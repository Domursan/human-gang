// Accès aux pages (tables hg_pages / hg_page_access, rpc hg_my_pages).
// Contrôle d'INTERFACE : masque les liens et renvoie vers l'accueil. Les données restent protégées par les
// règles de la base. Les pages non déclarées dans hg_pages (compte, legal, assistance, rejoindre, admin…)
// ne sont pas concernées. En cas d'échec réseau, rien n'est bloqué.
/*
 * Rôle : sait quelles pages le membre connecté peut voir (réglages « accès aux pages » de l'administration),
 * pour construire le menu et renvoyer vers l'accueil une page interdite.
 * Page : toutes les pages (init.js charge la liste puis contrôle la page courante).
 * Dépendances : supabase.js (requêtes), profile.js (savoir si l'on est admin : accès total).
 * Données : table hg_pages (liste déclarée), RPC hg_my_pages (mes pages accessibles).
 * Exporte : currentPageSlug, loadMyPages, getMyPages, canAccess, pageLabel.
 */
import { sb, hasSession, isNavCancel } from './supabase.js';
import { getCachedProfile } from './profile.js';

/* ---------- État interne ---------- */

/** Données chargées : { declared: Map slug -> page déclarée, mine: liste de mes pages, set: slugs accessibles }. null = inconnu. */
let _pages = null; // { declared: Map slug -> {slug,label,mode,in_nav,sort}, mine: [{slug,label,in_nav,sort}], set: Set }
/** Promesse du chargement en cours, pour ne lancer qu'une seule requête à la fois. */
let _pagesLoading = null;
/** Forme d'un slug valide : minuscules, chiffres et tirets, sans point ni espace. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
/**
 * Extrait le slug d'un chemin, d'une URL ou d'un nom de fichier : retire la query, l'ancre, le dossier et « .html ».
 * @param {string|null|undefined} s Par exemple '/irl.html?x=1' ou 'irl'.
 * @returns {string} Par exemple 'irl'.
 */
const slugOf = (s) => String(s ?? '').split(/[?#]/)[0].split('/').pop().replace(/\.html$/, '');

/* ---------- Page courante ---------- */

/**
 * Slug de la page courante (nom du fichier sans .html ; 'accueil' pour la racine).
 * @returns {string} Par exemple 'irl' ou 'accueil'.
 */
export function currentPageSlug() { return slugOf(location.pathname) || 'accueil'; }

/* ---------- Chargement ---------- */

/**
 * Charge (une fois par page) les pages déclarées et mes pages accessibles. Ne jette jamais ; renvoie mes pages ou null.
 * Les appels suivants renvoient la même promesse, sauf avec { force: true }.
 * @param {{force?: boolean}} [options] force : recharge même si un chargement a déjà eu lieu.
 * @returns {Promise<Array<object>|null>} Mes pages, ou null si inconnues.
 */
export function loadMyPages({ force = false } = {}) {
  if (_pagesLoading && !force) return _pagesLoading;
  _pagesLoading = (async () => {
    try {
      if (!(await hasSession())) return getMyPages(); // sans session : rien à charger (hg_my_pages est réservée aux membres)
      const [all, mine] = await Promise.all([
        sb.from('hg_pages').select('slug, label, mode, in_nav, sort'),
        sb.rpc('hg_my_pages'),
      ]);
      if (all.error) throw all.error;
      if (mine.error) throw mine.error;
      // On ignore les entrées mal formées ; l'ordre d'affichage suit le champ sort
      const list = (Array.isArray(mine.data) ? mine.data : []).filter((p) => p && SLUG_RE.test(p.slug))
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      _pages = {
        declared: new Map((all.data ?? []).map((p) => [p.slug, p])),
        mine: list,
        set: new Set(list.map((p) => p.slug)),
      };
    } catch (e) {
      if (!isNavCancel(e)) console.warn('[accès aux pages]', e?.message || e);
      _pages = null; // accès inconnus : canAccess laissera tout passer
    }
    return getMyPages();
  })();
  return _pagesLoading;
}

/* ---------- Lecture ---------- */

/**
 * Mes pages accessibles [{slug,label,in_nav,sort}] triées, ou null si inconnues (non connecté, échec réseau).
 * Renvoie des copies : modifier le résultat ne change pas l'état.
 * @returns {Array<object>|null}
 */
export function getMyPages() { return _pages ? _pages.mine.map((p) => ({ ...p })) : null; }
/**
 * Ai-je accès à cette page ? (slug ou nom de fichier). true si la page n'est pas déclarée ou si les accès sont inconnus.
 * Un admin a toujours accès. Une page absente de hg_pages n'est jamais bloquée (compte, aide, légal...).
 * @param {string} slug Slug ou nom de fichier de la page.
 * @returns {boolean}
 */
export function canAccess(slug) {
  const s = slugOf(slug);
  if (!_pages || getCachedProfile()?.is_admin) return true;
  if (!_pages.declared.has(s)) return true;
  return _pages.set.has(s);
}
/**
 * Libellé d'une page déclarée (ou '').
 * @param {string} slug Slug ou nom de fichier de la page.
 * @returns {string}
 */
export function pageLabel(slug) { return _pages?.declared.get(slugOf(slug))?.label || ''; }
