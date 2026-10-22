// ===== Humane Gang — pièces jointes des messages manuels du bot (partagé par hg-notify) =====
// Rôle : l'admin envoie parfois un message manuel au Discord avec des fichiers (image, vidéo, audio, PDF).
//   Les fichiers sont téléversés par l'admin dans le bucket privé « hg-bot-media » (migration 037) sous
//   « manuel/<AAAA-MM-JJ>/<uuid>-<nom> ». La fonction les lit avec la clé de service et les renvoie à Discord.
// Sécurité : le client ne fournit que des chemins, jamais de contenu ni d'URL. Un chemin hors de manuel/ est refusé.
// Dépendances : ./discord.ts (limites et nettoyage des noms de fichiers) ; le bucket Supabase hg-bot-media.
// Exporte : BOT_MEDIA_BUCKET, BOT_MEDIA_TYPES, MediaError, validAttachmentPaths, loadAttachments.
import { MAX_ATTACH_BYTES, MAX_ATTACH_FILES, safeFileName, type UploadFile } from './discord.ts';

/** Nom du bucket privé qui contient les fichiers téléversés par l'admin. */
export const BOT_MEDIA_BUCKET = 'hg-bot-media';
/** Types acceptés (identiques à la liste blanche du bucket). */
export const BOT_MEDIA_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'application/pdf',
]);

/** Erreur destinée à l'utilisateur (renvoyée en 400 par hg-notify). */
export class MediaError extends Error {
  readonly status = 400;
}

// Forme exacte d'un chemin : manuel/, une date AAAA-MM-JJ, un uuid puis le nom du fichier (160 caractères au plus).
// Toute autre forme est refusée, ce qui empêche de lire un autre dossier du bucket.
const PATH_RE = /^manuel\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[^\/\\\u0000]{1,160}$/i;

/** Nom affiché : sans le préfixe « <uuid>- » ajouté au téléversement. */
const displayName = (path: string) => (path.split('/').pop() ?? path).replace(/^[0-9a-f-]{36}-/i, '');

/**
 * Valide la liste reçue du client : tableau, 4 chemins au plus, chemins sous manuel/ sans « .. ».
 * Les doublons sont retirés. Renvoie une liste vide si rien n'est envoyé.
 * @param {unknown} raw Valeur brute du champ « pieces » du corps de requête.
 * @param {number} [max] Nombre maximal de fichiers (défaut : MAX_ATTACH_FILES).
 * @returns {string[]} Chemins valides et uniques.
 */
export function validAttachmentPaths(raw: unknown, max = MAX_ATTACH_FILES): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new MediaError('Pièces jointes invalides');
  if (raw.length > max) throw new MediaError(`${max} fichiers maximum par envoi`);
  const paths = raw.map((p) => {
    if (typeof p !== 'string' || !PATH_RE.test(p) || p.includes('..')) throw new MediaError('Chemin de pièce jointe refusé');
    return p;
  });
  return [...new Set(paths)];
}

/**
 * Lit les fichiers dans le bucket privé et contrôle taille et type. Noms uniques dans le message.
 * Si deux fichiers ont le même nom, le second reçoit un suffixe _2, _3, etc.
 * @param {any} db Client Supabase (clé service role).
 * @param {string[]} paths Chemins déjà validés par validAttachmentPaths.
 * @param {number} [maxBytes] Taille maximale d'un fichier en octets.
 * @param {number} [maxMo] Taille maximale en Mo, utilisée seulement dans le message d'erreur.
 * @returns {Promise<UploadFile[]>} Fichiers prêts à être envoyés à Discord.
 */
// deno-lint-ignore no-explicit-any
export async function loadAttachments(db: any, paths: string[], maxBytes = MAX_ATTACH_BYTES, maxMo = 10): Promise<UploadFile[]> {
  const out: UploadFile[] = [];
  const used = new Set<string>();
  for (const path of paths) {
    const shown = displayName(path);
    const { data, error } = await db.storage.from(BOT_MEDIA_BUCKET).download(path);
    if (error || !data) throw new MediaError(`Pièce jointe introuvable : ${shown}`);
    // Le contrôle de taille et de type se fait sur les métadonnées du fichier téléversé, avant de le charger en mémoire.
    if (data.size > maxBytes) throw new MediaError(`${shown} dépasse ${maxMo} Mo`);
    const type = data.type || 'application/octet-stream';
    if (!BOT_MEDIA_TYPES.has(type)) throw new MediaError(`Type de fichier non autorisé : ${shown}`);
    let name = safeFileName(shown);
    // Évite les doublons de nom : on ajoute _2, _3... avant l'extension.
    for (let n = 2; used.has(name); n++) name = safeFileName(shown.replace(/(\.[^.]+)?$/, `_${n}$1`));
    used.add(name);
    out.push({ name, type, data: new Uint8Array(await data.arrayBuffer()) });
  }
  return out;
}
