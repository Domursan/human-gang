// Parcours : panel admin, domaine « Vie du gang » (polish : listes et détails, formulaires dans le tiroir).
// (a) Secret Santa 1440 px : éditions en colonne 2, édition choisie par adresse (#camp/secret-santa/<id>), détail
//     (inscrits, tirage, exclusions, vœux, carte, attributions), tiroirs « Nouvelle édition » (verrouillée tant qu'une
//     édition est ouverte), « Modifier » (écrit en base), exclusion ajoutée, tirage annulé puis confirmé (rpc),
//     suppression confirmée (édition 2024 effacée, retour à la liste).
// (b) Événements 1440 px : liste et filtres, détail par adresse, tiroir de création (validation du nom), modification
//     écrite en base, suppression annulée puis confirmée.
// (c) Badges 1440 px : grille avec nombre de détenteurs, tiroir de création (annulé sans écriture, puis créé), tiroir
//     de modification (écrit en base), attribution à un membre.
// (d) Mobile 390 px : sections sans défilement horizontal, tiroir pleine largeur.
// Contrôles sur l'état du faux Supabase (window.__DB, window.__LOG) et aucune erreur console.
// Lancer : node tests/parcours-admin-polish-vie.cjs
const { ROOT, check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('./lib/harness.cjs');

const EV_CIT = 'aaaaaaaa-0000-4000-8000-000000000001';
const EV_FUT = 'aaaaaaaa-0000-4000-8000-000000000003';

/** Exécute fn dans la page avec arg et renvoie son résultat (lecture de la base simulée). */
const db = (p, fn, arg) => p.evaluate(fn, arg);
const drawer = 'dialog.ui-drawer[open]';
/** Nombre de tiroirs présents sur la page. */
const drawerCount = (p) => p.locator('dialog.ui-drawer').count();
// Lignes de la liste affichée (les listes des autres sous-sections restent montées, masquées)
/** Nombre de lignes affichées dans la zone de liste. */
const rowCount = (p) => p.locator('.shell-slot:not([hidden]) .ui-row').count();
const LIST_ROW = '.shell-slot:not([hidden]) .ui-row';
/** Bouton « annuler » du pied du tiroir, puis attente de sa fermeture. */
/** Ferme le tiroir ouvert, en cliquant sur son bouton Fermer. */
async function closeDrawer(p) {
  await p.click(`${drawer} .ui-drawer-foot [data-drawer-close]`);
  await p.waitForFunction(() => !document.querySelector('dialog.ui-drawer'), null, { timeout: 5000 }).catch(() => {});
}
/** Valide le tiroir ouvert (bouton principal), puis attend qu'il se ferme (ou reste ouvert en cas d'erreur). */
/** Clique sur le bouton de validation du tiroir ouvert. */
async function submitDrawer(p) {
  await p.click(`${drawer} [data-drawer-submit]`);
  await p.waitForTimeout(400);
}
/** Confirmation (confirmBox) : « ok » ou « cancel ». */
/** Répond à la boîte de confirmation en saisissant value, puis en validant. */
async function confirmWith(p, value) {
  await p.waitForSelector(`dialog[open] button[value="${value}"]`, { timeout: 5000 });
  await p.click(`dialog[open] button[value="${value}"]`);
  await p.waitForTimeout(300);
}
/** Ouvre une adresse (hash) du panel, puis attend que le sélecteur sel soit affiché. */
async function goto(p, hash, sel) {
  await p.evaluate((h) => { location.hash = h; }, hash);
  await p.waitForSelector(sel, { timeout: 6000 });
  await sleep(200);
}
/** Vrai si le journal contient une écriture sur la table (de type op, si fourni). */
const logHas = (p, table, op) => p.evaluate(([t, o]) => (window.__LOG || []).some((e) => e[1] === t && (!o || e[0] === o)), [table, op]);

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* ---------- (a) Secret Santa, 1440 px ---------- */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: {} });
    await adminSection(p, 'camp/secret-santa');
    check(await rowCount(p) === 2, '(a) colonne 2 : les deux éditions (2025 et 2024)');
    check(await p.locator('#zone-actions [data-ss-act="new"]').count() === 1, '(a) barre de zone : « Nouvelle édition »');
    check(await p.locator('.detail-empty').count() === 1, '(a) sans édition choisie : la zone propose de la choisir');

    await p.click('.shell-slot:not([hidden]) .ui-row[data-id="E25"]');
    await p.waitForSelector('#ss-dhead h2', { timeout: 5000 });
    check(await p.textContent('#ss-dhead h2') === 'Édition 2025', '(a) clic sur une édition : adresse et détail « Édition 2025 »');
    check(await p.evaluate(() => location.hash) === '#camp/secret-santa/E25', '(a) l\'adresse suit l\'édition choisie');
    check(await p.locator('#ss-h-excl').count() === 1 && await p.locator('[data-del-excl]').count() === 1, '(a) détail : une exclusion affichée');
    check(await p.locator('#ss-h-wish').count() === 1, '(a) détail : carte « Vœux » (lecture seule)');
    check(await p.locator('#ss-h-draw').count() === 1 && await p.locator('#ss-draw').count() === 1, '(a) détail : bloc tirage présent');
    check(await p.locator('#ss-card-file').count() === 1, '(a) détail : carte de base et son sélecteur de fichier');

    // Création : le tiroir s'ouvre, s'annule sans écriture ; verrouillé tant que 2025 est ouverte
    await p.click('#zone-actions [data-ss-act="new"]');
    await p.waitForSelector(`${drawer} #ssc-year`, { timeout: 5000 });
    check(await p.isDisabled(`${drawer} [data-drawer-submit]`), '(a) création : verrouillée tant qu\'une édition est ouverte');
    await closeDrawer(p);
    check(await drawerCount(p) === 0, '(a) tiroir « Nouvelle édition » : annulé, fermé');
    check((await db(p, () => window.__DB.hg_ss_editions.length)) === 2, '(a) annulation : aucune édition créée');

    // Modification : le tiroir reprend les valeurs, l'enregistrement écrit en base
    await p.click('#ss-dhead button.ui-btn:has-text("Modifier")');
    await p.waitForSelector(`${drawer} #sse-budget`, { timeout: 5000 });
    await p.fill(`${drawer} #sse-budget`, '25 CHF');
    await submitDrawer(p);
    check(await drawerCount(p) === 0, '(a) modification : tiroir fermé après enregistrement');
    check((await db(p, () => window.__DB.hg_ss_editions.find((e) => e.id === 'E25').budget)) === '25 CHF', '(a) modification : budget écrit en base');
    check((await p.textContent('#ss-dhead .ui-dhead-s')).includes('25 CHF'), '(a) en-tête : budget à jour');

    // Exclusion : tiroir avec deux sélecteurs ; le doublon est refusé sans fermer le tiroir
    await p.click('[data-ss-act="excl-new"]');
    await p.waitForSelector(`${drawer} #ex-a`, { timeout: 5000 });
    await p.selectOption(`${drawer} #ex-a`, { index: 0 });
    await p.selectOption(`${drawer} #ex-b`, { index: 2 });
    const before = await db(p, () => window.__DB.hg_ss_exclusions.length);
    await submitDrawer(p);
    const after = await db(p, () => window.__DB.hg_ss_exclusions.length);
    check(after === before + 1 || (after === before && await drawerCount(p) === 1), '(a) exclusion : ajoutée en base, ou refusée (doublon) tiroir ouvert');
    if (await drawerCount(p)) await closeDrawer(p);

    // Tirage : annulé sans appel, puis confirmé
    await p.click('#ss-draw');
    await confirmWith(p, 'cancel');
    check(!(await logHas(p, 'hg_ss_draw')), '(a) tirage annulé : aucun appel');
    await p.click('#ss-draw');
    await confirmWith(p, 'ok');
    check(await logHas(p, 'hg_ss_draw'), '(a) tirage confirmé : appel du tirage');

    // Suppression : sur l'édition 2024 (terminée) ; la confirmation annulée ne supprime rien
    await goto(p, '#camp/secret-santa/E24', '#ss-delete');
    await p.click('#ss-delete');
    await confirmWith(p, 'cancel');
    check((await db(p, () => window.__DB.hg_ss_editions.some((e) => e.id === 'E24'))), '(a) suppression annulée : l\'édition 2024 est conservée');
    await p.click('#ss-delete');
    await confirmWith(p, 'ok');
    await p.waitForFunction(() => location.hash === '#camp/secret-santa', null, { timeout: 5000 }).catch(() => {});
    check((await db(p, () => !window.__DB.hg_ss_editions.some((e) => e.id === 'E24'))), '(a) suppression confirmée : édition 2024 effacée');
    check(await rowCount(p) === 1, '(a) après suppression : une seule édition dans la liste');

    check(!p.errs.length, '(a) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* ---------- (b) Événements, 1440 px ---------- */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: {} });
    await adminSection(p, 'fete/evenements');
    check(await rowCount(p) === 3, '(b) colonne 2 : les trois événements');
    await p.click('.shell-slot:not([hidden]) .ui-chip[data-filter="future"]');
    check(await rowCount(p) === 1, '(b) filtre « À venir » : un événement');
    await p.click('.shell-slot:not([hidden]) .ui-chip[data-filter="all"]');

    await goto(p, `#fete/evenements/${EV_CIT}`, '#ev-dhead h2');
    check(await p.textContent('#ev-dhead h2') === 'La citrouille d\'Halloween', '(b) adresse d\'un événement : détail affiché');
    await p.waitForFunction(() => document.querySelector('#ev-board')?.textContent && !document.querySelector('#ev-board')?.textContent.includes('Chargement'), null, { timeout: 5000 }).catch(() => {});
    check(!(await p.textContent('#ev-board')).includes('Chargement'), '(b) classement chargé');

    // Création : nom trop court refusé dans le tiroir (il reste ouvert)
    await p.click('#zone-actions [data-ev-act="new"]');
    await p.waitForSelector(`${drawer} #evf-name`, { timeout: 5000 });
    await p.fill(`${drawer} #evf-name`, 'A');
    await submitDrawer(p);
    check(/nom/.test(await p.textContent(`${drawer} .form-error`)), '(b) création : nom trop court refusé, tiroir ouvert');
    await closeDrawer(p);
    check((await db(p, () => window.__DB.hg_dyn_events.length)) === 3, '(b) création annulée : aucun événement ajouté');

    // Modification : écrite en base
    await p.click('#ev-dhead button.ui-btn:has-text("Modifier")');
    await p.waitForSelector(`${drawer} #evf-desc`, { timeout: 5000 });
    await p.fill(`${drawer} #evf-desc`, 'Description révisée par le test.');
    await submitDrawer(p);
    check(await drawerCount(p) === 0, '(b) modification : tiroir fermé après enregistrement');
    check((await db(p, (id) => window.__DB.hg_dyn_events.find((e) => e.id === id).description, EV_CIT)) === 'Description révisée par le test.', '(b) modification : description écrite en base');

    // Suppression de l'événement à venir : annulée puis confirmée
    await goto(p, `#fete/evenements/${EV_FUT}`, '#ev-dhead h2');
    await p.click('[data-ev-act="delete"]');
    await confirmWith(p, 'cancel');
    check((await db(p, () => window.__DB.hg_dyn_events.length)) === 3, '(b) suppression annulée : rien n\'est effacé');
    await p.click('[data-ev-act="delete"]');
    await confirmWith(p, 'ok');
    await p.waitForTimeout(400);
    check((await db(p, () => window.__DB.hg_dyn_events.length)) === 2, '(b) suppression confirmée : événement effacé');

    check(!p.errs.length, '(b) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* ---------- (c) Badges, 1440 px ---------- */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: {} });
    await adminSection(p, 'place/badges');
    const cards = await p.locator('#badge-grid .badge-card').count();
    const total = await db(p, () => window.__DB.hg_badges.length);
    check(cards >= 9 && cards < total && await p.isVisible('#badge-more-btn'), `(c) grille : une page de badges (${cards} sur ${total}) et « Afficher plus »`);
    await p.click('#badge-more-btn');
    const cards2 = await p.locator('#badge-grid .badge-card').count();
    check(cards2 > cards, `(c) « Afficher plus » ajoute des badges (${cards2})`);
    check(await p.locator('#badge-grid .badge-card .badge-holders .pill').first().count() === 1, '(c) chaque badge affiche son nombre de détenteurs');
    check(await p.locator('#zone-actions #badge-new').count() === 1, '(c) barre de zone : « Nouveau badge »');

    // Création annulée : aucune écriture
    const nBefore = await db(p, () => window.__DB.hg_badges.length);
    await p.click('#badge-new');
    await p.waitForSelector(`${drawer} #bdg-name`, { timeout: 5000 });
    await p.fill(`${drawer} #bdg-name`, 'Badge de test');
    check(await p.inputValue(`${drawer} #bdg-code`) === 'badge_de_test', '(c) création : code proposé depuis le nom');
    await closeDrawer(p);
    check((await db(p, () => window.__DB.hg_badges.length)) === nBefore, '(c) création annulée : aucun badge ajouté');

    // Création validée
    await p.click('#badge-new');
    await p.waitForSelector(`${drawer} #bdg-name`, { timeout: 5000 });
    await p.fill(`${drawer} #bdg-name`, 'Badge de test');
    await p.fill(`${drawer} #bdg-desc`, 'Obtenu par le test de parcours.');
    await submitDrawer(p);
    check((await db(p, () => window.__DB.hg_badges.length)) === nBefore + 1, '(c) création validée : badge écrit en base');
    check(await drawerCount(p) === 0, '(c) création validée : tiroir fermé');

    // Modification : tiroir pré-rempli, enregistrement écrit en base
    await p.fill('#badge-search', 'citrouille'); // recherche : tous les résultats sont affichés
    await p.waitForSelector('#badge-grid [data-badge-edit="citrouille"]', { timeout: 5000 });
    await p.click('#badge-grid [data-badge-edit="citrouille"]');
    await p.waitForSelector(`${drawer} #bdg-name`, { timeout: 5000 });
    check(await p.inputValue(`${drawer} #bdg-code`) === 'citrouille', '(c) modification : code non modifiable, tiroir pré-rempli');
    await p.fill(`${drawer} #bdg-name`, 'Citrouille révisée');
    await submitDrawer(p);
    check((await db(p, () => window.__DB.hg_badges.find((b) => b.code === 'citrouille').name)) === 'Citrouille révisée', '(c) modification : nom écrit en base');

    // Attribution (partie « Attribution » des badges) : un membre, un badge à la main
    await adminSection(p, 'place/badges-attribution');
    await p.selectOption('#badge-member', { index: 1 });
    await p.waitForSelector('#badge-toggles [data-toggle-badge]', { timeout: 5000 });
    check(await p.locator('#badge-toggles [data-toggle-badge]').count() > 0, '(c) attribution : les badges du membre sont proposés');

    check(!p.errs.length, '(c) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* ---------- (d) Mobile 390 px ---------- */
  {
    const p = await openPage(browser, { page: 'admin', width: 390, height: 844, scenario: {} });
    // Mobile : la liste occupe l'écran tant qu'aucun élément n'est choisi ; le détail a un retour « Liste »
    const pages = [
      ['#camp/secret-santa', LIST_ROW],
      ['#camp/secret-santa/E25', '#ss-dhead h2'],
      ['#fete/evenements', LIST_ROW],
      ['#fete/evenements/' + EV_CIT, '#ev-dhead h2'],
      ['#place/badges', '#badge-grid .badge-card'],
    ];
    for (const [hash, sel] of pages) {
      await goto(p, hash, sel);
      check(await hscroll(p) === 0, `(d) 390 px : ${hash} sans défilement horizontal`);
    }
    await goto(p, '#place/badges', '#badge-grid .badge-card');
    await p.click('#badge-new');
    await p.waitForSelector(`${drawer} #bdg-name`, { timeout: 5000 });
    const w = await p.evaluate(() => document.querySelector('dialog.ui-drawer[open]').getBoundingClientRect().width);
    check(w >= 380, `(d) 390 px : le tiroir prend la largeur de l'écran (${Math.round(w)} px)`);
    check(await hscroll(p) === 0, '(d) 390 px : tiroir ouvert sans défilement horizontal');
    await closeDrawer(p);
    check(!p.errs.length, '(d) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})().catch((err) => { console.error(err); process.exitCode = 1; });
