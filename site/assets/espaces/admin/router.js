// Admin : routage du panel. URL : /pages/admin/admin.html#plateau, #<lieu>, #<lieu>/<sous-section>[/id[/onglet]]
// - #plateau : l'accueil (route par défaut). #<lieu> (ex. #fabrique) : la page du lieu. #<lieu>/<sous-section> : la page.
// - Un lieu ou une sous-section sans droit renvoie vers la première route permise (ou null : aucun accès).
// - Anciennes adresses par domaine (avant le plateau : #pilotage/…, #membres/…, #irl/…, #event/…, #cartes/…, #jeux/…) :
//   la sous-section est cherchée par son identifiant dans tous les lieux (les identifiants sont uniques). L'id et l'onglet
//   suivent. ALIAS_SUB donne les identifiants renommés (bataille → arene).
// - Anciennes ancres de section (#comptes, #cartes, #journal, #membres = Invitations…) : redirigées vers leur sous-section (LEGACY).
// - MOVED : adresses retirées ou déplacées (#apercu → plateau, #reglages → identité, fiches fantômes → Comptes).
// Utilisé par admin/shell.js (resolve à chaque changement d'adresse). Dépend de admin/perms.js (LIEUX, droits).
import { LIEUX, visibleLieux } from './perms.js';

// Identifiants de sous-section renommés : ancien -> nouveau (les adresses déjà partagées restent valables).
const ALIAS_SUB = { bataille: 'arene' };

// Anciens domaines (avant le plateau) : leur premier segment n'est plus un lieu, la sous-section suit.
const OLD_DOMAINS = new Set(['pilotage', 'membres', 'irl', 'event', 'cartes', 'jeux']);

// Ancienne ancre -> route : la sous-section de même nom que la section, sinon la première qui la monte.
const LEGACY = {};
for (const l of LIEUX) for (const s of l.subs) if (!LEGACY[s.section] || s.id === s.section) LEGACY[s.section] = `${l.id}/${s.id}`;

// Adresses retirées ou déplacées : ancien fragment -> nouvelle route (id et onglet suivent).
// #reglages (ancienne ancre du formulaire « Identité et textes ») : première partie du formulaire ; la liste brute des clés
// garde son identifiant (#mairie/reglages, « Clés avancées »). Les fiches fantômes sont dans Comptes.
const MOVED = {
  apercu: 'plateau', 'pilotage/apercu': 'plateau',
  fantomes: 'place/comptes', 'membres/fantomes': 'place/comptes', 'place/fantomes': 'place/comptes',
  reglages: 'mairie/identite',
};

/** Première route permise (« plateau »), ou null si l'administrateur n'a aucun lieu accessible. */
export function defaultRoute() {
  return visibleLieux().length ? 'plateau' : null;
}

/** Décode une partie d'adresse ; si le codage est invalide (% mal formé), renvoie le texte tel quel. */
function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Découpe un fragment sans vérifier les droits.
 * @param {string} hash Fragment de l'adresse, avec ou sans « # ».
 * @returns {{raw: string, dom: string, sub?: string, id: string|null, tab: string|null}} dom = premier segment (lieu ou ancien domaine).
 */
export function parseHash(hash) {
  const raw = decodeSafe(String(hash || '').replace(/^#/, '')).trim();
  const [dom = '', sub, id, tab] = raw.split('/');
  return { raw, dom, sub, id: id || null, tab: tab || null };
}

/**
 * Résout le fragment courant.
 * Renvoie { redirect } (route vers laquelle remplacer le fragment, ou null : aucun accès), { plateau: true },
 * ou { lieu, sub?, id, tab } (sub absent : la page du lieu).
 * @param {string} hash Fragment de l'adresse.
 */
export function resolve(hash) {
  const { raw, dom: a, sub: b, id, tab } = parseHash(hash);
  const fallback = defaultRoute();
  if (!raw) return { redirect: fallback };
  if (a === 'plateau') return { plateau: true };
  const moved = MOVED[b === undefined ? a : `${a}/${b}`];
  if (moved) return { redirect: [moved, id, tab].filter(Boolean).join('/') };
  const lieu = visibleLieux().find((l) => l.id === a);
  if (!lieu) {
    if (b === undefined && LEGACY[a]) return { redirect: LEGACY[a] };                 // #membres, #journal…
    if (!OLD_DOMAINS.has(a) && LEGACY[a]) return { redirect: [LEGACY[a], b, id, tab].filter(Boolean).join('/') }; // #comptes/<id>
    return redirectTo(findSub(b), id, tab, fallback);                                // #pilotage/x, #membres/x…
  }
  if (!b) return { lieu };
  const sub = lieu.subs.find((s) => s.id === b);
  if (!sub) return redirectTo(findSub(b), id, tab, fallback);
  return { lieu, sub, id, tab };
}

/** Sous-section permise d'identifiant `subId` (ou renommée via ALIAS_SUB), dans n'importe quel lieu visible ; sinon null. */
function findSub(subId) {
  if (!subId) return null;
  const want = ALIAS_SUB[subId] || subId;
  for (const lieu of visibleLieux()) {
    const sub = lieu.subs.find((x) => x.id === want);
    if (sub) return { lieu, sub };
  }
  return null;
}

/** Redirection d'une ancienne adresse vers la sous-section trouvée (segments id/onglet conservés), ou vers la première permise. */
function redirectTo(hit, id, tab, fallback) {
  if (!hit) return { redirect: fallback };
  return { redirect: [`${hit.lieu.id}/${hit.sub.id}`, id, tab].filter(Boolean).join('/') };
}
