// Parcours C12 : tableau « Je cherche / Je donne » (onglet Échanges › Tableau).
// Faux Supabase : fixtures/fake-sb-cartes.mjs, scénario c2 (C4 cherchée par moi et Chloé, donnée par Bruno ; C1 donnée par
// moi, cherchée par Alice ; C7 cherchée, personne ne la donne). Contrôles : onglet « Tableau » (ARIA), inscription
// (interrupteur) et petit mot, filtres (« Ce qui m'intéresse », rareté), lignes « Cherchée par » / « Donnée par »,
// « Proposer un échange » ouvre l'éditeur prérempli (exemplaire 201 de Bruno ; mon exemplaire de C1 pour Alice) ;
// 360 px sans défilement ; admin : petits mots listés et effaçables.
// Lancer : node tests/parcours-c12.cjs
const { ROOT, check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');
const txt = (p, sel) => p.textContent(sel).then((t) => (t || '').replace(/\s+/g, ' ').trim()).catch(() => '');
const checked = (p, side) => p.$$eval(`#trd-grid-${side} button[aria-pressed="true"]`, (b) => b.map((x) => x.dataset.id));

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: { c2: true }, width: 360, height: 800 });
  await p.evaluate(() => { location.hash = 'echanges'; }); // la barre d'onglets est masquée : on change d'onglet par l'adresse
  await p.waitForSelector('#trd-tab-tableau', { timeout: 6000 });
  await p.click('#trd-tab-tableau');
  await p.waitForSelector('.c2-brd-row', { timeout: 5000 }).catch(() => {});
  check(await p.getAttribute('#trd-tab-tableau', 'aria-selected') === 'true' && await p.getAttribute('#trd-tab-tableau', 'role') === 'tab', 'onglet « Tableau » sélectionné (ARIA)');
  check(await p.$$eval('.c2-brd-row', (x) => x.length) === 3, '3 cartes sur le tableau');
  const r0 = await txt(p, '.c2-brd-row:nth-child(1)');
  check(/Cherchée par Ethan \(toi\), Chloé/.test(r0) && /Donnée par Bruno \(×1\)/.test(r0), 'ligne 1 : cherchée / donnée');
  check(/personne pour l’instant/.test(await txt(p, '.c2-brd-row:nth-child(3)')) && !(await p.$('.c2-brd-row:nth-child(3) .c2-brd-go')), 'ligne sans donneur : pas de bouton');
  check(/J’échange mes Dorées contre les OG/.test(await txt(p, '.c2-brd-notes')), 'petit mot d’un inscrit affiché');
  check(await hscroll(p) === 0, '360 px : pas de défilement horizontal');
  await p.click('.c2-switch');
  await sleep(400);
  const set = (await log(p)).find((l) => l[1] === 'hg_trade_board_set');
  check(set && set[2].p_on === true, 'inscription : hg_trade_board_set(true)');
  check(await p.isVisible('#c2-brd-note'), 'inscrit : champ du petit mot');
  await p.fill('#c2-brd-note', 'Je cherche les cartes LoL');
  await p.click('.c2-brd-note button[type=submit]');
  await sleep(400);
  check((await log(p)).filter((l) => l[1] === 'hg_trade_board_set').at(-1)[2].p_note === 'Je cherche les cartes LoL', 'petit mot envoyé');
  await p.click('[data-c2=brd-mine]');
  await sleep(300);
  check(await p.getAttribute('[data-c2=brd-mine]', 'aria-pressed') === 'true' && await p.$$eval('.c2-brd-row', (x) => x.length) === 2, '« Ce qui m’intéresse » : 2 cartes');
  await p.selectOption('#c2-brd-rar', 'peu_commune');
  await sleep(300);
  check(await p.$$eval('.c2-brd-row', (x) => x.length) === 1, 'filtre rareté : 1 carte');
  await p.click('.c2-brd-row .c2-brd-go');
  await p.waitForSelector('#trd-edit[open]', { timeout: 5000 }).catch(() => {});
  check(/Bruno/.test(await txt(p, '#trd-edit-title')) && JSON.stringify(await checked(p, 'want')) === '["201"]', 'Proposer : éditeur pour Bruno, exemplaire 201 demandé');
  await p.keyboard.press('Escape');
  await sleep(200);
  await p.selectOption('#c2-brd-rar', '');
  await sleep(300);
  await p.locator('.c2-brd-row', { hasText: 'Alice' }).locator('.c2-brd-go').click();
  await p.waitForSelector('#trd-edit[open]', { timeout: 5000 }).catch(() => {});
  const give = await checked(p, 'give');
  check(/Alice/.test(await txt(p, '#trd-edit-title')) && give.length === 1 && ['1', '2', '3'].includes(give[0]), `Proposer : je donne un de mes C1 à Alice (${give})`);
  await p.keyboard.press('Escape');
  check(!p.errs.length, 'cartes : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', scenario: { c2: true }, width: 1280, height: 900 });
  await adminSection(p, 'cartes/echanges');
  await p.waitForSelector('#acd-brd-notes .acd-item', { timeout: 5000 }).catch(() => {});
  check(/David/.test(await txt(p, '#acd-brd-notes')), 'admin : petit mot de David listé');
  await p.click('[data-act=board-note-clear]');
  await p.waitForSelector('dialog.hg-dialog[open]', { timeout: 3000 });
  await p.click('dialog.hg-dialog[open] button[value=ok]');
  await sleep(500);
  check((await log(p)).some((l) => l[1] === 'hg_trade_board_note_clear' && l[2].p_user === '00000005-0000-4000-8000-000000000005'), 'admin : hg_trade_board_note_clear(David)');
  check(!p.errs.length, 'admin : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await browser.close();
  finish();
})();
