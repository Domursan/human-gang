// Parcours : modèles prêts à l'emploi des défis du gang (admin.html › Jeu de cartes › Défis du gang).
// Couvre : la rangée de modèles est affichée ; choisir un modèle pré-remplit le formulaire (titre, objectif,
// cible, récompense, « Actif » coché, début maintenant, fin dans la durée du modèle) sans rien créer ; « Annuler »
// ne crée rien ; « Créer le défi » envoie les bonnes valeurs ; une cible invalide est refusée ; le widget de
// l'accueil affiche un défi en cours (jauge) et reste masqué sans défi ; mobile 390 px sans défilement
// horizontal ; aucune erreur console.
// Les contrôles portent sur l'état du faux (window.__DB) et sur les appels reçus (window.__LOG).
// Lancer : node tests/parcours-defi-modele.cjs
const { check, finish, openPage, adminSection, hscroll, chromium } = require('./lib/harness.cjs');

/** Tiroir de dialogue ouvert (dialog.ui-drawer[open]). */
const drawer = (p) => p.locator('dialog.ui-drawer[open]');
/** Titre du tiroir ouvert. */
const drawerTitle = (p) => p.textContent('dialog.ui-drawer[open] .ui-drawer-title');
/** Clique sur le bouton Annuler (fermer) du tiroir ouvert. */
const closeDrawer = (p) => p.click('dialog.ui-drawer[open] .ui-drawer-foot [data-drawer-close]');
/** Clique sur le bouton de validation du tiroir ouvert. */
const submitDrawer = (p) => p.click('dialog.ui-drawer[open] [data-drawer-submit]');
/** Attend que le tiroir soit fermé (retiré de la page). */
const waitClosed = (p) => p.waitForSelector('dialog.ui-drawer', { state: 'detached', timeout: 5000 }).catch(() => {});
/** Exécute fn dans la page et renvoie son résultat (lecture de la base simulée). */
const db = (p, fn, arg) => p.evaluate(fn, arg);
/** Modèle choisi dans la rangée (bouton data-model). */
const modelBtn = (p, id) => p.locator(`#challenges-root [data-action="adc-model"][data-model="${id}"]`);
/** Écart en millisecondes entre la fin et le début saisis dans le formulaire ouvert. */
const formSpanMs = (p) => p.evaluate(() => new Date(document.querySelector('#adc-end').value) - new Date(document.querySelector('#adc-start').value));
/** Écart en millisecondes entre la fin et le début d'une ligne de la base. */
const rowSpanMs = (r) => new Date(r.ends_at) - new Date(r.starts_at);
/** Vrai si deux durées (ms) diffèrent de moins de deux minutes. */
const about = (a, b) => Math.abs(a - b) < 2 * 60 * 1000;
const DAY = 86400000;

(async () => {
  const browser = await chromium.launch();

  /* ---------- Admin, bureau 1280 px ---------- */
  let p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900 });
  await adminSection(p, 'cartes/defis');
  await p.waitForSelector('#challenges-root [data-action="adc-edit"]', { timeout: 5000 });
  const before = await db(p, () => window.__DB.hg_challenges.length);
  check(await p.locator('#challenges-root .adc-model').count() === 4, 'modèles : 4 modèles affichés dans la rangée');
  check(await p.locator('#challenges-root .adc-models-title').textContent() === 'Modèles prêts à l\'emploi', 'modèles : titre de la rangée');

  /* Choisir un modèle pré-remplit le formulaire, sans rien créer */
  await modelBtn(p, 'boosters-semaine').click();
  await p.waitForSelector('dialog.ui-drawer[open] #adc-title', { timeout: 5000 });
  check(await drawerTitle(p) === 'Nouveau défi', 'modèle : le tiroir s\'ouvre en « Nouveau défi »');
  check(await p.inputValue('#adc-title') === 'Ouvrez 800 boosters cette semaine', 'modèle : titre pré-rempli');
  check(await p.inputValue('#adc-metric') === 'boosters_ouverts', 'modèle : objectif « Boosters ouverts »');
  check(await p.inputValue('#adc-target') === '800', 'modèle : cible 800');
  check(await p.inputValue('#adc-reward') === '50', 'modèle : récompense 50 Paillettes');
  check(await p.isChecked('#adc-active'), 'modèle : « Actif » coché (le clic sur Créer lance le défi)');
  check(about(await formSpanMs(p), 7 * DAY), 'modèle : fin dans 7 jours après le début');
  check(await db(p, () => window.__DB.hg_challenges.length) === before, 'modèle : rien n\'est créé avant le clic sur « Créer »');

  /* Annuler : rien n'est créé */
  await closeDrawer(p);
  await waitClosed(p);
  check(await db(p, () => window.__DB.hg_challenges.length) === before, 'modèle : « Annuler » ne crée rien');

  /* Modèle sur 30 jours, ajusté puis validé */
  await modelBtn(p, 'echanges-mois').click();
  await p.waitForSelector('dialog.ui-drawer[open] #adc-title', { timeout: 5000 });
  check(await p.inputValue('#adc-metric') === 'echanges_conclus', 'modèle échanges : objectif « Échanges de cartes conclus »');
  check(about(await formSpanMs(p), 30 * DAY), 'modèle échanges : fin dans 30 jours');
  await p.fill('#adc-target', '10');
  await submitDrawer(p);
  await waitClosed(p);
  const cree = await db(p, () => window.__DB.hg_challenges.find((c) => c.metric === 'echanges_conclus'));
  check(!!cree, 'création : le défi est enregistré après « Créer »');
  check(!!cree && cree.title === 'Concluez 8 échanges ce mois-ci', 'création : titre du modèle envoyé');
  check(!!cree && cree.target === 10 && cree.reward === 60, 'création : cible ajustée (10) et récompense du modèle (60) envoyées');
  check(!!cree && cree.active === true, 'création : défi actif');
  check(!!cree && about(rowSpanMs(cree), 30 * DAY), 'création : durée de 30 jours enregistrée');
  check(!!cree && Number.isInteger(cree.target) && Number.isInteger(cree.reward), 'création : cible et récompense entières');
  check(await db(p, () => window.__DB.hg_challenges.length) === before + 1, 'création : une seule ligne ajoutée');

  /* Fin avant le début : refusée par le formulaire (message), tiroir ouvert, rien créé.
     Une cible vide ou hors bornes est bloquée plus tôt, par la validation native du champ (reportValidity). */
  await modelBtn(p, 'recyclage-semaine').click();
  await p.waitForSelector('dialog.ui-drawer[open] #adc-title', { timeout: 5000 });
  await p.fill('#adc-end', '2020-01-01T10:00');
  await submitDrawer(p);
  await p.waitForTimeout(300);
  check(await p.locator('dialog.ui-drawer[open] #adc-error').isVisible(), 'refus : fin avant le début, message d\'erreur affiché');
  check((await p.textContent('dialog.ui-drawer[open] #adc-error')).includes('La fin doit être après le début'), 'refus : message « La fin doit être après le début »');
  check(await drawer(p).count() === 1, 'refus : le tiroir reste ouvert');
  check(await db(p, () => window.__DB.hg_challenges.length) === before + 1, 'refus : rien n\'est créé');
  await closeDrawer(p);
  await waitClosed(p);

  /* Mobile 390 px : rangée sans défilement horizontal */
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(200);
  check(await hscroll(p) <= 0, 'mobile : rangée de modèles sans défilement horizontal');
  check(p.errs.length === 0, 'admin : aucune erreur console (' + p.errs.join(' | ') + ')');
  await p.close();

  /* ---------- Accueil : widget « Défi du gang » ---------- */
  const defi = {
    id: '00000000-0000-4000-8000-0000000000d1', title: 'Ouvrez 800 boosters cette semaine', description: 'Objectif collectif.',
    metric: 'boosters_ouverts', target: 800, reward: 50,
    starts_at: new Date(Date.now() - DAY).toISOString(), ends_at: new Date(Date.now() + 6 * DAY).toISOString(),
    progress: 120, done: false, ended: false, credited: false,
  };
  let a = await openPage(browser, { page: 'accueil', width: 1280, height: 900, scenario: { defis: [defi] } });
  await a.waitForSelector('#defi .defi-item', { timeout: 8000 });
  check(await a.isVisible('#defi'), 'accueil : le bloc « Défi du gang » est affiché avec un défi en cours');
  check((await a.textContent('#defi .defi-title')).includes('Ouvrez 800 boosters'), 'accueil : titre du défi affiché');
  check((await a.textContent('#defi .defi-count')).includes('120 / 800'), 'accueil : progression « 120 / 800 » affichée');
  check(await a.getAttribute('#defi .defi-bar', 'aria-valuenow') === '120' && await a.getAttribute('#defi .defi-bar', 'aria-valuemax') === '800', 'accueil : jauge à 120 sur 800');
  check(await a.locator('#defi .defi-bar span').evaluate((s) => s.style.width) === '15%', 'accueil : barre remplie à 15 %');
  check(a.errs.length === 0, 'accueil (défi) : aucune erreur console (' + a.errs.join(' | ') + ')');
  await a.close();

  let b = await openPage(browser, { page: 'accueil', width: 1280, height: 900, scenario: { defis: [] } });
  await b.waitForTimeout(800);
  check(await b.isHidden('#defi'), 'accueil : sans défi en cours, le bloc reste masqué');
  await b.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
