const { chromium } = require('playwright');
const { attach, log } = require('./fake.js');
(async () => {
  const b = await chromium.launch();
  const [path, n, w, name] = [process.argv[2] || '', +(process.argv[3] || 1), +(process.argv[4] || 1280), process.argv[5] || 'shot'];
  const ctx = await b.newContext({ viewport: { width: w, height: w < 600 ? 800 : 900 }, serviceWorkers: 'block' });
  await attach(ctx, n);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('console', m.type(), m.text().slice(0, 300)); });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto('http://localhost:8080/pages/jeux/loup-garou.html' + path);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `shots/${name}.png`, fullPage: true });
  console.log(log.join('\n'));
  await b.close();
})();
