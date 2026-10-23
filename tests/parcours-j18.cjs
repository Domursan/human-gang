// Parcours : idée J18, l'arcade du jour (onglet « Arcade » de jeux.html, paquet xJ4).
// Le serveur tire UN mini-jeu par jour (hg_arcade_board) : le tirage s'affiche (jeu du jour mis en avant, les deux autres
// « pas ce soir ») ; une partie complète (horloge simulée) ouvre et ferme la partie côté serveur (hg_arcade_start,
// hg_arcade_finish), affiche le gain du jour une seule fois ; bouton Pause ; score refusé par le serveur ; 360 px.
// Faux Supabase : fixtures/fake-sb.mjs (scénario arcadeGame, arcadeRewarded, arcadeBadScore).
const { check, finish, openPage, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

/** Joue une partie complète dans l'horloge simulée (balayage du canevas), renvoie le score affiché. */
async function partie(p, pas = 320) {
  await p.click('#arc-jouer');
  const box = await p.locator('#arc-canvas').boundingBox();
  for (let i = 0; i < pas; i++) {
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
  await p.waitForSelector('.arc-tires', { timeout: 5000 }).catch(() => {});
  check((await p.getAttribute('#jeux-tab-arcade', 'aria-selected')) === 'true', 'onglet : « Arcade » sélectionné depuis jeux.html#arcade');
  check((await p.locator('.arc-tire').count()) === 3, 'tirage : les trois mini-jeux affichés');
  check((await p.locator('.arc-tire.is-on').innerText()).includes('Raclette') && (await p.locator('.arc-tire.is-on').innerText()).includes('jeu du jour'), 'tirage : Raclette tirée au sort, « jeu du jour »');
  check((await p.locator('.arc-tire:not(.is-on)').allInnerTexts()).every((t) => t.includes('pas ce soir')), 'tirage : les deux autres « pas ce soir »');
  check(/Prochain tirage dans \d/.test(await p.locator('.arc-tirage').innerText()), 'tirage : temps avant le prochain tirage');
  check((await p.locator('#arc-scores-h').innerText()).includes('Raclette'), 'scores : « Meilleurs scores · Raclette »');
  check((await p.locator('#arc-top .arc-row').count()) === 2, 'scores : tableau de la semaine (2 lignes)');
  check((await p.locator('#arc-gain').innerText()).includes('+5 ✦') && (await p.locator('#arc-gain').innerText()).includes('1 / jour'), 'récompense : « +5 ✦ 1 / jour »');
  check(await p.locator('#arc-pause').isDisabled(), 'pause : désactivée avant la partie');
  check(await p.$eval('#arc-canvas', (el) => getComputedStyle(el).touchAction) === 'none', 'canevas : pas de défilement au doigt');
  check(await hscroll(p) <= 0, '390 px : pas de défilement horizontal');
  check(p.errs.length === 0, 'aucune erreur JS au chargement' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  check((await p.locator('.nav a[href="jeux.html"]').count()) === 1, 'menu : lien « Jeux »');
  await p.ctx.close();

  /* ---------- Partie complète (horloge simulée), pause, gain une fois ---------- */
  p = await openPage(browser, { page: 'jeux', hash: '#arcade', width: 1280, scenario: { arcadeGame: 'paillettes' } });
  await p.waitForSelector('#arc-jouer', { timeout: 5000 });
  await p.clock.install();
  await p.click('#arc-jouer');
  await p.clock.runFor(2000);
  check(!(await p.locator('#arc-pause').isDisabled()), 'pause : active pendant la partie');
  await p.click('#arc-pause');
  const t1 = await p.textContent('#arc-temps');
  await p.clock.runFor(5000);
  check((await p.textContent('#arc-temps')) === t1 && (await p.textContent('#arc-pause')).trim() === 'Reprendre', 'pause : le temps est figé, bouton « Reprendre »');
  await p.click('#arc-pause');
  const box = await p.locator('#arc-canvas').boundingBox();
  for (let i = 0; i < 300; i++) { await p.mouse.move(box.x + box.width * (0.5 + 0.45 * Math.sin(i * 0.21)), box.y + box.height * 0.85); await p.clock.runFor(100); }
  await sleep(400);
  const sc = Number(await p.textContent('#arc-score'));
  let calls = (await log(p)).filter((e) => e[0] === 'rpc' && /^hg_arcade_(start|finish)$/.test(e[1]));
  check(calls.filter((c) => c[1] === 'hg_arcade_start').length === 1, 'serveur : hg_arcade_start appelé une fois au lancement');
  const fin = calls.find((c) => c[1] === 'hg_arcade_finish');
  check(!!fin && fin[2].p_run === 'run-1' && fin[2].p_score === sc, `serveur : hg_arcade_finish(run-1, ${sc})`);
  check(sc >= 1 && (await p.textContent('#arc-msg')).includes('+5 ✦'), `fin : score ${sc} et gain +5 ✦ affichés`);
  check((await p.locator('#arc-gain').innerText()).includes('reçue aujourd’hui'), 'récompense : « reçue aujourd’hui » après le gain');
  check((await p.textContent('#arc-jouer')).trim() === 'Rejouer', 'bouton : « Rejouer » après la partie');
  check(Number(await p.textContent('#arc-record')) === sc, 'record : mis à jour');
  check((await p.locator('#arc-top .is-me').count()) === 1, 'scores : ma ligne apparaît au tableau');
  const sc2 = await partie(p, 310);
  check(!(await p.textContent('#arc-msg')).includes('✦'), `2e partie (${sc2}) : pas de second gain`);
  check(p.errs.length === 0, 'aucune erreur JS pendant les parties' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Domu-mobile, score refusé par le serveur ---------- */
  p = await openPage(browser, { page: 'jeux', hash: '#arcade', width: 1280, scenario: { arcadeGame: 'domu', arcadeBadScore: true } });
  await p.waitForSelector('#arc-jouer', { timeout: 5000 });
  check((await p.locator('#arc-titre, .arc-tire.is-on').last().innerText()).includes('Domu-mobile'), 'tirage : Domu-mobile');
  await p.clock.install();
  await p.click('#arc-jouer');
  for (let i = 0; i < 950 && !(await p.locator('#arc-jouer').isEnabled()); i++) { await p.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight'); await p.clock.runFor(100); }
  await sleep(400);
  check((await p.textContent('#arc-msg')).includes('Score non retenu : Score impossible'), 'serveur : score refusé, message clair');
  check(p.errs.length === 0, 'Domu-mobile : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
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
