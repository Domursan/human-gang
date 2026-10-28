-- Menu « Autres » : les jeux n'y apparaissent plus (ils sont tous rangés sur la page Jeux).
-- Seul le menu change (in_nav) : l'accès aux pages reste le même.
update hg_pages set in_nav = false
where slug in ('uno', 'duels', 'nom-de-code', 'loup-garou', 'blackjack', 'poker')
   or slug like 'nj-%' or slug like 'arcade-%' or slug like 'duel-%';
