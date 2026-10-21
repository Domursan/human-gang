// ===== Humane Gang — contrôle d'accès des fonctions planifiées (partagé par hg-cron et hg-birthdays) =====
// pg_cron appelle ces fonctions avec l'en-tête « x-cron-secret ». La valeur attendue vient de la variable
// d'environnement CRON_SECRET si elle existe, sinon de la table privée public.hg_private (clé « cron_secret »,
// RLS sans aucune policy : lisible uniquement avec la clé service role, et par pg_cron côté base).
// Sans secret configuré, tout appel est refusé. Comparaison à temps constant.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

let cached: string | null = null;

async function expectedSecret(db: SupabaseClient): Promise<string> {
  const env = Deno.env.get('CRON_SECRET') ?? '';
  if (env) return env;
  if (cached) return cached;
  const { data, error } = await db.from('hg_private').select('value').eq('key', 'cron_secret').maybeSingle();
  if (error || !data?.value) return '';
  cached = String(data.value);
  return cached;
}

export async function cronAuthorized(req: Request, db: SupabaseClient): Promise<boolean> {
  const expected = await expectedSecret(db);
  if (!expected) return false;
  const given = new TextEncoder().encode(req.headers.get('x-cron-secret') ?? '');
  const want = new TextEncoder().encode(expected);
  if (given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given[i] ^ want[i];
  return diff === 0;
}
