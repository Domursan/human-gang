// Parcours : proposer un échange de cartes (cartes.html › Échanges › Proposer).
// Après l'envoi de l'offre, le site appelle la fonction hg-notify avec { event: 'trade_offer', trade_id } (MP au
// destinataire). Contrôles sur le journal du faux client (window.__LOG) : l'appel part avec l'id renvoyé par
// hg_trade_propose, et une erreur de la RPC n'appelle pas hg-notify.
// Faux Supabase : fixtures/fake-sb-cartes.mjs (hg_trade_propose renvoie un uuid, comme la vraie RPC).
// Lancer : node tests/parcours-cartes-offre.cjs
const { ROOT, check, finish, openPage, log, chromium } = require('./lib/harness.cjs');

const BOB = '00000002-0000-4000-8000-000000000002'; // Alice (membre proposé)
const TRADE_ID = '7e57c0de-0000-4000-8000-000000000001';

async function proposer(p) {
  await p.click('[data-tab=echanges]');
  await p.waitForSelector('#trd-tab-proposer', { timeout: 5000 });
  await p.click('#trd-tab-proposer');
  await p.selectOption('#trd-who', BOB);
  await p.click('#trd-panel [data-act=compose]');
  await p.waitForSelector('#trd-form [data-side=give][data-id]', { timeout: 5000 });
  await p.click('#trd-form [data-side=give][data-id]');
  await p.waitForSelector('#trd-send:not([disabled])', { timeout: 5000 }).catch(() => {});
  await p.click('#trd-send');
}
const notifyCalls = async (p) => p.evaluate(() => (window.__LOG || []).filter((e) => e[0] === 'fn' && e[1] === 'hg-notify').map((e) => e[2]));

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  // 1. Offre envoyée : hg-notify reçoit trade_offer avec l'id de l'offre.
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280 });
  await proposer(p);
  await p.waitForFunction(() => (window.__LOG || []).some((e) => e[0] === 'fn' && e[1] === 'hg-notify'), null, { timeout: 5000 }).catch(() => {});
  const rpc = (await log(p)).find((l) => l[0] === 'rpc' && l[1] === 'hg_trade_propose');
  check(!!rpc && rpc[2]?.p_to === BOB, 'offre envoyée à hg_trade_propose (destinataire choisi)');
  const calls = await notifyCalls(p);
  check(calls.length === 1, 'hg-notify appelée une seule fois après l\'envoi');
  check(calls[0]?.event === 'trade_offer' && calls[0]?.trade_id === TRADE_ID, 'hg-notify appelée avec trade_offer et l\'id de l\'offre');
  check(!(await p.$('#trd-edit[open]')), 'éditeur fermé après l\'envoi');
  check(!p.errs.length, 'offre : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 2. Offre refusée par la RPC : rien n'est notifié, le message d'erreur reste dans l'éditeur.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, scenario: { tradeFail: true } });
  await proposer(p);
  await p.waitForSelector('#trd-err:not(:empty)', { timeout: 5000 }).catch(() => {});
  check(/Trop d/.test(await p.textContent('#trd-err').catch(() => '')), 'erreur de la RPC affichée dans l\'éditeur');
  check((await notifyCalls(p)).length === 0, 'offre refusée : hg-notify non appelée');
  await p.ctx.close();

  await browser.close();
  finish();
})();
