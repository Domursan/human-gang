// Admin › Vie du gang › Secret Santa : « Afficher les attributions » fonctionne sans être passé par la section Comptes.
// Lancer : node tests/parcours-ss-attributions.cjs   (NODE_PATH et PLAYWRIGHT_BROWSERS_PATH : voir tests/README.md)
const { check, finish, openPage, adminSection, chromium } = require('./lib/harness.cjs');
(async () => {
  const browser = await chromium.launch();
  const p = await openPage(browser, { page: 'admin', hash: '#vie/secret-santa/E24' });
  await adminSection(p, 'vie/secret-santa/E24').catch(() => {});
  const btn = p.locator('[data-pairs="show"]').first();
  await btn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  check(await btn.count() === 1, 'bouton « Afficher les attributions » présent');
  await btn.click();
  await p.waitForFunction(() => { const b = document.querySelector('#ss-pairs-body'); return b && !b.hidden; }, null, { timeout: 8000 }).catch(() => {});
  check(await p.locator('#ss-pairs-body').isVisible(), 'les attributions s\'affichent au clic');
  check(await p.locator('[data-pairs="hide"]').count() === 1, 'le bouton devient « Masquer »');
  await p.locator('[data-pairs="hide"]').click();
  check(await p.locator('#ss-pairs-body').isHidden(), 'masquées au second clic');
  check(!p.errs.filter((e) => !/^404 /.test(e)).length, 'aucune erreur console : ' + p.errs.join(' | '));
  await browser.close(); finish();
})();
