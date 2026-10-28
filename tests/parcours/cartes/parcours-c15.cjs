require('fs').mkdirSync(require('path').join(__dirname, '..', '..', 'shots'), { recursive: true }); // tests/shots absent d'une copie fraîche du dépôt : créé avant les captures.
// Parcours C15 · « Le Cours de la Paillette » (onglet Classement de cartes.html, migration 082).
// 1. Sans la migration : le classement seul, sans erreur.
// 2. Carte d'appel en tête du classement ; « Lire le bulletin » remplace le classement par le bulletin complet :
//    grand chiffre, courbe SVG de 8 semaines, rubriques, « Un membre discret », ligne de la cagnotte, archives,
//    accord « Apparaître dans le bulletin » (RPC), retour au classement.
// 3. 360 px : pas de défilement horizontal. Faux Supabase : fixtures/fake-sb-cartes.mjs (scénario bulletin).
// Lancer : node tests/parcours/cartes/parcours-c15.cjs
const path = require('path');
const { openPage, check, finish, hscroll, sleep, log, chromium } = require('../../lib/harness.cjs');

const F = 'fake-sb-cartes.mjs';
(async () => {
  const browser = await chromium.launch();

  const a = await openPage(browser, { page: 'cartes', fixture: F, width: 390, height: 900, hash: '#classement' });
  await sleep(500);
  check(await a.$('.cartes-lb') !== null && await a.$('.bul-teaser') === null, 'sans migration : classement seul');
  check(a.errs.length === 0, `sans migration : aucune erreur (${a.errs.join(' | ') || 'rien'})`);
  await a.ctx.close();

  const p = await openPage(browser, { page: 'cartes', fixture: F, width: 390, height: 900, scenario: { bulletin: true }, hash: '#classement' });
  await sleep(500);
  const t = await p.$eval('.bul-teaser', (e) => e.innerText);
  check(/N° 12/.test(t) && /Le Cours de la Paillette/.test(t) && /s’arrache/.test(t), 'carte d’appel : numéro, titre, accroche');
  check(await p.evaluate(() => document.querySelector('#cartes-bulletin-slot').compareDocumentPosition(document.querySelector('.cartes-lb')) & Node.DOCUMENT_POSITION_FOLLOWING), 'bulletin en tête du classement');
  await p.click('[data-bul="open"]');
  await sleep(300);
  check(await p.$('.bul') !== null && await p.$eval('.cartes-lb', (e) => !e.offsetParent), 'bulletin complet à la place du classement');
  check(await p.evaluate(() => document.activeElement?.id) === 'bul-title', 'focus sur le titre du bulletin');
  const full = await p.$eval('.bul', (e) => e.innerText);
  check(/412.380/.test(full) && /\+3,1 %/.test(full), 'grand chiffre et variation');
  check(await p.$$eval('.bul-spark polyline', (x) => x.length) === 1 && (await p.$eval('.bul-spark polyline', (x) => x.getAttribute('points'))).split(' ').length === 8, 'courbe SVG de 8 points');
  check(await p.$$eval('.bul-tile', (x) => x.length) === 6, '6 rubriques');
  check(/Un membre discret/.test(full) && !/paillettes\s*:\s*\d/i.test(full), 'recycleur anonyme, aucun solde de membre');
  check(/Cagnotte « Un booster Raclette/.test(full), 'ligne de la cagnotte');
  await p.click('[data-bul="consent"]');
  await sleep(300);
  const c = (await log(p)).find((l) => l[1] === 'hg_eco_public_set');
  check(c && c[2].p_on === true, 'accord envoyé (hg_eco_public_set)');
  await p.click('[data-bul="week"][data-week="2026-10-12"]');
  await sleep(300);
  check(/N° 11/.test(await p.$eval('.bul-kicker', (e) => e.innerText)) && /Semaine calme/.test(await p.$eval('.bul-lead', (e) => e.innerText)), 'archive : numéro 11 affiché');
  const small = await p.$$eval('.bul button, .bul-consent', (els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
  check(small === 0, 'cibles ≥ 44 px');
  await p.click('[data-bul="back"]');
  await sleep(300);
  check(await p.$eval('.cartes-lb', (e) => !!e.offsetParent) && await p.$('.bul-teaser') !== null, 'retour : classement et carte d’appel');
  check(p.errs.length === 0, `aucune erreur (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  const n = await openPage(browser, { page: 'cartes', fixture: F, width: 360, height: 800, scenario: { bulletin: true }, hash: '#classement' });
  await sleep(500);
  await n.click('[data-bul="open"]');
  await sleep(300);
  check(await hscroll(n) === 0, '360 px : pas de défilement horizontal');
  await n.screenshot({ path: path.join(__dirname, '..', '..', 'shots', 'c15-bulletin-360.png'), fullPage: true });
  await n.ctx.close();

  await browser.close();
  finish();
})();
