// Parcours : réglages du site, lot 1 (identité, textes, pages légales, menu, pied de page, intro).
// 1. Scénario avec réglages en base : le site (en-tête, titre, pied, menu, mentions, intro) les applique.
// 2. Admin › Site › Réglages : validation (nom vide refusé), modification du nom et du copyright, enregistrement
//    dans hg_settings (faux client persistant), effet visible sur le site dans le même navigateur.
// 3. Rétablissement par champ puis par groupe : retour aux valeurs d'origine, aucune clé superflue en base.
// 4. Parties (Site › Identité / Textes / Menu / État du site / Clés avancées) : un seul formulaire, seules les valeurs
//    de la partie sont visibles ; enregistrer depuis une partie conserve les autres (menu, état du site) ; une erreur
//    dans une partie masquée est signalée avec un lien vers sa partie.
// Aucune erreur console, pas de défilement horizontal à 390 px. Lancer : node tests/parcours/compte/parcours-reglages-lot1.cjs
const { ORIGIN, PREFIX, check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('../../lib/harness.cjs');

/* ---------- Aides de test ---------- */
const FX = 'fake-sb-reglages.mjs';
const REG = {
  site_identite: { nom: 'Crew Test', copyright: '© {annee} {nom} · essai', editeur: 'Ethan Test', bandeau_cookies: false },
  site_textes: {
    nav_libelles: { 'menu:irl': 'Sorties', 'jeux.html': 'Jeux du gang' },
    footer_liens: [
      { id: 'evenements', label: 'Événements', visible: true }, { id: 'assistance', label: 'Aide', visible: true },
      { id: 'mentions', label: 'Mentions légales', visible: true }, { id: 'confidentialite', label: 'Confidentialité', visible: true },
      { id: 'cookies', label: 'Cookies', visible: false },
    ],
    legal_mentions: 'Paragraphe ajouté par l\'admin.',
  },
};
/** Attend 0,4 s, le temps que l'enregistrement se termine. */
const sleepShort = () => sleep(400);
/** Réglages enregistrés par le faux client (localStorage, clé __fake_settings). */
const storedSettings = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('__fake_settings') || 'null') || []; } catch { return []; } });
/** Valeur enregistrée pour la clé key de hg_settings, ou undefined. */
const overridesOf = async (p, key) => ((await storedSettings(p)).find((r) => r.key === key) || {}).value;

/** Ouvre une partie de Site (identite par défaut : nom, logo, éditeur, mentions) dans le panel admin. */
async function adminGoto(p, route = 'pilotage/identite') {
  await p.goto(`${ORIGIN}${PREFIX}/pages/admin/admin.html`);
  await sleep(1200);
  await adminSection(p, route);
  await p.waitForSelector('#rgi-form', { timeout: 8000 });
  await sleepShort();
}
/** Champ de formulaire du réglage k dans le panel. */
const field = (p, k) => p.locator(`#rgi-${k.replace(/[^a-z0-9]/gi, '-')}`);
/** Clique sur Enregistrer, puis attend un instant. */
const save = async (p) => { await p.click('#rgi-save'); await sleepShort(); };

/* ---------- Scénario ---------- */
(async () => {
  const browser = await chromium.launch();
  try {
    // ---- 1. Le site applique les réglages enregistrés ----
    const p1 = await openPage(browser, { page: 'accueil', fixture: FX, scenario: { reglages: REG } });
    const brand1 = (await p1.textContent('.site-header .brand span')).trim();
    check(brand1 === 'CREW TEST', `en-tête : nom du site appliqué (« ${brand1} »)`);
    check((await p1.title()).includes('Crew Test'), `titre de page : « ${await p1.title()} »`);
    const copy1 = (await p1.textContent('.site-footer > .container > div')).trim();
    check(copy1 === `© ${new Date().getFullYear()} Crew Test · essai`, `pied : copyright avec {annee} et {nom} (« ${copy1} »)`);
    const footLinks = await p1.$$eval('.site-footer nav a', (as) => as.map((a) => a.textContent.trim()));
    check(footLinks.includes('Aide') && footLinks.includes('Mentions légales') && !footLinks.includes('Cookies'), `pied : libellés et lien masqué (${footLinks.join(' | ')})`);
    // Titres de menu et entrées renommés (menu « IRL » → « Sorties », lien « Jeux » → « Jeux du gang »), si les menus sont affichés
    const tops = await p1.$$eval('.site-header .nav-top', (b) => b.map((x) => x.textContent.trim()));
    const items = await p1.$$eval('.site-header .nav-item', (b) => b.map((x) => x.textContent.trim()));
    check(!tops.length || (tops.includes('Sorties') && !tops.includes('IRL')), `menu : titre « IRL » renommé « Sorties » (${tops.join(' | ')})`);
    // « Jeux » est un lien direct (sans sous-menu) : son libellé réglé remplace « Jeux »
    check(!tops.length || (tops.includes('Jeux du gang') && !tops.includes('Jeux')), `menu : lien « Jeux » renommé « Jeux du gang » (${tops.join(' | ')})`);
    await p1.close(); await p1.ctx.close();

    const p2 = await openPage(browser, { page: 'legal', fixture: FX, scenario: { reglages: REG } });
    const ed = (await p2.textContent('[data-field="editeur"]')).trim();
    const mail = (await p2.textContent('[data-field="contact_email"]')).trim();
    check(ed === 'Ethan Test', `mentions : éditeur saisi (« ${ed} »)`);
    check(mail === 'à compléter' && (await p2.$eval('[data-field="contact_email"]', (e) => e.classList.contains('a-completer'))), 'mentions : contact vide affiché « à compléter », rien d\'inventé');
    check((await p2.textContent('[data-legal-extra="legal_mentions"]')).includes('Paragraphe ajouté par l\'admin.'), 'mentions : paragraphe additionnel affiché');
    check(!(await p2.textContent('body')).includes('[À COMPLÉTER'), 'mentions : plus aucun placeholder « [À COMPLÉTER » dans la page');
    await p2.close(); await p2.ctx.close();

    // Intro désactivée : l'index renvoie à l'accueil (le cache des réglages doit avoir été lu une fois)
    const p3 = await openPage(browser, { page: 'accueil', fixture: FX, scenario: { reglages: { site_identite: { intro_active: false } } } });
    await p3.goto(`${ORIGIN}${PREFIX}/index.html`); await sleep(900);
    check(/accueil\.html/.test(p3.url()), `intro désactivée : index -> accueil (« ${p3.url()} »)`);
    await p3.close(); await p3.ctx.close();

    // ---- 2. Admin : validation puis modification ----
    const pa = await openPage(browser, { page: 'admin', fixture: FX, width: 1280, height: 900 });
    await adminGoto(pa);
    check(await pa.isVisible('#rgi-form'), 'admin : formulaire « Identité et textes » affiché');
    await field(pa, 'site_identite.nom').fill('');
    await save(pa);
    const err1 = await pa.textContent('[data-err="site_identite.nom"]');
    check(/ne peut pas être vide/.test(err1 || ''), 'admin : nom vide refusé (message sous le champ)');
    check((await storedSettings(pa)).every((r) => r.key !== 'site_identite' || !r.value || !('nom' in r.value)), 'admin : rien écrit quand la validation échoue');

    await field(pa, 'site_identite.nom').fill('Bande Essai');
    await field(pa, 'site_identite.contact_email').fill('pas-un-mail');
    await save(pa);
    check(/Adresse e-mail invalide/.test(await pa.textContent('[data-err="site_identite.contact_email"]') || ''), 'admin : e-mail invalide refusé');
    await field(pa, 'site_identite.contact_email').fill('contact@exemple.ch');
    await field(pa, 'site_identite.copyright').fill('© {annee} {nom}');
    await save(pa);
    const idRow = await overridesOf(pa, 'site_identite');
    check(idRow && idRow.nom === 'Bande Essai' && idRow.contact_email === 'contact@exemple.ch', `admin : écarts enregistrés dans hg_settings (${JSON.stringify(idRow)})`);
    check(!idRow || !('copyright' in idRow), 'admin : valeur identique au défaut non enregistrée');
    check((await pa.textContent('.toasts').catch(() => '')).includes('Identité et textes enregistrés'), 'admin : confirmation affichée');

    // Effet visible côté site dans le même navigateur
    await pa.goto(`${ORIGIN}${PREFIX}/pages/compte/accueil.html`); await sleep(1200);
    check((await pa.textContent('.site-header .brand span')).trim() === 'BANDE ESSAI', 'site : nouveau nom après enregistrement');

    // ---- 3. Rétablir : un champ, puis un groupe ----
    await adminGoto(pa);
    await pa.click('button[data-reset="site_identite.nom"]');
    check((await field(pa, 'site_identite.nom').inputValue()) === 'Humane Gang', 'admin : « Valeur par défaut » remet le nom d\'origine dans le champ');
    await save(pa);
    check(!('nom' in ((await overridesOf(pa, 'site_identite')) || {})), 'admin : nom par défaut -> clé retirée des écarts');

    await field(pa, 'site_identite.editeur').fill('Quelqu\'un');
    await pa.click('button[data-reset-group="identite"]');
    check((await field(pa, 'site_identite.editeur').inputValue()) === 'Quelqu\'un', 'admin : rétablir un groupe ne touche pas aux autres groupes');
    await pa.click('button[data-reset-group="legal"]');
    check((await field(pa, 'site_identite.editeur').inputValue()) === '', 'admin : rétablir le groupe « Éditeur et mentions légales » vide l\'éditeur');
    await save(pa);
    const after = await storedSettings(pa);
    const idAfter = (after.find((r) => r.key === 'site_identite') || {}).value || {};
    check(!('nom' in idAfter) && !('editeur' in idAfter), `hg_settings : plus aucun écart pour nom ni éditeur (${JSON.stringify(idAfter)})`);

    // ---- 4. Parties du formulaire ----
    /* Groupes visibles du formulaire (data-group des fieldsets non masqués). */
    const shownGroups = () => pa.$$eval('#rgi-form fieldset[data-group]', (fs) => fs.filter((f) => !f.hidden && f.getClientRects().length).map((f) => f.dataset.group).join(','));
    await adminSection(pa, 'pilotage/menu');
    await sleepShort();
    check(await shownGroups() === 'navigation', `parties : « Menu et pied de page » ne montre que son groupe (${await shownGroups()})`);
    check(!(await pa.isVisible('#reglages-root')) && await pa.isVisible('#rgi-save'), 'parties : liste des clés masquée, bouton Enregistrer visible');
    await pa.fill('#rgi-site-textes-nav-libelles-menu-irl', 'Sorties');
    check(await pa.isVisible('#rgi-site-textes-nav-libelles-cartes-html-ouverture') && await pa.isVisible('#rgi-site-textes-nav-libelles-menu-cartes') && await pa.isVisible('#rgi-site-textes-nav-libelles-jeux-html'), 'menu : titres, entrées et lien « Jeux » modifiables (Le jeu de cartes, Ouverture, Jeux)');
    await pa.fill('#rgi-site-textes-nav-libelles-cartes-html-ouverture', 'Ouvrir un booster');
    await save(pa);
    check(((await overridesOf(pa, 'site_textes')) || {}).nav_libelles?.['menu:irl'] === 'Sorties' && ((await overridesOf(pa, 'site_textes')) || {}).nav_libelles?.['cartes.html#ouverture'] === 'Ouvrir un booster', 'parties : titres de menu et entrées enregistrés depuis « Menu »');

    await adminSection(pa, 'pilotage/etat');
    await sleepShort();
    check(await shownGroups() === 'etat', `parties : « État du site » ne montre que son groupe (${await shownGroups()})`);
    check((await pa.textContent('#rgi-title')).trim() === 'État du site', 'parties : titre de la partie');
    await field(pa, 'site_identite.bandeau_actif').check({ force: true });
    await field(pa, 'site_identite.bandeau_texte').fill('Annonce de test');
    // Erreur dans une partie masquée : nom vidé par script (le champ n'est pas visible ici)
    await pa.evaluate(() => { document.getElementById('rgi-site-identite-nom').value = ''; });
    await save(pa);
    const st = await pa.textContent('#rgi-status');
    check(/À corriger dans « Identité et mentions légales »/.test(st || '') && await pa.locator('#rgi-status a[href="#mairie/identite"]').count() === 1,
      `parties : erreur d'une partie masquée nommée, avec son lien (« ${st} »)`);
    check(!('bandeau_actif' in ((await overridesOf(pa, 'site_identite')) || {})), 'parties : rien écrit tant que l\'erreur masquée n\'est pas corrigée');
    await pa.click('#rgi-status a[href="#mairie/identite"]');
    await sleepShort();
    check(await shownGroups() === 'identite,legal', `parties : le lien ouvre la partie fautive (${await shownGroups()})`);
    check((await field(pa, 'site_identite.bandeau_texte').inputValue()) === 'Annonce de test', 'parties : la saisie des autres parties est conservée');
    await field(pa, 'site_identite.nom').fill('Bande Parties');
    await save(pa);
    const idP = (await overridesOf(pa, 'site_identite')) || {};
    const txP = (await overridesOf(pa, 'site_textes')) || {};
    check(idP.nom === 'Bande Parties' && idP.bandeau_actif === true && idP.bandeau_texte === 'Annonce de test' && !('maintenance_active' in idP),
      `parties : état du site enregistré avec l'identité, défauts non écrits (${JSON.stringify(idP)})`);
    check(txP.nav_libelles?.['menu:irl'] === 'Sorties', 'parties : enregistrer depuis « Identité » conserve les libellés du menu');

    await adminSection(pa, 'pilotage/reglages');
    await sleepShort();
    check(!(await pa.isVisible('#identite-root')) && await pa.isVisible('#reglages-root .rg-keys-title'), 'parties : « Clés avancées » montre la liste seule');
    check(await pa.locator('#zone-actions [data-rg-add]').count() === 1, 'parties : « + Nouvelle clé » dans la partie Clés avancées');
    await adminSection(pa, 'pilotage/textes');
    await sleepShort();
    check(await shownGroups() === 'accueil,textes,affichage,visite,hors_ligne' && await pa.locator('#zone-actions [data-rg-add]').count() === 0, 'parties : « Textes et intro » (sans « + Nouvelle clé »)');

    // Erreurs console et défilement à 390 px
    const pm = await openPage(browser, { page: 'admin', fixture: FX, width: 390, height: 844, touch: true });
    await adminGoto(pm);
    check((await hscroll(pm)) <= 0, 'admin 390 px : pas de défilement horizontal');
    const errs = [...(pa.errs || []), ...(pm.errs || [])].filter((e) => !/^404 /.test(e));
    check(errs.length === 0, `console : aucune erreur (${errs.slice(0, 3).join(' / ')})`);

    await pm.close(); await pm.ctx.close();
    await pa.close(); await pa.ctx.close();
  } catch (e) {
    check(false, `exception : ${e.message}`);
  } finally {
    await browser.close();
    finish();
  }
})();
