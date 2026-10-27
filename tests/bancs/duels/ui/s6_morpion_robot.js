// Morpion contre le robot : mon coup s'affiche tout de suite (avant la réponse du serveur), la réponse du robot arrive
// un instant après, et la croix a bien ses deux traits. Captures dans tests/bancs/duels/ui/shots (s6-*).
const { ouvrir, shot, fermer, psql, uid } = require('./lib.js');
const q = (n, sql) => { const r = psql(uid(n), sql); if (!r.ok) throw new Error(r.message); return r.text; };
let ok = 0, ko = 0;
const check = (c, m) => { if (c) { ok++; console.log('OK     ' + m); } else { ko++; console.log('ECHEC  ' + m); } };
(async () => {
  const c = JSON.parse(q(2, `select to_jsonb(hg_duel_creer('{"jeu":"morpion","variante":"classique","adversaire":"robot","robot":1,"commence":"moi"}'::jsonb))`));
  const a = await ouvrir(2, `#partie/${c}`, 390);
  await a.waitForSelector('button.morpion-case:not([disabled])', { timeout: 8000 });
  // Réponse du serveur ralentie de 600 ms pour voir l'affichage provisoire
  // (fetch enveloppé dans la page : page.route + continue passe par le proxy du conteneur et échoue)
  await a.evaluate(() => { const f = window.fetch; window.fetch = async (u, o) => { if (String(u).includes('hg_duel_jouer')) await new Promise((ok) => setTimeout(ok, 600)); return f(u, o); }; });
  await a.click('button.morpion-case[data-case="4"]');
  await a.waitForTimeout(150);
  check(await a.$('span.morpion-case[data-case="4"] svg.morpion-marque') !== null, 'mon coup s’affiche tout de suite, avant la réponse');
  check((await a.$$('span.morpion-case[data-case="4"] svg.morpion-marque path')).length === 2, 'la croix a deux traits séparés');
  await shot(a, 's6-provisoire', false);
  await a.waitForTimeout(900);
  const marques = await a.$$eval('span.morpion-case', (els) => els.length);
  check(marques === 2, `après 450 ms : mon coup et celui du robot affichés (${marques} marques)`);
  await a.waitForTimeout(800);
  await shot(a, 's6-robot', false);
  const pleins = await a.$$eval('svg.morpion-marque path, svg.morpion-marque circle', (els) => els.every((x) => Math.abs(parseFloat(getComputedStyle(x).strokeDashoffset) || 0) < 0.01));
  check(pleins, 'toutes les marques sont entièrement tracées à la fin de l’animation');
  const visibles = await a.$$eval('svg.morpion-marque', (els) => els.every((x) => parseFloat(getComputedStyle(x).opacity) > 0.99));
  check(visibles, 'toutes les marques sont pleinement visibles à la fin de l’animation (apparition terminée)');
  console.log(`${ok} OK, ${ko} ECHEC(S)`);
  await fermer();
})();
