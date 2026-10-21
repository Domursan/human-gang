// ===== Humane Gang — mentions des annonces du bot (partagé par hg-notify, hg-cron, hg-birthdays) =====
// Réglages (hg_settings.bot) : mention_role_id (ID du rôle à mentionner) et mentions = { <type>: 'none' | 'role' | 'everyone' }.
//   none      : aucune mention (défaut, comportement d'avant).
//   role      : mention du rôle (<@&ID>) dans le contenu : notifie les membres de ce rôle. Sans ID de rôle : rien.
//   everyone  : @everyone : notifie TOUT le serveur.
// La mention va dans le contenu du message, jamais dans un embed (une mention dans un embed ne notifie personne).
// allowed_mentions autorise explicitement ce qui doit notifier ; le reste reste muet.
import { isSnowflake } from './discord.ts';

export const MENTION_TYPES = ['draw', 'irl', 'birthday', 'dyn', 'card_pull', 'card_trade'] as const;
export type MentionType = typeof MENTION_TYPES[number];
export type MentionMode = 'none' | 'role' | 'everyone';
export type MentionBot = { mention_role_id?: string | null; mentions?: Record<string, string | undefined> | null };
export type AllowedMentions = { parse: string[]; roles?: string[]; users?: string[] };
export type MentionPart = { content?: string; allowed_mentions: AllowedMentions };

/** Valeur sûre d'un mode (toute autre valeur devient « none »). */
export const mentionMode = (v: unknown): MentionMode => (v === 'role' || v === 'everyone' ? v : 'none');

/** Mention pour un mode donné. `users` : membres à notifier explicitement (anniversaires). */
export function mentionWith(bot: MentionBot, mode: MentionMode, users: string[] = []): MentionPart {
  const who = users.length ? { users } : {};
  const roleId = bot.mention_role_id;
  if (mode === 'everyone') return { content: '@everyone', allowed_mentions: { parse: ['everyone'], ...who } };
  if (mode === 'role' && isSnowflake(roleId)) {
    return { content: `<@&${roleId}>`, allowed_mentions: { parse: [], roles: [roleId], ...who } };
  }
  return { allowed_mentions: { parse: [], ...who } };
}

/** Mention configurée pour un type d'annonce (bot.mentions[type]). Défaut : aucune. */
export function mentionFor(bot: MentionBot, type: MentionType): MentionPart {
  return mentionWith(bot, mentionMode(bot.mentions?.[type]));
}
