// Parcours : 30 nouveaux styles de cartouche de booster (migration 077, booster-styles.js, boosters-styles.css).
// (a) Admin 1280 px : sélecteur de l'éditeur regroupé par famille (8 groupes, 53 styles, nom affiché et motif au survol),
//     les deux feuilles de styles chargées, choix de « Lagon » : aperçu, charge utile de hg_booster_type_save, miniature
//     de la liste ; style inconnu en base : miniature en Classique.
// (b) Admin 390 px : éditeur sans défilement horizontal.
// (c) Boutique (cartes.html, types) : un type en « Braise » affiche sa cartouche (dégradé et motif de boosters-styles.css),
//     un style inconnu ou malveillant retombe sur « cart--classique » (aucun attribut injecté) ; la tuile de stock et la
//     scène d'ouverture reprennent le style ; mode daltonien : motifs renforcés (--bs-k) ; 390 px sans défilement horizontal.
// Faux Supabase : fixtures/fake-sb.mjs (admin) et fixtures/fake-sb-cartes.mjs (typeOverrides). Captures dans scratchpad/nuit2/shots/.
// Lancer : node tests/parcours-styles-boosters.cjs
const fs = require('fs');
const path = require('path');
const { check, finish, openPage, adminSection, hscroll, sleep, chromium } = require('./lib/harness.cjs');

const SHOTS = '/tmp/claude-0/-home-claude/745c1954-a6f8-5445-b8b6-c526f6aef9c2/scratchpad/nuit2/shots';
fs.mkdirSync(SHOTS, { recursive: true });
/** Familles attendues dans le sélecteur, dans l'ordre, avec leur nombre de styles. */
const FAMS = [['Styles d’origine', 9], ['Rouges', 5], ['Roses et violets', 5], ['Oranges et bruns', 5], ['Jaunes et verts', 5], ['Bleus et cyans', 5], ['Indigos et neutres', 5], ['Thèmes', 14]];
/** Appels de hg_booster_type_save reçus par le faux (charges utiles). */
const saves = (p) => p.evaluate(() => (window.__LOG || []).filter((x) => x[0] === 'booster_type_save').map((x) => x[2]));

(async () => {
  const browser = await chromium.launch();

  /* ---------- (a) Admin 1280 px ---------- */
  let p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
  await adminSection(p, 'cartes/boosters');
  await p.waitForSelector('.abt-row', { timeout: 8000 });
  check(await p.locator('link[data-abt-css]').count() === 2, '(a) cartes-boosters.css et boosters-styles.css chargées à la demande');
  await p.click('[data-bt="edit"][data-id="serie"]');
  await p.waitForSelector('dialog.ui-drawer.abt-drawer[open]', { timeout: 5000 });
  check(await p.locator('.abt-style input[name="style"]').count() === 53, '(a) 53 styles dans le sélecteur');
  const fams = await p.$$eval('.abt-style-fam', (fs) => fs.map((f) => [f.querySelector('.abt-style-fh').firstChild.textContent.trim(), f.querySelectorAll('input[name="style"]').length]));
  check(JSON.stringify(fams) === JSON.stringify(FAMS), `(a) 8 familles dans l'ordre avec leurs effectifs (${fams.map((f) => f.join(' ')).join(', ')})`);
  check(await p.$$eval('.abt-style-fam', (fs) => fs.every((f) => f.getAttribute('role') === 'group' && document.getElementById(f.getAttribute('aria-labelledby')))), '(a) chaque famille est un groupe nommé (role=group, aria-labelledby)');
  check(await p.$eval('.abt-style:has(input[value="cart--lagon"])', (l) => l.querySelector('.abt-style-l').textContent === 'Lagon' && /ondes, moyen/.test(l.title)), '(a) nom affiché sous la cartouche, motif et luminosité au survol');
  const small = await p.$$eval('.abt-style', (ls) => ls.filter((l) => l.getBoundingClientRect().height < 44).length);
  check(small === 0, `(a) cibles d'au moins 44 px (${small} trop petites)`);
  // Les 30 nouveaux styles ont bien une règle CSS (fond du corps différent du Classique).
  const plain = await p.$$eval('.abt-style .cart-box', (bs) => bs.filter((b) => !b.classList.contains('cart--classique') && !/gradient/.test(getComputedStyle(b.querySelector('.cart-body')).backgroundImage) && getComputedStyle(b.querySelector('.cart-body')).backgroundColor === 'rgb(43, 40, 54)').map((b) => b.className));
  check(plain.length === 0, `(a) chaque style a son propre fond (${plain.join(', ') || 'tous'})`);
  const sel = await p.$('.abt-styles');
  await sel.screenshot({ path: path.join(SHOTS, 'styles-selecteur-1280.png') });
  await p.click('.abt-style:has(input[value="cart--lagon"])');
  check(await p.isChecked('.abt-style input[value="cart--lagon"]'), '(a) « Lagon » coché');
  check(await p.$eval('#abt-preview .cart-box', (b) => b.classList.contains('cart--lagon')), '(a) aperçu : classe cart--lagon');
  check(/repeating-radial-gradient/.test(await p.$eval('#abt-preview .cart-body', (e) => getComputedStyle(e).backgroundImage)), '(a) aperçu : motif « ondes » appliqué');
  await p.click('[data-drawer-submit]');
  await p.waitForSelector('dialog.ui-drawer', { state: 'detached', timeout: 5000 }).catch(() => {});
  const sv = await saves(p);
  check(sv.length === 1 && sv[0].id === 'serie' && sv[0].style === 'cart--lagon', `(a) charge utile : style cart--lagon (${JSON.stringify(sv[0] || {})})`);
  await p.waitForSelector('.abt-row[data-type="serie"] .cart-box.cart--lagon', { timeout: 5000 }).catch(() => {});
  check(await p.locator('.abt-row[data-type="serie"] .cart-box.cart--lagon').count() === 1, '(a) liste : miniature en Lagon');
  check(p.errs.length === 0, `(a) aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // Style inconnu en base (ex. ligne écrite avant 077 ou à la main) : la miniature retombe sur Classique.
  p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
  await p.evaluate(() => { window.__DB.hg_booster_types.find((t) => t.id === 'dore').style = 'cart--pirate'; });
  await adminSection(p, 'cartes/boosters');
  await p.waitForSelector('.abt-row', { timeout: 8000 });
  check(await p.$eval('.abt-row[data-type="dore"] .cart-box', (b) => b.classList.contains('cart--classique') && !b.classList.contains('cart--pirate')), '(a) style inconnu : miniature en Classique');
  await p.ctx.close();

  /* ---------- (b) Admin 390 px : éditeur ---------- */
  p = await openPage(browser, { page: 'admin', width: 390, height: 844 });
  await adminSection(p, 'cartes/boosters');
  await p.waitForSelector('.abt-row', { timeout: 8000 });
  await p.click('[data-bt="edit"][data-id="serie"]');
  await p.waitForSelector('dialog.ui-drawer.abt-drawer[open]', { timeout: 5000 });
  const over = await p.$eval('dialog.ui-drawer', (d) => d.scrollWidth - d.clientWidth);
  const hs = await hscroll(p);
  check(over <= 0 && hs <= 0, `(b) 390 px : éditeur sans défilement horizontal (tiroir ${over}, page ${hs})`);
  await (await p.$('.abt-styles')).screenshot({ path: path.join(SHOTS, 'styles-selecteur-390.png') });
  await p.ctx.close();

  /* ---------- (c) Boutique, Inventaire, Ouverture ---------- */
  const scenario = { types: true, bal: 20000, stock: { dore: 1 },
    typeOverrides: { dore: { style: 'cart--braise' }, argente: { style: 'cart--pirate' }, diamant: { style: 'cart--x" onmouseover="alert(1)' } } };
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900, scenario });
  await p.click('[data-tab=boutique]'); await sleep(300);
  const cls = (id) => p.$eval(`#cartes-p-boutique .shop-item[data-type=${id}] .cart-box`, (b) => b.className);
  check(/\bcart--braise\b/.test(await cls('dore')), '(c) Boutique : le type Doré passé en « Braise » affiche cart--braise');
  check(/radial-gradient/.test(await p.$eval('#cartes-p-boutique .shop-item[data-type=dore] .cart-body', (e) => getComputedStyle(e).backgroundImage)), '(c) Boutique : motif « étincelles » appliqué (boosters-styles.css)');
  check(/\bcart--classique\b/.test(await cls('argente')) && !/pirate/.test(await cls('argente')), '(c) style inconnu : retombe sur cart--classique');
  check(/\bcart--classique\b/.test(await cls('diamant')) && await p.locator('[onmouseover]').count() === 0, '(c) style malveillant : Classique, aucun attribut injecté');
  check(/\bcart--holo\b/.test(await cls('holographique')), '(c) styles d’origine inchangés (Holographique)');
  await (await p.$('#cartes-p-boutique .shop-item[data-type=dore]')).screenshot({ path: path.join(SHOTS, 'styles-boutique-braise.png') });
  await p.click('[data-tab=ouverture]'); await sleep(300);
  check(await p.locator('#cartes-p-ouverture [data-stock-type=dore] .cart-box.cart--braise').count() === 1, '(c) Ouverture : la tuile du stock « Doré » est dessinée en Braise');
  await p.click('#cartes-p-ouverture [data-action=open-stock][data-type=dore]');
  await p.waitForSelector('.op-cart .cart-box', { timeout: 8000 }).catch(() => {});
  check(await p.locator('.op-cart .cart-box.cart--braise').count() === 1, '(c) scène d’ouverture : la cartouche qui tombe est en Braise');
  await p.evaluate(() => { document.documentElement.dataset.mode = 'daltonien'; });
  check((await p.$eval('.cart-box.cart--braise', (b) => getComputedStyle(b).getPropertyValue('--bs-k').trim())) === '1.8', '(c) mode daltonien : motifs renforcés (--bs-k = 1.8)');
  check(p.errs.length === 0, `(c) aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 390, height: 844, scenario });
  await p.click('[data-tab=boutique]'); await sleep(300);
  check(await hscroll(p) <= 0, '(c) 390 px : Boutique sans défilement horizontal');
  await p.ctx.close();

  await browser.close();
  finish();
})();
