// Parcours : secrets cachés (easter eggs).
// Code Konami au clavier (pluie de logos, puis hg_egg_found 'konami'), Konami ignoré dans un champ de saisie,
// logo cliqué sept fois (hg_egg_found 'logo', sans navigation) et clic isolé qui mène toujours à l'accueil,
// mot « humane » (classe arc-en-ciel sur <html>, arrêt en le retapant, hg_egg_found 'humane'),
// heure de Zurich simulée (13 h 37 : message dans le pied de page ; 13 h 20 : rien ; 3 h 30 : la chouette),
// mots tapés hors champ (tzatzikistan, kc, serge, domu : effets, hg_egg_found ; dans un champ : rien ; loupe de recherche),
// carnet des secrets (/pages/jeux/secret.html : nombre trouvé sur 18, cases « ??? » sans nom, console envoyée),
// visiteur sans compte (aucun appel au serveur, effets visuels conservés), mouvement réduit (version calme),
// aucune erreur JS, pas de défilement horizontal à 390 px.
// Faux Supabase : fixtures/fake-sb.mjs (hg_egg_found et hg_eggs_me simulés ; l'appel reste dans window.__LOG).
// Lancer : node tests/parcours/compte/parcours-eggs.cjs   (HG_ROOT / HG_PREFIX comme les autres parcours)
const { check, finish, openPage, hscroll, log, sleep, chromium } = require('../../lib/harness.cjs');

/** Suite du code Konami au clavier (les lettres b et a sont en minuscules). */
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
/** Heure de Zurich simulée : 13 h 37 (CEST, UTC+2), 13 h 20, 3 h 30. */
const ZURICH_1337 = '2026-10-22T11:37:20Z';
const ZURICH_1320 = '2026-10-22T11:20:00Z';
const ZURICH_0330 = '2026-10-22T01:30:00Z';

/** Nombre d'appels hg_egg_found pour un secret donné, relevés dans le journal du faux client. */
const egg = (lg, code) => lg.filter((x) => x[0] === 'rpc' && x[1] === 'hg_egg_found' && x[2]?.p_egg === code).length;
/** Nombre d'appels à une fonction des secrets (hg_egg_found ou hg_eggs_me) dans le journal. */
const appelsSecrets = (lg) => lg.filter((x) => x[0] === 'rpc' && /^hg_egg/.test(x[1])).length;

/** Attend que le module des secrets soit lancé (sa feuille de style est injectée). */
async function attendSecrets(p) {
  await p.waitForSelector('link[data-eggs]', { state: 'attached', timeout: 8000 });
}

/** Tape le code Konami au clavier, touche par touche. */
async function konami(p) {
  for (const k of KONAMI) await p.keyboard.press(k);
}

(async () => {
  const browser = await chromium.launch();

  /* ---------- Code Konami au clavier (membre) : pluie, puis signalement ---------- */
  let p = await openPage(browser, { page: 'accueil', width: 1280 });
  await attendSecrets(p);
  await konami(p);
  await sleep(300);
  check(await p.locator('.egg-pluie img').count() > 0, 'Konami clavier : la pluie de logos commence');
  check(egg(await log(p), 'konami') === 0, 'Konami clavier : rien n\'est envoyé avant la fin de la pluie');
  await sleep(4200);
  check(await p.locator('.egg-pluie').count() === 0, 'Konami clavier : la pluie s\'arrête après environ 4 s');
  check(egg(await log(p), 'konami') === 1, 'Konami clavier : hg_egg_found(konami) envoyé une fois');
  check(p.errs.length === 0, `Konami clavier : aucune erreur JS${p.errs.length ? ' — ' + p.errs.join(' | ') : ''}`);
  await p.ctx.close();

  /* ---------- Konami ignoré quand on tape dans un champ de saisie (recherche de l'aide) ---------- */
  p = await openPage(browser, { page: 'aide', width: 1280 });
  await attendSecrets(p);
  await p.focus('#aide-q');
  for (const k of KONAMI) await p.locator('#aide-q').press(k);
  await p.locator('#aide-q').pressSequentially('humane');
  await sleep(400);
  check(await p.locator('.egg-pluie').count() === 0, 'champ de saisie : le Konami ne déclenche pas la pluie');
  check(await p.evaluate(() => document.documentElement.classList.contains('egg-arc')) === false, 'champ de saisie : « humane » n\'active pas le mode arc-en-ciel');
  check(egg(await log(p), 'konami') === 0 && egg(await log(p), 'humane') === 0, 'champ de saisie : aucun secret envoyé');
  check(await p.inputValue('#aide-q').then((v) => v.includes('humane')), 'champ de saisie : la saisie reste intacte');
  await p.ctx.close();

  /* ---------- Sept clics sur le logo : pirouette, secret « logo », pas de navigation ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280 });
  await attendSecrets(p);
  await p.waitForSelector('a.brand');
  for (let i = 0; i < 7; i++) await p.click('a.brand');
  await sleep(300);
  check(egg(await log(p), 'logo') === 1, 'sept clics sur le logo : hg_egg_found(logo) envoyé une fois');
  check(p.url().endsWith('/pages/compte/accueil.html'), 'sept clics sur le logo : la page ne change pas');
  check(p.errs.length === 0, `sept clics sur le logo : aucune erreur JS${p.errs.length ? ' — ' + p.errs.join(' | ') : ''}`);
  await p.ctx.close();

  /* ---------- Un clic isolé sur le logo mène toujours à l'accueil ---------- */
  p = await openPage(browser, { page: 'aide', width: 1280 });
  await p.waitForSelector('a.brand');
  await p.click('a.brand');
  await sleep(1400);
  check(p.url().endsWith('/pages/compte/accueil.html'), 'un clic isolé sur le logo : mène à l\'accueil');
  await p.ctx.close();

  /* ---------- Mot « humane » : arc-en-ciel, arrêt en le retapant, secret « humane » ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280 });
  await attendSecrets(p);
  await p.keyboard.type('humane');
  await sleep(200);
  check(await p.evaluate(() => document.documentElement.classList.contains('egg-arc')), 'mot « humane » : classe arc-en-ciel sur <html>');
  check(await p.locator('.egg-arc-calque').isVisible(), 'mot « humane » : le voile arc-en-ciel est affiché');
  await p.keyboard.type('humane');
  await sleep(400);
  check(await p.evaluate(() => document.documentElement.classList.contains('egg-arc')) === false, 'mot « humane » retapé : le mode arc-en-ciel s\'arrête');
  check(egg(await log(p), 'humane') === 1, 'mot « humane » : hg_egg_found(humane) envoyé une fois');
  check(p.errs.length === 0, `mot « humane » : aucune erreur JS${p.errs.length ? ' — ' + p.errs.join(' | ') : ''}`);
  await p.ctx.close();

  /* ---------- Mots tapés hors champ : tzatzikistan (drapeau), kc (confettis et texte), serge, domu ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280 });
  await attendSecrets(p);
  await p.keyboard.type('tzatzikistan');
  await sleep(400);
  check(await p.locator('.egg-drapeau').count() === 1, 'mot « tzatzikistan » : le drapeau du Tzatzikistan se déroule');
  check(await p.locator('.egg-legende').innerText().then((t) => t === 'Bienvenue au Tzatzikistan. Population : le gang.'), 'mot « tzatzikistan » : légende exacte');
  check(await p.locator('.egg-drapeau-svg').isVisible(), 'mot « tzatzikistan » : le drapeau SVG est visible');
  check(egg(await log(p), 'tzatziki') === 0, 'mot « tzatzikistan » : rien n\'est envoyé pendant le flottement');
  await sleep(5000);
  check(await p.locator('.egg-drapeau').count() === 0, 'mot « tzatzikistan » : le drapeau s\'arrête après environ 5 s');
  check(egg(await log(p), 'tzatziki') === 1, 'mot « tzatzikistan » : hg_egg_found(tzatziki) envoyé une fois');
  await p.keyboard.type('kc');
  await sleep(300);
  check(await p.locator('.egg-kc-texte').innerText().then((t) => t === 'Le gang pousse derrière son équipe !'), 'mot « kc » : texte « Le gang pousse derrière son équipe ! »');
  check(await p.locator('.egg-confetti.egg-bleu span').count() > 0, 'mot « kc » : confettis bleus et blancs');
  await sleep(3200);
  check(egg(await log(p), 'kc') === 1, 'mot « kc » : hg_egg_found(kc) envoyé une fois, à la fin de l\'effet');
  await p.keyboard.type('k');
  await sleep(1600);
  await p.keyboard.type('c');
  await sleep(300);
  check(await p.locator('.egg-kc-texte').count() === 0, 'mot « kc » : « k » puis, après plus de 1,5 s, « c » ne déclenchent rien');
  await p.keyboard.type('serge');
  await sleep(300);
  check(await p.locator('.egg-serge-carte').count() === 1, 'mot « serge » : la couronne sur la carte de duchés apparaît');
  check(await p.locator('.egg-serge-carte figcaption').innerText().then((t) => t === 'Les règles de la campagne sont non négociables.'), 'mot « serge » : légende exacte');
  await p.keyboard.type('domu');
  await sleep(300);
  check(await p.locator('.egg-voiture').count() === 1, 'mot « domu » : la voiture chargée traverse l\'écran');
  check(p.errs.length === 0, `mots tapés hors champ : aucune erreur JS${p.errs.length ? ' — ' + p.errs.join(' | ') : ''}`);
  await p.ctx.close();

  /* ---------- Mots tapés dans un champ de saisie : rien ; la loupe de recherche lance le mot ---------- */
  p = await openPage(browser, { page: 'aide', width: 1280 });
  await attendSecrets(p);
  await p.locator('#aide-q').pressSequentially('serge kc tzatzikistan');
  await sleep(400);
  check(await p.locator('.egg-serge-carte, .egg-kc-texte, .egg-drapeau').count() === 0, 'mot tapé dans un champ : aucun effet (calque absent)');
  check(egg(await log(p), 'serge') + egg(await log(p), 'kc') + egg(await log(p), 'tzatziki') === 0, 'mot tapé dans un champ : aucun secret envoyé');
  await p.ctx.close();

  p = await openPage(browser, { page: 'accueil', width: 1280 });
  await attendSecrets(p);
  await p.keyboard.press('Control+k');
  await p.waitForSelector('#search-q', { state: 'visible', timeout: 5000 });
  await p.locator('#search-q').pressSequentially('Serge');
  await sleep(400);
  check(await p.locator('.egg-serge-carte').count() === 1, 'loupe : « Serge » tapé (sans casse) lance l\'effet');
  check(await p.locator('dialog[open]').count() === 0, 'loupe : la recherche se ferme quand un mot secret est reconnu');
  await sleep(300);
  check(egg(await log(p), 'serge') === 0, 'loupe : hg_egg_found(serge) pas encore envoyé pendant la couronne');
  await p.ctx.close();

  /* ---------- Heure du gang : 13 h 37 à Zurich, message dans le pied de page ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280, now: ZURICH_1337 });
  await p.waitForSelector('.site-footer .egg-gang', { timeout: 10000 }).catch(() => {});
  check(await p.locator('.site-footer .egg-gang').count() === 1, 'heure du gang (13 h 37 à Zurich) : message dans le pied de page');
  check(await p.locator('.site-footer .egg-gang').innerText().then((t) => t.includes('13 h 37') && t.includes('l\'heure du gang')), 'heure du gang : texte « 13 h 37 · l\'heure du gang »');
  check(egg(await log(p), 'heure_gang') === 1, 'heure du gang : hg_egg_found(heure_gang) envoyé (silencieux)');
  await p.ctx.close();

  /* ---------- Autre heure (13 h 20 à Zurich) : pas de message ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280, now: ZURICH_1320 });
  await sleep(500);
  check(await p.locator('.egg-gang').count() === 0, 'autre heure (13 h 20) : pas de message du gang');
  check(egg(await log(p), 'heure_gang') === 0, 'autre heure : aucun secret « heure du gang » envoyé');
  await p.ctx.close();

  /* ---------- Nuit profonde : 3 h 30 à Zurich, la chouette traverse ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280, now: ZURICH_0330 });
  await p.waitForSelector('.egg-chouette', { timeout: 10000 }).catch(() => {});
  check(await p.locator('.egg-bulle').count() === 1, 'nuit profonde (3 h 30 à Zurich) : la chouette et sa bulle apparaissent');
  check(await p.locator('.egg-bulle').innerText().then((t) => t === 'Toi aussi tu ne dors pas ?'), 'nuit profonde : bulle « Toi aussi tu ne dors pas ? »');
  check(egg(await log(p), 'nuit') === 1, 'nuit profonde : hg_egg_found(nuit) envoyé (silencieux)');
  await p.ctx.close();

  /* ---------- Carnet des secrets (membre) : nombre trouvé, cases « ??? », console ---------- */
  p = await openPage(browser, { page: 'secret', width: 1280 });
  await p.waitForSelector('#secret-trouves .egg-case', { timeout: 8000 }).catch(() => {});
  check(await p.locator('#secret-bilan').innerText().then((t) => t.includes('1 secret trouvé sur 18')), 'carnet : « 1 secret trouvé sur 18 » (total du serveur)');
  check(await p.locator('#secret-bilan').innerText().then((t) => t.includes('Cueillette : 0 saisons sur 4')), 'carnet : ligne « Cueillette : 0 saisons sur 4 »');
  check(await p.locator('#secret-trouves .egg-case').count() === 1, 'carnet : le secret trouvé est listé avec son nom');
  check(await p.locator('#secret-caches .inconnue').count() === 17, 'carnet : dix-sept cases « ??? » pour les secrets restants');
  check(await p.locator('#secret-trouves').innerText().then((t) => t.includes('Le code des anciens')), 'carnet : le nom poétique du Konami est affiché');
  check(egg(await log(p), 'console') === 1, 'carnet : ouvrir la page envoie hg_egg_found(console)');
  check(p.errs.length === 0, `carnet : aucune erreur JS${p.errs.length ? ' — ' + p.errs.join(' | ') : ''}`);
  await p.ctx.close();

  /* ---------- Visiteur sans compte : aucun appel au serveur, effets visuels gardés ---------- */
  p = await openPage(browser, { page: 'aide', width: 1280, scenario: { guest: true } });
  await attendSecrets(p);
  await konami(p);
  await sleep(300);
  check(await p.locator('.egg-pluie img').count() > 0, 'visiteur : la pluie de logos fonctionne sans compte');
  await sleep(4200);
  check(appelsSecrets(await log(p)) === 0, 'visiteur : aucun appel hg_egg_* au serveur');
  await p.ctx.close();

  p = await openPage(browser, { page: 'secret', width: 1280, scenario: { guest: true } });
  await sleep(500);
  check(await p.locator('#secret-bilan').innerText().then((t) => t.includes('Connecte-toi pour garder la trace de tes trouvailles')), 'visiteur : la page secrète invite à se connecter');
  check(appelsSecrets(await log(p)) === 0, 'visiteur : la page secrète n\'appelle pas le serveur');
  check(await p.locator('#secret-liste-section').isHidden(), 'visiteur : aucun carnet affiché');
  await p.ctx.close();

  /* ---------- Mouvement réduit : version calme, sans animation ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280, reducedMotion: 'reduce' });
  await attendSecrets(p);
  await konami(p);
  await sleep(300);
  check(await p.locator('.egg-pluie').count() === 0, 'mouvement réduit : pas de pluie de logos');
  check(await p.locator('.egg-calme img').count() === 1, 'mouvement réduit : un logo fixe (version calme)');
  await sleep(2800);
  check(egg(await log(p), 'konami') === 1, 'mouvement réduit : le Konami est tout de même signalé');
  await p.ctx.close();

  /* ---------- Mots tapés en mouvement réduit : drapeau immobile, couronne et voiture en version calme ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280, reducedMotion: 'reduce' });
  await attendSecrets(p);
  await p.keyboard.type('tzatzikistan');
  await sleep(300);
  check(await p.locator('.egg-drapeau.egg-drapeau-calme').count() === 1, 'mouvement réduit, « tzatzikistan » : drapeau immobile (version calme)');
  check(await p.locator('.egg-drapeau-tissu').evaluate((el) => getComputedStyle(el).animationName === 'none'), 'mouvement réduit, « tzatzikistan » : aucune animation sur le drapeau');
  await p.keyboard.type('domu');
  await sleep(300);
  check(await p.locator('.egg-voiture.egg-voiture-calme').count() === 1, 'mouvement réduit, « domu » : voiture fixe dans l\'angle');
  await p.ctx.close();

  /* ---------- Pas de défilement horizontal à 390 px ---------- */
  p = await openPage(browser, { page: 'secret', width: 390 });
  await attendSecrets(p);
  await konami(p);
  await sleep(300);
  check(await hscroll(p) <= 0, '/pages/jeux/secret.html 390 px : pas de défilement horizontal (pluie comprise)');
  await p.ctx.close();

  p = await openPage(browser, { page: 'accueil', width: 390 });
  await attendSecrets(p);
  await p.keyboard.type('tzatzikistan');
  await sleep(300);
  check(await hscroll(p) <= 0, 'accueil 390 px, drapeau du Tzatzikistan : pas de défilement horizontal');
  await p.keyboard.type('serge');
  await sleep(300);
  check(await hscroll(p) <= 0, 'accueil 390 px, couronne de Serge : pas de défilement horizontal');
  await p.keyboard.type('domu');
  await sleep(300);
  check(await hscroll(p) <= 0, 'accueil 390 px, voiture domu : pas de défilement horizontal');
  await p.ctx.close();

  p = await openPage(browser, { page: 'accueil', width: 390, now: ZURICH_1337 });
  await p.waitForSelector('.site-footer .egg-gang', { timeout: 10000 }).catch(() => {});
  check(await hscroll(p) <= 0, 'accueil 390 px avec les secrets actifs : pas de défilement horizontal');
  await p.ctx.close();

  await browser.close();
  finish();
})();
