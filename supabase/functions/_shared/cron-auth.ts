// ===== Humane Gang — contrôle d'accès des fonctions planifiées (partagé par hg-cron et hg-birthdays) =====
// Rôle : empêcher n'importe qui d'appeler les tâches planifiées (rappels, anniversaires) depuis Internet.
// pg_cron appelle ces fonctions avec l'en-tête « x-cron-secret ». La valeur attendue vient de la variable
// d'environnement CRON_SECRET si elle existe, sinon de la table privée public.hg_private (clé « cron_secret »,
// RLS sans aucune policy : lisible uniquement avec la clé service role, et par pg_cron côté base).
// Sans secret configuré, tout appel est refusé. Comparaison à temps constant des empreintes SHA-256 (longueur fixe :
// ni le contenu ni la longueur du secret ne se devinent au temps de réponse). Le secret lu en table n'est gardé
// que CACHE_TTL_MS : après une rotation, l'ancien secret est refusé au plus tard 5 minutes après.
// Dépendances : le client Supabase passé par l'appelant (clé service role).
// Exporte : cronAuthorized.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

/** Durée de vie du secret lu en table, dans une même instance (5 minutes). */
const CACHE_TTL_MS = 5 * 60_000;
/** Secret lu depuis la table et date de lecture, gardés CACHE_TTL_MS pour les appels suivants de la même instance. */
let cached: { value: string; at: number } | null = null;

/**
 * Renvoie le secret attendu. La variable d'environnement prime ; sinon on lit la table privée.
 * Une erreur de lecture donne une chaîne vide, ce qui fait refuser l'appel (échec fermé).
 * @param {SupabaseClient} db Client Supabase (clé service role).
 * @returns {Promise<string>} Secret attendu, ou '' si aucun n'est configuré.
 */
async function expectedSecret(db: SupabaseClient): Promise<string> {
  const env = Deno.env.get('CRON_SECRET') ?? '';
  if (env) return env;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  cached = null;
  const { data, error } = await db.from('hg_private').select('value').eq('key', 'cron_secret').maybeSingle();
  if (error || !data?.value) return '';
  cached = { value: String(data.value), at: Date.now() };
  return cached.value;
}

/** Empreinte SHA-256 d'un texte (32 octets). */
async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/**
 * Vérifie l'en-tête x-cron-secret de la requête. Les empreintes SHA-256 (même longueur) sont comparées octet par
 * octet sans sortie anticipée, pour ne révéler ni le secret ni sa longueur par le temps de réponse.
 * @param {Request} req Requête entrante.
 * @param {SupabaseClient} db Client Supabase (clé service role).
 * @returns {Promise<boolean>} true si le secret correspond, false sinon.
 */
export async function cronAuthorized(req: Request, db: SupabaseClient): Promise<boolean> {
  const expected = await expectedSecret(db);
  if (!expected) return false;
  const given = await sha256(req.headers.get('x-cron-secret') ?? '');
  const want = await sha256(expected);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given[i] ^ want[i];
  return diff === 0;
}
