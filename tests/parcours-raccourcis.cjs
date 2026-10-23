// Parcours : raccourcis clavier (idée Q8). « g » puis une lettre → page ; étiquette « g… » pendant l'attente ;
// frappe dans un champ → aucune navigation ; « / » ouvre la recherche ; « ? » ouvre l'aide-mémoire (focus dedans,
// raccourcis de la page Cartes listés, Échap le ferme) ; préférence coupée → plus rien ; « Désactiver les raccourcis » ;
// admin.html n'installe pas les raccourcis. Faux Supabase : fixtures/fake-sb.mjs.
// Lancer : node tests/parcours-raccourcis.cjs
const { ROOT, check, finish, openPage, sleep, chromium } = require('./lib/harness.cjs');

const page = (p) => p.evaluate(() => location.pathname.split('/').pop());

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  // 1. g puis c → cartes.html, étiquette « g… »
  let p = await openPage(browser, { page: 'accueil', width: 1280 });
  await p.waitForSelector('.site-header .nav-search-open', { timeout: 8000 }).catch(() => {});
  await p.keyboard.press('g');
  check(await p.isVisible('#kbd-hint'), 'après « g » : étiquette « g… » affichée');
  await Promise.all([p.waitForURL(/cartes\.html/, { timeout: 5000 }).catch(() => {}), p.keyboard.press('c')]);
  check(await page(p) === 'cartes.html', 'g puis c → cartes.html');

  // 2. « ? » sur Cartes : aide-mémoire, focus dedans, raccourcis de la page, Échap le ferme
  await p.waitForSelector('.site-header .nav-search-open', { timeout: 8000 }).catch(() => {});
  await p.keyboard.press('Shift+?');
  await p.waitForSelector('.kbd-dialog[open]', { timeout: 3000 }).catch(() => {});
  check(await p.isVisible('.kbd-dialog[open]'), '« ? » ouvre l’aide-mémoire');
  check(await p.evaluate(() => !!document.activeElement?.closest('.kbd-dialog')), 'le focus est dans l’aide-mémoire');
  const txt = await p.textContent('.kbd-dialog');
  check(/Sur la page Cartes/.test(txt) && /Fermer le zoom/.test(txt), 'raccourcis de la page Cartes listés');
  check(/Sorties IRL/.test(txt) && /Mon compte/.test(txt), 'raccourcis « Aller à » listés');
  await p.keyboard.press('Escape');
  await sleep(150);
  check(!(await p.isVisible('.kbd-dialog[open]')), 'Échap ferme l’aide-mémoire');

  // 3. « / » ouvre la recherche
  await p.keyboard.press('/');
  await sleep(200);
  check(await p.evaluate(() => document.activeElement?.id === 'search-q'), '« / » ouvre la recherche (champ actif)');
  // 4. Frappe dans un champ : aucune navigation
  await p.keyboard.type('gi');
  await sleep(1600);
  check(await page(p) === 'cartes.html', 'g i tapé dans un champ : pas de navigation');
  // Dans un champ de type « recherche », la première Échap vide le champ ; la seconde ferme la recherche.
  await p.keyboard.press('Escape');
  await sleep(150);
  await p.keyboard.press('Escape');
  await sleep(150);
  check(!(await p.isVisible('.search-dialog[open]')), 'Échap ferme la recherche');
  // 5. Délai dépassé : g … (2 s) i → rien
  await p.keyboard.press('g');
  await sleep(1700);
  await p.keyboard.press('i');
  await sleep(400);
  check(await page(p) === 'cartes.html' && !(await p.isVisible('#kbd-hint')), 'seconde touche trop tardive : rien');
  // 6. Ctrl + g : ignoré
  await p.keyboard.press('Control+g');
  check(!(await p.isVisible('#kbd-hint')), 'avec Ctrl : ignoré');

  // 7. « Désactiver les raccourcis » dans l'aide-mémoire, puis plus rien
  await p.keyboard.press('Shift+?');
  await p.waitForSelector('.kbd-dialog[open]', { timeout: 3000 }).catch(() => {});
  await p.click('.kbd-dialog [data-kbd=off]');
  await sleep(150);
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('hg_prefs')).shortcuts === false), '« Désactiver les raccourcis » coupe la préférence');
  await p.keyboard.press('g');
  await p.keyboard.press('a');
  await sleep(500);
  check(await page(p) === 'cartes.html' && !(await p.isVisible('#kbd-hint')), 'préférence coupée : plus aucun raccourci');
  await p.keyboard.press('Shift+?');
  await sleep(200);
  check(!(await p.isVisible('.kbd-dialog[open]')), 'préférence coupée : « ? » n’ouvre rien');
  // La préférence se réactive dans le panneau des préférences
  await p.click('.prefs-open').catch(() => {});
  await p.waitForSelector('.prefs-dialog[open] input[name=shortcuts]', { timeout: 3000 }).catch(() => {});
  check(await p.isVisible('.prefs-dialog[open] input[name=shortcuts]'), 'interrupteur « Raccourcis clavier » dans les préférences (ordinateur)');
  check(await p.isVisible('.prefs-dialog[open] input[name=revealDirect]'), 'interrupteur « Révéler mes boosters d’un coup » dans les préférences');
  await p.check('.prefs-dialog[open] input[name=shortcuts]');
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('hg_prefs')).shortcuts === true), 'préférence réactivée');
  check(!p.errs.length, 'aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 8. Admin : pas de raccourcis
  p = await openPage(browser, { page: 'admin', width: 1280 });
  await sleep(1500);
  await p.keyboard.press('g');
  check(!(await p.isVisible('#kbd-hint')), 'admin.html : pas de raccourcis');
  await p.ctx.close();

  // 9. Écran tactile : la ligne « Raccourcis clavier » est cachée
  p = await openPage(browser, { page: 'accueil', width: 390, height: 800, mobile: true, dpr: 2 });
  await p.waitForSelector('.prefs-open', { timeout: 8000 }).catch(() => {});
  await p.evaluate(() => document.querySelector('.prefs-open')?.click());
  await p.waitForSelector('.prefs-dialog[open]', { timeout: 3000 }).catch(() => {});
  check(!(await p.isVisible('.prefs-dialog[open] input[name=shortcuts]')), 'écran tactile : ligne « Raccourcis clavier » cachée');
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '390 px : pas de défilement horizontal');
  await p.ctx.close();

  await browser.close();
  finish();
})();
