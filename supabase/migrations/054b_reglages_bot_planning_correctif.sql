-- Appliqué en production le 22/10/2026.
-- 054_corrige (facultatif, idempotence) : a appliquer APRES 054_reglages_bot_planning.sql.
-- Rend les deux politiques re-jouables sans erreur (sinon « policy already exists » a une seconde execution).
-- Aucun changement fonctionnel.
drop policy if exists hg_settings_support_read on public.hg_settings;
create policy hg_settings_support_read on public.hg_settings
  for select to anon, authenticated using (key = 'support');

drop policy if exists hg_settings_lot5_bot on public.hg_settings;
create policy hg_settings_lot5_bot on public.hg_settings
  for all to authenticated
  using (key in ('support', 'planning') and hg_has_perm('bot'))
  with check (key in ('support', 'planning') and hg_has_perm('bot'));
