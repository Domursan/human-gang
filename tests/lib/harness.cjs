// Outils communs aux tests : site servi depuis le dépôt, faux Supabase, compteurs de résultats.
// Aucun test ne doit atteindre la vraie base : toute requête vers *.supabase.co est interceptée
// et signalée, et finish() échoue si l'une a été tentée.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const TESTS = path.resolve(__dirname, '..');
const ROOT = process.env.HG_ROOT ? path.resolve(process.env.HG_ROOT) : path.resolve(TESTS, '..');
const FIXTURES = path.join(TESTS, 'fixtures');
const SHOTS = path.join(TESTS, 'shots');
const ORIGIN = 'http://hg.test';
// Préfixe de chemin : HG_PREFIX=/human-gang sert le site comme GitHub Pages (https://domursan.github.io/human-gang/).
// Tout chemin hors préfixe (ex. /assets/… à la racine) répond 404, comme en ligne : un chemin absolu cassé se voit.
const PREFIX = (process.env.HG_PREFIX || '').replace(/\/+$/, '');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

let fails = 0, passes = 0;
const EXTERNAL = [];

/** Affiche un résultat. Compte les échecs pour finish(). */
function check(cond, msg) {
  if (cond) passes++; else fails++;
  console.log((cond ? 'OK     ' : 'ECHEC ') + msg);
  return !!cond;
}

/** Termine le script : code de sortie non nul si un contrôle a échoué ou si le vrai Supabase a été sollicité. */
function finish() {
  if (EXTERNAL.length) { fails++; console.log('ECHEC requêtes vers le vrai Supabase interceptées : ' + EXTERNAL.join(', ')); }
  console.log(`\n${passes} OK, ${fails} ECHEC(S)`);
  process.exitCode = fails ? 1 : 0;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Ouvre une page du site dans un contexte isolé.
 * fixture : fichier de tests/fixtures/ qui remplace le client supabase-js.
 * scenario : objet visible par le faux client sous window.__SCN (ex. { guest: true }).
 * reducedMotion : 'reduce' pour désactiver les animations (préférence système).
 * hash : fragment d'adresse à l'ouverture (ex. '#cartes/quetes').
 */
async function openPage(browser, { page: slug = 'accueil', fixture = 'fake-sb.mjs', scenario = {}, width = 1280, height = 900, reducedMotion = 'no-preference', hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion });
  await ctx.addInitScript((s) => {
    window.__SCN = s;
    try { localStorage.setItem('hg_cookie_ok', '1'); } catch (e) { /* stockage bloqué : sans importance pour le test */ }
  }, scenario);
  const fakeBody = fs.readFileSync(path.join(FIXTURES, fixture));
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== ORIGIN) {
      if (u.hostname.endsWith('supabase.co')) EXTERNAL.push(req.url());
      if (u.hostname === 'cdn.jsdelivr.net' && u.pathname.includes('supabase-js')) return route.fulfill({ body: fakeBody, contentType: 'text/javascript' });
      return route.fulfill({ status: 204, body: '' });
    }
    if (/\/vendor\/supabase/.test(u.pathname)) return route.fulfill({ body: fakeBody, contentType: 'text/javascript' });
    if (PREFIX && u.pathname !== PREFIX && !u.pathname.startsWith(PREFIX + '/')) return route.fulfill({ status: 404, body: 'nf' });
    const rel = u.pathname.slice(PREFIX.length) || '/';
    let f = path.join(ROOT, decodeURIComponent(rel));
    if (!f.startsWith(ROOT + path.sep)) return route.fulfill({ status: 403, body: 'interdit' });
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
    route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', (e) => page.errs.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errs.push(m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.status() === 404) page.errs.push('404 ' + r.url()); });
  await page.goto(`${ORIGIN}${PREFIX}/${slug}.html${hash}`); // hash : adresse de départ (lien direct), ex. '#membres/comptes/<id>'
  await sleep(1200);
  page.ctx = ctx;
  return page;
}

/** Décalage horizontal de la page (0 = pas de scroll horizontal). */
const hscroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

/**
 * Admin : ouvre une sous-section comme un clic dans la colonne de navigation et attend qu'elle soit affichée.
 * Les sous-sections se montent à leur première visite : un test qui interagit avec une section doit l'ouvrir d'abord.
 * Ouvre une sous-section du panel par sa route « domaine/sous-section » (ex. 'vie/secret-santa', 'cartes/defis')
 * et attend qu'elle soit affichée : adresse à jour, sous-section active dans la colonne, section visible.
 */
async function adminSection(page, route) {
  await page.evaluate((r) => { location.hash = r; }, route);
  await page.waitForFunction((r) => {
    if (location.hash !== '#' + r) return false;
    const cur = document.querySelector('.shell-sub[aria-current="true"]');
    if (!cur || cur.getAttribute('href') !== '#' + r) return false;
    const s = document.querySelector('#shell-groups > .shell-group:not([hidden]) .admin-section');
    return !!s && s.getClientRects().length > 0;
  }, route, { timeout: 8000 });
}

/** Journal des appels du faux client (rpc, from, fn, auth…). */
const log = (page) => page.evaluate(() => window.__LOG || []);

module.exports = { ROOT, TESTS, FIXTURES, SHOTS, ORIGIN, PREFIX, check, finish, openPage, adminSection, hscroll, log, sleep, chromium };
