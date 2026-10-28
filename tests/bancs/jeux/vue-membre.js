require('fs').mkdirSync(require('path').join(__dirname, 'shots'), { recursive: true }); // tests/shots absent d'une copie fraîche du dépôt : créé avant les captures.
// Captures de la page Jeux vue par un membre non-admin (ordinateur et téléphone), images chargées.
process.env.FAKE_DB = 'uno';
const { chromium } = require('playwright');
const { attach } = require('../loup-garou/ui/fake.js');
(async () => {
  const b = await chromium.launch();
  for (const [w, nom] of [[1280, 'membre-ordi'], [390, 'membre-tel']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, serviceWorkers: 'block', deviceScaleFactor: 2 });
    await attach(ctx, 2);
    const p = await ctx.newPage();
    await p.goto('http://localhost:8080/pages/jeux/jeux.html'); await p.waitForTimeout(2500);
    await p.evaluate(() => document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; }));
    await p.waitForTimeout(800);
    console.log(nom, await p.$$eval('.jx-carte:not([hidden]) .jx-t', (xs) => xs.map((x) => x.textContent).join(', ')));
    await p.screenshot({ path: `${__dirname}/shots/${nom}.png`, fullPage: true });
    await ctx.close();
  }
  await b.close();
})();
