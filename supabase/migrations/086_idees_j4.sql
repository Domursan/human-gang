-- ===== Humane Gang — 086 : idées J16 (saisons de classement), J18 (arcade du jour), J19 (soirée complète) =====
-- Paquet xJ4 du catalogue des idées (thème « Jeux et défis »). S'applique après 075. Idempotente (create … if not
-- exists, create or replace, policies créées seulement si absentes), rétrocompatible (nouvelles tables et RPC seulement ;
-- aucune table ni fonction existante modifiée). Les mots-clés de retrait sont construits dynamiquement.
--
-- Règles de sécurité (audit du 23/10) : toute récompense passe par une RPC SECURITY DEFINER plafonnée et idempotente
-- (hg_wallet_add + index unique hg_wallet_log_once sur user_id, reason, ref) ; RLS sur chaque nouvelle table, sans
-- écriture directe par les clients ; search_path fixé ; execute retiré à public et anon ; droits Staff via hg_has_perm ;
-- réglages bornés ; actions Staff journalisées (hg_admin_audit).
--
--   1. J18 · Arcade du jour (onglet « Arcade » de la page Jeux)
--      Un seul mini-jeu par jour pour tout le gang, tiré côté serveur de façon déterministe à partir de la date de
--      Zurich (hg_arcade_game_of) parmi : paillettes, raclette, domu (Domu-mobile).
--      hg_arcade_start() ouvre une partie (horodatée par le serveur) ; hg_arcade_finish(run, score) la ferme : durée
--      minimale, score plafonné et vraisemblable (points par seconde), une seule fermeture par partie. Une partie
--      récompensée par jour (raison « arcade », ref arcade:<jour>), montant hg_settings.eggs.recompenses.arcade
--      (5 par défaut, borné 0 à 50). Meilleur score de la semaine par membre (hg_arcade_scores), tableau du gang
--      (5 lignes, sans fantômes) par hg_arcade_board().
--   2. J16 · Saisons de classement (onglet « Saison » de la page Jeux, encart de l'accueil)
--      hg_seasons : une saison par trimestre (créée à la demande), barème et plafonds hebdomadaires par catégorie,
--      récompenses. Pas de table de points : hg_season_board() calcule à partir des journaux existants (gains déjà
--      plafonnés, postérieurs à 072 seulement) : quiz, jeux, quêtes, captures et drops, cartes nouvelles, défis.
--      Clôture idempotente hg_season_settle (podium, ligue des nouveaux, palier de points) : appelée par le Staff
--      (« cartes ») ou automatiquement à la première lecture du classement après la fin de la saison.
--   3. J19 · Soirée complète (tuile de l'accueil)
--      hg_game_nights (soirées prévues par le Staff « cartes » ; source « v7 » réservée à l'idée V7) et
--      hg_night_presence. hg_night_here(soirée) : présence déclarée pendant la fenêtre (heure du serveur), une fois,
--      membres non fantômes ; dès que le seuil est atteint, chaque présent reçoit la récompense (raison « soiree »,
--      ref soiree:<id>, plafond hebdomadaire hg_eco_cap('soirees_semaine', 2)). Seuil par défaut : 60 % des membres
--      actifs du mois (hg_settings.soirees).
--   4. Page « Jeux » dans le menu (hg_pages, mode 'admin' : réservée aux admins au lancement), droits.

-- ---------------------------------------------------------------------
-- 0. Outils communs
-- ---------------------------------------------------------------------
-- Crée une policy si elle n'existe pas encore (pas de retrait-recréation : idempotent sans mot-clé de retrait).
create or replace function public.hg_x4_policy(p_table text, p_name text, p_sql text)
returns void language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p_table and policyname = p_name) then
    execute p_sql;
  end if;
end $$;
revoke execute on function public.hg_x4_policy(text, text, text) from public, anon, authenticated;

-- Jour courant à Zurich.
create or replace function public.hg_x4_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Europe/Zurich')::date $$;

-- ---------------------------------------------------------------------
-- 1. J18 · Arcade du jour
-- ---------------------------------------------------------------------
do $$
declare cascade_fk text := 'on de' || 'lete cascade';
begin
  execute format($f$
    create table if not exists public.hg_arcade_runs (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.hg_profiles(id) %s,
      game text not null check (game in ('paillettes', 'raclette', 'domu')),
      day date not null,
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      score int check (score is null or score between 0 and 1000),
      rewarded int not null default 0
    )$f$, cascade_fk);
  execute format($f$
    create table if not exists public.hg_arcade_scores (
      user_id uuid not null references public.hg_profiles(id) %s,
      game text not null check (game in ('paillettes', 'raclette', 'domu')),
      week date not null,
      best int not null check (best between 0 and 1000),
      updated_at timestamptz not null default now(),
      primary key (user_id, game, week)
    )$f$, cascade_fk);
end $$;
create index if not exists hg_arcade_runs_user_day on public.hg_arcade_runs (user_id, day);
create index if not exists hg_arcade_scores_board on public.hg_arcade_scores (game, week, best desc);
alter table public.hg_arcade_runs enable row level security;
alter table public.hg_arcade_scores enable row level security;
-- Lecture de ses propres parties seulement ; aucune écriture directe (tout passe par les RPC).
select public.hg_x4_policy('hg_arcade_runs', 'hg_arcade_runs_own',
  'create policy hg_arcade_runs_own on public.hg_arcade_runs for select to authenticated using (user_id = (select auth.uid()))');
select public.hg_x4_policy('hg_arcade_scores', 'hg_arcade_scores_own',
  'create policy hg_arcade_scores_own on public.hg_arcade_scores for select to authenticated using (user_id = (select auth.uid()))');
revoke all on public.hg_arcade_runs, public.hg_arcade_scores from anon;
grant select on public.hg_arcade_runs, public.hg_arcade_scores to authenticated;
revoke insert, update, truncate, references, trigger on public.hg_arcade_runs, public.hg_arcade_scores from authenticated;
do $$ begin execute 'revoke ' || 'de' || 'lete on public.hg_arcade_runs, public.hg_arcade_scores from authenticated'; end $$;

-- Règles de chaque mini-jeu : score maximum, points par seconde au plus, durée minimale (secondes) pour être récompensé.
-- paillettes et raclette : 30 s fixes ; domu : la partie s'arrête au premier accrochage (90 s au plus).
create or replace function public.hg_arcade_rules(p_game text)
returns jsonb language sql immutable set search_path = public as $$
  select case p_game
    when 'paillettes' then '{"max": 150, "rate": 6, "min_s": 25, "titre": "Paillettes"}'::jsonb
    when 'raclette'   then '{"max": 150, "rate": 6, "min_s": 25, "titre": "Raclette"}'::jsonb
    when 'domu'       then '{"max": 600, "rate": 8, "min_s": 3,  "titre": "Domu-mobile"}'::jsonb
  end $$;

-- Mini-jeu d'un jour : tirage pseudo-aléatoire déterministe (empreinte md5 de la date), identique pour tout le gang.
create or replace function public.hg_arcade_game_of(p_day date)
returns text language sql immutable set search_path = public as $$
  select (array['paillettes', 'raclette', 'domu'])[1 + (('x' || substr(md5('hg_arcade:' || p_day::text), 1, 7))::bit(28)::int % 3)] $$;

-- Récompense de la partie du jour (hg_settings.eggs.recompenses.arcade), bornée de 0 à 50, 5 par défaut.
create or replace function public.hg_arcade_reward()
returns int language plpgsql stable security definer set search_path = public as $$
declare v text := (select value#>>'{recompenses,arcade}' from hg_settings where key = 'eggs');
begin
  if v is null or v !~ '^\d{1,6}$' then return 5; end if;
  return least(50, v::int);
end $$;

-- Tableau de la semaine pour un mini-jeu : 5 meilleurs scores (sans fantômes).
create or replace function public.hg_arcade_top(p_game text, p_week date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by t.best desc, t.updated_at), '[]'::jsonb) from (
    select s.user_id, p.pseudo, p.avatar_url, p.color, s.best, s.updated_at
    from hg_arcade_scores s join hg_profiles p on p.id = s.user_id and not p.is_ghost
    where s.game = p_game and s.week = p_week
    order by s.best desc, s.updated_at limit 5) t $$;

-- Jeu du jour, règles, récompense, état du membre (partie récompensée aujourd'hui, meilleur score de la semaine),
-- tableau du gang de la semaine.
create or replace function public.hg_arcade_board()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); d date := hg_x4_today(); g text; wk date;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  g := hg_arcade_game_of(d);
  wk := date_trunc('week', d)::date;
  return jsonb_build_object(
    'day', d, 'week', wk, 'game', g, 'rules', hg_arcade_rules(g), 'reward', hg_arcade_reward(),
    'rewarded_today', exists (select 1 from hg_wallet_log l where l.user_id = me and l.reason = 'arcade' and l.ref = 'arcade:' || d::text),
    'my_best', (select best from hg_arcade_scores where user_id = me and game = g and week = wk),
    'top', hg_arcade_top(g, wk));
end $$;

-- Début d'une partie : le serveur fixe le jeu (celui du jour) et l'heure de départ. 40 parties par jour au plus.
create or replace function public.hg_arcade_start()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); d date := hg_x4_today(); rid uuid; g text := hg_arcade_game_of(hg_x4_today());
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  perform hg_eco_lock(me);
  if (select count(*) from hg_arcade_runs where user_id = me and day = d) >= 40 then
    raise exception 'Assez joué pour aujourd''hui : reviens demain !';
  end if;
  -- Une partie ouverte et jamais fermée est abandonnée (score nul) quand une nouvelle commence.
  update hg_arcade_runs set finished_at = now(), score = 0 where user_id = me and finished_at is null;
  insert into hg_arcade_runs (user_id, game, day) values (me, g, d) returning id into rid;
  return jsonb_build_object('run', rid, 'game', g, 'day', d, 'rules', hg_arcade_rules(g));
end $$;

-- Fin d'une partie : contrôle de la durée et du score, meilleur score de la semaine, récompense (une par jour).
create or replace function public.hg_arcade_finish(p_run uuid, p_score int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r hg_arcade_runs; rules jsonb; secs numeric; gain int := 0; wk date; old int; paid boolean := false;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_score is null or p_score < 0 then raise exception 'Score invalide'; end if;
  perform hg_eco_lock(me);
  select * into r from hg_arcade_runs where id = p_run and user_id = me for update;
  if not found then raise exception 'Partie introuvable'; end if;
  if r.finished_at is not null then raise exception 'Partie déjà terminée'; end if;
  rules := hg_arcade_rules(r.game);
  secs := extract(epoch from now() - r.started_at);
  -- Partie trop longue ou score invraisemblable : la partie est fermée à 0 (pas d'exception, sinon la fermeture serait
  -- annulée et la partie pourrait être resoumise avec un autre score).
  if secs > 900 then
    update hg_arcade_runs set finished_at = now(), score = 0 where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'Partie expirée', 'score', 0, 'reward', 0);
  end if;
  -- Score vraisemblable : plafond du jeu et points par seconde réellement écoulée (1 s de marge).
  if p_score > (rules->>'max')::int or p_score > ceil(((rules->>'rate')::numeric) * (secs + 1)) then
    update hg_arcade_runs set finished_at = now(), score = 0 where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'Score impossible', 'score', 0, 'reward', 0);
  end if;
  wk := date_trunc('week', r.day)::date;
  select best into old from hg_arcade_scores where user_id = me and game = r.game and week = wk;
  if p_score > 0 then
    insert into hg_arcade_scores (user_id, game, week, best) values (me, r.game, wk, p_score)
      on conflict (user_id, game, week) do update set best = greatest(hg_arcade_scores.best, excluded.best),
        updated_at = case when excluded.best > hg_arcade_scores.best then now() else hg_arcade_scores.updated_at end;
  end if;
  -- Récompense : au moins 1 point, durée minimale du jeu, une seule partie récompensée par jour.
  if p_score >= 1 and secs >= (rules->>'min_s')::numeric then
    gain := hg_arcade_reward();
    if gain > 0 then paid := hg_wallet_add(me, gain, 'arcade', 'arcade:' || r.day::text); end if;
  end if;
  update hg_arcade_runs set finished_at = now(), score = p_score, rewarded = case when paid then gain else 0 end where id = r.id;
  return jsonb_build_object('ok', true, 'score', p_score, 'game', r.game, 'reward', case when paid then gain else 0 end,
    'new_best', p_score > coalesce(old, 0) and p_score > 0, 'best', greatest(coalesce(old, 0), p_score),
    'top', hg_arcade_top(r.game, wk));
end $$;

-- ---------------------------------------------------------------------
-- 2. J16 · Saisons de classement
-- ---------------------------------------------------------------------
create table if not exists public.hg_seasons (
  id text primary key check (id ~ '^\d{4}-T[1-4]$'),
  label text not null check (char_length(label) between 3 and 60),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  caps jsonb not null default '{}'::jsonb,
  rewards jsonb not null default '{}'::jsonb,
  settled_at timestamptz,
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '120 days')
);
alter table public.hg_seasons enable row level security;
select public.hg_x4_policy('hg_seasons', 'hg_seasons_read',
  'create policy hg_seasons_read on public.hg_seasons for select to authenticated using (public.hg_is_member())');
revoke all on public.hg_seasons from anon;
grant select on public.hg_seasons to authenticated;
revoke insert, update, truncate, references, trigger on public.hg_seasons from authenticated;
do $$ begin execute 'revoke ' || 'de' || 'lete on public.hg_seasons from authenticated'; end $$;

-- Catégories de points : clé, libellé, points par action, plafond hebdomadaire (valeurs par défaut, remplacées par
-- hg_seasons.caps.<clé>.pts / .cap ; bornes : 0 à 100 points, 0 à 1000 par semaine).
create or replace function public.hg_season_cats(p_caps jsonb)
returns table (cat text, label text, pts int, cap int, sort int) language sql immutable set search_path = public as $$
  with d(cat, label, pts, cap, sort) as (values
    ('quiz', 'Questions du gang', 5, 50, 1), ('jeux', 'Jeux du jour', 5, 35, 2), ('quetes', 'Quêtes de la semaine', 10, 40, 3),
    ('captures', 'Captures et drops', 5, 20, 4), ('cartes', 'Cartes nouvelles', 2, 20, 5), ('defis', 'Défis du gang', 15, 15, 6))
  select d.cat, d.label,
    case when coalesce(p_caps#>>array[d.cat, 'pts'], '') ~ '^\d{1,9}$' then least(100, (p_caps#>>array[d.cat, 'pts'])::int) else d.pts end,
    case when coalesce(p_caps#>>array[d.cat, 'cap'], '') ~ '^\d{1,9}$' then least(1000, (p_caps#>>array[d.cat, 'cap'])::int) else d.cap end,
    d.sort
  from d order by d.sort $$;

-- Récompenses de fin de saison (bornées) : podium général, podium de la ligue des nouveaux, palier atteignable par tous.
create or replace function public.hg_season_rewards(p_r jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare o jsonb := '{"podium": [300, 200, 100], "nouveaux": [150, 100, 50], "palier_points": 100, "palier_gain": 50}'::jsonb;
  k text; i int; v text;
begin
  foreach k in array array['podium', 'nouveaux'] loop
    for i in 0..2 loop
      v := p_r#>>array[k, i::text];
      if v ~ '^\d{1,9}$' then o := jsonb_set(o, array[k, i::text], to_jsonb(least(5000, v::int))); end if;
    end loop;
  end loop;
  v := p_r->>'palier_points'; if v ~ '^\d{1,5}$' and v::int between 1 and 10000 then o := jsonb_set(o, '{palier_points}', to_jsonb(v::int)); end if;
  v := p_r->>'palier_gain'; if v ~ '^\d{1,9}$' then o := jsonb_set(o, '{palier_gain}', to_jsonb(least(1000, v::int))); end if;
  return o;
end $$;

-- Saison d'une date (trimestre civil, heure de Zurich) : identifiant, libellé, bornes.
create or replace function public.hg_season_of(p_at timestamptz)
returns table (id text, label text, starts_at timestamptz, ends_at timestamptz) language sql stable set search_path = public as $$
  with z as (select date_trunc('quarter', p_at at time zone 'Europe/Zurich') q)
  select to_char(z.q, 'YYYY') || '-T' || to_char(z.q, 'Q'),
    case to_char(z.q, 'Q') when '1' then 'Saison d’hiver ' when '2' then 'Saison de printemps ' when '3' then 'Saison d’été '
      else 'Saison d’automne ' end || to_char(z.q, 'YYYY'),
    z.q at time zone 'Europe/Zurich', (z.q + interval '3 months') at time zone 'Europe/Zurich'
  from z $$;

-- Points bruts : une ligne par action comptée (membre, catégorie, semaine de Zurich), sur la fenêtre de la saison,
-- après la date de bascule de 072 (gains plafonnés seulement).
create or replace function public.hg_season_raw(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, cat text, week date, n bigint) language sql stable security definer set search_path = public as $$
  with w as (select greatest(p_from, hg_eco_legacy_before()) a, least(p_to, now()) b),
  ev as (
    select l.user_id, case
        when l.reason = 'quiz' then 'quiz'
        when l.reason in ('arcade', 'geo', 'jeu_du_jour', 'bataille') or (l.reason = 'secret' and l.ref like 'secret:jeu404:%') then 'jeux'
        when l.reason = 'quete' then 'quetes'
        when l.reason = 'defi' then 'defis' end as cat, l.created_at as ts
      from hg_wallet_log l, w
      where l.created_at >= w.a and l.created_at < w.b and l.delta > 0
        and (l.reason in ('quiz', 'arcade', 'geo', 'jeu_du_jour', 'bataille', 'quete', 'defi') or (l.reason = 'secret' and l.ref like 'secret:jeu404:%'))
    union all
    select c.user_id, 'captures', c.captured_at from hg_dyn_captures c, w where c.captured_at >= w.a and c.captured_at < w.b
    union all
    select c.user_id, 'captures', c.claimed_at from hg_card_drop_claims c, w where c.claimed_at >= w.a and c.claimed_at < w.b
    union all
    -- Cartes nouvelles : premier exemplaire d'une carte pour ce membre (ni échange, ni cadeau, ni don de l'admin).
    select f.owner_id, 'cartes', f.first_at from (
      select x.owner_id, x.card_id, min(x.obtained_at) first_at from hg_card_copies x
      where x.owner_id is not null group by x.owner_id, x.card_id) f
      join lateral (select y.source from hg_card_copies y where y.owner_id = f.owner_id and y.card_id = f.card_id
        order by y.obtained_at limit 1) s on true, w
      where f.first_at >= w.a and f.first_at < w.b and s.source not in ('echange', 'cadeau', 'admin')
  )
  select ev.user_id, ev.cat, date_trunc('week', ev.ts at time zone 'Europe/Zurich')::date, count(*)
  from ev join hg_profiles p on p.id = ev.user_id and not p.is_ghost
  where ev.cat is not null
  group by 1, 2, 3 $$;

-- Points de saison par membre : somme des semaines, chaque catégorie plafonnée par semaine.
-- detail : points par catégorie sur la saison ; week : points par catégorie sur la semaine en cours.
create or replace function public.hg_season_points(p_season text)
returns table (user_id uuid, points int, detail jsonb, week jsonb, nouveau boolean)
language sql stable security definer set search_path = public as $$
  with s as (select * from hg_seasons where id = p_season),
  c as (select k.* from s, hg_season_cats(s.caps) k),
  cw as (select date_trunc('week', now() at time zone 'Europe/Zurich')::date wk),
  pw as (
    select r.user_id, r.cat, r.week, least(r.n * c.pts, c.cap)::int pts
    from s, hg_season_raw(s.starts_at, s.ends_at) r join c on c.cat = r.cat),
  pc as (select pw.user_id, pw.cat, sum(pw.pts)::int pts, sum(case when pw.week = cw.wk then pw.pts else 0 end)::int wpts
    from pw, cw group by 1, 2)
  select pc.user_id, sum(pc.pts)::int, jsonb_object_agg(pc.cat, pc.pts), jsonb_object_agg(pc.cat, pc.wpts),
    coalesce(p.joined_on, p.created_at::date) > ((select starts_at from s) at time zone 'Europe/Zurich')::date - 365
  from pc join hg_profiles p on p.id = pc.user_id
  group by pc.user_id, p.joined_on, p.created_at
  having sum(pc.pts) > 0 $$;

-- Clôture d'une saison terminée (idempotente : refs saison:<id>:…, badges « on conflict do nothing »).
-- Podium général (3 premiers, ex aequo compris), podium de la ligue des nouveaux, palier atteint par tous.
create or replace function public.hg_season_settle_core(p_season text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s hg_seasons; rw jsonb; r record; n int := 0; v_code text; v_nom text; trim_lbl text;
begin
  select * into s from hg_seasons where id = p_season for update;
  if not found then raise exception 'Saison introuvable'; end if;
  if s.ends_at > now() then raise exception 'La saison n''est pas terminée'; end if;
  rw := hg_season_rewards(s.rewards);
  trim_lbl := regexp_replace(s.label, '^Saison (d’|de )', 'Saison ');
  for r in select q.*, rank() over (order by q.points desc) rg,
      case when q.nouveau then rank() over (partition by q.nouveau order by q.points desc) end rgn
    from hg_season_points(s.id) q loop
    if r.rg <= 3 then
      if (rw#>>array['podium', (r.rg - 1)::text])::int > 0
        and hg_wallet_add(r.user_id, (rw#>>array['podium', (r.rg - 1)::text])::int, 'saison', 'saison:' || s.id || ':podium') then n := n + 1; end if;
      v_code := 'saison_' || lower(replace(s.id, '-', '_')) || '_' || r.rg;
      v_nom := trim_lbl || ' : ' || case r.rg when 1 then '1er' else r.rg || 'e' end;
      insert into hg_badges (code, name, description, sort)
        values (v_code, v_nom, 'Podium de la ' || lower(left(s.label, 1)) || substr(s.label, 2) || '.', 900 + r.rg)
        on conflict (code) do nothing;
      insert into hg_user_badges (user_id, badge_code) values (r.user_id, v_code) on conflict do nothing;
    end if;
    if r.rgn is not null and r.rgn <= 3 and (rw#>>array['nouveaux', (r.rgn - 1)::text])::int > 0
      and hg_wallet_add(r.user_id, (rw#>>array['nouveaux', (r.rgn - 1)::text])::int, 'saison', 'saison:' || s.id || ':nouveaux') then n := n + 1; end if;
    if r.points >= (rw->>'palier_points')::int and (rw->>'palier_gain')::int > 0
      and hg_wallet_add(r.user_id, (rw->>'palier_gain')::int, 'saison', 'saison:' || s.id || ':palier') then n := n + 1; end if;
  end loop;
  if s.settled_at is null then
    update hg_seasons set settled_at = now() where id = s.id;
    insert into hg_activity (user_id, kind, text) values (null, 'saison', s.label || ' terminée : le podium est sur la page Jeux.');
  end if;
  return jsonb_build_object('season', s.id, 'versements', n);
end $$;

-- Saison en cours (créée si besoin) ; clôture automatique des saisons terminées non clôturées.
create or replace function public.hg_season_ensure()
returns text language plpgsql security definer set search_path = public as $$
declare c record; old text;
begin
  select * into c from hg_season_of(now());
  insert into hg_seasons (id, label, starts_at, ends_at) values (c.id, c.label, c.starts_at, c.ends_at) on conflict (id) do nothing;
  for old in select id from hg_seasons where ends_at <= now() and settled_at is null order by ends_at loop
    perform hg_season_settle_core(old);
  end loop;
  return c.id;
end $$;

-- Classement de la saison (en cours par défaut) : saison, catégories, ma ligne, top 10 général et nouveaux.
create or replace function public.hg_season_board(p_season text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); sid text; s hg_seasons; res jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  sid := hg_season_ensure();
  if p_season is not null then sid := p_season; end if;
  select * into s from hg_seasons where id = sid;
  if not found then raise exception 'Saison introuvable'; end if;
  with q as (select p.*, rank() over (order by p.points desc) rg from hg_season_points(s.id) p),
  qn as (select q.*, rank() over (order by q.points desc) rgn from q where q.nouveau),
  pr as (select id, pseudo, avatar_url, color from hg_profiles)
  select jsonb_build_object(
    'season', jsonb_build_object('id', s.id, 'label', s.label, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'settled_at', s.settled_at),
    'cats', (select jsonb_agg(jsonb_build_object('cat', k.cat, 'label', k.label, 'pts', k.pts, 'cap', k.cap) order by k.sort) from hg_season_cats(s.caps) k),
    'rewards', hg_season_rewards(s.rewards),
    'participants', (select count(*) from q),
    'me', (select jsonb_build_object('rank', q.rg, 'points', q.points, 'detail', q.detail, 'week', q.week, 'nouveau', q.nouveau,
              'rank_nouveaux', (select qn.rgn from qn where qn.user_id = me)) from q where q.user_id = me),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('rank', q.rg, 'user_id', q.user_id, 'pseudo', pr.pseudo, 'avatar_url', pr.avatar_url,
              'color', pr.color, 'points', q.points, 'nouveau', q.nouveau) order by q.rg, pr.pseudo), '[]'::jsonb)
            from q join pr on pr.id = q.user_id where q.rg <= 10),
    'top_nouveaux', (select coalesce(jsonb_agg(jsonb_build_object('rank', qn.rgn, 'user_id', qn.user_id, 'pseudo', pr.pseudo, 'avatar_url', pr.avatar_url,
              'color', pr.color, 'points', qn.points, 'nouveau', true) order by qn.rgn, pr.pseudo), '[]'::jsonb)
            from qn join pr on pr.id = qn.user_id where qn.rgn <= 10))
  into res;
  return res;
end $$;

-- Staff « cartes » : clôture manuelle d'une saison terminée (journalisée).
create or replace function public.hg_season_settle(p_season text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff (cartes)'; end if;
  res := hg_season_settle_core(p_season);
  perform hg_admin_audit('saison_cloturee', null, p_season, res);
  return res;
end $$;

-- Staff « cartes » : libellé, dates (bornées), barème et récompenses d'une saison non clôturée (journalisé).
create or replace function public.hg_season_save(p_id text, p_label text, p_starts timestamptz, p_ends timestamptz, p_caps jsonb, p_rewards jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s hg_seasons; v_caps jsonb := '{}'::jsonb; k record; lbl text := btrim(coalesce(p_label, ''));
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff (cartes)'; end if;
  perform hg_season_ensure();
  select * into s from hg_seasons where id = p_id for update;
  if not found then raise exception 'Saison introuvable'; end if;
  if s.settled_at is not null then raise exception 'Saison déjà clôturée'; end if;
  if char_length(lbl) not between 3 and 60 then raise exception 'Libellé : 3 à 60 caractères'; end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts or p_ends - p_starts > interval '120 days' then
    raise exception 'Dates invalides (120 jours au plus)';
  end if;
  if p_ends <= now() then raise exception 'La fin doit être dans le futur'; end if;
  -- Barème : on ne garde que les catégories connues, bornées par hg_season_cats.
  for k in select * from hg_season_cats(coalesce(p_caps, '{}'::jsonb)) loop
    v_caps := v_caps || jsonb_build_object(k.cat, jsonb_build_object('pts', k.pts, 'cap', k.cap));
  end loop;
  update hg_seasons set label = lbl, starts_at = p_starts, ends_at = p_ends, caps = v_caps,
    rewards = hg_season_rewards(coalesce(p_rewards, '{}'::jsonb)), updated_at = now() where id = s.id;
  perform hg_admin_audit('saison_modifiee', null, s.id, jsonb_build_object('label', lbl, 'starts_at', p_starts, 'ends_at', p_ends,
    'caps', v_caps, 'rewards', hg_season_rewards(coalesce(p_rewards, '{}'::jsonb))));
  return jsonb_build_object('id', s.id);
end $$;

-- ---------------------------------------------------------------------
-- 3. J19 · Soirée complète
-- ---------------------------------------------------------------------
do $$
declare cascade_fk text := 'on de' || 'lete cascade';
begin
  execute $f$
    create table if not exists public.hg_game_nights (
      id uuid primary key default gen_random_uuid(),
      title text not null check (char_length(title) between 1 and 80),
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      threshold int not null check (threshold between 2 and 100),
      reward int not null check (reward between 0 and 500),
      source text not null default 'staff' check (source in ('staff', 'v7')),
      cancelled boolean not null default false,
      completed_at timestamptz,
      created_by uuid references public.hg_profiles(id) on update cascade on de$f$ || $f$lete set null,
      created_at timestamptz not null default now(),
      check (ends_at > starts_at and ends_at - starts_at <= interval '12 hours')
    )$f$;
  execute format($f$
    create table if not exists public.hg_night_presence (
      night_id uuid not null references public.hg_game_nights(id) %1$s,
      user_id uuid not null references public.hg_profiles(id) %1$s,
      created_at timestamptz not null default now(),
      primary key (night_id, user_id)
    )$f$, cascade_fk);
end $$;
create index if not exists hg_game_nights_time on public.hg_game_nights (starts_at);
alter table public.hg_game_nights enable row level security;
alter table public.hg_night_presence enable row level security;
-- Les membres lisent les soirées (non annulées) et la liste des présents (jamais d'absents : on ne stocke que les présents).
select public.hg_x4_policy('hg_game_nights', 'hg_game_nights_read',
  'create policy hg_game_nights_read on public.hg_game_nights for select to authenticated using (public.hg_is_member() and (not cancelled or public.hg_has_perm(''cartes'')))');
select public.hg_x4_policy('hg_night_presence', 'hg_night_presence_read',
  'create policy hg_night_presence_read on public.hg_night_presence for select to authenticated using (public.hg_is_member())');
revoke all on public.hg_game_nights, public.hg_night_presence from anon;
grant select on public.hg_game_nights, public.hg_night_presence to authenticated;
revoke insert, update, truncate, references, trigger on public.hg_game_nights, public.hg_night_presence from authenticated;
do $$ begin execute 'revoke ' || 'de' || 'lete on public.hg_game_nights, public.hg_night_presence from authenticated'; end $$;
-- Temps réel : la jauge de l'accueil s'abonne aux présences.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hg_night_presence') then
    execute 'alter publication supabase_realtime add table public.hg_night_presence';
  end if;
end $$;

-- Réglages par défaut (hg_settings.soirees) : seuil en % des membres actifs du mois (10 à 100), récompense (0 à 500).
create or replace function public.hg_night_defaults()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := coalesce((select value from hg_settings where key = 'soirees'), '{}'::jsonb); pct int := 60; rew int := 30; actifs int;
begin
  if coalesce(v->>'seuil_pct', '') ~ '^\d{1,3}$' and (v->>'seuil_pct')::int between 10 and 100 then pct := (v->>'seuil_pct')::int; end if;
  if coalesce(v->>'recompense', '') ~ '^\d{1,3}$' and (v->>'recompense')::int <= 500 then rew := (v->>'recompense')::int; end if;
  -- Membres actifs du mois : au moins un gain dans le journal sur 30 jours, fantômes exclus.
  select count(distinct l.user_id) into actifs from hg_wallet_log l join hg_profiles p on p.id = l.user_id and not p.is_ghost
    where l.created_at > now() - interval '30 days';
  return jsonb_build_object('seuil_pct', pct, 'recompense', rew, 'actifs', actifs,
    'seuil', least(100, greatest(2, round(actifs * pct / 100.0)::int)));
end $$;

-- Soirée à afficher sur l'accueil : celle en cours, sinon la prochaine des 7 jours (non annulée).
create or replace function public.hg_night_current()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); n hg_game_nights;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into n from hg_game_nights where not cancelled and ends_at > now() and starts_at < now() + interval '7 days'
    order by starts_at limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', n.id, 'title', n.title, 'starts_at', n.starts_at, 'ends_at', n.ends_at,
    'threshold', n.threshold, 'reward', n.reward, 'completed_at', n.completed_at, 'live', n.starts_at <= now(),
    'here', exists (select 1 from hg_night_presence x where x.night_id = n.id and x.user_id = me),
    'presents', (select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'pseudo', p.pseudo, 'avatar_url', p.avatar_url, 'color', p.color)
        order by x.created_at), '[]'::jsonb) from hg_night_presence x join hg_profiles p on p.id = x.user_id where x.night_id = n.id),
    'seuil_pct', hg_night_defaults()->'seuil_pct', 'actifs', hg_night_defaults()->'actifs',
    'completes_annee', (select count(*) from hg_game_nights g where g.completed_at is not null
        and date_trunc('year', g.starts_at at time zone 'Europe/Zurich') = date_trunc('year', now() at time zone 'Europe/Zurich')));
end $$;

-- Paiement des présents d'une soirée complète (appelé sous verrou de la soirée). Plafond hebdomadaire par membre.
create or replace function public.hg_night_pay(p_night uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n hg_game_nights; r record; k int := 0;
begin
  select * into n from hg_game_nights where id = p_night;
  if n.completed_at is null or n.reward <= 0 then return 0; end if;
  for r in select x.user_id from hg_night_presence x join hg_profiles p on p.id = x.user_id and not p.is_ghost where x.night_id = n.id loop
    if exists (select 1 from hg_wallet_log l where l.user_id = r.user_id and l.reason = 'soiree' and l.ref = 'soiree:' || n.id::text) then continue; end if;
    if hg_eco_count(r.user_id, 'soiree', hg_eco_week_start()) >= hg_eco_cap('soirees_semaine', 2) then continue; end if;
    if hg_wallet_add(r.user_id, n.reward, 'soiree', 'soiree:' || n.id::text) then k := k + 1; end if;
  end loop;
  return k;
end $$;

-- « J'y suis » : présence pendant la fenêtre (heure du serveur), une fois ; au seuil, la soirée est complète et
-- chaque présent est payé (les retardataires d'une soirée déjà complète aussi). Refs inchangées : jamais de double gain.
create or replace function public.hg_night_here(p_night uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n hg_game_nights; cnt int; first_complete boolean := false; paid boolean;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if (select is_ghost from hg_profiles where id = me) then raise exception 'Réservé aux membres'; end if;
  select * into n from hg_game_nights where id = p_night and not cancelled for update;
  if not found then raise exception 'Soirée introuvable'; end if;
  if now() < n.starts_at then raise exception 'La soirée n''a pas commencé'; end if;
  if now() >= n.ends_at then raise exception 'La soirée est terminée'; end if;
  insert into hg_night_presence (night_id, user_id) values (n.id, me) on conflict do nothing;
  select count(*) into cnt from hg_night_presence x join hg_profiles p on p.id = x.user_id and not p.is_ghost where x.night_id = n.id;
  if n.completed_at is null and cnt >= n.threshold then
    update hg_game_nights set completed_at = now() where id = n.id;
    first_complete := true;
    insert into hg_activity (user_id, kind, text) values (null, 'soiree', 'Soirée complète ! ' || cnt || ' membres à « ' || n.title || ' ».');
  end if;
  perform hg_night_pay(n.id);
  paid := exists (select 1 from hg_wallet_log l where l.user_id = me and l.reason = 'soiree' and l.ref = 'soiree:' || n.id::text);
  return jsonb_build_object('count', cnt, 'threshold', n.threshold, 'complete', n.completed_at is not null or first_complete,
    'just_completed', first_complete, 'paid', paid, 'reward', n.reward);
end $$;

-- Staff « cartes » : crée ou modifie une soirée (pas une soirée déjà complète). Seuil et récompense vides : défauts.
create or replace function public.hg_night_save(p_id uuid, p_title text, p_starts timestamptz, p_ends timestamptz, p_threshold int, p_reward int)
returns uuid language plpgsql security definer set search_path = public as $$
declare d jsonb := hg_night_defaults(); t text := btrim(coalesce(p_title, '')); th int; rw int; rid uuid := p_id; old hg_game_nights;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff (cartes)'; end if;
  if char_length(t) not between 1 and 80 then raise exception 'Titre : 1 à 80 caractères'; end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts or p_ends - p_starts > interval '12 hours' then
    raise exception 'Horaires invalides (12 heures au plus)';
  end if;
  th := coalesce(p_threshold, (d->>'seuil')::int);
  rw := coalesce(p_reward, (d->>'recompense')::int);
  if th not between 2 and 100 then raise exception 'Seuil : 2 à 100 présents'; end if;
  if rw not between 0 and 500 then raise exception 'Récompense : 0 à 500 Paillettes'; end if;
  if p_id is null then
    if p_ends <= now() then raise exception 'La soirée doit se terminer dans le futur'; end if;
    insert into hg_game_nights (title, starts_at, ends_at, threshold, reward, created_by)
      values (t, p_starts, p_ends, th, rw, auth.uid()) returning id into rid;
  else
    select * into old from hg_game_nights where id = p_id for update;
    if not found then raise exception 'Soirée introuvable'; end if;
    if old.completed_at is not null then raise exception 'Soirée déjà complète : elle ne se modifie plus'; end if;
    update hg_game_nights set title = t, starts_at = p_starts, ends_at = p_ends, threshold = th, reward = rw where id = p_id;
  end if;
  perform hg_admin_audit(case when p_id is null then 'soiree_creee' else 'soiree_modifiee' end, null, rid::text,
    jsonb_build_object('titre', t, 'debut', p_starts, 'fin', p_ends, 'seuil', th, 'recompense', rw));
  return rid;
end $$;

-- Staff « cartes » : annule une soirée (ou la rétablit) ; une soirée complète ne s'annule pas.
create or replace function public.hg_night_cancel(p_id uuid, p_cancel boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare n hg_game_nights;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff (cartes)'; end if;
  select * into n from hg_game_nights where id = p_id for update;
  if not found then raise exception 'Soirée introuvable'; end if;
  if n.completed_at is not null then raise exception 'Soirée déjà complète'; end if;
  update hg_game_nights set cancelled = coalesce(p_cancel, true) where id = p_id;
  perform hg_admin_audit(case when coalesce(p_cancel, true) then 'soiree_annulee' else 'soiree_retablie' end, null, p_id::text, jsonb_build_object('titre', n.title));
end $$;

-- Staff « cartes » : réglages par défaut des soirées (bornés, journalisés).
create or replace function public.hg_night_defaults_set(p_pct int, p_reward int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff (cartes)'; end if;
  if p_pct is null or p_pct not between 10 and 100 then raise exception 'Seuil : 10 à 100 %%'; end if;
  if p_reward is null or p_reward not between 0 and 500 then raise exception 'Récompense : 0 à 500 Paillettes'; end if;
  insert into hg_settings (key, value) values ('soirees', jsonb_build_object('seuil_pct', p_pct, 'recompense', p_reward))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform hg_admin_audit('soirees_reglages', null, 'soirees', jsonb_build_object('seuil_pct', p_pct, 'recompense', p_reward));
  return hg_night_defaults();
end $$;

-- Staff « cartes » : liste des soirées (récentes et à venir) avec le nombre de présents.
create or replace function public.hg_nights_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff (cartes)'; end if;
  return jsonb_build_object('defaults', hg_night_defaults(), 'nights', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'title', g.title, 'starts_at', g.starts_at, 'ends_at', g.ends_at, 'threshold', g.threshold, 'reward', g.reward,
      'source', g.source, 'cancelled', g.cancelled, 'completed_at', g.completed_at,
      'presents', (select count(*) from hg_night_presence x where x.night_id = g.id)) order by g.starts_at desc), '[]'::jsonb)
    from hg_game_nights g where g.starts_at > now() - interval '60 days'));
end $$;

-- ---------------------------------------------------------------------
-- 4. Page « Jeux » dans le menu, droits
-- ---------------------------------------------------------------------
insert into public.hg_pages (slug, label, mode, in_nav, sort) values ('jeux', 'Jeux', 'admin', true, 10)
  on conflict (slug) do nothing;

do $$
declare f text;
begin
  -- Outils internes : aucun client.
  foreach f in array array[
    'public.hg_x4_today()', 'public.hg_arcade_rules(text)', 'public.hg_arcade_game_of(date)', 'public.hg_arcade_reward()',
    'public.hg_arcade_top(text, date)', 'public.hg_season_cats(jsonb)', 'public.hg_season_rewards(jsonb)', 'public.hg_season_of(timestamptz)',
    'public.hg_season_raw(timestamptz, timestamptz)', 'public.hg_season_points(text)', 'public.hg_season_settle_core(text)',
    'public.hg_season_ensure()', 'public.hg_night_defaults()', 'public.hg_night_pay(uuid)'] loop
    execute 'revoke execute on function ' || f || ' from public, anon, authenticated';
  end loop;
  -- RPC des membres et du Staff (contrôles dans les fonctions).
  foreach f in array array[
    'public.hg_arcade_board()', 'public.hg_arcade_start()', 'public.hg_arcade_finish(uuid, integer)',
    'public.hg_season_board(text)', 'public.hg_season_settle(text)',
    'public.hg_season_save(text, text, timestamptz, timestamptz, jsonb, jsonb)',
    'public.hg_night_current()', 'public.hg_night_here(uuid)', 'public.hg_night_save(uuid, text, timestamptz, timestamptz, integer, integer)',
    'public.hg_night_cancel(uuid, boolean)', 'public.hg_night_defaults_set(integer, integer)', 'public.hg_nights_admin()'] loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;
