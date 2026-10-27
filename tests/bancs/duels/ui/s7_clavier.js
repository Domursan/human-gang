// Clavier dans les tables à grille des duels : un coup joué aux flèches puis Entrée dans Puissance 4, Morpion, Dames,
// Échecs, Othello et Bataille (contre le robot, base locale). Vérifie aussi que chaque grille n'a qu'une case dans
// l'ordre de tabulation, que le focus a un contour visible, et que Échap annule une sélection (Puissance 4 et
// Othello sur téléphone, Échecs sur ordinateur). Lancer : node tests/bancs/duels/ui/s7_clavier.js
const { ouvrir, shot, fermer, psql, uid } = require('./lib.js');

const q = (n, sql) => { const r = psql(uid(n), sql); if (!r.ok) throw new Error(r.message); return r.text; };
const su = (sql) => { const r = psql(null, 'reset role; ' + sql); if (!r.ok) throw new Error(r.message); return r.text; };
const attendre = (p, ms) => p.waitForTimeout(ms);
const coups = (c) => Number(su(`select nb_coups from hg_duel_parties where code = '${c}'`));
const creer = (json) => JSON.parse(q(2, `select to_jsonb(hg_duel_creer('${json}'::jsonb))`));
let ok = 0, ko = 0;
const check = (c, m) => { if (c) { ok++; console.log('OK     ' + m); } else { ko++; console.log('ECHEC  ' + m); } };

/** Le focus : contour visible (focus-visible) ou non. */
const contourVisible = (p) => p.evaluate(() => {
  const a = document.activeElement;
  if (!a) return false;
  const st = getComputedStyle(a);
  return a.matches(':focus-visible') && st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0;
});
/** Attribut data-* de la case qui a le focus. */
const caseFocus = (p, attr) => p.evaluate((attr) => Number(document.activeElement?.dataset?.[attr]), attr);

/** Déplace le focus aux flèches vers la première case de classe « cls » (la plus proche), à l'écran. */
async function versClasse(p, cls, essais = 16) {
  for (let k = 0; k < essais; k++) {
    const dir = await p.evaluate((cls) => {
      const a = document.activeElement;
      if (a && a.classList.contains(cls)) return 'ici';
      const ra = a.getBoundingClientRect();
      const cibles = [...document.querySelectorAll('[data-sq]')].filter((x) => x.classList.contains(cls));
      if (!cibles.length) return 'rien';
      const c = cibles.map((x) => { const r = x.getBoundingClientRect(); return { dx: r.left - ra.left, dy: r.top - ra.top }; })
        .sort((u, v) => Math.hypot(u.dx, u.dy) - Math.hypot(v.dx, v.dy))[0];
      if (Math.abs(c.dx) >= Math.abs(c.dy)) return c.dx > 0 ? 'ArrowRight' : 'ArrowLeft';
      return c.dy > 0 ? 'ArrowDown' : 'ArrowUp';
    }, cls);
    if (dir === 'ici') return true;
    if (dir === 'rien') return false;
    await p.keyboard.press(dir);
    await attendre(p, 60);
  }
  return false;
}

/** Déplace le focus, case par case, jusqu'à la case d'index « cible » d'une grille de cote « cote » (attribut data-attr). */
async function allerCase(p, cible, cote, attr) {
  for (let k = 0; k < 40; k++) {
    const i = await caseFocus(p, attr);
    if (i === cible) return true;
    const dl = Math.floor(cible / cote) - Math.floor(i / cote);
    const dc = (cible % cote) - (i % cote);
    const touche = dl !== 0 ? (dl > 0 ? 'ArrowDown' : 'ArrowUp') : (dc > 0 ? 'ArrowRight' : 'ArrowLeft');
    await p.keyboard.press(touche);
  }
  return false;
}

/* ---------- Puissance 4 ---------- */
async function puissance4() {
  const c = creer('{"jeu":"p4","variante":"classique","adversaire":"robot","robot":1,"commence":"moi"}');
  const a = await ouvrir(2, `#partie/${c}`);
  await a.waitForSelector('.duels-p4-colonne:not([disabled])', { timeout: 8000 });
  check(await a.$$eval('.duels-p4-colonne[tabindex="0"]', (e) => e.length) === 1, 'P4 : une seule colonne dans l’ordre de tabulation');
  await a.focus('.duels-p4-colonne[tabindex="0"]');
  const avant = await caseFocus(a, 'col');
  await a.keyboard.press('ArrowRight');
  await a.keyboard.press('ArrowRight');
  const col = await caseFocus(a, 'col');
  check(col === avant + 2, `P4 : deux flèches droite mènent à la colonne ${col + 1}`);
  check(await contourVisible(a), 'P4 : la colonne au focus a un contour visible');
  await a.keyboard.press('Enter');
  await attendre(a, 2000);
  check(coups(c) >= 2, `P4 : Entrée joue la colonne ${col + 1}, le robot répond (coups en base : ${coups(c)})`);
  await shot(a, 's7-p4-clavier', false);
}

/* ---------- Puissance 4 sur téléphone : Entrée sélectionne, Échap annule ---------- */
async function puissance4Telephone() {
  const c = creer('{"jeu":"p4","variante":"classique","adversaire":"robot","robot":1,"commence":"moi"}');
  const a = await ouvrir(2, `#partie/${c}`, 390, { isMobile: true, hasTouch: true });
  await a.waitForSelector('.duels-p4-colonne:not([disabled])', { timeout: 8000 });
  check(await a.evaluate(() => !matchMedia('(hover: hover) and (pointer: fine)').matches), 'P4 téléphone : l’émulation est bien tactile');
  await a.focus('.duels-p4-colonne[tabindex="0"]');
  await a.keyboard.press('ArrowRight');
  await a.keyboard.press('Enter');
  await attendre(a, 150);
  check(await a.$('.duels-p4-valider') !== null, 'P4 téléphone : Entrée sélectionne la colonne, « Valider » apparaît');
  check(await a.$eval('.duels-p4-colonne[data-col="1"]', (b) => b.getAttribute('aria-pressed')) === 'true', 'P4 téléphone : la colonne choisie est aria-pressed');
  await a.keyboard.press('Escape');
  await attendre(a, 150);
  check(await a.$('.duels-p4-valider') === null, 'P4 téléphone : Échap annule la sélection');
  check(coups(c) === 0, 'P4 téléphone : aucun coup envoyé par la sélection et l’annulation');
}

/* ---------- Morpion (classique) ---------- */
async function morpion() {
  const c = creer('{"jeu":"morpion","variante":"classique","adversaire":"robot","robot":1,"commence":"moi"}');
  const a = await ouvrir(2, `#partie/${c}`);
  await a.waitForSelector('button.morpion-case:not([disabled])', { timeout: 8000 });
  check(await a.$$eval('[data-case][tabindex="0"]', (e) => e.length) === 1, 'morpion : une seule case dans l’ordre de tabulation');
  await a.focus('[data-case][tabindex="0"]');
  const depart = await caseFocus(a, 'case');
  await a.keyboard.press('ArrowRight');
  await a.keyboard.press('ArrowDown');
  const i = await caseFocus(a, 'case');
  check(i === depart + 4, `morpion : flèches droite puis bas mènent à la case ${i + 1}`);
  check(await contourVisible(a), 'morpion : la case au focus a un contour visible');
  await a.keyboard.press('Enter');
  await attendre(a, 1500);
  check(coups(c) >= 2, `morpion : Entrée joue la case ${i + 1}, le robot répond (coups : ${coups(c)})`);
  check(await a.$(`span.morpion-case[data-case="${i}"]`) !== null, 'morpion : la marque apparaît sur la case jouée');
}

/* ---------- Dames : pièce puis arrivée diagonale, aux flèches ---------- */
async function dames() {
  const c = creer('{"jeu":"dames","adversaire":"robot","robot":1,"commence":"moi"}');
  const a = await ouvrir(2, `#partie/${c}`);
  await a.waitForSelector('.duels-dames-case.is-mienne', { timeout: 12000 });
  await a.focus('[data-sq][tabindex="0"]');
  check(await versClasse(a, 'is-mienne'), 'dames : les flèches mènent à une pièce qui peut jouer');
  await a.keyboard.press('Enter');
  await attendre(a, 150);
  check(await a.$('.duels-dames-case.is-sel') !== null, 'dames : Entrée choisit la pièce');
  check(await versClasse(a, 'is-cible'), 'dames : les flèches mènent à une arrivée (en diagonale)');
  await a.keyboard.press('Enter');
  await attendre(a, 1800);
  check(coups(c) >= 2, `dames : Entrée joue le coup, le robot répond (coups : ${coups(c)})`);
}

/* ---------- Échecs : e2-e4 au clavier, Échap annule la sélection ---------- */
async function echecs() {
  const c = creer('{"jeu":"echecs","adversaire":"robot","robot":1,"commence":"moi"}');
  const a = await ouvrir(2, `#partie/${c}`);
  await a.waitForSelector('.duels-echecs-case', { timeout: 8000 });
  await a.focus('[data-sq][tabindex="0"]');
  check(await a.evaluate(() => document.activeElement.dataset.sq) === '52', 'échecs : le focus part de e2');
  await a.keyboard.press('Enter');
  await attendre(a, 150);
  await a.keyboard.press('Escape');
  await attendre(a, 150);
  check(await a.$('.duels-echecs-case.is-sel') === null, 'échecs : Échap annule la pièce choisie');
  await a.keyboard.press('Enter');
  await attendre(a, 150);
  await a.keyboard.press('ArrowUp');
  await a.keyboard.press('ArrowUp');
  check(await caseFocus(a, 'sq') === 36, 'échecs : deux flèches haut mènent à e4');
  check(await contourVisible(a), 'échecs : la case au focus a un contour visible');
  await a.keyboard.press('Enter');
  await attendre(a, 1800);
  check(coups(c) >= 2, `échecs : Entrée joue e2-e4, le robot répond (coups : ${coups(c)})`);
}

/* ---------- Othello : coup aux flèches, puis Échap sur téléphone ---------- */
async function othello() {
  const c = creer('{"jeu":"othello","adversaire":"robot","robot":1,"commence":"moi"}');
  const a = await ouvrir(2, `#partie/${c}`);
  await a.waitForSelector('.duels-oth-case.is-possible', { timeout: 8000 });
  const cible = await a.evaluate(() => Number(document.querySelector('.duels-oth-case.is-possible').dataset.i));
  await a.focus('.duels-oth-case[tabindex="0"]');
  check(await allerCase(a, cible, 8, 'i'), `othello : les flèches mènent à la case jouable ${cible}`);
  check(await contourVisible(a), 'othello : la case au focus a un contour visible');
  await a.keyboard.press('Enter');
  await attendre(a, 2000);
  check(coups(c) >= 2, `othello : Entrée joue, le robot répond (coups : ${coups(c)})`);
}

/* ---------- Othello sur téléphone : Échap annule la case choisie ---------- */
async function othelloTelephone() {
  const c = creer('{"jeu":"othello","adversaire":"robot","robot":1,"commence":"moi"}');
  const a = await ouvrir(2, `#partie/${c}`, 390, { isMobile: true, hasTouch: true });
  await a.waitForSelector('.duels-oth-case.is-possible', { timeout: 8000 });
  const cible = await a.evaluate(() => Number(document.querySelector('.duels-oth-case.is-possible').dataset.i));
  await a.focus('.duels-oth-case[tabindex="0"]');
  await allerCase(a, cible, 8, 'i');
  await a.keyboard.press('Enter');
  await attendre(a, 150);
  check(await a.$('.duels-oth-valider') !== null, 'othello téléphone : Entrée choisit la case, « Jouer en … » apparaît');
  await a.keyboard.press('Escape');
  await attendre(a, 150);
  check(await a.$('.duels-oth-valider') === null, 'othello téléphone : Échap annule la case choisie');
  check(coups(c) === 0, 'othello téléphone : aucun coup envoyé par la sélection et l’annulation');
}

/* ---------- Qui est-ce : flèches entre les cartes de personnages ---------- */
async function quiEstCe() {
  const c = creer('{"jeu":"quiestce","adversaire":"robot","robot":2,"commence":"moi"}');
  const a = await ouvrir(2, `#partie/${c}`);
  await a.waitForSelector('[data-act="carte"]:not([disabled])', { timeout: 8000 });
  await a.focus('[data-act="carte"]:not([disabled])');
  const avant = await a.evaluate(() => document.activeElement.dataset.id);
  await a.keyboard.press('ArrowRight');
  const apres = await a.evaluate(() => document.activeElement.dataset.id);
  check(apres !== avant && (await a.evaluate(() => document.activeElement.matches('[data-act="carte"]'))),
    'qui est-ce : la flèche droite passe à la carte voisine');
  check(await contourVisible(a), 'qui est-ce : la carte au focus a un contour visible');
}

/* ---------- Bataille : tir aux flèches dans la grille de tir ---------- */
async function bataille() {
  const c = creer('{"jeu":"bataille","adversaire":"robot","robot":2,"commence":"moi"}');
  q(2, `select hg_duel_placer('${c}', hg_duel_flotte_hasard('${c}'))`);
  const a = await ouvrir(2, `#partie/${c}`);
  await a.waitForSelector('button[data-role="tir"]:not([disabled])', { timeout: 8000 });
  await a.focus('button[data-role="tir"][tabindex="0"]');
  const avant = await caseFocus(a, 'case');
  await a.keyboard.press('ArrowRight');
  await a.keyboard.press('ArrowDown');
  const i = await caseFocus(a, 'case');
  check(i === avant + 11, `bataille : flèches droite puis bas mènent à ${await a.evaluate(() => document.activeElement.getAttribute('aria-label'))}`);
  check(await contourVisible(a), 'bataille : la case au focus a un contour visible');
  await a.keyboard.press('Enter');
  await attendre(a, 1500);
  const tirs = Number(su(`select count(*) from hg_duel_tirs t join hg_duel_parties p on p.id = t.partie where p.code = '${c}'`));
  check(tirs >= 1, `bataille : Entrée tire sur la case visée (${tirs} tir en base)`);
  check(await a.evaluate(() => !!document.activeElement?.matches('button[data-role="tir"]:not([disabled])')),
    'bataille : après le tir, le focus reste sur une case de tir active');
}

(async () => {
  // Limite de 10 duels ouverts par membre : on annule ceux des passages précédents (comme s5).
  su("update hg_duel_parties set statut = 'annulee' where statut in ('attente', 'en_cours')");
  const etapes = [
    ['P4', puissance4], ['P4 téléphone', puissance4Telephone], ['morpion', morpion], ['dames', dames],
    ['échecs', echecs], ['othello', othello], ['othello téléphone', othelloTelephone], ['qui est-ce', quiEstCe],
    ['bataille', bataille],
  ];
  for (const [nom, f] of etapes) {
    try { await f(); } catch (e) { ko++; console.log(`ECHEC  ${nom} : ${e.message.split('\n')[0]}`); }
  }
  await fermer();
  console.log(`${ok} OK, ${ko} ECHEC(S)`);
  process.exitCode = ko ? 1 : 0;
  process.exit(process.exitCode);
})();
