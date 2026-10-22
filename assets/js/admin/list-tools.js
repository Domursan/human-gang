// Admin : outils communs des listes (recherche insensible aux accents et à la casse, compteur,
// état vide « Aucun résultat », « Afficher plus » par lots de 50).
// Utilisé par la plupart des sections (membres, badges, thèmes, cartes, bot…). Dépend de core.js (esc) et icons.js (loupe).
import { esc } from '../core.js';
import { svg } from '../icons.js';

// Lignes par lot (« Afficher plus ») et délai (ms) de la recherche après la dernière frappe.
export const PAGE_SIZE = 50;
export const SEARCH_DELAY = 150;

/** Texte replié : sans accents, en minuscules, espaces normalisés. */
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Vrai si chaque mot de la requête figure dans les champs (ordre indifférent). Requête vide : tout passe. */
export function matches(query, ...fields) {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = fold(fields.map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''))).join(' '));
  return words.every((w) => hay.includes(w));
}

/** Balisage du champ de recherche et de son compteur. */
export function searchHtml({ id, label, placeholder = 'Rechercher…', value = '', count = true, attrs = '' }) {
  return `<div class="lt-search">
    <label class="lt-label" for="${esc(id)}">${esc(label)}</label>
    <div class="lt-box">${svg('search', { stroke: 2 })}<input id="${esc(id)}" type="search" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(value)}" ${attrs}></div>
    ${count ? `<p class="small muted lt-count" id="${esc(id)}-count" aria-live="polite"></p>` : ''}
  </div>`;
}

/** Insère le champ de recherche juste avant `anchor` ; renvoie les éléments utiles. */
export function mountSearch(anchor, opts) {
  const wrap = document.createElement('div');
  wrap.innerHTML = searchHtml(opts);
  const root = wrap.firstElementChild;
  anchor.parentNode.insertBefore(root, anchor);
  return { input: root.querySelector('input'), count: root.querySelector('.lt-count') };
}

/** Relie la saisie au filtre : appel différé de SEARCH_DELAY ms, valeur passée à onQuery (texte brut). */
export function bindSearch(input, onQuery, delay = SEARCH_DELAY) {
  let t = 0;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => onQuery(input.value), delay);
  });
}

/** Compteur : « 3 résultats sur 12 » pendant une recherche, « 12 idées » sinon. */
export function setCount(el, shown, total, query, [one, many]) {
  if (!el) return;
  if (fold(query)) el.textContent = `${shown} résultat${shown > 1 ? 's' : ''} sur ${total} ${total > 1 ? many : one}`;
  else el.textContent = `${total} ${total > 1 || total === 0 ? many : one}`;
}

/** État vide : « Aucun résultat » pendant une recherche, sinon le message d'origine. */
export function emptyHtml(query, message) {
  return fold(query)
    ? `<div class="empty">Aucun résultat pour « ${esc(String(query).trim())} ».</div>`
    : `<div class="empty">${message}</div>`;
}

/** Bouton « Afficher plus » quand il reste des lignes à montrer. */
export function moreHtml(id, shown, total, attrs = '') {
  if (shown >= total) return '';
  return `<div class="lt-more"><button class="btn btn-ghost btn-sm" type="button" id="${esc(id)}" ${attrs}>Afficher plus (${total - shown} restant${total - shown > 1 ? 's' : ''})</button></div>`;
}
