// Parcours Arène v2 (docs/ARENE.md ; cartes.html#arene, réglages dans admin.html#fabrique/arene).
// Admin : aperçu avec bandeau, accueil (ligue, cote, combats restants, adversaires), attaque d'Alice (5 cartes, résultat,
// cote), historique, classement de saison, règles ; 1280 et 390 px sans défilement horizontal ; captures.
// Membre, Arène fermée : l'Arène actuelle, inchangée. Membre, Arène ouverte : la v2 sans bandeau.
// Panel admin : réglages de l'Arène v2 envoyés, ouverture aux membres, clôture de saison (confirmation).
// Faux : tests/fixtures/fake-sb-arene2.mjs (ajoute les RPC hg_arena_* au faux de l'Arène actuelle).
const { check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');
const path = require('path');

const ME = '11111111-1111-4111-8111-111111111111';
const ALICE = '00000002-0000-4000-8000-000000000002';
const BRUNO = '00000003-0000-4000-8000-000000000003';
const SHOTS = path.join(__dirname, 'shots');

(async () => {
  const browser = await chromium.launch();

  /* ---------- 1. Admin : aperçu v2 (1280 px) ---------- */
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-arene2.mjs', hash: '#arene', width: 1280, height: 900, reducedMotion: 'reduce', scenario: { deck: true } });
  await p.waitForSelector('.ar', { timeout: 6000 }).catch(() => {});
  check(await p.locator('.ar').count() === 1, 'admin : l’Arène v2 s’affiche (classe .ar)');
  check((await p.locator('.ar-banner').innerText().catch(() => '')).includes('Aperçu admin : invisible pour les membres'), 'admin : bandeau « Aperçu admin : invisible pour les membres »');
  check((await p.locator('.ar-ligue').innerText()).includes('Bronze') && (await p.locator('.ar-ligue').innerText()).includes('1000 pts'), 'accueil : ligue Bronze et cote 1000 affichées');
  check((await p.locator('.ar-tab').count()) === 4, 'accueil : quatre onglets (Accueil, Historique, Classement, Règles)');
  check((await p.locator('#cartes-p-arene').innerText()).includes('5 attaques restantes sur 5'), 'accueil : « 5 attaques restantes sur 5 »');
  check((await p.locator('.jb-row5 .hgc').count()) === 5, 'accueil : deck de défense (5 cartes)');
  check(await p.locator(`[data-act="attaquer"][data-id="${ALICE}"]`).isEnabled(), 'adversaire Alice (deck, cote proche) : attaque possible');
  check(await p.locator(`[data-act="attaquer"][data-id="${BRUNO}"]`).isDisabled(), 'adversaire Bruno (sans deck) : attaque désactivée');
  const ordre = await p.locator('.jb-opp-n').allInnerTexts();
  check(ordre.length === 4 && ordre[0].includes('Bruno') && ordre[1].includes('David') && ordre[2].includes('Alice') && ordre[3].includes('Chloé'), 'adversaires proposés : du plus proche au plus loin en cote (Bruno 1000, David 1000, Alice 1180, Chloé 1430)');
  check((await hscroll(p)) <= 0, '1280 px : pas de défilement horizontal (accueil)');
  await p.screenshot({ path: path.join(SHOTS, 'arene-v2-1280.png'), fullPage: true });

  // Attaque d'Alice
  await p.click(`[data-act="attaquer"][data-id="${ALICE}"]`);
  await sleep(150);
  check((await p.locator('.jb-title').innerText()).includes('Attaquer Alice'), 'combat : titre « Attaquer Alice »');
  for (const id of [1, 2, 3, 4, 5]) await p.click(`button.hgc[data-copy="${id}"]`);
  check((await p.locator('.jb-slot.is-full').count()) === 5, 'combat : 5 cartes choisies');
  await p.click('[data-act="lancer"]');
  await p.waitForSelector('.jb-res', { timeout: 4000 }).catch(() => {});
  check((await p.locator('.jb-duel').count()) === 5, 'résultat : 5 duels (écran de l’Arène actuelle, réutilisé)');
  check(/Victoire|Défaite|Égalité/.test(await p.locator('.jb-res .jd-title').innerText()), 'résultat : issue affichée');
  check((await p.locator('.ar-cote').innerText()).includes('Cote : 1000 →'), 'résultat : cote avant → après affichée');
  const calls = (await log(p)).filter((e) => e[1] === 'hg_arena_attack');
  check(calls.length === 1 && JSON.stringify(calls[0][2].p_copies) === '[1,2,3,4,5]', 'attaque : envoyée avec les 5 cartes dans l’ordre');
  // Historique
  await p.click('[data-act="retour"]');
  await sleep(150);
  await p.click('[data-act="onglet"][data-tab="historique"]');
  await p.waitForSelector('.jb-h', { timeout: 3000 }).catch(() => {});
  check((await p.locator('.jb-h').count()) >= 1, 'historique : le combat apparaît');
  check((await p.locator('.jb-h').first().innerText()).includes('Contre la défense de Alice'), 'historique : « Contre la défense de Alice »');
  // Classement de saison
  await p.click('[data-act="onglet"][data-tab="classement"]');
  await p.waitForSelector('.ar-top li', { timeout: 3000 }).catch(() => {});
  check((await p.locator('.ar-top li').count()) >= 3, 'classement : membres classés (au moins 3 avec 3 combats et plus)');
  check((await p.locator('.ar-row.is-me').count()) === 1, 'classement : ma ligne est mise en évidence');
  check((await p.locator('#cartes-p-arene').innerText()).includes('Toi :'), 'classement : rang et cote personnels');
  // Règles
  await p.click('[data-act="onglet"][data-tab="regles"]');
  await sleep(120);
  const regles = await p.locator('#cartes-p-arene').innerText();
  check(regles.includes('Points et ligues') && regles.includes('5 attaques par jour'), 'règles : chiffres du réglage (5 attaques par jour)');
  check(regles.includes('Plafond Arène : 20 ✦ par jour'), 'règles : plafond Arène affiché');
  check((await hscroll(p)) <= 0, '1280 px : pas de défilement horizontal (règles)');
  // Accueil et 390 px
  await p.click('[data-act="onglet"][data-tab="accueil"]');
  await sleep(150);
  await p.setViewportSize({ width: 390, height: 900 });
  await sleep(200);
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal (accueil)');
  await p.screenshot({ path: path.join(SHOTS, 'arene-v2-390.png'), fullPage: true });
  await p.click('[data-act="onglet"][data-tab="classement"]');
  await p.waitForSelector('.ar-top li', { timeout: 3000 }).catch(() => {});
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal (classement)');
  await p.setViewportSize({ width: 360, height: 800 });
  await sleep(150);
  check((await hscroll(p)) <= 0, '360 px : pas de défilement horizontal (classement)');
  check(p.errs.length === 0, 'admin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- 2. Membre, Arène fermée : l'Arène actuelle, inchangée ---------- */
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-arene2.mjs', hash: '#arene', width: 390, height: 900, reducedMotion: 'reduce', scenario: { uid: ALICE, deck: true } });
  await p.waitForSelector('.jb', { timeout: 5000 }).catch(() => {});
  const txt = await p.locator('#cartes-p-arene').innerText();
  check(txt.includes('Arène de cartes') && txt.includes('Membre bat objet'), 'membre (v2 fermée) : l’Arène actuelle s’affiche');
  check(await p.locator('.ar').count() === 0 && await p.locator('.ar-banner').count() === 0, 'membre (v2 fermée) : aucun élément de la v2');
  check((await log(p)).some((e) => e[1] === 'hg_arena_me'), 'membre (v2 fermée) : la v2 a été interrogée et refusée par le serveur');
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal (Arène actuelle)');
  check(p.errs.length === 0, 'membre (v2 fermée) : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- 3. Membre, Arène ouverte : la v2, sans bandeau ---------- */
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-arene2.mjs', hash: '#arene', width: 390, height: 900, reducedMotion: 'reduce', scenario: { uid: ALICE, deck: true, v2Public: true } });
  await p.waitForSelector('.ar', { timeout: 6000 }).catch(() => {});
  check(await p.locator('.ar').count() === 1 && await p.locator('.ar-banner').count() === 0, 'membre (v2 ouverte) : la v2 sans bandeau d’aperçu');
  check(!(await p.locator('.jb-opps').innerText()).includes('Alice'), 'membre (v2 ouverte) : pas de combat contre soi-même dans la liste');
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal (v2 membre)');
  check(p.errs.length === 0, 'membre (v2 ouverte) : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- 4. Panel admin : réglages, ouverture, clôture ---------- */
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-arene2.mjs', width: 1280, height: 900, scenario: { deck: true } });
  await adminSection(p, 'fabrique/arene');
  await p.waitForSelector('#ar-form', { timeout: 6000 }).catch(() => {});
  check(await p.locator('#bt-form').count() === 1, 'panel : réglages de l’Arène actuelle toujours présents');
  check(await p.locator('#ar-form').count() === 1, 'panel : réglages de l’Arène v2 présents');
  check(await p.locator('#ar-v2_public').isEnabled(), 'panel : ouverture aux membres possible pour l’administrateur');
  check(!(await p.locator('#ar-v2_public').isChecked()), 'panel : Arène v2 fermée aux membres par défaut');
  check((await p.locator('.ar-adm-top').innerText()).includes('Aperçu du classement'), 'panel : aperçu du classement');
  await p.fill('#ar-attaques_jour', '6');
  await p.click('#ar-form button[type="submit"]');
  await sleep(300);
  const reg = (await log(p)).filter((e) => e[1] === 'hg_arena_settings_save');
  check(reg.length === 1 && reg[0][2].p.attaques_jour === '6' && reg[0][2].p.v2_public === false, 'panel : réglages envoyés (attaques_jour 6, v2 fermée)');
  await p.click('#ar-cloture');
  await p.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => {});
  check(await p.locator('dialog[open]').count() === 1, 'panel : clôture demande une confirmation');
  await p.locator('dialog[open] button', { hasText: 'Clôturer' }).click();
  await sleep(300);
  check((await log(p)).some((e) => e[1] === 'hg_arena_season_close'), 'panel : clôture envoyée après confirmation');
  check(p.errs.length === 0, 'panel : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
