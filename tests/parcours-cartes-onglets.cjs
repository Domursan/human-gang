// Parcours : navigation de la page Cartes (cartes.html) entre ses sections.
// La barre d'onglets interne est masquée sur toutes les tailles d'écran (assets/css/cartes.css) : la navigation
// passe par le menu « Le jeu de cartes » de l'en-tête et par l'adresse cartes.html#<onglet>. Le titre de section
// (#cartes-section-h) indique l'onglet affiché.
// 1. Téléphone (360, 390, 430 px) : barre masquée, titre visible, les sept sections ont un lien dans le menu,
//    aucune erreur, pas de défilement horizontal.
// 2. 390 px : Ouverture est active au départ ; changer de section par adresse ou par le menu met à jour
//    l'onglet, le panneau et le titre.
// 3. Ordinateur (1280 px) : barre toujours masquée, titre visible, sept onglets dans le DOM (aria-selected).
// 4. Contenu des sections (Ouverture, Inventaire, Boutique) et adresse cartes.html#boutique.
// Faux Supabase : fixtures/fake-sb-cartes.mjs.
// Lancer : node tests/parcours-cartes-onglets.cjs
const { openPage, check, finish, hscroll, sleep, chromium } = require('./lib/harness.cjs');

const FIXTURE = 'fake-sb-cartes.mjs';
/** Sections de la page, dans l'ordre de la barre (TABS dans cartes.js). */
const ONGLETS = ['ouverture', 'inventaire', 'boutique', 'collection', 'classement', 'echanges', 'arene'];
/** Changement de section par adresse : la barre étant masquée, c'est le chemin que suit l'en-tête. */
const goTab = (p, id) => p.evaluate((id) => { if (location.hash === '#' + id) location.hash = ''; location.hash = id; }, id);
/** État visible de la navigation : barre (masquée ?), titre de section, liens du menu vers chaque section. */
const etat = (p) => p.evaluate((ids) => {
  const t = document.querySelector('#cartes-tablist');
  const titre = document.querySelector('#cartes-section-h');
  const liens = [...document.querySelectorAll('a[href^="cartes.html#"]')].map((a) => a.getAttribute('href').split('#')[1]);
  return {
    barreVisible: getComputedStyle(t).display !== 'none',
    titreVisible: !titre.hidden && getComputedStyle(titre).display !== 'none',
    titre: titre.textContent.trim(),
    liens: ids.filter((id) => liens.includes(id)),
    onglets: [...t.querySelectorAll('[role=tab]')].map((b) => b.dataset.tab),
  };
}, ONGLETS);
const actif = (p) => p.evaluate(() => [...document.querySelectorAll('#cartes-tablist [role=tab]')].find((b) => b.getAttribute('aria-selected') === 'true')?.dataset.tab || null);

(async () => {
  const browser = await chromium.launch();

  // ---------- 1. Téléphone : barre masquée, navigation par le menu ----------
  for (const w of [360, 390, 430]) {
    const p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: w, height: 800, touch: true });
    const e = await etat(p);
    check(!e.barreVisible, `${w} px : barre d'onglets masquée (navigation dans le menu du haut)`);
    check(e.titreVisible && e.titre === 'Ouverture', `${w} px : titre de section visible (« ${e.titre} »)`);
    check(JSON.stringify(e.onglets) === JSON.stringify(ONGLETS), `${w} px : les sept sections existent (${e.onglets.join(',')})`);
    check(e.liens.length === ONGLETS.length, `${w} px : le menu mène aux sept sections (${e.liens.join(',')})`);
    check(await hscroll(p) === 0, `${w} px : pas de défilement horizontal de la page`);
    check(p.errs.length === 0, `${w} px : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
    if (w === 390) {
      // ---------- 2. Section active et changements de section ----------
      check(await actif(p) === 'ouverture', '390 px : Ouverture est la section active au départ');
      await goTab(p, 'classement');
      await sleep(300);
      check(await actif(p) === 'classement', '390 px : l\'adresse #classement active la section Classement');
      check(await p.$eval('#cartes-p-classement', (s) => !s.hidden), '390 px : le panneau Classement s\'affiche');
      check((await etat(p)).titre === 'Classement', '390 px : le titre indique Classement');
      // Lien « Échanges » du menu, par le chemin d'un téléphone : Menu (replié), puis « Le jeu de cartes », puis le lien
      await p.click('.nav-toggle');
      await p.click('button.nav-top[aria-controls="nav-menu-cartes"]');
      await p.click('a[href="cartes.html#echanges"]');
      await sleep(300);
      check(await actif(p) === 'echanges', '390 px : le lien « Échanges » du menu active Échanges');
      check((await etat(p)).titre === 'Échanges', '390 px : le titre indique Échanges');
      check(await hscroll(p) === 0, '390 px : pas de défilement horizontal après changement de section');
      check(p.errs.length === 0, `390 px : aucune erreur console après interactions (${p.errs.join(' | ') || 'rien'})`);
    }
    await p.ctx.close();
  }

  // ---------- 3. Ordinateur : barre masquée, titre visible ----------
  const d = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900 });
  const ed = await etat(d);
  check(!ed.barreVisible, '1280 px : barre d\'onglets masquée');
  check(ed.titreVisible && ed.titre === 'Ouverture', '1280 px : titre de section visible (« ' + ed.titre + ' »)');
  check(JSON.stringify(ed.onglets) === JSON.stringify(ONGLETS), '1280 px : les sept sections existent dans le DOM');
  check(d.errs.length === 0, `1280 px : aucune erreur console (${d.errs.join(' | ') || 'rien'})`);
  await d.ctx.close();

  // ---------- 4. Contenu des sections ----------
  // Achat dans la Boutique : mode typé (migration 069), où le classique s'achète avec « Acheter · total ».
  const q = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, scenario: { types: true } });
  check(await q.$eval('#cartes-p-ouverture', (s) => !s.hidden && !!s.querySelector('#cartes-free') && !!s.querySelector('#cartes-stock') && !!s.querySelector('#cartes-quests')),
    'Ouverture : booster gratuit, boosters en stock et quêtes');
  check(await q.$eval('#cartes-p-ouverture', (s) => !s.querySelector('[data-action=buy-stock]')), 'Ouverture : pas d\'achat (il est dans la Boutique)');
  await goTab(q, 'boutique'); await sleep(300);
  check(await q.$eval('#cartes-p-boutique', (s) => !s.hidden && !!s.querySelector('[data-action=buy-stock]') && !!s.querySelector('.cartes-odds')), 'Boutique : booster à acheter (buy-stock) et chances');
  await goTab(q, 'inventaire'); await sleep(300);
  check(await q.$eval('#cartes-p-inventaire', (s) => !s.hidden && !!s.querySelector('#cartes-history') && s.querySelectorAll('.inv-box').length === 3), 'Inventaire : trois blocs et historique des Paillettes');
  check(!(await q.$('#cartes-history-wrap')), 'L\'ancien historique global a disparu');
  await goTab(q, 'boutique'); await sleep(300);
  // Acheter reste dans la Boutique : pas de révélation, et le lien « Les ouvrir » apparaît sous l'article.
  await q.click('#cartes-paid [data-action=buy-stock]'); await sleep(900);
  check(await q.$eval('#cartes-tab-boutique', (b) => b.getAttribute('aria-selected')) === 'true', 'Acheter dans la Boutique reste sur la Boutique');
  check(await q.$eval('#cartes-reveal', (r) => r.innerHTML.trim() === ''), 'Acheter : aucune révélation');
  check(await q.$eval('#cartes-paid', (a) => !!a.querySelector('[data-tab-go=ouverture]')), 'Acheter : lien « Les ouvrir » sous l\'article');
  await q.click('#cartes-paid [data-tab-go=ouverture]'); await sleep(300);
  check(await q.$eval('#cartes-tab-ouverture', (b) => b.getAttribute('aria-selected')) === 'true', '« Les ouvrir » passe sur Ouverture');
  // L'ouverture se fait dans Ouverture : la révélation y reste affichée.
  await q.click('#cartes-p-ouverture [data-action=open-free]'); await sleep(900);
  check(await q.$eval('#cartes-tab-ouverture', (b) => b.getAttribute('aria-selected')) === 'true', 'Ouvrir dans Ouverture : reste sur Ouverture');
  check(await q.$eval('#cartes-reveal', (r) => r.innerHTML.trim().length > 0), 'La révélation s\'affiche dans Ouverture');
  check(q.errs.length === 0, `Contenu : aucune erreur console (${q.errs.join(' | ') || 'rien'})`);
  await q.ctx.close();
  const h = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, hash: '#boutique' });
  await sleep(300);
  check(await h.$eval('#cartes-tab-boutique', (b) => b.getAttribute('aria-selected')) === 'true' && await h.$eval('#cartes-p-boutique', (s) => !s.hidden), 'cartes.html#boutique ouvre la Boutique');
  await h.ctx.close();

  await browser.close();
  finish();
})();
