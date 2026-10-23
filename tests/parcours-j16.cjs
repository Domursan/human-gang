// Parcours : idée J16, saisons de classement (onglet « Saisons » de jeux.html et encart de l'accueil, paquet xJ4).
// Compte à rebours, mon rang et ligue des nouveaux, points de la semaine par catégorie avec plafonds, palier, top
// général et ligue des nouveaux (onglets ARIA), encart « Ton rang de saison » sur l'accueil ; 390 et 360 px.
// Faux Supabase : fixtures/fake-sb.mjs (hg_season_board).
const { check, finish, openPage, hscroll, log, chromium } = require('./lib/harness.cjs');

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'jeux', hash: '#saison', width: 390, height: 900 });
  await p.waitForSelector('.ssn', { timeout: 5000 }).catch(() => {});
  check((await p.getAttribute('#jeux-tab-saison', 'aria-selected')) === 'true', 'onglet : « Saisons » sélectionné');
  check((await p.locator('.ssn-label').innerText()).includes('Saison d’automne 2026'), 'saison : libellé');
  check(/encore \d+ jours/.test(await p.locator('.ssn-head .pill').innerText()), 'saison : compte à rebours');
  check((await p.locator('.ssn-big').innerText()) === '4e' && (await p.locator('.ssn-mid').innerText()).includes('540'), 'mon rang : 4e, 540 pts');
  check((await p.locator('.ssn-nouveau').innerText()).includes('1er de la ligue des nouveaux'), 'mon rang : 1er de la ligue des nouveaux');
  check((await p.locator('.ssn-me').innerText()).includes('+129 cette semaine'), 'mon rang : +129 cette semaine (somme des catégories)');
  check((await p.locator('.ssn-cat').count()) === 6, 'semaine : 6 catégories');
  check((await p.locator('.ssn-cat').first().innerText()).includes('38') && (await p.locator('.ssn-cat').first().innerText()).includes('/ 50 cette semaine'), 'semaine : « 38 / 50 cette semaine » pour le quiz');
  check((await p.locator('.ssn-cat .ssn-bar.is-full').count()) === 1, 'semaine : la catégorie au plafond (défis 15/15) est marquée');
  check((await p.locator('.ssn-palier').innerText()).includes('Palier atteint'), 'palier : atteint (540 ≥ 100)');
  check((await p.locator('#ssn-l .ssn-row').count()) === 5 && (await p.locator('#ssn-l .ssn-row.is-me').innerText()).includes('2e gen'), 'classement général : 5 lignes, ma ligne marquée « 2e gen »');
  await p.click('#ssn-t-nouveaux');
  check((await p.getAttribute('#ssn-t-nouveaux', 'aria-selected')) === 'true' && (await p.locator('#ssn-l .ssn-row').count()) === 2, 'ligue des nouveaux : onglet sélectionné, 2 lignes');
  await p.focus('#ssn-t-nouveaux');
  await p.keyboard.press('ArrowLeft');
  check((await p.getAttribute('#ssn-t-general', 'aria-selected')) === 'true', 'clavier : flèche gauche revient au classement général');
  check(await hscroll(p) <= 0, '390 px : pas de défilement horizontal');
  check(p.errs.length === 0, 'aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  // Navigation au clavier entre onglets de la page
  await p.focus('#jeux-tab-saison');
  await p.keyboard.press('ArrowLeft');
  check((await p.getAttribute('#jeux-tab-bataille', 'aria-selected')) === 'true' && (await p.evaluate(() => location.hash)) === '#bataille', 'page Jeux : flèche gauche → onglet suivant, adresse à jour');
  await p.ctx.close();

  p = await openPage(browser, { page: 'jeux', hash: '#saison', width: 360, height: 800 });
  await p.waitForSelector('.ssn', { timeout: 5000 }).catch(() => {});
  check(await hscroll(p) <= 0, '360 px : pas de défilement horizontal');
  check((await p.$$eval('.ssn-chip', (bs) => bs.map((b) => b.getBoundingClientRect().height))).every((h) => h >= 44), 'cibles : onglets du classement ≥ 44 px');
  await p.ctx.close();

  // Accueil : encart « Ton rang de saison »
  p = await openPage(browser, { page: 'accueil', width: 390, height: 900 });
  await p.waitForSelector('.home-saison', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.home-saison').count()) === 1 && (await p.locator('.home-saison').innerText()).includes('Ton rang de saison : 4e'), 'accueil : encart « Ton rang de saison : 4e »');
  check((await p.getAttribute('.home-saison', 'href')) === 'jeux.html#saison', 'accueil : lien vers jeux.html#saison');
  check((await p.locator('#soiree').isHidden()), 'accueil : pas de tuile de soirée sans soirée prévue');
  check(await hscroll(p) <= 0, 'accueil 390 px : pas de défilement horizontal');
  check(p.errs.length === 0, 'accueil : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
