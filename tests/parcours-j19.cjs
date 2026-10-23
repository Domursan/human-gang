// Parcours : idée J19, soirée complète (onglet « Soirée complète » de jeux.html, tuile de l'accueil, admin, paquet xJ4).
// Jauge « n / seuil », avatars des présents seulement, « J’y suis » (hg_night_here), soirée complète au seuil ;
// soirée à venir : pas de bouton ; temps réel ; admin « Saisons et soirées » (création de soirée) ; 390 et 360 px.
// Faux Supabase : fixtures/fake-sb.mjs (scénario night).
const { check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;

(async () => {
  const browser = await chromium.launch();
  /* ---------- Onglet de la page Jeux ---------- */
  let p = await openPage(browser, { page: 'jeux', hash: '#soiree', width: 390, height: 900, scenario: { night: { threshold: 3, presents: [U(2)] } } });
  await p.waitForSelector('.sr-carte', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.sr-titre').innerText()) === 'Soirée Gartic', 'onglet : titre de la soirée');
  check((await p.locator('.sr-pill').innerText()).includes('En cours'), 'onglet : « En cours »');
  check((await p.locator('.sr-bas').innerText()).replace(/\s+/g, ' ').includes('1 / 3'), 'jauge : 1 / 3');
  check((await p.locator('.sr-presents li:not(.sr-vide)').count()) === 1 && (await p.locator('.sr-vide').count()) === 2, 'présents : 1 avatar, 2 places libres (aucun absent nommé)');
  check((await p.locator('.sr-boite').innerText()).includes('60 % des 13 membres actifs'), 'seuil : explication 60 % des membres actifs');
  await p.click('[data-ici]');
  await p.waitForSelector('.sr-ici', { timeout: 4000 }).catch(() => {});
  const here = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_night_here');
  check(here.length === 1 && here[0][2].p_night === 'night-1', 'J’y suis : hg_night_here(night-1) une fois');
  check((await p.locator('.sr-bas').innerText()).replace(/\s+/g, ' ').includes('2 / 3') && (await p.locator('.sr-ici').count()) === 1, 'après J’y suis : 2 / 3 et « Tu es noté présent »');
  check(await p.evaluate(() => document.activeElement?.classList.contains('sr-ici')), 'focus : sur le message de présence');
  // Temps réel : un 3e membre arrive → soirée complète
  const tables = await p.evaluate(() => window.__fakeRealtime?.tables?.() || []);
  check(tables.includes('hg_night_presence'), 'temps réel : abonnement aux présences');
  await p.evaluate(() => document.activeElement?.blur());
  await p.evaluate((id) => { window.__X4.presents.push(id); window.__fakeRealtime.emit('hg_night_presence', { new: { night_id: 'night-1', user_id: id } }); }, U(3));
  await sleep(900);
  check((await p.locator('.sr-bas').innerText()).replace(/\s+/g, ' ').includes('3 / 3') && (await p.locator('.sr-pill').innerText()).includes('Complète'), 'temps réel : un 3e présent arrive → 3 / 3, « Complète »');
  check(await hscroll(p) <= 0, '390 px : pas de défilement horizontal');
  check(p.errs.length === 0, 'aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Soirée complète et soirée à venir ---------- */
  p = await openPage(browser, { page: 'jeux', hash: '#soiree', width: 360, height: 800, scenario: { night: { threshold: 2, presents: [U(2), U(3)] } } });
  await p.waitForSelector('.sr-carte', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.sr-pill').innerText()).includes('Complète') && (await p.locator('.sr-bas').innerText()).includes('Défi réussi'), 'soirée complète : « Complète », « Défi réussi ! »');
  check(await hscroll(p) <= 0, '360 px : pas de défilement horizontal');
  await p.ctx.close();
  p = await openPage(browser, { page: 'jeux', hash: '#soiree', width: 390, scenario: { night: { live: false, presents: [] } } });
  await p.waitForSelector('.sr-carte', { timeout: 5000 }).catch(() => {});
  check((await p.locator('[data-ici]').count()) === 0 && (await p.locator('.sr-carte').innerText()).includes('apparaîtra'), 'soirée à venir : pas de bouton, heure annoncée');
  await p.ctx.close();
  p = await openPage(browser, { page: 'jeux', hash: '#soiree', width: 390 });
  await p.waitForSelector('.sr', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.sr').innerText()).includes('Pas de soirée prévue'), 'sans soirée : message');
  await p.ctx.close();

  /* ---------- Tuile de l'accueil ---------- */
  p = await openPage(browser, { page: 'accueil', width: 390, height: 900, scenario: { night: { threshold: 3, presents: [U(2)] } } });
  await p.waitForSelector('#soiree:not([hidden])', { timeout: 5000 }).catch(() => {});
  check((await p.locator('#soiree').innerText()).includes('Soirée complète · 1 / 3'), 'accueil : « Soirée complète · 1 / 3 »');
  check((await p.locator('#soiree .home-soiree-avs li').count()) === 1, 'accueil : avatars des présents');
  await p.click('#soiree [data-ici]');
  await p.waitForSelector('#soiree .home-soiree-ok', { timeout: 4000 }).catch(() => {});
  check((await p.locator('#soiree').innerText()).includes('2 / 3') && (await p.locator('#soiree .home-soiree-ok').count()) === 1, 'accueil : J’y suis → 2 / 3, « Tu es présent »');
  check(await hscroll(p) <= 0, 'accueil 390 px : pas de défilement horizontal');
  check(p.errs.length === 0, 'accueil : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Admin : Saisons et soirées ---------- */
  p = await openPage(browser, { page: 'admin', width: 1280 });
  await adminSection(p, 'cartes/saisons');
  await p.waitForSelector('#ajx-night-form', { timeout: 5000 }).catch(() => {});
  check((await p.locator('#ajx-saison-form .ajx-table tbody tr').count()) === 6, 'admin : barème des 6 catégories');
  check((await p.locator('#jeux4-root').innerText()).includes('Saison d’été 2026'), 'admin : saison terminée listée');
  await p.fill('#ajx-nt', 'Soirée raclette');
  await p.fill('#ajx-nd', '2026-10-31T20:00');
  await p.fill('#ajx-nf', '2026-11-01T02:00');
  await p.click('#ajx-night-form [type="submit"]');
  await sleep(500);
  const sv = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_night_save');
  check(sv.length === 1 && sv[0][2].p_title === 'Soirée raclette' && sv[0][2].p_threshold === null && sv[0][2].p_starts === '2026-10-31T19:00:00.000Z', 'admin : hg_night_save (heure suisse convertie, seuil par défaut)');
  check((await p.locator('#ajx-soirees').innerText()).includes('Soirée raclette'), 'admin : la nouvelle soirée est listée');
  await p.click('#ajx-saison-form [type="submit"]');
  await sleep(400);
  const ss = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_season_save');
  check(ss.length === 1 && ss[0][2].p_caps.quiz.cap === 50 && ss[0][2].p_rewards.podium[0] === 300, 'admin : hg_season_save avec barème et récompenses');
  check(p.errs.length === 0, 'admin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
