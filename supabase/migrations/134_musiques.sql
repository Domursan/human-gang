-- ===== Humane Gang — migration 134 : série « Musiques » (1 000 cartes) =====
-- Famille « musique » ajoutée aux familles de cartes.
-- Série « musiques », inactive (visible des admins seulement tant qu'elle n'est pas ouverte) :
-- les 1 000 titres les plus écoutés sur Spotify (classement kworb.net, octobre 2026) sortis depuis 1980.
-- Numéro = rang dans cette liste. Nom = titre ; légende = artiste(s) ; image = pochette officielle (Apple Music ou Deezer, liée, non copiée).
-- Raretés par rang : 1-10 mythique, 11-50 légendaire, 51-150 épique, 151-330 rare, 331-610 peu commune, 611-1000 commune.
-- Rejouable : la série et ses cartes sont créées seulement si elles n'existent pas.

alter table public.hg_cards drop constraint if exists hg_cards_family_check;
alter table public.hg_cards add constraint hg_cards_family_check
  check (family in ('membre','moment','lieu','objet','evenement','jeu','unique','musique'));

insert into public.hg_card_sets (code, name, description, active, sort)
values ('musiques', 'Musiques', 'Les 1 000 titres les plus écoutés sur Spotify sortis depuis 1980. Numéro = rang au classement des écoutes (octobre 2026).', false, 60)
on conflict (code) do nothing;
