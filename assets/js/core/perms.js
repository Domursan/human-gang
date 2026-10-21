// Mes droits sur le panel (rpc hg_my_perms) : { is_admin, perms[] }.
// Une seule requête par session : le résultat est gardé en mémoire et dans sessionStorage, lié au compte
// (un autre compte déclenche une nouvelle requête). Effacé à la déconnexion (clearPerms).
// Échec réseau : renvoie null (ou jette avec { strict: true }), sans rien mettre en cache.
import { sb } from './supabase.js';

const KEY = 'hg_my_perms';
let _mem = null;      // { uid, is_admin, perms }
let _loading = null;  // promesse en cours (évite deux requêtes simultanées)

function readStore() {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return v && typeof v.uid === 'string' ? v : null; } catch { return null; }
}
function writeStore(v) {
  try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* stockage bloqué : cache mémoire seulement */ }
}

/** Mes droits déjà connus (synchrone) : { is_admin, perms[] } ou null. */
export function getCachedPerms() {
  return _mem ? { is_admin: _mem.is_admin, perms: [..._mem.perms] } : null;
}
/** Oublie les droits (déconnexion). */
export function clearPerms() {
  _mem = null; _loading = null;
  try { sessionStorage.removeItem(KEY); } catch { /* sans objet */ }
}
/** Peut-on ouvrir le panel ? (admin, ou Staff avec au moins une permission). */
export function canPanel(p = _mem) { return !!p && (p.is_admin || p.perms.length > 0); }
/** A-t-on la permission (clé du catalogue) ? L'admin a toutes les clés. */
export function hasPerm(key, p = _mem) { return !!p && (p.is_admin || p.perms.includes(key)); }

/**
 * Charge mes droits (une fois par session). Renvoie { is_admin, perms[] } ou null (non connecté, échec).
 * strict : en cas d'échec réseau, jette l'erreur au lieu de renvoyer null.
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
