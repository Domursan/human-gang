// Outils des parcours navigateur du Uno : ouvre /pages/jeux/uno.html pour le joueur n (faux Supabase sur la base locale « uno »).
process.env.FAKE_DB = 'uno';
const { chromium } = require('playwright');
const { attach, log, psql, uid } = require('../../loup-garou/ui/fake.js');
let browser;
async function ouvrir(n, path, w = 1280) {
  browser = browser || await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, serviceWorkers: 'block' });
  await attach(ctx, n);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[J${n}] pageerror`, e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|404|400/.test(m.text())) console.log(`[J${n}] console`, m.text().slice(0, 300)); });
  await p.goto('http://localhost:8080/pages/jeux/uno.html' + path);
  await p.waitForTimeout(1800);
  return p;
}
const shot = async (p, name, full = true) => { await p.waitForTimeout(600); await p.screenshot({ path: `${__dirname}/shots/${name}.png`, fullPage: full }); };
const fermer = async () => { if (browser) await browser.close(); const l = log.filter((x) => !x.startsWith('rpc inconnue')); if (l.length) console.log('journal :\n' + l.join('\n')); };
module.exports = { ouvrir, shot, fermer, psql, uid };
