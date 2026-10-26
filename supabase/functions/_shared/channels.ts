// ===== Humane Gang — salons des annonces du bot (partagé par hg-notify, hg-cron, hg-birthdays) =====
// Rôle : choisir les salons Discord où part une annonce, selon son type (draw, irl, birthday, dyn, card_pull, card_trade, card_drop, quiz),
// et publier un même message dans chacun d'eux (un salon en échec n'empêche pas les autres).
// Réglages (hg_settings.bot) :
//   salons   = [{ id, nom }]                  liste des salons connus du bot (25 au plus) ; sert aussi à valider l'envoi manuel.
//   channels = { <type>: ['<ID>', ...] }      0 à 5 salons par type. L'ancienne forme '<ID>' (chaîne seule) reste lue comme ['<ID>'].
//   birthday_channel_id                       ancien réglage des anniversaires, lu seulement en repli de channels.birthday.
//   announce_channel_id                       salon d'annonces : repli de tous les types.
// Ordre de repli (liste vide ou absente) : channels[type] → (anniversaires seulement) birthday_channel_id → announce_channel_id → aucun.
// Un identifiant invalide (pas un identifiant Discord de 17 à 20 chiffres) est ignoré. Les doublons sont retirés, l'ordre est gardé.
// Les messages privés (MP) ne passent pas par ce module.
// Dépendances : ./discord.ts (isSnowflake), ./mentions.ts (MentionType).
// Exporte : ChannelBot, CHANNEL_LABEL, MAX_CHANNELS, ChannelResult, channelsFor, channelFor (premier salon de channelsFor),
//   isKnownChannel (salon connu : dans salons ou salon d'annonces), sendToChannels (envoi dans chaque salon, sans arrêt sur erreur),
//   ChannelLogEntry, channelLog (détail par salon pour le journal), isMissingChannelsColumn, insertWithChannels (insertion
//   hg_bot_log avec la colonne channels, nouvel essai sans elle seulement si elle manque).
import { isSnowflake } from './discord.ts';
import type { MentionType } from './mentions.ts';

/** Nombre maximal de salons pour un même type d'annonce. */
export const MAX_CHANNELS = 5;

/** Partie « salons » des réglages du bot. Toutes les clés sont facultatives. */
export type ChannelBot = {
  announce_channel_id?: string | null;
  birthday_channel_id?: string | null;
  channels?: Partial<Record<MentionType, string | string[] | null>> | null;
  salons?: { id: string; nom: string }[] | null;
};

/** Résultat d'un envoi dans un salon : identifiant, succès, et message d'erreur court en cas d'échec. */
export type ChannelResult = { id: string; ok: boolean; error?: string };

/** Libellés français des types d'annonce (utilisés dans le message de test). */
export const CHANNEL_LABEL: Record<MentionType, string> = {
  draw: 'Tirage du Secret Santa',
  irl: 'Sorties IRL',
  birthday: 'Anniversaires',
  dyn: 'Événements',
  card_pull: 'Belles cartes',
  card_trade: 'Échanges',
  card_drop: 'Drops de cartes',
  quiz: 'Question du jour',
  cine: 'Ciné-club',
  loup_garou: 'Loup-Garou',
  uno: 'Uno',
  nom_de_code: 'Nom de code',
  plateaux: 'Jeux de plateau',
};

/**
 * Salons d'une annonce selon son type : identifiants valides, sans doublon, dans l'ordre, 5 au plus.
 * Si la liste est vide (ou ne contient que des identifiants invalides), repli comme channelFor.
 * @param {ChannelBot} bot Réglages du bot (hg_settings.bot).
 * @param {MentionType} type Type d'annonce.
 * @returns {string[]} Identifiants de salons ; tableau vide si aucun salon n'est configuré.
 */
export function channelsFor(bot: ChannelBot, type: MentionType): string[] {
  const own = bot.channels?.[type];
  const raw: unknown[] = Array.isArray(own) ? own : [own];
  const ids = [...new Set(raw.filter(isSnowflake))].slice(0, MAX_CHANNELS);
  if (ids.length) return ids;
  if (type === 'birthday' && isSnowflake(bot.birthday_channel_id)) return [bot.birthday_channel_id];
  return isSnowflake(bot.announce_channel_id) ? [bot.announce_channel_id] : [];
}

/**
 * Premier salon d'une annonce selon son type (compatibilité : équivaut à channelsFor(...)[0]).
 * @param {ChannelBot} bot Réglages du bot.
 * @param {MentionType} type Type d'annonce.
 * @returns {string | null} Identifiant du salon, ou null si aucun salon n'est configuré.
 */
export function channelFor(bot: ChannelBot, type: MentionType): string | null {
  return channelsFor(bot, type)[0] ?? null;
}

/**
 * Vrai si le salon est connu du bot : listé dans salons, ou salon d'annonces. Sert à valider un envoi manuel.
 * @param {ChannelBot} bot Réglages du bot.
 * @param {string} id Identifiant de salon demandé.
 * @returns {boolean}
 */
export function isKnownChannel(bot: ChannelBot, id: string): boolean {
  if (!isSnowflake(id)) return false;
  return (bot.salons ?? []).some((s) => s?.id === id) || id === bot.announce_channel_id;
}

/**
 * Envoie un message dans chaque salon, en parallèle. Un échec sur un salon est journalisé avec son identifiant
 * et n'empêche pas les autres. Ne lève jamais d'erreur.
 * @param {string[]} ids Salons à atteindre.
 * @param {(id: string) => Promise<unknown>} send Envoi pour un salon (par exemple sendChannel(id, message)).
 * @param {string} label Nom de l'envoi, pour le journal.
 * @param {(e: unknown) => string} [fmtError] Mise en forme de l'erreur (défaut : message tronqué à 160 caractères).
 * @returns {Promise<ChannelResult[]>} Un résultat par salon, dans l'ordre de ids.
 */
export function sendToChannels(
  ids: string[],
  send: (id: string) => Promise<unknown>,
  label: string,
  fmtError: (e: unknown) => string = (e) => String((e as Error)?.message ?? e).slice(0, 160),
): Promise<ChannelResult[]> {
  return Promise.all(ids.map(async (id): Promise<ChannelResult> => {
    try {
      await send(id);
      return { id, ok: true };
    } catch (e) {
      console.error(`[channels] ${label} (salon ${id})`, e);
      return { id, ok: false, error: fmtError(e) };
    }
  }));
}

/* ---------- Journal (hg_bot_log.channels, migration 070) ---------- */

/** Ligne du détail par salon écrite dans hg_bot_log.channels. ref (facultatif) dit à quelle annonce elle se rapporte. */
export type ChannelLogEntry = { id: string; ok: boolean; error?: string; ref?: string };

/**
 * Détail par salon prêt pour le journal : { id, ok } si réussi, { id, ok, error } sinon, avec ref si donné.
 * @param {ChannelResult[]} results Résultats de sendToChannels.
 * @param {string} [ref] Annonce concernée (ex. « anniversaire de Léa »), répétée sur chaque ligne.
 * @returns {ChannelLogEntry[]}
 */
export function channelLog(results: ChannelResult[], ref?: string): ChannelLogEntry[] {
  return results.map(({ id, ok, error }) => ({ id, ok, ...(ok ? {} : { error: error ?? 'échec' }), ...(ref ? { ref } : {}) }));
}

/** Erreur renvoyée par supabase-js (PostgREST ou Postgres). */
type DbError = { code?: string | null; message?: string | null } | null | undefined;

/**
 * Vrai si l'erreur dit que la colonne « channels » manque (migration 070 non passée) :
 * code Postgres 42703 (colonne inconnue), code PostgREST PGRST204 (colonne absente du cache), ou message citant « channels ».
 * @param {DbError} err Erreur de l'insertion.
 * @returns {boolean}
 */
export function isMissingChannelsColumn(err: DbError): boolean {
  if (!err) return false;
  return err.code === '42703' || err.code === 'PGRST204' || /channels/i.test(String(err.message ?? ''));
}

/**
 * Insère une ligne de journal avec le détail par salon (colonne hg_bot_log.channels). Si la colonne manque
 * (voir isMissingChannelsColumn), réessaie une fois sans elle : l'entrée du journal n'est pas perdue.
 * Toute autre erreur est renvoyée telle quelle, sans nouvel essai. Sans détail (liste vide ou null), la colonne n'est pas écrite.
 * @param {(row: Record<string, unknown>) => PromiseLike<T>} insert Insertion (ex. (row) => db.from('hg_bot_log').insert(row)).
 * @param {Record<string, unknown>} base Colonnes communes de la ligne.
 * @param {ChannelLogEntry[] | null} channels Détail par salon.
 * @returns {Promise<T>} Résultat de la dernière insertion tentée (son champ error est null si elle a réussi).
 */
export async function insertWithChannels<T extends { error: DbError }>(
  insert: (row: Record<string, unknown>) => PromiseLike<T>,
  base: Record<string, unknown>,
  channels: ChannelLogEntry[] | null,
): Promise<T> {
  if (!channels?.length) return await insert(base);
  const first = await insert({ ...base, channels });
  if (!first.error || !isMissingChannelsColumn(first.error)) return first;
  console.error('[channels] colonne hg_bot_log.channels absente (migration 070) : journal écrit sans les salons', first.error);
  return await insert(base);
}
