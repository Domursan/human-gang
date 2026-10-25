// Fonctions edge Supabase : appel générique et notification du bot Discord.
/*
 * Rôle : appeler les fonctions serveur (« edge functions ») de Supabase, en particulier hg-notify
 * qui envoie les messages au bot Discord.
 * Page : toutes les pages qui déclenchent une notification (sorties, messages, cartes, Secret Santa...).
 * Dépendances : supabase.js (client Supabase), profile.js (savoir si l'on est admin), ui.js (toast), util.js (errMsg).
 * Exporte : callFn, notify.
 */
import { sb } from './supabase.js';
import { getCachedProfile } from './profile.js';
import { toast } from './ui.js';
import { errMsg } from './util.js';

/**
 * Appelle une fonction edge Supabase (avec le jeton de la session).
 * Le client Supabase ajoute automatiquement la session courante à l'appel.
 * @param {string} name Nom de la fonction edge (ex. 'hg-notify').
 * @param {object} body Corps envoyé à la fonction.
 * @returns {Promise<any>} Données renvoyées par la fonction.
 * @throws {Error} Si la fonction renvoie une erreur (c'est l'erreur de Supabase, relancée telle quelle).
 */
export async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) throw error;
  return data;
}

/* Libellés lisibles de chaque événement, pour le message d'erreur affiché à l'admin. */
const NOTIFY_LABELS = {
  ss_draw: 'tirage Secret Santa', ss_gift_sent: 'cadeau envoyé', ss_gift_received: 'cadeau reçu', irl_new: 'sortie IRL',
  message_new: 'message', dyn_announce: 'annonce', card_pull: 'tirage de carte', card_trade: 'échange de cartes',
  bot_test: 'test du bot', admin_dm: 'message admin', card_gift_admin: 'don de carte', card_drop: 'annonce de drop', lg_party: 'partie de Loup-Garou', uno_party: 'partie de Uno',
};

/**
 * Notifie le bot Discord. Renvoie true si l'appel a réussi. Le site continue de fonctionner sans bot :
 * un membre ne voit rien en cas d'échec ; un admin reçoit un message d'erreur (sinon il croit l'annonce partie).
 * @param {string} event Type d'événement (clé de NOTIFY_LABELS, ex. 'irl_new').
 * @param {object} [payload={}] Données propres à l'événement, envoyées avec.
 * @returns {Promise<boolean>} true si le bot a bien reçu la notification, false sinon.
 */
export async function notify(event, payload = {}) {
  try { await callFn('hg-notify', { event, ...payload }); return true; }
  catch (e) {
    console.warn('[hg-notify]', e);
    if (getCachedProfile()?.is_admin) toast(`Notification Discord non envoyée (${NOTIFY_LABELS[event] || event}) : ${errMsg(e)}`, 'error');
    return false;
  }
}
