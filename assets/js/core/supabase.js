// Client Supabase du socle. Chargé en dernier (import dynamique de supabase-js, module évalué après les
// préférences et le thème en cache, voir core.js).
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');

// Verrou simple en mémoire à la place du verrou navigateur (Navigator LockManager) :
// celui-ci provoquait l'erreur « Acquiring an exclusive Navigator LockManager lock … immediately failed »
// et bloquait le chargement quand plusieurs requêtes partaient en même temps.
const memoryLock = (() => {
  let queue = Promise.resolve();
  return async (_name, _timeout, fn) => {
    const run = queue.then(() => fn());
    queue = run.catch(() => {});
    return run;
  };
})();

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, lock: memoryLock },
});

// Passage à une autre page (lien, déconnexion, rechargement) : les requêtes en cours sont coupées, ce n'est pas une panne.
let _leaving = false;
addEventListener('pagehide', () => { _leaving = true; });

/** Vrai si une session est ouverte. Sans session, supabase-js envoie la seule clé publique : les RPC membres répondent 401. */
export async function hasSession() {
  try { return !!(await sb.auth.getSession()).data.session; } catch { return false; }
}
/** Erreur causée par la navigation en cours (requête coupée) : à ignorer sans bruit dans la console. */
export const isNavCancel = (e) => _leaving && (e?.name === 'AbortError' || /NetworkError|Failed to fetch|aborted/i.test(String(e?.message ?? e)));
