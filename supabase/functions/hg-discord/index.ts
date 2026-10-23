// ===== Humane Gang — fonction edge « hg-discord » : commandes slash du bot (interactions HTTP de Discord) =====
// Point d'entrée Deno : branche le gestionnaire (handler.ts) sur Supabase (clé service) et sur les secrets.
// Description complète, sécurité et secrets : voir l'en-tête de handler.ts. verify_jwt = false.
// Secrets : DISCORD_PUBLIC_KEY (obligatoire), DISCORD_GUILD_ID (recommandé), SITE_URL (facultatif),
//   SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (fournis).
// Dépendances : ./handler.ts, ./lib.ts. Exporte : rien (Deno.serve).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { makeHandler } from './handler.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(makeHandler({
  rpc: async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw error;
    return data as T;
  },
  log: async (row) => {
    const { error } = await db.from('hg_bot_log').insert(row);
    if (error) throw error;
  },
  fetch: (input, init) => fetch(input, init),
  // Supabase Edge : la complétion continue après la réponse différée.
  later: (p) => {
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(p); else p.catch((e) => console.error('[hg-discord]', e));
  },
  publicKey: Deno.env.get('DISCORD_PUBLIC_KEY') ?? '',
  guild: Deno.env.get('DISCORD_GUILD_ID') ?? '',
  site: (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, ''),
}));
