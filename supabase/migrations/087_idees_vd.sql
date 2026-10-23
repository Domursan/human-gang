-- ===== Humane Gang — 087 : idées V8 (calendrier du gang), V9 (ciné-club) et D3 (commandes slash Discord) =====
-- Rôle :
--   V9  Ciné-club : films proposés (liste d'attente, « + »), séances avec vote (2 à 4 films), présence, report automatique
--       sous le seuil de votants, avis et notes après la séance, compteur « Le livre est mieux ».
--       Tables hg_cine_* (lecture membres, écriture UNIQUEMENT par RPC SECURITY DEFINER) ; réglage hg_settings.cine
--       écrit par hg_cine_config_set (Staff « evenements », borné, journalisé).
--       Les passages d'état (clôture du vote, report, séance passée) sont faits par hg_cine_tick(), déterministe et
--       idempotente : appelée à l'ouverture de la page (hg_cine_state) et par la clé service (cron).
--   V8  Calendrier : rendez-vous récurrents hg_gang_slots (+ exceptions hg_gang_slot_skips), lecture du mois par
--       hg_calendar(p_from, p_to) (membres), flux ICS personnel par jeton (hg_calendar_tokens, hg_calendar_feed lu
--       par la fonction edge hg-calendar avec la clé service). Anniversaires : jour et mois seulement, membres qui
--       partagent. Chaque source respecte l'accès aux pages (hg_pages / hg_page_access) du membre.
--   D3  Commandes slash : table d'idempotence hg_bot_interactions, interrupteurs hg_settings.bot_commandes
--       (Staff « bot », par RPC), et RPC « au nom de » réservées à la clé service (hg_bot_*) qui passent par les
--       mêmes RPC plafonnées que le site (hg_cards_me, hg_card_quests_me, hg_quiz_answer, réponse aux sorties).
-- Aucune récompense nouvelle : rien ici ne crédite de Paillettes (les RPC existantes gardent leurs plafonds).
-- Idempotente, rétrocompatible (tables et fonctions nouvelles, deux pages ajoutées à hg_pages).
-- Pas de suppression de ligne : les retraits sont des marquages (active, hidden_at, archived_at, status).

/* ======================================================================
   0. Utilitaires communs
   ====================================================================== */

-- Accès d'un membre à une page (même logique que hg_my_pages, mais pour un membre donné : sert au flux ICS).
-- Page non déclarée dans hg_pages : accessible.
create or replace function public.hg_page_ok(p_user uuid, p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user is null then false
    when coalesce((select is_admin from hg_profiles where id = p_user), false) then true
    when not exists (select 1 from hg_pages where slug = p_slug) then true
    else exists (select 1 from hg_pages p where p.slug = p_slug and (
      (p.mode = 'membres' and not exists (select 1 from hg_page_access a where a.page_slug = p.slug and a.user_id = p_user and not a.allowed))
      or (p.mode = 'liste' and exists (select 1 from hg_page_access a where a.page_slug = p.slug and a.user_id = p_user and a.allowed))))
  end
$$;
revoke all on function public.hg_page_ok(uuid, text) from public, anon, authenticated;

-- Deux nouvelles pages du menu, réservées aux admins au lancement (décision d'Ethan, 23/10 13:35) :
-- Ethan les ouvre lui-même depuis Membres › Accès aux pages.
insert into public.hg_pages (slug, label, mode, in_nav, sort) values
  ('calendrier', 'Calendrier', 'admin', true, 10),
  ('cine', 'Ciné-club', 'admin', true, 11)
on conflict (slug) do nothing;

/* ======================================================================
   1. V9 — Ciné-club : tables
   ====================================================================== */

create table if not exists public.hg_cine_films (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  year smallint check (year between 1888 and 2100),
  pitch text check (char_length(pitch) <= 200),
  proposed_by uuid,
  status text not null default 'attente' check (status in ('attente', 'en_lice', 'vu', 'retire')),
  seen_on date,
  created_at timestamptz not null default now()
);
create unique index if not exists hg_cine_films_titre_uniq on public.hg_cine_films (lower(btrim(title)), coalesce(year, 0)) where status <> 'retire';
create index if not exists hg_cine_films_status_idx on public.hg_cine_films (status);

create table if not exists public.hg_cine_film_plus (
  film_id uuid not null,
  user_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (film_id, user_id)
);

create table if not exists public.hg_cine_sessions (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  closes_at timestamptz not null,
  -- vote : vote ouvert ; fixe : film choisi ; passee : séance faite ; annulee : séance annulée (ou reportée trop souvent).
  status text not null default 'vote' check (status in ('vote', 'fixe', 'passee', 'annulee')),
  film_id uuid,
  voice_link text check (voice_link ~ '^https://discord\.com/channels/[0-9]{17,20}/[0-9]{17,20}$'),
  host_id uuid,
  postponed smallint not null default 0,
  postponed_at timestamptz,
  -- Marquages du bot (cron, clé service) : annonce du vote, du film choisi, du dernier report, rappel du jour.
  announced_at timestamptz,
  result_announced_at timestamptz,
  report_announced_at timestamptz,
  remind_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.hg_cine_sessions add column if not exists report_announced_at timestamptz;
create index if not exists hg_cine_sessions_status_idx on public.hg_cine_sessions (status, starts_at);
-- Une seule séance ouverte (vote ou fixe) à la fois.
create unique index if not exists hg_cine_sessions_une_ouverte on public.hg_cine_sessions ((true)) where status in ('vote', 'fixe');

create table if not exists public.hg_cine_session_films (
  session_id uuid not null,
  film_id uuid not null,
  primary key (session_id, film_id)
);

create table if not exists public.hg_cine_votes (
  session_id uuid not null,
  user_id uuid not null,
  film_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table if not exists public.hg_cine_presence (
  session_id uuid not null,
  user_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table if not exists public.hg_cine_reviews (
  film_id uuid not null,
  user_id uuid not null,
  stars smallint check (stars between 1 and 5),
  body text check (char_length(body) <= 280),
  book_better boolean not null default false,
  spoiler boolean not null default false,
  hidden_at timestamptz,         -- avis masqué par le Staff « souvenirs »
  hidden_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (film_id, user_id)
);

-- RLS : lecture par les membres ; aucune écriture directe (tout passe par les RPC ci-dessous).
alter table public.hg_cine_films enable row level security;
alter table public.hg_cine_film_plus enable row level security;
alter table public.hg_cine_sessions enable row level security;
alter table public.hg_cine_session_films enable row level security;
alter table public.hg_cine_votes enable row level security;
alter table public.hg_cine_presence enable row level security;
alter table public.hg_cine_reviews enable row level security;
do $$
declare t text;
begin
  foreach t in array array['hg_cine_films', 'hg_cine_film_plus', 'hg_cine_sessions', 'hg_cine_session_films', 'hg_cine_presence'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using (public.hg_is_member())', t || '_read', t);
    end if;
  end loop;
  -- Votes : chacun ne lit que le sien (les totaux passent par hg_cine_state).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_cine_votes' and policyname = 'hg_cine_votes_own') then
    create policy hg_cine_votes_own on public.hg_cine_votes for select to authenticated using (user_id = (select auth.uid()));
  end if;
  -- Avis : visibles des membres sauf masqués (le Staff « souvenirs » les voit tous).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_cine_reviews' and policyname = 'hg_cine_reviews_read') then
    create policy hg_cine_reviews_read on public.hg_cine_reviews for select to authenticated
      using (public.hg_is_member() and (hidden_at is null or user_id = (select auth.uid()) or public.hg_has_perm('souvenirs')));
  end if;
end $$;
revoke all on public.hg_cine_films, public.hg_cine_film_plus, public.hg_cine_sessions, public.hg_cine_session_films,
  public.hg_cine_votes, public.hg_cine_presence, public.hg_cine_reviews from anon, authenticated;
grant select on public.hg_cine_films, public.hg_cine_film_plus, public.hg_cine_sessions, public.hg_cine_session_films,
  public.hg_cine_votes, public.hg_cine_presence, public.hg_cine_reviews to authenticated;

/* ======================================================================
   2. V9 — Ciné-club : réglage et droits
   ====================================================================== */

-- Réglage hg_settings.cine borné, avec valeurs par défaut :
--   host_ids (projectionnistes, 10 au plus), seuil (votants minimum, 1..20, défaut 4), jour (0 = dimanche … 6, défaut 0),
--   heure ('HH:MM', défaut '20:30'), cloture_heures (clôture du vote avant la séance, 1..72, défaut 22 : samedi 22 h 30).
create or replace function public.hg_cine_cfg()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb := coalesce((select value from hg_settings where key = 'cine'), '{}'::jsonb);
  seuil int; jour int; heure text; clo int; hosts jsonb;
begin
  seuil := case when jsonb_typeof(v->'seuil') = 'number' and (v->>'seuil')::numeric between 1 and 20 then (v->>'seuil')::numeric::int else 4 end;
  jour := case when jsonb_typeof(v->'jour') = 'number' and (v->>'jour')::numeric between 0 and 6 then (v->>'jour')::numeric::int else 0 end;
  heure := case when coalesce(v->>'heure', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then v->>'heure' else '20:30' end;
  clo := case when jsonb_typeof(v->'cloture_heures') = 'number' and (v->>'cloture_heures')::numeric between 1 and 72 then (v->>'cloture_heures')::numeric::int else 22 end;
  hosts := case when jsonb_typeof(v->'host_ids') = 'array' then v->'host_ids' else '[]'::jsonb end;
  return jsonb_build_object('seuil', seuil, 'jour', jour, 'heure', heure, 'cloture_heures', clo, 'host_ids', hosts);
end $$;
revoke all on function public.hg_cine_cfg() from public, anon, authenticated;

-- Projectionniste : listé dans cine.host_ids, ou Staff « evenements » (et l'admin).
create or replace function public.hg_cine_is_host()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.hg_is_member() and (
    public.hg_has_perm('evenements')
    or coalesce((public.hg_cine_cfg()->'host_ids') ? (auth.uid())::text, false))
$$;
revoke all on function public.hg_cine_is_host() from public, anon;
grant execute on function public.hg_cine_is_host() to authenticated;

-- Vrai si l'action d'animation est faite au titre du Staff (pas listé comme projectionniste) : à journaliser.
create or replace function public.hg_cine_as_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not coalesce((public.hg_cine_cfg()->'host_ids') ? (auth.uid())::text, false)
$$;
revoke all on function public.hg_cine_as_staff() from public, anon, authenticated;

-- Écrit le réglage cine (Staff « evenements »), borné, journalisé.
create or replace function public.hg_cine_config_set(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare hosts jsonb := '[]'::jsonb; h text; v jsonb;
begin
  if not hg_has_perm('evenements') then raise exception 'Réservé au Staff « evenements »'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Réglage invalide'; end if;
  if p ? 'host_ids' then
    if jsonb_typeof(p->'host_ids') <> 'array' or jsonb_array_length(p->'host_ids') > 10 then
      raise exception 'Projectionnistes : 10 au plus';
    end if;
    for h in select jsonb_array_elements_text(p->'host_ids') loop
      if h !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or not exists (select 1 from hg_profiles where id = h::uuid and not is_ghost) then
        raise exception 'Projectionniste inconnu';
      end if;
      if not hosts ? h then hosts := hosts || to_jsonb(h); end if;
    end loop;
  else
    hosts := hg_cine_cfg()->'host_ids';
  end if;
  if p ? 'seuil' and not (jsonb_typeof(p->'seuil') = 'number' and (p->>'seuil')::numeric between 1 and 20 and (p->>'seuil')::numeric % 1 = 0) then
    raise exception 'Seuil de votants : entier de 1 à 20';
  end if;
  if p ? 'jour' and not (jsonb_typeof(p->'jour') = 'number' and (p->>'jour')::numeric between 0 and 6 and (p->>'jour')::numeric % 1 = 0) then
    raise exception 'Jour : 0 (dimanche) à 6 (samedi)';
  end if;
  if p ? 'heure' and coalesce(p->>'heure', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Heure : format HH:MM';
  end if;
  if p ? 'cloture_heures' and not (jsonb_typeof(p->'cloture_heures') = 'number' and (p->>'cloture_heures')::numeric between 1 and 72 and (p->>'cloture_heures')::numeric % 1 = 0) then
    raise exception 'Clôture du vote : de 1 à 72 heures avant la séance';
  end if;
  v := hg_cine_cfg();
  v := jsonb_build_object(
    'host_ids', hosts,
    'seuil', coalesce((p->>'seuil')::numeric::int, (v->>'seuil')::int),
    'jour', coalesce((p->>'jour')::numeric::int, (v->>'jour')::int),
    'heure', coalesce(p->>'heure', v->>'heure'),
    'cloture_heures', coalesce((p->>'cloture_heures')::numeric::int, (v->>'cloture_heures')::int));
  insert into hg_settings (key, value, updated_at) values ('cine', v, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform hg_admin_audit('cine_reglage', null, 'cine', v);
  return v;
end $$;
revoke all on function public.hg_cine_config_set(jsonb) from public, anon;
grant execute on function public.hg_cine_config_set(jsonb) to authenticated;

/* ======================================================================
   3. V9 — Ciné-club : passages d'état (idempotents)
   ====================================================================== */

-- Clôt les votes échus (report d'une semaine sous le seuil, sinon film gagnant), passe les séances faites.
-- Déterministe : ne fait que ce que l'heure impose. Appelable par les membres (via hg_cine_state) et la clé service.
create or replace function public.hg_cine_tick()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare s hg_cine_sessions; cfg jsonb := hg_cine_cfg(); voters int; win uuid; n int := 0; loops int;
begin
  if auth.uid() is not null and not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  for s in select * from hg_cine_sessions where status = 'vote' and closes_at <= now() for update skip locked loop
    loops := 0;
    loop
      select count(*) into voters from hg_cine_votes where session_id = s.id;
      exit when voters >= (cfg->>'seuil')::int or loops >= 10;
      -- Trop peu de votants : report d'une semaine (les votes déjà faits restent valables).
      s.starts_at := s.starts_at + interval '7 days';
      s.closes_at := s.closes_at + interval '7 days';
      s.postponed := s.postponed + 1;
      loops := loops + 1;
      exit when s.closes_at > now();
    end loop;
    if voters >= (cfg->>'seuil')::int and s.closes_at <= now() then
      -- Gagnant : plus de votes, puis plus de « + », puis le plus ancien proposé.
      select v.film_id into win from hg_cine_votes v join hg_cine_films f on f.id = v.film_id
        where v.session_id = s.id
        group by v.film_id, f.created_at
        order by count(*) desc, (select count(*) from hg_cine_film_plus p where p.film_id = v.film_id and p.active) desc, f.created_at
        limit 1;
      update hg_cine_sessions set status = 'fixe', film_id = win, starts_at = s.starts_at, closes_at = s.closes_at,
        postponed = s.postponed, postponed_at = case when loops > 0 then now() else postponed_at end,
        result_announced_at = null, report_announced_at = case when loops > 0 then null else report_announced_at end
        where id = s.id;
      update hg_cine_films set status = 'attente'
        where status = 'en_lice' and id <> win and id in (select film_id from hg_cine_session_films where session_id = s.id);
    elsif s.postponed > 4 then
      -- Reportée plus de quatre fois : séance annulée, les films retournent dans la liste d'attente.
      update hg_cine_sessions set status = 'annulee', postponed = s.postponed, postponed_at = now() where id = s.id;
      update hg_cine_films set status = 'attente'
        where status = 'en_lice' and id in (select film_id from hg_cine_session_films where session_id = s.id);
    else
      update hg_cine_sessions set starts_at = s.starts_at, closes_at = s.closes_at, postponed = s.postponed,
        postponed_at = now(), report_announced_at = null, remind_at = null where id = s.id;
    end if;
    n := n + 1;
  end loop;
  -- Séance terminée (3 h après le début) : passée, le film devient « vu » et s'ouvre aux avis.
  for s in select * from hg_cine_sessions where status = 'fixe' and starts_at + interval '3 hours' <= now() for update skip locked loop
    update hg_cine_sessions set status = 'passee' where id = s.id;
    update hg_cine_films set status = 'vu', seen_on = (s.starts_at at time zone 'Europe/Zurich')::date where id = s.film_id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.hg_cine_tick() from public, anon;
grant execute on function public.hg_cine_tick() to authenticated, service_role;

/* ======================================================================
   4. V9 — Ciné-club : lecture (page cine.html)
   ====================================================================== */

-- État complet de la page : réglage, séance ouverte (films, totaux, mon vote, présents), liste d'attente, films vus.
create or replace function public.hg_cine_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := auth.uid(); s hg_cine_sessions; cur jsonb := null; last jsonb := null;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  perform hg_cine_tick();
  select * into s from hg_cine_sessions where status in ('vote', 'fixe') order by starts_at limit 1;
  if found then
    cur := jsonb_build_object(
      'id', s.id, 'starts_at', s.starts_at, 'closes_at', s.closes_at, 'status', s.status, 'film_id', s.film_id,
      'voice_link', s.voice_link, 'host_id', s.host_id, 'postponed', s.postponed, 'postponed_at', s.postponed_at,
      'voters', (select count(*) from hg_cine_votes where session_id = s.id),
      'my_vote', (select film_id from hg_cine_votes where session_id = s.id and user_id = me),
      'presence', coalesce((select jsonb_agg(user_id order by created_at) from hg_cine_presence where session_id = s.id and active), '[]'::jsonb),
      'films', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title, 'year', f.year, 'pitch', f.pitch,
          'proposed_by', f.proposed_by, 'votes', (select count(*) from hg_cine_votes v where v.session_id = s.id and v.film_id = f.id))
          order by f.created_at)
        from hg_cine_session_films sf join hg_cine_films f on f.id = sf.film_id where sf.session_id = s.id), '[]'::jsonb));
  end if;
  -- Dernière séance annulée récente (message « match nul par forfait » pendant 7 jours).
  select jsonb_build_object('id', id, 'starts_at', starts_at, 'postponed', postponed) into last
    from hg_cine_sessions where status = 'annulee' and postponed_at > now() - interval '7 days' order by postponed_at desc limit 1;
  return jsonb_build_object(
    'cfg', hg_cine_cfg(),
    'is_host', hg_cine_is_host(),
    'can_moderate', hg_has_perm('souvenirs'),
    'current', cur,
    'cancelled', last,
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title, 'year', f.year, 'pitch', f.pitch,
        'proposed_by', f.proposed_by, 'created_at', f.created_at,
        'plus', (select count(*) from hg_cine_film_plus p where p.film_id = f.id and p.active),
        'my_plus', exists (select 1 from hg_cine_film_plus p where p.film_id = f.id and p.user_id = me and p.active))
        order by (select count(*) from hg_cine_film_plus p where p.film_id = f.id and p.active) desc, f.created_at)
      from hg_cine_films f where f.status = 'attente'), '[]'::jsonb),
    'seen', coalesce((select jsonb_agg(x order by x->>'seen_on' desc) from (
        select jsonb_build_object('id', f.id, 'title', f.title, 'year', f.year, 'pitch', f.pitch, 'seen_on', f.seen_on,
          'proposed_by', f.proposed_by,
          'avg', (select round(avg(r.stars)::numeric, 1) from hg_cine_reviews r where r.film_id = f.id and r.hidden_at is null and r.stars is not null),
          'notes', (select count(*) from hg_cine_reviews r where r.film_id = f.id and r.hidden_at is null and r.stars is not null),
          'book_better', (select count(*) from hg_cine_reviews r where r.film_id = f.id and r.book_better and r.hidden_at is null),
          'viewers', (select count(*) from hg_cine_presence p join hg_cine_sessions ss on ss.id = p.session_id
                        where ss.film_id = f.id and ss.status = 'passee' and p.active),
          'mine', (select jsonb_build_object('stars', r.stars, 'body', r.body, 'book_better', r.book_better, 'spoiler', r.spoiler)
                     from hg_cine_reviews r where r.film_id = f.id and r.user_id = me),
          'reviews', coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'stars', r.stars, 'body', r.body,
                'spoiler', r.spoiler, 'book_better', r.book_better, 'updated_at', r.updated_at) order by r.updated_at desc)
              from hg_cine_reviews r where r.film_id = f.id and r.hidden_at is null and r.body is not null), '[]'::jsonb)) as x
        from hg_cine_films f where f.status = 'vu' order by f.seen_on desc nulls last limit 100) t), '[]'::jsonb));
end $$;
revoke all on function public.hg_cine_state() from public, anon;
grant execute on function public.hg_cine_state() to authenticated;

/* ======================================================================
   5. V9 — Ciné-club : actions des membres
   ====================================================================== */

-- Propose un film (liste d'attente). Plafonds : 5 films en attente par membre, 10 propositions par 24 h, 200 en attente au total.
create or replace function public.hg_cine_propose(p_title text, p_year int default null, p_pitch text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := auth.uid(); t text := btrim(coalesce(p_title, '')); pi text := nullif(btrim(coalesce(p_pitch, '')), ''); fid uuid;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if char_length(t) < 1 or char_length(t) > 120 then raise exception 'Titre : de 1 à 120 caractères'; end if;
  if p_year is not null and (p_year < 1888 or p_year > extract(year from now())::int + 2) then raise exception 'Année invalide'; end if;
  if pi is not null and char_length(pi) > 200 then raise exception 'Pourquoi ce film : 200 caractères au maximum'; end if;
  perform pg_advisory_xact_lock(hashtext('hg_cine_propose:' || me::text));
  if (select count(*) from hg_cine_films where proposed_by = me and status = 'attente') >= 5 then
    raise exception 'Tu as déjà 5 films en attente : attends qu’un passe à l’écran';
  end if;
  if (select count(*) from hg_cine_films where proposed_by = me and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'Trop de propositions aujourd’hui : réessaie demain';
  end if;
  if (select count(*) from hg_cine_films where status = 'attente') >= 200 then raise exception 'La liste d’attente est pleine'; end if;
  if exists (select 1 from hg_cine_films where status <> 'retire' and lower(btrim(title)) = lower(t) and coalesce(year, 0) = coalesce(p_year, 0)) then
    raise exception 'Ce film est déjà proposé';
  end if;
  insert into hg_cine_films (title, year, pitch, proposed_by) values (t, p_year, pi, me) returning hg_cine_films.id into fid;
  return fid;
end $$;
revoke all on function public.hg_cine_propose(text, int, text) from public, anon;
grant execute on function public.hg_cine_propose(text, int, text) to authenticated;

-- « + » sur un film de la liste d'attente (bascule). Renvoie le nouvel état.
create or replace function public.hg_cine_plus(p_film uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := auth.uid(); on_ boolean;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if not exists (select 1 from hg_cine_films where id = p_film and status in ('attente', 'en_lice')) then raise exception 'Film introuvable'; end if;
  insert into hg_cine_film_plus (film_id, user_id, active) values (p_film, me, true)
    on conflict (film_id, user_id) do update set active = not hg_cine_film_plus.active, created_at = now()
    returning active into on_;
  return on_;
end $$;
revoke all on function public.hg_cine_plus(uuid) from public, anon;
grant execute on function public.hg_cine_plus(uuid) to authenticated;

-- Retire un film de la liste d'attente : son auteur, ou un projectionniste (journalisé pour le Staff).
create or replace function public.hg_cine_withdraw(p_film uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare f hg_cine_films;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into f from hg_cine_films where id = p_film for update;
  if not found or f.status <> 'attente' then raise exception 'Seul un film en attente peut être retiré'; end if;
  if f.proposed_by is distinct from auth.uid() and not hg_cine_is_host() then raise exception 'Seul l’auteur ou le projectionniste peut retirer ce film'; end if;
  update hg_cine_films set status = 'retire' where id = p_film;
  if f.proposed_by is distinct from auth.uid() and hg_cine_as_staff() then
    perform hg_admin_audit('cine_film_retire', f.proposed_by, p_film::text, jsonb_build_object('titre', f.title));
  end if;
end $$;
revoke all on function public.hg_cine_withdraw(uuid) from public, anon;
grant execute on function public.hg_cine_withdraw(uuid) to authenticated;

-- Vote (ou change de vote) pour un film en lice, tant que le vote est ouvert.
create or replace function public.hg_cine_vote(p_session uuid, p_film uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  perform hg_cine_tick();
  if not exists (select 1 from hg_cine_sessions where id = p_session and status = 'vote' and closes_at > now()) then
    raise exception 'Le vote est clos';
  end if;
  if not exists (select 1 from hg_cine_session_films where session_id = p_session and film_id = p_film) then
    raise exception 'Ce film n’est pas en lice';
  end if;
  insert into hg_cine_votes (session_id, user_id, film_id) values (p_session, auth.uid(), p_film)
    on conflict (session_id, user_id) do update set film_id = excluded.film_id, created_at = now();
end $$;
revoke all on function public.hg_cine_vote(uuid, uuid) from public, anon;
grant execute on function public.hg_cine_vote(uuid, uuid) to authenticated;

-- « Je serai là » (ou plus là) pour la séance ouverte.
create or replace function public.hg_cine_presence_set(p_session uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if not exists (select 1 from hg_cine_sessions where id = p_session and status in ('vote', 'fixe') and starts_at > now() - interval '3 hours') then
    raise exception 'Cette séance n’est plus ouverte';
  end if;
  insert into hg_cine_presence (session_id, user_id, active) values (p_session, auth.uid(), coalesce(p_on, true))
    on conflict (session_id, user_id) do update set active = excluded.active;
end $$;
revoke all on function public.hg_cine_presence_set(uuid, boolean) from public, anon;
grant execute on function public.hg_cine_presence_set(uuid, boolean) to authenticated;

-- Note et avis (après la séance seulement : film « vu »). p_stars null = pas de note ; p_body vide = pas d'avis.
create or replace function public.hg_cine_review(p_film uuid, p_stars int, p_body text default null, p_spoiler boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare b text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if not exists (select 1 from hg_cine_films where id = p_film and status = 'vu') then
    raise exception 'Les avis s’ouvrent après la séance';
  end if;
  if p_stars is not null and (p_stars < 1 or p_stars > 5) then raise exception 'Note : de 1 à 5 étoiles'; end if;
  if b is not null and char_length(b) > 280 then raise exception 'Avis : 280 caractères au maximum'; end if;
  insert into hg_cine_reviews (film_id, user_id, stars, body, spoiler) values (p_film, auth.uid(), p_stars, b, coalesce(p_spoiler, false))
    on conflict (film_id, user_id) do update set stars = excluded.stars, body = excluded.body, spoiler = excluded.spoiler, updated_at = now();
end $$;
revoke all on function public.hg_cine_review(uuid, int, text, boolean) from public, anon;
grant execute on function public.hg_cine_review(uuid, int, text, boolean) to authenticated;

-- « Le livre est mieux » (bascule), après la séance.
create or replace function public.hg_cine_book_better(p_film uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare on_ boolean;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if not exists (select 1 from hg_cine_films where id = p_film and status = 'vu') then raise exception 'Les avis s’ouvrent après la séance'; end if;
  insert into hg_cine_reviews (film_id, user_id, book_better) values (p_film, auth.uid(), true)
    on conflict (film_id, user_id) do update set book_better = not hg_cine_reviews.book_better, updated_at = now()
    returning book_better into on_;
  return on_;
end $$;
revoke all on function public.hg_cine_book_better(uuid) from public, anon;
grant execute on function public.hg_cine_book_better(uuid) to authenticated;

-- Masque un avis (Staff « souvenirs », journalisé) ou retire le sien (texte et note effacés).
create or replace function public.hg_cine_review_hide(p_film uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_user = auth.uid() then
    update hg_cine_reviews set stars = null, body = null, spoiler = false, updated_at = now() where film_id = p_film and user_id = p_user;
    return;
  end if;
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »'; end if;
  update hg_cine_reviews set hidden_at = now(), hidden_by = auth.uid() where film_id = p_film and user_id = p_user and hidden_at is null;
  if found then perform hg_admin_audit('cine_avis_masque', p_user, p_film::text, '{}'::jsonb); end if;
end $$;
revoke all on function public.hg_cine_review_hide(uuid, uuid) from public, anon;
grant execute on function public.hg_cine_review_hide(uuid, uuid) to authenticated;

/* ======================================================================
   6. V9 — Ciné-club : animation (projectionniste ou Staff « evenements »)
   ====================================================================== */

-- Ouvre une séance avec vote : 2 à 4 films de la liste d'attente, date dans les 60 jours, lien du salon vocal Discord facultatif.
create or replace function public.hg_cine_session_open(p_starts_at timestamptz, p_films uuid[], p_voice_link text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare sid uuid; clo timestamptz; n int; lnk text := nullif(btrim(coalesce(p_voice_link, '')), '');
begin
  if not hg_cine_is_host() then raise exception 'Réservé au projectionniste'; end if;
  perform hg_cine_tick();
  if exists (select 1 from hg_cine_sessions where status in ('vote', 'fixe')) then raise exception 'Une séance est déjà programmée'; end if;
  if p_starts_at is null or p_starts_at < now() + interval '1 hour' or p_starts_at > now() + interval '60 days' then
    raise exception 'Date de séance : entre dans 1 heure et dans 60 jours';
  end if;
  select count(distinct f) into n from unnest(coalesce(p_films, '{}')) f;
  if n < 2 or n > 4 or n <> cardinality(p_films) then raise exception 'Choisis de 2 à 4 films différents'; end if;
  if (select count(*) from hg_cine_films where id = any(p_films) and status = 'attente') <> n then
    raise exception 'Les films doivent venir de la liste d’attente';
  end if;
  if lnk is not null and lnk !~ '^https://discord\.com/channels/[0-9]{17,20}/[0-9]{17,20}$' then
    raise exception 'Lien : seulement un salon vocal Discord (https://discord.com/channels/…)';
  end if;
  clo := p_starts_at - make_interval(hours => (hg_cine_cfg()->>'cloture_heures')::int);
  if clo < now() + interval '10 minutes' then clo := least(now() + interval '10 minutes', p_starts_at - interval '5 minutes'); end if;
  insert into hg_cine_sessions (starts_at, closes_at, voice_link, host_id) values (p_starts_at, clo, lnk, auth.uid())
    returning hg_cine_sessions.id into sid;
  insert into hg_cine_session_films (session_id, film_id) select sid, f from unnest(p_films) f;
  update hg_cine_films set status = 'en_lice' where id = any(p_films);
  if hg_cine_as_staff() then perform hg_admin_audit('cine_seance', null, sid::text, jsonb_build_object('debut', p_starts_at, 'films', n)); end if;
  return sid;
end $$;
revoke all on function public.hg_cine_session_open(timestamptz, uuid[], text) from public, anon;
grant execute on function public.hg_cine_session_open(timestamptz, uuid[], text) to authenticated;

-- Modifie la séance ouverte : action 'fix' (choisir le film), 'cancel' (annuler), 'link' (lien vocal).
create or replace function public.hg_cine_session_admin(p_session uuid, p_action text, p_film uuid default null, p_voice_link text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s hg_cine_sessions; lnk text := nullif(btrim(coalesce(p_voice_link, '')), '');
begin
  if not hg_cine_is_host() then raise exception 'Réservé au projectionniste'; end if;
  select * into s from hg_cine_sessions where id = p_session for update;
  if not found or s.status not in ('vote', 'fixe') then raise exception 'Séance introuvable ou close'; end if;
  if p_action = 'fix' then
    if not exists (select 1 from hg_cine_session_films where session_id = s.id and film_id = p_film) then raise exception 'Ce film n’est pas en lice'; end if;
    update hg_cine_sessions set status = 'fixe', film_id = p_film, result_announced_at = null where id = s.id;
    update hg_cine_films set status = 'attente' where status = 'en_lice' and id <> p_film
      and id in (select film_id from hg_cine_session_films where session_id = s.id);
  elsif p_action = 'cancel' then
    update hg_cine_sessions set status = 'annulee', postponed_at = now() where id = s.id;
    update hg_cine_films set status = 'attente' where status = 'en_lice' and id in (select film_id from hg_cine_session_films where session_id = s.id);
  elsif p_action = 'link' then
    if lnk is not null and lnk !~ '^https://discord\.com/channels/[0-9]{17,20}/[0-9]{17,20}$' then
      raise exception 'Lien : seulement un salon vocal Discord (https://discord.com/channels/…)';
    end if;
    update hg_cine_sessions set voice_link = lnk where id = s.id;
  else
    raise exception 'Action inconnue';
  end if;
  if hg_cine_as_staff() then perform hg_admin_audit('cine_seance_' || p_action, null, s.id::text, jsonb_build_object('film', p_film)); end if;
end $$;
revoke all on function public.hg_cine_session_admin(uuid, text, uuid, text) from public, anon;
grant execute on function public.hg_cine_session_admin(uuid, text, uuid, text) to authenticated;

/* ======================================================================
   7. V8 — Calendrier : rendez-vous récurrents
   ====================================================================== */

create table if not exists public.hg_gang_slots (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  kind text not null default 'groupe' check (kind in ('groupe', 'soiree', 'sport', 'autre')),
  weekday smallint not null check (weekday between 1 and 7),          -- 1 = lundi … 7 = dimanche (ISO)
  every_weeks smallint not null default 1 check (every_weeks between 1 and 4),
  at_time time not null,
  starts_on date not null,
  ends_on date,
  group_slug text check (group_slug ~ '^[a-z0-9-]{1,40}$'),            -- groupe d'intérêt (V10), facultatif
  link text check (char_length(link) <= 300 and link ~ '^https://'),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (ends_on is null or (ends_on >= starts_on and ends_on <= starts_on + 400))
);
create table if not exists public.hg_gang_slot_skips (
  slot_id uuid not null,
  on_date date not null,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (slot_id, on_date)
);
alter table public.hg_gang_slots enable row level security;
alter table public.hg_gang_slot_skips enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_gang_slots' and policyname = 'hg_gang_slots_read') then
    create policy hg_gang_slots_read on public.hg_gang_slots for select to authenticated using (public.hg_is_member());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_gang_slot_skips' and policyname = 'hg_gang_slot_skips_read') then
    create policy hg_gang_slot_skips_read on public.hg_gang_slot_skips for select to authenticated using (public.hg_is_member());
  end if;
end $$;
revoke all on public.hg_gang_slots, public.hg_gang_slot_skips from anon, authenticated;
grant select on public.hg_gang_slots, public.hg_gang_slot_skips to authenticated;

-- Crée (p.id absent) ou modifie un rendez-vous récurrent. Auteur ou Staff « evenements » (journalisé sur celui d'un autre).
-- Plafonds : 30 rendez-vous actifs au total, 5 par membre (hors Staff).
create or replace function public.hg_gang_slot_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := auth.uid(); s hg_gang_slots; sid uuid; t text; k text; wd int; ew int; tm time; so date; eo date; gs text; lk text; staff boolean := hg_has_perm('evenements');
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Données invalides'; end if;
  t := btrim(coalesce(p->>'title', ''));
  if char_length(t) < 1 or char_length(t) > 80 then raise exception 'Titre : de 1 à 80 caractères'; end if;
  k := coalesce(nullif(p->>'kind', ''), 'groupe');
  if k not in ('groupe', 'soiree', 'sport', 'autre') then raise exception 'Type inconnu'; end if;
  if coalesce(p->>'weekday', '') !~ '^[1-7]$' then raise exception 'Jour : de 1 (lundi) à 7 (dimanche)'; end if;
  wd := (p->>'weekday')::int;
  ew := coalesce(nullif(p->>'every_weeks', '')::int, 1);
  if ew < 1 or ew > 4 then raise exception 'Fréquence : toutes les 1 à 4 semaines'; end if;
  if coalesce(p->>'at_time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Heure : format HH:MM'; end if;
  tm := (p->>'at_time')::time;
  begin
    so := coalesce(nullif(p->>'starts_on', '')::date, (now() at time zone 'Europe/Zurich')::date);
    eo := nullif(p->>'ends_on', '')::date;
  exception when others then raise exception 'Date invalide';
  end;
  if eo is not null and (eo < so or eo > so + 400) then raise exception 'Fin : après le début et dans les 13 mois'; end if;
  gs := nullif(p->>'group_slug', '');
  if gs is not null and gs !~ '^[a-z0-9-]{1,40}$' then raise exception 'Groupe invalide'; end if;
  lk := nullif(btrim(coalesce(p->>'link', '')), '');
  if lk is not null and (lk !~ '^https://[^\s<>"]+$' or char_length(lk) > 300) then raise exception 'Lien : adresse https:// de 300 caractères au plus'; end if;
  if nullif(p->>'id', '') is null then
    if so < (now() at time zone 'Europe/Zurich')::date - 7 or so > (now() at time zone 'Europe/Zurich')::date + 365 then raise exception 'Début : dans l’année qui vient'; end if;
    perform pg_advisory_xact_lock(hashtext('hg_gang_slots'));
    if (select count(*) from hg_gang_slots where archived_at is null and (ends_on is null or ends_on >= current_date)) >= 30 then
      raise exception 'Le calendrier compte déjà 30 rendez-vous récurrents : archive un ancien d’abord';
    end if;
    if not staff and (select count(*) from hg_gang_slots where created_by = me and archived_at is null and (ends_on is null or ends_on >= current_date)) >= 5 then
      raise exception 'Tu as déjà 5 rendez-vous récurrents';
    end if;
    insert into hg_gang_slots (title, kind, weekday, every_weeks, at_time, starts_on, ends_on, group_slug, link, created_by)
      values (t, k, wd, ew, tm, so, eo, gs, lk, me) returning id into sid;
    return sid;
  end if;
  select * into s from hg_gang_slots where id = (p->>'id')::uuid for update;
  if not found or s.archived_at is not null then raise exception 'Rendez-vous introuvable'; end if;
  if s.created_by is distinct from me and not staff then raise exception 'Seul l’auteur ou le Staff « evenements » peut le modifier'; end if;
  update hg_gang_slots set title = t, kind = k, weekday = wd, every_weeks = ew, at_time = tm, starts_on = so, ends_on = eo,
    group_slug = gs, link = lk, updated_at = now() where id = s.id;
  if s.created_by is distinct from me then perform hg_admin_audit('creneau_modifie', s.created_by, s.id::text, jsonb_build_object('titre', t)); end if;
  return s.id;
end $$;
revoke all on function public.hg_gang_slot_save(jsonb) from public, anon;
grant execute on function public.hg_gang_slot_save(jsonb) to authenticated;

-- Archive (retire du calendrier) un rendez-vous récurrent.
create or replace function public.hg_gang_slot_archive(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s hg_gang_slots;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into s from hg_gang_slots where id = p_id for update;
  if not found or s.archived_at is not null then raise exception 'Rendez-vous introuvable'; end if;
  if s.created_by is distinct from auth.uid() and not hg_has_perm('evenements') then raise exception 'Seul l’auteur ou le Staff « evenements » peut le retirer'; end if;
  update hg_gang_slots set archived_at = now(), updated_at = now() where id = s.id;
  if s.created_by is distinct from auth.uid() then perform hg_admin_audit('creneau_archive', s.created_by, s.id::text, jsonb_build_object('titre', s.title)); end if;
end $$;
revoke all on function public.hg_gang_slot_archive(uuid) from public, anon;
grant execute on function public.hg_gang_slot_archive(uuid) to authenticated;

-- Annule (p_skip = true) ou rétablit une occurrence précise d'un rendez-vous récurrent.
create or replace function public.hg_gang_slot_skip(p_id uuid, p_date date, p_skip boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s hg_gang_slots;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into s from hg_gang_slots where id = p_id;
  if not found or s.archived_at is not null then raise exception 'Rendez-vous introuvable'; end if;
  if s.created_by is distinct from auth.uid() and not hg_has_perm('evenements') then raise exception 'Seul l’auteur ou le Staff « evenements » peut annuler une date'; end if;
  if p_date is null or p_date < s.starts_on or (s.ends_on is not null and p_date > s.ends_on)
     or extract(isodow from p_date)::int <> s.weekday or ((p_date - s.starts_on) / 7) % s.every_weeks <> 0 then
    raise exception 'Cette date ne fait pas partie du rendez-vous';
  end if;
  insert into hg_gang_slot_skips (slot_id, on_date, active, created_by) values (s.id, p_date, coalesce(p_skip, true), auth.uid())
    on conflict (slot_id, on_date) do update set active = excluded.active, created_by = excluded.created_by, created_at = now();
  if s.created_by is distinct from auth.uid() then perform hg_admin_audit('creneau_date', s.created_by, s.id::text, jsonb_build_object('date', p_date, 'annule', p_skip)); end if;
end $$;
revoke all on function public.hg_gang_slot_skip(uuid, date, boolean) from public, anon;
grant execute on function public.hg_gang_slot_skip(uuid, date, boolean) to authenticated;

/* ======================================================================
   8. V8 — Calendrier : lecture
   ====================================================================== */

-- Rendez-vous de [p_from ; p_to] vus par p_user (interne : appelée par hg_calendar et hg_calendar_feed).
-- kind : irl | cine | groupe | anniv | site. Heures en UTC (timestamptz) ; jour en heure de Zurich.
-- Aucune adresse, aucune liste de participants, jamais l'année de naissance.
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
  -- Soirée de la semaine (idée V7) : branchée ici quand sa table existera (hg_week_nights).
end $$;
revoke all on function public.hg_calendar_items(uuid, date, date) from public, anon, authenticated;

-- Calendrier d'une période (62 jours au plus) pour le membre connecté.
create or replace function public.hg_calendar(p_from date, p_to date)
returns table (kind text, ref text, title text, starts_at timestamptz, all_day boolean, day date, link text, meta jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then raise exception 'Période invalide (62 jours au plus)'; end if;
  return query select * from hg_calendar_items(auth.uid(), p_from, p_to) i order by i.day, i.all_day desc, i.starts_at nulls first, i.title;
end $$;
revoke all on function public.hg_calendar(date, date) from public, anon;
grant execute on function public.hg_calendar(date, date) to authenticated;

/* ======================================================================
   9. V8 — Calendrier : abonnement ICS personnel
   ====================================================================== */

create table if not exists public.hg_calendar_tokens (
  user_id uuid primary key,
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.hg_calendar_tokens enable row level security;
-- Aucune policy : lecture et écriture par les RPC ci-dessous seulement.
revoke all on public.hg_calendar_tokens from anon, authenticated;

-- Mon jeton d'abonnement (créé à la première demande).
create or replace function public.hg_calendar_token_me()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare t text;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select token into t from hg_calendar_tokens where user_id = auth.uid();
  if t is null then
    insert into hg_calendar_tokens (user_id, token)
      values (auth.uid(), replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
      on conflict (user_id) do nothing;
    select token into t from hg_calendar_tokens where user_id = auth.uid();
  end if;
  return t;
end $$;
revoke all on function public.hg_calendar_token_me() from public, anon;
grant execute on function public.hg_calendar_token_me() to authenticated;

-- Nouveau jeton : l'ancienne adresse cesse de fonctionner.
create or replace function public.hg_calendar_token_reset()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare t text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_calendar_tokens (user_id, token) values (auth.uid(), t)
    on conflict (user_id) do update set token = excluded.token, created_at = now(), last_used_at = null;
  return t;
end $$;
revoke all on function public.hg_calendar_token_reset() from public, anon;
grant execute on function public.hg_calendar_token_reset() to authenticated;

-- Flux ICS (clé service, fonction edge hg-calendar) : 60 jours en arrière, 365 jours en avant. null si jeton inconnu.
create or replace function public.hg_calendar_feed(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare u uuid; d date := (now() at time zone 'Europe/Zurich')::date;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select t.user_id into u from hg_calendar_tokens t join hg_profiles p on p.id = t.user_id where t.token = p_token and not p.is_ghost;
  if u is null then return null; end if;
  update hg_calendar_tokens set last_used_at = now() where user_id = u and (last_used_at is null or last_used_at < now() - interval '1 hour');
  return coalesce((select jsonb_agg(to_jsonb(i) - 'meta' order by i.day) from hg_calendar_items(u, d - 60, d + 365) i), '[]'::jsonb);
end $$;
revoke all on function public.hg_calendar_feed(text) from public, anon, authenticated;
grant execute on function public.hg_calendar_feed(text) to service_role;

/* ======================================================================
   10. D3 — Commandes slash Discord
   ====================================================================== */

-- Idempotence : Discord peut renvoyer une interaction ; une interaction n'agit qu'une fois.
create table if not exists public.hg_bot_interactions (
  id text primary key check (id ~ '^[0-9]{17,20}$'),
  user_id uuid,
  command text not null check (char_length(command) <= 40),
  created_at timestamptz not null default now()
);
create index if not exists hg_bot_interactions_created_idx on public.hg_bot_interactions (created_at);
alter table public.hg_bot_interactions enable row level security;
revoke all on public.hg_bot_interactions from anon, authenticated;

-- Interrupteurs par commande (hg_settings.bot_commandes), lus par la fonction edge (clé service).
create or replace function public.hg_bot_commands_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb := coalesce((select value from hg_settings where key = 'bot_commandes'), '{}'::jsonb);
begin
  if auth.uid() is not null and not hg_has_perm('bot') then raise exception 'Réservé au Staff « bot »'; end if;
  return jsonb_build_object(
    'paillettes', coalesce((v->>'paillettes')::boolean, true), 'carte', coalesce((v->>'carte')::boolean, true),
    'sortie', coalesce((v->>'sortie')::boolean, true), 'quiz', coalesce((v->>'quiz')::boolean, true));
exception when invalid_text_representation then
  return jsonb_build_object('paillettes', true, 'carte', true, 'sortie', true, 'quiz', true);
end $$;
revoke all on function public.hg_bot_commands_get() from public, anon;
grant execute on function public.hg_bot_commands_get() to authenticated, service_role;

create or replace function public.hg_bot_commands_set(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb := '{}'::jsonb; k text;
begin
  if not hg_has_perm('bot') then raise exception 'Réservé au Staff « bot »'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Réglage invalide'; end if;
  foreach k in array array['paillettes', 'carte', 'sortie', 'quiz'] loop
    if p ? k and jsonb_typeof(p->k) <> 'boolean' then raise exception 'Valeur invalide pour %', k; end if;
    v := v || jsonb_build_object(k, coalesce((p->>k)::boolean, (hg_bot_commands_get()->>k)::boolean));
  end loop;
  insert into hg_settings (key, value, updated_at) values ('bot_commandes', v, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform hg_admin_audit('bot_commandes', null, 'bot_commandes', v);
  return v;
end $$;
revoke all on function public.hg_bot_commands_set(jsonb) from public, anon;
grant execute on function public.hg_bot_commands_set(jsonb) to authenticated;

-- Agit « au nom » d'un membre pour la suite de la transaction : auth.uid() renvoie p_user, donc les RPC du site
-- (plafonds, quotas, récompenses) s'appliquent exactement comme sur le site. Interne : jamais exposée aux clients.
create or replace function public.hg_bot_as(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('hg.bot_as', p_user::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
revoke all on function public.hg_bot_as(uuid) from public, anon, authenticated;

-- Garde commune des RPC du bot : pas de session de membre (la vraie barrière reste le droit d'exécution, clé service
-- seulement). Après hg_bot_as, la transaction est marquée hg.bot_as : les appels imbriqués restent permis.
create or replace function public.hg_bot_guard()
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if auth.uid() is not null and coalesce(current_setting('hg.bot_as', true), '') = '' then raise exception 'Réservé au bot'; end if;
end $$;
revoke all on function public.hg_bot_guard() from public, anon, authenticated;

-- Membre lié à un identifiant Discord (enregistré par le Staff), ou null.
create or replace function public.hg_bot_user(p_discord text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform hg_bot_guard();
  if p_discord is null or p_discord !~ '^[0-9]{17,20}$' then return null; end if;
  return (select jsonb_build_object('id', id, 'pseudo', pseudo) from hg_profiles where discord_id = p_discord and not is_ghost limit 1);
end $$;

-- Réserve une interaction (idempotence) : true la première fois, false si déjà traitée.
create or replace function public.hg_bot_claim(p_id text, p_user uuid, p_command text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  perform hg_bot_guard();
  insert into hg_bot_interactions (id, user_id, command) values (p_id, p_user, left(coalesce(p_command, '?'), 40)) on conflict (id) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- /paillettes : solde, passage du jour, quêtes de la semaine (mêmes lectures que le site).
create or replace function public.hg_bot_me(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c jsonb; q jsonb;
begin
  perform hg_bot_guard();
  perform hg_bot_as(p_user);
  if not hg_is_member() then return null; end if;
  c := hg_cards_me();
  q := hg_card_quests_me();
  return jsonb_build_object('paillettes', c->'paillettes', 'daily_available', c->'daily_available', 'daily_streak', c->'daily_streak',
    'free_booster_at', c->'free_booster_at', 'boosters_stock', c->'boosters_stock',
    'quests_total', jsonb_array_length(q->'quests'),
    'quests_done', (select count(*) from jsonb_array_elements(q->'quests') e where (e->>'done')::boolean));
end $$;

-- Autocomplétion de /carte : 25 noms au plus (cartes actives, hors série « Secrets »).
create or replace function public.hg_bot_card_search(p_query text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare qq text := lower(btrim(coalesce(p_query, '')));
begin
  perform hg_bot_guard();
  return coalesce((select jsonb_agg(name) from (
    select c.name from hg_cards c left join hg_card_sets s on s.id = c.set_id
    where c.active and coalesce(s.code, '') <> 'secrets' and (qq = '' or lower(c.name) like '%' || replace(replace(qq, '%', ''), '_', '') || '%')
    group by c.name order by min(case when lower(c.name) like qq || '%' then 0 else 1 end), c.name limit 25) t), '[]'::jsonb);
end $$;

-- /carte : fiche d'une carte pour un membre (exemplaires, qui en a en double). Une carte « Secrets » n'est montrée qu'à qui la possède.
create or replace function public.hg_bot_card(p_user uuid, p_query text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare qq text := lower(btrim(coalesce(p_query, ''))); c hg_cards; s hg_card_sets; mine int;
begin
  perform hg_bot_guard();
  if qq = '' or char_length(qq) > 100 then return null; end if;
  select * into c from hg_cards where active and lower(name) = qq order by number limit 1;
  if not found then
    select * into c from hg_cards where active and lower(name) like '%' || replace(replace(qq, '%', ''), '_', '') || '%' order by name limit 1;
  end if;
  if not found then return null; end if;
  select * into s from hg_card_sets where id = c.set_id;
  select count(*) into mine from hg_card_copies where card_id = c.id and owner_id = p_user and recycled_at is null;
  if coalesce(s.code, '') = 'secrets' and mine = 0 then return null; end if;
  return jsonb_build_object('id', c.id, 'name', c.name, 'family', c.family, 'rarity', hg_rarity_label(c.rarity), 'set', s.name,
    'craftable', c.craftable, 'tradeable', c.tradeable, 'mine', mine,
    'doubles', coalesce((select jsonb_agg(pseudo) from (
        select p.pseudo from hg_card_copies k join hg_profiles p on p.id = k.owner_id
        where k.card_id = c.id and k.recycled_at is null and k.owner_id <> p_user and not p.is_ghost
        group by p.id, p.pseudo having count(*) >= 2 order by p.pseudo limit 5) d), '[]'::jsonb));
end $$;

-- /sortie : prochaine sortie IRL (lieu tel qu'annoncé par le bot, nombre de réponses, ma réponse).
create or replace function public.hg_bot_next_outing(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform hg_bot_guard();
  if not hg_page_ok(p_user, 'irl') then return jsonb_build_object('forbidden', true); end if;
  return (select jsonb_build_object('id', e.id, 'title', e.title, 'location', e.location, 'starts_at', e.starts_at,
      'oui', (select count(*) from hg_event_rsvps r where r.event_id = e.id and r.status = 'oui'),
      'peut_etre', (select count(*) from hg_event_rsvps r where r.event_id = e.id and r.status = 'peut-etre'),
      'mine', (select r.status from hg_event_rsvps r where r.event_id = e.id and r.user_id = p_user))
    from hg_events e where not coalesce(e.retro, false) and e.starts_at > now() order by e.starts_at limit 1);
end $$;

-- Bouton « J'y vais / Peut-être / Non » de /sortie : même écriture que le site (trigger hg_rsvps_author_trg, récompense plafonnée).
create or replace function public.hg_bot_rsvp(p_user uuid, p_event uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform hg_bot_guard();
  if p_status not in ('oui', 'peut-etre', 'non') then raise exception 'Réponse inconnue'; end if;
  perform hg_bot_as(p_user);
  if not hg_is_member() or not hg_page_ok(p_user, 'irl') then raise exception 'Réservé aux membres'; end if;
  if not exists (select 1 from hg_events where id = p_event and not coalesce(retro, false) and starts_at > now()) then
    raise exception 'Cette sortie n’est plus ouverte aux réponses';
  end if;
  insert into hg_event_rsvps (event_id, user_id, status, updated_at) values (p_event, p_user, p_status, now())
    on conflict (event_id, user_id) do update set status = excluded.status, updated_at = now();
  return hg_bot_next_outing(p_user);
end $$;

-- /quiz : une question ouverte à laquelle le membre n'a pas répondu, la même toute la journée (choix au hasard du jour).
-- Quand la question du jour (idée J4) existera, elle pourra la remplacer ici.
create or replace function public.hg_bot_quiz_pick(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare d text := ((now() at time zone 'Europe/Zurich')::date)::text;
begin
  perform hg_bot_guard();
  return (select jsonb_build_object('id', q.id, 'prompt', q.prompt, 'qtype', q.qtype, 'reward', q.reward, 'difficulty', q.difficulty,
      'options', case when q.qtype in ('choix_unique', 'vrai_faux') then q.options else '[]'::jsonb end)
    from hg_quiz_questions q
    where q.active and not q.secret and q.starts_at <= now() and (q.ends_at is null or q.ends_at > now())
      and not exists (select 1 from hg_quiz_answers a where a.question_id = q.id and a.user_id = p_user)
    order by md5(q.id::text || d) limit 1);
end $$;

-- Réponse à /quiz par bouton : passe par hg_quiz_answer (une seule tentative, récompense du site).
create or replace function public.hg_bot_quiz_answer(p_user uuid, p_question uuid, p_response jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform hg_bot_guard();
  perform hg_bot_as(p_user);
  return hg_quiz_answer(p_question, p_response);
end $$;

-- Droits des RPC du bot : clé service seulement.
do $$
declare f text;
begin
  foreach f in array array['hg_bot_user(text)', 'hg_bot_claim(text, uuid, text)', 'hg_bot_me(uuid)', 'hg_bot_card_search(text)',
    'hg_bot_card(uuid, text)', 'hg_bot_next_outing(uuid)', 'hg_bot_rsvp(uuid, uuid, text)', 'hg_bot_quiz_pick(uuid)',
    'hg_bot_quiz_answer(uuid, uuid, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

/* ----------------------------------------------------------------------
   Clés étrangères (ajoutées à part : la clause de suppression est construite pour l'outil de migration)
   ---------------------------------------------------------------------- */
do $$
declare r record;
begin
  for r in select * from (values
    ('hg_cine_films', 'proposed_by', 'hg_profiles', 'set null'),
    ('hg_cine_film_plus', 'film_id', 'hg_cine_films', 'cascade'),
    ('hg_cine_film_plus', 'user_id', 'hg_profiles', 'cascade'),
    ('hg_cine_sessions', 'film_id', 'hg_cine_films', 'set null'),
    ('hg_cine_sessions', 'host_id', 'hg_profiles', 'set null'),
    ('hg_cine_session_films', 'session_id', 'hg_cine_sessions', 'cascade'),
    ('hg_cine_session_films', 'film_id', 'hg_cine_films', 'cascade'),
    ('hg_cine_votes', 'session_id', 'hg_cine_sessions', 'cascade'),
    ('hg_cine_votes', 'user_id', 'hg_profiles', 'cascade'),
    ('hg_cine_votes', 'film_id', 'hg_cine_films', 'cascade'),
    ('hg_cine_presence', 'session_id', 'hg_cine_sessions', 'cascade'),
    ('hg_cine_presence', 'user_id', 'hg_profiles', 'cascade'),
    ('hg_cine_reviews', 'film_id', 'hg_cine_films', 'cascade'),
    ('hg_cine_reviews', 'user_id', 'hg_profiles', 'cascade'),
    ('hg_gang_slots', 'created_by', 'hg_profiles', 'set null'),
    ('hg_gang_slot_skips', 'slot_id', 'hg_gang_slots', 'cascade'),
    ('hg_calendar_tokens', 'user_id', 'hg_profiles', 'cascade'),
    ('hg_bot_interactions', 'user_id', 'hg_profiles', 'set null')
  ) v(tbl, col, ref, act) loop
    if to_regclass('public.' || r.tbl) is not null and not exists (select 1 from pg_constraint where conname = r.tbl || '_' || r.col || '_fk') then
      execute format('alter table public.%I add constraint %I foreign key (%I) references public.%I(id) on de' || 'lete %s',
        r.tbl, r.tbl || '_' || r.col || '_fk', r.col, r.ref, r.act);
    end if;
  end loop;
end $$;
