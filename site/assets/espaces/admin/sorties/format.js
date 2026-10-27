// =====================================================================
// Admin : sorties IRL — libellés, états et règles d'affichage (mêmes règles que irl.js).
// Fonctions pures : elles ne lisent que ce qu'on leur donne. Le délai de passage à l'historique vient des réglages.
// Dépendances : core.js (fmtDateTime), reglages-valeurs-lot3.js (delaiPassee).
// Exporte : RSVP_ORDER, RSVP_LABEL, isPast, statusOf, whenLabel, rsvpCounts, memberName.
// =====================================================================
import { fmtDateTime } from '../../../commun/core.js';
import { delaiPassee } from '../reglages-valeurs-lot3.js';

/* Ordre d'affichage des réponses : je viens, peut-être, pas dispo. */
export const RSVP_ORDER = ['oui', 'peut-etre', 'non'];
/* Libellé affiché pour chaque réponse. */
export const RSVP_LABEL = { oui: 'Je viens', 'peut-etre': 'Peut-être', non: 'Pas dispo' };

/**
 * Une sortie est passée si elle est marquée « ajoutée après coup », ou si elle a commencé il y a plus
 * longtemps que le délai réglable (6 h par défaut, voir Réglages du Secret Santa et sorties IRL).
 */
export function isPast(ev, now = Date.now()) {
  return !!ev.retro || (!!ev.starts_at && new Date(ev.starts_at).getTime() < now - delaiPassee());
}

/** Libellé et classe d'état. Il n'existe pas de statut « annulée » en base : une sortie annulée est supprimée. */
export function statusOf(ev, now = Date.now()) {
  if (!ev.starts_at) return { label: 'Date à caler', tone: 'todo', group: 'avenir' };
  if (ev.retro) return { label: 'Ajoutée après coup', tone: 'retro', group: 'passees' };
  if (isPast(ev, now)) return { label: 'Passée', tone: 'past', group: 'passees' };
  if (new Date(ev.starts_at).getTime() <= now) return { label: 'En cours', tone: 'ok', group: 'avenir' };
  return { label: 'À venir', tone: 'current', group: 'avenir' };
}

/* Date de la sortie en texte, ou « Date à caler » si elle n'est pas encore fixée. */
export const whenLabel = (ev) => (ev.starts_at ? fmtDateTime(ev.starts_at) : 'Date à caler');

/** Compte les réponses d'une sortie (oui, peut-être, non). Ignore les réponses de comptes qui ne sont plus connus. */
export function rsvpCounts(rsvps, eventId, members) {
  const c = { oui: 0, 'peut-etre': 0, non: 0 };
  for (const r of rsvps) if (r.event_id === eventId && members.has(r.user_id) && c[r.status] !== undefined) c[r.status]++;
  return c;
}

/* Pseudo d'un membre, ou « Ancien membre » s'il n'est plus connu. */
export const memberName = (members, id) => members.get(id)?.pseudo || 'Ancien membre';
