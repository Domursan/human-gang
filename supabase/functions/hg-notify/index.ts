// ===== Humane Gang — fonction edge « hg-notify » =====
// Rôle : point d'entrée unique du site pour envoyer les messages du bot Discord (MP et annonces) quand un événement
// se produit (tirage du Secret Santa, sortie créée, message reçu, échange conclu, carte offerte...).
// Construit et envoie les messages du bot Discord (MP et annonces) à partir d'événements du site.
// verify_jwt = true : seul un utilisateur connecté peut l'appeler ; on vérifie ensuite ses droits événement par événement.
// Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis), DISCORD_BOT_TOKEN, SITE_URL (facultatif).
// Dépendances : ../_shared/templates.ts, dyn-announce.ts, discord.ts, mentions.ts, channels.ts, bot-media.ts, reglages.ts ;
//   tables hg_settings, hg_profiles, hg_staff, hg_ss_*, hg_events, hg_conversations, hg_messages, hg_card_*,
//   hg_dyn_events, hg_bot_log.
// Exporte : rien (point d'entrée Deno.serve).
//
// Événements :
//   ss_draw          { edition_id }  admin  → annonce + MP aux participants (opt-in)
//   ss_gift_sent     { edition_id }  Santa  → MP à sa cible « Ton Santa a envoyé ton cadeau ! » (sans le nommer)
//   ss_gift_received { edition_id }  cible  → MP à son Santa « Ta cible a reçu son cadeau »
//   irl_new          { event_id }    créateur de la sortie (ou admin) → annonce dans le salon
//   bot_test         { type?: MentionType } admin → message de test (avec type : dans chaque salon de ce type ; sans type : salon
//                    d'annonces + MP admin)
//   message_new      { conversation_id } membre de la conversation → MP aux autres membres (opt-in), sauf discussion
//                    en cours (message précédent < 10 min). Le Santa d'une conversation santa n'est jamais nommé.
//   admin_dm         { user_ids: uuid[] (≤ 100, peut être vide si channel ou channels), title?, body (≤ 2000), channel?: bool,
//                    channels?: string[] (1 à 10 salons connus : dans bot.salons ou salon d'annonces ; sinon 400 « Salon inconnu »),
//                    mention?: 'none' | 'role' | 'everyone' (salons seulement), attachments?: chemins hg-bot-media (≤ 4) }
//                    admin ou Staff « bot » → MP à chaque destinataire opt-in avec ID Discord ({pseudo} personnalisé), annonce
//                    facultative dans chaque salon choisi (channel = salon d'annonces ; avec mention et pièces jointes), trace dans
//                    hg_bot_log (colonne channels : [{id, ok, error?}]), détail par destinataire et par salon renvoyé.
//                    Pièces jointes : fichiers du bucket privé hg-bot-media sous manuel/ (10 Mo max chacun), envoyés en multipart.
//   dyn_announce     { event_id, phase: 'start' | 'end' }  admin → annonce d'un événement dynamique dans le salon
//                    (image de l'événement, top 3 pour la fin) ; met à jour announced_start_at / announced_end_at.
//                    Les annonces automatiques sont faites par la fonction hg-cron.
//   card_pull        { card: uuid (hg_cards.id), rarity?, shiny?, serial?, via?: 'fabrication' } membre → annonce « belle carte »
//                    dans le salon si la carte est légendaire, mythique, identité ou unique ET qu'un exemplaire obtenu il y a
//                    moins de 10 min appartient à l'appelant (rarity, shiny et via du client ignorés : lus en base ; serial sert
//                    seulement à choisir l'exemplaire). Si l'exemplaire vient d'une fabrication (source), le texte dit « a fabriqué »
//                    au lieu de « a obtenu » (variable {verbe}). Désactivable (bot.notify.card_pull).
//   card_trade       { trade_id: uuid } destinataire de l'offre (celui qui accepte) → annonce « échange conclu » dans le salon.
//                    Facultative : seulement si bot.notify.card_trade === true (désactivée par défaut).
//   trade_offer      { trade_id: uuid } auteur de l'offre (ou de la contre-proposition) → MP au destinataire « te propose
//                    un échange » : cartes et Paillettes donnés/demandés (noms tronqués). Offre créée il y a moins de 15 min,
//                    encore ouverte (status proposee). Désactivable (bot.notify.trade_offer, activé par défaut).
//   card_wish        { cards: uuid[] (≤ 10) } membre, après l'ouverture d'un booster → MP aux membres qui ont la carte dans
//                    leur liste de souhaits et qui ont activé l'alerte (profil.notify_card_wish). Une fois par exemplaire
//                    (wish_notified_at). Le membre qui a obtenu la carte n'est pas nommé. Désactivable (bot.notify.card_wish).
//   card_gift_admin  { user_id: uuid, card_id: uuid, count?: 1..100, shiny?: bool } admin ou Staff « cartes » → MP au membre
//                    « t'a offert « carte » (rareté, brillante) ×N », avec l'image de la carte si elle est en https. Un don
//                    (exemplaire source 'admin' de cette carte pour ce membre) doit avoir été créé il y a moins de 15 min.
//                    Nom, rareté, brillance et image sont lus en base ; count est borné par les exemplaires trouvés.
//                    Une seule fois par exemplaire (réservation gift_dm_at, migration 079).
//                    Désactivable (bot.notify.card_gift_admin, activé par défaut).
//   card_drop        { drop_id: uuid } admin ou Staff « cartes », juste après hg_drop_create → annonce « carte sauvage » dans le
//                    salon (carte, rareté, brillance, exemplaires, heure de fin, image si https). Drop créé il y a moins de
//                    15 min et encore en cours ; une seule annonce par drop (réservation discord_announced_at, migration 064).
//                    Désactivable (bot.notify.card_drop, activé par défaut).
// Mentions des annonces du salon (draw, irl, dyn, card_pull, card_trade, card_drop) : bot.mentions.<type> = none | role | everyone,
// rôle : bot.mention_role_id (voir ../_shared/mentions.ts). Défaut : aucune mention.
// Salons des annonces (draw, irl, birthday, dyn, card_pull, card_trade, card_drop) : bot.channels.<type> (liste de salons),
// sinon le salon d'annonces (voir ../_shared/channels.ts). Chaque annonce part dans chaque salon de la liste ; un échec sur un
// salon n'empêche pas les autres (résultat « channels » par salon). Les MP ne changent pas.
// Journal des annonces (hg_bot_log, colonne channels = [{ id, ok, error? }], migration 070) : toujours pour draw, dyn_announce,
// card_drop (lancées par l'admin) ; seulement si un salon a échoué pour irl, card_pull, card_trade (kinds auto:tirage,
// auto:evenement, auto:drop, auto:sortie, auto:carte, auto:echange). Un salon en échec n'est jamais réessayé quand un autre a
// reçu l'annonce ; la réservation (carte, drop) n'est libérée que si aucun salon ne l'a reçue.
// Textes : modèles personnalisables (hg_settings.bot_templates, défauts dans ../_shared/bot-templates.json).
// Anti-rejeu (audit I7, migration 075) : chaque annonce ou MP déclenché par un membre est réservé une seule fois en base
// (update … is null, comme card_pull) : hg_events.announced_at (irl_new), hg_ss_participants.gift_notified_at /
// received_notified_at (ss_gift_*), hg_card_trades.announced_at (card_trade), hg_messages.dm_notified_at (message_new).
// La réservation est libérée seulement si rien n'est parti. Ces colonnes ne sont modifiables que par la clé service.
// Limite par membre (hors admin) : bot.limites.annonces_par_heure (20 par défaut) sur une heure glissante, comptée dans
// hg_bot_quota ; au-delà, 429. Événements comptés : ss_gift_*, irl_new, message_new, card_pull, card_trade, trade_offer,
// card_wish (une unité par envoi réel, pas par appel ignoré).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { loadTemplates, renderTemplate, embedFrom, mdSafe, truncate, type Templates } from '../_shared/templates.ts';
import { buildDynAnnounce, type DynEvent } from '../_shared/dyn-announce.ts';
import { CORS, hasBotToken, isSnowflake, jsonResponse, sendChannel, sendDM } from '../_shared/discord.ts';
import { mentionFor, mentionMode, mentionWith, MENTION_TYPES, type MentionBot, type MentionType } from '../_shared/mentions.ts';
import {
  channelLog, channelsFor, insertWithChannels, isKnownChannel, sendToChannels, CHANNEL_LABEL, type ChannelResult,
} from '../_shared/channels.ts';
import { loadAttachments, MediaError, validAttachmentPaths } from '../_shared/bot-media.ts';
import { botRules } from '../_shared/reglages.ts';

/* ---------- Constantes et clients ---------- */

/** Réponse JSON avec les en-têtes CORS (raccourci vers jsonResponse). */
const json = (body: unknown, status = 200) => jsonResponse(body, status);

// Client avec la clé service role : la fonction lit les réglages et écrit le journal ; les droits sont vérifiés à la main.
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
/** Adresse du site sans « / » final ; sert à construire les liens des messages. */
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
/** Lien vers une page du site, ou undefined si SITE_URL n'est pas configurée. */
const link = (page: string) => (SITE ? `${SITE}/${page}` : undefined);
/** Couleurs des embeds par type de message. */
const COLOR = { ss: 0xe0909a, irl: 0xe2c77e, info: 0x7e93c9, accent: 0x9e3543, card: 0xe0a93b };
const FRESH_MS = 15 * 60_000; // un envoi/réception doit être récent (anti-répétition)

/** Réglages du bot (hg_settings.bot). Tous les champs sont facultatifs : une valeur absente désactive la fonction. */
type Bot = MentionBot & {
  announce_channel_id?: string | null;
  birthday_channel_id?: string | null;
  channels?: Partial<Record<MentionType, string | string[] | null>> | null;
  salons?: { id: string; nom: string }[] | null;
  admin_discord_id?: string | null;
  notify?: Partial<Record<'draw' | 'gift' | 'irl' | 'birthday' | 'support' | 'messages' | 'card_pull' | 'card_trade' | 'trade_offer' | 'card_wish' | 'card_gift_admin' | 'card_drop', boolean>>;
};
/** Profil de l'appelant ou d'un destinataire, tel que lu par la fonction. */
type Profile = { id: string; pseudo: string; is_admin: boolean; discord_id: string | null; bot_optin: boolean };

/** Erreur liée à la requête (droits, données absentes...). Son statut HTTP est renvoyé à l'appelant. */
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/* ---------- Discord : client partagé (_shared/discord.ts : 429, MP, salon) ---------- */

/** Vrai si le jeton du bot est configuré. Alias de hasBotToken. */
const hasToken = hasBotToken;
/**
 * Exécute un envoi Discord sans jamais faire échouer la fonction : l'erreur est seulement journalisée.
 * Un message qui ne part pas ne doit pas empêcher la suite (autres MP, autres annonces).
 * @param {() => Promise<unknown>} fn Envoi à exécuter.
 * @param {string} label Nom de l'envoi, pour le journal.
 * @returns {Promise<boolean>} true si l'envoi a réussi.
 */
async function trySend(fn: () => Promise<unknown>, label: string): Promise<boolean> {
  try { await fn(); return true; } catch (e) { console.error(`[hg-notify] ${label}`, e); return false; }
}
/**
 * Embed Discord avec pied de page « Humane Gang » et horodatage ajoutés par défaut.
 * @param {Record<string, unknown>} e Champs de l'embed.
 * @returns {{embeds: object[]}} Corps à fusionner dans le message.
 */
const embed = (e: Record<string, unknown>) => ({ embeds: [{ footer: { text: 'Humane Gang' }, timestamp: new Date().toISOString(), ...e }] });
/**
 * Vrai si le profil peut recevoir un MP : il a accepté le bot et a un identifiant Discord valide.
 * @param {Profile | null | undefined} p Profil.
 * @returns {boolean} Vrai si le MP peut partir.
 */
const canDM = (p: Profile | null | undefined): p is Profile => !!p && p.bot_optin && !!p.discord_id && /^\d{17,20}$/.test(p.discord_id);

/**
 * Trace d'une annonce publiée dans des salons (hg_bot_log, colonne channels = détail par salon, migration 070).
 * Écrite si au moins un salon a échoué, ou toujours si always (annonces lancées par l'admin). Le texte contient « échec »
 * quand un salon a échoué, pour le filtre « Échecs » de l'historique. Ne lève jamais d'erreur.
 * @param {Profile} me Appelant (auteur de l'action qui a déclenché l'annonce).
 * @param {string} kind Type de ligne (ex. « auto:carte »).
 * @param {string} title Titre de la ligne.
 * @param {ChannelResult[]} results Résultat par salon.
 * @param {boolean} always Écrire même si tous les salons ont reçu l'annonce.
 * @returns {Promise<void>}
 */
async function logAnnounce(me: Profile, kind: string, title: string, results: ChannelResult[], always: boolean): Promise<void> {
  const failed = results.filter((r) => !r.ok);
  if (!results.length || (!failed.length && !always)) return;
  const ok = results.length - failed.length;
  try {
    const { error } = await insertWithChannels((row) => db.from('hg_bot_log').insert(row), {
      sent_by: me.id, kind, title: truncate(title, 200), recipients: [], channel: ok > 0,
      body: failed.length
        ? truncate(`${failed.length} salon(s) en échec sur ${results.length} (non réessayés${ok ? '' : ', nouvelle tentative possible'}) : `
          + failed.map((r) => `${r.id} : ${r.error ?? 'échec'}`).join(' ; '), 2000)
        : `Publié dans ${results.length} salon(s).`,
    }, channelLog(results));
    if (error) console.error(`[hg-notify] journal ${kind}`, error);
  } catch (e) { console.error(`[hg-notify] journal ${kind}`, e); }
}

/* ---------- Données ---------- */

/**
 * Lit les réglages du bot (hg_settings.bot). Renvoie {} si rien n'est enregistré.
 * @returns {Promise<Bot>} Réglages du bot.
 */
async function getBot(): Promise<Bot> {
  const { data } = await db.from('hg_settings').select('value').eq('key', 'bot').maybeSingle();
  return (data?.value ?? {}) as Bot;
}
/**
 * Lit un profil par identifiant.
 * @param {string} id Identifiant du membre.
 * @returns {Promise<Profile | null>} Le profil, ou null s'il n'existe pas.
 */
async function getProfile(id: string): Promise<Profile | null> {
  const { data } = await db.from('hg_profiles').select('id, pseudo, is_admin, discord_id, bot_optin').eq('id', id).maybeSingle();
  return data as Profile | null;
}
/**
 * Vrai si la valeur ressemble à un UUID (forme seulement, sans vérifier qu'il existe).
 * @param {unknown} v Valeur à tester.
 * @returns {boolean}
 */
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
/**
 * Date formatée pour les messages (fuseau de Zurich), avec ou sans jour de semaine et heure.
 * @param {string | null | undefined} d Date ISO.
 * @param {boolean} [withTime] Ajoute le jour de la semaine et l'heure.
 * @returns {string | null} Texte formaté, ou null si la date est absente.
 */
const fmtDate = (d: string | null | undefined, withTime = false) => d
  ? new Intl.DateTimeFormat('fr-CH', {
      timeZone: 'Europe/Zurich', weekday: withTime ? 'long' : undefined, day: 'numeric', month: 'long', year: withTime ? undefined : 'numeric',
      hour: withTime ? '2-digit' : undefined, minute: withTime ? '2-digit' : undefined,
    }).format(new Date(d))
  : null;
/**
 * Vrai si l'horodatage est moins vieux que FRESH_MS (15 min). Sert contre les envois répétés.
 * @param {string | null | undefined} ts Horodatage ISO.
 * @returns {boolean}
 */
const recent = (ts: string | null | undefined) => !!ts && Date.now() - new Date(ts).getTime() < FRESH_MS;

/** Fenêtre de la limite par membre (heure glissante). */
const QUOTA_WINDOW_MS = 60 * 60_000;
/** Les lignes de quota plus vieilles que ça sont purgées au passage. */
const QUOTA_KEEP_MS = 2 * 24 * 60 * 60_000;
/**
 * Consomme une unité de la limite horaire du membre (hg_bot_quota, migration 075), juste avant un envoi réel.
 * La ligne est insérée puis comptée : même des appels simultanés ne dépassent pas la limite. L'admin n'est pas limité.
 * Échec fermé : si l'insertion ou le comptage échoue, l'envoi est refusé (503), la limite ne pouvant être vérifiée.
 * @param {Profile} me Appelant.
 * @param {Bot} bot Réglages du bot (bot.limites.annonces_par_heure).
 * @param {string} event Événement compté.
 * @returns {Promise<void>}
 * @throws {HttpError} 429 si la limite est dépassée, 503 si elle ne peut pas être vérifiée.
 */
async function takeQuota(me: Profile, bot: Bot, event: string): Promise<void> {
  if (me.is_admin) return;
  const max = botRules(bot as unknown as Record<string, unknown>).annonces_heure;
  const { error: insErr } = await db.from('hg_bot_quota').insert({ user_id: me.id, event });
  if (insErr) { console.error('[hg-notify] quota (insertion)', insErr); throw new HttpError(503, 'Envoi impossible pour le moment : réessaie plus tard.'); }
  const { count, error } = await db.from('hg_bot_quota').select('id', { count: 'exact', head: true })
    .eq('user_id', me.id).gte('created_at', new Date(Date.now() - QUOTA_WINDOW_MS).toISOString());
  if (error) { console.error('[hg-notify] quota (comptage)', error); throw new HttpError(503, 'Envoi impossible pour le moment : réessaie plus tard.'); }
  // Purge des vieilles lignes du membre (sans attendre ni faire échouer l'envoi).
  db.from('hg_bot_quota').delete().eq('user_id', me.id).lt('created_at', new Date(Date.now() - QUOTA_KEEP_MS).toISOString())
    .then(({ error: e }) => { if (e) console.error('[hg-notify] quota (purge)', e); });
  if ((count ?? 0) > max) throw new HttpError(429, 'Trop d\'annonces envoyées en une heure : réessaie plus tard.');
}

/**
 * Réserve une ligne pour un envoi : passe la colonne de null à « maintenant ». Seul le premier appel réussit.
 * @param {string} table Table.
 * @param {string} col Colonne de réservation.
 * @param {Record<string, unknown>} keys Filtres d'égalité qui désignent la ligne.
 * @returns {Promise<boolean>} true si la réservation est prise par cet appel.
 * @throws {Error} si la requête échoue (colonne absente…) : 500 générique.
 */
async function claim(table: string, col: string, keys: Record<string, unknown>): Promise<boolean> {
  let q = db.from(table).update({ [col]: new Date().toISOString() });
  for (const [k, v] of Object.entries(keys)) q = q.eq(k, v as string);
  const { data, error } = await q.is(col, null).select(col);
  if (error) throw new Error(`réservation ${table}.${col} : ${error.message}`);
  return !!data?.length;
}
/**
 * Libère une réservation quand rien n'est parti, pour qu'un nouvel appel puisse réessayer.
 * @param {string} table Table.
 * @param {string} col Colonne de réservation.
 * @param {Record<string, unknown>} keys Filtres d'égalité qui désignent la ligne.
 * @returns {Promise<void>}
 */
async function release(table: string, col: string, keys: Record<string, unknown>): Promise<void> {
  let q = db.from(table).update({ [col]: null });
  for (const [k, v] of Object.entries(keys)) q = q.eq(k, v as string);
  const { error } = await q;
  if (error) console.error(`[hg-notify] libération ${table}.${col}`, error);
}

/* ---------- Événements ---------- */

/**
 * Tirage du Secret Santa (ss_draw, admin) : annonce dans le salon et MP à chaque participant opt-in.
 * Les MP partent un par un, avec une pause de 300 ms, pour rester sous les limites de Discord.
 * @param {Profile} me Appelant (doit être admin).
 * @param {Bot} bot Réglages du bot.
 * @param {Record<string, unknown>} p Corps de la requête (edition_id).
 * @param {Templates} tpl Modèles personnalisés.
 * @returns {Promise<object>} Nombre de MP envoyés et échoués, et si l'annonce est partie.
 * @throws {HttpError} 403 si l'appelant n'est pas admin, 400 si l'identifiant manque, 404 ou 409 si le tirage est absent.
 */
async function onDraw(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!me.is_admin) throw new HttpError(403, 'Réservé à l\'admin');
  if (!isUuid(p.edition_id)) throw new HttpError(400, 'edition_id manquant');
  if (bot.notify?.draw === false) return { skipped: 'désactivé' };
  const { data: ed } = await db.from('hg_ss_editions').select('id, year, budget, send_deadline, exchange_date, drawn_at').eq('id', p.edition_id).maybeSingle();
  if (!ed) throw new HttpError(404, 'Édition introuvable');
  if (!ed.drawn_at) throw new HttpError(409, 'Le tirage n\'a pas encore été fait');

  // Participants et leur profil (jointure PostgREST sur hg_profiles).
  const { data: parts } = await db.from('hg_ss_participants')
    .select('user_id, hg_profiles(id, pseudo, is_admin, discord_id, bot_optin)').eq('edition_id', ed.id);
  const people = (parts ?? []).map((r: any) => r.hg_profiles as Profile).filter(Boolean);

  // Champs affichés dans l'annonce et dans les MP (budget et date limite, s'ils sont renseignés).
  const fields = [
    ...(ed.budget ? [{ name: 'Budget', value: String(ed.budget), inline: true }] : []),
    ...(ed.send_deadline ? [{ name: 'Envoi avant le', value: fmtDate(ed.send_deadline)!, inline: true }] : []),
  ];
  const vars = {
    annee: ed.year, participants: people.length, budget: ed.budget ?? '', date_limite: fmtDate(ed.send_deadline) ?? '',
    date_echange: fmtDate(ed.exchange_date) ?? '', lien: link('secret-santa.html') ?? '',
  };
  const drawChannels = channelsFor(bot, 'draw');
  let channels: ChannelResult[] = [];
  if (drawChannels.length) {
    const annonce = {
      ...mentionFor(bot, 'draw'),
      ...embed({ ...embedFrom(renderTemplate('ss_draw_announce', vars, tpl)), url: link('secret-santa.html'), color: COLOR.ss, fields }),
    };
    channels = await sendToChannels(drawChannels, (id) => sendChannel(id, annonce), 'annonce tirage', friendlyDiscordError);
    await logAnnounce(me, 'auto:tirage', `Annonce du tirage ${ed.year}`, channels, true);
  }
  const announced = channels.some((c) => c.ok);
  let dms = 0, failed = 0;
  for (const person of people.filter(canDM)) {
    const ok = await trySend(() => sendDM(person.discord_id!, embed({
      ...embedFrom(renderTemplate('ss_draw_dm', { ...vars, pseudo: mdSafe(person.pseudo) }, tpl)),
      url: link('secret-santa.html'), color: COLOR.ss, fields,
    })), `MP tirage ${person.id}`);
    ok ? dms++ : failed++;
    await new Promise((r) => setTimeout(r, 300)); // reste sous les limites de Discord
  }
  return { announced, channels, dms_sent: dms, dms_failed: failed };
}

/**
 * Envoi ou réception de cadeau (Secret Santa) : MP au partenaire (le Santa ou la cible).
 * Le Santa n'est jamais nommé dans le MP envoyé à la cible. L'attribution est lue en base, jamais renvoyée au client.
 * @param {Profile} me Appelant (participant).
 * @param {Bot} bot Réglages du bot.
 * @param {Record<string, unknown>} p Corps de la requête (edition_id).
 * @param {'sent' | 'received'} kind « sent » : le Santa a envoyé ; « received » : la cible a reçu.
 * @param {Templates} tpl Modèles personnalisés.
 * @returns {Promise<object>} { dm: boolean } ou une raison de non-envoi.
 * @throws {HttpError} 400, 403 (pas participant), 409 (envoi ou réception non enregistré).
 */
async function onGift(me: Profile, bot: Bot, p: Record<string, unknown>, kind: 'sent' | 'received', tpl: Templates) {
  if (!isUuid(p.edition_id)) throw new HttpError(400, 'edition_id manquant');
  if (bot.notify?.gift === false) return { skipped: 'désactivé' };
  const { data: part } = await db.from('hg_ss_participants').select('sent_at, received_at, gift_notified_at, received_notified_at')
    .eq('edition_id', p.edition_id).eq('user_id', me.id).maybeSingle();
  if (!part) throw new HttpError(403, 'Tu ne participes pas à cette édition');
  const ts = kind === 'sent' ? part.sent_at : part.received_at;
  if (!ts) throw new HttpError(409, kind === 'sent' ? 'Envoi non enregistré' : 'Réception non enregistrée');
  // Un MP n'est envoyé que si l'action est récente (anti-répétition).
  if (!recent(ts)) return { skipped: 'action trop ancienne' };
  if (kind === 'sent' ? part.gift_notified_at : part.received_notified_at) return { skipped: 'déjà notifié' };

  // Service role : on lit l'attribution côté serveur, sans jamais la renvoyer au client.
  // Si l'appelant est le Santa (sent), on cherche sa cible (receiver_id) ; sinon on cherche son Santa (giver_id).
  const role = kind === 'sent' ? 'giver_id' : 'receiver_id';
  const { data: a } = await db.from('hg_ss_assignments').select('giver_id, receiver_id')
    .eq('edition_id', p.edition_id).eq(role, me.id).maybeSingle();
  if (!a) return { skipped: 'pas d\'attribution' };
  const { data: ed } = await db.from('hg_ss_editions').select('year, exchange_date').eq('id', p.edition_id).maybeSingle();
  const other = await getProfile(kind === 'sent' ? a.receiver_id : a.giver_id);
  if (!canDM(other)) return { dm: false, reason: 'destinataire sans Discord ou opt-out' };

  // ss_gift_sent part chez la cible : aucune variable ne désigne le Santa. ss_gift_received part chez le Santa : {cible} = me.
  const base = { pseudo: mdSafe(other.pseudo), annee: ed?.year ?? '', date_echange: fmtDate(ed?.exchange_date) ?? '', lien: link('secret-santa.html') ?? '' };
  const rendered = kind === 'sent'
    ? renderTemplate('ss_gift_sent', base, tpl)
    : renderTemplate('ss_gift_received', { ...base, cible: mdSafe(me.pseudo) }, tpl);
  const message = embed({ ...embedFrom(rendered), url: link('secret-santa.html'), color: COLOR.ss });
  // Un seul MP par participant, édition et sens (I7) : rappeler l'événement ne renvoie rien.
  await takeQuota(me, bot, `ss_gift_${kind}`);
  const col = kind === 'sent' ? 'gift_notified_at' : 'received_notified_at';
  const keys = { edition_id: p.edition_id, user_id: me.id };
  if (!(await claim('hg_ss_participants', col, keys))) return { skipped: 'déjà notifié' };
  const dm = await trySend(() => sendDM(other.discord_id!, message), `MP cadeau ${kind}`);
  if (!dm) await release('hg_ss_participants', col, keys);
  return { dm };
}

/**
 * Nouvelle sortie IRL : annonce dans le salon, seulement par l'organisateur (ou l'admin) et dans l'heure qui suit la création.
 * @param {Profile} me Appelant.
 * @param {Bot} bot Réglages du bot.
 * @param {Record<string, unknown>} p Corps de la requête (event_id).
 * @param {Templates} tpl Modèles personnalisés.
 * @returns {Promise<object>} { channel: boolean } ou une raison de non-envoi.
 * @throws {HttpError} 400, 403 (pas organisateur), 404 (sortie introuvable).
 */
async function onIrl(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!isUuid(p.event_id)) throw new HttpError(400, 'event_id manquant');
  if (bot.notify?.irl === false) return { skipped: 'désactivé' };
  const irlChannels = channelsFor(bot, 'irl');
  if (!irlChannels.length) return { skipped: 'aucun salon configuré' };
  const { data: ev } = await db.from('hg_events').select('id, title, description, location, starts_at, created_by, created_at, retro, announced_at')
    .eq('id', p.event_id).maybeSingle();
  if (!ev) throw new HttpError(404, 'Sortie introuvable');
  if (ev.created_by !== me.id && !me.is_admin) throw new HttpError(403, 'Seul l\'organisateur peut annoncer cette sortie');
  // Pas d'annonce tardive : la sortie doit avoir été créée il y a moins d'une heure.
  if (Date.now() - new Date(ev.created_at).getTime() > 60 * 60_000) return { skipped: 'sortie déjà ancienne' };
  // Une rencontre passée (créée depuis l'historique) n'est jamais annoncée comme une nouvelle sortie.
  if (ev.retro) return { skipped: 'sortie passée' };
  if (ev.announced_at) return { skipped: 'déjà annoncée' };

  const when = fmtDate(ev.starts_at, true) ?? 'Date à choisir (sondage sur le site)';
  // Titre, description, lieu et pseudo sont du texte libre de membre : Markdown neutralisé (pas de lien masqué).
  const where = mdSafe(String(ev.location || 'À préciser').slice(0, 200));
  const orga = mdSafe(me.pseudo);
  const fields = [
    { name: 'Quand', value: when, inline: true },
    { name: 'Où', value: where, inline: true },
    { name: 'Proposée par', value: orga, inline: true },
  ];
  const rendered = renderTemplate('irl_new', {
    titre: mdSafe(String(ev.title).slice(0, 200)),
    description: ev.description ? mdSafe(String(ev.description).slice(0, 600)) : 'Dis si tu viens sur le site.',
    lieu: where, date: when, organisateur: orga, lien: link('irl.html') ?? '',
  }, tpl);
  const annonce = {
    ...mentionFor(bot, 'irl'),
    ...embed({ ...embedFrom(rendered), url: link('irl.html'), color: COLOR.irl, fields }),
  };
  // Réservation (I7) : une seule annonce par sortie, libérée si aucun salon ne l'a reçue.
  await takeQuota(me, bot, 'irl_new');
  if (!(await claim('hg_events', 'announced_at', { id: ev.id }))) return { skipped: 'déjà annoncée' };
  const channels = await sendToChannels(irlChannels, (id) => sendChannel(id, annonce), 'annonce IRL', friendlyDiscordError);
  await logAnnounce(me, 'auto:sortie', `Annonce de sortie : ${ev.title}`, channels, false);
  const channel = channels.some((c) => c.ok);
  if (!channel) await release('hg_events', 'announced_at', { id: ev.id });
  return { channel, channels };
}

/** Un message déclencheur doit dater de moins de 2 minutes. */
const MSG_FRESH_MS = 2 * 60_000;   // le message déclencheur doit avoir moins de 2 min
/** Pas de MP si le message précédent de la conversation est trop récent : la discussion est en cours. */
const MSG_QUIET_MS = 10 * 60_000;  // pas de MP si le message précédent de la conversation a moins de 10 min
/**
 * Nouveau message dans une conversation : MP aux autres membres, avec un extrait (200 caractères au plus).
 * Pour un Secret Santa, l'expéditeur n'est jamais nommé. Pas de MP pendant une discussion en cours.
 * @param {Profile} me Expéditeur (doit être membre de la conversation).
 * @param {Bot} bot Réglages du bot.
 * @param {Record<string, unknown>} p Corps de la requête (conversation_id).
 * @param {Templates} tpl Modèles personnalisés.
 * @returns {Promise<object>} Nombre de MP envoyés, échoués et ignorés.
 * @throws {HttpError} 400, 403 (pas membre), 404 (conversation introuvable).
 */
async function onMessage(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!isUuid(p.conversation_id)) throw new HttpError(400, 'conversation_id manquant');
  if (bot.notify?.messages === false) return { skipped: 'désactivé' };
  const convId = p.conversation_id;
  const { data: conv } = await db.from('hg_conversations').select('id, kind, santa_id, target_id').eq('id', convId).maybeSingle();
  if (!conv) throw new HttpError(404, 'Conversation introuvable');
  const { data: members } = await db.from('hg_conversation_members').select('user_id').eq('conversation_id', convId);
  const ids: string[] = (members ?? []).map((m: { user_id: string }) => m.user_id);
  if (!ids.includes(me.id)) throw new HttpError(403, 'Tu ne fais pas partie de cette conversation');

  // Deux derniers messages : le dernier doit être le mien et récent ; le précédent doit être assez ancien.
  const { data: last } = await db.from('hg_messages').select('id, sender_id, body, created_at, dm_notified_at')
    .eq('conversation_id', convId).order('id', { ascending: false }).limit(2);
  const [latest, previous] = last ?? [];
  if (!latest || latest.sender_id !== me.id) return { skipped: 'pas de message récent de ta part' };
  const latestAt = new Date(latest.created_at).getTime();
  if (Date.now() - latestAt > MSG_FRESH_MS) return { skipped: 'message trop ancien' };
  if (previous && latestAt - new Date(previous.created_at).getTime() < MSG_QUIET_MS) return { skipped: 'discussion en cours' };
  if (latest.dm_notified_at) return { skipped: 'déjà notifié' };

  // Dans un Secret Santa, le Santa (l'expéditeur) reste anonyme pour sa cible.
  const anonymous = conv.kind === 'santa' && conv.santa_id === me.id; // ne JAMAIS révéler le Santa
  // Extrait : espaces réduits, 200 caractères au plus.
  const raw = String(latest.body ?? '').replace(/\s+/g, ' ').trim();
  // Texte libre : Markdown neutralisé après la coupe (pas de lien masqué dans un MP du bot).
  const excerpt = mdSafe(raw.length > 200 ? `${raw.slice(0, 199)}…` : raw);
  const url = link(`messages.html?c=${encodeURIComponent(convId)}`);

  // Réservation (I7) : un seul lot de MP par message ; libérée si aucun MP n'est parti alors qu'il y a eu des échecs.
  await takeQuota(me, bot, 'message_new');
  if (!(await claim('hg_messages', 'dm_notified_at', { id: latest.id }))) return { skipped: 'déjà notifié' };
  let dms = 0, failed = 0, skipped = 0;
  for (const uid of ids.filter((id) => id !== me.id)) {
    const other = await getProfile(uid);
    if (!canDM(other)) { skipped++; continue; }
    // message_new_santa : l'expéditeur (le Santa) n'est JAMAIS passé dans les variables.
    const rendered = anonymous
      ? renderTemplate('message_new_santa', { pseudo: mdSafe(other.pseudo), extrait: excerpt || '(message vide)', lien: url ?? '' }, tpl)
      : renderTemplate('message_new', { pseudo: mdSafe(other.pseudo), expediteur: mdSafe(me.pseudo), extrait: excerpt || '(message vide)', lien: url ?? '' }, tpl);
    const ok = await trySend(() => sendDM(other.discord_id!, embed({
      ...embedFrom(rendered), url,
      color: conv.kind === 'santa' ? COLOR.ss : COLOR.info,
      ...(url ? { fields: [{ name: '\u200b', value: `[Répondre sur le site](${url})` }] } : {}),
    })), `MP message ${uid}`);
    ok ? dms++ : failed++;
  }
  if (!dms && failed) await release('hg_messages', 'dm_notified_at', { id: latest.id });
  return { dms_sent: dms, dms_failed: failed, recipients_skipped: skipped };
}

/**
 * Message de test (bot_test, admin) : envoie un message de vérification dans le salon et/ou en MP à l'admin.
 * @param {Profile} me Appelant (doit être admin).
 * @param {Bot} bot Réglages du bot.
 * @param {Templates} tpl Modèles personnalisés.
 * @returns {Promise<object>} Résultat par destination (channel, dm), ou un message d'erreur de configuration.
 * @throws {HttpError} 403 si l'appelant n'est pas admin.
 */
async function onTest(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!me.is_admin) throw new HttpError(403, 'Réservé à l\'admin');
  const out: Record<string, unknown> = {};
  // Test d'un salon par type d'annonce (bot.channels) : message seulement dans ce salon, sans MP.
  if (p.type != null && p.type !== '') {
    if (!MENTION_TYPES.includes(p.type as MentionType)) throw new HttpError(400, 'Type d\'annonce inconnu');
    const type = p.type as MentionType;
    const chans = channelsFor(bot, type);
    if (!chans.length) return { error: 'Aucun salon pour ce type : renseigne son salon, ou le salon d\'annonces, puis enregistre.' };
    out.type = type;
    const test = embed({
      ...embedFrom(renderTemplate('bot_test', { canal: `les annonces « ${CHANNEL_LABEL[type]} »`, pseudo: me.pseudo, lien: link('accueil.html') ?? '' }, tpl)),
      color: COLOR.info, url: link('accueil.html'),
    });
    const channels = await sendToChannels(chans, (id) => sendChannel(id, test), `test salon ${type}`, friendlyDiscordError);
    out.channel = channels.some((c) => c.ok);
    out.channels = channels;
    return out;
  }
  // Identifiants invalides ignorés (ils finiraient dans l'adresse de l'API Discord).
  const announceId = isSnowflake(bot.announce_channel_id) ? bot.announce_channel_id : null;
  const adminId = isSnowflake(bot.admin_discord_id) ? bot.admin_discord_id : null;
  if (!announceId && !adminId) return { error: 'Renseigne d\'abord l\'ID du salon ou ton ID Discord (17 à 20 chiffres), puis enregistre.' };
  if (announceId) {
    out.channel = await trySend(() => sendChannel(announceId, embed({
      ...embedFrom(renderTemplate('bot_test', { canal: 'les annonces', pseudo: me.pseudo, lien: link('accueil.html') ?? '' }, tpl)),
      color: COLOR.info, url: link('accueil.html'),
    })), 'test salon');
  }
  if (adminId) {
    out.dm = await trySend(() => sendDM(adminId, embed({
      ...embedFrom(renderTemplate('bot_test', { canal: 'les messages privés', pseudo: me.pseudo, lien: link('accueil.html') ?? '' }, tpl)),
      color: COLOR.info,
    })), 'test MP');
  }
  return out;
}

/* ---------- Message manuel de l'admin ---------- */
// Limites du message manuel : réglables (bot.envoi), défauts 100 destinataires, 2000 caractères, 4 pièces de 10 Mo.
/** Modes de mention acceptés pour une annonce manuelle. */
const MANUAL_MENTIONS = ['none', 'role', 'everyone'];
/** Nombre maximal de salons choisis pour une annonce manuelle (liste « channels »). */
const MAX_MANUAL_CHANNELS = 10;
/** Résultat d'un envoi pour un destinataire, renvoyé à l'admin et gardé dans le journal. */
type Recipient = { user_id: string; pseudo: string | null; ok: boolean; status: 'sent' | 'failed' | 'skipped'; reason: string | null };
/**
 * Traduit une erreur Discord en phrase compréhensible pour l'admin.
 * @param {unknown} e Erreur reçue (souvent un DiscordError).
 * @returns {string} Message court en français.
 */
const friendlyDiscordError = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  if (/Discord 403/.test(m) || /50007/.test(m)) return 'MP refusés par Discord (serveur non partagé ou MP fermés)';
  if (/Discord 400/.test(m) && /recipient/i.test(m)) return 'ID Discord invalide';
  if (/Discord 404/.test(m)) return 'Utilisateur Discord introuvable';
  if (/trop de requêtes/.test(m)) return 'Discord : trop de requêtes';
  return truncate(m, 160);
};
/** {pseudo} est la seule variable d'un message manuel ; le reste du texte est laissé tel quel. */
const withPseudo = (text: string, pseudo: string) => text.replace(/\{pseudo\}/g, pseudo);

/**
 * Droit « bot » : admin, ou Staff actif avec la permission « bot » (même règle que le panel et le bucket hg-bot-media).
 * @param {Profile} me Appelant.
 * @returns {Promise<boolean>}
 */
async function canUseBot(me: Profile): Promise<boolean> {
  if (me.is_admin) return true;
  const { data } = await db.from('hg_staff').select('perms, active').eq('user_id', me.id).maybeSingle();
  return !!data?.active && Array.isArray(data.perms) && (data.perms as string[]).includes('bot');
}

/**
 * Message manuel (admin_dm) : MP à chaque destinataire, et annonce facultative dans le salon, avec pièces jointes.
 * Les contrôles (taille, pièces, mention) se font avant tout envoi. Le journal garde le détail par destinataire.
 * @param {Profile} me Appelant (admin ou Staff « bot »).
 * @param {Bot} bot Réglages du bot.
 * @param {Record<string, unknown>} p Corps de la requête (user_ids, title, body, channel, mention, attachments).
 * @returns {Promise<object>} Détail par destinataire, compteurs, résultat de l'annonce et identifiant du journal.
 * @throws {HttpError} 400 (données invalides) ou 403 (droit insuffisant).
 * @throws {MediaError} 400 si une pièce jointe est refusée.
 */
async function onAdminDm(me: Profile, bot: Bot, p: Record<string, unknown>) {
  if (!(await canUseBot(me))) throw new HttpError(403, 'Réservé à l\'admin ou au Staff avec la permission Bot Discord');
  const raw: unknown[] = Array.isArray(p.user_ids) ? p.user_ids : [];
  const ids = [...new Set(raw.filter(isUuid).map((s) => s.toLowerCase()))];
  if (ids.length !== raw.length && !ids.length) throw new HttpError(400, 'Destinataires invalides');
  // Salons : liste facultative ; chaque identifiant doit être un salon connu. « channel: true » = salon d'annonces.
  // La limite (10 salons) s'applique après retrait des doublons, salon d'annonces compris.
  if (p.channels != null && !Array.isArray(p.channels)) throw new HttpError(400, 'Salons invalides');
  const rawChans: unknown[] = Array.isArray(p.channels) ? p.channels : [];
  if (rawChans.length > MAX_MANUAL_CHANNELS * 10) throw new HttpError(400, `${MAX_MANUAL_CHANNELS} salons maximum par envoi`);
  for (const c of rawChans) {
    if (typeof c !== 'string' || !isKnownChannel(bot, c)) throw new HttpError(400, `Salon inconnu : ${String(c)}`);
  }
  const wantChannel = p.channel === true;
  if (wantChannel && !isSnowflake(bot.announce_channel_id)) throw new HttpError(400, 'Aucun salon d\'annonces n\'est configuré');
  // Salons visés, sans doublon : le salon d'annonces (channel: true) puis les salons choisis.
  const targets = [...new Set([...(wantChannel ? [bot.announce_channel_id as string] : []), ...(rawChans as string[])])];
  if (targets.length > MAX_MANUAL_CHANNELS) throw new HttpError(400, `${MAX_MANUAL_CHANNELS} salons maximum par envoi`);
  if (!ids.length && !targets.length) throw new HttpError(400, 'Choisis au moins un destinataire (ou un salon)');
  const rules = botRules(bot as unknown as Record<string, unknown>);
  const MAX_USERS = rules.destinataires_max, MAX_BODY = rules.corps_max;
  if (raw.length > MAX_USERS * 2 || ids.length > MAX_USERS) throw new HttpError(400, `${MAX_USERS} destinataires maximum par envoi`);
  // Titre : sans caractère NUL, espaces réduits, 200 caractères au plus. Corps : sans NUL, borné par corps_max.
  const title = typeof p.title === 'string' ? p.title.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const body = typeof p.body === 'string' ? p.body.replace(/\u0000/g, '').trim() : '';
  if (!body) throw new HttpError(400, 'Le message est vide');
  if (body.length > MAX_BODY) throw new HttpError(400, `Message trop long (${MAX_BODY} caractères maximum)`);
  if (p.mention != null && !MANUAL_MENTIONS.includes(String(p.mention))) throw new HttpError(400, 'Mention inconnue');
  const mode = mentionMode(p.mention); // la mention ne concerne que la publication dans les salons
  if (targets.length && mode === 'role' && !isSnowflake(bot.mention_role_id)) {
    throw new HttpError(400, 'Aucun rôle à mentionner n\'est configuré (section Bot Discord)');
  }
  const attachPaths = validAttachmentPaths(p.attachments, rules.pieces_max); // chemins sous manuel/ ; erreur de contrôle → 400

  const { data: rows, error } = ids.length
    ? await db.from('hg_profiles').select('id, pseudo, is_admin, discord_id, bot_optin').in('id', ids)
    : { data: [], error: null };
  if (error) throw new Error(error.message);
  const byId = new Map<string, Profile>((rows ?? []).map((r: Profile) => [r.id, r]));

  // Fichiers lus une fois (service role), puis joints à chaque envoi. Une erreur de contrôle arrête tout avant l'envoi.
  const files = attachPaths.length ? await loadAttachments(db, attachPaths, rules.piece_max_mo * 1024 * 1024, rules.piece_max_mo) : [];
  const image = files.find((f) => f.type.startsWith('image/'));

  /**
   * Construit l'embed d'un message manuel pour un pseudo donné.
   * @param {string} pseudo Pseudo qui remplace {pseudo} dans le titre et le corps.
   * @returns {object} Embed prêt à envoyer.
   */
  const build = (pseudo: string) => {
    const t = truncate(withPseudo(title, pseudo).trim(), 256);
    const d = truncate(withPseudo(body, pseudo).trim(), 4096);
    return embed({
      ...(t ? { title: t } : {}), description: d || '\u200b', color: COLOR.accent,
      ...(image ? { image: { url: `attachment://${image.name}` } } : {}), // première image affichée dans l'embed
    });
  };

  // Un MP par destinataire ; les comptes non éligibles sont notés « skipped » avec la raison.
  const recipients: Recipient[] = [];
  let first = true;
  for (const id of ids) {
    const prof = byId.get(id);
    if (!prof) { recipients.push({ user_id: id, pseudo: null, ok: false, status: 'skipped', reason: 'Compte sans profil' }); continue; }
    if (!prof.discord_id || !/^\d{17,20}$/.test(prof.discord_id)) {
      recipients.push({ user_id: id, pseudo: prof.pseudo, ok: false, status: 'skipped', reason: 'Pas d\'ID Discord' }); continue;
    }
    if (!prof.bot_optin) { recipients.push({ user_id: id, pseudo: prof.pseudo, ok: false, status: 'skipped', reason: 'A refusé les MP du bot' }); continue; }
    if (!first) await new Promise((r) => setTimeout(r, 300)); // reste sous les limites de Discord
    first = false;
    try {
      await sendDM(prof.discord_id, build(mdSafe(prof.pseudo)), files);
      recipients.push({ user_id: id, pseudo: prof.pseudo, ok: true, status: 'sent', reason: null });
    } catch (e) {
      console.error(`[hg-notify] MP manuel ${id}`, e);
      recipients.push({ user_id: id, pseudo: prof.pseudo, ok: false, status: 'failed', reason: friendlyDiscordError(e) });
    }
  }

  // Annonce dans chaque salon visé : indépendante des MP ; un salon en échec n'empêche pas les autres ni le journal.
  const channels: ChannelResult[] = targets.length
    ? await sendToChannels(targets, (id) => sendChannel(id, { ...mentionWith(bot, mode), ...build('tout le monde') }, files), 'annonce manuelle', friendlyDiscordError)
    : [];
  const channelOk: boolean | null = targets.length ? channels.some((c) => c.ok) : null;
  const channelError: string | null = channels.find((c) => !c.ok)?.error ?? null;

  // Trace dans le journal du bot (historique de l'admin). Si la colonne « channels » (migration 070) manque, et seulement
  // dans ce cas, l'entrée est écrite sans les salons plutôt que perdue. Échec final : log_error dans la réponse.
  const logRes = await insertWithChannels(
    (row): PromiseLike<{ data: { id: number } | null; error: { code?: string; message: string } | null }> =>
      db.from('hg_bot_log').insert(row).select('id').maybeSingle(),
    { sent_by: me.id, kind: 'manual', title: title || null, body, recipients, channel: channelOk === true },
    channelLog(channels),
  );
  if (logRes.error) console.error('[hg-notify] hg_bot_log', logRes.error);
  const log = logRes.data;
  const logError: string | null = logRes.error ? truncate(String(logRes.error.message ?? logRes.error), 160) : null;

  /**
   * Compte les destinataires ayant un statut donné.
   * @param {'sent' | 'failed' | 'skipped'} s Statut recherché.
   * @returns {number}
   */
  const count = (s: Recipient['status']) => recipients.filter((r) => r.status === s).length;
  return {
    recipients, sent: count('sent'), failed: count('failed'), skipped: count('skipped'),
    channel: channelOk, channel_error: channelError, channels, log_id: log?.id ?? null, log_error: logError,
    mention: targets.length ? mode : 'none', attachments: files.map((f) => f.name),
  };
}

/* ---------- Événements dynamiques : annonce manuelle (admin) ---------- */

/**
 * Annonce manuelle d'un événement dynamique (début ou fin), déclenchée par l'admin depuis le panel.
 * Met à jour la date d'annonce seulement si l'envoi a réussi.
 * @param {Profile} me Appelant (doit être admin).
 * @param {Bot} bot Réglages du bot.
 * @param {Record<string, unknown>} p Corps de la requête (event_id, phase).
 * @param {Templates} tpl Modèles personnalisés.
 * @returns {Promise<object>} { sent, phase } ou une raison d'échec.
 * @throws {HttpError} 400, 403, 404.
 */
async function onDynAnnounce(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!me.is_admin) throw new HttpError(403, 'Réservé à l\'admin');
  if (!isUuid(p.event_id)) throw new HttpError(400, 'event_id manquant');
  const phase = p.phase === 'start' || p.phase === 'end' ? p.phase : null;
  if (!phase) throw new HttpError(400, 'phase attendue : start ou end');
  const { data: ev } = await db.from('hg_dyn_events').select('*').eq('id', p.event_id).maybeSingle();
  if (!ev) throw new HttpError(404, 'Événement introuvable');
  const dynChannels = channelsFor(bot, 'dyn');
  if (!dynChannels.length) return { sent: false, skipped: 'aucun salon d\'annonces configuré (section Bot Discord)' };
  const message = await buildDynAnnounce(db, ev as DynEvent, phase, tpl, SITE, mentionFor(bot, 'dyn'), botRules(bot as unknown as Record<string, unknown>).top_n);
  const channels = await sendToChannels(dynChannels, (id) => sendChannel(id, message), 'annonce événement', friendlyDiscordError);
  await logAnnounce(me, 'auto:evenement', `Annonce ${phase === 'start' ? 'de début' : 'de fin'} : ${(ev as DynEvent).name ?? ev.id}`, channels, true);
  if (!channels.some((c) => c.ok)) {
    return { sent: false, error: channels.find((c) => !c.ok)?.error ?? 'Aucun salon n\'a reçu l\'annonce', channels };
  }
  // Marque l'annonce comme faite (au moins un salon l'a reçue), pour que hg-cron ne la republie pas.
  const col = phase === 'start' ? 'announced_start_at' : 'announced_end_at';
  const { error } = await db.from('hg_dyn_events').update({ [col]: new Date().toISOString() }).eq('id', ev.id);
  if (error) console.error('[hg-notify] announced_*_at', error);
  return { sent: true, phase, channels };
}

/* ---------- Cartes à collectionner ---------- */

/** Libellés français des raretés annoncées publiquement. Les autres raretés ne sont pas annoncées. */
const CARD_RARITY_LABEL: Record<string, string> = { legendaire: 'Légendaire', mythique: 'Mythique', identite: 'Identité', unique: 'Unique' };
const CARD_FRESH_MS = 10 * 60_000; // l'exemplaire doit venir d'être obtenu (anti-spam)

/**
 * Annonce d'une belle carte obtenue (card_pull) : seulement pour les raretés annoncées, et une seule fois par exemplaire.
 * @param {Profile} me Appelant (doit posséder l'exemplaire récent).
 * @param {Bot} bot Réglages du bot.
 * @param {Record<string, unknown>} p Corps de la requête (card, serial facultatif).
 * @param {Templates} tpl Modèles personnalisés.
 * @returns {Promise<object>} { channel } ou une raison de non-envoi.
 * @throws {HttpError} 400, 404.
 */
async function onCardPull(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!isUuid(p.card)) throw new HttpError(400, 'card manquant');
  if (bot.notify?.card_pull === false) return { skipped: 'désactivé' };
  const pullChannels = channelsFor(bot, 'card_pull');
  if (!pullChannels.length) return { skipped: 'aucun salon configuré' };
  const { data: card } = await db.from('hg_cards').select('id, name, rarity, max_copies').eq('id', p.card).maybeSingle();
  if (!card) throw new HttpError(404, 'Carte introuvable');
  const rarete = CARD_RARITY_LABEL[card.rarity];
  if (!rarete) return { skipped: 'carte pas assez rare pour être annoncée' };

  // Service role : un exemplaire récent de cette carte doit appartenir à l'appelant. Valeurs lues en base.
  // Un exemplaire déjà annoncé (announced_at) n'est jamais annoncé deux fois : rappeler card_pull ne republie rien.
  let q = db.from('hg_card_copies').select('id, shiny, serial, obtained_at, source')
    .eq('card_id', card.id).eq('owner_id', me.id).is('recycled_at', null).is('announced_at', null)
    .gte('obtained_at', new Date(Date.now() - CARD_FRESH_MS).toISOString())
    .order('obtained_at', { ascending: false }).limit(1);
  if (Number.isInteger(p.serial)) q = q.eq('serial', p.serial as number);
  const { data: copy } = await q.maybeSingle();
  if (!copy) return { skipped: 'aucun exemplaire récent de cette carte' };
  // Verbe du texte : « a fabriqué » pour un exemplaire fabriqué, sinon « a obtenu » (source lue en base, jamais celle du client).
  const verbe = copy.source === 'fabrication' ? 'a fabriqué' : 'a obtenu';
  await takeQuota(me, bot, 'card_pull');
  // Réservation : seul un appel qui passe de null à « maintenant » publie l'annonce.
  const { data: claimed } = await db.from('hg_card_copies').update({ announced_at: new Date().toISOString() })
    .eq('id', copy.id).is('announced_at', null).select('id');
  if (!claimed?.length) return { skipped: 'déjà annoncé' };

  // Nom affiché : « (brillante) » si l'exemplaire l'est, « N° x/y » si l'exemplaire a un numéro de série.
  const carte = `${card.name}${copy.shiny ? ' (brillante)' : ''}${copy.serial ? ` N° ${copy.serial}${card.max_copies ? `/${card.max_copies}` : ''}` : ''}`;
  const rendered = renderTemplate('card_pull_announce', { pseudo: mdSafe(me.pseudo), carte, rarete, verbe, lien: link('cartes.html') ?? '' }, tpl);
  const annonce = {
    ...mentionFor(bot, 'card_pull'),
    ...embed({ ...embedFrom(rendered), url: link('cartes.html'), color: COLOR.card, fields: [{ name: 'Rareté', value: rarete, inline: true }] }),
  };
  const channels = await sendToChannels(pullChannels, (id) => sendChannel(id, annonce), 'annonce carte', friendlyDiscordError);
  await logAnnounce(me, 'auto:carte', `Annonce de carte : ${carte} (${me.pseudo})`, channels, false);
  const channel = channels.some((c) => c.ok);
  // Aucun salon n'a reçu l'annonce : on retire la réservation pour que la prochaine ouverture puisse réessayer.
  if (!channel) await db.from('hg_card_copies').update({ announced_at: null }).eq('id', copy.id);
  return { channel, channels };
}

/**
 * Échange conclu (card_trade) : annonce dans le salon, envoyée par le destinataire de l'offre, seulement si l'option est activée.
 * @param {Profile} me Appelant (le destinataire de l'offre).
 * @param {Bot} bot Réglages du bot.
 * @param {Record<string, unknown>} p Corps de la requête (trade_id).
 * @param {Templates} tpl Modèles personnalisés.
 * @returns {Promise<object>} { channel } ou une raison de non-envoi.
 * @throws {HttpError} 400, 403 (pas le destinataire), 404.
 */
async function onCardTrade(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!isUuid(p.trade_id)) throw new HttpError(400, 'trade_id manquant');
  if (bot.notify?.card_trade !== true) return { skipped: 'désactivé' };
  const tradeChannels = channelsFor(bot, 'card_trade');
  if (!tradeChannels.length) return { skipped: 'aucun salon configuré' };
  const { data: t } = await db.from('hg_card_trades').select('id, from_user, to_user, status, resolved_at, announced_at').eq('id', p.trade_id).maybeSingle();
  if (!t) throw new HttpError(404, 'Échange introuvable');
  // Seul le destinataire (celui qui accepte l'offre) annonce : une seule annonce par échange.
  if (t.to_user !== me.id) throw new HttpError(403, 'Seul le destinataire de l\'offre peut annoncer l\'échange');
  if (t.status !== 'acceptee') return { skipped: 'échange non conclu' };
  if (!recent(t.resolved_at)) return { skipped: 'échange déjà ancien' };
  if (t.announced_at) return { skipped: 'déjà annoncé' };
  const other = await getProfile(t.from_user);
  const rendered = renderTemplate('card_trade_announce', { pseudo: mdSafe(me.pseudo), partenaire: mdSafe(other?.pseudo ?? ''), lien: link('cartes.html') ?? '' }, tpl);
  const annonce = {
    ...mentionFor(bot, 'card_trade'),
    ...embed({ ...embedFrom(rendered), url: link('cartes.html'), color: COLOR.card }),
  };
  // Réservation (I7) : une seule annonce par échange, libérée si aucun salon ne l'a reçue.
  await takeQuota(me, bot, 'card_trade');
  if (!(await claim('hg_card_trades', 'announced_at', { id: t.id }))) return { skipped: 'déjà annoncé' };
  const channels = await sendToChannels(tradeChannels, (id) => sendChannel(id, annonce), 'annonce échange', friendlyDiscordError);
  await logAnnounce(me, 'auto:echange', `Annonce d'échange : ${me.pseudo}`, channels, false);
  const channel = channels.some((c) => c.ok);
  if (!channel) await release('hg_card_trades', 'announced_at', { id: t.id });
  return { channel, channels };
}

/* Offre d'échange reçue : MP au destinataire, envoyé par l'auteur juste après la création (ou la contre-proposition). */
/** Longueur maximale d'un nom de carte dans le MP d'échange. */
const TRADE_NAME_MAX = 40;   // caractères par nom de carte
/** Nombre de noms de cartes listés ; le reste est résumé (« et N autres »). */
const TRADE_NAMES_SHOWN = 5; // noms listés, le reste est résumé
/**
 * Choisit le singulier ou le pluriel selon le nombre.
 * @param {number} n Quantité.
 * @param {string} one Forme au singulier.
 * @param {string} many Forme au pluriel.
 * @returns {string}
 */
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
/**
 * Décrit un côté d'un échange : les cartes (5 noms au plus) et les Paillettes.
 * @param {string[]} cards Noms des cartes.
 * @param {number} paillettes Nombre de Paillettes.
 * @returns {string} Ex. « 2 cartes (A, B) + 50 Paillettes », ou « rien ».
 */
function tradeSide(cards: string[], paillettes: number): string {
  const shown = cards.slice(0, TRADE_NAMES_SHOWN).map((n) => truncate(n, TRADE_NAME_MAX));
  const more = cards.length - shown.length;
  const parts: string[] = [];
  if (cards.length) parts.push(`${cards.length} ${plural(cards.length, 'carte', 'cartes')} (${shown.join(', ')}${more > 0 ? ` et ${more} autre${more > 1 ? 's' : ''}` : ''})`);
  if (paillettes > 0) parts.push(`${paillettes} Paillettes`);
  return parts.join(' + ') || 'rien';
}

/**
 * Offre d'échange (trade_offer) : MP au destinataire, avec le détail de ce qui est donné et demandé.
 * @param {Profile} me Appelant (l'auteur de l'offre).
 * @param {Bot} bot Réglages du bot.
 * @param {Record<string, unknown>} p Corps de la requête (trade_id).
 * @param {Templates} tpl Modèles personnalisés.
 * @returns {Promise<object>} { dm } ou une raison de non-envoi.
 * @throws {HttpError} 400, 403 (pas l'auteur), 404.
 */
async function onTradeOffer(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!isUuid(p.trade_id)) throw new HttpError(400, 'trade_id manquant');
  if (bot.notify?.trade_offer === false) return { skipped: 'désactivé' };
  const { data: t } = await db.from('hg_card_trades')
    .select('id, from_user, to_user, status, created_at, parent_id, from_paillettes, to_paillettes').eq('id', p.trade_id).maybeSingle();
  if (!t) throw new HttpError(404, 'Offre introuvable');
  if (t.from_user !== me.id) throw new HttpError(403, 'Seul l\'auteur de l\'offre peut la notifier');
  if (t.status !== 'proposee') return { skipped: 'offre non ouverte' };
  if (!recent(t.created_at)) return { skipped: 'offre déjà ancienne' };

  // La fenêtre de 15 min écarte les vieilles offres ; l'anti-doublon est la réservation notified_at ci-dessous.
  const other = await getProfile(t.to_user);
  if (!canDM(other)) return { dm: false, reason: 'destinataire sans Discord ou opt-out' };
  await takeQuota(me, bot, 'trade_offer');
  // Réservation : seul un appel qui passe de null à « maintenant » envoie le MP. Un second appel ne renvoie rien.
  const { data: claimed, error: claimErr } = await db.from('hg_card_trades').update({ notified_at: new Date().toISOString() })
    .eq('id', t.id).is('notified_at', null).select('id');
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed?.length) return { skipped: 'déjà notifié' };

  // Cartes : côté 'from' = données par l'auteur, côté 'to' = demandées à leur destinataire (lecture serveur).
  const { data: items } = await db.from('hg_card_trade_items')
    .select('side, hg_card_copies(shiny, hg_cards(name))').eq('trade_id', t.id);
  type Row = { side: 'from' | 'to'; hg_card_copies: { shiny: boolean; hg_cards: { name: string } | null } | null };
  /**
   * Noms des cartes d'un côté de l'échange, avec « (brillante) » si l'exemplaire l'est.
   * @param {'from' | 'to'} side Côté à lire.
   * @returns {string[]}
   */
  const names = (side: 'from' | 'to') => ((items ?? []) as unknown as Row[])
    .filter((r) => r.side === side)
    .map((r) => `${r.hg_card_copies?.hg_cards?.name ?? 'Carte'}${r.hg_card_copies?.shiny ? ' (brillante)' : ''}`);

  const rendered = renderTemplate('trade_offer_dm', {
    pseudo: mdSafe(me.pseudo),
    contre: t.parent_id ? ' (contre-proposition)' : '',
    donne: tradeSide(names('from'), t.from_paillettes ?? 0),
    demande: tradeSide(names('to'), t.to_paillettes ?? 0),
    lien: link('cartes.html') ?? '',
  }, tpl);
  const ok = await trySend(() => sendDM(other.discord_id!, embed({
    ...embedFrom(rendered), url: link('cartes.html'), color: COLOR.card,
  })), `MP offre ${other.id}`);
  // Échec : on libère la réservation pour qu'un nouvel appel dans la fenêtre de 15 min puisse réessayer.
  if (!ok) await db.from('hg_card_trades').update({ notified_at: null }).eq('id', t.id);
  return { dm: ok };
}

/* Don de carte par l'admin ou le Staff « cartes » (hg_cards_admin_give) : MP au membre, envoyé par le site après le don. */
/** Nombre maximal d'exemplaires par don (même limite que la fonction SQL). */
const CARD_GIFT_MAX = 100; // exemplaires max par don (comme la RPC)
/** Noms des raretés en français minuscule, pour la phrase du MP de don. */
const RARITY_NAME: Record<string, string> = {
  commune: 'commune', peu_commune: 'peu commune', rare: 'rare', epique: 'épique',
  legendaire: 'légendaire', mythique: 'mythique', identite: 'identité', unique: 'unique',
};
/**
 * Droit « cartes » : admin, ou Staff actif avec la permission (même règle que hg_has_perm('cartes') côté base).
 * @param {Profile} me Appelant.
 * @returns {Promise<boolean>}
 */
async function canUseCards(me: Profile): Promise<boolean> {
  if (me.is_admin) return true;
  const { data } = await db.from('hg_staff').select('perms, active').eq('user_id', me.id).maybeSingle();
  return !!data?.active && Array.isArray(data.perms) && (data.perms as string[]).includes('cartes');
}

/**
 * Don de carte par l'admin ou le Staff « cartes » : MP au membre qui a reçu le don.
 * Le nombre annoncé est borné par les exemplaires réellement donnés il y a moins de 15 min.
 * @param {Profile} me Appelant (admin ou Staff « cartes »).
 * @param {Bot} bot Réglages du bot.
 * @param {Record<string, unknown>} p Corps de la requête (user_id, card_id, count).
 * @param {Templates} tpl Modèles personnalisés.
 * @returns {Promise<object>} { dm, count } ou une raison de non-envoi.
 * @throws {HttpError} 400, 403, 404.
 */
async function onCardGiftAdmin(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!(await canUseCards(me))) throw new HttpError(403, 'Réservé à l\'admin ou au Staff avec la permission Cartes');
  if (!isUuid(p.user_id)) throw new HttpError(400, 'user_id manquant');
  if (!isUuid(p.card_id)) throw new HttpError(400, 'card_id manquant');
  const asked = Number.isInteger(p.count) ? (p.count as number) : 1;
  if (asked < 1 || asked > CARD_GIFT_MAX) throw new HttpError(400, `Nombre d'exemplaires : entre 1 et ${CARD_GIFT_MAX}`);
  if (bot.notify?.card_gift_admin === false) return { skipped: 'désactivé' };

  // Dons récents de cette carte à ce membre (lus en base : le client ne fournit ni la rareté ni la brillance).
  const { data: gifts, error } = await db.from('hg_card_copies').select('id, shiny, obtained_at, gift_dm_at')
    .eq('card_id', p.card_id).eq('owner_id', p.user_id).eq('source', 'admin').is('recycled_at', null)
    .gte('obtained_at', new Date(Date.now() - FRESH_MS).toISOString())
    .order('obtained_at', { ascending: false });
  if (error) throw new Error(error.message);
  if (!gifts?.length) return { skipped: 'aucun don récent de cette carte' };
  // Seuls les exemplaires pas encore annoncés comptent (migration 079 : gift_dm_at).
  const fresh = gifts.filter((g: { gift_dm_at: string | null }) => !g.gift_dm_at);
  if (!fresh.length) return { skipped: 'déjà annoncé' };
  const shiny = !!fresh[0].shiny; // un même don a la même brillance pour tous ses exemplaires

  const { data: card } = await db.from('hg_cards').select('name, rarity, image_url').eq('id', p.card_id).maybeSingle();
  if (!card) throw new HttpError(404, 'Carte introuvable');
  const other = await getProfile(p.user_id);
  if (!canDM(other)) return { dm: false, reason: 'destinataire sans Discord ou opt-out' };

  // Réservation anti-rejeu : les exemplaires annoncés passent gift_dm_at de null à « maintenant » ; seul le premier
  // appel les obtient. Libérés si le MP ne part pas, pour pouvoir réessayer.
  const ids = fresh.slice(0, asked).map((g: { id: string }) => g.id);
  const { data: claimed, error: claimErr } = await db.from('hg_card_copies').update({ gift_dm_at: new Date().toISOString() })
    .in('id', ids).is('gift_dm_at', null).select('id');
  if (claimErr) throw new Error(`réservation hg_card_copies.gift_dm_at : ${claimErr.message}`);
  if (!claimed?.length) return { skipped: 'déjà annoncé' };
  const claimedIds = claimed.map((c: { id: string }) => c.id);
  const count = claimedIds.length;

  // Détail affiché : rareté, puis « brillante » si besoin.
  const detail = [RARITY_NAME[card.rarity] ?? card.rarity, shiny ? 'brillante' : ''].filter(Boolean).join(', ');
  const rendered = renderTemplate('card_gift_admin_dm', {
    admin: me.pseudo, carte: truncate(String(card.name), 100), detail, quantite: count > 1 ? ` ×${count}` : '',
  }, tpl);
  // L'image n'est reprise dans le MP que si elle est en https (Discord ne charge pas les autres).
  const image = typeof card.image_url === 'string' && /^https:\/\//.test(card.image_url) ? card.image_url : null;
  const ok = await trySend(() => sendDM(other.discord_id!, embed({
    ...embedFrom(rendered), url: link('cartes.html'), color: COLOR.card,
    ...(image ? { image: { url: image } } : {}),
  })), `MP don carte ${other.id}`);
  if (!ok) {
    const { error: relErr } = await db.from('hg_card_copies').update({ gift_dm_at: null }).in('id', claimedIds);
    if (relErr) console.error('[hg-notify] libération hg_card_copies.gift_dm_at', relErr);
  }
  return { dm: ok, count };
}

/* Drop lancé par l'admin ou le Staff « cartes » (hg_drop_create) : annonce dans le salon, envoyée par le site juste après. */
/**
 * Annonce d'un drop (card_drop) : « une carte sauvage est apparue », avec la carte, le nombre d'exemplaires et l'heure de fin.
 * Tout est lu en base (le client ne fournit que l'identifiant du drop). Une seule annonce par drop.
 * @param {Profile} me Appelant (admin ou Staff « cartes »).
 * @param {Bot} bot Réglages du bot.
 * @param {Record<string, unknown>} p Corps de la requête (drop_id).
 * @param {Templates} tpl Modèles personnalisés.
 * @returns {Promise<object>} { channel } ou une raison de non-envoi.
 * @throws {HttpError} 400, 403, 404.
 */
async function onCardDrop(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!(await canUseCards(me))) throw new HttpError(403, 'Réservé à l\'admin ou au Staff avec la permission Cartes');
  if (!isUuid(p.drop_id)) throw new HttpError(400, 'drop_id manquant');
  if (bot.notify?.card_drop === false) return { skipped: 'désactivé' };
  const dropChannels = channelsFor(bot, 'card_drop');
  if (!dropChannels.length) return { skipped: 'aucun salon configuré' };
  const { data: d } = await db.from('hg_card_drops').select('id, card_id, shiny, quantity, ends_at, created_at, discord_announced_at')
    .eq('id', p.drop_id).maybeSingle();
  if (!d) throw new HttpError(404, 'Drop introuvable');
  if (!recent(d.created_at)) return { skipped: 'drop déjà ancien' };
  if (new Date(d.ends_at).getTime() <= Date.now()) return { skipped: 'drop terminé' };
  if (d.discord_announced_at) return { skipped: 'déjà annoncé' };
  const { data: card } = await db.from('hg_cards').select('name, rarity, image_url').eq('id', d.card_id).maybeSingle();
  if (!card) throw new HttpError(404, 'Carte introuvable');

  // Réservation : seul un appel qui passe de null à « maintenant » publie l'annonce.
  const { data: claimed, error: claimErr } = await db.from('hg_card_drops').update({ discord_announced_at: new Date().toISOString() })
    .eq('id', d.id).is('discord_announced_at', null).select('id');
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed?.length) return { skipped: 'déjà annoncé' };

  const nom = RARITY_NAME[card.rarity] ?? String(card.rarity);
  const rarete = nom.charAt(0).toUpperCase() + nom.slice(1);
  const carte = `${truncate(String(card.name), 100)}${d.shiny ? ' (brillante)' : ''}`;
  const quantite = `${d.quantity} exemplaire${d.quantity > 1 ? 's' : ''}`;
  const fin = fmtDate(d.ends_at, true) ?? '';
  const rendered = renderTemplate('card_drop_announce', { carte, rarete, quantite, fin, lien: link('accueil.html') ?? '' }, tpl);
  // L'image n'est reprise que si elle est en https (Discord ne charge pas les autres).
  const image = typeof card.image_url === 'string' && /^https:\/\//.test(card.image_url) ? card.image_url : null;
  const annonce = {
    ...mentionFor(bot, 'card_drop'),
    ...embed({
      ...embedFrom(rendered), url: link('accueil.html'), color: COLOR.card,
      fields: [{ name: 'Exemplaires', value: quantite, inline: true }, ...(fin ? [{ name: 'Jusqu\'à', value: fin, inline: true }] : [])],
      ...(image ? { image: { url: image } } : {}),
    }),
  };
  const channels = await sendToChannels(dropChannels, (id) => sendChannel(id, annonce), 'annonce drop', friendlyDiscordError);
  await logAnnounce(me, 'auto:drop', `Annonce de drop : ${carte}`, channels, true);
  const channel = channels.some((c) => c.ok);
  // Aucun salon n'a reçu l'annonce : on libère la réservation pour qu'un nouvel appel puisse réessayer.
  if (!channel) await db.from('hg_card_drops').update({ discord_announced_at: null }).eq('id', d.id);
  return { channel, channels };
}

/* F12 : un membre obtient une carte que d'autres souhaitent → MP aux souhaitants qui ont activé l'alerte */
/** Nombre maximal de cartes distinctes traitées par appel (une ouverture de booster). */
const WISH_MAX_CARDS = 10; // cartes distinctes par appel (une ouverture de booster)
/** Nombre maximal de MP par appel, pour rester raisonnable. */
const WISH_MAX_DMS = 50;   // MP maximum par appel
/**
 * Alerte « souhaits » (card_wish) : prévient les membres qui veulent une carte qu'on vient d'obtenir.
 * Les exemplaires sont réservés (wish_notified_at) avant l'envoi : une même copie n'alerte qu'une fois.
 * @param {Profile} me Appelant (celui qui vient d'obtenir les cartes).
 * @param {Bot} bot Réglages du bot.
 * @param {Record<string, unknown>} p Corps de la requête (cards : liste d'UUID).
 * @param {Templates} tpl Modèles personnalisés.
 * @returns {Promise<object>} Nombre de MP envoyés, échoués et ignorés.
 * @throws {HttpError} 400 si la liste est absente ou vide.
 */
async function onCardWish(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!Array.isArray(p.cards)) throw new HttpError(400, 'cards manquant');
  const ids = [...new Set((p.cards as unknown[]).filter(isUuid).map((s) => s.toLowerCase()))].slice(0, WISH_MAX_CARDS);
  if (!ids.length) throw new HttpError(400, 'cards manquant');
  if (bot.notify?.card_wish === false) return { skipped: 'désactivé' };

  // Exemplaires de l'appelant obtenus il y a peu, pas encore signalés (lus en base). Réservés avant l'envoi.
  const { data: fresh, error } = await db.from('hg_card_copies').select('id, card_id, shiny')
    .in('card_id', ids).eq('owner_id', me.id).is('recycled_at', null).is('wish_notified_at', null)
    .gte('obtained_at', new Date(Date.now() - CARD_FRESH_MS).toISOString());
  if (error) throw new Error(error.message);
  if (!fresh?.length) return { skipped: 'aucun exemplaire récent' };
  await takeQuota(me, bot, 'card_wish');
  const { data: claimed, error: e2 } = await db.from('hg_card_copies').update({ wish_notified_at: new Date().toISOString() })
    .in('id', fresh.map((c: { id: number }) => c.id)).is('wish_notified_at', null).select('id, card_id, shiny');
  if (e2) throw new Error(e2.message);
  if (!claimed?.length) return { skipped: 'déjà signalé' };

  // Une alerte par carte distincte (le premier exemplaire réservé donne le nom et la mention « brillante »)
  const byCard = new Map<string, { shiny: boolean }>();
  for (const c of claimed as { id: number; card_id: string; shiny: boolean }[]) {
    if (!byCard.has(c.card_id)) byCard.set(c.card_id, { shiny: c.shiny });
  }
  const { data: cards } = await db.from('hg_cards').select('id, name').in('id', [...byCard.keys()]);
  const names = new Map((cards ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));

  let sent = 0, failed = 0, skipped = 0;
  for (const [cardId, info] of byCard) {
    let cardSent = 0, cardFailed = 0;
    // Membres qui souhaitent cette carte (sauf l'appelant).
    const { data: wishes } = await db.from('hg_card_wishlist').select('user_id').eq('card_id', cardId).neq('user_id', me.id);
    const wishers = (wishes ?? []).map((w: { user_id: string }) => w.user_id);
    if (!wishers.length) continue;
    const { data: profs } = await db.from('hg_profiles').select('id, pseudo, discord_id, bot_optin, notify_card_wish').in('id', wishers);
    for (const prof of (profs ?? []) as { id: string; discord_id: string | null; bot_optin: boolean; notify_card_wish: boolean }[]) {
      // Seuls les membres qui ont activé l'alerte, accepté le bot et lié un Discord reçoivent le MP.
      const reachable = prof.notify_card_wish && prof.bot_optin && /^\d{17,20}$/.test(prof.discord_id ?? '');
      if (!reachable) { skipped++; continue; }
      if (sent + failed >= WISH_MAX_DMS) { skipped++; continue; }
      const carte = `${names.get(cardId) ?? 'Une carte'}${info.shiny ? ' (brillante)' : ''}`;
      const rendered = renderTemplate('card_wish_dm', { carte, lien: link('cartes.html') ?? '' }, tpl);
      const ok = await trySend(() => sendDM(prof.discord_id!, embed({
        ...embedFrom(rendered), url: link('cartes.html'), color: COLOR.card,
      })), `MP souhait ${prof.id}`);
      if (ok) { sent++; cardSent++; } else { failed++; cardFailed++; }
      await new Promise((r) => setTimeout(r, 300)); // reste sous les limites de Discord
    }
    // Échec total pour cette carte (aucun MP parti, au moins un échec) : on libère ses exemplaires réservés,
    // pour qu'un appel ultérieur dans la fenêtre de 10 min puisse réessayer. Un échec partiel reste marqué (pas de MP en double).
    if (cardSent === 0 && cardFailed > 0) {
      const copyIds = (claimed as { id: number; card_id: string }[]).filter((c) => c.card_id === cardId).map((c) => c.id);
      const { error: relErr } = await db.from('hg_card_copies').update({ wish_notified_at: null }).in('id', copyIds);
      if (relErr) console.error('[hg-notify] libération souhaits', relErr);
    }
  }
  return { dms_sent: sent, dms_failed: failed, skipped };
}

/* ---------- Point d'entrée ---------- */

/**
 * Point d'entrée : vérifie l'appelant, lit le type d'événement et appelle le gestionnaire correspondant.
 * Les erreurs HttpError et MediaError sont renvoyées avec leur statut ; toute autre erreur donne un 500 générique.
 * Sans DISCORD_BOT_TOKEN, rien n'est envoyé (sauf admin_dm, qui répond 503 pour que l'admin le sache).
 * @param {Request} req Requête POST avec l'en-tête Authorization et le corps JSON { event, ... }.
 * @returns {Promise<Response>} Résultat JSON de l'événement.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  try {
    // Identification de l'appelant à partir de son jeton de session.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await db.auth.getUser(token);
    if (!auth?.user) throw new HttpError(401, 'Connexion requise');
    const me = await getProfile(auth.user.id);
    if (!me) throw new HttpError(403, 'Réservé aux membres');

    let payload: Record<string, unknown>;
    try { payload = await req.json(); } catch { throw new HttpError(400, 'Requête invalide'); }
    const event = String(payload.event ?? '');

    // Bot non configuré : on répond sans rien envoyer. L'admin voit une erreur pour le test et pour les pièces jointes.
    if (!hasToken()) {
      if (event === 'admin_dm') throw new HttpError(503, 'Le secret DISCORD_BOT_TOKEN n\'est pas configuré dans Supabase.');
      return json({ ok: true, skipped: 'bot non configuré (DISCORD_BOT_TOKEN absent)', ...(event === 'bot_test' ? { error: 'Le secret DISCORD_BOT_TOKEN n\'est pas configuré dans Supabase.' } : {}) });
    }
    // Réglages et modèles chargés en parallèle ; le message manuel n'utilise pas les modèles.
    const [bot, tpl] = await Promise.all([getBot(), event === 'admin_dm' ? Promise.resolve({}) : loadTemplates(db)]);

    // Aiguillage vers le gestionnaire de l'événement.
    let result: Record<string, unknown>;
    switch (event) {
      case 'ss_draw': result = await onDraw(me, bot, payload, tpl); break;
      case 'ss_gift_sent': result = await onGift(me, bot, payload, 'sent', tpl); break;
      case 'ss_gift_received': result = await onGift(me, bot, payload, 'received', tpl); break;
      case 'irl_new': result = await onIrl(me, bot, payload, tpl); break;
      case 'bot_test': result = await onTest(me, bot, payload, tpl); break;
      case 'message_new': result = await onMessage(me, bot, payload, tpl); break;
      case 'admin_dm': result = await onAdminDm(me, bot, payload); break;
      case 'dyn_announce': result = await onDynAnnounce(me, bot, payload, tpl); break;
      case 'card_pull': result = await onCardPull(me, bot, payload, tpl); break;
      case 'card_trade': result = await onCardTrade(me, bot, payload, tpl); break;
      case 'trade_offer': result = await onTradeOffer(me, bot, payload, tpl); break;
      case 'card_wish': result = await onCardWish(me, bot, payload, tpl); break;
      case 'card_gift_admin': result = await onCardGiftAdmin(me, bot, payload, tpl); break;
      case 'card_drop': result = await onCardDrop(me, bot, payload, tpl); break;
      default: throw new HttpError(400, `Événement inconnu : ${event || '(vide)'}`);
    }
    return json({ ok: true, event, ...result });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof MediaError) return json({ error: e.message }, e.status);
    console.error('[hg-notify]', e);
    return json({ error: 'Erreur interne' }, 500);
  }
});
