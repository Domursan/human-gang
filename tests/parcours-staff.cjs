// Parcours : gestion du Staff et accès au panel selon les droits.
// (a) admin : section Staff, ajout d'un membre avec 2 permissions, désactivation avec confirmation.
// (b) Staff { cartes, journal } : admin.html s'ouvre, seules les sections Cartes/Défis/Journal sont visibles,
//     aucune requête vers les RPC et tables des autres sections, ni section Staff, ni mode sans limite.
// (c) membre simple : redirigé hors de admin.html.
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours-staff.cjs
const { ROOT, check, finish, openPage, adminSection, log, chromium } = require('./lib/harness.cjs');

const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const CHLOE = U(4);
const NOTE = 'Test CI staff';

// Appels interdits au Staff { cartes, journal } : RPC et tables des sections qu'il n'a pas.
const RPC_INTERDITS = ['hg_admin_accounts', 'hg_admin_ghosts', 'hg_members', 'hg_staff_list', 'hg_staff_set', 'hg_ghost_create',
  'hg_ghost_invite', 'hg_ghost_merge', 'hg_ghost_suggestions', 'hg_admin_conversations', 'hg_admin_read_conversation',
  'hg_ss_manual_draw', 'hg_ss_draw', 'hg_dyn_leaderboard', 'hg_trade_cancel'];
// hg_badges, hg_user_badges et hg_pages ne sont pas listées : le contrôle des badges et l'accès aux pages
// tournent pour tout membre sur toutes les pages (core/badges.js, core/pages-access.js), hors du panel.
const TABLES_INTERDITES = ['hg_invites', 'hg_invite_links', 'hg_ss_editions', 'hg_ss_participants', 'hg_ss_exclusions',
  'hg_ss_assignments', 'hg_dyn_events', 'hg_ideas', 'hg_support', 'hg_messages',
  'hg_conversations', 'hg_bot_log', 'hg_page_access', 'hg_profile_info'];

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* (a) Administrateur */
  {
    const p = await openPage(browser, { page: 'admin' });
    // Rail : lien Staff (administrateur) -> section Staff ; compte et mode sans limite dans le rail
    await p.click('#shell-foot a[href="#pilotage/staff"]');
    await p.waitForSelector('#staff', { state: 'visible', timeout: 5000 }).catch(() => {});
    check(await p.isVisible('#staff'), '(a) admin : section Staff visible (lien du rail)');
    check(await p.isVisible('#shell-avatar') && await p.isVisible('#shell-foot a[href="#pilotage/staff"]'), '(a) admin : compte et lien Staff dans le rail');
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
    // Colonne 2 : la liste se met à jour ; la fiche de Chloé s'ouvre (URL #pilotage/staff/<uid>)
    await p.waitForSelector('#shell-col-list .ui-row:has-text("Chloé")', { timeout: 5000 }).catch(() => {});
    check(await p.locator('#shell-col-list .ui-row', { hasText: 'Chloé' }).count() === 1, '(a) la liste se met à jour : Chloé apparaît dans le Staff');
    check((await p.evaluate(() => location.hash)) === '#pilotage/staff/' + CHLOE, '(a) après ajout : la fiche de Chloé est ouverte (URL)');
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
    const domaines = await p.$$eval('#shell-rail .shell-dom', (as) => as.map((a) => a.dataset.dom));
    check(JSON.stringify(domaines) === JSON.stringify(['pilotage', 'cartes']), `(b) Staff : domaines = ${domaines.join(', ')}`);
    const attendu = ['journal', 'series', 'cartes', 'quetes', 'economie', 'joueurs', 'stats', 'echanges', 'defis'];
    const subs = await p.$$eval('#shell-subs .shell-sub', (as) => as.map((a) => a.dataset.sub));
    check(JSON.stringify(subs) === JSON.stringify(attendu), `(b) Staff : sous-sections = ${subs.join(', ')}`);
    const sections = await p.$$eval('.admin-section', (ss) => ss.filter((s) => !s.hidden).map((s) => s.id));
    check(JSON.stringify(sections.sort()) === JSON.stringify(['cartes', 'defis', 'journal']), `(b) Staff : sections permises = ${sections.join(', ')}`);
    check(await p.isVisible('#journal'), '(b) Staff : Journal affiché (première sous-section permise)');
    await p.click('#shell-rail .shell-dom[data-dom="cartes"]');
    await p.waitForSelector('#cartes', { state: 'visible', timeout: 5000 }).catch(() => {});
    check(await p.isVisible('#cartes') && !(await p.isVisible('#journal')), '(b) Staff : Jeu de cartes affiché');
    check(!(await p.isVisible('#staff')), '(b) Staff : pas de section Staff');
    check(await p.locator('[data-staff-add]').count() === 0, '(b) Staff : pas de bouton d’ajout au Staff');
    check(await p.locator('.god-card').count() === 0 && !(await p.isVisible('#shell-god')), '(b) Staff : pas de mode sans limite');
    check((await p.textContent('#stats')).includes('Aucun indicateur'), '(b) Staff : aucune tuile d’aperçu hors de ses droits');
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
    check(await p.locator('#shell-rail, #shell-foot a[href="#pilotage/staff"]').count() === 0, '(c) membre simple : ni rail du panel ni lien Staff');
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
