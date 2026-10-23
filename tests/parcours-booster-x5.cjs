// Parcours : ouvrir 5 boosters d'un coup depuis le stock dans cartes.html.
// Flux : on achète 5 boosters dans la Boutique (ils vont dans l'inventaire, l'onglet ne change pas), puis on
// ouvre 5 depuis l'onglet Ouverture (bouton « Ouvrir 5 »). L'ouverture ne coûte rien de plus : les Paillettes partent à l'achat.
// Faux Supabase : fixtures/fake-sb-cartes.mjs en mode typé (scenario.types) : achat hg_booster_buy, ouverture du stock
// par hg_booster_open (p_mode stock, une demande par booster, idempotence par p_request, stock vérifié).
// La tentative n° 3 échoue (échec simulé par une enveloppe de window.__SB.rpc, voir echouerOuverture).
// Cas : achat de 5 désactivé si solde < 5 × prix ; 5 appels à identifiants distincts ; 25 cartes triées ;
// arrêt propre au 3e appel puis « Reprendre l'ouverture (k restants) » sans rien rouvrir deux fois ; double clic
// (un seul achat, un seul lot) ; « réduire les animations » ; mobile 390 px sans défilement horizontal ; aucune erreur console.
// Captures : dossier qa/booster-x5 du scratchpad (1440 et 390 px), relues à la main.
// Lancer : node tests/parcours-booster-x5.cjs
const fs = require('fs');
const path = require('path');
const { ROOT, check, finish, openPage, log, hscroll, sleep, chromium } = require('./lib/harness.cjs');

/** Ouvre un onglet de Cartes par son adresse (cartes.html#id) : la barre d'onglets est masquée depuis le nouvel en-tête. */
async function goTab(p, id) {
  await p.evaluate((h) => { location.hash = ''; location.hash = h; }, id);
  await p.waitForFunction((i) => document.getElementById('cartes-p-' + i) && !document.getElementById('cartes-p-' + i).hidden, id, { timeout: 8000 });
}

/* ---------- Aides de test ---------- */
const QA = '/tmp/claude-0/-home-claude/745c1954-a6f8-5445-b8b6-c526f6aef9c2/scratchpad/qa/booster-x5';
/** Bouton d'achat de la Boutique (classique) : achète la quantité choisie dans #shop-qty. */
const ACHAT = '#cartes-paid [data-action=buy-stock]';
/** Bouton « Ouvrir 5 » du classique dans l'onglet Ouverture. */
const OUVRIR5 = '[data-action=open-stock-multi][data-type=classique][data-count="5"]';
const CELL = '#cartes-reveal .x5-cell';
/** Ouvre l'onglet Boutique (où sont les boutons d'achat). */
async function aBoutique(p) { await goTab(p, 'boutique'); await sleep(300); }
/** Ouvre l'onglet Ouverture (où sont les boutons d'ouverture) ; l'achat ne change pas d'onglet à lui seul. */
async function aOuverture(p) { await goTab(p, 'ouverture'); await sleep(300); }
const ME = '11111111-1111-4111-8111-111111111111';
/** Nombre de boosters classiques en stock pour le membre connecté (base factice, table hg_booster_stock). */
const stock = (p) => p.evaluate((me) => window.__DB.hg_booster_stock.find((r) => r.user_id === me && r.type_id === 'classique')?.qty ?? 0, ME);
/** Achète n boosters classiques dans la Boutique et attend qu'ils soient dans le stock. */
async function acheter(p, n) {
  await aBoutique(p);
  await p.selectOption('#shop-qty', String(n));
  const avant = await stock(p);
  await p.click(ACHAT);
  await p.waitForFunction(([me, a]) => (window.__DB.hg_booster_stock.find((r) => r.user_id === me && r.type_id === 'classique')?.qty ?? 0) === a, [ME, avant + n], { timeout: 8000 });
  await sleep(200);
}

/**
 * Fait échouer la n-ième ouverture du stock (hg_booster_open, mode stock) : la RPC répond une erreur, rien n'est ouvert ni débité.
 * L'appel est tout de même noté dans le journal, comme un vrai appel. Les autres appels passent par la RPC du faux client.
 */
async function echouerOuverture(p, n) {
  await p.evaluate((n) => {
    const sb = window.__SB, orig = sb.rpc;
    let vu = 0;
    window.__ECHEC = n;
    sb.rpc = function (fn, args) {
      if (fn === 'hg_booster_open' && args?.p_mode === 'stock' && window.__ECHEC && ++vu === window.__ECHEC) {
        window.__LOG.push(['rpc', fn, args]);
        return Promise.resolve({ data: null, error: { message: 'Ouverture refusée (essai)' } });
      }
      return orig.call(this, fn, args);
    };
  }, n);
}

/** Appels d'ouverture du stock (hg_booster_open, mode stock) dans le journal j. */
const rpcs = (j) => j.filter((l) => l[0] === 'rpc' && l[1] === 'hg_booster_open' && l[2]?.p_mode === 'stock');
/** Nombre d'appels de hg-notify pour l'événement ev dans le journal j. */
const notifs = (j, ev) => j.filter((l) => l[0] === 'fn' && l[1] === 'hg-notify' && l[2]?.event === ev).length;

/** Révèle le lot jusqu'au bout (toutes les cartes retournées), puis attend le bouton de fermeture. */
async function revelerTout(p) {
  await p.waitForSelector('#cartes-reveal [data-action=reveal-all], #cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
  if (await p.$('#cartes-reveal [data-action=reveal-all]')) await p.click('#cartes-reveal [data-action=reveal-all]');
  await p.waitForSelector('#cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
}

/** Attend qu'une notification (toast) affiche un texte qui correspond à l'expression re. */
const toastHas = (p, re) => p.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 8000 });

/* ---------- Scénario ---------- */
(async () => {
  console.log('Racine testée : ' + ROOT);
  fs.mkdirSync(QA, { recursive: true });
  const browser = await chromium.launch();

  // 1. Solde insuffisant (450 < 5 × 100) : achat de 5 désactivé avec message, achat d'un seul toujours actif.
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1440, scenario: { types: true, bal: 450 } });
  await aBoutique(p);
  await p.selectOption('#shop-qty', '5');
  check(await p.isDisabled(ACHAT), 'solde 450 < 500 : achat de 5 boosters désactivé');
  check(/500/.test(await p.textContent(ACHAT)), 'bouton d\'achat affiche le prix total (500)');
  check(/Il te manque/.test(await p.textContent('#cartes-paid .shop-stock-miss')), 'message « Il te manque » pour les 5 boosters');
  await p.selectOption('#shop-qty', '1');
  check(await p.isEnabled(ACHAT), 'achat d\'un seul booster toujours actif avec 450');
  await p.screenshot({ path: path.join(QA, 'boutons-1440.png') });
  check(!p.errs.length, '1440 : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 2. Solde suffisant : achat de 5, puis ouverture complète depuis le stock.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1440, scenario: { types: true, bal: 600 } });
  await aBoutique(p);
  await p.selectOption('#shop-qty', '5');
  check(await p.isEnabled(ACHAT), 'solde 600 : achat de 5 boosters actif');
  await p.click(ACHAT);
  await p.waitForFunction(([me]) => window.__DB.hg_booster_stock.find((r) => r.user_id === me && r.type_id === 'classique')?.qty === 5, [ME], { timeout: 8000 });
  check(await p.evaluate(() => window.__DB.hg_wallets[0].paillettes) === 100, 'achat : 500 débités (reste 100)');
  check(await p.$eval('[data-tab=boutique]', (b) => b.getAttribute('aria-selected')) === 'true', 'achat : l\'onglet Boutique reste affiché');
  await aOuverture(p);
  await p.click(OUVRIR5);
  await revelerTout(p);
  let j = await log(p);
  const demandes = rpcs(j);
  check(demandes.length === 5, `5 appels à hg_booster_open (stock) (${demandes.length})`);
  check(new Set(demandes.map((l) => l[2]?.p_request)).size === 5, 'cinq identifiants de demande distincts');
  check(demandes.every((l) => l[2]?.p_type === 'classique' && l[2]?.p_mode === 'stock' && typeof l[2]?.p_request === 'string'), 'chaque appel : classique, depuis le stock (p_mode stock) et un p_request');
  check(!j.some((l) => l[0] === 'rpc' && l[1] === 'hg_open_booster'), 'pas de repli sur hg_open_booster');
  const cellsN = await p.$$eval(CELL, (x) => x.length);
  check(cellsN === 25, `25 cartes affichées (${cellsN})`);
  const ranks = await p.$$eval(CELL, (els) => els.map((e) => Number(e.dataset.rank)));
  check(ranks.every((r, i) => i === 0 || ranks[i - 1] >= r), 'cartes triées de la plus rare à la moins rare');
  check((await p.$$(`${CELL}.is-shiny`)).length >= 1, 'cartes brillantes mises en valeur (classe is-shiny)');
  const head = await p.textContent('.x5-head');
  check(/5 boosters · 25 cartes · meilleure : /.test(head), `résumé en tête : « ${head.trim()} »`);
  check(/nouvelles? pour ta collection/.test(await p.textContent('.x5-sum')), 'nombre de nouvelles cartes pour la collection');
  check(await p.$eval('#cartes-reveal [data-action=close-reveal]', (b) => b === document.activeElement), 'focus sur « Fermer » en fin de révélation');
  // Q7 : annonce par rareté (25 cartes : regroupée, seules les cartes à partir d'épique sont nommées) et pastilles du résumé
  const live = await p.textContent('#cartes-live');
  check(/^Boosters ouverts\. 25 cartes : \d+ /.test(live) && /nouvelles? pour ta collection/.test(live), `Q7 : annonce « 25 cartes : … » (${live.slice(0, 90)}…)`);
  const nommees = await p.evaluate(() => window.__DB.hg_card_copies.slice(-25).length);
  check(nommees === 25 && (live.match(/,/g) || []).length <= 12, 'Q7 : annonce courte (regroupée par rareté)');
  check(await p.locator('#cartes-reveal .rv-sum .rv-chip').count() >= 2, 'Q7 : pastilles par rareté dans le résumé');
  const liste = await p.$$eval('#cartes-reveal ul.visually-hidden li', (x) => x.length);
  check(liste === 25, 'liste textuelle masquée visuellement : 25 cartes');
  check(notifs(j, 'card_wish') === 5, 'alerte souhaits : un appel par booster (5)');
  const belles = await p.$$eval(CELL, (els) => els.filter((e) => Number(e.dataset.rank) >= 5).length);
  check(notifs(j, 'card_pull') === belles, `annonces Discord : une par carte légendaire ou plus (${belles})`);
  check(await p.evaluate(() => window.__DB.hg_wallets[0].paillettes) === 100, 'ouverture depuis le stock : aucune Paillette de plus (reste 100)');
  check(await stock(p) === 0, 'ouverture : stock 5 -> 0');
  await p.screenshot({ path: path.join(QA, 'revele-1440.png'), fullPage: true });
  await p.click('#cartes-reveal [data-action=close-reveal]');
  check((await p.$$('#cartes-reveal .x5-cell')).length === 0, 'fermer : la révélation disparaît');
  await aBoutique(p);
  await p.selectOption('#shop-qty', '5');
  check(await p.isDisabled(ACHAT), 'après : solde 100 < 500, achat de 5 désactivé');
  check(!p.errs.length, '1440 : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 3. Double clic : un seul achat (un seul débit), puis un seul lot de 5 appels.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, scenario: { types: true, bal: 600 } });
  await aBoutique(p);
  await p.selectOption('#shop-qty', '5');
  await p.dblclick(ACHAT);
  await p.waitForFunction(([me]) => (window.__DB.hg_booster_stock.find((r) => r.user_id === me && r.type_id === 'classique')?.qty ?? 0) >= 5, [ME], { timeout: 8000 });
  await sleep(300);
  check(await stock(p) === 5, `double clic à l'achat : 5 boosters, pas 10 (${await stock(p)})`);
  check(await p.evaluate(() => window.__DB.hg_wallets[0].paillettes) === 100, 'double clic à l\'achat : débit unique de 500');
  await aOuverture(p);
  await p.dblclick(OUVRIR5);
  await revelerTout(p);
  j = await log(p);
  check(rpcs(j).length === 5, `double clic : toujours 5 appels (${rpcs(j).length})`);
  check(await stock(p) === 0 && await p.evaluate(() => window.__DB.hg_wallets[0].paillettes) === 100, 'double clic : stock 0, solde 100');
  check(!p.errs.length, 'double clic : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 4. Arrêt au 3e appel (solde ou réseau) : 2 boosters ouverts, 3 restent ; « Reprendre l'ouverture » les ouvre sans rien rouvrir deux fois.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, scenario: { types: true, bal: 600 } });
  await acheter(p, 5);
  await aOuverture(p);
  await echouerOuverture(p, 3);
  await p.click(OUVRIR5);
  await revelerTout(p);
  await toastHas(p, /2 boosters ouverts sur 5/);
  j = await log(p);
  check(rpcs(j).length === 3, `arrêt propre : 3 appels seulement (${rpcs(j).length})`);
  check((await p.$$(CELL)).length === 10, 'arrêt : les 2 boosters ouverts sont affichés (10 cartes)');
  check(/Ouverture interrompue/.test(await p.textContent('#cartes-reveal')), 'arrêt : motif affiché dans la révélation');
  check(await p.evaluate(() => window.__DB.hg_wallets[0].paillettes) === 100, 'arrêt : solde inchangé (l\'achat était déjà payé)');  check(await stock(p) === 3, `arrêt : 3 boosters restent en stock (${await stock(p)})`);
  check(await p.isEnabled('#cartes-p-ouverture [data-action=resume-multi]') && /Reprendre l'ouverture \(3 restants\)/.test(await p.textContent('#cartes-p-ouverture [data-action=resume-multi]')),
    'reprise proposée : « Reprendre l\'ouverture (3 restants) »');
  await p.click('#cartes-reveal [data-action=close-reveal]');
  await p.evaluate(() => { window.__ECHEC = null; });
  await p.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await p.click('#cartes-p-ouverture [data-action=resume-multi]');
  await revelerTout(p);
  j = await log(p);
  const tous = rpcs(j);
  check(tous.length === 6, `reprise : 3 appels de plus (${tous.length} au total)`);
  check(tous[3]?.[2]?.p_request === tous[2]?.[2]?.p_request, 'reprise : le 3e booster est renvoyé avec le même identifiant (pas de double ouverture)');
  check(new Set(tous.map((l) => l[2]?.p_request)).size === 5, 'reprise : seulement 5 identifiants distincts');
  check((await p.$$(CELL)).length === 25, 'reprise : 25 cartes au total');
  check(await p.evaluate(() => window.__DB.hg_wallets[0].paillettes) === 100, 'reprise : solde final 100 (rien de plus débité)');
  check(await stock(p) === 0, 'reprise : stock 0');
  check(!(await p.$('#cartes-p-ouverture [data-action=resume-multi]')), 'reprise : plus de bouton « Reprendre » une fois terminé');
  check(!(await p.$$eval('.toast', (x) => x.some((t) => t.classList.contains('error') || /sur 5/.test(t.textContent)))), 'reprise : aucune erreur affichée');
  check(!p.errs.length, 'arrêt et reprise : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 5. Booster unique depuis le stock : une seule demande, identifiant fourni (non régressé).
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, scenario: { types: true, bal: 600 } });
  await acheter(p, 1);
  await aOuverture(p);
  await p.click('#cartes-p-ouverture #cartes-stock [data-action=open-gift]');
  await p.waitForSelector('#cartes-reveal [data-action=reveal-all], #cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
  if (await p.$('#cartes-reveal [data-action=reveal-all]')) await p.click('#cartes-reveal [data-action=reveal-all]');
  await p.waitForSelector('#cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
  j = await log(p);
  check(rpcs(j).length === 1 && rpcs(j)[0][2]?.p_type === 'classique' && typeof rpcs(j)[0][2]?.p_request === 'string', 'booster unique : un seul appel, classique depuis le stock, avec identifiant');
  check((await p.$$('#cartes-reveal .op-front .hgc')).length === 5, 'booster unique : 5 cartes comme avant');
  check(await p.evaluate(() => window.__DB.hg_wallets[0].paillettes) === 500, 'booster unique : seul l\'achat a coûté (500 restants)');
  check(!p.errs.length, 'booster unique : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 6. Réduire les animations : pas de cascade, les 25 cartes sont là tout de suite.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, reducedMotion: 'reduce', scenario: { types: true, bal: 600 } });
  await acheter(p, 5);
  await aOuverture(p);
  await p.click(OUVRIR5);
  await p.waitForSelector('#cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
  check((await p.$$(CELL)).length === 25, 'réduire les animations : 25 cartes affichées directement');
  check((await p.$$(`${CELL}.is-pending`)).length === 0, 'réduire les animations : aucune carte en attente');
  check(!(await p.$('#cartes-reveal [data-action=reveal-all]')), 'réduire les animations : pas de cascade à passer');
  check(!p.errs.length, 'réduire les animations : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 7. Mobile 390 px : pas de défilement horizontal, grille sur 3 colonnes.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 390, scenario: { types: true, bal: 600 } });
  await acheter(p, 5);
  await p.screenshot({ path: path.join(QA, 'boutons-390.png'), fullPage: true });
  check(await hscroll(p) === 0, '390 : boutique sans défilement horizontal');
  await aOuverture(p);
  check(await hscroll(p) === 0, '390 : ouverture sans défilement horizontal');
  await p.click(OUVRIR5);
  await revelerTout(p);
  check(await hscroll(p) === 0, '390 : révélation sans défilement horizontal');
  const colonnes = await p.$$eval(CELL, (els) => new Set(els.slice(0, 6).map((e) => Math.round(e.getBoundingClientRect().left))).size);
  check(colonnes === 3, `390 : grille sur 3 colonnes (${colonnes})`);
  check(await p.$eval('#cartes-reveal', (el) => el.getBoundingClientRect().width <= innerWidth), '390 : la révélation tient dans l\'écran');
  await p.screenshot({ path: path.join(QA, 'revele-390.png'), fullPage: true });
  check(!p.errs.length, '390 : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
