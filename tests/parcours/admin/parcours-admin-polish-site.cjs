// Parcours : finition du panel (option C) — Membres › Invitations et Accès aux pages, Communication › Messagerie
// et Bot Discord, Site › Réglages et Thème. Chaque section ouvre ses formulaires dans le tiroir (openDrawer) :
// ouvrir, annuler (aucune écriture), valider (écriture contrôlée dans le faux client). Puis : messagerie en liste +
// lecture seule (« lecture journalisée »), suppression d'un message avec confirmation ; pas de défilement horizontal
// à 1280 et 390 px ; aucune erreur console. Captures dans scratchpad (qa/polish-site) si SHOTS_DIR est défini.
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours/admin/parcours-admin-polish-site.cjs
const path = require('path');
const fs = require('fs');
const { ROOT, check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('../../lib/harness.cjs');

/* ---------- Aides de test ---------- */
/** Identifiant de test du membre n (U(2) = Alice, U(3) = Bruno, comme dans le faux client). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`; // Alice = U(2), Bruno = U(3) (fixture)
const SHOTS_DIR = process.env.SHOTS_DIR || '';
/** Enregistre une capture d'écran nommée name, si un dossier de captures est défini (SHOTS_DIR). */
const shot = async (p, name) => { if (SHOTS_DIR) { fs.mkdirSync(SHOTS_DIR, { recursive: true }); await p.screenshot({ path: path.join(SHOTS_DIR, name) }); } };
/** Exécute fn dans la page et renvoie son résultat (lecture de la base simulée). */
const db = (p, fn) => p.evaluate(fn);
/** Vrai si une boîte de dialogue est ouverte. */
const dialogOpen = (p) => p.evaluate(() => !!document.querySelector('dialog[open]'));
/** Date ISO d'il y a min minutes. */
const iso = (min) => new Date(Date.now() - min * 60000).toISOString();

// Données de démonstration : deux conversations (une directe, une Secret Santa) et trois messages
const SCN = {
  convs: [
    { id: 'conv-direct', kind: 'direct', members: 'Alice, Bruno', messages: 2, last_message_at: iso(12) },
    { id: 'conv-santa', kind: 'santa', santa: 'Alice', target: 'Bruno', santa_id: U(2), target_id: U(3), edition_year: 2025, messages: 1, last_message_at: iso(60) },
  ],
  messages: [
    { id: 1, conversation_id: 'conv-direct', sender_id: U(2), body: 'Tu viens samedi au chalet ?', created_at: iso(14) },
    { id: 2, conversation_id: 'conv-direct', sender_id: U(3), body: 'Oui, je ramène les cartes.', created_at: iso(12) },
    { id: 3, conversation_id: 'conv-santa', sender_id: U(2), body: 'Un indice : il fait froid.', created_at: iso(60) },
  ],
};

// Ouvre une sous-section par sa route et attend que la liste ou le contenu soit affiché.
/** Ouvre une route du panel admin, puis attend que le sélecteur sel soit affiché. */
async function goto(p, route, sel) {
  await adminSection(p, route);
  await p.waitForFunction((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel, { timeout: 8000 }).catch(() => {});
  await sleep(200);
}
/** Clique sur le bouton de la zone d'actions dont le texte est text. */
const zoneBtn = (p, text) => p.click(`#zone-actions button:has-text("${text}")`, { timeout: 5000 });
/** Clique sur le bouton de validation de la boîte de dialogue ouverte. */
const submitDrawer = (p) => p.click('dialog[open] button[data-drawer-submit]', { timeout: 5000 });
/** Ferme le tiroir ouvert et attend qu'il soit fermé. */
const closeDrawer = async (p) => { await p.click('dialog[open] [data-drawer-close]', { timeout: 5000 }).catch(() => {}); await sleep(300); };

/* ---------- Scénario ---------- */
(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* (a) Membres › Invitations : codes et liens dans des tiroirs (1440 px) */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: SCN });
    await goto(p, 'membres/invitations', '#invite-list');
    check(await p.locator('#zone-actions button').count() >= 2, '(a) Invitations : « + Nouveau code » et « + Nouveau lien » dans l\'en-tête de zone');
    check(await p.locator('#membres form').count() === 0, '(a) Invitations : aucun formulaire déplié dans la section');

    const codesBefore = await db(p, () => window.__DB.hg_invites.length);
    await zoneBtn(p, 'Nouveau code');
    await p.waitForSelector('dialog[open] #invite-count', { timeout: 5000 });
    await closeDrawer(p);
    check(!(await dialogOpen(p)) && (await db(p, () => window.__DB.hg_invites.length)) === codesBefore, '(a) code : tiroir annulé, aucune écriture');

    await zoneBtn(p, 'Nouveau code');
    await p.waitForSelector('dialog[open] #invite-count', { timeout: 5000 });
    await p.selectOption('dialog[open] #invite-count', '3');
    await submitDrawer(p);
    await sleep(500);
    check((await db(p, () => window.__DB.hg_invites.length)) === codesBefore + 3 && !(await dialogOpen(p)), '(a) code : 3 codes générés depuis le tiroir, tiroir fermé');
    check(await p.locator('#invite-list .code').count() >= 3, '(a) code : les codes apparaissent dans la liste');

    await zoneBtn(p, 'Nouveau lien');
    await p.waitForSelector('dialog[open] #il-label', { timeout: 5000 });
    await p.fill('dialog[open] #il-label', 'Soirée test polish');
    await p.fill('dialog[open] #il-max', '5');
    await submitDrawer(p);
    await sleep(500);
    check(await db(p, () => window.__DB.hg_invite_links.some((l) => l.label === 'Soirée test polish' && l.max_codes === 5)), '(a) lien : créé avec libellé et limite depuis le tiroir');
    await shot(p, 'invitations-1440-sombre.png');
    check(await hscroll(p) === 0, '(a) Invitations : pas de défilement horizontal à 1440 px');

    /* Accès aux pages : création en tiroir, matrice sans débordement de la page */
    await goto(p, 'membres/acces', '#access-root');
    await zoneBtn(p, 'Nouvelle page');
    await p.waitForSelector('dialog[open] #pa-pg-slug', { timeout: 5000 });
    await closeDrawer(p);
    check(!(await dialogOpen(p)), '(a) page : tiroir « Nouvelle page » annulé');
    await zoneBtn(p, 'Nouvelle page');
    await p.waitForSelector('dialog[open] #pa-pg-slug', { timeout: 5000 });
    await p.fill('dialog[open] #pa-pg-slug', 'galerie-polish');
    await p.fill('dialog[open] #pa-pg-label', 'Galerie polish');
    await submitDrawer(p);
    await sleep(500);
    check(await db(p, () => window.__DB.hg_pages.some((x) => x.slug === 'galerie-polish' && x.label === 'Galerie polish')), '(a) page : créée depuis le tiroir');
    await p.click('[data-pa-view="matrice"]');
    await sleep(200);
    check(await hscroll(p) === 0, '(a) Accès : la matrice ne fait pas déborder la page à 1280 px');
    check(await p.locator('#access-root .pa-matrix-wrap').count() === 1, '(a) Accès : la matrice défile dans son propre conteneur');
    await shot(p, 'acces-1440-sombre.png');
    check(!p.errs.length, '(a) Invitations et Accès : aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (b) Communication › Messagerie et Bot Discord (1440 px) */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: SCN });
    await goto(p, 'pilotage/messagerie', '#shell-col-list .ui-row');
    check(await p.locator('#shell-col-list .ui-row').count() === 2, '(b) Messagerie : conversations en colonne 2');
    await p.click('#shell-col-list .ui-chip[data-filter="santa"]');
    check(await p.locator('#shell-col-list .ui-row').count() === 1, '(b) Messagerie : filtre « Secret Santa »');
    await p.click('#shell-col-list .ui-chip[data-filter="all"]');
    await p.click('#shell-col-list .ui-row[data-id="conv-direct"]');
    await p.waitForSelector('.ui-thread-log .ui-msg', { timeout: 5000 });
    check(await p.locator('.ui-thread-log .ui-msg').count() === 2, '(b) Messagerie : messages lus dans le fil (createThread)');
    check(await p.locator('.ui-thread textarea:visible').count() === 0, '(b) Messagerie : fil en lecture seule, aucune zone de réponse');
    check(/Lecture journalisée/i.test(await p.textContent('#amsg-thread, #messages-root')), '(b) Messagerie : mention « lecture journalisée »');
    check((await db(p, () => window.__READS || 0)) >= 1, '(b) Messagerie : la lecture passe par la RPC journalisée');
    await shot(p, 'messagerie-1440-sombre.png');

    await p.click('.ui-thread-log [data-row-act="1"]');
    await p.waitForSelector('dialog[open] button[value="ok"]', { timeout: 5000 });
    await p.click('dialog[open] button[value="cancel"]');
    await sleep(300);
    check((await db(p, () => window.__DB.hg_messages.length)) === 3, '(b) Messagerie : suppression annulée, aucun message effacé');
    await p.click('.ui-thread-log [data-row-act="1"]');
    await p.waitForSelector('dialog[open] button[value="ok"]', { timeout: 5000 });
    await p.click('dialog[open] button[value="ok"]');
    await sleep(500);
    check((await db(p, () => window.__DB.hg_messages.some((m) => m.id === 1))) === false, '(b) Messagerie : message supprimé après confirmation');
    check(!p.errs.length, '(b) Messagerie : aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: SCN });
    await goto(p, 'pilotage/bot', '#bot-tablist');
    await p.click('#bot-tab-modeles'); // les messages types sont dans leur sous-onglet
    await p.waitForSelector('#bt-body .bt-item', { timeout: 8000 }).catch(() => {});
    check(await p.locator('#bt-body .bt-item').count() >= 1, '(b) Bot : modèles en liste');
    await p.click('#bt-body .bt-item >> nth=0');
    await p.waitForSelector('dialog[open] #bt-title', { timeout: 5000 });
    check(await p.locator('dialog[open] #bt-preview').count() === 1, '(b) Bot : modèle ouvert dans le tiroir avec aperçu');
    await shot(p, 'bot-modele-1440-sombre.png');
    await closeDrawer(p);
    check(!(await dialogOpen(p)), '(b) Bot : tiroir du modèle fermé');
    check(!p.errs.length, '(b) Bot : aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (c) Site › Réglages et Thème (1440 px, clair) */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: SCN });
    await p.emulateMedia({ colorScheme: 'light' });
    await goto(p, 'pilotage/reglages', '#reglages-root [data-key-item]');
    await zoneBtn(p, 'Nouvelle clé');
    await p.waitForSelector('dialog[open] #rg-new-key', { timeout: 5000 });
    await closeDrawer(p);
    check(!(await dialogOpen(p)), '(c) Réglages : tiroir « Ajouter une clé » annulé');
    await zoneBtn(p, 'Nouvelle clé');
    await p.waitForSelector('dialog[open] #rg-new-key', { timeout: 5000 });
    await p.fill('dialog[open] #rg-new-key', 'polish_test');
    await p.fill('dialog[open] #rg-add [name="v"]', 'ok');
    await submitDrawer(p);
    await sleep(500);
    check(await db(p, () => window.__DB.hg_settings.some((s) => s.key === 'polish_test')), '(c) Réglages : clé ajoutée depuis le tiroir');
    await shot(p, 'reglages-1440-clair.png');
    check(!p.errs.length, '(c) Réglages : aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));

    await goto(p, 'pilotage/theme', '#theme-root');
    const themesBefore = await db(p, () => window.__DB.hg_themes.length);
    await zoneBtn(p, 'Nouveau thème');
    await p.waitForSelector('dialog[open] #th-name', { timeout: 5000 });
    await p.fill('dialog[open] #th-name', 'Thème test');
    await closeDrawer(p);
    check((await db(p, () => window.__DB.hg_themes.length)) === themesBefore && !(await dialogOpen(p)), '(c) Thème : tiroir annulé, aucune écriture');
    await zoneBtn(p, 'Nouveau thème');
    await p.waitForSelector('dialog[open] #th-name', { timeout: 5000 });
    await p.fill('dialog[open] #th-name', 'Thème test');
    await shot(p, 'theme-tiroir-1440-clair.png');
    await submitDrawer(p);
    await sleep(700);
    check(await db(p, () => window.__DB.hg_themes.some((t) => t.name === 'Thème test')) && !(await dialogOpen(p)), '(c) Thème : thème créé depuis le tiroir large');
    check(await hscroll(p) === 0, '(c) Thème : pas de défilement horizontal à 1440 px');
    check(!p.errs.length, '(c) Réglages et Thème : aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (d) Mobile 390 px : pas de défilement horizontal, tiroir pleine largeur */
  {
    const p = await openPage(browser, { page: 'admin', width: 390, height: 844, scenario: SCN });
    await goto(p, 'membres/invitations', '#links-root');
    check(await hscroll(p) === 0, '(d) Invitations 390 px : pas de défilement horizontal');
    await p.click('#zone-actions button:has-text("Nouveau lien")').catch(() => {});
    await p.waitForSelector('dialog[open] #il-label', { timeout: 5000 }).catch(() => {});
    const w = await p.evaluate(() => { const d = document.querySelector('dialog[open]'); return d ? Math.round(d.getBoundingClientRect().width) : 0; });
    check(w >= 385, `(d) tiroir à 390 px : pleine largeur (${w} px)`);
    await shot(p, 'invitations-390-tiroir.png');
    await closeDrawer(p);
    // Mobile : la liste des conversations occupe l'écran (pas de section visible tant qu'aucune conversation n'est choisie)
    await p.evaluate(() => { location.hash = 'pilotage/messagerie'; });
    await p.waitForSelector('#shell-col-list .ui-row', { timeout: 8000 });
    check(await hscroll(p) === 0, '(d) Messagerie 390 px : pas de défilement horizontal (liste)');
    await p.click('#shell-col-list .ui-row >> nth=0');
    await p.waitForSelector('.ui-thread-log .ui-msg', { timeout: 5000 });
    check(await hscroll(p) === 0, '(d) Messagerie 390 px : lecture sans défilement horizontal');
    check(!p.errs.length, '(d) mobile : aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
