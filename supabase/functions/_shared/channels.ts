// ===== Humane Gang — salons des annonces du bot (partagé par hg-notify, hg-cron, hg-birthdays) =====
// Rôle : choisir le salon Discord où part une annonce, selon son type (draw, irl, birthday, dyn, card_pull, card_trade).
// Réglages (hg_settings.bot) :
//   channels = { <type>: '<ID de salon>' }   vide ou absent = repli (voir channelFor).
//   birthday_channel_id                       ancien réglage des anniversaires, lu seulement en repli de channels.birthday.
//   announce_channel_id                       salon d'annonces : repli de tous les types.
// Ordre de repli : channels[type] → (anniversaires seulement) birthday_channel_id → announce_channel_id → aucun (null).
// Les messages privés (MP) ne passent pas par ce module.
// Dépendances : ./discord.ts (isSnowflake), ./mentions.ts (MentionType).
// Exporte : ChannelBot, CHANNEL_LABEL, channelFor.
import { isSnowflake } from './discord.ts';
import type { MentionType } from './mentions.ts';

/** Partie « salons » des réglages du bot. Toutes les clés sont facultatives. */
export type ChannelBot = {
  announce_channel_id?: string | null;
  birthday_channel_id?: string | null;
  channels?: Partial<Record<MentionType, string | null>> | null;
};

/** Libellés français des types d'annonce (utilisés dans le message de test). */
export const CHANNEL_LABEL: Record<MentionType, string> = {
  draw: 'Tirage du Secret Santa',
  irl: 'Sorties IRL',
  birthday: 'Anniversaires',
  dyn: 'Événements',
  card_pull: 'Belles cartes',
  card_trade: 'Échanges',
};

/**
 * Salon d'une annonce selon son type. Un identifiant invalide est traité comme absent.
 * @param {ChannelBot} bot Réglages du bot (hg_settings.bot).
 * @param {MentionType} type Type d'annonce.
 * @returns {string | null} Identifiant du salon, ou null si aucun salon n'est configuré.
 */
export function channelFor(bot: ChannelBot, type: MentionType): string | null {
  const own = bot.channels?.[type];
  if (isSnowflake(own)) return own;
  if (type === 'birthday' && isSnowflake(bot.birthday_channel_id)) return bot.birthday_channel_id;
  return isSnowflake(bot.announce_channel_id) ? bot.announce_channel_id : null;
}
