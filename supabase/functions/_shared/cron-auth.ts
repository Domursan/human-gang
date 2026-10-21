// ===== Humane Gang — contrôle d'accès des fonctions planifiées (partagé par hg-cron et hg-birthdays) =====
// pg_cron appelle ces fonctions avec l'en-tête « x-cron-secret » égal à la variable CRON_SECRET de la fonction.
// Sans CRON_SECRET configuré, tout appel est refusé : une fonction ouverte ne doit jamais tourner par défaut.
// Comparaison à temps constant (pas de fuite du secret par le temps de réponse).

export function cronAuthorized(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET') ?? '';
  if (!expected) return false;
  const given = new TextEncoder().encode(req.headers.get('x-cron-secret') ?? '');
  const want = new TextEncoder().encode(expected);
  if (given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given[i] ^ want[i];
  return diff === 0;
}
