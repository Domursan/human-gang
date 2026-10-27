// Parcours : statistiques d'amitié (idée P6, migration 091).
// (a) Fiche d'un autre membre : encart « Toi et Alice » (sorties, échanges, Secret Santa), conclusion, actions ; 360 px.
// (b) Membre qui masque ses souvenirs : aucun encart. (c) Réglage coupé : aucun encart.
// (d) Sa propre fiche : bouton « Avec qui j'ai le plus de souvenirs » qui déplie la liste privée.
// Faux Supabase : fixtures/fake-sb.mjs + fake-sb-social2.mjs. Lancer : node tests/parcours/compte/parcours-amitie.cjs
const { ROOT, check, finish, openPage, log, chromium } = require('../../lib/harness.cjs');
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  {
    const p = await openPage(browser, { page: 'membre', hash: '', width: 360, height: 900, scenario: { extra: 'fake-sb-social2.mjs' } });
    await p.goto(p.url().replace(/membre\.html.*/, `membre.html?id=${U(2)}`));
    await p.waitForSelector('.fr-card', { timeout: 8000 }).catch(() => {});
    check(await p.isVisible('.fr-card'), '(a) encart « Toi et … » affiché');
    const t = await p.textContent('.fr-card');
    check(/Toi et Alice/.test(t), '(a) titre « Toi et Alice »');
    check(/7\s*sorties ensemble/.test(t) && /Nouvel an 2023 chez Litver/.test(t), '(a) sorties ensemble et première sortie');
    check(/3\s*échanges et 1 don/.test(t) && /« Domu-mobile » contre « Le Tzatzikistan »/.test(t), '(a) échanges, don et dernier échange');
    check(/2023\s*tu lui as offert son cadeau/.test(t), '(a) Secret Santa terminé');
    check(/Duo de sorties/.test(t), '(a) conclusion « Duo de sorties »');
    check(/Visible par toi seul/.test(t) && /depuis 2022/.test(t), '(a) mention « Visible par toi seul » et année commune');
    check(await p.locator('.fr-actions a[href^="/pages/compte/messages.html?to="]').count() === 1, '(a) bouton « Lui écrire »');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '(a) 360 px : pas de défilement horizontal');
    const calls = (await log(p)).filter((l) => l[0] === 'rpc' && l[1] === 'hg_friendship');
    check(calls.length === 1 && calls[0][2].p_other === U(2), '(a) une seule RPC hg_friendship par fiche');
    check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }
  for (const [k, sc, lbl] of [['b', { amitieHidden: true }, 'membre qui masque'], ['c', { amitieOff: true }, 'réglage coupé']]) {
    const p = await openPage(browser, { page: 'membre', scenario: { extra: 'fake-sb-social2.mjs', ...sc } });
    await p.goto(p.url().replace(/membre\.html.*/, `membre.html?id=${U(2)}`));
    await p.waitForSelector('.idc', { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(500);
    check(await p.locator('.fr-card').count() === 0, `(${k}) ${lbl} : aucun encart`);
    check(!p.errs.length, `(${k}) aucune erreur JS` + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }
  {
    const p = await openPage(browser, { page: 'membre', scenario: { extra: 'fake-sb-social2.mjs' } });
    await p.waitForSelector('.fr-top-btn', { timeout: 8000 }).catch(() => {});
    check(await p.locator('.fr-card').count() === 0, '(d) pas d’encart sur sa propre fiche');
    check(await p.getAttribute('.fr-top-btn', 'aria-expanded') === 'false', '(d) bouton de liste privée replié');
    await p.click('.fr-top-btn');
    await p.waitForSelector('.fr-top-item', { timeout: 5000 }).catch(() => {});
    check(await p.locator('.fr-top-item').count() === 2, '(d) liste privée : 2 membres');
    check(/7\s*sorties/.test(await p.textContent('#fr-top-list')), '(d) sorties partagées affichées');
    check(!p.errs.length, '(d) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }
  await browser.close();
  finish();
})();
