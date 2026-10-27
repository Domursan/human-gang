// ===== Paillettes : icône, formatage et pastille de solde (compteur LCD 7 segments) =====
// Toutes les fonctions renvoient du HTML à insérer par innerHTML ; les chiffres réels restent
// lisibles par les lecteurs d'écran (texte masqué visuellement), les segments sont décoratifs.
// Styles : assets/css/cartes.css (section « Paillettes »).
/*
 * Rôle : la monnaie du site (les « Paillettes ») s'affiche de trois façons : icône, nombre formaté, ou afficheur
 * 7 segments animé (pastille de solde, avec variation « +N » et clignotement au gain).
 * Page : /pages/cartes/cartes.html (utilisé par cartes.js : solde et affichage des gains).
 * Dépendances : aucune (HTML pur + Intl pour le format des nombres).
 * Exporte : paillettesIcon, fmtPaillettes, lcdNumHtml, pastilleHtml, lcdSet, lcdBlink, lcdDelta.
 */

/* ---------- Format des nombres ---------- */

/** Format des nombres à la suisse (espace comme séparateur de milliers). */
const nf = new Intl.NumberFormat('fr-CH');

/** Icône C « style pop » : étoile à quatre pointes droites, aplat jaune, contour noir épais. */
export function paillettesIcon(size = null) {
  const pts = '50,0 61,39 100,50 61,61 50,100 39,61 0,50 39,39';
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg class="paill-svg"${dim} viewBox="-6 -6 112 112" aria-hidden="true" focusable="false">`
    + `<polygon points="${pts}" transform="translate(6 6)" fill="#FE3104" stroke="#000" stroke-width="6" stroke-linejoin="round"/>`
    + `<polygon points="${pts}" fill="#FBD32D" stroke="#000" stroke-width="6" stroke-linejoin="round"/>`
    + '<line x1="50" y1="18" x2="50" y2="34" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>';
}

/** Nombre de Paillettes formaté (fr-CH) suivi de l'icône. Libellé accessible : « N Paillettes ». */
export function fmtPaillettes(n, { icon = true } = {}) {
  const txt = nf.format(Number(n) || 0);
  return `<span class="paill" role="img" aria-label="${txt} Paillettes">`
    + `<span class="paill-n" aria-hidden="true">${txt}</span>`
    + (icon ? `<span class="paill-ic" aria-hidden="true">${paillettesIcon()}</span>` : '')
    + '</span>';
}

/* ---------- Afficheur 7 segments ---------- */

// Afficheur 7 segments : segments allumés par chiffre, géométrie 20 × 34 (reprise de la maquette « solde »).
/** Segments allumés par chiffre (lettres de a à g, voir SEGR). */
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
/** Position de chaque segment dans le viewBox 20 × 34 : [x, y, largeur, hauteur]. */
const SEGR = { a: [3, 0, 14, 3], b: [17, 3, 3, 13], c: [17, 18, 3, 13], d: [3, 31, 14, 3], e: [0, 18, 3, 13], f: [0, 3, 3, 13], g: [3, 15, 14, 3] };
/** Hauteur (px) et taille de l'icône pour chaque taille de pastille : 'lg' (en-tête) ou 'sm' (bouton). */
const SIZES = { lg: { h: 40, ic: 40 }, sm: { h: 20, ic: 20 } };

/**
 * Un chiffre en 7 segments : les 7 segments éteints, puis ceux qui doivent être allumés par-dessus.
 * @param {string} ch Chiffre (0 à 9) ; un autre caractère donne un chiffre éteint.
 * @param {number} h Hauteur du chiffre en px.
 * @returns {string} SVG du chiffre.
 */
function digitSvg(ch, h) {
  const on = SEG[ch] || '';
  let s = `<svg class="lcd-dg" viewBox="0 0 20 34" style="width:${(h * 20 / 34).toFixed(2)}px;height:${h}px" aria-hidden="true" focusable="false">`;
  for (const k of Object.keys(SEGR)) { const r = SEGR[k]; s += `<rect class="lcd-off" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}"/>`; }
  for (const k of on) { const r = SEGR[k]; s += `<rect class="lcd-on" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}"/>`; }
  return s + '</svg>';
}

/** Chiffres seuls (segments). Tout caractère non numérique (séparateur de milliers) devient un espace. */
export function lcdNumHtml(n, h) {
  const txt = nf.format(Math.max(0, Math.round(Number(n) || 0)));
  return [...txt].map((ch) => (/\d/.test(ch) ? digitSvg(ch, h) : `<span class="lcd-sep" style="width:${(h * 0.42).toFixed(2)}px"></span>`)).join('');
}

/** Pastille de solde. size : 'lg' (en-tête, avec étiquette) ou 'sm' (dans un bouton). */
export function pastilleHtml(n, { size = 'lg', id = '' } = {}) {
  const c = SIZES[size] || SIZES.lg;
  const txt = nf.format(Math.max(0, Math.round(Number(n) || 0)));
  return `<span class="lcd lcd-${size}"${id ? ` id="${id}"` : ''}>`
    + `<span class="lcd-ic" aria-hidden="true">${paillettesIcon(c.ic)}</span>`
    + '<span class="lcd-col">'
    + (size === 'lg' ? '<span class="lcd-lab" aria-hidden="true">Paillettes</span>' : '')
    + `<span class="lcd-num" aria-hidden="true" data-h="${c.h}">${lcdNumHtml(n, c.h)}</span>`
    + '</span>'
    + `<span class="visually-hidden">${txt} Paillettes</span></span>`;
}

/** Met à jour les chiffres et le texte lu par les lecteurs d'écran d'une pastille déjà affichée. */
export function lcdSet(el, n) {
  const num = el?.querySelector?.('.lcd-num');
  if (!num) return;
  num.innerHTML = lcdNumHtml(n, Number(num.dataset.h) || SIZES.lg.h);
  const hid = el.querySelector('.visually-hidden');
  if (hid) hid.textContent = `${nf.format(Math.max(0, Math.round(Number(n) || 0)))} Paillettes`;
}

/** Fait clignoter une fois les segments allumés (à appeler avant un palier de gain). */
export function lcdBlink(el) {
  const num = el?.querySelector?.('.lcd-num');
  if (!num) return;
  num.classList.remove('is-blink');
  void num.offsetWidth; // redémarre l'animation
  num.classList.add('is-blink');
  setTimeout(() => num.classList.remove('is-blink'), 420);
}

/** Affiche « +N » qui monte puis s'estompe au-dessus de la pastille (décoratif). */
export function lcdDelta(el, d) {
  if (!el || !(d > 0)) return;
  const s = document.createElement('span');
  s.className = 'lcd-delta';
  s.setAttribute('aria-hidden', 'true');
  s.textContent = `+${nf.format(d)}`;
  el.append(s);
  setTimeout(() => s.remove(), 1300);
}
