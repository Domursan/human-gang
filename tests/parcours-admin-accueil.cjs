// Parcours : accueil « Vue d'ensemble » du panel (Pilotage, #pilotage/apercu) en deux moitiés (admin/overview.js,
// assets/css/admin-accueil.css). Faux Supabase (fixtures/fake-sb.mjs).
// (a) 1280 px : rail et colonne masqués (classe admin-home), six tuiles, file « À traiter » dans l'ordre (demandes les plus
//     anciennes d'abord, échange, idée), premier élément déplié, un seul déplié à la fois, filtre par tuile et puce « × »,
//     « Marquer comme traitée » (écriture hg_support, la file se redessine), lien d'une tuile : coquille normale.
// (b) 390 px : onglets « Domaines » / « À traiter (n) », « À traiter » ouvert par défaut, un seul panneau visible,
//     filtre depuis l'onglet Domaines, cibles ≥ 44 px, pas de défilement horizontal, barre d'onglets du bas présente.
// Captures : tests/shots/admin-accueil-1280.png et tests/shots/admin-accueil-390.png.
// Lancer : node tests/parcours-admin-accueil.cjs
const fs = require('fs');
const path = require('path');
const { SHOTS, check, finish, openPage, hscroll, log, chromium } = require('./lib/harness.cjs');

/** Identifiant de test du membre n (U(2) = Alice, comme dans le faux client). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
/** Date de il y a n heures (format ISO). */
const il_y_a = (n) => new Date(Date.now() - n * 36e5).toISOString();
/** Données de départ : deux demandes ouvertes, une échange de cartes proposé, une idée nouvelle. */
const SCN = {
  support: [
    { id: 'sup-a', status: 'ouverte', user_id: U(3), pseudo: null, subject: 'Booster Doré introuvable', message: 'Alex a ouvert un booster Doré hier soir, mais il n’apparaît plus dans sa collection.', contact: null, created_at: il_y_a(3), updated_at: il_y_a(3) },
    { id: 'sup-b', status: 'ouverte', user_id: null, pseudo: 'Noa', subject: 'Connexion bloquée', message: 'Je n’arrive pas à me connecter après l’inscription.', contact: null, created_at: il_y_a(1), updated_at: il_y_a(1) },
  ],
  trades: [{ id: 'tr-1', status: 'proposee' }],
  ideas: [{ id: 'idea-1', status: 'nouvelle', user_id: U(2), body: 'Une page pour voir les anniversaires du mois.', created_at: il_y_a(2) }],
};

/** Vrai si l'élément correspondant au sélecteur est affiché (taille non nulle). */
const visible = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);
/** Titres des éléments de la file, dans l'ordre affiché. */
const titres = (p) => p.$$eval('#ov-todo .ov-q-item .ov-q-title', (x) => x.map((t) => t.textContent.trim()));
/** Attend que la file affiche le nombre d'éléments voulu (ou la limite de temps). */
const attendreFile = (p, n) => p.waitForFunction((k) => document.querySelectorAll('#ov-todo .ov-q-item').length === k, n, { timeout: 8000 }).catch(() => {});

(async () => {
  const browser = await chromium.launch();
  fs.mkdirSync(SHOTS, { recursive: true });
  try {
    /* (a) Bureau 1280 px */
    {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: SCN });
      await attendreFile(p, 5);
      check(await p.evaluate(() => document.getElementById('shell').classList.contains('admin-home')), '(a) accueil : classe admin-home sur la coquille');
      check(await visible(p, '#shell-rail') && !(await visible(p, '#shell-col')), '(a) accueil : rail gardé, colonne de navigation masquée');
      check(await p.evaluate(() => document.getElementById('app').getBoundingClientRect().width) >= 1200, '(a) accueil : zone principale pleine largeur');
      check(await p.locator('#ov-tiles .ov-tile').count() === 6, '(a) six tuiles, une par domaine');
      check(await p.locator('#ov-tiles .ov-tile-links a').count() === 18, '(a) trois raccourcis par domaine (18 liens)');
      check((await p.textContent('#ov-tiles')).includes('Tout voir'), '(a) chaque tuile a « Tout voir »');
      check(await p.locator('#ov-todo .ov-q-item').count() === 5, '(a) file : deux demandes, une alerte économie, un échange, une idée');
      check(JSON.stringify(await titres(p)) === JSON.stringify(['Booster Doré introuvable', 'Connexion bloquée', '1 alerte économie', '1 échange en attente', 'Une page pour voir les anniversaires du mois.']),
        '(a) file : assistance (la plus ancienne d’abord), puis économie, échanges, idées');
      check((await p.textContent('#ov-todo-head')).includes('5 sur 5'), '(a) en-tête de la file : « 5 sur 5 »');
      check(await p.locator('#ov-todo .ov-q-item').first().evaluate((el) => el.classList.contains('is-open')), '(a) le premier élément est déplié');
      check(await p.locator('#ov-todo .ov-q-item.is-open').count() === 1, '(a) un seul élément déplié');
      check(await p.locator('#ov-todo a[href="#communication/assistance/sup-a"]').count() === 1, '(a) déplié : « Répondre » mène à la demande');
      check(await p.locator('#ov-todo [data-ov-done="sup-a"]').count() === 1, '(a) déplié : « Marquer comme traitée » pour une demande');
      check(await p.locator('#ov-todo .ov-q-item[data-dom="communication"]').count() === 3, '(a) pastilles : domaine Communication sur les demandes et l’idée');
      check(await p.evaluate(() => document.querySelectorAll('#stats .stat').length) > 0, '(a) chiffres clés (#stats) toujours affichés');
      check(await hscroll(p) === 0, '(a) pas de défilement horizontal');
      await p.screenshot({ path: path.join(SHOTS, 'admin-accueil-1280.png') });

      // Filtre par tuile : Jeux et cartes (un échange), puis Vie du gang (rien)
      await p.click('[data-ov-filter="cartes"]');
      check(await p.getAttribute('[data-ov-filter="cartes"]', 'aria-pressed') === 'true', '(a) tuile Jeux et cartes : filtre actif (aria-pressed)');
      check(await p.locator('#ov-tiles .ov-tile.is-on').count() === 1, '(a) tuile filtrée mise en avant');
      check(await p.locator('#ov-todo .ov-q-item').count() === 2 && (await p.textContent('#ov-todo-head')).includes('2 sur 5'), '(a) filtre : l’alerte et l’échange, « 2 sur 5 »');
      check(await p.locator('#ov-todo-head .ov-chip').count() === 1 && (await p.textContent('#ov-todo-head .ov-chip')).includes('Jeux et cartes'), '(a) filtre : puce « Jeux et cartes × »');
      check(await p.locator('#ov-todo .ov-q-item').first().evaluate((el) => el.classList.contains('is-open')), '(a) filtre : le premier élément filtré est déplié');
      await p.click('[data-ov-filter="vie"]');
      check((await p.textContent('#ov-todo')).includes('Rien à traiter dans ce domaine.'), '(a) filtre sans élément : « Rien à traiter dans ce domaine. »');
      await p.click('#ov-todo-head .ov-chip');
      check(await p.locator('#ov-todo-head .ov-chip').count() === 0 && await p.locator('#ov-todo .ov-q-item').count() === 5, '(a) puce « × » : filtre retiré, file complète');
      check(await p.getAttribute('[data-ov-filter="vie"]', 'aria-pressed') === 'false', '(a) tuile : plus de filtre actif');

      // Un seul élément déplié à la fois
      await p.click('#ov-todo .ov-q-item:nth-child(2) .ov-q-head');
      check(await p.getAttribute('#ov-todo .ov-q-item:nth-child(2) .ov-q-head', 'aria-expanded') === 'true'
        && await p.getAttribute('#ov-todo .ov-q-item:nth-child(1) .ov-q-head', 'aria-expanded') === 'false', '(a) un clic déplie l’élément choisi et replie le premier');
      check(await p.locator('#ov-todo .ov-q-item.is-open').count() === 1, '(a) toujours un seul élément déplié');
      await p.click('#ov-todo .ov-q-item:nth-child(1) .ov-q-head');
      check(await p.getAttribute('#ov-todo .ov-q-item:nth-child(1) .ov-q-head', 'aria-expanded') === 'true', '(a) redéplier le premier');

      // Marquer comme traitée : écriture sur hg_support, la demande quitte la file
      await p.click('#ov-todo [data-ov-done="sup-a"]');
      await attendreFile(p, 4);
      const L = await log(p);
      check(L.some((l) => l[0] === 'update' && l[1] === 'hg_support' && l[2]?.status === 'traitee'), '(a) « Marquer comme traitée » : mise à jour hg_support (status traitee)');
      check(JSON.stringify(await titres(p)) === JSON.stringify(['Connexion bloquée', '1 alerte économie', '1 échange en attente', 'Une page pour voir les anniversaires du mois.']),
        '(a) après traitement : la demande a quitté la file');
      check(await p.locator('#ov-todo .ov-q-item').first().evaluate((el) => el.classList.contains('is-open')), '(a) après traitement : le premier élément restant est déplié');
      check((await p.textContent('#ov-tiles')).includes('1 demande ouverte'), '(a) tuile Communication : une demande ouverte restante');
      check(!(await p.isVisible('#ov-todo [data-ov-done="sup-a"]')), '(a) après traitement : bouton disparu');
      check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));

      // Un lien de tuile mène à la sous-section, avec la coquille habituelle
      await p.click('[data-dom="communication"] .ov-tile-links a[href="#communication/assistance"]');
      await p.waitForFunction(() => location.hash === '#communication/assistance', null, { timeout: 5000 }).catch(() => {});
      await p.waitForFunction(() => !!document.querySelector('.shell-sub[aria-current="true"][data-sub="assistance"]'), null, { timeout: 5000 }).catch(() => {});
      check(await p.evaluate(() => !document.getElementById('shell').classList.contains('admin-home')), '(a) sous-section : la coquille reprend (plus admin-home)');
      check(await visible(p, '#shell-rail') && await visible(p, '#shell-col'), '(a) sous-section : rail et colonne de navigation affichés');
      check(await p.locator('#shell-col .shell-sub[aria-current="true"]').count() === 1, '(a) sous-section : entrée active dans la colonne');
      await p.ctx.close();
    }

    /* (b) Téléphone 390 px */
    {
      const p = await openPage(browser, { page: 'admin', width: 390, height: 844, mobile: true, dpr: 2, scenario: SCN });
      await attendreFile(p, 5);
      check(await visible(p, '#ov-tab-domains') && await visible(p, '#ov-tab-todo'), '(b) deux onglets visibles : Domaines et À traiter');
      check(await p.getAttribute('#ov-tab-todo', 'aria-selected') === 'true', '(b) « À traiter » ouvert par défaut');
      check((await p.textContent('#ov-tab-todo')).includes('(5)'), '(b) onglet « À traiter (5) »');
      check(await visible(p, '#ov-todo-card') && !(await visible(p, '#ov-pane-domains')), '(b) un seul panneau visible : la file');
      const tailles = await p.$$eval('#ov-tab-domains, #ov-tab-todo, #ov-todo .ov-q-head', (els) => els.map((e) => e.getBoundingClientRect().height));
      check(tailles.every((h) => h >= 44), `(b) cibles tactiles ≥ 44 px (${tailles.map(Math.round).join(', ')})`);
      check(await visible(p, '#shell-tabs'), '(b) barre d’onglets des domaines (bas de l’écran) toujours présente');
      await p.tap('#ov-tab-domains');
      check(await visible(p, '#ov-pane-domains') && !(await visible(p, '#ov-todo-card')), '(b) onglet Domaines : tuiles affichées, file masquée');
      check(await p.locator('#ov-tiles .ov-tile').count() === 6 && await visible(p, '#ov-tiles .ov-tile'), '(b) six tuiles visibles');
      await p.tap('[data-ov-filter="cartes"]');
      check(await p.getAttribute('[data-ov-filter="cartes"]', 'aria-pressed') === 'true', '(b) filtre par tuile depuis l’onglet Domaines');
      await p.tap('#ov-tab-todo');
      check(await visible(p, '#ov-todo-card') && await p.locator('#ov-todo .ov-q-item').count() === 2 && await visible(p, '#ov-todo-head .ov-chip'),
        '(b) onglet À traiter : élément filtré et puce de filtre');
      await p.tap('#ov-todo-head .ov-chip');
      check(await p.locator('#ov-todo .ov-q-item').count() === 5, '(b) puce « × » : file complète');
      check(await hscroll(p) === 0, '(b) pas de défilement horizontal');
      check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
      await p.screenshot({ path: path.join(SHOTS, 'admin-accueil-390.png') });
      await p.ctx.close();
    }
  } catch (e) {
    check(false, 'arrêt sur erreur : ' + e.message.split('\n')[0]);
  } finally {
    await browser.close();
  }
  finish();
})();
