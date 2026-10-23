-- ===== Humane Gang — 096 : idées T1 à T4 (saisonnier) =====
-- S'applique après 075 (et après 080 / 084 s'ils sont livrés : T3 s'y branche sans les exiger).
-- Idempotente (create … if not exists, create or replace, insertions gardées, blocs do) et rétrocompatible
-- (colonnes facultatives, aucune signature existante modifiée, hg_eggs_public et hg_card_quests_pick renvoient
-- seulement plus de choses). Les mots-clés de retrait sont construits dynamiquement (l'outil de migration les refuse).
--
-- Sécurité (audit du 23/10) : toute récompense passe par une RPC SECURITY DEFINER plafonnée et idempotente
-- (hg_wallet_add + index unique hg_wallet_log_once, ou ligne d'idempotence dédiée) ; aucune récompense par trigger ;
-- nouvelles tables en RLS sans policy d'écriture ; search_path fixé ; execute retiré à anon et public ; droits Staff
-- par hg_has_perm ; actions Staff journalisées (hg_admin_audit) ; réglages bornés à la lecture.
--
-- 0. Commun : hg_season_now() (date de test réservée à l'admin, 2 h au plus), hg_saisons_cfg(), réglage « saisons ».
-- 1. T1 Calendrier de l'Avent : hg_advent_days, hg_advent_opens ; hg_advent_me, hg_advent_open, hg_advent_answer,
--    hg_advent_claim_group ; Staff « themes » : hg_advent_admin, hg_advent_day_save, hg_advent_autofill ;
--    badge avent_complet ; contenu par défaut de 2026 (Paillettes, quatre cases collectives, booster le 24).
-- 2. T2 Soirée déballage : colonnes unwrap_* de hg_ss_editions (figées pour le client), hg_ss_unwrap (temps réel) ;
--    Staff « secret_santa » : hg_ss_unwrap_setup, hg_ss_unwrap_fix_date, hg_ss_unwrap_draw, hg_ss_unwrap_next,
--    hg_ss_unwrap_reveal ; membre : hg_ss_unwrap_state. Aucune récompense.
-- 3. T3 Saison des Worlds : thème « worlds » (éteint), réglage saisons.worlds, trois quêtes saisonnières ajoutées EN PLUS
--    des quêtes de la semaine (hg_card_quests_pick), trois métriques (pronos_faits, boosters_saison, reactions_saison),
--    badges pickem_parfait et fidele_worlds (hg_saison_badges) ; hg_saison_state (accueil), hg_saison_set (Staff « themes »).
--    Points d'accroche : type de booster par id (défaut worlds_2026, C1 / 080), pronostics de J5 (hg_pick_*, 084) lus
--    seulement s'ils existent, lien jeux.html#pronos.
-- 4. T4 Anniversaire du serveur : réglage saisons.anniversaire, hg_eggs_public enrichi (âge, fenêtre), type de booster
--    « anniversaire » (hors vente), série « Anniversaires du gang » (hors boosters), carte datée de l'année,
--    hg_anniv_claim, hg_gang_retro, hg_moments.retro (Staff « souvenirs » : hg_moment_retro_set), hg_anniv_admin.
-- 5. Bot : hg_bot_runs (même table que 084), hg_saisons_bot_due / hg_saisons_bot_release (clé service seulement).
-- 6. Droits.

-- =====================================================================
-- 0. Commun
-- =====================================================================
insert into public.hg_settings (key, value)
values ('saisons', jsonb_build_object(
  'avent', jsonb_build_object('actif', true, 'seuil', 10, 'seuil_pct', 70, 'carte_repli', 20),
  'worlds', jsonb_build_object('actif', false, 'debut', null, 'fin', null, 'booster', 'worlds_2026',
    'pronos', 'jeux.html#pronos', 'theme', 'worlds',
    'quetes', jsonb_build_array('q_saison_worlds_pronos', 'q_saison_worlds_booster', 'q_saison_worlds_reaction'),
    'mots', jsonb_build_array('worlds', 'lec', 'lol', 'esport', 'karmine', 'kc', 'pick''em', 'pickem', 'finale', 'nexus')),
  'anniversaire', jsonb_build_object('annee', 2022, 'fenetre', 1, 'booster', 'anniversaire', 'cartes', '{}'::jsonb),
  'date_test', null))
on conflict (key) do nothing;

-- Réglages saisonniers (hg_settings.saisons), lus côté serveur seulement.
create or replace function public.hg_saisons_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from hg_settings where key = 'saisons'), '{}'::jsonb) $$;

-- Maintenant, pour les fonctions saisonnières. L'administrateur peut fixer une date de test (hg_saisons_test_date) :
-- elle ne vaut que pour lui, avance avec l'horloge et expire seule (2 h au plus). Tous les autres voient now().
create or replace function public.hg_season_now()
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare t jsonb := hg_saisons_cfg()->'date_test'; v_at timestamptz; v_set timestamptz; v_exp timestamptz;
begin
  if t is null or jsonb_typeof(t) <> 'object' or not hg_is_admin() then return now(); end if;
  begin
    v_at := (t->>'at')::timestamptz; v_set := (t->>'set_at')::timestamptz; v_exp := (t->>'expires')::timestamptz;
  exception when others then return now(); end;
  if v_at is null or v_set is null or v_exp is null or v_exp <= now() or v_exp > v_set + interval '2 hours' then return now(); end if;
  return v_at + (now() - v_set);
end $$;

-- Administrateur : fixe (ou retire, p_at null) sa date de test pour 2 h.
create or replace function public.hg_saisons_test_date(p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not hg_is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_at is not null and (p_at < now() - interval '3 years' or p_at > now() + interval '3 years') then
    raise exception 'Date de test hors limites (3 ans autour d''aujourd''hui)';
  end if;
  v := case when p_at is null then 'null'::jsonb
    else jsonb_build_object('at', p_at, 'set_at', now(), 'expires', now() + interval '2 hours') end;
  insert into hg_settings (key, value) values ('saisons', jsonb_build_object('date_test', v))
    on conflict (key) do update set value = hg_settings.value || jsonb_build_object('date_test', v), updated_at = now();
  perform hg_admin_audit('saisons_date_test', null, coalesce(p_at::text, 'aucune'), '{}'::jsonb);
  return v;
end $$;

-- Appel de service : clé service (API) ou tâche en base sans utilisateur (pg_cron, psql). Jamais un membre :
-- dans une fonction SECURITY DEFINER, current_user vaut toujours le propriétaire ; on regarde donc le rôle de l'appel.
create or replace function public.hg_saisons_is_service()
returns boolean language sql stable set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role'
    or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated') and session_user not in ('anon', 'authenticated', 'authenticator')) $$;

-- Membres non fantômes (taille du gang, pour borner les seuils collectifs).
create or replace function public.hg_saisons_gang_size()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from hg_profiles where not coalesce(is_ghost, false) $$;

-- =====================================================================
-- 1. T1 — Calendrier de l'Avent
-- =====================================================================
create table if not exists public.hg_advent_days (
  year int not null check (year between 2024 and 2100),
  day int not null check (day between 1 and 24),
  kind text not null default 'paillettes' check (kind in ('paillettes', 'carte', 'souvenir', 'question', 'booster')),
  reward int not null default 0 check (reward between 0 and 200),
  card_id uuid,
  shiny boolean not null default false,
  moment_id uuid,
  event_id uuid,
  quiz_id uuid,
  booster_type text,
  group_target int check (group_target is null or group_target between 1 and 200),
  group_reward int not null default 0 check (group_reward between 0 and 200),
  label text check (label is null or char_length(label) <= 120),
  announced_at timestamptz,
  group_announced_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (year, day)
);
comment on table public.hg_advent_days is 'T1 (migration 096) : contenu des 24 cases du calendrier de l''Avent. Jamais lisible directement par un membre (hg_advent_me ne renvoie que les cases ouvertes). Écriture : hg_advent_day_save (Staff « themes »).';

do $fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'hg_advent_days_card_fk') then
    execute 'alter table public.hg_advent_days add constraint hg_advent_days_card_fk foreign key (card_id) references public.hg_cards(id) on ' || 'de' || 'lete set null';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_advent_days_moment_fk') then
    execute 'alter table public.hg_advent_days add constraint hg_advent_days_moment_fk foreign key (moment_id) references public.hg_moments(id) on ' || 'de' || 'lete set null';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_advent_days_event_fk') then
    execute 'alter table public.hg_advent_days add constraint hg_advent_days_event_fk foreign key (event_id) references public.hg_events(id) on ' || 'de' || 'lete set null';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_advent_days_quiz_fk') then
    execute 'alter table public.hg_advent_days add constraint hg_advent_days_quiz_fk foreign key (quiz_id) references public.hg_quiz_questions(id) on ' || 'de' || 'lete set null';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_advent_days_booster_fk') then
    execute 'alter table public.hg_advent_days add constraint hg_advent_days_booster_fk foreign key (booster_type) references public.hg_booster_types(id) on ' || 'de' || 'lete set null';
  end if;
end $fk$;

create table if not exists public.hg_advent_opens (
  year int not null,
  day int not null check (day between 1 and 24),
  user_id uuid not null,
  opened_at timestamptz not null default now(),
  late boolean not null default false,
  paid int not null default 0,
  copy_id bigint,
  group_claimed_at timestamptz,
  group_paid int not null default 0,
  primary key (year, day, user_id)
);
create index if not exists hg_advent_opens_user on public.hg_advent_opens (user_id, year);
do $fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'hg_advent_opens_user_fk') then
    execute 'alter table public.hg_advent_opens add constraint hg_advent_opens_user_fk foreign key (user_id) references public.hg_profiles(id) on ' || 'de' || 'lete cascade';
  end if;
end $fk$;
comment on table public.hg_advent_opens is 'T1 (migration 096) : cases ouvertes par chaque membre (une ligne par case et par membre = une seule récompense). Écrite par hg_advent_open / hg_advent_claim_group seulement.';

alter table public.hg_advent_days enable row level security;
alter table public.hg_advent_opens enable row level security;
revoke all on public.hg_advent_days from public, anon, authenticated;
revoke all on public.hg_advent_opens from public, anon, authenticated;

insert into public.hg_perm_tables (tbl, perm) select 'hg_advent_days', 'themes'
  where not exists (select 1 from public.hg_perm_tables where tbl = 'hg_advent_days')
    and exists (select 1 from public.hg_perm_catalog where key = 'themes');
insert into public.hg_perm_tables (tbl, perm) select 'hg_advent_opens', 'themes'
  where not exists (select 1 from public.hg_perm_tables where tbl = 'hg_advent_opens')
    and exists (select 1 from public.hg_perm_catalog where key = 'themes');

insert into public.hg_badges (code, name, description, sort)
values ('avent_complet', 'Calendrier complet', 'A ouvert les 24 cases du calendrier de l’Avent du gang.', 400)
on conflict (code) do nothing;

-- Réglages du calendrier, bornés.
create or replace function public.hg_advent_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'actif', coalesce((c->>'actif')::boolean, true),
    'seuil', least(greatest(coalesce((c->>'seuil')::int, 10), 1), 200),
    'seuil_pct', least(greatest(coalesce((c->>'seuil_pct')::int, 70), 10), 100),
    'carte_repli', least(greatest(coalesce((c->>'carte_repli')::int, 20), 0), 200),
    'plafond', least(greatest(hg_eco_cap('avent_mois', 600), 0), 3000))
  from (select coalesce(hg_saisons_cfg()->'avent', '{}'::jsonb) as c) x $$;

-- Où en est le calendrier : année (décembre seulement), case débloquée (6 h, heure de Zurich), rattrapage possible.
create or replace function public.hg_advent_clock()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'year', case when extract(month from z) = 12 then extract(year from z)::int end,
    'today', case when extract(month from z) = 12 then least(24, greatest(0,
      case when extract(day from z)::int = 1 and extract(hour from z) < 6 then 0
           else extract(day from (z - interval '6 hours'))::int end)) else 0 end,
    'open', extract(month from z) = 12,
    'now', hg_season_now())
  from (select hg_season_now() at time zone 'Europe/Zurich' as z) x $$;

-- Seuil effectif d'une case collective : seuil de la case (ou réglage), borné par un pourcentage du gang.
create or replace function public.hg_advent_target(p_target int)
returns int language sql stable security definer set search_path = public as $$
  select least(coalesce(p_target, (hg_advent_cfg()->>'seuil')::int),
               greatest(1, ceil(hg_saisons_gang_size() * (hg_advent_cfg()->>'seuil_pct')::numeric / 100)::int)) $$;

-- Contenu d'une case (pour une case déjà ouverte par le membre, ou pour le Staff).
create or replace function public.hg_advent_content(p_year int, p_day int, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d hg_advent_days; o hg_advent_opens; out jsonb; k record; m record; e record; q record; bt record;
  answered boolean := false; a_ok boolean;
begin
  select * into d from hg_advent_days where year = p_year and day = p_day;
  if not found then return null; end if;
  select * into o from hg_advent_opens where year = p_year and day = p_day and user_id = p_user;
  out := jsonb_build_object('kind', d.kind, 'reward', d.reward, 'label', d.label, 'paid', coalesce(o.paid, 0));
  if d.kind = 'carte' and d.card_id is not null then
    select c.id, c.name, c.rarity, c.family, c.image_url, c.flavor, c.caption, c.number, c.max_copies, s.name as set_name, s.code as set_code
      into k from hg_cards c join hg_card_sets s on s.id = c.set_id where c.id = d.card_id;
    if found then
      out := out || jsonb_build_object('card', to_jsonb(k), 'shiny', coalesce((select x.shiny from hg_card_copies x where x.id = o.copy_id), d.shiny),
        'serial', (select x.serial from hg_card_copies x where x.id = o.copy_id), 'copy_id', o.copy_id);
    end if;
  elsif d.kind = 'souvenir' then
    if d.moment_id is not null then
      select id, title, body, happened_on, image_path into m from hg_moments where id = d.moment_id;
      if found then out := out || jsonb_build_object('moment', jsonb_build_object('id', m.id, 'title', m.title,
        'body', left(coalesce(m.body, ''), 600), 'happened_on', m.happened_on, 'image_path', m.image_path)); end if;
    end if;
    if d.event_id is not null then
      select id, title, location, starts_at, cover_path into e from hg_events where id = d.event_id;
      if found then out := out || jsonb_build_object('event', jsonb_build_object('id', e.id, 'title', e.title,
        'location', e.location, 'starts_at', e.starts_at, 'cover_path', e.cover_path)); end if;
    end if;
  elsif d.kind = 'question' and d.quiz_id is not null then
    select id, prompt, qtype, options, image_url, reward, explanation into q from hg_quiz_questions where id = d.quiz_id;
    if found then
      select is_correct into a_ok from hg_quiz_answers where question_id = q.id and user_id = p_user;
      answered := found;
      out := out || jsonb_build_object('question', jsonb_build_object('id', q.id, 'prompt', q.prompt, 'qtype', q.qtype,
        'options', coalesce((select jsonb_agg(jsonb_build_object('id', x->>'id', 'text', x->>'text')) from jsonb_array_elements(q.options) x), '[]'::jsonb),
        'image_url', q.image_url, 'reward', q.reward, 'answered', answered, 'correct', a_ok,
        'explanation', case when answered and a_ok is not null then q.explanation end));
    end if;
  elsif d.kind = 'booster' and d.booster_type is not null then
    select id, name, size, style into bt from hg_booster_types where id = d.booster_type;
    if found then out := out || jsonb_build_object('booster', jsonb_build_object('id', bt.id, 'name', bt.name, 'size', bt.size, 'style', bt.style)); end if;
  end if;
  return out;
end $$;

-- Membre : le calendrier de l'année (décembre). Contenu seulement pour les cases qu'il a ouvertes.
create or replace function public.hg_advent_me()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); clk jsonb := hg_advent_clock(); y int; t int; cfg jsonb := hg_advent_cfg(); days jsonb;
  n_open int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  y := (clk->>'year')::int; t := (clk->>'today')::int;
  if y is null or not (cfg->>'actif')::boolean or not exists (select 1 from hg_advent_days where year = y) then
    return jsonb_build_object('active', false, 'year', y, 'today', t);
  end if;
  select jsonb_agg(jsonb_build_object(
      'day', g.d,
      'state', case when o.user_id is not null then 'ouverte'
                    when g.d > t then 'verrouillee'
                    when g.d = t then 'a_ouvrir'
                    else 'a_rattraper' end,
      'ready', d.year is not null,
      'group', d.group_target is not null,
      'group_target', case when d.group_target is not null then hg_advent_target(d.group_target) end,
      'group_count', case when d.group_target is not null and g.d <= t then (select count(*) from hg_advent_opens x where x.year = y and x.day = g.d) end,
      'group_reward', case when d.group_target is not null then d.group_reward end,
      'group_claimed', o.group_claimed_at is not null,
      'content', case when o.user_id is not null then hg_advent_content(y, g.d, me) end) order by g.d)
    into days
    from generate_series(1, 24) g(d)
    left join hg_advent_days d on d.year = y and d.day = g.d
    left join hg_advent_opens o on o.year = y and o.day = g.d and o.user_id = me;
  select count(*) into n_open from hg_advent_opens where year = y and user_id = me;
  return jsonb_build_object('active', true, 'year', y, 'today', t, 'opened', n_open,
    'complete', n_open >= 24, 'catch_up_until', make_date(y, 12, 31), 'days', days);
end $$;

-- Membre : ouvre une case (celle du jour ou une case passée, jusqu'au 31 décembre). Une récompense par case.
create or replace function public.hg_advent_open(p_day int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); clk jsonb := hg_advent_clock(); y int; t int; d hg_advent_days; cfg jsonb := hg_advent_cfg();
  n int; given int := 0; already int; cap int; cid bigint; badge boolean := false; v_ref text; fallback boolean := false;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  y := (clk->>'year')::int; t := (clk->>'today')::int;
  if y is null or not (cfg->>'actif')::boolean then raise exception 'Le calendrier de l''Avent est fermé'; end if;
  if p_day is null or p_day < 1 or p_day > 24 then raise exception 'Case inconnue'; end if;
  if p_day > t then raise exception 'Patience : cette case s''ouvre le % décembre à 6 h', p_day; end if;
  select * into d from hg_advent_days where year = y and day = p_day;
  if not found then raise exception 'Cette case n''est pas encore prête'; end if;
  perform hg_eco_lock(me);
  insert into hg_wallets (user_id) values (me) on conflict do nothing;
  perform 1 from hg_wallets where user_id = me for update;
  insert into hg_advent_opens (year, day, user_id, late) values (y, p_day, me, p_day < t) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('day', p_day, 'already', true, 'content', hg_advent_content(y, p_day, me));
  end if;
  v_ref := 'avent:' || y || ':' || lpad(p_day::text, 2, '0');
  -- Carte : un exemplaire (source « evenement »). Plus d'exemplaire disponible : Paillettes de repli.
  if d.kind = 'carte' and d.card_id is not null then
    begin
      cid := hg_card_give(me, d.card_id, d.shiny, 'evenement');
      update hg_advent_opens set copy_id = cid where year = y and day = p_day and user_id = me;
    exception when others then
      fallback := true;
    end;
  elsif d.kind = 'booster' and d.booster_type is not null then
    insert into hg_booster_stock (user_id, type_id, qty) values (me, d.booster_type, 1)
      on conflict (user_id, type_id) do update set qty = hg_booster_stock.qty + 1;
  end if;
  -- Paillettes de la case (toutes sortes), plafonnées sur le mois.
  given := d.reward + case when fallback then (cfg->>'carte_repli')::int else 0 end;
  if given > 0 then
    cap := (cfg->>'plafond')::int;
    select coalesce(sum(delta), 0) into already from hg_wallet_log
      where user_id = me and reason in ('avent', 'avent_groupe') and hg_wallet_log.ref like 'avent:' || y || ':%';
    given := least(given, greatest(cap - already, 0));
    if given > 0 and hg_wallet_add(me, given, 'avent', v_ref) then
      update hg_advent_opens set paid = given where year = y and day = p_day and user_id = me;
    else
      given := 0;
    end if;
  end if;
  -- 24 cases ouvertes : badge « Calendrier complet » (payé comme tout badge, une seule fois).
  if (select count(*) from hg_advent_opens where year = y and user_id = me) >= 24 then
    insert into hg_user_badges (user_id, badge_code) values (me, 'avent_complet') on conflict do nothing;
    get diagnostics n = row_count;
    badge := n > 0;
  end if;
  return jsonb_build_object('day', p_day, 'already', false, 'paid', given, 'fallback', fallback, 'badge', badge,
    'content', hg_advent_content(y, p_day, me));
end $$;

-- Membre : répond à la question d'une case qu'il a ouverte (question réservée au calendrier : elle peut être inactive
-- dans le quiz). Même correction et même gain que hg_quiz_answer (raison « quiz », référence « quiz:<id> »).
create or replace function public.hg_advent_answer(p_day int, p_response jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); y int := (hg_advent_clock()->>'year')::int; d hg_advent_days; q hg_quiz_questions; k jsonb;
  ok boolean; gain int := 0;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if y is null then raise exception 'Le calendrier de l''Avent est fermé'; end if;
  select * into d from hg_advent_days where year = y and day = p_day;
  if not found or d.kind <> 'question' or d.quiz_id is null then raise exception 'Pas de question dans cette case'; end if;
  if not exists (select 1 from hg_advent_opens where year = y and day = p_day and user_id = me) then
    raise exception 'Ouvre d''abord la case';
  end if;
  select * into q from hg_quiz_questions where id = d.quiz_id;
  if not found then raise exception 'Question introuvable'; end if;
  if p_response is null or (jsonb_typeof(p_response) = 'string' and btrim(p_response #>> '{}') = '')
     or (jsonb_typeof(p_response) = 'array' and jsonb_array_length(p_response) = 0) then
    raise exception 'Choisis ou écris une réponse';
  end if;
  if length(p_response::text) > 1000 then raise exception 'Réponse trop longue'; end if;
  perform hg_eco_lock(me);
  if exists (select 1 from hg_quiz_answers where question_id = q.id and user_id = me) then
    raise exception 'Tu as déjà répondu à cette question';
  end if;
  select answer into k from hg_quiz_keys where question_id = q.id;
  ok := hg_quiz_check(q.qtype, coalesce(k, '{}'::jsonb), p_response);
  if ok then gain := least(q.reward, 200); end if;
  insert into hg_quiz_answers (question_id, user_id, response, is_correct, reward) values (q.id, me, p_response, ok, gain);
  if gain > 0 then perform hg_wallet_add(me, gain, 'quiz', 'quiz:' || q.id::text); end if;
  return jsonb_build_object('correct', ok, 'reward', gain, 'explanation', case when ok is not null then q.explanation end,
    'solution', case when ok is not null then
      case q.qtype when 'texte' then k->'accepted' when 'nombre' then k->'value' else k->'correct' end end);
end $$;

-- Membre : réclame le bonus d'une case collective, une fois le seuil atteint (il faut avoir ouvert la case).
create or replace function public.hg_advent_claim_group(p_day int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); y int := (hg_advent_clock()->>'year')::int; d hg_advent_days; cnt int; tgt int;
  gain int; cap int; already int; v_ref text;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if y is null or not (hg_advent_cfg()->>'actif')::boolean then raise exception 'Le calendrier de l''Avent est fermé'; end if;
  select * into d from hg_advent_days where year = y and day = p_day;
  if not found or d.group_target is null then raise exception 'Cette case n''est pas collective'; end if;
  if not exists (select 1 from hg_advent_opens where year = y and day = p_day and user_id = me) then
    raise exception 'Ouvre d''abord la case du %', p_day;
  end if;
  select count(*) into cnt from hg_advent_opens where year = y and day = p_day;
  tgt := hg_advent_target(d.group_target);
  if cnt < tgt then raise exception 'Encore % membre(s) avant le bonus du gang', tgt - cnt; end if;
  perform hg_eco_lock(me);
  v_ref := 'avent:' || y || ':' || lpad(p_day::text, 2, '0') || ':groupe';
  cap := (hg_advent_cfg()->>'plafond')::int;
  select coalesce(sum(delta), 0) into already from hg_wallet_log
    where user_id = me and reason in ('avent', 'avent_groupe') and hg_wallet_log.ref like 'avent:' || y || ':%';
  gain := least(d.group_reward, greatest(cap - already, 0));
  update hg_advent_opens set group_claimed_at = now() where year = y and day = p_day and user_id = me and group_claimed_at is null;
  if not found then return jsonb_build_object('already', true, 'paid', 0); end if;
  if gain > 0 and hg_wallet_add(me, gain, 'avent_groupe', v_ref) then
    update hg_advent_opens set group_paid = gain where year = y and day = p_day and user_id = me;
  else
    gain := 0;
  end if;
  return jsonb_build_object('already', false, 'paid', gain, 'count', cnt, 'target', tgt);
end $$;

-- Staff « themes » : les 24 cases d'une année, avec le contenu complet et le nombre d'ouvertures.
create or replace function public.hg_advent_admin(p_year int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('themes') then raise exception 'Réservé au Staff « Thèmes et événements »'; end if;
  return jsonb_build_object('year', p_year, 'clock', hg_advent_clock(), 'cfg', hg_advent_cfg(), 'gang', hg_saisons_gang_size(),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'day', g.d, 'ready', d.year is not null, 'kind', d.kind, 'reward', d.reward, 'card_id', d.card_id, 'shiny', d.shiny,
        'moment_id', d.moment_id, 'event_id', d.event_id, 'quiz_id', d.quiz_id, 'booster_type', d.booster_type,
        'group_target', d.group_target, 'group_target_eff', case when d.group_target is not null then hg_advent_target(d.group_target) end,
        'group_reward', d.group_reward, 'label', d.label,
        'opens', (select count(*) from hg_advent_opens x where x.year = p_year and x.day = g.d),
        'preview', case when d.year is not null then hg_advent_content(p_year, g.d, null) end) order by g.d)
      from generate_series(1, 24) g(d) left join hg_advent_days d on d.year = p_year and d.day = g.d), '[]'::jsonb));
end $$;

-- Staff « themes » : enregistre une case (valeurs vérifiées et bornées), journalisé.
create or replace function public.hg_advent_day_save(p_year int, p_day int, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text := coalesce(p->>'kind', 'paillettes'); r int; gt int; gr int; card uuid; mom uuid; ev uuid; qz uuid; bt text;
begin
  if not hg_has_perm('themes') then raise exception 'Réservé au Staff « Thèmes et événements »'; end if;
  if p_year is null or p_year < 2024 or p_year > 2100 or p_day is null or p_day < 1 or p_day > 24 then raise exception 'Case inconnue'; end if;
  if k not in ('paillettes', 'carte', 'souvenir', 'question', 'booster') then raise exception 'Sorte de case inconnue'; end if;
  begin
    r := coalesce(nullif(p->>'reward', '')::int, 0);
    gt := nullif(p->>'group_target', '')::int;
    gr := coalesce(nullif(p->>'group_reward', '')::int, 0);
    card := nullif(p->>'card_id', '')::uuid; mom := nullif(p->>'moment_id', '')::uuid;
    ev := nullif(p->>'event_id', '')::uuid; qz := nullif(p->>'quiz_id', '')::uuid;
  exception when others then raise exception 'Valeur invalide'; end;
  bt := nullif(p->>'booster_type', '');
  if r < 0 or r > 200 then raise exception 'Paillettes de la case : de 0 à 200'; end if;
  if gr < 0 or gr > 200 then raise exception 'Bonus du gang : de 0 à 200'; end if;
  if gt is not null and (gt < 1 or gt > 200) then raise exception 'Seuil collectif : de 1 à 200 membres'; end if;
  if k = 'paillettes' and r < 1 then raise exception 'Indique des Paillettes (1 à 200)'; end if;
  if k = 'carte' and (card is null or not exists (select 1 from hg_cards where id = card)) then raise exception 'Choisis une carte'; end if;
  if k = 'souvenir' and mom is null and ev is null then raise exception 'Choisis un souvenir ou une sortie'; end if;
  if mom is not null and not exists (select 1 from hg_moments where id = mom) then raise exception 'Souvenir introuvable'; end if;
  if ev is not null and not exists (select 1 from hg_events where id = ev) then raise exception 'Sortie introuvable'; end if;
  if k = 'question' and (qz is null or not exists (select 1 from hg_quiz_questions where id = qz)) then raise exception 'Choisis une question'; end if;
  if k = 'booster' and (bt is null or not exists (select 1 from hg_booster_types where id = bt)) then raise exception 'Choisis un type de booster'; end if;
  insert into hg_advent_days (year, day, kind, reward, card_id, shiny, moment_id, event_id, quiz_id, booster_type,
      group_target, group_reward, label, updated_at, updated_by)
    values (p_year, p_day, k, r, case when k = 'carte' then card end, k = 'carte' and coalesce((p->>'shiny')::boolean, false),
      case when k = 'souvenir' then mom end, case when k = 'souvenir' then ev end, case when k = 'question' then qz end,
      case when k = 'booster' then bt end, gt, case when gt is null then 0 else gr end, left(nullif(btrim(p->>'label'), ''), 120),
      now(), auth.uid())
    on conflict (year, day) do update set kind = excluded.kind, reward = excluded.reward, card_id = excluded.card_id,
      shiny = excluded.shiny, moment_id = excluded.moment_id, event_id = excluded.event_id, quiz_id = excluded.quiz_id,
      booster_type = excluded.booster_type, group_target = excluded.group_target, group_reward = excluded.group_reward,
      label = excluded.label, updated_at = now(), updated_by = auth.uid();
  perform hg_admin_audit('avent_case', null, p_year || '-' || p_day, jsonb_build_object('sorte', k, 'paillettes', r, 'seuil', gt));
  return jsonb_build_object('year', p_year, 'day', p_day);
end $$;

-- Staff « themes » : propositions de souvenirs pour chaque case (même jour de décembre, années passées).
create or replace function public.hg_advent_autofill(p_year int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('themes') then raise exception 'Réservé au Staff « Thèmes et événements »'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('day', g.d,
      'moments', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'happened_on', m.happened_on, 'has_image', m.image_path is not null) order by m.happened_on desc)
        from hg_moments m where extract(month from m.happened_on) = 12 and extract(day from m.happened_on) = g.d
          and extract(year from m.happened_on) < p_year), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at) order by e.starts_at desc)
        from hg_events e where e.starts_at is not null
          and extract(month from e.starts_at at time zone 'Europe/Zurich') = 12 and extract(day from e.starts_at at time zone 'Europe/Zurich') = g.d
          and extract(year from e.starts_at at time zone 'Europe/Zurich') < p_year), '[]'::jsonb)) order by g.d)
    from generate_series(1, 24) g(d)), '[]'::jsonb);
end $$;

-- Contenu par défaut de 2026 (le Staff le remplace la dernière semaine de novembre) : Paillettes 15 à 25,
-- cases collectives les 6, 13, 20 et 24 (bonus 25), booster Collectionneur dans le stock le 24 s'il existe.
-- Budget : 420 Paillettes + 100 de bonus ≈ 500 par membre, sous le plafond « avent_mois » (600 par défaut, bonus compris).
do $seed$
declare amounts int[] := array[20,15,15,15,20,25,15,20,15,15,20,15,25,15,15,20,15,20,15,25,15,20,25,0];
  i int;
begin
  for i in 1..24 loop
    insert into public.hg_advent_days (year, day, kind, reward, booster_type, group_target, group_reward)
    values (2026, i,
      case when i = 24 and exists (select 1 from public.hg_booster_types where id = 'collectionneur') then 'booster' else 'paillettes' end,
      case when i = 24 and exists (select 1 from public.hg_booster_types where id = 'collectionneur') then 0 when i = 24 then 40 else amounts[i] end,
      case when i = 24 and exists (select 1 from public.hg_booster_types where id = 'collectionneur') then 'collectionneur' end,
      case when i in (6, 13, 20, 24) then 10 end,
      case when i in (6, 13, 20, 24) then 25 else 0 end)
    on conflict (year, day) do nothing;
  end loop;
end $seed$;

-- =====================================================================
-- 2. T2 — Soirée déballage
-- =====================================================================
alter table public.hg_ss_editions add column if not exists unwrap_event_id uuid;
alter table public.hg_ss_editions add column if not exists unwrap_started_at timestamptz;
alter table public.hg_ss_editions add column if not exists unwrap_turn_seconds int default 300; -- null = 300 (colonne figée pour le client : null à l'insertion)
alter table public.hg_ss_editions add column if not exists unwrap_all_received_at timestamptz;
alter table public.hg_ss_editions add column if not exists unwrap_reminder_at timestamptz;
do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'hg_ss_editions_unwrap_turn_check') then
    alter table public.hg_ss_editions add constraint hg_ss_editions_unwrap_turn_check check (unwrap_turn_seconds is null or unwrap_turn_seconds between 60 and 1800);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_ss_editions_unwrap_event_fk') then
    execute 'alter table public.hg_ss_editions add constraint hg_ss_editions_unwrap_event_fk foreign key (unwrap_event_id) references public.hg_events(id) on ' || 'de' || 'lete set null';
  end if;
  -- Le Staff écrit hg_ss_editions par l'API : les colonnes de la soirée ne changent que par les RPC (ou la clé service).
  if not exists (select 1 from pg_trigger where tgname = 'hg_ss_editions_unwrap_cols' and tgrelid = 'public.hg_ss_editions'::regclass) then
    create trigger hg_ss_editions_unwrap_cols before insert or update on public.hg_ss_editions
      for each row execute function public.hg_freeze_service_cols('unwrap_event_id', 'unwrap_started_at', 'unwrap_turn_seconds',
        'unwrap_all_received_at', 'unwrap_reminder_at');
  end if;
end $c$;

create table if not exists public.hg_ss_unwrap (
  edition_id uuid not null,
  user_id uuid not null,
  position int not null check (position between 1 and 1000),
  status text not null default 'attente' check (status in ('attente', 'en_cours', 'fait', 'passe', 'en_route')),
  started_at timestamptz,
  done_at timestamptz,
  primary key (edition_id, user_id)
);
do $fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'hg_ss_unwrap_edition_fk') then
    execute 'alter table public.hg_ss_unwrap add constraint hg_ss_unwrap_edition_fk foreign key (edition_id) references public.hg_ss_editions(id) on ' || 'de' || 'lete cascade';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_ss_unwrap_user_fk') then
    execute 'alter table public.hg_ss_unwrap add constraint hg_ss_unwrap_user_fk foreign key (user_id) references public.hg_profiles(id) on ' || 'de' || 'lete cascade';
  end if;
end $fk$;
comment on table public.hg_ss_unwrap is 'T2 (migration 096) : ordre de passage de la soirée déballage. Lecture : inscrits de l''édition et Staff « secret_santa ». Écriture : RPC hg_ss_unwrap_* seulement. Publiée en temps réel.';
alter table public.hg_ss_unwrap enable row level security;
revoke all on public.hg_ss_unwrap from public, anon, authenticated;
grant select on public.hg_ss_unwrap to authenticated;
do $p$
begin
  if not exists (select 1 from pg_policies where tablename = 'hg_ss_unwrap' and policyname = 'hg_ss_unwrap_read') then
    create policy hg_ss_unwrap_read on public.hg_ss_unwrap for select to authenticated
      using (hg_has_perm('secret_santa') or exists (select 1 from public.hg_ss_participants p
        where p.edition_id = hg_ss_unwrap.edition_id and p.user_id = (select auth.uid())));
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'hg_ss_unwrap') then
    alter publication supabase_realtime add table public.hg_ss_unwrap;
  end if;
end $p$;
insert into public.hg_perm_tables (tbl, perm) select 'hg_ss_unwrap', 'secret_santa'
  where not exists (select 1 from public.hg_perm_tables where tbl = 'hg_ss_unwrap')
    and exists (select 1 from public.hg_perm_catalog where key = 'secret_santa');

-- Membre inscrit (ou Staff) : état de la soirée. Ne dit jamais qui a offert à qui : seulement qui a reçu.
create or replace function public.hg_ss_unwrap_state(p_edition uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ed hg_ss_editions; staff boolean := hg_has_perm('secret_santa'); ev record; me uuid := auth.uid();
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into ed from hg_ss_editions where id = p_edition;
  if not found then raise exception 'Édition introuvable'; end if;
  if not staff and not exists (select 1 from hg_ss_participants where edition_id = p_edition and user_id = me) then
    raise exception 'Réservé aux inscrits de cette édition';
  end if;
  select id, title, starts_at into ev from hg_events where id = ed.unwrap_event_id;
  return jsonb_build_object(
    'edition', ed.id, 'year', ed.year, 'status', ed.status, 'can_pilot', staff,
    'turn_seconds', coalesce(ed.unwrap_turn_seconds, 300), 'started_at', ed.unwrap_started_at,
    'event', case when ev.id is not null then jsonb_build_object('id', ev.id, 'title', ev.title, 'starts_at', ev.starts_at,
      'photos', (select count(*) from hg_photos ph where ph.event_id = ev.id),
      'dates', coalesce((select jsonb_agg(jsonb_build_object('id', dd.id, 'at', dd.proposed_at,
          'votes', (select count(*) from hg_event_date_votes v where v.date_id = dd.id),
          'mine', exists (select 1 from hg_event_date_votes v where v.date_id = dd.id and v.user_id = me)) order by dd.proposed_at)
        from hg_event_dates dd where dd.event_id = ev.id), '[]'::jsonb)) end,
    'received', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'received', p.received_at is not null) order by p.joined_at)
      from hg_ss_participants p where p.edition_id = p_edition), '[]'::jsonb),
    'all_received', not exists (select 1 from hg_ss_participants p where p.edition_id = p_edition and p.received_at is null)
      and exists (select 1 from hg_ss_participants p where p.edition_id = p_edition),
    'order', coalesce((select jsonb_agg(jsonb_build_object('user_id', u.user_id, 'position', u.position, 'status', u.status,
        'started_at', u.started_at, 'done_at', u.done_at) order by u.position)
      from hg_ss_unwrap u where u.edition_id = p_edition), '[]'::jsonb));
end $$;

-- Staff : prépare la soirée (sortie « en ligne » sans gain, 0 à 4 dates proposées, minuteur indicatif).
create or replace function public.hg_ss_unwrap_setup(p_edition uuid, p_title text, p_dates timestamptz[], p_turn_seconds int default 300)
returns uuid language plpgsql security definer set search_path = public as $$
declare ed hg_ss_editions; eid uuid; t text := btrim(coalesce(p_title, '')); d timestamptz;
begin
  if not hg_has_perm('secret_santa') then raise exception 'Réservé au Staff « Secret Santa »'; end if;
  select * into ed from hg_ss_editions where id = p_edition for update;
  if not found then raise exception 'Édition introuvable'; end if;
  if t = '' then t := 'Soirée déballage ' || ed.year; end if;
  if char_length(t) > 120 then raise exception 'Titre trop long (120 caractères au plus)'; end if;
  if p_turn_seconds is null or p_turn_seconds < 60 or p_turn_seconds > 1800 then raise exception 'Minuteur : de 1 à 30 minutes'; end if;
  if coalesce(array_length(p_dates, 1), 0) > 4 then raise exception 'Quatre dates au plus'; end if;
  eid := ed.unwrap_event_id;
  if eid is null or not exists (select 1 from hg_events where id = eid) then
    -- created_by null : la création ne rapporte rien (hg_cards_earn_trg ne paie personne).
    insert into hg_events (title, description, location, starts_at, created_by)
      values (t, 'Soirée déballage du Secret Santa ' || ed.year || ', en vocal sur Discord.', 'En ligne (vocal Discord)', null, null)
      returning id into eid;
  else
    update hg_events set title = t where id = eid;
  end if;
  if p_dates is not null then
    foreach d in array p_dates loop
      if d is not null and not exists (select 1 from hg_event_dates where event_id = eid and proposed_at = d) then
        insert into hg_event_dates (event_id, proposed_at) values (eid, d);
      end if;
    end loop;
  end if;
  update hg_ss_editions set unwrap_event_id = eid, unwrap_turn_seconds = p_turn_seconds where id = p_edition;
  perform hg_admin_audit('ss_deballage_soiree', null, p_edition::text, jsonb_build_object('event', eid, 'dates', coalesce(array_length(p_dates, 1), 0)));
  return eid;
end $$;

-- Staff : fixe la date gagnante (proposée) de la soirée.
create or replace function public.hg_ss_unwrap_fix_date(p_edition uuid, p_date uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare ed hg_ss_editions; at timestamptz;
begin
  if not hg_has_perm('secret_santa') then raise exception 'Réservé au Staff « Secret Santa »'; end if;
  select * into ed from hg_ss_editions where id = p_edition;
  if not found or ed.unwrap_event_id is null then raise exception 'Prépare d''abord la soirée'; end if;
  select proposed_at into at from hg_event_dates where id = p_date and event_id = ed.unwrap_event_id;
  if at is null then raise exception 'Date inconnue'; end if;
  update hg_events set starts_at = at where id = ed.unwrap_event_id;
  update hg_ss_editions set unwrap_reminder_at = null where id = p_edition;
  perform hg_admin_audit('ss_deballage_date', null, p_edition::text, jsonb_build_object('date', at));
  return at;
end $$;

-- Staff : tire l'ordre de passage parmi les inscrits (refusé si déjà tiré, sauf p_force). Le premier passe « en cours ».
create or replace function public.hg_ss_unwrap_draw(p_edition uuid, p_force boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare ed hg_ss_editions; n int;
begin
  if not hg_has_perm('secret_santa') then raise exception 'Réservé au Staff « Secret Santa »'; end if;
  select * into ed from hg_ss_editions where id = p_edition for update;
  if not found then raise exception 'Édition introuvable'; end if;
  if ed.status not in ('envoi', 'revelation') then raise exception 'La soirée se tient à l''étape « envoi » ou « révélation »'; end if;
  if exists (select 1 from hg_ss_unwrap where edition_id = p_edition) then
    if not coalesce(p_force, false) then raise exception 'L''ordre est déjà tiré'; end if;
    execute 'de' || 'lete from public.hg_ss_unwrap where edition_id = $1' using p_edition;
  end if;
  insert into hg_ss_unwrap (edition_id, user_id, position, status)
    select p_edition, p.user_id, row_number() over (order by random()), 'attente'
    from hg_ss_participants p join hg_profiles pr on pr.id = p.user_id where p.edition_id = p_edition;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Aucun inscrit'; end if;
  update hg_ss_unwrap set status = 'en_cours', started_at = now() where edition_id = p_edition and position = 1;
  update hg_ss_editions set unwrap_started_at = now() where id = p_edition;
  perform hg_admin_audit('ss_deballage_ordre', null, p_edition::text, jsonb_build_object('inscrits', n, 'force', coalesce(p_force, false)));
  return n;
end $$;

-- Staff : fait avancer la soirée. 'suivant' (déballé), 'passer' (absent : en fin de liste), 'en_route' (cadeau pas
-- arrivé : déballé plus tard), 'choisir' (p_user passe maintenant, ex. cadeau arrivé entre-temps).
create or replace function public.hg_ss_unwrap_next(p_edition uuid, p_action text, p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur hg_ss_unwrap; nxt uuid; maxpos int;
begin
  if not hg_has_perm('secret_santa') then raise exception 'Réservé au Staff « Secret Santa »'; end if;
  if p_action not in ('suivant', 'passer', 'en_route', 'choisir') then raise exception 'Action inconnue'; end if;
  perform 1 from hg_ss_editions where id = p_edition for update;
  if not found then raise exception 'Édition introuvable'; end if;
  if not exists (select 1 from hg_ss_unwrap where edition_id = p_edition) then raise exception 'Tire d''abord l''ordre'; end if;
  select * into cur from hg_ss_unwrap where edition_id = p_edition and status = 'en_cours' limit 1;
  select max(position) into maxpos from hg_ss_unwrap where edition_id = p_edition;
  if cur.user_id is not null then
    if p_action = 'suivant' then
      update hg_ss_unwrap set status = 'fait', done_at = now() where edition_id = p_edition and user_id = cur.user_id;
    elsif p_action = 'passer' then
      update hg_ss_unwrap set status = 'passe', started_at = null, position = maxpos + 1 where edition_id = p_edition and user_id = cur.user_id;
    elsif p_action = 'en_route' then
      update hg_ss_unwrap set status = 'en_route', started_at = null where edition_id = p_edition and user_id = cur.user_id;
    elsif p_action = 'choisir' then
      update hg_ss_unwrap set status = 'attente', started_at = null where edition_id = p_edition and user_id = cur.user_id;
    end if;
  end if;
  if p_action = 'choisir' then
    if p_user is null or not exists (select 1 from hg_ss_unwrap where edition_id = p_edition and user_id = p_user and status <> 'fait') then
      raise exception 'Cette personne a déjà déballé ou ne participe pas';
    end if;
    nxt := p_user;
  else
    select user_id into nxt from hg_ss_unwrap where edition_id = p_edition and status in ('attente', 'passe')
      order by position limit 1;
  end if;
  if nxt is not null then
    update hg_ss_unwrap set status = 'en_cours', started_at = now() where edition_id = p_edition and user_id = nxt;
  end if;
  perform hg_admin_audit('ss_deballage_tour', null, p_edition::text, jsonb_build_object('action', p_action, 'suivant', nxt));
  return jsonb_build_object('current', nxt,
    'left', (select count(*) from hg_ss_unwrap where edition_id = p_edition and status in ('attente', 'passe', 'en_route')));
end $$;

-- Staff : révèle les paires (passe l'édition en « révélation » ; hg_ss_reveal les renvoie alors comme aujourd'hui).
create or replace function public.hg_ss_unwrap_reveal(p_edition uuid)
returns text language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if not hg_has_perm('secret_santa') then raise exception 'Réservé au Staff « Secret Santa »'; end if;
  select status into st from hg_ss_editions where id = p_edition for update;
  if st is null then raise exception 'Édition introuvable'; end if;
  if st in ('revelation', 'termine') then return st; end if;
  if st <> 'envoi' then raise exception 'La révélation suit l''étape « envoi »'; end if;
  update hg_ss_editions set status = 'revelation' where id = p_edition;
  perform hg_admin_audit('ss_deballage_revelation', null, p_edition::text, '{}'::jsonb);
  return 'revelation';
end $$;

-- =====================================================================
-- 3. T3 — Saison des Worlds
-- =====================================================================
insert into public.hg_themes (slug, name, is_default, active, start_md, end_md, priority, emojis, effect, colors)
values ('worlds', 'Saison des Worlds', false, false, '10-01', '11-15', 6, array['🏆','🎮','⚔️','✨'], 'etoiles',
  '{"bg":"#0B1026","surface":"#131A38","text":"#F2EFEA","muted":"#A9B0CC","accent":"#2E4FA8","highlight":"#E2B84F"}'::jsonb)
on conflict (slug) do nothing;

insert into public.hg_badges (code, name, description, sort) values
  ('pickem_parfait', 'Pick’em parfait', 'Tous les pronostics justes d’une phase des Worlds (au moins trois matchs).', 410),
  ('fidele_worlds', 'Fidèle de la saison', 'Dix pronostics de la saison esport, justes ou non.', 411)
on conflict (code) do nothing;

-- Métriques saisonnières dans la liste blanche des quêtes (la contrainte actuelle est relue puis complétée).
do $m$
declare def text; vals text[]; add text[] := array['pronos_faits', 'boosters_saison', 'reactions_saison']; x text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'hg_card_quests_templates_metric_check';
  if def is null then return; end if;
  if def like '%reactions_saison%' then return; end if;
  select array_agg(m[1]) into vals from regexp_matches(def, '''([a-z0-9_]+)''', 'g') m;
  foreach x in array add loop if not (x = any (vals)) then vals := vals || x; end if; end loop;
  execute 'alter table public.hg_card_quests_templates dr' || 'op constraint hg_card_quests_templates_metric_check';
  execute 'alter table public.hg_card_quests_templates add constraint hg_card_quests_templates_metric_check check (metric in ('
    || (select string_agg(quote_literal(v), ', ') from unnest(vals) v) || '))';
end $m$;

-- Trois quêtes saisonnières, inactives dans le tirage normal : hg_card_quests_pick les ajoute pendant la saison.
insert into public.hg_card_quests_templates (code, label, metric, target, reward, active, sort) values
  ('q_saison_worlds_pronos', 'Pronostique 3 matchs', 'pronos_faits', 3, 60, false, 900),
  ('q_saison_worlds_booster', 'Ouvre un booster de la saison esport', 'boosters_saison', 1, 40, false, 901),
  ('q_saison_worlds_reaction', 'Réagis à un moment culte esport', 'reactions_saison', 1, 30, false, 902)
on conflict (code) do nothing;

-- Réglage de la saison des Worlds, borné : dates, type de booster (identifiant), quêtes, mots des moments esport.
create or replace function public.hg_saison_worlds_cfg()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c jsonb := coalesce(hg_saisons_cfg()->'worlds', '{}'::jsonb); deb timestamptz; fin timestamptz;
begin
  begin deb := nullif(c->>'debut', '')::timestamptz; exception when others then deb := null; end;
  begin fin := nullif(c->>'fin', '')::timestamptz; exception when others then fin := null; end;
  return jsonb_build_object(
    'actif', coalesce((c->>'actif')::boolean, false), 'debut', deb, 'fin', fin,
    'en_cours', coalesce((c->>'actif')::boolean, false) and (deb is null or deb <= hg_season_now()) and (fin is null or fin > hg_season_now()),
    'booster', case when coalesce(c->>'booster', '') ~ '^[a-z0-9_]{2,30}$' then c->>'booster' end,
    'pronos', case when coalesce(c->>'pronos', '') ~ '^[a-z0-9_-]+\.html(#[a-z0-9_-]+)?$' then c->>'pronos' else 'jeux.html#pronos' end,
    'quetes', coalesce((select jsonb_agg(v) from (select v from jsonb_array_elements_text(case when jsonb_typeof(c->'quetes') = 'array' then c->'quetes' else '[]'::jsonb end) v
      where v ~ '^[a-z0-9_]{2,40}$' limit 6) s), '[]'::jsonb),
    'mots', coalesce((select jsonb_agg(lower(v)) from (select v from jsonb_array_elements_text(case when jsonb_typeof(c->'mots') = 'array' then c->'mots' else '[]'::jsonb end) v
      where char_length(btrim(v)) between 2 and 30 limit 20) s), '[]'::jsonb));
end $$;

-- Valeur d'une métrique saisonnière (appelée par hg_challenge_value). Les pronostics (J5, migration 084) sont lus
-- seulement si leurs tables existent ; sinon 0.
create or replace function public.hg_saison_metric(p_metric text, p_user uuid, p_start timestamptz, p_end timestamptz)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare c jsonb := hg_saison_worlds_cfg(); v numeric := 0;
begin
  if p_metric = 'pronos_faits' then
    if to_regclass('public.hg_pick_bets') is null then return 0; end if;
    execute 'select count(*) from public.hg_pick_bets b join public.hg_pick_items i on i.id = b.item_id
      join public.hg_pick_comps c on c.id = i.comp_id
      where c.kind = ''lol'' and b.created_at >= $1 and b.created_at < $2 and ($3 is null or b.user_id = $3)'
      into v using p_start, p_end, p_user;
  elsif p_metric = 'boosters_saison' then
    select count(*) into v from hg_booster_opens o where o.type_id = c->>'booster'
      and o.created_at >= p_start and o.created_at < p_end and (p_user is null or o.user_id = p_user);
  elsif p_metric = 'reactions_saison' then
    select count(distinct r.target_id) into v from hg_reactions r join hg_moments m on m.id = r.target_id
      where r.target_kind = 'moment' and r.active and r.created_at >= p_start and r.created_at < p_end
        and (p_user is null or r.user_id = p_user)
        and exists (select 1 from jsonb_array_elements_text(c->'mots') w
          where lower(m.title || ' ' || coalesce(m.body, '')) ~ ('(^|[^a-zà-ÿ0-9])' || regexp_replace(w, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '($|[^a-zà-ÿ0-9])'));
  end if;
  return coalesce(v, 0);
end $$;

-- Branche les trois métriques dans hg_challenge_value (version en place, quelle qu'elle soit) : une ligne « when »
-- par métrique avant le « else 0 ». Sans effet si c'est déjà fait. Une migration ultérieure qui réécrit
-- hg_challenge_value doit garder ces trois lignes.
do $patch$
declare def text; ins text;
begin
  select pg_get_functiondef('public.hg_challenge_value(text, uuid, timestamptz, timestamptz)'::regprocedure) into def;
  if def is null or def like '%hg_saison_metric%' then return; end if;
  if def !~ 'else 0 end\)::numeric' then raise warning '096 : hg_challenge_value sans « else 0 end)::numeric », métriques saisonnières non branchées'; return; end if;
  ins := E'    -- ---- Saisons (migration 096) ----\n'
    || E'    when ''pronos_faits'' then public.hg_saison_metric(p_metric, p_user, p_start, p_end)\n'
    || E'    when ''boosters_saison'' then public.hg_saison_metric(p_metric, p_user, p_start, p_end)\n'
    || E'    when ''reactions_saison'' then public.hg_saison_metric(p_metric, p_user, p_start, p_end)\n    else 0 end)::numeric';
  def := regexp_replace(def, '\s*else 0 end\)::numeric', E'\n' || ins);
  -- Corps relu tel quel depuis la base : pas de nouvelle vérification (comme lors de sa création).
  perform set_config('check_function_bodies', 'off', true);
  execute def;
end $patch$;

-- Quêtes de la semaine + quêtes saisonnières (EN PLUS, jamais à la place) quand la saison est en cours cette semaine.
create or replace function public.hg_card_quests_pick(p_week date)
returns setof public.hg_card_quests_templates language plpgsql security definer set search_path = public as $$
declare c jsonb := hg_saison_worlds_cfg(); ws timestamptz := (p_week::timestamp) at time zone 'Europe/Zurich';
begin
  perform hg_quest_week_ensure(p_week);
  return query select t.* from hg_card_quests_templates t
    join hg_quest_week_picks w on w.code = t.code and w.week = p_week
    where t.active;
  if (c->>'actif')::boolean
     and ((c->>'debut') is null or (c->>'debut')::timestamptz < ws + interval '7 days')
     and ((c->>'fin') is null or (c->>'fin')::timestamptz > ws) then
    return query select t.* from hg_card_quests_templates t
      where t.code in (select jsonb_array_elements_text(c->'quetes'))
        and not exists (select 1 from hg_quest_week_picks w where w.code = t.code and w.week = p_week)
      order by t.sort, t.code;
  end if;
end $$;

-- Badges de la saison (pas de trigger) : « Fidèle de la saison » (10 pronostics LoL, justes ou non, sur des matchs
-- réglés) et « Pick'em parfait » (une compétition LoL d'au moins 3 matchs réglés, tous pronostiqués et tous justes).
-- p_user null : tout le gang (Staff « themes » ou « pronos », ou clé service) ; sinon soi-même seulement.
-- J5 peut l'appeler à la fin de hg_pick_settle : perform hg_saison_badges(null).
create or replace function public.hg_saison_badges(p_user uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; who uuid := p_user;
begin
  if who is null then
    if not (hg_has_perm('themes') or hg_has_perm('pronos') or hg_saisons_is_service()) then
      who := auth.uid();
    end if;
  elsif who <> auth.uid() and not (hg_has_perm('themes') or hg_has_perm('pronos')) then
    raise exception 'Réservé au Staff';
  end if;
  if who is not null and not exists (select 1 from hg_profiles where id = who) then return 0; end if;
  if to_regclass('public.hg_pick_bets') is null then return 0; end if;
  execute 'insert into public.hg_user_badges (user_id, badge_code)
    select b.user_id, ''fidele_worlds'' from public.hg_pick_bets b join public.hg_pick_items i on i.id = b.item_id
      join public.hg_pick_comps c on c.id = i.comp_id
      where c.kind = ''lol'' and i.settled_at is not null and not i.cancelled and ($1 is null or b.user_id = $1)
      group by b.user_id having count(*) >= 10
    on conflict do nothing' using who;
  get diagnostics k = row_count; n := n + k;
  execute 'insert into public.hg_user_badges (user_id, badge_code)
    select distinct b.user_id, ''pickem_parfait'' from public.hg_pick_comps c
      join public.hg_pick_items i on i.comp_id = c.id and not i.cancelled
      join public.hg_pick_bets b on b.item_id = i.id
      where c.kind = ''lol'' and ($1 is null or b.user_id = $1)
        and not exists (select 1 from public.hg_pick_items i2 where i2.comp_id = c.id and not i2.cancelled and i2.settled_at is null)
        and (select count(*) from public.hg_pick_items i3 where i3.comp_id = c.id and not i3.cancelled) >= 3
      group by c.id, b.user_id
      having count(*) = (select count(*) from public.hg_pick_items i4 where i4.comp_id = c.id and not i4.cancelled)
         and bool_and(b.choice = i.result)
    on conflict do nothing' using who;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

-- Membre : état de la saison pour l'accueil (rien hors saison) : booster, prochain match, quêtes, badge fidèle.
create or replace function public.hg_saison_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c jsonb := hg_saison_worlds_cfg(); bt record; nxt jsonb; fid int := 0; wk date;
  ws timestamptz; we timestamptz; qs jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if not (c->>'en_cours')::boolean then return jsonb_build_object('worlds', null); end if;
  perform hg_saison_badges(me);
  select id, name, price, size, description, active, style into bt from hg_booster_types where id = c->>'booster';
  if to_regclass('public.hg_pick_items') is not null then
    execute 'select jsonb_build_object(''id'', i.id, ''label'', i.label, ''options'', i.options, ''locks_at'', i.locks_at,
        ''comp'', c.title, ''bets'', (select count(*) from public.hg_pick_bets b where b.item_id = i.id),
        ''mine'', (select b.choice from public.hg_pick_bets b where b.item_id = i.id and b.user_id = $1))
      from public.hg_pick_items i join public.hg_pick_comps c on c.id = i.comp_id
      where c.kind = ''lol'' and c.active and not i.cancelled and i.settled_at is null and i.locks_at > now()
      order by i.locks_at limit 1' into nxt using me;
    execute 'select count(*) from public.hg_pick_bets b join public.hg_pick_items i on i.id = b.item_id
      join public.hg_pick_comps c on c.id = i.comp_id where c.kind = ''lol'' and b.user_id = $1
        and i.settled_at is not null and not i.cancelled' into fid using me;
  end if;
  wk := hg_quest_week(); ws := (wk::timestamp) at time zone 'Europe/Zurich'; we := ((wk + 7)::timestamp) at time zone 'Europe/Zurich';
  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'label', t.label, 'target', t.target, 'reward', t.reward,
      'progress', hg_challenge_value(t.metric, me, ws, least(we, now())),
      'claimed', exists (select 1 from hg_wallet_log l where l.user_id = me and l.reason = 'quete' and l.ref = 'quete:' || wk::text || ':' || t.code))
      order by t.sort), '[]'::jsonb)
    into qs from hg_card_quests_templates t where t.code in (select jsonb_array_elements_text(c->'quetes'));
  return jsonb_build_object('worlds', jsonb_build_object(
    'fin', c->'fin', 'pronos', c->'pronos',
    'booster', case when bt.id is not null then jsonb_build_object('id', bt.id, 'name', bt.name, 'price', bt.price, 'size', bt.size,
      'description', bt.description, 'active', bt.active, 'style', bt.style) end,
    'next', nxt, 'quests', qs, 'week', wk,
    'fidele', jsonb_build_object('count', fid, 'target', 10,
      'has', exists (select 1 from hg_user_badges where user_id = me and badge_code = 'fidele_worlds')),
    'pickem', exists (select 1 from hg_user_badges where user_id = me and badge_code = 'pickem_parfait')));
end $$;

-- Staff « themes » : interrupteur de la saison. Allume ou éteint d'un coup le thème (dates de la saison, priorité 6),
-- le type de booster (s'il existe) et les quêtes ; à l'extinction, attribue les badges de la saison au gang.
create or replace function public.hg_saison_set(p_slug text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur jsonb := coalesce(hg_saisons_cfg()->'worlds', '{}'::jsonb); nv jsonb; on_ boolean; deb timestamptz; fin timestamptz;
  bt text; mots jsonb; n int := 0;
begin
  if not hg_has_perm('themes') then raise exception 'Réservé au Staff « Thèmes et événements »'; end if;
  if p_slug is distinct from 'worlds' then raise exception 'Saison inconnue'; end if;
  on_ := coalesce((p->>'actif')::boolean, (cur->>'actif')::boolean, false);
  begin
    deb := coalesce(nullif(p->>'debut', ''), cur->>'debut')::timestamptz;
    fin := coalesce(nullif(p->>'fin', ''), cur->>'fin')::timestamptz;
  exception when others then raise exception 'Date invalide'; end;
  if deb is not null and fin is not null and fin <= deb then raise exception 'La fin doit suivre le début'; end if;
  if fin is not null and deb is not null and fin - deb > interval '120 days' then raise exception 'Une saison dure 120 jours au plus'; end if;
  bt := coalesce(nullif(p->>'booster', ''), cur->>'booster');
  if bt is not null and bt !~ '^[a-z0-9_]{2,30}$' then raise exception 'Type de booster invalide'; end if;
  if p ? 'mots' then
    if jsonb_typeof(p->'mots') <> 'array' or jsonb_array_length(p->'mots') > 20 then raise exception 'Vingt mots au plus'; end if;
    select coalesce(jsonb_agg(lower(btrim(v))), '[]'::jsonb) into mots from jsonb_array_elements_text(p->'mots') v where char_length(btrim(v)) between 2 and 30;
  else
    mots := coalesce(cur->'mots', '[]'::jsonb);
  end if;
  nv := cur || jsonb_build_object('actif', on_, 'debut', deb, 'fin', fin, 'booster', bt, 'mots', mots);
  insert into hg_settings (key, value) values ('saisons', jsonb_build_object('worlds', nv))
    on conflict (key) do update set value = hg_settings.value || jsonb_build_object('worlds', nv), updated_at = now();
  update hg_themes set active = on_,
      start_md = case when on_ and deb is not null then to_char(deb at time zone 'Europe/Zurich', 'MM-DD') else start_md end,
      end_md = case when on_ and fin is not null then to_char((fin - interval '1 second') at time zone 'Europe/Zurich', 'MM-DD') else end_md end,
      updated_at = now()
    where slug = coalesce(nv->>'theme', 'worlds');
  if bt is not null then update hg_booster_types set active = on_, updated_at = now() where id = bt; end if;
  if not on_ then n := hg_saison_badges(null); end if;
  perform hg_admin_audit('saison_worlds', null, case when on_ then 'allumee' else 'eteinte' end,
    jsonb_build_object('debut', deb, 'fin', fin, 'booster', bt, 'badges', n));
  return hg_saison_worlds_cfg() || jsonb_build_object('badges', n);
end $$;

-- Staff « themes » : réglages et état de la saison (pour l'écran d'admin).
create or replace function public.hg_saison_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('themes') then raise exception 'Réservé au Staff « Thèmes et événements »'; end if;
  return jsonb_build_object('worlds', hg_saison_worlds_cfg(),
    'theme', (select jsonb_build_object('active', active, 'start_md', start_md, 'end_md', end_md) from hg_themes where slug = 'worlds'),
    'booster_types', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'active', active) order by sort) from hg_booster_types), '[]'::jsonb),
    'pronos_ready', to_regclass('public.hg_pick_items') is not null,
    'quests', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'label', label, 'target', target, 'reward', reward)) from hg_card_quests_templates
      where code in (select jsonb_array_elements_text(hg_saison_worlds_cfg()->'quetes'))), '[]'::jsonb));
end $$;

-- =====================================================================
-- 4. T4 — Anniversaire du serveur
-- =====================================================================
-- Série dédiée, inactive (jamais tirée par un booster : hg_card_pick exige une série active) et « hors boosters »
-- si la colonne de la migration 080 existe.
insert into public.hg_card_sets (code, name, description, active, sort)
values ('anniversaires', 'Anniversaires du gang', 'Une carte datée par anniversaire du serveur, offerte à chaque membre. Jamais dans un booster.', false, 960)
on conflict (code) do nothing;
do $s$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hg_card_sets' and column_name = 'booster_scope') then
    execute 'update public.hg_card_sets set booster_scope = ''hors_boosters'' where code = ''anniversaires'' and booster_scope is null';
  end if;
end $s$;

-- Carte du 8 janvier 2027 (5 ans) : légendaire, ni fabricable ni échangeable.
do $card$
declare s uuid; cid uuid;
begin
  select id into s from public.hg_card_sets where code = 'anniversaires';
  insert into public.hg_cards (set_id, number, name, family, rarity, image_url, flavor, can_shiny, tradeable, craftable)
  values (s, 5, '8 janvier 2027 · 5 ans', 'moment', 'legendaire', 'assets/cards/anniversaire/2027.svg',
    'Cinq ans de soirées, de Worldle et de Secret Santa.', false, false, false)
  on conflict (set_id, number) do nothing;
  select id into cid from public.hg_cards where set_id = s and number = 5;
  update public.hg_settings set value = jsonb_set(value, '{anniversaire,cartes}',
      coalesce(value#>'{anniversaire,cartes}', '{}'::jsonb) || jsonb_build_object('2027', cid))
    where key = 'saisons' and coalesce(value#>>'{anniversaire,cartes,2027}', '') = '';
end $card$;

-- Type de booster « Anniversaire » : pas en vente (active = false), il n'arrive que par hg_anniv_claim.
do $bt$
declare cr jsonb; ord int;
begin
  select rates into cr from public.hg_booster_types where id = 'classique';
  cr := coalesce(cr, '{"commune":60,"peu_commune":25,"rare":10,"epique":4,"legendaire":0.88,"mythique":0.1,"identite":0.02}'::jsonb);
  select coalesce(max(sort), 0) into ord from public.hg_booster_types;
  insert into public.hg_booster_types (id, name, price, size, rates, shiny_rate, pity_epique, pool, weekly_limit, style, description, active, sort)
  values ('anniversaire', 'Anniversaire', 0, 5, cr, 10, 0, 'tous', null, 'cart--dore',
    'Offert pour l’anniversaire du gang. Ne s’achète pas.', false, ord + 40)
  on conflict (id) do nothing;
exception when check_violation then
  insert into public.hg_booster_types (id, name, price, size, rates, shiny_rate, pity_epique, pool, weekly_limit, description, active, sort)
  values ('anniversaire', 'Anniversaire', 0, 5, cr, 10, 0, 'tous', null, 'Offert pour l’anniversaire du gang. Ne s’achète pas.', false, ord + 40)
  on conflict (id) do nothing;
end $bt$;

-- Moments « à retenir » pour la rétrospective : écrits par hg_moment_retro_set seulement (figés pour le client).
alter table public.hg_moments add column if not exists retro boolean default false; -- null = non retenu (figée pour le client : null à l'insertion)
do $t$
begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_moments_retro_col' and tgrelid = 'public.hg_moments'::regclass) then
    create trigger hg_moments_retro_col before insert or update on public.hg_moments
      for each row execute function public.hg_freeze_service_cols('retro');
  end if;
end $t$;
comment on column public.hg_moments.retro is 'T4 (migration 096) : moment retenu par le Staff pour la rétrospective de l''anniversaire. Écrit par hg_moment_retro_set.';

-- Anniversaire : date (eggs.anniversaire_gang, défaut 01-08), année de création, fenêtre (jours avant et après, 0 à 3).
create or replace function public.hg_anniv_info()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare md text := coalesce(nullif((select value->>'anniversaire_gang' from hg_settings where key = 'eggs'), ''), '01-08');
  c jsonb := coalesce(hg_saisons_cfg()->'anniversaire', '{}'::jsonb); z date := (hg_season_now() at time zone 'Europe/Zurich')::date;
  y0 int; f int; d date; best date;
begin
  if md !~ '^\d{2}-\d{2}$' then md := '01-08'; end if;
  y0 := least(greatest(coalesce((c->>'annee')::int, 2022), 2000), 2100);
  f := least(greatest(coalesce((c->>'fenetre')::int, 1), 0), 3);
  -- Anniversaire le plus proche (année en cours, précédente ou suivante : la fenêtre peut chevaucher le nouvel an).
  select x into best from (select make_date(yy, split_part(md, '-', 1)::int, split_part(md, '-', 2)::int) x
    from generate_series(extract(year from z)::int - 1, extract(year from z)::int + 1) yy) s order by abs(x - z) limit 1;
  return jsonb_build_object('date', best, 'age', extract(year from best)::int - y0, 'annee', y0, 'fenetre_jours', f,
    'dans_fenetre', abs(best - z) <= f and extract(year from best)::int > y0, 'aujourdhui', best = z,
    'debut', best - f, 'fin', best + f,
    'carte', nullif(c#>>array['cartes', extract(year from best)::text], ''),
    'booster', case when coalesce(c->>'booster', '') ~ '^[a-z0-9_]{2,30}$' then c->>'booster' else 'anniversaire' end);
end $$;

-- Secrets cachés (062, 072) : en plus, l'âge du gang et la fenêtre de l'anniversaire (jamais la date brute).
create or replace function public.hg_eggs_public()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not hg_is_member() then '{}'::jsonb else jsonb_build_object(
    'recompenses', coalesce(s.value->'recompenses', '{}'::jsonb),
    'anniversaire_aujourdhui', coalesce(s.value->>'anniversaire_gang', '') = to_char(now() at time zone 'Europe/Zurich', 'MM-DD'),
    'anniversaire_age', (a->>'age')::int,
    'anniversaire_fenetre', coalesce((a->>'dans_fenetre')::boolean, false))
  end
  from (select (select value from hg_settings where key = 'eggs') as value, hg_anniv_info() as a) s $$;

-- Membre : état du cadeau d'anniversaire (pour la bannière).
create or replace function public.hg_anniv_me()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a jsonb := hg_anniv_info(); y text; k record;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  y := extract(year from (a->>'date')::date)::text;
  if a->>'carte' is not null then
    select c.id, c.name, c.rarity, c.family, c.image_url, c.flavor, c.number, s.name as set_name into k
      from hg_cards c join hg_card_sets s on s.id = c.set_id where c.id = (a->>'carte')::uuid;
  end if;
  return jsonb_build_object('age', a->'age', 'date', a->'date', 'fin', a->'fin', 'dans_fenetre', a->'dans_fenetre',
    'aujourdhui', a->'aujourdhui', 'annee', a->'annee',
    'claimed', exists (select 1 from hg_wallet_log where user_id = auth.uid() and reason = 'anniversaire_gang' and ref = 'anniv:' || y),
    'card', case when k.id is not null then to_jsonb(k) end,
    'booster', (select jsonb_build_object('id', id, 'name', name, 'size', size) from hg_booster_types where id = a->>'booster'));
end $$;

-- Membre : réclame son cadeau d'anniversaire (une fois par an, dans la fenêtre) : un booster « Anniversaire » dans son
-- stock et un exemplaire de la carte datée. Idempotence : ligne hg_wallet_log (delta 0, ref « anniv:<année> »).
create or replace function public.hg_anniv_claim()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); a jsonb := hg_anniv_info(); y text; n int; cid bigint; card_ok boolean := false;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if not coalesce((a->>'dans_fenetre')::boolean, false) then raise exception 'Le cadeau d''anniversaire s''ouvre autour du jour J'; end if;
  y := extract(year from (a->>'date')::date)::text;
  perform hg_eco_lock(me);
  insert into hg_wallets (user_id) values (me) on conflict do nothing;
  perform 1 from hg_wallets where user_id = me for update;
  insert into hg_wallet_log (user_id, delta, reason, ref) values (me, 0, 'anniversaire_gang', 'anniv:' || y) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('already', true); end if;
  if exists (select 1 from hg_booster_types where id = a->>'booster') then
    insert into hg_booster_stock (user_id, type_id, qty) values (me, a->>'booster', 1)
      on conflict (user_id, type_id) do update set qty = hg_booster_stock.qty + 1;
  end if;
  if a->>'carte' is not null then
    begin
      cid := hg_card_give(me, (a->>'carte')::uuid, false, 'evenement');
      card_ok := true;
    exception when others then
      raise warning 'hg_anniv_claim : carte non donnée (%)', sqlerrm;
    end;
  end if;
  return jsonb_build_object('already', false, 'booster', a->>'booster', 'card', card_ok, 'copy_id', cid, 'age', a->'age');
end $$;

-- Membre : rétrospective de toute la vie du serveur (comme hg_year_recap, mais par année depuis la création).
-- Aucun membre nommé : seulement des chiffres et les moments retenus par le Staff.
create or replace function public.hg_gang_retro()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a jsonb := hg_anniv_info(); y0 int; y1 int; ph text := hg_saisons_cfg()#>>'{anniversaire,photo_id}'; fam jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  y0 := (a->>'annee')::int; y1 := extract(year from (hg_season_now() at time zone 'Europe/Zurich'))::int;
  if ph ~ '^[0-9a-f-]{36}$' then
    select jsonb_build_object('path', p.path, 'caption', p.caption) into fam from hg_photos p where p.id = ph::uuid;
  end if;
  return jsonb_build_object('age', a->'age', 'annee', y0,
    'years', (select jsonb_agg(jsonb_build_object('year', yy,
        'sorties', (select count(*) from hg_events e where extract(year from e.starts_at at time zone 'Europe/Zurich') = yy and e.starts_at <= now()),
        'photos', (select count(*) from hg_photos p where extract(year from p.created_at at time zone 'Europe/Zurich') = yy),
        'souvenirs', (select count(*) from hg_moments m where extract(year from m.happened_on) = yy),
        'secret_santa', (select count(*) from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id where e.year = yy),
        'cartes', (select coalesce(sum(o.cards), 0) from hg_booster_opens o where extract(year from o.created_at at time zone 'Europe/Zurich') = yy),
        'moments', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'happened_on', m.happened_on, 'image_path', m.image_path) order by m.happened_on)
          from (select * from hg_moments m where coalesce(m.retro, false) and extract(year from m.happened_on) = yy order by m.happened_on limit 3) m), '[]'::jsonb)) order by yy)
      from generate_series(y0, y1) yy),
    'totals', jsonb_build_object(
      'sorties', (select count(*) from hg_events where starts_at <= now()),
      'photos', (select count(*) from hg_photos),
      'souvenirs', (select count(*) from hg_moments),
      'secret_santa', (select count(*) from hg_ss_editions where status in ('revelation', 'termine')),
      'cartes', (select coalesce(sum(cards), 0) from hg_booster_opens),
      'membres', hg_saisons_gang_size()),
    'photo_famille', fam);
end $$;

-- Staff « souvenirs » : retient (ou non) un moment pour la rétrospective. Journalisé.
create or replace function public.hg_moment_retro_set(p_moment uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « Souvenirs »'; end if;
  update hg_moments set retro = coalesce(p_on, false) where id = p_moment;
  if not found then raise exception 'Souvenir introuvable'; end if;
  perform hg_admin_audit('moment_retro', null, p_moment::text, jsonb_build_object('retenu', coalesce(p_on, false)));
  return coalesce(p_on, false);
end $$;

-- Staff « themes » : réglages de l'anniversaire (année de création, fenêtre, carte de l'année, photo de famille).
create or replace function public.hg_anniv_admin(p jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur jsonb := coalesce(hg_saisons_cfg()->'anniversaire', '{}'::jsonb); nv jsonb; y int; f int; cy text; card uuid; ph uuid;
begin
  if not hg_has_perm('themes') then raise exception 'Réservé au Staff « Thèmes et événements »'; end if;
  if p is not null then
    begin
      y := coalesce(nullif(p->>'annee', '')::int, (cur->>'annee')::int, 2022);
      f := coalesce(nullif(p->>'fenetre', '')::int, (cur->>'fenetre')::int, 1);
      card := nullif(p->>'carte', '')::uuid; ph := nullif(p->>'photo_id', '')::uuid;
    exception when others then raise exception 'Valeur invalide'; end;
    if y < 2000 or y > 2100 then raise exception 'Année de création invalide'; end if;
    if f < 0 or f > 3 then raise exception 'Fenêtre : de 0 à 3 jours'; end if;
    if card is not null and not exists (select 1 from hg_cards where id = card) then raise exception 'Carte introuvable'; end if;
    if ph is not null and not exists (select 1 from hg_photos where id = ph) then raise exception 'Photo introuvable'; end if;
    cy := coalesce(nullif(p->>'carte_annee', ''), extract(year from (hg_anniv_info()->>'date')::date)::text);
    if cy !~ '^\d{4}$' then raise exception 'Année de la carte invalide'; end if;
    nv := cur || jsonb_build_object('annee', y, 'fenetre', f)
      || case when p ? 'photo_id' then jsonb_build_object('photo_id', ph) else '{}'::jsonb end
      || case when p ? 'carte' then jsonb_build_object('cartes', coalesce(cur->'cartes', '{}'::jsonb) || jsonb_build_object(cy, card)) else '{}'::jsonb end;
    insert into hg_settings (key, value) values ('saisons', jsonb_build_object('anniversaire', nv))
      on conflict (key) do update set value = hg_settings.value || jsonb_build_object('anniversaire', nv), updated_at = now();
    perform hg_admin_audit('anniversaire_gang', null, cy, jsonb_build_object('annee', y, 'fenetre', f, 'carte', card));
  end if;
  return jsonb_build_object('info', hg_anniv_info(), 'cfg', coalesce(hg_saisons_cfg()->'anniversaire', '{}'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'number', c.number) order by c.number)
      from hg_cards c join hg_card_sets s on s.id = c.set_id where s.code = 'anniversaires'), '[]'::jsonb),
    'claims', (select count(*) from hg_wallet_log where reason = 'anniversaire_gang'
      and ref = 'anniv:' || extract(year from (hg_anniv_info()->>'date')::date)::text),
    'moments', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'happened_on', m.happened_on, 'retro', coalesce(m.retro, false)) order by m.happened_on desc)
      from (select * from hg_moments order by coalesce(retro, false) desc, happened_on desc limit 200) m), '[]'::jsonb));
end $$;

-- =====================================================================
-- 5. Bot (hg-cron) : messages saisonniers à envoyer, réservés AVANT l'envoi (même table que la migration 084).
-- =====================================================================
create table if not exists public.hg_bot_runs (
  task text not null check (task ~ '^[a-z_]{2,40}$'),
  period text not null check (char_length(period) between 1 and 40),
  sent_at timestamptz not null default now(),
  message_ids jsonb,
  primary key (task, period)
);
alter table public.hg_bot_runs enable row level security;
revoke all on public.hg_bot_runs from public, anon, authenticated;

-- Clé service : liste des messages saisonniers dus maintenant, déjà réservés (une seule fois par période).
-- Chaque élément : { task, period, type (salon : dyn, draw ou birthday), title, body, page }.
create or replace function public.hg_saisons_bot_due()
returns jsonb language plpgsql security definer set search_path = public as $$
declare z timestamp := now() at time zone 'Europe/Zurich'; out jsonb := '[]'::jsonb; y int; d int; r record; a jsonb; n int;
  bot jsonb := coalesce((select value from hg_settings where key = 'bot'), '{}'::jsonb);
begin
  if not hg_saisons_is_service() then raise exception 'Réservé au service'; end if;
  -- T1 : la case du jour (à 8 h), puis les cases collectives qui atteignent leur seuil.
  if extract(month from z) = 12 and (hg_advent_cfg()->>'actif')::boolean then
    y := extract(year from z)::int; d := extract(day from z)::int;
    if d <= 24 and extract(hour from z) >= 8 and exists (select 1 from hg_advent_days where year = y and day = d) then
      insert into hg_bot_runs (task, period) values ('avent_case', y || '-' || d) on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        update hg_advent_days set announced_at = now() where year = y and day = d;
        out := out || jsonb_build_array(jsonb_build_object('task', 'avent_case', 'period', y || '-' || d, 'type', 'dyn',
          'title', 'Calendrier de l’Avent : la case du ' || d || ' est ouverte',
          'body', 'Une nouvelle case t’attend sur l’accueil du site. Une case oubliée reste ouvrable jusqu’au 31 décembre.', 'page', 'accueil.html#avent'));
      end if;
    end if;
    for r in select ad.day, ad.group_target from hg_advent_days ad where ad.year = y and ad.group_target is not null and ad.day <= least(d, 24)
      and ad.group_announced_at is null
      and (select count(*) from hg_advent_opens o where o.year = y and o.day = ad.day) >= hg_advent_target(ad.group_target) loop
      insert into hg_bot_runs (task, period) values ('avent_groupe', y || '-' || r.day) on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        update hg_advent_days set group_announced_at = now() where year = y and day = r.day;
        out := out || jsonb_build_array(jsonb_build_object('task', 'avent_groupe', 'period', y || '-' || r.day, 'type', 'dyn',
          'title', 'Bonus du gang débloqué pour le ' || r.day || ' décembre',
          'body', 'Assez de membres ont ouvert la case : chacun peut réclamer le bonus sur l’accueil.', 'page', 'accueil.html#avent'));
      end if;
    end loop;
  end if;
  -- T2 : tout le monde a reçu (une fois) ; rappel 1 h avant la soirée ; tour de passage si bot.notify.unwrap = true.
  for r in select e.* from hg_ss_editions e where e.status in ('envoi', 'revelation') and e.unwrap_event_id is not null loop
    if r.unwrap_all_received_at is null and r.status = 'envoi'
       and exists (select 1 from hg_ss_participants p where p.edition_id = r.id)
       and not exists (select 1 from hg_ss_participants p where p.edition_id = r.id and p.received_at is null) then
      update hg_ss_editions set unwrap_all_received_at = now() where id = r.id and unwrap_all_received_at is null;
      if found then
        out := out || jsonb_build_array(jsonb_build_object('task', 'deballage_recus', 'period', r.id::text, 'type', 'draw',
          'title', 'Tout le monde a reçu son cadeau !', 'body', 'Vote pour la date de la soirée déballage sur la page Secret Santa.',
          'page', 'secret-santa.html#deballage'));
      end if;
    end if;
    if r.unwrap_reminder_at is null and exists (select 1 from hg_events ev where ev.id = r.unwrap_event_id
         and ev.starts_at > now() and ev.starts_at <= now() + interval '1 hour') then
      update hg_ss_editions set unwrap_reminder_at = now() where id = r.id and unwrap_reminder_at is null;
      if found then
        out := out || jsonb_build_array(jsonb_build_object('task', 'deballage_rappel', 'period', r.id::text, 'type', 'draw',
          'title', 'Soirée déballage dans moins d’une heure', 'body', 'Prépare ton cadeau (et cache l’étiquette du colis avant la photo).',
          'page', 'secret-santa.html#deballage'));
      end if;
    end if;
    if coalesce((bot#>>'{notify,unwrap}')::boolean, false) then
      for a in select jsonb_build_object('user_id', u.user_id, 'pseudo', p.pseudo, 'started_at', u.started_at) from hg_ss_unwrap u
          join hg_profiles p on p.id = u.user_id where u.edition_id = r.id and u.status = 'en_cours' and u.started_at > now() - interval '15 minutes' loop
        insert into hg_bot_runs (task, period) values ('deballage_tour', left(r.id::text || ':' || (a->>'user_id') || ':' || extract(epoch from (a->>'started_at')::timestamptz)::bigint, 40))
          on conflict do nothing;
        get diagnostics n = row_count;
        if n > 0 then
          out := out || jsonb_build_array(jsonb_build_object('task', 'deballage_tour', 'period', left(r.id::text || ':' || (a->>'user_id') || ':' || extract(epoch from (a->>'started_at')::timestamptz)::bigint, 40), 'type', 'draw',
            'title', 'C’est au tour de ' || (a->>'pseudo'), 'body', 'La soirée déballage continue : suis-la en direct sur le site.', 'page', 'secret-santa.html#deballage'));
        end if;
      end loop;
    end if;
  end loop;
  -- T4 : le jour de l'anniversaire, à 9 h, « Le gang a N ans aujourd'hui » avec le lien de la rétrospective.
  a := hg_anniv_info();
  if coalesce((a->>'aujourdhui')::boolean, false) and extract(hour from z) >= 9 and (a->>'age')::int >= 1 then
    insert into hg_bot_runs (task, period) values ('anniv_gang', extract(year from z)::text) on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 then
      out := out || jsonb_build_array(jsonb_build_object('task', 'anniv_gang', 'period', extract(year from z)::text, 'type', 'birthday',
        'title', 'Le gang a ' || (a->>'age') || ' ans aujourd’hui !', 'body', 'Ton cadeau t’attend sur l’accueil, et la rétrospective raconte toutes ces années.',
        'page', 'recap.html?retro=1'));
    end if;
  end if;
  return out;
end $$;

-- Clé service : libère une réservation (envoi en échec dans tous les salons) pour un nouvel essai.
create or replace function public.hg_saisons_bot_release(p_task text, p_period text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not hg_saisons_is_service() then raise exception 'Réservé au service'; end if;
  if p_task = 'deballage_recus' then
    update hg_ss_editions set unwrap_all_received_at = null where id::text = p_period;
  elsif p_task = 'deballage_rappel' then
    update hg_ss_editions set unwrap_reminder_at = null where id::text = p_period;
  else
    execute 'de' || 'lete from public.hg_bot_runs where task = $1 and period = $2' using p_task, p_period;
    if p_task = 'avent_case' then
      update hg_advent_days set announced_at = null where year::text || '-' || day::text = p_period;
    elsif p_task = 'avent_groupe' then
      update hg_advent_days set group_announced_at = null where year::text || '-' || day::text = p_period;
    end if;
  end if;
end $$;

-- =====================================================================
-- 6. Droits
-- =====================================================================
do $g$
declare f text;
begin
  foreach f in array array[
    'public.hg_saisons_cfg()', 'public.hg_season_now()', 'public.hg_saisons_is_service()', 'public.hg_saisons_test_date(timestamptz)', 'public.hg_saisons_gang_size()',
    'public.hg_advent_cfg()', 'public.hg_advent_clock()', 'public.hg_advent_target(int)', 'public.hg_advent_content(int, int, uuid)',
    'public.hg_advent_me()', 'public.hg_advent_open(int)', 'public.hg_advent_answer(int, jsonb)', 'public.hg_advent_claim_group(int)',
    'public.hg_advent_admin(int)', 'public.hg_advent_day_save(int, int, jsonb)', 'public.hg_advent_autofill(int)',
    'public.hg_ss_unwrap_state(uuid)', 'public.hg_ss_unwrap_setup(uuid, text, timestamptz[], int)', 'public.hg_ss_unwrap_fix_date(uuid, uuid)',
    'public.hg_ss_unwrap_draw(uuid, boolean)', 'public.hg_ss_unwrap_next(uuid, text, uuid)', 'public.hg_ss_unwrap_reveal(uuid)',
    'public.hg_saison_worlds_cfg()', 'public.hg_saison_metric(text, uuid, timestamptz, timestamptz)', 'public.hg_card_quests_pick(date)',
    'public.hg_saison_badges(uuid)', 'public.hg_saison_state()', 'public.hg_saison_set(text, jsonb)', 'public.hg_saison_admin()',
    'public.hg_anniv_info()', 'public.hg_eggs_public()', 'public.hg_anniv_me()', 'public.hg_anniv_claim()', 'public.hg_gang_retro()',
    'public.hg_moment_retro_set(uuid, boolean)', 'public.hg_anniv_admin(jsonb)',
    'public.hg_saisons_bot_due()', 'public.hg_saisons_bot_release(text, text)'] loop
    execute 'revoke execute on function ' || f || ' from public, anon';
  end loop;
  -- Fonctions internes : pas d'appel direct par un client.
  foreach f in array array['public.hg_saisons_cfg()', 'public.hg_saisons_gang_size()', 'public.hg_advent_cfg()',
    'public.hg_advent_target(int)', 'public.hg_advent_content(int, int, uuid)', 'public.hg_saison_worlds_cfg()',
    'public.hg_saison_metric(text, uuid, timestamptz, timestamptz)', 'public.hg_anniv_info()', 'public.hg_card_quests_pick(date)',
    'public.hg_saisons_bot_due()', 'public.hg_saisons_bot_release(text, text)'] loop
    execute 'revoke execute on function ' || f || ' from authenticated';
  end loop;
  foreach f in array array['public.hg_saisons_bot_due()', 'public.hg_saisons_bot_release(text, text)'] loop
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
  -- Fonctions appelées par les membres ou le Staff (contrôle des droits à l'intérieur).
  foreach f in array array['public.hg_season_now()', 'public.hg_saisons_test_date(timestamptz)', 'public.hg_advent_clock()',
    'public.hg_advent_me()', 'public.hg_advent_open(int)', 'public.hg_advent_answer(int, jsonb)', 'public.hg_advent_claim_group(int)',
    'public.hg_advent_admin(int)', 'public.hg_advent_day_save(int, int, jsonb)', 'public.hg_advent_autofill(int)',
    'public.hg_ss_unwrap_state(uuid)', 'public.hg_ss_unwrap_setup(uuid, text, timestamptz[], int)', 'public.hg_ss_unwrap_fix_date(uuid, uuid)',
    'public.hg_ss_unwrap_draw(uuid, boolean)', 'public.hg_ss_unwrap_next(uuid, text, uuid)', 'public.hg_ss_unwrap_reveal(uuid)',
    'public.hg_saison_badges(uuid)', 'public.hg_saison_state()', 'public.hg_saison_set(text, jsonb)', 'public.hg_saison_admin()',
    'public.hg_eggs_public()', 'public.hg_anniv_me()', 'public.hg_anniv_claim()', 'public.hg_gang_retro()',
    'public.hg_moment_retro_set(uuid, boolean)', 'public.hg_anniv_admin(jsonb)', 'public.hg_saisons_is_service()'] loop
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $g$;
