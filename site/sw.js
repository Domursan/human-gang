/* Service worker du Humane Gang : mode hors ligne (coque du site et derniers contenus lus).
   - Pages (navigation) : réseau d'abord ; en cas d'échec, la copie en cache puis /offline.html.
   - Fichiers du site (/assets/) : copie en cache servie tout de suite, mise à jour en arrière-plan
     (stale-while-revalidate) : une nouvelle version est utilisée dès le chargement suivant.
   - Bibliothèque jsDelivr épinglée (/npm/, version exacte x.y.z) : cache d'abord ; seules les réponses lisibles et réussies
     (pas les réponses « opaques », dont le statut est inconnu) sont gardées, sauf pour PRECACHE_REMOTE.
   - Pages : la copie en cache est rangée sous l'adresse sans paramètres (?code=, ?c=, ?u=…), pour ne garder ni code
     d'invitation ni identifiant dans le cache.
   - Supabase (données, authentification, fonctions) : jamais interceptée, jamais mise en cache.
     Seule exception (Q4, collection hors ligne) : les images PUBLIQUES des cartes (/storage/v1/object/public/hg-assets/cards/,
     sans jeton ni donnée privée) passent par un cache séparé « hg-cartes-img », servi en premier, plafonné à 1 500 images
     (les plus anciennes partent). Ce cache est rempli aussi par la page Cartes et effacé à la déconnexion.
     Les illustrations des cartes servies par le site (/assets/cartes/) suivent la même stratégie, dans le même cache.
   CACHE_VERSION : à incrémenter seulement si la liste PRECACHE ou la logique du service worker change. */

/* ---------- Constantes ---------- */

// Nom du cache : préfixe commun + version. Les caches des anciennes versions (même préfixe) sont supprimés à l'activation.
const CACHE_VERSION = 'v123';
const CACHE_PREFIX = 'hg-coque-';
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
// Q4 : images des cartes (même nom et même plafond que assets/commun/offline-store.js). Hors du préfixe : gardé d'une version à l'autre.
const IMG_CACHE = 'hg-cartes-img';
const IMG_MAX = 1500;
const CARD_IMG_PATH = '/storage/v1/object/public/hg-assets/cards/';
// Illustrations des cartes rangées dans le site (même cache IMG_CACHE que ci-dessus).
const LOCAL_CARD_PATH = '/assets/cartes/';

/* ---------- Liste de précache ----------
   Fichiers téléchargés à l'installation, pour que le site s'ouvre hors ligne. Chemins relatifs à la racine du site.
   Un fichier ajouté au site doit aussi être ajouté ici s'il doit marcher hors ligne. Ne pas modifier sans
   incrémenter CACHE_VERSION (voir l'en-tête). */
const PRECACHE = [
  '/index.html', '/pages/compte/accueil.html', '/pages/admin/admin.html', '/pages/infos/aide.html', '/pages/jeux/quiz.html', '/pages/jeux/secret.html', '/pages/infos/assistance.html', '/pages/cartes/cartes.html', '/pages/compte/compte.html',
  '/pages/irl/evenements.html', '/pages/irl/historique.html', '/pages/irl/irl.html', '/pages/infos/legal.html', '/pages/compte/membre.html', '/pages/compte/messages.html',
  '/pages/irl/recap.html', '/pages/infos/rejoindre.html', '/pages/irl/secret-santa.html', '/offline.html', '/assets/espaces/accueil/accueil.css',
  '/assets/espaces/admin/admin-access.css', '/assets/espaces/admin/admin-accounts.css', '/assets/espaces/admin/admin-bot.css',
  '/assets/espaces/admin/admin-cards.css', '/assets/espaces/admin/admin-reglages.css', '/assets/espaces/admin/admin-identite.css', '/assets/espaces/admin/admin-events.css', '/assets/espaces/admin/admin-ghosts.css',
  '/assets/espaces/admin/admin-messages.css', '/assets/espaces/admin/admin-themes.css', '/assets/espaces/admin/admin-tools.css',
  '/assets/espaces/admin/admin-staff.css', '/assets/espaces/admin/admin-pilotage.css', '/assets/espaces/admin/admin.css', '/assets/espaces/admin/admin-sorties.css', '/assets/espaces/infos/aide.css', '/assets/espaces/infos/assistance.css', '/assets/commun/base.css', '/assets/commun/themes-decor.css', '/assets/commun/fromage/coulure.svg', '/assets/commun/fromage/coulure-vert.svg',
  '/assets/espaces/cartes/cartes-card.css', '/assets/espaces/cartes/cartes-boosters.css', '/assets/espaces/cartes/cartes-showcase.css', '/assets/espaces/cartes/cartes-trades.css',
  '/assets/espaces/cartes/cartes.css', '/assets/espaces/cartes/cartes-x5.css', '/assets/espaces/cartes/cartes-zoom.css', '/assets/espaces/cartes/cartes-pentakill.css', '/assets/espaces/cartes/cartes-pentakill.js', '/assets/espaces/compte/compte.css', '/assets/espaces/irl/evenements.css',
  '/assets/espaces/irl/historique.css', '/assets/espaces/accueil/intro.css', '/assets/espaces/irl/irl-history.css',
  '/assets/espaces/irl/irl.css', '/assets/espaces/infos/legal.css', '/assets/espaces/compte/membre.css', '/assets/espaces/messages/messages.css',
  '/assets/espaces/irl/photos.css', '/assets/espaces/irl/recap.css', '/assets/espaces/infos/rejoindre.css', '/assets/commun/ui-confirm.css',
  '/assets/espaces/irl/secret-santa.css', '/assets/espaces/irl/ss-pairs.css', '/assets/espaces/accueil/accueil.js', '/assets/espaces/admin/admin-access.js',
  '/assets/espaces/admin/admin-accounts.js', '/assets/espaces/admin/admin-badges-edit.js', '/assets/espaces/admin/admin-bot.js',
  '/assets/espaces/admin/admin-cards.js', '/assets/espaces/admin/admin-events.js', '/assets/espaces/admin/admin-ghosts.js', '/assets/espaces/admin/admin-godmode.js',
  '/assets/espaces/admin/admin-invite-links.js', '/assets/espaces/admin/admin-messages.js',
  '/assets/espaces/admin/admin-ss-manual.js', '/assets/espaces/admin/admin-themes.js', '/assets/espaces/admin/admin.js',
  '/assets/espaces/admin/cartes/quests.js', '/assets/espaces/admin/cartes/boosters.js', '/assets/espaces/admin/admin-eggs.js', '/assets/espaces/admin/admin-loup-garou.js', '/assets/espaces/admin/admin-fil.js', '/assets/espaces/admin/admin-champs.js', '/assets/commun/core/site-etat.js', '/assets/espaces/admin/admin-eggs.css', '/assets/espaces/admin/admin-loup-garou.css', '/assets/espaces/admin/admin-fil.css', '/assets/espaces/admin/admin-champs.css', '/assets/commun/site-etat.css', '/assets/espaces/admin/reglages/keys.js', '/assets/espaces/admin/reglages/view.js', '/assets/espaces/admin/reglages/keys-lot1.js', '/assets/espaces/admin/reglages/identite.js', '/assets/commun/core/site-defaults.js', '/assets/commun/core/site-load.js',
  '/assets/espaces/admin/reglages/keys-lot3.js', '/assets/espaces/admin/reglages/lot3-ui.js', '/assets/espaces/admin/reglages-valeurs-lot3.js',
  '/assets/espaces/admin/comptes/activity.js', '/assets/espaces/admin/comptes/common.js', '/assets/espaces/admin/comptes/events.js', '/assets/espaces/admin/comptes/fiche.js',
  '/assets/espaces/admin/comptes/inspect.js', '/assets/espaces/admin/comptes/list.js', '/assets/espaces/admin/comptes/profile.js', '/assets/espaces/admin/comptes/ss-pairs.js',
  '/assets/espaces/admin/comptes/ss-shared.js', '/assets/espaces/admin/comptes/ss.js', '/assets/espaces/admin/comptes/state.js', '/assets/espaces/admin/cartes/constants.js',
  '/assets/espaces/admin/cartes/bulk.js', '/assets/espaces/admin/cartes/data.js', '/assets/espaces/admin/cartes/economy.js', '/assets/espaces/admin/cartes/editor.js', '/assets/espaces/admin/cartes/helpers.js',
  '/assets/espaces/admin/cartes/list.js', '/assets/espaces/admin/cartes/players.js', '/assets/espaces/admin/cartes/sets.js', '/assets/espaces/admin/cartes/state.js',
  '/assets/espaces/admin/cartes/stats.js', '/assets/espaces/admin/cartes/trades.js', '/assets/espaces/admin/cartes/view.js', '/assets/espaces/admin/badges.js',
  '/assets/espaces/admin/badges-criteres.js', '/assets/espaces/admin/reglages/keys-lot4.js', // lot 4 (réglages)
  '/assets/espaces/admin/reglages/keys-lot2.js', '/assets/espaces/admin/reglages/keys-lot5.js', '/assets/espaces/compte/invite-config.js',
  '/assets/espaces/admin/common.js', '/assets/espaces/admin/ideas.js', '/assets/espaces/admin/invites.js', '/assets/espaces/admin/loaders.js',
  '/assets/espaces/admin/counts.js', '/assets/espaces/admin/lieux.js', '/assets/espaces/admin/todos.js', '/assets/espaces/admin/quick.js', '/assets/espaces/admin/admin-quick.css', '/assets/espaces/admin/visual-pick.js', '/assets/espaces/admin/reglages-merge.js', '/assets/espaces/admin/puissances.js', '/assets/espaces/admin/admin-visual-pick.css', '/assets/espaces/admin/panel-icons.js', '/assets/espaces/admin/perms.js', '/assets/espaces/admin/ss-events.js', '/assets/espaces/admin/ss-render.js', '/assets/espaces/admin/state.js',
  '/assets/espaces/admin/support.js', '/assets/espaces/admin/live.js', '/assets/espaces/admin/admin-live.css',
  '/assets/espaces/admin/shell.js', '/assets/espaces/admin/router.js', '/assets/espaces/admin/admin-shell.css',
  '/assets/espaces/admin/palette.js', '/assets/espaces/admin/admin-nav.css', '/assets/espaces/admin/admin-lieux.css', '/assets/espaces/admin/list-tools.js',
  '/assets/espaces/admin/sorties/data.js', '/assets/espaces/admin/sorties/dialogs.js', '/assets/espaces/admin/sorties/format.js', '/assets/espaces/admin/sorties/index.js',
  '/assets/espaces/admin/admin-souvenirs.css', '/assets/espaces/admin/souvenirs/helpers.js', '/assets/espaces/admin/souvenirs/index.js', '/assets/espaces/admin/souvenirs/moments.js',
  '/assets/espaces/admin/souvenirs/photos.js', '/assets/espaces/admin/souvenirs/reactions.js',
  '/assets/espaces/infos/aide.js', '/assets/espaces/infos/assistance.js',
  '/assets/espaces/admin/reglages-jetons.js', '/assets/commun/quest-track.js', '/assets/espaces/infos/tutos/index.js', '/assets/espaces/infos/tutos/premiers-pas.js', '/assets/espaces/infos/tutos/secret-santa.js',
  '/assets/espaces/infos/tutos/irl-historique.js', '/assets/espaces/infos/tutos/cartes-base.js', '/assets/espaces/infos/tutos/cartes-avance.js',
  '/assets/espaces/infos/tutos/communaute.js', '/assets/espaces/compte/badge-levels.js', '/assets/espaces/cartes/cartes-showcase.js',
  '/assets/espaces/cartes/cartes-trades.js', '/assets/espaces/cartes/cartes-ui.js', '/assets/espaces/cartes/cartes.js', '/assets/espaces/cartes/cartes-zoom.js', '/assets/espaces/cartes/cartes-place.js',
  '/assets/espaces/compte/compte.js', '/assets/commun/config.js', '/assets/commun/core.js',
  '/assets/commun/core/badges.js', '/assets/commun/core/effects.js', '/assets/commun/core/footer.js',
  '/assets/commun/core/functions.js', '/assets/commun/core/godmode.js', '/assets/commun/core/header.js', '/assets/commun/core/menu-def.js', '/assets/commun/core/view-as.js',
  '/assets/commun/core/icons.js', '/assets/commun/core/init.js', '/assets/commun/core/light-dismiss.js', '/assets/commun/core/admin-reponses.js', '/assets/commun/core/pages-access.js',
  '/assets/commun/core/prefs-state.js', '/assets/commun/core/prefs.js', '/assets/commun/core/profile.js',
  '/assets/commun/core/perms.js', '/assets/commun/core/memoire.js', '/assets/commun/core/search.js',
  '/assets/commun/core/supabase.js', '/assets/commun/core/theme-calc.js', '/assets/commun/core/theme-load.js',
  '/assets/commun/core/theme.js', '/assets/commun/core/ui.js', '/assets/commun/core/unread.js',
  '/assets/commun/core/util.js', '/assets/commun/dyn-events.js', '/assets/espaces/cartes/card-drops.js', '/assets/espaces/cartes/card-drops.css', '/assets/espaces/admin/cartes/drops.js',
  '/assets/espaces/irl/evenements.js', '/assets/espaces/irl/historique.js', '/assets/espaces/accueil/intro-logo.js',
  '/assets/espaces/accueil/intro-daily.js', '/assets/espaces/accueil/intro-redirect.js', '/assets/espaces/accueil/intro.js', '/assets/espaces/irl/irl-history.js',
  '/assets/espaces/irl/irl.js', '/assets/commun/eco-quota.js', '/assets/espaces/infos/legal.js', '/assets/espaces/compte/membre.js', '/assets/espaces/messages/messages.js',
  '/assets/commun/paillettes.js', '/assets/espaces/irl/photos.js', '/assets/espaces/compte/profile-fields.js',
  '/assets/espaces/irl/recap.js', '/assets/espaces/infos/rejoindre.js', '/assets/espaces/irl/secret-santa.js',
  '/assets/commun/site-boot.js', '/assets/commun/sound.js', '/assets/espaces/irl/ss-card.js', '/assets/espaces/irl/ss-pairs.js',
  '/assets/commun/theme-boot.js', '/assets/commun/icons.js', '/assets/commun/ui-confirm.js', '/assets/commun/utils.js', '/assets/images/marque/logo-1600.webp', '/assets/images/marque/logo-96.webp', '/assets/images/marque/logo-192.webp', '/assets/commun/core/godmode-dialog.js', '/assets/commun/core/recherche-lien.js', '/assets/commun/core/tour-etat.js', '/assets/espaces/accueil/avent-date.js', '/assets/images/marque/favicon-64.png',
  '/assets/espaces/quiz/quiz.js', '/assets/espaces/arcade/secret.js', '/assets/espaces/admin/admin-quiz.js', '/assets/espaces/admin/admin-quiz-stats.js',
  '/assets/espaces/arcade/api.js', '/assets/espaces/arcade/core.js', '/assets/espaces/arcade/lettres.js', '/assets/espaces/arcade/creeper.js', '/assets/espaces/arcade/champignon.js', '/assets/espaces/arcade/pages.js', '/assets/espaces/arcade/jeu404.js',
  '/assets/espaces/quiz/quiz.css', '/assets/espaces/admin/admin-quiz.css', '/assets/espaces/admin/admin-quiz-stats.css', '/assets/espaces/arcade/eggs.css', '/assets/espaces/arcade/eggs-pages.css', '/assets/espaces/arcade/eggs-f.css',
  '/assets/espaces/admin/admin-challenges.js', '/assets/espaces/admin/admin-log.js', '/assets/espaces/admin/admin-staff.js', '/assets/espaces/irl/ics.js', '/assets/commun/image-compress.js', '/assets/commun/push.js', '/assets/commun/reactions.js',
  '/assets/espaces/admin/admin-ui.css', '/assets/espaces/admin/ui/common.js', '/assets/espaces/admin/ui/time.js', '/assets/espaces/admin/ui/list.js', '/assets/espaces/admin/ui/drawer.js',
  '/assets/espaces/admin/ui/thread.js', '/assets/espaces/admin/ui/info-panel.js', '/assets/espaces/admin/ui/detail-header.js', '/assets/espaces/admin/ui/fold.js',
  // Nouvelles pages et modules (23/10 : Jeux, citations, playlist, visite guidée, hors ligne)
  '/pages/jeux/jeux.html', '/pages/irl/citations.html', '/pages/irl/playlist.html',
  '/assets/espaces/jeux/jeux.js', '/assets/espaces/jeux/onglets.js', '/assets/espaces/jeux/commun.js', '/assets/espaces/jeux/jeux.css',
  '/assets/espaces/irl/citations.js', '/assets/espaces/irl/citations.css', '/assets/espaces/irl/playlist.js', '/assets/espaces/irl/playlist.css',
  '/assets/espaces/irl/contenus-ui.js', '/assets/espaces/irl/contenus.css', '/assets/commun/core/tour.js', '/assets/commun/tour.css',
  '/assets/commun/offline-store.js', '/assets/commun/offline.css', '/assets/espaces/accueil/quest-proofs.js', '/assets/espaces/accueil/quest-proofs.css',
  '/assets/commun/leaflet-load.js',
  // Bibliothèques servies localement (/assets/vendor, voir son README.md)
  '/assets/vendor/supabase-js-2.45.4.js', '/assets/vendor/supabase-js-2.45.4.mjs', '/assets/vendor/qrcode-generator-1.4.4.mjs',
  '/assets/images/marque/icon-192.png', '/assets/images/marque/icon-512.png', '/assets/images/marque/apple-touch-icon.png',
  '/assets/images/marque/og-image.png', '/manifest.webmanifest', '/assets/images/marque/logo-512.webp',
  '/assets/cartes/champions/baton.svg', '/assets/cartes/champions/bouclier.svg', '/assets/cartes/champions/chateau.svg', '/assets/cartes/champions/couronne.svg', '/assets/cartes/champions/epee.svg', '/assets/cartes/champions/etoile.svg', '/assets/cartes/champions/fusee.svg', '/assets/cartes/champions/pioche.svg', '/assets/espaces/cartes/boosters-styles.css', '/assets/espaces/cartes/cartes-idees.css', '/assets/espaces/cartes/collection-a4.css', '/assets/espaces/admin/cartes/champions.js', '/assets/espaces/admin/cartes/pots.js', '/assets/espaces/cartes/booster-styles.js', '/assets/espaces/cartes/booster-themes.js', '/assets/espaces/cartes/cartes-bulletin.js', '/assets/espaces/cartes/cartes-cagnotte.js', '/assets/espaces/cartes/cartes-champion.js', '/assets/espaces/cartes/cartes-chance.js', '/assets/espaces/cartes/collection-a4.js', '/pages/cartes/collection-a4.html',
  // Lot 3 (23/10) : calendrier, ciné-club, saisons, social, raccourcis, notifications
  '/assets/cartes/le-gang-joue/01-torii.svg', '/assets/cartes/le-gang-joue/02-usine-a-fer.svg', '/assets/cartes/le-gang-joue/03-base-du-gang.svg', '/assets/cartes/le-gang-joue/04-coffre-des-trouvailles.svg', '/assets/cartes/le-gang-joue/05-la-merveille.svg', '/assets/cartes/le-gang-joue/06-moine-qui-convertit.svg', '/assets/cartes/le-gang-joue/07-trebuchet.svg', '/assets/cartes/le-gang-joue/08-villageois-oisif.svg', '/assets/cartes/le-gang-joue/09-le-nexus.svg', '/assets/cartes/le-gang-joue/10-tour-du-milieu.svg', '/assets/cartes/le-gang-joue/11-pickem-du-gang.svg', '/assets/cartes/le-gang-joue/12-balise-de-vision.svg', '/assets/cartes/le-gang-joue/13-le-bateau.svg', '/assets/cartes/le-gang-joue/14-le-coffre-maudit.svg', '/assets/cartes/le-gang-joue/15-la-carte-au-tresor.svg', '/assets/cartes/le-gang-joue/16-le-seau-d-eau.svg', '/assets/cartes/le-gang-joue/17-la-planete-a-industrialiser.svg', '/assets/cartes/le-gang-joue/18-le-convoyeur-sans-fin.svg', '/assets/cartes/le-gang-joue/19-l-usine-repartie.svg', '/assets/cartes/le-gang-joue/20-la-foreuse-geante.svg', '/assets/cartes/le-gang-joue/21-le-bouton-d-urgence.svg', '/assets/cartes/le-gang-joue/22-la-bouche-d-aeration.svg', '/assets/cartes/le-gang-joue/23-la-grille-de-mots.svg', '/assets/cartes/le-gang-joue/24-le-dessin-incomprehensible.svg', '/assets/espaces/admin/admin-eco.css', '/assets/espaces/admin/admin-errors.css', '/assets/espaces/admin/admin-vd.css', '/assets/espaces/irl/calendrier.css', '/assets/espaces/cartes/cartes-saisons.css', '/assets/espaces/irl/cine.css', '/assets/espaces/jeux/jeux-arcade.css', '/assets/commun/report.css', '/assets/espaces/accueil/saisons.css', '/assets/espaces/compte/social.css', '/assets/espaces/accueil/accueil-ce-jour.js', '/assets/espaces/admin/admin-archive.js', '/assets/espaces/admin/cartes/auctions.js', '/assets/espaces/admin/cartes/boosters-saison.js', '/assets/espaces/admin/cartes/codes.js', '/assets/espaces/admin/cartes/proposals.js', '/assets/espaces/admin/cartes/recipes.js', '/assets/espaces/admin/admin-errors.js', '/assets/espaces/admin/admin-saisons.js', '/assets/espaces/admin/admin-social.js', '/assets/espaces/admin/sorties/carte.js', '/assets/espaces/admin/souvenirs/contenu.js', '/assets/espaces/admin/souvenirs/moment-card.js', '/assets/espaces/admin/admin-vd.js', '/assets/espaces/admin/eco-health.js', '/assets/espaces/admin/reports.js', '/assets/espaces/accueil/anniv.js', '/assets/espaces/accueil/avent.js', '/assets/espaces/compte/blason.js', '/assets/espaces/irl/calendrier.js', '/assets/espaces/cartes/cartes-atelier.js', '/assets/espaces/cartes/cartes-codes.js', '/assets/espaces/cartes/cartes-enchere.js', '/assets/espaces/cartes/enchere-regles.js', '/assets/espaces/cartes/cartes-gen.js', '/assets/espaces/cartes/cartes-lots.js', '/assets/espaces/cartes/cartes-jeux.js', '/assets/espaces/cartes/cartes-propositions.js', '/assets/espaces/cartes/cartes-saisons.js', '/assets/espaces/cartes/cartes-tableau.js', '/assets/espaces/irl/cine.js', '/assets/espaces/compte/compte-social.js', '/assets/commun/core/shortcuts.js', '/assets/espaces/arcade/arcade.js', '/assets/espaces/arcade/jeu-domu.js', '/assets/espaces/arcade/jeu-paillettes.js', '/assets/espaces/arcade/jeu-raclette.js', '/assets/commun/error-report.js', '/assets/espaces/compte/friendship.js', '/assets/espaces/accueil/home-blocks.js', '/assets/espaces/accueil/home-edit.js', '/assets/espaces/accueil/home-mentor.js', '/assets/espaces/accueil/home-registry.js', '/assets/espaces/irl/irl-carte.js', '/assets/espaces/jeux/arcade.js', '/assets/espaces/accueil/mercis.js', '/assets/espaces/messages/messages-groupes.js', '/assets/espaces/compte/notif-prefs.js', '/assets/espaces/accueil/polls.js', '/assets/espaces/compte/profil-gaming.js', '/assets/commun/report.js', '/assets/espaces/accueil/saisons-css.js', '/assets/espaces/accueil/saisons.js', '/assets/espaces/compte/skills.js', '/assets/espaces/compte/social.js', '/assets/espaces/irl/ss-unwrap.js', '/assets/espaces/infos/support-files.js', '/pages/irl/calendrier.html', '/pages/irl/cine.html', 
];

// Bibliothèque versionnée (épinglée) : mise en cache si le réseau le permet, sans bloquer l'installation.
const PRECACHE_REMOTE = []; // vide : plus aucune bibliothèque externe épinglée (tout est dans assets/vendor)

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

  // Illustrations des cartes servies par le site (/assets/cartes/, 4 135 fichiers) : même stratégie que les images
  // de Supabase (cache hg-cartes-img, servi en premier, plafonné à IMG_MAX).
  if (sameOrigin && url.pathname.startsWith(LOCAL_CARD_PATH)) { event.respondWith(cardImage(req, event)); return; }

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
 * Réseau d'abord : essaie le réseau et garde une copie. Hors ligne, sert la copie en cache, sinon /offline.html.
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
    return (await cache.match(key)) || (await cache.match('/offline.html')) || Response.error();
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
 * Image de carte (Q4) : la copie du cache hg-cartes-img si elle existe, sinon la copie de la précache (CACHE, cartes
 * de base rangées dans le site) ; sinon le réseau en mode CORS (réponse lisible, pas de réponse opaque), gardée dans
 * hg-cartes-img, plafonné à IMG_MAX images (les plus anciennes sont retirées).
 * @param {Request} req Requête de l'image.
 * @param {FetchEvent} event Événement fetch (le rangement du cache se poursuit après la réponse).
 * @returns {Promise<Response>}
 */
async function cardImage(req, event) {
  const cache = await caches.open(IMG_CACHE);
  const hit = (await cache.match(req.url)) || (await (await caches.open(CACHE)).match(req.url));
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
    icon: new URL('/assets/images/marque/icon-192.png', self.registration.scope).href,
    data: { conversation_id: data.conversation_id || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* Clic sur la notification : ouvre la messagerie sur la conversation, dans un onglet déjà ouvert si possible. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const conv = event.notification.data?.conversation_id;
  const target = new URL('/pages/compte/messages.html', self.registration.scope);
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
