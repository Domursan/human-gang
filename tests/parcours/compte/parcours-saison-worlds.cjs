// Parcours : saison des Worlds (T3, migration 096).
// Accueil pendant la saison : bandeau « Saison des Worlds », booster de la saison en boutique, trois quêtes saisonnières
// (une à réclamer), mention de la soirée finale. Hors saison : rien. Visiteur : rien. Téléphone 360 px : pas de
// défilement horizontal. Le faux Supabase simule hg_saison_state (le booster C1 n’est pas dans cette branche).
// Les pronostics (J5) ont été retirés : plus de tuile « Pronostics Worlds » ni de badge « Fidèle de la saison ».
// Administration (section 6) : Fête foraine › Calendrier de l’Avent (réglages saisons.avent), Saison des Worlds (quêtes
// et page des pronostics : saisons.worlds.quetes / pronos) et Anniversaire du gang (booster : saisons.anniversaire.booster).
// Chaque enregistrement est fusionné dans hg_settings.saisons : les autres sous-clés restent en place.
// Faux Supabase : fixtures/fake-sb-saisons.mjs (scénario worlds, worldsNext ; réglages saisonniers via scenario.settings).
// Lancer : flock .../nuit2/pw.lock env NODE_PATH=... node tests/parcours/compte/parcours-saison-worlds.cjs (voir RULES.md)
const { check, finish, openPage, adminSection, hscroll, log, chromium, sleep } = require('../../lib/harness.cjs');

const FIX = 'fake-sb-saisons.mjs';
const SAISON = '2026-11-02T10:00:00Z';
/** Réglages saisonniers de départ (hg_settings.saisons), avec des sous-clés que l'admin ne règle pas ici. */
const SETTINGS = [{ key: 'saisons', value: {
  avent: { actif: true, seuil: 10, seuil_pct: 70, carte_repli: 30 },
  worlds: { actif: false, quetes: ['boosters_5'], pronos: '/pages/jeux/jeux.html#pronos', theme: 'worlds', mots: ['worlds'] },
  anniversaire: { annee: 2022, fenetre: 1, booster: 'classique', cartes: { 2027: 'k1' } },
} }];
/** Enregistrements de saisons.* envoyés (upsert de hg_settings). */
const saisonsUpserts = async (p) => (await log(p)).filter((x) => x[0] === 'upsert' && x[1] === 'hg_settings' && x[2]?.key === 'saisons');
/** Valeur de hg_settings.saisons dans la base simulée. */
const saisons = (p) => p.evaluate(() => window.__DB.hg_settings.find((r) => r.key === 'saisons')?.value);

(async () => {
  const browser = await chromium.launch();

  /* 1. Saison allumée. */
  let p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 1280, now: SAISON, scenario: { worlds: true } });
  await p.waitForSelector('#wd-title', { timeout: 8000 }).catch(() => {});
  check((await p.textContent('#wd-title').catch(() => '')).includes('Saison des Worlds'), 'saison : bandeau « Saison des Worlds » sur l’accueil');
  check(!!(await p.$('#saison-home:not([hidden])')), 'saison : le bloc de l’accueil est visible');
  check(!(await p.$('.wd-team')) && !(await p.$('a[href="/pages/jeux/jeux.html#pronos"]')), 'saison : aucune tuile de pronostics (retirée)');
  check((await p.textContent('#saison-home')).includes('Saison esport'), 'saison : le booster de la saison est proposé en boutique');
  check(!!(await p.$('a[href="/pages/cartes/cartes.html#boutique"]')), 'saison : lien vers la boutique');
  check(await p.locator('.wd-quests li').count() === 3, 'saison : trois quêtes saisonnières affichées');
  check((await p.textContent('.wd-quests')).includes('Ouvre un booster de la saison esport'), 'saison : la quête « booster de la saison » est listée');
  check(!!(await p.$('a[href="/pages/cartes/cartes.html#ouverture"]')) && (await p.textContent('#saison-home')).includes('Réclamer dans les quêtes'), 'saison : une quête terminée se réclame dans les quêtes');
  check(!(await p.$('.wd-ring')), 'saison : pas de badge « Fidèle » (retiré avec les pronostics)');
  check((await p.textContent('#saison-home')).includes('La soirée finale'), 'saison : le drop de la finale est annoncé');
  check(!p.errs.filter((e) => !/^404 /.test(e)).length, 'saison : aucune erreur console : ' + p.errs.join(' | '));
  await p.close();

  /* 2. Hors saison : rien sur l'accueil. */
  p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 1280, now: SAISON, scenario: { worlds: false } });
  await p.waitForTimeout(800);
  check(!(await p.$('#wd-title')), 'hors saison : aucun bandeau des Worlds');
  await p.close();

  /* 3. Visiteur : rien. */
  p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 1280, now: SAISON, scenario: { guest: true, worlds: true } });
  await p.waitForTimeout(800);
  check(!(await p.$('#wd-title')), 'visiteur : aucun bandeau des Worlds');
  await p.close();

  /* 4. Téléphone 360 px. */
  p = await openPage(browser, { page: 'accueil', fixture: FIX, width: 360, height: 780, mobile: true, now: SAISON, scenario: { worlds: true } });
  await p.waitForSelector('#wd-title', { timeout: 8000 }).catch(() => {});
  check(await hscroll(p) <= 0, `360 px : pas de défilement horizontal (${await hscroll(p)} px)`);
  await p.close();

  /* 5. Administration : l'interrupteur de la saison est dans Vie du gang › Rendez-vous. */
  p = await openPage(browser, { page: 'admin', fixture: FIX, width: 1280, hash: '#fete/saison-worlds', now: SAISON });
  await p.waitForSelector('#zw-deb, #zs-body .empty', { timeout: 8000 }).catch(() => {});
  check(!!(await p.$('#saisons')) , 'admin : section « Saisons » présente dans le panel');
  check((await log(p)).some((x) => x[1] === 'hg_saison_admin'), 'admin : l’état de la saison est lu (hg_saison_admin)');
  await p.close();

  /* 6a. Calendrier de l'Avent : réglages du calendrier (saisons.avent). */
  p = await openPage(browser, { page: 'admin', fixture: FIX, width: 1280, now: SAISON, scenario: { settings: SETTINGS } });
  await adminSection(p, 'fete/avent');
  await p.waitForSelector('[data-zac]', { timeout: 8000 }).catch(() => {});
  check(await p.inputValue('#zac-r') === '30' && await p.inputValue('#zac-s') === '10' && await p.inputValue('#zac-p') === '70',
    'avent : réglages du calendrier affichés depuis saisons.avent (repli 30, seuil 10, 70 %)');
  check(await p.isChecked('[data-zac] [name="actif"]'), 'avent : calendrier actif coché');
  await p.fill('#zac-s', '0');
  await p.click('[data-zac] [type="submit"]');
  await sleep(300);
  check((await saisonsUpserts(p)).length === 0, 'avent : seuil hors bornes (0) refusé, rien n’est enregistré');
  await p.fill('#zac-s', '12');
  await p.fill('#zac-r', '25');
  await p.click('[data-zac] [type="submit"]');
  await sleep(500);
  const sv = await saisons(p);
  check(sv?.avent?.seuil === 12 && sv?.avent?.carte_repli === 25 && sv?.avent?.seuil_pct === 70 && sv?.avent?.actif === true,
    'avent : seuil 12 et Paillettes de repli 25 enregistrés, pourcentage et interrupteur gardés');
  check(sv?.worlds?.quetes?.[0] === 'boosters_5' && sv?.anniversaire?.cartes?.['2027'] === 'k1', 'avent : Worlds et anniversaire gardés dans saisons');
  await p.close();

  /* 6b. Saison des Worlds : quêtes de la saison et page des pronostics (saisons.worlds). */
  p = await openPage(browser, { page: 'admin', fixture: FIX, width: 1280, now: SAISON, scenario: { settings: SETTINGS } });
  await adminSection(p, 'fete/saison-worlds');
  await p.waitForSelector('[data-zw]', { timeout: 8000 }).catch(() => {});
  check(await p.isChecked('input[name="quete"][value="boosters_5"]') && !(await p.isChecked('input[name="quete"][value="echange_1"]')),
    'worlds : quêtes de la saison cochées depuis saisons.worlds.quetes');
  check(await p.inputValue('#zw-p') === '/pages/jeux/jeux.html#pronos', 'worlds : page des pronostics affichée (/pages/jeux/jeux.html#pronos)');
  await p.check('input[name="quete"][value="echange_1"]');
  await p.fill('#zw-p', 'Pronos Page !');
  await p.click('[data-zw] [type="submit"]');
  await sleep(300);
  check(!(await log(p)).some((x) => x[0] === 'rpc' && x[1] === 'hg_saison_set'), 'worlds : page des pronostics invalide refusée, rien n’est enregistré');
  await p.fill('#zw-p', '/pages/jeux/jeux.html#worlds');
  await p.click('[data-zw] [type="submit"]');
  await sleep(500);
  check((await log(p)).some((x) => x[0] === 'rpc' && x[1] === 'hg_saison_set' && x[2]?.p_slug === 'worlds'), 'worlds : enregistrement par hg_saison_set');
  const ws = (await saisons(p))?.worlds || {};
  check(JSON.stringify(ws.quetes) === JSON.stringify(['boosters_5', 'echange_1']) && ws.pronos === '/pages/jeux/jeux.html#worlds',
    'worlds : quêtes (2) et pronostics enregistrés dans saisons.worlds');
  check(ws.theme === 'worlds' && JSON.stringify(ws.mots) === '["worlds"]', 'worlds : thème et mots des moments gardés');
  await p.close();

  /* 6c. Anniversaire du gang : booster du cadeau (saisons.anniversaire.booster). */
  p = await openPage(browser, { page: 'admin', fixture: FIX, width: 1280, now: SAISON, scenario: { settings: SETTINGS } });
  await adminSection(p, 'fete/anniv-gang');
  await p.waitForSelector('[data-za]', { timeout: 8000 }).catch(() => {});
  check(await p.inputValue('#za-b') === 'classique', 'anniversaire : booster du cadeau affiché (classique, saisons.anniversaire.booster)');
  await p.selectOption('#za-b', 'serie');
  await p.click('[data-za] [type="submit"]');
  await sleep(500);
  const an = (await saisons(p))?.anniversaire || {};
  check(an.booster === 'serie' && an.fenetre === 1 && an.cartes?.['2027'] === 'k1', 'anniversaire : booster « serie » enregistré, fenêtre et cartes gardées');
  await p.close();

  /* 6d. Téléphone 390 px : les trois parties s'affichent sans défilement horizontal, sans erreur. */
  for (const [route, sel] of [['fete/avent', '[data-zac]'], ['fete/saison-worlds', '[data-zw]'], ['fete/anniv-gang', '[data-za]']]) {
    p = await openPage(browser, { page: 'admin', fixture: FIX, width: 390, height: 780, mobile: true, now: SAISON, scenario: { settings: SETTINGS } });
    await adminSection(p, route);
    await p.waitForSelector(sel, { timeout: 8000 }).catch(() => {});
    check(await hscroll(p) <= 0, `${route} 390 px : pas de défilement horizontal (${await hscroll(p)} px)`);
    check(!p.errs.filter((e) => !/^404 /.test(e)).length, `${route} : aucune erreur console : ` + p.errs.join(' | '));
    await p.close();
  }

  await browser.close();
  finish();
})();
