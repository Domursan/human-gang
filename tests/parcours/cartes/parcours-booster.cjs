// Parcours : ouvrir le booster gratuit dans cartes.html.
// Faux Supabase : fixtures/fake-sb-cartes.mjs (copie du faux de visuel-carte) gère les données de la
// collection et hg_open_booster_req. Le site n'appelle plus l'ancienne hg_open_booster (migration 074 : plus de repli).
// Deux cas : animation normale (tirage « en cours », puis « Tout révéler ») et préférence
// « réduire les animations » (cartes affichées tout de suite).
// Lancer : node tests/parcours/cartes/parcours-booster.cjs
const { ROOT, check, finish, openPage, log, chromium } = require('../../lib/harness.cjs');

const GRILLE = '#cartes-reveal .cartes-booster-grid .hgc'; // grille affichée sans animation

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  // 1. Animation normale : on passe la séquence avec « Tout révéler ».
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280 });
  await p.click('[data-tab=boosters]').catch(() => {});
  check(await p.isVisible('[data-action=open-free]'), 'booster gratuit proposé');
  await p.click('[data-action=open-free]');
  await p.waitForSelector('[data-action=reveal-all]', { timeout: 5000 }).catch(() => {});
  check(await p.isVisible('[data-action=reveal-all]'), 'animation d\'ouverture en cours avec « Tout révéler »');
  check(await p.evaluate(() => document.activeElement?.dataset?.action === 'reveal-all'), 'Q7 : le focus est sur « Tout révéler » dès le début');
  await p.click('[data-action=reveal-all]');
  await p.waitForSelector('[data-action=close-reveal]', { timeout: 5000 }).catch(() => {});
  check(await p.$$eval('#cartes-reveal .op-front .hgc', (x) => x.length) === 5, 'tout révéler : 5 cartes face visible en éventail');
  check(/Meilleure carte/.test(await p.textContent('#cartes-reveal').catch(() => '')), 'meilleure carte annoncée');
  check(await p.isVisible('[data-action=close-reveal]'), 'bouton « Fermer » proposé en fin de tirage');
  // Q7 : résumé par rareté (pastilles avec texte) et annonce complète, une seule fois
  const live = await p.textContent('#cartes-live');
  check(/^Booster ouvert\. 5 cartes : .*\d+ (commune|peu commune|rare|épique|légendaire|mythique)/.test(live), 'Q7 : annonce « 5 cartes : … » avec les comptes par rareté (' + live + ')');
  check(/nouvelles? pour ta collection/.test(live) || !(await p.$('.rv-new')), 'Q7 : nouvelles cartes annoncées si présentes');
  check(await p.locator('#cartes-reveal .rv-sum .rv-chip').count() >= 1, 'Q7 : pastilles du résumé visibles');
  check(await p.evaluate(() => [...document.querySelectorAll('.rv-chip')].every((c) => c.textContent.trim().length > 0)), 'Q7 : chaque pastille a son texte (lisible en mode daltonien)');
  check(await p.evaluate(() => document.activeElement?.dataset?.action === 'close-reveal'), 'Q7 : en fin d\'ouverture, le focus est sur « Fermer »');
  check(await p.locator('#cartes-reveal [data-change="reveal-direct"]').count() === 1, 'Q7 : interrupteur « Révéler mes boosters d\'un coup » sous le résultat');
  const journal = await log(p);
  const ouverture = journal.find((l) => l[0] === 'rpc' && l[1] === 'hg_open_booster_req');
  check(!!ouverture && ouverture[2]?.p_free === true && typeof ouverture[2]?.p_request === 'string', 'ouverture gratuite envoyée à hg_open_booster_req (p_free, id de demande)');
  check(!journal.some((l) => l[0] === 'rpc' && l[1] === 'hg_open_booster'), 'pas d\'appel à l\'ancienne hg_open_booster');
  check(!p.errs.length, 'animation normale : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 1 bis. Q7 : préférence « Révéler mes boosters d'un coup » : pas de séquence, même avec les animations permises.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280 });
  await p.evaluate(() => localStorage.setItem('hg_prefs', JSON.stringify({ revealDirect: true })));
  await p.reload();
  await p.click('[data-tab=boosters]').catch(() => {});
  await p.waitForSelector('[data-action=open-free]', { timeout: 8000 }).catch(() => {});
  await p.click('[data-action=open-free]');
  await p.waitForSelector(GRILLE, { timeout: 5000 }).catch(() => {});
  check(await p.$$eval(GRILLE, (x) => x.length) === 5 && !(await p.$('.op-stage')), 'Q7 : révélation directe : 5 cartes, pas de .op-stage');
  check(await p.isChecked('#cartes-reveal [data-change="reveal-direct"]'), 'Q7 : interrupteur coché sous le résultat');
  check(/^Booster ouvert\. 5 cartes/.test(await p.textContent('#cartes-live')), 'Q7 : annonce faite en révélation directe');
  await p.uncheck('#cartes-reveal [data-change="reveal-direct"]');
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('hg_prefs')).revealDirect === false), 'Q7 : décocher sous le résultat coupe la préférence');
  check(!p.errs.length, 'révélation directe : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 2. Réduire les animations : pas de séquence, les 5 cartes sont là dès la réponse.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, reducedMotion: 'reduce' });
  await p.click('[data-tab=boosters]').catch(() => {});
  await p.click('[data-action=open-free]');
  await p.waitForSelector(GRILLE, { timeout: 5000 }).catch(() => {});
  check(await p.$$eval(GRILLE, (x) => x.length) === 5, 'réduire les animations : 5 cartes affichées directement');
  check(!(await p.$('[data-action=reveal-all]')), 'réduire les animations : pas de séquence à passer');
  check(!p.errs.length, 'réduire les animations : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 3. Le booster gratuit du jour n'est plus le Classique (réglage admin « gratuit chaque jour » sur le Doré) :
  //    le site ouvre le bon type au lieu de recevoir « Ce booster ne s'ouvre pas gratuitement ».
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, reducedMotion: 'reduce',
    scenario: { types: true, bal: 600, typeOverrides: { classique: { free_daily: false }, dore: { free_daily: true } } } });
  await p.click('[data-tab=boosters]').catch(() => {});
  await p.waitForSelector('[data-action=open-free]', { timeout: 8000 }).catch(() => {});
  check(/DOR/i.test(await p.textContent('#cartes-free .cart-lbl2').catch(() => '')), 'gratuit réglé sur le Doré : la cartouche du gratuit montre le Doré');
  await p.click('[data-action=open-free]');
  await p.waitForSelector(GRILLE, { timeout: 5000 }).catch(() => {});
  const call = (await log(p)).filter((l) => l[1] === 'hg_booster_open').pop();
  check(call && call[2].p_type === 'dore' && call[2].p_mode === 'gratuit', `gratuit réglé sur le Doré : hg_booster_open(dore, gratuit) (${JSON.stringify(call && call[2])})`);
  check(!p.errs.length, 'gratuit Doré : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
