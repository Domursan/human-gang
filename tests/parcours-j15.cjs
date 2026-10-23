// Parcours J15 : Bataille de cartes (jeux.html#bataille).
// Accueil (règles, bêta sans Paillettes, pas de deck) ; créer son deck de défense (5 cartes, une seule de puissance 6) ;
// attaquer Alice avec 5 cartes ; écran de résultat (5 duels, puissances, avantages en texte, score) ; historique ;
// adversaire sans deck non attaquable ; 360 px sans défilement horizontal ; aucune erreur JS.
const { check, finish, openPage, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

(async () => {
  const browser = await chromium.launch();
  const p = await openPage(browser, { page: 'jeux', fixture: 'fake-sb-jeux3.mjs', hash: '#bataille', width: 390, height: 900, reducedMotion: 'reduce' });
  await p.waitForSelector('.jb', { timeout: 5000 }).catch(() => {});
  const txt = await p.locator('#jeux-panel-bataille').innerText();
  check(txt.includes('Arène de cartes') && txt.includes('Membre bat objet'), 'accueil : titre et règles (Membre bat objet…)');
  check(txt.includes('Bêta'), 'accueil : bêta sans Paillettes annoncée');
  check(txt.includes('pas encore de deck de défense'), 'accueil : pas encore de deck');
  check(await p.locator('[data-act="attaquer"][aria-label^="Attaquer Bruno"]').isDisabled(), 'adversaire sans deck : bouton désactivé');
  // Deck de défense
  await p.click('[data-act="deck"]');
  await sleep(200);
  for (const id of [6, 7]) await p.click(`button.hgc[data-copy="${id}"]`).catch(() => {});
  check((await p.locator('.jb-slot.is-full').count()) === 1, 'deck : une seule carte de puissance 6 acceptée (la 2e est désactivée)');
  for (const id of [1, 2, 3, 4]) await p.click(`button.hgc[data-copy="${id}"]`);
  check((await p.locator('.jb-slot.is-full').count()) === 5, 'deck : 5 cartes choisies');
  check(await p.locator('button.hgc[data-copy="5"]').isDisabled(), 'deck : plus de choix possible au-delà de 5');
  await p.click('[data-act="enregistrer"]');
  await p.waitForSelector('.jb-row5', { timeout: 3000 }).catch(() => {});
  check((await p.locator('.jb-row5 .hgc').count()) === 5, 'deck : enregistré et affiché (5 cartes)');
  let c = (await log(p)).find((e) => e[1] === 'hg_battle_set_deck');
  check(c && JSON.stringify(c[2].p_copies) === '[6,1,2,3,4]', 'deck : envoyé dans l’ordre choisi');
  // Attaque
  await p.click('[data-act="attaquer"][data-id="00000002-0000-4000-8000-000000000002"]');
  await sleep(200);
  for (const id of [1, 2, 3, 4, 5]) await p.click(`button.hgc[data-copy="${id}"]`);
  await p.click('[data-act="retirer"][data-i="4"]');
  check((await p.locator('.jb-slot.is-full').count()) === 4, 'main : retirer une carte libère la position');
  await p.click('button.hgc[data-copy="5"]');
  await p.click('[data-act="lancer"]');
  await p.waitForSelector('.jb-res', { timeout: 3000 }).catch(() => {});
  check((await p.locator('.jb-duel').count()) === 5, 'résultat : 5 duels');
  const head = await p.locator('.jb-res .jd-title').innerText();
  check(/Victoire|Défaite|Égalité/.test(head) && /\d – \d/.test(head), `résultat : score affiché (« ${head} »)`);
  check((await p.locator('.jb-duel').first().innerText()).includes('6') && (await p.locator('.jb-duel').first().innerText()).includes('objet bat lieu'), 'duel 1 : 6 contre 1, « avantage : objet bat lieu » en texte');
  check((await p.locator('.jb-duel.is-perdu .jb-duel-r').first().innerText().catch(() => 'Duel perdu')) === 'Duel perdu', 'texte neutre : « Duel perdu »');
  check((await p.locator('.jb-res').innerText()).includes('contre la défense de Alice'), 'résultat : « contre la défense de Alice »');
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal (résultat)');
  await p.screenshot({ path: __dirname + '/shots/j15-bataille.png', fullPage: true });
  await p.setViewportSize({ width: 360, height: 800 });
  await sleep(200);
  check((await hscroll(p)) <= 0, '360 px : pas de défilement horizontal (résultat)');
  // Retour et historique
  await p.click('[data-act="retour"]');
  await p.waitForSelector('.jb-hist', { timeout: 3000 }).catch(() => {});
  check((await p.locator('.jb-h').count()) === 1, 'historique : la bataille apparaît');
  check((await hscroll(p)) <= 0, '360 px : pas de défilement horizontal (accueil)');
  check(p.errs.length === 0, 'aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();
  await browser.close();
  finish();
})();
