// Q1 · Visite guidée au premier passage (assets/js/core/tour.js), faux Supabase.
// - 390 px (téléphone) : profil sans date → bulle de bienvenue, le menu replié s'ouvre, 4 étapes, « Terminer », date écrite, menu refermé.
// - 1280 px : Échap passe la visite (date écrite, plus de bulle) ; Tab reste dans la bulle.
// - Page masquée : un membre sans accès à Cartes n'a pas l'étape Cartes (3 étapes).
// - Membre inscrit avant la visite (1970-01-01) : bandeau « Nouveau » proposé une fois, pas de visite ; « Faire la visite » la lance.
// - Visite déjà vue : rien. Page Aide : bouton « Revoir la visite » → accueil.html#visite relance la visite.
// - Pas de défilement horizontal.
// Lancer : node tests/parcours-visite.cjs
const path = require('path');
const { SHOTS, check, finish, openPage, hscroll, sleep, chromium } = require('./lib/harness.cjs');

const U2 = '00000002-0000-4000-8000-000000000002';
/** Date de visite du profil connecté dans la base simulée. */
const tourAt = (p, uid) => p.evaluate((u) => (window.__DB.hg_profiles.find((x) => x.id === u) || {}).tour_done_at, uid);
const ME = '11111111-1111-4111-8111-111111111111';

(async () => {
  const browser = await chromium.launch();

  /* ---------- Téléphone : visite complète ---------- */
  {
    const p = await openPage(browser, { page: 'accueil', width: 390, height: 844, mobile: true, dpr: 2, scenario: { tour: null } });
    const bubble = p.locator('.tour-bubble');
    await bubble.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    check(await bubble.isVisible(), '390 : bulle de bienvenue visible au premier passage');
    check(/Bienvenue dans le gang/.test(await p.locator('#tour-t').textContent()), '390 : titre « Bienvenue dans le gang ! »');
    check(/4 étapes/.test(await p.locator('#tour-d').textContent()), '390 : « l’essentiel en 4 étapes »');
    check(await p.evaluate(() => document.activeElement?.classList.contains('tour-next')), '390 : focus sur le bouton principal de la bulle');
    check(await bubble.getAttribute('role') === 'dialog' && !!(await bubble.getAttribute('aria-describedby')), '390 : role=dialog et aria-describedby');
    await p.click('.tour-next'); await sleep(450);
    check((await p.locator('#tour-c').textContent()) === 'Étape 1 / 4', `390 : compteur « Étape 1 / 4 » (${await p.locator('#tour-c').textContent()})`);
    check(await p.getAttribute('.site-header .nav-toggle', 'aria-expanded') === 'true', '390 : le menu replié est ouvert pour l’étape menu');
    check(await p.locator('.tour-spot').isVisible(), '390 : l’élément est éclairé');
    await p.click('.tour-next'); await sleep(450);
    check((await p.locator('#tour-t').textContent()) === 'Tes cartes t’attendent', '390 : étape 2 = Cartes');
    await p.screenshot({ path: path.join(SHOTS, 'visite-390-etape2.png') });
    check(await hscroll(p) <= 0, '390 : pas de défilement horizontal pendant la visite');
    await p.click('.tour-next'); await sleep(450);
    check(await p.getAttribute('.site-header .nav-toggle', 'aria-expanded') === 'false', '390 : menu refermé pour l’étape loupe');
    await p.click('.tour-next'); await sleep(450);
    check((await p.locator('.tour-next').textContent()) === 'Terminer', '390 : dernière étape → « Terminer »');
    const box = await bubble.boundingBox();
    check(box && box.x >= 0 && box.x + box.width <= 390, '390 : bulle entièrement dans l’écran');
    await p.click('.tour-next'); await sleep(400);
    check(!(await p.locator('.tour').count()), '390 : visite terminée, plus de voile');
    const at = await tourAt(p, ME);
    check(!!at && !String(at).startsWith('1970'), `390 : date de visite écrite (${at})`);
    check(!p.errs.length, '390 : aucune erreur : ' + p.errs.join(' | '));
    await p.ctx.close();
  }

  /* ---------- Ordinateur : Échap passe la visite ---------- */
  {
    const p = await openPage(browser, { page: 'accueil', width: 1280, scenario: { tour: null } });
    await p.locator('.tour-bubble').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await p.click('.tour-next'); await sleep(350);
    await p.screenshot({ path: path.join(SHOTS, 'visite-1280-etape1.png') });
    await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
    check(await p.evaluate(() => !!document.activeElement?.closest('.tour-bubble')), '1280 : Tab reste dans la bulle');
    await p.keyboard.press('Escape'); await sleep(300);
    check(!(await p.locator('.tour').count()), '1280 : Échap passe la visite');
    check(!!(await tourAt(p, ME)), '1280 : date écrite après « Passer »');
    check(await hscroll(p) <= 0, '1280 : pas de défilement horizontal');
    check(!p.errs.length, '1280 : aucune erreur : ' + p.errs.join(' | '));
    await p.ctx.close();
  }

  /* ---------- Page masquée : étape Cartes sautée ---------- */
  {
    const p = await openPage(browser, { page: 'accueil', width: 1280, scenario: { tour: null, uid: U2 } });
    await p.locator('.tour-bubble').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    check(/3 étapes/.test(await p.locator('#tour-d').textContent() || ''), 'sans accès à Cartes : 3 étapes annoncées');
    const titres = [];
    for (let i = 0; i < 3; i++) { await p.click('.tour-next'); await sleep(250); titres.push(await p.locator('#tour-t').textContent()); }
    check(!titres.includes('Tes cartes t’attendent'), `étape Cartes sautée (${titres.join(' / ')})`);
    await p.click('.tour-next'); await sleep(250);
    check(!(await p.locator('.tour').count()), 'visite à 3 étapes terminée');
    await p.ctx.close();
  }

  /* ---------- Membre inscrit avant la visite : bandeau une fois ---------- */
  {
    const p = await openPage(browser, { page: 'accueil', width: 390, height: 844, scenario: { tour: '1970-01-01T00:00:00Z' } });
    await sleep(1500);
    check(!(await p.locator('.tour-bubble').count()), 'ancien membre : pas de visite d’office');
    check(await p.locator('.tour-banner').isVisible(), 'ancien membre : bandeau « Nouveau : la visite du site » proposé');
    const at = await tourAt(p, ME);
    check(!!at && !String(at).startsWith('1970'), 'bandeau proposé une seule fois (date écrite dès l’affichage)');
    const btns = await p.$$eval('.tour-banner .btn', (l) => l.map((b) => b.getBoundingClientRect().height));
    check(btns.every((h) => h >= 44), 'bandeau : boutons d’au moins 44 px');
    check(await hscroll(p) <= 0, 'bandeau : pas de défilement horizontal à 390');
    await p.click('.tour-banner-go');
    await p.locator('.tour-bubble').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    check((await p.locator('#tour-c').textContent()) === 'Étape 1 / 4', '« Faire la visite » lance la visite (sans bienvenue)');
    await p.keyboard.press('Escape');
    await p.ctx.close();
  }

  /* ---------- Visite déjà vue, puis « Revoir la visite » depuis l'Aide ---------- */
  {
    const p = await openPage(browser, { page: 'aide', width: 1280, scenario: { tour: '2026-10-01T10:00:00Z' } });
    const revoir = p.locator('a.aide-visite');
    check(await revoir.isVisible(), 'Aide : bouton « Revoir la visite » visible pour un membre');
    await revoir.click();
    await p.waitForURL(/accueil\.html/, { timeout: 8000 }).catch(() => {});
    await p.locator('.tour-bubble').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    check(await p.locator('.tour-bubble').isVisible(), 'accueil.html#visite : la visite se relance');
    check(!/#visite/.test(p.url()), 'l’ancre #visite est retirée de l’adresse');
    await p.keyboard.press('Escape');
    await p.goto(p.url().replace(/#.*$/, '')); await sleep(1500);
    check(!(await p.locator('.tour-bubble').count()) && !(await p.locator('.tour-banner').count()), 'visite déjà vue : ni bulle ni bandeau');
    await p.ctx.close();
  }

  /* ---------- Visiteur : rien ---------- */
  {
    const p = await openPage(browser, { page: 'aide', width: 1280, scenario: { guest: true } });
    check(!(await p.locator('a.aide-visite').count()), 'visiteur : pas de « Revoir la visite »');
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
