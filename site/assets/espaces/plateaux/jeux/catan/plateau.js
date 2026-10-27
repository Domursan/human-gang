// ===== Humane Gang — Catan du gang : le plateau en SVG (plateaux/jeux/catan/plateau.js) =====
/*
 * Rôle : dessine le plateau (19 tuiles, 54 sommets, 72 arêtes) en SVG : tuiles colorées par ressource, jetons avec
 *   les points de probabilité, voleur, colonies (petites maisons), villes (maisons plus grosses), routes.
 *   Les sommets, arêtes et tuiles désignés comme cibles sont des éléments focusables, avec un nom lisible.
 *   Ce module ne fait que du SVG : table.js choisit les cibles et gère les clics.
 *   Géométrie : repère d'un hexagone de rayon 1, pointe en haut (fournie par le serveur, hg_plat__catan_vue).
 * Dépendances : core.js (esc).
 * Exporte : RESSOURCES, pips(n), nomTuile(t), enumerer(liste), plateauSvg(opts) -> HTML (<svg>).
 *   opts = { geo, tuiles, voleur, colonies, villes, routes, couleurs: {uid: '#rrggbb'}, dernier, cibles: { sommets, aretes, hexes } }
 */
import { esc } from '../../../../commun/core.js';

/** Ressources : nom affiché, couleur de la tuile et couleur du texte posé dessus (le désert compris). */
export const RESSOURCES = {
  bois: { nom: 'bois', couleur: '#2F6B4A', texte: '#F2EFEA' },
  argile: { nom: 'argile', couleur: '#CF7055', texte: '#1A1412' },
  ble: { nom: 'blé', couleur: '#E2C77E', texte: '#1A1412' },
  mouton: { nom: 'mouton', couleur: '#B9C9A6', texte: '#1A1412' },
  pierre: { nom: 'pierre', couleur: '#5E6672', texte: '#F2EFEA' },
  desert: { nom: 'désert', couleur: '#C9B79C', texte: '#1A1412' },
};

const COULEUR = /^#[0-9a-f]{6}$/i;
const CREME = '#F2EFEA';
const NUMEROS_ROUGES = new Set([6, 8]);
/* Maison de référence (sommet à l'origine) : colonie = forme × 1, ville = forme × 1,4. */
const MAISON = [[-0.28, 0.24], [0.28, 0.24], [0.28, -0.04], [0, -0.3], [-0.28, -0.04]];

/** Points de probabilité d'un numéro : 7 et absent : 0 ; 6 et 8 : 5 ; 2 et 12 : 1. */
export function pips(n) { return n == null || n === 7 ? 0 : 6 - Math.abs(7 - n); }

/** Liste en français : « a, b et c ». */
export function enumerer(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

/** Nom d'une tuile pour un lecteur d'écran : « bois 6 », « désert ». */
export function nomTuile(t) {
  if (!t || t.res === 'desert' || t.num == null) return 'désert';
  return `${RESSOURCES[t.res]?.nom || t.res} ${t.num}`;
}

/** Points d'un polygone de maison, décalés par rapport au sommet (x, y) et mis à l'échelle k. */
const maisonPts = (x, y, k) => MAISON.map(([dx, dy]) => `${(x + dx * k).toFixed(3)},${(y + dy * k).toFixed(3)}`).join(' ');

/**
 * HTML SVG du plateau.
 * @param {object} opts voir l'en-tête du module.
 * @returns {string} HTML (<svg class="ct-svg">) ou un message si le plateau manque.
 */
export function plateauSvg({ geo, tuiles = [], voleur = null, colonies = {}, villes = {}, routes = {}, couleurs = {}, dernier = null, cibles = {} } = {}) {
  const hexes = geo?.hexes || [];
  const sommets = geo?.sommets || [];
  const aretes = geo?.aretes || [];
  if (!hexes.length || !sommets.length) return '<p class="ct-vide">Plateau indisponible.</p>';

  const S = new Map(sommets.map((s) => [s.id, s]));
  const H = new Map(hexes.map((h) => [h.id, h]));
  const ensemble = (liste) => new Set((liste || []).map(String));
  const cS = ensemble(cibles.sommets);
  const cA = ensemble(cibles.aretes);
  const cH = ensemble(cibles.hexes);
  const couleur = (uid) => (COULEUR.test(couleurs[uid] || '') ? couleurs[uid] : CREME);
  const tuile = (id) => tuiles[id] || { res: 'desert', num: null };
  const f = (n) => Number(n).toFixed(3);

  // Cadre : tout le plateau, avec une marge.
  const marge = 0.9;
  const xs = sommets.map((s) => s.x);
  const ys = sommets.map((s) => s.y);
  const x0 = Math.min(...xs) - marge;
  const y0 = Math.min(...ys) - marge;
  const largeur = Math.max(...xs) - x0 + marge;
  const hauteur = Math.max(...ys) - y0 + marge;

  /** Nom d'un sommet : les tuiles qui le touchent. */
  const nomSommet = (s) => `Sommet entre ${enumerer(s.hexes.map((id) => nomTuile(tuile(id))))}`;
  /** Nom d'une arête : les tuiles communes à ses deux extrémités. */
  const nomArete = (ar) => {
    const a = S.get(ar.a);
    const b = S.get(ar.b);
    const communes = a.hexes.filter((id) => b.hexes.includes(id)).map((id) => nomTuile(tuile(id)));
    return communes.length > 1 ? `entre ${enumerer(communes)}` : `au bord de ${communes[0] || 'le plateau'}`;
  };

  /* Tuiles : fond coloré, jeton avec le numéro et ses points, nom de la ressource, voleur. */
  const tuilesSvg = hexes.map((hx) => {
    const t = tuile(hx.id);
    const res = RESSOURCES[t.res] || RESSOURCES.desert;
    const pts = hx.sommets.map((id) => `${f(S.get(id).x)},${f(S.get(id).y)}`).join(' ');
    const cx = hx.x;
    const cy = hx.y;
    const nb = pips(t.num);
    const jeton = t.num == null ? '' :
      `<circle class="ct-jeton" cx="${f(cx)}" cy="${f(cy)}" r="0.4"/>` +
      `<text class="ct-num${NUMEROS_ROUGES.has(t.num) ? ' is-rouge' : ''}" x="${f(cx)}" y="${f(cy - 0.04)}" text-anchor="middle" dominant-baseline="central">${esc(t.num)}</text>` +
      Array.from({ length: nb }, (_, i) => `<circle class="ct-point" cx="${f(cx + (i - (nb - 1) / 2) * 0.1)}" cy="${f(cy + 0.22)}" r="0.03"/>`).join('');
    const nom = `<text class="ct-nom" x="${f(cx)}" y="${f(cy + (t.num == null ? 0.1 : 0.68))}" text-anchor="middle" dominant-baseline="central" fill="${res.texte}">${esc(res.nom)}</text>`;
    const pion = voleur === hx.id ? `<circle class="ct-voleur" cx="${f(cx + 0.5)}" cy="${f(cy - 0.5)}" r="0.2"/>` : '';
    const contenu = `<polygon class="ct-hex" points="${pts}" fill="${res.couleur}"/>${jeton}${nom}${pion}`;
    const nomCourt = t.res === 'desert' ? 'désert' : nomTuile(t);
    if (cH.has(String(hx.id))) {
      return `<g class="ct-cible" role="button" tabindex="0" data-hexe="${hx.id}" aria-label="${esc(`Poser le voleur sur ${nomCourt}`)}">` +
        `${contenu}<polygon class="ct-halo" points="${pts}"/></g>`;
    }
    return `<g role="img" aria-label="${esc(`Tuile ${nomCourt}${voleur === hx.id ? ', voleur posé dessus' : ''}`)}">${contenu}</g>`;
  }).join('');

  /* Routes : un trait à la couleur du joueur, sur un fond sombre ; cible : zone de clic de 0,84 unité de large (sans
     déborder sur l'arête voisine au milieu), et halo. */
  const routesSvg = aretes.map((ar) => {
    const a = S.get(ar.a);
    const b = S.get(ar.b);
    const coords = `x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}"`;
    const uid = routes[ar.id];
    const trait = uid != null
      ? `<line class="ct-route-fond" ${coords} stroke="#0E0E10" stroke-width="0.26" stroke-linecap="round"/>` +
        `<line class="ct-route" ${coords} stroke="${couleur(uid)}" stroke-width="0.16" stroke-linecap="round"/>`
      : '';
    if (!cA.has(String(ar.id))) return trait;
    return `${trait}<g class="ct-cible" role="button" tabindex="0" data-arete="${ar.id}" aria-label="${esc(`Route ${nomArete(ar)}`)}">` +
      `<line class="ct-zone" ${coords} stroke-width="0.84" stroke-linecap="round"/>` +
      `<line class="ct-halo" ${coords} stroke-width="0.12" stroke-linecap="round"/></g>`;
  }).join('');

  /* Colonies et villes : maisons à la couleur du joueur, la ville plus grande et bordée de crème. */
  const batimentsSvg = sommets.map((s) => {
    if (villes[s.id] != null) {
      return `<polygon class="ct-ville" points="${maisonPts(s.x, s.y, 1.4)}" fill="${couleur(villes[s.id])}"/>`;
    }
    if (colonies[s.id] != null) {
      return `<polygon class="ct-colonie" points="${maisonPts(s.x, s.y, 1)}" fill="${couleur(colonies[s.id])}"/>`;
    }
    return '';
  }).join('');

  /* Sommets cibles : zone de clic de 0,72 unité de rayon (environ 22 px sur un plateau de 360 px, soit 44 px de diamètre). */
  const sommetsSvg = sommets.filter((s) => cS.has(String(s.id))).map((s) =>
    `<g class="ct-cible ct-cible--sommet" role="button" tabindex="0" data-sommet="${s.id}" aria-label="${esc(nomSommet(s))}">` +
    `<circle class="ct-zone" cx="${f(s.x)}" cy="${f(s.y)}" r="0.72"/>` +
    `<circle class="ct-halo" cx="${f(s.x)}" cy="${f(s.y)}" r="0.24"/></g>`).join('');

  const dernierSvg = dernier != null && S.get(dernier)
    ? `<circle class="ct-dernier" cx="${f(S.get(dernier).x)}" cy="${f(S.get(dernier).y)}" r="0.44"/>` : '';

  return `<svg class="ct-svg" viewBox="${f(x0)} ${f(y0)} ${f(largeur)} ${f(hauteur)}" role="group" aria-label="Plateau de Catan du gang" focusable="false">` +
    `${tuilesSvg}${routesSvg}${batimentsSvg}${dernierSvg}${sommetsSvg}</svg>`;
}
