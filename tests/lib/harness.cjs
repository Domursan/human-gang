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
 * Mesure de performance (tests/perf-budget.cjs) : delay(octets) → millisecondes d'attente avant chaque réponse du site
 * (réseau lent simulé), cpu : ralentissement du processeur (×N, protocole Chrome), init : script ajouté avant le chargement.
 * Le contexte renvoyé (page.ctx) compte les requêtes servies et leurs octets : page.ctx.__net = { requetes, octets }.
 */
async function openPage(browser, { page: slug = 'accueil', fixture = 'fake-sb.mjs', scenario = {}, width = 1280, height = 900, reducedMotion = 'no-preference', hash = '', touch = false, now = null, mobile = false, dpr = 1, delay = null, cpu = 0, init = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion, hasTouch: touch || mobile, isMobile: mobile, deviceScaleFactor: dpr }); // touch : écran tactile (pointeur grossier)
  // Avec now (horloge simulée), le jour de l'intro vient de now : le script d'initialisation s'exécute avant l'horloge.
  const dayKey = now ? (() => { const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; })() : null;
  await ctx.addInitScript(({ s, dayKey }) => {
    window.__SCN = s;
    try {
      localStorage.setItem('hg_cookie_ok', '1');
      // Intro déjà jouée aujourd'hui (sinon l'accueil y renvoie) ; scenario.intro = true pour la tester
      const d = new Date();
      if (!s.intro) localStorage.setItem('hg_intro_day', dayKey || `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    } catch (e) { /* stockage bloqué : sans importance pour le test */ }
  }, { s: scenario, dayKey });
  // init : script supplémentaire exécuté avant la page : nom d'un fichier de tests/fixtures/ (ex. fake-jeux.js : RPC des jeux)
  // ou script Playwright (fonction, { content }, { path }).
  if (init) await ctx.addInitScript(typeof init === 'string' && /\.m?js$/.test(init) ? { path: path.join(FIXTURES, init) } : init);
  const fakeBody = fs.readFileSync(path.join(FIXTURES, fixture));
  const net = ctx.__net = { requetes: 0, octets: 0 };
  // Réponse comptée (requêtes et octets) et retardée si un réseau lent est simulé (delay).
  const serve = async (route, opts) => {
    const n = opts.body ? Buffer.byteLength(opts.body) : 0;
    net.requetes++; net.octets += n;
    if (delay) await sleep(delay(n));
    return route.fulfill(opts);
  };
  // Toute requête de la page passe ici : le site est servi depuis le dépôt, le faux Supabase remplace
  // supabase-js, les autres hôtes externes répondent vide (204). Les requêtes vers *.supabase.co sont notées dans EXTERNAL.
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== ORIGIN) {
      if (u.hostname.endsWith('supabase.co')) EXTERNAL.push(req.url());
      return route.fulfill({ status: 204, body: '' });
    }
    // supabase-js est servi localement : assets/vendor/supabase-js-2.45.4.mjs (et son .js) reçoivent le faux client.
    if (/\/vendor\/supabase/.test(u.pathname)) return serve(route, { body: fakeBody, contentType: 'text/javascript' });
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
    return serve(route, { body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  const page = await ctx.newPage();
  // now : horloge simulée (Playwright) installée avant la navigation, pour tester l'heure de Zurich
  if (now) await page.clock.install({ time: new Date(now) });
  if (cpu > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
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
 * Ouvre une sous-section du panel par sa route « domaine/sous-section » (ex. 'irl/secret-santa', 'cartes/defis')
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
