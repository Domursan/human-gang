// Session et profil du membre connecté (mis en cache pour la page courante).
/*
 * Rôle : donne le profil (ligne hg_profiles) du membre connecté, une seule fois par page, et redirige
 * les visiteurs vers la page de connexion quand la page l'exige.
 * Page : toutes les pages (init.js appelle requireMember / requireAdmin / getProfile selon la page).
 * Dépendances : supabase.js (session, table hg_profiles), perms.js (droits du panel).
 * Exporte : getCachedProfile, getUser, getProfile, requireMember, requireAdmin.
 */
import { sb } from './supabase.js';
import { loadMyPerms, canPanel } from './perms.js';
import { memoEcrire, memoOublier } from './memoire.js';

/** Profil en cache : undefined = pas encore chargé ; null = pas de profil (visiteur). */
let _profile;
/**
 * Profil mis en cache (undefined avant le premier chargement, null si pas de profil). Synchrone.
 * @returns {object|null|undefined}
 */
export function getCachedProfile() { return _profile; }
/**
 * Pose le profil gardé en mémoire (memoire.js) comme profil courant, sans requête : l'en-tête s'affiche tout de suite.
 * getProfile(true) relit ensuite la base.
 * @param {object} p Ligne hg_profiles gardée.
 */
export function primerProfil(p) { _profile = p; }

/**
 * Utilisateur connecté (compte d'authentification), ou null si personne n'est connecté.
 * @returns {Promise<object|null>}
 */
export async function getUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
/**
 * Profil du membre connecté. Lu depuis le cache sauf si force est demandé.
 * @param {boolean} [force=false] Relit la base même si le profil est déjà en cache.
 * @returns {Promise<object|null>} La ligne hg_profiles, ou null (visiteur ou pas encore de profil).
 * @throws {Error} En cas d'erreur réseau ou base (rien n'est mis en cache dans ce cas).
 */
export async function getProfile(force = false) {
  if (_profile !== undefined && !force) return _profile;
  const user = await getUser();
  if (!user) return (_profile = null);
  const { data, error } = await sb.from('hg_profiles').select('*').eq('id', user.id).maybeSingle();
  // Erreur réseau (ou base) : on ne met rien en cache et on jette, pour ne pas confondre avec « pas de profil »
  if (error) throw error;
  // Mémoire d'affichage : le profil relu sert au prochain démarrage (memoire.js)
  if (data) memoEcrire('profil', data); else memoOublier('profil');
  return (_profile = data ?? null);
}
/**
 * Exige un membre connecté. Sinon, redirige vers /pages/compte/compte.html (avec retour à la page demandée).
 * @returns {Promise<object>} Le profil. Ne revient jamais si redirigé (lève 'redirect' pour arrêter la page).
 * @throws {Error} Error('redirect') quand la redirection est lancée.
 */
export async function requireMember() {
  const p = await getProfile();
  if (!p) { location.href = `/pages/compte/compte.html?next=${encodeURIComponent(location.pathname.split('/').pop())}`; throw new Error('redirect'); }
  return p;
}
/**
 * Panel d'administration : admin, ou Staff actif avec au moins une permission. Sinon redirection vers l'accueil.
 * Un admin passe sans requête de droits ; un Staff vérifie ses permissions. Une erreur réseau n'est
 * pas une redirection : elle remonte jusqu'à init.js, qui affiche « Connexion impossible ».
 * @returns {Promise<object>} Le profil.
 * @throws {Error} Error('redirect') quand la redirection est lancée.
 */
export async function requireAdmin() {
  const p = await requireMember();
  if (p.is_admin) return p;
  if (!canPanel(await loadMyPerms({ strict: true }))) { location.href = '/pages/compte/accueil.html'; throw new Error('redirect'); }
  return p;
}
