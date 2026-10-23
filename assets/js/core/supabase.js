// Client Supabase du socle. Chargé en dernier (import dynamique de supabase-js, module évalué après les
// préférences et le thème en cache, voir core.js).
/*
 * Rôle : crée l'unique client Supabase du site (sb) et fournit deux petites aides :
 * hasSession (y a-t-il une session ouverte ?) et isNavCancel (faut-il ignorer cette erreur, due à une navigation ?).
 * Page : toutes les pages (tous les autres fichiers du socle importent sb depuis ici).
 * Dépendances : config.js (URL et clé publique), supabase-js chargé depuis jsDelivr (version fixée).
 * Exporte : sb, hasSession, isNavCancel, authLanding, signOutDevice.
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

/* ---------- Retour d'un lien reçu par e-mail (confirmation d'inscription, mot de passe oublié) ----------
   Flux PKCE : le lien ramène sur compte.html avec ?code=<uuid>, échangeable contre une session seulement avec le
   « code_verifier » gardé par CE navigateur au moment de la demande. Un lien fabriqué par quelqu'un d'autre
   (session d'un autre compte en #access_token=…, ou ?code= sans verifier) n'ouvre donc aucune session (fixation refusée).
   La lecture de l'adresse n'est active que sur compte.html, seule page de retour des e-mails ; ailleurs l'adresse
   est ignorée. Sur compte.html, ?code=HG-XXXX est un code d'invitation et non un code d'authentification : la lecture
   est coupée dans ce cas, pour ne pas consommer le verifier d'une inscription en attente. */
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
/** Clé de stockage du verifier PKCE (nom imposé par supabase-js : sb-<projet>-auth-token-code-verifier). */
const VERIFIER_KEY = `sb-${PROJECT_REF}-auth-token-code-verifier`;
/** Pages qui reçoivent les retours d'e-mail. */
const URL_SESSION_PAGES = new Set(['compte.html']);
const _here = new URL(location.href);
const _page = _here.pathname.split('/').pop() || 'index.html';
const _code = _here.searchParams.get('code') || '';
const _isAuthCode = /^[0-9a-f-]{36}$/i.test(_code);
let _verifier = false;
try { _verifier = !!localStorage.getItem(VERIFIER_KEY); } catch { /* stockage bloqué : pas d'échange possible */ }
const detectSessionInUrl = URL_SESSION_PAGES.has(_page) && (!_code || _isAuthCode);

/** Client Supabase partagé par tout le site : session persistante, rafraîchissement automatique du jeton, flux PKCE. */
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl, flowType: 'pkce', lock: memoryLock },
});

/**
 * Résultat du retour par lien d'e-mail sur cette page.
 * - fromEmailLink : vrai si une session vient d'être ouverte en échangeant le ?code= du lien (même navigateur que la demande) ;
 * - codeWithoutVerifier : vrai si l'adresse portait un code d'e-mail que ce navigateur ne peut pas échanger
 *   (lien ouvert dans un autre navigateur ou une autre appli que celle de la demande).
 * @type {{fromEmailLink: boolean, codeWithoutVerifier: boolean}}
 */
export const authLanding = { fromEmailLink: false, codeWithoutVerifier: false };
if (detectSessionInUrl && _isAuthCode) {
  if (!_verifier) authLanding.codeWithoutVerifier = true;
  else {
    let initError = null;
    try { initError = (await sb.auth.initialize?.())?.error ?? null; } catch (e) { initError = e; }
    authLanding.fromEmailLink = !initError;
  }
}

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

/**
 * Déconnexion de cet appareil : retire d'abord l'abonnement aux notifications push de l'appareil (ligne
 * hg_push_subscriptions, tant que la session permet encore de la supprimer, puis désabonnement du navigateur),
 * pour que le compte suivant sur un appareil partagé ne reçoive pas les alertes du précédent. Puis ferme la session.
 * Ne jette jamais : chaque étape est au mieux, et l'ensemble du push est borné à 3 secondes.
 * @returns {Promise<void>}
 */
export async function signOutDevice() {
  try {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      await Promise.race([
        (async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          const sub = await reg?.pushManager?.getSubscription();
          if (!sub) return;
          try { await sb.from('hg_push_subscriptions').delete().eq('endpoint', sub.endpoint); } catch { /* ligne déjà absente ou réseau */ }
          await sub.unsubscribe().catch(() => {});
        })(),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    }
  } catch { /* push indisponible : sans effet */ }
  // Copie hors ligne de la collection (IndexedDB) effacée à chaque déconnexion, comme le menu : téléphone prêté,
  // ordinateur partagé. Sans cela, la page Compte et le panel admin la laissaient sur l'appareil.
  try { await (await import('../offline-store.js')).clearOffline(); } catch { /* rien à effacer */ }
  try { await sb.auth.signOut(); } catch { /* déconnexion locale au mieux */ }
}
