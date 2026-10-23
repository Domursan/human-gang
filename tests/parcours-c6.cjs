// Parcours C6 (migration 080) : série « Campagne Serge » et propositions de cartes.
// 1. Collection : encart « Proposer une carte » quand une série accepte des propositions ; mes propositions et leur état.
// 2. Formulaire : nom, famille, phrase, blason (couleurs en pastilles, figure), aperçu en direct ; envoi = hg_card_proposal_submit.
// 3. Retirer une proposition en attente : hg_card_proposal_cancel.
// 4. Admin › Séries : « Propositions des membres » ; Accepter appelle hg_card_proposal_review (rareté, image du blason).
// 5. Téléphone 360 px : formulaire sans défilement horizontal.
const { openPage, check, finish, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const SERGE = { id: 'SETCS', code: 'campagne-serge', name: 'Campagne Serge', description: null, starts_at: null, ends_at: null, active: false, sort: 920, proposals_open: true };
const BL = { colors: ['#9E3543', '#E2C77E', '#F2EFEA'], figure: 'lune', partition: 'plein' };
const PROPS = [
  { id: 'P1', set_id: 'SETCS', proposed_by: ME, payload: { name: 'Comté d’Ajaccio', family: 'lieu', blason: BL }, status: 'en_attente', created_at: new Date().toISOString() },
  { id: 'P2', set_id: 'SETCS', proposed_by: ME, payload: { name: 'Duché de Toscane', family: 'lieu' }, status: 'acceptee', created_at: new Date().toISOString() },
];

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: { c080: { hg_card_sets: [SERGE], hg_card_proposals: PROPS } }, hash: '#collection', width: 1100 });
  await p.waitForSelector('#cartes-propose', { timeout: 8000 });
  const box = await p.textContent('#cartes-propose');
  check(box.includes('Campagne Serge'), '(1) encart : série ouverte aux propositions');
  check(box.includes('Comté d’Ajaccio') && box.includes('En attente') && box.includes('Acceptée'), '(1) mes propositions et leur état');
  await p.click('#cartes-propose [data-prop-open]');
  await p.waitForSelector('#cartes-prop-dlg[open]', { timeout: 5000 });
  await p.fill('#prop-name', 'Comté de Zadar');
  await p.fill('#prop-flavor', 'Ici, on ne fuit pas : on négocie.');
  await p.click('#cartes-prop-dlg .prop-swatch:has(input[value="#4E2398"]) >> nth=0');
  await p.click('#cartes-prop-dlg .prop-fig:has(input[value="etoile"])');
  await sleep(200);
  check((await p.textContent('#prop-prev')).includes('Comté de Zadar'.toUpperCase()) || (await p.getAttribute('#prop-prev .hgc', 'aria-label')).includes('Comté de Zadar'), '(2) aperçu en direct');
  check(/^data:image\/svg\+xml/.test(await p.getAttribute('#prop-prev .hgc-win-img', 'src')), '(2) aperçu du blason');
  await p.screenshot({ path: 'tests/shots/c6-formulaire.png' });
  await p.click('#prop-send');
  await sleep(600);
  const sub = (await log(p)).filter((x) => x[0] === 'rpc' && x[1] === 'hg_card_proposal_submit').pop();
  check(sub && sub[2].p_set === 'SETCS' && sub[2].p.name === 'Comté de Zadar' && sub[2].p.blason.figure === 'etoile' && sub[2].p.blason.colors[0] === '#4E2398',
    `(2) hg_card_proposal_submit : ${JSON.stringify(sub && sub[2].p)}`);
  check(!(await p.$('#cartes-prop-dlg[open]')), '(2) fenêtre fermée après l’envoi');
  await p.click('#cartes-propose [data-prop-cancel="P1"]');
  await sleep(500);
  const can = (await log(p)).filter((x) => x[0] === 'rpc' && x[1] === 'hg_card_proposal_cancel').pop();
  check(can && can[2].p_id === 'P1', '(3) hg_card_proposal_cancel');
  await p.evaluate(() => { location.hash = 'boutique'; }); // la barre d'onglets est masquée : on change d'onglet par l'adresse
  await p.waitForSelector('#cartes-p-boutique:not([hidden])', { timeout: 5000 });
  await sleep(300);
  check(await p.$eval('#cartes-propose', (el) => getComputedStyle(el).display === 'none'), '(1) encart caché hors de l’onglet Collection');
  check(!p.errs.length, '(1) aucune erreur de page ' + p.errs.join(' | '));
  await p.ctx.close();

  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: { c080: { hg_card_sets: [SERGE], hg_card_proposals: [] } }, hash: '#collection', width: 360, height: 780 });
  await p.waitForSelector('#cartes-propose [data-prop-open]', { timeout: 8000 });
  await p.click('#cartes-propose [data-prop-open]');
  await p.waitForSelector('#cartes-prop-dlg[open]', { timeout: 5000 });
  const over = await p.$eval('#cartes-prop-dlg', (d) => d.scrollWidth - d.clientWidth);
  check(over <= 0 && (await hscroll(p)) <= 0, `(5) 360 px : formulaire sans défilement horizontal (${over})`);
  await p.ctx.close();

  // Admin : la proposition d'un autre membre, acceptée.
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1280,
    scenario: { c080: { hg_card_sets: [SERGE], hg_card_proposals: [{ ...PROPS[0], proposed_by: U(2) }] } } });
  await adminSection(p, 'cartes/series');
  await p.waitForSelector('.acd-prop', { timeout: 8000 });
  check((await p.textContent('.acd-props')).includes('proposée par Alice'), '(4) proposition listée avec son auteur');
  await p.selectOption('.acd-prop [data-prop-rar]', 'epique');
  await p.click('.acd-prop [data-prop-ok]');
  await sleep(1200);
  const rev = (await log(p)).filter((x) => x[0] === 'rpc' && x[1] === 'hg_card_proposal_review').pop();
  check(rev && rev[2].p_accept === true && rev[2].p.rarity === 'epique' && !!rev[2].p.image_url, `(4) hg_card_proposal_review : ${JSON.stringify(rev && rev[2])}`);
  check(!p.errs.length, '(4) aucune erreur de page ' + p.errs.join(' | '));
  await p.ctx.close();
  await browser.close();
  finish();
})();
