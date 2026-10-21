// Parcours : réglages du site, lot 1 (identité, textes, pages légales, menu, pied de page, intro).
// 1. Scénario avec réglages en base : le site (en-tête, titre, pied, menu, mentions, intro) les applique.
// 2. Admin › Site › Réglages : validation (nom vide refusé), modification du nom et du copyright, enregistrement
//    dans hg_settings (faux client persistant), effet visible sur le site dans le même navigateur.
// 3. Rétablissement par champ puis par groupe : retour aux valeurs d'origine, aucune clé superflue en base.
// Aucune erreur console, pas de défilement horizontal à 390 px. Lancer : node tests/parcours-reglages-lot1.cjs
const { ORIGIN, PREFIX, check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('./lib/harness.cjs');

const FX = 'fake-sb-reglages.mjs';
const REG = {
  site_identite: { nom: 'Crew Test', copyright: '© {annee} {nom} · essai', editeur: 'Ethan Test', bandeau_cookies: false },
  site_textes: {
    nav_libelles: { irl: 'Sorties' },
    footer_liens: [
      { id: 'evenements', label: 'Événements', visible: true }, { id: 'assistance', label: 'Aide', visible: true },
      { id: 'mentions', label: 'Mentions légales', visible: true }, { id: 'confidentialite', label: 'Confidentialité', visible: true },
      { id: 'cookies', label: 'Cookies', visible: false },
    ],
    legal_mentions: 'Paragraphe ajouté par l\'admin.',
  },
};
const sleepShort = () => sleep(400);
const storedSettings = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('__fake_settings') || 'null') || []; } catch { return []; } });
const overridesOf = async (p, key) => ((await storedSettings(p)).find((r) => r.key === key) || {}).value;

async function adminGoto(p) {
  await p.goto(`${ORIGIN}${PREFIX}/admin.html`);
  await sleep(1200);
  await adminSection(p, 'site/reglages');
  await p.waitForSelector('#rgi-form', { timeout: 8000 });
  await sleepShort();
}
const field = (p, k) => p.locator(`#rgi-${k.replace(/[^a-z0-9]/gi, '-')}`);
const save = async (p) => { await p.click('#rgi-save'); await sleepShort(); };

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
    const navTxt = await p1.$$eval('.site-header .nav a', (as) => as.map((a) => a.textContent.trim()));
    check(!navTxt.length || navTxt.every((t) => t !== 'IRL'), `menu : libellé « Sorties » si le lien IRL est affiché (${navTxt.join(' | ')})`);
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
    await pa.goto(`${ORIGIN}${PREFIX}/accueil.html`); await sleep(1200);
    check((await pa.textContent('.site-header .brand span')).trim() === 'BANDE ESSAI', 'site : nouveau nom après enregistrement');

    // ---- 3. Rétablir : un champ, puis un groupe ----
    await adminGoto(pa);
    await pa.click('button[data-reset="site_identite.nom"]');
    check((await field(pa, 'site_identite.nom').inputValue()) === 'Humane Gang', 'admin : « Valeur par défaut » remet le nom d\'origine dans le champ');
    await save(pa);
    check(!('nom' in ((await overridesOf(pa, 'site_identite')) || {})), 'admin : nom par défaut -> clé retirée des écarts');

    await field(pa, 'site_identite.editeur').fill('Quelqu\'un');
    await field(pa, 'site_identite.intro_active').uncheck().catch(() => {});
    await pa.click('button[data-reset-group="identite"]');
    check((await field(pa, 'site_identite.editeur').inputValue()) === 'Quelqu\'un', 'admin : rétablir un groupe ne touche pas aux autres groupes');
    await pa.click('button[data-reset-group="legal"]');
    check((await field(pa, 'site_identite.editeur').inputValue()) === '', 'admin : rétablir le groupe « Éditeur et mentions légales » vide l\'éditeur');
    await save(pa);
    const after = await storedSettings(pa);
    const idAfter = (after.find((r) => r.key === 'site_identite') || {}).value || {};
    check(!('nom' in idAfter) && !('editeur' in idAfter), `hg_settings : plus aucun écart pour nom ni éditeur (${JSON.stringify(idAfter)})`);

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
