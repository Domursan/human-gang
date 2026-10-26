// ===== Humane Gang — Navigation au clavier dans les grilles et les plans de jeu (flèches, Début, Fin) =====
/*
 * Rôle : deux aides sans dépendance pour les plateaux et grilles des duels et des jeux de plateau.
 *   - voisinGrille : pas à pas dans une grille lignes × colonnes (flèches, Début et Fin de ligne), en sautant les
 *     cases que l'appelant déclare non accessibles (désactivées).
 *   - voisinSpatial : élément le plus proche dans la direction de la flèche, d'après sa position à l'écran
 *     (territoires, intersections, cases en anneau, pièces d'un plan).
 *   L'appelant met le focus lui-même et garde un seul élément dans l'ordre de tabulation (roving tabindex).
 * Exporte : ECARTS, voisinGrille(touche, r, c, lignes, colonnes, accessible) -> [r, c] | null,
 *   voisinSpatial(touche, source, candidats) -> élément | null.
 */

/** Déplacement (ligne, colonne) par touche de direction. */
export const ECARTS = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/**
 * Case suivante dans une grille, en partant de (r, c) vers la touche donnée.
 * Flèches : première case accessible dans la direction. Début / Fin : première / dernière case accessible de la ligne.
 * @param {string} touche nom de la touche (ArrowUp…, Home, End).
 * @param {number} r ligne de départ.
 * @param {number} c colonne de départ.
 * @param {number} lignes nombre de lignes.
 * @param {number} colonnes nombre de colonnes.
 * @param {(r: number, c: number) => boolean} [accessible] vrai si la case peut recevoir le focus.
 * @returns {[number, number] | null} la case trouvée, ou null s'il n'y en a pas (le focus reste où il est).
 */
export function voisinGrille(touche, r, c, lignes, colonnes, accessible = () => true) {
  if (touche === 'Home' || touche === 'End') {
    const pas = touche === 'Home' ? 1 : -1;
    for (let k = touche === 'Home' ? 0 : colonnes - 1; k >= 0 && k < colonnes; k += pas) {
      if (accessible(r, k)) return [r, k];
    }
    return null;
  }
  const e = ECARTS[touche];
  if (!e) return null;
  let rr = r + e[0];
  let cc = c + e[1];
  while (rr >= 0 && rr < lignes && cc >= 0 && cc < colonnes) {
    if (accessible(rr, cc)) return [rr, cc];
    rr += e[0];
    cc += e[1];
  }
  return null;
}

/** Centre écran d'un élément, ou null s'il n'est pas affiché. */
function centre(el) {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Élément le plus proche dans la direction de la touche, d'après sa position à l'écran.
 * Une cible est dans la direction si son écart principal est positif ; on préfère les cibles droites devant
 * (écart latéral pénalisé deux fois).
 * @param {string} touche ArrowUp, ArrowDown, ArrowLeft ou ArrowRight.
 * @param {Element} source élément qui a le focus.
 * @param {Element[]} candidats éléments accessibles (le même ensemble que celui visé).
 * @returns {Element | null}
 */
export function voisinSpatial(touche, source, candidats) {
  const e = ECARTS[touche];
  const c0 = e && source ? centre(source) : null;
  if (!c0) return null;
  let meilleur = null;
  let score = Infinity;
  for (const el of candidats) {
    if (el === source) continue;
    const c = centre(el);
    if (!c) continue;
    const dx = c.x - c0.x;
    const dy = c.y - c0.y;
    const devant = e[0] * dy + e[1] * dx;
    if (devant <= 1) continue;
    const cote = Math.abs(e[0] ? dx : dy);
    const s = devant + 2 * cote;
    if (s < score) { score = s; meilleur = el; }
  }
  return meilleur;
}
