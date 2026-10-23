// Parcours : page « Jeux » (jeux.html), faux Supabase fixtures/fake-sb-jeux.mjs.
// Onglet « Aujourd'hui » par défaut (programme du jour, états des jeux, Paillettes du jour) ; motif ARIA des onglets
// (un seul tabindex 0, flèches, Début/Fin) ; adresse jeux.html#<id> et mémoire locale ; import paresseux des modules ;
// lien « Jeux » dans le menu ; 360 px sans défilement horizontal de la page (la barre d'onglets défile seule) ;
// grand écran : colonne d'onglets verticale et groupée ; aucune erreur JS.
// Lancer : node tests/parcours-jeux.cjs
const { check, finish, openPage, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');
const FIX = 'fake-sb-jeux.mjs';
// Les onglets viennent de la liste commune (les paquets en ajoutent) : le test ne suppose plus 3 jeux.
const IDS = [...require('fs').readFileSync(require('path').join(__dirname, '../assets/js/jeux/onglets.js'), 'utf8').matchAll(/\{ id: '([a-z0-9-]+)'/g)].map((m) => m[1]);
// Les onglets sont groupés (Chaque jour, Chaque semaine, Compétition) : le dernier onglet est le dernier de la dernière
// rubrique non vide, pas le dernier de la liste.
const RYTHMES = [...require('fs').readFileSync(require('path').join(__dirname, '../assets/js/jeux/onglets.js'), 'utf8').matchAll(/\{ id: '([a-z0-9-]+)'[^\n]*?rythme: '(jour|semaine|competition)'/g)].map((m) => [m[1], m[2]]);
const LAST = ['competition', 'semaine'].map((r) => RYTHMES.filter((x) => x[1] === r).map((x) => x[0]).pop()).find(Boolean) || IDS[IDS.length - 1];

(async () => {
  const browser = await chromium.launch();

  /* ---------- Téléphone : onglet par défaut, tableau de bord ---------- */
  let p = await openPage(browser, { page: 'jeux', fixture: FIX, width: 360, height: 800 });
  await p.waitForSelector('#jeux-panel-aujourdhui .jeux-row', { timeout: 6000 }).catch(() => {});
  await p.waitForFunction(() => !document.querySelector('[data-sub="geo"]')?.textContent.includes('…'), null, { timeout: 6000 }).catch(() => {});
  const tabs = p.locator('[role="tab"]');
  check(await tabs.count() === IDS.length + 1, `onglets : Aujourd’hui + ${IDS.length} jeux`);
  check(await p.locator('#jeux-tab-aujourdhui').getAttribute('aria-selected') === 'true', 'défaut : onglet « Aujourd’hui » sélectionné');
  check(await p.locator('[role="tab"][tabindex="0"]').count() === 1, 'ARIA : un seul onglet dans l’ordre de tabulation');
  check(await p.locator('#jeux-tabs').getAttribute('aria-orientation') === 'horizontal', 'ARIA : barre horizontale sur téléphone');
  check(await p.locator('#jeux-panel-aujourdhui').getAttribute('aria-labelledby') === 'jeux-tab-aujourdhui', 'ARIA : panneau relié à son onglet');
  check(await p.locator('.jeux-row').count() === IDS.length, 'tableau de bord : une ligne par jeu');
  check((await p.locator('[data-sub="geo"]').innerText()).includes('Manche n°18'), 'tableau de bord : résumé GeoGuessr');
  check((await p.locator('[data-badge="geo"]').innerText()).includes('À jouer'), 'tableau de bord : GeoGuessr à jouer');
  check((await p.locator('[data-badge="citations"]').innerText()).includes('À jouer'), 'tableau de bord : citations à jouer');
  check((await p.locator('#jeux-prog-txt').innerText()).includes('0 jeu sur 3'), 'programme : 0 jeu sur 3 faits');
  check(!(await p.locator('#jeux-bal').isHidden()) && (await p.locator('#jeux-bal-v').innerText()).includes('+0'), 'en-tête : Paillettes du jour affichées');
  check(await hscroll(p) <= 0, '360 px : pas de défilement horizontal de la page');
  const bar = await p.evaluate(() => { const t = document.querySelector('#jeux-tabs'); return { sw: t.scrollWidth, cw: t.clientWidth }; });
  check(bar.sw >= bar.cw, '360 px : la barre d’onglets reste dans sa boîte (défile seule)');
  const minH = await p.evaluate(() => Math.min(...[...document.querySelectorAll('[role="tab"], .jeux-row')].map((b) => b.getBoundingClientRect().height)));
  check(minH >= 44, `cibles ≥ 44 px (min ${Math.round(minH)})`);
  check(await p.locator('.site-header a[data-page="jeux"]').count() >= 1, 'menu : lien « Jeux »');
  check(!(await log(p)).some((l) => l[0] === 'rpc' && l[1] === 'hg_daily_submit'), 'aucun envoi au chargement');

  /* ---------- Clavier : flèches, Fin, Début ; adresse et mémoire ---------- */
  await p.locator('#jeux-tab-aujourdhui').focus();
  await p.keyboard.press('ArrowRight');
  await sleep(500);
  check(await p.locator('#jeux-tab-geo').getAttribute('aria-selected') === 'true', 'clavier : flèche droite → GeoGuessr');
  check(await p.evaluate(() => document.activeElement?.id) === 'jeux-tab-geo', 'clavier : le focus suit l’onglet');
  check(await p.evaluate(() => location.hash) === '#geo', 'adresse : #geo');
  await p.keyboard.press('End');
  await sleep(500);
  check(await p.locator('#jeux-tab-' + LAST).getAttribute('aria-selected') === 'true', 'clavier : Fin → dernier onglet');
  await p.keyboard.press('Home');
  await sleep(300);
  check(await p.locator('#jeux-tab-aujourdhui').getAttribute('aria-selected') === 'true', 'clavier : Début → Aujourd’hui');
  await p.keyboard.press('ArrowLeft');
  await sleep(500);
  check(await p.locator('#jeux-tab-' + LAST).getAttribute('aria-selected') === 'true', 'clavier : flèche gauche boucle sur le dernier');
  await p.locator('#jeux-tab-citations').click();
  await sleep(600);
  check(await p.locator('#jeux-panel-citations .cit').count() === 1, 'chargement paresseux : module des citations monté');
  check(await p.locator('#jeux-panel-geo').isHidden() && !(await p.locator('#jeux-panel-citations').isHidden()), 'un seul panneau visible');
  check(await p.evaluate(() => { const n = [...document.querySelectorAll('link[data-jeux-css]')].map((l) => l.dataset.jeuxCss); return new Set(n).size === n.length && n.includes('geo') && n.includes('citations'); }), 'CSS des jeux chargées une fois chacune');
  // Ouvrir un jeu depuis le tableau de bord
  await p.locator('#jeux-tab-aujourdhui').click();
  await sleep(300);
  await p.locator('.jeux-row[data-open="jdj"]').click();
  await sleep(600);
  check(await p.locator('#jeux-tab-jdj').getAttribute('aria-selected') === 'true', 'tableau de bord : une ligne ouvre son jeu');
  check(p.errs.length === 0, `aucune erreur JS (téléphone) ${p.errs.join(' | ')}`);
  await p.ctx.close();

  /* ---------- Mémoire : sans adresse, le dernier onglet revient ; lien direct ---------- */
  p = await openPage(browser, { page: 'jeux', fixture: FIX, width: 390, hash: '#citations' });
  await sleep(600);
  check(await p.locator('#jeux-tab-citations').getAttribute('aria-selected') === 'true', 'lien direct jeux.html#citations');
  await p.goto(p.url().split('#')[0]);
  await sleep(1500);
  check(await p.locator('#jeux-tab-citations').getAttribute('aria-selected') === 'true', 'mémoire locale : dernier onglet rouvert');
  await p.evaluate(() => { location.hash = 'jdj'; });
  await sleep(600);
  check(await p.locator('#jeux-tab-jdj').getAttribute('aria-selected') === 'true', 'changement d’adresse (#jdj) suivi');
  check(p.errs.length === 0, `aucune erreur JS (adresse) ${p.errs.join(' | ')}`);
  await p.ctx.close();

  /* ---------- Grand écran : colonne verticale groupée ---------- */
  p = await openPage(browser, { page: 'jeux', fixture: FIX, width: 1280, height: 900 });
  await p.waitForSelector('.jeux-card', { timeout: 6000 }).catch(() => {});
  check(await p.locator('#jeux-tabs').getAttribute('aria-orientation') === 'vertical', 'grand écran : aria-orientation vertical');
  const lay = await p.evaluate(() => { const a = document.querySelector('#jeux-tab-aujourdhui').getBoundingClientRect(), b = document.querySelector('#jeux-tab-geo').getBoundingClientRect(); return { col: b.top > a.top && Math.abs(b.left - a.left) < 2, w: a.width }; });
  check(lay.col && lay.w > 180, 'grand écran : onglets empilés dans une colonne');
  check(await p.locator('.jeux-tabs-grp').first().isVisible() && (await p.locator('.jeux-tabs-grp').first().innerText()).includes('Chaque jour'), 'grand écran : groupe « Chaque jour »');
  check(await p.locator('.jeux-card').count() === 3, 'grand écran : cartes « À jouer »');
  await p.keyboard.press('Tab');
  await p.locator('#jeux-tab-aujourdhui').focus();
  await p.keyboard.press('ArrowDown');
  await sleep(500);
  check(await p.locator('#jeux-tab-geo').getAttribute('aria-selected') === 'true', 'grand écran : flèche bas → onglet suivant');
  check(p.errs.length === 0, `aucune erreur JS (grand écran) ${p.errs.join(' | ')}`);
  await p.ctx.close();

  /* ---------- Échec réseau : les jeux restent utilisables (message, pas de plantage) ---------- */
  p = await openPage(browser, { page: 'jeux', fixture: FIX, width: 390, scenario: { jeuxFail: true } });
  await sleep(1200);
  check((await p.locator('[data-sub="geo"]').innerText()).includes('Indisponible'), 'échec réseau : résumé « Indisponible »');
  check(p.errs.filter((e) => !/Failed to fetch|GeoGuessr/.test(e)).length === 0, `échec réseau : aucune erreur JS ${p.errs.join(' | ')}`);
  await p.ctx.close();

  await browser.close();
  finish();
})();
