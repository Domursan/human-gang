// ===== Humane Gang — client Discord partagé par les fonctions edge (hg-notify, hg-support, hg-birthdays, hg-cron) =====
// Envoi dans un salon ou en MP avec le bot, pièces jointes (multipart), gestion du 429 (attente du délai « retry_after »
// de Discord, puis nouvel essai), en-têtes CORS communs et réponses JSON.
// Erreurs : DiscordError (status + message « Discord <code> : <détail> », format relu par hg-notify pour l'admin).
// Secret : DISCORD_BOT_TOKEN (Deno.env). Aucune donnée n'est journalisée ici.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export class DiscordError extends Error {
  constructor(public status: number, detail: string) {
    super(`Discord ${status} : ${detail}`);
    this.name = 'DiscordError';
  }
}

export const hasBotToken = () => !!Deno.env.get('DISCORD_BOT_TOKEN');
export const isSnowflake = (v: unknown): v is string => typeof v === 'string' && /^\d{17,20}$/.test(v);

/** Pièce jointe prête à envoyer : nom sûr (aussi celui de attachment://), type MIME et contenu. */
export type UploadFile = { name: string; type: string; data: Uint8Array };
/** Limites d'un envoi : 4 fichiers, 10 Mo chacun (limite d'envoi d'un bot sur un serveur sans boost). */
export const MAX_ATTACH_FILES = 4;
export const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
// Les limites réglables (bot.envoi) sont passées en paramètre par les appelants ; ces constantes sont les défauts.

/** Nom de fichier accepté par Discord et sans caractère de chemin. */
export const safeFileName = (n: string) =>
  n.normalize('NFC').replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(0, 100) || 'fichier';

const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 10_000; // au-delà, on n'attend pas : la fonction doit rester dans son délai d'exécution

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Délai demandé par Discord sur un 429 : « retry_after » (secondes) du corps, sinon l'en-tête Retry-After. */
async function retryDelayMs(res: Response): Promise<number> {
  const body = await res.json().catch(() => ({} as { retry_after?: number }));
  const sec = Number(body?.retry_after ?? res.headers.get('Retry-After') ?? 1);
  return Number.isFinite(sec) && sec >= 0 ? Math.ceil(sec * 1000) : 1000;
}

/** POST sur l'API Discord v10 avec le bot. `init` est rappelé à chaque essai (un FormData ne se rejoue pas). */
// deno-lint-ignore no-explicit-any
async function discordRequest(path: string, init: () => { body: BodyInit; headers?: Record<string, string> }): Promise<any> {
  const token = Deno.env.get('DISCORD_BOT_TOKEN');
  if (!token) throw new Error('DISCORD_BOT_TOKEN absent');
  for (let attempt = 1; ; attempt++) {
    const { body, headers } = init();
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, ...(headers ?? {}) },
      body,
    });
    if (res.status === 429) {
      const wait = await retryDelayMs(res);
      if (attempt >= MAX_ATTEMPTS || wait > MAX_WAIT_MS) throw new DiscordError(429, 'trop de requêtes');
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new DiscordError(res.status, await res.text());
    return await res.json();
  }
}

/** Corps JSON (sans pièce jointe). */
const jsonInit = (payload: unknown) => () => ({
  body: JSON.stringify(payload),
  headers: { 'Content-Type': 'application/json' },
});

/** Corps multipart/form-data : payload_json (message + attachments) puis files[n] (contenu des fichiers). */
const multipartInit = (payload: Record<string, unknown>, files: UploadFile[]) => () => {
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.data as BlobPart], { type: f.type }), f.name));
  return { body: form };
};

/** POST sur l'API Discord v10 (corps JSON, sans pièce jointe). */
// deno-lint-ignore no-explicit-any
export function discordApi(path: string, body: unknown): Promise<any> {
  return discordRequest(path, jsonInit(body));
}

/**
 * Message dans un salon. Les mentions sont désactivées par défaut (pas de @everyone involontaire) : un message qui
 * mentionne un rôle ou @everyone doit fournir son propre allowed_mentions (voir _shared/mentions.ts).
 * Avec `files`, le message part en multipart et chaque fichier doit être référencé par son nom (attachment://nom).
 */
// deno-lint-ignore no-explicit-any
export function sendChannel(channelId: string, message: Record<string, unknown>, files: UploadFile[] = []): Promise<any> {
  const payload = { allowed_mentions: { parse: [] }, ...message };
  const path = `/channels/${channelId}/messages`;
  if (!files.length) return discordRequest(path, jsonInit(payload));
  return discordRequest(path, multipartInit({ ...payload, attachments: files.map((f, i) => ({ id: i, filename: f.name })) }, files));
}

/** Message privé : ouvre le salon MP avec le membre puis envoie. Le membre doit partager un serveur avec le bot. */
// deno-lint-ignore no-explicit-any
export async function sendDM(userId: string, message: Record<string, unknown>, files: UploadFile[] = []): Promise<any> {
  const ch = await discordApi('/users/@me/channels', { recipient_id: userId });
  return sendChannel(ch.id, message, files);
}
