// Client Supabase du socle. Chargé en dernier (import dynamique de supabase-js, module évalué après les
// préférences et le thème en cache, voir core.js).
/*
 * Rôle : crée l'unique client Supabase du site (sb) et fournit deux petites aides :
 * hasSession (y a-t-il une session ouverte ?) et isNavCancel (faut-il ignorer cette erreur, due à une navigation ?).
 * Page : toutes les pages (tous les autres fichiers du socle importent sb depuis ici).
 * Dépendances : config.js (URL et clé publique), supabase-js chargé depuis jsDelivr (version fixée).
 * Exporte : sb, hasSession, isNavCancel.
 */
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

// supabase-js est chargé ici et non par une balise <script> : la version est fixée dans l'URL.
const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');

/**
 * Verrou simple en mémoire à la place du verrou navigateur (Navigator LockManager) :
 * celui-ci provoquait l'erreur « Acquiring an exclusive Navigator LockManager lock … immediately failed »
 * et bloquait le chargement quand plusieurs requêtes partaient en même temps.
 * Les opérations d'authentification sont exécutées l'une après l'autre dans cette file.
 * (Les paramètres _name et _timeout sont ceux attendus par supabase-js, non utilisés ici.)
 */
const memoryLock = (() => {
  let queue = Promise.resolve();
  return async (_name, _timeout, fn) => {
    const run = queue.then(() => fn());
    queue = run.catch(() => {}); // une erreur n'arrête pas la file
    return run;
  };
})();

/** Client Supabase partagé par tout le site : session persistante, rafraîchissement automatique du jeton. */
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, lock: memoryLock },
});

// Passage à une autre page (lien, déconnexion, rechargement) : les requêtes en cours sont coupées, ce n'est pas une panne.
let _leaving = false;
addEventListener('pagehide', () => { _leaving = true; });

/**
 * Vrai si une session est ouverte. Sans session, supabase-js envoie la seule clé publique : les RPC membres répondent 401.
 * Ne jette jamais : en cas d'erreur, renvoie false.
 * @returns {Promise<boolean>}
 */
export async function hasSession() {
  try { return !!(await sb.auth.getSession()).data.session; } catch { return false; }
}
/**
 * Erreur causée par la navigation en cours (requête coupée) : à ignorer sans bruit dans la console.
 * @param {*} e Erreur attrapée.
 * @returns {boolean} true si la page est en train de quitter et que l'erreur est une requête coupée.
 */
export const isNavCancel = (e) => _leaving && (e?.name === 'AbortError' || /NetworkError|Failed to fetch|aborted/i.test(String(e?.message ?? e)));
