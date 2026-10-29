// ===== Humane Gang — présence et notifications du site (migration 153) =====
// Rôle : avant chaque MP du bot à un membre, écrire la notification sur le site (cloche de l'en-tête) et n'envoyer
// le MP Discord que si le membre est HORS LIGNE (aucune page du site ouverte et visible depuis 2 minutes).
// Une erreur de la base (table absente, réseau) ne bloque jamais le MP : on retombe sur l'envoi Discord habituel.
// Copie aux admins (demande d'Ethan, 29.10.2026) : chaque message du bot destiné à un membre est aussi envoyé en MP
// aux comptes admin (hg_profiles.is_admin avec un identifiant Discord), avec en tête le destinataire et le canal
// utilisé (MP Discord ou notification du site). Réglage : hg_settings « bot » › copie_admins (true par défaut).
// Une copie ratée ne bloque jamais l'envoi au membre.
// Dépendances : ./discord.ts (sendDM, isSnowflake) ; RPC hg_en_ligne_interne, hg_site_notif ; tables hg_profiles,
//   hg_settings (clé service).
// Secret Santa (demande d'Ethan, 29.10.2026) : dmToujours envoie le MP Discord dans tous les cas (en ligne ou non), en plus
//   de la notification du site, sans tenir compte des préférences du membre.
// Exporte : dmOuSite, dmToujours, enLigne, notifDepuisMessage, copierAuxAdmins.
import { isSnowflake, sendDM, type UploadFile } from './discord.ts';

/** Client minimal attendu (supabase-js avec la clé service). */
// deno-lint-ignore no-explicit-any
type Db = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>; from?: (t: string) => any };

/** Admins qui reçoivent la copie (identifiants Discord), relus au plus toutes les 60 s. */
let cacheAdmins: { at: number; ids: string[] } | null = null;
async function adminsCopie(db: Db): Promise<string[]> {
  if (cacheAdmins && Date.now() - cacheAdmins.at < 60_000) return cacheAdmins.ids;
  let ids: string[] = [];
  try {
    if (!db.from) return [];
    const { data: reglage } = await db.from('hg_settings').select('value').eq('key', 'bot').maybeSingle();
    if (reglage?.value?.copie_admins !== false) {
      const { data } = await db.from('hg_profiles').select('discord_id').eq('is_admin', true).not('discord_id', 'is', null);
      ids = [...new Set(((data ?? []) as { discord_id: string }[]).map((r) => r.discord_id).filter(isSnowflake))];
    }
  } catch (e) {
    console.warn('[presence] admins de la copie introuvables', e);
  }
  cacheAdmins = { at: Date.now(), ids };
  return ids;
}

/**
 * Envoie aux admins une copie d'un message du bot destiné à un membre. Jamais d'erreur levée.
 * @param {Db} db client avec la clé service
 * @param {string} userId destinataire (hg_profiles.id)
 * @param {string} discordId identifiant Discord du destinataire (pas de copie à soi-même)
 * @param {Record<string, unknown>} message message Discord d'origine
 * @param {'site' | 'discord'} canal canal utilisé pour le membre
 * @param {string} cat catégorie de la notification
 * @param {UploadFile[]} [files] pièces jointes d'origine
 */
export async function copierAuxAdmins(db: Db, userId: string, discordId: string, message: Record<string, unknown>,
  canal: 'site' | 'discord', cat: string, files: UploadFile[] = []): Promise<void> {
  const admins = (await adminsCopie(db)).filter((id) => id !== discordId);
  if (!admins.length) return;
  let pseudo = 'un membre';
  try {
    const { data } = await db.from!('hg_profiles').select('pseudo').eq('id', userId).maybeSingle();
    if (data?.pseudo) pseudo = String(data.pseudo).replace(/[*_~`|>]/g, '');
  } catch { /* pseudo facultatif */ }
  const via = canal === 'site' ? 'remis en notification sur le site (membre en ligne)' : 'envoyé en MP Discord';
  const tete = `📋 **Copie** · message du bot pour **${pseudo}** (${cat}) · ${via}`;
  const contenu = typeof message.content === 'string' && message.content ? `${tete}\n\n${message.content}` : tete;
  const copie = { ...message, content: contenu.slice(0, 2000), allowed_mentions: { parse: [] } };
  for (const id of admins) {
    try { await sendDM(id, copie, files); } catch (e) { console.warn('[presence] copie admin non envoyée', e); }
  }
}

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
  if (enLigneMaintenant && ecrite) {
    await copierAuxAdmins(db, userId, discordId, message, 'site', cat, files);
    return 'site';
  }
  await sendDM(discordId, message, files);
  await copierAuxAdmins(db, userId, discordId, message, 'discord', cat, files);
  return 'discord';
}

/**
 * Notifie un membre sur le site ET par MP Discord, même s'il est en ligne (Secret Santa : pas de choix possible).
 * Lève l'erreur de Discord comme sendDM. La copie aux admins suit.
 * @param {Db} db client avec la clé service
 * @param {string} userId membre (hg_profiles.id)
 * @param {string} discordId identifiant Discord du membre
 * @param {Record<string, unknown>} message message Discord
 * @param {string} cat catégorie de la notification du site
 * @returns {Promise<'discord'>}
 */
export async function dmToujours(db: Db, userId: string, discordId: string, message: Record<string, unknown>, cat: string): Promise<'discord'> {
  const n = notifDepuisMessage(message);
  try {
    const { error } = await db.rpc('hg_site_notif', { p_user: userId, p_cat: cat, p_titre: n.titre, p_texte: n.texte || null,
      p_lien: n.lien, p_par_discord: true });
    if (error) console.warn('[presence] notification du site non écrite', error.message);
  } catch (e) {
    console.warn('[presence] notification du site non écrite', e);
  }
  await sendDM(discordId, message);
  await copierAuxAdmins(db, userId, discordId, message, 'discord', cat);
  return 'discord';
}
