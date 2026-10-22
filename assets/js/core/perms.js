// Mes droits sur le panel (rpc hg_my_perms) : { is_admin, perms[] }.
// Une seule requête par session : le résultat est gardé en mémoire et dans sessionStorage, lié au compte
// (un autre compte déclenche une nouvelle requête). Effacé à la déconnexion (clearPerms).
// Échec réseau : renvoie null (ou jette avec { strict: true }), sans rien mettre en cache.
/*
 * Rôle : dit si le membre peut ouvrir le panel d'administration (admin ou Staff) et quelles permissions
 * il a (clés du catalogue : par exemple « cartes », « journal »). Les permissions réelles sont contrôlées
 * par la base ; ce fichier ne sert qu'à afficher les bons liens et sections.
 * Page : toutes les pages (header.js affiche le lien Admin/Staff ; profile.js vérifie l'accès au panel).
 * Dépendances : supabase.js (session et RPC hg_my_perms).
 * Stockage : sessionStorage « hg_my_perms » (vidé quand l'onglet se ferme).
 * Exporte : getCachedPerms, clearPerms, canPanel, hasPerm, loadMyPerms.
 */
import { sb } from './supabase.js';

/* ---------- État interne ---------- */

/** Clé sessionStorage où le résultat est gardé entre deux pages de la même session. */
const KEY = 'hg_my_perms';
let _mem = null;      // { uid, is_admin, perms }
let _loading = null;  // promesse en cours (évite deux requêtes simultanées)

/* ---------- Stockage (sessionStorage) ---------- */

/**
 * Lit les droits gardés dans sessionStorage. Renvoie null si absents ou illisibles.
 * @returns {{uid: string, is_admin: boolean, perms: string[]}|null}
 */
function readStore() {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return v && typeof v.uid === 'string' ? v : null; } catch { return null; }
}
/**
 * Écrit les droits dans sessionStorage. Un échec n'est pas grave : le cache mémoire suffit.
 * @param {object} v Droits à garder.
 */
function writeStore(v) {
  try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* stockage bloqué : cache mémoire seulement */ }
}

/* ---------- Lecture et remise à zéro ---------- */

/**
 * Mes droits déjà connus (synchrone) : { is_admin, perms[] } ou null.
 * Renvoie une copie : la liste de permissions ne peut pas être modifiée de l'extérieur.
 * @returns {{is_admin: boolean, perms: string[]}|null}
 */
export function getCachedPerms() {
  return _mem ? { is_admin: _mem.is_admin, perms: [..._mem.perms] } : null;
}
/** Oublie les droits (déconnexion). La prochaine demande refera la requête. */
export function clearPerms() {
  _mem = null; _loading = null;
  try { sessionStorage.removeItem(KEY); } catch { /* sans objet */ }
}
/**
 * Peut-on ouvrir le panel ? (admin, ou Staff avec au moins une permission).
 * @param {object|null} [p] Droits à tester (par défaut ceux en mémoire).
 * @returns {boolean}
 */
export function canPanel(p = _mem) { return !!p && (p.is_admin || p.perms.length > 0); }
/**
 * A-t-on la permission (clé du catalogue) ? L'admin a toutes les clés.
 * @param {string} key Clé de permission, par exemple 'cartes'.
 * @param {object|null} [p] Droits à tester (par défaut ceux en mémoire).
 * @returns {boolean}
 */
export function hasPerm(key, p = _mem) { return !!p && (p.is_admin || p.perms.includes(key)); }

/* ---------- Chargement ---------- */

/**
 * Charge mes droits (une fois par session). Renvoie { is_admin, perms[] } ou null (non connecté, échec).
 * Ordre de recherche : mémoire, puis sessionStorage (si c'est le même compte), puis le serveur.
 * strict : en cas d'échec réseau, jette l'erreur au lieu de renvoyer null.
 * @param {{strict?: boolean}} [options]
 * @returns {Promise<{is_admin: boolean, perms: string[]}|null>}
 */
export function loadMyPerms({ strict = false } = {}) {
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const { data } = await sb.auth.getSession();
      const uid = data?.session?.user?.id;
      if (!uid) { clearPerms(); return null; }
      if (_mem && _mem.uid === uid) return getCachedPerms();
      const stored = readStore();
      if (stored && stored.uid === uid) { _mem = stored; return getCachedPerms(); }
      const res = await sb.rpc('hg_my_perms');
      if (res.error) throw res.error;
      const v = res.data ?? {};
      // On ne garde que les clés textuelles : une valeur mal formée ne doit pas casser les contrôles
      _mem = { uid, is_admin: !!v.is_admin, perms: Array.isArray(v.perms) ? v.perms.filter((k) => typeof k === 'string') : [] };
      writeStore(_mem);
      return getCachedPerms();
    } catch (e) {
      _loading = null; // la prochaine demande réessaie
      if (strict) throw e;
      console.warn('[droits]', e?.message || e);
      return null;
    }
  })();
  return _loading;
}
