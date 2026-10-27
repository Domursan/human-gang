// Parcours : page « Jeux » (/pages/jeux/jeux.html), faux Supabase fixtures/fake-sb-jeux.mjs.
// Sans adresse, la page s'ouvre sur « Tous les jeux » (vue de départ en cartes) ; « Les missions du jour » (#aujourdhui) est
// le tableau de bord ; motif ARIA des onglets (un seul tabindex 0, flèches, Début/Fin) ; adresse /pages/jeux/jeux.html#<id> ;
// lien direct vers la page depuis le menu « Jeux » ; import paresseux des modules ; 360 px sans défilement horizontal de la
// page (la barre d'onglets défile seule) ; grand écran : colonne d'onglets verticale et groupée ; aucune erreur JS.
// Lancer : node tests/parcours/jeux/parcours-jeux.cjs
const { ROOT, check, finish, openPage, hscroll, log, sleep, chromium } = require('../../lib/harness.cjs');
const FIX = 'fake-sb-jeux.mjs';
// Les onglets viennent de la liste commune (les paquets en ajoutent) : le test ne suppose plus 3 jeux.
const IDS = [...require('fs').readFileSync(require('path').join(ROOT, 'assets/espaces/jeux/onglets.js'), 'utf8').matchAll(/\{ id: '([a-z0-9-]+)'/g)].map((m) => m[1]);
// Les onglets sont groupés (Chaque jour, Chaque semaine, Compétition) : le dernier onglet est le dernier de la dernière
// rubrique non vide, pas le dernier de la liste.
const RYTHMES = [...require('fs').readFileSync(require('path').join(ROOT, 'assets/espaces/jeux/onglets.js'), 'utf8').matchAll(/\{ id: '([a-z0-9-]+)'[^\n]*?rythme: '(jour|semaine|competition)'/g)].map((m) => [m[1], m[2]]);
const LAST = ['competition', 'semaine'].map((r) => RYTHMES.filter((x) => x[1] === r).map((x) => x[0]).pop()).find(Boolean) || IDS[IDS.length - 1];
// La colonne d'onglets est masquée à toutes les largeurs (navigation par l'adresse et par le menu « Jeux ») :
// les touches du clavier sont envoyées à l'onglet, comme le ferait le clavier, et les cibles visibles sont mesurées.
const touche = (pg, id, key) => pg.evaluate(([i, k]) => document.getElementById(i).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })), [id, key]);
// Le lien « Jeux » du menu mène à la page (lien direct, sans sous-menu).
const LIEN_MENU = '.site-header a.nav-top[href="/pages/jeux/jeux.html"]';
// Le harnais répond vide aux CDN : l’empreinte (SRI) de Leaflet, chargé par le module GeoGuessr, échoue. Ce n’est pas une erreur du site.
const erreurs = (p) => p.errs.filter((e) => !/integrity|leaflet@/i.test(e));

(async () => {
  const browser = await chromium.launch();

  /* ---------- Téléphone : vue de départ (tous les jeux), puis tableau de bord ---------- */
  let p = await openPage(browser, { page: 'jeux', fixture: FIX, width: 360, height: 800 });
  await p.waitForSelector('#jeux-panel-tous .jx-carte', { timeout: 6000 }).catch(() => {});
  const tabs = p.locator('[role="tab"]');
  check(await tabs.count() === IDS.length + 2, `onglets : Tous les jeux, Aujourd’hui + ${IDS.length} jeux`);
  check(await p.locator('#jeux-tab-tous').getAttribute('aria-selected') === 'true', 'défaut : onglet « Tous les jeux » sélectionné (sans adresse)');
  check(await p.evaluate(() => location.hash) === '', 'défaut : aucune adresse ajoutée');
  check(await p.locator('#jeux-panel-tous .jx-carte').count() > 0, 'vue de départ : cartes des jeux');
  // Jeux quotidiens (une partie par jour) avant les jeux flash (à volonté) ; un filtre par section
  const sec = (s) => p.locator(`#jeux-panel-tous .jx-section[data-s="${s}"]`);
  check((await p.locator('#jeux-panel-tous .jx-h').allInnerTexts()).slice(0, 2).join(' / ') === 'Jeux quotidiens / Jeux flash', 'sections : « Jeux quotidiens » puis « Jeux flash »');
  check((await p.locator('#jeux-panel-tous .jx-filtre').allInnerTexts()).slice(0, 3).join(',') === 'Tous,Quotidiens,Flash', 'filtres : Tous, Quotidiens, Flash');
  // Chaque jeu à onglet « Chaque jour » (onglets.js) a sa carte dans « Jeux quotidiens », sauf l’Arcade (à volonté)
  const manquants = [];
  for (const id of RYTHMES.filter(([i, r]) => r === 'jour' && i !== 'arcade').map((x) => x[0])) {
    if (!(await sec('quotidien').locator(`a[href="#${id}"]`).count())) manquants.push(id);
  }
  check(manquants.length === 0, `quotidiens : chaque jeu « Chaque jour » a sa carte ${manquants.length ? '(manque : ' + manquants.join(', ') + ')' : ''}`);
  const titresQ = await sec('quotidien').locator('.jx-t').allInnerTexts();
  const titresF = await sec('flash').locator('.jx-t').allInnerTexts();
  // (Code du jour dépend de la page duels, fermée à ce membre dans le faux Supabase : pas attendu ici)
  check(['Sutom HG', 'Carte mystère', 'Sudoku du jour'].every((t) => titresQ.includes(t)), 'quotidiens : Sutom HG, Carte mystère, Sudoku du jour');
  check(['Paillettes', 'Raclette', 'Démineur', 'Domu-mobile'].every((t) => titresF.includes(t)), 'flash : Paillettes, Raclette, Démineur, Domu-mobile');
  check(!titresQ.some((t) => ['Paillettes', 'Raclette', 'Démineur', 'Domu-mobile', '2048 Paillettes'].includes(t)), 'quotidiens : aucun jeu à volonté');
  await p.click('.jx-filtre[data-f="quotidien"]'); await sleep(150);
  check(await sec('quotidien').isVisible() && await sec('flash').isHidden(), 'filtre « Quotidiens » : seulement les jeux quotidiens');
  await p.click('.jx-filtre[data-f="flash"]'); await sleep(150);
  check(await sec('flash').isVisible() && await sec('quotidien').isHidden(), 'filtre « Flash » : seulement les jeux flash');
  await p.click('.jx-filtre[data-f=""]'); await sleep(150);
  check(await sec('quotidien').isVisible() && await sec('flash').isVisible(), 'filtre « Tous » : les deux sections');
  await p.fill('#jx-q', 'démineur'); await sleep(150);
  check(await sec('flash').isVisible() && await sec('quotidien').isHidden(), 'recherche « démineur » : dans « Jeux flash » seulement');
  await p.fill('#jx-q', ''); await sleep(150);
  check(await sec('quotidien').isVisible() && await sec('flash').isVisible(), 'recherche vidée : les deux sections');
  check(await p.locator('[role="tab"][tabindex="0"]').count() === 1, 'ARIA : un seul onglet dans l’ordre de tabulation');
  check(await p.locator('#jeux-tabs').getAttribute('aria-orientation') === 'horizontal', 'ARIA : barre horizontale sur téléphone');
  check(await p.locator('#jeux-panel-tous').getAttribute('aria-labelledby') === 'jeux-tab-tous', 'ARIA : panneau relié à son onglet');
  check(await hscroll(p) <= 0, '360 px : pas de défilement horizontal de la page');
  check(await p.locator('.jeux-tabs-wrap').isHidden(), 'barre d’onglets masquée (navigation par le menu et l’adresse)');
  check(await p.locator(LIEN_MENU).count() === 1, 'menu : lien « Jeux » vers la page des jeux');
  // Tableau de bord « Les missions du jour » (par l’adresse)
  await p.evaluate(() => { location.hash = 'aujourdhui'; });
  await p.waitForSelector('#jeux-panel-aujourdhui .jeux-row', { timeout: 6000 }).catch(() => {});
  await p.waitForFunction(() => !document.querySelector('[data-sub="geo"]')?.textContent.includes('…'), null, { timeout: 6000 }).catch(() => {});
  check(await p.locator('#jeux-tab-aujourdhui').getAttribute('aria-selected') === 'true', 'tableau de bord : onglet « Aujourd’hui » par l’adresse');
  check(await p.locator('#jeux-panel-aujourdhui').getAttribute('aria-labelledby') === 'jeux-tab-aujourdhui', 'ARIA : panneau relié à son onglet (tableau de bord)');
  check(await p.locator('.jeux-row').count() === IDS.length, 'tableau de bord : une ligne par jeu');
  check((await p.locator('[data-sub="geo"]').innerText()).includes('Manche n°18'), 'tableau de bord : résumé GeoGuessr');
  check((await p.locator('[data-badge="geo"]').innerText()).includes('À jouer'), 'tableau de bord : GeoGuessr à jouer');
  check((await p.locator('[data-badge="citations"]').innerText()).includes('À jouer'), 'tableau de bord : citations à jouer');
  // Quatre jeux ont un état pour cet admin (GeoGuessr, citations, Sudoku, 2048) : aucun fait
  check((await p.locator('#jeux-prog-txt').innerText()).includes('0 jeu sur 4'), 'programme : 0 jeu sur 4 faits');
  check(!(await p.locator('#jeux-bal').isHidden()) && (await p.locator('#jeux-bal-v').innerText()).includes('+0'), 'en-tête : Paillettes du jour affichées');
  const minH = await p.evaluate(() => Math.min(...[...document.querySelectorAll('[role="tab"], .jeux-row')].filter((b) => b.getClientRects().length > 0).map((b) => b.getBoundingClientRect().height)));
  check(minH >= 44, `cibles visibles ≥ 44 px (min ${Math.round(minH)})`);
  check(!(await log(p)).some((l) => l[0] === 'rpc' && l[1] === 'hg_daily_submit'), 'aucun envoi au chargement');

  /* ---------- Clavier : flèches, Fin, Début ; adresse ---------- */
  await touche(p, 'jeux-tab-aujourdhui', 'ArrowRight');
  await sleep(500);
  check(await p.locator('#jeux-tab-geo').getAttribute('aria-selected') === 'true', 'clavier : flèche droite → GeoGuessr');
  check(await p.locator('#jeux-tab-geo').getAttribute('tabindex') === '0' && await p.locator('#jeux-tab-aujourdhui').getAttribute('tabindex') === '-1', 'clavier : tabulation roulante (onglet actif seul dans l’ordre)');
  check(await p.evaluate(() => location.hash) === '#geo', 'adresse : #geo');
  await touche(p, 'jeux-tab-geo', 'End');
  await sleep(500);
  check(await p.locator('#jeux-tab-' + LAST).getAttribute('aria-selected') === 'true', 'clavier : Fin → dernier onglet');
  await touche(p, 'jeux-tab-' + LAST, 'Home');
  await sleep(300);
  check(await p.locator('#jeux-tab-tous').getAttribute('aria-selected') === 'true', 'clavier : Début → Tous les jeux');
  await touche(p, 'jeux-tab-tous', 'ArrowLeft');
  await sleep(500);
  check(await p.locator('#jeux-tab-' + LAST).getAttribute('aria-selected') === 'true', 'clavier : flèche gauche boucle sur le dernier');
  await p.evaluate(() => { location.hash = 'citations'; });
  await sleep(600);
  check(await p.locator('#jeux-panel-citations .cit').count() === 1, 'chargement paresseux : module des citations monté');
  check(await p.locator('#jeux-panel-geo').isHidden() && !(await p.locator('#jeux-panel-citations').isHidden()), 'un seul panneau visible');
  check(await p.evaluate(() => { const n = [...document.querySelectorAll('link[data-jeux-css]')].map((l) => l.dataset.jeuxCss); return new Set(n).size === n.length && n.includes('geo') && n.includes('citations'); }), 'CSS des jeux chargées une fois chacune');
  // Ouvrir un jeu depuis le tableau de bord
  await p.evaluate(() => { location.hash = 'aujourdhui'; });
  await sleep(300);
  await p.locator('.jeux-row[data-open="geo"]').click();
  await sleep(600);
  check(await p.locator('#jeux-tab-geo').getAttribute('aria-selected') === 'true', 'tableau de bord : une ligne ouvre son jeu');
  check(erreurs(p).length === 0, `aucune erreur JS (téléphone) ${erreurs(p).join(' | ')}`);
  await p.ctx.close();

  /* ---------- Adresse : lien direct ; sans adresse, la vue de départ (le dernier jeu n'est plus rouvert) ---------- */
  p = await openPage(browser, { page: 'jeux', fixture: FIX, width: 390, hash: '#citations' });
  await sleep(600);
  check(await p.locator('#jeux-tab-citations').getAttribute('aria-selected') === 'true', 'lien direct /pages/jeux/jeux.html#citations');
  await p.goto(p.url().split('#')[0]);
  await sleep(1500);
  check(await p.locator('#jeux-tab-tous').getAttribute('aria-selected') === 'true', 'sans adresse : « Tous les jeux » (pas le dernier jeu ouvert)');
  await p.evaluate(() => { location.hash = 'geo'; });
  await sleep(600);
  check(await p.locator('#jeux-tab-geo').getAttribute('aria-selected') === 'true', 'changement d’adresse (#geo) suivi');
  check(erreurs(p).length === 0, `aucune erreur JS (adresse) ${erreurs(p).join(' | ')}`);
  await p.ctx.close();

  /* ---------- Grand écran : colonne verticale groupée (tableau de bord) ---------- */
  p = await openPage(browser, { page: 'jeux', fixture: FIX, width: 1280, height: 900, hash: '#aujourdhui' });
  await p.waitForSelector('.jeux-card', { timeout: 6000 }).catch(() => {});
  check(await p.locator('#jeux-tabs').getAttribute('aria-orientation') === 'vertical', 'grand écran : aria-orientation vertical');
  check(await p.locator('.jeux-tabs-wrap').isHidden(), 'grand écran : colonne d’onglets masquée (navigation par le menu)');
  check((await p.locator('.jeux-tabs-grp').first().textContent()).includes('Chaque jour'), 'grand écran : groupe « Chaque jour » dans la liste');
  // Trois cartes « À jouer » au plus (jeux.js)
  check(await p.locator('.jeux-card').count() === 3, 'grand écran : trois cartes « À jouer » (au plus)');
  await touche(p, 'jeux-tab-aujourdhui', 'ArrowDown');
  await sleep(500);
  check(await p.locator('#jeux-tab-geo').getAttribute('aria-selected') === 'true', 'grand écran : flèche bas → onglet suivant');
  check(erreurs(p).length === 0, `aucune erreur JS (grand écran) ${erreurs(p).join(' | ')}`);
  await p.ctx.close();

  /* ---------- Échec réseau : le tableau de bord reste utilisable (message, pas de plantage) ---------- */
  p = await openPage(browser, { page: 'jeux', fixture: FIX, width: 390, hash: '#aujourdhui', scenario: { jeuxFail: true } });
  await sleep(1200);
  check((await p.locator('[data-sub="geo"]').innerText()).includes('Indisponible'), 'échec réseau : résumé « Indisponible »');
  check(p.errs.filter((e) => !/Failed to fetch|GeoGuessr/.test(e)).length === 0, `échec réseau : aucune erreur JS ${p.errs.join(' | ')}`);
  await p.ctx.close();

  await browser.close();
  finish();
})();
