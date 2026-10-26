// ===== Humane Gang — Cluedo : dessin du manoir (plateaux/jeux/cluedo/plateau.js) =====
/*
 * Rôle : plan du manoir en grille 3 × 4 (disposition de la maquette ChateauPlateau).
 *   Si une image de fond existe (assets/img/plateaux/cluedo/plateau.webp, 2400 × 1500), elle sert de fond
 *   et les pièces deviennent des zones transparentes par-dessus ; sinon, dessin de repli (couleurs, noms, passages).
 *   Les pions des suspects et les armes sont posés au centre de leur pièce.
 *   Ce module ne fait que du HTML : c'est table.js qui le monte et décide quand le refaire.
 * Dépendances : core.js (esc).
 * Exporte : PIECES (zones), plateauHtml(opts) -> HTML.
 *   opts = { image: string|null, noms: {piece: nom}, pions: [{suspect, nom, couleur, initiale, piece, pseudo}],
 *            armes: [{arme, nom, piece}], voisines: [piece], maPiece: piece|null, cliquable: bool }
 */
import { esc } from '../../../core.js';

/* Grille : colonnes 0..2, rangées 0..3. Largeur 860 px, hauteur 540 px (maquette). */
const LARGEUR = 860;
const HAUTEUR = 540;
const MARGE = 18;
const PAS_X = 278;
const PAS_Y = 128;
const L_CASE = 268;
const H_CASE = 118;

/** Pièces : position dans la grille, fond de repli (maquette), passage secret éventuel. Les identifiants sont fixes. */
export const PIECES = {
  cuisine:      { c: 0, r: 0, h: 1, fond: 'radial-gradient(circle at 50% 50%, #E6E0D0 0 12px, #B9B09A 13px 15px, transparent 16px) 0 0 / 30px 30px, #CFC6B2', passage: 'bureau' },
  bal:          { c: 1, r: 0, h: 1, fond: 'repeating-linear-gradient(90deg, #A8733A 0 24px, #94632F 24px 25px), #A8733A' },
  veranda:      { c: 2, r: 0, h: 1, fond: 'linear-gradient(135deg, #BFE3DA, #7FB9A8)', passage: 'salon' },
  manger:       { c: 0, r: 1, h: 2, fond: 'repeating-linear-gradient(90deg, #6E2C2C 0 26px, #5A2222 26px 27px), #6E2C2C' },
  billard:      { c: 2, r: 1, h: 1, fond: 'radial-gradient(circle at 50% 50%, #2E7A4A 0 60%, #1F5233 100%), #2E7A4A' },
  bibliotheque: { c: 2, r: 2, h: 1, fond: 'repeating-linear-gradient(90deg, #4A3520 0 14px, #6A4C2C 14px 16px), #4A3520' },
  salon:        { c: 0, r: 3, h: 1, fond: 'radial-gradient(circle at 50% 50%, #6A2E3A 0 60%, #4A1E28 100%), #6A2E3A', passage: 'veranda' },
  hall:         { c: 1, r: 3, h: 1, fond: 'repeating-conic-gradient(#D8D0C0 0 25%, #B8B0A0 0 50%) 0 0 / 36px 36px, #D8D0C0' },
  bureau:       { c: 2, r: 3, h: 1, fond: 'repeating-linear-gradient(0deg, #3E2A18 0 22px, #33220F 22px 24px), #3E2A18', passage: 'cuisine' },
};

/** Centre d'une zone (en %), pour poser les pions. */
const centre = (c, r, h) => ({
  x: ((MARGE + c * PAS_X + L_CASE / 2) / LARGEUR) * 100,
  y: ((MARGE + r * PAS_Y + (H_CASE + (h - 1) * PAS_Y) / 2) / HAUTEUR) * 100,
});
/** Position d'une zone en % (gauche, haut, largeur, hauteur). */
const zoneStyle = ({ c, r, h }) =>
  `left:${((MARGE + c * PAS_X) / LARGEUR) * 100}%;top:${((MARGE + r * PAS_Y) / HAUTEUR) * 100}%;` +
  `width:${(L_CASE / LARGEUR) * 100}%;height:${((H_CASE + (h - 1) * PAS_Y) / HAUTEUR) * 100}%`;

/** Pions déjà posés dans une même pièce : décalés pour rester lisibles. */
function decalage(index, total) {
  if (total <= 1) return { dx: 0, dy: 0 };
  const angle = (index / total) * 2 * Math.PI;
  return { dx: Math.cos(angle) * 9, dy: Math.sin(angle) * 6 };
}

const ABREV_ARME = { chandelier: 'Ch', poignard: 'Po', revolver: 'Re', corde: 'Co', matraque: 'Ma', 'clé anglaise': 'Cl' };

/** Plan du manoir : HTML complet (boîte 860 × 540 à l'échelle). */
export function plateauHtml({ image = null, noms = {}, pions = [], armes = [], voisines = [], maPiece = null, cliquable = false } = {}) {
  const voisinesSet = new Set(voisines);
  const nom = (p) => esc(noms[p] || p);

  const pieces = Object.entries(PIECES).map(([id, z]) => {
    const estVoisine = cliquable && voisinesSet.has(id);
    const estMoi = id === maPiece;
    const classes = ['ch-room'];
    if (!image) classes.push('ch-fond');
    if (estVoisine) classes.push('ch-hl');
    if (estMoi) classes.push('ch-sel');
    const fond = image ? '' : `background:${z.fond};`;
    const etiquettes = [];
    if (estMoi) etiquettes.push('<span class="ch-tag-piece">Ta pièce</span>');
    else if (estVoisine) etiquettes.push('<span class="ch-tag-piece">Voisine</span>');
    if (z.passage) {
      etiquettes.push(`<span class="ch-passage"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#E2C77E" stroke-width="2" aria-hidden="true"><path d="M3 20h4v-4h4v-4h4V8h6"></path></svg>Passage vers ${nom(z.passage)}</span>`);
    }
    const contenu = `<span class="ch-name">${nom(id)}</span>${etiquettes.join('')}`;
    const style = `${zoneStyle(z)};${fond}`;
    if (estVoisine) {
      return `<button type="button" class="${classes.join(' ')}" style="${style}" data-piece="${esc(id)}" aria-label="Aller dans ${nom(id)}">${contenu}</button>`;
    }
    return `<div class="${classes.join(' ')}" style="${style}"${estMoi ? ' aria-current="true"' : ''}>${contenu}</div>`;
  }).join('');

  // Escalier central : pas une pièce, décor seulement (absent de l'image si elle existe).
  const escalier = image ? '' : `<div class="ch-escalier" style="${zoneStyle({ c: 1, r: 1, h: 2 })}" aria-hidden="true"><span class="ch-escalier-marche"></span><span class="ch-escalier-nom">Escalier central</span></div>`;

  // Pions : regroupés par pièce pour les décaler.
  const parPiece = {};
  pions.forEach((p) => { (parPiece[p.piece] ||= []).push(p); });
  const pionsHtml = Object.entries(parPiece).flatMap(([piece, liste]) => {
    const z = PIECES[piece];
    if (!z) return [];
    const base = centre(z.c, z.r, z.h);
    return liste.map((p, i) => {
      const { dx, dy } = decalage(i, liste.length);
      const tag = p.pseudo ? `<span class="ch-tag">${esc(p.pseudo)}</span>` : '';
      return `<div class="ch-pawn" style="left:calc(${base.x}% + ${dx}px);top:calc(${base.y}% + ${dy}px)" role="img" aria-label="${esc(p.nom)}${p.pseudo ? `, pion de ${esc(p.pseudo)}` : ''}">` +
        `<span class="ch-disc" style="background:${esc(p.couleur)}" aria-hidden="true">${esc(p.initiale)}</span>${tag}</div>`;
    });
  }).join('');

  // Armes : petites pastilles dans leur pièce (le nom est lu par les lecteurs d'écran).
  const parArme = {};
  armes.forEach((a) => { (parArme[a.piece] ||= []).push(a); });
  const armesHtml = Object.entries(parArme).flatMap(([piece, liste]) => {
    const z = PIECES[piece];
    if (!z) return [];
    const base = centre(z.c, z.r, z.h);
    return liste.map((a, i) => {
      const abr = ABREV_ARME[String(a.nom).toLowerCase()] || String(a.nom).slice(0, 2);
      return `<span class="ch-arme" style="left:calc(${base.x}% - ${28 - i * 26}px);top:calc(${base.y}% + 30px)" title="${esc(a.nom)}"><span class="visually-hidden">${esc(a.nom)}</span><span aria-hidden="true">${esc(abr)}</span></span>`;
    });
  }).join('');

  const fondImage = image ? `<img class="ch-plan-img" src="${esc(image)}" alt="" width="860" height="540">` : '';

  return `<div class="ch-plan" role="group" aria-label="Plan du manoir">${fondImage}${escalier}${pieces}${armesHtml}${pionsHtml}</div>`;
}
