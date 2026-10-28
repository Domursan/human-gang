// Parcours C16 · Planche imprimable de la collection (/pages/cartes/collection-a4.html).
// 1. Lien « Imprimer ma planche » dans la Collection, « Imprimer sa planche » dans la collection d'un membre.
// 2. Planche : en-tête (pseudo, séries, compte possédées / total), cases possédées et manquantes (numéro, nom), pastille brillante,
//    options (série, fond sombre, sans manquantes) reflétées dans l'adresse.
// 3. Impression : barre d'outils et en-tête du site cachés, page.pdf() en A4 (nombre de pages), pas de débordement de la grille.
// 4. Planche d'un autre membre (?user=) ; 360 px : prévisualisation sans défilement horizontal.
// Faux Supabase : fixtures/fake-sb-cartes.mjs. Lancer : node tests/parcours/cartes/parcours-c16.cjs
const path = require('path');
const { openPage, check, finish, hscroll, sleep, chromium } = require('../../lib/harness.cjs');

const F = 'fake-sb-cartes.mjs';
// tests/shots/ n'existe pas sur une copie fraîche du dépôt (CI) : créé avant toute écriture (writeFileSync ne le crée pas).
const SHOTS = path.join(__dirname, '..', '..', 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
(async () => {
  const browser = await chromium.launch();

  const c = await openPage(browser, { page: 'cartes', fixture: F, width: 1280, height: 900, hash: '#collection' });
  await sleep(400);
  check(/collection-a4\.html\?set=/.test(await c.$eval('.cz-extra a', (a) => a.getAttribute('href'))), 'Collection : lien « Imprimer ma planche »');
  await c.evaluate(() => { location.hash = '#collection/00000002-0000-4000-8000-000000000002'; });
  await sleep(800);
  check(/collection-a4\.html\?user=00000002/.test(await c.$eval('.cartes-peer-offer a', (a) => a.getAttribute('href'))), 'collection d’un membre : lien « Imprimer sa planche »');
  await c.ctx.close();

  const p = await openPage(browser, { page: 'collection-a4', fixture: F, width: 1280, height: 1000 });
  await sleep(600);
  const head = await p.$eval('.a4-head', (e) => e.innerText);
  check(/Collection de Ethan/.test(head) && /version claire/.test(head), 'en-tête : pseudo et version claire');
  check(/6 \/ 11/.test(head), `compte possédées / total hors identités (${head.replace(/\s+/g, ' ').slice(-40)})`);
  check(await p.$$eval('.a4-page', (x) => x.length) === 1, 'une page (12 cartes)');
  check(await p.$$eval('.a4-cell .hgc', (x) => x.length) === 7 && await p.$$eval(".a4-miss", (x) => x.length) === 5, "7 cases possédées, 5 manquantes");
  check(/N° 004/.test(await p.$eval('.a4-miss', (e) => e.innerText)) && /Pompe à essence/.test(await p.$eval('.a4-miss', (e) => e.innerText)), 'case manquante : numéro et nom');
  check(await p.$$eval('.a4-shiny', (x) => x.length) === 3, "pastilles brillantes (C1, C5, C7)");
  check(await p.$$eval('.a4-page .hgc-holo', (x) => x.filter((h) => getComputedStyle(h).display !== 'none').length) === 0, 'aucun effet holo sur la planche');
  check(/Imprimé le \d\d\.\d\d\.\d{4} · page 1 \/ 1/.test(await p.$eval('.a4-foot', (e) => e.innerText)), 'pied : date et page');
  await p.check('input[name="a4-theme"][value="sombre"]');
  await sleep(200);
  check(await p.$('.a4-page.a4-sombre') !== null && /theme=sombre/.test(p.url()), 'fond sombre et adresse à jour');
  await p.uncheck('[data-opt="missing"]');
  await sleep(200);
  check(await p.$$eval('.a4-miss', (x) => x.length) === 0 && /missing=0/.test(p.url()), 'sans les manquantes');
  await p.check('[data-opt="missing"]');
  await p.check('input[name="a4-theme"][value="clair"]');
  await sleep(200);
  // Impression
  await p.emulateMedia({ media: 'print' });
  check(await p.$eval('.a4-tools', (e) => getComputedStyle(e).display) === 'none', 'impression : barre d’outils cachée');
  const site = await p.$('header.site-header, .site-header');
  check(!site || await site.evaluate((e) => getComputedStyle(e).display === 'none'), 'impression : en-tête du site caché');
  const over = await p.$$eval('.a4-page', (pg) => pg.some((x) => { const g = x.querySelector('.a4-grid'), f = x.querySelector('.a4-foot'); return f.getBoundingClientRect().bottom > x.getBoundingClientRect().bottom + 1 || g.scrollHeight > g.clientHeight + 1; }));
  check(!over, 'impression : rien ne déborde de la page');
  const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  check(pages === 1, `PDF A4 : ${pages} page(s)`);
  require('fs').writeFileSync(path.join(SHOTS, 'c16-planche.pdf'), pdf);
  await p.emulateMedia({ media: 'screen' });
  await p.screenshot({ path: path.join(SHOTS, 'c16-planche.png'), fullPage: true });
  check(p.errs.length === 0, `aucune erreur (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // Planche d'un autre membre, beaucoup de cartes (pagination)
  const o = await openPage(browser, { page: 'collection-a4', fixture: F, width: 1280, height: 1000, scenario: { echanges: true, bigCards: 40 }, hash: '' });
  await o.goto(o.url().replace(/\.html.*$/, '.html?user=00000002-0000-4000-8000-000000000002&set=all&theme=clair&missing=1'));
  await sleep(800);
  check(/Collection de Alice/.test(await o.$eval('.a4-head', (e) => e.innerText)), 'planche d’un autre membre (?user=)');
  check(await o.$$eval('.a4-page', (x) => x.length) === 2, '53 cartes : 2 pages (30 par page)');
  const pdf2 = await o.pdf({ preferCSSPageSize: true, printBackground: true });
  check((pdf2.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length === 2, 'PDF : 2 pages');
  await o.ctx.close();

  const n = await openPage(browser, { page: 'collection-a4', fixture: F, width: 360, height: 800 });
  await sleep(600);
  check(await hscroll(n) === 0, '360 px : pas de défilement horizontal');
  const k = await n.$eval('#a4-sheets', (e) => Number(getComputedStyle(e).getPropertyValue('--k')));
  check(k > 0.3 && k < 0.5, `360 px : planche réduite à l’écran (×${k.toFixed(2)})`);
  await n.ctx.close();

  await browser.close();
  finish();
})();
