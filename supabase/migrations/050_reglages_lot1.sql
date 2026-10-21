-- Migration 050 : réglages admin, lot 1 (identité, textes, pages légales, menu, pied de page, intro, bandeau cookies).
-- Rétrocompatible : ajouts seulement. Une valeur {} = valeurs par défaut du site (comportement inchangé).
-- Les clés ne stockent que les écarts aux valeurs par défaut (voir assets/js/core/site-defaults.js).

-- 1. Lignes de réglage (ne remplace jamais une valeur existante)
insert into hg_settings (key, value, updated_at)
values ('site_identite', '{}'::jsonb, now()), ('site_textes', '{}'::jsonb, now())
on conflict (key) do nothing;

-- 2. Lecture publique de ces deux seules clés (visiteurs non connectés : intro, pages légales, connexion, assistance).
--    Les autres clés de hg_settings gardent leur politique actuelle.
drop policy if exists hg_settings_site_read on hg_settings;
create policy hg_settings_site_read on hg_settings
  for select to anon, authenticated
  using (key in ('site_identite', 'site_textes'));

-- Écriture : inchangée. La politique hg_settings_admin (administrateur, ou Staff avec le droit « reglages »,
-- hg_settings_perm renvoie « reglages » pour ces clés) s'applique déjà.
