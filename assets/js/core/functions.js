// Fonctions edge Supabase : appel générique et notification du bot Discord.
import { sb } from './supabase.js';
import { getCachedProfile } from './profile.js';
import { toast } from './ui.js';
import { errMsg } from './util.js';

/** Appelle une fonction edge Supabase (avec le jeton de la session). */
export async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) throw error;
  return data;
}
const NOTIFY_LABELS = {
  ss_draw: 'tirage Secret Santa', ss_gift_sent: 'cadeau envoyé', ss_gift_received: 'cadeau reçu', irl_new: 'sortie IRL',
  message_new: 'message', dyn_announce: 'annonce', card_pull: 'tirage de carte', card_trade: 'échange de cartes',
  bot_test: 'test du bot', admin_dm: 'message admin', card_gift_admin: 'don de carte',
};
/**
 * Notifie le bot Discord. Renvoie true si l'appel a réussi. Le site continue de fonctionner sans bot :
 * un membre ne voit rien en cas d'échec ; un admin reçoit un message d'erreur (sinon il croit l'annonce partie).
 */
export async function notify(event, payload = {}) {
  try { await callFn('hg-notify', { event, ...payload }); return true; }
  catch (e) {
    console.warn('[hg-notify]', e);
    if (getCachedProfile()?.is_admin) toast(`Notification Discord non envoyée (${NOTIFY_LABELS[event] || event}) : ${errMsg(e)}`, 'error');
    return false;
  }
}
