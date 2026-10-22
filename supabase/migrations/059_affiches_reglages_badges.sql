-- Appliquée en production le 22/10/2026.
-- Migration 059 : les affiches et les tutos lisent les critères des badges (hg_settings.badges).
-- Avant, seule l'administration lisait cette clé ; les membres voient maintenant les critères
-- (par exemple « 5 sorties » pour Toujours là) dans les textes des affiches et des tutos.
-- Rétrocompatible : aucune donnée ni aucune écriture ne change, la politique d'écriture reste celle de hg_settings_admin.
-- La configuration du jeu de cartes passe par la RPC hg_card_cfg() (migration 018, déjà appelable par les membres).

drop policy if exists hg_settings_read_badges on public.hg_settings;
create policy hg_settings_read_badges on public.hg_settings
  for select to authenticated
  using (key = 'badges');
