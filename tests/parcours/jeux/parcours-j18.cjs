// Parcours : idée J18, l'arcade du jour (onglet « Arcade » de jeux.html, paquet xJ4).
// Les trois mini-jeux sont jouables chaque jour : sélecteur (aria-pressed, « Jeu du jour » sur le tirage du serveur),
// adresse #arcade-<jeu> (choix au chargement, puis changement d'adresse), récompense « une par jour, tous jeux confondus » ; une partie complète (horloge simulée) ouvre et ferme la partie côté serveur (hg_arcade_start,
// hg_arcade_finish), affiche le gain du jour une seule fois ; bouton Pause ; score refusé par le serveur ; 360 px.
// Pas de limite de temps : une partie se termine quand le joueur perd ses trois vies (Paillettes, Raclette) ou au premier accrochage (Domu-mobile).
// Faux Supabase : fixtures/fake-sb.mjs (scénario arcadeGame, arcadeRewarded, arcadeBadScore).
const { check, finish, openPage, hscroll, log, sleep, chromium } = require('../../lib/harness.cjs');

/**
 * Joue une partie complète dans l'horloge simulée (balayage du canevas) jusqu'à la fin (bouton « Jouer » de nouveau actif),
 * renvoie le score affiché.
 */
async function partie(p, pas = 3000) {
  await p.click('#arc-jouer');
  return balaye(p, pas);
}

/** Balaye le canevas jusqu'à la fin de la partie en cours (bouton « Jouer » ou « Rejouer » actif), renvoie le score. */
async function balaye(p, pas = 3000) {
  const box = await p.locator('#arc-canvas').boundingBox();
  for (let i = 0; i < pas && !(await p.locator('#arc-jouer').isEnabled()); i++) {
    await p.mouse.move(box.x + box.width * (0.5 + 0.45 * Math.sin(i * 0.21)), box.y + box.height * 0.85);
    await p.clock.runFor(100);
  }
  await sleep(400);
  return Number(await p.textContent('#arc-score'));
}

(async () => {
  const browser = await chromium.launch();

  /* ---------- Tirage du jour : Raclette ---------- */
  let p = await openPage(browser, { page: 'jeux', hash: '#arcade', width: 390, height: 900, scenario: { arcadeGame: 'raclette' } });
  await p.waitForSelector('.arc-choix', { timeout: 5000 }).catch(() => {});
  check((await p.getAttribute('#jeux-tab-arcade', 'aria-selected')) === 'true', 'onglet : « Arcade » sélectionné depuis /pages/jeux/jeux.html#arcade');
  check((await p.locator('.arc-jeu').count()) === 3 && (await p.locator('.arc-jeu:not([disabled])').count()) === 3, 'sélecteur : les trois mini-jeux jouables');
  check(/Raclette/.test(await p.locator('.arc-jeu[aria-pressed="true"]').innerText()) && /jeu du jour/i.test(await p.locator('.arc-jeu[aria-pressed="true"]').innerText()), 'sélecteur : Raclette (jeu du jour) choisi par défaut'); // badge affiché en capitales par la CSS
  check((await p.locator('.arc-jeu[aria-pressed="false"]').count()) === 2, 'sélecteur : les deux autres non choisis (aria-pressed=false)');
  check(/une seule partie par jour/i.test(await p.locator('.arc-tirage').innerText()), 'sélecteur : une seule partie par jour récompensée, tous jeux confondus');
  check((await p.locator('#arc-scores-h').innerText()).includes('Raclette'), 'scores : « Meilleurs scores · Raclette »');
  check((await p.locator('#arc-top .arc-row').count()) === 2, 'scores : tableau de la semaine (2 lignes)');
  check((await p.locator('#arc-gain').innerText()).includes('+5 ✦') && (await p.locator('#arc-gain').innerText()).includes('à gagner aujourd’hui'), 'récompense : « +5 ✦ à gagner aujourd’hui »');
  check(await p.locator('#arc-pause').isDisabled(), 'pause : désactivée avant la partie');
  check(await p.$eval('#arc-canvas', (el) => getComputedStyle(el).touchAction) === 'none', 'canevas : pas de défilement au doigt');
  check(await hscroll(p) <= 0, '390 px : pas de défilement horizontal');
  check(p.errs.length === 0, 'aucune erreur JS au chargement' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  check((await p.locator('.nav-group[data-menu="jeux"] .nav-menu a[href^="/pages/jeux/jeux.html#"]').count()) >= 1, 'menu : liens vers les onglets Jeux');
  await p.ctx.close();

  /* ---------- Partie complète (horloge simulée), pause, gain une fois ---------- */
  p = await openPage(browser, { page: 'jeux', hash: '#arcade', width: 1280, scenario: { arcadeGame: 'paillettes' } });
  await p.waitForSelector('#arc-jouer', { timeout: 5000 });
  await p.clock.install();
  await p.click('#arc-jouer');
  await p.clock.runFor(2000);
  check(!(await p.locator('#arc-pause').isDisabled()), 'pause : active pendant la partie');
  await p.click('#arc-pause');
  const sc1 = await p.textContent('#arc-score');
  const vies1 = await p.textContent('#arc-vies-txt');
  await p.clock.runFor(5000);
  check((await p.textContent('#arc-score')) === sc1 && (await p.textContent('#arc-pause')).trim() === 'Reprendre', 'pause : la partie est figée (score), bouton « Reprendre »');
  check(vies1 === '3 vies sur 3', `pause : vies affichées au départ (« ${vies1} »)`);
  await p.click('#arc-pause');
  const sc = await balaye(p);
  check(!(await p.locator('#arc-jouer').isDisabled()) && (await p.textContent('#arc-msg')).includes('Score'), 'fin : partie terminée par la perte des vies (bouton actif, score affiché)');
  let calls = (await log(p)).filter((e) => e[0] === 'rpc' && /^hg_arcade_(start|finish)$/.test(e[1]));
  check(calls.filter((c) => c[1] === 'hg_arcade_start').length === 1, 'serveur : hg_arcade_start appelé une fois au lancement');
  const fin = calls.find((c) => c[1] === 'hg_arcade_finish');
  check(!!fin && fin[2].p_run === 'run-1' && fin[2].p_score === sc, `serveur : hg_arcade_finish(run-1, ${sc})`);
  check(sc >= 1 && (await p.textContent('#arc-msg')).includes('+5 ✦'), `fin : score ${sc} et gain +5 ✦ affichés`);
  check((await p.locator('#arc-gain').innerText()).includes('reçue aujourd’hui'), 'récompense : « reçue aujourd’hui » après le gain');
  check((await p.textContent('#arc-jouer')).trim() === 'Rejouer', 'bouton : « Rejouer » après la partie');
  check(Number(await p.textContent('#arc-record')) === sc, 'record : mis à jour');
  check((await p.locator('#arc-top .is-me').count()) === 1, 'scores : ma ligne apparaît au tableau');
  const sc2 = await partie(p);
  check(!(await p.textContent('#arc-msg')).includes('✦'), `2e partie (${sc2}) : pas de second gain`);
  check(p.errs.length === 0, 'aucune erreur JS pendant les parties' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Domu-mobile, score refusé par le serveur ---------- */
  p = await openPage(browser, { page: 'jeux', hash: '#arcade', width: 1280, scenario: { arcadeGame: 'domu', arcadeBadScore: true } });
  await p.waitForSelector('#arc-jouer', { timeout: 5000 });
  check((await p.locator('.arc-jeu[aria-pressed="true"]').innerText()).includes('Domu-mobile'), 'sélecteur : Domu-mobile (jeu du jour)');
  await p.clock.install();
  await p.click('#arc-jouer');
  for (let i = 0; i < 950 && !(await p.locator('#arc-jouer').isEnabled()); i++) { await p.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight'); await p.clock.runFor(100); }
  await sleep(400);
  check((await p.textContent('#arc-msg')).includes('Score non retenu : Score impossible'), 'serveur : score refusé, message clair');
  check(p.errs.length === 0, 'Domu-mobile : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Adresse #arcade-<jeu> : choix au chargement, puis changement d'adresse et de jeu ---------- */
  p = await openPage(browser, { page: 'jeux', hash: '#arcade-domu', width: 1280, scenario: { arcadeGame: 'raclette' } });
  await p.waitForSelector('#arc-jouer', { timeout: 5000 });
  check((await p.getAttribute('.arc-jeu[data-game="domu"]', 'aria-pressed')) === 'true', 'adresse #arcade-domu : Domu-mobile choisi');
  check((await p.locator('.arc-jeu[data-game="raclette"] .arc-tire-badge').isVisible()), 'adresse #arcade-domu : le jeu du jour reste étiqueté');
  await p.evaluate(() => { location.hash = '#arcade-paillettes'; });
  await p.waitForFunction(() => document.querySelector('.arc-jeu[data-game="paillettes"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 5000 }).catch(() => {});
  check((await p.getAttribute('.arc-jeu[data-game="paillettes"]', 'aria-pressed')) === 'true', 'adresse changée (#arcade-paillettes) pendant que l’onglet est ouvert : Paillettes choisi');
  await p.click('.arc-jeu[data-game="raclette"]');
  await p.waitForFunction(() => document.querySelector('#arc-canvas')?.getAttribute('aria-label')?.includes('Raclette'), null, { timeout: 5000 }).catch(() => {});
  check((await p.getAttribute('#arc-canvas', 'aria-label')).includes('Raclette'), 'sélecteur : cliquer Raclette charge le jeu (canevas)');
  check((await p.locator('.arc-jeu[aria-pressed="true"]').getAttribute('data-game')) === 'raclette', 'sélecteur : Raclette marqué');
  check(p.errs.length === 0, 'adresse et sélecteur : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- 360 px et animation réduite ---------- */
  p = await openPage(browser, { page: 'jeux', hash: '#arcade', width: 360, height: 800, reducedMotion: 'reduce' });
  await p.waitForSelector('#arc-canvas', { timeout: 5000 });
  check(await hscroll(p) <= 0, '360 px : pas de défilement horizontal');
  const tailles = await p.$$eval('.arc button, .jeux-tab', (bs) => bs.filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height));
  check(tailles.every((h) => h >= 44), 'cibles : boutons d’au moins 44 px');
  await p.ctx.close();

  await browser.close();
  finish();
})();
