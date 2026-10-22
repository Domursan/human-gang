// Parcours : réglages du lot 4 (badges automatiques, jeu de cartes, drops, quêtes) dans le panel admin.
// Couvre : Cartes › Économie (valeurs affichées = défauts, enregistrement de cards.drops et cards.quetes_par_semaine,
// validation durée par défaut > durée max, « Rétablir les valeurs par défaut » d'un groupe) ;
// Cartes › Drops (bornes lues dans cards.drops : attribut max, durée proposée, refus hors bornes) ;
// Vie › Badges (formulaire des critères : enregistrement dans hg_settings.badges, validation, défauts) ;
// Réglages du site (la clé badges est listée et renvoie vers Vie › Badges).
// Les contrôles portent sur l'état du faux Supabase (window.__DB) et sur les appels reçus (window.__LOG).
// Le faux Supabase ne rejoue pas les fonctions SQL : les replis et bornes SQL sont vérifiés par la migration 053 (revue).
// Lancer : node tests/parcours-reglages-lot4.cjs
const { check, finish, openPage, adminSection, chromium } = require('./lib/harness.cjs');

/** Tiroir de dialogue ouvert (dialog.ui-drawer[open]). */
const drawer = (p) => p.locator('dialog.ui-drawer[open]');
/** Attend que le tiroir soit fermé (retiré de la page). */
const waitClosed = (p) => p.waitForSelector('dialog.ui-drawer', { state: 'detached', timeout: 5000 }).catch(() => {});
/** Valeur de la ligne hg_settings de la clé key dans la base simulée (copie JSON), ou null. */
const settingsRow = (p, key) => p.evaluate((k) => {
  const row = window.__DB.hg_settings.find((r) => r.key === k);
  return row ? JSON.parse(JSON.stringify(row.value)) : null;
}, key);
/** Arguments des appels de la RPC fn dans le journal du faux client. */
const rpcCalls = (p, fn) => p.evaluate((f) => (window.__LOG || []).filter((x) => x[0] === 'rpc' && x[1] === f).map((x) => x[2]), fn);
/** Ajoute en tête de la base simulée le réglage « cards » avec la valeur value (point de départ du test). */
const seedCards = (p, value) => p.evaluate((v) => { window.__DB.hg_settings.unshift({ key: 'cards', value: v }); }, value);

(async () => {
  const browser = await chromium.launch();

  /* ---------- Cartes › Économie ---------- */
  let p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1440, height: 900 });
  await adminSection(p, 'cartes/economie');
  await p.waitForSelector('#acd-econ-form', { timeout: 8000 });
  check(await p.inputValue('#acd-e-drops_quantite_max') === '50', 'économie : exemplaires max d\'un drop affiche le défaut (50) sans configuration');
  check(await p.inputValue('#acd-e-drops_duree_max_min') === '1440', 'économie : durée max d\'un drop affiche le défaut (1440)');
  check(await p.inputValue('#acd-e-quetes_par_semaine') === '3', 'économie : quêtes tirées par semaine affiche le défaut (3)');
  check(await p.inputValue('#acd-e-craft_shiny_multiplier') === '6', 'économie : multiplicateur de fabrication brillante aligné sur la base (6)');
  check(await p.inputValue('#acd-e-max_open_trades') === '50', 'économie : offres en cours max alignées sur la base (50)');
  check(await p.inputValue('#acd-e-pity_epique') === '20', 'économie : garantie épique alignée sur la base (20)');
  check(await p.inputValue('#acd-e-rewards_daily') === '100', 'économie : passage du jour aligné sur la base (100)');

  await p.fill('#acd-e-drops_quantite_max', '10');
  await p.fill('#acd-e-quetes_par_semaine', '5');
  await p.fill('#acd-e-drops_duree_defaut_min', '2000');
  await p.click('#acd-econ-form [type="submit"]');
  await p.waitForTimeout(300);
  check(await p.textContent('#acd-econ-form .form-error') !== '' && await p.isVisible('#acd-econ-form .form-error'), 'économie : durée par défaut au-delà de la durée max (ou hors bornes) refusée');
  check(await settingsRow(p, 'cards') === null || (await settingsRow(p, 'cards')).drops === undefined, 'économie : rien n\'est enregistré quand la validation échoue');

  await p.fill('#acd-e-drops_duree_defaut_min', '45');
  await p.click('#acd-econ-form [type="submit"]');
  await p.waitForTimeout(400);
  const saved = await settingsRow(p, 'cards');
  check(saved && saved.drops && saved.drops.quantite_max === 10 && saved.drops.duree_max_min === 1440 && saved.drops.duree_defaut_min === 45, 'économie : cards.drops enregistré (10 / 1440 / 45)');
  check(saved && saved.quetes_par_semaine === 5, 'économie : cards.quetes_par_semaine enregistré (5)');
  check(saved && saved.rewards && saved.rewards.daily === 100 && saved.craft && saved.craft.shiny_multiplier === 6, 'économie : les autres réglages sont conservés à l\'enregistrement');

  // « Rétablir les valeurs par défaut » du groupe Cartes sauvages : remplit les champs avec les défauts
  await p.click('fieldset:has(legend:text-is("Cartes sauvages (drops)")) [data-act="econ-default"]');
  await p.waitForTimeout(200);
  check(await p.inputValue('#acd-e-drops_quantite_max') === '50' && await p.inputValue('#acd-e-drops_duree_defaut_min') === '30', 'économie : « Rétablir les valeurs par défaut » remplit le groupe avec les défauts');
  check(await p.inputValue('#acd-e-quetes_par_semaine') === '5', 'économie : le rétablissement d\'un groupe ne touche pas les autres groupes');
  await p.click('#acd-econ-form [type="submit"]');
  await p.waitForTimeout(400);
  const reset = await settingsRow(p, 'cards');
  check(reset && reset.drops.quantite_max === 50 && reset.drops.duree_defaut_min === 30, 'économie : après enregistrement, le défaut est bien en base');
  await p.close();

  /* ---------- Cartes › Drops : bornes lues dans cards.drops ---------- */
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900 });
  await seedCards(p, { drops: { quantite_max: 10, duree_max_min: 120, duree_defaut_min: 15 } });
  await adminSection(p, 'cartes/drops');
  await p.click('[data-action="drop-new"]');
  await p.waitForSelector('dialog.ui-drawer[open] #drop-qty', { timeout: 5000 });
  check(await p.getAttribute('#drop-qty', 'max') === '10', 'drops : exemplaires max lu dans cards.drops (10)');
  check(await p.getAttribute('#drop-min', 'max') === '120', 'drops : durée max lue dans cards.drops (120)');
  check(await p.inputValue('#drop-min') === '15', 'drops : durée proposée lue dans cards.drops (15)');
  await p.selectOption('#drop-card', { index: 0 });
  await p.fill('#drop-qty', '11');
  await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
  await p.waitForTimeout(300);
  check((await rpcCalls(p, 'hg_drop_create')).length === 0, 'drops : 11 exemplaires refusés par le formulaire (max = 10, pas d\'appel)');
  await p.fill('#drop-qty', '10');
  await p.fill('#drop-min', '60');
  await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
  await p.waitForTimeout(400);
  const calls = await rpcCalls(p, 'hg_drop_create');
  check(calls.length === 1 && calls[0].p_quantity === 10 && calls[0].p_minutes === 60, 'drops : un drop de 10 exemplaires pour 60 minutes est lancé');
  await waitClosed(p);
  await p.close();

  /* ---------- Vie › Badges : critères ---------- */
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb.mjs', width: 1280, height: 900 });
  await adminSection(p, 'vie/badges');
  await p.waitForSelector('#bc-form', { timeout: 8000 });
  check(await p.inputValue('#bc-criteres_toujours_la_sorties') === '5', 'badges : seuil « Toujours là » affiche le défaut (5)');
  check(await p.inputValue('#bc-criteres_paparazzi_photos') === '50', 'badges : seuil « Paparazzi » affiche le défaut (50)');
  check(await p.inputValue('#bc-criteres_bug_sujet') === 'Bug sur le site', 'badges : sujet du badge « Chasseur de bugs » affiche le défaut');
  check(await p.inputValue('#bc-max_carte') === '8', 'badges : badges affichés sur la carte affiche le défaut (8)');

  await p.fill('#bc-criteres_toujours_la_sorties', '0');
  await p.click('#bc-form [type="submit"]');
  await p.waitForTimeout(300);
  check(await p.isVisible('#bc-form .form-error') && (await p.textContent('#bc-form .form-error')).includes('entre 1 et 999'), 'badges : seuil hors bornes refusé avec un message');
  check(await settingsRow(p, 'badges') === null, 'badges : rien n\'est enregistré quand la validation échoue');

  await p.fill('#bc-criteres_toujours_la_sorties', '7');
  await p.fill('#bc-criteres_paparazzi_photos', '20');
  await p.fill('#bc-max_carte', '3');
  await p.click('#bc-form [type="submit"]');
  await p.waitForTimeout(400);
  let b = await settingsRow(p, 'badges');
  check(b && b.criteres.toujours_la_sorties === 7 && b.criteres.paparazzi_photos === 20, 'badges : critères enregistrés dans hg_settings.badges.criteres');
  check(b && b.max_carte === 3 && b.criteres.fidele_annees === 3 && b.criteres.bug_sujet === 'Bug sur le site', 'badges : affichage enregistré, autres critères à leur défaut');

  await p.click('[data-bc-default="0"]');
  await p.waitForTimeout(200);
  check(await p.inputValue('#bc-criteres_toujours_la_sorties') === '5' && await p.inputValue('#bc-criteres_paparazzi_photos') === '50', 'badges : « Rétablir les valeurs par défaut » du groupe critères');
  check(await p.inputValue('#bc-max_carte') === '3', 'badges : le rétablissement des critères ne touche pas l\'affichage');
  await p.click('#bc-form [type="submit"]');
  await p.waitForTimeout(400);
  b = await settingsRow(p, 'badges');
  check(b && b.criteres.toujours_la_sorties === 5 && b.criteres.paparazzi_photos === 50, 'badges : défauts enregistrés en base après rétablissement');
  await p.close();

  /* ---------- Réglages du site : la clé badges est listée et renvoie vers sa section ---------- */
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb.mjs', width: 1280, height: 900 });
  await p.evaluate(() => { window.__DB.hg_settings.unshift({ key: 'badges', value: { max_carte: 4 } }); });
  await adminSection(p, 'site/reglages');
  await p.waitForSelector('[data-key-item="badges"]', { timeout: 8000 });
  const row = await p.textContent('[data-key-item="badges"]');
  check(row.includes('Badges : critères et affichage') && row.includes('Géré dans'), 'réglages du site : la clé badges est listée avec son libellé et renvoie vers sa section');
  await p.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
