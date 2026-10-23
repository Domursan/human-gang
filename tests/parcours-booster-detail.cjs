// Parcours : voir le détail des cartes d'un booster (cartes.html).
// Une carte révélée s'ouvre dans la carte agrandie de la collection (cartes-zoom.js) : nom, rareté, texte, exemplaires.
// Premier clic sur une carte encore face cachée : elle se retourne ; clic suivant : elle s'agrandit.
// 1. Booster unique animé : indice caché au départ, retournement à la main, carte agrandie, flèches, Échap, focus rendu, clavier (Entrée, Espace).
// 2. Lot de 5 boosters animé : retournement à la main d'une carte en attente, puis détail après la révélation.
// 3. Booster gratuit et booster offert sans animation : grille de boutons, clic et Entrée.
// 4. Téléphone 390 px tactile : toucher une carte ouvre le détail, appui long = loupe ×2,5, sans défilement horizontal.
// Les boosters s'ouvrent depuis le stock : on achète dans la Boutique, puis on ouvre dans l'onglet Ouverture.
// Faux Supabase : fixtures/fake-sb-cartes.mjs en mode typé (scenario.types) : achat hg_booster_buy, ouverture du stock par hg_booster_open.
// Lancer : node tests/parcours-booster-detail.cjs
const { ROOT, check, finish, openPage, log, sleep, hscroll, chromium } = require('./lib/harness.cjs');

/** Ouvre un onglet de Cartes par son adresse (cartes.html#id) : la barre d'onglets est masquée depuis le nouvel en-tête. */
async function goTab(p, id) {
  await p.evaluate((h) => { location.hash = ''; location.hash = h; }, id);
  await p.waitForFunction((i) => document.getElementById('cartes-p-' + i) && !document.getElementById('cartes-p-' + i).hidden, id, { timeout: 8000 });
}

/* ---------- Aides de test ---------- */
/** Bouton « Ouvrir 1 » du stock (classique) dans l'onglet Ouverture. */
const OUVRIR1 = '#cartes-p-ouverture [data-stock-type=classique] [data-action=open-gift]';
/** Bouton « Ouvrir 5 » du stock (classique) dans l'onglet Ouverture. */
const BTN_X5 = '[data-action=open-stock-multi][data-type=classique][data-count="5"]';
/** Bouton d'achat de la Boutique (classique) : achète la quantité choisie dans #shop-qty. */
const ACHAT = '#cartes-paid [data-action=buy-stock]';
const OPEN_CARD = '#cz-dialog[open]';
const HINT = '#cartes-reveal .cartes-reveal-hint';
/** Ouvre l'onglet Boutique (où sont les boutons d'achat). */
async function aBoutique(p) { await goTab(p, 'boutique'); await sleep(300); }
/** Ouvre l'onglet Ouverture (où sont les boutons d'ouverture). */
async function aOuverture(p) { await goTab(p, 'ouverture'); await sleep(300); }
/** Achète n boosters classiques dans la Boutique (ils vont dans le stock) et attend le stock. */
async function acheter(p, n) {
  await aBoutique(p);
  await p.selectOption('#shop-qty', String(n));
  const avant = await p.evaluate(() => window.__DB.hg_booster_stock.find((r) => r.type_id === 'classique')?.qty ?? 0);
  await p.click(ACHAT);
  await p.waitForFunction((a) => (window.__DB.hg_booster_stock.find((r) => r.type_id === 'classique')?.qty ?? 0) === a, avant + n, { timeout: 8000 });
  await sleep(200);
}

/** Vrai si la fenêtre de carte agrandie est ouverte. */
const ouverte = async (p) => !!(await p.$(OPEN_CARD));
/** Nom affiché dans la fenêtre de carte agrandie. */
const titreOuvert = (p) => p.textContent('#cz-title');
/** Nom de la carte sel (plaque du dessin de carte). */
const nomDe = (p, sel) => p.locator(`${sel} .hgc-plate-t`).first().textContent();
/** Attend la fin de l'ouverture (révélation complète) : « Tout révéler » si la séquence tourne encore. */
async function revelerTout(p) {
  await p.waitForSelector('#cartes-reveal [data-action=reveal-all], #cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
  if (await p.$('#cartes-reveal [data-action=reveal-all]')) await p.click('#cartes-reveal [data-action=reveal-all]');
  await p.waitForSelector('#cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
}
/** Centre (x, y) de l'élément sel dans la fenêtre. */
const centre = (p, sel) => p.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2];
}, sel);

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  // 1. Booster unique animé.
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, scenario: { types: true, bal: 600 } });
  await acheter(p, 1);
  await aOuverture(p);
  await p.click(OUVRIR1);
  await p.waitForSelector('#op-stage .op-card', { timeout: 8000 });
  check(await p.$$eval('#op-stage .op-card', (els) => els.length) === 5, 'booster animé : 5 cartes en éventail');
  check(await p.$$eval('#op-stage .op-card', (els) => els.every((e) => e.getAttribute('role') === 'button' && e.tabIndex === 0)), 'cartes : rôle bouton et atteignables au clavier');
  check(await p.$(`${HINT}[hidden]`) !== null, 'indice caché tant qu\'aucune carte n\'est retournée');
  // Premier clic sur une carte encore face cachée : elle se retourne, la fenêtre ne s'ouvre pas.
  await p.click('#op-stage .op-card[data-i="4"]');
  check(await p.$eval('#op-stage .op-card[data-i="4"]', (e) => e.classList.contains('is-flip')), 'premier clic : la carte face cachée se retourne');
  check(!(await ouverte(p)), 'premier clic : la carte agrandie ne s\'ouvre pas');
  check(await p.isVisible(HINT), 'indice « Touche une carte pour la voir en grand » visible après un retournement');
  check((await p.textContent(HINT)).trim() === 'Touche une carte pour la voir en grand', 'texte de l\'indice exact');
  await revelerTout(p);
  // Clic suivant : la carte retournée s'ouvre en grand avec son nom.
  const nom4 = await nomDe(p, '#op-stage .op-card[data-i="4"] .op-front');
  await p.click('#op-stage .op-card[data-i="4"]');
  await p.waitForSelector(OPEN_CARD, { timeout: 3000 }).catch(() => {});
  check(await ouverte(p), 'clic sur une carte révélée : la carte agrandie s\'ouvre');
  check((await titreOuvert(p)) === nom4, `carte agrandie : nom « ${nom4} » (${await titreOuvert(p)})`);
  check(await p.isVisible('#cz-dialog .cz-rar') && (await p.textContent('#cz-dialog .cz-rar')).trim() !== '', 'carte agrandie : rareté affichée');
  check(await p.$('#cz-dialog .cz-copies, #cz-dialog .cz-empty') !== null, 'carte agrandie : exemplaires (ou « Pas encore obtenue »)');
  check(await p.$('#cz-dialog #cz-card .hgc') !== null, 'carte agrandie : dessin de la carte');
  const eyebrow = await p.textContent('#cz-eyebrow');
  check(/· \d+ \/ \d+$/.test(eyebrow.trim()), `carte agrandie : compteur de position (« ${eyebrow.trim()} »)`);
  await p.keyboard.press('ArrowRight');
  await sleep(80);
  check(/· \d+ \/ \d+$/.test((await p.textContent('#cz-eyebrow')).trim()) && (await p.textContent('#cz-eyebrow')) !== eyebrow, 'flèche droite : carte suivante du booster');
  await p.keyboard.press('Escape');
  await sleep(80);
  check(!(await ouverte(p)), 'Échap : la carte agrandie se ferme');
  check(await p.evaluate(() => document.activeElement?.classList.contains('op-card') && document.activeElement?.dataset.i === '4'), 'fermeture : le focus revient à la carte');
  // Clavier : Entrée sur une carte révélée, puis Espace.
  await p.focus('#op-stage .op-card[data-i="1"]');
  await p.keyboard.press('Enter');
  await p.waitForSelector(OPEN_CARD, { timeout: 3000 }).catch(() => {});
  const nom1 = await nomDe(p, '#op-stage .op-card[data-i="1"] .op-front');
  check(await ouverte(p) && (await titreOuvert(p)) === nom1, 'Entrée sur une carte : carte agrandie de la bonne carte');
  await p.keyboard.press('Escape');
  await sleep(80);
  await p.focus('#op-stage .op-card[data-i="2"]');
  await p.keyboard.press(' ');
  await p.waitForSelector(OPEN_CARD, { timeout: 3000 }).catch(() => {});
  const nom2 = await nomDe(p, '#op-stage .op-card[data-i="2"] .op-front');
  check(await ouverte(p) && (await titreOuvert(p)) === nom2, 'Espace sur une carte : carte agrandie de la bonne carte');
  await p.keyboard.press('Escape');
  await sleep(80);
  check(!p.errs.length, 'booster animé : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 2. Lot de 5 boosters animé : une carte en attente se retourne au premier clic, le détail vient ensuite.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, scenario: { types: true, bal: 600 } });
  await acheter(p, 5);
  await aOuverture(p);
  await p.click(BTN_X5);
  await p.waitForSelector('#x5-c24', { timeout: 8000 });
  check(await p.$eval('#x5-c24', (e) => e.classList.contains('is-pending')), 'lot de 5 : carte encore face cachée au départ');
  await p.click('#x5-c24');
  check(!(await p.$eval('#x5-c24', (e) => e.classList.contains('is-pending'))), 'lot de 5 : le premier clic retourne la carte');
  check(!(await ouverte(p)), 'lot de 5 : le premier clic n\'ouvre pas la carte agrandie');
  await revelerTout(p);
  const nomX5 = await nomDe(p, '#x5-c24 .x5-front');
  await p.click('#x5-c24');
  await p.waitForSelector(OPEN_CARD, { timeout: 3000 }).catch(() => {});
  check(await ouverte(p) && (await titreOuvert(p)) === nomX5, `lot de 5 : carte révélée agrandie (« ${nomX5} »)`);
  const pos1 = (await p.textContent('#cz-eyebrow')).trim();
  check(/· 1 \/ \d+$/.test(pos1) || /· \d+ \/ \d+$/.test(pos1), `lot de 5 : compteur de position (« ${pos1} »)`);
  await p.click('#cz-dialog .cz-bar-btn:nth-child(2)').catch(() => p.keyboard.press('ArrowRight'));
  await sleep(80);
  check((await p.textContent('#cz-eyebrow')) !== pos1, 'lot de 5 : « Suivant » passe à une autre carte du lot');
  await p.keyboard.press('Escape');
  await sleep(80);
  check(!(await ouverte(p)), 'lot de 5 : Échap ferme la carte agrandie');
  await p.focus('#x5-c0');
  await p.keyboard.press('Enter');
  await p.waitForSelector(OPEN_CARD, { timeout: 3000 }).catch(() => {});
  check(await ouverte(p), 'lot de 5 : Entrée au clavier ouvre une carte révélée');
  await p.keyboard.press('Escape');
  await sleep(80);
  check(await p.isVisible(HINT), 'lot de 5 : indice visible après la révélation');
  check(!p.errs.length, 'lot de 5 : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 3. Booster gratuit et booster offert, sans animation : grille de cartes (boutons).
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, reducedMotion: 'reduce', scenario: { types: true, bal: 600, stock: { classique: 1 } } });
  // Booster gratuit : onglet Ouverture (par défaut), pas besoin de changer d'onglet.
  await p.click('[data-action=open-free]');
  await p.waitForSelector('#cartes-reveal .cartes-booster-grid .hgc', { timeout: 5000 }).catch(() => {});
  const grille = p.locator('#cartes-reveal .cartes-booster-grid .hgc');
  check(await grille.count() === 5, 'booster gratuit sans animation : 5 cartes en grille');
  check(await grille.first().evaluate((e) => e.tagName === 'BUTTON'), 'grille : chaque carte est un bouton');
  check(await p.isVisible(HINT), 'grille : indice visible');
  const nomG = await grille.nth(0).locator('.hgc-plate-t').textContent();
  await grille.nth(0).click();
  await p.waitForSelector(OPEN_CARD, { timeout: 3000 }).catch(() => {});
  check(await ouverte(p) && (await titreOuvert(p)) === nomG, 'grille : clic ouvre la carte agrandie (bon nom)');
  await p.keyboard.press('Escape');
  await sleep(80);
  await grille.nth(2).focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector(OPEN_CARD, { timeout: 3000 }).catch(() => {});
  const nomG2 = await grille.nth(2).locator('.hgc-plate-t').textContent();
  check(await ouverte(p) && (await titreOuvert(p)) === nomG2, 'grille : Entrée sur un bouton ouvre la bonne carte (sans double ouverture)');
  await p.keyboard.press('Escape');
  await sleep(80);
  check(!(await ouverte(p)), 'grille : Échap ferme');
  // Booster offert (même écran de révélation).
  await p.click(OUVRIR1);
  await p.waitForSelector('#cartes-reveal .cartes-booster-grid .hgc', { timeout: 5000 }).catch(() => {});
  const grilleO = p.locator('#cartes-reveal .cartes-booster-grid .hgc');
  const nomO = await grilleO.nth(3).locator('.hgc-plate-t').textContent();
  await grilleO.nth(3).click();
  await p.waitForSelector(OPEN_CARD, { timeout: 3000 }).catch(() => {});
  check(await ouverte(p) && (await titreOuvert(p)) === nomO, 'booster offert : clic ouvre la carte agrandie (bon nom)');
  await p.keyboard.press('Escape');
  await sleep(80);
  check(!p.errs.length, 'gratuit et offert : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 4. Téléphone 390 px, écran tactile : toucher une carte ouvre le détail, appui long = loupe.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 390, height: 844, touch: true, reducedMotion: 'reduce', scenario: { types: true, bal: 600 } });
  await acheter(p, 5);
  await aOuverture(p);
  await p.tap(BTN_X5);
  await p.waitForSelector('#cartes-reveal .x5-cell', { timeout: 8000 });
  check(await hscroll(p) <= 0, '390 : révélation du lot sans défilement horizontal');
  const nomM = await nomDe(p, '#x5-c3 .x5-front');
  await p.tap('#x5-c3');
  await p.waitForSelector(OPEN_CARD, { timeout: 3000 }).catch(() => {});
  check(await ouverte(p) && (await titreOuvert(p)) === nomM, '390 : toucher une carte ouvre la carte agrandie (bon nom)');
  check(await p.$eval('#cz-lens', (l) => l.hidden), '390 : un simple toucher n\'affiche pas la loupe');
  const cdp = await p.ctx.newCDPSession(p);
  const [tx, ty] = await centre(p, '#cz-card .hgc');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty }] });
  await sleep(750);
  const loupe = await p.evaluate(() => {
    const l = document.getElementById('cz-lens');
    if (!l || l.hidden) return null;
    const c = l.querySelector('.cz-clone');
    return { scale: c ? new DOMMatrix(getComputedStyle(c).transform).a : 0 };
  });
  check(loupe && Math.abs(loupe.scale - 2.5) < 0.01, '390 : appui long sur la carte agrandie : loupe ×2,5');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(120);
  check(await p.$eval('#cz-lens', (l) => l.hidden), '390 : loupe masquée au relâchement');
  check(await hscroll(p) <= 0, '390 : carte agrandie sans défilement horizontal');
  check(!p.errs.length, '390 : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // Journal : les ouvertures passent bien par les RPC habituelles (aucun appel en plus pour voir une carte).
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, reducedMotion: 'reduce', scenario: { types: true, bal: 600 } });
  await acheter(p, 1);
  await aOuverture(p);
  await p.click(OUVRIR1);
  await p.waitForSelector('#cartes-reveal .cartes-booster-grid .hgc, #cartes-reveal .x5-cell', { timeout: 5000 }).catch(() => {});
  await p.locator('#cartes-reveal .cartes-booster-grid .hgc').first().click().catch(() => {});
  await p.waitForSelector(OPEN_CARD, { timeout: 3000 }).catch(() => {});
  const j = await log(p);
  check(j.filter((l) => l[0] === 'rpc' && l[1] === 'hg_booster_open' && l[2]?.p_mode === 'stock').length === 1, 'voir une carte : un seul appel d\'ouverture, aucune requête de plus');
  check(!p.errs.length, 'journal : aucune erreur JS');
  await p.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
