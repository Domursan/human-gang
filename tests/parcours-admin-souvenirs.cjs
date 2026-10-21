// Parcours admin : section « Souvenirs et photos » (admin.html).
// Créer, modifier et supprimer un souvenir ; supprimer une photo d'album ; masquer une réaction.
// Faux Supabase (fixtures/fake-sb.mjs) : le test vérifie ce que le client envoie (journal) et ce qui s'affiche.
// Lancer : node tests/parcours-admin-souvenirs.cjs
const { ROOT, check, finish, openPage, adminSection, log, chromium } = require('./lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const ALICE = '00000002-0000-4000-8000-000000000002';
const TITRE = 'Souvenir de test CI';
const TITRE_MODIFIE = 'Souvenir modifié CI';

const dialogOk = (p) => p.click('dialog.hg-dialog[open] .btn-danger');

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  const p = await openPage(browser, { page: 'admin', width: 1280 });
  await adminSection(p, 'vie/souvenirs');
  await p.waitForSelector('#souvenirs-root .sv-row', { timeout: 5000 }).catch(() => {});
  check(await p.isVisible('#souvenirs'), 'section « Souvenirs et photos » présente');
  check((await p.locator('#souvenirs-root .sv-row').count()) === 3, 'onglet Souvenirs : 3 souvenirs affichés');

  // Créer
  await p.click('[data-sv-new]');
  await p.waitForSelector('dialog.hg-dialog[open] #sv-mo-f-title', { timeout: 5000 }).catch(() => {});
  await p.fill('#sv-mo-f-title', TITRE);
  await p.fill('#sv-mo-f-body', 'Créé par le parcours CI.');
  await p.click('dialog.hg-dialog[open] button[type="submit"]');
  await p.waitForFunction(() => !document.querySelector('dialog.hg-dialog[open]'), null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(300);
  let journal = await log(p);
  const ins = journal.find((l) => l[0] === 'insert' && l[1] === 'hg_moments');
  check(!!ins && ins[2].title === TITRE, 'création : insertion envoyée à hg_moments avec le titre saisi');
  check(!!ins && ins[2].created_by === ME, 'création : auteur = administrateur (règle hg_moments_insert)');
  check((await p.locator('.sv-row', { hasText: TITRE }).count()) === 1, 'création : le souvenir apparaît dans la liste');

  // Modifier (titre et auteur)
  await p.locator('.sv-row', { hasText: TITRE }).locator('[data-sv-act="edit"]').click();
  await p.waitForSelector('dialog.hg-dialog[open] #sv-mo-f-title', { timeout: 5000 }).catch(() => {});
  await p.fill('#sv-mo-f-title', TITRE_MODIFIE);
  await p.selectOption('#sv-mo-f-author', ALICE);
  await p.click('dialog.hg-dialog[open] button[type="submit"]');
  await p.waitForFunction(() => !document.querySelector('dialog.hg-dialog[open]'), null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(300);
  journal = await log(p);
  const upd = journal.find((l) => l[0] === 'update' && l[1] === 'hg_moments' && l[2]?.title === TITRE_MODIFIE);
  check(!!upd, 'modification : mise à jour envoyée à hg_moments avec le nouveau titre');
  check(!!upd && upd[2].created_by === ALICE, 'modification : auteur changé');
  check((await p.locator('.sv-row', { hasText: TITRE_MODIFIE }).count()) === 1, 'modification : la liste affiche le nouveau titre');

  // Supprimer
  await p.locator('.sv-row', { hasText: TITRE_MODIFIE }).locator('[data-sv-act="delete"]').click();
  await p.waitForSelector('dialog.hg-dialog[open] .btn-danger', { timeout: 5000 }).catch(() => {});
  await dialogOk(p);
  await p.waitForTimeout(400);
  journal = await log(p);
  check(journal.some((l) => l[0] === 'delete' && l[1] === 'hg_moments'), 'suppression : delete envoyé à hg_moments après confirmation');
  check((await p.locator('.sv-row', { hasText: TITRE_MODIFIE }).count()) === 0, 'suppression : le souvenir a disparu de la liste');

  // Photos : supprimer une photo d'album (fichier puis ligne)
  await p.click('[data-sv-tab="photos"]');
  await p.waitForSelector('#souvenirs-root .sv-photo', { timeout: 5000 }).catch(() => {});
  check((await p.locator('#souvenirs-root .sv-photo').count()) === 2, 'onglet Photos : 2 photos d\'album affichées');
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

  // Réactions : masquer (active = false)
  await p.click('[data-sv-tab="reactions"]');
  await p.waitForSelector('#souvenirs-root .sv-reaction', { timeout: 5000 }).catch(() => {});
  check((await p.locator('#souvenirs-root .sv-reaction').count()) === 3, 'onglet Réactions : 3 réactions actives (la masquée n\'apparaît pas)');
  await p.locator('#souvenirs-root .sv-reaction').first().locator('[data-sv-hide]').click();
  await p.waitForTimeout(400);
  journal = await log(p);
  const hide = journal.find((l) => l[0] === 'update' && l[1] === 'hg_reactions');
  check(!!hide && hide[2]?.active === false, 'réaction : masquée par active = false (hg_reactions)');
  check((await p.locator('#souvenirs-root .sv-reaction').count()) === 2, 'réaction : la liste ne montre plus la réaction masquée');

  check(!p.errs.length, 'aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();
  await browser.close();
  finish();
})();
