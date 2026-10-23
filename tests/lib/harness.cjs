// Harnais commun des tests (tests/lib/harness.cjs).
// Outils communs aux tests : site servi depuis le dépôt sans serveur, faux Supabase (tests/fixtures/),
// compteurs de résultats (check / finish), ouverture de page et de panel admin.
// Aucun test ne doit atteindre la vraie base : toute requête vers *.supabase.co est interceptée
// et signalée, et finish() échoue si l'une a été tentée.
// Utilisé par les smoke*.cjs et les parcours-*.cjs via require('./lib/harness.cjs'). Rien à lancer seul : voir tests/README.md.

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

/* ---------- Constantes : chemins (dépôt, tests, fixtures, captures) et adresse du faux site ---------- */
const TESTS = path.resolve(__dirname, '..');
const ROOT = process.env.HG_ROOT ? path.resolve(process.env.HG_ROOT) : path.resolve(TESTS, '..');
const FIXTURES = path.join(TESTS, 'fixtures');
const SHOTS = path.join(TESTS, 'shots');
const ORIGIN = 'http://hg.test';
// Préfixe de chemin : HG_PREFIX=/human-gang sert le site comme GitHub Pages (https://humane-gang.com/).
// Tout chemin hors préfixe (ex. /assets/… à la racine) répond 404, comme en ligne : un chemin absolu cassé se voit.
/** Préfixe de chemin : le site peut être servi sous /human-gang/ comme sur GitHub Pages. */
const PREFIX = (process.env.HG_PREFIX || '').replace(/\/+$/, '');
/** Type MIME envoyé au navigateur, selon l'extension du fichier. */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

/** Compteurs de résultats et liste des requêtes vers le vrai Supabase (remplie par openPage). */
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

/** Attend ms millisecondes (laisse le temps aux animations et au rendu). */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Ouvre une page du site dans un contexte isolé.
 * fixture : fichier de tests/fixtures/ qui remplace le client supabase-js.
 * scenario : objet visible par le faux client sous window.__SCN (ex. { guest: true }).
 * reducedMotion : 'reduce' pour désactiver les animations (préférence système).
 * touch : true pour un écran tactile (page.tap possible).
 * mobile / dpr : téléphone émulé (isMobile, deviceScaleFactor), ex. { mobile: true, dpr: 2.6 }.
 * hash : fragment d'adresse à l'ouverture (ex. '#cartes/quetes').
 */
async function openPage(browser, { page: slug = 'accueil', fixture = 'fake-sb.mjs', scenario = {}, width = 1280, height = 900, reducedMotion = 'no-preference', hash = '', touch = false, now = null, mobile = false, dpr = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion, hasTouch: touch || mobile, isMobile: mobile, deviceScaleFactor: dpr }); // touch : écran tactile (pointeur grossier)
  await ctx.addInitScript((s) => {
    window.__SCN = s;
    try {
      localStorage.setItem('hg_cookie_ok', '1');
      // Intro déjà jouée aujourd'hui (sinon l'accueil y renvoie) ; scenario.intro = true pour la tester
      const d = new Date();
      if (!s.intro) localStorage.setItem('hg_intro_day', `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    } catch (e) { /* stockage bloqué : sans importance pour le test */ }
  }, scenario);
  const fakeBody = fs.readFileSync(path.join(FIXTURES, fixture));
  // Toute requête de la page passe ici : le site est servi depuis le dépôt, le faux Supabase remplace
  // supabase-js, les autres hôtes externes répondent vide (204). Les requêtes vers *.supabase.co sont notées dans EXTERNAL.
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
    if (!fs.existsSync(f)) { // comme GitHub Pages : une adresse inconnue reçoit 404.html, avec le statut 404
      const page404 = path.join(ROOT, '404.html');
      if (fs.existsSync(page404)) return route.fulfill({ status: 404, body: fs.readFileSync(page404), contentType: 'text/html' });
      return route.fulfill({ status: 404, body: 'nf' });
    }
    route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  const page = await ctx.newPage();
  // now : horloge simulée (Playwright) installée avant la navigation, pour tester l'heure de Zurich
  if (now) await page.clock.install({ time: new Date(now) });
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
/** Décalage horizontal de la page : 0 si aucun défilement horizontal. */
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
/** Renvoie le journal des appels du faux client, lu dans la page (window.__LOG). */
const log = (page) => page.evaluate(() => window.__LOG || []);

module.exports = { ROOT, TESTS, FIXTURES, SHOTS, ORIGIN, PREFIX, check, finish, openPage, adminSection, hscroll, log, sleep, chromium };
