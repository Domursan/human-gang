// Parcours : aperçu admin de la bannière Pentakill (cartes.html?apercu=pentakill).
// Admin : la bannière s'affiche une fois (variante « Cinq cartes de même rareté ») ; membre : rien.
// Dans les deux cas, aucun appel à hg_pentakill_check (ni badge). Faux Supabase : fixtures/fake-sb-cartes.mjs.
// Lancer : node tests/parcours-apercu-pentakill.cjs
const { check, finish, openPage, sleep, log, chromium } = require('./lib/harness.cjs');

const ALICE = '00000002-0000-4000-8000-000000000002';
/** Appels à hg_pentakill_check dans le journal du faux client. */
const pentaCalls = async (p) => (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_pentakill_check').length;

(async () => {
  const browser = await chromium.launch();

  // Admin (Ethan, par défaut) : bannière visible une fois
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', hash: '', width: 390, height: 844 });
  await p.evaluate(() => { history.replaceState(null, '', location.pathname + '?apercu=pentakill'); });
  await p.reload();
  await p.waitForSelector('.penta', { timeout: 6000 }).catch(() => {});
  check((await p.locator('.penta').count()) === 1, 'admin : la bannière Pentakill s\'affiche');
  check((await p.locator('.penta-sub').textContent()).trim() === 'Cinq cartes de même rareté', 'admin : variante « Cinq cartes de même rareté »');
  check((await p.locator('.penta').getAttribute('role')) === 'status', 'admin : annoncée en statut (role=status)');
  await p.waitForFunction(() => !document.querySelector('.penta'), null, { timeout: 4000 }).catch(() => {});
  check((await p.locator('.penta').count()) === 0, 'admin : la bannière disparaît d\'elle-même (une seule fois)');
  check((await pentaCalls(p)) === 0, 'admin : aucun appel à hg_pentakill_check');
  check(p.errs.length === 0, 'admin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // Membre : le paramètre est ignoré
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', hash: '', width: 390, height: 844, scenario: { uid: ALICE } });
  await p.evaluate(() => { history.replaceState(null, '', location.pathname + '?apercu=pentakill'); });
  await p.reload();
  await p.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 8000 }).catch(() => {});
  await sleep(500);
  check((await p.locator('.penta').count()) === 0, 'membre : aucune bannière (paramètre ignoré)');
  check((await pentaCalls(p)) === 0, 'membre : aucun appel à hg_pentakill_check');
  await p.ctx.close();

  await browser.close();
  finish();
})();
