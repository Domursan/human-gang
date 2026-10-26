// ===== Humane Gang — arcade : « Snake » (le serpent des raclettes) =====
/*
 * Rôle : le serpent avance sur une grille et tourne à chaque flèche, glissement ou appui du doigt (appui : il tourne
 * vers le côté appuyé par rapport à la tête). Il mange des raclettes (fromage fondu sur une pomme de terre) : +10 points
 * et il grandit. Un mur ou sa propre queue finit la partie. Pas de limite de temps.
 * Cadence : une raclette n'apparaît qu'1,7 s après la précédente mangée (REPAS_MIN) : au plus un repas toutes les 1,7 s,
 * soit 5,9 points par seconde au plus, sous le plafond serveur de 12 points par seconde. Un repas seul fait 10 points
 * dans une seconde, jamais deux.
 * Vitesse : le serpent avance plus vite au fil du temps (plafonné après 50 s).
 * Codes de triche (s.triche, eggs/arcade.js) : coeurs = la nourriture devient des cœurs ; immortel = les murs font passer
 * de l'autre côté et se mordre ne tue pas.
 * Moteur : eggs/arcade.js (creeArcade ; jeu « directions » et action pour tourner au doigt). Animation réduite : pas plus lent.
 * Exporte : JEU (règles du mini-jeu pour creeArcade), COLS et LIGNES (taille de la grille).
 */
import { W, H, coeur } from './arcade.js';

/** Grille : cases de 18 px, 18 colonnes × 20 lignes, centrée dans le canevas. */
export const COLS = 18, LIGNES = 20, CASE = 18;
const OX = (W - COLS * CASE) / 2, OY = (H - LIGNES * CASE) / 2;
const POINTS = 10;
/** Délai minimal entre deux raclettes (secondes) : au plus un repas toutes les 1,7 s. */
const REPAS_MIN = 1.7;
/** Au-delà de cette seconde, le serpent n'accélère plus. */
const PLAFOND_VITESSE = 50;
const ARC = ['#FE3104', '#FCA301', '#FBD32D', '#159946', '#2B5AE2', '#4E2398'];
const DIRS = { haut: { x: 0, y: -1 }, bas: { x: 0, y: 1 }, gauche: { x: -1, y: 0 }, droite: { x: 1, y: 0 } };
const FOND_A = '#171528', FOND_B = '#1C1A33', PLATEAU = '#0E0E10', SABLE = '#E2C77E';
const RACLETTE = ['..JJ.j', '.JJJJJ', 'JJjJJJ', 'JJJJjJ', 'PPpPPp', '.PpPP.'];
const COULEUR_RACLETTE = { J: '#FBD32D', j: '#E0A526', P: '#B9854A', p: '#7A4A22' };

/**
 * Mélange deux couleurs hexadécimales.
 * @param {string} hex couleur de départ (#RRGGBB)
 * @param {string} vers couleur d'arrivée (#RRGGBB)
 * @param {number} k part de la couleur d'arrivée, de 0 à 1
 * @returns {string} couleur #RRGGBB
 */
function melange(hex, vers, k) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(vers.slice(i, i + 2), 16));
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join('');
}
/** Ombre et tête calculées une fois (pas d'allocation par image). */
const OMBRE = ARC.map((c) => melange(c, '#000000', 0.3));
const TETE = melange(ARC[0], '#FFFFFF', 0.4);

/**
 * Trace une raclette en pixel art (6 × 6 pixels de 3 px) dans la case dont le coin haut gauche est (x, y).
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x coin de la case
 * @param {number} y coin de la case
 */
function raclette(ctx, x, y) {
  for (let r = 0; r < RACLETTE.length; r++) {
    const ligne = RACLETTE[r];
    for (let c = 0; c < ligne.length; c++) {
      const couleur = COULEUR_RACLETTE[ligne[c]];
      if (!couleur) continue;
      ctx.fillStyle = couleur;
      ctx.fillRect(x + c * 3, y + r * 3, 3, 3);
    }
  }
}

/**
 * Tourne le serpent : la commande est mise en file (deux au plus) ; demi-tour et répétition sont refusés.
 * @param {object} s état de la partie
 * @param {{x: number, y: number}} d direction demandée
 */
function tourne(s, d) {
  if (s.file.length >= 2) return;
  const derniere = s.file.length ? s.file[s.file.length - 1] : s.dir;
  if ((d.x === derniere.x && d.y === derniere.y) || (d.x === -derniere.x && d.y === -derniere.y)) return;
  s.file.push(d);
}

/**
 * Place une raclette sur une case libre (pas sur le serpent).
 * @param {object} s état de la partie
 */
function placeRaclette(s) {
  for (let essai = 0; essai < 300; essai++) {
    const x = Math.floor(Math.random() * COLS), y = Math.floor(Math.random() * LIGNES);
    if (!s.corps.some((c) => c.x === x && c.y === y)) { s.nourriture = { x, y }; return; }
  }
}

/**
 * Un pas du serpent : applique la commande en attente, gère murs, queue et repas.
 * @param {object} s état de la partie
 */
function avance(s) {
  if (s.file.length) s.dir = s.file.shift();
  const t = s.corps[0];
  let x = t.x + s.dir.x, y = t.y + s.dir.y;
  if (x < 0 || y < 0 || x >= COLS || y >= LIGNES) {
    if (!s.triche?.immortel) { s.mort = 'Aïe, un mur !'; s.secousse = s.reduit ? 0 : 0.3; return; }
    x = (x + COLS) % COLS; y = (y + LIGNES) % LIGNES; // immortel : de l'autre côté
  }
  const mange = !!s.nourriture && s.nourriture.x === x && s.nourriture.y === y;
  // La queue quitte sa case, sauf si le serpent mange (il grandit).
  const obstacles = mange ? s.corps : s.corps.slice(0, -1);
  if (!s.triche?.immortel && obstacles.some((c) => c.x === x && c.y === y)) { s.mort = 'Tu t’es mordu la queue !'; return; }
  s.corps.unshift({ x, y });
  if (mange) { s.score += POINTS; s.nourriture = null; s.reserve = REPAS_MIN; }
  else s.corps.pop();
}

export const JEU = {
  id: 'snake',
  titre: 'Snake',
  directions: true,
  action: true,
  aide: 'Flèches ou glisse le doigt pour tourner ; touche le côté où tu veux aller. Mange les raclettes, évite les murs et ta queue.',
  init: ({ reduit }) => {
    const milieu = Math.floor(COLS / 2), ligne = Math.floor(LIGNES / 2);
    return {
      reduit, pas: reduit ? 0.26 : 0.2, pasMin: reduit ? 0.14 : 0.09,
      ecoule: 0, aTemps: 0, score: 0,
      corps: [{ x: milieu, y: ligne }, { x: milieu - 1, y: ligne }, { x: milieu - 2, y: ligne }], // tête en premier
      dir: DIRS.droite, file: [], nourriture: null, reserve: REPAS_MIN, mort: null, secousse: 0,
    };
  },
  update(s, dt, e) {
    if (s.mort) { s.secousse = Math.max(0, s.secousse - dt); return; }
    s.ecoule += dt;
    if (e.dir) tourne(s, DIRS[e.dir]);
    if (e.action && e.cible !== null && e.cibleY !== null) {
      // Appui : tourne vers le côté appuyé, par rapport à la tête (au doigt).
      const t = s.corps[0];
      const dx = e.cible - (OX + t.x * CASE + CASE / 2), dy = e.cibleY - (OY + t.y * CASE + CASE / 2);
      tourne(s, Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? DIRS.gauche : DIRS.droite) : (dy < 0 ? DIRS.haut : DIRS.bas));
    }
    if (!s.nourriture) { s.reserve -= dt; if (s.reserve <= 0) placeRaclette(s); }
    const pas = Math.max(s.pasMin, s.pas - (Math.min(s.ecoule, PLAFOND_VITESSE) / PLAFOND_VITESSE) * (s.pas - s.pasMin));
    s.aTemps += dt;
    while (s.aTemps >= pas && !s.mort) { s.aTemps -= pas; avance(s); }
  },
  draw(ctx, s) {
    const dx = s.secousse > 0 ? (Math.random() - 0.5) * 8 : 0;
    ctx.save();
    ctx.translate(dx, 0);
    ctx.fillStyle = PLATEAU; ctx.fillRect(OX - 6, OY - 6, COLS * CASE + 12, LIGNES * CASE + 12);
    for (let y = 0; y < LIGNES; y++) for (let x = 0; x < COLS; x++) {
      ctx.fillStyle = (x + y) % 2 ? FOND_A : FOND_B;
      ctx.fillRect(OX + x * CASE, OY + y * CASE, CASE, CASE);
    }
    ctx.strokeStyle = SABLE; ctx.lineWidth = 2;
    ctx.strokeRect(OX - 5, OY - 5, COLS * CASE + 10, LIGNES * CASE + 10);
    if (s.nourriture) {
      const f = s.nourriture;
      if (s.triche?.coeurs) coeur(ctx, OX + f.x * CASE + CASE / 2, OY + f.y * CASE + CASE / 2, 7);
      else raclette(ctx, OX + f.x * CASE, OY + f.y * CASE);
    }
    // Corps : couleurs de l'arc-en-ciel du logo qui se succèdent ; la tête est plus claire.
    for (let i = s.corps.length - 1; i >= 0; i--) {
      const c = s.corps[i], px = OX + c.x * CASE, py = OY + c.y * CASE;
      if (i === 0) { ctx.fillStyle = TETE; ctx.fillRect(px + 1, py + 1, CASE - 2, CASE - 2); continue; }
      ctx.fillStyle = ARC[i % ARC.length]; ctx.fillRect(px + 1, py + 1, CASE - 2, CASE - 2);
      ctx.fillStyle = OMBRE[i % ARC.length]; ctx.fillRect(px + 1, py + CASE - 4, CASE - 2, 3);
    }
    // Deux yeux à l'avant de la tête, dans le sens de la marche.
    const t = s.corps[0], hx = OX + t.x * CASE + CASE / 2, hy = OY + t.y * CASE + CASE / 2;
    const d = s.dir, perp = d.x !== 0 ? [0, 1] : [1, 0];
    for (const k of [-1, 1]) {
      const cx = hx + d.x * 4 + perp[0] * k * 4, cy = hy + d.y * 4 + perp[1] * k * 4;
      ctx.fillStyle = '#F2EFEA'; ctx.fillRect(cx - 3, cy - 3, 6, 6);
      ctx.fillStyle = '#0E0E10'; ctx.fillRect(cx - 1 + d.x, cy - 1 + d.y, 2, 2);
    }
    if (s.mort) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, H / 2 - 34, W, 68);
      ctx.fillStyle = '#F2EFEA'; ctx.font = '22px "Archivo Black", system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(s.mort, W / 2, H / 2 + 8);
      ctx.textAlign = 'start';
    }
    ctx.restore();
  },
  score: (s) => s.score,
  /* Pas de vies : la partie finit au premier mur ou au premier coup de queue. */
  vies: () => null,
  fini: (s) => s.mort !== null,
};
