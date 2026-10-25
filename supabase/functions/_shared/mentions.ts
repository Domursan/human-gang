// ===== Humane Gang — mentions des annonces du bot (partagé par hg-notify, hg-cron, hg-birthdays) =====
// Rôle : décider qui est notifié par une annonce du bot Discord (aucun, un rôle, ou tout le serveur).
// Types : ceux de MENTION_TYPES, dont « cine » (ciné-club, cine-announce.ts ; réglé dans Bot Discord › Mentions).
// Réglages (hg_settings.bot) : mention_role_id (ID du rôle à mentionner) et mentions = { <type>: 'none' | 'role' | 'everyone' }.
//   none      : aucune mention (défaut, comportement d'avant).
//   role      : mention du rôle (<@&ID>) dans le contenu : notifie les membres de ce rôle. Sans ID de rôle : rien.
//   everyone  : @everyone : notifie TOUT le serveur.
// La mention va dans le contenu du message, jamais dans un embed (une mention dans un embed ne notifie personne).
// allowed_mentions autorise explicitement ce qui doit notifier ; le reste reste muet.
// Dépendances : ./discord.ts (isSnowflake).
// Exporte : MENTION_TYPES, MentionType, MentionMode, MentionBot, AllowedMentions, MentionPart,
//   mentionMode, mentionWith, mentionFor.
import { isSnowflake } from './discord.ts';

/** Types d'annonce qui ont leur propre réglage de mention. */
export const MENTION_TYPES = ['draw', 'irl', 'birthday', 'dyn', 'card_pull', 'card_trade', 'card_drop', 'quiz', 'cine', 'loup_garou', 'uno'] as const;
export type MentionType = typeof MENTION_TYPES[number];
/** Mode de mention possible pour un type d'annonce. */
export type MentionMode = 'none' | 'role' | 'everyone';
/** Partie « bot » des réglages utile ici : rôle à mentionner et mode par type. */
export type MentionBot = { mention_role_id?: string | null; mentions?: Record<string, string | undefined> | null };
/** Format de allowed_mentions attendu par Discord. */
export type AllowedMentions = { parse: string[]; roles?: string[]; users?: string[] };
/** Morceau de message à fusionner dans le corps envoyé à Discord (contenu éventuel + allowed_mentions). */
export type MentionPart = { content?: string; allowed_mentions: AllowedMentions };

/**
 * Valeur sûre d'un mode (toute autre valeur devient « none »).
 * @param {unknown} v Valeur lue dans les réglages.
 * @returns {MentionMode} Mode valide.
 */
export const mentionMode = (v: unknown): MentionMode => (v === 'role' || v === 'everyone' ? v : 'none');

/**
 * Mention pour un mode donné. `users` : membres à notifier explicitement (anniversaires).
 * Un mode « role » sans identifiant de rôle valide ne mentionne personne.
 * @param {MentionBot} bot Réglages du bot (rôle à mentionner).
 * @param {MentionMode} mode Mode choisi.
 * @param {string[]} [users] Identifiants de membres à notifier.
 * @returns {MentionPart} Contenu et allowed_mentions correspondants.
 */
export function mentionWith(bot: MentionBot, mode: MentionMode, users: string[] = []): MentionPart {
  const who = users.length ? { users } : {};
  const roleId = bot.mention_role_id;
  if (mode === 'everyone') return { content: '@everyone', allowed_mentions: { parse: ['everyone'], ...who } };
  if (mode === 'role' && isSnowflake(roleId)) {
    return { content: `<@&${roleId}>`, allowed_mentions: { parse: [], roles: [roleId], ...who } };
  }
  return { allowed_mentions: { parse: [], ...who } };
}

/**
 * Mention configurée pour un type d'annonce (bot.mentions[type]). Défaut : aucune.
 * @param {MentionBot} bot Réglages du bot.
 * @param {MentionType} type Type d'annonce.
 * @returns {MentionPart} Mention à utiliser pour ce type.
 */
export function mentionFor(bot: MentionBot, type: MentionType): MentionPart {
  return mentionWith(bot, mentionMode(bot.mentions?.[type]));
}
