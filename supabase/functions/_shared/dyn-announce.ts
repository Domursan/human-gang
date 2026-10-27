// ===== Humane Gang — annonces Discord des événements dynamiques (partagé par hg-notify et hg-cron) =====
// Rôle : construire le message (embed) annonçant le lancement ou la fin d'un événement dynamique (table hg_dyn_events),
// à partir des modèles « dyn_start » / « dyn_end » (hg_settings.bot_templates, défauts dans ./bot-templates.json).
// À la fin, l'annonce contient le classement des chasseurs d'images (hg_dyn_captures).
// Dépendances : ./templates.ts (rendu des modèles, embed), ./mentions.ts (type de mention).
// Exporte : DynEvent, DynPhase, DYN_COLOR, fmtZurich, dynTop, classementText, buildDynAnnounce.
import { renderTemplate, embedFrom, type Templates } from './templates.ts';
import type { MentionPart } from './mentions.ts';

/** Ligne de la table hg_dyn_events, telle que lue par les fonctions (seuls les champs utiles). */
export type DynEvent = {
  id: string; name: string; description: string | null; image_url: string | null; emoji: string | null;
  starts_at: string; ends_at: string; announce: boolean; active: boolean;
  announced_start_at: string | null; announced_end_at: string | null;
};
/** Moment de l'annonce : 'start' (lancement) ou 'end' (fin, avec classement). */
export type DynPhase = 'start' | 'end';
/** Couleur de l'embed (doré, comme le reste du site). */
export const DYN_COLOR = 0xe2c77e;

/**
 * Date formatée en français pour Zurich (la fête est à l'heure suisse), ex. « lundi 3 mars, 14:00 ».
 * @param {string | null | undefined} d Date ISO, ou null.
 * @returns {string} Date formatée, ou '' si la date est absente.
 */
export const fmtZurich = (d: string | null | undefined) => d
  ? new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(d))
  : '';

/**
 * Top n des chasseurs d'un événement (service role). En cas d'égalité : le premier à avoir atteint son score.
 * On compte les captures par membre, puis on trie par nombre décroissant et par date de la dernière capture.
 * @param {any} db Client Supabase (clé service role).
 * @param {string} eventId Identifiant de l'événement.
 * @param {number} [n] Nombre de places à renvoyer (3 par défaut).
 * @returns {Promise<{pseudo: string, captures: number}[]>} Le classement, du premier au dernier.
 * @throws {Error} Si la lecture des captures échoue.
 */
// deno-lint-ignore no-explicit-any
export async function dynTop(db: any, eventId: string, n = 3): Promise<{ pseudo: string; captures: number }[]> {
  const { data, error } = await db.from('hg_dyn_captures').select('user_id, captured_at').eq('event_id', eventId).order('captured_at', { ascending: true });
  if (error) throw new Error(error.message);
  // Pour chaque membre : nombre de captures et horodatage de la dernière (sert au départage).
  const by = new Map<string, { n: number; last: number }>();
  for (const c of (data ?? []) as { user_id: string; captured_at: string }[]) {
    const cur = by.get(c.user_id) ?? { n: 0, last: 0 };
    by.set(c.user_id, { n: cur.n + 1, last: new Date(c.captured_at).getTime() });
  }
  const top = [...by.entries()].sort((a, b) => b[1].n - a[1].n || a[1].last - b[1].last).slice(0, n);
  if (!top.length) return [];
  // Une seconde requête récupère les pseudos ; un membre supprimé apparaît comme « Ancien membre ».
  const { data: profs } = await db.from('hg_profiles').select('id, pseudo').in('id', top.map(([id]) => id));
  const names = new Map(((profs ?? []) as { id: string; pseudo: string }[]).map((p) => [p.id, p.pseudo]));
  return top.map(([id, v]) => ({ pseudo: names.get(id) ?? 'Ancien membre', captures: v.n }));
}

/**
 * Texte du classement : une ligne par place, avec médailles pour les trois premières (1., 2., 3.).
 * @param {{pseudo: string, captures: number}[]} rows Classement renvoyé par dynTop.
 * @returns {string} Texte prêt à insérer dans le modèle.
 */
export function classementText(rows: { pseudo: string; captures: number }[]) {
  if (!rows.length) return 'Personne n\'a attrapé d\'image cette fois-ci.';
  const medal = ['1.', '2.', '3.'];
  return rows.map((r, i) => `${medal[i] ?? `${i + 1}.`} ${r.pseudo} : ${r.captures} image${r.captures > 1 ? 's' : ''}`).join('\n');
}

/**
 * Message Discord (corps de POST /channels/:id/messages) pour l'annonce d'un événement.
 * `mention` : réglage bot.mentions.dyn (aucune mention par défaut). Le classement n'est calculé qu'en fin d'événement.
 * @param {any} db Client Supabase (clé service role).
 * @param {DynEvent} ev L'événement annoncé.
 * @param {DynPhase} phase 'start' pour le lancement, 'end' pour la fin.
 * @param {Templates} tpl Modèles personnalisés (hg_settings.bot_templates).
 * @param {string} site Adresse du site, sans « / » final ; vide pour ne pas mettre de lien.
 * @param {MentionPart} [mention] Mention à ajouter au message.
 * @param {number} [topN] Taille du classement de fin.
 * @returns {Promise<object>} Corps du message : contenu de mention et un embed.
 */
// deno-lint-ignore no-explicit-any
export async function buildDynAnnounce(db: any, ev: DynEvent, phase: DynPhase, tpl: Templates, site: string,
  mention: MentionPart = { allowed_mentions: { parse: [] } }, topN = 3) {
  const lien = site ? `${site}/pages/irl/evenements.html` : '';
  const vars: Record<string, string> = {
    nom: ev.name, description: ev.description ?? '', fin: fmtZurich(ev.ends_at), lien,
  };
  if (phase === 'end') vars.classement = classementText(await dynTop(db, ev.id, topN));
  const r = renderTemplate(phase === 'start' ? 'dyn_start' : 'dyn_end', vars, tpl);
  // Sans image, l'emoji de l'événement est placé devant le titre (limité à 256 caractères, limite Discord).
  const title = !ev.image_url && ev.emoji && r.title ? `${ev.emoji} ${r.title}`.slice(0, 256) : r.title;
  // Seules les images en https sont acceptées ; Discord refuse les autres schémas.
  const img = ev.image_url && /^https:\/\//.test(ev.image_url) ? ev.image_url : null;
  return {
    ...mention,
    embeds: [{
      ...embedFrom({ title, description: r.description }),
      color: DYN_COLOR,
      ...(lien ? { url: lien } : {}),
      // Au lancement l'image est grande (image) ; à la fin on la met en vignette (thumbnail).
      ...(img ? (phase === 'start' ? { image: { url: img } } : { thumbnail: { url: img } }) : {}),
      footer: { text: 'Humane Gang · événements' },
      timestamp: new Date().toISOString(),
    }],
  };
}
