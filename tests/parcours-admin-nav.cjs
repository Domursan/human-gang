// Parcours : navigation du panel admin (admin.html) — sous-sections montées à la première visite, liens directs
// #membres/comptes/<id>/<onglet> (et ancienne adresse #comptes/<id>/<onglet>), palette « Aller à… », filtrage Staff de la
// palette, navigation mobile. Sur le faux Supabase (fixtures/fake-sb.mjs).
// (a) au chargement, aucune requête des sections Cartes, Bot et Messagerie ; elles partent à l'ouverture de la sous-section
// (b) #membres/comptes/<id>/<onglet> ouvre la bonne fiche ; #comptes/<id>/<onglet> (ancienne adresse) y est redirigée ;
//     #cartes/quetes ouvre la sous-section ; clic met l'adresse à jour ; Précédent
// (c) Ctrl/Cmd+K ouvre la palette (et pas la recherche du site) ; elle ouvre une sous-section et une fiche ; focus piégé ; Échap
// (d) Staff ['cartes'] : la palette ne propose que les sous-sections permises (« Groupe · Libellé »), sans membres
// (e) 375 px : barre d'onglets des domaines en bas de l'écran, sans défilement horizontal de la page
// Lancer : node tests/parcours-admin-nav.cjs
const { ROOT, check, finish, openPage, adminSection, hscroll, log, chromium, sleep } = require('./lib/harness.cjs');

/** Identifiant de test du membre n, mêmes identifiants que le faux client (Alice, Bruno, Chloé…). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`; // mêmes identifiants que le faux (Alice, Bruno, Chloé…)
const CHLOE = U(4), BRUNO = U(3);
/** Vrai si au moins une entrée du journal satisfait pred. */
const has = (entries, pred) => entries.some(pred);
/** Prédicat pour le journal : entrée touchant la table t. */
const table = (t) => (e) => e[1] === t;
/** Prédicat pour le journal : appel de la fonction RPC fn. */
const rpc = (fn) => (e) => e[0] === 'rpc' && e[1] === fn;

/** Ouvre la palette « Aller à… » (Ctrl+K) et attend qu'elle s'affiche. */
const openPal = async (p) => {
  await p.keyboard.press('Control+k');
  await p.waitForSelector('.apal-backdrop:not([hidden]) [role="dialog"]', { timeout: 5000 });
};
/** Vrai si la palette « Aller à… » est ouverte. */
const palOpen = (p) => p.locator('.apal-backdrop:not([hidden])').count().then((n) => n === 1);
/** Libellés des entrées affichées dans la palette. */
const palLabels = (p) => p.$$eval('.apal-item .apal-label', (els) => els.map((e) => e.textContent.trim()));
// Sous-section affichée : adresse et lien actif de la colonne
/** Attend que l'adresse de la page soit #route. */
const onRoute = (p, route) => p.waitForFunction((r) => location.hash === '#' + r
  && document.querySelector('.shell-sub[aria-current="true"]')?.getAttribute('href') === '#' + r, route, { timeout: 5000 }).then(() => true, () => false);

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  try {

  /* ---------- (a) Chargement à la demande ---------- */
  let p = await openPage(browser, { page: 'admin', width: 1280 });
  let L = await log(p);
  check(!has(L, table('hg_card_sets')) && !has(L, rpc('hg_admin_conversations')) && !has(L, table('hg_bot_log')),
    '(a) au chargement : aucune requête des sections Cartes, Bot ni Messagerie');
  check(await p.locator('#cards-root .acd-tabs').count() === 0 && await p.locator('#bot-root .bot-admin').count() === 0
    && await p.locator('#messages-root .amsg').count() === 0, '(a) Cartes, Bot, Messagerie : pas encore montées');
  check(await p.locator('#shell-parking #cartes').count() === 1, '(a) Cartes : section rangée hors de l\'écran tant que sa sous-section n\'est pas ouverte');
  check(await p.locator('#stats .stat').count() > 0, '(a) vue d\'ensemble : chargée tout de suite (tuiles affichées)');

  await adminSection(p, 'cartes/cartes');
  check(has(await log(p), table('hg_card_sets')), '(a) Cartes : ses requêtes partent à l\'ouverture de la sous-section');
  const beforeBot = (await log(p)).length;
  await adminSection(p, 'communication/bot');
  check(await p.locator('#bot-root .bot-admin').count() === 1 && (await log(p)).length > beforeBot, '(a) Bot : montée et chargée à l\'ouverture de la sous-section');
  await adminSection(p, 'communication/messagerie');
  L = await log(p);
  check(has(L, rpc('hg_admin_conversations')), '(a) Messagerie : ses requêtes partent à l\'ouverture de la sous-section');
  const membersCalls = L.filter(rpc('hg_members')).length;
  await p.evaluate(() => { location.hash = 'pilotage/apercu'; });
  await adminSection(p, 'membres/comptes');
  check((await log(p)).filter(rpc('hg_members')).length <= membersCalls + 1, '(a) donnée partagée (membres) : chargée une fois pour les sections qui l\'utilisent');
  await p.ctx.close();

  /* ---------- (b) Liens directs ---------- */
  p = await openPage(browser, { page: 'admin', width: 1280, hash: `#membres/comptes/${BRUNO}/badges` });
  await p.waitForSelector('#acc-dh .ui-dhead-t', { timeout: 8000 });
  check(await p.textContent('#acc-dh .ui-dhead-t') === 'Bruno', '(b) #membres/comptes/<id>/badges : la fiche de Bruno s\'ouvre');
  check(await p.getAttribute('#acc-tab-badges', 'aria-selected') === 'true', '(b) #membres/comptes/<id>/badges : l\'onglet Badges est sélectionné');

  await p.ctx.close();
  // Ancienne adresse #comptes/<id>/<onglet> : redirigée vers la nouvelle route, la fiche et l'onglet s'ouvrent
  p = await openPage(browser, { page: 'admin', width: 1280, hash: `#comptes/${BRUNO}/badges` });
  await p.waitForSelector('#acc-dh .ui-dhead-t', { timeout: 8000 });
  check(await p.evaluate(() => location.hash) === `#membres/comptes/${BRUNO}/badges`, '(b) ancienne adresse #comptes/<id>/<onglet> : redirigée vers #membres/comptes/<id>/<onglet>');
  check(await p.textContent('#acc-dh .ui-dhead-t') === 'Bruno', '(b) ancienne adresse : la fiche de Bruno s\'ouvre');
  await p.ctx.close();

  p = await openPage(browser, { page: 'admin', width: 1280, hash: '#cartes/quetes' });
  await p.waitForSelector('#acd-panel .acd-item', { timeout: 8000 });
  check(await onRoute(p, 'cartes/quetes'), '(b) #cartes/quetes : la sous-section Quêtes est ouverte (colonne et adresse)');
  check(await p.locator('#acd-panel .acd-item').count() === 5, '(b) #cartes/quetes : les quêtes sont listées');

  await p.ctx.close();
  p = await openPage(browser, { page: 'admin', width: 1280, hash: `#membres/comptes/${'0'.repeat(8)}-0000-4000-8000-000000000000` });
  await p.waitForTimeout(300);
  await p.waitForFunction(() => location.hash === '#membres/comptes', null, { timeout: 5000 }).catch(() => {});
  check(await p.evaluate(() => location.hash) === '#membres/comptes', '(b) identifiant inconnu : l\'adresse revient à la liste des comptes');
  await p.ctx.close();

  // Adresse mise à jour par les clics, Précédent qui y revient
  p = await openPage(browser, { page: 'admin', width: 1280 });
  await adminSection(p, 'membres/comptes');
  await p.click(`#shell-col-list .ui-row[data-id="${CHLOE}"]`);
  await p.waitForFunction((id) => location.hash === '#membres/comptes/' + id, CHLOE, { timeout: 5000 });
  check(true, '(b) clic sur un compte : l\'adresse devient #membres/comptes/<id>');
  await p.click('#acc-tab-infos');
  await p.waitForFunction((id) => location.hash === '#membres/comptes/' + id + '/infos', CHLOE, { timeout: 5000 });
  check(true, '(b) clic sur un onglet : l\'adresse ajoute l\'onglet');
  await p.evaluate(() => { location.hash = 'vie/secret-santa'; });
  await p.waitForFunction(() => location.hash === '#vie/secret-santa');
  await p.goBack();
  await p.waitForFunction(() => location.hash.startsWith('#membres/comptes/'), null, { timeout: 5000 });
  await p.waitForSelector('#acc-tab-infos[aria-selected="true"]', { timeout: 5000 });
  check(await p.textContent('#acc-dh .ui-dhead-t') === 'Chloé', '(b) Précédent : revient à la fiche et à l\'onglet ouverts');
  await p.evaluate(() => { location.hash = 'membres/comptes'; });
  await p.waitForSelector('#shell-col-list .ui-row', { timeout: 5000 });
  check(await p.locator('.acc-tabs').count() === 0, '(b) #membres/comptes : retour à la liste (fiche fermée)');
  await p.ctx.close();

  /* ---------- (c) Palette « Aller à… » ---------- */
  p = await openPage(browser, { page: 'admin', width: 1280 });
  await openPal(p);
  check(await p.locator('dialog[open]').count() === 0, '(c) Ctrl+K : la recherche du site ne s\'ouvre pas en même temps');
  check(await p.getAttribute('.apal', 'role') === 'dialog' && await p.getAttribute('.apal', 'aria-modal') === 'true', '(c) palette : rôle dialogue modal');
  await p.keyboard.press('Tab');
  check(await p.evaluate(() => document.activeElement?.closest('.apal') !== null), '(c) focus piégé : Tab reste dans la palette');
  await p.keyboard.press('Shift+Tab');
  check(await p.evaluate(() => document.activeElement?.id === 'apal-q'), '(c) focus piégé : Maj+Tab revient au champ');
  await p.keyboard.press('Escape');
  check(!(await palOpen(p)), '(c) Échap : la palette se ferme');

  await p.click('#admin-goto');
  check(await palOpen(p), '(c) bouton « Aller à… » du rail : ouvre la palette');
  await p.fill('#apal-q', 'secret');
  await p.waitForSelector('.apal-item:has-text("Secret Santa")', { timeout: 5000 });
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => location.hash === '#vie/secret-santa', null, { timeout: 5000 });
  check(!(await palOpen(p)), '(c) Entrée sur une sous-section : la palette se ferme');
  await p.waitForFunction(() => !!document.querySelector('#shell-groups #secret-santa'), null, { timeout: 8000 });
  check(await p.isVisible('#secret-santa'), '(c) Entrée sur une sous-section : la section est montée et affichée (rangée hors écran avant)');

  await openPal(p);
  await p.fill('#apal-q', 'bruno');
  await p.waitForSelector('.apal-item:has-text("Bruno")', { timeout: 5000 });
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowUp');
  await p.keyboard.press('Enter');
  await p.waitForFunction((id) => location.hash === '#membres/comptes/' + id, BRUNO, { timeout: 5000 });
  await p.waitForSelector('#acc-dh .ui-dhead-t', { timeout: 5000 });
  check(await p.textContent('#acc-dh .ui-dhead-t') === 'Bruno', '(c) Entrée sur un membre : la fiche s\'ouvre');
  await p.close();
  await p.ctx.close();

  /* ---------- (d) Staff : palette limitée aux droits ---------- */
  p = await openPage(browser, { page: 'admin', width: 1280, scenario: { uid: U(2), staff: ['cartes'] } });
  await openPal(p);
  // « Groupe · Libellé » (sous-menus), dans l'ordre de la colonne ; ni Questions du gang [quiz] ni Secrets [reglages]
  const labels = await palLabels(p);
  const attendu = ['Catalogue · Séries', 'Catalogue · Cartes', 'Catalogue · Boosters',
    'Économie · Paillettes et dons', 'Économie · Tirage', 'Économie · Recyclage et fabrication', 'Économie · Limites',
    'Animation · Quêtes', 'Animation · Défis du gang', 'Animation · Drops',
    'Suivi · Joueurs', 'Suivi · Échanges', 'Suivi · Statistiques', 'Jeux · Saisons et soirées'];
  check(JSON.stringify(labels) === JSON.stringify(attendu),
    `(d) Staff ['cartes'] : la palette ne propose que ses sous-sections (${labels.join(' | ')})`);
  await p.fill('#apal-q', 'bruno');
  await sleep(300);
  check(await p.locator('.apal-item').count() === 0 && await p.locator('.apal-empty').count() === 1, '(d) Staff : aucun membre proposé');
  check(!has(await log(p), rpc('hg_members')), '(d) Staff : la liste des membres n\'est pas chargée');
  await p.ctx.close();

  /* ---------- (e) Mobile : navigation par domaines ---------- */
  p = await openPage(browser, { page: 'admin', width: 375 });
  const hs = await hscroll(p);
  check(hs <= 0 && await p.isVisible('#shell-tabs') && (await p.$$eval('#shell-tabs .shell-tab', (as) => as.length)) === 6,
    `(e) 375 px : barre d'onglets des domaines en bas, sans défilement horizontal de la page (hscroll=${hs})`);
  await p.click('#shell-tabs .shell-tab[data-dom="cartes"]');
  await p.waitForFunction(() => /^#cartes\//.test(location.hash), null, { timeout: 5000 }).catch(() => {});
  await p.click('#shell-subs a[href="#cartes/cartes"]');
  await p.waitForFunction(() => location.hash === '#cartes/cartes', null, { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => { const e = document.getElementById('cartes'); return !!e && e.getClientRects().length > 0; }, null, { timeout: 5000 }).catch(() => {});
  check(await p.isVisible('#cartes') && await hscroll(p) <= 0, '(e) 375 px : un domaine puis une sous-section ouvrent la section sans défilement horizontal');
  await p.ctx.close();

  } catch (e) {
    check(false, 'arrêt sur erreur : ' + String(e.message).split('\n')[0]);
  } finally {
    await browser.close();
  }
  finish();
})();
