// Parcours : Membres › Comptes en liste + détail (phase 2 de la coquille, option C).
// (a) ordinateur 1440 px : liste en colonne 2 (recherche, puces Actifs / Staff / Fantômes / Toutes, Actifs par défaut),
//     fiche dans la zone principale, onglet suivi par l'URL, résumé à droite, actions rapides, Échap ferme la fiche,
//     Précédent fonctionne.
// (c) mobile 390 px : liste plein écran, fiche avec bouton retour vers la liste, pas de défilement horizontal.
// Les fantômes dans Comptes (fiche, liaison, tiroirs) : tests/parcours-admin-comptes-fantomes.cjs.
// Faux Supabase (fixtures/fake-sb.mjs) avec deux fantômes fournis par le scénario. Lancer : node tests/parcours-admin-p2-comptes.cjs
const { ROOT, check, finish, openPage, hscroll, chromium } = require('./lib/harness.cjs');

/* ---------- Aides de test ---------- */
/** Identifiant de test du membre n (U(2) = Alice, comme dans le faux client). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const DAY = 864e5; // fantômes préparés il y a 1 et 2 jours : plus récents que les comptes du faux Supabase
const GHOSTS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000101', pseudo: 'Zoé', avatar_url: null, joined_on: '2025-06-01', created_at: new Date(Date.now() - DAY).toISOString(), invite_code: 'HG-ABC123', invite_expires_at: '2099-01-01T00:00:00Z', ghost_note: 'Ami de Bruno' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000102', pseudo: 'Théo', avatar_url: null, joined_on: null, created_at: new Date(Date.now() - 2 * DAY).toISOString(), invite_code: null, invite_expires_at: null, ghost_note: null },
];
const SCN = { ghosts: GHOSTS };

// Attend qu'un élément soit visible (ou masqué) après un changement de route.
/** Attend que sel soit visible (want vrai) ou caché (want faux). */
async function waitVisible(p, sel, want = true) {
  await p.waitForFunction(([s, w]) => {
    const e = document.querySelector(s);
    const vis = !!e && e.getClientRects().length > 0;
    return vis === w;
  }, [sel, want], { timeout: 6000 }).catch(() => {});
  return p.isVisible(sel).then((v) => v === want);
}
/** Adresse (hash) courante de la page. */
const hashOf = (p) => p.evaluate(() => location.hash);
/** Change l'adresse de la page (hash), comme un clic sur un lien. */
const goHash = (p, h) => p.evaluate((x) => { location.hash = x; }, h);
/** Nombre de lignes visibles dans la colonne liste. */
const rowCount = (p) => p.$$eval('#shell-col-list .ui-row', (rs) => rs.filter((r) => r.getClientRects().length).length);
/** Attend que la colonne liste affiche n lignes visibles. */
const waitRows = (p, n) => p.waitForFunction((k) => [...document.querySelectorAll('#shell-col-list .ui-row')].filter((r) => r.getClientRects().length).length === k, n, { timeout: 8000 }).then(() => true, () => false);

/* ---------- Scénario ---------- */
(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* (a) Comptes, ordinateur 1440 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: SCN });
    await goHash(p, '#place/comptes');
    check(await waitRows(p, 6), `(a) liste des comptes : filtre Actifs par défaut, 6 membres (${await rowCount(p)})`);
    check(await p.getAttribute('#shell-col-list .ui-chip[data-filter="active"]', 'aria-pressed') === 'true', '(a) puce « Actifs » active par défaut');
    const firstRow = await p.getAttribute('#shell-col-list .ui-row', 'data-id');
    check(firstRow === U(6), `(a) tri : le compte le plus récent (Emma) en tête (${firstRow})`);
    check(await p.isVisible('#shell-col') && await p.isVisible('#shell-col-list .ui-search'), '(a) recherche dans la colonne 2');
    check(await p.locator('#shell-col-list .ui-chip').count() === 4, '(a) puces Actifs / Staff / Fantômes / Toutes');
    check(await p.isVisible('#acc-root .acc-empty') && (await hashOf(p)) === '#place/comptes', '(a) sans sélection : zone principale invite à choisir un membre');

    await p.click('#shell-col-list .ui-chip[data-filter="ghost"]');
    check(await rowCount(p) === 2, '(a) puce « Fantômes » : deux lignes');
    await p.click('#shell-col-list .ui-chip[data-filter="all"]');
    check(await rowCount(p) === 8, '(a) puce « Toutes » : huit lignes');
    check(await p.getAttribute('#shell-col-list .ui-row', 'data-id') === GHOSTS[0].id, '(a) tri : fantôme le plus récent (Zoé) en tête de « Toutes »');
    await p.click('#shell-col-list .ui-chip[data-filter="active"]');
    check(await rowCount(p) === 6, '(a) retour sur « Actifs » : six lignes');

    await p.fill('#shell-col-list input[type="search"]', 'alic');
    await p.waitForTimeout(400);
    check(await rowCount(p) === 1, '(a) recherche « alic » : Alice seule');
    await p.press('#shell-col-list input[type="search"]', 'Escape');
    await p.waitForTimeout(300);
    check(await rowCount(p) === 6, '(a) Échap dans la recherche : liste complète du filtre Actifs (six lignes)');

    await p.click(`#shell-col-list .ui-row[data-id="${U(2)}"]`);
    check(await p.waitForFunction((u) => location.hash === `#place/comptes/${u}`, U(2), { timeout: 6000 }).then(() => true, () => false), '(a) clic sur Alice : URL #place/comptes/<id>');
    check(await waitVisible(p, '#acc-dh .ui-dhead-t') && (await p.textContent('#acc-dh .ui-dhead-t')).includes('Alice'), '(a) en-tête de fiche : Alice (composant commun)');
    check(await p.locator('#acc-root .acc-tab').count() === 8, '(a) huit onglets de fiche');
    check(await waitVisible(p, '#shell-info') && await p.locator('#shell-info .ui-facts .ui-fact').count() === 6, '(a) panneau d’infos : résumé à six repères');
    const labels = await p.$$eval('#shell-info .ui-fact span', (ss) => ss.map((s) => s.textContent));
    check(['Paillettes', 'Cartes', 'Sorties IRL', 'Secret Santa', 'Badges', 'Rôle'].every((l) => labels.includes(l)), `(a) résumé : Paillettes, Cartes, Sorties, Secret Santa, Badges, Rôle (${labels.join(' / ')})`);

    await p.click('#acc-root .acc-tab[data-tab="badges"]');
    check(await p.waitForFunction((u) => location.hash === `#place/comptes/${u}/badges`, U(2), { timeout: 4000 }).then(() => true, () => false), '(a) onglet Badges : l’URL suit l’onglet');
    check(await p.getAttribute('#acc-root .acc-tab[data-tab="badges"]', 'aria-selected') === 'true', '(a) onglet Badges sélectionné');

    await p.locator('#shell-info .ui-linkbtn', { hasText: 'Secret Santa' }).click();
    check(await p.waitForFunction((u) => location.hash === `#place/comptes/${u}/ss`, U(2), { timeout: 4000 }).then(() => true, () => false), '(a) action rapide « Secret Santa » du résumé : onglet Secret Santa');

    // Adresse directe avec onglet
    await goHash(p, `#place/comptes/${U(3)}/irl`);
    check(await waitVisible(p, '#acc-root .acc-tab[data-tab="irl"][aria-selected="true"]'), '(a) adresse directe avec onglet : Bruno, onglet Sorties IRL');
    check((await p.textContent('#acc-dh .ui-dhead-t')).includes('Bruno'), '(a) adresse directe : en-tête de Bruno');

    // Échap ferme la fiche ; Précédent revient à la fiche précédente
    await p.keyboard.press('Escape');
    check(await p.waitForFunction(() => location.hash === '#place/comptes', null, { timeout: 4000 }).then(() => true, () => false), '(a) Échap : retour à la liste (URL #place/comptes)');
    check(await waitVisible(p, '#acc-root .acc-empty'), '(a) Échap : zone principale vide');
    await p.goBack();
    check(await p.waitForFunction((u) => location.hash.startsWith(`#place/comptes/${u}`), U(3), { timeout: 4000 }).then(() => true, () => false), '(a) Précédent : fiche de Bruno rouverte');

    // Bouton « Fermer la fiche » de l'en-tête
    await p.click('#acc-dh .ui-btn:has-text("Fermer la fiche")');
    check(await p.waitForFunction(() => location.hash === '#place/comptes', null, { timeout: 4000 }).then(() => true, () => false), '(a) « Fermer la fiche » : retour à la liste');

    check(p.errs.length === 0, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (c) Mobile 390 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 390, height: 844, scenario: SCN });
    await p.click('.shell-tab[data-lieu="place"]');
    await p.evaluate((h) => { location.hash = h; }, '#place/comptes');
    check(await waitRows(p, 6), '(c) mobile : liste des comptes plein écran');
    check(await waitVisible(p, '#app', false) && await p.isVisible('#shell-col'), '(c) mobile : zone masquée tant qu’aucun membre n’est choisi');
    check(await hscroll(p) <= 0, '(c) mobile : pas de défilement horizontal (liste)');
    await p.click(`#shell-col-list .ui-row[data-id="${U(2)}"]`);
    check(await waitVisible(p, '#app') && await waitVisible(p, '#shell-col', false), '(c) mobile : fiche d’Alice, liste masquée');
    check(await p.getAttribute('#zone-back', 'href') === '#place/comptes', '(c) mobile : retour vers la liste des comptes');
    check(await p.isVisible('#acc-dh .ui-dhead-t') && await hscroll(p) <= 0, '(c) mobile : en-tête de fiche, sans défilement horizontal');
    await p.click('#zone-back');
    check(await waitVisible(p, '#shell-col') && (await hashOf(p)) === '#place/comptes', '(c) mobile : retour à la liste');
    check(p.errs.length === 0, '(c) mobile : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
