-- ===== Humane Gang — migration 136 : socle des nouveaux jeux (en développement, réservés aux admins) =====
-- hg_nj_acces() : vrai si le compte connecté peut jouer aux jeux en développement. Pour l'instant : les admins seulement.
--   Le jour de la sortie, il suffira de la redéfinir (par exemple sur hg_is_member()).
-- Arcade : six nouveaux mini-jeux (flappy, briques, snake, tetris, invaders, taupe) acceptés par les tables et les RPC,
--   seulement pour hg_nj_acces(). Règles anti-triche par jeu : plafond, points par seconde, durée minimale récompensée.

create or replace function public.hg_nj_acces()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.hg_is_admin(), false) $$;
revoke all on function public.hg_nj_acces() from public, anon;
grant execute on function public.hg_nj_acces() to authenticated;

-- Tables : nouveaux identifiants de jeu.
alter table public.hg_arcade_runs drop constraint if exists hg_arcade_runs_game_check;
alter table public.hg_arcade_runs add constraint hg_arcade_runs_game_check
  check (game in ('paillettes', 'raclette', 'domu', 'flappy', 'briques', 'snake', 'tetris', 'invaders', 'taupe'));
alter table public.hg_arcade_scores drop constraint if exists hg_arcade_scores_game_check;
alter table public.hg_arcade_scores add constraint hg_arcade_scores_game_check
  check (game in ('paillettes', 'raclette', 'domu', 'flappy', 'briques', 'snake', 'tetris', 'invaders', 'taupe'));

-- Règles : max = score plafond, rate = points par seconde au plus, min_s = durée minimale pour la récompense.
create or replace function public.hg_arcade_rules(p_game text)
 returns jsonb language sql immutable set search_path to 'public'
as $function$
  select case p_game
    when 'paillettes' then '{"max": 100000, "rate": 6, "min_s": 10, "titre": "Paillettes"}'::jsonb
    when 'raclette'   then '{"max": 100000, "rate": 6, "min_s": 10, "titre": "Raclette"}'::jsonb
    when 'domu'       then '{"max": 100000, "rate": 8, "min_s": 3,  "titre": "Domu-mobile"}'::jsonb
    when 'flappy'     then '{"max": 100000, "rate": 2, "min_s": 3,  "titre": "Flappy Domu"}'::jsonb
    when 'briques'    then '{"max": 100000, "rate": 40, "min_s": 10, "titre": "Casse-briques"}'::jsonb
    when 'snake'      then '{"max": 100000, "rate": 12, "min_s": 5,  "titre": "Snake"}'::jsonb
    when 'tetris'     then '{"max": 100000, "rate": 60, "min_s": 15, "titre": "Tetris du gang"}'::jsonb
    when 'invaders'   then '{"max": 100000, "rate": 40, "min_s": 10, "titre": "Space Invaders"}'::jsonb
    when 'taupe'      then '{"max": 100000, "rate": 5, "min_s": 10, "titre": "Tape-taupe"}'::jsonb
  end $function$;

-- Choix du mini-jeu : les jeux en développement seulement pour hg_nj_acces(), sinon le jeu du jour.
create or replace function public.hg_arcade_pick(p_game text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_game in ('paillettes', 'raclette', 'domu') then p_game
    when p_game in ('flappy', 'briques', 'snake', 'tetris', 'invaders', 'taupe') and public.hg_nj_acces() then p_game
    else hg_arcade_game_of(hg_x4_today()) end $$;
revoke all on function public.hg_arcade_pick(text) from public, anon, authenticated;
