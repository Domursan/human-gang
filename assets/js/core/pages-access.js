// Accès aux pages (tables hg_pages / hg_page_access, rpc hg_my_pages).
// Contrôle d'INTERFACE : masque les liens et renvoie vers l'accueil. Les données restent protégées par les
// règles de la base. Les pages non déclarées dans hg_pages (compte, legal, assistance, rejoindre, admin…)
// ne sont pas concernées. En cas d'échec réseau, rien n'est bloqué.
import { sb } from './supabase.js';
import { getCachedProfile } from './profile.js';

let _pages = null; // { declared: Map slug -> {slug,label,mode,in_nav,sort}, mine: [{slug,label,in_nav,sort}], set: Set }
let _pagesLoading = null;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const slugOf = (s) => String(s ?? '').split(/[?#]/)[0].split('/').pop().replace(/\.html$/, '');

/** Slug de la page courante (nom du fichier sans .html ; 'accueil' pour la racine). */
export function currentPageSlug() { return slugOf(location.pathname) || 'accueil'; }

/** Charge (une fois par page) les pages déclarées et mes pages accessibles. Ne jette jamais ; renvoie mes pages ou null. */
export function loadMyPages({ force = false } = {}) {
  if (_pagesLoading && !force) return _pagesLoading;
  _pagesLoading = (async () => {
    try {
      const [all, mine] = await Promise.all([
        sb.from('hg_pages').select('slug, label, mode, in_nav, sort'),
        sb.rpc('hg_my_pages'),
      ]);
      if (all.error) throw all.error;
      if (mine.error) throw mine.error;
      const list = (Array.isArray(mine.data) ? mine.data : []).filter((p) => p && SLUG_RE.test(p.slug))
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      _pages = {
        declared: new Map((all.data ?? []).map((p) => [p.slug, p])),
        mine: list,
        set: new Set(list.map((p) => p.slug)),
      };
    } catch (e) {
      console.warn('[accès aux pages]', e?.message || e);
      _pages = null;
    }
    return getMyPages();
  })();
  return _pagesLoading;
}
/** Mes pages accessibles [{slug,label,in_nav,sort}] triées, ou null si inconnues (non connecté, échec réseau). */
export function getMyPages() { return _pages ? _pages.mine.map((p) => ({ ...p })) : null; }
/** Ai-je accès à cette page ? (slug ou nom de fichier). true si la page n'est pas déclarée ou si les accès sont inconnus. */
export function canAccess(slug) {
  const s = slugOf(slug);
  if (!_pages || getCachedProfile()?.is_admin) return true;
  if (!_pages.declared.has(s)) return true;
  return _pages.set.has(s);
}
/** Libellé d'une page déclarée (ou ''). */
export function pageLabel(slug) { return _pages?.declared.get(slugOf(slug))?.label || ''; }
