// ===== Humane Gang — contrôle d'accès des fonctions planifiées (partagé par hg-cron et hg-birthdays) =====
// Rôle : empêcher n'importe qui d'appeler les tâches planifiées (rappels, anniversaires) depuis Internet.
// pg_cron appelle ces fonctions avec l'en-tête « x-cron-secret ». La valeur attendue vient de la variable
// d'environnement CRON_SECRET si elle existe, sinon de la table privée public.hg_private (clé « cron_secret »,
// RLS sans aucune policy : lisible uniquement avec la clé service role, et par pg_cron côté base).
// Sans secret configuré, tout appel est refusé. Comparaison à temps constant.
// Dépendances : le client Supabase passé par l'appelant (clé service role).
// Exporte : cronAuthorized.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

/** Secret lu une seule fois depuis la table, puis gardé pour les appels suivants de la même instance. */
let cached: string | null = null;

/**
 * Renvoie le secret attendu. La variable d'environnement prime ; sinon on lit la table privée.
 * Une erreur de lecture donne une chaîne vide, ce qui fait refuser l'appel (échec fermé).
 * @param {SupabaseClient} db Client Supabase (clé service role).
 * @returns {Promise<string>} Secret attendu, ou '' si aucun n'est configuré.
 */
async function expectedSecret(db: SupabaseClient): Promise<string> {
  const env = Deno.env.get('CRON_SECRET') ?? '';
  if (env) return env;
  if (cached) return cached;
  const { data, error } = await db.from('hg_private').select('value').eq('key', 'cron_secret').maybeSingle();
  if (error || !data?.value) return '';
  cached = String(data.value);
  return cached;
}

/**
 * Vérifie l'en-tête x-cron-secret de la requête. Comparaison octet par octet sans sortie anticipée
 * sur le contenu, pour ne pas révéler le secret par le temps de réponse.
 * @param {Request} req Requête entrante.
 * @param {SupabaseClient} db Client Supabase (clé service role).
 * @returns {Promise<boolean>} true si le secret correspond, false sinon.
 */
export async function cronAuthorized(req: Request, db: SupabaseClient): Promise<boolean> {
  const expected = await expectedSecret(db);
  if (!expected) return false;
  const given = new TextEncoder().encode(req.headers.get('x-cron-secret') ?? '');
  const want = new TextEncoder().encode(expected);
  // Des longueurs différentes sont refusées tout de suite (la longueur du secret n'est pas gardée secrète ici).
  if (given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given[i] ^ want[i];
  return diff === 0;
}
