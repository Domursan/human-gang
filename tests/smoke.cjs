// Test de fumée : chaque page publique, en 1280 px et 375 px.
// Une page passe si elle se charge sans erreur JS, sans 404 et sans défilement horizontal.
// Lancer : node tests/smoke.cjs   (HG_ROOT=<dossier> pour tester un autre checkout)
const { ROOT, SHOTS, check, finish, openPage, hscroll, chromium } = require('./lib/harness.cjs');
const path = require('path');

const PAGES = ['cartes', 'evenements', 'rejoindre', 'index', 'accueil', 'compte', 'secret-santa', 'irl', 'historique', 'admin', 'assistance', 'legal', 'messages', 'membre', 'recap'];
const SHOT_PAGES = ['accueil', 'messages', 'membre'];

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  for (const pg of PAGES) {
    for (const w of [1280, 375]) {
      const p = await openPage(browser, { page: pg, width: w });
      const hs = await hscroll(p);
      const errs = p.errs.join(' | ');
      check(!p.errs.length && hs <= 0, `${pg} ${w} url=${p.url().replace(/^.*hg\.test\//, '')} hscroll=${hs}${errs ? ' ' + errs : ''}`);
      if (w === 1280 && SHOT_PAGES.includes(pg)) await p.screenshot({ path: path.join(SHOTS, `smoke-${pg}.png`) });
      await p.ctx.close();
    }
  }
  await browser.close();
  finish();
})();
