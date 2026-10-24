-- Une carte unique peut avoir plusieurs exemplaires numérotés (quantité réglée dans l'éditeur).
-- L'ancienne contrainte imposait max_copies = 1 : on exige seulement un nombre défini.
alter table public.hg_cards drop constraint if exists hg_cards_unique_un_exemplaire;
alter table public.hg_cards add constraint hg_cards_unique_un_exemplaire
  check (rarity <> 'unique' or (max_copies is not null and max_copies >= 1));
