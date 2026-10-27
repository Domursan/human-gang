// =====================================================================
// Admin : sorties IRL — données et écritures.
// Mêmes tables, mêmes colonnes et mêmes valeurs que irl.js (hg_events, hg_event_dates, hg_event_rsvps,
// hg_event_date_votes). Les droits sont ceux de la base : hg_has_perm('evenements') (admin ou Staff).
// Dépendances : core.js (sb, notify), admin-ghosts.js (annuaire des fantômes), photos.js (suppression de fichiers).
// Exporte : loadAll, createEvent, updateEvent, fixDate, syncDates, deleteEvent, setRsvp, removeRsvp, setVote, announceNew.
// =====================================================================
import { sb, notify } from '../../../commun/core.js';
import { ghostDirectory } from '../admin-ghosts.js';
import { removeObjects } from '../../irl/photos.js';

/* Renvoie les données d'une réponse Supabase, ou lève l'erreur reçue. */
const ok = ({ data, error }) => { if (error) throw error; return data; };

/** Charge tout ce dont la section a besoin. Les tables sont petites (une poignée de sorties). */
export async function loadAll() {
  const [m, ev, rs, dt, vt, ph] = await Promise.all([
    sb.rpc('hg_members'),
    sb.from('hg_events').select('*').order('created_at', { ascending: false }),
    sb.from('hg_event_rsvps').select('*'),
    sb.from('hg_event_dates').select('*').order('proposed_at', { ascending: true }),
    sb.from('hg_event_date_votes').select('*'),
    sb.from('hg_photos').select('id, event_id, path, caption, created_at'),
  ]);
  const members = new Map((ok(m) || []).map((x) => [x.id, x]));
  for (const [id, g] of await ghostDirectory()) members.set(id, g); // l'admin voit aussi les fantômes (comme irl.js)
  return {
    members,
    events: ok(ev) || [],
    rsvps: ok(rs) || [],
    dates: ok(dt) || [],
    votes: ok(vt) || [],
    photos: ok(ph) || [],
  };
}

/** Crée une sortie. L'organisateur est le créateur (RLS : created_by = auth.uid() à l'insertion). */
export async function createEvent(row) {
  return ok(await sb.from('hg_events').insert(row).select().single());
}

/** Modifie les champs donnés d'une sortie. */
export async function updateEvent(id, patch) {
  ok(await sb.from('hg_events').update(patch).eq('id', id));
}

/** Fixe la date retenue : la sortie passe de « à caler » à « datée ». */
export async function fixDate(eventId, iso) {
  ok(await sb.from('hg_events').update({ starts_at: iso }).eq('id', eventId));
}

/**
 * Aligne les dates proposées sur `wanted` ([{ id?, iso }]). `existing` = lignes actuelles de la sortie.
 * Les dates retirées perdent leurs votes (ON DELETE CASCADE) ; une date modifiée garde ses votes.
 */
export async function syncDates(eventId, wanted, existing) {
  const byId = new Map(existing.map((d) => [d.id, d]));
  const keep = new Set(wanted.map((w) => w.id).filter(Boolean));
  const drop = existing.filter((d) => !keep.has(d.id)).map((d) => d.id);
  if (drop.length) ok(await sb.from('hg_event_dates').delete().in('id', drop));
  for (const w of wanted) {
    const cur = w.id && byId.get(w.id);
    if (cur && new Date(cur.proposed_at).getTime() !== new Date(w.iso).getTime()) {
      ok(await sb.from('hg_event_dates').update({ proposed_at: w.iso }).eq('id', w.id));
    }
  }
  const add = wanted.filter((w) => !w.id).map((w) => ({ event_id: eventId, proposed_at: w.iso }));
  if (add.length) ok(await sb.from('hg_event_dates').insert(add));
}

/** Supprime la sortie. Les inscriptions, dates, votes et lignes de photos partent en cascade ; les fichiers sont retirés du stockage. */
export async function deleteEvent(ev, photoPaths = []) {
  ok(await sb.from('hg_events').delete().eq('id', ev.id));
  try { await removeObjects([ev.cover_path, ...photoPaths]); } catch (e) { console.warn('[admin-sorties] fichiers non supprimés', e); }
}

/** Enregistre (ou remplace) la réponse d'un membre à une sortie. */
export async function setRsvp(eventId, userId, status) {
  ok(await sb.rpc('hg_rsvp_admin_set', { p_event: eventId, p_user: userId, p_status: status })); // RPC journalisée (076)
}

/** Retire la réponse d'un membre à une sortie. */
export async function removeRsvp(eventId, userId) {
  ok(await sb.rpc('hg_rsvp_admin_set', { p_event: eventId, p_user: userId, p_status: null })); // RPC journalisée (076)
}

/** Ajoute (on = true) ou retire (on = false) le vote d'un membre pour une date proposée. */
export async function setVote(dateId, userId, on) {
  ok(on
    ? await sb.from('hg_event_date_votes').insert({ date_id: dateId, user_id: userId })
    : await sb.from('hg_event_date_votes').delete().eq('date_id', dateId).eq('user_id', userId));
}

/** Annonce Discord d'une nouvelle sortie, comme irl.js (les rencontres ajoutées après coup ne sont pas annoncées). */
export function announceNew(eventId) {
  return notify('irl_new', { event_id: eventId });
}
