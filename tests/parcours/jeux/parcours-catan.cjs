// Parcours Catan du gang (plateaux, migration 144) : plateau SVG, mise en place (colonie puis route), construction d'une
// route en phase action, lancer des dés, déplacement du voleur, fin de partie ; 390 et 360 px sans défilement horizontal ;
// aucune erreur JS. Faux Supabase : fixtures/fake-sb-catan.mjs (scénario : phase, fin).
const { check, finish, openPage, hscroll, log, sleep, chromium } = require('../../lib/harness.cjs');

const FIX = 'fake-sb-catan.mjs';
const HASH = '#partie/HGCAT-1234';
/** Dernier appel d'une fonction RPC journalisé par le faux client. */
const dernierRpc = async (p, fn) => (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === fn).pop();
const titrePanneau = (p) => p.locator('.ct-panneau h2').first().innerText().catch(() => '');

(async () => {
  const browser = await chromium.launch();

  // ----- Ordinateur : mise en place (une colonie, puis une route qui la touche) -----
  let p = await openPage(browser, { page: 'catan', fixture: FIX, scenario: { phase: 'placement' }, hash: HASH, width: 1280, height: 900 });
  await p.waitForSelector('.ct-svg', { timeout: 6000 }).catch(() => {});
  check((await p.locator('.ct-bandeau h1').innerText()) === 'Catan du gang', 'titre : « Catan du gang » dans le bandeau');
  check((await p.locator('.ct-svg polygon.ct-hex').count()) === 19, 'plateau : 19 tuiles');
  check((await p.locator('.ct-svg .ct-colonie, .ct-svg .ct-ville').count()) === 0, 'plateau : aucune colonie avant la mise en place');
  check((await titrePanneau(p)) === 'Pose ta colonie', 'panneau : « Pose ta colonie » (c\'est à moi)');
  const nbSommets = await p.locator('[data-sommet]').count();
  check(nbSommets > 20, `sommets libres mis en valeur : ${nbSommets}`);
  check((await p.locator('[data-arete]').count()) === 0, 'arêtes : aucune cible avant la colonie');
  const nomSommet = await p.locator('[data-sommet]').first().getAttribute('aria-label');
  check((await p.locator('[data-sommet]').first().getAttribute('role')) === 'button' && nomSommet.startsWith('Sommet entre '),
    `accessibilité : sommet focusable et nommé (« ${nomSommet} »)`);
  const sommet = await p.locator('[data-sommet]').first().getAttribute('data-sommet');
  await p.locator('[data-sommet]').first().click();
  await sleep(600);
  let r = await dernierRpc(p, 'hg_plat_agir');
  check(r && r[2].p_action === 'colonie' && r[2].p_args.sommet === Number(sommet) && r[2].p_code === 'HGCAT-1234',
    `colonie : hg_plat_agir(colonie, { sommet: ${sommet} }) sur HGCAT-1234`);
  await p.waitForFunction(() => document.querySelector('.ct-panneau h2')?.textContent === 'Pose ta route', null, { timeout: 4000 }).catch(() => {});
  check((await titrePanneau(p)) === 'Pose ta route', 'après la colonie : « Pose ta route »');
  const nbAretes = await p.locator('[data-arete]').count();
  check(nbAretes >= 1 && nbAretes <= 3, `routes : seules les arêtes de la colonie sont cibles (${nbAretes})`);
  check((await p.locator('.ct-svg .ct-colonie').count()) === 1, 'plateau : la colonie posée est dessinée');
  const arete = await p.locator('[data-arete]').first().getAttribute('data-arete');
  await p.locator('[data-arete]').first().click();
  await sleep(600);
  r = await dernierRpc(p, 'hg_plat_agir');
  check(r && r[2].p_action === 'route' && r[2].p_args.arete === Number(arete), `route : hg_plat_agir(route, { arete: ${arete} })`);
  await p.waitForFunction(() => document.querySelector('.ct-panneau h2')?.textContent.startsWith("C'est à"), null, { timeout: 4000 }).catch(() => {});
  check((await titrePanneau(p)).startsWith("C'est à Alice"), 'après la route : c\'est au tour d\'Alice');
  check((await p.locator('.ct-bloc-titre').filter({ hasText: 'Ta main' }).count()) === 1, 'colonne de droite : « Ta main »');
  check((await p.locator('.ct-points li').count()) === 3, 'points : trois joueurs');
  check((await p.locator('.ct-etapes li').count()) === 4, 'règles : « Comment on joue » en quatre étapes');
  check((await p.locator('.ct-couts .ct-cout-ligne').count()) === 3, 'coûts : route, colonie, ville');
  check((await hscroll(p)) <= 0, '1280 px : pas de défilement horizontal');
  await p.screenshot({ path: __dirname + '/shots/catan-placement-1280.png', fullPage: true });
  check(p.errs.length === 0, '1280 px : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // ----- Téléphone (390 px) : phase action, construire une route par le mode « Construire une route » -----
  p = await openPage(browser, { page: 'catan', fixture: FIX, scenario: { phase: 'action' }, hash: HASH, width: 390, height: 844, mobile: true, dpr: 2 });
  await p.waitForSelector('.ct-svg', { timeout: 6000 }).catch(() => {});
  check((await titrePanneau(p)) === 'Construire, échanger ou finir', '390 px : panneau « Construire, échanger ou finir »');
  check((await p.locator('.ct-svg .ct-colonie').count()) === 3 && (await p.locator('.ct-svg .ct-route').count()) === 2,
    '390 px : trois colonies et deux routes dessinées');
  check((await p.locator('[data-mode="route"]').isEnabled()) === true, '390 px : « Construire une route » active (ressources suffisantes)');
  await p.click('[data-mode="route"]');
  await sleep(300);
  check((await p.locator('[data-mode="route"]').getAttribute('aria-pressed')) === 'true', 'mode route : bouton marqué comme actif');
  check((await p.locator('.ct-mode').count()) === 1, 'mode route : rappel de ce qu\'il faut toucher');
  const nbCibles = await p.locator('[data-arete]').count();
  check(nbCibles > 0, `mode route : arêtes libres mises en valeur (${nbCibles})`);
  // Une arête verticale a une boîte de largeur nulle : Playwright ne la juge pas visible. On prend une arête visible.
  await p.locator('[data-arete]').filter({ visible: true }).first().click();
  await sleep(600);
  r = await dernierRpc(p, 'hg_plat_agir');
  check(r && r[2].p_action === 'route' && typeof r[2].p_args.arete === 'number', 'route en phase action : hg_plat_agir(route, { arete })');
  const boite = await p.locator('[data-finir]').boundingBox();
  check(boite && boite.height >= 44, '390 px : boutons d\'action à 44 px au moins');
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal');
  await p.screenshot({ path: __dirname + '/shots/catan-action-390.png', fullPage: true });
  check(p.errs.length === 0, '390 px : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // ----- 360 px : le plateau et les panneaux tiennent dans la largeur -----
  p = await openPage(browser, { page: 'catan', fixture: FIX, scenario: { phase: 'action' }, hash: HASH, width: 360, height: 780 });
  await p.waitForSelector('.ct-svg', { timeout: 6000 }).catch(() => {});
  const largeurPlateau = await p.locator('.ct-plateau').boundingBox();
  check(largeurPlateau && largeurPlateau.width <= 360, `360 px : plateau dans la largeur (${Math.round(largeurPlateau?.width || 0)} px)`);
  check((await hscroll(p)) <= 0, '360 px : pas de défilement horizontal');
  check(p.errs.length === 0, '360 px : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // ----- Lancer les dés (phase lancer) -----
  p = await openPage(browser, { page: 'catan', fixture: FIX, scenario: { phase: 'lancer' }, hash: HASH, width: 1280, height: 900 });
  await p.waitForSelector('[data-lancer]', { timeout: 6000 }).catch(() => {});
  check((await p.locator('[data-lancer]').count()) === 1, 'lancer : bouton « Lancer les dés » présent');
  await p.click('[data-lancer]');
  await sleep(600);
  r = await dernierRpc(p, 'hg_plat_agir');
  check(r && r[2].p_action === 'lancer', 'lancer : hg_plat_agir(lancer)');
  await p.waitForFunction(() => document.querySelector('.ct-panneau h2')?.textContent === 'Construire, échanger ou finir', null, { timeout: 4000 }).catch(() => {});
  check((await titrePanneau(p)) === 'Construire, échanger ou finir', 'après les dés : phase de construction');
  check(p.errs.length === 0, 'lancer : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // ----- Voleur : une tuile suffit (personne à voler) -----
  p = await openPage(browser, { page: 'catan', fixture: FIX, scenario: { phase: 'voleur' }, hash: HASH, width: 1280, height: 900 });
  await p.waitForSelector('[data-hexe]', { timeout: 6000 }).catch(() => {});
  check((await p.locator('[data-hexe]').count()) === 18, 'voleur : 18 tuiles proposées (toutes sauf celle du voleur)');
  const hexe = await p.locator('[data-hexe]').first().getAttribute('data-hexe');
  await p.locator('[data-hexe]').first().click();
  await sleep(600);
  r = await dernierRpc(p, 'hg_plat_agir');
  check(r && r[2].p_action === 'voleur' && r[2].p_args.hexe === Number(hexe), `voleur : hg_plat_agir(voleur, { hexe: ${hexe} })`);
  check(p.errs.length === 0, 'voleur : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // ----- Fin de partie : bilan par joueur -----
  p = await openPage(browser, { page: 'catan', fixture: FIX, scenario: { fin: true, phase: 'action' }, hash: HASH, width: 1280, height: 900 });
  await p.waitForSelector('.ct-fin-liste li', { timeout: 6000 }).catch(() => {});
  check((await p.locator('.ct-fin-liste li').count()) === 3, 'fin : un bilan par joueur (trois)');
  check((await p.locator('.ct-fin-ligne.is-gagnant').count()) === 1, 'fin : un gagnant mis en avant');
  check((await hscroll(p)) <= 0, 'fin 1280 px : pas de défilement horizontal');
  await p.screenshot({ path: __dirname + '/shots/catan-fin-1280.png', fullPage: true });
  check(p.errs.length === 0, 'fin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
