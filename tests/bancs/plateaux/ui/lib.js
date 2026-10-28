require('fs').mkdirSync(require('path').join(__dirname, 'shots'), { recursive: true }); // tests/shots absent d'une copie fraîche du dépôt : créé avant les captures.
// Outils des parcours navigateur des jeux de plateau : ouvre <page> pour le joueur n (faux Supabase sur la base locale « plat »).
process.env.FAKE_DB = 'plat';
const { chromium } = require('playwright');
const { attach, log, psql, uid } = require('../../loup-garou/ui/fake.js');
let browser;
async function ouvrir(n, page, path = '', w = 1280) {
  browser = browser || await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, serviceWorkers: 'block' });
  await attach(ctx, n);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[J${n}] pageerror`, e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|404|400/.test(m.text())) console.log(`[J${n}] console`, m.text().slice(0, 300)); });
  await p.goto(`http://localhost:8080/${page}${path}`);
  await p.waitForTimeout(1800);
  return p;
}
const shot = async (p, name, full = true) => { await p.waitForTimeout(600); await p.screenshot({ path: `${__dirname}/shots/${name}.png`, fullPage: full }); };
const fermer = async () => { if (browser) await browser.close(); const l = log.filter((x) => !x.startsWith('rpc inconnue')); if (l.length) console.log('journal :\n' + l.join('\n')); };
/** SQL en superutilisateur ; renvoie le texte (lève en cas d'erreur). */
const su = (sql) => { const r = psql(null, 'reset role; ' + sql); if (!r.ok) throw new Error(r.message); return r.text.trim(); };
module.exports = { ouvrir, shot, fermer, su, uid };
