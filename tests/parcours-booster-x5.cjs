// Parcours : ouvrir 5 boosters payants d'un coup dans cartes.html.
// Faux Supabase : fixtures/fake-sb-cartes.mjs, avec hg_open_booster_req activée par scenario.reqRpc
// (idempotence par p_request, solde vérifié, scenario.x5FailAt = tentative qui échoue).
// Cas : bouton désactivé si solde < 5 × prix ; 5 appels à identifiants distincts ; 25 cartes triées ;
// arrêt propre au 3e appel puis reprise avec les boosters restants ; double clic ; « réduire les animations » ;
// mobile 390 px sans défilement horizontal ; aucune erreur console.
// Captures : dossier qa/booster-x5 du scratchpad (1440 et 390 px), relues à la main.
// Lancer : node tests/parcours-booster-x5.cjs
const fs = require('fs');
const path = require('path');
const { ROOT, check, finish, openPage, log, hscroll, chromium } = require('./lib/harness.cjs');

/* ---------- Aides de test ---------- */
const QA = '/tmp/claude-0/-home-claude/745c1954-a6f8-5445-b8b6-c526f6aef9c2/scratchpad/qa/booster-x5';
const BTN = '[data-action=open-paid-x5]';
const CELL = '#cartes-reveal .x5-cell';

/** Appels de hg_open_booster_req dans le journal j. */
const rpcs = (j) => j.filter((l) => l[0] === 'rpc' && l[1] === 'hg_open_booster_req');
/** Nombre d'appels de hg-notify pour l'événement ev dans le journal j. */
const notifs = (j, ev) => j.filter((l) => l[0] === 'fn' && l[1] === 'hg-notify' && l[2]?.event === ev).length;

// Attend la révélation (cascade ou directe), passe la cascade avec « Tout révéler » si elle est proposée.
/** Révèle le booster jusqu'au bout (toutes les cartes retournées), puis attend le bouton de fermeture. */
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

  // 1. Solde insuffisant (450 < 5 × 100) : bouton désactivé, message, booster unique toujours actif.
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1440, scenario: { reqRpc: true, bal: 450 } });
  await p.click('[data-tab=boosters]').catch(() => {});
  check(await p.isVisible(BTN), 'bouton « Ouvrir 5 boosters » proposé à côté du booster unique');
  check(await p.isDisabled(BTN), 'solde 450 < 500 : bouton 5 boosters désactivé');
  check(/500 Paillettes/.test(await p.textContent(BTN)), 'bouton 5 boosters affiche le prix total (500)');
  check(/Pour 5 boosters, il te manque/.test(await p.textContent('#cartes-paid')), 'message « il te manque » pour les 5 boosters');
  check(await p.isEnabled('[data-action=open-paid]'), 'le booster unique reste actif avec 450');
  await p.screenshot({ path: path.join(QA, 'boutons-1440.png') });
  check(!p.errs.length, '1440 : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 2. Solde suffisant : ouverture complète.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1440, scenario: { reqRpc: true, bal: 600 } });
  check(await p.isEnabled(BTN), 'solde 600 : bouton 5 boosters actif');
  await p.click(BTN);
  await revelerTout(p);
  let j = await log(p);
  const demandes = rpcs(j);
  check(demandes.length === 5, `5 appels à hg_open_booster_req (${demandes.length})`);
  check(new Set(demandes.map((l) => l[2]?.p_request)).size === 5, 'cinq identifiants de demande distincts');
  check(demandes.every((l) => l[2]?.p_free === false && typeof l[2]?.p_request === 'string'), 'chaque appel : p_free false et un p_request');
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
  const liste = await p.$$eval('#cartes-reveal ul.visually-hidden li', (x) => x.length);
  check(liste === 25, 'liste textuelle masquée visuellement : 25 cartes');
  check(notifs(j, 'card_wish') === 5, 'alerte souhaits : un appel par booster (5)');
  const belles = await p.$$eval(CELL, (els) => els.filter((e) => Number(e.dataset.rank) >= 5).length);
  check(notifs(j, 'card_pull') === belles, `annonces Discord : une par carte légendaire ou plus (${belles})`);
  const solde = await p.evaluate(() => window.__DB.hg_wallets[0].paillettes);
  check(solde === 100, `solde débité de 500 (reste ${solde})`);
  check(await p.isDisabled(BTN), 'après : solde 100 < 500, bouton désactivé');
  await p.screenshot({ path: path.join(QA, 'revele-1440.png'), fullPage: true });
  await p.click('#cartes-reveal [data-action=close-reveal]');
  check((await p.$$('#cartes-reveal .x5-cell')).length === 0, 'fermer : la révélation disparaît');
  check(!p.errs.length, '1440 : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 3. Double clic : un seul lot de 5 appels.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, scenario: { reqRpc: true, bal: 600 } });
  await p.dblclick(BTN);
  await revelerTout(p);
  j = await log(p);
  check(rpcs(j).length === 5, `double clic : toujours 5 appels (${rpcs(j).length})`);
  check(await p.evaluate(() => window.__DB.hg_wallets[0].paillettes) === 100, 'double clic : débit unique de 500');
  check(!p.errs.length, 'double clic : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 4. Arrêt au 3e appel (solde ou réseau), puis reprise avec les 3 boosters restants.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, scenario: { reqRpc: true, bal: 600, x5FailAt: 3 } });
  await p.click(BTN);
  await revelerTout(p);
  await toastHas(p, /2 boosters ouverts sur 5/);
  j = await log(p);
  check(rpcs(j).length === 3, `arrêt propre : 3 appels seulement (${rpcs(j).length})`);
  check((await p.$$(CELL)).length === 10, 'arrêt : les 2 boosters ouverts sont affichés (10 cartes)');
  check(/Ouverture interrompue/.test(await p.textContent('#cartes-reveal')), 'arrêt : motif affiché dans la révélation');
  check(await p.evaluate(() => window.__DB.hg_wallets[0].paillettes) === 400, 'arrêt : 400 restants (2 boosters débités seulement)');
  check(/Ouvrir 3 boosters/.test(await p.textContent(BTN)) && await p.isEnabled(BTN), 'reprise proposée : « Ouvrir 3 boosters » (400 ≥ 300)');
  await p.click('#cartes-reveal [data-action=close-reveal]');
  await p.evaluate(() => { window.__SCN.x5FailAt = null; });
  await p.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await p.click(BTN);
  await revelerTout(p);
  j = await log(p);
  const tous = rpcs(j);
  check(tous.length === 6, `reprise : 3 appels de plus (${tous.length} au total)`);
  check(tous[3]?.[2]?.p_request === tous[2]?.[2]?.p_request, 'reprise : le 3e booster est renvoyé avec le même identifiant (pas de double ouverture)');
  check(new Set(tous.map((l) => l[2]?.p_request)).size === 5, 'reprise : seulement 5 identifiants distincts');
  check((await p.$$(CELL)).length === 25, 'reprise : 25 cartes au total');
  check(await p.evaluate(() => window.__DB.hg_wallets[0].paillettes) === 100, 'reprise : solde final 100');
  check(!(await p.$$eval('.toast', (x) => x.some((t) => t.classList.contains('error') || /sur 5/.test(t.textContent)))), 'reprise : aucune erreur affichée');
  check(!p.errs.length, 'arrêt et reprise : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 5. Booster unique avec la nouvelle RPC : une seule demande, identifiant fourni (non régressé).
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, scenario: { reqRpc: true, bal: 600 } });
  await p.click('[data-action=open-paid]');
  await p.waitForSelector('#cartes-reveal [data-action=reveal-all], #cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
  if (await p.$('#cartes-reveal [data-action=reveal-all]')) await p.click('#cartes-reveal [data-action=reveal-all]');
  await p.waitForSelector('#cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
  j = await log(p);
  check(rpcs(j).length === 1 && rpcs(j)[0][2]?.p_free === false, 'booster unique : un seul appel, payant');
  check((await p.$$('#cartes-reveal .op-front .hgc')).length === 5, 'booster unique : 5 cartes comme avant');
  check(await p.evaluate(() => window.__DB.hg_wallets[0].paillettes) === 500, 'booster unique : débit de 100');
  check(!p.errs.length, 'booster unique : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 6. Réduire les animations : pas de cascade, les 25 cartes sont là tout de suite.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, reducedMotion: 'reduce', scenario: { reqRpc: true, bal: 600 } });
  await p.click(BTN);
  await p.waitForSelector('#cartes-reveal [data-action=close-reveal]', { timeout: 8000 });
  check((await p.$$(CELL)).length === 25, 'réduire les animations : 25 cartes affichées directement');
  check((await p.$$(`${CELL}.is-pending`)).length === 0, 'réduire les animations : aucune carte en attente');
  check(!(await p.$('#cartes-reveal [data-action=reveal-all]')), 'réduire les animations : pas de cascade à passer');
  check(!p.errs.length, 'réduire les animations : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 7. Mobile 390 px : pas de défilement horizontal, grille sur 3 colonnes.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 390, scenario: { reqRpc: true, bal: 600 } });
  await p.screenshot({ path: path.join(QA, 'boutons-390.png'), fullPage: true });
  check(await hscroll(p) === 0, '390 : boutons sans défilement horizontal');
  await p.click(BTN);
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
