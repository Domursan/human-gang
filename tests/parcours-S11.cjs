// Parcours : Récap annuel enrichi (recap.html), idée S11, et vue admin « Contenus proposés ».
// Nouvelles diapos (carte la plus rare du gang, morceaux de la semaine, citations, ma carte et mes boosters) ;
// diapo sautée si sa donnée est trop faible ; diapo masquée par le Staff ; parcours sans erreur.
// Admin : vue Souvenirs > Contenus proposés (validation d'une citation, masquage des diapos du récap).
// Faux Supabase : fixtures/fake-sb-contenus.mjs.
const { SHOTS, check, finish, openPage, adminSection, log, sleep, chromium } = require('./lib/harness.cjs');
const path = require('path');
const FX = 'fake-sb-contenus.mjs';

const keys = (p) => p.$$eval('.rc-slide', (els) => els.map((e) => [...e.classList].find((c) => c.startsWith('rc-slide-')).slice(9)));

(async () => {
  const T0 = Date.now();
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'recap', fixture: FX, width: 390, height: 844, reducedMotion: 'reduce' });
  await p.waitForSelector('.rc-slide', { timeout: 6000 }).catch(() => {});
  let k = await keys(p);
  check(k.includes('carte') && k.includes('morceaux') && k.includes('citations') && k.includes('ma_carte'), 'nouvelles diapos : carte, morceaux, citations, ma carte');
  check(k.indexOf('ma_carte') < k.indexOf('moi'), '« Ma carte » avant « Ton année »');
  check((await p.locator('.rc-slide-carte .hgc, .rc-slide-carte [class*="hgc"]').count()) > 0, 'diapo carte : rendu de carte du jeu');
  check((await p.locator('.rc-slide-ma_carte').innerText()).includes('boosters ouverts'), 'diapo ma carte : boosters ouverts');
  // Parcours complet : aucune diapo vide
  const empty = await p.$$eval('.rc-slide .rc-slide-inner', (els) => els.filter((e) => e.innerText.trim().length < 3).length);
  check(empty === 0, 'aucune diapo vide');
  // Parcours jusqu'à la dernière diapo : « Suivant » est désactivé sur la dernière (recap.js), on s'arrête là
  // (sans délai court, un clic sur un bouton désactivé attendrait 30 s).
  for (let i = 0; i < k.length; i++) {
    if (await p.isDisabled('#rc-next', { timeout: 1000 }).catch(() => true)) break;
    await p.click('#rc-next', { timeout: 1000 }).catch(() => {}); await sleep(60);
  }
  console.log('  (temps) parcours récap terminé à ' + ((Date.now() - T0) / 1000).toFixed(0) + ' s');
  await p.screenshot({ path: path.join(SHOTS, 'S11-390.png') }).catch(() => {});
  check(p.errs.length === 0, 'récap : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  p = await openPage(browser, { page: 'recap', fixture: FX, scenario: { recapMasquees: ['carte', 'citations'] }, reducedMotion: 'reduce' });
  await p.waitForSelector('.rc-slide', { timeout: 6000 }).catch(() => {});
  k = await keys(p);
  check(!k.includes('carte') && !k.includes('citations') && k.includes('morceaux') && k.includes('intro') && k.includes('moi'), 'diapos masquées par le Staff absentes, intro et « Ton année » gardées');
  await p.ctx.close();

  /* ---------- Admin : Contenus proposés ---------- */
  p = await openPage(browser, { page: 'admin', fixture: FX });
  await adminSection(p, 'camp/souvenirs').catch(() => {});
  await p.evaluate(() => { location.hash = '#camp/souvenirs/contenus'; });
  await p.waitForSelector('.sv-contenus .sv-ct-row', { timeout: 6000 }).catch(() => {});
  check((await p.locator('.sv-contenus [role="tab"]').count()) === 3, 'admin : 3 onglets (citations, playlist, récap)');
  check((await p.locator('.sv-contenus').innerText()).includes('2 citations en attente'), 'admin : file de validation (2 en attente)');
  await p.locator('[data-ct-quote="valider"]').first().click();
  await sleep(400);
  check((await log(p)).some((e) => e[1] === 'hg_quote_review' && e[2].p_action === 'valider'), 'admin : validation d’une citation (hg_quote_review)');
  await p.click('[data-ct-tab="playlist"]');
  await p.waitForSelector('[data-ct-track]', { timeout: 4000 }).catch(() => {});
  await p.locator('[data-ct-track="masquer"]').first().click();
  await sleep(300);
  check((await log(p)).some((e) => e[1] === 'hg_track_moderate' && e[2].p_action === 'masquer'), 'admin : masquer un morceau');
  await p.click('[data-ct-tab="recap"]');
  await p.waitForSelector('#sv-ct-recap', { timeout: 4000 }).catch(() => {});
  await p.check('#sv-ct-recap input[value="morceaux"]');
  await p.click('#sv-ct-recap button[type="submit"]');
  await sleep(300);
  const set = (await log(p)).filter((e) => e[1] === 'hg_recap_diapos_set');
  check(set.length === 1 && set[0][2].p_keys.includes('morceaux'), 'admin : diapos masquées enregistrées (hg_recap_diapos_set)');
  await p.screenshot({ path: path.join(SHOTS, 'S11-admin.png') }).catch(() => {});
  check(p.errs.length === 0, 'admin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();
  await browser.close();
  finish();
})();
