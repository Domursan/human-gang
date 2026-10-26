// Parcours des commandes clavier des jeux (page Jeux) : dans chaque grille du jour et solo (Connexions, Mot mêlé, Nerdle,
// Anagramme, Mots croisés, Démineur, Sudoku, 2048), les flèches déplacent le focus ou la case, Entrée/Espace valident, et
// la page ne défile pas ; chaque jeu d'arcade se lance au clavier (Entrée, ou Espace pour les jeux sans action), reçoit
// une action (flèches, Espace), se met en pause et reprend avec Échap, et est atteint à la tabulation avec un focus visible.
// Aucune erreur JS sur chaque page.
// Faux Supabase : fixtures/fake-sb-grilles.mjs (grilles), fake-sb-solo.mjs (démineur, sudoku, 2048), fake-sb.mjs (arcade).
const { check, finish, openPage, sleep, chromium } = require('./lib/harness.cjs');

/** Les neuf mini-jeux de la borne (identifiants de jeux/arcade.js). */
const JEUX_ARCADE = ['paillettes', 'raclette', 'domu', 'flappy', 'briques', 'snake', 'tetris', 'invaders', 'taupe'];

/** Défilement vertical de la page. */
const defile = (p) => p.evaluate(() => window.scrollY);
/** Élément actif parmi une liste : texte, position dans la liste, focus visible, attributs data-*. */
const actif = (p, sel) => p.evaluate((s) => {
  const liste = [...document.querySelectorAll(s)];
  const a = document.activeElement;
  const r = a.getBoundingClientRect();
  return { txt: a.textContent.trim(), i: liste.indexOf(a), top: r.top, left: r.left, visible: a.matches(':focus-visible'), data: { ...a.dataset } };
}, sel);
/** Ouvre la page Jeux sur un onglet, attend l'élément demandé et fait défiler la page jusqu'à la zone de jeu. */
const ouvre = async (browser, fixture, hash, attend, zone) => {
  const p = await openPage(browser, { page: 'jeux', fixture, hash, width: 1280, height: 900 });
  await p.waitForSelector(attend, { timeout: 6000 }).catch(() => {});
  await sleep(200);
  await p.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), zone);
  await sleep(100);
  return p;
};
/** Vrai si la touche Tab amène le focus sur l'élément d'identifiant id, en au plus n touches. */
const tabJusqua = async (p, id, n = 60) => {
  for (let k = 0; k < n; k++) {
    if (await p.evaluate((i) => document.activeElement?.id === i, id)) return true;
    await p.keyboard.press('Tab');
  }
  return p.evaluate((i) => document.activeElement?.id === i, id);
};
/** Contrôle des erreurs JS de la page (les 404 de fichiers en cours d'écriture par ailleurs ne comptent pas ici), puis fermeture. */
const fermer = async (p, nom) => {
  const js = p.errs.filter((e) => !e.startsWith('404 '));
  check(js.length === 0, `${nom} : aucune erreur JS${js.length ? ' (' + js.slice(0, 2).join(' | ') + ')' : ''}`);
  await p.ctx.close();
};

/** Navigateur de la session : fermé à la fin, même en cas d'erreur. */
let browser = null;

(async () => {
  browser = await chromium.launch();

  /* ---------- Connexions : tuiles (flèches, Entrée, Espace) ---------- */
  let p = await ouvre(browser, 'fake-sb-grilles.mjs', '#connexions', '[data-mot]', '.ng-tiles');
  await p.evaluate(() => document.querySelector('[data-mot]').focus({ preventScroll: true }));
  const a0 = await actif(p, '[data-mot]');
  const y0c = await defile(p);
  await p.keyboard.press('ArrowRight');
  const a1 = await actif(p, '[data-mot]');
  check(a1.i === a0.i + 1, 'connexions : flèche droite passe à la tuile suivante');
  await p.keyboard.press('ArrowDown');
  const a2 = await actif(p, '[data-mot]');
  check(a2.top > a1.top + 10, 'connexions : flèche bas passe à la tuile de la rangée suivante');
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('ArrowUp');
  check((await actif(p, '[data-mot]')).i === a0.i, 'connexions : flèches gauche et haut reviennent à la tuile de départ');
  check((await actif(p, '[data-mot]')).visible, 'connexions : focus visible sur la tuile');
  await p.keyboard.press('Enter');
  check((await p.locator('.ng-tile.is-sel').count()) === 1, 'connexions : Entrée sélectionne la tuile');
  await p.keyboard.press(' ');
  check((await p.locator('.ng-tile.is-sel').count()) === 0, 'connexions : Espace désélectionne la tuile');
  check((await defile(p)) === y0c, 'connexions : les flèches ne font pas défiler la page');
  await fermer(p, 'connexions');

  /* ---------- Mot mêlé : déplacement de case en case, Entrée = départ, Échap = annuler ---------- */
  p = await ouvre(browser, 'fake-sb-grilles.mjs', '#mot-mele', '.ng-cell', '.ng-grille');
  await p.evaluate(() => document.querySelector('.ng-cell[data-r="3"][data-c="3"]').focus({ preventScroll: true }));
  const y0m = await defile(p);
  await p.keyboard.press('ArrowRight');
  check(await p.evaluate(() => document.activeElement.dataset.c === '4' && document.activeElement.dataset.r === '3'), 'mot mêlé : flèche droite déplace la case');
  await p.keyboard.press('ArrowDown');
  check(await p.evaluate(() => document.activeElement.dataset.r === '4'), 'mot mêlé : flèche bas déplace la case');
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('ArrowUp');
  check(await p.evaluate(() => document.activeElement.dataset.r === '3' && document.activeElement.dataset.c === '2'), 'mot mêlé : flèches gauche et haut déplacent la case');
  await p.keyboard.press('Enter');
  check((await p.locator('.ng-live').textContent()).includes('Départ'), 'mot mêlé : Entrée pose le départ');
  await p.keyboard.press('Escape');
  check((await p.locator('.ng-live').textContent()).includes('annulée'), 'mot mêlé : Échap annule la sélection');
  check((await defile(p)) === y0m, 'mot mêlé : les flèches ne font pas défiler la page');
  check(await p.evaluate(() => document.activeElement.matches(':focus-visible')), 'mot mêlé : focus visible sur la case');
  await fermer(p, 'mot mêlé');

  /* ---------- Nerdle : clavier à l'écran (flèches entre touches), Espace tape, Entrée valide ---------- */
  p = await ouvre(browser, 'fake-sb-grilles.mjs', '#nerdle', '.ng-key', '.ng-clavier');
  await p.evaluate(() => document.querySelector('.ng-key[data-touche="1"]').focus({ preventScroll: true }));
  const y0n = await defile(p);
  await p.keyboard.press('ArrowRight');
  check((await actif(p, '.ng-key')).txt === '2', 'nerdle : flèche droite passe à la touche suivante');
  await p.keyboard.press('ArrowDown');
  check((await actif(p, '.ng-key')).txt === '8', 'nerdle : flèche bas passe à la touche de la rangée suivante');
  await p.keyboard.press('ArrowUp');
  check((await actif(p, '.ng-key')).txt === '2', 'nerdle : flèche haut revient à la touche du dessus');
  check((await actif(p, '.ng-key')).visible, 'nerdle : focus visible sur la touche');
  await p.keyboard.press(' ');
  check((await p.locator('.ng-ligne.is-saisie').getAttribute('aria-label')).includes('2'), 'nerdle : Espace tape la touche (saisie « 2 »)');
  await p.keyboard.press('Enter');
  check((await p.locator('.ng-live').textContent()).includes('huit caractères'), 'nerdle : Entrée valide la saisie (refus : calcul incomplet)');
  check((await defile(p)) === y0n, 'nerdle : les flèches ne font pas défiler la page');
  await fermer(p, 'nerdle');

  /* ---------- Anagramme : flèches entre les tuiles du mot, Entrée et Espace ---------- */
  p = await ouvre(browser, 'fake-sb-grilles.mjs', '#anagramme', '.ang-mot.is-actif .ang-tuile', '.ang-mot.is-actif');
  await p.evaluate(() => document.querySelector('.ang-mot.is-actif .ang-tuile').focus({ preventScroll: true }));
  const y0a = await defile(p);
  const t0 = await p.evaluate(() => document.activeElement.dataset.t);
  await p.keyboard.press('ArrowRight');
  const t1 = await p.evaluate(() => document.activeElement.dataset.t);
  check(t1 !== t0 && (await p.evaluate(() => !!document.activeElement.closest('.ang-tuiles'))), 'anagramme : flèche droite passe à la tuile suivante du mot');
  await p.keyboard.press('Enter');
  check((await p.locator('.ang-mot.is-actif .ang-case.is-pleine').count()) === 1, 'anagramme : Entrée pose la tuile (les tuiles sont des boutons)');
  check((await defile(p)) === y0a, 'anagramme : les flèches ne font pas défiler la page');
  await fermer(p, 'anagramme');

  /* ---------- Mots croisés : flèches déplacent la case, Entrée passe au mot suivant, Espace change de sens ---------- */
  p = await ouvre(browser, 'fake-sb-grilles.mjs', '#mots-croises', '.mc-case:not(.is-noire)', '.mc-grille');
  await p.locator('.mc-case:not(.is-noire)').first().click();
  await sleep(100);
  const c0 = await p.evaluate(() => document.querySelector('.mc-case.is-pos').dataset.c);
  const y0x = await defile(p);
  await p.keyboard.press('ArrowRight');
  const c1 = await p.evaluate(() => document.querySelector('.mc-case.is-pos').dataset.c);
  check(Number(c1) > Number(c0), 'mots croisés : flèche droite déplace la case active');
  await p.keyboard.press('ArrowDown');
  check(await p.evaluate(() => !!document.querySelector('.mc-case.is-pos')), 'mots croisés : flèche bas garde une case active');
  check((await defile(p)) === y0x, 'mots croisés : les flèches ne font pas défiler la page');
  const rappel0 = await p.locator('.mc-rappel').textContent();
  await p.keyboard.press('Enter');
  check((await p.locator('.mc-rappel').textContent()) !== rappel0, 'mots croisés : Entrée passe au mot suivant');
  const sens0 = await p.locator('.mc-rappel').textContent();
  await p.keyboard.press(' ');
  await p.keyboard.press(' ');
  check((await p.locator('.mc-rappel').textContent()) === sens0, 'mots croisés : Espace change de sens (deux appuis ramènent au même mot)');
  await fermer(p, 'mots croisés');

  /* ---------- Démineur : flèches, Entrée ouvre la case, F pose un drapeau ---------- */
  p = await ouvre(browser, 'fake-sb-solo.mjs', '#demineur', '.sol-case', '#dm-champ');
  await p.evaluate(() => document.querySelector('.sol-case[data-i="0"]').focus({ preventScroll: true }));
  const y0d = await defile(p);
  await p.keyboard.press('f');
  check(await p.evaluate(() => document.querySelector('.sol-case[data-i="0"]').classList.contains('is-drapeau')), 'démineur : F pose un drapeau (case 1, encore fermée)');
  await p.keyboard.press('ArrowRight');
  check((await actif(p, '.sol-case')).data.i === '1', 'démineur : flèche droite passe à la case suivante');
  await p.keyboard.press('ArrowDown');
  check((await actif(p, '.sol-case')).data.i === '10', 'démineur : flèche bas passe à la case de la ligne suivante');
  await p.keyboard.press('Enter');
  check(await p.evaluate(() => /is-ouverte|is-explose/.test(document.querySelector('.sol-case[data-i="10"]').className)), 'démineur : Entrée ouvre la case');
  check((await defile(p)) === y0d, 'démineur : les flèches ne font pas défiler la page');
  await fermer(p, 'démineur');

  /* ---------- Sudoku : flèches entre les cases, chiffres, Retour arrière ---------- */
  p = await ouvre(browser, 'fake-sb-solo.mjs', '#sudoku', '.sol-s', '#su-grille');
  await p.evaluate(() => document.querySelector('.sol-s[data-i="0"]').focus({ preventScroll: true }));
  const y0s = await defile(p);
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  check((await actif(p, '.sol-s')).data.i === '2', 'sudoku : deux flèches droite amènent à la case 3');
  await p.keyboard.press('ArrowDown');
  check((await actif(p, '.sol-s')).data.i === '11', 'sudoku : flèche bas passe à la ligne suivante');
  await p.keyboard.press('ArrowUp');
  await p.keyboard.press('1');
  check((await p.locator('.sol-s[data-i="2"]').textContent()).trim() === '1', 'sudoku : chiffre 1 posé dans la case active');
  await p.keyboard.press('Backspace');
  check((await p.locator('.sol-s[data-i="2"]').textContent()).trim() === '', 'sudoku : Retour arrière efface la case');
  check((await defile(p)) === y0s, 'sudoku : les flèches ne font pas défiler la page');
  await fermer(p, 'sudoku');

  /* ---------- 2048 : les quatre flèches jouent un coup, la page ne défile pas ---------- */
  p = await ouvre(browser, 'fake-sb-solo.mjs', '#2048', '#g-plateau', '#g-plateau');
  await p.evaluate(() => document.getElementById('g-plateau').focus({ preventScroll: true }));
  const y02 = await defile(p);
  for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
    await p.keyboard.press(k);
    if ((await p.locator('#g-statut').textContent()).includes('Partie en cours')) break;
  }
  check((await p.locator('#g-statut').textContent()).includes('Partie en cours'), '2048 : une flèche joue un coup (le compte démarre)');
  check((await defile(p)) === y02, '2048 : les flèches ne font pas défiler la page');
  check(await p.evaluate(() => document.getElementById('g-plateau').matches(':focus-visible')), '2048 : focus visible sur le plateau');
  await fermer(p, '2048');

  /* ---------- Arcade : chaque jeu se lance au clavier (Entrée), reçoit une action, se met en pause (Échap) ---------- */
  for (const jeu of JEUX_ARCADE) {
    p = await openPage(browser, { page: 'jeux', fixture: 'fake-sb.mjs', hash: `#arcade-${jeu}`, width: 1280, height: 900, scenario: { arcadeGame: jeu } });
    await p.waitForSelector('#arc-canvas', { timeout: 15000 });
    await sleep(200);
    // Parcours au clavier seul : la borne est atteinte à la tabulation et montre son focus.
    check(await tabJusqua(p, 'arc-canvas'), `${jeu} : la borne est atteinte à la tabulation`);
    check(await p.evaluate(() => document.getElementById('arc-canvas').matches(':focus-visible')), `${jeu} : focus visible sur la borne`);
    const y0 = await defile(p);
    check((await p.locator('#arc-pause').isDisabled()) && (await p.locator('#arc-jouer').isEnabled()), `${jeu} : avant le départ, « Jouer » actif et « Pause » désactivé`);
    await p.keyboard.press('Enter');
    await sleep(120);
    check(await p.locator('#arc-pause').isEnabled(), `${jeu} : Entrée démarre la partie`);
    await p.keyboard.press('ArrowLeft');
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press(' ');
    await p.keyboard.press('ArrowUp');
    await p.keyboard.press('ArrowDown');
    await sleep(120);
    check(await p.locator('#arc-pause').isEnabled(), `${jeu} : la partie continue après les flèches et l'Espace (action au clavier)`);
    check((await defile(p)) === y0, `${jeu} : les flèches et l'Espace ne font pas défiler la page`);
    await p.keyboard.press('Escape');
    check((await p.locator('#arc-pause').textContent()).trim() === 'Reprendre', `${jeu} : Échap met en pause`);
    await p.keyboard.press('Escape');
    check((await p.locator('#arc-pause').textContent()).trim() === 'Pause', `${jeu} : Échap reprend la partie`);
    await fermer(p, `arcade ${jeu}`);
  }

  /* ---------- Arcade : Espace démarre un jeu sans action (Paillettes) sans faire défiler la page ---------- */
  p = await openPage(browser, { page: 'jeux', fixture: 'fake-sb.mjs', hash: '#arcade-paillettes', width: 1280, height: 900, scenario: { arcadeGame: 'paillettes' } });
  await p.waitForSelector('#arc-canvas', { timeout: 15000 });
  await sleep(200);
  await p.evaluate(() => { document.getElementById('arc-canvas').focus({ preventScroll: true }); window.scrollTo(0, 0); });
  const y0p = await defile(p);
  await p.keyboard.press(' ');
  await sleep(120);
  check(await p.locator('#arc-pause').isEnabled(), 'paillettes : Espace démarre la partie (jeu sans action)');
  check((await defile(p)) === y0p, 'paillettes : Espace ne fait pas défiler la page');
  await fermer(p, 'arcade paillettes (Espace)');

  await browser.close();
  finish();
})().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  if (browser) await browser.close();
});
