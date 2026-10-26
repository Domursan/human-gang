// Tetris du gang (eggs/jeu-tetris.js) : règles, cadence serveur et codes de triche, sans navigateur : node tests/arcade-tetris.mjs
import { JEU as T, FORMES, COLONNES, RANGEES } from '../assets/js/eggs/jeu-tetris.js';
import { simule, fauxCtx } from './lib/faux-canevas.mjs';
let ok = 0, ko = 0;
const check = (c, m) => { if (c) { ok++; console.log('OK     ' + m); } else { ko++; console.log('ECHEC  ' + m); } };
/** Moitié de la cadence serveur (60 points par seconde) : la barre que vise le barème. */
const CADENCE = 30;
const VIDE = { cible: null, cibleY: null, fleche: 0, pas: 0, vertical: 0, dir: null, action: false, tenu: false };

/** Vrai si la pièce (type, rotation) tient en (x, y) sur ce plateau (même règle que le jeu). */
function libreTest(plateau, type, rot, x, y) {
  return FORMES[type][rot].every(([dx, dy]) => {
    const X = x + dx, Y = y + dy;
    return X >= 0 && X < COLONNES && Y >= 0 && Y < RANGEES && !plateau[Y][X];
  });
}

/** Note un placement (heuristique classique) : lignes pleines, hauteur, trous et dénivelés (plus haut = meilleur). */
function note(plateau, type, rot, x, y) {
  const copie = plateau.map((r) => r.slice());
  for (const [dx, dy] of FORMES[type][rot]) copie[y + dy][x + dx] = 1;
  const lignes = copie.filter((r) => r.every((c) => c)).length;
  const hauteurs = [];
  let trous = 0;
  for (let c = 0; c < COLONNES; c++) {
    let haut = -1;
    for (let r = 0; r < RANGEES; r++) if (copie[r][c]) { haut = r; break; }
    hauteurs.push(haut < 0 ? 0 : RANGEES - haut);
    if (haut >= 0) for (let r = haut; r < RANGEES; r++) if (!copie[r][c]) trous++;
  }
  const total = hauteurs.reduce((a, b) => a + b, 0);
  let relief = 0;
  for (let c = 1; c < COLONNES; c++) relief += Math.abs(hauteurs[c] - hauteurs[c - 1]);
  return 0.76 * lignes - 0.51 * total - 0.36 * trous - 0.18 * relief;
}

/** Meilleur placement de la pièce courante (rotation et colonne), ou null. */
function meilleur(s) {
  let best = null;
  const { type } = s.piece;
  for (let rot = 0; rot < 4; rot++) {
    for (let x = -2; x < COLONNES + 2; x++) {
      if (!libreTest(s.plateau, type, rot, x, 0)) continue;
      let y = 0;
      while (libreTest(s.plateau, type, rot, x, y + 1)) y++;
      const n = note(s.plateau, type, rot, x, y);
      if (!best || n > best.n) best = { rot, x, n };
    }
  }
  return best;
}

/** Joueur « intelligent » simple : tourne et décale la pièce vers le meilleur placement, puis la fait tomber. */
function intelligent() {
  let piece = null, plan = null, essais = 0;
  return (s) => {
    if (!s.piece) return {};
    if (s.piece !== piece) { piece = s.piece; plan = meilleur(s); essais = 0; }
    essais++;
    if (!plan || essais > 40) return { dir: 'bas', glisse: true };
    if (s.piece.rot !== plan.rot) return { dir: 'haut' };
    if (s.piece.x !== plan.x) return { pas: Math.sign(plan.x - s.piece.x) };
    return { dir: 'bas', glisse: true };
  };
}

/** Joueur « maladroit » : ne tourne jamais, pousse la pièce à gauche autant que possible et la laisse tomber. */
function maladroit() {
  return (s) => {
    if (!s.piece) return {};
    const p = s.piece;
    if (libreTest(s.plateau, p.type, p.rot, p.x - 1, p.y)) return { pas: -1 };
    return { dir: 'bas', glisse: true };
  };
}

/** Compte les appels de dessin de cœurs (bezierCurveTo) pendant un dessin, pour une état donné. */
function coeursDessines(coeurs) {
  const compte = { n: 0 };
  const ctx = new Proxy(fauxCtx(), {
    get(t, k) { if (k === 'bezierCurveTo') compte.n++; return t[k]; },
  });
  const s = T.init({ reduit: false });
  s.triche = { coeurs, immortel: false };
  for (let i = 0; i < 60; i++) T.update(s, 1 / 30, VIDE);
  T.draw(ctx, s);
  return compte.n;
}

// Formes : quatre cases par orientation, pour les sept pièces.
check(FORMES.length === 7 && FORMES.every((f) => f.length === 4 && f.every((c) => c.length === 4)), 'sept pièces, quatre orientations de quatre cases');

// Points d'une ligne et de quatre lignes (une pièce posée : 1 point, plus le barème des lignes).
{
  const s = T.init({ reduit: false });
  s.triche = { coeurs: false, immortel: false };
  for (let x = 0; x < COLONNES - 1; x++) s.plateau[RANGEES - 1][x] = 1;
  s.piece = { type: 0, rot: 1, x: 7, y: RANGEES - 4 }; // I vertical dans la colonne 9 : pose la dernière case du bas
  T.update(s, 1 / 30, { ...VIDE, dir: 'bas', glisse: true });
  check(s.lignes === 1 && T.score(s) === 11, `une ligne : 10 points + 1 pièce (score ${T.score(s)})`);
}
{
  const s = T.init({ reduit: false });
  s.triche = { coeurs: false, immortel: false };
  for (let y = RANGEES - 4; y < RANGEES; y++) for (let x = 0; x < COLONNES - 1; x++) s.plateau[y][x] = 1;
  s.piece = { type: 0, rot: 1, x: 7, y: RANGEES - 4 }; // I vertical dans la colonne 9 : quatre lignes d'un coup
  T.update(s, 1 / 30, { ...VIDE, dir: 'bas', glisse: true });
  check(s.lignes === 4 && T.score(s) === 81, `quatre lignes : 80 points + 1 pièce (score ${T.score(s)})`);
}

// 1. Joueur intelligent pendant 120 s : pas d'exception, score plausible.
let a = null;
try {
  a = simule(T, { secondes: 120, entree: intelligent() });
  check(true, 'intelligent : 120 s jouées sans exception');
} catch (e) {
  check(false, `intelligent : exception levée (${e.message})`);
}
if (a) {
  const pts = T.score(a.s);
  check(a.s.poses >= 20 && pts >= a.s.poses, `intelligent : ${a.s.poses} pièces, ${a.s.lignes} lignes, score ${pts} (au moins 1 par pièce)`);
  // 2. Cadence : pic sur une seconde et moyenne, sous la moitié du plafond serveur.
  // Le serveur compare le total à la durée (60 pts/s au plus) : on vérifie la moyenne (< 30) et le total ;
  // le pic sur une seconde est affiché pour information (un tétris, 80 points, tombe en une seule image).
  check(pts / a.t < CADENCE && pts <= 60 * a.t, `intelligent : moyenne ${(pts / a.t).toFixed(1)} pts/s (< ${CADENCE}), pic sur 1 s ${a.maxParSeconde.toFixed(1)} (info)`);
}

// Cadence maximale : pièces posées sans attendre, avec immortel pour tenir 120 s. Au plus une pièce toutes les 0,25 s.
const r = simule(T, { secondes: 120, triche: { coeurs: false, immortel: true }, entree: () => ({ dir: 'bas', glisse: true }) });
check(r.s.poses <= Math.floor(r.t / 0.25) + 1 && r.maxParSeconde <= 4.5,`chute immédiate en continu : ${r.s.poses} pièces en ${r.t.toFixed(0)} s (au plus 1 toutes les 0,25 s), pic ${r.maxParSeconde.toFixed(1)} pts/s`);

// 3. Code « coeurs » : pas de piège, partie en cours, cases dessinées en cœurs.
const c = simule(T, { secondes: 120, triche: { coeurs: true, immortel: false }, entree: intelligent() });
check(c.t > 119.9 && !T.fini(c.s), `coeurs : pas de piège à éviter, partie toujours en cours après ${c.t.toFixed(0)} s (score ${T.score(c.s)})`);
check(coeursDessines(true) > 0 && coeursDessines(false) === 0, 'coeurs : les cases se dessinent en cœurs, et seulement avec le code');

// 3. Code « immortel » : on joue mal, la partie ne finit pas en 120 s, les débordements sont effacés.
const m = simule(T, { secondes: 120, triche: { coeurs: false, immortel: true }, entree: maladroit() });
check(!T.fini(m.s) && m.t > 119.9 && m.s.debordements > 0, `immortel : joué mal, ${m.s.debordements} débordements effacés, partie toujours en cours après ${m.t.toFixed(0)} s`);
// Sans code, le même joueur finit la partie.
const mm = simule(T, { secondes: 600, entree: maladroit() });
check(T.fini(mm.s), `sans code, joué mal : la partie finit (${mm.s.poses} pièces en ${mm.t.toFixed(0)} s)`);

// 4. Sans code et sans jouer, la partie finit.
const n = simule(T, { secondes: 900 });
check(T.fini(n.s), `sans code ni jeu : la partie finit (${n.s.poses} pièces en ${n.t.toFixed(0)} s)`);

console.log(`\n${ok} OK, ${ko} ECHEC(S)`);
process.exit(ko ? 1 : 0);
