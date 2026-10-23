/* Service worker du Humane Gang : mode hors ligne (coque du site et derniers contenus lus).
   - Pages (navigation) : réseau d'abord ; en cas d'échec, la copie en cache puis offline.html.
   - Fichiers du site (/assets/) : copie en cache servie tout de suite, mise à jour en arrière-plan
     (stale-while-revalidate) : une nouvelle version est utilisée dès le chargement suivant.
   - Bibliothèque jsDelivr épinglée (/npm/, version exacte x.y.z) : cache d'abord ; seules les réponses lisibles et réussies
     (pas les réponses « opaques », dont le statut est inconnu) sont gardées, sauf pour PRECACHE_REMOTE.
   - Pages : la copie en cache est rangée sous l'adresse sans paramètres (?code=, ?c=, ?u=…), pour ne garder ni code
     d'invitation ni identifiant dans le cache.
   - Supabase (données, authentification, fonctions) : jamais interceptée, jamais mise en cache.
     Seule exception (Q4, collection hors ligne) : les images PUBLIQUES des cartes (/storage/v1/object/public/hg-assets/cards/,
     sans jeton ni donnée privée) passent par un cache séparé « hg-cartes-img », servi en premier, plafonné à 400 images
     (les plus anciennes partent). Ce cache est rempli aussi par la page Cartes et effacé à la déconnexion.
   CACHE_VERSION : à incrémenter seulement si la liste PRECACHE ou la logique du service worker change. */

/* ---------- Constantes ---------- */

// Nom du cache : préfixe commun + version. Les caches des anciennes versions (même préfixe) sont supprimés à l'activation.
const CACHE_VERSION = 'v56';
const CACHE_PREFIX = 'hg-coque-';
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
// Q4 : images des cartes (même nom et même plafond que assets/js/offline-store.js). Hors du préfixe : gardé d'une version à l'autre.
const IMG_CACHE = 'hg-cartes-img';
const IMG_MAX = 400;
const CARD_IMG_PATH = '/storage/v1/object/public/hg-assets/cards/';

/* ---------- Liste de précache ----------
   Fichiers téléchargés à l'installation, pour que le site s'ouvre hors ligne. Chemins relatifs à la racine du site.
   Un fichier ajouté au site doit aussi être ajouté ici s'il doit marcher hors ligne. Ne pas modifier sans
   incrémenter CACHE_VERSION (voir l'en-tête). */
const PRECACHE = [
  'index.html', 'accueil.html', 'admin.html', 'aide.html', 'quiz.html', 'secret.html', 'assistance.html', 'cartes.html', 'compte.html',
  'evenements.html', 'historique.html', 'irl.html', 'legal.html', 'membre.html', 'messages.html',
  'recap.html', 'rejoindre.html', 'secret-santa.html', 'offline.html', 'assets/css/accueil.css',
  'assets/css/admin-access.css', 'assets/css/admin-accounts.css', 'assets/css/admin-bot.css',
  'assets/css/admin-cards.css', 'assets/css/admin-reglages.css', 'assets/css/admin-identite.css', 'assets/css/admin-events.css', 'assets/css/admin-ghosts.css',
  'assets/css/admin-messages.css', 'assets/css/admin-themes.css', 'assets/css/admin-tools.css',
  'assets/css/admin-staff.css', 'assets/css/admin-pilotage.css', 'assets/css/admin.css', 'assets/css/admin-sorties.css', 'assets/css/aide.css', 'assets/css/assistance.css', 'assets/css/base.css',
  'assets/css/cartes-card.css', 'assets/css/cartes-boosters.css', 'assets/css/cartes-showcase.css', 'assets/css/cartes-trades.css',
  'assets/css/cartes.css', 'assets/css/cartes-x5.css', 'assets/css/cartes-zoom.css', 'assets/css/cartes-pentakill.css', 'assets/js/cartes-pentakill.js', 'assets/css/compte.css', 'assets/css/evenements.css',
  'assets/css/historique.css', 'assets/css/intro.css', 'assets/css/irl-history.css',
  'assets/css/irl.css', 'assets/css/legal.css', 'assets/css/membre.css', 'assets/css/messages.css',
  'assets/css/photos.css', 'assets/css/recap.css', 'assets/css/rejoindre.css', 'assets/css/ui-confirm.css',
  'assets/css/secret-santa.css', 'assets/css/ss-pairs.css', 'assets/js/accueil.js', 'assets/js/admin-access.js',
  'assets/js/admin-accounts.js', 'assets/js/admin-badges-edit.js', 'assets/js/admin-bot.js',
  'assets/js/admin-cards.js', 'assets/js/admin-events.js', 'assets/js/admin-ghosts.js', 'assets/js/admin-godmode.js',
  'assets/js/admin-invite-links.js', 'assets/js/admin-messages.js',
  'assets/js/admin-ss-manual.js', 'assets/js/admin-themes.js', 'assets/js/admin.js',
  'assets/js/admin-cards/quests.js', 'assets/js/admin-cards/boosters.js', 'assets/js/admin-eggs.js', 'assets/js/admin-fil.js', 'assets/js/admin-champs.js', 'assets/js/core/site-etat.js', 'assets/css/admin-eggs.css', 'assets/css/admin-fil.css', 'assets/css/admin-champs.css', 'assets/css/site-etat.css', 'assets/js/admin-reglages/keys.js', 'assets/js/admin-reglages/view.js', 'assets/js/admin-reglages/keys-lot1.js', 'assets/js/admin-reglages/identite.js', 'assets/js/core/site-defaults.js', 'assets/js/core/site-load.js',
  'assets/js/admin-reglages/keys-lot3.js', 'assets/js/admin-reglages/lot3-ui.js', 'assets/js/reglages-valeurs-lot3.js',
  'assets/js/admin-accounts/activity.js', 'assets/js/admin-accounts/common.js', 'assets/js/admin-accounts/events.js', 'assets/js/admin-accounts/fiche.js',
  'assets/js/admin-accounts/inspect.js', 'assets/js/admin-accounts/list.js', 'assets/js/admin-accounts/profile.js', 'assets/js/admin-accounts/ss-pairs.js',
  'assets/js/admin-accounts/ss-shared.js', 'assets/js/admin-accounts/ss.js', 'assets/js/admin-accounts/state.js', 'assets/js/admin-cards/constants.js',
  'assets/js/admin-cards/bulk.js', 'assets/js/admin-cards/data.js', 'assets/js/admin-cards/economy.js', 'assets/js/admin-cards/editor.js', 'assets/js/admin-cards/helpers.js',
  'assets/js/admin-cards/list.js', 'assets/js/admin-cards/players.js', 'assets/js/admin-cards/sets.js', 'assets/js/admin-cards/state.js',
  'assets/js/admin-cards/stats.js', 'assets/js/admin-cards/trades.js', 'assets/js/admin-cards/view.js', 'assets/js/admin/badges.js',
  'assets/js/admin/badges-criteres.js', 'assets/js/admin-reglages/keys-lot4.js', // lot 4 (réglages)
  'assets/js/admin-reglages/keys-lot2.js', 'assets/js/admin-reglages/keys-lot5.js', 'assets/js/invite-config.js',
  'assets/js/admin/common.js', 'assets/js/admin/ideas.js', 'assets/js/admin/invites.js', 'assets/js/admin/loaders.js',
  'assets/js/admin/overview.js', 'assets/js/admin/perms.js', 'assets/js/admin/ss-events.js', 'assets/js/admin/ss-render.js', 'assets/js/admin/state.js',
  'assets/js/admin/support.js', 'assets/js/admin/live.js', 'assets/css/admin-live.css',
  'assets/js/admin/shell.js', 'assets/js/admin/router.js', 'assets/css/admin-shell.css',
  'assets/js/admin/palette.js', 'assets/css/admin-nav.css', 'assets/js/admin/list-tools.js',
  'assets/js/admin-sorties/data.js', 'assets/js/admin-sorties/dialogs.js', 'assets/js/admin-sorties/format.js', 'assets/js/admin-sorties/index.js',
  'assets/css/admin-souvenirs.css', 'assets/js/admin-souvenirs/helpers.js', 'assets/js/admin-souvenirs/index.js', 'assets/js/admin-souvenirs/moments.js',
  'assets/js/admin-souvenirs/photos.js', 'assets/js/admin-souvenirs/reactions.js',
  'assets/js/aide.js', 'assets/js/assistance.js',
  'assets/js/reglages-jetons.js', 'assets/js/quest-track.js', 'assets/js/tutos/index.js', 'assets/js/tutos/premiers-pas.js', 'assets/js/tutos/secret-santa.js',
  'assets/js/tutos/irl-historique.js', 'assets/js/tutos/cartes-base.js', 'assets/js/tutos/cartes-avance.js',
  'assets/js/tutos/communaute.js', 'assets/js/badge-levels.js', 'assets/js/cartes-showcase.js',
  'assets/js/cartes-trades.js', 'assets/js/cartes-ui.js', 'assets/js/cartes.js', 'assets/js/cartes-zoom.js', 'assets/js/cartes-place.js',
  'assets/js/compte.js', 'assets/js/config.js', 'assets/js/core.js',
  'assets/js/core/badges.js', 'assets/js/core/effects.js', 'assets/js/core/footer.js',
  'assets/js/core/functions.js', 'assets/js/core/godmode.js', 'assets/js/core/header.js',
  'assets/js/core/icons.js', 'assets/js/core/init.js', 'assets/js/core/pages-access.js',
  'assets/js/core/prefs-state.js', 'assets/js/core/prefs.js', 'assets/js/core/profile.js',
  'assets/js/core/perms.js', 'assets/js/core/search.js',
  'assets/js/core/supabase.js', 'assets/js/core/theme-calc.js', 'assets/js/core/theme-load.js',
  'assets/js/core/theme.js', 'assets/js/core/ui.js', 'assets/js/core/unread.js',
  'assets/js/core/util.js', 'assets/js/dyn-events.js', 'assets/js/card-drops.js', 'assets/css/card-drops.css', 'assets/js/admin-cards/drops.js',
  'assets/js/evenements.js', 'assets/js/historique.js', 'assets/js/intro-logo.js',
  'assets/js/intro-daily.js', 'assets/js/intro-redirect.js', 'assets/js/intro.js', 'assets/js/irl-history.js',
  'assets/js/irl.js', 'assets/js/eco-quota.js', 'assets/js/legal.js', 'assets/js/membre.js', 'assets/js/messages.js',
  'assets/js/paillettes.js', 'assets/js/photos.js', 'assets/js/profile-fields.js',
  'assets/js/recap.js', 'assets/js/rejoindre.js', 'assets/js/secret-santa.js',
  'assets/js/site-boot.js', 'assets/js/sound.js', 'assets/js/ss-card.js', 'assets/js/ss-pairs.js',
  'assets/js/theme-boot.js', 'assets/js/icons.js', 'assets/js/ui-confirm.js', 'assets/js/utils.js', 'assets/img/logo-1600.webp', 'assets/img/favicon-64.png',
  'assets/js/quiz.js', 'assets/js/secret.js', 'assets/js/admin-quiz.js', 'assets/js/admin-quiz-stats.js',
  'assets/js/eggs/api.js', 'assets/js/eggs/core.js', 'assets/js/eggs/lettres.js', 'assets/js/eggs/pages.js', 'assets/js/eggs/jeu404.js',
  'assets/css/quiz.css', 'assets/css/admin-quiz.css', 'assets/css/admin-quiz-stats.css', 'assets/css/eggs.css', 'assets/css/eggs-pages.css',
  'assets/js/admin-challenges.js', 'assets/js/admin-log.js', 'assets/js/admin-staff.js', 'assets/js/ics.js', 'assets/js/image-compress.js', 'assets/js/push.js', 'assets/js/reactions.js',
  'assets/css/admin-ui.css', 'assets/js/admin/ui/common.js', 'assets/js/admin/ui/time.js', 'assets/js/admin/ui/list.js', 'assets/js/admin/ui/drawer.js',
  'assets/js/admin/ui/thread.js', 'assets/js/admin/ui/info-panel.js', 'assets/js/admin/ui/detail-header.js',
  // Nouvelles pages et modules (23/10 : Jeux, citations, playlist, visite guidée, hors ligne)
  'jeux.html', 'citations.html', 'playlist.html',
  'assets/js/jeux.js', 'assets/js/jeux/onglets.js', 'assets/js/jeux/commun.js', 'assets/css/jeux.css',
  'assets/js/citations.js', 'assets/css/citations.css', 'assets/js/playlist.js', 'assets/css/playlist.css',
  'assets/js/contenus-ui.js', 'assets/css/contenus.css', 'assets/js/core/tour.js', 'assets/css/tour.css',
  'assets/js/offline-store.js', 'assets/css/offline.css', 'assets/js/quest-proofs.js', 'assets/css/quest-proofs.css',
  'assets/js/leaflet-load.js',
  'assets/img/icon-192.png', 'assets/img/icon-512.png', 'assets/img/apple-touch-icon.png',
  'assets/img/og-image.png', 'manifest.webmanifest',
  'assets/cards/champions/baton.svg', 'assets/cards/champions/bouclier.svg', 'assets/cards/champions/chateau.svg', 'assets/cards/champions/couronne.svg', 'assets/cards/champions/epee.svg', 'assets/cards/champions/etoile.svg', 'assets/cards/champions/fusee.svg', 'assets/cards/champions/pioche.svg', 'assets/css/boosters-styles.css', 'assets/css/cartes-idees.css', 'assets/css/collection-a4.css', 'assets/js/admin-cards/champions.js', 'assets/js/admin-cards/pots.js', 'assets/js/booster-styles.js', 'assets/js/booster-themes.js', 'assets/js/cartes-bulletin.js', 'assets/js/cartes-cagnotte.js', 'assets/js/cartes-champion.js', 'assets/js/cartes-chance.js', 'assets/js/collection-a4.js', 'collection-a4.html',
  // Lot 3 (23/10) : calendrier, ciné-club, saisons, social, raccourcis, notifications
  'assets/cards/le-gang-joue/01-torii.svg', 'assets/cards/le-gang-joue/02-usine-a-fer.svg', 'assets/cards/le-gang-joue/03-base-du-gang.svg', 'assets/cards/le-gang-joue/04-coffre-des-trouvailles.svg', 'assets/cards/le-gang-joue/05-la-merveille.svg', 'assets/cards/le-gang-joue/06-moine-qui-convertit.svg', 'assets/cards/le-gang-joue/07-trebuchet.svg', 'assets/cards/le-gang-joue/08-villageois-oisif.svg', 'assets/cards/le-gang-joue/09-le-nexus.svg', 'assets/cards/le-gang-joue/10-tour-du-milieu.svg', 'assets/cards/le-gang-joue/11-pickem-du-gang.svg', 'assets/cards/le-gang-joue/12-balise-de-vision.svg', 'assets/cards/le-gang-joue/13-le-bateau.svg', 'assets/cards/le-gang-joue/14-le-coffre-maudit.svg', 'assets/cards/le-gang-joue/15-la-carte-au-tresor.svg', 'assets/cards/le-gang-joue/16-le-seau-d-eau.svg', 'assets/cards/le-gang-joue/17-la-planete-a-industrialiser.svg', 'assets/cards/le-gang-joue/18-le-convoyeur-sans-fin.svg', 'assets/cards/le-gang-joue/19-l-usine-repartie.svg', 'assets/cards/le-gang-joue/20-la-foreuse-geante.svg', 'assets/cards/le-gang-joue/21-le-bouton-d-urgence.svg', 'assets/cards/le-gang-joue/22-la-bouche-d-aeration.svg', 'assets/cards/le-gang-joue/23-la-grille-de-mots.svg', 'assets/cards/le-gang-joue/24-le-dessin-incomprehensible.svg', 'assets/css/admin-eco.css', 'assets/css/admin-errors.css', 'assets/css/admin-vd.css', 'assets/css/calendrier.css', 'assets/css/cartes-saisons.css', 'assets/css/cine.css', 'assets/css/jeux-arcade.css', 'assets/css/report.css', 'assets/css/saisons.css', 'assets/css/social.css', 'assets/js/accueil-ce-jour.js', 'assets/js/admin-archive.js', 'assets/js/admin-cards/auctions.js', 'assets/js/admin-cards/boosters-saison.js', 'assets/js/admin-cards/codes.js', 'assets/js/admin-cards/proposals.js', 'assets/js/admin-cards/recipes.js', 'assets/js/admin-errors.js', 'assets/js/admin-saisons.js', 'assets/js/admin-social.js', 'assets/js/admin-sorties/carte.js', 'assets/js/admin-souvenirs/contenu.js', 'assets/js/admin-souvenirs/moment-card.js', 'assets/js/admin-vd.js', 'assets/js/admin/eco-health.js', 'assets/js/admin/reports.js', 'assets/js/anniv.js', 'assets/js/avent.js', 'assets/js/blason.js', 'assets/js/calendrier.js', 'assets/js/cartes-atelier.js', 'assets/js/cartes-codes.js', 'assets/js/cartes-enchere.js', 'assets/js/enchere-regles.js', 'assets/js/cartes-gen.js', 'assets/js/cartes-lots.js', 'assets/js/cartes-jeux.js', 'assets/js/cartes-propositions.js', 'assets/js/cartes-saisons.js', 'assets/js/cartes-tableau.js', 'assets/js/cine.js', 'assets/js/compte-social.js', 'assets/js/core/shortcuts.js', 'assets/js/eggs/arcade.js', 'assets/js/eggs/jeu-domu.js', 'assets/js/eggs/jeu-paillettes.js', 'assets/js/eggs/jeu-raclette.js', 'assets/js/error-report.js', 'assets/js/friendship.js', 'assets/js/home-blocks.js', 'assets/js/home-edit.js', 'assets/js/home-mentor.js', 'assets/js/home-registry.js', 'assets/js/irl-carte.js', 'assets/js/jeux/arcade.js', 'assets/js/mercis.js', 'assets/js/messages-groupes.js', 'assets/js/notif-prefs.js', 'assets/js/polls.js', 'assets/js/profil-gaming.js', 'assets/js/report.js', 'assets/js/saisons-css.js', 'assets/js/saisons.js', 'assets/js/skills.js', 'assets/js/social.js', 'assets/js/ss-unwrap.js', 'assets/js/support-files.js', 'calendrier.html', 'cine.html', 
];

// Bibliothèque versionnée (épinglée) : mise en cache si le réseau le permet, sans bloquer l'installation.
const PRECACHE_REMOTE = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm',
];

/* ---------- Cycle de vie : installation et activation ---------- */

/** Installation : remplit le cache avec la liste PRECACHE puis prend la main sans attendre la fermeture des onglets. */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Un fichier absent ne doit pas faire échouer toute l'installation.
    await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
    await Promise.allSettled(PRECACHE_REMOTE.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

/** Activation : supprime les anciens caches du site (même préfixe, autre version) puis contrôle les onglets ouverts. */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/* ---------- Interception des requêtes (fetch) ----------
   Choisit la stratégie selon le type de requête. Une requête sans stratégie passe directement au réseau. */

/** Gestionnaire fetch : classe chaque requête GET et choisit la stratégie de cache correspondante. */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Images publiques des cartes (Q4) : cache séparé, servi en premier (le nom de fichier change à chaque nouvelle image).
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith(CARD_IMG_PATH) && !url.search) {
    event.respondWith(cardImage(req, event));
    return;
  }
  // Données et authentification : toujours en direct.
  if (url.hostname.endsWith('.supabase.co')) return;

  const sameOrigin = url.origin === self.location.origin;

  if (req.mode === 'navigate' && sameOrigin) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Code (JS, CSS) : toujours la version en ligne quand le réseau répond, pour que la page et ses modules
  // restent de la même version après une mise à jour ; le cache ne sert qu'hors ligne.
  if (sameOrigin && url.pathname.includes('/assets/') && /\.(m?js|css|json)$/.test(url.pathname)) { event.respondWith(networkFirst(req, true)); return; }
  // Images, polices, sons : le cache d'abord, rafraîchi en arrière-plan.
  if (sameOrigin && url.pathname.includes('/assets/')) { event.respondWith(staleWhileRevalidate(req, event)); return; }
  if (isPinnedLibrary(url)) event.respondWith(cacheFirst(req));
});

/* ---------- Stratégies de cache ---------- */

/**
 * Fichier jsDelivr d'une version exacte (ex. /npm/@supabase/auth-js@2.65.0/+esm) : son contenu ne change pas.
 * Une adresse sans version exacte (plage, « latest », /gh/…) n'est jamais mise en cache.
 * @param {URL} url Adresse demandée.
 * @returns {boolean}
 */
function isPinnedLibrary(url) {
  return url.origin === 'https://cdn.jsdelivr.net' && /^\/npm\/(@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+\//.test(url.pathname);
}

/**
 * Clé de cache d'une page : l'adresse sans paramètres ni fragment. Les paramètres (code d'invitation, conversation,
 * membre…) ne sont donc jamais conservés dans le cache, et hors ligne la copie de la page sert pour toute variante.
 * @param {Request} req Requête de navigation.
 * @returns {string}
 */
function pageKey(req) {
  const u = new URL(req.url);
  return u.origin + u.pathname;
}

/**
 * Réseau d'abord : essaie le réseau et garde une copie. Hors ligne, sert la copie en cache, sinon offline.html.
 * @param {Request} req Requête à traiter.
 * @param {boolean} [revalidate] Si vrai, demande au serveur de vérifier la version (évite le cache HTTP du navigateur).
 * @returns {Promise<Response>} La réponse réseau, la copie en cache, ou une erreur réseau.
 */
async function networkFirst(req, revalidate = false) {
  const cache = await caches.open(CACHE);
  // Navigation : rangée sous l'adresse sans paramètres (voir pageKey).
  const key = req.mode === 'navigate' ? pageKey(req) : req;
  try {
    // revalidate : demande au serveur si le fichier a changé (réponse 304 légère sinon), sans se fier au cache HTTP.
    const res = await fetch(req, revalidate ? { cache: 'no-cache' } : undefined);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(key)) || (await cache.match('offline.html')) || Response.error();
  }
}

/**
 * Cache d'abord : sert la copie en cache si elle existe, sinon va sur le réseau et garde la réponse.
 * Sert à la bibliothèque jsDelivr épinglée, dont la version ne change jamais.
 * @param {Request} req Requête à traiter.
 * @returns {Promise<Response>} La copie en cache ou la réponse réseau.
 */
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Réponse opaque (statut inconnu, peut-être une erreur) : gardée seulement pour la liste PRECACHE_REMOTE.
  if (res.ok || (res.type === 'opaque' && PRECACHE_REMOTE.includes(req.url))) cache.put(req, res.clone());
  return res;
}

/**
 * Périmé puis mis à jour : sert tout de suite la copie en cache (si elle existe) et met à jour le cache en arrière-plan.
 * Sans copie, attend le réseau.
 * @param {Request} req Requête à traiter.
 * @param {FetchEvent} event Événement fetch, pour prolonger le travail d'arrière-plan (waitUntil).
 * @returns {Promise<Response>} La copie en cache, ou la réponse réseau.
 */
async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const update = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  if (hit) { event.waitUntil(update); return hit; }
  return (await update) || Response.error();
}

/**
 * Image de carte (Q4) : la copie du cache hg-cartes-img si elle existe ; sinon le réseau en mode CORS (réponse lisible,
 * pas de réponse opaque), gardée dans le cache, plafonné à IMG_MAX images (les plus anciennes sont retirées).
 * @param {Request} req Requête de l'image.
 * @param {FetchEvent} event Événement fetch (le rangement du cache se poursuit après la réponse).
 * @returns {Promise<Response>}
 */
async function cardImage(req, event) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) {
      event.waitUntil((async () => {
        await cache.put(req.url, res.clone());
        const keys = await cache.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - IMG_MAX))) await cache.delete(k);
      })());
    }
    return res;
  } catch (e) {
    return fetch(req); // repli : la requête d'origine (échoue aussi hors ligne, comme avant)
  }
}

/* ---------- Notifications push (F9) ----------
   Le serveur envoie « Nouveau message » + nom de la conversation (jamais le contenu, jamais l'expéditeur
   d'un Secret Santa). Un clic ouvre la messagerie sur la conversation concernée. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = String(data.title || 'Humane Gang').slice(0, 80);
  const options = {
    body: String(data.body || '').slice(0, 120),
    tag: String(data.tag || 'hg-message').slice(0, 120),
    icon: new URL('assets/img/icon-192.png', self.registration.scope).href,
    data: { conversation_id: data.conversation_id || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* Clic sur la notification : ouvre la messagerie sur la conversation, dans un onglet déjà ouvert si possible. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const conv = event.notification.data?.conversation_id;
  const target = new URL('messages.html', self.registration.scope);
  if (conv && /^[0-9a-f-]{36}$/i.test(conv)) target.searchParams.set('c', conv);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) {
      if ('navigate' in win) await win.navigate(target.href).catch(() => {});
      return win.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
