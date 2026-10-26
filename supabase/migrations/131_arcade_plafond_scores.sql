-- Arcade : la migration 114 a relevé les scores max (5 000 / 30 000) mais les tables gardaient un plafond à 1 000,
-- d'où « hg_arcade_scores_best_check » pour tout score au-delà. Plafond aligné sur le plus grand max des règles.
alter table public.hg_arcade_scores drop constraint if exists hg_arcade_scores_best_check;
alter table public.hg_arcade_scores add constraint hg_arcade_scores_best_check check (best >= 0 and best <= 30000);
alter table public.hg_arcade_runs drop constraint if exists hg_arcade_runs_score_check;
alter table public.hg_arcade_runs add constraint hg_arcade_runs_score_check check (score is null or (score >= 0 and score <= 30000));
