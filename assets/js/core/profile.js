// Session et profil du membre connecté (mis en cache pour la page courante).
import { sb } from './supabase.js';
import { loadMyPerms, canPanel } from './perms.js';

let _profile;
/** Profil mis en cache (undefined avant le premier chargement, null si pas de profil). Synchrone. */
export function getCachedProfile() { return _profile; }

export async function getUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
export async function getProfile(force = false) {
  if (_profile !== undefined && !force) return _profile;
  const user = await getUser();
  if (!user) return (_profile = null);
  const { data, error } = await sb.from('hg_profiles').select('*').eq('id', user.id).maybeSingle();
  // Erreur réseau (ou base) : on ne met rien en cache et on jette, pour ne pas confondre avec « pas de profil »
  if (error) throw error;
  return (_profile = data ?? null);
}
/** Redirige vers compte.html si non membre. Renvoie le profil. */
export async function requireMember() {
  const p = await getProfile();
  if (!p) { location.href = `compte.html?next=${encodeURIComponent(location.pathname.split('/').pop())}`; throw new Error('redirect'); }
  return p;
}
/** Panel d'administration : admin, ou Staff actif avec au moins une permission. Sinon redirection vers l'accueil. */
export async function requireAdmin() {
  const p = await requireMember();
  if (p.is_admin) return p;
  if (!canPanel(await loadMyPerms({ strict: true }))) { location.href = 'accueil.html'; throw new Error('redirect'); }
  return p;
}
