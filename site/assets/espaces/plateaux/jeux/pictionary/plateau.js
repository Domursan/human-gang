// ===== Humane Gang — Pictionary : toile et aides d'affichage (plateaux/jeux/pictionary/plateau.js) =====
/*
 * Rôle : dessin de la toile (traits en coordonnées normalisées 0-1, rejoués sur un canevas 960 × 720), palette de
 *   couleurs, épaisseurs, gomme, et affichage de l'indice (« _ _ a _ », une case par lettre, espaces entre les mots).
 *   Ce module ne fait ni réseau ni état : table.js décide quoi dessiner et quand.
 * Dépendances : core.js (esc).
 * Exporte : LARGEUR, HAUTEUR, FOND, PALETTE, EPAISSEURS, GOMME, tracerToile(ctx, traits), tracerTrait(ctx, trait),
 *   indiceHtml(indice), nombreCachees(indice), arrondi(n), borne(n, min, max), couleurValide(c).
 *   Un trait : { s: identifiant, c: '#rrggbb', e: épaisseur (part de la largeur), p: [[x, y], …] }.
 */
import { esc } from '../../../../commun/core.js';

/** Dimensions du canevas (ratio 4:3) : les coordonnées normalisées sont multipliées par ces valeurs. */
export const LARGEUR = 960;
export const HAUTEUR = 720;
/** Couleur du papier (fond de la toile, aussi couleur de la gomme). */
export const FOND = '#F6F1E7';
/** Palette : huit couleurs, dont celles du logo (rouge, sable, sauge, ardoise, prune, rose). */
export const PALETTE = [
  { nom: 'Noir', couleur: '#1B1A1F' },
  { nom: 'Rouge', couleur: '#B70127' },
  { nom: 'Rouille', couleur: '#CF7055' },
  { nom: 'Ambre', couleur: '#D8A75E' },
  { nom: 'Vert', couleur: '#3F8A5C' },
  { nom: 'Bleu', couleur: '#3C5A9E' },
  { nom: 'Violet', couleur: '#6E55A8' },
  { nom: 'Rose', couleur: '#E0909A' },
];
/** Trois épaisseurs, en part de la largeur de la toile. */
export const EPAISSEURS = [
  { nom: 'Fin', valeur: 0.004 },
  { nom: 'Moyen', valeur: 0.01 },
  { nom: 'Épais', valeur: 0.022 },
];
/** Épaisseur de la gomme (un trait couleur papier). */
export const GOMME = 0.04;

const COULEUR = /^#[0-9a-f]{6}$/i;

/** Arrondit à trois décimales (les points partent sur le canal : moins de chiffres, moins d'octets). */
export const arrondi = (n) => Math.round(n * 1000) / 1000;

/** Borne un nombre entre min et max ; un nombre absent ou non fini donne min. */
export const borne = (n, min = 0, max = 1) => (Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min);

/** Vrai si c est une couleur « #rrggbb ». */
export const couleurValide = (c) => COULEUR.test(String(c || ''));

/**
 * Dessine un trait sur le canevas (arrondis, largeur proportionnelle à la toile).
 * Un trait d'un seul point est dessiné comme un point.
 * @param {CanvasRenderingContext2D} ctx contexte de la toile (coordonnées en pixels de la toile).
 * @param {{ c: string, e: number, p: number[][] }} t trait normalisé.
 */
export function tracerTrait(ctx, t) {
  const pts = Array.isArray(t?.p) ? t.p : [];
  if (!pts.length) return;
  const largeur = Math.max(2, borne(Number(t.e), 0.001, 0.05) * LARGEUR);
  const couleur = couleurValide(t.c) ? t.c : PALETTE[0].couleur;
  ctx.strokeStyle = couleur;
  ctx.fillStyle = couleur;
  ctx.lineWidth = largeur;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const [x0, y0] = [borne(pts[0][0]) * LARGEUR, borne(pts[0][1]) * HAUTEUR];
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(x0, y0, largeur / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(borne(pts[i][0]) * LARGEUR, borne(pts[i][1]) * HAUTEUR);
  ctx.stroke();
}

/**
 * Efface la toile (papier) puis rejoue tous les traits, dans l'ordre.
 * @param {CanvasRenderingContext2D} ctx contexte de la toile.
 * @param {Array} traits traits normalisés, du premier au dernier.
 */
export function tracerToile(ctx, traits) {
  ctx.fillStyle = FOND;
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
  for (const t of traits || []) tracerTrait(ctx, t);
}

/**
 * HTML de l'indice : une case par lettre (la lettre si elle est dévoilée, sinon vide), un espace marqué entre les mots.
 * Le serveur sépare chaque caractère par une espace : un double espace marque un espace du mot.
 * @param {string} indice indice du serveur, par exemple « _ a _ _ ».
 * @returns {string} HTML (le texte passe par esc).
 */
export function indiceHtml(indice) {
  if (!indice) return '';
  return String(indice).split(' ').map((c) => (c === ''
    ? '<span class="pi-mot-espace" aria-hidden="true"></span>'
    : `<span class="pi-case${c === '_' ? ' is-vide' : ''}">${c === '_' ? '' : esc(c)}</span>`)).join('');
}

/** Nombre de lettres encore cachées dans un indice (les « _ »). */
export function nombreCachees(indice) {
  return String(indice || '').split(' ').filter((c) => c === '_').length;
}
