// Parcours : secrets cachés des pages Cartes (secousse) et Historique (rembobinage), assets/js/eggs/pages.js.
// Faux Supabase : fixtures/fake-sb-cartes.mjs (Cartes) et fixtures/fake-sb.mjs (Historique), qui répondent à
// hg_egg_found et journalisent l'appel dans window.__LOG.
// Secousse : deux événements devicemotion simulés (accélération > 25 m/s²) à moins d'1 s d'écart.
// Rembobinage : appui long de la souris sur le dernier élément de la frise (600 ms et plus).
// Cas : Cartes (un coup, deux coups, iOS avec bouton 📳, réduire les animations) ; Historique (appui long,
// appui qui bouge, premier élément, clic simple, réduire les animations). Pas d'erreur JS, pas de défilement
// horizontal à 390 px.
// Lancer : node tests/parcours/cartes/parcours-eggs-pages.cjs
const { ROOT, check, finish, openPage, hscroll, log, sleep, chromium } = require('../../lib/harness.cjs');

const DERNIER = '#timeline .tl-year:last-child .tl-item:last-child';
const PREMIER = '#timeline .tl-year:first-child .tl-item:first-child';

/**
 * Faux capteur, injecté avant le chargement : hg.test n'est pas un contexte sécurisé, Chromium n'expose donc pas
 * DeviceMotionEvent. ios = true ajoute DeviceMotionEvent.requestPermission (comme sur iPhone).
 */
const CAPTEUR = (ios) => {
  if (typeof window.DeviceMotionEvent === 'undefined') {
    class DeviceMotionEvent extends Event {
      constructor(type, init = {}) { super(type); this.accelerationIncludingGravity = init.accelerationIncludingGravity || null; }
    }
    window.DeviceMotionEvent = DeviceMotionEvent;
  }
  if (ios) window.DeviceMotionEvent.requestPermission = () => Promise.resolve('granted');
};

/** Page Cartes à 390 px (tactile) avec le faux capteur, rechargée pour que le script le voie. */
async function cartesAvecCapteur(browser, ios = false, opts = {}) {
  const p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 390, touch: true, ...opts });
  await p.ctx.addInitScript(CAPTEUR, ios);
  await p.reload();
  await sleep(1200);
  return p;
}

/** Une secousse : un événement devicemotion avec une accélération bien au-dessus de la pesanteur. */
const secousse = (p) => p.evaluate(() => window.dispatchEvent(new DeviceMotionEvent('devicemotion', {
  accelerationIncludingGravity: { x: 30, y: 4, z: 2 },
})));

/** Appels hg_egg_found journalisés, éventuellement pour un seul code. */
const appels = async (p, code) => (await log(p)).filter((l) => l[0] === 'rpc' && l[1] === 'hg_egg_found' && (!code || l[2]?.p_egg === code));

/** La page tremble-t-elle (classe posée sur #app) ? */
const tremble = (p) => p.evaluate(() => document.querySelector('#app').classList.contains('egg-shake'));

/** Fait défiler la frise jusqu'à l'élément, et renvoie son centre (coordonnées de la fenêtre). */
async function centreDe(p, selecteur) {
  await p.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), selecteur);
  await sleep(100);
  const b = await (await p.$(selecteur + ' .tl-title')).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  // 1. Cartes, 390 px : un seul coup ne compte pas ; deux coups en moins d'1 s déclenchent l'effet et le secret.
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 390, touch: true });
  check(!(await p.$('.egg-motion-btn')), 'ordinateur sans capteur : aucun bouton 📳');
  check(!p.errs.length, 'Cartes sans capteur : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  p = await cartesAvecCapteur(browser);
  await secousse(p);
  await sleep(150);
  check((await appels(p, 'secousse')).length === 0, 'un seul coup : aucun secret signalé');
  await sleep(250);
  await secousse(p);
  check(await tremble(p), 'deux coups : la page tremble');
  await sleep(300);
  check((await appels(p, 'secousse')).length === 1, 'deux coups : hg_egg_found(secousse) envoyé une fois');
  check(await p.isVisible('.egg-relance'), 'booster offert : « Actualiser la page » proposé');
  await sleep(700);
  check(!(await tremble(p)), 'le tremblement s\'arrête après 0,6 s');
  check(!p.errs.length, 'Cartes, secousse : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  check(await hscroll(p) === 0, 'Cartes à 390 px : pas de défilement horizontal');
  await p.ctx.close();

  // 2. Cartes, iOS : la permission se demande par le bouton 📳, puis la secousse est reconnue.
  p = await cartesAvecCapteur(browser, true);
  check(await p.isVisible('.egg-motion-btn'), 'iOS : le bouton 📳 est proposé');
  await p.click('.egg-motion-btn');
  await sleep(150);
  check(!(await p.$('.egg-motion-btn')), 'iOS : après la réponse, le bouton disparaît');
  await secousse(p);
  await sleep(250);
  await secousse(p);
  await sleep(300);
  check((await appels(p, 'secousse')).length === 1, 'iOS accordé : la secousse est reconnue');
  check(!p.errs.length, 'Cartes, iOS : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 3. Cartes, réduire les animations : pas de tremblement, mais le secret est tout de même signalé.
  p = await cartesAvecCapteur(browser, false, { reducedMotion: 'reduce' });
  await secousse(p);
  await sleep(250);
  await secousse(p);
  await sleep(100);
  check(!(await tremble(p)), 'réduire les animations : pas de tremblement');
  check((await appels(p, 'secousse')).length === 1, 'réduire les animations : hg_egg_found(secousse) envoyé');
  check(!p.errs.length, 'Cartes, réduire les animations : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 4. Historique, 390 px : clic simple normal ; appui qui bouge = défilement ; appui long sur le premier élément = rien ;
  //    appui long sur le dernier élément = remontée avec l'effet, puis le secret.
  p = await openPage(browser, { page: 'historique', width: 390 });
  check((await p.$$('#timeline .tl-item')).length >= 2, 'frise : plusieurs souvenirs affichés');
  await p.click('#timeline .tl-year:last-child .tl-item:last-child .tl-title');
  await sleep(300);
  check(!(await p.$('.egg-vhs')) && (await appels(p, 'rembobine')).length === 0, 'clic simple sur le dernier élément : comportement normal, pas de rembobinage');

  let c = await centreDe(p, DERNIER);
  await p.mouse.move(c.x, c.y);
  await p.mouse.down();
  await p.mouse.move(c.x, c.y + 40);
  await sleep(800);
  await p.mouse.up();
  await sleep(100);
  check(!(await p.$('.egg-vhs')) && (await appels(p, 'rembobine')).length === 0, 'appui qui défile : pas de rembobinage');

  c = await centreDe(p, PREMIER);
  await p.mouse.move(c.x, c.y);
  await p.mouse.down();
  await sleep(800);
  await p.mouse.up();
  await sleep(100);
  check(!(await p.$('.egg-vhs')), 'appui long sur le premier élément (le plus récent) : rien');

  const haut = await p.evaluate(() => scrollY);
  c = await centreDe(p, DERNIER);
  const bas = await p.evaluate(() => scrollY);
  check(bas > 100, 'avant le rembobinage, la frise est descendue (' + bas + ' px ; haut ' + haut + ')');
  await p.mouse.move(c.x, c.y);
  await p.mouse.down();
  await sleep(800);
  await p.mouse.up();
  await sleep(150);
  check(!!(await p.$('.egg-vhs')), 'appui long sur le dernier élément : effet « REWIND » affiché');
  check((await p.textContent('.egg-vhs-rew')) === '◀◀ REWIND', 'effet : libellé « ◀◀ REWIND »');
  await sleep(2800);
  check((await p.evaluate(() => scrollY)) === 0, 'rembobinage : la page est revenue en haut');
  check(!(await p.$('.egg-vhs')), 'effet retiré à la fin');
  check((await appels(p, 'rembobine')).length === 1, 'hg_egg_found(rembobine) envoyé une fois');
  check(!p.errs.length, 'Historique, rembobinage : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  check(await hscroll(p) === 0, 'Historique à 390 px : pas de défilement horizontal');
  await p.ctx.close();

  // 5. Historique, réduire les animations : remontée immédiate, sans effet ; le secret est tout de même signalé.
  p = await openPage(browser, { page: 'historique', width: 390, reducedMotion: 'reduce' });
  c = await centreDe(p, DERNIER);
  await p.mouse.move(c.x, c.y);
  await p.mouse.down();
  await sleep(800);
  await p.mouse.up();
  await sleep(150);
  check(!(await p.$('.egg-vhs')), 'réduire les animations : pas d\'effet');
  check((await p.evaluate(() => scrollY)) === 0, 'réduire les animations : retour en haut immédiat');
  check((await appels(p, 'rembobine')).length === 1, 'réduire les animations : hg_egg_found(rembobine) envoyé');
  check(!p.errs.length, 'Historique, réduire les animations : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
