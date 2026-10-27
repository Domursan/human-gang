// Parcours : boosters typés dans /pages/cartes/cartes.html (SPEC booster-system, scénario types: true, 9 types).
// 1. Boutique : 9 articles dans l'ordre (classique, série, argenté, doré, diamant, quitte ou double,
//    collectionneur, holographique, identité), cartouche de la bonne famille, limites hebdomadaires, chances.
//    La Boutique ne fait qu'acheter en stock ; garantie épique seulement si pity_epique > 0.
// 2. Achat du classique dans la Boutique (mise en stock), puis ouverture depuis l'onglet Ouverture (RPC hg_booster_open, mode stock).
// 3. Achat (Doré) dans la Boutique : toast, stock, total selon la quantité, pas de changement d'onglet.
// 4. Ouverture depuis le stock : une tuile par type en stock, « Ouvrir 1 » et « Tout ouvrir (N) », RPC (stock).
// 5. Dialogue de série : liste, présélection, Échap et Annuler sans appel, confirmation avec p_set.
// 6. Limite hebdomadaire : holographique (1 par semaine) bloqué après une mise en stock, diamant encore possible.
// 7. Don par type : choix du type limité aux types en stock, quantité limitée, confirmation, toast, historique,
//    RPC hg_booster_gift avec p_type.
// 8. Scénarios à part : limite déjà atteinte (boughtWeek), Paillettes insuffisantes (bal petit),
//    remboursement du Collectionneur (collectorMissing 3), mode sans limite (god).
// 9. Téléphone 390 px : Boutique, Ouverture, Inventaire et dialogue de série sans défilement horizontal.
// 10. Repli sans types : la tuile « Boosters en stock » d'origine (#cartes-stock) reste en place.
// Faux Supabase : fixtures/fake-sb-cartes.mjs (hg_booster_types_me, hg_booster_buy, hg_booster_open, hg_booster_gift).
// La Boutique n'ouvre rien : tous les boosters passent par le stock (buy-stock) puis l'onglet Ouverture.
// Lancer : node tests/parcours/cartes/parcours-boosters-types.cjs
const { openPage, check, finish, hscroll, log, sleep, chromium } = require('../../lib/harness.cjs');

/** Ouvre un onglet de Cartes par son adresse (/pages/cartes/cartes.html#id) : la barre d'onglets est masquée depuis le nouvel en-tête. */
async function goTab(p, id) {
  await p.evaluate((h) => { location.hash = ''; location.hash = h; }, id);
  await p.waitForFunction((i) => document.getElementById('cartes-p-' + i) && !document.getElementById('cartes-p-' + i).hidden, id, { timeout: 8000 });
}

const FIXTURE = 'fake-sb-cartes.mjs';
const ME = '11111111-1111-4111-8111-111111111111';
const ALICE = '00000002-0000-4000-8000-000000000002';
// Les neuf types, dans l'ordre d'affichage de la Boutique.
const TYPES = ['classique', 'serie', 'argente', 'dore', 'diamant', 'quitte_double', 'collectionneur', 'holographique', 'identite'];
// Famille de cartouche attendue pour chaque type (classe cart--<style>).
const STYLES = { classique: 'classique', serie: 'serie', argente: 'argente', dore: 'dore', diamant: 'diamant', quitte_double: 'quitte', collectionneur: 'collection', holographique: 'holo', identite: 'identite' };

/** Attend qu'un texte apparaisse dans la page (toast) ; faux si rien ne vient dans les 4 s. */
async function toast(p, texte) {
  try { await p.waitForFunction((t) => document.body.textContent.includes(t), texte, { timeout: 4000 }); return true; } catch { return false; }
}
/** Attend la fin de l'ouverture : « Tout révéler » si la séquence tourne, puis le bouton Fermer. */
async function revelerTout(p) {
  await p.waitForSelector('#cartes-reveal [data-action=reveal-all], #cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
  if (await p.$('#cartes-reveal [data-action=reveal-all]')) await p.click('#cartes-reveal [data-action=reveal-all]');
  await p.waitForSelector('#cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
}
/** Quantité en stock d'un type pour le membre connecté, lue dans la base factice. */
const stockDe = (p, id) => p.evaluate(([me, id]) => (window.__DB.hg_booster_stock.find((r) => r.user_id === me && r.type_id === id)?.qty) ?? 0, [ME, id]);
/** La zone de révélation est-elle vide (aucune ouverture lancée) ? */
const sansRevelation = (p) => p.$eval('#cartes-reveal', (r) => r.innerHTML.trim() === '');
/** Solde de Paillettes du membre connecté, lu dans la base factice. */
const paillettes = (p) => p.evaluate((me) => window.__DB.hg_wallets.find((w) => w.user_id === me).paillettes, ME);
/** Appels d'une RPC dans le journal du faux client. */
const rpcs = (j, fn) => j.filter((l) => l[0] === 'rpc' && l[1] === fn);
let j = null; // journal du faux client, relu après chaque ouverture

(async () => {
  const browser = await chromium.launch();
  const scenario = { types: true, bal: 20000, stock: { dore: 2, serie: 1 } };

  // ---------- 1. Boutique : 9 articles ----------
  let p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, scenario });
  check(p.errs.length === 0, `Chargement typé : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await goTab(p, 'boutique'); await sleep(300);
  const articles = await p.$$eval('#cartes-p-boutique .shop-item', (els) => els.map((e) => e.dataset.type));
  check(articles.join(',') === TYPES.join(','), `Boutique : 9 articles dans l'ordre (${articles.join(',')})`);
  check(await p.$eval('#cartes-paid', (a) => !!a.querySelector('#shop-qty') && !!a.querySelector('[data-action=buy-stock][data-type=classique]')),
    'Classique : #shop-qty et buy-stock présents dans #cartes-paid');
  check(await p.$$eval('#cartes-p-boutique select[id^="shop-qty"]', (s) => s.length) === 9, 'Boutique : une quantité par type (9 select)');
  check(await p.$$eval('#cartes-p-boutique details.shop-odds > table.cartes-odds', (t) => t.length) === 9, 'Chances : un tableau par type (9)');
  for (const id of TYPES) {
    const ok = await p.$eval(`#cartes-p-boutique .shop-item[data-type=${id}] .cart-box`, (b, cls) => b.classList.contains('cart--' + cls), STYLES[id]).catch(() => false);
    check(ok, `Cartouche de ${id} : classe cart--${STYLES[id]}`);
  }
  check(await p.$eval('#cartes-p-boutique [data-type=dore] .cart-box', (b) => /5 CARTES/.test(b.textContent)), 'Doré : 5 cartes');
  check(await p.$eval('#cartes-p-boutique [data-type=collectionneur] .cart-box', (b) => /10 CARTES/.test(b.textContent)), 'Collectionneur : 10 cartes');
  check(await p.$eval('#cartes-p-boutique [data-type=holographique]', (a) => /Limite : 1 par semaine · il t'en reste 1/.test(a.textContent)), 'Holographique : « Limite : 1 par semaine · il t\'en reste 1 »');
  check(await p.$eval('#cartes-p-boutique [data-type=identite] .cart-lbl2', (e) => e.textContent.trim()) === 'IDENTITÉ', 'Identité : sous-titre en capitales');
  check(await p.$eval('#cartes-p-boutique [data-type=serie] .cart-lbl2', (e) => e.textContent.trim()) === 'SÉRIE', 'Série (boutique) : sous-titre « SÉRIE » tant qu\'aucune série n\'est choisie');
  check(await p.$eval('#cartes-p-boutique [data-type=diamant]', (a) => /Limite : 5 par semaine · il t'en reste 5/.test(a.textContent)), 'Diamant : limite de 5 par semaine');
  check(await p.$eval('#cartes-p-boutique [data-type=dore] details.shop-odds', (d) => /Une Épique ou mieux garantie au bout de 20 boosters/.test(d.textContent)), 'Doré : garantie épique dans les chances (20 boosters)');
  // La garantie n'apparaît que si pity_epique > 0 : absente pour diamant, quitte ou double, holographique et identité.
  const sansGarantie = ['diamant', 'quitte_double', 'holographique', 'identite'];
  check((await p.$$eval('#cartes-p-boutique details.shop-odds', (ds) => ds.filter((d) => /garantie/.test(d.textContent)).length)) === 5,
    'Garantie épique : affichée pour 5 types à pity 20 (absente pour diamant, quitte ou double, holographique, identité)');
  for (const id of sansGarantie) {
    check(await p.$eval(`#cartes-p-boutique [data-type=${id}] details.shop-odds`, (d) => !/garantie/.test(d.textContent)), `${id} : pas de garantie épique (pity 0)`);
  }
  check(await hscroll(p) === 0, '1280 : Boutique sans défilement horizontal');

  // ---------- 2. Achat en stock du classique, puis ouverture depuis l'onglet Ouverture ----------
  await p.click('#cartes-paid [data-action=buy-stock][data-type=classique]'); await sleep(300);
  check(await paillettes(p) === 19900, `Classique acheté : 100 Paillettes débitées (${await paillettes(p)} P)`);
  check(await stockDe(p, 'classique') === 1, 'Classique acheté : stock classique à 1');
  check(await p.$eval('#cartes-tab-boutique', (b) => b.getAttribute('aria-selected')) === 'true', 'Achat : reste dans la Boutique');
  check(await sansRevelation(p), 'Achat : aucune révélation');
  await goTab(p, 'ouverture'); await sleep(300);
  check(await p.$eval('#cartes-p-ouverture [data-stock-type=classique] [data-action=open-gift]', (b) => b.textContent.trim()) === 'Ouvrir 1',
    'Ouverture : bouton « Ouvrir 1 » sur le classique');
  await p.click('#cartes-p-ouverture [data-stock-type=classique] [data-action=open-gift]'); await sleep(300);
  await revelerTout(p);
  j = await log(p);
  const cl = rpcs(j, 'hg_booster_open').at(-1);
  check(cl?.[2]?.p_type === 'classique' && cl?.[2]?.p_mode === 'stock', `Ouverture du classique : hg_booster_open(classique, stock) (${JSON.stringify(cl?.[2])})`);
  check(await p.$eval('#cartes-tab-ouverture', (b) => b.getAttribute('aria-selected')) === 'true', 'Ouverture du classique : reste sur Ouverture');
  check(await p.$$eval('#cartes-reveal .cart-box', (els) => els.length) > 0, 'Révélation : cartouche présente');
  check(await stockDe(p, 'classique') === 0, 'Ouverture du classique : stock 1 -> 0');
  await p.click('#cartes-reveal [data-action=close-reveal]'); await sleep(200);

  // ---------- 3. Achat en stock (Doré, 1 puis 3) ----------
  await goTab(p, 'boutique'); await sleep(300);
  const avant = await stockDe(p, 'dore');
  await p.click('#cartes-p-boutique [data-action=buy-stock][data-type=dore]');
  check(await toast(p, '1 booster Doré ajouté à ton inventaire'), 'Achat (Doré) : toast « 1 booster Doré ajouté à ton inventaire »');
  await sleep(300);
  check(await stockDe(p, 'dore') === avant + 1, `Achat (Doré) : stock ${avant} -> ${avant + 1}`);
  check(await p.$eval('#cartes-tab-boutique', (b) => b.getAttribute('aria-selected')) === 'true', 'Achat : reste dans la Boutique');
  await p.selectOption('#shop-qty-dore', '3');
  const totalDore3 = (await p.textContent('#cartes-p-boutique [data-action=buy-stock][data-type=dore]')).replace(/\s/g, '').replace(/[’']/g, '');
  check(totalDore3.includes('1050'), `Doré x3 : le total passe à 1 050 (« ${totalDore3} »)`);
  await p.selectOption('#shop-qty-dore', '1');

  // ---------- 4. Ouverture depuis le stock (Doré) ----------
  await goTab(p, 'ouverture'); await sleep(300);
  check(await p.$$eval('#cartes-p-ouverture [data-stock-type]', (els) => els.map((e) => e.dataset.stockType).join(',')) === 'serie,dore',
    'Ouverture : une tuile par type en stock (serie, dore)');
  check(await p.$eval('#cartes-p-ouverture #cartes-stock', (e) => e.dataset.stockType) === 'serie', 'Ouverture : #cartes-stock sur la première tuile de stock');
  check(await p.$eval('#cartes-p-ouverture [data-action=open-stock][data-type=dore]', (b) => b.textContent.trim()) === 'Ouvrir 1', 'Ouverture : bouton « Ouvrir 1 » sur le Doré');
  check(await p.$eval('#cartes-p-ouverture [data-action=open-stock-multi][data-type=dore][data-count=all]', (b) => b.textContent.trim()) === 'Tout ouvrir (3)', 'Ouverture : « Tout ouvrir (3) » sur le Doré');
  await p.click('#cartes-p-ouverture [data-action=open-stock][data-type=dore]'); await sleep(300);
  await revelerTout(p);
  j = await log(p);
  const st = rpcs(j, 'hg_booster_open').at(-1);
  check(st?.[2]?.p_type === 'dore' && st?.[2]?.p_mode === 'stock', `Ouvrir depuis le stock : hg_booster_open(dore, stock) (${JSON.stringify(st?.[2])})`);
  check(await stockDe(p, 'dore') === 2, 'Ouvrir depuis le stock : stock Doré 3 -> 2');
  check(await p.$eval('#cartes-reveal', (r) => !!r.querySelector('.cart-box.cart--dore')), 'Révélation Doré : cartouche cart--dore dans la scène');
  await p.click('#cartes-reveal [data-action=close-reveal]'); await sleep(200);

  // ---------- 5. Dialogue de série ----------
  const sets = await p.evaluate(() => window.__DB.hg_card_sets.filter((s) => s.active !== false && (!s.starts_at || new Date(s.starts_at) <= new Date())).map((s) => s.id));
  await p.click('#cartes-p-ouverture [data-action=open-stock][data-type=serie]'); await sleep(300);
  check(await p.$eval('#cartes-serie-pick', (d) => d.open), 'Série : le dialogue « Quelle série ? » s\'ouvre avant l\'ouverture');
  check(await p.$$eval('#cartes-serie-list input[type=radio]', (r) => r.length) === sets.length, `Série : une ligne par série ouverte (${sets.length})`);
  check(!!(await p.$('#cartes-serie-list input[type=radio]:checked')), 'Série : une série présélectionnée');
  const lastChecked = await p.$eval('#cartes-serie-list input[type=radio]:checked', (r) => r.value);
  const focusFirst = await p.evaluate(() => document.activeElement?.name === 'serie-set' && document.activeElement?.value === document.querySelector('#cartes-serie-list input').value);
  check(focusFirst, 'Série : le premier choix reçoit le focus');
  check(lastChecked === await p.$$eval('#cartes-serie-list input[type=radio]', (r) => r.at(-1).value), 'Série : la dernière série est présélectionnée');
  await p.keyboard.press('Escape'); await sleep(200);
  check(!(await p.$eval('#cartes-serie-pick', (d) => d.open))
    && await p.evaluate(() => document.activeElement?.dataset?.action === 'open-stock' && document.activeElement?.dataset?.type === 'serie'),
  'Série : Échap ferme sans ouvrir, le focus revient au bouton');
  check(rpcs(await log(p), 'hg_booster_open').filter((l) => l[2]?.p_type === 'serie').length === 0, 'Série : Échap n\'appelle pas la RPC');
  await p.click('#cartes-p-ouverture [data-action=open-stock][data-type=serie]'); await sleep(300);
  await p.click('#cartes-serie-pick [data-action=close-dialog]'); await sleep(200);
  check(!(await p.$eval('#cartes-serie-pick', (d) => d.open)), 'Série : Annuler ferme le dialogue');
  check(rpcs(await log(p), 'hg_booster_open').filter((l) => l[2]?.p_type === 'serie').length === 0, 'Série : Annuler n\'appelle pas la RPC');
  await p.click('#cartes-p-ouverture [data-action=open-stock][data-type=serie]'); await sleep(300);
  await p.click('#cartes-serie-list input[value="' + lastChecked + '"]');
  await p.click('#cartes-serie-pick [data-action=serie-confirm]'); await sleep(300);
  await revelerTout(p);
  j = await log(p);
  const se = rpcs(j, 'hg_booster_open').filter((l) => l[2]?.p_type === 'serie').at(-1);
  check(se?.[2]?.p_mode === 'stock' && se?.[2]?.p_set === lastChecked, `Série confirmée : hg_booster_open(serie, stock, p_set=${lastChecked}) (${JSON.stringify(se?.[2])})`);
  check(await p.$eval('#cartes-reveal', (r) => !!r.querySelector('.cart-box.cart--serie')), 'Révélation Série : cartouche cart--serie');
  check(await stockDe(p, 'serie') === 0, 'Série confirmée : stock Série 1 -> 0');
  await p.click('#cartes-reveal [data-action=close-reveal]'); await sleep(200);

  // ---------- 6. Limite hebdomadaire : Holographique (1 par semaine) ----------
  await goTab(p, 'boutique'); await sleep(300);
  const avantHolo = await paillettes(p);
  await p.click('#cartes-p-boutique [data-action=buy-stock][data-type=holographique]'); await sleep(300);
  check(await paillettes(p) === avantHolo - 1000, 'Holographique acheté : 1000 Paillettes débitées');
  check(await p.$eval('#cartes-p-boutique [data-type=holographique] [data-action=buy-stock]', (b) => b.disabled), 'Holographique : achat bloqué après la limite de la semaine');
  check(await p.$eval('#cartes-p-boutique [data-type=holographique]', (a) => /Limite de la semaine atteinte/.test(a.textContent)), 'Holographique : « Limite de la semaine atteinte »');
  check(await p.$eval('#cartes-p-boutique [data-type=diamant] [data-action=buy-stock]', (b) => !b.disabled), 'Diamant : achat encore possible (limite non atteinte)');

  // ---------- 7. Don par type (Doré) ----------
  await goTab(p, 'inventaire'); await sleep(300);
  check(await p.$eval('#cartes-p-inventaire', (s) => /Doré/.test(s.textContent) && /Aucun booster/.test(s.textContent) === false), 'Inventaire : stock listé par type (Doré)');
  const typesDon = await p.$$eval('#gift-type option', (o) => o.map((x) => x.textContent.trim()).join(' | '));
  check(/Doré \(2 en stock\)/.test(typesDon) && !/Quitte/.test(typesDon), `Don : choix du type limité aux types en stock, « Doré (2 en stock) » (${typesDon})`);
  await p.selectOption('#gift-type', 'dore'); await sleep(300);
  check(await p.$$eval('#gift-qty option', (o) => o.map((x) => x.value).join(',')) === '1,2', 'Don : quantité limitée au stock du Doré (1,2)');
  await p.selectOption('#gift-to', ALICE);
  await p.selectOption('#gift-qty', '2');
  await p.click('[data-action=gift-ask]'); await sleep(300);
  const conf = await p.$eval('.inv-gift-confirm', (e) => e.textContent.replace(/\s+/g, ' '));
  check(/Offrir 2 boosters Doré à Alice \?/.test(conf), `Confirmation : « Offrir 2 boosters Doré à Alice ? » (« ${conf.slice(0, 60)} »)`);
  await p.click('[data-action=gift-confirm]');
  check(await toast(p, '2 boosters Doré offerts à Alice'), 'Don : toast « 2 boosters Doré offerts à Alice »');
  await sleep(500);
  check(await stockDe(p, 'dore') === 0, 'Don : stock Doré 2 -> 0');
  const gift = await p.evaluate(() => window.__DB.hg_booster_gifts.at(-1));
  check(gift?.type_id === 'dore' && gift?.qty === 2, 'Base : le don garde le type (dore, 2)');
  check((await p.textContent('#inv-gifts .inv-gifts-list')).includes('Tu as offert 2 boosters Doré à Alice'), 'Historique : « Tu as offert 2 boosters Doré à Alice »');
  j = await log(p);
  const don = rpcs(j, 'hg_booster_gift').at(-1);
  check(don?.[2]?.p_type === 'dore' && don?.[2]?.p_qty === 2 && don?.[2]?.p_to === ALICE, `Don : RPC hg_booster_gift(dore, 2, Alice) (${JSON.stringify(don?.[2])})`);
  await goTab(p, 'ouverture'); await sleep(300);
  check(await p.$eval('#cartes-p-ouverture', (s) => !s.querySelector('[data-action=open-stock][data-type=dore]')), 'Ouverture : plus de tuile Doré quand le stock est à zéro');
  check(await hscroll(p) === 0, '1280 : Inventaire et Ouverture sans défilement horizontal');
  // Appels de la RPC d'achat : le type et la quantité sont envoyés.
  j = await log(p);
  const achatsStock = rpcs(j, 'hg_booster_buy');
  check(achatsStock.some((l) => l[2]?.p_type === 'dore' && l[2]?.p_qty === 1), 'Achat : RPC hg_booster_buy(dore, 1)');
  check(achatsStock.some((l) => l[2]?.p_type === 'holographique' && l[2]?.p_qty === 1), 'Achat : RPC hg_booster_buy(holographique, 1)');
  check(p.errs.length === 0, `Parcours typé 1280 : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // ---------- 8a. Limite déjà atteinte (boughtWeek) : holographique bloqué dès l'ouverture ----------
  p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, scenario: { types: true, bal: 20000, boughtWeek: { holographique: 1 } } });
  await goTab(p, 'boutique'); await sleep(300);
  check(await p.$eval('#cartes-p-boutique [data-type=holographique]', (a) => /Limite de la semaine atteinte/.test(a.textContent)), 'Limite atteinte (boughtWeek) : « Limite de la semaine atteinte »');
  check(await p.$eval('#cartes-p-boutique [data-type=holographique] [data-action=buy-stock]', (b) => b.disabled), 'Limite atteinte (boughtWeek) : mise en stock désactivée');
  check(p.errs.length === 0, `Limite atteinte : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // ---------- 8b. Paillettes insuffisantes (bal 50) : achats refusés, message, rien d'acheté ----------
  p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, scenario: { types: true, bal: 50 } });
  await goTab(p, 'boutique'); await sleep(300);
  check(await p.$eval('#cartes-paid [data-action=buy-stock][data-type=classique]', (b) => b.disabled), 'Paillettes insuffisantes : classique non acheté');
  check(await p.$eval('#cartes-p-boutique [data-type=dore] [data-action=buy-stock]', (b) => b.disabled), 'Paillettes insuffisantes : Doré non acheté');
  check(await p.$eval('#cartes-p-boutique [data-type=dore] p.shop-stock-miss', (e) => /Il te manque/.test(e.textContent)), 'Paillettes insuffisantes : « Il te manque … » affiché pour le Doré');
  check(await p.$eval('#cartes-p-boutique [data-type=identite] [data-action=buy-stock]', (b) => b.disabled), 'Paillettes insuffisantes : Identité (10 000 P) non mise en stock');
  check(p.errs.length === 0, `Paillettes insuffisantes : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // ---------- 8c. Collectionneur : 3 cartes manquantes sur 10 : 7 remboursées à 50 P ----------
  p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, scenario: { types: true, bal: 20000, collectorMissing: 3 } });
  await goTab(p, 'boutique'); await sleep(300);
  const avantCollec = await paillettes(p);
  await p.click('#cartes-p-boutique [data-action=buy-stock][data-type=collectionneur]'); await sleep(300);
  check(await paillettes(p) === avantCollec - 500, 'Collectionneur acheté : 500 Paillettes débitées');
  await goTab(p, 'ouverture'); await sleep(300);
  await p.click('#cartes-p-ouverture [data-action=open-stock][data-type=collectionneur]'); await sleep(300);
  await revelerTout(p);
  check(await toast(p, 'remboursés'), 'Collectionneur : toast de remboursement');
  check(await p.evaluate(() => [...document.querySelectorAll('.toast, [role=status], [role=alert]')].some((t) => /cartes déjà toutes possédées/.test(t.textContent) && /remboursés/.test(t.textContent)) || /cartes déjà toutes possédées.*remboursés/.test(document.body.textContent)),
    'Collectionneur : « … cartes déjà toutes possédées : … ✦ remboursés »');
  check(await paillettes(p) === avantCollec - 500 + 350, `Collectionneur : 500 débitées, 350 remboursées à l'ouverture (${await paillettes(p)} P)`);
  const remb = await p.evaluate(() => window.__DB.hg_wallet_log.find((l) => l.reason === 'remboursement'));
  check(remb?.delta === 350, `Collectionneur : ligne « remboursement » de 350 au journal (${remb?.delta})`);
  await p.click('#cartes-reveal [data-action=close-reveal]').catch(() => {}); await sleep(200);
  check(p.errs.length === 0, `Collectionneur : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // ---------- 8d. Mode sans limite (god) : holographique à volonté, rien ne se débite ----------
  p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, scenario: { types: true, bal: 0, god: true, boughtWeek: { holographique: 1 } } });
  await goTab(p, 'boutique'); await sleep(300);
  check(await p.$eval('#cartes-p-boutique [data-action=buy-stock][data-type=holographique]', (b) => !b.disabled), 'Mode sans limite : holographique acheté malgré la limite');
  await p.click('#cartes-p-boutique [data-action=buy-stock][data-type=holographique]'); await sleep(300);
  await goTab(p, 'ouverture'); await sleep(300);
  await p.click('#cartes-p-ouverture [data-action=open-stock][data-type=holographique]'); await sleep(300);
  await revelerTout(p);
  await p.click('#cartes-reveal [data-action=close-reveal]'); await sleep(200);
  check(await paillettes(p) === 0, 'Mode sans limite : aucune Paillettes débitées');
  check(p.errs.length === 0, `Mode sans limite : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // ---------- 9. Téléphone 390 px : Boutique, Ouverture, Inventaire et dialogue sans défilement ----------
  p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 390, height: 844, touch: true, scenario });
  await goTab(p, 'boutique'); await sleep(300);
  check(await hscroll(p) === 0, '390 : Boutique typée sans défilement horizontal');
  await goTab(p, 'ouverture'); await sleep(300);
  check(await hscroll(p) === 0, '390 : Ouverture typée sans défilement horizontal');
  await goTab(p, 'inventaire'); await sleep(300);
  check(await hscroll(p) === 0, '390 : Inventaire typé sans défilement horizontal');
  await goTab(p, 'ouverture'); await sleep(300);
  await p.click('#cartes-p-ouverture [data-action=open-stock][data-type=serie]'); await sleep(300);
  check(await hscroll(p) === 0, '390 : dialogue de série sans défilement horizontal');
  await p.keyboard.press('Escape');
  check(p.errs.length === 0, `Parcours typé 390 : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // ---------- 10. Repli : sans types, l'ancien mode reste en place ----------
  p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, scenario: { bal: 500, gift: 2 } });
  check(await p.$eval('#cartes-p-ouverture', (s) => !!s.querySelector('#cartes-stock [data-action=open-gift]')), 'Repli : « Ouvrir un booster (2 en stock) » sur #cartes-stock');
  await goTab(p, 'boutique'); await sleep(300);
  check(await p.$$eval('#cartes-p-boutique .shop-item', (e) => e.length) === 1 && await p.$('#cartes-paid [data-action=buy-stock][data-type=classique]') !== null, 'Repli : une seule carte d\'article (classique)');
  check(p.errs.length === 0, `Repli : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
