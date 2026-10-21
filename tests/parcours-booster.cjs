// Parcours : ouvrir le booster gratuit dans cartes.html.
// Faux Supabase : fixtures/fake-sb-cartes.mjs (copie du faux de visuel-carte) gère les données de la
// collection et hg_open_booster. Le code appelle d'abord hg_open_booster_req ; le faux ne le connaît pas,
// il renvoie null, et le site retombe sur hg_open_booster (comportement attendu, testé ici aussi).
// Deux cas : animation normale (tirage « en cours », puis « Tout révéler ») et préférence
// « réduire les animations » (cartes affichées tout de suite).
// Lancer : node tests/parcours-booster.cjs
const { ROOT, check, finish, openPage, log, chromium } = require('./lib/harness.cjs');

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
  await p.click('[data-action=reveal-all]');
  await p.waitForSelector('[data-action=close-reveal]', { timeout: 5000 }).catch(() => {});
  check(await p.$$eval('#cartes-reveal .op-front .hgc', (x) => x.length) === 5, 'tout révéler : 5 cartes face visible en éventail');
  check(/Meilleure carte/.test(await p.textContent('#cartes-reveal').catch(() => '')), 'meilleure carte annoncée');
  check(await p.isVisible('[data-action=close-reveal]'), 'bouton « Fermer » proposé en fin de tirage');
  const journal = await log(p);
  const ouverture = journal.find((l) => l[0] === 'rpc' && l[1] === 'hg_open_booster');
  check(!!ouverture && ouverture[2]?.p_free === true, 'ouverture gratuite envoyée à hg_open_booster (repli)');
  check(!p.errs.length, 'animation normale : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
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

  await browser.close();
  finish();
})();
