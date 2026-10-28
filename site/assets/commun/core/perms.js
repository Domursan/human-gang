// Mes droits sur le panel (rpc hg_my_perms) : { is_admin, perms[] }.
// Une requête par tranche de 10 minutes au plus : le résultat est gardé en mémoire et dans la mémoire d'affichage
// (memoire.js), lié au compte (un autre compte déclenche une nouvelle requête). Effacé à la déconnexion (clearPerms).
// Échec réseau : renvoie null (ou jette avec { strict: true }), sans rien effacer de ce qui était connu.
/*
 * Rôle : dit si le membre peut ouvrir le panel d'administration (admin ou Staff) et quelles permissions
 * il a (clés du catalogue : par exemple « cartes », « journal »). Les permissions réelles sont contrôlées
 * par la base ; ce fichier ne sert qu'à afficher les bons liens et sections.
 * Page : toutes les pages (header.js affiche le lien Admin/Staff ; profile.js vérifie l'accès au panel).
 * Dépendances : supabase.js (session et RPC hg_my_perms), memoire.js (mémoire d'affichage par compte).
 * Mémoire : champ « perms » de memoire.js (10 minutes). init.js pose la valeur gardée (primerDroits) puis force
 *   une relecture en arrière-plan (loadMyPerms({ force: true })).
 * Exporte : getCachedPerms, clearPerms, canPanel, hasPerm, loadMyPerms, primerDroits.
 */
import { sb } from './supabase.js';
import { memoLire, memoEcrire, memoCompteCourant, memoEffacer } from './memoire.js';

/* ---------- État interne ---------- */

let _mem = null;      // { uid, is_admin, perms }
let _loading = null;  // promesse en cours (évite deux requêtes simultanées)

/* ---------- Lecture et remise à zéro ---------- */

/**
 * Mes droits déjà connus (synchrone) : { is_admin, perms[] } ou null.
 * Renvoie une copie : la liste de permissions ne peut pas être modifiée de l'extérieur.
 * @returns {{is_admin: boolean, perms: string[]}|null}
 */
export function getCachedPerms() {
  return _mem ? { is_admin: _mem.is_admin, perms: [..._mem.perms] } : null;
}
/** Oublie les droits (déconnexion) : en mémoire, et dans la mémoire d'affichage. La prochaine demande refera la requête. */
export function clearPerms() {
  _mem = null; _loading = null;
  memoEffacer();
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

/**
 * Pose les droits gardés en mémoire (memoire.js) comme droits courants, sans requête. Sans effet si le compte diffère.
 * @param {string} uid Compte auquel appartiennent les droits.
 * @param {{is_admin: boolean, perms: string[]}} v Valeur gardée.
 */
export function primerDroits(uid, v) {
  if (!uid || !v) return;
  _mem = { uid, is_admin: !!v.is_admin, perms: Array.isArray(v.perms) ? v.perms.filter((k) => typeof k === 'string') : [] };
}

/* ---------- Chargement ---------- */

/**
 * Charge mes droits. Renvoie { is_admin, perms[] } ou null (non connecté, échec).
 * Ordre : droits déjà en mémoire pour ce compte, puis mémoire d'affichage (si fraîche), puis le serveur.
 * force : relit le serveur même si une valeur fraîche existe (mise à jour en arrière-plan).
 * strict : en cas d'échec réseau, jette l'erreur au lieu de renvoyer null.
 * @param {{strict?: boolean, force?: boolean}} [options]
 * @returns {Promise<{is_admin: boolean, perms: string[]}|null>}
 */
export function loadMyPerms({ strict = false, force = false } = {}) {
  if (_loading && !force) return _loading;
  _loading = (async () => {
    try {
      const { data } = await sb.auth.getSession();
      const uid = data?.session?.user?.id;
      if (!uid) { clearPerms(); return null; }
      if (!force) {
        if (_mem && _mem.uid === uid) return getCachedPerms();
        const gardé = memoLire('perms');
        if (gardé && gardé.uid === uid) { primerDroits(uid, gardé); return getCachedPerms(); }
      }
      const res = await sb.rpc('hg_my_perms');
      if (res.error) throw res.error;
      const v = res.data ?? {};
      // On ne garde que les clés textuelles : une valeur mal formée ne doit pas casser les contrôles
      _mem = { uid, is_admin: !!v.is_admin, perms: Array.isArray(v.perms) ? v.perms.filter((k) => typeof k === 'string') : [] };
      if (memoCompteCourant() === uid) memoEcrire('perms', { uid, is_admin: _mem.is_admin, perms: _mem.perms });
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
