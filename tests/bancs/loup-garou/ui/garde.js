const { ouvrir, fermer } = require('./lib.js');
(async () => {
  for (const n of [1, 2]) { const p = await ouvrir(n, ''); await p.waitForTimeout(1500);
    console.log(`J${n}`, p.url().replace('http://localhost:8080/', ''), 'menu LG :', await p.locator('a[href="/pages/jeux/loup-garou.html"]').count()); }
  await fermer();
})();
