// Parcours : boosters en stock et dons de boosters dans /pages/cartes/cartes.html (migrations 067 et 069, mode typé).
// 1. Boutique : achat de boosters Classique dans l'inventaire (1 à 10), bouton « Acheter · total », désactivé sans assez de Paillettes.
//    Un achat ne change pas d'onglet et n'ouvre aucune révélation ; le solde et le stock sont mis à jour.
// 2. Inventaire : stock du type (« Classique ») ; sans stock, message et lien vers la Boutique.
// 3. Ouverture : la tuile de stock propose « Ouvrir 1 » ; « Ouvrir 5 » est désactivé sous 5 boosters.
// 4. Dons : choix du destinataire (membres sauf moi, triés), quantité limitée au stock, confirmation ou annulation,
//    messages de toast, historique des dons envoyés et reçus, erreur de l'historique, historique vide.
// 5. Téléphone (360 px) : pas de défilement horizontal sur la Boutique et l'Inventaire ; aucune erreur console.
// 6. Repli (backend sans les RPC typées) : Acheter désactivé, dons « arrivent bientôt », stock d'origine encore ouvrable.
// Faux Supabase : fixtures/fake-sb-cartes.mjs (scénario types: true : hg_booster_buy, hg_booster_gift, hg_booster_gifts_me,
// hg_booster_open ; sans types : repli sur hg_open_booster_req avec reqRpc).
// Lancer : node tests/parcours/cartes/parcours-boosters-stock-dons.cjs
const { openPage, check, finish, hscroll, sleep, chromium } = require('../../lib/harness.cjs');

/** Ouvre un onglet de Cartes par son adresse (/pages/cartes/cartes.html#id) : la barre d'onglets est masquée depuis le nouvel en-tête. */
async function goTab(p, id) {
  await p.evaluate((h) => { location.hash = ''; location.hash = h; }, id);
  await p.waitForFunction((i) => document.getElementById('cartes-p-' + i) && !document.getElementById('cartes-p-' + i).hidden, id, { timeout: 8000 });
}

const FIXTURE = 'fake-sb-cartes.mjs';
// Identifiants factices du fixture (même formule que U(n) et ME dans fake-sb-cartes.mjs).
const ME = '11111111-1111-4111-8111-111111111111';
const ALICE = '00000002-0000-4000-8000-000000000002';
const BRUNO = '00000003-0000-4000-8000-000000000003';
const CHLOE = '00000004-0000-4000-8000-000000000004';

/** Attend qu'un texte apparaisse dans la page (toast) ; faux si rien ne vient dans les 3 s. */
async function toast(p, texte) {
  try { await p.waitForFunction((t) => document.body.textContent.includes(t), texte, { timeout: 3000 }); return true; } catch { return false; }
}
/** Valeur affichée dans le bloc de stock de l'Inventaire (le gras du li) : « Classique » en mode typé, « Boosters en stock » en repli. */
const stockInventaire = (p) => p.evaluate(() => {
  const li = [...document.querySelectorAll('#cartes-p-inventaire li')]
    .find((l) => ['Classique', 'Boosters en stock'].includes(l.querySelector('span')?.textContent.trim()));
  return li?.querySelector('strong')?.textContent.trim() ?? null;
});
/** Texte du bouton « Ouvrir 1 » du classique dans l'Ouverture (mode typé), espaces normalisés. */
const boutonOuvrir = (p) => p.$eval('#cartes-p-ouverture [data-stock-type=classique] [data-action=open-gift]', (b) => b.textContent.replace(/\s+/g, ' ').trim()).catch(() => null);
/** Paillettes et stock de boosters classiques du membre connecté, lus dans la base factice. */
const solde = (p) => p.evaluate((me) => {
  const w = window.__DB.hg_wallets.find((x) => x.user_id === me);
  const st = window.__DB.hg_booster_stock.find((r) => r.user_id === me && r.type_id === 'classique');
  return { paillettes: w.paillettes, stock: st?.qty ?? 0 };
}, ME);
/** Onglet actif (aria-selected) est-il celui-ci ? */
const actif = (p, id) => p.$eval(`#cartes-tab-${id}`, (b) => b.getAttribute('aria-selected') === 'true');
/** Le bloc de révélation est-il vide (aucune ouverture lancée) ? */
const sansRevelation = (p) => p.$eval('#cartes-reveal', (r) => r.innerHTML.trim() === '');
/** Attend la fin de l'ouverture : « Tout révéler » si la séquence tourne encore, puis le bouton Fermer. */
async function revelerTout(p) {
  await p.waitForSelector('#cartes-reveal [data-action=reveal-all], #cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
  if (await p.$('#cartes-reveal [data-action=reveal-all]')) await p.click('#cartes-reveal [data-action=reveal-all]');
  await p.waitForSelector('#cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
}

(async () => {
  const browser = await chromium.launch();

  // ---------- 1. Pas assez de Paillettes : bouton désactivé, message, rien d'acheté ----------
  let p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 360, height: 800, scenario: { types: true, bal: 50 } });
  await goTab(p, 'boutique'); await sleep(300);
  check(await p.$eval('#cartes-paid #shop-qty', (s) => s.options.length) === 10, 'Boutique : quantité de 1 à 10 proposée');
  check((await p.$eval('#cartes-paid [data-action=buy-stock]', (b) => b.textContent.trim())).startsWith('Acheter · '), 'Boutique : bouton « Acheter · total »');
  check(await p.$eval('#cartes-paid [data-action=buy-stock]', (b) => b.disabled), 'Boutique : achat désactivé sans assez de Paillettes');
  check(await p.isVisible('#cartes-paid p.shop-stock-miss'), 'Boutique : message « il te manque » affiché');
  check(await hscroll(p) === 0, '360 px : Boutique sans défilement horizontal');
  await goTab(p, 'inventaire'); await sleep(300);
  check(await p.isVisible('#inv-gift p.inv-gift-empty'), 'Inventaire sans stock : message « pas de booster à offrir »');
  check(await p.$eval('#inv-gift [data-tab-go=boutique]', (b) => !!b), 'Inventaire sans stock : lien vers la Boutique');
  check(!(await p.$('#inv-gift-form')), 'Inventaire sans stock : pas de formulaire de don');
  check((await p.textContent('#inv-gifts')).includes('Aucun don pour le moment.'), 'Historique vide : « Aucun don pour le moment. »');
  check(await hscroll(p) === 0, '360 px : Inventaire sans défilement horizontal');
  await p.click('#inv-gift [data-tab-go=boutique]'); await sleep(300);
  check(await actif(p, 'boutique'), 'Le lien de l\'Inventaire ouvre la Boutique');
  check(p.errs.length === 0, `Pas assez de Paillettes : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // ---------- 2. Achats dans la Boutique : toast, solde, stock, pas de révélation ----------
  p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 360, height: 800, scenario: { types: true, bal: 500 } });
  await goTab(p, 'boutique'); await sleep(300);
  check((await p.textContent('#cartes-paid [data-action=buy-stock]')).includes('100'), 'Boutique : le total d\'un booster (100) est affiché sur le bouton');
  await p.click('#cartes-paid [data-action=buy-stock]');
  check(await toast(p, '1 booster Classique ajouté à ton inventaire'), 'Un booster acheté : toast « 1 booster Classique ajouté à ton inventaire »');
  await sleep(300);
  let s = await solde(p);
  check(s.paillettes === 400 && s.stock === 1, `Un booster acheté : solde -100 et stock 1 (${s.paillettes} P, stock ${s.stock})`);
  check(await actif(p, 'boutique'), 'Acheter ne change pas d\'onglet');
  check(await sansRevelation(p), 'Acheter n\'ouvre aucune révélation');
  await goTab(p, 'inventaire'); await sleep(300);
  check(await stockInventaire(p) === '1', 'Inventaire : le stock Classique vaut 1');
  await goTab(p, 'ouverture'); await sleep(300);
  check((await boutonOuvrir(p)) === 'Ouvrir 1', 'Ouverture : le bouton de la tuile est « Ouvrir 1 »');
  check(await p.$eval('#cartes-p-ouverture [data-action=open-stock-multi][data-type=classique][data-count="5"]', (b) => b.disabled && b.title === 'Il te faut 5 boosters'), 'Ouverture : « Ouvrir 5 » désactivé avec 1 booster');
  await goTab(p, 'boutique'); await sleep(300);
  await p.selectOption('#cartes-paid #shop-qty', '3');
  check((await p.textContent('#cartes-paid [data-action=buy-stock]')).includes('300'), 'Boutique : le total passe à 300 pour 3 boosters');
  await p.click('#cartes-paid [data-action=buy-stock]');
  check(await toast(p, '3 boosters Classique ajoutés à ton inventaire'), 'Trois boosters achetés : toast « 3 boosters Classique ajoutés à ton inventaire »');
  await sleep(300);
  s = await solde(p);
  check(s.paillettes === 100 && s.stock === 4, `Trois boosters achetés : solde -300 et stock 4 (${s.paillettes} P, stock ${s.stock})`);
  await p.selectOption('#cartes-paid #shop-qty', '2');
  check(await p.$eval('#cartes-paid [data-action=buy-stock]', (b) => b.disabled) && await p.isVisible('#cartes-paid p.shop-stock-miss'),
    'Solde de 100 P : deux boosters (200 P) refusés, bouton désactivé');
  check(await hscroll(p) === 0, '360 px : Boutique sans défilement horizontal après achats');
  check(await sansRevelation(p), 'Après les achats : aucune révélation');
  check(p.errs.length === 0, `Achats : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // ---------- 3. Dons : formulaire, confirmation, annulation, historique ----------
  const recu = { id: 1, from_user: BRUNO, to_user: ME, qty: 1, message: null, created_at: new Date(Date.now() - 864e5).toISOString() };
  p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 360, height: 800, scenario: { types: true, bal: 500, stock: { classique: 4 }, boosterGifts: [recu] } });
  const ids = await p.evaluate(() => Object.fromEntries(window.__DB.hg_profiles.map((x) => [x.pseudo, x.id])));
  check(ids.Alice === ALICE && ids.Bruno === BRUNO && ids.Chloé === CHLOE, 'Identifiants des membres conformes au fixture');
  await goTab(p, 'inventaire'); await sleep(300);
  check(!!(await p.$('#inv-gift-form')), 'Stock 4 : formulaire de don affiché');
  check(await hscroll(p) === 0, '360 px : Inventaire avec formulaire sans défilement horizontal');
  check(await p.$eval('#gift-type', (t) => t.options[0].textContent.trim()) === 'Classique (4 en stock)', 'Don : type « Classique (4 en stock) »');
  check(await p.$eval('#gift-to option', (o) => o.value) === '', 'Destinataire : première option vide');
  const pseudos = await p.$$eval('#gift-to option', (os) => os.slice(1).map((o) => o.textContent.trim()));
  check(!pseudos.includes('Ethan') && pseudos.length === 5, `Destinataires : les cinq autres membres, sans moi (${pseudos.join(', ')})`);
  check(JSON.stringify(pseudos) === JSON.stringify([...pseudos].sort((a, b) => a.localeCompare(b, 'fr'))), 'Destinataires : triés par pseudo');
  const quantites = await p.$$eval('#gift-qty option', (os) => os.map((o) => o.value));
  check(quantites.join(',') === '1,2,3,4', `Quantité limitée au stock (${quantites.join(',')})`);
  check(await p.$eval('#gift-msg', (t) => t.maxLength) === 300, 'Message : 300 caractères au plus');
  check(await p.$eval('[data-action=gift-ask]', (b) => b.textContent.trim()) === 'Offrir', 'Bouton « Offrir »');
  check((await p.textContent('#inv-gifts')).includes("Bruno t'a offert 1 booster"), 'Reçu : « Bruno t\'a offert 1 booster » dans l\'historique');
  await p.click('[data-action=gift-ask]');
  check(await toast(p, 'Choisis à qui offrir'), 'Sans destinataire : toast « Choisis à qui offrir »');
  await p.selectOption('#gift-to', ALICE);
  await p.selectOption('#gift-qty', '2');
  await p.fill('#gift-msg', 'Bon courage pour la collection !');
  await p.click('[data-action=gift-ask]'); await sleep(300);
  check(await p.isVisible('.inv-gift-confirm'), 'Offrir : demande de confirmation affichée');
  const confirme = await p.$eval('.inv-gift-confirm', (e) => e.textContent.replace(/\s+/g, ' '));
  check(/Offrir 2 boosters Classique à Alice/.test(confirme), `Confirmation : quantité, type et pseudo (« ${confirme.trim().slice(0, 80)} »)`);
  check(!!(await p.$('[data-action=gift-confirm]')) && !!(await p.$('[data-action=gift-cancel]')), 'Confirmation : boutons « confirmer » et « annuler »');
  await p.click('[data-action=gift-cancel]'); await sleep(300);
  check(!(await p.isVisible('.inv-gift-confirm')), 'Annuler : la confirmation disparaît');
  check((await solde(p)).stock === 4, 'Annuler : aucun booster donné');
  await p.click('[data-action=gift-ask]'); await sleep(300);
  await p.click('[data-action=gift-confirm]');
  check(await toast(p, '2 boosters Classique offerts à Alice'), 'Don de deux boosters : toast « 2 boosters Classique offerts à Alice »');
  await sleep(500);
  check((await solde(p)).stock === 2, `Don de deux boosters : stock 4 -> 2 (stock ${(await solde(p)).stock})`);
  check(await stockInventaire(p) === '2', 'Inventaire : le stock Classique vaut 2 après le don');
  let liste = await p.textContent('#inv-gifts .inv-gifts-list');
  check(liste.includes('Tu as offert 2 boosters Classique à Alice'), 'Historique : « Tu as offert 2 boosters Classique à Alice »');
  check((await p.$$eval('#inv-gifts .inv-gifts-list q', (qs) => qs.map((q) => q.textContent))).includes('Bon courage pour la collection !'), 'Historique : le message est dans une citation');
  check(liste.includes("Bruno t'a offert 1 booster"), 'Historique : le don reçu reste affiché');
  // Un seul booster, sans message, à Chloé : singulier et message vide.
  await p.selectOption('#gift-to', CHLOE);
  await p.selectOption('#gift-qty', '1');
  await p.fill('#gift-msg', '');
  await p.click('[data-action=gift-ask]'); await sleep(300);
  await p.click('[data-action=gift-confirm]');
  check(await toast(p, '1 booster Classique offert à Chloé'), 'Don d\'un booster : toast « 1 booster Classique offert à Chloé »');
  await sleep(500);
  check((await solde(p)).stock === 1 && await stockInventaire(p) === '1', 'Don d\'un booster : stock 2 -> 1');
  liste = await p.textContent('#inv-gifts .inv-gifts-list');
  check(liste.includes('Tu as offert 1 booster Classique à Chloé'), 'Historique : « Tu as offert 1 booster Classique à Chloé »');
  check(await p.evaluate((c) => window.__DB.hg_booster_gifts.some((g) => g.to_user === c && g.qty === 1 && g.message === null), CHLOE),
    'Base : le don à Chloé est enregistré sans message');
  await goTab(p, 'ouverture'); await sleep(300);
  check((await boutonOuvrir(p)) === 'Ouvrir 1', 'Ouverture : « Ouvrir 1 » après les dons (1 en stock)');
  check(await hscroll(p) === 0, '360 px : Ouverture sans défilement horizontal');
  check(p.errs.length === 0, `Dons : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // ---------- 4. Historique en erreur ----------
  p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, scenario: { types: true, bal: 0, stock: { classique: 2 }, giftsError: true } });
  await goTab(p, 'inventaire'); await sleep(300);
  check((await p.textContent('#inv-gifts')).includes('Historique des dons indisponible pour le moment.'), 'Historique en erreur : message « indisponible »');
  check(!!(await p.$('#inv-gift-form')), 'Historique en erreur : le don reste possible (stock 2)');
  check(p.errs.length === 0, `Historique en erreur : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // ---------- 5. Repli : backend sans les RPC typées (migration 069 pas déployée) ----------
  // Pas d'achat ni de don proposés ; le stock d'origine (wallet gift_boosters) reste ouvrable.
  p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, scenario: { reqRpc: true, bal: 5000, gift: 2 } });
  await goTab(p, 'boutique'); await sleep(300);
  check(await p.$eval('#cartes-paid [data-action=buy-stock]', (b) => b.disabled && b.textContent.trim().startsWith('Acheter')), 'Repli : « Acheter » désactivé');
  check(await p.isVisible('#cartes-paid :text("La boutique ouvre bientôt.")'), 'Repli : note « La boutique ouvre bientôt. »');
  await goTab(p, 'inventaire'); await sleep(300);
  check(await p.isVisible('#inv-gift :text("Les dons de boosters arrivent bientôt.")'), 'Repli : « Les dons de boosters arrivent bientôt. »');
  check(!(await p.$('#inv-gift-form')), 'Repli : formulaire de don masqué');
  check((await stockInventaire(p)) === '2', 'Repli : « Boosters en stock » vaut 2');
  await goTab(p, 'ouverture'); await sleep(300);
  await p.click('#cartes-stock [data-action=open-gift]');
  await revelerTout(p);
  const jr = (await p.evaluate(() => window.__LOG)).filter((l) => l[0] === 'rpc' && l[1] === 'hg_open_booster_req');
  check(jr.length === 1 && jr[0][2]?.p_offert === true, 'Repli : l\'ouverture du stock passe par hg_open_booster_req (p_offert)');
  check(await p.evaluate(() => window.__DB.hg_wallets[0].gift_boosters) === 1, 'Repli : stock d\'origine 2 -> 1');
  check(await p.evaluate(() => window.__DB.hg_wallets[0].paillettes) === 5000, 'Repli : l\'ouverture du stock ne coûte aucune Paillette');
  check(await hscroll(p) === 0, 'Repli : Ouverture sans défilement horizontal');
  check(p.errs.length === 0, `Repli : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
