// Parcours : idée S3 « Ludothèque du gang » (ludotheque.html, fiche-jeu.html?slug=…) et section admin « Ludothèque ».
// Grille par type ; fiche avec onglets ARIA (flèches), prochaine session (Je viens / Peut-être, .ics), proposer une session,
// « Qui y joue » (se déclarer), règles maison en markdown limité et échappé, liens publics et zone privée,
// admin : créer et modifier une fiche (hg_ludo_save). 360 px sans défilement horizontal.
// Faux Supabase : fixtures/fake-sb-contenu.mjs.  Lancer : node tests/parcours-s3-ludotheque.cjs
const { check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

(async () => {
  const browser = await chromium.launch();
  const F = 'fake-sb-contenu.mjs';
  const rpcs = async (p, fn) => (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === fn);

  /* ---------- Grille ---------- */
  let p = await openPage(browser, { page: 'ludotheque', fixture: F, width: 360 });
  await p.waitForSelector('.ludo-card', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.ludo-card').count()) === 4, 'grille : 4 fiches');
  check((await p.locator('.ludo-sec-h').allInnerTexts()).join('|') === 'Au long cours|Soirées jeux', 'grille : deux sections');
  check((await p.locator('.ludo-card', { hasText: 'Crusader' }).innerText()).includes('2 joueurs'), 'grille : nombre de joueurs');
  check((await p.locator('.ludo-card', { hasText: 'Crusader' }).innerText()).includes('Prochaine session'), 'grille : prochaine session');
  check((await p.locator('.ludo-card svg').count()) === 4, 'grille : icônes dessinées');
  check((await hscroll(p)) <= 0, '360 px : pas de défilement horizontal (grille)');
  check(p.errs.length === 0, 'grille : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Fiche CK3 (390 px) ---------- */
  p = await openPage(browser, { page: 'fiche-jeu', fixture: F, width: 390, hash: '' });
  await p.goto(p.url().replace('fiche-jeu.html', 'fiche-jeu.html?slug=ck3'));
  await p.waitForSelector('.jeu-sess', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.jeu-title').innerText()) === 'Crusader Kings III', 'fiche : titre');
  check((await p.locator('[role="tab"]').count()) === 3 && (await p.locator('[role="tab"][aria-selected="true"]').innerText()) === 'Fiche', 'onglets : 3, « Fiche » choisi');
  check((await p.locator('.jeu-sess').first().innerText()).includes('Session 13'), 'session : petit mot');
  check((await p.locator('.jeu-sess').first().innerText()).includes('1 oui · 1 peut-être'), 'session : réponses');
  check((await p.locator('.jeu-prow').count()) === 2 && (await p.locator('.jeu-prow').first().innerText()).includes('Référent'), 'joueurs : référent en premier');
  check((await p.locator('.jeu-past summary').innerText()).includes('(1)'), 'sessions passées : 1');
  await p.click('.jeu-sess [data-rsvp="oui"]');
  await sleep(300);
  check((await log(p)).some((e) => e[0] === 'upsert' && e[1] === 'hg_ludo_session_rsvps' && e[2].status === 'oui'), 'Je viens : réponse enregistrée');
  check((await p.locator('.jeu-sess [data-rsvp="oui"]').getAttribute('aria-pressed')) === 'true', 'Je viens : bouton pressé');
  check((await p.locator('.jeu-sess').first().innerText()).includes('2 oui'), 'Je viens : 2 oui');
  const dl = p.waitForEvent('download', { timeout: 3000 }).catch(() => null);
  await p.click('.jeu-sess [data-ics]');
  check(!!(await dl), '.ics : fichier téléchargé');
  await p.click('[data-player]');
  await p.selectOption('#jeu-p-l', 'regulier');
  await p.fill('#jeu-p-r', 'duché de Bourgogne');
  await p.click('.jeu-dialog [type=submit]:not([data-quit])');
  await sleep(300);
  check((await log(p)).some((e) => e[0] === 'upsert' && e[1] === 'hg_ludo_players' && e[2].role_label === 'duché de Bourgogne'), 'Je joue aussi : déclaration enregistrée');
  check((await p.locator('.jeu-prow').count()) === 3, 'Je joue aussi : 3 joueurs');
  await p.click('[data-new-session]');
  await p.fill('#jeu-s-n', 'On reprend en 1131');
  await p.click('.jeu-dialog [type=submit]');
  await sleep(300);
  check((await rpcs(p, 'hg_ludo_session_create')).length === 1, 'proposer une session : hg_ludo_session_create');
  check((await p.locator('#jeu-h-later').count()) === 1, 'proposer une session : « Ensuite » apparaît');
  // Onglets au clavier
  await p.locator('[role="tab"][aria-selected="true"]').focus();
  await p.keyboard.press('ArrowRight');
  await sleep(100);
  check((await p.locator('[role="tab"][aria-selected="true"]').innerText()) === 'Règles maison', 'onglets : flèche droite → Règles maison');
  check((await p.locator('.jeu-md strong').innerText()) === 'Un duché', 'règles : gras rendu');
  check((await p.locator('.jeu-md li').count()) === 2 && (await p.locator('.jeu-md em').count()) === 1, 'règles : liste et italique');
  check((await p.locator('.jeu-md img').count()) === 0 && (await p.locator('.jeu-md').innerText()).includes('<img'), 'règles : HTML échappé');
  check((await p.locator('.jeu-rules').innerText()).includes('Versions précédentes (2)'), 'règles : historique des versions');
  await p.click('[data-edit-rules]');
  await p.fill('#jeu-r', '**Nouvelle** règle');
  await p.click('.jeu-dialog [type=submit]');
  await sleep(300);
  check((await rpcs(p, 'hg_ludo_rules_save')).length === 1 && (await p.locator('.jeu-md strong').innerText()) === 'Nouvelle', 'règles : enregistrées (admin)');
  await p.keyboard.press('End');
  await p.locator('[role="tab"][data-tab="liens"]').click();
  await sleep(100);
  check((await p.locator('.jeu-links a[href^="https://ck3.paradoxwikis.com"]').count()) === 1, 'liens : lien public');
  check((await p.locator('.jeu-links code').innerText()) === 'serge1066', 'liens : zone des joueurs');
  await p.click('[data-edit-links]');
  await p.fill('#jeu-l', 'Piège | https://evil.example.com/');
  await p.click('.jeu-dialog [type=submit]');
  await sleep(200);
  check(await p.locator('.jeu-dialog .form-error').isVisible(), 'liens : domaine hors liste blanche refusé (message)');
  await p.keyboard.press('Escape');
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal (fiche)');
  check(p.errs.length === 0, 'fiche : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Fiche inconnue ---------- */
  p = await openPage(browser, { page: 'fiche-jeu', fixture: F });
  await p.goto(p.url().replace('fiche-jeu.html', 'fiche-jeu.html?slug=inconnu'));
  await sleep(600);
  check((await p.locator('#jeu-root').innerText()).includes('n’existe pas'), 'fiche inconnue : message');
  await p.ctx.close();

  /* ---------- Membre non joueur : pas de zone privée, pas d'édition ---------- */
  p = await openPage(browser, { page: 'fiche-jeu', fixture: F, scenario: { uid: '00000005-0000-4000-8000-000000000005', ideesOuvertes: true } });
  await p.evaluate(() => { window.__DB.hg_ludo_private = []; });
  await p.goto(p.url().replace('fiche-jeu.html', 'fiche-jeu.html?slug=minecraft'));
  await p.waitForSelector('.jeu-title', { timeout: 5000 }).catch(() => {});
  await p.locator('[data-tab="liens"]').click();
  check((await p.locator('[data-edit-links]').count()) === 0 && (await p.locator('[data-edit-rules]').count()) === 0, 'membre : pas de bouton de modification');
  await p.ctx.close();

  /* ---------- Admin : Ludothèque ---------- */
  p = await openPage(browser, { page: 'admin', fixture: F });
  await adminSection(p, 'cartes/ludotheque');
  await p.waitForSelector('.aj-row', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.aj-row').count()) === 4, 'admin : 4 fiches');
  await p.click('[data-aj-new]');
  await p.fill('#aj-name', 'Sea of Thieves');
  await p.fill('#aj-slug', 'sea-of-thieves');
  await p.selectOption('#aj-icon', 'navire');
  await p.selectOption('#aj-r0', { label: 'Alice' });
  await p.click('dialog [type=submit]');
  await sleep(300);
  const sv = (await rpcs(p, 'hg_ludo_save')).pop();
  check(sv && sv[2].p.create === true && sv[2].p.icon === 'navire' && sv[2].p.referents.length === 1, 'admin : création (icône, référent)');
  check((await p.locator('.aj-row').count()) === 5, 'admin : 5 fiches');
  await p.locator('[data-aj-edit="minecraft"]').click();
  check((await p.locator('#aj-slug').getAttribute('readonly')) !== null, 'admin : identifiant figé en modification');
  await p.locator('dialog input[name="active"]').uncheck();
  await p.click('dialog [type=submit]');
  await sleep(300);
  check((await rpcs(p, 'hg_ludo_save')).pop()[2].p.active === false, 'admin : retirer une fiche');
  check(p.errs.length === 0, 'admin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Staff sans « ludothèque » : pas de sous-section ---------- */
  p = await openPage(browser, { page: 'admin', fixture: F, scenario: { uid: '00000002-0000-4000-8000-000000000002', staff: ['souvenirs'] } });
  await sleep(300);
  check((await p.locator('.shell-sub[href="#cartes/ludotheque"]').count()) === 0, 'Staff sans « ludothèque » : pas de « Ludothèque »');
  await p.ctx.close();

  await browser.close();
  finish();
})();
