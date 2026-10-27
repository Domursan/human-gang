// Parcours Pictionary (moteur des plateaux, migration 145) : choix du mot et tracé (dessinateur), trait envoyé sur le canal,
// annuler / tout effacer / enregistrement du dessin ; devineur : indice, « presque » (ligne privée), proposition, trouvé ;
// traits reçus en direct, mot du tour précédent, classement de fin ; 390 px et 360 px sans défilement horizontal ;
// aucune erreur JS. Faux Supabase : fixtures/fake-sb-pictionary.mjs (RPC hg_plat_* et canal « pict: » simulé).
const { check, finish, openPage, hscroll, log, sleep, chromium } = require('../../lib/harness.cjs');

const FIX = 'fake-sb-pictionary.mjs';
const HASH = '#partie/HGPIC-1234';

/** Dernier appel d'une fonction RPC journalisé par le faux client. */
const dernierRpc = async (p, fn) => (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === fn).pop();
/** Messages envoyés sur le canal, pour un événement donné (trait, annuler, effacer). */
const envois = async (p, evenement) => (await log(p)).filter((e) => e[0] === 'canal' && e[2]?.event === evenement);
/** Nombre de pixels d'encre sur la toile (tout ce qui n'est pas le papier). */
const encre = (p) => p.evaluate(() => {
  const c = document.querySelector('.pi-toile');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200) n++;
  return n;
});
/** Trace un trait à la souris sur la toile (quelques points). */
async function tracer(p) {
  const box = await p.locator('.pi-toile').boundingBox();
  const x0 = box.x + box.width * 0.15, y0 = box.y + box.height * 0.25;
  await p.mouse.move(x0, y0);
  await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(x0 + i * box.width * 0.08, y0 + Math.sin(i) * box.height * 0.1);
  await p.mouse.up();
  await sleep(200);
}

(async () => {
  const browser = await chromium.launch();

  // ----- Dessinateur, ordinateur : choix du mot, tracé, annuler, tout effacer, enregistrement -----
  let p = await openPage(browser, { page: 'pictionary', fixture: FIX, scenario: { dessinateur: 'moi' }, hash: HASH, width: 1280, height: 900 });
  await p.waitForSelector('.pi-mot-choix', { timeout: 6000 }).catch(() => {});
  check((await p.locator('.pi-mot-choix').count()) === 3, 'choix : trois mots proposés au dessinateur');
  check((await p.locator('.pi-mot-choix').first().innerText()) === 'raclette', 'choix : premier mot « raclette »');
  check(await p.locator('[data-zone="choix"]').isVisible(), 'choix : zone de choix visible pour le dessinateur');
  check((await p.locator('.pi-bandeau-titre').innerText()) === 'Soirée dessin', 'bandeau : nom de la partie');
  check((await p.locator('.pi-bandeau-jeu').innerText()).includes('Manche 1 sur 2'), 'bandeau : « Manche 1 sur 2 »');
  check((await p.locator('.pi-score').count()) === 4, 'scores : quatre joueurs');
  check((await p.locator('.pi-score').first().innerText()).includes('Alice'), 'scores : Alice en tête (22 points)');
  check((await p.locator('.pi-fil-ligne').count()) === 5, 'propositions : le journal (cinq lignes) est affiché');
  check(await p.locator('[data-revele]').isHidden(), 'mot précédent : rien à montrer au premier tour');

  await p.click('[data-mot="1"]');
  await sleep(500);
  let r = await dernierRpc(p, 'hg_plat_agir');
  check(r && r[2].p_action === 'choisir' && r[2].p_args.mot === 'montagne' && r[2].p_code === 'HGPIC-1234', 'choisir : hg_plat_agir(choisir, { mot : montagne }) sur HGPIC-1234');
  await p.waitForSelector('.pi-mot-grand', { state: 'visible', timeout: 4000 }).catch(() => {});
  check((await p.locator('.pi-mot-grand').innerText()) === 'montagne', 'dessin : « montagne » affiché en grand pour le dessinateur');
  check(await p.locator('[data-outils]').isVisible(), 'dessin : outils visibles pour le dessinateur');
  check((await p.locator('.pi-indice-zone').isHidden()), 'dessin : pas d\'indice pour celui qui dessine');

  // Palette, épaisseur, gomme : état des boutons (aria-pressed)
  await p.click('[data-couleur="1"]');
  check((await p.locator('[data-couleur="1"]').getAttribute('aria-pressed')) === 'true' && (await p.locator('[data-couleur="0"]').getAttribute('aria-pressed')) === 'false', 'palette : la couleur choisie est marquée (aria-pressed)');
  await p.click('[data-couleur="0"]');
  await p.click('[data-epaisseur="2"]');
  check((await p.locator('[data-epaisseur="2"]').getAttribute('aria-pressed')) === 'true', 'épaisseur : « Épais » marqué');
  await p.click('[data-epaisseur="1"]');
  await p.click('[data-gomme]');
  check((await p.locator('[data-gomme]').getAttribute('aria-pressed')) === 'true', 'gomme : bouton marqué');
  await p.click('[data-gomme]');

  await tracer(p);
  let t = await envois(p, 'trait');
  check(t.length >= 1, 'trait : un paquet part sur le canal (événement trait)');
  const premier = t[0] && t[0][2].payload;
  check(premier && premier.n === 1 && premier.k === 0 && t.reduce((n, e) => n + e[2].payload.p.length, 0) >= 2 && premier.c === '#1B1A1F' && premier.e === 0.01, 'trait : numéro de tour 1, points à partir de 0, couleur Noir, épaisseur Moyen');
  check(premier && premier.p.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1), 'trait : points normalisés entre 0 et 1');
  check((await encre(p)) > 50, 'toile : le trait est dessiné sur le canevas');

  await p.click('[data-annuler]');
  await sleep(300);
  check((await envois(p, 'annuler')).length === 1, 'annuler : le retrait part sur le canal');
  check((await encre(p)) === 0, 'annuler : la toile est revenue au papier vide');
  await sleep(200);
  r = await dernierRpc(p, 'hg_plat_agir');
  check(r && r[2].p_action === 'dessin' && Array.isArray(r[2].p_args.traits) && r[2].p_args.traits.length === 0, 'annuler : le dessin vide est enregistré aussitôt (action dessin)');

  await tracer(p);
  await p.click('[data-effacer]');
  await sleep(300);
  check((await envois(p, 'effacer')).length === 1, 'tout effacer : le message part sur le canal');
  check((await encre(p)) === 0, 'tout effacer : toile vide');
  await sleep(200);
  r = await dernierRpc(p, 'hg_plat_agir');
  check(r && r[2].p_action === 'dessin' && r[2].p_args.traits.length === 0, 'tout effacer : enregistré aussitôt');

  await tracer(p);
  await sleep(5600);
  r = await dernierRpc(p, 'hg_plat_agir');
  check(r && r[2].p_action === 'dessin' && r[2].p_args.traits.length >= 1, 'enregistrement : le dessin complet est enregistré toutes les 5 s');
  check((await hscroll(p)) <= 0, '1280 px : pas de défilement horizontal');
  await p.screenshot({ path: __dirname + '/shots/pictionary-dessin-1280.png', fullPage: true });
  check(p.errs.length === 0, '1280 px (dessinateur) : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // ----- Téléphone 390 px : choix (boutons de 44 px et plus), puis dessin en pleine largeur -----
  p = await openPage(browser, { page: 'pictionary', fixture: FIX, scenario: { dessinateur: 'moi' }, hash: HASH, width: 390, height: 844, mobile: true, dpr: 2 });
  await p.waitForSelector('.pi-mot-choix', { timeout: 6000 }).catch(() => {});
  check((await p.locator('.pi-mot-choix').first().boundingBox()).height >= 44, '390 px : boutons de mot à 44 px au moins');
  check((await p.locator('.pi-tiroir-chat').evaluate((el) => getComputedStyle(el).display)) === 'block', '390 px : chat en tiroir');
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal (choix)');
  await p.screenshot({ path: __dirname + '/shots/pictionary-choix-390.png', fullPage: true });
  await p.click('[data-mot="0"]');
  await p.waitForSelector('.pi-toile', { state: 'visible', timeout: 4000 }).catch(() => {});
  await p.waitForFunction(() => document.querySelector('.pi-mot-grand')?.textContent === 'raclette', null, { timeout: 4000 }).catch(() => {});
  check((await p.locator('.pi-toile').boundingBox()).width <= 390 - 2 * 14 + 1, '390 px : toile dans la largeur de l\'écran');
  check((await p.locator('[data-palette] [data-couleur]').first().boundingBox()).height >= 44, '390 px : pastilles de couleur à 44 px');
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal (dessin)');
  await p.screenshot({ path: __dirname + '/shots/pictionary-dessin-390.png', fullPage: true });
  check(p.errs.length === 0, '390 px (dessinateur) : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // ----- Devineur, ordinateur : indice, « presque », proposition, trouvé, traits reçus en direct -----
  p = await openPage(browser, { page: 'pictionary', fixture: FIX, scenario: { dessinateur: 'alice' }, hash: HASH, width: 1280, height: 900, });
  await p.waitForSelector('.pi-case', { timeout: 6000 }).catch(() => {});
  check((await p.locator('.pi-case').count()) === 8, 'indice : huit cases pour « montagne »');
  check((await p.locator('.pi-case.is-vide').count()) === 8, 'indice : aucune lettre dévoilée au départ');
  check(await p.locator('.pi-mot-dessin').isHidden(), 'mot caché : le devineur ne voit pas le mot');
  check((await p.locator('.pi-dessinateur').innerText()) === 'Alice dessine.', 'dessinateur : « Alice dessine. »');
  check(await p.locator('[data-devine]').isVisible(), 'proposition : champ « Ta proposition » visible');
  check(await p.locator('[data-outils]').isHidden(), 'outils : cachés pour un devineur');
  check((await p.locator('[data-toile]').getAttribute('aria-label')) === 'Dessin en cours, lecture seule', 'toile : lecture seule pour le devineur');
  check((await p.locator('.pi-fil-ligne').count()) === 5, 'propositions : le journal est affiché');

  // Traits reçus en direct (paquets du dessinateur) : la toile se remplit ; un ancien tour est ignoré ; annuler retire
  await p.evaluate(() => window.__CANAUX.emettre('trait', { n: 1, s: 'a1', c: '#B70127', e: 0.02, k: 0, p: [[0.1, 0.1], [0.9, 0.9], [0.5, 0.1]] }));
  await sleep(200);
  const avec = await encre(p);
  check(avec > 50, 'direct : un trait reçu s\'affiche sur la toile du devineur');
  await p.evaluate(() => window.__CANAUX.emettre('trait', { n: 0, s: 'vieux', c: '#B70127', e: 0.02, k: 0, p: [[0.1, 0.5], [0.9, 0.5]] }));
  await sleep(150);
  check((await encre(p)) === avec, 'direct : un message d\'un tour précédent est ignoré');
  await p.evaluate(() => window.__CANAUX.emettre('annuler', { n: 1, s: 'a1' }));
  await sleep(200);
  check((await encre(p)) === 0, 'direct : annuler retire le trait sur la toile du devineur');

  // Proposition « presque » : ligne privée ; proposition fausse : ligne publique
  await p.fill('[data-proposition]', 'montagn');
  await p.press('[data-proposition]', 'Enter');
  await sleep(500);
  r = await dernierRpc(p, 'hg_plat_agir');
  check(r && r[2].p_action === 'deviner' && r[2].p_args.texte === 'montagn' && r[2].p_code === 'HGPIC-1234', 'deviner : hg_plat_agir(deviner, { texte : montagn }) par Entrée');
  await p.waitForSelector('.pi-fil-ligne.is-prive', { timeout: 4000 }).catch(() => {});
  check((await p.locator('.pi-fil-ligne.is-prive').count()) === 1 && (await p.locator('.pi-fil-ligne.is-prive').innerText()).includes('presque'), 'presque : la ligne « presque ! » est privée (pour toi)');
  check((await p.locator('[data-proposition]').inputValue()) === '', 'champ : vidé après la proposition');

  await p.fill('[data-proposition]', 'chat');
  await p.press('[data-proposition]', 'Enter');
  await p.waitForSelector('.pi-fil-ligne.is-propose', { timeout: 4000 }).catch(() => {});
  check((await p.locator('.pi-fil-ligne.is-propose').first().innerText()).includes('Ethan : chat'), 'proposition fausse : « Ethan : chat » dans le fil');

  check((await p.locator('.pi-bravo').isHidden()), 'trouvé : pas de « Bravo » tant que le mot n\'est pas trouvé');
  await p.fill('[data-proposition]', 'Montagne');
  await p.press('[data-proposition]', 'Enter');
  await p.waitForFunction(() => document.querySelector('.pi-bravo') && !document.querySelector('.pi-bravo').hidden, null, { timeout: 4000 }).catch(() => {});
  check((await p.locator('.pi-bravo').innerText()) === 'Bravo, tu as trouvé : montagne', 'trouvé : « Bravo, tu as trouvé : montagne »');
  check(await p.locator('[data-proposition]').isDisabled(), 'trouvé : le champ se désactive');
  check((await p.locator('.pi-coche').count()) >= 1, 'scores : coche sur mon nom');
  check((await p.locator('.pi-case').count()) === 8, 'indice : toujours huit cases');
  check((await hscroll(p)) <= 0, '1280 px (devineur) : pas de défilement horizontal');
  await p.screenshot({ path: __dirname + '/shots/pictionary-devineur-1280.png', fullPage: true });
  check(p.errs.length === 0, '1280 px (devineur) : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // ----- 360 px : devineur, sans défilement horizontal -----
  p = await openPage(browser, { page: 'pictionary', fixture: FIX, scenario: { dessinateur: 'alice' }, hash: HASH, width: 360, height: 780 });
  await p.waitForSelector('.pi-case', { timeout: 6000 }).catch(() => {});
  check((await hscroll(p)) <= 0, '360 px : pas de défilement horizontal (devineur)');
  check(p.errs.length === 0, '360 px : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // ----- Mot du tour précédent : affiché au début du tour, puis masqué -----
  p = await openPage(browser, { page: 'pictionary', fixture: FIX, scenario: { dessinateur: 'alice', phase: 'choix', precedent: true }, hash: HASH, width: 1280, height: 900 });
  await p.waitForSelector('.pi-revele:not([hidden])', { timeout: 6000 }).catch(() => {});
  check((await p.locator('.pi-revele').isVisible()), 'mot précédent : affiché au début du tour');
  check((await p.locator('.pi-revele').innerText()).includes('Le mot était : chat'), 'mot précédent : « Le mot était : chat »');
  check((await p.locator('.pi-attente').innerText()).includes('Alice choisit'), 'attente : « Alice choisit le mot à dessiner… »');
  await sleep(6800);
  check(await p.locator('.pi-revele').isHidden(), 'mot précédent : masqué après quelques secondes');
  check(p.errs.length === 0, 'mot précédent : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // ----- Partie terminée : classement aux points -----
  p = await openPage(browser, { page: 'pictionary', fixture: FIX, scenario: { dessinateur: 'alice', fin: true }, hash: HASH, width: 1280, height: 900 });
  await p.waitForSelector('.pi-fin-ligne', { timeout: 6000 }).catch(() => {});
  check((await p.locator('.pi-fin-ligne').count()) === 4, 'fin : un classement aux points, quatre lignes');
  check((await p.locator('.pi-fin-ligne').first().innerText()).includes('Alice') && (await p.locator('.pi-fin-ligne').first().innerText()).includes('22 pts'), 'fin : Alice en tête avec 22 points');
  check(p.errs.length === 0, 'fin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
