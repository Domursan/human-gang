// Parcours : comptes fantômes dans Membres › Comptes (fusion de l'ancienne sous-section « Comptes fantômes »).
// (a) ordinateur 1440 px : anciennes adresses redirigées ; fiche d'un fantôme (code, bloc « Lier à un compte inscrit »,
//     correspondances en tête, liaison et récapitulatif) ; le transfert appelle hg_ghost_merge et ouvre le compte inscrit.
// (b) fiche d'un fantôme sans correspondance : recherche dans le bloc, génération d'un code, « + Nouveau fantôme »
//     (tiroir), « Lier un fantôme… » depuis la fiche d'un compte actif.
// (c) bannière « Ce compte correspond peut-être au fantôme X » sur la fiche d'un compte actif, puis « Compléter la fiche ».
// (d) mobile 390 px : liste, fiche d'un fantôme et tiroir de création, sans défilement horizontal.
// Faux Supabase (fixtures/fake-sb.mjs) : fantômes et correspondances fournis par le scénario, RPC de fantômes simulées.
// Lancer : node tests/parcours-admin-comptes-fantomes.cjs
const { ROOT, check, finish, openPage, hscroll, chromium } = require('./lib/harness.cjs');

const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const DAY = 864e5;
const ZOE = 'aaaaaaaa-0000-4000-8000-000000000101';
const THEO = 'aaaaaaaa-0000-4000-8000-000000000102';
const GHOSTS = [
  { id: ZOE, pseudo: 'Zoé', avatar_url: null, joined_on: '2025-06-01', created_at: new Date(Date.now() - DAY).toISOString(), invite_code: 'HG-ABC123', invite_expires_at: '2099-01-01T00:00:00Z', ghost_note: 'Ami de Bruno' },
  { id: THEO, pseudo: 'Théo', avatar_url: null, joined_on: null, created_at: new Date(Date.now() - 2 * DAY).toISOString(), invite_code: null, invite_expires_at: null, ghost_note: null },
];
// Zoé ressemble à Chloé (même ID Discord) : correspondance proposée sur la fiche de Zoé et sur celle de Chloé
const SUGG = [{ ghost_id: ZOE, ghost_pseudo: 'Zoé', user_id: U(4), user_pseudo: 'Chloé', reason: 'même ID Discord' }];

const hashOf = (p) => p.evaluate(() => location.hash);
const goHash = (p, h) => p.evaluate((x) => { location.hash = x; }, h);
const waitHash = (p, h) => p.waitForFunction((x) => location.hash === x, h, { timeout: 5000 }).then(() => true, () => false);
const waitVisible = (p, sel, want = true) => p.waitForFunction(([s, w]) => {
  const e = document.querySelector(s);
  return (!!e && e.getClientRects().length > 0) === w;
}, [sel, want], { timeout: 6000 }).then(() => true, () => false);
const waitText = (p, sel, text) => p.waitForFunction(([s, t]) => {
  const e = document.querySelector(s);
  return !!e && e.textContent.includes(t);
}, [sel, text], { timeout: 6000 }).then(() => true, () => false);
const waitGone = (p, sel) => p.waitForFunction((s) => !document.querySelector(s), sel, { timeout: 6000 }).then(() => true, () => false);
const rowCount = (p) => p.$$eval('#shell-col-list .ui-row', (rs) => rs.filter((r) => r.getClientRects().length).length);
const waitRows = (p, n) => p.waitForFunction((k) => [...document.querySelectorAll('#shell-col-list .ui-row')].filter((r) => r.getClientRects().length).length === k, n, { timeout: 8000 }).then(() => true, () => false);
const rpcLog = (p) => p.evaluate(() => window.__LOG.filter((e) => e[0] === 'rpc').map((e) => [e[1], e[2]]));
const hasCall = (log, fn, args) => log.some(([f, a]) => f === fn && Object.entries(args).every(([k, v]) => a?.[k] === v));

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  const SCN = () => ({ ghosts: JSON.parse(JSON.stringify(GHOSTS)), suggestions: JSON.parse(JSON.stringify(SUGG)) });

  /* (a) Redirections, fiche d'un fantôme, liaison par correspondance */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: SCN() });
    await goHash(p, '#membres/fantomes');
    check(await waitHash(p, '#membres/comptes'), '(a) ancienne adresse #membres/fantomes redirigée vers #membres/comptes');
    check(await waitRows(p, 6), '(a) liste de Comptes affichée (filtre Actifs)');
    await goHash(p, '#fantomes');
    check(await waitHash(p, '#membres/comptes'), '(a) ancre #fantomes redirigée vers #membres/comptes');
    await goHash(p, `#membres/fantomes/${ZOE}`);
    check(await waitHash(p, `#membres/comptes/${ZOE}`), '(a) #membres/fantomes/<id> redirigée vers #membres/comptes/<id>');
    check(await waitVisible(p, '#acc-root .agh-detail'), '(a) l’adresse redirigée ouvre la fiche du fantôme');
    check(await p.locator('#shell-subs a[href="#membres/fantomes"]').count() === 0, '(a) plus de sous-section « Comptes fantômes » dans la colonne');

    check((await p.textContent('#agh-dh .ui-dhead-t')).includes('Zoé'), '(a) en-tête : Zoé (fantôme)');
    check((await p.textContent('#acc-root .agh-code-val')).includes('HG-ABC123'), '(a) code d’invitation affiché');
    check(await p.isVisible('#agh-lier') && (await p.textContent('#agh-lier-t')).includes('Lier à un compte inscrit'), '(a) bloc « Lier à un compte inscrit » en évidence');
    check(await p.locator('#acc-root .acc-tab').count() === 0, '(a) fiche du fantôme : pas d’onglets de fiche complète');
    check(await p.locator('#agh-lier .agh-sugg-item').count() === 1 && (await p.textContent('#agh-lier .agh-sugg-item')).includes('même ID Discord'), '(a) correspondance en tête du bloc, avec sa raison');
    check(await p.locator('#agh-merge-sel optgroup[label="Correspondances"] option[value="' + U(4) + '"]').count() === 1, '(a) la liste des comptes met Chloé en tête (Correspondances)');

    await p.click('#agh-lier [data-agh="pick"]');
    check(await p.inputValue('#agh-merge-sel') === U(4), '(a) « Choisir ce compte » : Chloé sélectionnée');
    check((await p.textContent('#agh-merge-recap')).includes('Chloé') && (await p.textContent('#agh-merge-recap')).includes('Zoé'), '(a) récapitulatif : Zoé vers Chloé');
    check(await p.isEnabled('#agh-lier [data-agh="merge-confirm"]'), '(a) confirmation activée');

    await p.click('#agh-lier [data-agh="merge-confirm"]');
    check(await waitHash(p, `#membres/comptes/${U(4)}`), '(a) après fusion : fiche du compte inscrit (Chloé) ouverte');
    check(await waitText(p, '#acc-dh .ui-dhead-t', 'Chloé'), '(a) après fusion : en-tête Chloé');
    const log = await rpcLog(p);
    check(hasCall(log, 'hg_ghost_merge', { p_ghost: ZOE, p_user: U(4) }), '(a) hg_ghost_merge appelé avec le fantôme Zoé et Chloé');
    check(await p.locator('#acc-sugg .agh-banner').count() === 0, '(a) plus de bannière sur Chloé (le fantôme est fusionné)');
    check(await p.locator('#acc-root .acc-tab').count() === 8, '(a) fiche complète de Chloé (huit onglets)');
    await p.click('#shell-col-list .ui-chip[data-filter="ghost"]');
    check(await rowCount(p) === 1, '(a) après fusion : un seul fantôme restant (Théo)');
    check(p.errs.length === 0, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (b) Recherche dans le bloc, code, création, « Lier un fantôme… » */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: SCN() });
    await goHash(p, `#membres/comptes/${THEO}`);
    check(await waitVisible(p, '#agh-lier') && (await p.textContent('#agh-dh .ui-dhead-t')).includes('Théo'), '(b) fiche de Théo (sans correspondance)');
    check(await p.locator('#agh-lier .agh-sugg-item').count() === 0, '(b) pas de correspondance pour Théo');

    await p.click('#acc-root [data-agh="invite"]');
    check(await waitText(p, '#acc-root', 'HG-NEW002'), '(b) code généré et affiché pour Théo');
    check(await p.isVisible('#acc-root [data-agh="copy-code"]'), '(b) bouton « Copier le code »');

    await p.fill('#agh-merge-q', 'bru');
    await p.waitForTimeout(100);
    const opts = await p.$$eval('#agh-merge-sel option', (os) => os.map((o) => o.textContent.trim()));
    check(opts.includes('Bruno') && !opts.includes('Alice'), `(b) recherche « bru » : seul Bruno dans la liste (${opts.join(', ')})`);
    await p.fill('#agh-merge-q', '');
    await p.selectOption('#agh-merge-sel', U(3));
    check((await p.textContent('#agh-merge-recap')).includes('Bruno'), '(b) choix de Bruno : récapitulatif');
    await p.selectOption('#agh-merge-sel', '');
    check(await p.isDisabled('#agh-lier [data-agh="merge-confirm"]'), '(b) sans compte choisi : confirmation désactivée');

    // + Nouveau fantôme (zone d'action) : tiroir de création
    await p.click('#zone-actions button:has-text("Nouveau fantôme")');
    check(await waitVisible(p, 'dialog.ui-drawer[open] #agh-pseudo'), '(b) « + Nouveau fantôme » ouvre le tiroir de création');
    await p.fill('#agh-pseudo', 'Nina');
    await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
    check(await waitGone(p, 'dialog.ui-drawer[open]'), '(b) création : tiroir fermé');
    check(hasCall(await rpcLog(p), 'hg_ghost_create', { p_pseudo: 'Nina' }), '(b) hg_ghost_create appelé pour Nina');
    check(await p.waitForFunction(() => document.querySelector('#shell-col-list .ui-chip[data-filter="ghost"] .ui-count')?.textContent.trim() === '3', null, { timeout: 6000 }).then(() => true, () => false), '(b) compteur des fantômes : 3 après création');

    // Lier un fantôme… depuis la fiche d'un compte actif
    await goHash(p, `#membres/comptes/${U(3)}`);
    check(await waitText(p, '#acc-dh .ui-dhead-t', 'Bruno'), '(b) fiche de Bruno');
    check(await p.isVisible('#zone-actions button:has-text("Lier un fantôme")') && await p.isVisible('#zone-actions button:has-text("Nouveau fantôme")'), '(b) actions de zone : Lier un fantôme… et + Nouveau fantôme');
    await p.click('#zone-actions button:has-text("Lier un fantôme")');
    check(await waitVisible(p, 'dialog.ui-drawer[open] #agh-d-ghost'), '(b) « Lier un fantôme… » ouvre le tiroir (choix du fantôme)');
    await p.selectOption('dialog.ui-drawer[open] #agh-d-ghost', THEO);
    check((await p.textContent('dialog.ui-drawer[open] .agh-merge-recap')).includes('Théo') && (await p.textContent('dialog.ui-drawer[open] .agh-merge-recap')).includes('Bruno'), '(b) tiroir : récapitulatif Théo vers Bruno');
    await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
    check(await waitGone(p, 'dialog.ui-drawer[open]'), '(b) liaison : tiroir fermé');
    check(hasCall(await rpcLog(p), 'hg_ghost_merge', { p_ghost: THEO, p_user: U(3) }), '(b) hg_ghost_merge appelé : Théo vers Bruno');
    check(await waitHash(p, `#membres/comptes/${U(3)}`) && await waitText(p, '#acc-dh .ui-dhead-t', 'Bruno'), '(b) après liaison : fiche de Bruno toujours ouverte');
    check(p.errs.length === 0, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (c) Bannière sur un compte actif, fiche d'un fantôme complète */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: SCN() });
    // Fiche d'un fantôme : « Compléter la fiche » ouvre la fiche complète, « Détail du fantôme » revient au fantôme
    await goHash(p, `#membres/comptes/${ZOE}`);
    check(await waitVisible(p, '#agh-lier'), '(c) fiche de Zoé');
    await p.click('#agh-dh .ui-btn:has-text("Compléter la fiche")');
    check(await waitHash(p, `#membres/comptes/${ZOE}/profil`), '(c) « Compléter la fiche » : fiche complète du fantôme');
    check(await waitVisible(p, '#acc-root .acc-tab[data-tab="profil"][aria-selected="true"]'), '(c) fiche complète : onglet Profil');
    check(await p.locator('#acc-root .acc-tab').count() === 7, '(c) fiche complète du fantôme : sept onglets (sans Accès)');
    await p.click('#acc-dh .ui-btn:has-text("Détail du fantôme")');
    check(await waitVisible(p, '#acc-root .agh-detail') && await waitHash(p, `#membres/comptes/${ZOE}`), '(c) « Détail du fantôme » : retour à la fiche du fantôme');

    // Bandeau sur la fiche d'un compte actif, liaison depuis le tiroir
    await goHash(p, `#membres/comptes/${U(4)}`);
    check(await waitVisible(p, '#acc-sugg .agh-banner'), '(c) bandeau sur la fiche de Chloé');
    check((await p.textContent('#acc-sugg .agh-banner')).includes('Zoé'), '(c) bandeau : « correspond peut-être au fantôme Zoé »');
    await p.click('#acc-sugg [data-agh="sugg-link"]');
    check(await waitVisible(p, 'dialog.ui-drawer[open]') && (await p.textContent('dialog.ui-drawer[open]')).includes('Lier à un compte inscrit'), '(c) « Lier » ouvre le tiroir de liaison');
    await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
    check(await waitGone(p, 'dialog.ui-drawer[open]'), '(c) liaison depuis le bandeau : tiroir fermé');
    check(hasCall(await rpcLog(p), 'hg_ghost_merge', { p_ghost: ZOE, p_user: U(4) }), '(c) hg_ghost_merge appelé : Zoé vers Chloé');
    check(await waitGone(p, '#acc-sugg .agh-banner'), '(c) bandeau retiré après liaison');
    check(p.errs.length === 0, '(c) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (d) Mobile 390 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 390, height: 844, scenario: SCN() });
    await p.click('#shell-tabs .shell-tab[data-dom="membres"]');
    await p.click('#shell-subs a[href="#membres/comptes"]');
    check(await waitRows(p, 6), '(d) mobile : liste des comptes plein écran');
    await p.click('#shell-col-list .ui-chip[data-filter="ghost"]');
    check(await rowCount(p) === 2, '(d) mobile : puce Fantômes : deux lignes');
    await p.click(`#shell-col-list .ui-row[data-id="${ZOE}"]`);
    check(await waitVisible(p, '#app') && await waitVisible(p, '#agh-lier') && await waitVisible(p, '#shell-col', false), '(d) mobile : fiche du fantôme, liste masquée');
    check(await p.getAttribute('#zone-back', 'href') === '#membres/comptes', '(d) mobile : retour vers la liste des comptes');
    check(await hscroll(p) <= 0, '(d) mobile : pas de défilement horizontal (fiche du fantôme)');
    await p.click('#zone-actions button:has-text("Nouveau fantôme")');
    check(await waitVisible(p, 'dialog.ui-drawer[open] #agh-pseudo'), '(d) mobile : « + Nouveau fantôme » ouvre le tiroir');
    check(await hscroll(p) <= 0, '(d) mobile : pas de défilement horizontal (tiroir)');
    await p.keyboard.press('Escape');
    check(await waitGone(p, 'dialog.ui-drawer[open]'), '(d) mobile : Échap ferme le tiroir');
    check(p.errs.length === 0, '(d) mobile : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
