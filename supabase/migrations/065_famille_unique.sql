-- ===== Humane Gang — migration 065 : famille « Unique » pour les cartes =====
-- Ajoute la famille « unique » (en plus de membre, moment, lieu, objet, evenement, jeu) pour ranger les cartes uniques.
-- Rétrocompatible : on élargit seulement la liste des valeurs permises.
alter table public.hg_cards drop constraint if exists hg_cards_family_check;
alter table public.hg_cards add constraint hg_cards_family_check
  check (family in ('membre','moment','lieu','objet','evenement','jeu','unique'));
