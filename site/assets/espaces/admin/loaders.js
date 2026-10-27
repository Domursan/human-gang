// Admin : chargement des données partagées (membres, invitations, Secret Santa, badges, idées, assistance).
// Chaque donnée se charge une seule fois (ensureX) : les sections qui en ont besoin attendent la même promesse.
// Les fonctions loadX rechargent la donnée sans passer par le cache (après une écriture, par exemple).
// Dépendances : core.js (Supabase, utilisateur courant), admin-ghosts.js (comptes fantômes), state.js, common.js.
import { sb, getUser } from '../../commun/core.js';
import { fetchAdminGhosts } from './admin-ghosts.js';
import { S } from './state.js';
import { check } from './common.js';

/* ---------- Cache des données partagées ---------- */
// Clé de donnée -> promesse de chargement en cours ou terminée.
const LOADED = new Map();
/** Charge la donnée `key` une seule fois : les appels suivants reçoivent la même promesse. Un échec n'est pas gardé. */
export function once(key, load) {
  if (!LOADED.has(key)) LOADED.set(key, load().catch((e) => { LOADED.delete(key); throw e; }));
  return LOADED.get(key);
}

/* ---------- Chargement ---------- */
/** Charge les comptes actifs (hg_members) et les fantômes, puis reconstruit l'index S.byId (identifiant -> membre). */
export async function loadMembers() {
  S.members = check(await sb.rpc('hg_members')) ?? [];
  // Fantômes : visibles seulement par l'admin (pour leur attribuer badges, présences, cartes…)
  S.ghosts = await fetchAdminGhosts().catch((e) => { console.warn('[fantômes]', e); return []; });
  S.byId = new Map([...S.members, ...S.ghosts].map((m) => [m.id, m]));
}
/** Charge tous les codes d'invitation, du plus récent au plus ancien. */
export async function loadInvites() { S.invites = check(await sb.from('hg_invites').select('*').order('created_at', { ascending: false })) ?? []; }
/** Charge les éditions Secret Santa. Garde l'édition choisie si elle existe encore, sinon prend la plus récente. */
export async function loadEditions() {
  S.editions = check(await sb.from('hg_ss_editions').select('*').order('year', { ascending: false })) ?? [];
  if (!S.editions.some((e) => e.id === S.editionId)) S.editionId = S.editions[0]?.id ?? null;
}
/** Charge les inscrits et les exclusions de l'édition choisie. Sans édition, les deux listes sont vides. */
export async function loadEditionDetails() {
  if (!S.editionId) { S.participants = []; S.exclusions = []; return; }
  const [p, x] = await Promise.all([
    sb.from('hg_ss_participants').select('user_id, sent_at, received_at, joined_at').eq('edition_id', S.editionId),
    sb.from('hg_ss_exclusions').select('*').eq('edition_id', S.editionId),
  ]);
  S.participants = check(p) ?? [];
  S.exclusions = check(x) ?? [];
}
/** Charge le catalogue des badges (trié par ordre d'affichage) et qui les a reçus. */
export async function loadBadges() {
  const [b, u] = await Promise.all([
    sb.from('hg_badges').select('*').order('sort'),
    sb.from('hg_user_badges').select('user_id, badge_code, awarded_at, level'),
  ]);
  S.badges = check(b) ?? []; S.userBadges = check(u) ?? [];
}
/** Charge les idées de la boîte à idées (plus récentes d'abord). */
export async function loadIdeas() { S.ideas = check(await sb.from('hg_ideas').select('*').order('created_at', { ascending: false })) ?? []; }
/** Demandes (tri par activité), leurs réponses (notes internes comprises) et l'identifiant de l'admin connecté. */
export async function loadSupport() {
  const [s, r, u, f, rep, cfg] = await Promise.all([
    sb.from('hg_support').select('*').order('updated_at', { ascending: false }),
    sb.from('hg_support_replies').select('*').order('created_at'),
    getUser(),
    sb.from('hg_support_files').select('id, support_id, path, name, mime, size').order('created_at'),
    // A6 : signalements liés aux demandes (table absente avant la migration 093 : liste vide, sans erreur)
    sb.from('hg_reports').select('*').order('created_at', { ascending: false }).then((x) => (x.error ? { data: [] } : x), () => ({ data: [] })),
    // Seuil de masquage affiché au Staff (réglage support.signalements) ; sans lecture, le défaut 3 reste affiché
    sb.from('hg_settings').select('value').eq('key', 'support').maybeSingle().then((x) => (x.error ? { data: null } : x), () => ({ data: null })),
  ]);
  S.support = check(s) ?? [];
  S.supportReplies = check(r) ?? [];
  // Pièces jointes (migration 078) : lecture facultative, une erreur ne bloque pas le panel.
  S.supportFiles = f?.error ? [] : (f?.data ?? []);
  S.reports = rep?.data ?? [];
  S.reportSeuil = cfg?.data?.value?.signalements?.seuil_masquage;
  S.meId = u?.id ?? null;
}

/* ---------- Versions partagées (une seule requête par donnée pour toutes les sections) ---------- */
/** Membres et fantômes, chargés une seule fois. */
export const ensureMembers = () => once('members', loadMembers);
/** Codes d'invitation, chargés une seule fois. */
export const ensureInvites = () => once('invites', loadInvites);
/** Badges et attributions, chargés une seule fois. */
export const ensureBadges = () => once('badges', loadBadges);
/** Idées, chargées une seule fois. */
export const ensureIdeas = () => once('ideas', loadIdeas);
/** Assistance, chargée une seule fois. */
export const ensureSupport = () => once('support', loadSupport);
/** Éditions Secret Santa et édition retenue (participants, exclusions). */
export const ensureSS = () => once('ss', async () => { await loadEditions(); await loadEditionDetails(); S.ssLoaded = true; });

/**
 * Exécute `fn` ; en cas d'échec, journalise l'erreur et appelle onError (sans interrompre le démarrage).
 * @returns {Promise<boolean>} true si `fn` a réussi.
 */
export async function safe(fn, onError) { try { await fn(); return true; } catch (e) { console.error(e); onError?.(e); return false; } }
