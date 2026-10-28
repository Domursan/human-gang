// Mémoire d'affichage : valeurs du compte gardées dans sessionStorage, pour afficher l'en-tête et le menu tout de suite.
/*
 * Rôle : garde (par compte, dans l'onglet) le profil, les pages accessibles, les droits du panel et l'état du mode
 * sans limite, pendant une durée courte (10 minutes sans relecture). Au démarrage d'une page, init.js s'en sert
 * pour afficher tout de suite, puis relit la base en arrière-plan et met l'affichage à jour.
 * Règles de sécurité : cette mémoire ne sert QU'À l'affichage. Aucune décision d'accès côté serveur ne s'appuie
 * dessus : la base contrôle tout (RPC, règles de table). Une redirection décidée d'après la mémoire n'arrive qu'à
 * l'affichage ; la relecture en arrière-plan la rattrape.
 * Vue « comme un membre » (view-as.js) : pendant cette vue, rien n'est lu ni écrit pour les pages et le mode
 * sans limite, qui sont ceux du membre et non ceux de l'admin ; le profil et les droits (ceux de l'admin) restent gardés.
 * Changement de compte ou déconnexion : les valeurs d'un autre compte ne sont jamais lues (clé par compte), et
 * memoEffacer() retire tout (appelée par signOutDevice dans supabase.js et par clearPerms).
 * Page : toutes les pages (init.js, profile.js, pages-access.js, perms.js, godmode.js).
 * Dépendances : aucune (module feuille, pour éviter les cycles d'import).
 * Stockage : sessionStorage « hg_memo:<identifiant du compte> » = { champ: { t: heure d'écriture (ms), v: valeur } }.
 *   Toute lecture et écriture est protégée : stockage bloqué = pas de mémoire (le site reste correct).
 * Exporte : MEMO_VALIDITE_MS, memoCompte, memoCompteCourant, memoLire, memoEcrire, memoOublier, memoEffacer, vueActive.
 */

/** Préfixe des clés sessionStorage (une clé par compte). */
const PREFIXE = 'hg_memo:';
/** Clé de l'ancien cache des droits (perms.js) : nettoyée avec la mémoire. */
const ANCIENNE_CLE_DROITS = 'hg_my_perms';
/** Durée de validité d'une valeur sans relecture : 10 minutes. */
export const MEMO_VALIDITE_MS = 10 * 60 * 1000;
/** Champs qui dépendent de la vue « comme un membre » : jamais écrits pendant cette vue. */
const CHAMPS_PAR_VUE = new Set(['pages', 'god']);

/** Compte courant (identifiant), fixé par init.js au démarrage de chaque page. Null pour un visiteur. */
let _compte = null;

/* ---------- Stockage ---------- */

/**
 * Lit toute la mémoire d'un compte. Renvoie {} si absente ou illisible.
 * @param {string} uid Identifiant du compte.
 * @returns {object}
 */
function lireTout(uid) {
  try { const v = JSON.parse(sessionStorage.getItem(PREFIXE + uid) || 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
/**
 * Écrit toute la mémoire d'un compte. Un échec n'est pas grave : la page relit la base.
 * @param {string} uid Identifiant du compte.
 * @param {object} v Contenu à garder.
 */
function ecrireTout(uid, v) {
  try { sessionStorage.setItem(PREFIXE + uid, JSON.stringify(v)); } catch { /* stockage bloqué : pas de mémoire */ }
}

/* ---------- Vue « comme un membre » ---------- */

/**
 * La vue « comme un membre » est-elle gardée dans cet onglet ? Lit la clé de view-as.js (sans l'importer, pour rester feuille).
 * @returns {boolean}
 */
export function vueActive() {
  try { return sessionStorage.getItem('hg_view_as') !== null; } catch { return false; }
}

/* ---------- Compte courant ---------- */

/**
 * Indique le compte de cette page. Efface les valeurs d'un autre compte ; sans compte (visiteur), efface tout.
 * @param {string|null} uid Identifiant du compte connecté, ou null.
 */
export function memoCompte(uid) {
  if (!uid) { memoEffacer(); return; }
  _compte = uid;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIXE) && k !== PREFIXE + uid) sessionStorage.removeItem(k);
    }
  } catch { /* stockage bloqué : sans objet */ }
}
/**
 * Identifiant du compte courant (ou null).
 * @returns {string|null}
 */
export function memoCompteCourant() { return _compte; }

/* ---------- Lecture et écriture ---------- */

/**
 * Valeur gardée pour un champ, si elle est encore fraîche (moins de 10 minutes depuis sa dernière relecture).
 * Renvoie undefined si absente, périmée, d'un autre compte, ou pendant une vue « comme un membre ».
 * @param {string} champ Nom du champ (profil, pages, perms, god…).
 * @returns {any|undefined} Une copie de la valeur (la modifier ne change pas la mémoire).
 */
export function memoLire(champ) {
  if (!_compte || vueActive()) return undefined;
  const e = lireTout(_compte)[champ];
  if (!e || typeof e.t !== 'number') return undefined;
  const age = Date.now() - e.t;
  if (!(age >= 0 && age <= MEMO_VALIDITE_MS)) return undefined;
  return e.v;
}
/**
 * Garde la valeur d'un champ, datée de maintenant. À n'appeler qu'après une lecture réussie de la base.
 * Les champs liés à la vue « comme un membre » ne sont pas écrits pendant cette vue.
 * @param {string} champ Nom du champ.
 * @param {any} valeur Valeur sérialisable (JSON).
 */
export function memoEcrire(champ, valeur) {
  if (!_compte) return;
  if (CHAMPS_PAR_VUE.has(champ) && vueActive()) return;
  const tout = lireTout(_compte);
  tout[champ] = { t: Date.now(), v: valeur };
  ecrireTout(_compte, tout);
}
/**
 * Retire la valeur d'un champ (par exemple un profil introuvable).
 * @param {string} champ Nom du champ.
 */
export function memoOublier(champ) {
  if (!_compte) return;
  const tout = lireTout(_compte);
  if (champ in tout) { delete tout[champ]; ecrireTout(_compte, tout); }
}
/**
 * Efface toute la mémoire de l'onglet (déconnexion, changement de compte). Oublie aussi le compte courant.
 */
export function memoEffacer() {
  _compte = null;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith(PREFIXE) || k === ANCIENNE_CLE_DROITS)) sessionStorage.removeItem(k);
    }
  } catch { /* stockage bloqué : rien à effacer */ }
}
