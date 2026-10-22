// Parcours : Pilotage du panel admin (phase 2) : Vue d'ensemble, Journal, Staff.
// (a) Staff (administrateur) 1440 px : ajout d'un membre depuis la colonne 2, fiche (permissions, barre
//     d'enregistrement, enregistrement), panneau d'infos, désactivation puis réactivation avec confirmation.
// (b) Journal : liste, filtres par type (puces), recherche, détail avant / après, consultations.
// (c) Vue d'ensemble : tuiles, bloc « À traiter » (liens vers les sous-sections), activité récente.
// (d) Staff { journal } : pas de Staff ni de Vue d'ensemble, aucune requête vers hg_staff_list ni hg_staff_set.
// (e) Mobile 390 px : liste plein écran, puis détail avec retour à la liste.
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours-admin-p2-pilotage.cjs
const { ROOT, check, finish, openPage, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

/* ---------- Aides de test ---------- */
/** Identifiant de test du membre n (U(2) = Alice, comme dans le faux client). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const CHLOE = U(4);
const NOTE = 'Test CI pilotage';

/** Adresse (hash) courante de la page. */
const hashOf = (p) => p.evaluate(() => location.hash);
/** Change l'adresse de la page (hash h), puis attend que le sélecteur sel soit affiché. */
const goHash = async (p, h, sel) => {
  await p.evaluate((x) => { location.hash = x; }, h);
  if (sel) await p.waitForSelector(sel, { state: 'visible', timeout: 5000 }).catch(() => {});
  await sleep(250);
};
/** Vrai si l'élément correspondant à sel est affiché. */
const visible = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);
/** Nombre de lignes de la colonne liste. */
const rowsCount = (p) => p.locator('#shell-col-list .ui-row').count();
/** Puce de filtre de la liste dont le texte contient label. */
const chip = (p, label) => p.locator('#shell-col-list .ui-chip', { hasText: new RegExp('^\\s*' + label) });

/* ---------- Scénario ---------- */
(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* (a) Administrateur : Staff, 1440 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900 });
    await goHash(p, '#pilotage/staff', '#staff');
    check(await visible(p, '#staff') && await visible(p, '#shell-col-list .stf-col'), '(a) Staff : zone principale et colonne 2 affichées');
    check((await p.textContent('#shell-col-list [data-staff-add]')).includes('Ajouter au Staff'), '(a) colonne 2 : bouton « + Ajouter au Staff »');
    check(await chip(p, 'Actifs').count() === 1 && await p.locator('#shell-col-list .ui-chip', { hasText: /^\s*Inactifs/ }).count() === 1, '(a) colonne 2 : puces Actifs / Inactifs');
    check(await p.locator('#staff .empty').count() === 1, '(a) sans membre choisi : invitation à choisir');
    check((await p.textContent('#shell-info')).includes('Choisis un membre'), '(a) sans membre choisi : panneau d’infos invite à choisir');

    // Ajout d'un membre
    await p.click('#shell-col-list [data-staff-add]');
    await p.waitForSelector('#staff-dialog[open]', { timeout: 5000 });
    await p.waitForSelector('.staff-pick', { timeout: 5000 });
    await p.click('.staff-pick:has-text("Chloé")');
    await p.check('input[name="perm"][value="cartes"]');
    await p.check('input[name="perm"][value="badges"]');
    await p.fill('#staff-note', NOTE);
    await p.click('#staff-dialog button[type="submit"]');
    await p.waitForFunction(() => !document.querySelector('#staff-dialog').open, null, { timeout: 5000 }).catch(() => {});
    await p.waitForSelector('#shell-col-list .ui-row:has-text("Chloé")', { timeout: 5000 }).catch(() => {});
    check(await hashOf(p) === '#pilotage/staff/' + CHLOE, '(a) après ajout : la fiche de Chloé s’ouvre (URL #pilotage/staff/<uid>)');
    check(await p.locator('#staff input[data-perm-key]:checked').count() === 2, '(a) fiche : deux permissions cochées');
    check((await p.textContent('#staff .stf-note')).includes(NOTE), '(a) fiche : note affichée');
    check(await visible(p, '#shell-info') && (await p.textContent('#shell-info')).includes('ajouté par'), '(a) panneau d’infos : ajouté par, date');
    let journal = await log(p);
    const add = journal.find((l) => l[0] === 'rpc' && l[1] === 'hg_staff_set');
    check(!!add && add[2].p_user === CHLOE && add[2].p_active === true, '(a) ajout : hg_staff_set envoyé (membre, actif)');

    // Permissions : modification, barre d'enregistrement, annulation, enregistrement
    check((await p.textContent('#stf-bar')).includes('Aucune modification'), '(a) barre : aucune modification au départ');
    await p.uncheck('#staff input[data-perm-key="cartes"]');
    await p.check('#staff input[data-perm-key="journal"]');
    check((await p.textContent('#stf-bar')).includes('2 modifications non enregistrées'), '(a) barre : « 2 modifications non enregistrées »');
    await p.click('#stf-bar [data-staff-cancel]');
    check(await p.locator('#staff input[data-perm-key="cartes"]:checked').count() === 1 && await p.locator('#staff input[data-perm-key="journal"]:checked').count() === 0,
      '(a) Annuler : permissions rétablies');
    await p.check('#staff input[data-perm-key="journal"]');
    await p.click('#stf-bar [data-staff-save]');
    await p.waitForFunction(() => document.querySelector('#stf-bar')?.textContent.includes('Aucune modification'), null, { timeout: 5000 }).catch(() => {});
    journal = await log(p);
    const set = journal.filter((l) => l[0] === 'rpc' && l[1] === 'hg_staff_set').pop();
    check(!!set && set[2].p_perms.includes('journal') && set[2].p_perms.includes('cartes') && set[2].p_note === NOTE,
      '(a) Enregistrer : hg_staff_set avec les nouvelles permissions, note conservée');

    // Désactivation avec confirmation, puis réactivation
    await p.click('#staff .ui-btn:has-text("Désactiver")');
    await p.waitForSelector('dialog.hg-dialog[open]', { timeout: 5000 });
    await p.click('dialog.hg-dialog[open] button[value="ok"]');
    await p.waitForSelector('#shell-col-list .ui-row:has-text("Chloé"):has-text("Inactif")', { timeout: 5000 }).catch(() => {});
    check(await p.locator('#shell-col-list .ui-row:has-text("Inactif")', { hasText: 'Chloé' }).count() === 1, '(a) désactivée : marquée inactive dans la liste');
    check(await p.locator('#staff .ui-btn:has-text("Réactiver")').count() === 1, '(a) désactivée : bouton Réactiver dans la fiche');
    journal = await log(p);
    check(journal.some((l) => l[0] === 'rpc' && l[1] === 'hg_staff_set' && l[2].p_active === false && l[2].p_note === NOTE), '(a) désactivation : p_active = false, note gardée');
    await p.click('#staff .ui-btn:has-text("Réactiver")');
    await p.waitForSelector('#shell-col-list .ui-row:has-text("Chloé"):has-text("Actif")', { timeout: 5000 }).catch(() => {});
    check(await p.locator('#shell-col-list .ui-row', { hasText: 'Chloé' }).count() === 1, '(a) réactivée sans confirmation');


    check((await p.textContent('#shell-info')).includes('Dernières actions'), '(a) panneau d’infos : dernières actions du membre');
    check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (b) Journal : 1440 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900 });
    await goHash(p, '#pilotage/journal', '#log-detail');
    check(await rowsCount(p) === 4, `(b) journal : 4 entrées (actions et consultations) (${await rowsCount(p)})`);
    check(await chip(p, 'Consultations').count() === 1 && await chip(p, 'Ajustement de Paillettes').count() === 1, '(b) puces par type d’action');
    await chip(p, 'Consultations').click();
    check(await rowsCount(p) === 1, '(b) filtre « Consultations » : une entrée');
    await chip(p, 'Toutes').click();
    await p.click('#shell-col-list .ui-row:has-text("Ajustement de Paillettes")');
    await p.waitForSelector('#log-detail .log-diff', { timeout: 5000 }).catch(() => {});
    check(await hashOf(p).then((h) => /^#pilotage\/journal\/l\d+$/.test(h)), '(b) sélection : l’URL suit l’entrée');
    const diff = await p.$$eval('#log-detail .log-diff tbody tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.trim())));
    check(diff.some((r) => r[1] === '120' && r[2] === '150'), '(b) détail : avant (120) et après (150) lisibles côte à côte');
    check(await p.locator('#log-detail tr.is-changed').count() >= 1, '(b) détail : valeurs modifiées mises en évidence');
    check((await p.textContent('#log-detail')).includes('Sortie IRL'), '(b) détail : autres champs listés');
    await p.fill('#shell-col-list input[type="search"]', 'Chloé');
    await sleep(400);
    check(await rowsCount(p) === 1, '(b) recherche « Hibou » : une entrée');
    await p.fill('#shell-col-list input[type="search"]', '');
    await sleep(300);
    check(await rowsCount(p) === 4, '(b) recherche vidée : toutes les entrées');
    check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (c) Vue d'ensemble : tuiles, à traiter, activité */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900,
      scenario: { support: [{ id: 'sup-1', status: 'ouverte', user_id: U(3), subject: 'Test', message: 'Bonjour', created_at: new Date().toISOString() }] } });
    await goHash(p, '#pilotage/apercu', '#apercu');
    check(await p.locator('#stats .stat').count() > 0, '(c) tuiles de chiffres clés affichées');
    check(await p.locator('#ov-todo .ov-todo-row').count() >= 1, '(c) « À traiter » : au moins une ligne');
    check(await p.locator('#ov-todo a[href="#communication/assistance"]').count() === 1, '(c) « À traiter » : lien vers Assistance');
    check(await p.locator('#ov-activity li').count() >= 1 && await visible(p, '#ov-activity-card'), '(c) activité récente : dernières actions du journal');
    check((await p.evaluate(() => document.querySelector('#ov-todo').textContent)).includes('demande ouverte'), '(c) « À traiter » : libellé de la demande');
    await p.click('#ov-todo a[href="#communication/assistance"]');
    await sleep(300);
    check(await hashOf(p) === '#communication/assistance', '(c) lien « À traiter » : mène à la sous-section');
    check(!p.errs.length, '(c) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (d) Staff { journal } : ni Staff ni Vue d'ensemble, pas de requête Staff */
  {
    const p = await openPage(browser, { page: 'admin', scenario: { uid: U(2), staff: ['journal'] } });
    const subs = await p.$$eval('#shell-subs .shell-sub', (as) => as.filter((a) => a.getClientRects().length).map((a) => a.dataset.sub));
    check(JSON.stringify(subs) === JSON.stringify(['journal']), `(d) Staff journal : seul le Journal (${subs.join(', ')})`);
    check(await rowsCount(p) === 4, '(d) Staff journal : liste du journal en colonne 2');
    const journal = await log(p);
    check(!journal.some((l) => l[0] === 'rpc' && (l[1] === 'hg_staff_list' || l[1] === 'hg_staff_set')), '(d) Staff journal : aucune requête vers le Staff');
    check(!p.errs.length, '(d) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (e) Mobile 390 px : liste plein écran, puis détail avec retour */
  {
    const p = await openPage(browser, { page: 'admin', width: 390, height: 844 });
    await goHash(p, '#pilotage/journal', '#shell-col-list');
    check(await visible(p, '#shell-col-list .ui-list') && !(await visible(p, '#log-detail')), '(e) mobile : liste plein écran (pas de détail)');
    await p.click('#shell-col-list .ui-row >> nth=0');
    await sleep(400);
    check(await visible(p, '#log-detail') && !(await visible(p, '#shell-col-list .ui-list')), '(e) mobile : détail après le choix d’une entrée');
    check(await p.getAttribute('#zone-back', 'href') === '#pilotage/journal', '(e) mobile : retour ramène à la liste');
    check(await hscroll(p) <= 0, '(e) mobile : pas de défilement horizontal');
    check(!p.errs.length, '(e) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
