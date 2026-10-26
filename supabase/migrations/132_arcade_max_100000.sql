-- Arcade : score maximum porté à 100 000 pour les trois jeux (règles et plafonds des tables).
create or replace function public.hg_arcade_rules(p_game text)
 returns jsonb language sql immutable set search_path to 'public'
as $function$
  select case p_game
    when 'paillettes' then '{"max": 100000, "rate": 6, "min_s": 10, "titre": "Paillettes"}'::jsonb
    when 'raclette'   then '{"max": 100000, "rate": 6, "min_s": 10, "titre": "Raclette"}'::jsonb
    when 'domu'       then '{"max": 100000, "rate": 8, "min_s": 3,  "titre": "Domu-mobile"}'::jsonb
  end $function$;
alter table public.hg_arcade_scores drop constraint if exists hg_arcade_scores_best_check;
alter table public.hg_arcade_scores add constraint hg_arcade_scores_best_check check (best >= 0 and best <= 100000);
alter table public.hg_arcade_runs drop constraint if exists hg_arcade_runs_score_check;
alter table public.hg_arcade_runs add constraint hg_arcade_runs_score_check check (score is null or (score >= 0 and score <= 100000));
