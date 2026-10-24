-- ===== Humane Gang — 107 : badge « Gladiateur » (fin de saison de l'Arène v2) =====
-- S'applique après 104 (et 105). Idempotente.
-- Règle : le niveau = la meilleure ligue de fin de saison jamais atteinte (rang non nul dans hg_arena_results) :
--   niveau 1 Argent, 2 Or, 3 Diamant, 4 Légende. Bronze ne donne rien. Le niveau ne baisse jamais (hg_award_level_badges).
-- Métrique « arene_ligue » branchée dans hg_metric_value (valeur 0 à 4 : 0 = aucune ligue classée).
-- Attribution : hg_arena_close_core appelle hg_award_level_badges pour chaque membre classé, à la clôture de saison.
-- La cron horaire de hg_award_badges recalcule aussi ce badge (comme les autres badges à niveaux).
-- hg_metric_value et hg_arena_close_core sont repris de leur définition en base ; seule une ligne change.

-- 1. Définition du badge (pas d'image : comme Pentakill, la pastille est la médaille par défaut)
insert into hg_badges (code, name, description, sort, levels_enabled, metric, levels)
  select 'gladiateur', 'Gladiateur', 'Meilleure ligue de fin de saison à l’Arène : Argent, Or, Diamant ou Légende.', 902,
    true, 'arene_ligue',
    '[{"level":1,"threshold":1,"name":"Argent"},{"level":2,"threshold":2,"name":"Or"},{"level":3,"threshold":3,"name":"Diamant"},{"level":4,"threshold":4,"name":"Légende"}]'::jsonb
  where not exists (select 1 from hg_badges where code = 'gladiateur');

-- 2. Métrique : meilleure ligue de fin de saison (saisons closes uniquement, membre classé)
create or replace function public.hg_metric_value(p_user uuid, p_metric text, p_event uuid default null::uuid)
returns numeric language sql stable security definer set search_path to 'public' as $function$
  select case p_metric
    when 'anciennete_annees' then (select floor(extract(epoch from (now() - coalesce(joined_on::timestamptz, created_at))) / 31557600) from hg_profiles where id = p_user)
    when 'secret_santa' then (select count(*) from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id where pt.user_id = p_user and e.status in ('revelation','termine') and pt.sent_at is not null)
    when 'sorties' then (select count(*) from hg_eco_attended() a where a.user_id = p_user)
    when 'sorties_organisees' then hg_eco_events_created(p_user)
    when 'photos' then hg_eco_photos(p_user)
    when 'moments' then hg_eco_moments(p_user)
    when 'messages' then (select count(*) from hg_messages where sender_id = p_user and not system)
    when 'idees_retenues' then (select count(*) from hg_ideas where user_id = p_user and status = 'retenue')
    when 'event_captures' then (select count(*) from hg_dyn_captures where user_id = p_user and (p_event is null or event_id = p_event))
    when 'events_dynamiques' then (select count(distinct event_id) from hg_dyn_captures where user_id = p_user)
    when 'mercis_recus' then (select count(distinct (t.from_id, date_trunc('week', t.created_at at time zone 'Europe/Zurich')))
                                from hg_thanks t where t.to_id = p_user and not t.removed)
    when 'mercis_donnes' then (select count(*) from hg_thanks t where t.from_id = p_user and not t.removed)
    when 'pentakills' then (select count(*) from hg_pentakills where user_id = p_user)
    when 'arene_ligue' then (select coalesce(max(case r.league when 'argent' then 1 when 'or' then 2 when 'diamant' then 3 when 'legende' then 4 else 0 end), 0)
                               from hg_arena_results r where r.user_id = p_user and r.rank is not null)
    else 0 end $function$;

-- 3. Clôture de saison : attribution du badge à chaque membre classé (seule ligne ajoutée : perform hg_award_level_badges)
create or replace function public.hg_arena_close_core(p_season integer, p_by uuid)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare cfg jsonb := hg_arena_cfg(); m record; lg text; tot int; bq int; n int := 0; paid_sum int := 0; boost_sum int := 0;
  dep int := (cfg->>'depart')::int; pl int := (cfg->>'plancher')::int; nxt int;
begin
  for m in select * from hg_arena_standings() s where s.rk is not null order by s.rk loop
    lg := hg_arena_league(m.rating, cfg);
    tot := coalesce((cfg->'recompenses'->>lg)::int, 0);
    if m.rk <= 3 then tot := tot + coalesce((cfg->'podium'->>(m.rk::text))::int, 0); end if;
    tot := least(tot, (cfg->>'plafond_saison')::int);
    bq := coalesce((cfg->'boosters'->>lg)::int, 0);
    perform hg_eco_lock(m.user_id);
    insert into hg_arena_results (season_id, user_id, rating, league, rank, matches, wins, losses, draws, paid, boosters)
      values (p_season, m.user_id, m.rating, lg, m.rk, m.matches, m.wins, m.losses, m.draws, tot, bq);
    perform hg_award_level_badges(m.user_id);
    if tot > 0 then perform hg_wallet_add(m.user_id, tot, 'arene_saison', 'arene_saison:' || p_season || ':' || m.user_id); end if;
    if bq > 0 then
      insert into hg_wallet_log (user_id, delta, reason, ref) values (m.user_id, 0, 'arene_booster', 'arene_booster:' || p_season || ':' || m.user_id)
        on conflict do nothing;
      if found then
        insert into hg_booster_stock (user_id, type_id, qty) values (m.user_id, 'classique', 0) on conflict do nothing;
        update hg_booster_stock set qty = qty + bq where user_id = m.user_id and type_id = 'classique';
      end if;
    end if;
    paid_sum := paid_sum + tot; boost_sum := boost_sum + bq; n := n + 1;
  end loop;
  -- Combats insuffisants : pas de rang, pas de récompense, mais une ligne dans l'historique.
  insert into hg_arena_results (season_id, user_id, rating, league, rank, matches, wins, losses, draws, paid, boosters)
    select p_season, r.user_id, r.rating, hg_arena_league(r.rating, cfg), null, r.matches, r.wins, r.losses, r.draws, 0, 0
    from hg_arena_ratings r join hg_profiles p on p.id = r.user_id and not p.is_ghost
    where r.matches > 0 and r.matches < (cfg->>'min_combats')::int;
  -- Remise à niveau des cotes pour la saison suivante.
  update hg_arena_ratings set rating = greatest(pl, dep + round((rating - dep) * (cfg->>'reset_pct')::int / 100.0)::int),
    matches = 0, wins = 0, losses = 0, draws = 0, updated_at = now();
  update hg_arena_seasons set status = 'close', closed_at = now(), closed_by = p_by where id = p_season;
  nxt := hg_arena_season_ensure();
  return jsonb_build_object('season', p_season, 'classes', n, 'paillettes', paid_sum, 'boosters', boost_sum, 'suivante', nxt);
end $function$;

-- Test (à lancer seul dans l'éditeur SQL, sur un membre sans résultat d'Arène). L'exception annule tout.
-- Attendu : TEST_RESULT metrique=3 niveau=3 (une saison classée en Diamant, une saison non classée en Légende ignorée).
-- do $t$
-- declare u uuid := (select p.id from hg_profiles p where not p.is_ghost
--          and not exists (select 1 from hg_arena_results r where r.user_id = p.id) order by p.created_at limit 1);
--   s1 int; s2 int; v numeric; lv int;
-- begin
--   insert into hg_arena_seasons (label, starts_at, ends_at, status)
--     values ('Test 1', now() - interval '60 days', now() - interval '31 days', 'close') returning id into s1;
--   insert into hg_arena_seasons (label, starts_at, ends_at, status)
--     values ('Test 2', now() - interval '30 days', now() - interval '1 day', 'close') returning id into s2;
--   insert into hg_arena_results (season_id, user_id, rating, league, rank, matches, wins, losses, draws)
--     values (s1, u, 1420, 'diamant', 4, 5, 3, 2, 0), (s2, u, 1650, 'legende', null, 2, 1, 1, 0);
--   perform hg_award_level_badges(u);
--   select level into lv from hg_user_badges where user_id = u and badge_code = 'gladiateur';
--   v := hg_metric_value(u, 'arene_ligue');
--   raise exception 'TEST_RESULT metrique=% niveau=%', v, lv;
-- end $t$;
