// Admin : chargement des données partagées (membres, invitations, Secret Santa, badges, idées, assistance).
// Chaque donnée se charge une seule fois (ensureX) : les sections qui en ont besoin attendent la même promesse.
import { sb, getUser } from '../core.js';
import { fetchAdminGhosts } from '../admin-ghosts.js';
import { S } from './state.js';
import { check } from './common.js';

/* ---------- Cache des données partagées ---------- */
const LOADED = new Map();
/** Charge la donnée `key` une seule fois : les appels suivants reçoivent la même promesse. Un échec n'est pas gardé. */
export function once(key, load) {
  if (!LOADED.has(key)) LOADED.set(key, load().catch((e) => { LOADED.delete(key); throw e; }));
  return LOADED.get(key);
}
/** Oublie la donnée `key` : le prochain appel la recharge. */
export function forget(key) { LOADED.delete(key); }

/* ---------- Chargement ---------- */
export async function loadMembers() {
  S.members = check(await sb.rpc('hg_members')) ?? [];
  // Fantômes : visibles seulement par l'admin (pour leur attribuer badges, présences, cartes…)
  S.ghosts = await fetchAdminGhosts().catch((e) => { console.warn('[fantômes]', e); return []; });
  S.byId = new Map([...S.members, ...S.ghosts].map((m) => [m.id, m]));
}
export async function loadInvites() { S.invites = check(await sb.from('hg_invites').select('*').order('created_at', { ascending: false })) ?? []; }
export async function loadEditions() {
  S.editions = check(await sb.from('hg_ss_editions').select('*').order('year', { ascending: false })) ?? [];
  if (!S.editions.some((e) => e.id === S.editionId)) S.editionId = S.editions[0]?.id ?? null;
}
export async function loadEditionDetails() {
  if (!S.editionId) { S.participants = []; S.exclusions = []; return; }
  const [p, x] = await Promise.all([
    sb.from('hg_ss_participants').select('user_id, sent_at, received_at, joined_at').eq('edition_id', S.editionId),
    sb.from('hg_ss_exclusions').select('*').eq('edition_id', S.editionId),
  ]);
  S.participants = check(p) ?? [];
  S.exclusions = check(x) ?? [];
}
export async function loadBadges() {
  const [b, u] = await Promise.all([
    sb.from('hg_badges').select('*').order('sort'),
    sb.from('hg_user_badges').select('user_id, badge_code, awarded_at, level'),
  ]);
  S.badges = check(b) ?? []; S.userBadges = check(u) ?? [];
}
export async function loadIdeas() { S.ideas = check(await sb.from('hg_ideas').select('*').order('created_at', { ascending: false })) ?? []; }
/** Demandes (tri par activité), leurs réponses (notes internes comprises) et l'identifiant de l'admin connecté. */
export async function loadSupport() {
  const [s, r, u] = await Promise.all([
    sb.from('hg_support').select('*').order('updated_at', { ascending: false }),
    sb.from('hg_support_replies').select('*').order('created_at'),
    getUser(),
  ]);
  S.support = check(s) ?? [];
  S.supportReplies = check(r) ?? [];
  S.meId = u?.id ?? null;
}

/* ---------- Versions partagées (une seule requête par donnée pour toutes les sections) ---------- */
export const ensureMembers = () => once('members', loadMembers);
export const ensureInvites = () => once('invites', loadInvites);
export const ensureBadges = () => once('badges', loadBadges);
export const ensureIdeas = () => once('ideas', loadIdeas);
export const ensureSupport = () => once('support', loadSupport);
/** Éditions Secret Santa et édition retenue (participants, exclusions). */
export const ensureSS = () => once('ss', async () => { await loadEditions(); await loadEditionDetails(); S.ssLoaded = true; });

/** Exécute `fn` ; en cas d'échec, journalise l'erreur et appelle onError (sans interrompre le démarrage). */
export async function safe(fn, onError) { try { await fn(); return true; } catch (e) { console.error(e); onError?.(e); return false; } }
