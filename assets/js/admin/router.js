// Admin : routage du panel. URL : admin.html#domaine/sous-section[/id[/onglet]]
// - Une ancienne ancre de section (#comptes, #cartes, #journal…) est redirigée vers sa sous-section (LEGACY, déduit de DOMAINS).
//   Un segment seul qui est une ancienne ancre l'emporte sur le domaine de même nom : #membres = Invitations, #cartes = Cartes.
// - #domaine/ (segment vide) = écran du domaine : sur mobile, la liste des sous-sections ; sur ordinateur, redirection
//   vers la première sous-section permise.
// - Un domaine ou une sous-section sans droit renvoie vers la première sous-section permise (ou null : aucun accès).
// - #reglages (ancienne ancre) mène au formulaire « Identité et textes » (#site/identite).
// - Les fiches membres (#comptes/<id>[/<onglet>], ancienne adresse) sont redirigées vers #membres/comptes/<id>[/<onglet>].
// Utilisé par admin/shell.js (resolve à chaque changement d'adresse). Dépend de admin/perms.js (DOMAINS, droits).
import { DOMAINS, visibleDomains } from './perms.js';

// Ancienne ancre -> route : la sous-section de même nom que la section, sinon la première qui la monte.
const LEGACY = {};
for (const d of DOMAINS) for (const s of d.subs) if (!LEGACY[s.section] || s.id === s.section) LEGACY[s.section] = `${d.id}/${s.id}`;
// Identifiants des domaines : un premier segment qui n'en est pas un peut être une ancienne ancre.
const DOMAIN_IDS = new Set(DOMAINS.map((d) => d.id));
// Adresses retirées : les comptes fantômes sont dans Comptes (#fantomes et #membres/fantomes[/<id>] suivent la liste).
// #reglages (ancienne ancre du formulaire « Identité et textes ») : première partie du formulaire ; la liste brute des clés
// garde sa route #site/reglages (« Clés avancées »).
const MOVED = { fantomes: 'membres/comptes', 'membres/fantomes': 'membres/comptes', reglages: 'site/identite' };

/** Première sous-section permise (« domaine/sous-section »), ou null si l'administrateur n'a aucun droit. */
export function defaultRoute() {
  const first = visibleDomains()[0];
  return first ? `${first.id}/${first.subs[0].id}` : null;
}

/** Décode une partie d'adresse ; si le codage est invalide (% mal formé), renvoie le texte tel quel. */
function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Découpe un fragment sans vérifier les droits.
 * @param {string} hash Fragment de l'adresse, avec ou sans « # ».
 * @returns {{raw: string, dom: string, sub?: string, id: string|null, tab: string|null}}
 */
export function parseHash(hash) {
  const raw = decodeSafe(String(hash || '').replace(/^#/, '')).trim();
  const [dom = '', sub, id, tab] = raw.split('/');
  return { raw, dom, sub, id: id || null, tab: tab || null };
}

/**
 * Résout le fragment courant.
 * Renvoie { redirect } (route vers laquelle remplacer le fragment, ou null : aucun accès), ou
 * { dom, sub, id, tab } (sub = null : écran du domaine sur mobile).
 * @param {string} hash Fragment de l'adresse.
 * @param {{mobile?: boolean}} [opts] mobile : vrai sous 760 px (l'écran du domaine est alors affiché).
 */
export function resolve(hash, { mobile = false } = {}) {
  const { raw, dom: a, sub: b, id, tab } = parseHash(hash);
  const fallback = defaultRoute();
  if (!raw) return { redirect: fallback };
  const moved = MOVED[b === undefined ? a : `${a}/${b}`];
  if (moved) return { redirect: [moved, id, tab].filter(Boolean).join('/') };
  if (b === undefined && LEGACY[a]) return { redirect: LEGACY[a] };
  // Ancienne ancre suivie de segments (#comptes/<id>/<onglet>) : mêmes segments sous la nouvelle route
  if (!DOMAIN_IDS.has(a) && LEGACY[a]) return { redirect: [LEGACY[a], b, id, tab].filter(Boolean).join('/') };
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
