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
