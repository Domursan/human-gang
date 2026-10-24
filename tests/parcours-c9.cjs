// Parcours C9 : codes cadeaux à usage unique (QR).
// Faux Supabase : fixtures/fake-sb-cartes.mjs, scénario c2 (HG-7KQ4-M2XR : 1 booster Doré ; HG-AAAA-BBBB : 300 Paillettes ;
// HG-2345-6789 : déjà utilisé). Contrôles : le QR (cartes.html#code=…) ouvre la fenêtre déjà remplie avec le lot,
// l'adresse est nettoyée, « Utiliser le code » ajoute le booster (stock Doré) et propose « L'ouvrir » ; saisie à la main
// dans l'Inventaire (minuscules et espaces acceptés), code déjà utilisé : « Déjà utilisé. » ; 360 px sans défilement ;
// admin : création d'un lot, codes affichés une fois, planche A4 imprimée (bibliothèque QR simulée), lots listés.
// Lancer : node tests/parcours-c9.cjs
const { ROOT, check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');
const txt = (p, sel) => p.textContent(sel).then((t) => (t || '').replace(/\s+/g, ' ').trim()).catch(() => '');
const DLG = '#c2-code-dlg[open]';

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: { c2: true, types: true }, width: 360, height: 800, hash: '#code=HG-7KQ4-M2XR' });
  await p.waitForSelector(DLG, { timeout: 5000 }).catch(() => {});
  check(await p.isVisible(DLG), 'QR : la fenêtre « Code cadeau » s’ouvre');
  check(await p.inputValue('#c2-code-in') === 'HG-7KQ4-M2XR', 'QR : code déjà rempli');
  await p.waitForSelector('.c2-code-lot', { timeout: 3000 }).catch(() => {});
  check(/1 booster Doré · valable jusqu’au 30\.06\.2026/.test(await txt(p, '.c2-code-lot')), 'QR : lot affiché avant utilisation (' + await txt(p, '.c2-code-lot') + ')');
  check(await p.evaluate(() => location.hash) === '', 'QR : adresse nettoyée (le code ne reste pas dans l’historique)');
  check(await hscroll(p) === 0, '360 px : pas de défilement horizontal');
  const stock0 = await p.evaluate(() => window.__DB.hg_booster_stock.find((r) => r.type_id === 'dore')?.qty || 0);
  await p.click('.c2-code-use');
  await p.waitForSelector('.c2-code-ok', { timeout: 4000 }).catch(() => {});
  check(/Booster Doré ajouté/.test(await txt(p, '.c2-code-ok')), 'utilisation : « Booster Doré ajouté »');
  check(await p.evaluate(() => window.__DB.hg_booster_stock.find((r) => r.type_id === 'dore')?.qty || 0) === stock0 + 1, 'utilisation : +1 booster Doré en stock');
  await p.click('[data-c2=code-go]');
  await sleep(300);
  check(await p.getAttribute('#cartes-tab-ouverture', 'aria-selected') === 'true' && !(await p.isVisible(DLG)), '« L’ouvrir » : onglet Ouverture, fenêtre fermée');
  // Saisie à la main dans l'Inventaire
  await p.evaluate(() => { location.hash = 'inventaire'; }); // la barre d'onglets est masquée : on change d'onglet par l'adresse
  await p.waitForSelector('#cartes-p-inventaire:not([hidden])', { timeout: 5000 });
  await p.fill('#c2-code-inline', 'hg 2345 6789');
  await p.click('.c2-codebox button[type=submit]');
  await p.waitForSelector('.c2-code-err', { timeout: 4000 }).catch(() => {});
  check((await txt(p, '.c2-code-err')) === 'Déjà utilisé.', 'saisie à la main : code déjà utilisé, « Déjà utilisé. »');
  await p.fill('#c2-code-in', 'HG-AAAA-BBBB');
  await sleep(300);
  check(/300/.test(await txt(p, '.c2-code-lot')), 'nouvelle saisie : lot de 300 Paillettes');
  const bal0 = await p.evaluate(() => window.__DB.hg_wallets[0].paillettes);
  await p.click('.c2-code-use');
  await p.waitForSelector('.c2-code-ok', { timeout: 4000 }).catch(() => {});
  check(await p.evaluate(() => window.__DB.hg_wallets[0].paillettes) === bal0 + 300, 'Paillettes : +300');
  const btn = await p.$eval('.c2-code-ok', () => true).catch(() => false);
  check(btn, 'Paillettes : message de réussite');
  await p.keyboard.press('Escape');
  check((await log(p)).filter((l) => l[1] === 'hg_gift_code_redeem').length === 2, 'deux utilisations envoyées (hg_gift_code_redeem)');
  check(!p.errs.length, 'cartes : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // Admin : créer un lot et imprimer la planche
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', scenario: { c2: true, types: true }, width: 1280, height: 900 });
  await p.ctx.route('**/qrcode-generator@1.4.4/**', (r) => r.fulfill({ contentType: 'text/javascript',
    body: 'export default function(){return{addData(){},make(){},createDataURL(){return "data:image/gif;base64,R0lGODlhAQABAAAAACw=";}};}' }));
  await adminSection(p, 'cartes/codes');
  await p.waitForSelector('#acd-codes-form', { timeout: 5000 });
  check(/Gobelets du RDV/.test(await txt(p, '#acd-codes')), 'admin : lot existant listé (sans les codes)');
  await p.selectOption('#cc-type', 'dore').catch(() => {});
  await p.fill('#cc-count', '3');
  await p.click('#acd-codes-form button[type=submit]');
  await p.waitForSelector('.acd-codes-list', { timeout: 4000 }).catch(() => {});
  check(await p.$$eval('.acd-codes-list code', (c) => c.length) === 3, 'admin : 3 codes affichés après création');
  const sent = (await log(p)).find((l) => l[1] === 'hg_gift_codes_create');
  check(sent && sent[2].p.kind === 'booster' && sent[2].p.count === 3, 'admin : hg_gift_codes_create (booster, 3 codes)');
  await p.evaluate(() => { window.print = () => { window.__printed = document.querySelectorAll('#acd-print .acd-lbl').length; }; });
  await p.click('[data-cc=print-sheet]');
  await sleep(400);
  check(await p.evaluate(() => window.__printed) === 3, 'admin : planche imprimée (3 étiquettes QR)');
  check(!p.errs.length, 'admin : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await browser.close();
  finish();
})();
