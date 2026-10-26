// Présence et notifications du site (migration 153, core/presence.js) : cloche avec le nombre de non lues, liste,
// « Tout marquer comme lu », réglage « Masquer mon statut », pastilles « en ligne » dans l'annuaire (membre.html),
// à 390 px (tactile) et 1280 px. Faux serveur : tests/fixtures/fake-presence.js.
// Lancer : node tests/parcours-presence.cjs
const { check, finish, openPage, chromium } = require('./lib/harness.cjs');

(async () => {
  const browser = await chromium.launch();
  for (const [w, mobile] of [[1280, false], [390, true]]) {
    const p = await openPage(browser, { page: 'accueil', width: w, height: 900, mobile, init: 'fake-presence.js' });
    await p.waitForSelector('#notif-btn', { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(600);
    check(await p.locator('#notif-btn').count() === 1, `${w} px : cloche dans l'en-tête`);
    check((await p.locator('#notif-btn .notif-badge').textContent()) === '1' && await p.isVisible('#notif-btn .notif-badge'), `${w} px : pastille « 1 » non lue`);
    check((await p.getAttribute('#notif-btn', 'aria-label')).includes('1 non lue'), `${w} px : libellé « Notifications : 1 non lue »`);
    check(await p.evaluate(() => window.__PRES.pings) >= 1, `${w} px : signal de vie envoyé`);
    await p.click('#notif-btn');
    await p.waitForSelector('.notif-item', { timeout: 4000 }).catch(() => {});
    check(await p.locator('.notif-item').count() === 2 && await p.locator('.notif-item.is-new').count() === 1, `${w} px : liste de 2 notifications, 1 nouvelle`);
    const box = await p.locator('#notif-panel').boundingBox();
    check(box && box.x >= 0 && box.x + box.width <= w + 1, `${w} px : panneau entièrement dans l'écran`);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${w} px : pas de défilement horizontal`);
    await p.click('[data-notif-act="lire"]');
    await p.waitForTimeout(200);
    check(await p.locator('.notif-item.is-new').count() === 0 && await p.isHidden('#notif-btn .notif-badge'), `${w} px : « Tout marquer comme lu » vide le compteur`);
    await p.click('.notif-statut span');
    await p.waitForTimeout(200);
    check(await p.evaluate(() => window.__PRES.masque) === true, `${w} px : « Masquer mon statut » envoyé`);
    await p.keyboard.press('Escape');
    check(await p.isHidden('#notif-panel'), `${w} px : Échap ferme le panneau`);
    check(!p.errs.length, `${w} px : aucune erreur JS` + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
    await p.ctx.close();
  }
  // Annuaire : pastilles en ligne / hors ligne
  const p = await openPage(browser, { page: 'membre', width: 1280, height: 900, init: 'fake-presence.js' });
  await p.waitForSelector('.gang-item .presence-dot', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(800);
  const dots = await p.$$eval('.gang-item .presence-dot', (els) => els.map((e) => ({ id: e.dataset.presence, on: e.classList.contains('is-online'), l: e.getAttribute('aria-label') })));
  check(dots.length >= 2, `annuaire : une pastille par membre (${dots.length})`);
  check(dots.some((d) => d.on && d.l === 'En ligne') && dots.some((d) => !d.on && d.l.startsWith('Hors ligne')), 'annuaire : « En ligne » et « Hors ligne (vu …) » selon le serveur');
  check(!p.errs.length, 'annuaire : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();
  await browser.close();
  finish();
})();
