// Parcours des tables à cases des duels : Échecs (coup à la souris et au clavier, glisser-déposer, promotion, roi en
// échec, plateau retourné) et Dames (prise obligatoire, rafle double pas à pas, annulation, plateau retourné), puis
// 360 et 390 px sans défilement horizontal. Banc : tests/bancs/duels/ui/banc-plateaux.html ; faux Supabase :
// tests/fixtures/fake-sb-duels-plateaux.mjs (les coups envoyés sont dans window.__DUELS.appels).
// Captures dans tests/shots/s4-*.png. Lancer : node tests/bancs/duels/ui/s4_echecs_dames.js
const path = require('path');
const fs = require('fs');
const { openPage, check, finish, hscroll, SHOTS, chromium } = require('../../../lib/harness.cjs');

const FIXTURE = 'fake-sb-duels-plateaux.mjs';
const BANC = 'tests/bancs/duels/ui/banc-plateaux';
const ME = '11111111-1111-4111-8111-111111111111';
const ALICE = '00000002-0000-4000-8000-000000000002';
const COLONNES = 'abcdefgh';
const DEBUT = 'rnbqkbnrpppppppp' + '.'.repeat(32) + 'PPPPPPPPRNBQKBNR';

/* ---------- Fabrique d'états (forme renvoyée par hg_duel_etat) ---------- */
/** Index d'une case d'échecs (a8 = 0, h1 = 63) à partir de son nom (« e2 »). */
const idx = (nom) => (8 - Number(nom[1])) * 8 + COLONNES.indexOf(nom[0]);
/** Grille d'échecs à partir de { case: pièce }. */
function echiquier(pos) {
  const g = Array(64).fill('.');
  for (const [nom, ch] of Object.entries(pos)) g[idx(nom)] = ch;
  return g.join('');
}
/** Grille d'échecs après un coup de de vers a (sans prise ni roque, pour les tests). */
function jouerSansPrise(grille, de, a) {
  const g = grille.split('');
  g[a] = g[de];
  g[de] = '.';
  return g.join('');
}
/** Grille de dames à partir de { index: pièce }. */
function damier(pos) {
  const g = Array(100).fill('.');
  for (const [i, ch] of Object.entries(pos)) g[Number(i)] = ch;
  return g.join('');
}
const joueur = (id, pseudo, couleur, place) => ({
  user_id: id, pseudo, couleur, avatar_url: null, invite: false, robot: false, place, manches: 0, nuls: 0, coups: 0,
  essais: 0, trouve_en: null, fin: null, pret: true, radar: 0, rang: null, gagne: null, paillettes: 0,
});
/** État complet d'une partie (échecs ou dames), membre connecté = ME. */
function etat({ jeu, code, grille, version, tour, blanc = ME, dernier = null, nb = 0, pions = { [ME]: '1', [ALICE]: '2' } }) {
  const echecs = jeu === 'echecs';
  return {
    partie: {
      id: `id-${code}`, code, jeu, variante: echecs ? 'classique' : 'internationales', nom: echecs ? 'Échecs' : 'Dames',
      statut: 'en_cours', hote: ME, defie: null, defi_expire: null, robot: 0, visibilite: 'privee', invites: 0, commence: 'moi',
      format: 1, t_coup: 60, options: {}, restant: null, manche: 1, phase: null, grille, w: echecs ? 8 : 10, h: echecs ? 8 : 10,
      n: 0, petites: null, cible: null, tour, tour_fin: new Date(Date.now() + 60000).toISOString(), premier: blanc,
      nb_coups: nb, dernier, vainqueur: null, version, historique: [], suite: null, forfait: null, abandon: null,
    },
    maintenant: new Date().toISOString(),
    moi: { user_id: ME, joue: true, spectateur: false, defie: false, hote: true, invite: false, place: blanc === ME ? 1 : 2 },
    joueurs: [joueur(ME, 'Ethan', '#4F6A8F', blanc === ME ? 1 : 2), joueur(ALICE, 'Alice', '#D97757', blanc === ME ? 2 : 1)],
    defie_pseudo: null, mastermind: null, bataille: null, quiestce: null, pfc: null,
    echecs: echecs ? { blanc, roque: 'KQkq', ep: -1, demi: 0 } : null,
    pions,
    journal: [],
  };
}
/** Les 20 premiers coups des blancs (pions d'une ou deux cases, cavaliers b1 et g1). */
function coupsDebut() {
  const coups = [];
  for (let f = 0; f < 8; f++) {
    coups.push({ de: 48 + f, a: 40 + f, promo: '' }, { de: 48 + f, a: 32 + f, promo: '' });
  }
  coups.push({ de: 57, a: 40, promo: '' }, { de: 57, a: 42, promo: '' }, { de: 62, a: 45, promo: '' }, { de: 62, a: 47, promo: '' });
  return coups;
}

/* ---------- Outils de test ---------- */
const attendre = (p, ms = 300) => p.waitForTimeout(ms);
const nb = (p, sel) => p.$$eval(sel, (els) => els.length);
const classes = (p, i) => p.getAttribute(`[data-sq="${i}"]`, 'class');
const libelle = (p, i) => p.getAttribute(`[data-sq="${i}"]`, 'aria-label');
const cliquer = (p, i) => p.click(`[data-sq="${i}"]`);
const appels = (p) => p.evaluate(() => window.__DUELS.appels.slice());
const erreurs = (p) => p.errs.filter((x) => x.startsWith('PAGEERR'));
const texte = (p, sel) => p.$eval(sel, (el) => el.textContent.trim());
const shot = async (p, nom, pleine = false) => {
  await attendre(p, 300);
  await p.screenshot({ path: path.join(SHOTS, `${nom}.png`), fullPage: pleine });
};

/** Ouvre le banc (faux Supabase, largeur donnée) et attend que la page soit prête. */
async function ouvrir(browser, opts = {}) {
  const p = await openPage(browser, { page: BANC, fixture: FIXTURE, width: 1280, height: 900, ...opts });
  await p.waitForFunction(() => window.bancPret === true, null, { timeout: 8000 }).catch(() => {});
  return p;
}
const monter = (p, jeu, e, possibles) => p.evaluate(([j, s, c]) => window.banc.monter(j, s, c), [jeu, e, possibles]);
const majEtat = (p, e, possibles) => p.evaluate(([s, c]) => window.banc.maj(s, c), [e, possibles]);

/* ---------- États de test ---------- */
const E_DEBUT = etat({ jeu: 'echecs', code: 'HGEC-1001', grille: DEBUT, version: 1, tour: ME });
const E_APRES_E4 = etat({
  jeu: 'echecs', code: 'HGEC-1001', grille: jouerSansPrise(DEBUT, 52, 36), version: 2, tour: ALICE, nb: 1,
  dernier: { user_id: ME, case: 52 * 64 + 36, action: 'pose' },
});
const E_PROMO = etat({ jeu: 'echecs', code: 'HGEC-1002', grille: echiquier({ a7: 'P', e1: 'K', e8: 'k' }), version: 1, tour: ME, nb: 30 });
const COUPS_PROMO = ['q', 'r', 'b', 'n'].map((promo) => ({ de: 8, a: 0, promo }));
/** Les noirs jouent ; le roi noir est en échec par la tour blanche (colonne e). */
const E_NOIR_ECHEC = etat({
  jeu: 'echecs', code: 'HGEC-1003', grille: echiquier({ a1: 'K', e1: 'R', d2: 'P', e8: 'k', h7: 'p' }), version: 1, tour: ME,
  blanc: ALICE, nb: 20,
});
const COUPS_NOIR = [{ de: 4, a: 5, promo: '' }, { de: 4, a: 3, promo: '' }];

const D_CAPTURE = etat({
  jeu: 'dames', code: 'HGDA-2001', grille: damier({ 61: '1', 67: '1', 52: '2', 34: '2', 56: '2', 9: 'B', 90: 'A' }), version: 1, tour: ME, nb: 12,
});
// Ici je suis le joueur « 2 » (mes pions remontent vers le bas) : le plateau doit être retourné.
const D_FLIP = etat({ jeu: 'dames', code: 'HGDA-2002', grille: damier({ 34: '2', 43: '1', 61: '1', 9: 'B' }), version: 1, tour: ME, nb: 9, pions: { [ME]: '2', [ALICE]: '1' } });

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  try {
    await echecs(browser);
    await dames(browser);
    await mobile(browser);
  } catch (e) {
    check(false, `exception : ${e.message}`);
  }
  await browser.close();
  finish();
})();

/* ---------- Échecs ---------- */
async function echecs(browser) {
  const p = await ouvrir(browser);
  await monter(p, 'echecs', E_DEBUT, coupsDebut());
  await attendre(p, 400);
  check(await nb(p, '.duels-echecs-case') === 64, 'échiquier : 64 cases');
  check(await nb(p, '.duels-echecs-coord') === 16, 'coordonnées : 8 rangs et 8 fichiers');
  check(await libelle(p, 52) === 'e2, pion blanc', `libellé de e2 : « ${await libelle(p, 52)} »`);
  check((await texte(p, '.duels-statut')) === 'À toi de jouer', 'statut : à toi de jouer (blancs)');
  check((await texte(p, '.duels-echecs-legende')).includes('Blancs : Ethan (toi)'), 'légende : les blancs et moi');
  check(await p.getAttribute('.duels-echecs-plateau', 'role') === 'group', 'plateau : groupe nommé');
  await shot(p, 's4-echecs-1280');

  // Clic : e2 choisie (e3 et e4 possibles), puis e4 : coup envoyé.
  await cliquer(p, 52);
  await attendre(p, 150);
  check(await nb(p, '.duels-echecs-case.is-sel') === 1, 'clic sur e2 : la case est sélectionnée');
  check(await nb(p, '.duels-echecs-case.is-cible') === 2, 'clic sur e2 : deux arrivées (e3, e4)');
  await cliquer(p, 36);
  await attendre(p, 300);
  let a = await appels(p);
  check(a.length === 1 && a[0].coup === 3364 && a[0].action === 'pose' && a[0].code === 'HGEC-1001',
    `clic e2-e4 : hg_duel_jouer(3364, 'pose') envoyé (${JSON.stringify(a)})`);
  await majEtat(p, E_APRES_E4, []);
  await attendre(p, 200);
  check(await nb(p, '.duels-echecs-case.is-dernier') === 2, 'dernier coup surligné (e2 et e4)');
  check((await texte(p, '.duels-statut')) === 'Au tour de Alice', 'statut après le coup : au tour d’Alice');

  // Clavier : Entrée sur e2, flèches jusqu'à e4, Entrée : coup envoyé.
  await monter(p, 'echecs', E_DEBUT, coupsDebut());
  await attendre(p, 300);
  await p.focus('[data-sq="52"]');
  await p.keyboard.press('Enter');
  await p.keyboard.press('ArrowUp');
  await p.keyboard.press('ArrowUp');
  const focus = await p.evaluate(() => document.activeElement?.dataset.sq);
  check(focus === '36', `clavier : deux flèches haut depuis e2 mènent à e4 (focus ${focus})`);
  await p.keyboard.press('Enter');
  await attendre(p, 300);
  a = await appels(p);
  check(a.length === 2 && a[1].coup === 3364, 'clavier : Entrée sur e4 joue e2-e4');

  // Glisser-déposer à la souris : e2 vers e3.
  await monter(p, 'echecs', E_DEBUT, coupsDebut());
  await attendre(p, 300);
  const b1 = await p.locator('[data-sq="52"]').boundingBox();
  const b2 = await p.locator('[data-sq="44"]').boundingBox();
  await p.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
  await p.mouse.down();
  await p.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2, { steps: 8 });
  await p.mouse.up();
  await attendre(p, 300);
  a = await appels(p);
  check(a.length === 3 && a[2].coup === 52 * 64 + 44, `glisser-déposer : e2-e3 joué (${a.length} appels, dernier ${a[a.length - 1]?.coup})`);

  // Promotion : a7-a8 ouvre la fenêtre ; Échap ferme sans jouer ; « Cavalier » joue a7-a8=n.
  await monter(p, 'echecs', E_PROMO, COUPS_PROMO);
  await attendre(p, 300);
  await cliquer(p, 8);
  await cliquer(p, 0);
  await attendre(p, 200);
  check(await p.isVisible('.duels-echecs-promo'), 'promotion : fenêtre de choix ouverte');
  check(await nb(p, '[data-promo]') === 4, 'promotion : dame, tour, fou, cavalier proposés');
  const focusPromo = await p.evaluate(() => document.activeElement?.dataset.promo);
  check(focusPromo === 'q', 'promotion : le focus va sur la dame');
  await shot(p, 's4-echecs-promotion-1280');
  const avantEchap = (await appels(p)).length;
  await p.keyboard.press('Escape');
  await attendre(p, 200);
  check(!(await p.isVisible('.duels-echecs-promo')) && (await appels(p)).length === avantEchap, 'promotion : Échap ferme sans jouer');
  await cliquer(p, 8);
  await cliquer(p, 0);
  await p.click('[data-promo="n"]');
  await attendre(p, 300);
  a = await appels(p);
  const dernier = a[a.length - 1];
  check(dernier.coup === 8 * 64 + 0 && dernier.action === 'n', `promotion : coup a7-a8 avec « n » (${JSON.stringify(dernier)})`);

  // Noirs, roi en échec : plateau retourné, case du roi en rouge, annonce « Échec ! ».
  await monter(p, 'echecs', E_NOIR_ECHEC, COUPS_NOIR);
  await attendre(p, 400);
  check(await p.getAttribute('.duels-echecs-plateau [data-sq]', 'data-sq') === '63', 'noirs : plateau retourné (h1 en haut à gauche)');
  check((await classes(p, 4)).includes('is-echec'), 'roi noir en échec : case e8 en rouge');
  check((await texte(p, '.duels-echecs-annonce')) === 'Échec !', 'roi en échec : « Échec ! » annoncé');
  check((await texte(p, '.duels-echecs-legende')).includes('Noirs : Ethan (toi)'), 'légende : les noirs et moi');
  check((await texte(p, '.duels-echecs-pris')).includes('Pris par les blancs'), 'pièces prises : affichées');
  await cliquer(p, 4);
  check(await nb(p, '.duels-echecs-case.is-cible') === 2, 'noirs : le roi a deux fuites');
  await cliquer(p, 5);
  await attendre(p, 300);
  a = await appels(p);
  check(a[a.length - 1].coup === 4 * 64 + 5 && a[a.length - 1].action === 'pose', 'noirs : Roi e8-f8 joué');
  await shot(p, 's4-echecs-noirs-echec-1280');
  check(erreurs(p).length === 0, `échecs : aucune erreur JS (${erreurs(p).join(' | ')})`);
}

/* ---------- Dames ---------- */
async function dames(browser) {
  const p = await ouvrir(browser);
  await monter(p, 'dames', D_CAPTURE, ['61,43,25', '67,45']);
  await attendre(p, 400);
  check((await texte(p, '.duels-dames-info')).startsWith('Prise obligatoire'), 'dames : « Prise obligatoire » affiché');
  check(await nb(p, '.duels-dames-case.is-prise') === 2, 'dames : les deux pièces qui peuvent prendre sont marquées');
  check((await texte(p, '.duels-dames-legende')).includes('Pions crème : Ethan (toi)'), 'dames : légende, pions crème et moi');
  await shot(p, 's4-dames-1280');

  // Sélection puis annulation.
  await cliquer(p, 67);
  await attendre(p, 150);
  check(await nb(p, '.duels-dames-case.is-cible') === 1, 'dames : pion 67 sélectionné, une arrivée');
  await p.click('[data-annuler]');
  await attendre(p, 150);
  check(await nb(p, '.duels-dames-case.is-sel') === 0 && await nb(p, '.duels-dames-case.is-cible') === 0, 'dames : « Annuler la sélection » reprend tout');

  // Rafle double 61 → 43 → 25 : chaque clic avance, la case sautée est surlignée, le coup part quand il est complet.
  await cliquer(p, 61);
  await attendre(p, 150);
  check(await nb(p, '.duels-dames-case.is-cible') === 1 && (await classes(p, 43)).includes('is-cible'), 'rafle : première étape, 43');
  await cliquer(p, 43);
  await attendre(p, 150);
  check((await classes(p, 52)).includes('is-saute'), 'rafle : la pièce sautée (52) est surlignée');
  check((await classes(p, 25)).includes('is-cible'), 'rafle : deuxième étape, 25');
  await shot(p, 's4-dames-rafle-1280');
  await cliquer(p, 25);
  await attendre(p, 300);
  let a = await appels(p);
  const dernier = a[a.length - 1];
  check(dernier.coup === 61 && dernier.action === 'chemin:61,43,25', `rafle double : hg_duel_jouer(61, 'chemin:61,43,25') (${JSON.stringify(dernier)})`);

  // Plateau retourné pour le joueur « 2 » : mes pions en bas, première case du DOM = 98.
  await monter(p, 'dames', D_FLIP, ['34,52,70']);
  await attendre(p, 400);
  check(await p.getAttribute('.duels-dames-plateau [data-sq]', 'data-sq') === '98', 'joueur « 2 » : plateau retourné');
  await cliquer(p, 34);
  await cliquer(p, 52);
  await attendre(p, 150);
  check((await classes(p, 43)).includes('is-saute'), 'rafle retournée : la pièce sautée (43) est surlignée');
  await cliquer(p, 70);
  await attendre(p, 300);
  a = await appels(p);
  check(a[a.length - 1].coup === 34 && a[a.length - 1].action === 'chemin:34,52,70', 'rafle retournée : chemin 34,52,70 envoyé');
  await shot(p, 's4-dames-retourne-1280');
  check(erreurs(p).length === 0, `dames : aucune erreur JS (${erreurs(p).join(' | ')})`);
}

/* ---------- Téléphone : 360 et 390 px ---------- */
async function mobile(browser) {
  for (const largeur of [360, 390]) {
    const p = await ouvrir(browser, { width: largeur, height: 780, mobile: true, dpr: 2 });
    await monter(p, 'echecs', E_DEBUT, coupsDebut());
    await attendre(p, 400);
    check(await hscroll(p) === 0, `échecs ${largeur} px : aucun défilement horizontal`);
    const boite = await p.locator('.duels-echecs-plateau').boundingBox();
    // Plateau pleine largeur : marges réduites à 2 px de chaque bord (echecs.css, téléphone)
    check(boite.width <= largeur - 4 && boite.x >= 0, `échecs ${largeur} px : plateau ${Math.round(boite.width)} px (pleine largeur, 2 px de marge)`);
    const caseE = await p.locator('.duels-echecs-case').first().boundingBox();
    check(caseE.width >= 44 && caseE.height >= 44, `échecs ${largeur} px : case ${caseE.width.toFixed(1)} × ${caseE.height.toFixed(1)} px (cible ≥ 44 px)`);
    await cliquer(p, 52);
    await attendre(p, 150);
    await shot(p, `s4-echecs-${largeur}`);

    await monter(p, 'dames', D_CAPTURE, ['61,43,25', '67,45']);
    await attendre(p, 400);
    check(await hscroll(p) === 0, `dames ${largeur} px : aucun défilement horizontal`);
    const boiteD = await p.locator('.duels-dames-plateau').boundingBox();
    check(boiteD.width <= largeur - 4 && boiteD.x >= 0, `dames ${largeur} px : damier ${Math.round(boiteD.width)} px (pleine largeur, 2 px de marge)`);
    // 10 cases de 44 px = 440 px > 360 px : la case reste sous 44 px (exception documentée dans a11y-mobile.cjs)
    const caseD = await p.locator('.duels-dames-case').first().boundingBox();
    check(caseD.width >= (largeur === 360 ? 35 : 38), `dames ${largeur} px : case ${caseD.width.toFixed(1)} px (maximum de la largeur, exception 44 px)`);
    await cliquer(p, 61);
    await attendre(p, 150);
    const annuler = await p.locator('[data-annuler]').boundingBox();
    check(annuler && annuler.height >= 44, `dames ${largeur} px : bouton « Annuler la sélection » ≥ 44 px (${annuler && Math.round(annuler.height)} px)`);
    await cliquer(p, 43);
    await attendre(p, 150);
    await shot(p, `s4-dames-${largeur}`);
    check(erreurs(p).length === 0, `${largeur} px : aucune erreur JS`);
  }
}
