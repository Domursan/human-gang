// Parcours : aperçu admin de la bulle « Le livre est mieux » (cine.html?apercu=livre).
// Admin : la bulle s'affiche une fois sur le premier film vu ; membre : rien.
// Dans les deux cas, aucun appel à hg_egg_found (le secret n'est pas signalé). Faux Supabase : fixtures/fake-sb-vd.mjs.
// Lancer : node tests/parcours-apercu-livre.cjs
const { check, finish, openPage, sleep, log, chromium } = require('./lib/harness.cjs');

const ALICE = '00000002-0000-4000-8000-000000000002';
/** Appels à hg_egg_found dans le journal du faux client. */
const eggCalls = async (p) => (await log(p)).filter((e) => e[1] === 'hg_egg_found').length;

(async () => {
  const browser = await chromium.launch();

  // Admin (Ethan, par défaut) : bulle visible une fois
  let p = await openPage(browser, { page: 'cine', fixture: 'fake-sb-vd.mjs', width: 390, height: 844 });
  await p.evaluate(() => { history.replaceState(null, '', location.pathname + '?apercu=livre'); });
  await p.reload();
  await p.waitForSelector('.cine-bulle', { timeout: 6000 }).catch(() => {});
  check((await p.locator('.cine-bulle').count()) === 1, 'admin : la bulle « Le livre est mieux » s\'affiche');
  check(/Le livre est mieux\./.test(await p.locator('.cine-bulle').innerText()), 'admin : texte « Le livre est mieux. »');
  check((await p.locator('.cine-bulle').evaluate((b) => !!b.closest('.cine-seen-poster'))) === true, 'admin : bulle sur l\'affiche d\'un film vu');
  await p.waitForFunction(() => !document.querySelector('.cine-bulle'), null, { timeout: 5000 }).catch(() => {});
  check((await p.locator('.cine-bulle').count()) === 0, 'admin : la bulle disparaît d\'elle-même (une seule fois)');
  check((await eggCalls(p)) === 0, 'admin : aucun appel à hg_egg_found');
  check(p.errs.length === 0, 'admin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // Membre : le paramètre est ignoré
  p = await openPage(browser, { page: 'cine', fixture: 'fake-sb-vd.mjs', width: 390, height: 844, scenario: { uid: ALICE } });
  await p.evaluate(() => { history.replaceState(null, '', location.pathname + '?apercu=livre'); });
  await p.reload();
  await p.waitForSelector('.cine-seen', { timeout: 8000 }).catch(() => {});
  await sleep(500);
  check((await p.locator('.cine-bulle').count()) === 0, 'membre : aucune bulle (paramètre ignoré)');
  check((await eggCalls(p)) === 0, 'membre : aucun appel à hg_egg_found');
  await p.ctx.close();

  await browser.close();
  finish();
})();
