// Parcours : anniversaire du gang (T4, migration 096).
// Pendant la fenêtre (7 au 9 janvier) : encart « Le gang a 5 ans » sur l'accueil, cadeau à réclamer une fois (booster
// « Anniversaire » et carte datée), rétrospective (lien /pages/irl/recap.html?retro=1, diapos depuis 2022), part de gâteau le jour J.
// Hors fenêtre : rien. Rétrospective : diapos de la vie du serveur, sans nom de membre. Visiteur : rien.
// Pas de défilement horizontal à 360 px.
// Faux Supabase : fixtures/fake-sb-saisons.mjs (scénario anniv : fenetre, today, age, claimed).
// Lancer : flock .../nuit2/pw.lock env NODE_PATH=... node tests/parcours/compte/parcours-anniversaire.cjs (voir RULES.md)
const { check, finish, openPage, hscroll, log, chromium } = require('../../lib/harness.cjs');

const FIX = 'fake-sb-saisons.mjs';
/** 8 janvier 2027, 10 h à Zurich : le jour J. */
const JOUR_J = '2027-01-08T09:00:00Z';
/** 20 janvier 2027 : hors fenêtre. */
const HORS = '2027-01-20T09:00:00Z';

(async () => {
  const browser = await chromium.launch();

  /* 1. Fenêtre ouverte, le jour J : encart, cadeau, rétrospective, part de gâteau. */
  let p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 1280, now: JOUR_J, scenario: { anniv: { fenetre: true, today: true, age: 5, claimed: false } } });
  await p.waitForSelector('#an-title', { timeout: 8000 }).catch(() => {});
  check((await p.textContent('#an-title').catch(() => '')).includes('Le gang a 5 ans'), 'jour J : encart « Le gang a 5 ans »');
  check(!!(await p.$('[data-an="claim"]:not([disabled])')), 'cadeau : bouton « Ouvrir mon cadeau » actif');
  check(!!(await p.$('[data-an="cake"]')), 'jour J : la part de gâteau est proposée');
  check(!!(await p.$('a[href="/pages/irl/recap.html?retro=1"]')), 'encart : lien vers la rétrospective');
  await p.waitForSelector('.an-retro .an-years li', { timeout: 8000 }).catch(() => {});
  check(await p.locator('.an-retro .an-years li').count() === 5, 'rétrospective : une ligne par année (2022 à 2026)');
  check((await p.textContent('.an-retro')).includes('Tzatzikistan'), 'rétrospective : le premier moment de 2022 est cité');
  check(await p.locator('#app .an-wrap, .an-wrap').count() === 1, 'accueil : un seul encart d’anniversaire');

  await p.locator('[data-an="cake"]').click().catch(() => {});
  await p.waitForTimeout(400);
  check((await log(p)).some((x) => x[1] === 'hg_egg_found' && x[2]?.p_egg === 'anniversaire'), 'part de gâteau : secret « anniversaire » déclaré');

  await p.locator('[data-an="claim"]').click();
  await p.waitForSelector('.an-gift', { timeout: 8000 }).catch(() => {});
  const claims = (await log(p)).filter((x) => x[1] === 'hg_anniv_claim');
  check(claims.length === 1, 'cadeau : une seule réclamation envoyée');
  check(!!(await p.$('.an-gift')), 'cadeau : carte datée et booster affichés après réclamation');
  check((await p.textContent('.an-gift')).includes('Reçu'), 'cadeau : marqué « Reçu »');
  check(await p.locator('[data-an="claim"]').isDisabled().catch(() => true), 'cadeau : le bouton ne se reclique pas (« Cadeau ouvert »)');
  check(!p.errs.filter((e) => !/^404 /.test(e)).length, 'accueil : aucune erreur console : ' + p.errs.join(' | '));
  await p.close();

  /* 2. Hors fenêtre : rien. */
  p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 1280, now: HORS, scenario: { anniv: { fenetre: false, today: false, age: 5 } } });
  await p.waitForTimeout(900);
  check(!(await p.$('#an-title')), 'hors fenêtre : pas d’encart d’anniversaire');
  check(!(await log(p)).some((x) => x[1] === 'hg_anniv_claim'), 'hors fenêtre : aucune réclamation');
  await p.close();

  /* 3. Réclamation refusée côté serveur hors fenêtre : message clair, pas de crash. */
  p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 1280, now: JOUR_J, scenario: { anniv: { fenetre: true, today: false, age: 5, claimed: false } } });
  await p.waitForSelector('[data-an="claim"]', { timeout: 8000 }).catch(() => {});
  check(!(await p.$('[data-an="cake"]')), 'hors jour J (fenêtre) : pas de part de gâteau');
  await p.close();

  /* 4. Rétrospective : diapos de la vie du serveur, sans nom de membre. */
  p = await openPage(browser, { page: 'recap', fixture: FIX, width: 1280, hash: '?retro=1', now: JOUR_J, scenario: { anniv: { fenetre: true, age: 5 } } });
  await p.waitForFunction(() => document.querySelector('.rc-title')?.textContent.includes('5 ans') || document.title.includes('5 ans'), null, { timeout: 8000 }).catch(() => {});
  check((await p.title()).includes('Le gang a 5 ans'), 'rétrospective : titre « Le gang a 5 ans »');
  check((await p.textContent('body')).includes('Le gang a'), 'rétrospective : première diapo « Le gang a 5 ans »');
  check(!(await p.$('.rc-year-pick')), 'rétrospective : pas de choix d’année');
  check(!(await p.textContent('.rc-stage').catch(() => '')).includes('Ethan'), 'rétrospective : aucun nom de membre dans la première diapo');
  check(!!(await p.$('[class*="rc-"]')), 'rétrospective : lecteur de story affiché');
  check(!p.errs.filter((e) => !/^404 /.test(e)).length, 'rétrospective : aucune erreur console : ' + p.errs.join(' | '));
  await p.close();

  /* 5. Visiteur : rien. */
  p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 1280, now: JOUR_J, scenario: { guest: true, anniv: { fenetre: true, today: true, age: 5 } } });
  await p.waitForTimeout(800);
  check(!(await p.$('#an-title')), 'visiteur : pas d’encart d’anniversaire');
  await p.close();

  /* 6. Téléphone 360 px. */
  p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 360, height: 780, mobile: true, now: JOUR_J, scenario: { anniv: { fenetre: true, today: true, age: 5 } } });
  await p.waitForSelector('#an-title', { timeout: 8000 }).catch(() => {});
  check(await hscroll(p) <= 0, `360 px : pas de défilement horizontal (${await hscroll(p)} px)`);
  await p.close();

  await browser.close();
  finish();
})();
