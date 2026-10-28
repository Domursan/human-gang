// Contrôle du site construit par outils/build/construire.mjs (version publiée, dossier _site/).
// Deux volets :
// - statique (dossier construit) : chaque relais d'import calculé pointe vers une entrée assets/_b/ qui existe ;
//   les adresses réécrites (modules de page, import.meta.url remplacés, imports relatifs et absolus des fichiers
//   regroupés, feuilles, précache de sw.js) existent ; aucun import.meta ne reste dans assets/_b/ ; les feuilles
//   fusionnées n'ont pas d'url() relative. Sur le source (site/), seules les adresses des pages et du service worker
//   sont vérifiées, en référence.
// - navigateur (toutes les pages HTML) : aucune exception ni erreur console, aucune réponse 4xx/5xx, aucun échec réseau,
//   et aucun module JS chargé par son adresse d'origine sans être un relais : une telle requête donnerait une seconde
//   instance du module, en plus de sa version regroupée.
// Le faux Supabase (tests/fixtures/) remplace supabase-js ; les autres hôtes répondent vide ; le service worker est
// bloqué pour que toutes les requêtes passent par le routage du test.
// Lancer (depuis tests/) : HG_ROOT=<dossier _site construit> node controles/check-build.cjs
// Sans HG_ROOT, le dossier testé est site/ (référence) ; le volet « relais » est alors ignoré.
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, FIXTURES, ORIGIN, PREFIX, check, finish, chromium } = require('../lib/harness.cjs');

const B = path.join(ROOT, 'assets', '_b');
const CONSTRUIT = fs.existsSync(B);
const RELAIS = /^export \* from "(\/assets\/_b\/[^"]+)";/;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

/** Fichiers d'un dossier, récursivement, dont le nom respecte le motif (chemins absolus). */
function walk(dir, motif, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, motif, out); else if (motif.test(p)) out.push(p);
  }
  return out;
}
/** Adresse absolue du site (« /a/b.js ») : existe comme fichier, ou comme dossier avec index.html. */
function existe(url) {
  const p = path.join(ROOT, decodeURIComponent(url.split(/[?#]/)[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return fs.existsSync(path.join(p, 'index.html'));
  return fs.existsSync(p);
}
const dansB = (f) => f.startsWith(B + path.sep);
const lire = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

const pagesHtml = walk(ROOT, /\.html$/);
const scriptsClassiques = new Set();

// ---------- Volet statique ----------
console.log(`Racine testée : ${ROOT}${CONSTRUIT ? ' (version construite)' : ' (source : pas de assets/_b/, volet relais ignoré)'}`);

// Adresses HTML : modules de page vers le regroupé, feuilles, préchargements et images existent.
const manquantsHtml = [];
for (const p of pagesHtml) {
  const t = lire(p);
  for (const [balise] of t.matchAll(/<script\b[^>]*>/gi)) {
    const src = balise.match(/\ssrc\s*=\s*"(\/[^"]+)"/i);
    if (!src) continue;
    if (/type\s*=\s*["']module["']/i.test(balise)) {
      if (CONSTRUIT && !src[1].startsWith('/assets/_b/')) manquantsHtml.push(`${rel(p)} : module d'origine ${src[1]}`);
    } else scriptsClassiques.add(src[1]);
    if (!existe(src[1])) manquantsHtml.push(`${rel(p)} : ${src[1]}`);
  }
  for (const m of t.matchAll(/\s(?:href|src)="(\/[^"#?]*)"/g)) {
    if (m[1] === '/' || m[1].startsWith('//')) continue;
    if (!existe(m[1])) manquantsHtml.push(`${rel(p)} : ${m[1]}`);
  }
}
check(manquantsHtml.length === 0, `pages : ${pagesHtml.length} HTML, adresses locales (scripts, feuilles, liens, images) existantes${manquantsHtml.length ? ' ; manquantes : ' + manquantsHtml.slice(0, 12).join(' | ') : ''}`);

// Précache du service worker : chaque fichier listé existe dans le dossier testé.
const sw = lire(path.join(ROOT, 'sw.js'));
const bloc = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
const precache = bloc ? [...bloc[1].matchAll(/'(\/[^']+)'/g)].map((m) => m[1]) : [];
const absentsSw = precache.filter((p) => !existe(p));
check(bloc && absentsSw.length === 0, `sw.js : ${precache.length} fichier(s) précachés existants${absentsSw.length ? ' ; absents : ' + absentsSw.join(', ') : ''}`);

if (CONSTRUIT) {
  // Relais : chaque fichier d'origine réécrit pointe vers une entrée existante de assets/_b/.
  const jsHors = walk(ROOT, /\.m?js$/).filter((f) => !dansB(f));
  const relais = [];
  for (const f of jsHors) { const m = lire(f).match(RELAIS); if (m) relais.push({ f, cible: m[1] }); }
  const casses = relais.filter((r) => !existe(r.cible) || !dansB(path.join(ROOT, r.cible)));
  check(relais.length > 0 && casses.length === 0, `relais : ${relais.length} fichier(s) d'origine renvoient vers une entrée de assets/_b/ existante${casses.length ? ' ; cassés : ' + casses.map((r) => `${rel(r.f)} -> ${r.cible}`).join(' | ') : ''}`);

  // Dans assets/_b/ : aucun import.meta, adresses « self.location.origin + "/…" » (import.meta.url remplacé),
  // imports relatifs (sortie esbuild entre entrées et morceaux) et adresses absolues de fichiers existants.
  const bfichiers = walk(B, /\.m?js$/);
  const restesMeta = [], origineCassee = [], relatifsCasses = [], absoluCasses = [];
  let dynamiques = 0;
  for (const f of bfichiers) {
    const t = lire(f);
    if (/import\.meta/.test(t)) restesMeta.push(rel(f));
    for (const m of t.matchAll(/self\.location\.origin\s*\+\s*"(\/[^"]+)"/g)) if (!existe(m[1])) origineCassee.push(`${rel(f)} -> ${m[1]}`);
    for (const m of t.matchAll(/(?:from|import\(|import)\s*"(\.{1,2}\/[^"]+)"/g)) {
      if (!fs.existsSync(path.resolve(path.dirname(f), m[1]))) relatifsCasses.push(`${rel(f)} -> ${m[1]}`);
    }
    for (const m of t.matchAll(/"(\/[^"\s]+?\.(?:m?js|css|json|svg|png|webp|jpe?g|woff2?|webmanifest|txt))"/g)) {
      // Un chemin construit à l'exécution (« ${r(x)} ») ne se vérifie pas ici : il est compté à part.
      if (m[1].includes('${')) { dynamiques++; continue; }
      if (!existe(m[1])) absoluCasses.push(`${rel(f)} -> ${m[1]}`);
    }
  }
  check(restesMeta.length === 0, `import.meta : aucun reste dans ${bfichiers.length} fichier(s) de assets/_b/${restesMeta.length ? ' ; restes : ' + restesMeta.slice(0, 10).join(', ') : ''}`);
  check(origineCassee.length === 0, `import.meta.url remplacés : adresses d'origine existantes${origineCassee.length ? ' ; cassées : ' + origineCassee.slice(0, 10).join(' | ') : ''}`);
  check(relatifsCasses.length === 0, `imports relatifs de assets/_b/ : cibles existantes${relatifsCasses.length ? ' ; cassés : ' + relatifsCasses.slice(0, 10).join(' | ') : ''}`);
  check(absoluCasses.length === 0, `chemins absolus réécrits dans assets/_b/ : fichiers existants (${dynamiques} chemin(s) construit(s) à l'exécution non vérifiés ici)${absoluCasses.length ? ' ; manquants : ' + absoluCasses.slice(0, 10).join(' | ') : ''}`);

  // Feuilles fusionnées : aucune url() relative (elle ne suivrait pas le fichier regroupé).
  const cssFusion = walk(path.join(B, 'css'), /\.css$/).filter((f) => /url\(\s*(?!["']?(?:data:|https?:|\/\/|#|\/))/i.test(lire(f)));
  check(cssFusion.length === 0, `feuilles fusionnées : aucune url() relative${cssFusion.length ? ' ; fautives : ' + cssFusion.map(rel).join(', ') : ''}`);
}

// ---------- Volet navigateur ----------
const fakeBody = fs.readFileSync(path.join(FIXTURES, 'fake-sb.mjs'));
const jourCle = (() => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; })();
// Un relais est un fichier d'origine qui ne contient que la réexportation de son entrée regroupée.
const estRelais = (p) => { const f = path.join(ROOT, decodeURIComponent(p)); return fs.existsSync(f) && RELAIS.test(lire(f)); };

/** Ouvre une page dans un contexte isolé et renvoie les requêtes du site et les erreurs. */
async function visiter(browser, pagePath) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript((k) => {
    window.__SCN = {};
    try { localStorage.setItem('hg_cookie_ok', '1'); localStorage.setItem('hg_intro_day', k); } catch (e) { /* stockage bloqué */ }
  }, jourCle);
  const externes = [];
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) {
      if (u.hostname.endsWith('supabase.co')) externes.push(u.href);
      return route.fulfill({ status: 204, body: '' });
    }
    if (/\/vendor\/supabase/.test(u.pathname)) return route.fulfill({ status: 200, body: fakeBody, contentType: 'text/javascript' });
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT + path.sep)) return route.fulfill({ status: 403, body: 'interdit' });
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'nf', contentType: 'text/plain' });
    return route.fulfill({ status: 200, body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
  const page = await ctx.newPage();
  const erreurs = [];
  const chargements = []; // { chemin, type, statut }
  page.on('pageerror', (e) => erreurs.push('exception : ' + e.message.slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push('console : ' + m.text().slice(0, 160)); });
  page.on('requestfailed', (r) => { if (r.url().startsWith(ORIGIN)) erreurs.push('échec réseau ' + new URL(r.url()).pathname); });
  page.on('response', (r) => {
    if (!r.url().startsWith(ORIGIN)) return;
    const chemin = new URL(r.url()).pathname;
    chargements.push({ chemin, type: r.request().resourceType(), statut: r.status() });
    if (r.status() >= 400) erreurs.push(`${r.status()} ${chemin}`);
  });
  await page.goto(`${ORIGIN}${PREFIX}/${pagePath}`, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await ctx.close();
  return { chargements, erreurs, externes };
}

(async () => {
  const browser = await chromium.launch();
  const pages = pagesHtml.map(rel).sort();
  for (const pagePath of pages) {
    const { chargements, erreurs, externes } = await visiter(browser, pagePath);
    if (externes.length) erreurs.push('requêtes vers le vrai Supabase : ' + externes.join(', '));
    // Modules JS chargés par leur adresse d'origine : seul un relais est admis (sa version regroupée est alors la seule instance).
    const doublons = [];
    if (CONSTRUIT) {
      const vus = new Set();
      for (const c of chargements) {
        if (c.type !== 'script' || !/\.m?js$/.test(c.chemin) || dansB(path.join(ROOT, c.chemin))) continue;
        if (vus.has(c.chemin)) continue;
        vus.add(c.chemin);
        if (!estRelais(c.chemin) && !scriptsClassiques.has(c.chemin)) doublons.push(c.chemin);
      }
    }
    const ok = erreurs.length === 0 && doublons.length === 0;
    check(ok, `${pagePath} : ${chargements.length} requête(s) du site${erreurs.length ? ' ; ' + erreurs.slice(0, 5).join(' | ') : ''}${doublons.length ? ' ; modules d\'origine non relais chargés : ' + doublons.join(', ') : ''}`);
  }
  await browser.close();
  finish();
})();
