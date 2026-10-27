// ===== Humane Gang — Risk : carte du monde (plateaux/jeux/risk/plateau.js) =====
/*
 * Rôle : la carte des 42 territoires.
 *   Si l'image assets/img/plateaux/risk/carte.webp existe (1376 × 768), elle sert de fond, avec ses propres centres (CENTRES_IMAGE). Sinon, dessin de repli :
 *   chaque continent est une enveloppe colorée autour de ses territoires, les liaisons maritimes sont en pointillés.
 *   Chaque territoire est un bouton placé en % (coordonnées de la maquette, 960 × 520 : valable pour l'image aussi).
 *   Ce module ne fait que du HTML et des classes : table.js le monte, décide quand le refaire et marque la sélection.
 * Dépendances : core.js (esc).
 * Exporte : CENTRES, plateauHtml(opts) -> HTML, marquer(zone, sel).
 *   plateauHtml : opts = { image, terrs: [{id, nom, couleur, clair, a, mine, clic, proprietaire, armee}],
 *                          continents: [{id, nom, couleur, membres: [ids]}] }
 *   marquer : sel = { de, vers, cibles: [ids] } (classes is-sel, is-vers, is-hl sur les territoires).
 */
import { esc } from '../../../core.js';

const LARGEUR = 960;
const HAUTEUR = 520;

/** Centres des 42 territoires (unités 960 × 520, coordonnées de la maquette ComteCarte). */
export const CENTRES = {
  alaska: [79.5, 68.0], tno: [172.2, 61.2], groenland: [371.0, 40.8], alberta: [172.2, 98.6], ontario: [243.8, 108.8],
  quebec: [286.2, 115.6], ouest: [172.2, 149.6], est: [259.7, 156.4], amcentrale: [225.2, 227.8],
  venezuela: [299.4, 258.4], perou: [278.2, 316.2], bresil: [339.2, 319.6], argentine: [304.8, 404.6],
  islande: [426.6, 64.6], gb: [471.7, 105.4], scandinavie: [514.1, 74.8], europenord: [508.8, 108.8],
  europeouest: [469.1, 129.2], europesud: [511.4, 142.8], ukraine: [564.4, 115.6],
  afnord: [490.2, 190.4], egypte: [556.5, 193.8], afest: [577.7, 278.8], congo: [530.0, 292.4],
  afsud: [543.2, 380.8], madagascar: [601.5, 353.6],
  oural: [636.0, 91.8], siberie: [728.8, 74.8], yakoutie: [821.5, 68.0], irkoutsk: [781.8, 115.6],
  kamtchatka: [895.7, 88.4], mongolie: [755.2, 129.2], japon: [842.7, 156.4], afghanistan: [649.2, 170.0],
  chine: [755.2, 176.8], moyenorient: [596.2, 183.6], inde: [683.7, 210.8], siam: [744.6, 234.6],
  indonesie: [781.8, 292.4], nouvelleguinee: [848.0, 302.6], australieouest: [797.6, 374.0], australieest: [863.9, 377.4],
};

/** Liaisons maritimes (pointillés) : paires de territoires séparées par la mer. */
const MARITIMES = [
  ['alaska', 'kamtchatka'], ['groenland', 'islande'], ['bresil', 'afnord'],
  ['europeouest', 'afnord'], ['europesud', 'egypte'], ['indonesie', 'australieouest'],
];

const pct = (v, total) => ((v / total) * 100).toFixed(2);

/** Enveloppe convexe d'un nuage de points (chaîne monotone). */
function enveloppe(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const bas = [];
  const haut = [];
  for (const q of p) {
    while (bas.length >= 2 && cross(bas[bas.length - 2], bas[bas.length - 1], q) <= 0) bas.pop();
    bas.push(q);
  }
  for (let i = p.length - 1; i >= 0; i -= 1) {
    const q = p[i];
    while (haut.length >= 2 && cross(haut[haut.length - 2], haut[haut.length - 1], q) <= 0) haut.pop();
    haut.push(q);
  }
  haut.pop();
  bas.pop();
  return bas.concat(haut);
}

/** Écarte chaque point du centre de gravité de marge unités (zone un peu plus large que ses territoires). */
function gonfler(points, marge) {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy) || 1;
    return [x + (dx / d) * marge, y + (dy / d) * marge];
  });
}

const chemin = (points) => `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')} Z`;

/** Arc en pointillés entre deux territoires (courbe vers le haut). */
function arc(a, b) {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const mx = (x1 + x2) / 2;
  const my = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.12 - 20;
  return `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`;
}

/** Fond de repli : mer, enveloppes des continents, liaisons maritimes. */
function fondDessine(continents) {
  const zones = continents.map((c) => {
    const pts = c.membres.map((id) => CENTRES[id]).filter(Boolean);
    if (!pts.length) return '';
    const forme = pts.length >= 3 ? gonfler(enveloppe(pts), 26) : pts;
    return `<path d="${chemin(forme)}" fill="${esc(c.couleur)}" fill-opacity=".28" stroke="${esc(c.couleur)}" stroke-opacity=".7" stroke-width="2" stroke-linejoin="round"><title>${esc(c.nom)}</title></path>`;
  }).join('');
  const mers = MARITIMES
    .filter(([a, b]) => CENTRES[a] && CENTRES[b])
    .map(([a, b]) => `<path d="${arc(CENTRES[a], CENTRES[b])}" fill="none" stroke="#E8D2B4" stroke-width="2" stroke-dasharray="6 6" stroke-opacity=".7"></path>`)
    .join('');
  return `<svg class="rk-fond-svg" viewBox="0 0 ${LARGEUR} ${HAUTEUR}" aria-hidden="true" focusable="false">
    <rect width="${LARGEUR}" height="${HAUTEUR}" fill="#0B2C48"></rect>${zones}${mers}</svg>`;
}

/** Centres des 42 territoires sur l'image de la carte (assets/img/plateaux/risk/carte.webp, 1376 × 768, en pixels). */
export const CENTRES_IMAGE = {
  alaska: [110, 160], tno: [235, 140], groenland: [520, 95], alberta: [230, 230], ontario: [320, 240], quebec: [420, 230],
  ouest: [260, 300], est: [350, 300], amcentrale: [320, 370],
  venezuela: [420, 440], perou: [410, 520], bresil: [490, 490], argentine: [430, 620],
  islande: [600, 160], scandinavie: [750, 170], gb: [650, 225], europenord: [730, 240], europeouest: [660, 285], europesud: [750, 285], ukraine: [820, 210],
  afnord: [660, 400], egypte: [770, 380], afest: [810, 460], congo: [740, 490], afsud: [760, 570], madagascar: [835, 540],
  oural: [920, 200], siberie: [1000, 150], yakoutie: [1120, 130], irkoutsk: [1100, 200], kamtchatka: [1270, 160], japon: [1160, 295],
  mongolie: [1080, 250], chine: [1030, 315], afghanistan: [900, 280], moyenorient: [840, 350], inde: [950, 385], siam: [1030, 395],
  indonesie: [1080, 470], nouvelleguinee: [1180, 485], australieouest: [1120, 580], australieest: [1190, 590],
};

/**
 * Carte complète : fond (image ou dessin), puis un bouton par territoire.
 * @param {{image?: string|null, terrs: object[], continents: object[]}} opts voir l'en-tête.
 * @returns {string} HTML (<div class="rk-carte">).
 */
export function plateauHtml({ image = null, terrs = [], continents = [] } = {}) {
  const fond = image
    ? `<img class="rk-fond-img" src="${esc(image)}" alt="" width="1376" height="768">`
    : fondDessine(continents);
  const [centres, l, h] = image ? [CENTRES_IMAGE, 1376, 768] : [CENTRES, LARGEUR, HAUTEUR];
  const pions = terrs.map((t) => {
    const [x, y] = centres[t.id] || [0, 0];
    const style = `left:${pct(x, l)}%;top:${pct(y, h)}%`;
    const classes = ['rk-terr'];
    if (t.mine) classes.push('is-moi');
    const armee = t.armee ? `, armée ${t.armee}` : '';
    const proprio = t.proprietaire ? `, à ${t.proprietaire}${armee}` : ', libre';
    const nom = `${t.nom}${proprio}, ${t.a} troupe${t.a > 1 ? 's' : ''}`;
    const pastille = `<span class="rk-pastille${t.clair ? ' is-clair' : ''}" style="background:${esc(t.couleur)}" aria-hidden="true">${esc(t.a)}</span>`;
    return `<button type="button" class="${classes.join(' ')}" style="${style}" data-terr="${esc(t.id)}" title="${esc(t.nom)}" aria-label="${esc(nom)}"${t.clic ? '' : ' disabled'}>${pastille}</button>`;
  }).join('');
  return `<div class="rk-carte${image ? ' rk-carte--image' : ''}">${fond}<div class="rk-pions">${pions}</div></div>`;
}

/**
 * Marque la sélection sur la carte déjà dessinée, sans la reconstruire (le focus reste en place).
 * @param {HTMLElement} zone zone de la carte.
 * @param {{de?: string|null, vers?: string|null, cibles?: string[]}} sel territoire de départ, cible, cibles possibles.
 */
export function marquer(zone, { de = null, vers = null, cibles = [] } = {}) {
  const hl = new Set(cibles);
  zone.querySelectorAll('[data-terr]').forEach((b) => {
    const id = b.dataset.terr;
    b.classList.toggle('is-sel', id === de);
    b.classList.toggle('is-vers', id === vers);
    b.classList.toggle('is-hl', hl.has(id));
  });
}
