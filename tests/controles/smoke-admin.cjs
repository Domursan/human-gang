// Test de fumée de l'espace admin (/pages/admin/admin.html), en 1280 px et 375 px, avec le faux Supabase.
// Lancer : node tests/controles/smoke-admin.cjs
const { ROOT, check, finish, openPage, hscroll, chromium } = require('../lib/harness.cjs');

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  for (const w of [1280, 375]) {
    const p = await openPage(browser, { page: 'admin', width: w });
    const hs = await hscroll(p);
    const errs = p.errs.join(' | ');
    check(!p.errs.length && hs <= 0, `admin ${w} url=${p.url().replace(/^.*hg\.test\//, '')} hscroll=${hs}${errs ? ' ' + errs : ''}`);
    await p.ctx.close();
  }
  await browser.close();
  finish();
})();
