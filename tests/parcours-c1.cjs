// Parcours C1 (migration 080) : booster « Saison esport » à fenêtre de vente.
// 1. Boutique : l'article « Saison esport » (cartouche cart--esport, « Encore 12 j », « Série « Soirée match » uniquement »),
//    achat qui appelle hg_booster_buy (p_type worlds_2026).
// 2. Un type dont la saison est finie n'est plus dans la Boutique, mais son stock reste ouvrable (onglet Ouverture).
// 3. « Dernière fournée » les trois derniers jours.
// 4. Le choix de série du booster « Série » ne propose pas la série réservée.
// 5. Admin : sous-section « Saison et horaires » de l'éditeur ; la fin de vente part dans hg_booster_type_save.
// 6. Téléphone 360 px : pas de défilement horizontal.
// Faux Supabase : fake-sb-cartes.mjs (types: true, scénario c080) et fake-sb.mjs (admin).
const { openPage, check, finish, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();
const RATES = { commune: 60, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.88, mythique: 0.1, identite: 0.02 };
const base = { price: 150, size: 5, rates: RATES, shiny_rate: 3, pity_epique: 10, pool: 'tous', weekly_limit: 3, free_daily: false, active: true };
const scenario = (until) => ({
  types: true, bal: 5000, stock: { worlds_2025: 2, serie: 1 },
  c080: {
    hg_card_sets: [{ id: 'SETSM', code: 'soiree-match', name: 'Soirée match', description: null, starts_at: null, ends_at: null, active: true, sort: 900, booster_scope: 'saison' }],
    hg_cards: [{ id: 'CSM1', set_id: 'SETSM', number: 1, name: 'La pancarte « KC > G2 »', family: 'objet', rarity: 'epique', image_url: 'assets/cards/soiree-match/001.png', flavor: 'Brandie à chaque but.', can_shiny: true, tradeable: true, craftable: true, max_copies: null, active: true }],
    hg_booster_types: [
      { ...base, id: 'worlds_2026', name: 'Saison esport', style: 'cart--esport', sort: 95, description: 'Worlds puis playoffs LEC. Série « Soirée match » uniquement.',
        only_set: 'soiree-match', only_set_name: 'Soirée match', available_until: until, on_shelf: true, open_now: true },
      { ...base, id: 'worlds_2025', name: 'Saison esport 2025', style: 'cart--esport', sort: 96, available_until: iso(-30), on_shelf: false, open_now: false },
    ],
  },
});

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: scenario(iso(12.2)), hash: '#boutique', width: 1100 });
  await p.waitForSelector('#cartes-p-boutique .shop-item', { timeout: 8000 });
  const art = '#cartes-p-boutique .shop-item[data-type="worlds_2026"]';
  check(await p.$(art), '(1) article « Saison esport » dans la Boutique');
  check(await p.$(`${art} .cart-box.cart--esport`), '(1) cartouche au style esport');
  const badge = (await p.textContent(`${art} .shop-badge`)) || '';
  check(/Encore 12 j \d\d h/.test(badge), `(1) compte à rebours « ${badge.trim()} »`);
  check((await p.textContent(art)).includes('Soirée match'), '(1) série unique annoncée');
  check(!(await p.$('#cartes-p-boutique .shop-item[data-type="worlds_2025"]')), '(2) saison finie : absente de la Boutique');
  await p.click(`${art} [data-action="buy-stock"]`);
  await sleep(600);
  const buy = (await log(p)).filter((x) => x[0] === 'rpc' && x[1] === 'hg_booster_buy').pop();
  check(buy && buy[2].p_type === 'worlds_2026', '(1) achat : hg_booster_buy avec p_type worlds_2026');
  await p.screenshot({ path: 'tests/shots/c1-boutique.png', fullPage: false });
  await p.click('#cartes-tab-ouverture');
  await sleep(500);
  check(await p.$('[data-stock-type="worlds_2025"]'), '(2) stock d’une saison finie : tuile d’ouverture présente');
  // (4) série réservée absente du choix de série
  await p.click('[data-stock-type="serie"] [data-action="open-stock"]');
  await p.waitForSelector('#cartes-serie-pick[open]', { timeout: 5000 });
  const sets = await p.evaluate(() => [...document.querySelectorAll('#cartes-serie-list input')].map((i) => i.value));
  check(sets.length > 0 && !sets.includes('SETSM'), `(4) la série réservée n’est pas proposée au booster « Série » (${sets.join(', ')})`);
  await p.keyboard.press('Escape');
  check(!p.errs.length, '(1) aucune erreur de page ' + p.errs.join(' | '));
  await p.ctx.close();

  // (3) Dernière fournée et (6) téléphone
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: scenario(iso(2.1)), hash: '#boutique', width: 360, height: 780 });
  await p.waitForSelector('#cartes-p-boutique .shop-item', { timeout: 8000 });
  const b2 = (await p.textContent('#cartes-p-boutique .shop-item[data-type="worlds_2026"] .shop-badge')) || '';
  check(/Dernière fournée · 2 j/.test(b2), `(3) « ${b2.trim()} »`);
  check((await hscroll(p)) <= 0, '(6) 360 px : pas de défilement horizontal');
  await p.ctx.close();

  // (5) Admin : sous-section « Saison et horaires »
  p = await openPage(browser, { page: 'admin', width: 1280 });
  await adminSection(p, 'cartes/boosters');
  await p.waitForSelector('.abt-row', { timeout: 8000 });
  await p.click('[data-bt="edit"][data-id="dore"]');
  await p.waitForSelector('dialog.ui-drawer.abt-drawer[open]', { timeout: 5000 });
  check(await p.$('#abt-sec-saison'), '(5) sous-section « Saison et horaires »');
  if (!(await p.evaluate(() => document.querySelector('#abt-sec-saison').open))) await p.click('#abt-sec-saison > summary');
  await p.fill('#abt-until', '2026-11-16T00:00');
  await p.click('.abt-style:has(input[value="cart--esport"])');
  await p.click('[data-drawer-submit]');
  await sleep(700);
  const sv = (await log(p)).filter((x) => x[0] === 'booster_type_save').map((x) => x[2]).pop();
  check(sv && sv.available_until === new Date('2026-11-15T23:00:00Z').toISOString(), `(5) fin de vente en heure de Zurich (${sv && sv.available_until})`);
  check(sv && sv.style === 'cart--esport', '(5) style esport enregistré');
  check(!p.errs.length, '(5) aucune erreur de page ' + p.errs.join(' | '));
  await p.ctx.close();
  await browser.close();
  finish();
})();
