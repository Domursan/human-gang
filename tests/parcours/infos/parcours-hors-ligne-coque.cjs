// P2 · Coque hors ligne (site/sw.js, précache ; outils/build/construire.mjs, section 6), avec le vrai service worker.
// Le service worker n'est pas actif sur http://hg.test (contexte non sûr) : le site est ici servi sur 127.0.0.1 (contexte sûr),
// et le réseau sortant passe par un proxy inaccessible, pour que les appels vers la base échouent aussitôt.
// - Installation : la précache est la coque seule (moins de 90 fichiers, dont les 4 polices, aucune page ni script du panel admin).
// - Une page hors coque, visitée en ligne (Événements), s'ouvre hors ligne depuis le cache.
// - Une page jamais visitée (panel admin) affiche la page hors ligne (/offline.html).
// Le serveur local est arrêté avant ces deux étapes : le cache seul répond.
// Lancer (depuis tests/) : HG_ROOT=<dossier _site construit> node parcours/infos/parcours-hors-ligne-coque.cjs
const fs = require('fs');
const http = require('http');
const path = require('path');
const { ROOT, check, finish, chromium, sleep } = require('../../lib/harness.cjs');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const jourCle = (() => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; })();

/** Titre écrit dans une page HTML (balise title du fichier). */
const titre = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1];

/** Serveur local du site construit (sans faux Supabase : les appels vers la base échouent, comme hors ligne). */
function serveur() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      let f = path.join(ROOT, decodeURIComponent(u.pathname));
      if (!f.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f) || !fs.statSync(f).isFile()) {
        res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(fs.readFileSync(path.join(ROOT, '404.html')));
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(fs.readFileSync(f));
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

// Test réservé au site construit (assets/_b/ produit par outils/build/construire.mjs) : sur les sources, il est sauté.
if (!fs.existsSync(path.join(ROOT, 'assets', '_b'))) {
  console.log('SAUTE site source (pas de _site construit) : lancer avec HG_ROOT=<dossier _site> pour ce test');
  process.exit(0);
}

(async () => {
  const srv = await serveur();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  // Proxy inaccessible (hors 127.0.0.1) : les appels du site vers la base échouent aussitôt, y compris depuis le service worker.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost' } });
  await ctx.addInitScript((k) => {
    try { localStorage.setItem('hg_cookie_ok', '1'); localStorage.setItem('hg_intro_day', k); } catch (e) { /* stockage bloqué */ }
  }, jourCle);
  const page = await ctx.newPage();

  // 1. Installation : la coque seule est précachée.
  await page.goto(`${base}/pages/compte/accueil.html`, { waitUntil: 'load' });
  const installe = await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 }).then(() => true, () => false);
  check(installe, 'service worker : installé et actif (contrôle la page)');
  const precache = await page.evaluate(async () => {
    const nom = (await caches.keys()).find((k) => k.startsWith('hg-coque-'));
    return nom ? (await (await caches.open(nom)).keys()).map((r) => new URL(r.url).pathname) : [];
  });
  check(precache.length > 0 && precache.length < 90, `précache : ${precache.length} fichier(s) (objectif : moins de 90)`);
  const attendus = ['/pages/compte/accueil.html', '/offline.html', '/index.html', '/sw.js'];
  check(attendus.every((p) => precache.includes(p)) && precache.some((p) => p.startsWith('/assets/_b/css/')),
    'précache : pages de la coque, feuille de style et service worker présents');
  check(!precache.some((p) => /\/admin/.test(p)), 'précache : aucun fichier du panel admin');

  // 2. Une page hors coque, visitée en ligne, est gardée et s'ouvre hors ligne.
  await page.goto(`${base}/pages/irl/evenements.html`, { waitUntil: 'load' });
  await sleep(1500);
  // Hors ligne : le serveur local est arrêté (la coupure du réseau de Playwright ne touche pas le service worker ici).
  srv.close();
  srv.closeAllConnections();
  await ctx.setOffline(true);
  const hors = await ctx.newPage();
  const reponse = await hors.goto(`${base}/pages/irl/evenements.html`, { waitUntil: 'load' }).catch((e) => e);
  const titreEvenements = titre(fs.readFileSync(path.join(ROOT, 'pages/irl/evenements.html'), 'utf8'));
  check(!(reponse instanceof Error) && reponse.fromServiceWorker() && (await reponse.text()).includes(`<title>${titreEvenements}</title>`),
    "hors ligne : Événements, visitée en ligne, s'ouvre depuis le cache");

  // 3. Une page jamais visitée (panel admin) affiche la page hors ligne.
  const pageHorsLigne = titre(fs.readFileSync(path.join(ROOT, 'offline.html'), 'utf8'));
  await hors.goto(`${base}/pages/admin/admin.html`, { waitUntil: 'load' }).catch(() => {});
  await sleep(500);
  check((await hors.content()).includes(`<title>${pageHorsLigne}</title>`),
    'hors ligne : page jamais visitée (panel admin) affiche la page hors ligne');

  await browser.close();
  finish();
})();
