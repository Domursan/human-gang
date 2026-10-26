// ===== Humane Gang — présence et notifications du site (migration 153) =====
// Rôle : avant chaque MP du bot à un membre, écrire la notification sur le site (cloche de l'en-tête) et n'envoyer
// le MP Discord que si le membre est HORS LIGNE (aucune page du site ouverte et visible depuis 2 minutes).
// Une erreur de la base (table absente, réseau) ne bloque jamais le MP : on retombe sur l'envoi Discord habituel.
// Dépendances : ./discord.ts (sendDM) ; RPC hg_en_ligne_interne, hg_site_notif (clé service).
// Exporte : dmOuSite, enLigne, notifDepuisMessage.
import { sendDM, type UploadFile } from './discord.ts';

/** Client minimal attendu (supabase-js avec la clé service). */
// deno-lint-ignore no-explicit-any
type Db = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }> };

/**
 * Vrai si le membre est en ligne sur le site (signal de vie de moins de 2 minutes). En cas d'erreur : faux.
 * @param {Db} db client avec la clé service
 * @param {string} userId identifiant du membre (hg_profiles.id)
 * @returns {Promise<boolean>}
 */
export async function enLigne(db: Db, userId: string): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('hg_en_ligne_interne', { p_user: userId });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Texte brut d'un Markdown Discord simple (gras, italique, liens, mentions). */
const brut = (s: unknown) => String(s ?? '')
  .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
  .replace(/[*_~`>|]/g, '')
  .replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>/g, '')
  .replace(/​/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/**
 * Titre, texte et lien d'une notification du site à partir d'un message Discord (premier embed, sinon contenu).
 * @param {Record<string, unknown>} message message Discord (content, embeds)
 * @returns {{ titre: string, texte: string, lien: string | null }}
 */
export function notifDepuisMessage(message: Record<string, unknown>): { titre: string; texte: string; lien: string | null } {
  // deno-lint-ignore no-explicit-any
  const e: any = Array.isArray(message.embeds) ? message.embeds[0] : null;
  const contenu = brut(message.content);
  const titre = brut(e?.title) || contenu.split('\n')[0] || 'Nouvelle notification';
  const texte = brut(e?.description) || (e?.title ? contenu : contenu.split('\n').slice(1).join('\n'));
  const lien = typeof e?.url === 'string' && /^https?:\/\//.test(e.url) ? e.url : null;
  return { titre: titre.slice(0, 200), texte: texte.slice(0, 1000), lien };
}

/**
 * Notifie un membre : notification sur le site toujours, MP Discord seulement s'il est hors ligne.
 * Remplace sendDM pour les messages destinés à un membre précis. Lève l'erreur de Discord comme sendDM.
 * @param {Db} db client avec la clé service
 * @param {string} userId membre (hg_profiles.id)
 * @param {string} discordId identifiant Discord du membre
 * @param {Record<string, unknown>} message message Discord
 * @param {string} cat catégorie (messages, sorties, echanges, souhaits, santa, anniversaires, jeux, annonces…)
 * @param {UploadFile[]} [files] pièces jointes du MP
 * @returns {Promise<'site' | 'discord'>} canal utilisé
 */
export async function dmOuSite(db: Db, userId: string, discordId: string, message: Record<string, unknown>, cat: string,
  files: UploadFile[] = []): Promise<'site' | 'discord'> {
  const enLigneMaintenant = await enLigne(db, userId);
  const n = notifDepuisMessage(message);
  let ecrite = false;
  try {
    const { error } = await db.rpc('hg_site_notif', { p_user: userId, p_cat: cat, p_titre: n.titre, p_texte: n.texte || null,
      p_lien: n.lien, p_par_discord: !enLigneMaintenant });
    ecrite = !error;
    if (error) console.warn('[presence] notification du site non écrite', error.message);
  } catch (e) {
    console.warn('[presence] notification du site non écrite', e);
  }
  // En ligne ET notification bien écrite : pas de MP. Sinon (hors ligne, ou écriture ratée) : MP comme avant.
  if (enLigneMaintenant && ecrite) return 'site';
  await sendDM(discordId, message, files);
  return 'discord';
}
