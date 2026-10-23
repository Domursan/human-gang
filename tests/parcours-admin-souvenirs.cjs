// Parcours admin : section « Souvenirs et photos » (admin.html#vie/souvenirs).
// Liste en colonne 2, détail dans la zone principale ; vues Souvenirs / Photos / Réactions en puces.
// Créer, modifier et supprimer un souvenir ; supprimer une photo d'album ; masquer une réaction.
// Faux Supabase (fixtures/fake-sb.mjs) : le test vérifie ce que le client envoie (journal) et ce qui s'affiche.
// Lancer : node tests/parcours-admin-souvenirs.cjs
const { ROOT, check, finish, openPage, adminSection, log, chromium } = require('./lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const ALICE = '00000002-0000-4000-8000-000000000002';
const TITRE = 'Souvenir de test CI';
const TITRE_MODIFIE = 'Souvenir modifié CI';

/** Clique sur le bouton rouge de confirmation de la boîte de dialogue. */
const dialogOk = (p) => p.click('dialog.hg-dialog[open] .btn-danger');
// Ligne de la liste (colonne 2) portant ce texte
/** Ligne de la colonne liste dont le titre est titre. */
const row = (p, titre) => p.locator('#shell-col .ui-row', { hasText: titre });

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  const p = await openPage(browser, { page: 'admin', width: 1280 });
  await adminSection(p, 'vie/souvenirs');
  await p.waitForSelector('#shell-col .ui-row', { timeout: 5000 }).catch(() => {});
  check(await p.isVisible('#souvenirs'), 'section « Souvenirs et photos » présente');
  check((await p.locator('#shell-col .ui-row').count()) === 3, 'colonne 2 : 3 souvenirs affichés');
  // 5 vues : Souvenirs, Photos, Réactions, Contenus proposés, Ce jour-là (idée S1)
  check((await p.locator('#shell-col .sv-views a').count()) === 5, 'puces des vues : Souvenirs, Photos, Réactions, Contenus proposés, Ce jour-là');
  check((await p.getAttribute('#shell-col .sv-views a[data-view="souvenirs"]', 'aria-current')) === 'true', 'vue Souvenirs active au départ');

  // Créer (depuis la colonne 2)
  await p.click('#sv-new');
  await p.waitForSelector('dialog.hg-dialog[open] #sv-mo-f-title', { timeout: 5000 }).catch(() => {});
  await p.fill('#sv-mo-f-title', TITRE);
  await p.fill('#sv-mo-f-body', 'Créé par le parcours CI.');
  await p.click('dialog.hg-dialog[open] button[type="submit"]');
  await p.waitForFunction(() => !document.querySelector('dialog.hg-dialog[open]'), null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(400);
  let journal = await log(p);
  const ins = journal.find((l) => l[0] === 'insert' && l[1] === 'hg_moments');
  check(!!ins && ins[2].title === TITRE, 'création : insertion envoyée à hg_moments avec le titre saisi');
  check(!!ins && ins[2].created_by === ME, 'création : auteur = administrateur (règle hg_moments_insert)');
  check((await row(p, TITRE).count()) === 1, 'création : le souvenir apparaît dans la liste');
  await p.waitForSelector('#sv-d-head h2', { timeout: 5000 }).catch(() => {});
  check((await p.locator('#sv-d-head h2').textContent()).includes(TITRE), 'création : le nouveau souvenir est ouvert dans la zone principale');

  // Modifier (titre et auteur), depuis l'en-tête du détail
  await row(p, TITRE).click();
  await p.waitForSelector('#sv-d-head', { state: 'visible' });
  await p.locator('#sv-d-head button', { hasText: 'Modifier' }).click();
  await p.waitForSelector('dialog.hg-dialog[open] #sv-mo-f-title', { timeout: 5000 }).catch(() => {});
  await p.fill('#sv-mo-f-title', TITRE_MODIFIE);
  await p.selectOption('#sv-mo-f-author', ALICE);
  await p.click('dialog.hg-dialog[open] button[type="submit"]');
  await p.waitForFunction(() => !document.querySelector('dialog.hg-dialog[open]'), null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(400);
  journal = await log(p);
  const upd = journal.find((l) => l[0] === 'update' && l[1] === 'hg_moments' && l[2]?.title === TITRE_MODIFIE);
  check(!!upd, 'modification : mise à jour envoyée à hg_moments avec le nouveau titre');
  check(!!upd && upd[2].created_by === ALICE, 'modification : auteur changé');
  check((await row(p, TITRE_MODIFIE).count()) === 1, 'modification : la liste affiche le nouveau titre');

  // Supprimer (depuis l'en-tête du détail, avec confirmation)
  await row(p, TITRE_MODIFIE).click();
  await p.waitForSelector('#sv-d-head', { state: 'visible' });
  await p.locator('#sv-d-head button', { hasText: 'Supprimer' }).click();
  await p.waitForSelector('dialog.hg-dialog[open] .btn-danger', { timeout: 5000 }).catch(() => {});
  await dialogOk(p);
  await p.waitForTimeout(400);
  journal = await log(p);
  check(journal.some((l) => l[0] === 'delete' && l[1] === 'hg_moments'), 'suppression : delete envoyé à hg_moments après confirmation');
  check((await row(p, TITRE_MODIFIE).count()) === 0, 'suppression : le souvenir a disparu de la liste');
  check(!/#vie\/souvenirs\/./.test(new URL(p.url()).hash), 'suppression : l\'adresse revient à la liste');

  // Vue Photos : supprimer une photo d'album (fichier puis ligne)
  await p.click('#shell-col .sv-views a[data-view="photos"]');
  await p.waitForSelector('#souvenirs-root .sv-photo', { timeout: 5000 }).catch(() => {});
  check(await p.isVisible('[data-zone="photos"]'), 'vue Photos : la zone Photos est affichée');
  check((await p.locator('#souvenirs-root .sv-photo').count()) === 2, 'vue Photos : 2 photos d\'album affichées');
  const images = await p.$$eval('#souvenirs-root .sv-photo img', (els) => els.length > 0 && els.every((i) => i.loading === 'lazy'));
  check(images, 'photos : miniatures chargées au défilement (loading="lazy")');
  await p.locator('#souvenirs-root .sv-photo').first().locator('[data-sv-act="delete"]').click();
  await p.waitForSelector('dialog.hg-dialog[open] .btn-danger', { timeout: 5000 }).catch(() => {});
  await dialogOk(p);
  await p.waitForTimeout(400);
  journal = await log(p);
  check(journal.some((l) => l[0] === 'remove'), 'photo : fichier retiré du stockage');
  check(journal.some((l) => l[0] === 'delete' && l[1] === 'hg_photos'), 'photo : ligne hg_photos supprimée');
  check((await p.locator('#souvenirs-root .sv-photo').count()) === 1, 'photo : la grille affiche une photo de moins');

  // Vue Réactions : masquer (active = false)
  await p.click('#shell-col .sv-views a[data-view="reactions"]');
  await p.waitForSelector('#souvenirs-root .sv-reaction', { timeout: 5000 }).catch(() => {});
  check((await p.locator('#souvenirs-root .sv-reaction').count()) === 3, 'vue Réactions : 3 réactions actives (la masquée n\'apparaît pas)');
  await p.locator('#souvenirs-root .sv-reaction').first().locator('[data-sv-hide]').click();
  await p.waitForTimeout(400);
  journal = await log(p);
  const hide = journal.find((l) => l[0] === 'update' && l[1] === 'hg_reactions');
  check(!!hide && hide[2]?.active === false, 'réaction : masquée par active = false (hg_reactions)');
  check((await p.locator('#souvenirs-root .sv-reaction').count()) === 2, 'réaction : la liste ne montre plus la réaction masquée');
  check(!(await p.isVisible('#shell-col .sv-col-list')), 'vue Réactions : la liste des souvenirs est masquée dans la colonne 2');

  check(!p.errs.length, 'aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();
  await browser.close();
  finish();
})();
