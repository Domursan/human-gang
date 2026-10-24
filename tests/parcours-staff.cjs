// Parcours : gestion du Staff et accès au panel selon les droits.
// (a) admin : section Staff, ajout d'un membre avec 2 permissions, désactivation avec confirmation.
// (b) Staff { cartes, journal } : admin.html s'ouvre, seules les sections Cartes/Défis/Journal sont visibles,
//     aucune requête vers les RPC et tables des autres sections, ni section Staff, ni mode sans limite.
// (c) membre simple : redirigé hors de admin.html.
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours-staff.cjs
const { ROOT, check, finish, openPage, log, chromium } = require('./lib/harness.cjs');

/* ---------- Aides de test ---------- */
/** Identifiant de test du membre n (U(2) = Alice, comme dans le faux client). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const CHLOE = U(4);
const NOTE = 'Test CI staff';

// Appels interdits au Staff { cartes, journal } : RPC et tables des sections qu'il n'a pas.
const RPC_INTERDITS = ['hg_admin_accounts', 'hg_admin_ghosts', 'hg_members', 'hg_staff_list', 'hg_staff_set', 'hg_ghost_create',
  'hg_ghost_invite', 'hg_ghost_merge', 'hg_ghost_suggestions', 'hg_admin_conversations', 'hg_admin_read_conversation',
  'hg_admin_conversation_info', 'hg_admin_message_remove',
  'hg_ss_manual_draw', 'hg_ss_draw', 'hg_dyn_leaderboard', 'hg_trade_cancel'];
// hg_badges, hg_user_badges et hg_pages ne sont pas listées : le contrôle des badges et l'accès aux pages
// tournent pour tout membre sur toutes les pages (core/badges.js, core/pages-access.js), hors du panel.
const TABLES_INTERDITES = ['hg_invites', 'hg_invite_links', 'hg_ss_editions', 'hg_ss_participants', 'hg_ss_exclusions',
  'hg_ss_assignments', 'hg_dyn_events', 'hg_ideas', 'hg_support', 'hg_messages',
  'hg_conversations', 'hg_bot_log', 'hg_page_access', 'hg_profile_info'];

/* ---------- Scénario ---------- */
(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* (a) Administrateur */
  {
    // Départ sur la section Staff (et non sur la Vue d’ensemble, où le rail est masqué : admin-accueil.css)
    const p = await openPage(browser, { page: 'admin', hash: '#mairie/staff' });
    // Rail : lien Staff (administrateur) -> section Staff ; compte et mode sans limite dans le rail
    await p.evaluate((h) => { location.hash = h; }, '#mairie/staff');
    await p.waitForSelector('#staff', { state: 'visible', timeout: 5000 }).catch(() => {});
    check(await p.isVisible('#staff'), '(a) admin : section Staff visible (lien du rail)');
    check(await p.isVisible('#shell-avatar') && await p.isVisible('#shell-top'), '(a) admin : compte dans l’en-tête unique');
    check(await p.isVisible('#shell-god') && (await p.getAttribute('#shell-god', 'aria-pressed')) === 'false', '(a) admin : mode sans limite visible (rail)');
    await p.click('[data-staff-add]');
    await p.waitForSelector('#staff-dialog[open]', { timeout: 5000 });
    await p.waitForSelector('.staff-pick', { timeout: 5000 });
    check(await p.$eval('.staff-pick:has-text("Ethan")', () => true).catch(() => false) === false, '(a) l’admin n’est pas proposé à l’ajout');
    await p.click(`.staff-pick:has-text("Chloé")`);
    await p.check('input[name="perm"][value="cartes"]');
    await p.check('input[name="perm"][value="badges"]');
    await p.fill('#staff-note', NOTE);
    await p.click('#staff-dialog button[type="submit"]');
    await p.waitForFunction(() => !document.querySelector('#staff-dialog').open, null, { timeout: 5000 }).catch(() => {});
    // Colonne 2 : la liste se met à jour ; la fiche de Chloé s'ouvre (URL #mairie/staff/<uid>)
    await p.waitForSelector('#shell-col-list .ui-row:has-text("Chloé")', { timeout: 5000 }).catch(() => {});
    check(await p.locator('#shell-col-list .ui-row', { hasText: 'Chloé' }).count() === 1, '(a) la liste se met à jour : Chloé apparaît dans le Staff');
    check((await p.evaluate(() => location.hash)) === '#mairie/staff/' + CHLOE, '(a) après ajout : la fiche de Chloé est ouverte (URL)');
    check(await p.locator('#staff input[data-perm-key]:checked').count() === 2, '(a) Chloé a deux permissions cochées dans sa fiche');
    check((await p.textContent('#staff .stf-note')).includes(NOTE), '(a) la note est affichée dans la fiche');
    let journal = await log(p);
    const add = journal.find((l) => l[0] === 'rpc' && l[1] === 'hg_staff_set');
    check(!!add && add[2].p_user === CHLOE && add[2].p_active === true && add[2].p_perms.includes('cartes') && add[2].p_perms.includes('badges'),
      '(a) hg_staff_set envoyé avec le membre et ses 2 permissions');

    await p.click('#staff .ui-btn:has-text("Désactiver")');
    await p.waitForSelector('dialog.hg-dialog[open]', { timeout: 5000 });
    check(await p.isVisible('dialog.hg-dialog[open]'), '(a) désactivation : confirmation demandée');
    await p.click('dialog.hg-dialog[open] button[value="ok"]');
    await p.waitForSelector('#shell-col-list .ui-row:has-text("Chloé"):has-text("Inactif")', { timeout: 5000 }).catch(() => {});
    check(await p.locator('#shell-col-list .ui-row:has-text("Inactif")', { hasText: 'Chloé' }).count() === 1, '(a) Chloé est marquée inactive sans recharger la page');
    journal = await log(p);
    const off = journal.find((l) => l[0] === 'rpc' && l[1] === 'hg_staff_set' && l[2].p_active === false);
    check(!!off && off[2].p_user === CHLOE, '(a) désactivation envoyée avec p_active = false (pas de suppression)');
    check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (b) Staff { cartes, journal }, membre non admin */
  {
    const p = await openPage(browser, { page: 'admin', scenario: { uid: U(2), staff: ['cartes', 'journal'] } });
    check(p.url().split('#')[0].endsWith('/admin.html'), '(b) Staff : admin.html s’ouvre (pas de redirection)');
    // Navigation : domaines et sous-sections permis seulement (Pilotage : Journal ; Jeu de cartes : ses parties et les Défis)
    await p.evaluate(() => { location.hash = '#plateau'; });
    await p.waitForSelector('.plateau-lieu', { timeout: 5000 }).catch(() => {});
    const domaines = await p.$$eval('.plateau-lieu', (as) => as.map((a) => a.getAttribute('href')));
    check(JSON.stringify(domaines) === JSON.stringify(['#ventes', '#fabrique', '#mairie']), `(b) Staff : lieux sur le plateau = ${domaines.join(' ')}`);
    // ordre de la colonne (Pilotage puis Le jeu de cartes) ; Questions [quiz], Secrets [reglages] et Staff [admin] absents.
    // Le droit « cartes » donne tout le domaine Le jeu de cartes, Arène comprise, et le Planning (PLANNING_PERMS).
    const attendu = ['planning', 'journal', 'gestion', 'series', 'cartes', 'boosters', 'economie', 'tirage', 'recyclage', 'limites', 'quetes', 'defis', 'drops', 'cagnotte', 'champions', 'codes', 'recettes', 'encheres', 'joueurs', 'echanges', 'stats', 'arene'];
    const subs = [];
    for (const lieu of ['#ventes', '#fabrique', '#mairie']) {
      await p.evaluate((h) => { location.hash = h; }, lieu);
      await p.waitForSelector('#lieu-root .lieu-tile', { timeout: 5000 }).catch(() => {});
      subs.push(...(await p.$$eval('#lieu-root .lieu-tile', (as) => as.map((a) => a.dataset.sub))));
    }
    check(JSON.stringify(subs.slice().sort()) === JSON.stringify(attendu.slice().sort()), `(b) Staff : pages des lieux = ${subs.join(', ')}`);
    const sections = await p.$$eval('.admin-section', (ss) => ss.filter((s) => !s.hidden).map((s) => s.id));
    check(JSON.stringify(sections.sort()) === JSON.stringify(['bataille', 'cagnotte', 'cartes', 'cartes-gestion', 'champions', 'defis', 'drops', 'journal', 'planning']), `(b) Staff : sections permises = ${sections.join(', ')}`);
    await p.evaluate((h) => { location.hash = h; }, '#mairie/journal');
    await p.waitForSelector('#journal', { state: 'visible', timeout: 5000 }).catch(() => {});
    check(await p.isVisible('#journal'), '(b) Staff : Journal affiché (sous-section Pilotage › Journal)');
    await p.evaluate((h) => { location.hash = h; }, '#fabrique/gestion');
    await p.waitForSelector('#cartes-gestion', { state: 'visible', timeout: 5000 }).catch(() => {});
    check(await p.isVisible('#cartes-gestion') && !(await p.isVisible('#journal')), '(b) Staff : Jeu de cartes affiché (Gestion globale, première sous-section)');
    await p.evaluate((h) => { location.hash = h; }, '#fabrique/series');
    await p.waitForSelector('#cartes', { state: 'visible', timeout: 5000 }).catch(() => {});
    check(await p.isVisible('#cartes') && !(await p.isVisible('#journal')), '(b) Staff : Jeu de cartes › Séries affiché');
    check(!(await p.isVisible('#staff')), '(b) Staff : pas de section Staff');
    check(await p.locator('[data-staff-add]').count() === 0, '(b) Staff : pas de bouton d’ajout au Staff');
    check(await p.locator('.god-card').count() === 0 && !(await p.isVisible('#shell-god')), '(b) Staff : pas de mode sans limite');
    const journal = await log(p);
    const rpcs = journal.filter((l) => l[0] === 'rpc').map((l) => l[1]);
    const tables = journal.filter((l) => /^(select|insert|update|upsert|delete)$/.test(l[0])).map((l) => l[1]);
    const rpcFuite = RPC_INTERDITS.filter((r) => rpcs.includes(r));
    const tableFuite = TABLES_INTERDITES.filter((t) => tables.includes(t));
    check(rpcFuite.length === 0, `(b) Staff : aucune RPC hors droits${rpcFuite.length ? ' (' + rpcFuite.join(', ') + ')' : ''}`);
    check(tableFuite.length === 0, `(b) Staff : aucune table hors droits${tableFuite.length ? ' (' + tableFuite.join(', ') + ')' : ''}`);
    check(rpcs.includes('hg_my_perms'), '(b) Staff : droits chargés une fois (hg_my_perms)');
    check(rpcs.filter((r) => r === 'hg_my_perms').length === 1, '(b) Staff : hg_my_perms une seule fois par session');
    check(!p.errs.length, '(b) Staff : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (c) Membre simple */
  {
    const p = await openPage(browser, { page: 'admin', scenario: { uid: U(2) } });
    check(/accueil\.html/.test(p.url()), `(c) membre simple : redirigé hors de admin.html (${p.url().replace(/^.*hg\.test/, '')})`);
    check(await p.locator('#shell-rail, #shell-top').count() === 0, '(c) membre simple : ni en-tête du panel ni rail');
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
