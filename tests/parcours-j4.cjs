// Parcours J4 : question du jour (tuile de l'accueil, onglet « Question du jour » de la page Jeux, onglet admin).
// Accueil 390 px : question, quatre choix, série et flamme, « Ta semaine » (joker), classement du mois en trois lignes ;
// réponse sans quitter l'accueil : explication, score du gang, gains ; aucune réponse avant la réponse.
// Jeux : jeux.html#jour, onglets ARIA, classement complet ; question déjà jouée dans le quiz (message dédié).
// Admin : onglet « Question du jour » des Questions du gang, programmation d'un jour à venir.
// Faux Supabase : fixtures/fake-sb.mjs + fixtures/fake-jeux.js (injecté par openPage({ init })).
// Lancer : node tests/parcours-j4.cjs
const { SHOTS, check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  fs.mkdirSync(SHOTS, { recursive: true });

  /* ---------- Accueil, téléphone ---------- */
  let p = await openPage(browser, { page: 'accueil', width: 390, height: 844, init: 'fake-jeux.js' });
  await p.waitForSelector('#qdj-home .qdj-choice', { timeout: 6000 }).catch(() => {});
  const tuile = p.locator('#qdj-home');
  check(await tuile.isVisible(), 'accueil : tuile « Question du jour » visible');
  check((await tuile.locator('.qdj-tag').innerText()).toLowerCase().includes('question du jour'), 'accueil : pastille « Question du jour »');
  check((await tuile.locator('.qdj-prompt').innerText()).includes('Tzatzikistan'), 'accueil : énoncé de la question');
  check((await tuile.locator('.qdj-choice').count()) === 4, 'accueil : quatre choix (vrais boutons)');
  check((await tuile.locator('.qdj-serie').innerText()).includes('30 jours'), 'accueil : série et flamme « 30 jours »');
  check((await tuile.locator('.qdj-plus').innerText()).includes('+10'), 'accueil : bonus « +10 »');
  check((await tuile.locator('.qdj-day').count()) === 7 && (await tuile.locator('.qdj-day.is-joker').count()) === 1, 'accueil : semaine en 7 cases, joker marqué');
  check((await tuile.locator('.qdj-week').innerText()).includes('joker utilisé'), 'accueil : explication du joker');
  check((await tuile.locator('.qdj-row').count()) === 3, 'accueil : classement du mois en trois lignes');
  check((await tuile.locator('a[href="jeux.html#jour"]').count()) === 1, 'accueil : lien « Tout le classement » vers Jeux');
  check(!(await tuile.innerText()).includes('Bonne réponse'), 'accueil : aucune bonne réponse avant de répondre');
  const tailles = await tuile.locator('.qdj-choice').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height));
  check(tailles.every((h) => h >= 44), 'accueil : choix d’au moins 44 px de haut');
  check((await hscroll(p)) <= 0, 'accueil 390 px : pas de défilement horizontal');
  await p.screenshot({ path: path.join(SHOTS, 'j4-accueil-390.png'), fullPage: true });
  await tuile.locator('.qdj-choice', { hasText: '2022' }).click();
  await p.waitForSelector('#qdj-home .qdj-result', { timeout: 4000 }).catch(() => {});
  const res = await tuile.locator('.qdj-result').innerText().catch(() => '');
  check(res.includes('Bravo'), 'réponse juste : « Bravo »');
  check(res.includes('Un Worldle de mars 2022'), 'réponse : explication affichée');
  check(res.includes('9 membres sur 12 ont trouvé'), 'réponse : score du gang');
  check(res.includes('+10 pour ta série') && res.includes('+200 : palier de 30 jours'), 'réponse : bonus du jour et palier');
  check((await tuile.locator('.qdj-serie').innerText()).includes('31 jours'), 'réponse : série passée à 31 jours');
  check(await p.evaluate(() => document.activeElement?.classList.contains('qdj-result')), 'réponse : le focus va sur le résultat');
  const calls = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_quiz_daily_answer');
  check(calls.length === 1 && calls[0][2].p_response === 'b', 'appel : hg_quiz_daily_answer une fois avec « b »');
  check(p.errs.length === 0, 'accueil : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.screenshot({ path: path.join(SHOTS, 'j4-accueil-apres.png'), fullPage: true });
  await p.ctx.close();

  /* ---------- Page Jeux, onglet « Question du jour » ---------- */
  p = await openPage(browser, { page: 'jeux', hash: '#jour', width: 390, height: 844, init: 'fake-jeux.js', scenario: { jeux: { deja: true } } });
  await p.waitForSelector('#jeux-panel-jour .qdj-choice', { timeout: 6000 }).catch(() => {});
  check((await p.locator('[role="tablist"] [role="tab"]').count()) >= 3, 'Jeux : barre d’onglets (role tablist, au moins trois onglets)');
  check((await p.locator('#jeux-tab-jour').getAttribute('aria-selected')) === 'true', 'Jeux : #jour ouvre l’onglet « Question du jour »');
  check((await p.locator('#jeux-panel-jour .qdj-deja').innerText()).includes('déjà répondu à cette question dans le quiz'), 'déjà jouée : message pour garder sa série');
  check((await p.locator('#jeux-panel-jour .qdj-row').count()) === 10, 'Jeux : classement sur dix lignes');
  await p.click('#jeux-panel-jour [data-tout]');
  check((await p.locator('#jeux-panel-jour .qdj-row').count()) === 12, 'Jeux : « Tout le classement » montre tout');
  check((await p.locator('#jeux-panel-jour .qdj-row.is-me').count()) === 1, 'Jeux : ma ligne mise en avant');
  await p.locator('#jeux-panel-jour .qdj-choice', { hasText: '2023' }).click();
  await p.waitForSelector('#jeux-panel-jour .qdj-result', { timeout: 4000 }).catch(() => {});
  const r2 = await p.locator('#jeux-panel-jour .qdj-result').innerText().catch(() => '');
  check(r2.includes('Raté') && r2.includes('Bonne réponse : 2022'), 'réponse fausse : « Raté » et bonne réponse');
  check(!r2.includes('pour la bonne réponse'), 'déjà jouée : aucun gain du quiz annoncé');
  // Flèches : passer à l'onglet suivant
  // la barre d'onglets est masquée (navigation par le menu) : on envoie la touche sur l'onglet, comme le clavier le ferait
  await p.evaluate(() => document.getElementById('jeux-tab-jour').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  await sleep(300);
  check((await p.locator('#jeux-tab-sutom').getAttribute('aria-selected')) === 'true' && p.url().endsWith('#sutom'), 'onglets : flèche droite → onglet suivant, adresse mise à jour');
  check((await p.locator('.nav-group[data-menu="jeux"] .nav-top').innerText()).includes('Jeux'), 'menu : groupe « Jeux »');
  check((await p.locator('.nav-group[data-menu="jeux"] .nav-menu a[href^="jeux.html#"]').count()) >= 1, 'menu : liens vers les onglets Jeux');
  check((await hscroll(p)) <= 0, 'Jeux 390 px : pas de défilement horizontal');
  check(p.errs.length === 0, 'Jeux : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Sans question ---------- */
  p = await openPage(browser, { page: 'accueil', width: 390, init: 'fake-jeux.js', scenario: { jeux: { vide: true } } });
  await p.waitForSelector('#qdj-home .qdj-card', { timeout: 6000 }).catch(() => {});
  check((await p.locator('#qdj-home').innerText()).includes('Pas de question du jour'), 'sans question : message « Pas de question du jour »');
  await p.ctx.close();

  /* ---------- Admin : calendrier ---------- */
  p = await openPage(browser, { page: 'admin', width: 1280, init: 'fake-jeux.js' });
  await adminSection(p, 'cartes/questions');
  await p.click('#adq-tab-j');
  await p.waitForSelector('.adqj-row', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.adqj-row').count()) === 28, 'admin : calendrier de 28 jours');
  check((await p.locator('.adqj-row.is-past select').count()) === 0, 'admin : jours passés non modifiables');
  const futur = p.locator('.adqj-row').nth(10);
  const jourFutur = await futur.locator('select').getAttribute('data-day');
  await futur.locator('[data-plan]').click();
  await sleep(400);
  const plan = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_quiz_daily_plan');
  check(plan.length === 1 && plan[0][2].p_day === jourFutur && plan[0][2].p_question === null, 'admin : enregistrement d’un jour à venir (tirage automatique)');
  check(p.errs.length === 0, 'admin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
