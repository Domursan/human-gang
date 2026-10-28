// Parcours : coquille du panel admin (en-tête unique, plateau, pages de lieu, fil d'Ariane, barre du bas, routage).
// (a) administrateur 1440 px : pas de rail ni de colonne de navigation ; en-tête unique (« Tout le panel », « Voir le site »,
//     avatar) ; plateau par défaut ; URL directe #place/comptes ; ancienne ancre #cartes redirigée ; fil d'Ariane
//     « Plateau › Lieu › Page » ; précédent/suivant du navigateur ; route inconnue ramenée à une route permise.
// (b) Staff { cartes, journal } : seuls ses lieux sur le plateau ; une route interdite retombe sur une page permise.
// (c) mobile 375 px : barre du bas (Plateau et lieux), liste « Comptes » plein écran puis fiche, retour, sans défilement.
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours/admin/parcours-admin-coquille.cjs
const { ROOT, check, finish, openPage, hscroll, sleep, chromium } = require('../../lib/harness.cjs');

/* ---------- Aides de test ---------- */
/** Identifiant de test du membre n (U(2) = Alice, comme dans le faux client). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
/** Adresse (hash) courante de la page. */
const hashOf = (p) => p.evaluate(() => location.hash);
/** Fil d'Ariane, espaces normalisés (« Plateau › Lieu › Page »). */
const crumbOf = (p) => p.evaluate(() => document.getElementById('zone-crumb').textContent.replace(/\s*›\s*/g, ' › ').replace(/\s+/g, ' ').trim());
/** Attend que la page courante soit affichée (route dans data-route, section visible). */
async function waitRoute(p, route) {
  await p.waitForFunction((r) => document.getElementById('shell')?.dataset.route === r, route, { timeout: 5000 }).catch(() => {});
  await sleep(150);
  return (await p.evaluate(() => document.getElementById('shell').dataset.route)) === route;
}
/** Lignes de la barre du bas (data-lieu ou data-route). */
const tabsOf = (p) => p.$$eval('#shell-tabs .shell-tab', (as) => as.map((a) => a.dataset.lieu || a.dataset.route));

/* ---------- Scénario ---------- */
(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* (a) Administrateur, ordinateur 1440 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900 });
    check((await hashOf(p)) === '#plateau', `(a) route par défaut : ${await hashOf(p)}`);
    check(await p.isVisible('#plateau-root') && (await p.textContent('#zone-title')).trim() === 'Plateau', '(a) plateau affiché, titre « Plateau »');
    check(await p.locator('#shell-rail').count() === 0 && await p.locator('#shell-subs').count() === 0, '(a) pas de rail ni de colonne de domaines');
    check(!(await p.isVisible('#shell-col')), '(a) plateau : pas de colonne de liste');
    check(await p.locator('.site-header').count() === 0 && await p.locator('.site-footer').count() === 0, '(a) en-tête et pied du site absents');
    check(await p.isVisible('#shell-top') && await p.isVisible('#shell-avatar'), '(a) en-tête unique avec le menu du compte');
    check((await p.textContent('#shell-top')).includes('Tout le panel'), '(a) en-tête : « Tout le panel »');
    check(!(await p.isVisible('#shell-tabs')), '(a) ordinateur : pas de barre du bas');
    check(await p.isVisible('#shell-god'), '(a) bouton Mode sans limite dans l’en-tête (administrateur)');
    check((await p.evaluate(() => document.querySelectorAll('.plateau-lieu').length)) === 7, '(a) plateau : 7 lieux');

    // Lieu, puis page : fil d'Ariane et retour
    await p.evaluate(() => { location.hash = '#place'; });
    await sleep(300);
    check((await hashOf(p)) === '#place' && (await p.textContent('#zone-title')).trim() === 'La Place du gang', `(a) #place : page du lieu (${await hashOf(p)})`);
    check((await p.evaluate(() => document.querySelectorAll('#lieu-root .lieu-tile').length)) === 14, '(a) page de La Place : 14 tuiles');
    await p.evaluate(() => { location.hash = '#place/invitations'; });
    check(await waitRoute(p, 'place/invitations'), '(a) sous-section Invitations affichée');
    check((await p.textContent('#zone-title')).trim() === 'Invitations', '(a) titre de zone : Invitations');
    check((await crumbOf(p)) === 'Plateau › La Place du gang › Invitations', `(a) fil d’Ariane : ${await crumbOf(p)}`);
    check(await p.isVisible('#zone-back') && (await p.getAttribute('#zone-back', 'href')) === '#place', '(a) bouton retour vers le lieu');

    // Précédent / suivant du navigateur
    await p.goBack();
    check((await hashOf(p)) === '#place', `(a) précédent du navigateur -> ${await hashOf(p)}`);
    await p.goForward();
    check(await waitRoute(p, 'place/invitations') && (await hashOf(p)) === '#place/invitations', `(a) suivant du navigateur -> ${await hashOf(p)}`);
    await p.click('#zone-crumb a[href="#plateau"]');
    check(await waitRoute(p, 'plateau') && (await hashOf(p)) === '#plateau', `(a) fil d’Ariane « Plateau » -> ${await hashOf(p)}`);
    await p.ctx.close();
  }
  {
    // URL directe, ancienne ancre et route inconnue
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, hash: '#place/comptes' });
    check(await waitRoute(p, 'place/comptes') && (await p.textContent('#zone-title')).trim() === 'Comptes', '(a) URL directe #place/comptes');
    await p.evaluate(() => { location.hash = '#cartes'; });
    await p.waitForFunction(() => location.hash === '#fabrique/cartes', null, { timeout: 5000 }).catch(() => {});
    check((await hashOf(p)) === '#fabrique/cartes', `(a) ancienne ancre #cartes redirigée (${await hashOf(p)})`);
    check(await waitRoute(p, 'fabrique/cartes') && await p.isVisible('#cards-root .acd'), '(a) Jeu de cartes affiché dans la zone principale');
    await p.evaluate(() => { location.hash = '#reglages'; });
    await p.waitForFunction(() => location.hash === '#mairie/identite', null, { timeout: 5000 }).catch(() => {});
    check((await hashOf(p)) === '#mairie/identite', `(a) ancienne ancre #reglages -> #mairie/identite (${await hashOf(p)})`);
    await p.evaluate(() => { location.hash = '#inconnu'; });
    await p.waitForFunction(() => location.hash !== '#inconnu', null, { timeout: 5000 }).catch(() => {});
    check((await hashOf(p)) !== '#inconnu' && (await hashOf(p)).length > 1, `route inconnue -> route permise (${await hashOf(p)})`);
    check(p.errs.length === 0, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (b) Staff { cartes, journal } */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: { uid: U(2), staff: ['cartes', 'journal'] } });
    check(p.url().split('#')[0].endsWith('/pages/admin/admin.html'), '(b) Staff : /pages/admin/admin.html s’ouvre');
    const lieux = await p.$$eval('.plateau-lieu', (as) => as.map((a) => a.getAttribute('href')));
    check(JSON.stringify(lieux) === JSON.stringify(['#ventes', '#fabrique', '#mairie']), `(b) Staff : lieux sur le plateau = ${lieux.join(' ')}`);
    check(!(await p.isVisible('#shell-god')), '(b) Staff : pas de mode sans limite');
    await p.evaluate(() => { location.hash = '#mairie/journal'; });
    check(await waitRoute(p, 'mairie/journal') && await p.isVisible('#journal'), '(b) Staff : Journal affiché');
    check(!(await p.isVisible('#staff')), '(b) Staff : section Staff absente');
    await p.evaluate(() => { location.hash = '#place/comptes'; });
    await p.waitForFunction(() => !location.hash.startsWith('#place'), null, { timeout: 5000 }).catch(() => {});
    check(!(await hashOf(p)).startsWith('#place/comptes'), `(b) Staff : route interdite redirigée (${await hashOf(p)})`);
    check(await p.locator('#comptes').count() === 1 && !(await p.isVisible('#comptes')), '(b) Staff : Comptes jamais affichée');
    check(p.errs.length === 0, '(b) Staff : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (c) Mobile 375 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 375, height: 812 });
    check(await p.isVisible('#shell-tabs'), '(c) mobile : barre du bas visible');
    const tabs = await tabsOf(p);
    check(tabs[0] === 'plateau' && tabs.length === 8, `(c) mobile : Plateau et 7 lieux (${tabs.join(', ')})`);
    check((await p.evaluate(() => document.querySelectorAll('.plateau-lieu').length)) === 7, '(c) mobile : 7 cartes sur le plateau');
    await p.click('.shell-tab[data-lieu="place"]');
    await p.waitForFunction(() => location.hash.startsWith('#place'), null, { timeout: 5000 }).catch(() => {});
    check((await hashOf(p)).startsWith('#place'), `(c) mobile : lieu La Place ouvert (${await hashOf(p)})`);
    await p.evaluate(() => { location.hash = '#place/comptes'; });
    check(await waitRoute(p, 'place/comptes'), '(c) mobile : Comptes affiché');
    // Comptes est une liste + détail : sur mobile, la liste occupe l'écran tant qu'aucun membre n'est choisi
    // Titre de page visible au-dessus de la liste (revue R6, M1) ; le contenu de la page reste masqué
    check(await waitRoute(p, 'place/comptes') && await p.isVisible('#shell-col') && !(await p.isVisible('#shell-groups')), '(c) mobile : liste des comptes plein écran (contenu de page masqué)');
    check((await p.textContent('#zone-title')).trim() === 'Comptes' && await p.isVisible('#zone-title'), '(c) mobile : titre « Comptes » visible en haut de la liste');
    check(await p.isVisible('#shell-tabs') && (await hashOf(p)) === '#place/comptes', '(c) mobile : barre du bas toujours visible');
    const hs = await hscroll(p);
    check(hs <= 0, `(c) mobile : pas de défilement horizontal (${hs})`);
    await p.click('#shell-col-list .ui-row');
    await sleep(300);
    check(await p.isVisible('#zone-back') && (await hashOf(p)).startsWith('#place/comptes/'), `(c) mobile : fiche du membre choisie (${await hashOf(p)})`);
    await p.click('#zone-back');
    await sleep(300);
    check((await hashOf(p)) === '#place/comptes' && await p.isVisible('#shell-col'), '(c) mobile : retour à la liste des comptes');
    check(p.errs.length === 0, '(c) mobile : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
