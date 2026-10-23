// Parcours : archive annuelle (idée A8) dans Site › Fonctionnement › Archives (administrateur seulement).
// (a) carte : année, 5 parties cochées, mention des exclusions ; aucune partie : message d'erreur, aucun appel.
// (b) téléchargement en 2 parties : la fonction hg-archive (simulée) est appelée pour la partie 1 puis 2, avec l'année
//     et les parties choisies, et les deux ZIP sont proposés (« partie 1 sur 2 »).
// (c) Staff « reglages » : pas d'Archives (adresse redirigée). (d) 375 px sans défilement horizontal.
// La fonction edge est simulée par une route de page (aucune requête vers la vraie base).
// Lancer : node tests/parcours-admin-archive.cjs
const { check, finish, openPage, hscroll, adminSection, sleep, chromium } = require('./lib/harness.cjs');

const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;

(async () => {
  const browser = await chromium.launch();
  try {
    let p = await openPage(browser, { page: 'admin' });
    const calls = [];
    await p.route('**/functions/v1/hg-archive', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      calls.push(body);
      await route.fulfill({ status: 200, body: Buffer.from('PK\u0005\u0006' + '\0'.repeat(18)), headers: { 'Content-Type': 'application/zip', 'X-Archive-Parts': '2', 'Access-Control-Expose-Headers': 'X-Archive-Parts' } });
    });
    await adminSection(p, 'site/archives');
    await p.waitForSelector('#ar-form', { timeout: 5000 });
    check(await p.$$eval('#ar-year option', (o) => o.length) >= 5 && await p.$$eval('#ar-form input[name="parts"]:checked', (i) => i.length) === 5, '(a) année et 5 parties cochées');
    check(/Jamais dans l’archive/.test(await p.textContent('#ar-form')), '(a) exclusions annoncées');
    for (const i of await p.$$('#ar-form input[name="parts"]')) await i.uncheck();
    await p.click('#ar-form button[type="submit"]');
    check(await p.isVisible('#ar-form .form-error') && calls.length === 0, '(a) aucune partie : erreur, aucun appel');
    await p.check('#ar-form input[value="moments"]');
    await p.check('#ar-form input[value="sorties"]');
    await p.selectOption('#ar-year', '2025');
    const names = [];
    p.on('download', (d) => names.push(d.suggestedFilename()));
    await p.click('#ar-form button[type="submit"]');
    await p.waitForFunction(() => /téléchargée/.test(document.querySelector('.ar-progress')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    await sleep(500);
    check(calls.length === 2 && calls[0].part === 1 && calls[1].part === 2 && calls[0].year === 2025 && JSON.stringify(calls[0].parts) === '["moments","sorties"]',
      `(b) hg-archive appelée pour les parties 1 et 2 (${JSON.stringify(calls)})`);
    check(names.length === 2 && /partie 1 sur 2/.test(names[0]) && /partie 2 sur 2/.test(names[1]), `(b) deux ZIP proposés (${names.join(' | ')})`);
    check(/2 parties/.test(await p.textContent('.ar-progress')), '(b) avancement : « téléchargée en 2 parties »');
    check(p.errs.length === 0, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.slice(0, 3).join(' | ') + ')' : ''));
    await p.ctx.close();

    p = await openPage(browser, { page: 'admin', scenario: { uid: U(2), staff: ['reglages'] } });
    await p.evaluate(() => { location.hash = '#site/archives'; });
    await sleep(600);
    check(await p.evaluate(() => location.hash) !== '#site/archives' && !(await p.isVisible('#archives')), '(c) Staff : Archives redirigée, jamais affichée');
    await p.ctx.close();

    p = await openPage(browser, { page: 'admin', width: 375, height: 812 });
    await adminSection(p, 'site/archives');
    await p.waitForSelector('#ar-form', { timeout: 5000 });
    check(await hscroll(p) <= 0, '(d) 375 px : pas de défilement horizontal');
    await p.ctx.close();
  } catch (e) {
    check(false, 'arrêt sur erreur : ' + String(e.message).split('\n')[0]);
  } finally {
    await browser.close();
  }
  finish();
})();
