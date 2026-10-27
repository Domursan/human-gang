// Parcours : secrets F (le drôle de bloc, creeper, et la cueillette de champignons Mycena).
// Drôle de bloc : ?creeper=1 force l'apparition pour l'administrateur (compte de test) : le bouton « Un drôle de bloc ? »
// est visible (48 px au moins) ; un clic appelle hg_egg_found('creeper') ; une seconde page forcée laisse passer les 3 s
// sans clic : « BOUM », cratère, et aucun appel au serveur. Visiteur (sans session) : rien, même avec ?creeper=1.
// Mouvement réduit : pas de tremblement ni de clignotement, mais le bloc apparaît et se touche.
// Champignon : présent seulement sur la page de la saison (scénario champi : saison et page), absent ailleurs ; un clic
// appelle hg_egg_found('champi_<saison>') et affiche l'anecdote ; une fois cueilli, il ne revient plus à la visite suivante
// (hg_eggs_me le compte comme trouvé) ; un visiteur ne le voit pas.
// Faux Supabase : fixtures/fake-sb.mjs (hg_eggs_public renvoie champi depuis le scénario, hg_egg_found répond).
// Lancer : node tests/parcours/compte/parcours-eggs-f.cjs
// Préfixe : aucun par défaut (le site est servi à la racine, humane-gang.com) ; HG_PREFIX=/human-gang teste le mode sous-dossier.
const { ROOT, ORIGIN, PREFIX, urlPage, check, finish, openPage, log, sleep, chromium } = require('../../lib/harness.cjs');

/** Appels hg_egg_found du faux client (arguments), dans l'ordre. */
const eggCalls = async (p) => (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_egg_found').map((e) => e[2]);

/** Ouvre une page puis la recharge avec une adresse de test (?creeper=1), sans quitter le contexte. */
async function avecQuery(p, page, query) {
  await p.goto(`${ORIGIN}${PREFIX}${urlPage(page)}${query}`);
  await sleep(1200);
  return p;
}

const BLOC = '.egg-f-monstre';
const CHAMPI = '.champi-f-bouton';

(async () => {
  console.log('Racine testée : ' + ROOT + ' (préfixe ' + PREFIX + ')');
  const browser = await chromium.launch();

  /* ---------- Drôle de bloc : forcé pour l'administrateur ---------- */
  let p = await openPage(browser, { page: 'accueil', width: 390 });
  await avecQuery(p, 'accueil', '?creeper=1');
  await p.waitForSelector(BLOC, { timeout: 6000 }).catch(() => {});
  check(await p.locator(BLOC).count() === 1, 'bloc forcé (?creeper=1, administrateur) : le bouton apparaît');
  check((await p.getAttribute(BLOC, 'aria-label')) === 'Un drôle de bloc ?', 'bloc : aria-label « Un drôle de bloc ? »');
  check((await p.locator(BLOC).evaluate((e) => e.tagName)) === 'BUTTON', 'bloc : c\'est un vrai bouton');
  const box = await p.locator(BLOC).boundingBox();
  check(box && box.width >= 48 && box.height >= 48, `bloc : 48 px au moins (${box && Math.round(box.width)}×${box && Math.round(box.height)})`);
  check(box && (box.x < 390 / 2 ? box.x < 40 : box.x + box.width > 390 - 40), 'bloc : dans une marge latérale (bas gauche ou bas droite)');
  check(await p.$eval('.egg-f-calque', (el) => getComputedStyle(el).pointerEvents) === 'none', 'bloc : le calque ne bloque pas la page');
  check(await hscrollOk(p), 'bloc, 390 px : pas de défilement horizontal');
  check(p.errs.length === 0, 'bloc : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.click(BLOC);
  await sleep(400);
  let appels = (await eggCalls(p)).filter((a) => a.p_egg === 'creeper');
  check(appels.length === 1, 'bloc touché → hg_egg_found(creeper) appelé une fois');
  check(await p.locator(BLOC).count() === 0 || (await p.locator(BLOC).isDisabled()), 'bloc touché : il se dégonfle (bouton retiré ou désactivé)');
  await sleep(800);
  check(await p.locator('.egg-f-nuage').count() === 0, 'bloc touché : le nuage est retiré à la fin de l\'animation');
  check(p.errs.length === 0, 'bloc touché : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- Drôle de bloc : raté (BOUM, cratère, rien envoyé) ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280 });
  await avecQuery(p, 'accueil', '?creeper=1');
  await p.waitForSelector(BLOC, { timeout: 6000 }).catch(() => {});
  check(await p.locator(BLOC).count() === 1, 'raté : le bloc apparaît');
  await sleep(3400);
  check(await p.locator('.egg-f-cratere').count() === 1, 'raté : un cratère reste dans le coin');
  check(await p.locator(BLOC).count() === 0, 'raté : le bloc a disparu');
  check((await eggCalls(p)).filter((a) => a.p_egg === 'creeper').length === 0, 'raté : aucun appel au serveur');
  check(p.errs.length === 0, 'raté : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- Drôle de bloc : mouvement réduit (pas de clignotement ni de tremblement) ---------- */
  p = await openPage(browser, { page: 'accueil', width: 390, reducedMotion: 'reduce' });
  await avecQuery(p, 'accueil', '?creeper=1');
  await p.waitForSelector(BLOC, { timeout: 6000 }).catch(() => {});
  check(await p.locator(BLOC).count() === 1, 'mouvement réduit : le bloc apparaît quand même');
  check(await p.locator(`${BLOC}.egg-f-clignote`).count() === 0, 'mouvement réduit : pas de clignotement');
  check(await p.locator('.egg-f-calme').count() === 1, 'mouvement réduit : version calme');
  await p.click(BLOC);
  await sleep(300);
  check((await eggCalls(p)).filter((a) => a.p_egg === 'creeper').length === 1, 'mouvement réduit : le clic appelle hg_egg_found(creeper)');
  await p.ctx.close();

  /* ---------- Drôle de bloc : visiteur (sans session) : rien, même forcé ---------- */
  p = await openPage(browser, { page: 'accueil', width: 390, scenario: { guest: true } });
  await avecQuery(p, 'accueil', '?creeper=1');
  await sleep(800);
  check(await p.locator(BLOC).count() === 0, 'visiteur : aucun bloc, même avec ?creeper=1');
  check(await p.locator('.egg-f-calque').count() === 0, 'visiteur : aucun calque d\'effet');
  await p.ctx.close();

  /* ---------- Champignon : présent seulement sur la page de la saison ---------- */
  const champi = { saison: 'ete', page: 'irl', fact: 'Certains Mycena brillent dans le noir.' };
  p = await openPage(browser, { page: 'cartes', width: 390, scenario: { champi } });
  await sleep(600);
  check(await p.locator(CHAMPI).count() === 0, 'champignon : absent sur une autre page que celle de la saison (cartes)');
  await p.ctx.close();

  p = await openPage(browser, { page: 'irl', width: 390, scenario: { champi } });
  await p.waitForSelector(CHAMPI, { timeout: 6000 }).catch(() => {});
  check(await p.locator(CHAMPI).count() === 1, 'champignon : présent sur la page de la saison (irl)');
  check((await p.getAttribute(CHAMPI, 'aria-label')) === 'Un champignon ?', 'champignon : aria-label « Un champignon ? »');
  const cbox = await p.locator(CHAMPI).boundingBox();
  const svgBox = await p.locator(`${CHAMPI} svg`).boundingBox();
  check(svgBox && svgBox.width >= 24 && svgBox.height >= 24, `champignon : dessin 24 px au moins (${svgBox && Math.round(svgBox.width)}×${svgBox && Math.round(svgBox.height)})`);
  check(cbox && cbox.x + cbox.width <= 390 && cbox.x >= 0, 'champignon, 390 px : dans l\'écran');
  check(await hscrollOk(p), 'champignon, 390 px : pas de défilement horizontal');
  await p.click(CHAMPI);
  await sleep(400);
  const cueill = (await eggCalls(p)).filter((a) => a.p_egg === 'champi_ete');
  check(cueill.length === 1, 'champignon cueilli → hg_egg_found(champi_ete) appelé une fois');
  check((await p.textContent('.champi-f-bulle').catch(() => '')).includes(champi.fact), 'champignon : la bulle affiche l\'anecdote du jour');
  check(p.errs.length === 0, 'champignon : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // Déjà cueilli cette saison (hg_eggs_me le compte) : il ne réapparaît pas
  p = await openPage(browser, { page: 'irl', width: 390, scenario: { champi, eggsDeja: { champi_ete: true } } });
  await sleep(1200);
  check(await p.locator(CHAMPI).count() === 0, 'champignon déjà cueilli cette saison : il ne réapparaît pas');
  await p.ctx.close();

  // Visiteur : pas de champignon
  p = await openPage(browser, { page: 'irl', width: 390, scenario: { champi, guest: true } });
  await sleep(800);
  check(await p.locator(CHAMPI).count() === 0, 'champignon, visiteur : absent');
  await p.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });

/** Vrai si la page ne défile pas horizontalement (raccourci pour les contrôles de mise en page). */
async function hscrollOk(p) {
  return (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0;
}
