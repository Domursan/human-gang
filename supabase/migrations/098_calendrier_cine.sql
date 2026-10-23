-- ===== Humane Gang — 098 : événements ponctuels du calendrier et affiches des films du ciné =====
-- S'applique après 087 (calendrier et ciné-club). Idempotente, rétrocompatible.
-- 1. Table hg_cal_events : événements ponctuels (titre, jour, heure ou journée entière, lieu, lien, note) ajoutés depuis
--    calendrier.html par l'admin ou le Staff « evenements ». RPC hg_cal_event_save(jsonb) et hg_cal_event_remove(uuid),
--    journalisées. hg_calendar_items les renvoie (kind 'site', meta.source = 'calendrier').
-- 2. Colonne hg_cine_films.poster_url (https) : affiche du film. RPC hg_cine_poster_set(uuid, text) : la personne qui a
--    proposé le film, le projectionniste ou le Staff « evenements ». Téléversement possible dans hg-assets sous
--    cine/<son id>/… (images du bucket : JPEG, PNG, WebP, 10 Mo).

-- ---------------------------------------------------------------------
-- 1. Événements ponctuels
-- ---------------------------------------------------------------------
create table if not exists public.hg_cal_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  all_day boolean not null default false,
  day date not null,
  starts_at timestamptz,
  location text check (location is null or char_length(location) <= 200),
  link text check (link is null or (link ~ '^https://' and char_length(link) <= 500)),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (all_day or starts_at is not null)
);
create index if not exists hg_cal_events_day_idx on public.hg_cal_events (day) where archived_at is null;
alter table public.hg_cal_events enable row level security;
revoke all on public.hg_cal_events from anon, authenticated;

-- Admin ou Staff « evenements » : crée (p.id absent) ou modifie un événement.
-- p = { id?, title, day 'AAAA-MM-JJ', time 'HH:MM' (vide = journée entière), location?, link?, note? }
create or replace function public.hg_cal_event_save(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; t text := btrim(coalesce(p->>'title', '')); d date; tm text := btrim(coalesce(p->>'time', ''));
  v_start timestamptz; v_loc text := nullif(btrim(coalesce(p->>'location', '')), ''); v_link text := nullif(btrim(coalesce(p->>'link', '')), '');
  v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
begin
  if not hg_has_perm('evenements') then raise exception 'Réservé à l’admin et au Staff « événements »'; end if;
  if char_length(t) < 1 or char_length(t) > 120 then raise exception 'Titre : de 1 à 120 caractères'; end if;
  if coalesce(p->>'day', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Choisis un jour'; end if;
  d := (p->>'day')::date;
  if d < current_date - 365 or d > current_date + 730 then raise exception 'Date : entre il y a un an et dans deux ans'; end if;
  if tm <> '' then
    if tm !~ '^\d{2}:\d{2}$' then raise exception 'Heure invalide'; end if;
    v_start := ((d + tm::time)::timestamp) at time zone 'Europe/Zurich';
  end if;
  if v_loc is not null and char_length(v_loc) > 200 then raise exception 'Lieu : 200 caractères au plus'; end if;
  if v_link is not null and (v_link !~ '^https://' or char_length(v_link) > 500) then raise exception 'Lien : une adresse https de 500 caractères au plus'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'Note : 500 caractères au plus'; end if;
  if v_id is null then
    if (select count(*) from hg_cal_events where archived_at is null and day >= current_date) >= 300 then raise exception 'Trop d’événements à venir (300 au plus)'; end if;
    insert into hg_cal_events (title, all_day, day, starts_at, location, link, note, created_by)
      values (t, v_start is null, d, v_start, v_loc, v_link, v_note, auth.uid()) returning id into v_id;
    perform hg_admin_audit('calendrier_evenement_cree', null, v_id::text, jsonb_build_object('titre', t, 'jour', d, 'heure', nullif(tm, '')));
  else
    update hg_cal_events set title = t, all_day = v_start is null, day = d, starts_at = v_start, location = v_loc, link = v_link,
        note = v_note, updated_at = now()
      where id = v_id and archived_at is null;
    if not found then raise exception 'Événement introuvable'; end if;
    perform hg_admin_audit('calendrier_evenement_modifie', null, v_id::text, jsonb_build_object('titre', t, 'jour', d, 'heure', nullif(tm, '')));
  end if;
  return v_id;
end $$;

-- Admin ou Staff « evenements » : retire un événement (archivé, plus affiché).
create or replace function public.hg_cal_event_remove(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare t text;
begin
  if not hg_has_perm('evenements') then raise exception 'Réservé à l’admin et au Staff « événements »'; end if;
  update hg_cal_events set archived_at = now() where id = p_id and archived_at is null returning title into t;
  if not found then raise exception 'Événement introuvable'; end if;
  perform hg_admin_audit('calendrier_evenement_retire', null, p_id::text, jsonb_build_object('titre', t));
end $$;

-- Le calendrier sait si le membre peut gérer les événements (bouton « Ajouter un événement »).
create or replace function public.hg_cal_can_manage()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$ select hg_has_perm('evenements') $$;

create or replace function public.hg_calendar_items(p_user uuid, p_from date, p_to date)
returns table (kind text, ref text, title text, starts_at timestamptz, all_day boolean, day date, link text, meta jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare z text := 'Europe/Zurich'; t0 timestamptz := (p_from::timestamp) at time zone 'Europe/Zurich';
  t1 timestamptz := ((p_to + 1)::timestamp) at time zone 'Europe/Zurich';
begin
  -- Sorties IRL (page irl)
  if hg_page_ok(p_user, 'irl') then
    return query select 'irl'::text, e.id::text, e.title, e.starts_at, false, (e.starts_at at time zone z)::date,
        'irl.html#event-' || e.id::text,
        jsonb_build_object('oui', (select count(*) from hg_event_rsvps r where r.event_id = e.id and r.status = 'oui'),
          'mine', (select r.status from hg_event_rsvps r where r.event_id = e.id and r.user_id = p_user))
      from hg_events e where not coalesce(e.retro, false) and e.starts_at >= t0 and e.starts_at < t1;
  end if;
  -- Séances du ciné-club (page cine)
  if hg_page_ok(p_user, 'cine') then
    return query select 'cine'::text, s.id::text,
        case when s.film_id is not null then 'Ciné : ' || f.title else 'Ciné-club : vote en cours' end,
        s.starts_at, false, (s.starts_at at time zone z)::date, 'cine.html',
        jsonb_build_object('status', s.status, 'presents', (select count(*) from hg_cine_presence p where p.session_id = s.id and p.active))
      from hg_cine_sessions s left join hg_cine_films f on f.id = s.film_id
      where s.status in ('vote', 'fixe', 'passee') and s.starts_at >= t0 and s.starts_at < t1;
  end if;
  -- Rendez-vous récurrents (hors dates annulées)
  return query select 'groupe'::text, g.id::text || ':' || d::date::text, g.title,
      ((d::date + g.at_time)::timestamp) at time zone z, false, d::date,
      coalesce(g.link, 'calendrier.html'),
      jsonb_build_object('slot_id', g.id, 'kind', g.kind, 'group', g.group_slug, 'by', g.created_by, 'every_weeks', g.every_weeks,
        'weekday', g.weekday, 'at_time', to_char(g.at_time, 'HH24:MI'))
    from hg_gang_slots g
    cross join lateral generate_series(
      greatest(g.starts_on, p_from)::timestamp, least(coalesce(g.ends_on, p_to), p_to)::timestamp, interval '1 day') d
    where g.archived_at is null
      and extract(isodow from d)::int = g.weekday
      and ((d::date - g.starts_on) / 7) % g.every_weeks = 0
      and not exists (select 1 from hg_gang_slot_skips k where k.slot_id = g.id and k.on_date = d::date and k.active);
  -- Anniversaires partagés (jour et mois seulement ; 29 février fêté le 28 les années non bissextiles)
  return query select 'anniv'::text, p.id::text || ':' || y::text, 'Anniversaire de ' || p.pseudo, null::timestamptz, true, bd, 'membre.html?id=' || p.id::text,
      jsonb_build_object('user_id', p.id)
    from hg_profiles p
    cross join generate_series(extract(year from p_from)::int, extract(year from p_to)::int) y
    cross join lateral (select case when extract(month from p.birthday) = 2 and extract(day from p.birthday) = 29
          and not (y % 4 = 0 and (y % 100 <> 0 or y % 400 = 0)) then make_date(y, 2, 28)
        else make_date(y, extract(month from p.birthday)::int, extract(day from p.birthday)::int) end as bd) b
    where p.share_birthday and p.birthday is not null and not p.is_ghost and bd between p_from and p_to;
  -- Secret Santa : date limite d'envoi et échange (page secret-santa)
  if hg_page_ok(p_user, 'secret-santa') then
    return query select 'site'::text, 'ss-envoi:' || e.id::text, 'Secret Santa ' || e.year || ' : date limite d’envoi', null::timestamptz, true,
        e.send_deadline, 'secret-santa.html', jsonb_build_object('source', 'secret_santa')
      from hg_ss_editions e where e.send_deadline between p_from and p_to;
    return query select 'site'::text, 'ss-echange:' || e.id::text, 'Secret Santa ' || e.year || ' : échange des cadeaux', null::timestamptz, true,
        e.exchange_date, 'secret-santa.html', jsonb_build_object('source', 'secret_santa')
      from hg_ss_editions e where e.exchange_date between p_from and p_to;
  end if;
  -- Événements du site déjà commencés (les événements à venir restent une surprise, comme sur evenements.html)
  if hg_page_ok(p_user, 'evenements') then
    return query select 'site'::text, 'dyn:' || v.id::text, v.name, v.starts_at, false, (v.starts_at at time zone z)::date,
        'evenements.html', jsonb_build_object('source', 'evenement', 'ends_at', v.ends_at)
      from hg_dyn_events v where v.active and v.starts_at <= now() and v.starts_at >= t0 and v.starts_at < t1;
  end if;
  -- Événements ponctuels ajoutés depuis le calendrier (migration 098)
  return query select 'site'::text, 'cal:' || c.id::text, c.title,
      case when c.all_day then null::timestamptz else c.starts_at end, c.all_day,
      case when c.all_day then c.day else (c.starts_at at time zone z)::date end,
      coalesce(c.link, 'calendrier.html'),
      jsonb_build_object('source', 'calendrier', 'event_id', c.id, 'location', c.location, 'note', c.note, 'by', c.created_by,
        'day', c.day, 'time', case when c.all_day then null else to_char(c.starts_at at time zone z, 'HH24:MI') end)
    from hg_cal_events c
    where c.archived_at is null
      and ((c.all_day and c.day between p_from and p_to) or (not c.all_day and c.starts_at >= t0 and c.starts_at < t1));
end $$;
revoke all on function public.hg_calendar_items(uuid, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Affiches des films
-- ---------------------------------------------------------------------
alter table public.hg_cine_films add column if not exists poster_url text;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_cine_films_poster_chk') then
    alter table public.hg_cine_films add constraint hg_cine_films_poster_chk
      check (poster_url is null or (poster_url ~ '^https://' and char_length(poster_url) <= 600));
  end if;
end $c$;

-- Pose ou retire (p_url vide) l'affiche d'un film. Droit : la personne qui l'a proposé (film pas encore retiré),
-- le projectionniste, le Staff « evenements ».
create or replace function public.hg_cine_poster_set(p_film uuid, p_url text)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); f hg_cine_films; u text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into f from hg_cine_films where id = p_film for update;
  if not found or f.status = 'retire' then raise exception 'Film introuvable'; end if;
  if not (f.proposed_by = me or hg_cine_is_host() or hg_has_perm('evenements')) then
    raise exception 'Seuls la personne qui a proposé le film, le projectionniste et le Staff peuvent changer l’affiche';
  end if;
  if u is not null and (u !~ '^https://' or char_length(u) > 600) then raise exception 'Affiche : une adresse https de 600 caractères au plus'; end if;
  update hg_cine_films set poster_url = u where id = f.id;
end $$;

-- Téléversement d'une affiche par un membre : bucket hg-assets, dossier cine/<son id>/ seulement.
do $s$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hg_assets_cine_ins') then
    create policy hg_assets_cine_ins on storage.objects for insert to authenticated
      with check (bucket_id = 'hg-assets' and name like 'cine/' || (select auth.uid())::text || '/%' and public.hg_is_member());
  end if;
end $s$;

do $g$
declare f text;
begin
  foreach f in array array['hg_cal_event_save(jsonb)', 'hg_cal_event_remove(uuid)', 'hg_cal_can_manage()', 'hg_cine_poster_set(uuid, text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $g$;
