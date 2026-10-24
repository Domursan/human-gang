-- 114 : jeux d'arcade (pages 404) sans limite de temps : la partie dure tant que le joueur a des vies.
-- Plafonds de score relevés, partie valable 1 h (au lieu de 15 min), récompense dès 10 s de jeu.
-- Le contrôle « points par seconde réellement écoulée » (rate) reste la garde contre les scores inventés.
create or replace function public.hg_arcade_rules(p_game text)
returns jsonb language sql immutable set search_path to 'public' as $function$
  select case p_game
    when 'paillettes' then '{"max": 5000, "rate": 6, "min_s": 10, "titre": "Paillettes"}'::jsonb
    when 'raclette'   then '{"max": 5000, "rate": 6, "min_s": 10, "titre": "Raclette"}'::jsonb
    when 'domu'       then '{"max": 30000, "rate": 8, "min_s": 3,  "titre": "Domu-mobile"}'::jsonb
  end $function$;
do $d$ begin
  execute replace(pg_get_functiondef('public.hg_arcade_finish(uuid, integer)'::regprocedure), 'if secs > 900 then', 'if secs > 3600 then');
end $d$;
