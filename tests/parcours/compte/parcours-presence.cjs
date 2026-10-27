// Présence et notifications du site (migration 153, core/presence.js) : voyant de statut sur la photo du membre
// (vert = en ligne, rouge barré = statut masqué, badge = non lues).
// Ordinateur (1280 px) : le voyant est un bouton ; un clic ouvre le panneau des notifications ; clic sur la photo -> menu en arc.
// Téléphone (390 px, tactile) : le voyant n'est qu'un indicateur (aria-hidden, sans clic ni focus, sans toucher) ; le statut
// et le panneau s'ouvrent depuis l'entrée « Statut » du menu en arc de la photo ; le libellé du statut est porté par la photo.
// Clavier, « Tout marquer comme lu », « Masquer mon statut », pastilles « en ligne » (annuaire), passage d'une largeur à l'autre.
// Faux serveur : tests/fixtures/fake-presence.js. Lancer : node tests/parcours/compte/parcours-presence.cjs
const { check, finish, openPage, chromium } = require('../../lib/harness.cjs');

(async () => {
  const browser = await chromium.launch();

  // ---------- Ordinateur (1280 px) : voyant cliquable, comme avant ----------
  {
    const tag = '1280 px';
    const p = await openPage(browser, { page: 'accueil', width: 1280, height: 900, init: 'fake-presence.js' });
    await p.waitForSelector('#statut-btn', { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(600);

    check(await p.locator('.nav-me-wrap #statut-btn').count() === 1, `${tag} : voyant posé sur la photo (.nav-me-wrap)`);
    check(await p.locator('.nav-me #statut-btn').count() === 0, `${tag} : le voyant n'est pas dans le bouton de la photo`);
    check(await p.locator('#notif-btn, .notif-btn').count() === 0, `${tag} : plus de cloche séparée dans l'en-tête`);
    check(await p.evaluate(() => window.__PRES.pings) >= 1, `${tag} : signal de vie envoyé`);
    check(await p.evaluate(() => getComputedStyle(document.getElementById('statut-btn')).pointerEvents) !== 'none', `${tag} : le voyant reçoit les clics`);
    check(await p.evaluate(() => document.getElementById('statut-btn').tagName) === 'BUTTON', `${tag} : le voyant est un bouton`);
    check((await p.locator('#statut-btn .statut-n').textContent()) === '1' && await p.isVisible('#statut-btn .statut-n'), `${tag} : badge « 1 » non lue sur le voyant`);
    check(await p.getAttribute('#statut-btn', 'aria-label') === 'Statut et notifications : en ligne, 1 non lue', `${tag} : libellé du voyant`);
    check(await p.getAttribute('#statut-btn', 'aria-expanded') === 'false', `${tag} : aria-expanded = false au repos`);
    check(await p.$eval('#statut-btn .presence-dot', (d) => d.classList.contains('is-online')), `${tag} : voyant vert (en ligne)`);
    const couleur = await p.$eval('#statut-btn .presence-dot', (d) => getComputedStyle(d).backgroundColor);
    check(couleur === 'rgb(47, 180, 99)', `${tag} : couleur verte du voyant (${couleur})`);
    const box = await p.locator('#statut-btn').boundingBox();
    check(box && box.width >= 24 && box.height >= 24, `${tag} : zone cliquable ≥ 24 × 24 px`);

    await p.click('#statut-btn');
    await p.waitForSelector('.notif-item', { timeout: 4000 }).catch(() => {});
    check(await p.isVisible('#notif-panel'), `${tag} : clic sur le voyant ouvre le panneau`);
    check(await p.getAttribute('#statut-btn', 'aria-expanded') === 'true', `${tag} : aria-expanded = true à l'ouverture`);
    check(await p.locator('.notif-item').count() === 2 && await p.locator('.notif-item.is-new').count() === 1, `${tag} : liste de 2 notifications, 1 nouvelle`);
    const panneau = await p.locator('#notif-panel').boundingBox();
    check(panneau && panneau.x >= 0 && panneau.x + panneau.width <= 1280 + 1, `${tag} : panneau entièrement dans l'écran`);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${tag} : pas de défilement horizontal`);
    check(await p.isVisible('#notif-panel [data-notif-act="masquer"]') || await p.isVisible('.notif-statut'), `${tag} : réglage « Masquer mon statut » dans le panneau`);

    // Clic sur la photo : le menu en arc s'ouvre toujours, le panneau se referme
    await p.click('.nav-me', { position: { x: 6, y: 22 } });
    await p.waitForTimeout(300);
    check(await p.isVisible('.me-fan .fan-item.nav-msg') && await p.getAttribute('.nav-me', 'aria-expanded') === 'true', `${tag} : clic sur la photo ouvre le menu en arc`);
    check(await p.isHidden('.me-fan .nav-statut-open'), `${tag} : entrée « Statut » de l'éventail absente sur ordinateur`);
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

    await p.click('[data-notif-act="lire"]');
    await p.waitForTimeout(200);
    check(await p.locator('.notif-item.is-new').count() === 0 && await p.isHidden('#statut-btn .statut-n'), `${tag} : « Tout marquer comme lu » retire le badge`);
    check(await p.getAttribute('#statut-btn', 'aria-label') === 'Statut et notifications : en ligne, aucune non lue', `${tag} : libellé sans non lue`);

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

  // ---------- Téléphone (390 px, tactile) : voyant indicateur, statut dans le menu de la photo ----------
  {
    const tag = '390 px (tactile)';
    const p = await openPage(browser, { page: 'accueil', width: 390, height: 844, mobile: true, init: 'fake-presence.js' });
    await p.waitForSelector('#statut-btn', { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(600);

    check(await p.locator('.nav-me-wrap #statut-btn').count() === 1, `${tag} : voyant posé sur la photo (.nav-me-wrap)`);
    check(await p.evaluate(() => window.__PRES.pings) >= 1, `${tag} : signal de vie envoyé`);
    check(await p.evaluate(() => document.getElementById('statut-btn').tagName) === 'SPAN', `${tag} : le voyant n'est pas un bouton (indicateur)`);
    check(await p.getAttribute('#statut-btn', 'aria-hidden') === 'true', `${tag} : voyant masqué aux lecteurs d'écran (aria-hidden)`);
    check(await p.evaluate(() => { const el = document.getElementById('statut-btn'); return el.tabIndex === -1 && !el.hasAttribute('tabindex') && !el.closest('a, button'); }), `${tag} : voyant hors de la tabulation (pas focusable)`);
    check(await p.evaluate(() => getComputedStyle(document.getElementById('statut-btn')).pointerEvents) === 'none', `${tag} : voyant sans toucher (pointer-events: none)`);
    check((await p.locator('#statut-btn .statut-n').textContent()) === '1' && await p.isVisible('#statut-btn .statut-n'), `${tag} : badge « 1 » non lue sur le voyant`);
    check(await p.$eval('#statut-btn .presence-dot', (d) => d.classList.contains('is-online')), `${tag} : voyant vert (en ligne)`);
    const couleur = await p.$eval('#statut-btn .presence-dot', (d) => getComputedStyle(d).backgroundColor);
    check(couleur === 'rgb(47, 180, 99)', `${tag} : couleur verte du voyant (${couleur})`);
    const box = await p.locator('#statut-btn').boundingBox();
    check(box && box.width >= 24 && box.height >= 24, `${tag} : voyant visible ≥ 24 × 24 px`);
    // Un toucher sur le voyant atteint la photo (le voyant ne le reçoit pas) : le menu s'ouvre
    const centreVoyant = await p.evaluate(() => { const r = document.getElementById('statut-btn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, photo: !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.nav-me') }; });
    check(centreVoyant.photo, `${tag} : le centre du voyant laisse passer le toucher vers la photo`);
    await p.touchscreen.tap(centreVoyant.x, centreVoyant.y);
    await p.waitForTimeout(300);
    check(await p.getAttribute('.nav-me', 'aria-expanded') === 'true' && await p.isVisible('.me-fan'), `${tag} : toucher le voyant ouvre le menu de la photo`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    check(await p.isHidden('.me-fan'), `${tag} : Échap ferme le menu en arc`);

    // Le libellé du statut est porté par la photo
    const libellePhoto = await p.getAttribute('.nav-me', 'aria-label');
    check(/statut : en ligne, 1 non lue/.test(libellePhoto), `${tag} : libellé de la photo « ${libellePhoto} »`);

    // Ouverture depuis le menu de la photo : entrée « Statut » (tabulable, libellée, badge de non lues)
    await p.click('.nav-me', { position: { x: 6, y: 22 } });
    await p.waitForTimeout(300);
    check(await p.isVisible('.me-fan .nav-statut-open'), `${tag} : entrée « Statut » visible dans le menu de la photo`);
    // Éventail : aucune étiquette ne recouvre une autre entrée (ni son bouton), toutes dans l'écran
    const eventail = await p.evaluate(() => {
      const items = [...document.querySelectorAll('.me-fan .fan-item')].filter((b) => !b.closest('.fan-li').hidden && !b.hidden);
      const boites = [];
      for (const b of items) {
        boites.push({ n: b.className, k: 'bouton', r: b.getBoundingClientRect() });
        const l = b.querySelector('.fan-label');
        if (l) boites.push({ n: b.className, k: 'étiquette', r: l.getBoundingClientRect() });
      }
      const croise = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
      let chevauche = 0, hors = 0;
      for (let i = 0; i < boites.length; i++) {
        const a = boites[i].r;
        if (a.left < 0 || a.right > innerWidth || a.top < 0 || a.bottom > innerHeight) hors++;
        for (let j = i + 1; j < boites.length; j++) if (boites[i].n !== boites[j].n && croise(a, boites[j].r)) chevauche++;
      }
      return { entrees: items.length, chevauche, hors };
    });
    check(eventail.entrees >= 7 && eventail.chevauche === 0 && eventail.hors === 0, `${tag} : éventail sans recouvrement (${eventail.entrees} entrées, ${eventail.chevauche} recouvrement(s), ${eventail.hors} hors écran)`);
    check(await p.evaluate(() => { const b = document.querySelector('.me-fan .nav-statut-open'); return b.tagName === 'BUTTON' && b.tabIndex >= 0; }), `${tag} : entrée « Statut » atteignable au clavier`);
    check(await p.getAttribute('.me-fan .nav-statut-open', 'aria-label') === 'Statut et notifications : en ligne, 1 non lue', `${tag} : libellé de l'entrée « Statut »`);
    check((await p.locator('.me-fan .nav-statut-open .nav-badge').textContent()) === '1', `${tag} : badge « 1 » sur l'entrée « Statut »`);

    // Clic sur l'entrée : l'arc se referme, le panneau (liste et réglage du statut) s'ouvre
    await p.click('.me-fan .nav-statut-open');
    await p.waitForSelector('.notif-item', { timeout: 4000 }).catch(() => {});
    check(await p.isVisible('#notif-panel') && await p.isHidden('.me-fan'), `${tag} : entrée « Statut » -> arc fermé, panneau ouvert`);
    check(await p.locator('.notif-item').count() === 2 && await p.locator('.notif-item.is-new').count() === 1, `${tag} : liste de 2 notifications, 1 nouvelle`);
    check(await p.getAttribute('.me-fan .nav-statut-open', 'aria-expanded') === 'true', `${tag} : entrée « Statut » annonce le panneau ouvert`);
    const panneau = await p.locator('#notif-panel').boundingBox();
    check(panneau && panneau.x >= 0 && panneau.x + panneau.width <= 390 + 1, `${tag} : panneau entièrement dans l'écran`);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${tag} : pas de défilement horizontal`);
    check(await p.isVisible('.notif-statut'), `${tag} : réglage « Masquer mon statut » dans le panneau`);

    // Tout marquer comme lu : le badge disparaît (voyant, entrée et photo)
    await p.click('[data-notif-act="lire"]');
    await p.waitForTimeout(200);
    check(await p.locator('.notif-item.is-new').count() === 0 && await p.isHidden('#statut-btn .statut-n'), `${tag} : « Tout marquer comme lu » retire le badge`);
    check(await p.evaluate(() => document.querySelector('.nav-statut-open .nav-badge')?.hidden === true), `${tag} : badge de l'entrée « Statut » retiré`);
    check(/statut : en ligne, aucune non lue/.test(await p.getAttribute('.nav-me', 'aria-label')), `${tag} : libellé de la photo sans non lue`);

    // Masquer mon statut : voyant rouge barré, photo et entrée annoncent « statut masqué »
    await p.click('.notif-statut span');
    await p.waitForTimeout(250);
    check(await p.evaluate(() => window.__PRES.masque) === true, `${tag} : « Masquer mon statut » envoyé`);
    check(await p.$eval('#statut-btn .presence-dot', (d) => !d.classList.contains('is-online')), `${tag} : voyant rouge barré (statut masqué)`);
    const rouge = await p.$eval('#statut-btn .presence-dot', (d) => getComputedStyle(d).backgroundColor);
    check(rouge === 'rgb(229, 72, 77)', `${tag} : couleur rouge du voyant (${rouge})`);
    check(/statut : statut masqué/.test(await p.getAttribute('.nav-me', 'aria-label')), `${tag} : libellé de la photo « statut masqué »`);
    check((await p.getAttribute('.me-fan .nav-statut-open', 'aria-label')).startsWith('Statut et notifications : statut masqué'), `${tag} : libellé de l'entrée « statut masqué »`);
    await p.click('.notif-statut span');
    await p.waitForTimeout(250);
    check(await p.evaluate(() => window.__PRES.masque) === false, `${tag} : statut visible de nouveau`);

    // Clavier : Échap ferme le panneau et rend le focus à la photo (le voyant n'est pas focusable)
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    check(await p.isHidden('#notif-panel'), `${tag} : Échap ferme le panneau`);
    check(await p.evaluate(() => document.activeElement?.classList.contains('nav-me')), `${tag} : focus rendu à la photo`);
    // Clavier : Entrée sur la photo ouvre l'arc, Entrée sur « Statut » ouvre le panneau
    await p.keyboard.press('Enter');
    await p.waitForTimeout(300);
    check(await p.getAttribute('.nav-me', 'aria-expanded') === 'true', `${tag} : Entrée sur la photo ouvre le menu en arc`);
    await p.focus('.me-fan .nav-statut-open');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(250);
    check(await p.isVisible('#notif-panel') && await p.isHidden('.me-fan'), `${tag} : Entrée sur « Statut » ouvre le panneau`);
    // Clic sur la photo pendant que le panneau est ouvert : le panneau se referme, l'arc s'ouvre
    await p.click('.nav-me', { position: { x: 6, y: 22 } });
    await p.waitForTimeout(300);
    check(await p.isHidden('#notif-panel') && await p.isVisible('.me-fan'), `${tag} : clic sur la photo referme le panneau et ouvre l'arc`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
    // Thème clair : le panneau reste lisible
    await p.evaluate(() => document.documentElement.setAttribute('data-mode', 'clair'));
    await p.click('.nav-me', { position: { x: 6, y: 22 } });
    await p.waitForTimeout(300);
    await p.click('.me-fan .nav-statut-open');
    await p.waitForTimeout(250);
    const contraste = await p.evaluate(() => {
      const f = getComputedStyle(document.getElementById('notif-panel')).backgroundColor;
      const t = getComputedStyle(document.getElementById('notif-panel')).color;
      return { f, t };
    });
    check(contraste.f !== contraste.t && contraste.f !== 'rgba(0, 0, 0, 0)', `${tag} : thème clair, panneau coloré (${contraste.f} / ${contraste.t})`);
    await p.keyboard.press('Escape');
    await p.evaluate(() => document.documentElement.removeAttribute('data-mode'));

    // Passage à l'ordinateur (1280 px) : le voyant redevient un bouton ; retour au téléphone : indicateur
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.waitForTimeout(400);
    check(await p.evaluate(() => document.getElementById('statut-btn')?.tagName) === 'BUTTON', `${tag} : en élargissant, le voyant redevient un bouton`);
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(400);
    check(await p.evaluate(() => document.getElementById('statut-btn')?.tagName) === 'SPAN', `${tag} : en revenant au téléphone, le voyant redevient un indicateur`);

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
