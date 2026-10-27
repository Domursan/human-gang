// Parcours C13 · Cagnotte collective de Paillettes (cartes.html, migration 082).
// 1. Sans la migration (fonction absente) : aucun encart, aucune erreur.
// 2. Cagnotte ouverte (téléphone 390 px) : jauge, participants, derniers versements (« Anonyme »), fenêtre de versement,
//    montant rapide, case anonyme, versement envoyé avec un identifiant de demande, solde et encart mis à jour.
// 3. Cagnotte atteinte : message et lien vers l'Inventaire ; cagnotte échouée : remboursement annoncé.
// 4. 360 px : pas de défilement horizontal ; cibles ≥ 44 px.
// Faux Supabase : fixtures/fake-sb-cartes.mjs (scénario pot). Lancer : node tests/parcours/cartes/parcours-c13.cjs
const { openPage, check, finish, hscroll, sleep, log, chromium } = require('../../lib/harness.cjs');

const F = 'fake-sb-cartes.mjs';
(async () => {
  const browser = await chromium.launch();

  // 1. Sans migration
  const a = await openPage(browser, { page: 'cartes', fixture: F, width: 390, height: 900 });
  check(await a.$eval('#cartes-pot', (e) => e.hidden && !e.innerHTML.trim()), 'sans migration : encart caché et vide');
  check(a.errs.length === 0, `sans migration : aucune erreur (${a.errs.join(' | ') || 'rien'})`);
  await a.ctx.close();

  // 2. Cagnotte ouverte
  const p = await openPage(browser, { page: 'cartes', fixture: F, width: 390, height: 900, scenario: { pot: 'ouverte', bal: 900 } });
  check(await p.$eval('#cartes-pot', (e) => !e.hidden), 'cagnotte ouverte : encart visible');
  const txt = await p.$eval('#cartes-pot', (e) => e.innerText);
  check(/Cagnotte du gang/i.test(txt) && /Un booster Raclette/.test(txt), 'eyebrow et titre');
  check(/13.450/.test(txt) && /20.000/.test(txt), 'total et objectif affichés');
  check(/16 participants/.test(txt) && /jours restants/.test(txt), 'participants et temps restant');
  check(await p.$eval('.pot-bar', (b) => b.getAttribute('aria-valuenow')) === '67', 'jauge à 67 % (ARIA)');
  check(await p.$$eval('.pot-row', (r) => r.length) === 4 && /Anonyme/.test(txt), '4 derniers versements, dont un anonyme');
  // Les éléments sont au-dessus des onglets
  check(await p.evaluate(() => document.querySelector('#cartes-pot').compareDocumentPosition(document.querySelector('#cartes-tablist')) & Node.DOCUMENT_POSITION_FOLLOWING), 'encart placé au-dessus des onglets');
  await p.click('[data-pot="open"]');
  await sleep(200);
  check(await p.$('.pot-form') !== null, 'fenêtre de versement ouverte');
  check(await p.$eval('#pot-amount', (i) => document.activeElement === i), 'focus sur le montant');
  await p.click('[data-pot="quick"][data-v="250"]');
  await sleep(100);
  check(await p.$eval('#pot-amount', (i) => i.value) === '250', 'montant rapide 250 appliqué');
  check(await p.$eval('[data-pot="quick"][data-v="250"]', (b) => b.getAttribute('aria-pressed')) === 'true', 'puce 250 marquée (aria-pressed)');
  check(/Confirmer · 250/.test((await p.$eval('.pot-confirm', (b) => b.innerText)).replace(/\s+/g, ' ')), 'bouton « Confirmer · 250 ✦ »');
  const small = await p.$$eval('.pot-form button, .pot-amount, .pot-check', (els) => els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.outerHTML.slice(0, 60)));
  check(small.length === 0, `cibles ≥ 44 px (${small.join(' | ') || 'toutes'})`);
  await p.check('#pot-anon');
  await p.click('.pot-confirm');
  await sleep(500);
  const call = (await log(p)).find((l) => l[0] === 'rpc' && l[1] === 'hg_pot_contribute');
  check(call && call[2].p_amount === 250 && call[2].p_anonymous === true && /^[A-Za-z0-9-]{8,64}$/.test(call[2].p_request || ''), 'versement envoyé : 250, anonyme, identifiant de demande valide');
  check(await p.$('.pot-form') === null, 'fenêtre refermée après le versement');
  check(/Tu as versé/.test(await p.$eval('#cartes-pot', (e) => e.innerText)), '« Tu as versé » affiché');
  check(await p.$$eval('.pot-row', (r) => r.length) === 5, 'nouveau versement en tête de liste (5 au plus)');
  check((await log(p)).filter((l) => l[1] === 'hg_cards_me').length >= 2, 'solde rechargé après le versement');
  check(p.errs.length === 0, `ouverte : aucune erreur (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // 3. Atteinte / échouée
  const r = await openPage(browser, { page: 'cartes', fixture: F, width: 390, height: 900, scenario: { pot: 'atteinte' } });
  const rt = await r.$eval('#cartes-pot', (e) => e.innerText);
  check(/Objectif atteint/.test(rt) && await r.$('[data-tab-go="inventaire"]') !== null && await r.$('[data-pot="open"]') === null, 'atteinte : message, lien Inventaire, plus de bouton Verser');
  await r.click('[data-tab-go="inventaire"]');
  await sleep(300);
  check(await r.$eval('#cartes-tab-inventaire', (t) => t.getAttribute('aria-selected')) === 'true', 'le lien ouvre l’onglet Inventaire');
  await r.ctx.close();
  const f = await openPage(browser, { page: 'cartes', fixture: F, width: 390, height: 900, scenario: { pot: 'echouee' } });
  check(/pas atteint/.test(await f.$eval('#cartes-pot', (e) => e.innerText)), 'échouée : remboursement annoncé');
  await f.ctx.close();

  // 4. 360 px
  const n = await openPage(browser, { page: 'cartes', fixture: F, width: 360, height: 800, scenario: { pot: 'ouverte', bal: 900 } });
  await n.click('[data-pot="open"]');
  await sleep(200);
  check(await hscroll(n) === 0, '360 px : pas de défilement horizontal (fenêtre ouverte)');
  await n.screenshot({ path: require('path').join(__dirname, '..', '..', 'shots', 'c13-cagnotte-360.png'), fullPage: false });
  await n.ctx.close();

  await browser.close();
  finish();
})();
