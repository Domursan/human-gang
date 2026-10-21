-- Appliqué en production le 22/10/2026.
-- 052_corrige : a appliquer APRES 052_reglages_ss_irl.sql.
-- Les fonctions de lecture de reglage sont en SECURITY DEFINER : elles lisent hg_settings sans RLS.
-- Sans ce correctif, anon peut appeler hg_reglage_int / hg_reglage_bool (droit EXECUTE par defaut Supabase)
-- et lire les champs numeriques ou booleens de cles masquees par RLS (ex. « planning », « cards »).
-- Les fonctions de tirage (SECURITY DEFINER, proprietaire postgres) continuent de fonctionner.
revoke execute on function public.hg_reglage_int(text, text, int) from public, anon, authenticated;
revoke execute on function public.hg_reglage_bool(text, text, boolean) from public, anon, authenticated;
