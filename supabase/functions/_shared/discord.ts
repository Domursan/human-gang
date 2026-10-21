// ===== Humane Gang — client Discord partagé par les fonctions edge (hg-notify, hg-support, hg-birthdays, hg-cron) =====
// Envoi dans un salon ou en MP avec le bot, gestion du 429 (attente du délai « retry_after » de Discord, puis nouvel
// essai), en-têtes CORS communs et réponses JSON.
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

const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 10_000; // au-delà, on n'attend pas : la fonction doit rester dans son délai d'exécution

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Délai demandé par Discord sur un 429 : « retry_after » (secondes) du corps, sinon l'en-tête Retry-After. */
async function retryDelayMs(res: Response): Promise<number> {
  const body = await res.json().catch(() => ({} as { retry_after?: number }));
  const sec = Number(body?.retry_after ?? res.headers.get('Retry-After') ?? 1);
  return Number.isFinite(sec) && sec >= 0 ? Math.ceil(sec * 1000) : 1000;
}

/** POST sur l'API Discord v10 avec le bot. Relance après un 429 (jusqu'à 3 essais, attente max 10 s). */
// deno-lint-ignore no-explicit-any
export async function discordApi(path: string, body: unknown): Promise<any> {
  const token = Deno.env.get('DISCORD_BOT_TOKEN');
  if (!token) throw new Error('DISCORD_BOT_TOKEN absent');
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

/** Message dans un salon. Les mentions sont désactivées par défaut (pas de @everyone involontaire). */
// deno-lint-ignore no-explicit-any
export function sendChannel(channelId: string, message: Record<string, unknown>): Promise<any> {
  return discordApi(`/channels/${channelId}/messages`, { allowed_mentions: { parse: [] }, ...message });
}

/** Message privé : ouvre le salon MP avec le membre puis envoie. Le membre doit partager un serveur avec le bot. */
// deno-lint-ignore no-explicit-any
export async function sendDM(userId: string, message: Record<string, unknown>): Promise<any> {
  const ch = await discordApi('/users/@me/channels', { recipient_id: userId });
  return sendChannel(ch.id, message);
}
