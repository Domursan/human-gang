// ===== Admin : sorties IRL — libellés, états et règles d'affichage (mêmes règles que irl.js) =====
import { fmtDateTime } from '../core.js';
import { pluralCount } from '../utils.js';

export const GRACE_MS = 6 * 3600 * 1000; // une sortie reste « à venir » 6 h après son début
export const BATCH = 30;                 // lignes affichées par lot
export const RSVP_ORDER = ['oui', 'peut-etre', 'non'];
export const RSVP_LABEL = { oui: 'Je viens', 'peut-etre': 'Peut-être', non: 'Pas dispo' };

/** Une sortie est passée si elle est marquée « ajoutée après coup » ou si elle a commencé il y a plus de 6 h. */
export function isPast(ev, now = Date.now()) {
  return !!ev.retro || (!!ev.starts_at && new Date(ev.starts_at).getTime() < now - GRACE_MS);
}

/** Libellé et classe d'état. Il n'existe pas de statut « annulée » en base : une sortie annulée est supprimée. */
export function statusOf(ev, now = Date.now()) {
  if (!ev.starts_at) return { label: 'Date à caler', tone: 'todo', group: 'avenir' };
  if (ev.retro) return { label: 'Ajoutée après coup', tone: 'retro', group: 'passees' };
  if (isPast(ev, now)) return { label: 'Passée', tone: 'past', group: 'passees' };
  if (new Date(ev.starts_at).getTime() <= now) return { label: 'En cours', tone: 'ok', group: 'avenir' };
  return { label: 'À venir', tone: 'current', group: 'avenir' };
}

export const whenLabel = (ev) => (ev.starts_at ? fmtDateTime(ev.starts_at) : 'Date à caler');

export function rsvpCounts(rsvps, eventId, members) {
  const c = { oui: 0, 'peut-etre': 0, non: 0 };
  for (const r of rsvps) if (r.event_id === eventId && members.has(r.user_id) && c[r.status] !== undefined) c[r.status]++;
  return c;
}

export function countsLine(c) {
  return `${pluralCount(c.oui, 'inscrit', 'inscrits')} · ${c['peut-etre']} peut-être · ${c.non} pas dispo`;
}

export const memberName = (members, id) => members.get(id)?.pseudo || 'Ancien membre';
