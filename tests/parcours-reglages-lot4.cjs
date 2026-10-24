// Parcours : réglages du lot 4 (badges automatiques, jeu de cartes, drops, quêtes) dans le panel admin.
// Couvre : Cartes › Économie (valeurs affichées = défauts, enregistrement de cards.drops et cards.quetes_par_semaine,
// validation durée par défaut > durée max, « Rétablir les valeurs par défaut » d'un groupe ; parties Paillettes et dons,
// Tirage, Recyclage et fabrication, Limites : un seul formulaire, saisies gardées d'une partie à l'autre, erreur d'une
// partie masquée nommée avec son lien) ;
// Cartes › Drops (bornes lues dans cards.drops : attribut max, durée proposée, refus hors bornes) ;
// Vie › Badges (formulaire des critères : enregistrement dans hg_settings.badges, validation, défauts) ;
// Réglages du site (la clé badges est listée et renvoie vers Vie › Badges).
// Les contrôles portent sur l'état du faux Supabase (window.__DB) et sur les appels reçus (window.__LOG).
// Le faux Supabase ne rejoue pas les fonctions SQL : les replis et bornes SQL sont vérifiés par la migration 053 (revue).
// Lancer : node tests/parcours-reglages-lot4.cjs
const { check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('./lib/harness.cjs');

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
  await adminSection(p, 'fabrique/limites');
  await p.waitForSelector('#acd-econ-form', { timeout: 8000 });
  /* Légendes des groupes visibles de l'Économie. */
  // Une fieldset dans un bloc <details> fermé (plafonds de Paillettes) n'est pas affichée, même si elle garde sa boîte.
  const shownLegends = () => p.$$eval('#acd-econ-form fieldset', (fs) => fs.filter((f) => f.getClientRects().length && !(f.closest('details') && !f.closest('details').open)).map((f) => f.querySelector('legend').textContent.trim()).join(' | '));
  check(await shownLegends() === 'Quêtes de la semaine | Cartes sauvages (drops) | Générations des membres | Échanges', `parties : « Limites » ne montre que ses groupes (${await shownLegends()})`);
  check((await p.textContent('#acd-econ-part')).trim() === 'Limites' && !(await p.isVisible('.acd-bulk-intro')), 'parties : titre « Limites », bloc Dons masqué');
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

  // Erreur dans une partie masquée : depuis « Tirage », la durée invalide (partie Limites) est signalée avec son lien
  await adminSection(p, 'fabrique/tirage');
  await p.waitForTimeout(200);
  check(await shownLegends() === 'Boosters | Taux de tirage | Brillantes et garantie', `parties : « Tirage » ne montre que ses groupes (${await shownLegends()})`);
  check(await p.inputValue('#acd-e-drops_duree_defaut_min') === '2000' && await p.inputValue('#acd-e-quetes_par_semaine') === '5', 'parties : les saisies de « Limites » sont gardées en passant à « Tirage »');
  await p.fill('#acd-e-pity_epique', '25');
  await p.click('#acd-econ-form [type="submit"]');
  await p.waitForTimeout(300);
  check(/À corriger dans « Limites »/.test(await p.textContent('#acd-econ-form .form-error')) && await p.locator('#acd-econ-form .form-error a[href="#fabrique/limites"]').count() === 1,
    'parties : erreur d\'une partie masquée nommée, avec le lien vers « Limites »');
  await p.click('#acd-econ-form .form-error a[href="#fabrique/limites"]');
  await p.waitForFunction(() => location.hash === '#fabrique/limites');
  await p.waitForTimeout(300);
  check(await p.isVisible('#acd-e-drops_duree_defaut_min') && await p.inputValue('#acd-e-pity_epique') === '25', 'parties : le lien ouvre « Limites », la saisie de « Tirage » est gardée');
  await p.fill('#acd-e-drops_duree_defaut_min', '45');
  await p.click('#acd-econ-form [type="submit"]');
  await p.waitForTimeout(400);
  const saved = await settingsRow(p, 'cards');
  check(saved && saved.pity_epique === 25, 'parties : la valeur saisie dans « Tirage » est enregistrée avec celles de « Limites »');
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
  // Enregistrer depuis « Tirage » conserve drops, récompenses et quêtes
  await adminSection(p, 'fabrique/tirage');
  await p.waitForTimeout(200);
  await p.fill('#acd-e-pity_epique', '30');
  await p.click('#acd-econ-form [type="submit"]');
  await p.waitForTimeout(400);
  const fromTirage = await settingsRow(p, 'cards');
  check(fromTirage && fromTirage.pity_epique === 30 && fromTirage.drops.quantite_max === 50 && fromTirage.rewards.daily === 100 && fromTirage.quetes_par_semaine === 5,
    'parties : enregistrer depuis « Tirage » conserve drops, récompenses et quêtes');
  await adminSection(p, 'fabrique/economie');
  await p.waitForTimeout(200);
  check(await shownLegends() === 'Départ | Récompenses' && await p.isVisible('[data-act="bulk-open"]'), `parties : « Paillettes et dons » : Dons, Départ, Récompenses (${await shownLegends()})`);
  await adminSection(p, 'fabrique/recyclage');
  await p.waitForTimeout(200);
  check(await shownLegends() === 'Recyclage | Fabrication | Alertes économie', `parties : « Recyclage et fabrication » (${await shownLegends()})`);
  await p.close();

  /* ---------- Cartes › Drops : bornes lues dans cards.drops ---------- */
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900 });
  await seedCards(p, { drops: { quantite_max: 10, duree_max_min: 120, duree_defaut_min: 15 } });
  await adminSection(p, 'fabrique/drops');
  await p.click('[data-action="drop-new"]');
  await p.waitForSelector('dialog.ui-drawer[open] #drop-qty', { timeout: 5000 });
  check(await p.getAttribute('#drop-qty', 'max') === '10', 'drops : exemplaires max lu dans cards.drops (10)');
  check(await p.getAttribute('#drop-min', 'max') === '120', 'drops : durée max lue dans cards.drops (120)');
  check(await p.inputValue('#drop-min') === '15', 'drops : durée proposée lue dans cards.drops (15)');
  await p.click('dialog.ui-drawer[open] [data-vp-card]:not([disabled]) >> nth=0');
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

  /* ---------- Cartes › Drops : plafond paramétrable (migration 055, borne technique 1 à 1000) ---------- */
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900 });
  await seedCards(p, { drops: { quantite_max: 120, duree_max_min: 1440, duree_defaut_min: 30 } });
  await adminSection(p, 'fabrique/drops');
  await p.click('[data-action="drop-new"]');
  await p.waitForSelector('dialog.ui-drawer[open] #drop-qty', { timeout: 5000 });
  check(await p.getAttribute('#drop-qty', 'max') === '120', 'drops plafond : avec quantite_max à 120, le champ accepte 120');
  await p.click('dialog.ui-drawer[open] [data-vp-card]:not([disabled]) >> nth=0');
  await p.fill('#drop-qty', '120');
  await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
  await p.waitForTimeout(400);
  const big = await rpcCalls(p, 'hg_drop_create');
  check(big.length === 1 && big[0].p_quantity === 120, 'drops plafond : un drop de 120 exemplaires est lancé avec quantite_max à 120');
  await waitClosed(p);
  await p.close();

  /* ---------- Vie › Badges : critères ---------- */
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb.mjs', width: 1280, height: 900 });
  await adminSection(p, 'place/badges-criteres');
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
  // Parties de la section Badges
  check(!(await p.isVisible('#badge-grid')) && !(await p.isVisible('#badge-member')) && await p.locator('#zone-actions #badge-new').count() === 0,
    'parties : « Critères automatiques » seul (grille, attribution et « + Nouveau badge » masqués)');
  await adminSection(p, 'place/badges-attribution');
  await p.waitForTimeout(200);
  check(await p.isVisible('#badge-member') && !(await p.isVisible('#bc-form')) && !(await p.isVisible('#badge-grid')), 'parties : « Attribution » seule');
  await adminSection(p, 'place/badges');
  await p.waitForTimeout(200);
  check(await p.isVisible('#badge-grid') && await p.isVisible('#badge-search') && !(await p.isVisible('#bc-form')) && !(await p.isVisible('#badge-member'))
    && await p.locator('#zone-actions #badge-new').count() === 1, 'parties : « Catalogue » : recherche, grille et « + Nouveau badge »');
  check(!(await p.isVisible('#bc-ro')), 'badges : pas de note « lecture seule » pour l\'administrateur');
  await p.close();

  /* ---------- Vie › Badges : Staff sans le droit Réglages du site (la base refuserait la clé « badges ») ---------- */
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb.mjs', width: 1280, height: 900, scenario: { uid: '00000002-0000-4000-8000-000000000002', staff: ['badges'] } });
  await adminSection(p, 'place/badges-criteres');
  await p.waitForSelector('#bc-form', { timeout: 8000 });
  check(await p.isVisible('#bc-ro') && /réservé au droit Réglages/.test(await p.textContent('#bc-ro')), 'badges (Staff sans Réglages) : note « lecture seule » affichée');
  check(await p.isDisabled('#bc-criteres_paparazzi_photos') && await p.locator('#bc-form [type="submit"]').count() === 0 && await p.locator('[data-bc-default]').count() === 0,
    'badges (Staff sans Réglages) : champs désactivés, ni Enregistrer ni Rétablir');
  await p.close();

  /* ---------- Réglages du site : la clé badges est listée et renvoie vers sa section ---------- */
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb.mjs', width: 1280, height: 900 });
  await p.evaluate(() => { window.__DB.hg_settings.unshift({ key: 'badges', value: { max_carte: 4 } }); });
  await adminSection(p, 'mairie/reglages');
  await p.waitForSelector('[data-key-item="badges"]', { timeout: 8000 });
  const row = await p.textContent('[data-key-item="badges"]');
  check(row.includes('Badges : critères et affichage') && row.includes('Géré dans'), 'réglages du site : la clé badges est listée avec son libellé et renvoie vers sa section');
  await p.close();

  /* ---------- Réglages du site : les clés qui ont leur écran (competences, echanges, saisons…) ne sont plus listées ---------- */
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb.mjs', width: 1280, height: 900 });
  await p.evaluate(() => {
    window.__DB.hg_settings.unshift({ key: 'competences', value: [] }, { key: 'echanges', value: { anciennete_jours: 7 } },
      { key: 'saisons', value: { avent: {} } }, { key: 'parrainage', value: { paillettes: 50 } }, { key: 'cine', value: { actif: true } });
  });
  await adminSection(p, 'mairie/reglages');
  await p.waitForSelector('[data-key-item="cine"]', { timeout: 8000 }).catch(() => {});
  check(await p.locator('[data-key-item="competences"], [data-key-item="echanges"], [data-key-item="saisons"], [data-key-item="parrainage"]').count() === 0,
    'réglages du site : competences, echanges, saisons et parrainage ne sont pas listées (elles ont leur écran)');
  check(await p.locator('[data-key-item="cine"]').count() === 1, 'réglages du site : les autres clés restent listées (cine)');
  const dedie = p.locator('.acd-note').filter({ hasText: 'Réglées dans leur écran' });
  check(await dedie.count() === 1 && (await dedie.textContent()).includes('se règle dans'), 'réglages du site : une note « Réglées dans leur écran » renvoie « se règle dans »');
  check(await p.getAttribute('.acd-note a[href="#place/competences"]', 'href') === '#place/competences'
    && (await dedie.textContent()).includes('Membres › Compétences') && (await dedie.textContent()).includes('Salle des ventes'),
  'réglages du site : la note renvoie vers Membres › Compétences et La Salle des ventes › Échanges');
  await p.close();

  /* ---------- Cartes : citation, quêtes à preuve, libellés des jeux (Séries) et limites des échanges, enregistrés par fusion ---------- */
  const SEED = { cards: { quetes_par_semaine: 4, tag_labels: { minecraft: 'Minecraft perso' }, plafonds: { quiz_jour: '7' } },
    echanges: { anciennete_jours: 7, paillettes_max_semaine: 4000, dons_valeur_max_semaine: 5000, note_admin: 'à garder' } };
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900, scenario: { settingsExtra: SEED } });
  await adminSection(p, 'fabrique/economie');
  await p.waitForSelector('#acd-e-rewards_citation', { timeout: 8000 }).catch(() => {});
  check(await p.inputValue('#acd-e-rewards_citation') === '20', 'économie : citation validée affichée au défaut (20), dans Récompenses');
  await p.fill('#acd-e-rewards_citation', '35');
  await p.click('#acd-econ-form [type="submit"]');
  await sleep(400);
  let cc = await settingsRow(p, 'cards');
  check(cc?.rewards?.citation === 35 && cc?.rewards?.daily === 100, 'économie : citation enregistrée (35), autres récompenses gardées');
  check(JSON.stringify(cc?.tag_labels) === JSON.stringify({ minecraft: 'Minecraft perso' }) && Number(cc?.plafonds?.quiz_jour) === 7, 'économie : libellés des jeux et plafonds gardés à l’enregistrement' + (Number(cc?.plafonds?.quiz_jour) === 7 ? '' : ' ' + JSON.stringify(cc?.plafonds)));
  await p.fill('#acd-e-rewards_citation', '501');
  await p.click('#acd-econ-form [type="submit"]');
  await sleep(300);
  check(await p.isVisible('#acd-econ-form .form-error') && (await p.textContent('#acd-econ-form .form-error')).includes('Citation'), 'économie : citation au-delà de 500 refusée');

  // Quêtes : nombre de quêtes à preuve (cards.quetes_preuve_par_semaine), texte d'aide de l'action « preuve validée ».
  await adminSection(p, 'fabrique/quetes');
  await p.waitForSelector('#acd-proof-form', { timeout: 8000 }).catch(() => {});
  check(await p.inputValue('#acd-proof-n') === '2', 'quêtes : quêtes à preuve affichées au défaut (2)');
  await p.fill('#acd-proof-n', '3');
  await p.click('#acd-proof-form [type="submit"]');
  await sleep(400);
  cc = await settingsRow(p, 'cards');
  check(cc?.quetes_preuve_par_semaine === 3 && cc?.quetes_par_semaine === 4 && Number(cc?.plafonds?.quiz_jour) === 7,
    'quêtes : quêtes à preuve enregistrées (3), réglages voisins gardés');
  await p.click('[data-act="quest-new"]');
  await p.waitForSelector('#aq-metric', { timeout: 8000 }).catch(() => {});
  await p.selectOption('#aq-metric', 'preuve_validee');
  const help = await p.textContent('#aq-metric-h');
  check(help.includes('3 par semaine') && !help.includes('2 par semaine') && !help.includes('{{preuve}}'), 'quêtes : l’aide « preuve validée » suit le réglage (3 par semaine)');
  await p.keyboard.press('Escape');
  await sleep(200);

  // Séries : libellés des jeux (cards.tag_labels).
  await adminSection(p, 'fabrique/series');
  await p.waitForSelector('#acd-tags-form', { timeout: 8000 }).catch(() => {});
  check(await p.inputValue('#acd-tag-minecraft') === 'Minecraft perso', 'séries : libellé enregistré du tag minecraft affiché');
  await p.fill('#acd-tag-new', 'Bad Tag!');
  await p.fill('#acd-tag-newl', 'Test');
  await p.click('#acd-tags-form [type="submit"]');
  await sleep(300);
  check(await p.isVisible('#acd-tags-form .form-error') && (await p.textContent('#acd-tags-form .form-error')).includes('minuscules'), 'séries : tag invalide refusé');
  await p.fill('#acd-tag-new', 'lol');
  await p.fill('#acd-tag-newl', 'League of Legends');
  await p.click('#acd-tags-form [type="submit"]');
  await sleep(400);
  cc = await settingsRow(p, 'cards');
  check(JSON.stringify(cc?.tag_labels) === JSON.stringify({ minecraft: 'Minecraft perso', lol: 'League of Legends' }) && cc?.quetes_preuve_par_semaine === 3,
    'séries : libellé du tag lol ajouté, libellés existants et réglages des quêtes gardés');

  // Salle des ventes › Échanges : limites anti-abus (echanges), fusion.
  await adminSection(p, 'ventes/echanges');
  await p.waitForSelector('#acd-echanges-form', { timeout: 8000 }).catch(() => {});
  check(await p.inputValue('#ace-paillettes_max_semaine') === '4000' && await p.inputValue('#ace-anciennete_jours') === '7', 'échanges : limites affichées depuis le réglage echanges');
  await p.fill('#ace-anciennete_jours', '400');
  await p.click('#acd-echanges-form [type="submit"]');
  await sleep(300);
  check(await p.isVisible('#acd-echanges-form .form-error'), 'échanges : âge du compte au-delà de 365 jours refusé');
  await p.fill('#ace-anciennete_jours', '10');
  await p.fill('#ace-dons_valeur_max_semaine', '6000');
  await p.click('#acd-echanges-form [type="submit"]');
  await sleep(400);
  const ech = await settingsRow(p, 'echanges');
  check(ech?.anciennete_jours === 10 && ech?.dons_valeur_max_semaine === 6000 && ech?.paillettes_max_semaine === 4000 && ech?.note_admin === 'à garder',
    'échanges : limites enregistrées, autres sous-clés du réglage gardées');
  await p.close();

  /* Cartes : pas de défilement horizontal à 390 px (libellés des jeux, limites des échanges). */
  for (const route of ['fabrique/series', 'ventes/echanges', 'fabrique/quetes']) {
    p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 390, height: 780, mobile: true, scenario: { settingsExtra: SEED } });
    await adminSection(p, route);
    await sleep(400);
    check(await hscroll(p) <= 0, `${route} 390 px : pas de défilement horizontal (${await hscroll(p)} px)`);
    await p.close();
  }

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
