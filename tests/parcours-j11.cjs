// Parcours J11 : quêtes à preuve validées par le Staff.
// Membre (cartes.html, onglet Ouverture) : les 2 quêtes à preuve apparaissent avec leur jeu et « Envoyer une preuve » ;
// la fenêtre demande 1 à 3 captures, les envoie dans hg-proofs/<moi>/…, appelle hg_proof_submit ; la quête passe
// « En attente de validation ». Staff (admin.html#fete/preuves) : file, capture agrandie, sa propre preuve non validable,
// refus sans motif impossible, validation au clavier (V). 390 px sans défilement horizontal ; aucune erreur JS.
const { check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

// PNG 1 × 1 (capture factice).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-jeux3.mjs', width: 390, height: 900, scenario: { jeuxBase: 'fake-sb-cartes.mjs', proofQuests: true } });
  await p.waitForSelector('#cartes-quests .cq-item', { timeout: 6000 }).catch(() => {});
  const items = p.locator('#cartes-quests .cq-item', { hasText: 'Minecraft' });
  check((await items.count()) === 1, 'quêtes : la quête à preuve Minecraft est listée');
  check((await items.innerText()).includes('· Minecraft'), 'quêtes : le jeu est indiqué');
  check((await p.locator('[data-action="quest-proof"]').count()) === 2, 'quêtes : 2 boutons « Envoyer une preuve »');
  await p.click('[data-action="quest-proof"][data-code="p_mc_ferme"]');
  await p.waitForSelector('dialog.qp-dialog[open]', { timeout: 3000 }).catch(() => {});
  check(await p.locator('dialog.qp-dialog[open]').isVisible(), 'fenêtre : ouverte');
  check((await p.locator('.qp-dialog').innerText()).includes('Recadre ta capture'), 'fenêtre : rappel « recadre ta capture »');
  await p.click('#qp-send');
  check((await p.locator('#qp-err').innerText()).includes('au moins une capture'), 'fenêtre : envoi sans capture refusé');
  await p.setInputFiles('#qp-files', [{ name: 'ferme.png', mimeType: 'image/png', buffer: PNG }, { name: 'ferme2.png', mimeType: 'image/png', buffer: PNG }]);
  check((await p.locator('.qp-thumb').count()) === 2, 'fenêtre : 2 aperçus');
  await p.fill('#qp-note', '12 fours en ligne');
  await p.check('#qp-share');
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal (fenêtre)');
  await p.screenshot({ path: __dirname + '/shots/j11-envoi.png' });
  await p.click('#qp-send');
  await p.waitForFunction(() => !document.querySelector('dialog.qp-dialog'), null, { timeout: 5000 }).catch(() => {});
  const L = await log(p);
  const ups = L.filter((e) => e[0] === 'upload');
  check(ups.length === 2 && ups.every((u) => /^11111111-1111-4111-8111-111111111111\/[a-z0-9]+\.(webp|jpg|png)$/.test(u[1])), 'envoi : 2 captures dans le dossier du membre');
  const sub = L.find((e) => e[1] === 'hg_proof_submit');
  check(sub && sub[2].p_quest === 'p_mc_ferme' && sub[2].p_paths.length === 2 && sub[2].p_share === true && sub[2].p_note === '12 fours en ligne', 'envoi : hg_proof_submit avec quête, captures, mot et partage');
  await p.waitForFunction(() => document.querySelector('#cartes-quests')?.textContent.includes('En attente de validation'), null, { timeout: 4000 }).catch(() => {});
  check((await p.locator('#cartes-quests').innerText()).includes('En attente de validation'), 'quête : « En attente de validation »');
  check(p.errs.length === 0, 'cartes : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // Staff : file de validation
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-jeux3.mjs', width: 1280, height: 900 });
  await adminSection(p, 'fete/preuves');
  await p.waitForSelector('.pf-item', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.pf-item').count()) === 2, 'file : 2 preuves en attente');
  check((await p.locator('.pf-card').innerText()).includes('Construis une ferme automatique'), 'détail : la 1re preuve est ouverte');
  check((await p.locator('.pf-shot img').count()) === 1 && (await p.locator('.pf-shotb').count()) === 2, 'détail : capture agrandie et 2 captures');
  check((await p.locator('.pf-note').innerText()).includes('12 fours'), 'détail : le mot du membre');
  await p.screenshot({ path: __dirname + '/shots/j11-staff.png' });
  // Sa propre preuve
  await p.click('.pf-item[data-id="pr-2"]');
  check((await p.locator('.pf-own').count()) === 1 && (await p.locator('[data-act="ok"]').count()) === 0, 'sa propre preuve : pas de bouton Valider');
  // Refus sans motif
  await p.click('.pf-item[data-id="pr-1"]');
  await p.selectOption('#pf-motif', '');
  await p.click('[data-act="ko"]');
  await sleep(200);
  check(!(await log(p)).some((e) => e[1] === 'hg_proof_review'), 'refus sans motif : rien n’est envoyé');
  // Validation au clavier
  await p.click('.pf-item[data-id="pr-1"]');
  await p.keyboard.press('v');
  await sleep(500);
  const rv = (await log(p)).find((e) => e[1] === 'hg_proof_review');
  check(rv && rv[2].p_id === 'pr-1' && rv[2].p_ok === true, 'touche V : preuve validée');
  check((await p.locator('.pf-item').count()) === 1, 'file : la preuve validée quitte la file');
  await p.click('.pf-chip[data-status="validee"]');
  await sleep(400);
  check((await p.locator('.pf-card').innerText()).includes('Validée'), 'Validées : la preuve y apparaît');
  check(p.errs.length === 0, 'admin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // Staff « souvenirs » : Framed et Heardle ; Staff « cartes » : Bataille
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-jeux3.mjs', width: 1280, height: 900 });
  await adminSection(p, 'fete/framed-heardle');
  await p.waitForSelector('.jm', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.jm').innerText()).includes('Nope'), 'admin Framed : films listés');
  await p.click('[data-act="f-new"]');
  check(await p.locator('#jm-film-form').isVisible(), 'admin Framed : formulaire d’un nouveau film (6 images)');
  check((await p.locator('#jm-film-form input[type="file"]').count()) === 6, 'admin Framed : 6 emplacements d’image');
  await p.click('[data-part="heardle"]');
  check((await p.locator('.jm').innerText()).includes('Le morceau du RDV'), 'admin Heardle : proposition des membres listée');
  await adminSection(p, 'fabrique/arene');
  await p.waitForSelector('#bt-form', { timeout: 5000 }).catch(() => {});
  check(!(await p.locator('#bt-gains').isChecked()), 'admin Bataille : gains coupés par défaut (bêta)');
  await p.check('#bt-gains');
  await p.click('#bt-form button[type="submit"]');
  await sleep(300);
  const bs = (await log(p)).find((e) => e[1] === 'hg_battle_settings_save');
  check(bs && bs[2].p.gains === true && bs[2].p.bataille_gain === '10', 'admin Bataille : réglages envoyés');
  check(p.errs.length === 0, 'admin jeux : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // Membre sans droit : sous-sections absentes
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-jeux3.mjs', width: 1280, scenario: { uid: '00000002-0000-4000-8000-000000000002', staff: ['quiz'] } });
  check((await p.locator('.shell-sub[href="#fete/preuves"]').count()) === 0, 'Staff sans « preuves » : pas de sous-section Preuves');
  await p.ctx.close();
  await browser.close();
  finish();
})();
