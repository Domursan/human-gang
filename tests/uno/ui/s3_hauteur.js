// Table de jeu à différentes hauteurs d'écran : la main doit rester visible sans défiler.
const { ouvrir, shot, fermer, psql, uid } = require('./lib.js');
const q = (n, sql) => { const r = psql(uid(n), sql); if (!r.ok) throw new Error(r.message); return r.text; };
(async () => {
  const code = q(1, `select hg_uno_creer('{"nb_places":6}'::jsonb)`);
  for (const n of [2, 3, 4, 5, 6]) { q(n, `select hg_uno_rejoindre('${code}')`); q(n, `select hg_uno_pret('${code}', true)`); }
  q(1, `select hg_uno_lancer('${code}')`);
  for (const [w, h] of [[1280, 720], [1366, 768], [1920, 1080]]) {
    const p = await ouvrir(1, `#partie/${code}`, w);
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(1500);
    const bas = await p.evaluate(() => { const m = document.querySelector('button.uc'); const r = m?.getBoundingClientRect(); return r ? Math.round(r.bottom) : null; });
    console.log(w + 'x' + h, 'bas de la main', bas, bas !== null && bas <= innerHeightOr(h) ? 'visible' : 'COUPÉE');
    await shot(p, `h-${w}x${h}`, false);
  }
  await fermer();
})().catch(async (e) => { console.log('ERREUR', e.message); await fermer(); process.exit(1); });
function innerHeightOr(h) { return h; }
