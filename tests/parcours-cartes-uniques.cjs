// Parcours : cartes uniques (rareté « unique », hors série, un seul exemplaire).
// Collection (cartes.html) : la série « Hors série » a son en-tête explicatif ; la carte unique s'affiche avec son style
// « unique » et « Exemplaire unique », sa mention « Pas encore / Déjà attribuée », pas de bouton recycler ni fabriquer,
// et la rareté n'apparaît pas dans les chances des boosters.
// Admin (admin.html) : la série « Hors série » est listée ; choisir « Unique » pré-sélectionne la série, verrouille
// l'exemplaire maximum à 1 et décoche la fabrication ; l'enregistrement garde ces valeurs. Don et Drop : une carte unique
// déjà attribuée est désactivée dans la liste.
// Faux Supabase : fixtures/fake-sb-cartes.mjs, scénarios uniques (série + carte C14), uniqueTaken (Alice l'a), uniqueOwned (moi).
// Lancer : node tests/parcours-cartes-uniques.cjs   (HG_ROOT / HG_PREFIX comme les autres parcours)
const { check, finish, openPage, adminSection, hscroll, sleep, chromium } = require('./lib/harness.cjs');

const FIXTURE = 'fake-sb-cartes.mjs';
const ALICE = '00000002-0000-4000-8000-000000000002';
const HS = { uniques: true }; // scénario : la série Hors série et la carte unique C14 existent
/** Clique sur le bouton de validation du tiroir ouvert. */
const submitDrawer = (p) => p.click('dialog.ui-drawer[open] [data-drawer-submit]');
/** Attend que le tiroir soit fermé. */
const waitClosed = (p) => p.waitForSelector('dialog.ui-drawer', { state: 'detached', timeout: 5000 }).catch(() => {});

(async () => {
  console.log('Racine testée : ' + require('./lib/harness.cjs').ROOT);
  const browser = await chromium.launch();

  // 1. Collection : Hors série, carte unique non possédée, personne ne l'a encore.
  let p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, scenario: HS });
  await p.click('[data-tab=collection]');
  await p.waitForSelector('#cartes-set', { timeout: 5000 });
  const series = await p.$$eval('#cartes-set option', (o) => o.map((x) => [x.value, x.textContent]));
  check(series.some(([v, t]) => v === 'SETHS' && t === 'Hors série'), 'sélecteur de série : « Hors série » est listée');
  await p.selectOption('#cartes-set', 'SETHS');
  await p.waitForSelector('.hgc-unique', { timeout: 5000 }).catch(() => {});
  const note = await p.textContent('.cartes-hs-note').catch(() => '');
  check(/Cartes uniques : un seul exemplaire existe, à gagner lors d'un événement ou offert par l'admin\./.test(note), 'Hors série : en-tête explicatif affiché (« ' + note.trim() + ' »)');
  check(await p.$$eval('.hgc-unique', (x) => x.length) === 1, 'la carte unique s\'affiche avec le style « unique »');
  const fam = await p.textContent('.hgc-unique .hgc-fam');
  check(fam.includes('Exemplaire unique'), 'ligne sous l\'image : « Exemplaire unique » (' + fam + ')');
  const label = await p.getAttribute('.hgc-unique', 'aria-label');
  check(/Unique/.test(label) && /pas encore obtenue/.test(label), 'libellé d\'accessibilité : rareté Unique, pas encore obtenue (' + label + ')');
  check((await p.textContent('.cartes-uniq-state')).trim() === 'Pas encore attribuée', 'vignette : « Pas encore attribuée » (personne ne l\'a)');
  const rareOpts = await p.$$eval('#cartes-f-rarity option', (o) => o.map((x) => x.value));
  check(rareOpts.includes('unique'), 'filtre Rareté : l\'option « Unique » existe');
  await p.selectOption('#cartes-f-rarity', 'unique');
  await sleep(150);
  check(await p.$$eval('.cz-cell', (x) => x.length) === 1, 'filtre Rareté « Unique » : seule la carte unique reste');
  await p.selectOption('#cartes-f-rarity', '');
  await sleep(150);
  check(!p.errs.length, 'collection : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));

  // Fiche détail : ni fabriquer, ni recycler ; message clair.
  await p.click('.cz-cell [data-action="open-card"][data-card="C14"]');
  await p.waitForSelector('#cartes-detail[open]', { timeout: 5000 });
  check(await p.$$eval('#cartes-detail [data-action="craft"]', (x) => x.length) === 0, 'fiche : aucun bouton « Fabriquer »');
  check(await p.$$eval('#cartes-detail [data-action="recycle"]', (x) => x.length) === 0, 'fiche : aucun bouton « Recycler »');
  const fiche = await p.textContent('#cartes-detail-info');
  check(/Une carte unique ne se fabrique pas/.test(fiche), 'fiche : message « Une carte unique ne se fabrique pas »');
  check(/Pas encore attribuée/.test(fiche), 'fiche : « Pas encore attribuée » affiché');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  // Chances des boosters : la rareté unique n'y figure pas.
  await p.click('[data-tab=boosters]');
  await p.waitForSelector('.cartes-odds', { timeout: 5000 });
  const chances = await p.$$eval('.cartes-odds tbody th', (x) => x.map((e) => e.textContent.trim()));
  check(!chances.some((t) => /unique/i.test(t)) && chances.includes('Mythique'), 'chances des boosters : pas de ligne « Unique » (' + chances.join(', ') + ')');
  await p.ctx.close();

  // 2. Carte unique que je possède : pas de bouton recycler, mention « Ne se recycle pas ».
  p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, scenario: { uniques: true, uniqueOwned: true } });
  await p.click('[data-tab=collection]');
  await p.selectOption('#cartes-set', 'SETHS');
  await p.waitForSelector('.hgc-unique', { timeout: 5000 }).catch(() => {});
  check(await p.$$eval('.hgc-unique', (x) => x.length) === 1 && await p.$$eval('.cartes-uniq-state', (x) => x.length) === 0, 'carte possédée : pas de mention d\'attribution');
  check(await p.$$eval('.hgc-unique .hgc-pied-s', (x) => x[0]?.textContent.trim()) === '1/1', 'carte possédée : numéro d\'exemplaire « 1/1 »');
  await p.click('.cz-cell [data-action="open-card"][data-card="C14"]');
  await p.waitForSelector('#cartes-detail[open]', { timeout: 5000 });
  const copie = await p.textContent('#cartes-detail .cartes-copies');
  check(/Ne se recycle pas/.test(copie) && await p.$$eval('#cartes-detail [data-action="recycle"]', (x) => x.length) === 0, 'mon exemplaire : « Ne se recycle pas », aucun bouton recycler');
  check(await p.$$eval('#cartes-detail [data-action="craft"]', (x) => x.length) === 0, 'mon exemplaire : aucun bouton fabriquer');
  await p.keyboard.press('Escape');
  await p.ctx.close();

  // 3. Un autre membre a déjà l'exemplaire : « Déjà attribuée », et la mise en page tient à 390 px sans défilement.
  p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 390, height: 844, scenario: { uniques: true, uniqueTaken: true } });
  await p.click('[data-tab=collection]');
  await p.selectOption('#cartes-set', 'SETHS');
  await p.waitForSelector('.cartes-uniq-state', { timeout: 5000 }).catch(() => {});
  check((await p.textContent('.cartes-uniq-state').catch(() => '')).trim() === 'Déjà attribuée', 'vignette : « Déjà attribuée » (Alice l\'a)');
  check(await hscroll(p) === 0, 'mobile 390 px : aucun défilement horizontal');
  check(!p.errs.length, 'mobile : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 4. Animation : le reflet doré ne bouge pas si la préférence « réduire les animations » est active.
  p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, reducedMotion: 'reduce', scenario: HS });
  await p.click('[data-tab=collection]');
  await p.selectOption('#cartes-set', 'SETHS');
  await p.waitForSelector('.hgc-sheen', { timeout: 5000 }).catch(() => {});
  const anim = await p.evaluate(() => getComputedStyle(document.querySelector('.hgc-sheen') || document.body).animationName);
  check(anim === 'none', 'réduire les animations : le reflet unique est fixe (animation « ' + anim + ' »)');
  await p.ctx.close();

  // 5. Admin : Hors série listée ; choisir « Unique » verrouille la carte ; l'enregistrement garde ces valeurs.
  p = await openPage(browser, { page: 'admin', fixture: FIXTURE, width: 1280, height: 900, scenario: HS });
  await adminSection(p, 'cartes/series');
  const seriesAdmin = await p.textContent('.acd-setgrid').catch(() => '');
  check(seriesAdmin.includes('Hors série'), 'admin › Séries : « Hors série » est listée');
  await adminSection(p, 'cartes/cartes');
  await p.waitForSelector('[data-act="card-new"]', { timeout: 5000 });
  await p.click('[data-act="card-new"]');
  await p.waitForSelector('dialog.ui-drawer[open] #acc-rarity', { timeout: 5000 });
  check(await p.isHidden('#acc-unique-help'), 'éditeur : aide « Unique » masquée tant que la rareté n\'est pas choisie');
  await p.selectOption('#acc-rarity', 'unique');
  check(await p.inputValue('#acc-family') === 'unique', 'éditeur : rareté unique → famille « Unique » proposée');
  await sleep(150);
  check(await p.inputValue('#acc-set') === 'SETHS', 'éditeur : choisir « Unique » pré-sélectionne « Hors série »');
  check(await p.inputValue('#acc-max') === '1' && await p.getAttribute('#acc-max', 'readonly') !== null, 'éditeur : exemplaires maximum verrouillé à 1');
  check(await p.isDisabled('dialog.ui-drawer[open] input[name="craftable"]') && !(await p.isChecked('dialog.ui-drawer[open] input[name="craftable"]')), 'éditeur : « Fabricable » décoché et désactivé');
  check(await p.isVisible('#acc-unique-help'), 'éditeur : aide « Unique » affichée');
  await p.selectOption('#acc-family', 'lieu'); // une carte « Membre » exige un membre lié : on choisit une autre famille
  await p.fill('#acc-name', 'Carte unique de test');
  await submitDrawer(p);
  await waitClosed(p);
  const creee = await p.evaluate(() => window.__DB.hg_cards.find((k) => k.name === 'Carte unique de test'));
  check(!!creee && creee.rarity === 'unique' && creee.max_copies === 1 && creee.craftable === false && creee.set_id === 'SETHS',
    'enregistrement : rareté unique, 1 exemplaire, non fabricable, série Hors série');
  check(!p.errs.length, 'admin cartes : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 6. Don et Drop : une carte unique déjà attribuée ne peut pas être redonnée ni lancée.
  p = await openPage(browser, { page: 'admin', fixture: FIXTURE, width: 1280, height: 900, scenario: { uniques: true, uniqueTaken: true } });
  await adminSection(p, 'cartes/joueurs');
  await p.evaluate((id) => { location.hash = 'cartes/joueurs/' + id; }, ALICE);
  await p.waitForSelector('[data-act="give-open"]', { timeout: 8000 });
  await p.click('[data-act="give-open"]');
  await p.waitForSelector('dialog.ui-drawer[open] #acd-give-card', { timeout: 5000 });
  const donOpt = await p.$eval('#acd-give-card option[value="C14"]', (o) => ({ dis: o.disabled, txt: o.textContent })).catch(() => null);
  check(donOpt && donOpt.dis && /déjà attribuée/.test(donOpt.txt), 'Don : la carte unique déjà attribuée est désactivée (« ' + (donOpt && donOpt.txt) + ' »)');
  await p.keyboard.press('Escape');
  await waitClosed(p);
  await adminSection(p, 'cartes/drops');
  await p.waitForSelector('[data-action="drop-new"]', { timeout: 8000 });
  await p.click('[data-action="drop-new"]');
  await p.waitForSelector('dialog.ui-drawer[open] #drop-card', { timeout: 5000 });
  const dropOpt = await p.$eval('#drop-card option[value="C14"]', (o) => ({ dis: o.disabled, txt: o.textContent })).catch(() => null);
  check(dropOpt && dropOpt.dis && /déjà attribuée/.test(dropOpt.txt), 'Drop : la carte unique déjà attribuée est désactivée (« ' + (dropOpt && dropOpt.txt) + ' »)');
  await p.keyboard.press('Escape');
  await p.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
