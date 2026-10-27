// Parcours : rôles et accès par rôle (migration 103) dans le panel admin : admin-roles.js, admin-access.js (memberAccessHtml,
// setAccess), admin-accounts/fiche.js (onglet « Accès », bloc « Rôles et accès ») et admin-accounts/events.js.
// Faux Supabase (fixtures/fake-sb.mjs : hg_roles, hg_member_roles, RPC hg_role_save / _remove, hg_member_role_set,
// hg_member_access, hg_member_access_reset ; scénario roles: true = pages des rôles en mode « liste »).
// (a) Membres › Rôles, 1280 px : liste des rôles avec leur nombre de membres ; détail du rôle choisi : pages cochables
//     (mode « liste ») et pages « déjà ouverte à tous » ou « réservée aux admins » ; membres du rôle ; note visible.
//     Ajouter (recherche, « Ajouter ») et retirer un membre appellent hg_member_role_set avec les bons paramètres.
//     Nouveau rôle : identifiant dérivé du libellé ; refus d'un libellé sans lettre ni chiffre, puis d'un nom déjà pris ;
//     création appelle hg_role_save (id, pages cochées, ordre). Modification : hg_role_save avec l'identifiant existant.
//     Suppression après confirmation : hg_role_remove, le rôle quitte la liste.
// (b) IRL › Membres IRL : membres du rôle « irl », « Retirer le rôle », « Ajouter un membre », lien vers Membres › Rôles.
// (c) Fiche d'un membre, onglet « Accès » : puces des rôles (un clic retire), menu « Ajouter le rôle » ; accès page par
//     page avec son origine (via le rôle, réglé à la main, ouverte à tous, aucun) ; interrupteur sur une page donnée par un
//     rôle : écrit une ligne « bloqué » (hg_page_access, allowed false) ; « Revenir au réglage par défaut » appelle
//     hg_member_access_reset.
// (d) 390 px : Membres › Rôles et fiche sans défilement horizontal, cibles ≥ 44 px.
// Captures : tests/shots/admin-roles-1280.png (Rôles), admin-roles-390.png (Rôles, téléphone).
// Lancer : node tests/parcours/admin/parcours-admin-roles.cjs
const fs = require('fs');
const path = require('path');
const { SHOTS, check, finish, openPage, adminSection, hscroll, log, chromium } = require('../../lib/harness.cjs');

/** Identifiant de test du membre n (même format que le faux client : Alice = 2, Bruno = 3, Chloé = 4, David = 5, Emma = 6). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
/** Scénario : rôles de départ (IRL, Secret Santa) ; Alice et Chloé sont IRL, Bruno est IRL et Secret Santa. */
const SCN = {
  roles: true,
  memberRoles: [
    { user_id: U(2), role_id: 'irl' },
    { user_id: U(3), role_id: 'irl' },
    { user_id: U(3), role_id: 'secret-santa' },
    { user_id: U(4), role_id: 'irl' },
  ],
};

/** Attend qu'un sélecteur soit affiché (ou la limite de temps). */
const attendre = (p, sel) => p.waitForSelector(sel, { state: 'visible', timeout: 8000 }).catch(() => {});
/** Textes d'une liste d'éléments, dans l'ordre. */
const textes = (p, sel) => p.$$eval(sel, (xs) => xs.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
/** Vrai si une entrée du journal correspond au prédicat. */
const journal = async (p, pred) => (await log(p)).some(pred);
/** Clique sur le bouton « ok » de la boîte de confirmation. */
const confirmOk = async (p) => { await attendre(p, 'dialog[open] button[value="ok"]'); await p.click('dialog[open] button[value="ok"]'); };
/** Hauteur minimale (px) des éléments d'un sélecteur, ou 0 s'il n'y en a pas. */
const hauteurMin = (p, sel) => p.$$eval(sel, (xs) => (xs.length ? Math.min(...xs.map((x) => x.getBoundingClientRect().height)) : 0));
/** Message du formulaire de rôle (vide si caché). */
const erreurRole = (p) => p.$eval('#roles-root .rl-form .form-error', (e) => (e.hidden ? '' : e.textContent.trim()));

(async () => {
  const browser = await chromium.launch();
  fs.mkdirSync(SHOTS, { recursive: true });
  try {
    /* (a) Membres › Rôles, 1280 px */
    {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: SCN });
      await adminSection(p, 'place/roles');
      await attendre(p, '#roles-root .rl-item');
      check((await textes(p, '#roles-root .rl-item')).length === 2, '(a) deux rôles dans la liste (IRL, Secret Santa)');
      const items = await textes(p, '#roles-root .rl-item-txt');
      check(items[0] === 'IRL3 membres' && items[1] === 'Secret Santa1 membre', '(a) nombre de membres par rôle : IRL 3, Secret Santa 1 (' + items.join(' | ') + ')');
      check(await p.getAttribute('#roles-root .rl-item[data-rl-pick="irl"]', 'aria-pressed') === 'true', '(a) le premier rôle est ouvert par défaut');
      check((await p.textContent('#rl-titre')).trim() === 'IRL', '(a) détail : titre du rôle IRL');
      check((await p.textContent('#roles-root .rl-count')).trim() === '3 membres', '(a) détail : compteur « 3 membres »');
      const cases = await p.$$eval('#roles-root .rl-page input[type="checkbox"]', (xs) => xs.map((x) => [x.value, x.checked]));
      check(cases.length === 3, '(a) cases : seulement les pages en mode « liste » (3) (' + JSON.stringify(cases) + ')');
      check(cases.find(([v]) => v === 'irl')?.[1] === true && cases.find(([v]) => v === 'historique')?.[1] === true && cases.find(([v]) => v === 'secret-santa')?.[1] === false,
        '(a) cases cochées : IRL et Historique, pas Secret Santa');
      const fixes = await textes(p, '#roles-root .rl-page-fixed');
      check(fixes.filter((t) => t.includes('déjà ouverte à tous')).length === 6 && fixes.filter((t) => t.includes('réservée aux admins')).length === 2,
        '(a) pages non cochables : six « déjà ouverte à tous », deux « réservée aux admins »');
      check((await p.textContent('#roles-root')).includes('Un réglage fait à la main sur un membre l’emporte sur ses rôles.'), '(a) note : réglage à la main prioritaire');
      check(JSON.stringify(await textes(p, '#roles-root ul.rl-people:not(.rl-results) .rl-person-name')) === JSON.stringify(['Alice', 'Bruno', 'Chloé']), '(a) membres du rôle IRL, par pseudo');

      // Ajouter un membre : recherche, puis « Ajouter » pour Emma
      await p.click('[data-rl-pick-open]');
      await attendre(p, '#rl-q');
      check(await p.evaluate(() => document.activeElement?.id === 'rl-q'), '(a) « Ajouter un membre » : le focus va sur la recherche');
      check((await textes(p, '#roles-root [data-picker-results] li')).length === 3, '(a) candidats : Ethan, David, Emma (ceux qui n’ont pas le rôle)');
      await p.fill('#rl-q', 'em');
      check(JSON.stringify(await textes(p, '#roles-root [data-picker-results] .rl-person-name')) === JSON.stringify(['Emma']), '(a) recherche « em » : Emma seule');
      await p.click('[data-rl-member-add="' + U(6) + '"]');
      await p.waitForFunction(() => document.querySelectorAll('#roles-root ul.rl-people:not(.rl-results) > li').length === 4, null, { timeout: 8000 }).catch(() => {});
      check(await journal(p, (l) => l[0] === 'rpc' && l[1] === 'hg_member_role_set' && l[2].p_user === U(6) && l[2].p_role === 'irl' && l[2].p_on === true),
        '(a) « Ajouter » : hg_member_role_set(Emma, irl, true)');
      check((await p.textContent('#roles-root .rl-count')).trim() === '4 membres', '(a) compteur mis à jour : 4 membres');
      check(await p.evaluate(() => document.activeElement?.id === 'rl-q'), '(a) après ajout : le focus reste sur la recherche');

      // Retirer un membre : Alice
      await p.click('[data-rl-member-rm="' + U(2) + '"]');
      await p.waitForFunction(() => document.querySelectorAll('#roles-root ul.rl-people:not(.rl-results) > li').length === 3, null, { timeout: 8000 }).catch(() => {});
      check(await journal(p, (l) => l[0] === 'rpc' && l[1] === 'hg_member_role_set' && l[2].p_user === U(2) && l[2].p_role === 'irl' && l[2].p_on === false),
        '(a) « Retirer » : hg_member_role_set(Alice, irl, false)');
      check(!(await textes(p, '#roles-root ul.rl-people:not(.rl-results) .rl-person-name')).includes('Alice'), '(a) Alice ne figure plus parmi les membres du rôle');
      await p.click('[data-rl-pick-open]');

      // Nouveau rôle : validations, puis création
      await p.click('[data-rl-new]');
      await attendre(p, '#rl-label');
      check(await p.evaluate(() => document.activeElement?.id === 'rl-label'), '(a) « Nouveau rôle » : le focus va sur le libellé');
      await p.fill('#rl-label', '!!');
      check((await p.textContent('#rl-id-hint')).trim() === 'Identifiant : à partir du libellé', '(a) nouveau rôle : libellé sans lettre, pas d’identifiant');
      await p.click('[data-rl-form="new"] button[type="submit"]');
      check((await erreurRole(p)).includes('deux lettres ou chiffres'), '(a) libellé « !! » : message d’erreur dans le formulaire');
      check(!(await journal(p, (l) => l[0] === 'rpc' && l[1] === 'hg_role_save')), '(a) libellé refusé : aucun hg_role_save');
      await p.fill('#rl-label', 'IRL');
      await p.click('[data-rl-form="new"] button[type="submit"]');
      check((await erreurRole(p)).includes('Un rôle porte déjà ce nom'), '(a) libellé déjà pris : refusé');
      await p.fill('#rl-label', 'Cinéphile');
      check((await p.textContent('#rl-id-hint')).trim() === 'Identifiant : cinephile', '(a) identifiant dérivé du libellé : « cinephile » (sans accent)');
      await p.fill('#rl-desc', 'Ceux qui vont au ciné-club.');
      await p.check('[data-rl-form="new"] input[value="historique"]');
      await p.click('[data-rl-form="new"] button[type="submit"]');
      await p.waitForFunction(() => document.querySelectorAll('#roles-root .rl-item').length === 3, null, { timeout: 8000 }).catch(() => {});
      const save = (await log(p)).filter((l) => l[0] === 'rpc' && l[1] === 'hg_role_save').pop();
      check(save && save[2].p.id === 'cinephile' && save[2].p.label === 'Cinéphile' && save[2].p.pages.includes('historique') && save[2].p.sort === 3,
        '(a) création : hg_role_save(id cinephile, libellé, pages cochées, ordre 3)');
      check((await p.textContent('#rl-titre')).trim() === 'Cinéphile', '(a) après création : le nouveau rôle est ouvert');
      check(!(await erreurRole(p)), '(a) après création : aucune erreur affichée');

      // Modifier : la description d’IRL
      await p.click('[data-rl-pick="irl"]');
      await attendre(p, '#rl-desc');
      await p.fill('#rl-desc', 'Sorties en vrai.');
      await p.click('[data-rl-form="irl"] button[type="submit"]');
      await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('Rôle enregistré')), null, { timeout: 8000 }).catch(() => {});
      const upd = (await log(p)).filter((l) => l[0] === 'rpc' && l[1] === 'hg_role_save' && l[2].p.id === 'irl').pop();
      check(upd && upd[2].p.description === 'Sorties en vrai.' && upd[2].p.sort === 1, '(a) modification : hg_role_save(irl, nouvelle description, ordre conservé)');

      // Supprimer Secret Santa (confirmation)
      await p.click('[data-rl-pick="secret-santa"]');
      await attendre(p, '[data-rl-delete="secret-santa"]');
      await p.click('[data-rl-delete="secret-santa"]');
      await confirmOk(p);
      await p.waitForFunction(() => document.querySelectorAll('#roles-root .rl-item').length === 2, null, { timeout: 8000 }).catch(() => {});
      check(await journal(p, (l) => l[0] === 'rpc' && l[1] === 'hg_role_remove' && l[2].p_id === 'secret-santa'), '(a) suppression : hg_role_remove(secret-santa) après confirmation');
      check(!(await textes(p, '#roles-root .rl-item-name')).includes('Secret Santa'), '(a) le rôle supprimé quitte la liste');
      check(!(await p.isVisible('[data-rl-delete="secret-santa"]').catch(() => false)), '(a) après suppression : plus de bouton pour ce rôle');
      check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
      check(await hscroll(p) === 0, '(a) pas de défilement horizontal (1280)');
      await p.evaluate(() => document.getElementById('roles-root')?.scrollIntoView({ block: 'start' }));
      await p.screenshot({ path: path.join(SHOTS, 'admin-roles-1280.png') });
    }

    /* (b) IRL › Membres IRL */
    {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: SCN });
      await adminSection(p, 'camp/membres-irl');
      await attendre(p, '#membres-irl-root ul.rl-people:not(.rl-results) > li');
      check(JSON.stringify(await textes(p, '#membres-irl-root ul.rl-people:not(.rl-results) .rl-person-name')) === JSON.stringify(['Alice', 'Bruno', 'Chloé']), '(b) membres du rôle IRL : Alice, Bruno, Chloé');
      const depuis = await textes(p, '#membres-irl-root ul.rl-people:not(.rl-results) .rl-person-txt .small');
      check(depuis.length === 3 && depuis.every((t) => t.startsWith('depuis le ')), '(b) chaque membre : « depuis le … »');
      check(await p.locator('#membres-irl-root a[href="#place/roles"]').count() === 1, '(b) lien vers Membres › Rôles');
      await p.click('[data-rl-member-rm="' + U(4) + '"]');
      await p.waitForFunction(() => document.querySelectorAll('#membres-irl-root ul.rl-people:not(.rl-results) > li').length === 2, null, { timeout: 8000 }).catch(() => {});
      check(await journal(p, (l) => l[0] === 'rpc' && l[1] === 'hg_member_role_set' && l[2].p_user === U(4) && l[2].p_role === 'irl' && l[2].p_on === false),
        '(b) « Retirer le rôle » : hg_member_role_set(Chloé, irl, false)');
      await p.click('[data-rl-pick-open]');
      await p.fill('#irl-q', 'da');
      check(JSON.stringify(await textes(p, '#membres-irl-root [data-picker-results] .rl-person-name')) === JSON.stringify(['David']), '(b) recherche « da » : David');
      await p.click('[data-rl-member-add="' + U(5) + '"]');
      await p.waitForFunction(() => document.querySelectorAll('#membres-irl-root ul.rl-people:not(.rl-results) > li').length === 3, null, { timeout: 8000 }).catch(() => {});
      check(await journal(p, (l) => l[0] === 'rpc' && l[1] === 'hg_member_role_set' && l[2].p_user === U(5) && l[2].p_role === 'irl' && l[2].p_on === true),
        '(b) « Ajouter un membre » : hg_member_role_set(David, irl, true)');
      check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    }

    /* (c) Fiche d'un membre : onglet « Accès », bloc « Rôles et accès » (Bruno : IRL et Secret Santa) */
    {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: SCN });
      await adminSection(p, 'place/roles');
      await p.evaluate((h) => { location.hash = h; }, '#place/comptes/' + U(3) + '/acces');
      await attendre(p, '#acc-panel .ra-block');
      check(await p.locator('#acc-panel .ra-chip').count() === 2, '(c) Bruno : deux puces de rôle (IRL, Secret Santa)');
      check(JSON.stringify(await textes(p, '#acc-panel .ra-chip')) === JSON.stringify(['IRL×', 'Secret Santa×']), '(c) puces : libellés des rôles');
      check((await p.textContent('#acc-panel .ra-roles')).includes('Tous les rôles sont déjà donnés.'), '(c) menu « Ajouter un rôle » : absent, tous les rôles sont donnés');
      const origine = async (slug) => p.$eval(`#acc-panel [data-page-access="${slug}"]`, (el) => el.closest('.pa-member-row').querySelector('.pa-member-txt .small').textContent.trim());
      check((await origine('historique')) === 'Membres choisis · via le rôle IRL', '(c) Historique : origine « via le rôle IRL »');
      check((await origine('secret-santa')) === 'Membres choisis · via le rôle Secret Santa', '(c) Secret Santa : origine « via le rôle Secret Santa »');
      check((await origine('messages')) === 'Tous les membres · ouverte à tous', '(c) Messages : origine « ouverte à tous »');
      check((await origine('cartes')) === 'Admin seulement · réservée aux admins', '(c) Cartes : origine « réservée aux admins »');
      check(await p.locator('#acc-panel [data-access-reset]').count() === 0, '(c) aucun réglage à la main : pas de bouton « Revenir au réglage par défaut »');

      // Interrupteur d'une page donnée par un rôle : une ligne « bloqué » est écrite
      await p.click('#acc-panel label.switch:has([data-page-access="historique"])'); // l'interrupteur visuel reçoit le clic (la case est masquée)
      await p.waitForFunction(() => document.querySelector('#acc-panel [data-page-access="historique"]')?.checked === false, null, { timeout: 8000 }).catch(() => {});
      check(await journal(p, (l) => l[0] === 'upsert' && l[1] === 'hg_page_access' && [].concat(l[2]).some((r) => r.page_slug === 'historique' && r.user_id === U(3) && r.allowed === false)),
        '(c) interrupteur éteint : hg_page_access(historique, Bruno, allowed false), pas de suppression');
      check((await origine('historique')) === 'Membres choisis · réglé à la main', '(c) après réglage : origine « réglé à la main »');
      check(await p.locator('#acc-panel [data-access-reset="historique"]').count() === 1, '(c) réglé à la main : bouton « Revenir au réglage par défaut »');
      check((await p.textContent('#acc-panel')).includes('Pas d’accès'), '(c) la page est fermée à Bruno');

      await p.click('#acc-panel [data-access-reset="historique"]');
      await p.waitForFunction(() => document.querySelector('#acc-panel [data-page-access="historique"]')?.checked === true, null, { timeout: 8000 }).catch(() => {});
      check(await journal(p, (l) => l[0] === 'rpc' && l[1] === 'hg_member_access_reset' && l[2].p_user === U(3) && l[2].p_slug === 'historique'),
        '(c) « Revenir au réglage par défaut » : hg_member_access_reset(Bruno, historique)');
      check((await origine('historique')) === 'Membres choisis · via le rôle IRL', '(c) après le retour : l’accès revient au rôle IRL');

      // Retirer la puce IRL : Historique et Calendrier n’ont plus d’origine
      await p.click('#acc-panel [data-role-remove="irl"]');
      await p.waitForFunction(() => document.querySelectorAll('#acc-panel .ra-chip').length === 1, null, { timeout: 8000 }).catch(() => {});
      check(await journal(p, (l) => l[0] === 'rpc' && l[1] === 'hg_member_role_set' && l[2].p_user === U(3) && l[2].p_role === 'irl' && l[2].p_on === false),
        '(c) puce IRL : hg_member_role_set(Bruno, irl, false)');
      check((await origine('historique')) === 'Membres choisis · aucun rôle ne la donne', '(c) sans le rôle : Historique n’a plus d’origine');
      check(JSON.stringify(await textes(p, '#ra-role-select option')) === JSON.stringify(['IRL']), '(c) menu « Ajouter un rôle » : propose IRL');

      // Ajouter le rôle IRL depuis le menu
      await p.selectOption('#ra-role-select', 'irl');
      await p.click('#acc-panel [data-role-add]');
      await p.waitForFunction(() => document.querySelectorAll('#acc-panel .ra-chip').length === 2, null, { timeout: 8000 }).catch(() => {});
      check(await journal(p, (l) => l[0] === 'rpc' && l[1] === 'hg_member_role_set' && l[2].p_user === U(3) && l[2].p_role === 'irl' && l[2].p_on === true),
        '(c) menu « Ajouter le rôle » : hg_member_role_set(Bruno, irl, true)');
      check((await origine('historique')) === 'Membres choisis · via le rôle IRL', '(c) rôle rendu : Historique à nouveau via IRL');
      check(!p.errs.length, '(c) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
      await p.screenshot({ path: path.join(SHOTS, 'admin-roles-fiche-1280.png') });
    }

    /* (d) 390 px : Rôles et fiche sans défilement horizontal, cibles ≥ 44 px */
    {
      const p = await openPage(browser, { page: 'admin', width: 390, height: 844, mobile: true, dpr: 2, scenario: SCN });
      await adminSection(p, 'place/roles');
      await attendre(p, '#roles-root .rl-item');
      check(await hscroll(p) === 0, '(d) Rôles, 390 px : pas de défilement horizontal');
      check(await hauteurMin(p, '#roles-root .rl-item') >= 44, '(d) Rôles, 390 px : cibles de liste ≥ 44 px');
      check(await hauteurMin(p, '#roles-root .rl-detail .btn') >= 44, '(d) Rôles, 390 px : boutons du détail ≥ 44 px');
      check(await hauteurMin(p, '#roles-root .rl-page') >= 44, '(d) Rôles, 390 px : cases de pages ≥ 44 px');
      await p.screenshot({ path: path.join(SHOTS, 'admin-roles-390.png') });
      await p.evaluate((h) => { location.hash = h; }, '#place/comptes/' + U(3) + '/acces');
      await attendre(p, '#acc-panel .ra-block');
      check(await hscroll(p) === 0, '(d) fiche « Accès », 390 px : pas de défilement horizontal');
      check(await hauteurMin(p, '#acc-panel .ra-chip') >= 44, '(d) fiche, 390 px : puces ≥ 44 px');
      check(await hauteurMin(p, '#acc-panel [data-access-reset]') >= 44 || (await p.locator('#acc-panel [data-access-reset]').count()) === 0, '(d) fiche, 390 px : bouton de réglage ≥ 44 px');
      check(!p.errs.length, '(d) aucune erreur JS (390 px)' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    }
    /* (e) Dialogue « Personnes » d'une page liste : retirer un membre écrit allowed=false (un rôle ne le lui redonne pas) */
    {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { ...SCN, access: [{ page_slug: 'irl', user_id: U(2), allowed: true }] } });
      await adminSection(p, 'place/acces');
      await attendre(p, '[data-pa-manage="irl"]');
      await p.click('[data-pa-manage="irl"]');
      await attendre(p, 'dialog[open] [data-pa-user="' + U(2) + '"]');
      check(await p.isChecked('dialog[open] [data-pa-user="' + U(2) + '"]'), '(e) Alice a un accès réglé à la main à IRL (case cochée)');
      await p.uncheck('dialog[open] [data-pa-user="' + U(2) + '"]');
      await p.waitForFunction(() => window.__LOG.some((l) => l[0] === 'upsert' && l[1] === 'hg_page_access'), null, { timeout: 8000 }).catch(() => {});
      check(await journal(p, (l) => l[0] === 'upsert' && l[1] === 'hg_page_access' && [].concat(l[2]).some((r) => r.page_slug === 'irl' && r.user_id === U(2) && r.allowed === false)),
        '(e) retirer Alice du dialogue : hg_page_access(irl, Alice, allowed false), pas de suppression');
      check(!(await journal(p, (l) => l[0] === 'delete' && l[1] === 'hg_page_access')), '(e) aucune suppression de ligne');
      check(await p.evaluate((u) => window.__DB.hg_page_access.some((a) => a.page_slug === 'irl' && a.user_id === u && a.allowed === false), U(2)),
        '(e) la base garde une ligne « bloqué » pour Alice (le rôle IRL ne la lui redonne pas)');
      check(!p.errs.length, '(e) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    }
  } catch (e) {
    check(false, 'exception : ' + (e && e.message ? e.message : e));
  } finally {
    await browser.close();
    finish();
  }
})();
