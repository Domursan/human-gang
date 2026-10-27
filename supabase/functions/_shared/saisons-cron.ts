// ===== Humane Gang — annonces saisonnières du bot (migration 096), appelées par hg-cron =====
// Rôle : envoyer dans les salons Discord les messages saisonniers que la base juge dus (RPC hg_saisons_bot_due, clé
// service) : case du jour du calendrier de l'Avent (8 h), bonus collectif débloqué, soirée déballage (tout le monde a
// reçu, rappel 1 h avant, tour de passage si bot.notify.unwrap = true), anniversaire du gang (9 h).
// Idempotence : la base réserve chaque message (hg_bot_runs ou colonne de marquage) AVANT de le renvoyer ; si aucun salon
// ne l'a reçu, la réservation est libérée (hg_saisons_bot_release) et le prochain passage réessaie.
// Salons et mentions : type « dyn » (Avent), « draw » (Secret Santa), « birthday » (anniversaire), comme les autres annonces.
// N'est appelé que si le bot a un jeton : sans bot, rien n'est réservé.
// Dépendances : ./discord.ts, ./channels.ts, ./mentions.ts.
// Exporte : seasonAnnouncements(db, bot, site) → { sent, errors, log }.
import { sendChannel } from './discord.ts';
import { channelLog, channelsFor, sendToChannels, type ChannelBot, type ChannelLogEntry } from './channels.ts';
import { mentionFor, type MentionBot, type MentionType } from './mentions.ts';

/** Message dû, tel que renvoyé par hg_saisons_bot_due. */
type Due = { task: string; period: string; type: MentionType; title: string; body: string; page: string };
/** Couleurs des embeds par type. */
const COLOR: Record<string, number> = { dyn: 0xb70127, draw: 0xe0909a, birthday: 0xe2c77e };

/**
 * Envoie les annonces saisonnières dues.
 * @param {any} db Client supabase-js (clé service).
 * @param {ChannelBot & MentionBot} bot Réglages du bot.
 * @param {string} site Adresse du site sans « / » final (peut être vide).
 * @returns {Promise<{sent: number, errors: number, log: ChannelLogEntry[]}>}
 */
export async function seasonAnnouncements(db: any, bot: ChannelBot & MentionBot, site: string) {
  const out = { sent: 0, errors: 0, log: [] as ChannelLogEntry[] };
  const { data, error } = await db.rpc('hg_saisons_bot_due');
  if (error) throw new Error(error.message);
  for (const d of (Array.isArray(data) ? data : []) as Due[]) {
    const channels = channelsFor(bot, d.type);
    const release = async () => {
      const { error: e } = await db.rpc('hg_saisons_bot_release', { p_task: d.task, p_period: d.period });
      if (e) console.error('[saisons] libération', d.task, d.period, e);
    };
    if (!channels.length) { await release(); continue; } // aucun salon : on réessaiera quand il sera configuré
    // d.page : chemin absolu du site (« /pages/compte/accueil.html#avent ») ou relatif (« pages/… ») selon la base
    const url = site ? `${site}${String(d.page).startsWith('/') ? '' : '/'}${d.page}` : undefined;
    const message = {
      ...mentionFor(bot, d.type),
      embeds: [{ title: d.title, description: d.body, url, color: COLOR[d.type] ?? 0xe2c77e, footer: { text: 'Humane Gang' }, timestamp: new Date().toISOString() }],
    };
    const results = await sendToChannels(channels, (id) => sendChannel(id, message), `saison ${d.task}`);
    out.log.push(...channelLog(results, `${d.task} : ${d.title}`.slice(0, 120)));
    if (results.some((r) => r.ok)) out.sent++;
    else { out.errors++; await release(); }
  }
  return out;
}
