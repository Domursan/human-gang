// Parcours : Vue d'ensemble du panel (Pilotage, #pilotage/apercu) après la réorganisation (migration 103) : admin/overview.js,
// assets/css/admin-accueil.css. Faux Supabase (fixtures/fake-sb.mjs : hg_admin_shortcuts_get / _set).
// (a) 1280 px : rail gardé, colonne masquée (classe admin-home), pas de tuiles de domaine ; « Mes raccourcis » avec les six
//     défauts (Assistance, Boîte à idées, Enchères, Secret Santa, Sorties IRL, Comptes) et leur compteur ; la file
//     « À traiter » dans l'ordre ; un seul élément déplié ; « Marquer comme traitée » ; dialogue « Ajouter un raccourci » :
//     recherche, cases, ordre (monter, descendre), Échap ferme et rend le focus, « Enregistrer » appelle
//     hg_admin_shortcuts_set puis redessine ; un raccourci mène à sa sous-section, coquille normale.
// (b) Échec d'enregistrement : le dialogue reste ouvert, un message d'erreur, aucun raccourci ajouté.
// (c) 390 px : une colonne (chiffres, raccourcis, file), deux colonnes pour chiffres et raccourcis, cibles ≥ 44 px, dialogue
//     dans l'écran, pas de défilement horizontal, barre d'onglets du bas présente.
// Captures : tests/shots/admin-reorg-1280.png (Vue d'ensemble), admin-reorg-dialogue.png (dialogue), admin-reorg-390.png.
// Lancer : node tests/parcours-admin-accueil.cjs
const fs = require('fs');
const path = require('path');
const { SHOTS, check, finish, openPage, hscroll, log, chromium } = require('./lib/harness.cjs');

/** Identifiant de test du membre n (U(2) = Alice, comme dans le faux client). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
/** Date de il y a n heures (format ISO). */
const il_y_a = (n) => new Date(Date.now() - n * 36e5).toISOString();
/** Données de départ : deux demandes ouvertes, un échange de cartes proposé, une idée nouvelle. */
const SCN = {
  support: [
    { id: 'sup-a', status: 'ouverte', user_id: U(3), pseudo: null, subject: 'Booster Doré introuvable', message: 'Alex a ouvert un booster Doré hier soir, mais il n’apparaît plus dans sa collection.', contact: null, created_at: il_y_a(3), updated_at: il_y_a(3) },
    { id: 'sup-b', status: 'ouverte', user_id: null, pseudo: 'Noa', subject: 'Connexion bloquée', message: 'Je n’arrive pas à me connecter après l’inscription.', contact: null, created_at: il_y_a(1), updated_at: il_y_a(1) },
  ],
  trades: [{ id: 'tr-1', status: 'proposee' }],
  ideas: [{ id: 'idea-1', status: 'nouvelle', user_id: U(2), body: 'Une page pour voir les anniversaires du mois.', created_at: il_y_a(2) }],
};
/** Raccourcis par défaut (aucun choix enregistré), dans l'ordre. */
const DEFAUTS = ['Assistance', 'Boîte à idées', 'Enchères', 'Secret Santa', 'Sorties IRL', 'Comptes'];

/** Vrai si l'élément correspondant au sélecteur est affiché (taille non nulle). */
const visible = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);
/** Titres des éléments de la file, dans l'ordre affiché. */
const titres = (p) => p.$$eval('#ov-todo .ov-q-item .ov-q-title', (x) => x.map((t) => t.textContent.trim()));
/** Noms des raccourcis affichés, dans l'ordre. */
const raccourcis = (p) => p.$$eval('#ov-shortcuts .ov-sc-name', (x) => x.map((t) => t.textContent.trim()));
/** Noms des lignes de la liste « Ordre » du dialogue, dans l'ordre. */
const ordre = (p) => p.$$eval('#ov-sc-order .ov-order-name', (x) => x.map((t) => t.textContent.trim()));
/** Attend que la file affiche le nombre d'éléments voulu (ou la limite de temps). */
const attendreFile = (p, n) => p.waitForFunction((k) => document.querySelectorAll('#ov-todo .ov-q-item').length === k, n, { timeout: 8000 }).catch(() => {});
/** Attend que la liste des raccourcis affiche les noms voulus (ou la limite de temps). */
const attendreRaccourcis = (p, noms) => p.waitForFunction((n) => {
  const t = [...document.querySelectorAll('#ov-shortcuts .ov-sc-name')].map((x) => x.textContent.trim());
  return t.length === n.length && t.every((x, i) => x === n[i]);
}, noms, { timeout: 8000 }).catch(() => {});
/** Vrai si le dialogue « Ajouter un raccourci » est ouvert. */
const dialogueOuvert = (p) => p.evaluate(() => document.getElementById('ov-dialog').open);

(async () => {
  const browser = await chromium.launch();
  fs.mkdirSync(SHOTS, { recursive: true });
  try {
    /* (a) Bureau 1280 px */
    {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: SCN });
      await attendreFile(p, 5);
      await attendreRaccourcis(p, DEFAUTS);
      check(await p.evaluate(() => document.getElementById('shell').classList.contains('admin-home')), '(a) accueil : classe admin-home sur la coquille');
      check(await visible(p, '#shell-rail') && !(await visible(p, '#shell-col')), '(a) accueil : rail gardé, colonne de navigation masquée');
      check(await p.evaluate(() => document.getElementById('app').getBoundingClientRect().width) >= 1200, '(a) accueil : zone principale pleine largeur');
      check(await p.locator('.ov-tile, #ov-tiles, #ov-tabs, .ov-tabs').count() === 0, '(a) plus de tuiles de domaine ni d’onglets Domaines / À traiter');
      check(JSON.stringify(await raccourcis(p)) === JSON.stringify(DEFAUTS), '(a) raccourcis par défaut : ' + DEFAUTS.join(', '));
      check((await p.textContent('#ov-shortcuts')).includes('+') && await p.locator('#ov-shortcuts [data-ov-add]').count() === 1, '(a) tuile « + Ajouter un raccourci » en pointillés');
      const tuileAssist = p.locator('#ov-shortcuts .ov-sc[href="#pilotage/assistance"]');
      check(await tuileAssist.count() === 1 && (await tuileAssist.textContent()).includes('2 à traiter'), '(a) tuile Assistance : compteur « 2 à traiter »');
      check(await p.locator('#ov-shortcuts .ov-sc[href="#pilotage/idees"] .ov-sc-count').count() === 1, '(a) tuile Boîte à idées : compteur (une idée)');
      check(await p.locator('#ov-shortcuts .ov-sc[href="#cartes/encheres"] .ov-sc-count').count() === 0, '(a) tuile sans élément à traiter : pas de compteur');
      check((await p.textContent('#ov-shortcuts .ov-sc[href="#pilotage/idees"] .ov-sc-path')).trim() === 'Pilotage › Assistance', '(a) chemin discret « Pilotage › Assistance » (groupe de la boîte à idées)');
      check((await p.textContent('#ov-short-title')).trim() === 'Mes raccourcis' && (await p.textContent('#ov')).includes('Tes raccourcis ne sont visibles que par toi.'), '(a) titre « Mes raccourcis » et note de confidentialité');
      check(await p.locator('#ov-todo .ov-q-item').count() === 5, '(a) file : deux demandes, une alerte économie, un échange, une idée');
      check(JSON.stringify(await titres(p)) === JSON.stringify(['Booster Doré introuvable', 'Connexion bloquée', '1 alerte économie', '1 échange en attente', 'Une page pour voir les anniversaires du mois.']),
        '(a) file : assistance (la plus ancienne d’abord), puis économie, échanges, idées');
      check((await p.textContent('#ov-todo-head')).includes('5 éléments'), '(a) en-tête de la file : « 5 éléments »');
      check(await p.locator('#ov-todo .ov-q-item').first().evaluate((el) => el.classList.contains('is-open')), '(a) le premier élément est déplié');
      check(await p.locator('#ov-todo .ov-q-item.is-open').count() === 1, '(a) un seul élément déplié');
      check(await p.locator('#ov-todo a[href="#pilotage/assistance/sup-a"]').count() === 1, '(a) déplié : « Répondre » mène à la demande (Pilotage › Assistance)');
      check(await p.locator('#ov-todo [data-ov-done="sup-a"]').count() === 1, '(a) déplié : « Marquer comme traitée » pour une demande');
      check(await p.locator('#ov-todo .ov-q-item[data-dom="pilotage"]').count() === 3, '(a) pastilles : domaine Pilotage sur les demandes et l’idée');
      check(await p.locator('#ov-todo .ov-q-item[data-dom="irl"]').count() === 0 && await p.locator('#ov-todo .ov-q-item[data-dom="cartes"]').count() === 2, '(a) pastilles : économie et échanges dans Le jeu de cartes');
      check(await p.evaluate(() => document.querySelectorAll('#stats .stat').length) > 0, '(a) chiffres clés (#stats) toujours affichés');
      check(await hscroll(p) === 0, '(a) pas de défilement horizontal');
      await p.screenshot({ path: path.join(SHOTS, 'admin-reorg-1280.png') });

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
      check(await p.locator('#ov-shortcuts .ov-sc[href="#pilotage/assistance"]').textContent().then((t) => t.includes('1 à traiter')), '(a) tuile Assistance : une demande restante');
      check(!(await p.isVisible('#ov-todo [data-ov-done="sup-a"]')), '(a) après traitement : bouton disparu');
      check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));

      // Dialogue « Ajouter un raccourci » (Modifier)
      await p.click('[data-ov-edit]');
      await p.waitForFunction(() => document.getElementById('ov-dialog').open, null, { timeout: 5000 }).catch(() => {});
      check(await dialogueOuvert(p), '(a) « Modifier » ouvre le dialogue');
      check((await p.textContent('#ov-dialog-title')).trim() === 'Ajouter un raccourci', '(a) dialogue : titre « Ajouter un raccourci »');
      check(await p.evaluate(() => document.activeElement?.id === 'ov-sc-q'), '(a) dialogue : le focus va sur la recherche');
      check(JSON.stringify(await ordre(p)) === JSON.stringify(DEFAUTS), '(a) dialogue : ordre = raccourcis actuels');
      check(await p.locator('#ov-dialog input[type="checkbox"]:checked').count() === DEFAUTS.length, '(a) dialogue : une case cochée par raccourci actuel');
      check(await p.locator('#ov-dialog .ov-pick-group').count() === 6, '(a) dialogue : toutes les pages permises, groupées par domaine (6)');
      check(await p.locator('#ov-sc-order [data-ov-move="-1"]').first().isDisabled() && await p.locator('#ov-sc-order [data-ov-move="1"]').last().isDisabled(), '(a) dialogue : pas de montée pour le premier, pas de descente pour le dernier');
      check(await p.evaluate(() => document.getElementById('ov-dialog').querySelector('#ov-sc-groups').getClientRects().length > 0), '(a) dialogue : liste des pages affichée');
      await p.screenshot({ path: path.join(SHOTS, 'admin-reorg-dialogue.png') });

      // Recherche : « sutom » ne montre que la page du jeu, puis la recherche est effacée
      await p.fill('#ov-sc-q', 'sutom');
      check(await p.locator('#ov-dialog .ov-pick-group').count() === 1 && (await p.textContent('#ov-sc-groups')).includes('Sutom du gang'), '(a) recherche « sutom » : une seule page proposée');
      await p.fill('#ov-sc-q', '');
      check(await p.locator('#ov-dialog .ov-pick-group').count() === 6, '(a) recherche effacée : toutes les pages');

      // Ajouter Sutom (en fin), le monter d'un cran, retirer Comptes
      await p.check('#ov-dialog input[value="sutom"]');
      check(JSON.stringify(await ordre(p)) === JSON.stringify([...DEFAUTS, 'Sutom du gang']), '(a) cocher Sutom l’ajoute en fin d’ordre');
      await p.click('#ov-sc-order .ov-order-item:last-child [data-ov-move="-1"]');
      check(JSON.stringify(await ordre(p)) === JSON.stringify([...DEFAUTS.slice(0, 5), 'Sutom du gang', 'Comptes']), '(a) « Monter » déplace Sutom avant Comptes');
      check(await p.evaluate(() => document.activeElement?.dataset.id === 'sutom'), '(a) après « Monter », le focus reste sur le bouton de la ligne');
      await p.uncheck('#ov-dialog input[value="comptes"]');
      const attendu = [...DEFAUTS.slice(0, 5), 'Sutom du gang'];
      check(JSON.stringify(await ordre(p)) === JSON.stringify(attendu), '(a) décocher Comptes le retire de l’ordre');

      // Échap ferme le dialogue sans enregistrer, et rend le focus au bouton « Modifier »
      await p.keyboard.press('Escape');
      await p.waitForFunction(() => !document.getElementById('ov-dialog').open, null, { timeout: 5000 }).catch(() => {});
      check(!(await dialogueOuvert(p)), '(a) Échap ferme le dialogue');
      check(await p.evaluate(() => document.activeElement?.matches('[data-ov-edit]')), '(a) fermeture : le focus revient au bouton « Modifier »');
      check(!(await log(p)).some((l) => l[0] === 'rpc' && l[1] === 'hg_admin_shortcuts_set'), '(a) Échap : aucun enregistrement');

      // Rouvrir, refaire la sélection, enregistrer
      await p.click('[data-ov-edit]');
      await p.waitForFunction(() => document.getElementById('ov-dialog').open, null, { timeout: 5000 }).catch(() => {});
      check(JSON.stringify(await ordre(p)) === JSON.stringify(DEFAUTS), '(a) rouvrir : la sélection enregistrée (rien) reprend les défauts');
      await p.check('#ov-dialog input[value="sutom"]');
      await p.click('#ov-sc-order .ov-order-item:last-child [data-ov-move="-1"]');
      await p.uncheck('#ov-dialog input[value="comptes"]');
      await p.click('#ov-sc-save');
      await p.waitForFunction(() => !document.getElementById('ov-dialog').open, null, { timeout: 5000 }).catch(() => {});
      const L2 = await log(p);
      const appel = L2.filter((l) => l[0] === 'rpc' && l[1] === 'hg_admin_shortcuts_set');
      check(appel.length === 1, '(a) « Enregistrer » appelle hg_admin_shortcuts_set une fois');
      const ids = ['assistance', 'idees', 'encheres', 'secret-santa', 'sorties', 'sutom'];
      check(appel.length === 1 && JSON.stringify(appel[0][2]?.p_items) === JSON.stringify(ids), '(a) hg_admin_shortcuts_set reçoit les identifiants dans l’ordre choisi : ' + ids.join(', '));
      await attendreRaccourcis(p, [...attendu.slice(0, 5), 'Sutom du gang']);
      check(JSON.stringify(await raccourcis(p)) === JSON.stringify([...attendu.slice(0, 5), 'Sutom du gang']), '(a) après enregistrement : la vue montre les nouveaux raccourcis, dans l’ordre');
      check(await p.locator('#ov-shortcuts .ov-sc[href="#jeux/sutom"]').count() === 1, '(a) la tuile Sutom mène à Autres jeux › Sutom du gang');
      check(!(await p.isVisible('#ov-dialog')), '(a) après enregistrement : le dialogue est fermé');
      check(!p.errs.length, '(a) aucune erreur JS pendant le dialogue' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));

      // Un raccourci mène à sa sous-section, coquille normale
      await p.click('#ov-shortcuts .ov-sc[href="#pilotage/assistance"]');
      await p.waitForFunction(() => location.hash === '#pilotage/assistance', null, { timeout: 5000 }).catch(() => {});
      await p.waitForFunction(() => !!document.querySelector('.shell-sub[aria-current="true"][data-sub="assistance"]'), null, { timeout: 5000 }).catch(() => {});
      check(await p.evaluate(() => !document.getElementById('shell').classList.contains('admin-home')), '(a) sous-section : la coquille reprend (plus admin-home)');
      check(await visible(p, '#shell-rail') && await visible(p, '#shell-col'), '(a) sous-section : rail et colonne de navigation affichés');
      check(await p.locator('#shell-col .shell-sub[aria-current="true"]').count() === 1, '(a) sous-section : entrée active dans la colonne');
      await p.ctx.close();
    }

    /* (b) Enregistrement refusé : le dialogue reste ouvert et le message s'affiche */
    {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { ...SCN, shortcutsFail: true } });
      await attendreFile(p, 5);
      await p.click('[data-ov-edit]');
      await p.waitForFunction(() => document.getElementById('ov-dialog').open, null, { timeout: 5000 }).catch(() => {});
      await p.uncheck('#ov-dialog input[value="comptes"]');
      await p.click('#ov-sc-save');
      await p.waitForFunction(() => [...document.querySelectorAll('.toast.error')].some((x) => x.textContent.includes('non enregistrés')), null, { timeout: 5000 }).catch(() => {});
      const t = await p.evaluate(() => [...document.querySelectorAll('.toast.error')].map((x) => x.textContent).join(' | '));
      check(await dialogueOuvert(p), '(b) enregistrement refusé : le dialogue reste ouvert');
      check(t.includes('non enregistrés'), '(b) enregistrement refusé : message d’erreur affiché');
      check(await p.locator('#ov-shortcuts .ov-sc[href="#membres/comptes"]').count() === 1, '(b) enregistrement refusé : les raccourcis ne changent pas');
      check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
      await p.ctx.close();
    }

    /* (c) Téléphone 390 px */
    {
      const p = await openPage(browser, { page: 'admin', width: 390, height: 844, mobile: true, dpr: 2, scenario: SCN });
      await attendreFile(p, 5);
      await attendreRaccourcis(p, DEFAUTS);
      check(await visible(p, '#shell-tabs'), '(c) barre d’onglets des domaines (bas de l’écran) toujours présente');
      check(await p.locator('#ov-tab-domains, #ov-tab-todo, .ov-tabs').count() === 0, '(c) plus d’onglets Domaines / À traiter : une seule colonne');
      const rect = (sel) => p.evaluate((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, w: r.width }; }, sel);
      const stats = await rect('#stats'), sc = await rect('#ov-shortcuts'), todo = await rect('#ov-todo-card');
      check(stats.bottom <= sc.top + 1 && sc.bottom <= todo.top + 1, '(c) ordre : chiffres clés, puis raccourcis, puis la file');
      const colonnes = (sel) => p.evaluate((s) => getComputedStyle(document.querySelector(s)).gridTemplateColumns.split(' ').length, sel);
      check(await colonnes('#stats') === 2, '(c) chiffres clés en grille de 2');
      check(await colonnes('#ov-shortcuts .ov-sc-grid') === 2, '(c) raccourcis en grille de 2');
      const tailles = await p.$$eval('#ov-shortcuts .ov-sc, #ov-shortcuts .ov-sc-add, [data-ov-edit]', (els) => els.map((e) => e.getBoundingClientRect().height));
      check(tailles.every((h) => h >= 44), `(c) cibles tactiles ≥ 44 px (${tailles.map(Math.round).join(', ')})`);
      check(await hscroll(p) === 0, '(c) pas de défilement horizontal');
      await p.screenshot({ path: path.join(SHOTS, 'admin-reorg-390.png') });
      await p.tap('[data-ov-edit]');
      await p.waitForFunction(() => document.getElementById('ov-dialog').open, null, { timeout: 5000 }).catch(() => {});
      const d = await rect('#ov-dialog');
      check(await dialogueOuvert(p) && d.w <= 390 && d.h <= 844, `(c) dialogue dans l’écran (${Math.round(d.w)} × ${Math.round(d.h)} px)`);
      check(await hscroll(p) === 0, '(c) dialogue ouvert : pas de défilement horizontal');
      await p.tap('#ov-dialog [data-ov-dialog-close]');
      check(!(await dialogueOuvert(p)), '(c) bouton × ferme le dialogue');
      check(!p.errs.length, '(c) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
      await p.ctx.close();
    }
  } catch (e) {
    check(false, 'arrêt sur erreur : ' + e.message.split('\n')[0]);
  } finally {
    await browser.close();
  }
  finish();
})();
