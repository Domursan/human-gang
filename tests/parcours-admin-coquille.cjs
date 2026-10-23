// Parcours : coquille du panel admin (rail, colonne de navigation, zone principale, routage, mobile).
// (a) administrateur 1440 px : rail visible, en-tête du site absent, navigation par domaine et sous-section,
//     URL directe #membres/comptes, anciennes ancres #cartes et #reglages redirigées, titres de groupe (sous-menus),
//     précédent/suivant du navigateur.
// (b) Staff { cartes, journal } : seuls Pilotage (Journal) et Jeu de cartes sont proposés ; pas de mode sans limite.
// (c) mobile 375 px : barre d'onglets en bas, écran domaine puis écran sous-section, sans défilement horizontal.
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours-admin-coquille.cjs
const { ROOT, check, finish, openPage, hscroll, chromium } = require('./lib/harness.cjs');

/* ---------- Aides de test ---------- */
/** Identifiant de test du membre n (U(2) = Alice, comme dans le faux client). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;

// Attend qu'un élément soit visible (ou masqué) après un changement de route.
/** Attend que sel soit visible (want vrai) ou caché (want faux). */
async function waitVisible(p, sel, want = true) {
  await p.waitForFunction(([s, w]) => {
    const e = document.querySelector(s);
    const vis = !!e && e.getClientRects().length > 0;
    return vis === w;
  }, [sel, want], { timeout: 5000 }).catch(() => {});
  return p.isVisible(sel).then((v) => v === want);
}
/** Adresse (hash) courante de la page. */
const hashOf = (p) => p.evaluate(() => location.hash);
/** Libellés des domaines visibles dans le rail. */
const visibleDomains = (p) => p.$$eval('#shell-rail .shell-dom', (as) => as.filter((a) => a.getClientRects().length).map((a) => a.dataset.dom));

/* ---------- Scénario ---------- */
(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* (a) Administrateur, ordinateur 1440 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900 });
    check(await p.isVisible('#shell-rail'), '(a) rail visible');
    check(await p.locator('nav[aria-label="Domaines du panel"]').count() === 1, '(a) rail : nav aria-label « Domaines du panel »');
    check((await visibleDomains(p)).length === 6, `(a) six domaines dans le rail (${(await visibleDomains(p)).join(', ')})`);
    check(await p.locator('.site-header').count() === 0 && await p.locator('.site-footer').count() === 0, '(a) en-tête et pied du site absents');
    check(await p.locator('#god-root').count() === 0, '(a) plus de carte « Mode sans limite » dans la page');
    check(await p.isVisible('#shell-god'), '(a) bouton Mode sans limite dans le rail (administrateur)');
    check(/#pilotage\/apercu$/.test(await hashOf(p)), `(a) route par défaut : ${await hashOf(p)}`);
    check(await waitVisible(p, '#apercu'), '(a) Vue d’ensemble affichée par défaut');

    // Navigation par domaine, puis sous-section
    await p.click('#shell-rail .shell-dom[data-dom="membres"]');
    check(await waitVisible(p, '#comptes') && await waitVisible(p, '#apercu', false), '(a) domaine Membres : Comptes affiché, Vue d’ensemble masquée');
    check((await hashOf(p)) === '#membres/comptes', `(a) domaine cliqué -> #membres/comptes (${await hashOf(p)})`);
    check(await p.isVisible('#shell-subs a[href="#membres/comptes"]') && await p.locator('#shell-subs a[href="#membres/fantomes"]').count() === 0, '(a) colonne : sous-sections de Membres (Comptes fantômes fusionnés dans Comptes)');
    check((await p.locator('.shell-sub[aria-current="true"]').textContent()).includes('Comptes'), '(a) sous-section active : Comptes');
    await p.click('#shell-subs a[href="#membres/invitations"]');
    check(await waitVisible(p, '#membres') && await waitVisible(p, '#comptes', false), '(a) sous-section Invitations affichée seule');
    check(await p.isVisible('#zone-title') && (await p.textContent('#zone-title')).trim() === 'Invitations', '(a) titre de zone : Invitations');
    await p.click('#shell-subs a[href="#membres/comptes"]');
    check(await waitVisible(p, '#comptes'), '(a) retour à Comptes : la section reste en mémoire (même élément)');

    // Précédent / suivant du navigateur
    await p.goBack();
    check(await waitVisible(p, '#membres') && (await hashOf(p)) === '#membres/invitations', `(a) précédent du navigateur -> ${await hashOf(p)}`);
    await p.goForward();
    check((await hashOf(p)) === '#membres/comptes', `(a) suivant du navigateur -> ${await hashOf(p)}`);
    await p.ctx.close();
  }
  {
    // URL directe, ancienne ancre et Jeu de cartes
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900 });
    await p.evaluate(() => { location.hash = '#membres/comptes'; });
    check(await waitVisible(p, '#comptes') && await waitVisible(p, '#apercu', false), '(a) URL directe #membres/comptes');
    await p.evaluate(() => { location.hash = '#cartes'; });
    await p.waitForFunction(() => location.hash === '#cartes/cartes', null, { timeout: 5000 }).catch(() => {});
    check((await hashOf(p)) === '#cartes/cartes', `(a) ancienne ancre #cartes redirigée (${await hashOf(p)})`);
    check(await waitVisible(p, '#cartes') && await p.isVisible('#cards-root .acd'), '(a) Jeu de cartes montée dans la zone principale');
    check(await p.locator('#cards-root [data-tab]').count() === 0, '(a) pas d’onglets internes : ce sont des sous-sections');
    await p.click('#shell-subs a[href="#cartes/quetes"]');
    await p.waitForFunction(() => !!document.querySelector('#cards-root [data-act="quest-new"]') || !!document.querySelector('#acd-panel'), null, { timeout: 5000 }).catch(() => {});
    check(await waitVisible(p, '#cartes') && (await hashOf(p)) === '#cartes/quetes', 'Quêtes ouvertes depuis la colonne');
    check(await p.isVisible('[data-act="quest-new"]'), 'Quêtes : contenu de l’onglet affiché');
    // Sous-menus : #reglages (ancienne ancre du formulaire) mène à Site › Identité et textes ; la liste brute garde #site/reglages
    await p.evaluate(() => { location.hash = '#reglages'; });
    await p.waitForFunction(() => location.hash === '#site/identite', null, { timeout: 5000 }).catch(() => {});
    check((await hashOf(p)) === '#site/identite' && await waitVisible(p, '#reglages'), `(a) ancienne ancre #reglages -> #site/identite (${await hashOf(p)})`);
    check((await p.textContent('#zone-eyebrow')).trim() === 'Site · Identité et textes', '(a) en-tête de zone : domaine · titre du groupe');
    check(await p.locator('[data-dom-subs="site"] .shell-subhead').count() === 3, '(a) colonne Site : trois titres de groupe');
    await p.evaluate(() => { location.hash = '#site/reglages'; });
    await p.waitForFunction(() => document.querySelector('.shell-sub[aria-current="true"]')?.dataset.sub === 'reglages', null, { timeout: 5000 }).catch(() => {});
    check((await hashOf(p)) === '#site/reglages' && (await p.textContent('#zone-title')).trim() === 'Clés avancées', '(a) #site/reglages : Clés avancées');
    // ancienne ancre inconnue : retour à la route par défaut
    await p.evaluate(() => { location.hash = '#inconnu'; });
    await p.waitForFunction(() => /^#(pilotage|membres|vie|cartes|communication|site)\//.test(location.hash), null, { timeout: 5000 }).catch(() => {});
    check(/^#(pilotage|membres|vie|cartes|communication|site)\//.test(await hashOf(p)), `route inconnue -> route permise (${await hashOf(p)})`);
    check(p.errs.length === 0, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (b) Staff { cartes, journal } */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: { uid: U(2), staff: ['cartes', 'journal'] } });
    check(p.url().split('#')[0].endsWith('/admin.html'), '(b) Staff : admin.html s’ouvre');
    const doms = await visibleDomains(p);
    check(JSON.stringify(doms) === JSON.stringify(['pilotage', 'cartes']), `(b) Staff : domaines = ${doms.join(', ')}`);
    await p.click('#shell-rail .shell-dom[data-dom="pilotage"]');
    const subs = await p.$$eval('#shell-subs [data-dom-subs]:not([hidden]) .shell-sub', (as) => as.map((a) => a.dataset.sub));
    check(JSON.stringify(subs) === JSON.stringify(['planning', 'journal']), `(b) Staff : Pilotage ne propose que Planning et Journal (${subs.join(', ')})`);
    check((await hashOf(p)) === '#pilotage/planning', `(b) Staff : Pilotage -> #pilotage/planning (${await hashOf(p)})`);
    await p.click('#shell-subs a[href="#pilotage/journal"]');
    check(await waitVisible(p, '#journal'), '(b) Staff : Journal affiché');
    check(await p.locator('#shell-subs a[href="#pilotage/staff"]').count() === 0, '(b) Staff : pas de sous-section Staff');
    check(!(await p.isVisible('#shell-god')) && await p.locator('.god-card').count() === 0, '(b) Staff : pas de mode sans limite');
    check(!(await p.isVisible('#staff')), '(b) Staff : section Staff absente');
    // Une route interdite retombe sur une section permise
    await p.evaluate(() => { location.hash = '#membres/comptes'; });
    await p.waitForFunction(() => location.hash.startsWith('#pilotage/') || location.hash.startsWith('#cartes/'), null, { timeout: 5000 }).catch(() => {});
    check(/^#(pilotage|cartes)\//.test(await hashOf(p)), `(b) Staff : route interdite redirigée (${await hashOf(p)})`);
    check(await p.locator('#comptes').count() === 1 && !(await p.isVisible('#comptes')), '(b) Staff : Comptes jamais affichée');
    check(p.errs.length === 0, '(b) Staff : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (c) Mobile 375 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 375, height: 812 });
    check(await p.isVisible('#shell-tabs'), '(c) mobile : barre d’onglets visible');
    check((await p.$$eval('#shell-tabs .shell-tab', (as) => as.length)) === 6, '(c) mobile : six domaines dans la barre');
    check(!(await p.isVisible('#shell-rail .shell-doms')), '(c) mobile : pas de rail de domaines latéral');
    check(await p.isVisible('#app') && !(await p.isVisible('#shell-col')), '(c) mobile : sans route, la première sous-section s’affiche (écran sous-section)');
    await p.click('#shell-tabs .shell-tab[data-dom="membres"]');
    await p.waitForFunction(() => document.getElementById('shell').dataset.screen === 'domain', null, { timeout: 5000 }).catch(() => {});
    check(await p.isVisible('#shell-col') && await p.isVisible('#shell-subs a[href="#membres/comptes"]'), '(c) mobile : écran Membres, liste des sous-sections');
    await p.click('#shell-subs a[href="#membres/comptes"]');
    // Comptes est une sous-section « liste + détail » : sur mobile, la liste occupe l'écran tant qu'aucun membre n'est choisi
    check(await waitVisible(p, '#shell-col') && await waitVisible(p, '#app', false), '(c) mobile : liste des comptes plein écran (zone masquée)');
    check(await p.isVisible('#shell-tabs') && (await hashOf(p)) === '#membres/comptes', '(c) mobile : barre d’onglets toujours visible');
    const hs = await hscroll(p);
    check(hs <= 0, `(c) mobile : pas de défilement horizontal (${hs})`);
    await p.click('#shell-col-list .ui-row');
    check(await waitVisible(p, '#app') && await waitVisible(p, '#shell-col', false), '(c) mobile : fiche du membre choisi, colonne masquée');
    check(await p.isVisible('#zone-back') && (await p.getAttribute('#zone-back', 'href')) === '#membres/comptes', '(c) mobile : bouton retour vers la liste des comptes');
    check(await waitVisible(p, '#comptes'), '(c) mobile : Comptes affichée');
    await p.click('#zone-back');
    check(await waitVisible(p, '#shell-col') && (await hashOf(p)) === '#membres/comptes', '(c) mobile : retour à la liste des comptes');
    await p.evaluate(() => { location.hash = '#membres/'; });
    check(await waitVisible(p, '#shell-col') && await p.isVisible('#shell-subs a[href="#membres/comptes"]'), '(c) mobile : retour à l’écran du domaine');
    check(p.errs.length === 0, '(c) mobile : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
