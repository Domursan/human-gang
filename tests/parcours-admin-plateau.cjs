// Parcours : plateau d'action du panel (admin.html) : accueil par défaut, 7 lieux, page de lieu avec tuiles, fil d'Ariane
// et retour, anciennes adresses, Staff partiel, téléphone 390 px sans défilement horizontal, aucune erreur JavaScript.
// (a) administrateur : #plateau par défaut, 7 lieux en cartes ; ouverture de La Fabrique de cartes (18 tuiles) ; une tuile
//     mène à la page (fil « Plateau › Lieu › Page », retour au lieu) ; le fil ramène au plateau.
// (b) anciennes adresses : #pilotage/…, #membres/…, #irl/…, #event/…, #cartes/…, #jeux/…, #comptes, #apercu, #reglages.
// (c) Staff { cartes, journal } : seuls les lieux permis (Mairie, Fabrique, Salle des ventes) sont sur le plateau.
// (d) téléphone 390 px : barre du bas (Plateau et lieux), pas de défilement horizontal ; captures tests/shots/.
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours-admin-plateau.cjs
const path = require('path');
const { ROOT, SHOTS, check, finish, openPage, hscroll, sleep, chromium } = require('./lib/harness.cjs');

// Adresse finale après redirection (le routeur remplace le fragment sans nouvelle entrée d'historique).
const settle = async (p) => { await sleep(350); return p.evaluate(() => location.hash); };

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* (a) Administrateur : plateau, page de lieu, tuile, fil d'Ariane */
  {
    const p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
    check((await settle(p)) === '#plateau', '(a) accueil par défaut : #plateau');
    const cartes = await p.$$eval('.plateau-lieu', (as) => as.map((a) => a.getAttribute('href')));
    check(JSON.stringify(cartes) === JSON.stringify(['#place', '#poste', '#ventes', '#camp', '#fabrique', '#fete', '#mairie']),
      `(a) 7 lieux sur le plateau : ${cartes.join(' ')}`);
    check(await p.isVisible('#plateau-root') && await p.isVisible('#zone-title'), '(a) plateau visible, titre de zone');
    check((await p.textContent('#zone-crumb')).trim() === 'Plateau', '(a) fil d’Ariane du plateau : Plateau');
    check(!(await p.isVisible('#zone-back')), '(a) pas de bouton retour sur le plateau');
    check(await p.$('.shell-col:not([hidden])') === null && await p.$('.shell-tabs:visible') === null, '(a) ordinateur : ni colonne de navigation, ni barre du bas');

    await p.click('.plateau-lieu[href="#fabrique"]');
    await sleep(400);
    check((await p.evaluate(() => location.hash)) === '#fabrique', '(a) clic sur La Fabrique de cartes : #fabrique');
    check((await p.textContent('#zone-title')).trim() === 'La Fabrique de cartes', '(a) titre de la page de lieu');
    const tuiles = await p.$$eval('.lieu-tile', (as) => as.length);
    check(tuiles === 18, `(a) page de lieu : 18 tuiles (${tuiles})`);
    const groupes = await p.$$eval('.lieu-group-title', (hs) => hs.map((h) => h.textContent.trim()));
    check(JSON.stringify(groupes) === JSON.stringify(['Agir', 'Arène', 'Catalogue', 'Suivi', 'Économie', 'Animations']),
      `(a) groupes de la page : ${groupes.join(', ')}`);
    await p.waitForFunction(() => !document.querySelector('.lieu-todo-box')?.textContent.includes('Chargement'), null, { timeout: 5000 }).catch(() => {});
    const todo = await p.textContent('.lieu-todo-box');
    check(!todo.includes('Chargement') && (todo.includes('Rien à faire ici pour l’instant.') || todo.includes('Diamant')),
      `(a) « À faire » : alerte économie du fixture ou message d’attente (${todo.trim().slice(0, 60)})`);
    const aide = await p.textContent('.lieu-tile[data-sub="defis"] .lieu-tile-help');
    check(aide.trim() === 'Objectifs collectifs', `(a) ligne d’aide de la tuile Défis : « ${aide.trim()} »`);

    await p.click('.lieu-tile[data-sub="defis"]');
    await sleep(500);
    check((await p.evaluate(() => location.hash)) === '#fabrique/defis', '(a) tuile Défis : #fabrique/defis');
    check(await p.isVisible('#defis'), '(a) la section Défis est affichée');
    check((await p.textContent('#zone-crumb')).replace(/\s*›\s*/g, ' › ').replace(/\s+/g, ' ').trim() === 'Plateau › La Fabrique de cartes › Défis du gang',
      '(a) fil d’Ariane : Plateau › La Fabrique de cartes › Défis du gang');
    check((await p.getAttribute('#zone-back', 'href')) === '#fabrique' && await p.isVisible('#zone-back'), '(a) bouton retour vers le lieu');
    await p.click('#zone-back');
    await sleep(400);
    check((await p.evaluate(() => location.hash)) === '#fabrique', '(a) retour : de retour sur la page de La Fabrique');
    await p.click('#zone-crumb a[href="#plateau"]');
    await sleep(400);
    check((await p.evaluate(() => location.hash)) === '#plateau', '(a) fil d’Ariane « Plateau » : retour au plateau');
    const erreurs = p.errs.filter((e) => !/Failed to load|404|favicon/.test(e));
    check(erreurs.length === 0, `(a) aucune erreur JavaScript${erreurs.length ? ' : ' + erreurs.join(' | ') : ''}`);
    await p.screenshot({ path: path.join(SHOTS, 'plateau-1280.png') });
    await p.click('.plateau-lieu[href="#fabrique"]');
    await sleep(400);
    await p.screenshot({ path: path.join(SHOTS, 'lieu-fabrique-1280.png') });
    await p.ctx.close();
  }

  /* (b) Anciennes adresses : chacune mène à la bonne sous-section */
  {
    const anciennes = [
      ['#mairie/planning', '#mairie/planning'], ['#mairie/identite', '#mairie/identite'], ['#mairie/apercu', '#plateau'],
      ['#place/comptes', '#place/comptes'], ['#place/comptes/0000', '#place/comptes'], ['#place/invitations', '#place/invitations'],
      ['#place/badges-criteres', '#place/badges-criteres'], ['#camp/sorties', '#camp/sorties'], ['#camp/secret-santa', '#camp/secret-santa'],
      ['#fete/rdv', '#fete/rdv'], ['#fete/mes-jeux', '#fete/mes-jeux'], ['#fabrique/defis', '#fabrique/defis'],
      ['#ventes/encheres', '#ventes/encheres'], ['#fabrique/joueurs/0000', '#fabrique/joueurs/0000'], ['#comptes', '#place/comptes'],
      ['#apercu', '#plateau'], ['#reglages', '#mairie/identite'], ['#journal', '#mairie/journal'], ['#membres', '#place/invitations'],
      ['#bataille', '#fabrique/arene'], ['#poste/bot', '#poste/bot'],
    ];
    const ko = [];
    for (const [ancienne, attendue] of anciennes) {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, hash: ancienne });
      const finale = await settle(p);
      if (finale !== attendue) ko.push(`${ancienne} -> ${finale} (attendu ${attendue})`);
      await p.ctx.close();
    }
    check(ko.length === 0, `(b) ${anciennes.length} anciennes adresses redirigées${ko.length ? ' : ' + ko.join(' ; ') : ''}`);
  }

  /* (c) Staff { cartes, journal } : seuls ses lieux, dont le Planning (Mairie) */
  {
    const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { uid: '00000002-0000-4000-8000-000000000002', staff: ['cartes', 'journal'] } });
    const lieux = await p.$$eval('.plateau-lieu', (as) => as.map((a) => a.getAttribute('href')));
    check(JSON.stringify(lieux) === JSON.stringify(['#ventes', '#fabrique', '#mairie']), `(c) Staff : lieux permis = ${lieux.join(' ')}`);
    const pages = await p.evaluate(() => [...document.querySelectorAll('#plateau-root [href]')].length);
    check(pages === 3, `(c) pas de lien vers un lieu interdit (${pages} liens)`);
    await p.click('.plateau-lieu[href="#mairie"]');
    await sleep(400);
    const tuilesM = await p.$$eval('.lieu-tile', (as) => as.map((a) => a.dataset.sub));
    check(JSON.stringify(tuilesM) === JSON.stringify(['planning', 'journal']), `(c) La Mairie pour ce Staff : ${tuilesM.join(', ')}`);
    await p.ctx.close();
  }

  /* (d) Téléphone 390 px : barre du bas, pas de défilement horizontal */
  {
    const p = await openPage(browser, { page: 'admin', width: 390, height: 844, mobile: true, dpr: 2 });
    check((await settle(p)) === '#plateau', '(d) téléphone : #plateau par défaut');
    const hs = await hscroll(p);
    check(hs <= 0, `(d) téléphone : pas de défilement horizontal (${hs})`);
    check(await p.isVisible('.shell-tabs'), '(d) téléphone : barre du bas visible');
    const onglets = await p.$$eval('.shell-tab', (as) => as.map((a) => a.dataset.lieu || a.dataset.route));
    check(onglets.length === 8 && onglets[0] === 'plateau', `(d) barre du bas : Plateau et ${onglets.length - 1} lieux`);
    check(await p.isVisible('#zone-title'), '(d) téléphone : titre du plateau visible');
    check((await p.$$eval('.plateau-lieu', (as) => as.length)) === 7, '(d) téléphone : 7 cartes de lieu');
    await p.screenshot({ path: path.join(SHOTS, 'plateau-390.png') });
    await p.click('.plateau-lieu[href="#fete"]');
    await sleep(400);
    const hs2 = await hscroll(p);
    check(hs2 <= 0, `(d) page de lieu au téléphone : pas de défilement horizontal (${hs2})`);
    check((await p.$$eval('.lieu-tile', (as) => as.length)) === 14, '(d) La Fête foraine : 14 tuiles');
    const erreurs = p.errs.filter((e) => !/Failed to load|404|favicon/.test(e));
    check(erreurs.length === 0, `(d) aucune erreur JavaScript${erreurs.length ? ' : ' + erreurs.join(' | ') : ''}`);
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
