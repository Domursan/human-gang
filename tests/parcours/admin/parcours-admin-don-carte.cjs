// Parcours : donner une carte à un membre (/pages/admin/admin.html › Jeu de cartes › Joueurs). Après un don réussi, le site appelle
// la fonction hg-notify avec { event: 'card_gift_admin', user_id, card_id, count, shiny } (MP au membre). Si la RPC
// hg_cards_admin_give échoue, aucun appel hg-notify n'est fait et l'erreur reste dans le tiroir.
// Faux Supabase : fixtures/fake-sb-cartes.mjs (scenario.giveFail = true fait échouer la RPC).
// Lancer : node tests/parcours/admin/parcours-admin-don-carte.cjs
const { ROOT, check, finish, openPage, adminSection, chromium } = require('../../lib/harness.cjs');

const ALICE = '00000002-0000-4000-8000-000000000002';
/** Tiroir de dialogue ouvert (dialog.ui-drawer[open]). */
const drawer = (p) => p.locator('dialog.ui-drawer[open]');
/** Clique sur le bouton de validation du tiroir ouvert. */
const submitDrawer = (p) => p.click('dialog.ui-drawer[open] [data-drawer-submit]');
/** Appels de hg-notify faits depuis le panel admin (journal du faux client). */
const notifyCalls = (p) => p.evaluate(() => (window.__LOG || []).filter((e) => e[0] === 'fn' && e[1] === 'hg-notify').map((e) => e[2]));
/** Appels de la RPC hg_cards_admin_give (journal du faux client). */
const giveCalls = (p) => p.evaluate(() => (window.__LOG || []).filter((e) => e[0] === 'rpc' && e[1] === 'hg_cards_admin_give').map((e) => e[2]));
// Donne une carte au membre choisi ; announce / notify = état des deux cases (true par défaut).
/** Donne 2 exemplaires de la première carte à Alice depuis le tiroir ouvert. announce et notify décochent l'annonce ou le MP (cochés par défaut). */
async function donner(p, { announce = true, notify = true } = {}) {
  await p.selectOption('#acd-give-card', { index: 1 });
  await p.fill('#acd-give-count', '2');
  if (!announce) await p.click('dialog.ui-drawer[open] label:has(input[name="announce"])');
  if (!notify) await p.click('dialog.ui-drawer[open] label:has(input[name="notify"])');
  await submitDrawer(p);
  await p.waitForSelector('dialog.ui-drawer', { state: 'detached', timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(300);
}

/** Ouvre la fiche d'Alice dans Jeu de cartes › Joueurs, puis le tiroir « Donner une carte ». */
async function ouvrirDon(p) {
  await adminSection(p, 'fabrique/joueurs');
  await p.evaluate((id) => { location.hash = 'cartes/joueurs/' + id; }, ALICE);
  await p.waitForSelector('[data-act="give-open"]', { timeout: 8000 });
  await p.click('[data-act="give-open"]');
  await p.waitForSelector('dialog.ui-drawer[open] #acd-give-card', { timeout: 5000 });
}

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  // 1. Don réussi : hg-notify reçoit card_gift_admin avec le membre, la carte, 3 exemplaires et la brillance.
  let p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900 });
  await ouvrirDon(p);
  await p.selectOption('#acd-give-card', { index: 1 });
  await p.fill('#acd-give-count', '3');
  await p.click('dialog.ui-drawer[open] label:has(input[name="shiny"])');
  await submitDrawer(p);
  await p.waitForSelector('dialog.ui-drawer', { state: 'detached', timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => (window.__LOG || []).some((e) => e[0] === 'fn' && e[1] === 'hg-notify'), null, { timeout: 5000 }).catch(() => {});
  const calls = await notifyCalls(p);
  check(calls.length === 1, 'don réussi : hg-notify appelée une seule fois');
  check(calls[0]?.event === 'card_gift_admin', 'don réussi : événement card_gift_admin');
  check(calls[0]?.user_id === ALICE, 'don réussi : destinataire = le membre choisi');
  check(typeof calls[0]?.card_id === 'string' && calls[0].card_id !== '', 'don réussi : id de la carte transmis');
  check(calls[0]?.count === 3 && calls[0]?.shiny === true, 'don réussi : 3 exemplaires, brillante');
  check(!p.errs.length, 'don réussi : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  check((await giveCalls(p))[0]?.p_announce === true, 'fil coché (défaut) : p_announce = true');
  await p.ctx.close();

  // 1b. Case « fil d'actualité » décochée : p_announce = false, le MP part toujours.
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900 });
  await ouvrirDon(p);
  await donner(p, { announce: false });
  check((await giveCalls(p))[0]?.p_announce === false, 'fil décoché : p_announce = false');
  check((await notifyCalls(p)).length === 1, 'fil décoché, MP coché : hg-notify appelée');
  await p.ctx.close();

  // 1c. Case « MP Discord » décochée : aucun appel hg-notify, le don passe quand même.
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900 });
  await ouvrirDon(p);
  await donner(p, { notify: false });
  check((await giveCalls(p)).length === 1, 'MP décoché : don envoyé à la RPC');
  check((await notifyCalls(p)).length === 0, 'MP décoché : hg-notify non appelée');
  await p.ctx.close();

  // 2. RPC refusée : aucun MP (hg-notify non appelée), l'erreur reste affichée dans le tiroir.
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900, scenario: { giveFail: true } });
  await ouvrirDon(p);
  await p.selectOption('#acd-give-card', { index: 1 });
  await submitDrawer(p);
  await p.waitForSelector('dialog.ui-drawer[open] .form-error:not([hidden])', { timeout: 5000 }).catch(() => {});
  check(!!(await p.$('dialog.ui-drawer[open] .form-error:not([hidden])')), 'RPC refusée : erreur affichée dans le tiroir');
  check((await notifyCalls(p)).length === 0, 'RPC refusée : hg-notify non appelée');
  check(await drawer(p).count() === 1, 'RPC refusée : le tiroir reste ouvert');
  await p.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
