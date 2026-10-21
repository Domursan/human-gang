// ===== Humane Gang — pièces jointes des messages manuels du bot (partagé par hg-notify) =====
// Les fichiers sont téléversés par l'admin dans le bucket privé « hg-bot-media » (migration 037) sous
// « manuel/<AAAA-MM-JJ>/<uuid>-<nom> ». La fonction les lit avec la clé de service et les renvoie à Discord.
// Le client ne fournit que des chemins : jamais de contenu, jamais d'URL. Un chemin hors de manuel/ est refusé.
import { MAX_ATTACH_BYTES, MAX_ATTACH_FILES, safeFileName, type UploadFile } from './discord.ts';

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

const PATH_RE = /^manuel\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[^\/\\\u0000]{1,160}$/i;

/** Nom affiché : sans le préfixe « <uuid>- » ajouté au téléversement. */
const displayName = (path: string) => (path.split('/').pop() ?? path).replace(/^[0-9a-f-]{36}-/i, '');

/** Valide la liste reçue du client : tableau, 4 chemins au plus, chemins sous manuel/ sans « .. ». */
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

/** Lit les fichiers dans le bucket privé et contrôle taille et type. Noms uniques dans le message. */
// deno-lint-ignore no-explicit-any
export async function loadAttachments(db: any, paths: string[], maxBytes = MAX_ATTACH_BYTES, maxMo = 10): Promise<UploadFile[]> {
  const out: UploadFile[] = [];
  const used = new Set<string>();
  for (const path of paths) {
    const shown = displayName(path);
    const { data, error } = await db.storage.from(BOT_MEDIA_BUCKET).download(path);
    if (error || !data) throw new MediaError(`Pièce jointe introuvable : ${shown}`);
    if (data.size > maxBytes) throw new MediaError(`${shown} dépasse ${maxMo} Mo`);
    const type = data.type || 'application/octet-stream';
    if (!BOT_MEDIA_TYPES.has(type)) throw new MediaError(`Type de fichier non autorisé : ${shown}`);
    let name = safeFileName(shown);
    for (let n = 2; used.has(name); n++) name = safeFileName(shown.replace(/(\.[^.]+)?$/, `_${n}$1`));
    used.add(name);
    out.push({ name, type, data: new Uint8Array(await data.arrayBuffer()) });
  }
  return out;
}
