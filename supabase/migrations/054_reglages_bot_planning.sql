-- Réglages admin, lot 5 : bot Discord, planning des tâches automatiques, assistance.
-- Ajouts seulement, rétrocompatible : sans les clés `planning` et `support`, le comportement est celui d'avant
-- (le code lit chaque clé avec le même défaut que celui inscrit ici et dans _shared/reglages.ts).
-- À appliquer AVANT de redéployer hg-birthdays (qui appelle hg_cron_gate).

-- 1. Lecture publique des réglages d'assistance : le formulaire est aussi utilisé sans compte.
--    La clé ne contient que des sujets et des limites, aucune donnée personnelle.
create policy hg_settings_support_read on public.hg_settings
  for select to anon, authenticated using (key = 'support');

-- 2. Écriture des clés support et planning : admin, ou Staff avec la permission « bot »
--    (ces clés sont éditées dans la section Bot Discord). hg_settings_perm reste inchangée.
create policy hg_settings_lot5_bot on public.hg_settings
  for all to authenticated
  using (key in ('support', 'planning') and hg_has_perm('bot'))
  with check (key in ('support', 'planning') and hg_has_perm('bot'));

-- 3. Porte logique des tâches planifiées (heure suisse fixe, quelle que soit la saison).
--    La tâche pg_cron tourne à fréquence fixe ; la fonction dit si elle doit agir maintenant.
--    p_tache = 'anniversaires' lit planning.anniversaires_heure_locale ; repli : p_heure_defaut.
create or replace function public.hg_cron_gate(p_tache text, p_heure_defaut int)
returns boolean
language sql
stable
set search_path = public
as $$
  select extract(hour from (now() at time zone 'Europe/Zurich'))::int = coalesce(
    (select case when v ~ '^[0-9]{1,2}$' then (case when v::int between 0 and 23 then v::int end) end
       from (select value->>(p_tache || '_heure_locale') as v from hg_settings where key = 'planning') s),
    p_heure_defaut)
$$;

revoke execute on function public.hg_cron_gate(text, int) from public, anon, authenticated;
grant execute on function public.hg_cron_gate(text, int) to service_role;
