// Parcours : thème saisonnier « Raclette » (migration 102, effet « fromage » : core/effects.js et base.css).
// Thème forcé par hg_settings.theme (forced_slug) avec la fausse base (scenario.themes / scenario.themeSetting).
// (a) Accueil 1280 px : classe fx-fromage sur <html>, coulée sous l'arc-en-ciel (pseudo-élément de l'en-tête, animation de 2 s
//     qui se termine figée), gourmandises dans un calque fixe non cliquable (pointer-events none, derrière le contenu) : 7 éléments,
//     aucun ne reçoit le clic au centre d'un bouton principal.
// (b) Aucun décalage : boîtes des boutons principaux et des cadres identiques avec et sans les gouttes ; hauteur de page inchangée.
// (c) Accueil 390 px : 4 gourmandises, aucun défilement horizontal, captures de l'en-tête et de la page.
// (d) Cartes 1280 et 390 px : gouttes sous les cadres (.card), jamais sur un cadre de formulaire ; aucun défilement horizontal.
// (e) Mouvement réduit : coulée présente et figée, calque de gourmandises absent. Effets coupés (préférence) : rien du tout.
// (f) Page d'administration : pas de classe fx-fromage (ni gouttes).
// Captures dans tests/shots/ : theme-raclette-accueil-1280.png, -accueil-390.png, -entete-390.png, -cartes-1280.png, -cartes-390.png.
// Lancer : node tests/parcours-theme-raclette.cjs
const path = require('path');
const { check, finish, openPage, hscroll, sleep, chromium, SHOTS } = require('./lib/harness.cjs');

/** Thème Raclette tel que la migration 102 le crée en base. */
const RACLETTE = { slug: 'raclette', name: 'Raclette', is_default: false, active: true, start_md: '01-15', end_md: '02-29', priority: 3, logo_url: null, emojis: ['🧀', '🥔', '🥒'], effect: 'fromage', colors: { bg: '#130E09', text: '#F6ECD8', muted: '#C2B096', accent: '#E8B52E', surface: '#1F1710', highlight: '#F2C14E' } };
const FORCED = { mode: 'forced', forced_slug: 'raclette' };

/** État lu sur la page : classe, calque, coulée (pseudo-élément de l'en-tête) et bouton principal sous son centre. */
const etat = (p) => p.evaluate(() => {
  const root = document.documentElement;
  const layer = document.querySelector('.fx-layer');
  const header = document.querySelector('.site-header');
  const melt = header ? getComputedStyle(header, '::before') : null;
  const btn = [...document.querySelectorAll('.btn-primary')].find((b) => !b.closest('form'));
  let sousLeCentre = null;
  if (btn) {
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    sousLeCentre = !!el && !!layer && layer.contains(el);
  }
  return {
    theme: root.dataset.theme,
    classe: root.classList.contains('fx-fromage'),
    calque: !!layer,
    gourmandises: layer ? layer.children.length : 0,
    pointer: layer ? getComputedStyle(layer).pointerEvents : null,
    spanPointer: layer && layer.children[0] ? getComputedStyle(layer.children[0]).pointerEvents : null,
    z: layer ? getComputedStyle(layer).zIndex : null,
    meltImage: melt ? melt.backgroundImage !== 'none' : false,
    meltAnim: melt ? melt.animationName : null,
    meltFini: [...document.getAnimations()].some((a) => a.animationName === 'fx-melt' && a.playState === 'finished'),
    sousLeCentre,
    gouttesCadres: [...document.querySelectorAll('.card')].filter((c) => getComputedStyle(c, '::after').backgroundImage !== 'none').length,
    cadresFormulaire: [...document.querySelectorAll('form .card, form.card')].filter((c) => getComputedStyle(c, '::after').backgroundImage !== 'none').length,
    hauteur: document.documentElement.scrollHeight,
    // plus haut élément visible du logo et des menus : sous la coulée (bas à 6 + 64 px)
    hautMenus: Math.min(...[...document.querySelectorAll('.site-header .brand, .site-header .nav-tools, .site-header .nav a')].filter((x) => x.getBoundingClientRect().height > 0).map((x) => x.getBoundingClientRect().top)),
  };
});

/**
 * Mesures de mise en page : boîtes des boutons principaux et des cadres (taille, position par rapport au bas de l'en-tête,
 * qui change avec la marge du thème), et hauteur de page sans l'en-tête. Arrondies au dixième de pixel.
 */
const mesures = (p) => p.evaluate(() => {
  const head = document.querySelector('.site-header');
  const hb = head ? head.getBoundingClientRect().bottom : 0;
  const boites = [...document.querySelectorAll('.btn-primary, .card')].map((e) => {
    const r = e.getBoundingClientRect();
    return [r.x, r.y - hb, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(',');
  });
  return { boites, hauteur: document.documentElement.scrollHeight - (head ? head.offsetHeight : 0) };
});

(async () => {
  const browser = await chromium.launch();

  /* ---------- (a) Accueil 1280 px : thème forcé ---------- */
  let p = await openPage(browser, { page: 'accueil', width: 1280, height: 900, scenario: { guest: true, themes: [RACLETTE], settings: [{ key: 'theme', value: FORCED }] } });
  await sleep(2600); // la coulée dure 2 s
  let e = await etat(p);
  check(e.theme === 'raclette', `(a) thème forcé appliqué (data-theme=${e.theme})`);
  check(e.classe, '(a) classe fx-fromage posée sur <html>');
  check(e.meltImage, "(a) coulée de fromage dessinée sous l'en-tête (pseudo-élément, image de fond)");
  check(e.meltAnim === 'fx-melt' && e.meltFini, `(a) coulée figée après son animation (animation=${e.meltAnim}, terminée=${e.meltFini})`);
  check(e.calque && e.gourmandises === 7, `(a) calque de gourmandises : 7 éléments (${e.gourmandises})`);
  check(e.pointer === 'none' && e.spanPointer === 'none', `(a) calque et gourmandises non cliquables (pointer-events ${e.pointer} / ${e.spanPointer})`);
  check(e.z === '-1', `(a) calque placé derrière le contenu (z-index ${e.z})`);
  check(e.hautMenus >= 70, `(a) logo et menus sous la coulée, pas dessus (haut à ${Math.round(e.hautMenus)} px)`);
  check(e.sousLeCentre === false, '(a) le clic au centre d\'un bouton principal atteint le bouton, pas le calque');
  check(e.gouttesCadres > 0, `(a) gouttes sous les cadres (${e.gouttesCadres})`);
  check(e.cadresFormulaire === 0, '(a) aucune goutte sur un cadre de formulaire');
  check(p.errs.length === 0, `(a) aucune erreur de page${p.errs.length ? ' : ' + p.errs.slice(0, 3).join(' | ') : ''}`);
  await p.screenshot({ path: path.join(SHOTS, 'theme-raclette-accueil-1280.png') });

  // (b) aucun décalage : la même page, avec puis sans la classe (les gouttes sont des pseudo-éléments absolus)
  const avec = await mesures(p);
  await p.evaluate(() => document.documentElement.classList.remove('fx-fromage'));
  const sans = await mesures(p);
  await p.evaluate(() => document.documentElement.classList.add('fx-fromage'));
  check(avec.boites.length > 0 && JSON.stringify(avec.boites) === JSON.stringify(sans.boites), `(b) boutons principaux et cadres : mêmes boîtes avec et sans gouttes (${avec.boites.length} éléments)`);
  check(avec.hauteur === sans.hauteur, `(b) hauteur de page hors en-tête inchangée (${avec.hauteur} / ${sans.hauteur} px)`);
  await p.close();

  /* ---------- (c) Accueil 390 px ---------- */
  p = await openPage(browser, { page: 'accueil', width: 390, height: 844, mobile: true, dpr: 2, scenario: { guest: true, themes: [RACLETTE], settings: [{ key: 'theme', value: FORCED }] } });
  await sleep(2600);
  e = await etat(p);
  check(e.gourmandises === 4, `(c) 390 px : 4 gourmandises (${e.gourmandises})`);
  check((await hscroll(p)) === 0, '(c) 390 px : aucun défilement horizontal');
  check(e.hautMenus >= 70, `(c) 390 px : logo et bouton de menu sous la coulée (haut à ${Math.round(e.hautMenus)} px)`);
  check(e.sousLeCentre === false, '(c) 390 px : aucun élément du calque sous le clic d\'un bouton');
  await p.screenshot({ path: path.join(SHOTS, 'theme-raclette-accueil-390.png') });
  await (await p.$('.site-header')).screenshot({ path: path.join(SHOTS, 'theme-raclette-entete-390.png') });
  await p.close();

  /* ---------- (d) Cartes 1280 et 390 px ---------- */
  for (const width of [1280, 390]) {
    p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width, height: 900, mobile: width < 600, dpr: width < 600 ? 2 : 1, scenario: { themes: [RACLETTE], themeSetting: FORCED } });
    await sleep(2600);
    e = await etat(p);
    check(e.classe && e.theme === 'raclette', `(d) cartes ${width} px : thème raclette et classe fx-fromage`);
    check(e.gouttesCadres > 0, `(d) cartes ${width} px : gouttes sous les cadres (${e.gouttesCadres})`);
    check(e.cadresFormulaire === 0, `(d) cartes ${width} px : aucune goutte sur un cadre de formulaire`);
    check((await hscroll(p)) === 0, `(d) cartes ${width} px : aucun défilement horizontal`);
    await p.screenshot({ path: path.join(SHOTS, `theme-raclette-cartes-${width}.png`) });
    await p.close();
  }

  /* ---------- (e) Mouvement réduit : coulée figée, pas de gourmandises ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280, reducedMotion: 'reduce', scenario: { themes: [RACLETTE], settings: [{ key: 'theme', value: FORCED }] } });
  e = await etat(p);
  check(e.classe && e.meltImage, '(e) mouvement réduit : coulée présente');
  check(e.meltAnim === 'none', `(e) mouvement réduit : coulée sans animation (${e.meltAnim})`);
  check(!e.calque, '(e) mouvement réduit : aucune gourmandise');
  await p.close();

  /* ---------- (e bis) Effets coupés (préférence « effets ») : rien du tout ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280, scenario: { themes: [RACLETTE], settings: [{ key: 'theme', value: FORCED }] }, init: () => { try { localStorage.setItem('hg_prefs', JSON.stringify({ effects: false })); } catch (err) { /* sans importance */ } } });
  e = await etat(p);
  check(!e.classe && !e.calque && !e.meltImage && e.gouttesCadres === 0, '(e) effets coupés : ni coulée, ni gouttes, ni gourmandises');
  await p.close();

  /* ---------- (f) Page d'administration : pas de gouttes ---------- */
  p = await openPage(browser, { page: 'admin', width: 1280, scenario: { themes: [RACLETTE], settings: [{ key: 'theme', value: FORCED }] } });
  e = await etat(p);
  check(!e.classe && e.gouttesCadres === 0, '(f) administration : pas de classe fx-fromage ni de gouttes');
  await p.close();

  await browser.close();
  finish();
})().catch((err) => { console.error(err); process.exitCode = 1; });
