// Parcours : Communication › Assistance et Boîte à idées (liste en colonne 2, détail dans la zone, fiche rapide).
// (a) administrateur 1440 px : compteurs et filtres de la liste, sélection (URL #communication/assistance/<id>),
//     en-tête (statut, « Résoudre »), fil avec zone de réponse, panneau d'infos (fiche rapide, historique, fiche membre),
//     changement de statut écrit en base et compteur de navigation mis à jour, recherche dans la liste.
// (b) Boîte à idées 1440 px : liste, sélection, « Retenir » écrit en base (le badge proposé est refusé), compteur mis à jour.
// (c) mobile 390 px : la liste occupe l'écran ; choisir une demande ouvre le détail, « retour » revient à la liste.
// Faux Supabase (fixtures/fake-sb.mjs, données de scénario S.support / S.ideas). Lancer : node tests/parcours-admin-p2-assistance.cjs
const { ROOT, check, finish, openPage, hscroll, chromium, sleep } = require('./lib/harness.cjs');

const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`; // Alice = U(2), Bruno = U(3) (fixture)

// Données de démonstration : trois demandes (deux ouvertes, dont une sans compte, une traitée) et deux idées
const SCN = {
  support: [
    { id: 'sup-1', user_id: U(2), pseudo: 'Alice', subject: 'Paillettes non créditées',
      message: 'Je suis venu à la sortie IRL de samedi, je n\'ai pas reçu mes Paillettes.', contact: 'alice@ex.ch', status: 'ouverte', discord_sent: true, created_at: new Date(Date.now() - 12 * 60000).toISOString() },
    { id: 'sup-2', user_id: null, pseudo: 'Wae', subject: 'Accès à la page Secret Santa',
      message: 'Le lien m\'affiche une page vide depuis hier.', contact: null, status: 'ouverte', discord_sent: false, created_at: new Date(Date.now() - 60 * 60000).toISOString() },
    { id: 'sup-3', user_id: U(2), pseudo: 'Alice', subject: 'Question sur le tirage',
      message: 'Est-ce que le tirage est définitif ?', contact: 'alice@ex.ch', status: 'traitee', discord_sent: true, created_at: new Date(Date.now() - 86400000).toISOString() },
  ],
  ideas: [
    { id: 'idea-1', user_id: U(3), body: 'Une soirée jeux de société au chalet, avec un tournoi de Uno.', status: 'nouvelle', created_at: new Date().toISOString() },
    { id: 'idea-2', user_id: U(2), body: 'Un calendrier de l\'avent des sorties.', status: 'retenue', created_at: new Date(Date.now() - 3600000).toISOString() },
  ],
};

// Ouvre une sous-section (route #domaine/sous-section[/id]) et attend que sa liste ou son détail soit affiché.
async function goto(p, hash, sel) {
  await p.evaluate((h) => { location.hash = h; }, hash);
  await p.waitForFunction((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel, { timeout: 6000 }).catch(() => {});
  await sleep(250);
}
const rows = (p) => p.locator('#shell-col-list .ui-row').count();
const navCount = (p, sub) => p.evaluate((s) => document.querySelector(`.nav-count[data-count="${s}"]`)?.textContent?.trim() || '', sub);
const dbRows = (p, table) => p.evaluate((t) => window.__DB[t].map((r) => ({ ...r })), table);

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* (a) Assistance, 1440 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: SCN });
    await goto(p, '#communication/assistance', '#shell-col-list .ui-row');

    check(await p.getAttribute('.shell', 'data-screen') === 'sub', '(a) 1440 px : écran sous-section (liste et zone côte à côte)');
    check(await p.isVisible('#shell-col-list') && await p.isVisible('#shell-info'), '(a) colonne de liste et panneau d\'infos visibles à 1440 px');
    check(await rows(p) === 3, '(a) liste : trois demandes (Toutes)');
    check((await navCount(p, 'assistance')) === '2', '(a) compteur de sous-section : 2 demandes ouvertes');
    const chips = await p.locator('#shell-col-list .ui-chip').allTextContents();
    check(chips.some((t) => /Ouvertes\s*2/.test(t)) && chips.some((t) => /Traitées\s*1/.test(t)), '(a) filtres avec compteurs : Ouvertes 2, Traitées 1 (' + chips.join(' | ') + ')');

    await p.click('#shell-col-list .ui-chip[data-filter="traitee"]');
    check(await rows(p) === 1, '(a) filtre « Traitées » : une ligne');
    await p.click('#shell-col-list .ui-chip[data-filter="all"]');
    check(await rows(p) === 3, '(a) filtre « Toutes » : trois lignes');

    await p.fill('#shell-col-list input[type="search"]', 'secret');
    await sleep(400);
    check(await rows(p) === 1, '(a) recherche « secret » : une ligne (Accès à la page Secret Santa)');
    await p.fill('#shell-col-list input[type="search"]', '');
    await sleep(400);

    // Sélection : l'URL suit l'élément choisi
    await p.click('#shell-col-list .ui-row[data-id="sup-1"]');
    await p.waitForFunction(() => location.hash === '#communication/assistance/sup-1', null, { timeout: 4000 }).catch(() => {});
    check(await p.evaluate(() => location.hash) === '#communication/assistance/sup-1', '(a) clic sur une ligne : URL #communication/assistance/sup-1');
    await p.waitForSelector('#support-root .ui-dhead-t', { timeout: 4000 }).catch(() => {});
    check((await p.textContent('#support-root .ui-dhead-t')).trim() === 'Paillettes non créditées', '(a) en-tête : titre de la demande');
    check(await p.inputValue('#support-root .ui-dhead select') === 'ouverte', '(a) en-tête : statut « ouverte » sélectionné');
    check((await p.textContent('#support-root .ui-dhead-actions [data-primary]')).includes('Résoudre'), '(a) en-tête : bouton « Résoudre »');
    check((await p.textContent('#support-root .ui-thread-log')).includes('je n\'ai pas reçu mes Paillettes'), '(a) fil : message initial de la demande');
    check(await p.isVisible('#support-root .ui-composer'), '(a) fil : zone de réponse visible (réponse publique et note interne)');
    check(await p.locator('#support-root .ui-msg').count() === 1, '(a) fil : un seul message');

    // Panneau d'infos : fiche rapide, historique des demandes du même membre, fiche membre
    await p.waitForSelector('#shell-info .ui-fact', { timeout: 4000 }).catch(() => {});
    const facts = await p.locator('#shell-info .ui-fact').count();
    check(facts === 4, '(a) panneau d\'infos : fiche rapide en 4 chiffres (' + facts + ')');
    check((await p.textContent('#shell-info .ui-info-name')).trim() === 'Alice', '(a) panneau d\'infos : nom du membre');
    check((await p.locator('#shell-info .ui-hist li').count()) === 1, '(a) historique : la demande traitée du même membre');
    check((await p.textContent('#shell-info .ui-linkbtn')).includes('Ouvrir la fiche membre'), '(a) panneau d\'infos : « Ouvrir la fiche membre » pour un compte');

    // Demande d'un visiteur sans compte : pas de fiche à ouvrir
    await goto(p, '#communication/assistance/sup-2', '#support-root .ui-dhead-t');
    await sleep(200);
    check(await p.locator('#shell-info .ui-linkbtn').count() === 0, '(a) demande sans compte : pas de lien vers une fiche membre');
    check((await p.textContent('#support-root .ui-dhead-t')).trim() === 'Accès à la page Secret Santa', '(a) changement de sélection via l\'URL');

    // Résoudre : écrit en base, compteur de navigation mis à jour
    await p.click('#support-root .ui-dhead-actions [data-primary]');
    await p.waitForFunction(() => window.__DB.hg_support.find((r) => r.id === 'sup-2')?.status === 'traitee', null, { timeout: 4000 }).catch(() => {});
    const sup2 = (await dbRows(p, 'hg_support')).find((r) => r.id === 'sup-2');
    check(sup2?.status === 'traitee', '(a) « Résoudre » : statut « traitee » écrit en base');
    await p.waitForFunction(() => document.querySelector('.nav-count[data-count="assistance"]')?.textContent?.trim() === '1', null, { timeout: 4000 }).catch(() => {});
    check((await navCount(p, 'assistance')) === '1', '(a) après résolution : compteur de navigation à 1');
    await p.waitForFunction(() => /Rouvrir/.test(document.querySelector('#support-root .ui-dhead-actions')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
    check((await p.textContent('#support-root .ui-dhead-actions [data-primary]')).includes('Rouvrir'), '(a) après résolution : bouton « Rouvrir »');

    // Retour à l'état ouvert : le statut se change aussi depuis le sélecteur de l'en-tête
    await p.selectOption('#support-root .ui-dhead select', 'ouverte');
    await p.waitForFunction(() => window.__DB.hg_support.find((r) => r.id === 'sup-2')?.status === 'ouverte', null, { timeout: 4000 }).catch(() => {});
    check((await dbRows(p, 'hg_support')).find((r) => r.id === 'sup-2')?.status === 'ouverte', '(a) sélecteur de statut : « ouverte » écrit en base');

    // Fiche membre : ouvre #membres/comptes/<id>, Précédent revient à la demande
    await goto(p, '#communication/assistance/sup-1', '#support-root .ui-dhead-t');
    await p.waitForSelector('#shell-info .ui-linkbtn', { timeout: 4000 }).catch(() => {});
    await p.click('#shell-info .ui-linkbtn');
    await p.waitForFunction(() => location.hash.startsWith('#membres/comptes/'), null, { timeout: 4000 }).catch(() => {});
    check((await p.evaluate(() => location.hash)).startsWith('#membres/comptes/'), '(a) « Ouvrir la fiche membre » : URL #membres/comptes/<id>');
    await p.waitForSelector('#acc-dh .ui-dhead-t', { timeout: 5000 }).catch(() => {});
    check(await p.isVisible('#acc-dh .ui-dhead-t') && (await p.textContent('#acc-dh .ui-dhead-t')).includes('Alice'), '(a) « Ouvrir la fiche membre » : la fiche d’Alice s’affiche');
    await p.goBack();
    await p.waitForFunction(() => location.hash === '#communication/assistance/sup-1', null, { timeout: 4000 }).catch(() => {});
    check(await p.evaluate(() => location.hash) === '#communication/assistance/sup-1', '(a) Précédent : retour à la demande sélectionnée');

    check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.context().close();
  }

  /* (b) Boîte à idées, 1440 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: SCN });
    await goto(p, '#communication/idees', '#shell-col-list .ui-row');
    check(await rows(p) === 2, '(b) liste : deux idées (Toutes)');
    check((await navCount(p, 'idees')) === '1', '(b) compteur : une idée nouvelle');
    check(await p.isHidden('#shell-info'), '(b) pas de panneau d\'infos pour la boîte à idées');

    await p.click('#shell-col-list .ui-row[data-id="idea-1"]');
    await p.waitForFunction(() => location.hash === '#communication/idees/idea-1', null, { timeout: 4000 }).catch(() => {});
    check(await p.evaluate(() => location.hash) === '#communication/idees/idea-1', '(b) clic : URL #communication/idees/idea-1');
    await p.waitForSelector('#ideas-root .ui-dhead-t', { timeout: 4000 }).catch(() => {});
    check((await p.textContent('#ideas-root .ui-dhead-s')).includes('Bruno'), '(b) en-tête : auteur et date');
    check((await p.textContent('#ideas-root .ui-thread-log')).includes('tournoi de Uno'), '(b) fil : texte de l\'idée');
    check(await p.isHidden('#ideas-root .ui-composer'), '(b) fil en lecture seule');

    // « Retenir » : le statut part en base ; la proposition de badge est refusée (Annuler)
    await p.click('#ideas-root [data-primary]');
    await p.waitForSelector('dialog[open]', { timeout: 4000 }).catch(() => {});
    await p.click('dialog[open] button:has-text("Annuler")').catch(() => {});
    await p.waitForFunction(() => window.__DB.hg_ideas.find((r) => r.id === 'idea-1')?.status === 'retenue', null, { timeout: 4000 }).catch(() => {});
    check((await dbRows(p, 'hg_ideas')).find((r) => r.id === 'idea-1')?.status === 'retenue', '(b) « Retenir » : statut « retenue » écrit en base');
    await p.waitForFunction(() => document.querySelector('.nav-count[data-count="idees"]')?.hidden !== false, null, { timeout: 4000 }).catch(() => {});
    check(await p.isHidden('.nav-count[data-count="idees"]'), '(b) après « Retenir » : plus d\'idée nouvelle, compteur masqué');
    check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.context().close();
  }

  /* (c) Mobile 390 px : liste plein écran, puis détail avec retour */
  {
    const p = await openPage(browser, { page: 'admin', width: 390, height: 844, scenario: SCN });
    await goto(p, '#communication/assistance', '#shell-col-list .ui-row');
    check(await p.getAttribute('.shell', 'data-screen') === 'list', '(c) mobile : liste plein écran (pas de détail sans demande choisie)');
    check(await p.isHidden('#app'), '(c) mobile : zone principale masquée sur l\'écran liste');
    check(await rows(p) === 3, '(c) mobile : trois demandes dans la liste');
    await p.click('#shell-col-list .ui-row[data-id="sup-1"]');
    await p.waitForFunction(() => location.hash === '#communication/assistance/sup-1', null, { timeout: 4000 }).catch(() => {});
    await p.waitForSelector('#support-root .ui-dhead-t', { timeout: 4000 }).catch(() => {});
    check(await p.getAttribute('.shell', 'data-screen') === 'sub', '(c) mobile : écran détail après choix d\'une demande');
    check(await p.isVisible('#support-root .ui-thread-log'), '(c) mobile : fil visible');
    check((await p.getAttribute('#zone-back', 'href')) === '#communication/assistance', '(c) mobile : retour vers la liste');
    check(await p.isVisible('#zone-back'), '(c) mobile : bouton retour visible');
    const hs = await hscroll(p);
    check(hs <= 0, `(c) mobile : pas de défilement horizontal (${hs})`);
    check(!p.errs.length, '(c) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.context().close();
  }

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
