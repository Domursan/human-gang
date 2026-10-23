-- ===== Humane Gang — 100 : Arcade, les trois mini-jeux disponibles tous les jours =====
-- Demande d'Ethan (23/10) : Paillettes, Raclette et Domu-mobile restent jouables chacun, accessibles depuis le menu.
-- hg_arcade_board(p_game) et hg_arcade_start(p_game) acceptent le mini-jeu voulu ; sans valeur (ou valeur inconnue),
-- c'est le jeu tiré pour la journée, comme avant. La récompense reste d'UNE partie par jour, tous jeux confondus.
-- Les anciennes versions sans argument sont retirées (sinon l'appel sans argument serait ambigu).

drop function if exists public.hg_arcade_board();
drop function if exists public.hg_arcade_start();

-- Mini-jeu demandé s'il est connu, sinon celui du jour.
create or replace function public.hg_arcade_pick(p_game text)
returns text language sql stable set search_path = public as $$
  select case when p_game in ('paillettes', 'raclette', 'domu') then p_game else hg_arcade_game_of(hg_x4_today()) end $$;

create or replace function public.hg_arcade_board(p_game text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); d date := hg_x4_today(); g text; wk date;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  g := hg_arcade_pick(p_game);
  wk := date_trunc('week', d)::date;
  return jsonb_build_object(
    'day', d, 'week', wk, 'game', g, 'game_of_day', hg_arcade_game_of(d), 'rules', hg_arcade_rules(g), 'reward', hg_arcade_reward(),
    'rewarded_today', exists (select 1 from hg_wallet_log l where l.user_id = me and l.reason = 'arcade' and l.ref = 'arcade:' || d::text),
    'my_best', (select best from hg_arcade_scores where user_id = me and game = g and week = wk),
    'top', hg_arcade_top(g, wk));
end $$;

create or replace function public.hg_arcade_start(p_game text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); d date := hg_x4_today(); rid uuid; g text := hg_arcade_pick(p_game);
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  perform hg_eco_lock(me);
  if (select count(*) from hg_arcade_runs where user_id = me and day = d) >= 40 then
    raise exception 'Assez joué pour aujourd''hui : reviens demain !';
  end if;
  update hg_arcade_runs set finished_at = now(), score = 0 where user_id = me and finished_at is null;
  insert into hg_arcade_runs (user_id, game, day) values (me, g, d) returning id into rid;
  return jsonb_build_object('run', rid, 'game', g, 'day', d, 'rules', hg_arcade_rules(g));
end $$;

revoke all on function public.hg_arcade_pick(text) from public, anon, authenticated;
revoke all on function public.hg_arcade_board(text) from public, anon;
revoke all on function public.hg_arcade_start(text) from public, anon;
grant execute on function public.hg_arcade_board(text) to authenticated;
grant execute on function public.hg_arcade_start(text) to authenticated;
