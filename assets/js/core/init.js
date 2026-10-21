// Initialisation d'une page : thème, en-tête, pied, bandeau cookies, puis (membre) messages non lus et badges.
import { applyTheme } from './theme-load.js';
import { getActiveTheme } from './theme.js';
import { startEffects } from './effects.js';
import { requireMember, requireAdmin, getProfile } from './profile.js';
import { loadMyPages, canAccess, currentPageSlug } from './pages-access.js';
import { loadMyPerms } from './perms.js';
import { loadGodMode } from './godmode.js';
import { renderHeader, updateNav } from './header.js';
import { renderFooter, cookieNotice } from './footer.js';
import { startUnread } from './unread.js';
import { checkNewBadges } from './badges.js';

const PROFILE_TIMEOUT_MS = 15000;
function withTimeout(p, ms) {
  let t = 0;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('délai dépassé')), ms); })])
    .finally(() => clearTimeout(t));
}

/**
 * Écran « Connexion impossible » dans la zone principale. Résout quand l'utilisateur réessaie (bouton)
 * ou quand le navigateur repasse en ligne : la page reprend alors son initialisation.
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
    const paintText = () => {
      text.textContent = navigator.onLine === false
        ? 'Tu sembles hors ligne. La page reprendra dès que la connexion reviendra.'
        : 'Le site n\'a pas pu joindre le serveur. Vérifie ta connexion, puis réessaie.';
    };
    paintText();
    const done = () => {
      window.removeEventListener('online', go);
      window.removeEventListener('offline', paintText);
    };
    function go() { done(); resolve(); }
    window.addEventListener('online', go);
    window.addEventListener('offline', paintText);
    btn.addEventListener('click', () => { btn.disabled = true; btn.textContent = 'Nouvelle tentative…'; go(); });
    btn.focus();
  });
}

/** Une tentative d'initialisation. Jette en cas d'échec réseau ; Error('redirect') si on quitte la page. */
async function startPage(auth) {
  applyTheme();
  const who = auth === 'member' ? requireMember() : auth === 'admin' ? requireAdmin() : getProfile();
  const profile = await withTimeout(who, PROFILE_TIMEOUT_MS);
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
  startEffects(getActiveTheme());
  if (profile) {
    startUnread();
    checkNewBadges();
    // Événements dynamiques (image qui traverse le site) : chargé à part, sans jamais bloquer ni casser la page
    import('../dyn-events.js').then((m) => m.startDynEvents(profile)).catch((e) => console.warn('[événements]', e));
  }
  return profile;
}

/**
 * Initialise une page : thème, en-tête, pied, bandeau cookies, puis (membre) messages non lus, badges.
 * options.auth : 'member' | 'admin' | 'optional'. Renvoie le profil (ou null).
 * En cas d'échec réseau, affiche « Connexion impossible » et ne résout qu'après une nouvelle tentative réussie.
 */
export async function initPage({ auth = 'member' } = {}) {
  for (;;) {
    try {
      return await startPage(auth);
    } catch (e) {
      if (e?.message === 'redirect') return new Promise(() => {}); // redirection en cours : la page s'arrête là
      console.warn('[initPage]', e);
      await connectionError(e?.message || String(e));
    }
  }
}
