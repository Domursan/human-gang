// Parcours : journal des erreurs du navigateur (idée A9, migration 093).
// (a) une page lève une erreur : elle est remontée une seule fois par visite (hg_client_error), sans donnée personnelle
//     (message nettoyé, fichier relatif, page sans paramètres) ; « Script error. » ignorée ; 5 remontées au plus.
// (b) admin, Site › Fonctionnement › Erreurs du site : compteur du rail, tableau filtré « Nouvelles », détail (pages,
//     navigateurs, 7 jours), « Corrigée » (hg_client_error_set), « Créer une demande » (hg_client_error_ticket → Assistance).
// (c) Staff sans « reglages » : pas de sous-section ; Staff « reglages » : la voit, sans « Archives » (admin seulement).
// (d) 375 px : sans défilement horizontal.
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours-admin-erreurs.cjs
const { check, finish, openPage, hscroll, adminSection, countOf, log, sleep, chromium } = require('./lib/harness.cjs');

const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const day = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(new Date(Date.now() - d * 864e5));
const ERRS = [
  { id: 1, signature: 'a'.repeat(32), message: "TypeError: Cannot read properties of null (reading 'dataset')", file: 'js/cartes-trades.js', line: 212, col: 18,
    pages: ['/cartes.html', '/membre.html', '/accueil.html'], browsers: { 'Safari iOS 17': 29, 'Chrome Android': 6, Firefox: 2 },
    days: { [day(0)]: 20, [day(1)]: 10, [day(3)]: 7 }, count: 37, first_seen: ago(48), last_seen: ago(2), last_version: 'v47', status: 'nouvelle' },
  { id: 2, signature: 'b'.repeat(32), message: 'Unhandled rejection: Failed to fetch', file: 'js/push.js', line: 88, pages: ['/accueil.html'], browsers: { Chrome: 12 },
    days: {}, count: 12, first_seen: ago(30), last_seen: ago(5), last_version: 'v47', status: 'nouvelle' },
  { id: 3, signature: 'c'.repeat(32), message: 'TypeError: navigator.share is not a function', file: 'js/recap.js', line: 530, pages: ['/recap.html'], browsers: { Firefox: 9 },
    days: {}, count: 9, first_seen: ago(200), last_seen: ago(72), last_version: 'v46', status: 'connue' },
];

(async () => {
  const browser = await chromium.launch();
  try {
    /* ---------- (a) remontée ---------- */
    let p = await openPage(browser, { page: 'aide', scenario: { guest: true } });
    await p.evaluate(() => {
      const boom = () => { throw new Error('Boom pour jean.dupont@example.com 0791234567'); };
      for (let i = 0; i < 3; i++) setTimeout(boom, 10);
      setTimeout(() => window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: '', lineno: 0 })), 20);
      for (let i = 0; i < 8; i++) setTimeout(() => { throw new Error('Erreur numéro ' + 'ABCDEFGH'[i]); }, 30);
    });
    await sleep(3500);
    const calls = (await log(p)).filter((l) => l[0] === 'rpc' && l[1] === 'hg_client_error').map((l) => l[2].p);
    const boom = calls.filter((c) => /Boom/.test(c.message));
    check(boom.length === 1, `(a) même erreur remontée une seule fois (${boom.length})`);
    check(boom[0] && /Boom pour \[e-mail\] \[nombre\]$/.test(boom[0].message), `(a) message nettoyé (${boom[0]?.message})`);
    check(boom[0] && boom[0].page === 'aide.html' && !/[?#]/.test(boom[0].page) && !/^https?:/.test(boom[0].file || ''), `(a) page et fichier sans adresse complète (${boom[0]?.page}, ${boom[0]?.file})`);
    check(boom[0] && !('user_id' in boom[0]) && !('pseudo' in boom[0]) && typeof boom[0].browser === 'string', '(a) aucune donnée de compte, famille de navigateur seulement');
    check(!calls.some((c) => /Script error/i.test(c.message)), '(a) « Script error. » ignorée');
    check(calls.length === 5, `(a) 5 remontées par visite au plus (${calls.length})`);
    check(!(await log(p)).some((l) => l[0] === 'rpc-401' && l[1] === 'hg_client_error'), '(a) appel accepté sans compte');
    await p.ctx.close();

    /* ---------- (b) admin ---------- */
    p = await openPage(browser, { page: 'admin', scenario: { clientErrors: ERRS } });
    await sleep(800);
    check((await countOf(p, 'mairie', 'erreurs')) === '2', '(b) compteur de la tuile Erreurs du site : 2 nouvelles erreurs');
    await adminSection(p, 'mairie/erreurs');
    await p.waitForSelector('.er-tbl', { timeout: 5000 });
    check(await p.$$eval('.er-tbl tbody tr', (r) => r.length) === 2, '(b) filtre « Nouvelles » par défaut : 2 groupes');
    check(/cartes-trades\.js:212/.test(await p.textContent('.er-tbl')) && /37/.test(await p.textContent('.er-tbl')), '(b) fichier:ligne et nombre de fois');
    const det = await p.textContent('.er-detail');
    check(/\/cartes\.html/.test(det) && /Safari iOS 17/.test(det) && await p.$$eval('.er-days span', (s) => s.length) === 7, '(b) détail : pages, navigateurs, 7 derniers jours');
    const pick = await p.locator('[data-er-pick="1"]').boundingBox();
    check(pick && pick.height >= 44, '(b) ligne cliquable ≥ 44 px');
    await p.click('.ui-chip[data-er-filter="all"]');
    check(await p.$$eval('.er-tbl tbody tr', (r) => r.length) === 3, '(b) « Toutes » : 3 groupes');
    await p.click('[data-er-pick="1"]');
    await p.click('[data-er-status="corrigee"]');
    await sleep(500);
    check((await log(p)).some((l) => l[0] === 'rpc' && l[1] === 'hg_client_error_set' && l[2].p_id === 1 && l[2].p_status === 'corrigee'), '(b) « Corrigée » : hg_client_error_set');
    check((await countOf(p, 'mairie', 'erreurs')) === '1', '(b) compteur mis à jour (1)');
    await p.click('[data-er-ticket]');
    await p.waitForFunction(() => location.hash.startsWith('#poste/assistance/sup-err-1'), null, { timeout: 5000 }).catch(() => {});
    check(await p.evaluate(() => location.hash) === '#poste/assistance/sup-err-1', '(b) « Créer une demande » ouvre la demande d’assistance');
    check(p.errs.length === 0, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.slice(0, 3).join(' | ') + ')' : ''));
    await p.ctx.close();

    /* ---------- (c) Staff ---------- */
    p = await openPage(browser, { page: 'admin', scenario: { uid: U(2), staff: ['cartes'], clientErrors: ERRS } });
    await p.evaluate(() => { location.hash = '#mairie'; });
    await sleep(600);
    check(await p.locator('#lieu-root .lieu-tile[data-sub="erreurs"]').count() === 0, '(c) Staff sans « reglages » : pas d’Erreurs du site sur La Mairie');
    check(!(await log(p)).some((l) => l[0] === 'select' && l[1] === 'hg_client_errors'), '(c) Staff sans « reglages » : journal jamais lu');
    await p.ctx.close();
    p = await openPage(browser, { page: 'admin', scenario: { uid: U(2), staff: ['reglages'], clientErrors: ERRS } });
    await p.evaluate(() => { location.hash = '#mairie'; });
    await p.waitForSelector('#lieu-root .lieu-tile', { timeout: 5000 }).catch(() => {});
    check(await p.locator('#lieu-root .lieu-tile[data-sub="erreurs"]').count() === 1 && await p.locator('#lieu-root .lieu-tile[data-sub="archives"]').count() === 0,
      '(c) Staff « reglages » : Erreurs du site, sans Archives');
    await p.ctx.close();

    /* ---------- (d) 375 px ---------- */
    p = await openPage(browser, { page: 'admin', width: 375, height: 812, scenario: { clientErrors: ERRS } });
    await adminSection(p, 'mairie/erreurs');
    await p.waitForSelector('.er-tbl', { timeout: 5000 });
    check(await hscroll(p) <= 0, '(d) 375 px : pas de défilement horizontal');
    await p.ctx.close();
  } catch (e) {
    check(false, 'arrêt sur erreur : ' + String(e.message).split('\n')[0]);
  } finally {
    await browser.close();
  }
  finish();
})();
