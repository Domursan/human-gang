// Initialisation d'une page : thème, en-tête, pied, bandeau cookies, puis (membre) messages non lus et badges.
/*
 * Rôle : point d'entrée commun. Chaque page appelle initPage() une fois ; ce fichier enchaîne
 * le thème, le contrôle d'accès, l'en-tête, le menu, le pied de page et les effets, puis lance
 * les services du membre (messages non lus, badges, événements dynamiques, drops de cartes).
 * Page : toutes les pages du site.
 * Dépendances : theme-load.js, theme.js, effects.js, profile.js, pages-access.js, perms.js, godmode.js,
 * header.js, footer.js, unread.js, badges.js, site-load.js, site-defaults.js, site-etat.js (bandeau et maintenance).
 *   Chargés à part (import dynamique, sans bloquer la page) : dyn-events.js, card-drops.js.
 * Exporte : initPage.
 */
import { applyTheme } from './theme-load.js';
import { getActiveTheme } from './theme.js';
import { startEffects } from './effects.js';
import { requireMember, requireAdmin, getProfile } from './profile.js';
import { loadMyPages, canAccess, currentPageSlug } from './pages-access.js';
import { loadMyPerms, getCachedPerms, canPanel } from './perms.js';
import { loadGodMode } from './godmode.js';
import { renderHeader, updateNav } from './header.js';
import { renderFooter, cookieNotice } from './footer.js';
import { startUnread } from './unread.js';
import { checkNewBadges } from './badges.js';
import { loadSiteSettings } from './site-load.js';
import { applySiteDom } from './site-defaults.js';
import { applySiteEtat } from './site-etat.js';

/* ---------- Constantes ---------- */

/** Délai maximal (ms) pour récupérer le profil avant d'afficher « Connexion impossible ». */
const PROFILE_TIMEOUT_MS = 15000;

/* ---------- Utilitaires ---------- */

/**
 * Fait échouer une promesse si elle ne répond pas dans le délai donné.
 * Le minuteur est nettoyé dans tous les cas, pour ne pas garder de timer inutile.
 * @param {Promise<any>} p Promesse à surveiller.
 * @param {number} ms Délai maximal en millisecondes.
 * @returns {Promise<any>} La valeur de p, ou une erreur « délai dépassé ».
 */
function withTimeout(p, ms) {
  let t = 0;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('délai dépassé')), ms); })])
    .finally(() => clearTimeout(t));
}

/* ---------- Écran « Connexion impossible » ---------- */

/**
 * Écran « Connexion impossible » dans la zone principale. Résout quand l'utilisateur réessaie (bouton)
 * ou quand le navigateur repasse en ligne : la page reprend alors son initialisation.
 * @param {string} [detail=''] Message technique affiché en petit, pour le diagnostic.
 * @returns {Promise<void>} Résolue quand l'utilisateur peut réessayer.
 */
function connectionError(detail = '') {
  return new Promise((resolve) => {
    const main = document.getElementById('app') || document.querySelector('main') || document.body;
    main.setAttribute('aria-busy', 'false');
    main.innerHTML = `<section class="conn-error" aria-labelledby="conn-title">
        <h1 id="conn-title" class="display">Connexion impossible</h1>
        <p class="conn-text"></p>
        <button class="btn btn-primary conn-retry" type="button">Réessayer</button>
        <p class="conn-detail small muted"></p>
      </section>`;
    const text = main.querySelector('.conn-text');
    const btn = main.querySelector('.conn-retry');
    main.querySelector('.conn-detail').textContent = detail ? `Détail : ${detail}` : '';
    /** Met à jour le texte selon l'état réseau (hors ligne ou serveur injoignable). */
    const paintText = () => {
      text.textContent = navigator.onLine === false
        ? 'Tu sembles hors ligne. La page reprendra dès que la connexion reviendra.'
        : 'Le site n\'a pas pu joindre le serveur. Vérifie ta connexion, puis réessaie.';
    };
    paintText();
    /** Retire les écouteurs réseau de cet écran. */
    const done = () => {
      window.removeEventListener('online', go);
      window.removeEventListener('offline', paintText);
    };
    /** Sort de l'écran : nettoie les écouteurs puis résout la promesse. */
    function go() { done(); resolve(); }
    window.addEventListener('online', go);
    window.addEventListener('offline', paintText);
    btn.addEventListener('click', () => { btn.disabled = true; btn.textContent = 'Nouvelle tentative…'; go(); });
    btn.focus();
  });
}

/* ---------- Une tentative d'initialisation ---------- */

/**
 * Une tentative d'initialisation. Jette en cas d'échec réseau ; Error('redirect') si on quitte la page.
 * L'ordre compte : les réglages du site et le profil sont chargés en parallèle, mais le menu
 * n'est construit qu'une fois la liste des pages accessibles connue.
 * @param {'member'|'admin'|'optional'} auth Niveau d'accès exigé par la page.
 * @returns {Promise<object|null>} Le profil connecté, ou null pour un visiteur.
 */
async function startPage(auth) {
  applyTheme();
  const siteP = loadSiteSettings(); // réglages du site (nom, menu, pied, textes) : ne lève jamais d'erreur
  const who = auth === 'member' ? requireMember() : auth === 'admin' ? requireAdmin() : getProfile();
  const profile = await withTimeout(who, PROFILE_TIMEOUT_MS);
  await siteP;
  applySiteDom();
  const pagesP = profile ? loadMyPages() : null; // en parallèle du mode sans limite
  const godP = loadGodMode(profile); // les pages lisent getGodMode() dès leur premier affichage
  const permsP = profile ? loadMyPerms() : null; // droits sur le panel (Staff/admin) : une requête, en cache
  // En-tête tout de suite (compte, outils) ; les liens arrivent avec les pages accessibles
  renderHeader(profile, { nav: false });
  await Promise.all([pagesP, godP, permsP]);
  const slug = currentPageSlug();
  // Page déclarée mais interdite -> accueil (jamais depuis l'accueil lui-même, pour éviter une boucle)
  if (pagesP && slug !== 'accueil' && !canAccess(slug)) {
    location.replace(`accueil.html?refus=${encodeURIComponent(slug)}`);
    return new Promise(() => {}); // la page s'arrête là, sans erreur
  }
  updateNav(profile);
  renderFooter(profile);
  cookieNotice();
  // État du site (bandeau d'annonce, écran de maintenance) : affichage seulement ; admin et Staff ne sont jamais bloqués
  const etat = applySiteEtat({ isStaff: !!profile && canPanel(getCachedPerms()), connecte: !!profile });
  startEffects(getActiveTheme());
  if (profile && !etat.maintenance) {
    startUnread();
    checkNewBadges();
    // Événements dynamiques (image qui traverse le site) : chargé à part, sans jamais bloquer ni casser la page
    import('../dyn-events.js').then((m) => m.startDynEvents(profile)).catch((e) => console.warn('[événements]', e));
    import('../card-drops.js').then((m) => m.startCardDrops(profile)).catch((e) => console.warn('[drops]', e));
  }
  return profile;
}

/* ---------- Point d'entrée ---------- */

/**
 * Initialise une page : thème, en-tête, pied, bandeau cookies, puis (membre) messages non lus, badges.
 * options.auth : 'member' | 'admin' | 'optional'. Renvoie le profil (ou null).
 * En cas d'échec réseau, affiche « Connexion impossible » et ne résout qu'après une nouvelle tentative réussie.
 * @param {{auth?: 'member'|'admin'|'optional'}} [options] Niveau d'accès exigé ('member' par défaut).
 * @returns {Promise<object|null>} Le profil connecté, ou null.
 */
export async function initPage({ auth = 'member' } = {}) {
  for (;;) {
    try {
      return await startPage(auth);
    } catch (e) {
      if (e?.message === 'redirect') return new Promise(() => {}); // redirection en cours : la page s'arrête là
      console.warn('[initPage]', e);
      await connectionError(e?.message || String(e)); // attend « Réessayer » ou le retour du réseau, puis recommence
    }
  }
}
