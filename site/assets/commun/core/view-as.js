// Vue « comme un membre » (admin) : l'admin voit le site avec les pages et les menus d'un membre, sans changer de compte.
/*
 * Rôle : garde la vue dans sessionStorage « hg_view_as » (même onglet) ; dit si elle s'applique à la page courante ;
 * affiche le bandeau « Tu vois le site comme … » ; lance la vue depuis la fiche d'un membre (rpc hg_admin_view_as).
 * Les données restent celles de l'admin : la base contrôle tout, ce module ne change que l'interface.
 * Règles : la clé n'est gardée que si le profil connecté est admin ; sur le panel (/pages/admin/admin.html) elle est effacée.
 * Page : toutes les pages (init.js résout la vue au chargement ; pages-access.js et header.js la lisent) ;
 *   admin-accounts/fiche.js (bouton « Voir le site comme… »).
 * Dépendances : supabase.js (rpc), util.js (esc).
 * Stockage : sessionStorage « hg_view_as » = { id, pseudo, is_admin, pages: [{slug,label,in_nav,sort}], roles }.
 *   Toute lecture et écriture est protégée : stockage bloqué = pas de vue.
 * Exporte : startViewAs, resolveViewAs, viewAsActive, viewAsState, renderViewAsBar.
 */
import { sb } from './supabase.js';
import { esc } from './util.js';

/** Clé sessionStorage de la vue (propre à l'onglet). */
const KEY = 'hg_view_as';
/** Forme d'un slug de page valide (comme pages-access.js). */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
/** Vue active sur cette page, ou null. */
let _state = null;

/* ---------- Stockage ---------- */

/** Lit la vue gardée (brute). Null si absente ou illisible. */
function readStore() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
}
/** Efface la vue gardée. */
function clearStore() {
  try { sessionStorage.removeItem(KEY); } catch { /* stockage bloqué : rien à effacer */ }
}
/**
 * Met la réponse du serveur dans la forme attendue (pages triées, champs contrôlés). Null si la réponse est inutilisable.
 * @param {any} v Réponse de hg_admin_view_as ou contenu de la clé.
 * @returns {{id: string, pseudo: string, is_admin: boolean, pages: object[], roles: string[]}|null}
 */
function normalize(v) {
  if (!v || typeof v.id !== 'string' || typeof v.pseudo !== 'string') return null;
  const pages = (Array.isArray(v.pages) ? v.pages : [])
    .filter((p) => p && typeof p.slug === 'string' && SLUG_RE.test(p.slug))
    .map((p) => ({ slug: p.slug, label: String(p.label ?? p.slug), in_nav: !!p.in_nav, sort: Number(p.sort) || 0 }))
    .sort((a, b) => a.sort - b.sort);
  return { id: v.id, pseudo: v.pseudo, is_admin: !!v.is_admin, pages, roles: Array.isArray(v.roles) ? v.roles : [] };
}

/* ---------- État sur la page ---------- */

/** Vrai sur le panel d'administration : la vue y prend fin (l'admin y retrouve ses droits). */
const surLePanel = () => (location.pathname.split('/').pop() || '').replace(/\.html$/, '') === 'admin';

/**
 * Décide si la vue s'applique à cette page. À appeler une fois, dès que le profil est connu (init.js).
 * Une clé posée par un non-admin, ou restée sur le panel, est effacée.
 * @param {object|null} profile Profil connecté (null pour un visiteur).
 * @returns {object|null} La vue active, ou null.
 */
export function resolveViewAs(profile) {
  _state = null;
  if (!readStore()) return null;
  if (!profile?.is_admin || surLePanel()) { clearStore(); return null; }
  _state = normalize(readStore());
  if (!_state) clearStore();
  return _state;
}

/**
 * La vue « comme un membre » s'applique-t-elle à cette page ?
 * @returns {boolean}
 */
export function viewAsActive() { return _state !== null; }

/**
 * Copie de la vue active (pseudo, pages du membre…), ou null.
 * @returns {object|null}
 */
export function viewAsState() {
  return _state ? { ..._state, pages: _state.pages.map((p) => ({ ...p })), roles: [..._state.roles] } : null;
}

/* ---------- Lancer et arrêter ---------- */

/**
 * Lance la vue « comme un membre » pour ce membre : la base renvoie ses pages, la vue est gardée, puis le site s'ouvre
 * dans le même onglet. Jette une erreur lisible en cas d'échec (rpc refusée, réponse inutilisable, stockage bloqué).
 * @param {string} uid Identifiant du membre.
 */
export async function startViewAs(uid) {
  const { data, error } = await sb.rpc('hg_admin_view_as', { p_user: uid });
  if (error) throw error;
  const v = normalize(data);
  if (!v) throw new Error('Réponse inattendue du serveur.');
  try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { throw new Error('Impossible de garder la vue : le stockage du navigateur est bloqué.'); }
  location.href = '/pages/compte/accueil.html';
}

/* ---------- Bandeau ---------- */

/**
 * Affiche le bandeau fixe en haut de la page quand la vue est active (sinon ne fait rien).
 * Le contenu est décalé de la hauteur du bandeau (--va-h, html[data-view-as]). « Revenir au panel » efface la vue.
 */
export function renderViewAsBar() {
  if (!_state) return;
  const bar = document.createElement('div');
  bar.className = 'view-as-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `<p class="view-as-msg">Tu vois le site comme <strong>${esc(_state.pseudo)}</strong> · les pages et les menus sont les siens, les données restent les tiennes</p>
    <a class="view-as-back" href="/pages/admin/admin.html#membres/comptes">Revenir au panel</a>`;
  bar.querySelector('.view-as-back').addEventListener('click', clearStore);
  document.body.prepend(bar);
  document.documentElement.dataset.viewAs = 'on';
  const fit = () => document.documentElement.style.setProperty('--va-h', `${bar.offsetHeight}px`);
  fit();
  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(bar);
}
