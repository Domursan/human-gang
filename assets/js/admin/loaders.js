// Admin : chargement des données (membres, invitations, Secret Santa, badges, idées, assistance, réglages).
import { sb } from '../core.js';
import { fetchAdminGhosts } from '../admin-ghosts.js';
import { S } from './state.js';
import { check } from './common.js';

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
export async function loadSupport() { S.support = check(await sb.from('hg_support').select('*').order('created_at', { ascending: false })) ?? []; }
export async function loadSettings() {
  const rows = check(await sb.from('hg_settings').select('key, value').in('key', ['bot', 'theme'])) ?? [];
  const get = (k) => rows.find((r) => r.key === k)?.value;
  S.bot = get('bot') ?? { announce_channel_id: null, admin_discord_id: null, notify: {} };
  S.bot.notify = { draw: true, gift: true, irl: true, birthday: true, support: true, messages: true, ...(S.bot.notify || {}) };
  S.theme = get('theme') ?? { mode: 'auto', forced: null };
}

export async function safe(fn, onError) { try { await fn(); return true; } catch (e) { console.error(e); onError?.(e); return false; } }
