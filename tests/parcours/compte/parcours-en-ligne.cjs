// Parcours : menu « En ligne » (core/en-ligne.js, migration 159).
// (a) 1280 px : barre à droite, 2 membres (Alice, Bob) avec pastille verte, contenu décalé, pas de défilement horizontal ;
//     survol : pseudo en bulle ; clic : fenêtre « Écrire » / « Défier » avec les bons liens ; Échap la ferme et rend le focus.
// (b) 390 px tactile : bouton flottant avec le nombre ; la liste s'ouvre avec les deux raccourcis par membre ; Échap ferme.
// (c) personne en ligne : la barre se replie en bouton (ordinateur) ; le message « Personne d'autre » s'ouvre avec lui.
// (d) catan sur téléphone : pas de bouton. (e) /pages/admin/admin.html : rien.
// (f) ordinateur : la barre arc-en-ciel de l'en-tête reste entière au-dessus de la barre, qui commence sous l'en-tête.
// (g) téléphone : le bouton se replie pendant un défilement vers le bas, revient en remontant et en bas de page (pied de page libre).
// Faux serveur : fixtures/fake-presence.js. Lancer : node tests/parcours/compte/parcours-en-ligne.cjs
const { check, finish, openPage, hscroll, chromium } = require('../../lib/harness.cjs');
const ALICE = '00000002-0000-4000-8000-000000000002';

(async () => {
  const browser = await chromium.launch();

  /* (a) Ordinateur */
  {
    const p = await openPage(browser, { page: 'accueil', width: 1280, height: 900, init: 'fake-presence.js' });
    await p.waitForSelector('#en-ligne .ol-av', { timeout: 5000 }).catch(() => {});
    check(await p.isVisible('#en-ligne'), '(a) barre « En ligne » visible');
    check((await p.$$('#en-ligne .ol-av')).length === 2, '(a) 2 membres en ligne');
    check((await p.textContent('#en-ligne .ol-n')).trim() === '2', '(a) compteur 2');
    const box = await p.evaluate(() => document.getElementById('en-ligne').getBoundingClientRect().toJSON());
    check(Math.round(box.right) === 1280 && box.width < 80, `(a) barre fine collée à droite (${Math.round(box.width)} px)`);
    check((await p.evaluate(() => getComputedStyle(document.body).paddingRight)) === '60px', '(a) contenu décalé de 60 px');
    check((await hscroll(p)) === 0, '(a) pas de défilement horizontal');
    // (f) en-tête : barre arc-en-ciel pleine largeur, barre latérale sous l'en-tête (ni recouverte, ni tronquée)
    const geo = await p.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      return { rb: r('.site-header .rainbow').toJSON(), hd: r('.site-header').toJSON(), ol: r('#en-ligne').toJSON() };
    });
    check(Math.round(geo.rb.right) === 1280 && Math.round(geo.rb.left) === 0, `(f) barre arc-en-ciel pleine largeur (${Math.round(geo.rb.width)} px)`);
    check(geo.ol.top >= geo.hd.bottom - 2, `(f) barre « En ligne » sous l'en-tête (haut ${Math.round(geo.ol.top)}, bas de l'en-tête ${Math.round(geo.hd.bottom)})`);
    await p.hover(`#en-ligne [data-ol="${ALICE}"]`);
    await p.waitForTimeout(300);
    const bulle = await p.evaluate((id) => { const n = document.querySelector(`[data-ol="${id}"] .ol-nom`); const r = n.getBoundingClientRect(); return { op: getComputedStyle(n).opacity, t: n.textContent, right: r.right }; }, ALICE);
    check(bulle.op === '1' && bulle.t === 'Alice' && bulle.right <= box.left, `(a) survol : « Alice » en bulle à gauche (opacité ${bulle.op})`);
    await p.click(`#en-ligne [data-ol="${ALICE}"]`);
    await p.waitForTimeout(150);
    check(await p.isVisible('#ol-pop'), '(a) clic : fenêtre des raccourcis ouverte');
    const liens = await p.$$eval('#ol-pop a', (as) => as.map((a) => a.getAttribute('href')));
    check(liens[0] === `/pages/compte/messages.html?to=${ALICE}` && liens[1] === `/pages/jeux/duels.html#creer/membre/${ALICE}`, `(a) liens Écrire et Défier (${liens.join(' , ')})`);
    check(await p.evaluate(() => document.activeElement?.closest('#ol-pop') !== null), '(a) le focus entre dans la fenêtre');
    await p.keyboard.press('Escape');
    check(!(await p.isVisible('#ol-pop')), '(a) Échap ferme la fenêtre');
    check(await p.evaluate((id) => document.activeElement?.dataset.ol === id, ALICE), '(a) le focus revient sur l’avatar');
    await p.click(`#en-ligne [data-ol="${ALICE}"]`);
    await p.mouse.click(600, 500);
    check(!(await p.isVisible('#ol-pop')), '(a) un clic ailleurs ferme la fenêtre');
    check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (b) Téléphone */
  {
    const p = await openPage(browser, { page: 'accueil', width: 390, height: 844, mobile: true, init: 'fake-presence.js' });
    await p.waitForSelector('#en-ligne .ol-av', { state: 'attached', timeout: 5000 }).catch(() => {});
    check(await p.isVisible('#en-ligne .ol-fab'), '(b) bouton flottant visible');
    check((await p.textContent('#en-ligne .ol-fab-n')).trim() === '2', '(b) bouton : 2 en ligne');
    check(!(await p.isVisible('#en-ligne .ol-liste')), '(b) liste fermée au départ');
    await p.tap('#en-ligne .ol-fab');
    await p.waitForTimeout(150);
    check(await p.isVisible('#en-ligne .ol-liste'), '(b) la liste s’ouvre');
    check((await p.$$('#en-ligne .ol-acts-tel a:visible')).length === 4, '(b) Écrire et Défier pour chacun des 2 membres');
    const r = await p.evaluate(() => document.querySelector('#en-ligne .ol-corps').getBoundingClientRect().toJSON());
    check(r.left >= 0 && r.right <= 390, '(b) la liste tient dans l’écran');
    await p.keyboard.press('Escape');
    check(!(await p.isVisible('#en-ligne .ol-liste')), '(b) Échap ferme la liste');
    check((await hscroll(p)) === 0, '(b) pas de défilement horizontal');
    check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (g) Téléphone : défilement vers le bas, bouton replié ; remontée ou bas de page, bouton revenu */
  {
    const p = await openPage(browser, { page: 'accueil', width: 390, height: 844, mobile: true, init: 'fake-presence.js' });
    await p.waitForSelector('#en-ligne .ol-fab', { state: 'attached', timeout: 5000 }).catch(() => {});
    const fabBas = () => p.evaluate(() => { const b = document.querySelector('#en-ligne .ol-fab').getBoundingClientRect(); return b.top; });
    const visible = () => p.evaluate(() => document.querySelector('#en-ligne').getBoundingClientRect().top < innerHeight - 20);
    check(await visible(), '(g) bouton visible en haut de page');
    await p.evaluate(() => window.scrollTo(0, 500));
    await p.waitForTimeout(400);
    check(await p.evaluate(() => document.documentElement.dataset.defil === 'bas'), '(g) défilement vers le bas : bouton replié');
    check(!(await visible()), '(g) bouton hors de l’écran pendant le défilement');
    await p.evaluate(() => window.scrollTo(0, 440));
    await p.waitForTimeout(400);
    check(await visible(), '(g) remonter : le bouton revient');
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await p.waitForTimeout(400);
    check(await visible(), '(g) bas de page : le bouton est là, au-dessus du pied de page');
    const pied = await p.evaluate(() => {
      const f = document.querySelector('footer').getBoundingClientRect(), b = document.querySelector('#en-ligne .ol-fab').getBoundingClientRect();
      return { chevauche: !(b.bottom <= f.top || b.top >= f.bottom || b.right <= f.left || b.left >= f.right) };
    });
    check(!pied.chevauche, '(g) le bouton ne recouvre pas le pied de page');
    void fabBas;
    await p.ctx.close();
  }

  /* (c) Personne en ligne */
  {
    const p = await openPage(browser, { page: 'accueil', width: 1280, height: 900, init: 'fake-presence.js' });
    await p.evaluate(() => { window.__PRES.personne = true; });
    await p.reload();
    await p.evaluate(() => { window.__PRES.personne = true; });
    await p.waitForTimeout(1500);
    // Après rechargement, le script d'init remet personne à false : on force un nouveau chargement de la liste
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForTimeout(500);
    // Repliée : la barre n'est plus qu'un filet (1 px de haut) qui prolonge la ligne de l'en-tête ; le bouton flotte en bas à droite
    const repliee = await p.evaluate(() => { const b = document.getElementById('en-ligne').getBoundingClientRect(); const f = document.querySelector('#en-ligne .ol-fab').getBoundingClientRect(); return { h: b.height, fab: getComputedStyle(document.querySelector('#en-ligne .ol-fab')).display !== 'none' && f.bottom <= innerHeight - 10 && f.right <= innerWidth - 10 }; });
    check(repliee.h <= 2 && repliee.fab, `(c) barre repliée : filet de ${Math.round(repliee.h)} px et bouton en bas à droite`);
    check(!(await p.isVisible('#en-ligne .ol-vide')), '(c) message « Personne d’autre » fermé au départ');
    await p.click('#en-ligne .ol-fab');
    await p.waitForTimeout(150);
    check(await p.isVisible('#en-ligne .ol-vide'), '(c) le bouton ouvre « Personne d’autre pour l’instant »');
    check((await hscroll(p)) === 0, '(c) pas de défilement horizontal');
    await p.ctx.close();
  }

  /* (d) Partie sur téléphone, (e) /pages/admin/admin.html */
  {
    const p = await openPage(browser, { page: 'catan', fixture: 'fake-sb-catan.mjs', width: 390, height: 844, mobile: true, init: 'fake-presence.js' });
    await p.waitForTimeout(1500);
    check(!(await p.isVisible('#en-ligne .ol-fab')), '(d) Catan sur téléphone : pas de bouton flottant');
    await p.ctx.close();
    const a = await openPage(browser, { page: 'admin', width: 1280, height: 900, init: 'fake-presence.js' });
    await a.waitForTimeout(1500);
    check(!(await a.$('#en-ligne')), '(e) /pages/admin/admin.html : pas de menu « En ligne »');
    await a.ctx.close();
  }

  await browser.close();
  finish();
})();
