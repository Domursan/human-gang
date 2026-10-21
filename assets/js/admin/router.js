// Admin : adresse de la page. #section, #comptes/<membre>[/<onglet>], #cartes/<onglet>.
// Les liens et le bouton Précédent ouvrent l'adresse (hashchange) ; les clics dans une fiche ou un onglet
// mettent l'adresse à jour sans entrée d'historique (replaceState).
import { closeDetail } from '../admin-accounts/inspect.js';
import { A } from '../admin-accounts/state.js';
import { mountSection, isReady, openFiche, setHash, fichePath } from './mounts.js';

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
export function parseHash(h = location.hash) {
  const parts = h.replace(/^#/, '').split('/').map(decode).filter(Boolean);
  return { id: parts[0] || 'apercu', rest: parts.slice(1) };
}

/** Ouvre une adresse (palette, liens) : déclenche hashchange, ou ouvre directement si l'adresse ne change pas. */
export function go(path) {
  if (location.hash === '#' + path) return route();
  location.hash = path;
  return undefined;
}

/** Applique l'adresse courante : monte la section, ouvre la fiche ou l'onglet demandé, puis fait défiler jusqu'à la section. */
export async function route() {
  const { id, rest } = parseHash();
  const sec = document.getElementById(id);
  if (!sec || sec.hidden) return;
  if (id === 'comptes' && rest[0]) {
    await openFiche(rest[0], rest[1] || 'profil');
    return;
  }
  if (id === 'cartes' && rest[0]) {
    await mountSection('cartes');
    document.querySelector(`#cards-root .acd-tabs [data-tab="${CSS.escape(rest[0])}"]`)?.click();
  } else {
    await mountSection(id);
    if (id === 'comptes' && A.uid) closeDetail();
  }
  sec.scrollIntoView({ block: 'start' });
}

/* Clics et saisies dans les sections : l'adresse suit la fiche ouverte et l'onglet choisi */
function syncComptes() {
  if (!isReady('comptes')) return;
  const cur = location.hash.slice(1);
  if (!A.uid && !cur.startsWith('comptes')) return; // on ne quitte pas une autre section pour la liste
  const want = A.uid ? fichePath(A.uid, A.tab) : 'comptes';
  if (cur !== want) setHash(want);
}
function syncCartes() {
  const on = document.querySelector('#cards-root .acd-tabs [aria-pressed="true"]');
  if (on?.dataset.tab) setHash(`cartes/${on.dataset.tab}`);
}
// Le chemin de l'événement est lu au moment du clic : un clic sur une ligne remplace le contenu de la section
// (la ligne n'est plus dans le document quand l'événement remonte jusqu'ici).
const inPath = (e, pred) => e.composedPath().some((n) => n instanceof Element && pred(n));
const inComptes = (n) => n.id === 'comptes' || n.classList.contains('insp-bar');
const inCartesTabs = (n) => n.classList.contains('acd-tabs') && n.closest('#cartes');
function onClick(e) {
  if (inPath(e, inComptes)) syncComptes();
  else if (inPath(e, inCartesTabs)) syncCartes();
}
function onKey(e) {
  if (inPath(e, (n) => n.id === 'comptes')) syncComptes();
}

/** Branche la navigation par adresse et ouvre l'adresse de départ. */
export function startRouter() {
  window.addEventListener('hashchange', () => { route(); });
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  return route();
}
