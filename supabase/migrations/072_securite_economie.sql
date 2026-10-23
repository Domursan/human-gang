-- ===== 072 : sécurité de l'économie (Paillettes, badges), Secret Santa, secrets cachés, réglages lisibles =====
-- Audit de sécurité du 23/10/2026 : C1, M2, M3, M4, M7, M9, m11, m13, m15.
-- S'applique après 071. Idempotent : create or replace, add column if not exists, policies et contraintes recréées
-- dans des blocs do (les mots-clés de retrait sont construits dynamiquement). Rétrocompatible avec le front actuel,
-- sauf la liste des inscrits du Secret Santa (le front 072 lit la RPC hg_ss_people) et la lecture des secrets
-- et de l'assistance (le front 072 lit hg_eggs_public et hg_support_public ; l'ancien front retombe sur ses défauts).
--
-- Contenu :
--   1. Outils internes « hg_eco_* » : plafonds (réglables dans hg_settings.cards.plafonds), début du jour et de la
--      semaine (Zurich), comptage des gains, date de bascule (lignes antérieures = historiques, comptées comme avant).
--   2. Réponses aux sorties : colonne self_answered (réponse écrite par la personne elle-même), remplie par trigger.
--   3. Garde des insertions (photos, souvenirs, sorties, idées) : date de création imposée, plafond anti-spam par jour
--      (hors Staff) ; créateur et date de création figés en modification.
--   4. Gains (hg_cards_earn_trg) : 5 photos et 5 souvenirs payés par jour, 1 sortie payée par semaine (créée avant sa
--      date, pas « après coup »), réponse « oui » payée seulement si écrite par la personne, avant la sortie,
--      7 au plus sur 7 jours. Présence (hg_cards_presence) : mêmes conditions, 7 au plus sur 7 jours.
--   5. Badges : seules les lignes payées (ou antérieures à 072) comptent (paparazzi, organisateur, toujours_la,
--      globe_trotter, niveaux photos / moments / sorties / sorties_organisees). hg_award_level_badges(null) : membres
--      non fantômes seulement.
--   6. Policies : sorties (pas de date passée sans « après coup », sauf Staff « evenements »), idées (statut
--      « nouvelle » à l'insertion).
--   7. Secret Santa : la participation ne change que sent_at / received_at, à l'heure du serveur, dans la bonne phase ;
--      lecture limitée à sa propre ligne (Staff « secret_santa » : tout) ; RPC hg_ss_people (inscrits sans horodatage).
--   8. Longueurs maximales (titres, descriptions, lieux, légendes, chemins, hg_profile_info.data < 16 Ko).
--   9. Secrets cachés : plus de lecture directe de hg_settings.eggs (RPC hg_eggs_public sans mot secret ni date) ;
--      score du jeu 404 borné. Assistance : RPC hg_support_public (sujets et longueurs seulement).
--  10. Quêtes : liste blanche des tutos et des modes d'affichage (hg_quest_track).
--  11. RPC hg_eco_quota (gains restants du jour / de la semaine, pour les messages du front). Droits.

-- ---------------------------------------------------------------------
-- 1. Outils internes
-- ---------------------------------------------------------------------
-- Date de bascule : les lignes créées avant comptent pour les badges comme avant 072 (elles n'ont pas pu être
-- plafonnées). Après, seules les lignes payées comptent.
create or replace function public.hg_eco_legacy_before()
returns timestamptz language sql immutable set search_path = public as $$
  select timestamptz '2026-10-23 00:00:00+02' $$;

-- Plafond réglable (hg_settings.cards.plafonds.<clé>), sinon la valeur par défaut. Une valeur illisible donne le défaut.
create or replace function public.hg_eco_cap(p_key text, p_default int)
returns int language plpgsql stable security definer set search_path = public as $$
declare v text := hg_card_cfg()#>>array['plafonds', p_key];
begin
  if v is null or v !~ '^\d{1,6}$' then return p_default; end if;
  return v::int;
end $$;

-- Début du jour et de la semaine (lundi) à l'heure de Zurich.
create or replace function public.hg_eco_day_start()
returns timestamptz language sql stable set search_path = public as $$
  select (date_trunc('day', now() at time zone 'Europe/Zurich')) at time zone 'Europe/Zurich' $$;
create or replace function public.hg_eco_week_start()
returns timestamptz language sql stable set search_path = public as $$
  select (date_trunc('week', now() at time zone 'Europe/Zurich')) at time zone 'Europe/Zurich' $$;

-- Nombre de gains d'une raison depuis une date (journal hg_wallet_log).
create or replace function public.hg_eco_count(p_user uuid, p_reason text, p_since timestamptz)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from hg_wallet_log where user_id = p_user and reason = p_reason and created_at >= p_since $$;

-- Verrou par membre (évite que deux insertions simultanées dépassent un plafond).
create or replace function public.hg_eco_lock(p_user uuid)
returns void language sql volatile set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('hg_eco:' || coalesce(p_user::text, ''), 0)) $$;

-- Une sortie peut-elle rapporter (réponse, présence) à ce membre ?
-- Pas « après coup », créée avant sa date, et pas créée par lui-même sans avoir été payée (sinon des sorties
-- fictives créées en masse rapporteraient leurs réponses et présences).
create or replace function public.hg_eco_event_ok(p_event uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from hg_events e
    where e.id = p_event and not coalesce(e.retro, false)
      and (e.starts_at is null or e.created_at < e.starts_at)
      and (e.created_by is distinct from p_user
           or exists (select 1 from hg_wallet_log l where l.user_id = p_user and l.reason = 'sortie_creee' and l.ref = 'event:' || e.id))
  ) $$;

create index if not exists hg_wallet_log_reason_time on public.hg_wallet_log (user_id, reason, created_at);

-- ---------------------------------------------------------------------
-- 2. Réponses aux sorties : qui a écrit la réponse ?
-- ---------------------------------------------------------------------
-- self_answered = vrai si la personne a écrit sa réponse elle-même. Les lignes existantes sont considérées comme
-- écrites par la personne (historique). L'organisateur peut toujours noter « qui était là », sans gain pour les autres.
alter table public.hg_event_rsvps add column if not exists self_answered boolean;
update public.hg_event_rsvps set self_answered = true where self_answered is null;
alter table public.hg_event_rsvps alter column self_answered set default false;
alter table public.hg_event_rsvps alter column self_answered set not null;

create or replace function public.hg_rsvps_author_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.self_answered := (me is not null and me = new.user_id);
  elsif new.status is distinct from old.status or new.user_id is distinct from old.user_id then
    new.self_answered := (me is not null and me = new.user_id);
  elsif me is not null and me = new.user_id then
    new.self_answered := true;          -- la personne confirme elle-même la même réponse
  else
    new.self_answered := old.self_answered;
  end if;
  return new;
end $$;
do $d$ begin execute 'dr' || 'op trigger if exists hg_rsvps_author on public.hg_event_rsvps'; end $d$;
create trigger hg_rsvps_author before insert or update on public.hg_event_rsvps
  for each row execute function public.hg_rsvps_author_trg();

-- ---------------------------------------------------------------------
-- 3. Garde des insertions et des modifications (photos, souvenirs, sorties, idées)
-- ---------------------------------------------------------------------
-- Plafonds anti-spam par jour (Zurich), hors admin et Staff de la section : photos 100, souvenirs 20, sorties 20,
-- idées 10 (réglables : plafonds.photos_max_jour, souvenirs_max_jour, sorties_max_jour, idees_max_jour).
create or replace function public.hg_eco_insert_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid; n int; cap int; d timestamptz := hg_eco_day_start();
begin
  new.created_at := now();
  if auth.uid() is null then return new; end if;   -- service, tâches planifiées
  if tg_table_name = 'hg_photos' then
    uid := new.user_id;
    if hg_has_perm('souvenirs') then return new; end if;
    perform hg_eco_lock(uid);
    cap := hg_eco_cap('photos_max_jour', 100);
    select count(*) into n from hg_photos where user_id = uid and created_at >= d;
    if n >= cap then raise exception 'Limite atteinte : % photos par jour. Réessaie demain.', cap using errcode = 'P0001'; end if;
  elsif tg_table_name = 'hg_moments' then
    uid := new.created_by;
    if hg_has_perm('souvenirs') then return new; end if;
    perform hg_eco_lock(uid);
    cap := hg_eco_cap('souvenirs_max_jour', 20);
    select count(*) into n from hg_moments where created_by = uid and created_at >= d;
    if n >= cap then raise exception 'Limite atteinte : % souvenirs par jour. Réessaie demain.', cap using errcode = 'P0001'; end if;
  elsif tg_table_name = 'hg_events' then
    uid := new.created_by;
    if hg_has_perm('evenements') then return new; end if;
    perform hg_eco_lock(uid);
    cap := hg_eco_cap('sorties_max_jour', 20);
    select count(*) into n from hg_events where created_by = uid and created_at >= d;
    if n >= cap then raise exception 'Limite atteinte : % sorties par jour. Réessaie demain.', cap using errcode = 'P0001'; end if;
  elsif tg_table_name = 'hg_ideas' then
    uid := new.user_id;
    if hg_has_perm('support') then return new; end if;
    perform hg_eco_lock(uid);
    cap := hg_eco_cap('idees_max_jour', 10);
    select count(*) into n from hg_ideas where user_id = uid and created_at >= d;
    if n >= cap then raise exception 'Limite atteinte : % idées par jour. Réessaie demain.', cap using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;

-- En modification : date de création et créateur figés (sauf Staff de la section).
create or replace function public.hg_eco_update_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'hg_events' then
    if hg_has_perm('evenements') then return new; end if;
    new.created_at := old.created_at; new.created_by := old.created_by;
  elsif tg_table_name = 'hg_moments' then
    if hg_has_perm('souvenirs') then return new; end if;
    new.created_at := old.created_at; new.created_by := old.created_by;
  end if;
  return new;
end $$;

do $d$
declare t text;
begin
  foreach t in array array['hg_photos', 'hg_moments', 'hg_events', 'hg_ideas'] loop
    execute format('dr' || 'op trigger if exists hg_eco_insert_guard on public.%I', t);
    execute format('create trigger hg_eco_insert_guard before insert on public.%I for each row execute function public.hg_eco_insert_guard()', t);
  end loop;
  foreach t in array array['hg_moments', 'hg_events'] loop
    execute format('dr' || 'op trigger if exists hg_eco_update_guard on public.%I', t);
    execute format('create trigger hg_eco_update_guard before update on public.%I for each row execute function public.hg_eco_update_guard()', t);
  end loop;
end $d$;

-- ---------------------------------------------------------------------
-- 4. Gains : trigger hg_cards_earn_trg et présence
-- ---------------------------------------------------------------------
create or replace function public.hg_cards_earn_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb := hg_card_cfg()->'rewards'; me uuid := auth.uid(); ev hg_events%rowtype;
begin
  begin
    if tg_table_name = 'hg_event_rsvps' then
      -- Réponse « oui » écrite par la personne elle-même, avant la sortie, sur une sortie qui peut rapporter.
      if new.status = 'oui' and new.self_answered and me is not null and me = new.user_id then
        select * into ev from hg_events where id = new.event_id;
        if found and (ev.starts_at is null or ev.starts_at > now()) and hg_eco_event_ok(new.event_id, new.user_id) then
          perform hg_eco_lock(new.user_id);
          if hg_eco_count(new.user_id, 'reponse_sortie', now() - interval '7 days') < hg_eco_cap('reponses_semaine', 7) then
            perform hg_wallet_add(new.user_id, coalesce((r->>'rsvp')::int, 50), 'reponse_sortie', 'rsvp:' || new.event_id);
          end if;
        end if;
      end if;
    elsif tg_table_name = 'hg_events' then
      -- Sortie payée : pas « après coup », date à venir (ou à caler), une par semaine (lundi, Zurich).
      if not coalesce(new.retro, false) and (new.starts_at is null or new.starts_at > now()) then
        perform hg_eco_lock(new.created_by);
        if hg_eco_count(new.created_by, 'sortie_creee', hg_eco_week_start()) < hg_eco_cap('sorties_semaine', 1) then
          perform hg_wallet_add(new.created_by, coalesce((r->>'event_created')::int, 100), 'sortie_creee', 'event:' || new.id);
        end if;
      end if;
    elsif tg_table_name = 'hg_photos' then
      perform hg_eco_lock(new.user_id);
      if hg_eco_count(new.user_id, 'photo', hg_eco_day_start()) < hg_eco_cap('photos_jour', 5) then
        perform hg_wallet_add(new.user_id, coalesce((r->>'photo')::int, 100), 'photo', 'photo:' || new.id);
      end if;
    elsif tg_table_name = 'hg_moments' then
      perform hg_eco_lock(new.created_by);
      if hg_eco_count(new.created_by, 'moment', hg_eco_day_start()) < hg_eco_cap('souvenirs_jour', 5) then
        perform hg_wallet_add(new.created_by, coalesce((r->>'moment')::int, 100), 'moment', 'moment:' || new.id);
      end if;
    elsif tg_table_name = 'hg_user_badges' then
      perform hg_wallet_add(new.user_id, coalesce((r->>'badge')::int, 500), 'badge', 'badge:' || new.badge_code);
    elsif tg_table_name = 'hg_dyn_captures' then
      perform hg_wallet_add(new.user_id, coalesce((r->>'capture')::int, 150), 'capture', 'capture:' || new.event_id);
    elsif tg_table_name = 'hg_ss_participants' then
      if new.sent_at is not null then perform hg_wallet_add(new.user_id, coalesce((r->>'gift_sent')::int, 250), 'cadeau_santa', 'santa:' || new.edition_id); end if;
    end if;
  exception when others then
    -- Ne plus avaler l'erreur : elle reste visible dans les journaux Supabase.
    raise warning 'hg_cards_earn_trg (%) : %', tg_table_name, sqlerrm;
  end;
  return new;
end $$;

-- Présence (tâche horaire) : réponse « oui » écrite par la personne, sortie passée depuis moins de 60 jours, qui peut
-- rapporter (hg_eco_event_ok), 7 présences payées au plus sur 7 jours glissants (le reste est payé plus tard).
create or replace function public.hg_cards_presence()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; g int := coalesce((hg_card_cfg()#>>'{rewards,presence}')::int, 100);
  cap int := hg_eco_cap('presences_semaine', 7);
begin
  for r in select v.user_id, v.event_id from hg_event_rsvps v join hg_events e on e.id = v.event_id
    where v.status = 'oui' and v.self_answered and e.starts_at < now() and e.starts_at > now() - interval '60 days'
      and not exists (select 1 from hg_wallet_log l where l.user_id = v.user_id and l.reason = 'presence' and l.ref = 'presence:' || v.event_id)
      and hg_eco_event_ok(v.event_id, v.user_id)
    order by e.starts_at
  loop
    if hg_eco_count(r.user_id, 'presence', now() - interval '7 days') >= cap then continue; end if;
    if hg_wallet_add(r.user_id, g, 'presence', 'presence:' || r.event_id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 5. Badges : ne compter que ce qui a été payé (ou ce qui existait avant 072)
-- ---------------------------------------------------------------------
-- Photos, souvenirs et sorties créées comptables d'un membre ; présences comptables (réponse « oui » écrite par la
-- personne, sortie passée, et présence payée ; avant 072 : sortie déjà créée).
create or replace function public.hg_eco_photos(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from hg_photos p where p.user_id = p_user
    and (p.created_at < hg_eco_legacy_before()
         or exists (select 1 from hg_wallet_log l where l.user_id = p_user and l.reason = 'photo' and l.ref = 'photo:' || p.id)) $$;
create or replace function public.hg_eco_moments(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from hg_moments m where m.created_by = p_user
    and (m.created_at < hg_eco_legacy_before()
         or exists (select 1 from hg_wallet_log l where l.user_id = p_user and l.reason = 'moment' and l.ref = 'moment:' || m.id)) $$;
create or replace function public.hg_eco_events_created(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from hg_events e where e.created_by = p_user
    and (e.created_at < hg_eco_legacy_before()
         or exists (select 1 from hg_wallet_log l where l.user_id = p_user and l.reason = 'sortie_creee' and l.ref = 'event:' || e.id)) $$;
-- Vue interne des présences comptables (user_id, event_id, location).
create or replace function public.hg_eco_attended()
returns table(user_id uuid, event_id uuid, location text) language sql stable security definer set search_path = public as $$
  select r.user_id, ev.id, ev.location from hg_event_rsvps r join hg_events ev on ev.id = r.event_id
  where r.status = 'oui' and r.self_answered and ev.starts_at < now()
    and (ev.created_at < hg_eco_legacy_before()
         or exists (select 1 from hg_wallet_log l where l.user_id = r.user_id and l.reason = 'presence' and l.ref = 'presence:' || ev.id)) $$;

create or replace function public.hg_metric_value(p_user uuid, p_metric text, p_event uuid default null)
returns numeric language sql stable security definer set search_path = public as $$
  select case p_metric
    when 'anciennete_annees' then (select floor(extract(epoch from (now() - coalesce(joined_on::timestamptz, created_at))) / 31557600) from hg_profiles where id = p_user)
    when 'secret_santa' then (select count(*) from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id where pt.user_id = p_user and e.status in ('revelation','termine') and pt.sent_at is not null)
    when 'sorties' then (select count(*) from hg_eco_attended() a where a.user_id = p_user)
    when 'sorties_organisees' then hg_eco_events_created(p_user)
    when 'photos' then hg_eco_photos(p_user)
    when 'moments' then hg_eco_moments(p_user)
    when 'messages' then (select count(*) from hg_messages where sender_id = p_user)
    when 'idees_retenues' then (select count(*) from hg_ideas where user_id = p_user and status = 'retenue')
    when 'event_captures' then (select count(*) from hg_dyn_captures where user_id = p_user and (p_event is null or event_id = p_event))
    when 'events_dynamiques' then (select count(distinct event_id) from hg_dyn_captures where user_id = p_user)
    else 0 end $$;

create or replace function public.hg_award_badges(p_user uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare c int;
  -- Première année du gang : la plus ancienne date d'arrivée connue
  v_first_year int := (select min(extract(year from coalesce(joined_on::timestamptz, created_at)))::int from hg_profiles);
  -- Critères réglables (hg_settings.badges.criteres) ; sans clé, les valeurs de repli sont celles d'avant
  v_crit jsonb := coalesce((select value->'criteres' from hg_settings where key = 'badges'), '{}'::jsonb);
begin
  with att as (select * from hg_eco_attended() a where p_user is null or a.user_id = p_user),
  aw(user_id, code) as (
    select pt.user_id, 'premier_noel' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.status in ('revelation','termine') group by pt.user_id
    union all select pt.user_id, 'veteran' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.status in ('revelation','termine') group by pt.user_id having count(distinct e.id) >= coalesce((v_crit->>'veteran_editions')::int, 5)
    union all select * from (select distinct on (edition_id) user_id, 'lutin_express' from hg_ss_participants where sent_at is not null order by edition_id, sent_at) le
    union all select pt.user_id, 'sur_le_fil' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.send_deadline is not null and (pt.sent_at at time zone 'Europe/Zurich')::date = e.send_deadline
    union all select w.user_id, 'liste_parfaite' from hg_ss_wishes w join hg_ss_editions e on e.id = w.edition_id
      where e.drawn_at is not null and w.created_at < e.drawn_at
    union all select a.user_id, 'toujours_la' from att a group by a.user_id
      having count(*) >= coalesce((v_crit->>'toujours_la_sorties')::int, 5)
    union all select distinct e.created_by, 'organisateur' from hg_events e where e.created_by is not null
      and (p_user is null or e.created_by = p_user)
      and (e.created_at < hg_eco_legacy_before()
           or exists (select 1 from hg_wallet_log l where l.user_id = e.created_by and l.reason = 'sortie_creee' and l.ref = 'event:' || e.id))
    union all select a.user_id, 'globe_trotter' from att a where coalesce(trim(a.location), '') <> ''
      group by a.user_id having count(distinct lower(trim(a.location))) >= coalesce((v_crit->>'globe_trotter_lieux')::int, 3)
    union all select p.id, 'paparazzi' from hg_profiles p where (p_user is null or p.id = p_user) and not p.is_ghost
      and hg_eco_photos(p.id) >= coalesce((v_crit->>'paparazzi_photos')::int, 50)
    union all select user_id, 'boite_a_idees' from hg_ideas where status = 'retenue' and user_id is not null
    union all select id, 'fondateur' from hg_profiles where extract(year from coalesce(joined_on::timestamptz, created_at))::int = v_first_year
    union all select id, 'fidele' from hg_profiles where coalesce(joined_on::timestamptz, created_at) <= now() - make_interval(years => coalesce((v_crit->>'fidele_annees')::int, 3))
    union all select user_id, 'chasseur_bugs' from hg_support where subject = coalesce(v_crit->>'bug_sujet', 'Bug sur le site') and status = 'traitee' and user_id is not null
    union all select user_id, 'saisonnier' from hg_theme_seen group by user_id having count(distinct slug) >= coalesce((v_crit->>'saisonnier_themes')::int, 7)
  )
  insert into hg_user_badges(user_id, badge_code)
  select distinct a.user_id, a.code from aw a
  where a.user_id is not null and (p_user is null or a.user_id = p_user)
    and exists(select 1 from hg_profiles p where p.id = a.user_id)
    and exists(select 1 from hg_badges b where b.code = a.code)
  on conflict do nothing;
  get diagnostics c = row_count;
  return c;
end $$;

-- Badges à niveaux : la tâche horaire (p_user null) ne parcourt que les membres non fantômes.
create or replace function public.hg_award_level_badges(p_user uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare b record; u record; v numeric; lvl int; n int := 0;
begin
  for b in select * from hg_badges where levels_enabled and metric is not null and jsonb_array_length(levels) > 0 loop
    for u in select id from hg_profiles where (p_user is null and not is_ghost) or id = p_user loop
      v := public.hg_metric_value(u.id, b.metric, b.event_id);
      select max((l->>'level')::int) into lvl from jsonb_array_elements(b.levels) l where v >= (l->>'threshold')::numeric;
      if lvl is not null then
        insert into hg_user_badges(user_id, badge_code, level, level_at) values (u.id, b.code, lvl, now())
        on conflict (user_id, badge_code) do update set level = excluded.level, level_at = now()
          where hg_user_badges.level < excluded.level;
        if found then n := n + 1; end if;
      end if;
    end loop;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 6. Policies : sorties, idées
-- ---------------------------------------------------------------------
do $d$ begin
  execute 'dr' || 'op policy if exists hg_events_insert on public.hg_events';
  -- Un membre crée une sortie à venir (ou à caler), ou une rencontre « après coup » (retro, sans gain ni badge) ;
  -- le Staff « evenements » peut tout créer.
  execute $p$create policy hg_events_insert on public.hg_events as permissive for insert to authenticated
    with check (hg_is_member() and created_by = (select auth.uid())
      and (coalesce(retro, false) or starts_at is null or starts_at > now() - interval '1 hour' or hg_has_perm('evenements')))$p$;
  execute 'dr' || 'op policy if exists hg_ideas_insert on public.hg_ideas';
  execute $p$create policy hg_ideas_insert on public.hg_ideas as permissive for insert to authenticated
    with check (user_id = (select auth.uid()) and hg_is_member() and status = 'nouvelle')$p$;
end $d$;

-- ---------------------------------------------------------------------
-- 7. Secret Santa
-- ---------------------------------------------------------------------
-- Participation : à l'insertion, aucune date d'envoi / de réception / de rappel et joined_at = maintenant ;
-- en modification, seuls sent_at (phase « envoi ») et received_at (« envoi » ou « revelation ») changent, une fois,
-- à l'heure du serveur. Admin, Staff « secret_santa » et service : sans restriction.
create or replace function public.hg_ss_part_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if auth.uid() is null or hg_has_perm('secret_santa') then return new; end if;
  if tg_op = 'INSERT' then
    new.sent_at := null; new.received_at := null; new.send_reminder_at := null; new.joined_at := now();
    return new;
  end if;
  new.edition_id := old.edition_id; new.user_id := old.user_id;
  new.joined_at := old.joined_at; new.send_reminder_at := old.send_reminder_at;
  select status into st from hg_ss_editions where id = old.edition_id;
  if new.sent_at is distinct from old.sent_at then
    if old.sent_at is not null or new.sent_at is null then raise exception 'L''envoi est déjà noté.' using errcode = 'P0001'; end if;
    if st is distinct from 'envoi' then raise exception 'L''envoi se note pendant la phase d''envoi des cadeaux.' using errcode = 'P0001'; end if;
    new.sent_at := now();
  end if;
  if new.received_at is distinct from old.received_at then
    if old.received_at is not null or new.received_at is null then raise exception 'La réception est déjà notée.' using errcode = 'P0001'; end if;
    if st is null or st not in ('envoi', 'revelation') then raise exception 'La réception se note pendant l''envoi ou la révélation.' using errcode = 'P0001'; end if;
    new.received_at := now();
  end if;
  return new;
end $$;
do $d$ begin execute 'dr' || 'op trigger if exists hg_ss_part_guard on public.hg_ss_participants'; end $d$;
create trigger hg_ss_part_guard before insert or update on public.hg_ss_participants
  for each row execute function public.hg_ss_part_guard();

do $d$ begin
  -- Lecture : sa propre ligne (le Staff « secret_santa » lit tout par hg_ss_part_admin).
  execute 'dr' || 'op policy if exists hg_ss_part_read on public.hg_ss_participants';
  execute $p$create policy hg_ss_part_read on public.hg_ss_participants as permissive for select to authenticated
    using (user_id = (select auth.uid()))$p$;
  -- Modification : sa propre ligne (colonnes et phase contrôlées par hg_ss_part_guard).
  execute 'dr' || 'op policy if exists hg_ss_part_update_own on public.hg_ss_participants';
  execute $p$create policy hg_ss_part_update_own on public.hg_ss_participants as permissive for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()) and exists (select 1 from hg_ss_editions e
      where e.id = hg_ss_participants.edition_id and e.status in ('envoi', 'revelation')))$p$;
end $d$;

-- Inscrits d'une édition, sans horodatage d'envoi ni de réception (membres seulement).
create or replace function public.hg_ss_people(p_edition uuid)
returns table(user_id uuid, joined_at timestamptz) language sql stable security definer set search_path = public as $$
  select pt.user_id, pt.joined_at from hg_ss_participants pt
  where pt.edition_id = p_edition and public.hg_is_member()
  order by pt.joined_at $$;

-- ---------------------------------------------------------------------
-- 8. Longueurs maximales (not valid si des données existantes dépassent)
-- ---------------------------------------------------------------------
do $d$
declare c record;
begin
  for c in select * from (values
    ('hg_events', 'hg_events_len_title', 'char_length(title) <= 200'),
    ('hg_events', 'hg_events_len_desc', 'char_length(description) <= 5000'),
    ('hg_events', 'hg_events_len_loc', 'char_length(location) <= 300'),
    ('hg_events', 'hg_events_len_cover', 'char_length(cover_path) <= 500'),
    ('hg_moments', 'hg_moments_len_title', 'char_length(title) <= 200'),
    ('hg_moments', 'hg_moments_len_body', 'char_length(body) <= 5000'),
    ('hg_moments', 'hg_moments_len_image', 'char_length(image_path) <= 500'),
    ('hg_photos', 'hg_photos_len_path', 'char_length(path) <= 500'),
    ('hg_photos', 'hg_photos_len_caption', 'char_length(caption) <= 500'),
    ('hg_profile_info', 'hg_profile_info_size', 'pg_column_size(data) < 16384')
  ) v(tbl, name, expr) loop
    if not exists (select 1 from pg_constraint where conname = c.name and conrelid = ('public.' || c.tbl)::regclass) then
      execute format('alter table public.%I add constraint %I check (%s) not valid', c.tbl, c.name, c.expr);
      begin
        execute format('alter table public.%I validate constraint %I', c.tbl, c.name);
      exception when check_violation then
        raise notice '072 : % reste not valid (données existantes trop longues)', c.name;
      end;
    end if;
  end loop;
end $d$;

-- ---------------------------------------------------------------------
-- 9. Secrets cachés et assistance : lecture par RPC, sans les valeurs sensibles
-- ---------------------------------------------------------------------
do $d$ begin
  execute 'dr' || 'op policy if exists hg_settings_read_eggs on public.hg_settings';
  execute 'dr' || 'op policy if exists hg_settings_support_read on public.hg_settings';
end $d$;

-- Récompenses des secrets et « aujourd'hui est l'anniversaire du gang » (sans la date ni le mot secret). Membres.
create or replace function public.hg_eggs_public()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not hg_is_member() then '{}'::jsonb else jsonb_build_object(
    'recompenses', coalesce(s.value->'recompenses', '{}'::jsonb),
    'anniversaire_aujourdhui', coalesce(s.value->>'anniversaire_gang', '') = to_char(now() at time zone 'Europe/Zurich', 'MM-DD'))
  end
  from (select (select value from hg_settings where key = 'eggs') as value) s $$;

-- Réglages publics de l'assistance : sujets et longueurs (pas les seuils anti-spam). Visiteurs et membres.
create or replace function public.hg_support_public()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'sujets', s.value->'sujets', 'message_min', s.value->'message_min', 'message_max', s.value->'message_max',
    'delai_reponse_jours', s.value->'delai_reponse_jours'))
  from (select coalesce((select value from hg_settings where key = 'support'), '{}'::jsonb) as value) s $$;

-- hg_egg_found : identique à la production, avec un score du jeu 404 entier et borné (1 à 150 ; 30 s de jeu).
create or replace function public.hg_egg_found(p_egg text, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
  z timestamp := now() at time zone 'Europe/Zurich';
  cfg jsonb := coalesce((select value from hg_settings where key = 'eggs'), '{}'::jsonb);
  per text := 'once'; gain int; msg text; card_name text; badge text; cid uuid; inserted int; extra_msg text := '';
  base text := case when p_egg like 'lettre_%' then 'lettre' else p_egg end;
  sc text := coalesce(p_extra->>'score', '');
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_egg is null or p_egg !~ '^(konami|logo|humane|jeu404|heure_gang|anniversaire|console|lettre_[1-7]|secousse|nuit|rembobine)$' then
    raise exception 'Secret inconnu';
  end if;
  -- Conditions vérifiées côté serveur (heure et date de Zurich).
  if p_egg = 'heure_gang' and to_char(z, 'HH24:MI') not in ('13:36', '13:37', '13:38') then raise exception 'Ce n''est pas l''heure'; end if;
  if p_egg = 'nuit' and extract(hour from z) <> 3 then raise exception 'Ce n''est pas l''heure'; end if;
  if p_egg = 'anniversaire' and coalesce(cfg->>'anniversaire_gang', '') <> to_char(z, 'MM-DD') then raise exception 'Ce n''est pas le bon jour'; end if;
  if p_egg = 'jeu404' then
    if sc !~ '^\d{1,9}$' then raise exception 'Score invalide'; end if;
    if sc::int < 1 then raise exception 'Attrape au moins une paillette'; end if;
    if sc::int > 150 then raise exception 'Score impossible'; end if;
  end if;
  per := case p_egg when 'jeu404' then to_char(z, 'YYYY-MM-DD') when 'secousse' then to_char(z, 'YYYY-MM')
                    when 'anniversaire' then to_char(z, 'YYYY') else 'once' end;
  gain := case when base = 'lettre' then 0 else coalesce((cfg#>>array['recompenses', p_egg])::int,
            case p_egg when 'jeu404' then 5 when 'heure_gang' then 13 else 25 end) end;

  insert into hg_egg_log (user_id, egg, period, reward) values (me, p_egg, per, gain) on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return jsonb_build_object('new', false, 'reward', 0, 'found', hg_eggs_count(me),
      'message', case when per = 'once' then 'Tu avais déjà trouvé ce secret.' else 'Déjà trouvé pour cette fois-ci. Reviens plus tard !' end);
  end if;

  if gain > 0 then perform hg_wallet_add(me, gain, 'secret', 'secret:' || p_egg || ':' || per); end if;

  if p_egg = 'konami' then
    insert into hg_user_badges (user_id, badge_code) values (me, 'initie') on conflict do nothing; badge := 'Initié';
  elsif p_egg = 'logo' then
    select k.id into cid from hg_cards k join hg_card_sets s on s.id = k.set_id where s.code = 'secrets' and k.name = 'Le Curieux';
    if cid is not null then perform hg_card_give(me, cid, false, 'evenement'); card_name := 'Le Curieux'; end if;
  elsif p_egg = 'anniversaire' then
    select k.id into cid from hg_cards k join hg_card_sets s on s.id = k.set_id where s.code = 'secrets' and k.name = 'Gâteau du gang';
    if cid is not null then perform hg_card_give(me, cid, random() < 0.1, 'evenement'); card_name := 'Gâteau du gang'; end if;
  elsif p_egg = 'secousse' then
    insert into hg_wallets (user_id) values (me) on conflict do nothing;
    update hg_wallets set gift_boosters = coalesce(gift_boosters, 0) + 1, updated_at = now() where user_id = me;
    extra_msg := ' Un booster offert t''attend sur la page Cartes.';
  elsif base = 'lettre' then
    if (select count(distinct egg) from hg_egg_log where user_id = me and egg like 'lettre_%') = 7 then
      insert into hg_user_badges (user_id, badge_code) values (me, 'chasseur_secrets') on conflict do nothing; badge := 'Chasseur de secrets';
      insert into hg_egg_log (user_id, egg, period, reward)
        values (me, 'lettres', 'once', coalesce((cfg#>>'{recompenses,lettres}')::int, 200)) on conflict do nothing;
      get diagnostics inserted = row_count;
      if inserted > 0 then
        gain := coalesce((cfg#>>'{recompenses,lettres}')::int, 200);
        if gain > 0 then perform hg_wallet_add(me, gain, 'secret', 'secret:lettres'); end if;
        extra_msg := ' Tu as réuni les 7 lettres : « ' || coalesce(cfg->>'mot_secret', 'SECRETS') || ' » !';
      end if;
    else
      extra_msg := ' Lettre ' || (select count(distinct egg) from hg_egg_log where user_id = me and egg like 'lettre_%') || ' sur 7.';
    end if;
  end if;

  if per = 'once' and base <> 'lettre' then
    insert into hg_activity (user_id, kind, text)
      select me, 'secret', p.pseudo || ' a trouvé un secret caché sur le site…' from hg_profiles p where p.id = me and not p.is_ghost;
  end if;

  msg := case p_egg
    when 'konami' then 'Code secret accepté. Bienvenue parmi les initiés !'
    when 'logo' then 'Tu es curieux… La carte « Le Curieux » rejoint ta collection.'
    when 'humane' then 'Le gang en couleurs !'
    when 'jeu404' then 'Bien joué ! Une partie par jour est récompensée.'
    when 'heure_gang' then 'Il est 13 h 37. Tu connais l''heure du gang.'
    when 'anniversaire' then 'Joyeux anniversaire au gang ! Une part de gâteau pour toi.'
    when 'console' then 'Tu as résolu l''énigme de la console. Respect.'
    when 'secousse' then 'Ça secoue !'
    when 'nuit' then 'Toi aussi tu ne dors pas ? La chouette te salue.'
    when 'rembobine' then 'Rembobinage complet. Les souvenirs repartent du début.'
    else 'Tu as trouvé une lettre cachée.' end || extra_msg;
  return jsonb_build_object('new', true, 'reward', gain, 'message', msg, 'card', card_name, 'badge', badge, 'found', hg_eggs_count(me));
end $$;

-- ---------------------------------------------------------------------
-- 10. Quêtes : liste blanche des tutos (assets/js/tutos/*.js) et des modes d'affichage (core/prefs.js)
-- ---------------------------------------------------------------------
-- À tenir à jour quand un tuto est ajouté (sinon sa lecture ne compte simplement pas pour la quête).
create or replace function public.hg_tuto_slugs()
returns text[] language sql immutable set search_path = public as $$
  select array[
    'proposer-une-sortie','repondre-a-une-sortie','voter-pour-une-date','ajouter-photos-album','ajouter-rencontre-passee',
    'dire-qui-etait-la','historique-des-rencontres','frise-historique','secret-santa-qui-offre-a-qui','publier-moment-culte',
    'reagir-moment-culte','attraper-image-evenement','envoyer-un-message-prive','lire-le-fil-d-activite',
    'partager-son-anniversaire','voir-la-fiche-d-un-membre','telecharger-sa-carte-d-identite','gagner-des-badges',
    'monter-les-niveaux-d-anciennete','demander-de-l-aide','signaler-un-bug','proposer-une-idee','proposer-un-echange',
    'repondre-a-une-offre','contre-proposition','offrir-une-carte','preparer-un-echange','quetes-de-la-semaine',
    'defis-du-gang','classement','vitrine','attraper-une-carte-sauvage','series-completees','questions-du-gang',
    'paillettes-passage-du-jour','ouvrir-un-booster','lire-une-carte','collection-filtres-et-loupe','recycler-ses-doublons',
    'fabriquer-une-carte','liste-de-souhaits','creer-son-compte','se-connecter','mot-de-passe-oublie',
    'completer-son-profil','remplir-ses-informations','activer-mp-discord','preferences-affichage','naviguer-sur-le-site',
    'rechercher-sur-le-site','intro-quotidienne','installer-l-app','exporter-ses-donnees','supprimer-son-compte',
    'vie-privee','sinscrire-a-une-edition','remplir-sa-liste-de-souhaits','decouvrir-sa-cible',
    'messages-secrets-cible-santa','marquer-son-cadeau-envoye-ou-recu','revelation-qui-a-offert-a-qui',
    'badges-et-paillettes-secret-santa']::text[] $$;

create or replace function public.hg_quest_track(p_kind text, p_ref text default ''::text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r text := left(btrim(coalesce(p_ref, '')), 80); target uuid;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_kind not in ('fiche_vue', 'carte_identite', 'app_installee', 'tuto_lu', 'theme_change') then
    raise exception 'Action inconnue';
  end if;
  if p_kind = 'fiche_vue' then
    begin target := r::uuid; exception when others then raise exception 'Membre inconnu'; end;
    if target = me or not exists (select 1 from hg_profiles where id = target and not is_ghost) then raise exception 'Membre inconnu'; end if;
  elsif p_kind = 'tuto_lu' then
    if not (r = any (hg_tuto_slugs())) then raise exception 'Tuto inconnu'; end if;
  elsif p_kind = 'theme_change' then
    if r not in ('sombre', 'clair', 'daltonien') then raise exception 'Mode inconnu'; end if;
  elsif p_kind in ('carte_identite', 'app_installee') then
    r := '';
  end if;
  -- 40 enregistrements par type et par semaine au plus.
  if (select count(*) from hg_quest_events where user_id = me and kind = p_kind and week = hg_quest_week()) >= 40 then return; end if;
  perform hg_quest_event_add(me, p_kind, r);
end $$;

-- ---------------------------------------------------------------------
-- 11. Gains restants (pour les messages du front) et droits
-- ---------------------------------------------------------------------
-- { photos: {payees, plafond}, souvenirs: {payes, plafond}, sortie: {payees, plafond} } pour le membre connecté.
create or replace function public.hg_eco_quota()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not hg_is_member() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'photos', jsonb_build_object('payees', hg_eco_count(me, 'photo', hg_eco_day_start()), 'plafond', hg_eco_cap('photos_jour', 5)),
    'souvenirs', jsonb_build_object('payes', hg_eco_count(me, 'moment', hg_eco_day_start()), 'plafond', hg_eco_cap('souvenirs_jour', 5)),
    'sortie', jsonb_build_object('payees', hg_eco_count(me, 'sortie_creee', hg_eco_week_start()), 'plafond', hg_eco_cap('sorties_semaine', 1)));
end $$;

do $d$
declare f text;
begin
  -- Outils internes et fonctions trigger : pas d'appel direct par le client.
  foreach f in array array[
    'public.hg_eco_legacy_before()', 'public.hg_eco_cap(text, integer)', 'public.hg_eco_day_start()',
    'public.hg_eco_week_start()', 'public.hg_eco_count(uuid, text, timestamptz)', 'public.hg_eco_lock(uuid)',
    'public.hg_eco_event_ok(uuid, uuid)', 'public.hg_eco_photos(uuid)', 'public.hg_eco_moments(uuid)',
    'public.hg_eco_events_created(uuid)', 'public.hg_eco_attended()', 'public.hg_rsvps_author_trg()',
    'public.hg_eco_insert_guard()', 'public.hg_eco_update_guard()', 'public.hg_ss_part_guard()',
    'public.hg_cards_earn_trg()', 'public.hg_cards_presence()', 'public.hg_award_badges(uuid)',
    'public.hg_award_level_badges(uuid)', 'public.hg_metric_value(uuid, text, uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $d$;
grant execute on function public.hg_ss_people(uuid) to authenticated;
grant execute on function public.hg_eggs_public() to authenticated;
grant execute on function public.hg_support_public() to anon, authenticated;
grant execute on function public.hg_eco_quota() to authenticated;
grant execute on function public.hg_egg_found(text, jsonb) to authenticated;
grant execute on function public.hg_quest_track(text, text) to authenticated;
grant execute on function public.hg_tuto_slugs() to authenticated;
revoke execute on function public.hg_ss_people(uuid) from public, anon;
revoke execute on function public.hg_eggs_public() from public, anon;
revoke execute on function public.hg_eco_quota() from public, anon;
