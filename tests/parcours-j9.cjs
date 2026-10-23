// Parcours J9 : Framed du ciné-club (jeux.html#framed).
// L'onglet s'ouvre depuis l'adresse ; 1 image au départ, les images suivantes verrouillées ; suggestions limitées aux films
// du ciné-club ; une erreur dévoile l'image 2 ; deviner à la 2e image ; fin : film dévoilé, gain, partage ; 360 px sans
// défilement horizontal ; onglets ARIA (flèches) ; aucune erreur JS. Faux Supabase : fixtures/fake-sb-jeux3.mjs.
const { check, finish, openPage, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'jeux', fixture: 'fake-sb-jeux3.mjs', hash: '#framed', width: 390, height: 900 });
  await p.waitForSelector('.jd-title', { timeout: 5000 }).catch(() => {});
  check((await p.locator('#jeux-tab-framed').getAttribute('aria-selected')) === 'true', 'onglet : Framed sélectionné depuis l’adresse #framed');
  check((await p.locator('#jeux-panel-framed .jd-title').innerText()).includes('Framed du gang #18'), 'titre : « Framed du gang #18 »');
  check((await p.locator('.jf-img img').count()) === 1, 'image : la 1re image est affichée');
  check((await p.locator('.jf-num:not([disabled])').count()) === 1 && (await p.locator('.jf-num[disabled]').count()) === 5, 'images : 1 ouverte, 5 verrouillées');
  check((await p.locator('.jd-pts-pill').innerText()).includes('6 pts possibles'), 'points : 6 possibles à la 1re image');
  check((await p.locator('.jd-note').innerText()).includes('5 films du ciné-club'), 'note : seuls les films du ciné-club sont proposés');
  check((await p.locator('.jd-hier').innerText()).includes('Le Dîner de cons'), 'hier : résumé de la manche précédente');
  // Suggestions
  await p.fill('#jf-input', 'In');
  await sleep(150);
  const opts = await p.locator('#jf-list [role="option"]').allInnerTexts();
  check(opts.length === 3 && opts.some((t) => t.includes('Interstellar')) && opts.some((t) => t.includes('vu le')), 'suggestions : 3 films contenant « In », avec la date de séance');
  check((await p.locator('#jf-input').getAttribute('aria-expanded')) === 'true', 'combobox : aria-expanded vrai pendant les suggestions');
  // Mauvaise réponse (clavier)
  await p.fill('#jf-input', 'Prest');
  await sleep(100);
  await p.keyboard.press('Enter');
  await p.click('#jf-form button[type="submit"]');
  await p.waitForFunction(() => document.querySelectorAll('.jf-num:not([disabled])').length === 2, null, { timeout: 3000 }).catch(() => {});
  check((await p.locator('.jf-num:not([disabled])').count()) === 2, 'erreur : l’image 2 est dévoilée');
  check((await p.locator('.jd-try.is-miss').innerText()).includes('Le Prestige'), 'essais : « Le Prestige · Raté »');
  check((await p.locator('.jf-num.is-miss').count()) === 1, 'images : la 1re marquée ratée');
  check((await p.locator('[data-act="passer"]').innerText()).includes('image 3'), 'bouton : « Passer · image 3 »');
  // Proposition hors liste refusée côté interface
  await p.fill('#jf-input', 'Titanic');
  await p.click('#jf-form button[type="submit"]');
  check((await p.locator('#jf-hint').innerText()).includes('liste'), 'saisie libre hors liste : message, aucun envoi');
  // Bonne réponse à la 2e image
  await p.fill('#jf-input', 'Nope');
  await sleep(100);
  await p.locator('#jf-list [role="option"]').first().click();
  await p.click('#jf-form button[type="submit"]');
  await p.waitForSelector('.jd-end', { timeout: 3000 }).catch(() => {});
  check((await p.locator('.jd-end').innerText()).includes('Trouvé en 2 essais'), 'fin : « Trouvé en 2 essais »');
  check((await p.locator('.jd-end-ans').innerText()).includes('Nope'), 'fin : le film est dévoilé');
  check((await p.locator('.jd-end').innerText()).includes('vu le 14 avril 2024'), 'fin : date de la séance');
  check((await p.locator('.jd-end').innerText()).includes('+10 ✦'), 'fin : gain affiché');
  check((await p.locator('.jf-num:not([disabled])').count()) === 6, 'fin : les 6 images sont visibles');
  const calls = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_framed_guess');
  check(calls.length === 2 && calls[0][2].p_film === 'f-prestige' && calls[1][2].p_film === 'f-nope', 'appels : 2 essais envoyés avec les bons films');
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal');
  await p.screenshot({ path: __dirname + '/shots/j9-framed.png', fullPage: true });
  check(p.errs.length === 0, 'aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // Onglets ARIA et 360 px
  p = await openPage(browser, { page: 'jeux', fixture: 'fake-sb-jeux3.mjs', hash: '#framed', width: 360, height: 800 });
  await p.focus('#jeux-tab-framed');
  await p.keyboard.press('ArrowRight');
  await sleep(400);
  check((await p.locator('#jeux-tab-heardle').getAttribute('aria-selected')) === 'true' && (await p.evaluate(() => location.hash)) === '#heardle', 'onglets : flèche droite → Heardle, adresse à jour');
  await p.keyboard.press('ArrowLeft');
  await sleep(300);
  check((await hscroll(p)) <= 0, '360 px : pas de défilement horizontal');
  check((await p.locator('.nav a[href="jeux.html"]').count()) >= 1, 'menu : lien « Jeux »');
  await p.ctx.close();

  p = await openPage(browser, { page: 'jeux', fixture: 'fake-sb-jeux3.mjs', hash: '#framed', scenario: { noRound: true } });
  check((await p.locator('#jeux-panel-framed').innerText()).includes('Pas de film aujourd’hui'), 'sans manche : « Pas de film aujourd’hui »');
  await p.ctx.close();
  await browser.close();
  finish();
})();
