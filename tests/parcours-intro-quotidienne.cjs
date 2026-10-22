// L'intro se rejoue une fois par jour : l'accueil y renvoie si elle n'a pas été jouée aujourd'hui, puis plus ce jour-là.
// Faux Supabase. Lancer : node tests/parcours-intro-quotidienne.cjs
const { ORIGIN, PREFIX, check, finish, openPage, sleep, chromium } = require('./lib/harness.cjs');
/** Vrai si le chemin de la page courante correspond à l'expression re. */
const at = (p, re) => re.test(new URL(p.url()).pathname);
(async () => {
  const browser = await chromium.launch();
  const p = await openPage(browser, { page: 'accueil', scenario: { intro: true } });
  await p.waitForURL(/index\.html/, { timeout: 8000 }).catch(() => {});
  check(at(p, /index\.html$/), `accueil → intro (${p.url()})`);
  await p.click('#skip');
  await p.waitForURL(/accueil\.html/, { timeout: 8000 }).catch(() => {});
  await sleep(800);
  check(at(p, /accueil\.html$/), 'passer l\'intro → accueil, sans boucle');
  await p.goto(`${ORIGIN}${PREFIX}/accueil.html`); await sleep(700);
  check(at(p, /accueil\.html$/), 'même jour : accueil direct');
  await p.goto(`${ORIGIN}${PREFIX}/index.html`); await p.waitForURL(/accueil\.html/, { timeout: 8000 }).catch(() => {});
  check(at(p, /accueil\.html$/), 'même jour : index.html → accueil');
  await p.evaluate(() => localStorage.setItem('hg_intro_day', '2000-1-1'));
  await p.goto(`${ORIGIN}${PREFIX}/accueil.html`); await p.waitForURL(/index\.html/, { timeout: 8000 }).catch(() => {});
  check(at(p, /index\.html$/), 'jour suivant : intro rejouée');
  check(!p.errs.filter((e) => !/^404 /.test(e)).length, 'aucune erreur console : ' + p.errs.join(' | '));
  await browser.close();
  finish();
})();
