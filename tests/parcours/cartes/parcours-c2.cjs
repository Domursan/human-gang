require('fs').mkdirSync(require('path').join(__dirname, '..', '..', 'shots'), { recursive: true }); // tests/shots absent d'une copie fraîche du dépôt : créé avant les captures.
// Parcours C2 (migration 080) : booster « Pâté-saucisses » vendu le soir de la soirée jeux.
// 1. Plage ouverte : article avec « Ce soir · jusqu’à 2 h », prix barré du Classique et « −20 % », limite par soirée.
// 2. Limite de la soirée atteinte : bouton désactivé et explication reliée.
// 3. Plage fermée : plus d'article, une ligne compacte « Revient … à 20 h » sous « Le reste de la semaine ».
// 4. Admin : plage horaire (jours, heures, limite par soirée) envoyée à hg_booster_type_save.
// 5. Téléphone 360 px : pas de défilement horizontal.
const { openPage, check, finish, adminSection, hscroll, log, sleep, chromium } = require('../../lib/harness.cjs');

const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();
const RATES = { commune: 60, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.88, mythique: 0.1, identite: 0.02 };
/** Prochain vendredi 20 h (heure de Zurich, approximation UTC+1/+2 sans importance pour l'affichage du jour). */
function nextFriday20() {
  // 20 h à Zurich : l'heure UTC dépend de l'heure d'été (18 h UTC en été, 19 h UTC en hiver)
  const zHour = (d) => Number(new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', hourCycle: 'h23' }).format(d));
  const d = new Date(); d.setUTCHours(18, 0, 0, 0);
  while (d.getUTCDay() !== 5 || d <= new Date()) d.setUTCDate(d.getUTCDate() + 1);
  if (zHour(d) !== 20) d.setUTCHours(19);
  return d.toISOString();
}
const pate = (open, rest) => ({ id: 'pate_saucisses', name: 'Pâté-saucisses', price: 80, size: 5, rates: RATES, shiny_rate: 5, pity_epique: 0, pool: 'tous',
  weekly_limit: null, free_daily: false, active: true, style: 'cart--pate', sort: 15,
  description: 'Le soir de la soirée jeux seulement : contenu du Classique, un peu moins cher, brillante un peu plus probable.',
  schedule: { days: [5, 6], from: '20:00', to: '02:00' }, per_window_limit: 2, on_shelf: true, open_now: open,
  closes_at: open ? iso(0.1) : null, opens_at: open ? null : nextFriday20(),
  remaining_window: open ? rest : null });

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: { types: true, bal: 5000, c080: { hg_booster_types: [pate(true, 1)] } }, hash: '#boutique', width: 1100 });
  await p.waitForSelector('#cartes-p-boutique .shop-item', { timeout: 8000 });
  const art = '#cartes-p-boutique .shop-item[data-type="pate_saucisses"]';
  check(await p.$(`${art} .cart-box.cart--pate`), '(1) article et cartouche Pâté-saucisses');
  const badge = (await p.textContent(`${art} .shop-badge`)) || '';
  check(/^Ce soir · jusqu’à \d+ h/.test(badge.trim()), `(1) pastille « ${badge.trim()} »`);
  check((await p.textContent(`${art} .shop-price`)).includes('−20 %'), '(1) réduction de 20 % par rapport au Classique');
  check((await p.textContent(art)).includes('Limite : 2 par soirée · il t’en reste 1'), '(1) limite par soirée affichée');
  await p.selectOption(`${art} select`, '2');
  await sleep(300);
  check(await p.isDisabled(`${art} [data-action="buy-stock"]`), '(2) 2 demandés, 1 restant : achat désactivé');
  check((await p.textContent(art)).includes('pour cette soirée'), '(2) explication « pour cette soirée »');
  await p.screenshot({ path: require('path').join(__dirname, '..', '..', 'shots', 'c2-ouvert.png') });
  check(!p.errs.length, '(1) aucune erreur de page ' + p.errs.join(' | '));
  await p.ctx.close();

  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: { types: true, bal: 5000, c080: { hg_booster_types: [pate(false)] } }, hash: '#boutique', width: 360, height: 780 });
  await p.waitForSelector('#cartes-p-boutique .shop-item', { timeout: 8000 });
  check(!(await p.$(art)), '(3) plage fermée : pas d’article complet');
  const row = (await p.textContent('#cartes-p-boutique .shop-closed[data-type="pate_saucisses"]').catch(() => '')) || '';
  check(/Revient (vendredi|demain|ce soir) à 20 h/.test(row), `(3) ligne compacte « ${row.replace(/\s+/g, ' ').trim()} »`);
  check((await p.textContent('#cartes-p-boutique')).includes('Le reste de la semaine'), '(3) intertitre « Le reste de la semaine »');
  check((await hscroll(p)) <= 0, '(5) 360 px : pas de défilement horizontal');
  await p.screenshot({ path: require('path').join(__dirname, '..', '..', 'shots', 'c2-ferme.png') });
  await p.ctx.close();

  p = await openPage(browser, { page: 'admin', width: 1280 });
  await adminSection(p, 'fabrique/boosters');
  await p.waitForSelector('.abt-row', { timeout: 8000 });
  await p.click('[data-bt="edit"][data-id="classique"]');
  await p.waitForSelector('dialog.ui-drawer.abt-drawer[open]', { timeout: 5000 });
  if (!(await p.evaluate(() => document.querySelector('#abt-sec-saison').open))) await p.click('#abt-sec-saison > summary');
  await p.locator('label.switch:has(input[name="sched_on"])').click();
  await p.fill('#abt-pwl', '2');
  await p.click('[data-drawer-submit]');
  await sleep(700);
  const sv = (await log(p)).filter((x) => x[0] === 'booster_type_save').map((x) => x[2]).pop();
  check(sv && JSON.stringify(sv.schedule) === JSON.stringify({ days: [5, 6], from: '20:00', to: '02:00' }), `(4) plage horaire envoyée ${JSON.stringify(sv && sv.schedule)}`);
  check(sv && sv.per_window_limit === 2, '(4) limite par soirée envoyée');
  check(!p.errs.length, '(4) aucune erreur de page ' + p.errs.join(' | '));
  await p.ctx.close();
  await browser.close();
  finish();
})();
