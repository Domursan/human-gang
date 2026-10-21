/* Service worker du Humane Gang : mode hors ligne (coque du site et derniers contenus lus).
   - Pages (navigation) : réseau d'abord ; en cas d'échec, la copie en cache puis offline.html.
   - Assets versionnés du site (/assets/) et bibliothèque jsDelivr épinglée (/npm/) : cache d'abord.
   - Supabase (données, authentification, fonctions) : jamais interceptée, jamais mise en cache.
   Incrémenter CACHE_VERSION à chaque déploiement qui modifie des fichiers du site. */

const CACHE_VERSION = 'v1';
const CACHE_PREFIX = 'hg-coque-';
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;

const PRECACHE = [
  'index.html', 'accueil.html', 'admin.html', 'assistance.html', 'cartes.html', 'compte.html',
  'evenements.html', 'historique.html', 'irl.html', 'legal.html', 'membre.html', 'messages.html',
  'recap.html', 'rejoindre.html', 'secret-santa.html', 'offline.html', 'assets/css/accueil.css',
  'assets/css/admin-access.css', 'assets/css/admin-accounts.css', 'assets/css/admin-bot.css',
  'assets/css/admin-cards.css', 'assets/css/admin-events.css', 'assets/css/admin-ghosts.css',
  'assets/css/admin-messages.css', 'assets/css/admin-themes.css', 'assets/css/admin-tools.css',
  'assets/css/admin.css', 'assets/css/assistance.css', 'assets/css/base.css',
  'assets/css/cartes-card.css', 'assets/css/cartes-showcase.css', 'assets/css/cartes-trades.css',
  'assets/css/cartes.css', 'assets/css/compte.css', 'assets/css/evenements.css',
  'assets/css/historique.css', 'assets/css/intro.css', 'assets/css/irl-history.css',
  'assets/css/irl.css', 'assets/css/legal.css', 'assets/css/membre.css', 'assets/css/messages.css',
  'assets/css/photos.css', 'assets/css/recap.css', 'assets/css/rejoindre.css',
  'assets/css/secret-santa.css', 'assets/js/accueil.js', 'assets/js/admin-access.js',
  'assets/js/admin-accounts.js', 'assets/js/admin-badges-edit.js', 'assets/js/admin-bot.js',
  'assets/js/admin-cards.js', 'assets/js/admin-events.js', 'assets/js/admin-ghosts.js',
  'assets/js/admin-godmode.js', 'assets/js/admin-invite-links.js', 'assets/js/admin-messages.js',
  'assets/js/admin-ss-manual.js', 'assets/js/admin-themes.js', 'assets/js/admin.js',
  'assets/js/assistance.js', 'assets/js/badge-levels.js', 'assets/js/cartes-showcase.js',
  'assets/js/cartes-trades.js', 'assets/js/cartes-ui.js', 'assets/js/cartes.js',
  'assets/js/compte.js', 'assets/js/config.js', 'assets/js/core.js', 'assets/js/dyn-events.js',
  'assets/js/evenements.js', 'assets/js/historique.js', 'assets/js/intro-logo.js',
  'assets/js/intro-redirect.js', 'assets/js/intro.js', 'assets/js/irl-history.js',
  'assets/js/irl.js', 'assets/js/legal.js', 'assets/js/membre.js', 'assets/js/messages.js',
  'assets/js/paillettes.js', 'assets/js/photos.js', 'assets/js/profile-fields.js',
  'assets/js/recap.js', 'assets/js/rejoindre.js', 'assets/js/secret-santa.js',
  'assets/js/site-boot.js', 'assets/js/sound.js', 'assets/js/ss-card.js',
  'assets/js/theme-boot.js', 'assets/img/logo-1600.webp', 'assets/img/favicon-64.png',
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
    await cache.addAll(PRECACHE);
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

  const versionedAsset = sameOrigin && url.pathname.includes('/assets/');
  const pinnedLibrary = url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/npm/');
  if (versionedAsset || pinnedLibrary) event.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
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
