// Parcours : secrets cachés, page 404 et lettres du mot « SECRETS ».
// 404 : une adresse inconnue reçoit 404.html (statut 404, comme GitHub Pages) ; la page charge ses ressources par des
// chemins absolus à la racine (/assets/…), comme sur humane-gang.com (CNAME) : le test sert le site à la racine. Le jeu des paillettes tourne
// (horloge factice de Playwright pour passer les 30 s), la fin de partie appelle hg_egg_found('jeu404', { score }) ; un
// visiteur joue sans appel et voit le message « Connecte-toi… » ; mouvement réduit ; 390 px sans défilement.
// Lettres : chacune des 7 pages affiche sa lettre dans le pied de page (aria-label « Un secret ? », atteignable au clavier),
// s'illumine au survol et un clic appelle hg_egg_found('lettre_N').
// Faux Supabase : fixtures/fake-sb.mjs (réponse hg_egg_found). Lancer : node tests/parcours-eggs-404-lettres.cjs
// Préfixe : racine par défaut (harnais) ; HG_PREFIX=/human-gang seulement pour un essai sous un sous-chemin.
const { ORIGIN, PREFIX, check, finish, openPage, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

/** Appels hg_egg_found du faux client (arguments), dans l'ordre. */
const eggCalls = async (p) => (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_egg_found').map((e) => e[2]);
/** Lettres du mot secret, par page (numéro et lettre affichée). */
const LETTRES = [
  ['accueil', 1, 'S'], ['cartes', 2, 'E'], ['irl', 3, 'C'], ['historique', 4, 'R'],
  ['membre', 5, 'E'], ['aide', 6, 'T'], ['secret-santa', 7, 'S'],
];

/**
 * Joue une partie complète dans l'horloge factice : balaie le canevas de gauche à droite pendant les 30 s.
 * Renvoie le score affiché à la fin.
 */
async function jouePartie(p) {
  await p.clock.install();
  await p.click('#jeu-bouton');
  const box = await p.locator('#jeu-canvas').boundingBox();
  for (let i = 0; i < 300; i++) { // 300 pas de 100 ms simulés
    const x = box.x + box.width * (0.5 + 0.45 * Math.sin(i * 0.21));
    await p.mouse.move(x, box.y + box.height * 0.85);
    await p.clock.runFor(100);
  }
  await sleep(300); // laisse finir la promesse de fin de partie (hasSession, appel au serveur)
  return Number(await p.textContent('#jeu-score'));
}

(async () => {
  console.log('Racine testée : ' + require('./lib/harness.cjs').ROOT + ' (préfixe ' + PREFIX + ')');
  const browser = await chromium.launch();

  /* ---------- Page 404 : adresse inconnue, ressources et mise en page ---------- */
  let p = await openPage(browser, { page: '404', width: 1280, height: 900 });
  check((await p.textContent('h1')).trim() === 'Page introuvable…', '404 : titre « Page introuvable… »');
  check((await p.textContent('.e404-carte > p:not(.e404-code)')).includes('mais tu peux attraper des paillettes !'), '404 : phrase d\'accroche');
  check(await p.$eval('.e404', (el) => getComputedStyle(el).display) === 'grid', '404 : feuille de style chargée (chemins absolus)');
  check(await p.$eval('body', (el) => getComputedStyle(el).backgroundColor) !== 'rgba(0, 0, 0, 0)', '404 : couleur de fond du thème appliquée');
  check((await p.textContent('#jeu-bouton')).trim() === 'Jouer', '404 : bouton « Jouer » avant la partie');
  check(await p.$eval('#jeu-canvas', (el) => getComputedStyle(el).touchAction) === 'none', '404 : le canevas ne fait pas défiler la page au doigt');
  check((await p.getAttribute('a.e404-accueil', 'href')) === `${PREFIX}/`, '404 : lien « Retour à l\'accueil » vers la racine du site');
  check(p.errs.length === 0, '404 : chargement sans erreur' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));

  // Partie avec score : le score part au serveur une fois
  const score = await jouePartie(p);
  check(score >= 1, `404 : partie terminée avec un score ≥ 1 (score ${score})`);
  check((await p.textContent('#jeu-bouton')).trim() === 'Rejouer', '404 : bouton « Rejouer » après la partie');
  let calls = (await eggCalls(p)).filter((a) => a.p_egg === 'jeu404');
  check(calls.length === 1 && calls[0].p_extra?.score === score, 'hg_egg_found(jeu404, { score }) appelé une fois avec le score');
  check((await p.textContent('#jeu-message')).includes('Tu as attrapé'), '404 : message de fin de partie');
  check(p.errs.length === 0, '404 : aucune erreur JS pendant la partie' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // Visiteur : le jeu tourne, pas d'appel, message d'invitation à se connecter
  p = await openPage(browser, { page: '404', width: 390, scenario: { guest: true }, reducedMotion: 'reduce' });
  check(await hscroll(p) <= 0, '404 visiteur, 390 px : pas de défilement horizontal');
  const scoreV = await jouePartie(p);
  check(scoreV >= 1, `404 visiteur : partie jouable (score ${scoreV})`);
  check((await eggCalls(p)).length === 0, '404 visiteur : aucun appel au serveur');
  check((await p.textContent('#jeu-message')).includes('Connecte-toi pour gagner des Paillettes'), '404 visiteur : message « Connecte-toi pour gagner des Paillettes »');
  check(p.errs.length === 0, '404 visiteur, mouvement réduit : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // Adresse inconnue : GitHub Pages sert 404.html ; le statut reste 404
  p = await openPage(browser, { page: 'accueil', width: 1280 });
  const rep = await p.goto(`${ORIGIN}${PREFIX}/adresse/inconnue-xyz`);
  await sleep(800);
  check(rep && rep.status() === 404, 'adresse inconnue : statut 404');
  check((await p.textContent('h1')).trim() === 'Page introuvable…', 'adresse inconnue : la page 404 s\'affiche');
  check(await p.$eval('.e404', (el) => getComputedStyle(el).display) === 'grid', 'adresse inconnue : ressources chargées sous le préfixe');
  check(p.errs.filter((e) => !/adresse\/inconnue-xyz/.test(e)).length === 0, 'adresse inconnue : aucune autre erreur JS ni ressource manquante');
  await p.ctx.close();

  /* ---------- Lettres cachées : une par page ---------- */
  for (const [page, n, lettre] of LETTRES) {
    p = await openPage(browser, { page, width: 390 });
    await p.waitForSelector('.lettre-secret', { timeout: 8000 }).catch(() => {});
    const count = await p.locator('.lettre-secret').count();
    check(count === 1, `${page} : une seule lettre cachée`);
    if (count !== 1) { await p.ctx.close(); continue; }
    const b = p.locator('.lettre-secret');
    check((await b.textContent()).trim() === lettre, `${page} : la lettre affichée est « ${lettre} » (lettre ${n})`);
    check((await b.getAttribute('aria-label')) === 'Un secret ?', `${page} : aria-label neutre « Un secret ? »`);
    check(await b.evaluate((el) => el.tagName) === 'BUTTON', `${page} : la lettre est un bouton (atteignable au clavier)`);
    const repos = parseFloat(await b.evaluate((el) => getComputedStyle(el).opacity));
    check(repos < 0.3, `${page} : lettre discrète au repos (opacité ${repos})`);
    await b.hover();
    await sleep(600);
    const survol = parseFloat(await b.evaluate((el) => getComputedStyle(el).opacity));
    check(survol >= 0.95, `${page} : la lettre s'illumine au survol (opacité ${survol})`);
    check(await hscroll(p) <= 0, `${page}, 390 px : pas de défilement horizontal`);
    await b.click();
    await sleep(300);
    let appels = (await eggCalls(p)).filter((a) => a.p_egg === `lettre_${n}`);
    check(appels.length === 1, `${page} : clic → hg_egg_found(lettre_${n})`);
    // Clavier : la lettre se déclenche avec Entrée
    await b.focus();
    await p.keyboard.press('Enter');
    await sleep(200);
    appels = (await eggCalls(p)).filter((a) => a.p_egg === `lettre_${n}`);
    check(appels.length >= 1, `${page} : lettre atteignable au clavier (Entrée)`);
    check(p.errs.length === 0, `${page} : aucune erreur JS` + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
