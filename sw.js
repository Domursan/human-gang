/* Service worker du Humane Gang : mode hors ligne (coque du site et derniers contenus lus).
   - Pages (navigation) : réseau d'abord ; en cas d'échec, la copie en cache puis offline.html.
   - Fichiers du site (/assets/) : copie en cache servie tout de suite, mise à jour en arrière-plan
     (stale-while-revalidate) : une nouvelle version est utilisée dès le chargement suivant.
   - Bibliothèque jsDelivr épinglée (/npm/, version fixe) : cache d'abord.
   - Supabase (données, authentification, fonctions) : jamais interceptée, jamais mise en cache.
   CACHE_VERSION : à incrémenter seulement si la liste PRECACHE ou la logique du service worker change. */

const CACHE_VERSION = 'v27';
const CACHE_PREFIX = 'hg-coque-';
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;

const PRECACHE = [
  'index.html', 'accueil.html', 'admin.html', 'assistance.html', 'cartes.html', 'compte.html',
  'evenements.html', 'historique.html', 'irl.html', 'legal.html', 'membre.html', 'messages.html',
  'recap.html', 'rejoindre.html', 'secret-santa.html', 'offline.html', 'assets/css/accueil.css',
  'assets/css/admin-access.css', 'assets/css/admin-accounts.css', 'assets/css/admin-bot.css',
  'assets/css/admin-cards.css', 'assets/css/admin-reglages.css', 'assets/css/admin-events.css', 'assets/css/admin-ghosts.css',
  'assets/css/admin-messages.css', 'assets/css/admin-themes.css', 'assets/css/admin-tools.css',
  'assets/css/admin-staff.css', 'assets/css/admin-pilotage.css', 'assets/css/admin.css', 'assets/css/admin-sorties.css', 'assets/css/assistance.css', 'assets/css/base.css',
  'assets/css/cartes-card.css', 'assets/css/cartes-showcase.css', 'assets/css/cartes-trades.css',
  'assets/css/cartes.css', 'assets/css/cartes-x5.css', 'assets/css/cartes-zoom.css', 'assets/css/compte.css', 'assets/css/evenements.css',
  'assets/css/historique.css', 'assets/css/intro.css', 'assets/css/irl-history.css',
  'assets/css/irl.css', 'assets/css/legal.css', 'assets/css/membre.css', 'assets/css/messages.css',
  'assets/css/photos.css', 'assets/css/recap.css', 'assets/css/rejoindre.css', 'assets/css/ui-confirm.css',
  'assets/css/secret-santa.css', 'assets/css/ss-pairs.css', 'assets/js/accueil.js', 'assets/js/admin-access.js',
  'assets/js/admin-accounts.js', 'assets/js/admin-badges-edit.js', 'assets/js/admin-bot.js',
  'assets/js/admin-cards.js', 'assets/js/admin-events.js', 'assets/js/admin-ghosts.js', 'assets/js/admin-godmode.js',
  'assets/js/admin-invite-links.js', 'assets/js/admin-messages.js',
  'assets/js/admin-ss-manual.js', 'assets/js/admin-themes.js', 'assets/js/admin.js',
  'assets/js/admin-cards/quests.js', 'assets/js/admin-reglages/keys.js', 'assets/js/admin-reglages/view.js',
  'assets/js/admin-accounts/activity.js', 'assets/js/admin-accounts/common.js', 'assets/js/admin-accounts/events.js', 'assets/js/admin-accounts/fiche.js',
  'assets/js/admin-accounts/inspect.js', 'assets/js/admin-accounts/list.js', 'assets/js/admin-accounts/profile.js', 'assets/js/admin-accounts/ss-pairs.js',
  'assets/js/admin-accounts/ss-shared.js', 'assets/js/admin-accounts/ss.js', 'assets/js/admin-accounts/state.js', 'assets/js/admin-cards/constants.js',
  'assets/js/admin-cards/data.js', 'assets/js/admin-cards/economy.js', 'assets/js/admin-cards/editor.js', 'assets/js/admin-cards/helpers.js',
  'assets/js/admin-cards/list.js', 'assets/js/admin-cards/players.js', 'assets/js/admin-cards/sets.js', 'assets/js/admin-cards/state.js',
  'assets/js/admin-cards/stats.js', 'assets/js/admin-cards/trades.js', 'assets/js/admin-cards/view.js', 'assets/js/admin/badges.js',
  'assets/js/admin/common.js', 'assets/js/admin/ideas.js', 'assets/js/admin/invites.js', 'assets/js/admin/loaders.js',
  'assets/js/admin/overview.js', 'assets/js/admin/perms.js', 'assets/js/admin/ss-events.js', 'assets/js/admin/ss-render.js', 'assets/js/admin/state.js',
  'assets/js/admin/support.js', 'assets/js/admin/live.js', 'assets/css/admin-live.css',
  'assets/js/admin/shell.js', 'assets/js/admin/router.js', 'assets/css/admin-shell.css',
  'assets/js/admin/palette.js', 'assets/css/admin-nav.css', 'assets/js/admin/list-tools.js',
  'assets/js/admin-sorties/data.js', 'assets/js/admin-sorties/dialogs.js', 'assets/js/admin-sorties/format.js', 'assets/js/admin-sorties/index.js',
  'assets/css/admin-souvenirs.css', 'assets/js/admin-souvenirs/helpers.js', 'assets/js/admin-souvenirs/index.js', 'assets/js/admin-souvenirs/moments.js',
  'assets/js/admin-souvenirs/photos.js', 'assets/js/admin-souvenirs/reactions.js',
  'assets/js/assistance.js', 'assets/js/badge-levels.js', 'assets/js/cartes-showcase.js',
  'assets/js/cartes-trades.js', 'assets/js/cartes-ui.js', 'assets/js/cartes.js', 'assets/js/cartes-zoom.js', 'assets/js/cartes-place.js',
  'assets/js/compte.js', 'assets/js/config.js', 'assets/js/core.js',
  'assets/js/core/badges.js', 'assets/js/core/effects.js', 'assets/js/core/footer.js',
  'assets/js/core/functions.js', 'assets/js/core/godmode.js', 'assets/js/core/header.js',
  'assets/js/core/icons.js', 'assets/js/core/init.js', 'assets/js/core/pages-access.js',
  'assets/js/core/prefs-state.js', 'assets/js/core/prefs.js', 'assets/js/core/profile.js',
  'assets/js/core/perms.js', 'assets/js/core/search.js',
  'assets/js/core/supabase.js', 'assets/js/core/theme-calc.js', 'assets/js/core/theme-load.js',
  'assets/js/core/theme.js', 'assets/js/core/ui.js', 'assets/js/core/unread.js',
  'assets/js/core/util.js', 'assets/js/dyn-events.js',
  'assets/js/evenements.js', 'assets/js/historique.js', 'assets/js/intro-logo.js',
  'assets/js/intro-daily.js', 'assets/js/intro-redirect.js', 'assets/js/intro.js', 'assets/js/irl-history.js',
  'assets/js/irl.js', 'assets/js/legal.js', 'assets/js/membre.js', 'assets/js/messages.js',
  'assets/js/paillettes.js', 'assets/js/photos.js', 'assets/js/profile-fields.js',
  'assets/js/recap.js', 'assets/js/rejoindre.js', 'assets/js/secret-santa.js',
  'assets/js/site-boot.js', 'assets/js/sound.js', 'assets/js/ss-card.js', 'assets/js/ss-pairs.js',
  'assets/js/theme-boot.js', 'assets/js/icons.js', 'assets/js/ui-confirm.js', 'assets/js/utils.js', 'assets/img/logo-1600.webp', 'assets/img/favicon-64.png',
  'assets/js/admin-challenges.js', 'assets/js/admin-log.js', 'assets/js/admin-staff.js', 'assets/js/ics.js', 'assets/js/image-compress.js', 'assets/js/push.js', 'assets/js/reactions.js',
  'assets/css/admin-ui.css', 'assets/js/admin/ui/common.js', 'assets/js/admin/ui/time.js', 'assets/js/admin/ui/list.js', 'assets/js/admin/ui/drawer.js',
  'assets/js/admin/ui/thread.js', 'assets/js/admin/ui/info-panel.js', 'assets/js/admin/ui/detail-header.js',
  'assets/img/icon-192.png', 'assets/img/icon-512.png', 'assets/img/apple-touch-icon.png',
  'assets/img/og-image.png', 'manifest.webmanifest',
];

// Bibliothèque versionnée (épinglée) : mise en cache si le réseau le permet, sans bloquer l'installation.
const PRECACHE_REMOTE = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Un fichier absent ne doit pas faire échouer toute l'installation.
    await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
    await Promise.allSettled(PRECACHE_REMOTE.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

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
  const pinnedLibrary = url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/npm/');
  if (pinnedLibrary) event.respondWith(cacheFirst(req));
});

async function networkFirst(req, revalidate = false) {
  const cache = await caches.open(CACHE);
  try {
    // revalidate : demande au serveur si le fichier a changé (réponse 304 légère sinon), sans se fier au cache HTTP.
    const res = await fetch(req, revalidate ? { cache: 'no-cache' } : undefined);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req)) || (await cache.match('offline.html')) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const update = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  if (hit) { event.waitUntil(update); return hit; }
  return (await update) || Response.error();
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
