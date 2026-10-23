// =====================================================================
// Styles de cartouche des boosters : liste de référence côté front (53 = 9 d'origine + 30 couleurs + 14 thèmes).
// Classes CSS : cartes-boosters.css (9 d'origine) et boosters-styles.css (30 couleurs, une famille par teinte ; 14 thèmes cart--theme-<slug>).
// Même liste côté base : hg_booster_styles() (migration 077), qui valide hg_booster_type_save et la contrainte
// hg_booster_types_style_check. Ajouter un style = une ligne ici + une classe CSS + la liste SQL.
// Exporte : BOOSTER_STYLE_FAMILIES, BOOSTER_STYLE_LIST, BOOSTER_STYLES (paires [classe, libellé]), boosterStyleClass.
// =====================================================================

/** Familles de couleurs (ordre d'affichage du sélecteur de l'admin). */
export const BOOSTER_STYLE_FAMILIES = [
  ['origine', 'Styles d’origine'],
  ['rouges', 'Rouges'],
  ['roses', 'Roses et violets'],
  ['oranges', 'Oranges et bruns'],
  ['verts', 'Jaunes et verts'],
  ['bleus', 'Bleus et cyans'],
  ['neutres', 'Indigos et neutres'],
  ['themes', 'Thèmes'],
];

/**
 * Tous les styles : classe CSS, nom, famille, motif (repère sans couleur : luminosité et dessin du corps).
 * @type {{cls: string, label: string, fam: string, motif: string}[]}
 */
export const BOOSTER_STYLE_LIST = [
  { cls: 'cart--classique', label: 'Classique', fam: 'origine', motif: '' },
  { cls: 'cart--serie', label: 'Série', fam: 'origine', motif: '' },
  { cls: 'cart--argente', label: 'Argenté', fam: 'origine', motif: '' },
  { cls: 'cart--dore', label: 'Doré', fam: 'origine', motif: '' },
  { cls: 'cart--diamant', label: 'Diamant', fam: 'origine', motif: '' },
  { cls: 'cart--quitte', label: 'Quitte ou double', fam: 'origine', motif: '' },
  { cls: 'cart--holo', label: 'Holographique', fam: 'origine', motif: '' },
  { cls: 'cart--collection', label: 'Collection', fam: 'origine', motif: '' },
  { cls: 'cart--identite', label: 'Identité', fam: 'origine', motif: '' },
  { cls: 'cart--rubis', label: 'Rubis', fam: 'rouges', motif: 'facettes taillées, moyen' },
  { cls: 'cart--paprika', label: 'Paprika', fam: 'rouges', motif: 'grains d’épices, moyen' },
  { cls: 'cart--braise', label: 'Braise', fam: 'rouges', motif: 'étincelles et lueur, sombre' },
  { cls: 'cart--corail', label: 'Corail', fam: 'rouges', motif: 'vagues, clair' },
  { cls: 'cart--framboise', label: 'Framboise', fam: 'rouges', motif: 'pois, moyen' },
  { cls: 'cart--dragee', label: 'Dragée', fam: 'roses', motif: 'losanges, clair' },
  { cls: 'cart--fuchsia', label: 'Fuchsia', fam: 'roses', motif: 'rayures néon, sombre' },
  { cls: 'cart--mauve', label: 'Mauve', fam: 'roses', motif: 'tartan, moyen' },
  { cls: 'cart--lavande', label: 'Lavande', fam: 'roses', motif: 'fleurettes, clair' },
  { cls: 'cart--prune', label: 'Prune', fam: 'roses', motif: 'zigzags, sombre' },
  { cls: 'cart--abricot', label: 'Abricot', fam: 'oranges', motif: 'vichy, clair' },
  { cls: 'cart--mandarine', label: 'Mandarine', fam: 'oranges', motif: 'rayures diagonales larges, moyen' },
  { cls: 'cart--miel', label: 'Miel', fam: 'oranges', motif: 'alvéoles, moyen' },
  { cls: 'cart--cuivre', label: 'Cuivre', fam: 'oranges', motif: 'métal brossé, moyen' },
  { cls: 'cart--cacao', label: 'Cacao', fam: 'oranges', motif: 'tablette, sombre' },
  { cls: 'cart--citron', label: 'Citron', fam: 'verts', motif: 'papier quadrillé, clair' },
  { cls: 'cart--pistache', label: 'Pistache', fam: 'verts', motif: 'écailles, clair' },
  { cls: 'cart--kiwi', label: 'Kiwi', fam: 'verts', motif: 'rayons, moyen' },
  { cls: 'cart--olive', label: 'Olive', fam: 'verts', motif: 'camouflage, moyen' },
  { cls: 'cart--acide', label: 'Acide', fam: 'verts', motif: 'grille néon, sombre' },
  { cls: 'cart--menthe', label: 'Menthe', fam: 'bleus', motif: 'bulles, clair' },
  { cls: 'cart--lagon', label: 'Lagon', fam: 'bleus', motif: 'ondes, moyen' },
  { cls: 'cart--petrole', label: 'Pétrole', fam: 'bleus', motif: 'reflet irisé, sombre' },
  { cls: 'cart--azur', label: 'Azur', fam: 'bleus', motif: 'fines rayures verticales, moyen' },
  { cls: 'cart--saphir', label: 'Saphir', fam: 'bleus', motif: 'taille princesse, sombre' },
  { cls: 'cart--pervenche', label: 'Pervenche', fam: 'neutres', motif: 'nuages, clair' },
  { cls: 'cart--amethyste', label: 'Améthyste', fam: 'neutres', motif: 'géode, moyen' },
  { cls: 'cart--indigo', label: 'Indigo', fam: 'neutres', motif: 'ciel étoilé, sombre' },
  { cls: 'cart--ardoise', label: 'Ardoise', fam: 'neutres', motif: 'feuilletage, moyen' },
  { cls: 'cart--ivoire', label: 'Ivoire', fam: 'neutres', motif: 'toile de lin, clair' },
  { cls: 'cart--theme-pate', label: 'Pâté', fam: 'themes', motif: 'croûte en treillis, moyen' },
  { cls: 'cart--theme-saucisse', label: 'Saucisse', fam: 'themes', motif: 'chaînons et liens, sombre' },
  { cls: 'cart--theme-pate-saucisse', label: 'Pâté + saucisse', fam: 'themes', motif: 'moitié treillis, moitié chaînons' },
  { cls: 'cart--theme-raclette', label: 'Raclette', fam: 'themes', motif: 'fromage fondu, gouttes' },
  { cls: 'cart--theme-fondue', label: 'Fondue', fam: 'themes', motif: 'bulles de fromage, piques' },
  { cls: 'cart--theme-arene', label: 'Arène', fam: 'themes', motif: 'grille hexagonale dorée, gemme' },
  { cls: 'cart--theme-blocs', label: 'Blocs', fam: 'themes', motif: 'pixels herbe et terre' },
  { cls: 'cart--theme-usine', label: 'Usine', fam: 'themes', motif: 'orange industriel, tapis, engrenage' },
  { cls: 'cart--theme-noel', label: 'Noël', fam: 'themes', motif: 'neige, ruban rouge' },
  { cls: 'cart--theme-halloween', label: 'Halloween', fam: 'themes', motif: 'lune, lueur orange, étoiles' },
  { cls: 'cart--theme-paques', label: 'Pâques', fam: 'themes', motif: 'œufs peints pastel' },
  { cls: 'cart--theme-saint-nicolas', label: 'Saint-Nicolas', fam: 'themes', motif: 'étoiles dorées, biscuits' },
  { cls: 'cart--theme-feux-artifice', label: 'Feux d’artifice', fam: 'themes', motif: 'bouquets en anneaux' },
  { cls: 'cart--theme-gateau-anniversaire', label: 'Gâteau d’anniversaire', fam: 'themes', motif: 'glaçage, bougies' },
];

/** Paires [classe, libellé], dans l'ordre de BOOSTER_STYLE_LIST. */
export const BOOSTER_STYLES = BOOSTER_STYLE_LIST.map((s) => [s.cls, s.label]);

const KNOWN = new Set(BOOSTER_STYLE_LIST.map((s) => s.cls));
/**
 * Classe de style sûre : une des classes connues, sinon « cart--classique » (style absent, inconnu ou mal formé).
 * @param {unknown} style valeur de hg_booster_types.style
 * @returns {string}
 */
export const boosterStyleClass = (style) => (typeof style === 'string' && KNOWN.has(style) ? style : 'cart--classique');
