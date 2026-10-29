-- ===== Humane Gang — migration 177 : couleurs Pixel Pop pour le thème par défaut =====
-- Refonte visuelle « Pixel Pop » (29/10/2026) : le thème Classique reprend la charte du logo
-- (fond presque noir, cœur rouge #B70127 pour les actions, jaune de la traînée arc-en-ciel pour les mises en avant).
-- Les thèmes de saison (Halloween, Noël, Raclette…) gardent leurs couleurs : seul le thème par défaut change.
-- Les mêmes valeurs sont dans DEFAULT_THEME (site/assets/commun/core/theme-calc.js), utilisé avant le chargement.

update hg_themes
   set colors = jsonb_build_object(
         'accent', '#B70127',
         'bg', '#08080B',
         'surface', '#121216',
         'text', '#F4F1EA',
         'muted', '#B8B4C0',
         'highlight', '#FBD32D'
       )
 where slug = 'classique' and is_default;
