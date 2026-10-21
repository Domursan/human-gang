// Parcours : Membres › Comptes et Comptes fantômes en liste + détail (phase 2 de la coquille, option C).
// (a) ordinateur 1440 px : liste en colonne 2 (recherche, puces Tous / Staff / Fantômes), fiche dans la zone principale,
//     onglet suivi par l'URL, résumé à droite, actions rapides, Échap ferme la fiche, Précédent fonctionne.
// (b) Comptes fantômes : liste, fiche avec code et liaison, formulaire « Nouveau fantôme ».
// (c) mobile 390 px : liste plein écran, fiche avec bouton retour vers la liste, pas de défilement horizontal.
// Faux Supabase (fixtures/fake-sb.mjs) avec deux fantômes fournis par le scénario. Lancer : node tests/parcours-admin-p2-comptes.cjs
const { ROOT, check, finish, openPage, hscroll, chromium } = require('./lib/harness.cjs');

const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const GHOSTS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000101', pseudo: 'Zoé', avatar_url: null, joined_on: '2025-06-01', created_at: '2026-09-01T10:00:00Z', invite_code: 'HG-ABC123', invite_expires_at: '2099-01-01T00:00:00Z', ghost_note: 'Ami de Bruno' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000102', pseudo: 'Théo', avatar_url: null, joined_on: null, created_at: '2026-09-02T10:00:00Z', invite_code: null, invite_expires_at: null, ghost_note: null },
];
const SCN = { ghosts: GHOSTS };

// Attend qu'un élément soit visible (ou masqué) après un changement de route.
async function waitVisible(p, sel, want = true) {
  await p.waitForFunction(([s, w]) => {
    const e = document.querySelector(s);
    const vis = !!e && e.getClientRects().length > 0;
    return vis === w;
  }, [sel, want], { timeout: 6000 }).catch(() => {});
  return p.isVisible(sel).then((v) => v === want);
}
const hashOf = (p) => p.evaluate(() => location.hash);
const goHash = (p, h) => p.evaluate((x) => { location.hash = x; }, h);
const rowCount = (p) => p.$$eval('#shell-col-list .ui-row', (rs) => rs.filter((r) => r.getClientRects().length).length);
const waitRows = (p, n) => p.waitForFunction((k) => [...document.querySelectorAll('#shell-col-list .ui-row')].filter((r) => r.getClientRects().length).length === k, n, { timeout: 8000 }).then(() => true, () => false);

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* (a) Comptes, ordinateur 1440 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: SCN });
    await goHash(p, '#membres/comptes');
    check(await waitRows(p, 8), `(a) liste des comptes : 6 membres et 2 fantômes en colonne 2 (${await rowCount(p)})`);
    check(await p.isVisible('#shell-col') && await p.isVisible('#shell-col-list .ui-search'), '(a) recherche dans la colonne 2');
    check(await p.locator('#shell-col-list .ui-chip').count() === 3, '(a) puces Tous / Staff / Fantômes');
    check(await p.isVisible('#acc-root .acc-empty') && (await hashOf(p)) === '#membres/comptes', '(a) sans sélection : zone principale invite à choisir un membre');

    await p.click('#shell-col-list .ui-chip[data-filter="ghost"]');
    check(await rowCount(p) === 2, '(a) puce « Fantômes » : deux lignes');
    await p.click('#shell-col-list .ui-chip[data-filter="all"]');
    check(await rowCount(p) === 8, '(a) puce « Toutes » : huit lignes');

    await p.fill('#shell-col-list input[type="search"]', 'alic');
    await p.waitForTimeout(400);
    check(await rowCount(p) === 1, '(a) recherche « alic » : Alice seule');
    await p.press('#shell-col-list input[type="search"]', 'Escape');
    await p.waitForTimeout(300);
    check(await rowCount(p) === 8, '(a) Échap dans la recherche : liste complète');

    await p.click(`#shell-col-list .ui-row[data-id="${U(2)}"]`);
    check(await p.waitForFunction((u) => location.hash === `#membres/comptes/${u}`, U(2), { timeout: 6000 }).then(() => true, () => false), '(a) clic sur Alice : URL #membres/comptes/<id>');
    check(await waitVisible(p, '#acc-dh .ui-dhead-t') && (await p.textContent('#acc-dh .ui-dhead-t')).includes('Alice'), '(a) en-tête de fiche : Alice (composant commun)');
    check(await p.locator('#acc-root .acc-tab').count() === 8, '(a) huit onglets de fiche');
    check(await waitVisible(p, '#shell-info') && await p.locator('#shell-info .ui-facts .ui-fact').count() === 6, '(a) panneau d’infos : résumé à six repères');
    const labels = await p.$$eval('#shell-info .ui-fact span', (ss) => ss.map((s) => s.textContent));
    check(['Paillettes', 'Cartes', 'Sorties IRL', 'Secret Santa', 'Badges', 'Rôle'].every((l) => labels.includes(l)), `(a) résumé : Paillettes, Cartes, Sorties, Secret Santa, Badges, Rôle (${labels.join(' / ')})`);

    await p.click('#acc-root .acc-tab[data-tab="badges"]');
    check(await p.waitForFunction((u) => location.hash === `#membres/comptes/${u}/badges`, U(2), { timeout: 4000 }).then(() => true, () => false), '(a) onglet Badges : l’URL suit l’onglet');
    check(await p.getAttribute('#acc-root .acc-tab[data-tab="badges"]', 'aria-selected') === 'true', '(a) onglet Badges sélectionné');

    await p.locator('#shell-info .ui-linkbtn', { hasText: 'Secret Santa' }).click();
    check(await p.waitForFunction((u) => location.hash === `#membres/comptes/${u}/ss`, U(2), { timeout: 4000 }).then(() => true, () => false), '(a) action rapide « Secret Santa » du résumé : onglet Secret Santa');

    // Adresse directe avec onglet
    await goHash(p, `#membres/comptes/${U(3)}/irl`);
    check(await waitVisible(p, '#acc-root .acc-tab[data-tab="irl"][aria-selected="true"]'), '(a) adresse directe avec onglet : Bruno, onglet Sorties IRL');
    check((await p.textContent('#acc-dh .ui-dhead-t')).includes('Bruno'), '(a) adresse directe : en-tête de Bruno');

    // Échap ferme la fiche ; Précédent revient à la fiche précédente
    await p.keyboard.press('Escape');
    check(await p.waitForFunction(() => location.hash === '#membres/comptes', null, { timeout: 4000 }).then(() => true, () => false), '(a) Échap : retour à la liste (URL #membres/comptes)');
    check(await waitVisible(p, '#acc-root .acc-empty'), '(a) Échap : zone principale vide');
    await p.goBack();
    check(await p.waitForFunction((u) => location.hash.startsWith(`#membres/comptes/${u}`), U(3), { timeout: 4000 }).then(() => true, () => false), '(a) Précédent : fiche de Bruno rouverte');

    // Bouton « Fermer la fiche » de l'en-tête
    await p.click('#acc-dh .ui-btn:has-text("Fermer la fiche")');
    check(await p.waitForFunction(() => location.hash === '#membres/comptes', null, { timeout: 4000 }).then(() => true, () => false), '(a) « Fermer la fiche » : retour à la liste');

    check(p.errs.length === 0, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (b) Comptes fantômes, ordinateur 1440 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: SCN });
    await goHash(p, '#membres/fantomes');
    check(await waitRows(p, 2), `(b) liste des fantômes : deux lignes en colonne 2 (${await rowCount(p)})`);
    check(await waitVisible(p, '#agh-view .agh-hint') && await p.isVisible('#shell-col .agh-new'), '(b) sans sélection : accueil et bouton « Nouveau fantôme »');
    check(await p.locator('#shell-col-list .ui-chip').count() === 3, '(b) puces Tous / Code actif / Sans code');

    await p.click(`#shell-col-list .ui-row[data-id="${GHOSTS[0].id}"]`);
    check(await p.waitForFunction((u) => location.hash === `#membres/fantomes/${u}`, GHOSTS[0].id, { timeout: 4000 }).then(() => true, () => false), '(b) clic sur Zoé : URL #membres/fantomes/<id>');
    check(await waitVisible(p, '#agh-view .agh-detail') && (await p.textContent('#agh-dh .ui-dhead-t')).includes('Zoé'), '(b) fiche du fantôme : en-tête Zoé');
    check((await p.textContent('#agh-view .agh-code-val')).includes('HG-ABC123'), '(b) code d’invitation affiché');
    check(await p.isVisible('#agh-view [data-agh="copy-code"]') && await p.isVisible('#agh-view [data-agh="invite"]'), '(b) actions du code : copier, générer');

    await p.click('#agh-dh .ui-btn:has-text("Lier à un compte")');
    check(await waitVisible(p, '[data-merge] #agh-merge-sel'), '(b) « Lier à un compte » : panneau de liaison');
    await p.click('[data-merge] [data-agh="merge-cancel"]');
    check(await waitVisible(p, '[data-merge]', false), '(b) liaison annulée');

    await p.click('#shell-col .agh-new');
    check(await p.waitForFunction(() => location.hash === '#membres/fantomes/nouveau', null, { timeout: 4000 }).then(() => true, () => false), '(b) « Nouveau fantôme » : URL #membres/fantomes/nouveau');
    check(await waitVisible(p, '#agh-form') && await p.isVisible('#agh-pseudo'), '(b) formulaire de création affiché');

    check(p.errs.length === 0, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (c) Mobile 390 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 390, height: 844, scenario: SCN });
    await p.click('#shell-tabs .shell-tab[data-dom="membres"]');
    await p.click('#shell-subs a[href="#membres/comptes"]');
    check(await waitRows(p, 8), '(c) mobile : liste des comptes plein écran');
    check(await waitVisible(p, '#app', false) && await p.isVisible('#shell-col'), '(c) mobile : zone masquée tant qu’aucun membre n’est choisi');
    check(await hscroll(p) <= 0, '(c) mobile : pas de défilement horizontal (liste)');
    await p.click(`#shell-col-list .ui-row[data-id="${U(2)}"]`);
    check(await waitVisible(p, '#app') && await waitVisible(p, '#shell-col', false), '(c) mobile : fiche d’Alice, liste masquée');
    check(await p.getAttribute('#zone-back', 'href') === '#membres/comptes', '(c) mobile : retour vers la liste des comptes');
    check(await p.isVisible('#acc-dh .ui-dhead-t') && await hscroll(p) <= 0, '(c) mobile : en-tête de fiche, sans défilement horizontal');
    await p.click('#zone-back');
    check(await waitVisible(p, '#shell-col') && (await hashOf(p)) === '#membres/comptes', '(c) mobile : retour à la liste');

    await goHash(p, '#membres/fantomes');
    check(await waitRows(p, 2) && await waitVisible(p, '#app', false), '(c) mobile : liste des fantômes plein écran');
    await p.click('#shell-col .agh-new');
    check(await waitVisible(p, '#agh-form') && await p.isVisible('#app'), '(c) mobile : « Nouveau fantôme » ouvre le formulaire');
    check(await hscroll(p) <= 0, '(c) mobile : pas de défilement horizontal (formulaire)');
    check(p.errs.length === 0, '(c) mobile : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
