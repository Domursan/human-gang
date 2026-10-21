// Admin : routage du panel. URL : admin.html#domaine/sous-section[/id[/onglet]]
// - Une ancienne ancre de section (#comptes, #cartes, #journal…) est redirigée vers sa sous-section (LEGACY, déduit de DOMAINS).
//   Un segment seul qui est une ancienne ancre l'emporte sur le domaine de même nom : #membres = Invitations, #cartes = Cartes.
// - #domaine/ (segment vide) = écran du domaine : sur mobile, la liste des sous-sections ; sur ordinateur, redirection
//   vers la première sous-section permise.
// - Un domaine ou une sous-section sans droit renvoie vers la première sous-section permise (ou null : aucun accès).
import { DOMAINS, visibleDomains } from './perms.js';

// Ancienne ancre -> route : la sous-section de même nom que la section, sinon la première qui la monte.
const LEGACY = {};
for (const d of DOMAINS) for (const s of d.subs) if (!LEGACY[s.section] || s.id === s.section) LEGACY[s.section] = `${d.id}/${s.id}`;

/** Première sous-section permise, ou null. */
export function defaultRoute() {
  const first = visibleDomains()[0];
  return first ? `${first.id}/${first.subs[0].id}` : null;
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Découpe un fragment sans vérifier les droits. */
export function parseHash(hash) {
  const raw = decodeSafe(String(hash || '').replace(/^#/, '')).trim();
  const [dom = '', sub, id, tab] = raw.split('/');
  return { raw, dom, sub, id: id || null, tab: tab || null };
}

/**
 * Résout le fragment courant.
 * Renvoie { redirect } (route vers laquelle remplacer le fragment, ou null : aucun accès), ou
 * { dom, sub, id, tab } (sub = null : écran du domaine sur mobile).
 */
export function resolve(hash, { mobile = false } = {}) {
  const { raw, dom: a, sub: b, id, tab } = parseHash(hash);
  const fallback = defaultRoute();
  if (!raw) return { redirect: fallback };
  if (b === undefined && LEGACY[a]) return { redirect: LEGACY[a] };
  const visible = visibleDomains().find((d) => d.id === a);
  if (!visible) return { redirect: fallback };
  if (!b) {
    if (mobile) return { dom: visible, sub: null, id: null, tab: null };
    return { redirect: `${visible.id}/${visible.subs[0].id}` };
  }
  const sub = visible.subs.find((s) => s.id === b);
  if (!sub) return { redirect: fallback };
  return { dom: visible, sub, id, tab };
}
