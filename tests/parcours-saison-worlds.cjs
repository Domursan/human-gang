// Parcours : saison des Worlds (T3, migration 096).
// Accueil pendant la saison : bandeau « Saison des Worlds », tuile « Pronostics Worlds » (deux équipes, « Pronostiquer »
// vers jeux.html#pronos), booster de la saison en boutique, trois quêtes saisonnières (une à réclamer), badge « Fidèle
// de la saison ». Hors saison : rien. Pas de match ouvert : message sans erreur. Visiteur : rien. Téléphone 360 px :
// pas de défilement horizontal. Le faux Supabase simule hg_saison_state (les pronostics J5 et le booster C1 ne sont pas
// dans cette branche : la tuile ne dépend que de la réponse de hg_saison_state).
// Faux Supabase : fixtures/fake-sb-saisons.mjs (scénario worlds, worldsNext).
// Lancer : flock .../nuit2/pw.lock env NODE_PATH=... node tests/parcours-saison-worlds.cjs (voir RULES.md)
const { check, finish, openPage, hscroll, log, chromium } = require('./lib/harness.cjs');

const FIX = 'fake-sb-saisons.mjs';
const SAISON = '2026-11-02T10:00:00Z';

(async () => {
  const browser = await chromium.launch();

  /* 1. Saison allumée, un match à pronostiquer. */
  let p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 1280, now: SAISON, scenario: { worlds: true } });
  await p.waitForSelector('#wd-title', { timeout: 8000 }).catch(() => {});
  check((await p.textContent('#wd-title').catch(() => '')).includes('Saison des Worlds'), 'saison : bandeau « Saison des Worlds » sur l’accueil');
  check(!!(await p.$('#saison-home:not([hidden])')), 'saison : le bloc de l’accueil est visible');
  check((await p.textContent('#saison-home')).includes('Quart de finale'), 'saison : le prochain match est affiché');
  check(await p.locator('.wd-team').count() === 2, 'saison : deux équipes proposées (deux liens vers les pronostics)');
  check((await p.getAttribute('.wd-team', 'href')) === 'jeux.html#pronos', 'saison : les pronostics mènent à jeux.html#pronos');
  // Le membre a déjà pronostiqué (fixture : mine « t1 ») : son choix est marqué, sans bouton « Pronostiquer ».
  check(await p.locator('.wd-team.is-mine').count() === 1, 'saison : son pronostic est marqué (« Ton prono »)');
  check(!(await p.$('a.wd-btn[href="jeux.html#pronos"]')), 'saison : pas de bouton « Pronostiquer » quand le pronostic est fait');
  check((await p.textContent('#saison-home')).includes('Saison esport'), 'saison : le booster de la saison est proposé en boutique');
  check(!!(await p.$('a[href="cartes.html#boutique"]')), 'saison : lien vers la boutique');
  check(await p.locator('.wd-quests li').count() === 3, 'saison : trois quêtes saisonnières affichées');
  check((await p.textContent('.wd-quests')).includes('Ouvre un booster de la saison esport'), 'saison : la quête « booster de la saison » est listée');
  check(!!(await p.$('a[href="cartes.html#ouverture"]')) && (await p.textContent('#saison-home')).includes('Réclamer dans les quêtes'), 'saison : une quête terminée se réclame dans les quêtes');
  check((await p.textContent('.wd-ring').catch(() => '')).includes('6/10'), 'saison : badge « Fidèle » à 6 sur 10');
  check((await p.textContent('#saison-home')).includes('La soirée finale'), 'saison : le drop de la finale est annoncé');
  check(!p.errs.filter((e) => !/^404 /.test(e)).length, 'saison : aucune erreur console : ' + p.errs.join(' | '));
  await p.close();

  /* 2. Saison sans match ouvert : le message remplace la tuile, sans erreur. */
  p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 1280, now: SAISON, scenario: { worlds: true, worldsNext: null } });
  await p.waitForSelector('#wd-title', { timeout: 8000 }).catch(() => {});
  check((await p.textContent('#saison-home')).includes('Pas de match ouvert'), 'sans match ouvert : message « Pas de match ouvert »');
  check(!(await p.$('.wd-team')), 'sans match ouvert : aucune équipe à pronostiquer');
  await p.close();

  /* 3. Hors saison : rien sur l'accueil. */
  p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 1280, now: SAISON, scenario: { worlds: false } });
  await p.waitForTimeout(800);
  check(!(await p.$('#wd-title')), 'hors saison : aucun bandeau des Worlds');
  await p.close();

  /* 4. Visiteur : rien. */
  p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 1280, now: SAISON, scenario: { guest: true, worlds: true } });
  await p.waitForTimeout(800);
  check(!(await p.$('#wd-title')), 'visiteur : aucun bandeau des Worlds');
  await p.close();

  /* 5. Téléphone 360 px. */
  p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 360, height: 780, mobile: true, now: SAISON, scenario: { worlds: true } });
  await p.waitForSelector('#wd-title', { timeout: 8000 }).catch(() => {});
  check(await hscroll(p) <= 0, `360 px : pas de défilement horizontal (${await hscroll(p)} px)`);
  await p.close();

  /* 6. Administration : l'interrupteur de la saison est dans Vie du gang › Rendez-vous. */
  p = await openPage(browser, { page: 'admin', fixture: FIX, width: 1280, hash: '#vie/saison-worlds', now: SAISON });
  await p.waitForSelector('#zw-deb, #zs-body .empty', { timeout: 8000 }).catch(() => {});
  check(!!(await p.$('#saisons')) , 'admin : section « Saisons » présente dans le panel');
  check((await log(p)).some((x) => x[1] === 'hg_saison_admin'), 'admin : l’état de la saison est lu (hg_saison_admin)');
  await p.close();

  await browser.close();
  finish();
})();
