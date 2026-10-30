// Parcours : calendrier de l'Avent du gang (T1, migration 096).
// En décembre, paquet cadeau dans la barre du haut qui ouvre le calendrier en popup (24 cases, case du jour, rattrapage, cases verrouillées),
// ouverture d'une case (carte révélée, une seule ouverture côté serveur), case collective (jauge, bonus une fois),
// rappel sur la page Cartes, visiteur sans rien, hors saison sans aucun appel, pas de défilement horizontal à 360 px.
// Faux Supabase : fixtures/fake-sb-saisons.mjs (scénario avent, today, opened, groupCount). Les appels restent dans window.__LOG.
// Lancer : flock .../nuit2/pw.lock env NODE_PATH=... node tests/parcours/compte/parcours-avent.cjs (voir RULES.md)
const { check, finish, openPage, hscroll, log, chromium } = require('../../lib/harness.cjs');

const FIX = 'fake-sb-saisons.mjs';
/** 13 décembre 2026, 10 h à Zurich (UTC+1) : la case du jour est la 13. */
const DEC13 = '2026-12-13T09:00:00Z';
/** 15 novembre 2026 : hors saison, le calendrier n'existe pas encore. */
const NOV15 = '2026-11-15T09:00:00Z';
/** Appels hg_advent_open relevés dans le journal. */
const opens = (lg) => lg.filter((x) => x[0] === 'rpc' && x[1] === 'hg_advent_open').map((x) => x[2].p_day);
/** Calendrier dans sa popup (avent-popup.js). */
const CAL = '.av-dlg[open]'; // (mouvement réduit dans les parcours qui cliquent les cases : la case du jour pulse sans fin)
/** Ouvre la popup du calendrier par le paquet cadeau de l'en-tête, et attend sa grille. */
async function ouvrirCalendrier(p) {
  await p.waitForSelector('.site-header .av-gift', { timeout: 8000 }).catch(() => {});
  if (!(await p.$('.site-header .av-gift'))) return false;
  await p.click('.site-header .av-gift');
  await p.waitForSelector(`${CAL} .av-grid`, { timeout: 8000 }).catch(() => {});
  return !!(await p.$(`${CAL} .av-grid`));
}

(async () => {
  const browser = await chromium.launch();

  /* 1. Hors saison : rien, et aucun appel au calendrier. */
  {
    const p = await openPage(browser, { page: 'accueil', fixture: FIX, now: NOV15, scenario: { avent: true, today: 13 } });
    await p.waitForTimeout(800);
    check(!(await p.$('.av-gift')), 'hors saison (15 novembre) : pas de paquet cadeau dans la barre du haut');
    check(!(await log(p)).some((x) => x[1] === 'hg_advent_me'), 'hors saison : aucun appel hg_advent_me');
    await browser.close().catch(() => {});
  }

  /* 2. Le 13 décembre : paquet cadeau, popup avec 24 cases, la case du jour, une case verrouillée. */
  const b2 = await chromium.launch();
  let p = await openPage(b2, { page: 'accueil', fixture: FIX, now: DEC13, width: 1280, reducedMotion: 'reduce', scenario: { avent: true, today: 13, opened: [1, 2, 3] } });
  check((await p.waitForSelector('.site-header .av-gift-badge:not([hidden])', { timeout: 8000 }).catch(() => null)) !== null
    && (await p.textContent('.site-header .av-gift-badge')).trim() === '10', 'le 13 décembre : paquet cadeau dans la barre, 10 cases à ouvrir ou rattraper');
  check(await ouvrirCalendrier(p), 'paquet cadeau : ouvre le calendrier en popup');
  check(await p.locator(`${CAL} .av-cell`).count() === 24, 'popup : 24 cases');
  check(await p.locator(`${CAL} .av-cell.is-today`).count() === 1 && (await p.locator(`${CAL} .av-cell.is-today`).getAttribute('data-day')) === '13',
    'popup : la case du 13 est la case du jour');
  check((await p.locator(`${CAL} .av-cell[data-day="2"]`).getAttribute('aria-label')).includes('ouverte'), 'popup : une case déjà ouverte est dite « ouverte »');
  check((await p.locator(`${CAL} .av-cell[data-day="20"]`).getAttribute('aria-label')).includes('s’ouvre le 20 décembre'), 'popup : la case du 20 dit quand elle s’ouvre');

  // Case verrouillée : un message de patience, pas d'appel serveur.
  const n0 = opens(await log(p)).length;
  // Case verrouillée : aria-disabled (pas disabled) pour rester focusable ; le clic donne le message.
  await p.locator(`${CAL} .av-cell[data-day="20"]`).click({ force: true });
  await p.waitForTimeout(300);
  check((await p.textContent('body')).includes('Patience'), 'case du 20 verrouillée : message « Patience »');
  check(opens(await log(p)).length === n0, 'case verrouillée : aucun appel hg_advent_open');

  // Ouverture de la case du jour : la carte est révélée, un seul appel.
  await p.locator(`${CAL} .av-cell[data-day="13"]`).click();
  await p.waitForSelector(`${CAL} .av-rv .av-rv-card .hgc`, { timeout: 8000 }).catch(() => {});
  check(!!(await p.$(`${CAL} .av-rv .av-rv-card .hgc`)), 'case du 13 : la carte est révélée');
  check(opens(await log(p)).join() === '13', 'case du 13 : un seul appel hg_advent_open (jour 13)');
  check((await p.locator(`${CAL} .av-cell[data-day="13"]`).getAttribute('aria-label')).includes('ouverte'), 'case du 13 : marquée ouverte après l’ouverture');

  // Recliquer une case ouverte : on la montre, sans nouvel appel.
  await p.locator(`${CAL} .av-cell[data-day="2"]`).click();
  await p.waitForTimeout(200);
  check(opens(await log(p)).join() === '13', 'case déjà ouverte : aucun nouvel appel');
  check((await p.textContent(`${CAL} .av-rv`)).includes('Case du 2'), 'case déjà ouverte : son contenu est montré');

  // Case collective : le 6 (rattrapage) fait passer la jauge à 10 / 10, puis le bonus se réclame une fois.
  await p.close();
  p = await openPage(b2, { page: 'accueil', fixture: FIX, now: DEC13, width: 1280, reducedMotion: 'reduce', scenario: { avent: true, today: 13, opened: [1, 2, 3], groupCount: { 6: 9 } } });
  await ouvrirCalendrier(p);
  check((await p.locator(`${CAL} .av-cell[data-day="6"]`).getAttribute('aria-label')).includes('case collective'), 'case 6 : indiquée comme collective');
  await p.locator(`${CAL} .av-cell[data-day="6"]`).click();
  await p.waitForSelector('[data-claim="6"]', { timeout: 8000 }).catch(() => {});
  check(!!(await p.$('[data-claim="6"]')), 'jauge : seuil atteint (10 / 10), bouton « Réclamer » affiché');
  check((await p.textContent(`${CAL} .av-count`)).trim() === '10 / 10', 'jauge : affiche 10 / 10');
  await p.locator('[data-claim="6"]').click();
  await p.waitForTimeout(800);
  check((await log(p)).some((x) => x[1] === 'hg_advent_claim_group' && x[2]?.p_day === 6), 'bonus : appel hg_advent_claim_group pour la case 6');
  check(!(await p.$('[data-claim="6"]')) && (await p.textContent(`${CAL} .av-group`)).includes('Bonus réclamé'), 'bonus : réclamé, le bouton disparaît');
  check(!(await p.$('.av-remind')), 'accueil : pas de rappel sur l’accueil');
  check(!p.errs.filter((e) => !/^404 /.test(e)).length, 'accueil : aucune erreur console : ' + p.errs.join(' | '));
  await p.close();

  /* 3. Téléphone de 360 px : pas de défilement horizontal. */
  p = await openPage(b2, { page: 'accueil', fixture: FIX, now: DEC13, width: 360, height: 780, mobile: true, scenario: { avent: true, today: 13, opened: [] } });
  await p.click('.nav-toggle').catch(() => {}); // téléphone : le paquet est dans la barre, hors du menu replié
  await ouvrirCalendrier(p);
  check(await hscroll(p) <= 0, `360 px : pas de défilement horizontal (${await hscroll(p)} px)`);
  const tap = await p.locator(`${CAL} .av-cell`).first().boundingBox();
  check(!!tap && tap.height >= 44 && tap.width >= 44, `360 px : cases ≥ 44 px (${tap && Math.round(tap.width)}×${tap && Math.round(tap.height)})`);
  await p.close();

  /* 4. Page Cartes : rappel discret quand une case attend. */
  p = await openPage(b2, { page: 'cartes', fixture: FIX, now: DEC13, width: 1280, reducedMotion: 'reduce', scenario: { avent: true, today: 13, opened: [1, 2, 3] } });
  await p.waitForSelector('.av-remind', { timeout: 8000 }).catch(() => {});
  check(!!(await p.$('.av-remind')), 'cartes : rappel « case du calendrier de l’Avent » affiché');
  check((await p.textContent('.av-remind')).includes('cases du calendrier') || (await p.textContent('.av-remind')).includes('Une case'), 'cartes : le rappel compte les cases à ouvrir');
  await p.close();

  /* 5. Visiteur (sans compte) : aucune tuile, aucun appel. */
  p = await openPage(b2, { page: 'accueil', fixture: FIX, now: DEC13, width: 1280, scenario: { guest: true, avent: true, today: 13 } });
  await p.waitForTimeout(800);
  check(!(await p.$('.av-gift')), 'visiteur : aucun paquet cadeau');
  check(!(await log(p)).some((x) => x[1] === 'hg_advent_me'), 'visiteur : aucun appel hg_advent_me');
  await p.close();

  await b2.close();
  finish();
})();
