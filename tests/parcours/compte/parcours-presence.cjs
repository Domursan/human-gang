// Présence et notifications du site (migration 153, core/presence.js) : voyant de statut sur la photo du membre
// (vert = en ligne, rouge barré = statut masqué, badge = non lues), clic sur le voyant -> panneau des notifications,
// clic sur la photo -> menu en arc (inchangé), clavier, zone tactile, « Tout marquer comme lu », « Masquer mon statut »,
// pastilles « en ligne » dans l'annuaire (/pages/compte/membre.html). À 390 px (tactile) et 1280 px. Faux serveur : tests/fixtures/fake-presence.js.
// Lancer : node tests/parcours/compte/parcours-presence.cjs
const { check, finish, openPage, chromium } = require('../../lib/harness.cjs');

(async () => {
  const browser = await chromium.launch();
  for (const [w, mobile] of [[1280, false], [390, true]]) {
    const tag = `${w} px${mobile ? ' (tactile)' : ''}`;
    const p = await openPage(browser, { page: 'accueil', width: w, height: 900, mobile, init: 'fake-presence.js' });
    await p.waitForSelector('#statut-btn', { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(600);

    // Voyant sur la photo, distinct de la photo
    check(await p.locator('.nav-me-wrap #statut-btn').count() === 1, `${tag} : voyant posé sur la photo (.nav-me-wrap)`);
    check(await p.locator('.nav-me #statut-btn').count() === 0, `${tag} : le voyant n'est pas dans le bouton de la photo`);
    check(await p.locator('#notif-btn, .notif-btn').count() === 0, `${tag} : plus de cloche séparée dans l'en-tête`);
    check(await p.evaluate(() => window.__PRES.pings) >= 1, `${tag} : signal de vie envoyé`);
    check((await p.locator('#statut-btn .statut-n').textContent()) === '1' && await p.isVisible('#statut-btn .statut-n'), `${tag} : badge « 1 » non lue sur le voyant`);
    const libelle = await p.getAttribute('#statut-btn', 'aria-label');
    check(libelle === 'Statut et notifications : en ligne, 1 non lue', `${tag} : libellé « ${libelle} »`);
    check(await p.getAttribute('#statut-btn', 'aria-expanded') === 'false', `${tag} : aria-expanded = false au repos`);
    check(await p.$eval('#statut-btn .presence-dot', (d) => d.classList.contains('is-online')), `${tag} : voyant vert (en ligne)`);
    const couleur = await p.$eval('#statut-btn .presence-dot', (d) => getComputedStyle(d).backgroundColor);
    check(couleur === 'rgb(47, 180, 99)', `${tag} : couleur verte du voyant (${couleur})`);
    // Zone de toucher : 24 px minimum ; au doigt, un point à 20 px du centre (hors du disque visible) atteint encore le voyant
    const box = await p.locator('#statut-btn').boundingBox();
    check(box && box.width >= 24 && box.height >= 24, `${tag} : zone cliquable ≥ 24 × 24 px`);
    if (mobile) {
      const touche = await p.evaluate(() => {
        const r = document.getElementById('statut-btn').getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const el = document.elementFromPoint(cx - 14, cy - 14);
        const photo = document.querySelector('.nav-me').getBoundingClientRect();
        const centre = document.elementFromPoint(photo.left + photo.width / 2, photo.top + photo.height / 2);
        return { coarse: matchMedia('(pointer: coarse)').matches, ok: !!el && !!el.closest('#statut-btn'), centre: !!centre && !!centre.closest('.nav-me') && !centre.closest('#statut-btn') };
      });
      check(touche.coarse, `${tag} : pointeur grossier détecté`);
      check(touche.ok, `${tag} : zone tactile élargie atteint le voyant (point à 14 px de son centre)`);
      check(touche.centre, `${tag} : le centre de la photo n'est pas recouvert par le voyant`);
    }

    // Clic sur le voyant -> panneau
    await p.click('#statut-btn');
    await p.waitForSelector('.notif-item', { timeout: 4000 }).catch(() => {});
    check(await p.isVisible('#notif-panel'), `${tag} : clic sur le voyant ouvre le panneau`);
    check(await p.getAttribute('#statut-btn', 'aria-expanded') === 'true', `${tag} : aria-expanded = true à l'ouverture`);
    check(await p.locator('.notif-item').count() === 2 && await p.locator('.notif-item.is-new').count() === 1, `${tag} : liste de 2 notifications, 1 nouvelle`);
    const panneau = await p.locator('#notif-panel').boundingBox();
    check(panneau && panneau.x >= 0 && panneau.x + panneau.width <= w + 1, `${tag} : panneau entièrement dans l'écran`);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${tag} : pas de défilement horizontal`);
    check(await p.isVisible('#notif-panel [data-notif-act="masquer"]') || await p.isVisible('.notif-statut'), `${tag} : réglage « Masquer mon statut » dans le panneau`);

    // Clic sur la photo : le menu en arc s'ouvre toujours, le panneau se referme
    // « ailleurs sur la photo » : le bord gauche, hors de la zone du voyant
    await p.click('.nav-me', { position: { x: 6, y: 22 } });
    await p.waitForTimeout(300);
    check(await p.isVisible('.me-fan .fan-item.nav-msg') && await p.getAttribute('.nav-me', 'aria-expanded') === 'true', `${tag} : clic sur la photo ouvre le menu en arc`);
    check(await p.isHidden('#notif-panel'), `${tag} : le clic sur la photo referme le panneau`);
    check(await p.getAttribute('#statut-btn', 'aria-expanded') === 'false', `${tag} : voyant repassé à aria-expanded=false`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    check(await p.isHidden('.me-fan'), `${tag} : Échap ferme le menu en arc`);

    // Voyant pendant que l'arc est ouvert : l'arc se ferme, le panneau s'ouvre
    await p.click('.nav-me', { position: { x: 6, y: 22 } });
    await p.waitForTimeout(300);
    await p.click('#statut-btn');
    await p.waitForTimeout(300);
    check(await p.isHidden('.me-fan') && await p.isVisible('#notif-panel'), `${tag} : voyant pendant l'arc -> arc fermé, panneau ouvert`);

    // Tout marquer comme lu : le badge disparaît
    await p.click('[data-notif-act="lire"]');
    await p.waitForTimeout(200);
    check(await p.locator('.notif-item.is-new').count() === 0 && await p.isHidden('#statut-btn .statut-n'), `${tag} : « Tout marquer comme lu » retire le badge`);
    check(await p.getAttribute('#statut-btn', 'aria-label') === 'Statut et notifications : en ligne, aucune non lue', `${tag} : libellé sans non lue`);

    // Masquer mon statut : voyant rouge barré, libellé « statut masqué »
    await p.click('.notif-statut span');
    await p.waitForTimeout(250);
    check(await p.evaluate(() => window.__PRES.masque) === true, `${tag} : « Masquer mon statut » envoyé`);
    check(await p.$eval('#statut-btn .presence-dot', (d) => !d.classList.contains('is-online')), `${tag} : voyant rouge barré (statut masqué)`);
    const rouge = await p.$eval('#statut-btn .presence-dot', (d) => getComputedStyle(d).backgroundColor);
    check(rouge === 'rgb(229, 72, 77)', `${tag} : couleur rouge du voyant (${rouge})`);
    check((await p.getAttribute('#statut-btn', 'aria-label')).startsWith('Statut et notifications : statut masqué'), `${tag} : libellé « statut masqué »`);
    await p.click('.notif-statut span');
    await p.waitForTimeout(250);
    check(await p.evaluate(() => window.__PRES.masque) === false, `${tag} : statut visible de nouveau`);
    check(await p.$eval('#statut-btn .presence-dot', (d) => d.classList.contains('is-online')), `${tag} : voyant de nouveau vert`);

    // Clavier : Entrée sur le voyant ouvre le panneau, Échap referme et rend le focus au voyant
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    await p.focus('#statut-btn');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(250);
    check(await p.isVisible('#notif-panel'), `${tag} : Entrée sur le voyant ouvre le panneau`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    check(await p.isHidden('#notif-panel'), `${tag} : Échap ferme le panneau`);
    check(await p.evaluate(() => document.activeElement?.id) === 'statut-btn', `${tag} : focus rendu au voyant`);
    await p.keyboard.press('Space');
    await p.waitForTimeout(250);
    check(await p.isVisible('#notif-panel'), `${tag} : Espace sur le voyant ouvre le panneau`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);

    // Thème clair : le panneau reste lisible (fond de surface, texte du thème)
    await p.evaluate(() => document.documentElement.setAttribute('data-mode', 'clair'));
    await p.click('#statut-btn');
    await p.waitForTimeout(250);
    const contraste = await p.evaluate(() => {
      const f = getComputedStyle(document.getElementById('notif-panel')).backgroundColor;
      const t = getComputedStyle(document.getElementById('notif-panel')).color;
      return { f, t };
    });
    check(contraste.f !== contraste.t && contraste.f !== 'rgba(0, 0, 0, 0)', `${tag} : thème clair, panneau coloré (${contraste.f} / ${contraste.t})`);
    await p.keyboard.press('Escape');
    await p.evaluate(() => document.documentElement.removeAttribute('data-mode'));

    check(!p.errs.length, `${tag} : aucune erreur JS` + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
    await p.ctx.close();
  }

  // Annuaire : pastilles en ligne / hors ligne (inchangées)
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
