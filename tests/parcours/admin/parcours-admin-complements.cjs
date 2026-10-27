// Parcours : compléments du panel admin (/pages/admin/admin.html), sur le faux Supabase (fixtures/fake-sb.mjs).
// Couvre : quêtes de la semaine (créer, modifier, activer), défis (modifier, supprimer), réglages du site
// (ajouter, modifier, JSON invalide refusé, clé sensible en lecture seule), pages (créer, modifier, supprimer),
// édition Secret Santa (suppression avec ses données en cascade), vue Matrice des accès, accès en lecture seule pour un
// Staff sans le droit Réglages, fiche membre › Informations (groupes repliables, enregistrement inchangé).
// Les contrôles portent sur l'état du faux (window.__DB), donc sur ce que le client a réellement écrit.
// Lancer : node tests/parcours/admin/parcours-admin-complements.cjs
const { ROOT, check, finish, openPage, adminSection, chromium } = require('../../lib/harness.cjs');

/** Exécute fn dans la page et renvoie son résultat (lecture de la base simulée). */
const db = (p, fn) => p.evaluate(fn);
/** Clique sur le bouton « ok » de la boîte de confirmation modale. */
const confirmOk = async (p) => { // bouton « ok » d'une confirmBox (dialogue modal)
  await p.waitForSelector('dialog[open] button[value="ok"]', { timeout: 5000 });
  await p.click('dialog[open] button[value="ok"]');
  await p.waitForTimeout(300);
};

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  const p = await openPage(browser, { page: 'admin', width: 1280 });
  await adminSection(p, 'fabrique/cartes');

  /* ---------- Quêtes de la semaine (onglet « Quêtes » de la section Cartes) ---------- */
  await adminSection(p, 'fabrique/quetes');
  await p.waitForSelector('#acd-panel .acd-item', { timeout: 5000 });
  check(await p.locator('#acd-panel .acd-item').count() === 5, 'quêtes : les 5 modèles existants sont listés');

  await p.click('[data-act="quest-new"]');
  await p.waitForSelector('#acd-quest-form', { timeout: 5000 });
  await p.fill('#aq-code', 'test_quete');
  await p.fill('#aq-label', 'Trois boosters de test');
  await p.selectOption('#aq-metric', 'boosters_ouverts');
  await p.fill('#aq-target', '3');
  await p.fill('#aq-reward', '25');
  await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
  await p.waitForSelector('dialog.ui-drawer', { state: 'detached', timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(300);
  const created = await db(p, () => window.__DB.hg_card_quests_templates.find((q) => q.code === 'test_quete'));
  check(!!created && created.label === 'Trois boosters de test' && created.target === 3 && created.reward === 25 && created.active === true,
    'quête créée avec libellé, objectif, récompense et active par défaut');
  check(await p.locator('#acd-panel .acd-item').count() === 6, 'la liste affiche la nouvelle quête');

  await p.click('[data-act="quest-edit"][data-id="photo_1"]');
  await p.waitForSelector('#acd-quest-form', { timeout: 5000 });
  check(await p.inputValue('#aq-code') === 'photo_1' && await p.getAttribute('#aq-code', 'readonly') !== null,
    'modification : l\'identifiant est affiché et ne peut pas être changé');
  await p.fill('#aq-label', 'Ajouter deux photos');
  await p.fill('#aq-target', '2');
  await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
  await p.waitForTimeout(400);
  const edited = await db(p, () => window.__DB.hg_card_quests_templates.find((q) => q.code === 'photo_1'));
  check(edited.label === 'Ajouter deux photos' && edited.target === 2, 'quête modifiée (libellé et objectif)');

  await p.click('[data-act="quest-toggle"][data-id="boosters_5"]');
  await p.waitForTimeout(400);
  const toggled = await db(p, () => window.__DB.hg_card_quests_templates.find((q) => q.code === 'boosters_5'));
  check(toggled.active === false, 'quête désactivée depuis la liste');

  /* ---------- Défis du gang ---------- */
  await adminSection(p, 'fabrique/defis');
  await p.waitForSelector('#challenges-root [data-action="adc-edit"]', { timeout: 5000 });
  await p.click('#challenges-root [data-action="adc-edit"]');
  await p.waitForSelector('#adc-title', { timeout: 5000 });
  await p.waitForSelector('dialog.ui-drawer[open]', { timeout: 5000 });
  await p.fill('#adc-title', 'Vingt sorties ce trimestre (modifié)');
  await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
  await p.waitForTimeout(400);
  const ch = await db(p, () => window.__DB.hg_challenges[0]);
  check(ch.title === 'Vingt sorties ce trimestre (modifié)', 'défi modifié (titre enregistré)');

  await p.click('#challenges-root [data-action="adc-del"]');
  await confirmOk(p);
  await p.waitForTimeout(400);
  check((await db(p, () => window.__DB.hg_challenges.length)) === 0, 'défi supprimé après confirmation');
  check(await p.locator('#challenges-root', { hasText: 'Aucun défi' }).count() === 1, 'liste des défis vide après suppression');

  /* ---------- Réglages du site (liste ; modification et ajout dans le tiroir) ---------- */
  await adminSection(p, 'mairie/reglages');
  await p.waitForSelector('#reglages-root [data-key-item="theme"]', { timeout: 5000 });
  // Admin : la clé sensible reste modifiable, mais après une confirmation explicite
  await p.click('#reglages-root [data-key-item="push_vapid_public"] [data-rg-edit]');
  await p.waitForSelector('dialog[open] .rg-form[data-key="push_vapid_public"]', { timeout: 5000 });
  await p.fill('dialog[open] .rg-form[data-key="push_vapid_public"] [name="v"]', 'BOOP_modifie');
  await p.click('dialog[open] button[data-drawer-submit]');
  await p.waitForSelector('dialog[open] button[value="cancel"]', { timeout: 5000 });
  await p.click('dialog[open] button[value="cancel"]');
  await p.waitForTimeout(300);
  check((await db(p, () => window.__DB.hg_settings.find((s) => s.key === 'push_vapid_public').value)) === 'BOOPdSa019_test',
    'clé sensible (admin) : confirmation demandée, annulée sans écriture');
  await p.click('dialog[open] [data-drawer-close]');
  await p.waitForTimeout(300);
  check(await p.locator('#reglages-root [data-key-item="theme"] [data-rg-edit]', { hasText: 'Voir' }).count() === 1
    && await p.locator('#reglages-root [data-key-item="theme"] form').count() === 0,
    'clé gérée ailleurs (theme) : lecture seule dans le tiroir, renvoi vers la section Thème');

  await p.click('#zone-actions [data-rg-add]');
  await p.waitForSelector('#rg-add', { timeout: 5000 });
  await p.fill('#rg-new-key', 'test_reglage');
  await p.fill('#rg-add [name="v"]', 'valeur initiale');
  await p.click('dialog[open] button[data-drawer-submit]');
  await p.waitForSelector('#reglages-root [data-key-item="test_reglage"]', { timeout: 5000 });
  check((await db(p, () => window.__DB.hg_settings.some((s) => s.key === 'test_reglage' && s.value === 'valeur initiale'))),
    'réglage ajouté (type texte)');

  await p.click('#reglages-root [data-key-item="test_reglage"] [data-rg-edit]');
  await p.waitForSelector('dialog[open] .rg-form[data-key="test_reglage"]', { timeout: 5000 });
  await p.fill('dialog[open] .rg-form[data-key="test_reglage"] [name="v"]', 'valeur modifiée');
  await p.click('dialog[open] button[data-drawer-submit]');
  await p.waitForTimeout(400);
  check((await db(p, () => window.__DB.hg_settings.find((s) => s.key === 'test_reglage').value)) === 'valeur modifiée',
    'réglage modifié et enregistré');

  // JSON : une valeur invalide est refusée avant tout envoi (le tiroir reste ouvert)
  await p.click('#zone-actions [data-rg-add]');
  await p.waitForSelector('#rg-add', { timeout: 5000 });
  await p.fill('#rg-new-key', 'test_json');
  await p.selectOption('#rg-new-kind', 'json');
  await p.fill('#rg-add [name="v"]', '{ pas du json');
  await p.click('dialog[open] button[data-drawer-submit]');
  await p.waitForTimeout(200);
  const jsonErr = await p.textContent('#rg-add .form-error');
  check(/JSON invalide/.test(jsonErr) && (await db(p, () => !window.__DB.hg_settings.some((s) => s.key === 'test_json'))),
    'JSON invalide refusé, rien n\'est écrit');
  await p.click('dialog[open] [data-drawer-close]');
  await p.waitForTimeout(300);

  /* ---------- Accès aux pages : créer, modifier, supprimer ---------- */
  await adminSection(p, 'place/acces');
  await p.waitForSelector('#zone-actions [data-pa-new]', { timeout: 5000 });
  await p.click('#zone-actions [data-pa-new]'); // « + Nouvelle page » : en-tête de zone, ouvre le tiroir
  await p.waitForSelector('#pa-pg-form', { timeout: 5000 });
  await p.fill('#pa-pg-slug', 'galerie-test');
  await p.fill('#pa-pg-label', 'Galerie test');
  await p.click('dialog[open] button[type="submit"]'); // bouton du pied du tiroir
  await p.waitForTimeout(500);
  check((await db(p, () => window.__DB.hg_pages.some((x) => x.slug === 'galerie-test' && x.label === 'Galerie test' && x.mode === 'membres'))),
    'page créée (membres, dans le menu par défaut)');
  check(await p.locator('#access-root [data-slug="galerie-test"]').count() === 1, 'la page apparaît dans le tableau');

  await p.click('#access-root [data-pa-edit="galerie-test"]');
  await p.waitForSelector('#pa-pg-form', { timeout: 5000 });
  await p.fill('#pa-pg-label', 'Galerie renommée');
  await p.selectOption('#pa-pg-mode', 'admin'); // membres -> admin : tous les membres perdent l'accès, donc confirmation
  await p.click('dialog[open] button[type="submit"]'); // bouton du pied du tiroir
  await confirmOk(p);
  await p.waitForTimeout(500);
  const pg = await db(p, () => window.__DB.hg_pages.find((x) => x.slug === 'galerie-test'));
  check(pg.label === 'Galerie renommée' && pg.mode === 'admin', 'page modifiée (libellé et accès)');

  await p.click('#access-root [data-pa-edit="galerie-test"]');
  await p.waitForSelector('#pa-pg-form [data-pa-pg-del]', { timeout: 5000 });
  await p.click('#pa-pg-form [data-pa-pg-del]');
  await confirmOk(p);
  await p.waitForTimeout(500);
  check((await db(p, () => !window.__DB.hg_pages.some((x) => x.slug === 'galerie-test'))), 'page supprimée après confirmation');
  check(await p.locator('#access-root [data-slug="galerie-test"]').count() === 0, 'la page a disparu du tableau');

  /* ---------- Secret Santa : suppression d'une édition ---------- */
  // Le détail d'une édition vit à son adresse (#camp/secret-santa/<id>) ; sans identifiant, la zone propose de la choisir
  await adminSection(p, 'camp/secret-santa');
  await p.evaluate(() => { location.hash = 'irl/secret-santa/E25'; });
  await p.waitForSelector('#ss-delete', { timeout: 5000 });
  await p.click('#ss-delete');
  await p.waitForSelector('dialog[open]', { timeout: 5000 });
  const body = await p.textContent('dialog[open]');
  check(/inscrit/.test(body) && /attribution/.test(body) && /messages/.test(body), 'confirmation : le détail des données effacées est affiché');
  await confirmOk(p);
  await p.waitForTimeout(500);
  check((await db(p, () => !window.__DB.hg_ss_editions.some((e) => e.id === 'E25'))), 'édition 2025 supprimée');
  check((await db(p, () => !window.__DB.hg_ss_participants.some((x) => x.edition_id === 'E25'))), 'ses inscrits sont supprimés avec elle');
  check((await db(p, () => window.__DB.hg_ss_editions.some((e) => e.id === 'E24'))), 'l\'édition 2024 est conservée');

  /* ---------- Accès aux pages : vue Matrice (sous-section membres/acces-matrice, setAccessView) ---------- */
  await adminSection(p, 'place/acces-matrice');
  await p.waitForSelector('#access-root .pa-matrix', { timeout: 5000 });
  check(await p.getAttribute('#access-root [data-pa-view="matrice"]', 'aria-pressed') === 'true', 'accès : la sous-section Matrice affiche la matrice (puce de vue à jour)');
  await adminSection(p, 'place/acces');
  await p.waitForSelector('#access-root .pa-table', { timeout: 5000 });
  check(!(await p.isVisible('#access-root .pa-ro')) && !(await p.isDisabled('#access-root [data-pa-mode]')), 'accès : administrateur, mode modifiable, pas de note « lecture seule »');

  /* ---------- Fiche membre › Informations : groupes repliables, un seul formulaire ---------- */
  await p.evaluate(() => { location.hash = 'membres/comptes/00000003-0000-4000-8000-000000000003/infos'; });
  await p.waitForSelector('#acc-panel details.acc-fold', { timeout: 5000 });
  const folds = await p.$$eval('#acc-panel details.acc-fold', (ds) => ds.map((d) => ({ open: d.open, sum: d.querySelector('summary').textContent })));
  check(folds.length > 1 && folds[0].open && folds.slice(1).every((f) => !f.open), `infos : ${folds.length} groupes repliables, seul le premier ouvert`);
  check(folds.every((f) => /champs? remplis?|aucun champ rempli/.test(f.sum)), `infos : résumé « n champs remplis » (${folds[1]?.sum})`);
  await p.click('#acc-panel details.acc-fold:nth-of-type(2) > summary');
  const f2 = p.locator('#acc-panel details.acc-fold:nth-of-type(2) input').first();
  const f2name = await f2.getAttribute('name');
  await f2.fill('Valeur du test');
  check(/1 champ rempli|champs remplis/.test(await p.textContent('#acc-panel details.acc-fold:nth-of-type(2) > summary')), 'infos : le résumé suit la saisie');
  await p.click('#acc-panel form[data-form="infos"] [type="submit"]');
  await p.waitForTimeout(500);
  const info = await db(p, () => (window.__DB.hg_profile_info || []).find((r) => r.user_id === '00000003-0000-4000-8000-000000000003'));
  check(!!info && info.data && info.data[f2name] === 'Valeur du test', `infos : enregistrement inchangé (champ « ${f2name} » d'un groupe replié écrit)`);

  check(!p.errs.length, 'aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- Accès aux pages, Staff « membres » sans « reglages » : mode, menu et ordre en lecture seule ---------- */
  const ps = await openPage(browser, { page: 'admin', width: 1280, scenario: { uid: '00000002-0000-4000-8000-000000000002', staff: ['membres'] } });
  await adminSection(ps, 'membres/acces');
  await ps.waitForSelector('#access-root .pa-table', { timeout: 5000 });
  check(await ps.isVisible('#access-root .pa-ro') && /réservé au droit Réglages/.test(await ps.textContent('#access-root .pa-ro')), 'accès (Staff sans Réglages) : note « lecture seule » affichée');
  check(await ps.isDisabled('#access-root [data-pa-mode]') && await ps.isDisabled('#access-root [data-pa-nav]') && await ps.locator('#access-root .pa-move:not([disabled])').count() === 0,
    'accès (Staff sans Réglages) : mode, menu et ordre désactivés');
  check(!(await ps.isDisabled('#access-root [data-pa-manage]:not([disabled]) >> nth=0')) && await ps.locator('#zone-actions [data-pa-new]').count() === 0,
    'accès (Staff sans Réglages) : « Personnes » reste actif, pas de « + Nouvelle page »');
  check(!ps.errs.length, 'Staff : aucune erreur JS' + (ps.errs.length ? ' (' + ps.errs.join(' | ') + ')' : ''));
  await ps.ctx.close();
  await browser.close();
  finish();
})();
