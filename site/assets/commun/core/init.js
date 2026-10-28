// Initialisation d'une page : thème, en-tête, pied, bandeau cookies, puis (membre) messages non lus et badges.
// Démarrage « affiche d'abord, rafraîchis ensuite » : si la mémoire d'affichage (memoire.js) a les valeurs du compte,
// l'en-tête et le menu s'affichent tout de suite et la base est relue en arrière-plan.
/*
 * Rôle : point d'entrée commun. Chaque page appelle initPage() une fois ; ce fichier enchaîne
 * le thème, le contrôle d'accès, l'en-tête, le menu, le pied de page et les effets, puis lance
 * les services du membre (messages non lus, badges, événements dynamiques, drops de cartes).
 * Démarrage rapide : profil, pages, droits et mode sans limite viennent de la mémoire d'affichage (10 minutes) ;
 * la base est relue ensuite, et l'affichage n'est remis à jour que si une valeur a changé. La mémoire ne décide
 * d'aucun accès côté serveur : la base reste maîtresse. Sans mémoire fraîche (ou pendant une vue « comme un membre »),
 * le démarrage attend la base comme avant.
 * Page : toutes les pages du site.
 * Dépendances : theme-load.js, theme.js, effects.js, profile.js, pages-access.js, perms.js, godmode.js,
 * header.js, footer.js, unread.js, badges.js, site-load.js, site-defaults.js, site-etat.js (bandeau et maintenance),
 * view-as.js (vue « comme un membre » de l'admin : résolue dès le profil connu, bandeau sous le menu),
 * memoire.js (mémoire d'affichage par compte), supabase.js (session locale).
 *   Chargés à part (import dynamique, sans bloquer la page) : dyn-events.js, card-drops.js, staff-dock.js
 *   (raccourcis Staff : barre à gauche pour l'admin et le Staff, pas sur /pages/admin/admin.html).
 * Exporte : initPage.
 */
import { applyTheme } from './theme-load.js';
import { getActiveTheme } from './theme.js';
import { startEffects } from './effects.js';
import { requireMember, requireAdmin, getProfile, primerProfil } from './profile.js';
import { loadMyPages, canAccess, currentPageSlug, primerPages } from './pages-access.js';
import { loadMyPerms, getCachedPerms, canPanel, primerDroits } from './perms.js';
import { loadGodMode, primerGodMode } from './godmode.js';
import { renderHeader, updateNav, updateHeaderProfile } from './header.js';
import { renderFooter, cookieNotice } from './footer.js';
import { startUnread } from './unread.js';
import { checkNewBadges } from './badges.js';
import { loadSiteSettings } from './site-load.js';
import { applySiteDom, siteIdentite } from './site-defaults.js';
import { applySiteEtat } from './site-etat.js';
import { resolveViewAs, viewAsActive, renderViewAsBar } from './view-as.js';
import { installLightDismiss } from './light-dismiss.js';
import { sb } from './supabase.js';
import { memoCompte, memoCompteCourant, memoLire, memoEffacer, vueActive } from './memoire.js';

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

/* ---------- Compte et mémoire d'affichage ---------- */

/**
 * Identifiant du compte connecté, lu dans la session locale (pas de requête réseau, sauf rafraîchissement du jeton).
 * @returns {Promise<string|null>} Null pour un visiteur ou en cas d'erreur.
 */
async function compteCourant() {
  try { const { data } = await sb.auth.getSession(); return data?.session?.user?.id ?? null; } catch { return null; }
}

/**
 * Valeurs gardées utilisables pour un démarrage rapide : profil et pages obligatoires. Pour un auth 'admin' d'un non-admin,
 * il faut des droits gardés (sinon la décision revient à la version complète, qui relit la base).
 * @param {'member'|'admin'|'optional'} auth Niveau d'accès exigé par la page.
 * @returns {{profile: object, pages: object, perms: object|undefined, god: object|undefined}|null}
 */
function lireMemoire(auth) {
  const profile = memoLire('profil');
  const pages = memoLire('pages');
  if (!profile || !pages || profile.id !== memoCompteCourant()) return null;
  const perms = memoLire('perms');
  if (auth === 'admin' && !profile.is_admin && !(perms && canPanel(perms))) return null;
  return { profile, pages, perms, god: memoLire('god') };
}

/** Services du membre déjà lancés sur cette page (messages non lus, présence, badges…) : une seule fois. */
let _servicesOk = false;
/** Raccourcis Staff déjà lancés sur cette page : une seule fois. */
let _dockOk = false;

/**
 * Lance les services du membre (une seule fois par page) : non lus, présence, en ligne, badges, événements, drops.
 * @param {object|null} profile Profil courant.
 * @param {{maintenance: boolean}} etat État du site (maintenance : pas de services).
 */
function demarrerServices(profile, etat) {
  if (!profile || etat.maintenance || _servicesOk) return;
  _servicesOk = true;
  startUnread();
  // Présence (en ligne / hors ligne), cloche des notifications du site, pastilles de statut (migration 153)
  import('./presence.js').then((m) => m.startPresence(profile)).catch((e) => console.warn('[présence]', e));
  // Menu « En ligne » à droite : membres connectés, raccourcis « Écrire » et « Défier » (migration 159)
  import('./en-ligne.js').then((m) => m.startEnLigne(profile)).catch((e) => console.warn('[en ligne]', e));
  checkNewBadges();
  // Événements dynamiques (image qui traverse le site) : chargé à part, sans jamais bloquer ni casser la page
  import('../dyn-events.js').then((m) => m.startDynEvents(profile)).catch((e) => console.warn('[événements]', e));
  import('../../espaces/cartes/card-drops.js').then((m) => m.startCardDrops(profile)).catch((e) => console.warn('[drops]', e));
}

/**
 * Raccourcis Staff (admin et Staff seulement, pas sur /pages/admin/admin.html ni en vue « comme un membre »), une seule fois.
 * Même en maintenance, car le Staff n'est jamais bloqué par l'état du site. Le module n'est chargé que pour eux.
 * @param {object|null} profile Profil courant.
 */
function demarrerRaccourcisStaff(profile) {
  if (_dockOk || !profile || !canPanel(getCachedPerms()) || viewAsActive() || currentPageSlug() === 'admin') return;
  _dockOk = true;
  import('./staff-dock.js').then((m) => m.startStaffDock(profile)).catch((e) => console.warn('[raccourcis Staff]', e));
}

/**
 * Partie finale du démarrage, commune aux deux chemins : pied, bandeau cookies, état du site, effets, services.
 * @param {object|null} profile Profil courant.
 * @returns {object|null} Le profil.
 */
function finir(profile) {
  renderFooter(profile);
  cookieNotice();
  // État du site (bandeau d'annonce, écran de maintenance) : affichage seulement ; admin et Staff ne sont jamais bloqués
  const etat = applySiteEtat({ isStaff: !!profile && canPanel(getCachedPerms()) && !viewAsActive(), connecte: !!profile });
  startEffects(getActiveTheme());
  demarrerServices(profile, etat);
  demarrerRaccourcisStaff(profile);
  return profile;
}

/**
 * Démarrage rapide : affiche l'en-tête et le menu avec les valeurs gardées, puis relit la base en arrière-plan.
 * Une page déjà interdite d'après la mémoire renvoie à l'accueil, comme la version complète.
 * Les réglages du site ne sont relus qu'après l'en-tête (le nom affiché vient du cache local, site-defaults.js).
 * @param {'member'|'admin'|'optional'} auth Niveau d'accès exigé.
 * @param {{profile: object, pages: object, perms: object|undefined, god: object|undefined}} g Valeurs gardées.
 * @returns {object|Promise<never>} Le profil, ou une promesse qui ne se résout jamais (redirection en cours).
 */
function demarrerAvecMemoire(auth, g) {
  const { profile } = g;
  // Valeurs gardées posées tout de suite : les autres modules les lisent sans requête
  primerProfil(profile);
  primerPages(g.pages);
  if (g.perms) primerDroits(profile.id, g.perms);
  primerGodMode(profile, g.god);
  const slug = currentPageSlug();
  if (slug !== 'accueil' && !canAccess(slug)) {
    location.replace(`/pages/compte/accueil.html?refus=${encodeURIComponent(slug)}`);
    return new Promise(() => {}); // la page s'arrête là, sans erreur
  }
  // Ce qui a été lu avant la relecture : sert à ne remettre à jour que ce qui a changé
  const avant = { profil: JSON.stringify(profile), pages: JSON.stringify(g.pages), perms: JSON.stringify(g.perms ?? null) };
  applySiteDom();
  renderHeader(profile, { nav: false });
  updateNav(profile);
  renderViewAsBar();
  finir(profile);
  const siteP = loadSiteSettings(); // après l'en-tête : le nom affiché vient du cache local
  rafraichir(auth, avant, siteP); // sans attendre : la page est déjà utilisable
  return profile;
}

/**
 * Relit la base après un affichage tiré de la mémoire, puis met à jour l'affichage si une valeur a changé.
 * Erreur réseau : rien ne change, la mémoire reste à l'écran. Droit ou page retirés : le menu est mis à jour et
 * la page renvoie à l'accueil si elle n'est plus permise. Profil introuvable : on relance le démarrage complet.
 * @param {'member'|'admin'|'optional'} auth Niveau d'accès exigé.
 * @param {{profil: string, pages: string, perms: string}} avant Valeurs (JSON) affichées avant la relecture.
 * @param {Promise<void>} siteP Chargement des réglages du site.
 * @returns {Promise<void>}
 */
async function rafraichir(auth, avant, siteP) {
  try {
    const slug = currentPageSlug();
    // Réglages du site : le nom de l'en-tête suit la base (le reste de la page est mis à jour par applySiteDom)
    siteP.then(() => {
      applySiteDom();
      const nom = siteIdentite().nom.toUpperCase();
      const marque = document.querySelector('.site-header .brand span');
      if (marque && marque.textContent !== nom) marque.textContent = nom;
    });
    let profil;
    try { profil = await getProfile(true); } catch (e) { console.warn('[mise à jour]', e?.message || e); return; } // réseau : on garde l'affichage
    if (!profil) { memoEffacer(); location.reload(); return; } // compte ou session disparus : le démarrage complet renvoie vers la connexion
    await Promise.all([
      loadMyPages({ force: true }),
      loadGodMode(viewAsActive() ? null : profil),
      loadMyPerms({ force: true }),
    ]);
    if (slug !== 'accueil' && !canAccess(slug)) { location.replace(`/pages/compte/accueil.html?refus=${encodeURIComponent(slug)}`); return; }
    if (auth === 'admin' && !(profil.is_admin || canPanel(getCachedPerms()))) { location.replace('/pages/compte/accueil.html'); return; }
    const apres = { profil: JSON.stringify(profil), pages: JSON.stringify(memoLire('pages') ?? null), perms: JSON.stringify(memoLire('perms') ?? null) };
    if (apres.profil !== avant.profil) { updateHeaderProfile(profil); updateNav(profil); }
    else if (apres.pages !== avant.pages || apres.perms !== avant.perms) updateNav(profil);
    demarrerRaccourcisStaff(profil); // un Staff nommé pendant la visite voit ses raccourcis sans recharger
  } catch (e) {
    console.warn('[mise à jour]', e?.message || e);
  }
}

/* ---------- Une tentative d'initialisation ---------- */

/**
 * Une tentative d'initialisation. Jette en cas d'échec réseau ; Error('redirect') si on quitte la page.
 * L'ordre compte : les réglages du site et le profil sont chargés en parallèle, mais le menu
 * n'est construit qu'une fois la liste des pages accessibles connue.
 * S'il y a une mémoire d'affichage fraîche pour ce compte, le démarrage n'attend pas la base (voir demarrerAvecMemoire).
 * @param {'member'|'admin'|'optional'} auth Niveau d'accès exigé par la page.
 * @returns {Promise<object|null>} Le profil connecté, ou null pour un visiteur.
 */
async function startPage(auth) {
  applyTheme();
  const uid = await compteCourant();
  memoCompte(uid); // mémoire propre à ce compte ; un autre compte ou un visiteur efface celle d'avant
  const garde = uid && !vueActive() ? lireMemoire(auth) : null;
  if (garde) return demarrerAvecMemoire(auth, garde);
  const siteP = loadSiteSettings(); // réglages du site (nom, menu, pied, textes) : ne lève jamais d'erreur
  const who = auth === 'member' ? requireMember() : auth === 'admin' ? requireAdmin() : getProfile();
  const profile = await withTimeout(who, PROFILE_TIMEOUT_MS);
  resolveViewAs(profile); // avant tout le reste : la vue change les pages, les menus et le mode sans limite
  await siteP;
  applySiteDom();
  const pagesP = profile ? loadMyPages() : null; // en parallèle du mode sans limite
  const godP = loadGodMode(viewAsActive() ? null : profile); // les pages lisent getGodMode() dès leur premier affichage ; coupé pendant une vue
  const permsP = profile ? loadMyPerms() : null; // droits sur le panel (Staff/admin) : une requête, en cache
  // En-tête tout de suite (compte, outils) ; les liens arrivent avec les pages accessibles
  renderHeader(profile, { nav: false });
  renderViewAsBar(); // bandeau « Tu vois le site comme… » (rien si la vue n'est pas active)
  await Promise.all([pagesP, godP, permsP]);
  const slug = currentPageSlug();
  // Page déclarée mais interdite -> accueil (jamais depuis l'accueil lui-même, pour éviter une boucle)
  if (pagesP && slug !== 'accueil' && !canAccess(slug)) {
    location.replace(`/pages/compte/accueil.html?refus=${encodeURIComponent(slug)}`);
    return new Promise(() => {}); // la page s'arrête là, sans erreur
  }
  updateNav(profile);
  return finir(profile);
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
  installLightDismiss(); // clic à côté d'une fenêtre = fermer (toutes les pages)
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
