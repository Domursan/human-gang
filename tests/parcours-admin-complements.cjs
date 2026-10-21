// Parcours : compléments du panel admin (admin.html), sur le faux Supabase (fixtures/fake-sb.mjs).
// Couvre : quêtes de la semaine (créer, modifier, activer), défis (modifier, supprimer), réglages du site
// (ajouter, modifier, JSON invalide refusé, clé sensible en lecture seule), pages (créer, modifier, supprimer),
// édition Secret Santa (suppression avec ses données en cascade).
// Les contrôles portent sur l'état du faux (window.__DB), donc sur ce que le client a réellement écrit.
// Lancer : node tests/parcours-admin-complements.cjs
const { ROOT, check, finish, openPage, chromium } = require('./lib/harness.cjs');

// Ouvre une sous-section du panel (route #domaine/sous-section) et attend que sa section soit affichée.
async function goto(p, hash, sel) {
  await p.evaluate((h) => { location.hash = h; }, hash);
  await p.waitForFunction((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel, { timeout: 5000 }).catch(() => {});
}

const db = (p, fn) => p.evaluate(fn);
const confirmOk = async (p) => { // bouton « ok » d'une confirmBox (dialogue modal)
  await p.waitForSelector('dialog[open] button[value="ok"]', { timeout: 5000 });
  await p.click('dialog[open] button[value="ok"]');
  await p.waitForTimeout(300);
};

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  const p = await openPage(browser, { page: 'admin', width: 1280 });

  /* ---------- Quêtes de la semaine (onglet « Quêtes » de la section Cartes) ---------- */
  await goto(p, '#cartes/quetes', '#cartes');
  await p.waitForSelector('#acd-panel .acd-item', { timeout: 5000 });
  check(await p.locator('#acd-panel .acd-item').count() === 5, 'quêtes : les 5 modèles existants sont listés');

  await p.click('[data-act="quest-new"]');
  await p.waitForSelector('#acd-quest-form', { timeout: 5000 });
  await p.fill('#aq-code', 'test_quete');
  await p.fill('#aq-label', 'Trois boosters de test');
  await p.selectOption('#aq-metric', 'boosters_ouverts');
  await p.fill('#aq-target', '3');
  await p.fill('#aq-reward', '25');
  await p.click('#acd-quest-form button[type="submit"]');
  await p.waitForSelector('#acd-quest-form', { state: 'detached', timeout: 5000 }).catch(() => {});
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
  await p.click('#acd-quest-form button[type="submit"]');
  await p.waitForTimeout(400);
  const edited = await db(p, () => window.__DB.hg_card_quests_templates.find((q) => q.code === 'photo_1'));
  check(edited.label === 'Ajouter deux photos' && edited.target === 2, 'quête modifiée (libellé et objectif)');

  await p.click('[data-act="quest-toggle"][data-id="boosters_5"]');
  await p.waitForTimeout(400);
  const toggled = await db(p, () => window.__DB.hg_card_quests_templates.find((q) => q.code === 'boosters_5'));
  check(toggled.active === false, 'quête désactivée depuis la liste');

  /* ---------- Défis du gang ---------- */
  await goto(p, '#cartes/defis', '#defis');
  await p.waitForSelector('#challenges-root [data-action="adc-edit"]', { timeout: 5000 });
  await p.click('#challenges-root [data-action="adc-edit"]');
  await p.waitForSelector('#adc-title', { timeout: 5000 });
  await p.fill('#adc-title', 'Vingt sorties ce trimestre (modifié)');
  await p.click('#adc-save');
  await p.waitForTimeout(400);
  const ch = await db(p, () => window.__DB.hg_challenges[0]);
  check(ch.title === 'Vingt sorties ce trimestre (modifié)', 'défi modifié (titre enregistré)');

  await p.click('#challenges-root [data-action="adc-del"]');
  await confirmOk(p);
  await p.waitForTimeout(400);
  check((await db(p, () => window.__DB.hg_challenges.length)) === 0, 'défi supprimé après confirmation');
  check(await p.locator('#challenges-root', { hasText: 'Aucun défi' }).count() === 1, 'liste des défis vide après suppression');

  /* ---------- Réglages du site ---------- */
  await goto(p, '#site/reglages', '#reglages');
  await p.waitForSelector('#reglages-root [data-key-item="theme"]', { timeout: 5000 });
  // Admin : la clé sensible reste modifiable, mais après une confirmation explicite
  await p.fill('.rg-form[data-key="push_vapid_public"] [name="v"]', 'BOOP_modifie');
  await p.click('.rg-form[data-key="push_vapid_public"] button[type="submit"]');
  await p.waitForSelector('dialog[open] button[value="cancel"]', { timeout: 5000 });
  await p.click('dialog[open] button[value="cancel"]');
  await p.waitForTimeout(300);
  check((await db(p, () => window.__DB.hg_settings.find((s) => s.key === 'push_vapid_public').value)) === 'BOOPdSa019_test',
    'clé sensible (admin) : confirmation demandée, annulée sans écriture');
  check(await p.locator('#reglages-root [data-key-item="theme"] form').count() === 0,
    'clé gérée ailleurs (theme) : lecture seule avec renvoi vers la section Thème');

  await p.fill('#rg-new-key', 'test_reglage');
  await p.fill('#rg-add [name="v"]', 'valeur initiale');
  await p.click('#rg-add button[type="submit"]');
  await p.waitForSelector('.rg-form[data-key="test_reglage"]', { timeout: 5000 });
  check((await db(p, () => window.__DB.hg_settings.some((s) => s.key === 'test_reglage' && s.value === 'valeur initiale'))),
    'réglage ajouté (type texte)');

  await p.fill('.rg-form[data-key="test_reglage"] [name="v"]', 'valeur modifiée');
  await p.click('.rg-form[data-key="test_reglage"] button[type="submit"]');
  await p.waitForTimeout(400);
  check((await db(p, () => window.__DB.hg_settings.find((s) => s.key === 'test_reglage').value)) === 'valeur modifiée',
    'réglage modifié et enregistré');

  // JSON : une valeur invalide est refusée avant tout envoi
  await p.fill('#rg-new-key', 'test_json');
  await p.selectOption('#rg-new-kind', 'json');
  await p.fill('#rg-add [name="v"]', '{ pas du json');
  await p.click('#rg-add button[type="submit"]');
  await p.waitForTimeout(200);
  const jsonErr = await p.textContent('#rg-add .form-error');
  check(/JSON invalide/.test(jsonErr) && (await db(p, () => !window.__DB.hg_settings.some((s) => s.key === 'test_json'))),
    'JSON invalide refusé, rien n\'est écrit');

  /* ---------- Accès aux pages : créer, modifier, supprimer ---------- */
  await goto(p, '#membres/acces', '#acces');
  await p.waitForSelector('#access-root [data-pa-new]', { timeout: 5000 });
  await p.click('#access-root [data-pa-new]');
  await p.waitForSelector('#pa-pg-form', { timeout: 5000 });
  await p.fill('#pa-pg-slug', 'galerie-test');
  await p.fill('#pa-pg-label', 'Galerie test');
  await p.click('#pa-pg-form button[type="submit"]');
  await p.waitForTimeout(500);
  check((await db(p, () => window.__DB.hg_pages.some((x) => x.slug === 'galerie-test' && x.label === 'Galerie test' && x.mode === 'membres'))),
    'page créée (membres, dans le menu par défaut)');
  check(await p.locator('#access-root [data-slug="galerie-test"]').count() === 1, 'la page apparaît dans le tableau');

  await p.click('#access-root [data-pa-edit="galerie-test"]');
  await p.waitForSelector('#pa-pg-form', { timeout: 5000 });
  await p.fill('#pa-pg-label', 'Galerie renommée');
  await p.selectOption('#pa-pg-mode', 'admin'); // membres -> admin : tous les membres perdent l'accès, donc confirmation
  await p.click('#pa-pg-form button[type="submit"]');
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
  await goto(p, '#vie/secret-santa', '#secret-santa');
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

  check(!p.errs.length, 'aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();
  await browser.close();
  finish();
})();
