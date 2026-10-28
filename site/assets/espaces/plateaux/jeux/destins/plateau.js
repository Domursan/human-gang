// ===== Humane Gang — Destins : chemin de vie (plateaux/jeux/destins/plateau.js) =====
/*
 * Rôle : dessin du chemin de vie sur l'image plateau.webp (repère 1024 × 1024) : routes, tronçon coloré par type de case,
 *   séparations, lettres, étiquettes de zones et pions. La géométrie (routes, tronçons, centres) vient de trace.js.
 *   Les règles de déplacement (case suivante selon la voie) reprennent hg_plat__de_suivante (supabase 128_destins.sql).
 *   Ce module ne fait que du HTML et du calcul de chemin : table.js décide quand le refaire.
 * Dépendances : core.js (esc), ./trace.js.
 * Exporte :
 *   POSITIONS : centre de chaque case (91 paires [x, y] en % de l'image).
 *   LIBELLES : type de case -> { lettre, nom }.
 *   COULEURS : type de case -> { fond, texte } (palette de la maquette, reprise par la légende).
 *   NOM_ZONE : zone (trace.js) -> nom affiché. zoneDeCase(n) : zone de la case n.
 *   caseSuivante(n, voie, voie2), pasEntre(de, vers, voie, voie2) : déplacement case par case.
 *   plateauHtml(opts) -> HTML ; legendeHtml() -> HTML de la légende des couleurs.
 *   opts = { image: string|null, types: [type par case], pions: [{couleur, initiale, pseudo, invite, case, saut}],
 *            prochaine: index|null, moi: index|null, estompees: [index] (voie non prise) }
 */
import { esc } from '../../../../commun/core.js';
import { CASES, ROUTES, ROUTE_AJOUTEE, TAILLE } from './trace.js';

const ROUTE_CREME = '#F3E6C4';
const ROUTE_SOMBRE = '#1A140D';
const TOUR_CASE = 14;      // taille de la lettre de case (repère de l'image)
const NB = CASES.length;

/** Centre de chaque case, en % de l'image (les pions et les zones se placent avec ces valeurs). */
export const POSITIONS = CASES.map((c) => [+((c.c[0] / TAILLE) * 100).toFixed(3), +((c.c[1] / TAILLE) * 100).toFixed(3)]);

/** Nom affiché et lettre de chaque type de case. */
export const LIBELLES = {
  depart: { lettre: 'D', nom: 'Départ' },
  paie: { lettre: '€', nom: 'Paie' },
  evenement: { lettre: '!', nom: 'Événement' },
  vacances: { lettre: 'V', nom: 'Vacances' },
  assurance: { lettre: 'A', nom: 'Assurance' },
  diplome: { lettre: 'T', nom: 'Diplôme' },
  mariage: { lettre: '&', nom: 'Mariage' },
  bebe: { lettre: 'B', nom: 'Bébé' },
  jumeaux: { lettre: '2', nom: 'Jumeaux' },
  achat: { lettre: 'M', nom: 'Achat' },
  impots: { lettre: 'I', nom: 'Impôts' },
  proces: { lettre: 'J', nom: 'Procès' },
  augmentation: { lettre: '+', nom: 'Augmentation' },
  choix: { lettre: '?', nom: 'Choix' },
  risque: { lettre: 'Q', nom: 'Risque' },
  retraite: { lettre: 'R', nom: 'Retraite' },
};

/** Couleurs des types (palette de la maquette) : fond du tronçon et couleur de la lettre. */
export const COULEURS = {
  depart: { fond: '#F2EFEA', texte: '#1A140D' },
  paie: { fond: '#3E9B5B', texte: '#FFFFFF' },
  augmentation: { fond: '#5BAF6E', texte: '#FFFFFF' },
  evenement: { fond: '#8A5CC2', texte: '#FFFFFF' },
  vacances: { fond: '#3B82C4', texte: '#FFFFFF' },
  assurance: { fond: '#2F8F8A', texte: '#FFFFFF' },
  diplome: { fond: '#C8A13A', texte: '#1A140D' },
  mariage: { fond: '#D0607E', texte: '#FFFFFF' },
  bebe: { fond: '#E58FB0', texte: '#1A140D' },
  jumeaux: { fond: '#E58FB0', texte: '#1A140D' },
  achat: { fond: '#C9772F', texte: '#FFFFFF' },
  impots: { fond: '#8C3B3B', texte: '#FFFFFF' },
  proces: { fond: '#B0413E', texte: '#FFFFFF' },
  choix: { fond: '#FFFFFF', texte: '#1A140D' },
  risque: { fond: '#D9822B', texte: '#FFFFFF' },
  retraite: { fond: '#A89A80', texte: '#1A140D' },
};
const COULEUR_DEFAUT = { fond: '#6B665F', texte: '#FFFFFF' };

/** Types montrés dans la légende, dans l'ordre de la maquette. */
const LEGENDE = ['paie', 'evenement', 'bebe', 'achat', 'mariage', 'vacances', 'assurance', 'impots', 'proces', 'risque', 'augmentation', 'diplome'];

/**
 * Ancre d'une étiquette de zone (repère 1024) : à ~57 unités (≈ 40 px) de la case du milieu de la zone, perpendiculairement
 * à la route, du côté où elle ne couvre aucune case.
 */
function ancreZone(zone) {
  const idx = [];
  CASES.forEach((c, i) => { if (c.z === zone) idx.push(i); });
  if (!idx.length) return [0, 0];
  const m = idx[Math.floor(idx.length / 2)];
  const [cx, cy] = CASES[m].c;
  const a = CASES[Math.max(0, m - 1)].c;
  const b = CASES[Math.min(NB, m + 1) < NB ? m + 1 : m].c;
  let tx = b[0] - a[0];
  let ty = b[1] - a[1];
  const longueur = Math.hypot(tx, ty) || 1;
  tx /= longueur;
  ty /= longueur;
  const nx = -ty;
  const ny = tx;
  let meilleure = [cx, cy];
  let meilleureDistance = -1;
  for (const sens of [1, -1]) {
    const px = cx + sens * nx * 57;
    const py = cy + sens * ny * 57;
    const distance = Math.min(...CASES.map((c) => Math.hypot(c.c[0] - px, c.c[1] - py)));
    if (distance > meilleureDistance) { meilleureDistance = distance; meilleure = [px, py]; }
  }
  return meilleure.map((v) => Math.round(v));
}

/** Zones : nom, couleur de bordure de l'étiquette, ancre de l'étiquette (repère 1024). */
const ZONES = {
  depart: { nom: 'Départ', couleur: '#F2EFEA', ancre: [150, 190] },
  universite: { nom: 'Université', couleur: '#3B82C4', ancre: ancreZone('universite') },
  carriere: { nom: 'Carrière', couleur: '#C9772F', ancre: ancreZone('carriere') },
  main: { nom: 'Vie active', couleur: '#3E9B5B', ancre: ancreZone('main') },
  famille: { nom: 'Famille', couleur: '#D0607E', ancre: ancreZone('famille') },
  aventure: { nom: 'Aventure', couleur: '#8A5CC2', ancre: ancreZone('aventure') },
  retraite: { nom: 'Retraite', couleur: '#A89A80', ancre: ancreZone('retraite') },
};
export const NOM_ZONE = Object.fromEntries(Object.entries(ZONES).map(([k, z]) => [k, z.nom]));

/** Libellé d'un type de case (repli : le type lui-même). */
const libelleDe = (type) => LIBELLES[type] || { lettre: '·', nom: String(type || 'Case') };
const couleurDeType = (type) => COULEURS[type] || COULEUR_DEFAUT;

/** Zone d'une case (depart, universite, carriere, main, famille, aventure, retraite). */
export function zoneDeCase(n) {
  return CASES[n]?.z || 'main';
}

/**
 * Case qui suit la case n (même règle que le serveur) : voie choisie au départ (voie), puis
 * embranchement de la case 51 (voie2 : aventure ou famille).
 */
export function caseSuivante(n, voie = null, voie2 = null) {
  if (n === 0) return voie === 'universite' ? 1 : 11;
  if (n === 10 || n === 20) return 21;
  if (n === 51) return voie2 === 'aventure' ? 62 : 52;
  if (n === 61 || n === 71) return 72;
  if (n === 90) return 90;
  return n + 1;
}

/** Nombre de pas pour aller de la case de à la case vers en suivant le chemin, ou -1 si impossible. */
export function pasEntre(de, vers, voie = null, voie2 = null, max = 40) {
  let n = Number(de);
  for (let k = 0; k <= max; k++) {
    if (n === Number(vers)) return k;
    n = caseSuivante(n, voie, voie2);
  }
  return -1;
}

/** Routes : bord sombre de chaque zone (la route aventure, absente de l'image, est posée sur fond crème). */
function routesSvg() {
  const parts = [];
  if (ROUTE_AJOUTEE && ROUTES[ROUTE_AJOUTEE]) {
    parts.push(`<path d="${ROUTES[ROUTE_AJOUTEE]}" fill="none" stroke="${ROUTE_CREME}" stroke-width="54" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const d of Object.values(ROUTES)) {
    parts.push(`<path d="${d}" fill="none" stroke="${ROUTE_SOMBRE}" stroke-opacity=".85" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  return parts.join('');
}

/** Tronçons colorés (un par case), séparations et lettres. */
function casesSvg(types, prochaine, estompees) {
  const tronc = [];
  const seps = [];
  const lettres = [];
  CASES.forEach((c, i) => {
    const type = types[i] || 'vacances';
    const { lettre } = libelleDe(type);
    const { fond, texte } = i === 0 ? COULEURS.depart : couleurDeType(type);
    const op = estompees.has(i) ? ' opacity=".35"' : '';
    if (c.d) {
      tronc.push(`<path d="${c.d}" fill="none" stroke="${fond}" stroke-width="34" stroke-linecap="butt" stroke-linejoin="round"${op}/>`);
    }
    if (c.sep) {
      const [x, y, nx, ny] = c.sep;
      const h = 18;
      seps.push(`<line x1="${(x - nx * h).toFixed(1)}" y1="${(y - ny * h).toFixed(1)}" x2="${(x + nx * h).toFixed(1)}" y2="${(y + ny * h).toFixed(1)}" stroke="${ROUTE_SOMBRE}" stroke-width="2.5" stroke-linecap="round"${op}/>`);
    }
    const [cx, cy] = c.c;
    if (i === 0) {
      lettres.push(`<circle cx="${cx}" cy="${cy}" r="27" fill="${COULEURS.depart.fond}" stroke="${ROUTE_SOMBRE}" stroke-width="5"/>` +
        `<text x="${cx}" y="${cy + 1}" text-anchor="middle" dominant-baseline="central" font-size="17" font-weight="800" fill="${COULEURS.depart.texte}">D</text>`);
    } else {
      lettres.push(`<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${TOUR_CASE}" font-weight="800" fill="${texte}"${op}>${esc(lettre)}</text>`);
    }
    if (i === prochaine) {
      lettres.push(`<circle class="dp-halo" cx="${cx}" cy="${cy}" r="22" fill="none" stroke="#E2C77E" stroke-width="5"/>`);
    }
  });
  return tronc.join('') + seps.join('') + lettres.join('');
}

/** Décalage des pions posés sur une même case : éventail (petit décalage), pour rester lisibles. */
function decalage(index, total) {
  if (total <= 1) return { dx: 0, dy: 0 };
  const angle = -Math.PI / 2 + ((index - (total - 1) / 2) * (Math.PI / 3.2));
  return { dx: Math.cos(angle) * 13, dy: Math.sin(angle) * 9 - 2 };
}

/**
 * HTML du chemin de vie : image, SVG des routes et des cases, étiquettes de zones, cases (accessibles) et pions.
 * @param {{image?: string|null, types?: string[], pions?: object[], prochaine?: number|null, moi?: number|null, estompees?: number[]}} opts
 * @returns {string} HTML (<div class="dp-plan">).
 */
export function plateauHtml({ image = null, types = [], pions = [], prochaine = null, moi = null, estompees = [] } = {}) {
  const estompeesSet = new Set(estompees);
  const fond = image ? `<img class="dp-plan-img" src="${esc(image)}" alt="" width="1024" height="1024">` : '';
  const svg = `<svg class="dp-svg" viewBox="0 0 ${TAILLE} ${TAILLE}" aria-hidden="true" focusable="false">${routesSvg()}${casesSvg(types, prochaine, estompeesSet)}</svg>`;

  const zones = Object.entries(ZONES).map(([, z]) => {
    const [x, y] = z.ancre;
    return `<span class="dp-zone" style="left:${((x / TAILLE) * 100).toFixed(3)}%;top:${((y / TAILLE) * 100).toFixed(3)}%;--zc:${z.couleur}" aria-hidden="true">${esc(z.nom)}</span>`;
  }).join('');

  const cases = POSITIONS.map(([x, y], i) => {
    const type = types[i] || 'vacances';
    const { nom } = libelleDe(type);
    const classes = ['dp-case', `dp-t-${esc(type)}`];
    if (i === prochaine) classes.push('is-prochaine');
    if (i === moi) classes.push('is-moi');
    if (estompeesSet.has(i)) classes.push('is-hors-voie');
    const etiquette = i === prochaine ? '<span class="dp-tag" aria-hidden="true">Prochaine case</span>' : '';
    return `<div class="${classes.join(' ')}" style="left:${x}%;top:${y}%" title="${esc(nom)}" role="img" aria-label="Case ${i}, ${esc(nom)}">${etiquette}</div>`;
  }).join('');

  // Pions : regroupés par case pour les décaler.
  const parCase = {};
  pions.forEach((p) => { (parCase[p.case] ||= []).push(p); });
  const pionsHtml = Object.entries(parCase).flatMap(([c, liste]) => {
    const pos = POSITIONS[Number(c)];
    if (!pos) return [];
    return liste.map((p, i) => {
      const { dx, dy } = decalage(i, liste.length);
      const couleur = /^#[0-9a-f]{6}$/i.test(p.couleur || '') ? p.couleur : '#F2EFEA';
      const libelle = `${p.pseudo || '?'}${p.invite ? ', invité' : ''}, case ${c}`;
      return `<div class="dp-pion${p.saut ? ' is-saut' : ''}" style="left:calc(${pos[0]}% + ${dx.toFixed(1)}px);top:calc(${pos[1]}% + ${dy.toFixed(1)}px)" role="img" aria-label="${esc(libelle)}">` +
        `<span class="dp-pion-disque" style="background:${couleur}" aria-hidden="true"><span>${esc(p.initiale || '?')}</span></span>` +
        `</div>`;
    });
  }).join('');

  return `<div class="dp-plan${image ? ' dp-plan--image' : ''}" role="group" aria-label="Chemin de vie">${fond}${svg}${zones}${cases}${pionsHtml}</div>`;
}

/** Légende des couleurs de cases (mêmes couleurs que le plan). */
export function legendeHtml() {
  return LEGENDE.map((type) => {
    const { lettre, nom } = libelleDe(type);
    const { fond, texte } = couleurDeType(type);
    return `<li class="dp-legende-item"><span class="dp-legende-puce" style="background:${fond};color:${texte}" aria-hidden="true">${esc(lettre)}</span>${esc(nom)}</li>`;
  }).join('');
}
