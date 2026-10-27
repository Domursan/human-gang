// ===== Humane Gang — arcade : « Tetris du gang » =====
/*
 * Rôle : le Tetris classique. Plateau de 10 × 20 cases de 19 px ; à droite, un panneau « Suivante » (la pièce suivante)
 * et le nombre de lignes. Sept pièces (I O T S Z J L) tirées par sacs de sept, aux couleurs de l'arc-en-ciel du logo
 * (le sable pour la L). Cases à reflet façon pixel. Rotation avec décalage contre les murs (0, -1, +1, -2, +2 cases).
 * Fantôme : contour pâle de l'endroit où la pièce tomberait. Pose : la pièce se verrouille après une demi-seconde posée.
 * Points : 1 par pièce posée ; 1 ligne = 10, 2 = 30, 3 = 50, 4 = 80. La vitesse monte de 7 % toutes les 10 lignes, sans
 * plafond (un plancher technique de 0,05 s par case la borne, bien au-delà de ce qu'un joueur suit).
 * Le panneau affiche le niveau de vitesse (« VITESSE », un niveau par tranche de 10 lignes).
 * Pas de limite de temps : la partie finit quand une nouvelle pièce ne peut pas apparaître.
 * Commandes : clavier ← → (la pièce file si la flèche reste tenue), ↑ ou espace = rotation, ↓ = chute immédiate,
 *   ↓ tenue = descente rapide ; souris : clic = rotation ; doigt : glisser à gauche ou à droite = une case,
 *   glisser vers le bas = chute immédiate, appui = rotation.
 * Codes de triche (s.triche, eggs/arcade.js) : coeurs = toutes les cases deviennent des cœurs rouges (il n'y a pas de
 *   piège à retirer) ; immortel = quand le plateau déborde, les 6 lignes du bas sont effacées au lieu de finir la partie
 *   (ces lignes ne rapportent rien).
 * Cadence serveur : une pièce au plus toutes les 0,25 s (4 points par seconde pour les pièces seules) ; le plafond
 * serveur est de 60 points par seconde, les lignes restant sous la moitié de cette cadence en jeu normal.
 * Moteur : eggs/arcade.js (creeArcade). Animation réduite : chute un peu plus lente.
 * Exporte : JEU (règles du mini-jeu pour creeArcade), FORMES, COLONNES, RANGEES (pour les tests).
 */
import { coeur } from './arcade.js';

/** Plateau : 10 colonnes × 20 rangées. */
export const COLONNES = 10, RANGEES = 20;
const CASE = 19, BX = 24, BY = 36, PX = 236, PANNEAU = 108;
const COULEURS = ['#FE3104', '#FCA301', '#FBD32D', '#159946', '#2B5AE2', '#4E2398', '#E2C77E'];
const POINTS_LIGNES = [0, 10, 30, 50, 80];
/** Secondes posée avant verrouillage ; secondes entre deux pièces (cadence serveur) ; secondes par case en descente rapide. */
const DELAI_POSE = 0.5, DELAI_APPARITION = 0.25, DESCENTE_RAPIDE = 0.05;
/** Répétition des flèches tenues : délai avant la répétition, puis cadence. */
const DAS = 0.17, CADENCE_REPETITION = 0.05;
/** Accélération : +7 % de vitesse par niveau (tranche de 10 lignes), sans plafond. */
const HAUSSE = 0.07;
/** Nombre de remises à zéro du délai de pose après rotation ou déplacement à terre (anti-blocage). */
const REPRISES_MAX = 15;
const DECALAGES = [0, -1, 1, -2, 2];

/** Formes de base des sept pièces (I O T S Z J L), 1 = case pleine. */
const BASES = [
  [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  [[1, 1], [1, 1]],
  [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
];

/**
 * Pivote une matrice carrée d'un quart de tour, dans le sens horaire.
 * @param {number[][]} m matrice carrée
 * @returns {number[][]} matrice pivotée
 */
function pivote(m) {
  return m.map((_, r) => m.map((__, c) => m[m.length - 1 - c][r]));
}

/**
 * Liste les cases pleines d'une matrice.
 * @param {number[][]} m matrice
 * @returns {number[][]} décalages [colonne, rangée] des cases pleines
 */
function cellules(m) {
  const out = [];
  m.forEach((ligne, r) => ligne.forEach((v, c) => { if (v) out.push([c, r]); }));
  return out;
}

/** Les quatre orientations de chaque pièce (FORMES[type][rotation] = liste de [colonne, rangée]). */
export const FORMES = BASES.map((base) => {
  const rots = [];
  let m = base;
  for (let i = 0; i < 4; i++) { rots.push(cellules(m)); m = pivote(m); }
  return rots;
});

/** Plateau vide : RANGEES lignes de COLONNES zéros (0 = vide, sinon type de pièce + 1). */
const vide = () => Array.from({ length: RANGEES }, () => new Array(COLONNES).fill(0));

/**
 * Tire la prochaine pièce dans le sac (les sept types, mélangés) et la retire.
 * @param {object} s état de la partie
 * @returns {number} type de pièce, de 0 (I) à 6 (L)
 */
function tirer(s) {
  if (!s.sac.length) {
    s.sac = [0, 1, 2, 3, 4, 5, 6];
    for (let i = 6; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [s.sac[i], s.sac[j]] = [s.sac[j], s.sac[i]];
    }
  }
  return s.sac.pop();
}

/**
 * Vrai si la pièce tient à cette place : dans le plateau et sans toucher une case posée.
 * @param {number[][]} plateau cases posées
 * @param {number} type type de pièce
 * @param {number} rot orientation (0 à 3)
 * @param {number} x colonne de l'origine de la pièce
 * @param {number} y rangée de l'origine de la pièce
 * @returns {boolean}
 */
function libre(plateau, type, rot, x, y) {
  for (const [dx, dy] of FORMES[type][rot]) {
    const X = x + dx, Y = y + dy;
    if (X < 0 || X >= COLONNES || Y < 0 || Y >= RANGEES || plateau[Y][X]) return false;
  }
  return true;
}

/**
 * Fait apparaître la pièce suivante en haut du plateau. Si elle ne tient pas, la partie finit,
 * sauf avec le code « immortel » : on efface alors les 6 lignes du bas (sans les compter).
 * @param {object} s état de la partie
 */
function apparait(s) {
  const type = s.suivante;
  s.suivante = tirer(s);
  const x = Math.floor((COLONNES - BASES[type].length) / 2);
  if (!libre(s.plateau, type, 0, x, 0)) {
    if (!s.triche?.immortel) { s.fin = true; return; }
    s.debordements++;
    s.plateau.splice(RANGEES - 6, 6);
    for (let i = 0; i < 6; i++) s.plateau.unshift(new Array(COLONNES).fill(0));
  }
  s.piece = { type, rot: 0, x, y: 0 };
  s.sol = 0; s.reprises = 0; s.chute = 0;
}

/**
 * Intervalle de chute, en secondes par case : 7 % plus court par niveau (un niveau tous les 10 lignes), sans plafond.
 * @param {object} s état de la partie
 * @returns {number} secondes par case
 */
function intervalleChute(s) {
  const n = Math.floor(s.lignes / 10);
  return Math.max(0.05, (1 / (1 + HAUSSE)) ** n) * s.lent;
}

/**
 * Après un déplacement ou une rotation à terre, remet le délai de pose à zéro (dans la limite de REPRISES_MAX).
 * @param {object} s état de la partie
 */
function reprise(s) {
  if (s.sol > 0 && s.reprises < REPRISES_MAX) { s.sol = 0; s.reprises++; }
}

/**
 * Décale la pièce d'une case à gauche (-1) ou à droite (1), si elle peut.
 * @param {object} s état de la partie
 * @param {number} d -1 ou 1
 */
function deplace(s, d) {
  const p = s.piece;
  if (!p || !libre(s.plateau, p.type, p.rot, p.x + d, p.y)) return;
  p.x += d;
  reprise(s);
}

/**
 * Tourne la pièce d'un quart de tour, avec décalage contre les murs (0, -1, +1, -2, +2 cases).
 * @param {object} s état de la partie
 */
function tournePiece(s) {
  const p = s.piece;
  if (!p) return;
  const nr = (p.rot + 1) % 4;
  for (const k of DECALAGES) {
    if (libre(s.plateau, p.type, nr, p.x + k, p.y)) {
      p.rot = nr; p.x += k;
      reprise(s);
      return;
    }
  }
}

/**
 * Fait tomber la pièce jusqu'à la case libre la plus basse, puis la pose.
 * @param {object} s état de la partie
 */
function chuteImmediate(s) {
  const p = s.piece;
  while (libre(s.plateau, p.type, p.rot, p.x, p.y + 1)) p.y++;
  pose(s);
}

/**
 * Rangée où la pièce tomberait (fantôme).
 * @param {object} s état de la partie
 * @returns {number} rangée d'origine du fantôme
 */
function fantome(s) {
  const p = s.piece;
  let y = p.y;
  while (libre(s.plateau, p.type, p.rot, p.x, y + 1)) y++;
  return y;
}

/**
 * Verrouille la pièce sur le plateau, efface les lignes pleines et compte les points.
 * La pièce suivante n'apparaît qu'après DELAI_APPARITION secondes (cadence serveur).
 * @param {object} s état de la partie
 */
function pose(s) {
  const p = s.piece;
  for (const [dx, dy] of FORMES[p.type][p.rot]) s.plateau[p.y + dy][p.x + dx] = p.type + 1;
  s.piece = null;
  s.poses++;
  s.score += 1;
  s.attente = DELAI_APPARITION; s.chute = 0; s.sol = 0;
  let k = 0;
  for (let y = RANGEES - 1; y >= 0; y--) {
    if (s.plateau[y].every((c) => c)) { s.plateau.splice(y, 1); k++; }
  }
  for (let i = 0; i < k; i++) s.plateau.unshift(new Array(COLONNES).fill(0));
  s.lignes += k;
  s.score += POINTS_LIGNES[k];
}

/**
 * Dessine une case : pleine à reflet pixel, ou cœur rouge avec le code « coeurs ».
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x coin haut gauche
 * @param {number} y coin haut gauche
 * @param {number} t type de pièce (0 à 6), indice de couleur
 * @param {boolean} coeurs vrai pour dessiner un cœur
 */
function dessineCase(ctx, x, y, t, coeurs) {
  if (coeurs) { coeur(ctx, x + CASE / 2, y + CASE / 2, 6.5); return; }
  ctx.fillStyle = COULEURS[t];
  ctx.fillRect(x, y, CASE, CASE);
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.fillRect(x + 3, y + 3, 10, 2); ctx.fillRect(x + 3, y + 3, 2, 10);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.fillRect(x, y + CASE - 3, CASE, 3); ctx.fillRect(x + CASE - 3, y, 3, CASE);
}

/**
 * Contour pâle d'une case du fantôme.
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x coin haut gauche
 * @param {number} y coin haut gauche
 */
function contour(ctx, x, y) {
  ctx.strokeStyle = 'rgba(242,239,234,.4)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 1, y + 1, CASE - 2, CASE - 2);
}

/**
 * Boîte englobante d'une forme, en cases : [colonne, rangée, largeur, hauteur].
 * @param {number[][]} cases décalages [colonne, rangée]
 * @returns {number[]} boîte
 */
function boite(cases) {
  const xs = cases.map((c) => c[0]), ys = cases.map((c) => c[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0 + 1, Math.max(...ys) - y0 + 1];
}

export const JEU = {
  id: 'tetris',
  titre: 'Tetris du gang',
  directions: true,
  action: true,
  tapeSeul: true,
  aide: 'Clavier : ← → déplacent la pièce (tenues, elle file), ↑ ou espace la tournent, ↓ tenue la fait descendre vite. Souris : un clic tourne la pièce. Doigt : une tape tourne la pièce, glisser à gauche ou à droite la décale d’une case, glisser vers le bas la fait tomber d’un coup.',
  init: ({ reduit }) => {
    const s = {
      reduit, lent: reduit ? 1.4 : 1, plateau: vide(), sac: [], suivante: 0, piece: null,
      attente: 0, chute: 0, sol: 0, reprises: 0, fl: 0, rep: 0,
      lignes: 0, poses: 0, debordements: 0, score: 0, fin: false,
    };
    s.suivante = tirer(s);
    return s;
  },
  update(s, dt, e) {
    if (s.fin) return;
    if (!s.piece) {
      s.attente -= dt;
      if (s.attente > 0) { s.fl = e.fleche; s.rep = 0; return; }
      apparait(s);
      if (s.fin) return;
    }
    if (e.action || e.dir === 'haut') tournePiece(s);
    // Clavier (pas et dir sont donnés ensemble à l'appui) ou glisser du doigt (dir seul) : un seul déplacement.
    const d = e.pas || (e.dir === 'gauche' ? -1 : e.dir === 'droite' ? 1 : 0);
    if (d) deplace(s, d);
    if (e.fleche !== s.fl) { s.fl = e.fleche; s.rep = DAS; }
    else if (e.fleche) { s.rep -= dt; while (s.rep <= 0) { s.rep += CADENCE_REPETITION; deplace(s, e.fleche); } }
    if (e.dir === 'bas' && e.glisse) { chuteImmediate(s); return; }
    const p = s.piece;
    const inter = intervalleChute(s);
    const vite = e.vertical > 0 ? Math.min(inter, DESCENTE_RAPIDE) : inter;
    s.chute += dt;
    while (s.chute >= vite) {
      if (!libre(s.plateau, p.type, p.rot, p.x, p.y + 1)) { s.chute = 0; break; }
      p.y++;
      s.chute -= vite;
    }
    if (libre(s.plateau, p.type, p.rot, p.x, p.y + 1)) { s.sol = 0; return; }
    s.sol += dt;
    if (s.sol >= DELAI_POSE) pose(s);
  },
  draw(ctx, s) {
    const coeurs = !!s.triche?.coeurs;
    // Plateau
    ctx.fillStyle = '#0E0E10';
    ctx.fillRect(BX, BY, COLONNES * CASE, RANGEES * CASE);
    ctx.fillStyle = 'rgba(242,239,234,.06)';
    for (let x = 1; x < COLONNES; x++) ctx.fillRect(BX + x * CASE, BY, 1, RANGEES * CASE);
    for (let y = 1; y < RANGEES; y++) ctx.fillRect(BX, BY + y * CASE, COLONNES * CASE, 1);
    for (let y = 0; y < RANGEES; y++) {
      for (let x = 0; x < COLONNES; x++) {
        const v = s.plateau[y][x];
        if (v) dessineCase(ctx, BX + x * CASE, BY + y * CASE, v - 1, coeurs);
      }
    }
    const p = s.piece;
    if (p) {
      const gy = fantome(s);
      if (gy !== p.y) for (const [dx, dy] of FORMES[p.type][p.rot]) contour(ctx, BX + (p.x + dx) * CASE, BY + (gy + dy) * CASE);
      for (const [dx, dy] of FORMES[p.type][p.rot]) dessineCase(ctx, BX + (p.x + dx) * CASE, BY + (p.y + dy) * CASE, p.type, coeurs);
    }
    ctx.strokeStyle = '#9E3543'; ctx.lineWidth = 2;
    ctx.strokeRect(BX - 1, BY - 1, COLONNES * CASE + 2, RANGEES * CASE + 2);
    // Panneau : pièce suivante et nombre de lignes
    ctx.textAlign = 'left';
    ctx.fillStyle = COULEURS[6];
    ctx.font = '12px "Archivo Black", system-ui, sans-serif';
    ctx.fillText('SUIVANTE', PX, 62);
    ctx.strokeStyle = 'rgba(242,239,234,.2)'; ctx.lineWidth = 1;
    ctx.strokeRect(PX + 0.5, 70.5, PANNEAU - 1, 83);
    const forme = FORMES[s.suivante][0];
    const [x0, y0, lw, lh] = boite(forme);
    const ox = Math.round(PX + (PANNEAU - lw * CASE) / 2 - x0 * CASE);
    const oy = Math.round(70 + (84 - lh * CASE) / 2 - y0 * CASE);
    for (const [dx, dy] of forme) dessineCase(ctx, ox + dx * CASE, oy + dy * CASE, s.suivante, coeurs);
    ctx.fillStyle = COULEURS[6];
    ctx.font = '12px "Archivo Black", system-ui, sans-serif';
    ctx.fillText('LIGNES', PX, 200);
    ctx.fillStyle = '#F2EFEA';
    ctx.font = '26px "Archivo Black", system-ui, sans-serif';
    ctx.fillText(String(s.lignes), PX, 232);
    // Niveau de vitesse : un par tranche de 10 lignes.
    ctx.fillStyle = COULEURS[6];
    ctx.font = '12px "Archivo Black", system-ui, sans-serif';
    ctx.fillText('VITESSE', PX, 270);
    ctx.fillStyle = '#F2EFEA';
    ctx.font = '26px "Archivo Black", system-ui, sans-serif';
    ctx.fillText(String(Math.floor(s.lignes / 10) + 1), PX, 302);
    ctx.textAlign = 'start';
  },
  score: (s) => s.score,
  /* Pas de vies : la partie finit quand une nouvelle pièce ne peut pas apparaître. */
  vies: () => null,
  fini: (s) => s.fin,
};
