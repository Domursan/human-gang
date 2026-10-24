// Parcours C5 (migration 080) : transformer un moment de l'historique en carte.
// 1. Admin › Souvenirs : le détail d'un moment propose « Créer une carte » (permission « cartes »).
// 2. Fenêtre préremplie : nom = titre, famille Moment, texte d'ambiance = première phrase, légende = date, rareté suggérée.
// 3. « Créer la carte » insère une carte liée (hg_cards.moment_id) ; le moment affiche ensuite « En carte » et le bouton disparaît.
// 4. Historique : pastille « En carte » sur le moment devenu carte (lien vers la collection).
const { openPage, check, finish, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

const M1 = 'mmmmmmmm-0000-4000-8000-000000000001';
const M3 = 'mmmmmmmm-0000-4000-8000-000000000003';

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'admin', width: 1280, hash: `#camp/souvenirs/${M1}` });
  await p.waitForSelector('#sv-d-head .ui-btn', { timeout: 8000 });
  const btn = p.locator('#sv-d-head .ui-btn', { hasText: 'Créer une carte' });
  check(await btn.count() === 1, '(1) bouton « Créer une carte » dans le détail du moment');
  await btn.click();
  await p.waitForSelector('dialog.sv-card-dlg[open]', { timeout: 5000 });
  const v = await p.evaluate(() => { const E = document.querySelector('dialog.sv-card-dlg form').elements; return { name: E.name.value, flavor: E.flavor.value, cap: E.caption.value, rar: document.querySelector('dialog.sv-card-dlg input[name=rarity]:checked')?.value }; });
  check(v.name === 'Le karaoké de Noël', '(2) nom = titre du moment');
  check(v.flavor === 'Alice a chanté plus fort que tout le monde.', '(2) texte d’ambiance = première phrase');
  check(!!v.cap, `(2) légende = date (${v.cap})`);
  check(v.rar === 'commune', '(2) rareté suggérée selon les réactions');
  check(await p.$('dialog.sv-card-dlg #sv-kc-card .hgc'), '(2) aperçu de la carte');
  await p.screenshot({ path: 'tests/shots/c5-admin.png' });
  await p.click('dialog.sv-card-dlg [type=submit]');
  await sleep(900);
  const ins = (await log(p)).filter((x) => x[0] === 'insert' && x[1] === 'hg_cards').pop();
  check(ins && ins[2].moment_id === M1 && ins[2].family === 'moment' && ins[2].name === 'Le karaoké de Noël', '(3) carte insérée avec moment_id et famille Moment');
  check(!(await p.$('dialog.sv-card-dlg[open]')), '(3) fenêtre fermée');
  await p.waitForSelector('#sv-d-body .sv-incard', { timeout: 5000 }).catch(() => {});
  check(await p.$('#sv-d-body .sv-incard'), '(3) le moment affiche « En carte »');
  check(await p.locator('#sv-d-head .ui-btn', { hasText: 'Créer une carte' }).count() === 0, '(3) plus de bouton « Créer une carte »');
  check(!p.errs.length, '(1) aucune erreur de page ' + p.errs.join(' | '));
  await p.ctx.close();

  p = await openPage(browser, { page: 'historique', width: 1100, scenario: { c080: { hg_cards: [{ id: 'CMO3', set_id: 'SET-HA', number: 7, name: 'Le sapin du lutin', family: 'moment', rarity: 'rare', active: true, moment_id: M3 }] } } });
  await p.waitForSelector(`#moment-${M3}`, { timeout: 8000 });
  check(await p.$(`#moment-${M3} .tl-incard[href="cartes.html#collection"]`), '(4) historique : pastille « En carte »');
  check(!(await p.$(`#moment-${M1} .tl-incard`)), '(4) moment sans carte : pas de pastille');
  check((await hscroll(p)) <= 0, '(4) pas de défilement horizontal');
  check(!p.errs.length, '(4) aucune erreur de page ' + p.errs.join(' | '));
  await p.ctx.close();
  await browser.close();
  finish();
})();
