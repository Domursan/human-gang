// ===== Humane Gang — arcade : « Space Invaders » =====
/*
 * Rôle : une armée de cornichons en pixel art (5 rangées de 8) avance en bloc, de côté, puis descend d'un cran au bord,
 * de plus en plus vite quand il en reste peu. Le vaisseau tire vers le haut : un seul tir à la fois, au plus un toutes
 * les 0,35 s. Les cornichons lâchent des gouttes de vinaigre : chaque goutte qui touche le vaisseau coûte une vie
 * (trois vies). Trois abris en briques sable s'abîment sous les tirs et sous les cornichons. Parfois une soucoupe-raclette
 * passe en haut (50 points). Points : 30 pour la rangée du haut, 20 pour les deux suivantes, 10 pour les deux du bas.
 * Quand tout est détruit, vague suivante (plus rapide : +7 % par vague, sans plafond ; la vague affichée est le palier). La partie finit à zéro vie, ou quand les cornichons
 * atteignent le bas. Pas de limite de temps.
 * Codes de triche (s.triche, eggs/arcade.js) : coeurs = les cornichons deviennent des cœurs et ne tirent plus, le vaisseau
 * aussi devient un cœur ; immortel = les gouttes ne font rien, et si les cornichons atteignent le bas, la vague recommence.
 * Commandes : souris ou doigt (le vaisseau suit), flèches gauche et droite ; tir à l'appui (espace, flèche haut, clic ou
 * doigt), tir continu tant que la touche ou le doigt reste appuyé.
 * Animation réduite : formation plus lente, pas de secousse ni d'explosions.
 * Moteur : eggs/arcade.js (creeArcade ; jeu.action = true).
 * Exporte : JEU (règles du mini-jeu pour creeArcade).
 */
import { W, H, coeur } from './arcade.js';

const VIES = 3;
/** Accélération par vague : +7 %, sans plafond (le plancher technique de la formation reste en place). */
const HAUSSE = 0.07;
/* Formation : 8 colonnes × 5 rangées ; cornichon de 7 × 10 pixels à l'échelle 3. */
const COLS = 8, LIGNES = 5, TOTAL = COLS * LIGNES;
const PIX = 3, AW = 7 * PIX, AH = 10 * PIX;
const ESP_X = 34, ESP_Y = 36, X0 = 50, Y0 = 70;
const PAS = 8, DECAL = 12;
/** Quand le bas de la formation atteint cette ligne, les cornichons ont gagné. */
const LIGNE_BAS = H - 62;
/** Points par rangée, de la plus haute à la plus basse. */
const VALEUR = [30, 20, 20, 10, 10];
/* Vaisseau et tirs */
const VAISS_Y = H - 40, VAISS_L = 9 * PIX, VAISS_H = 5 * PIX, MARGE = 16;
const VIT_VAISS = 220, VIT_TIR = 200, CADENCE = 0.35;
/* Abris */
const ABRI_Y = H - 112, CELL = 4, ABRI_L = 11 * CELL;
/* Soucoupe-raclette */
const SOUC_Y = 40, SOUC_VIT = 70, SOUC_POINTS = 50;
const OR = '#FBD32D', SABLE = '#E2C77E', ROUGE = '#9E3543', VINAIGRE = '#D9F0A0', FROMAGE = '#FCA301';
const FLASH = 'rgba(224, 64, 75, ';

/* Sprites en pixel art (une lettre par pixel, voir PAL_*). */
const PAL_CORN = { o: '#1F3A18', g: '#5FA83A', l: '#A8DC74', d: '#2F6B2A', k: '#0E0E10' };
const CORNICHON = [
  '..ooo..',
  '.ogggo.',
  'oglllgo',
  'ogkgkgo',
  'ogggggo',
  'ogdgdgo',
  'oggdggo',
  'ogdggdo',
  '.odddo.',
  '..ooo..',
];
const PAL_VAISS = { c: SABLE, r: ROUGE };
const VAISSEAU = [
  '....c....',
  '...ccc...',
  '..rrrrr..',
  'rrrrrrrrr',
  'rrrrrrrrr',
];
/** Masque d'un abri : « # » = une brique (deux coups pour la détruire). */
const MASQUE_ABRI = [
  '..#######..',
  '.#########.',
  '###########',
  '###########',
  '###########',
  '###.....###',
  '###.....###',
];
/** Couleur d'une brique selon ses coups restants (index = points de vie). */
const COULEUR_ABRI = [null, '#8A7444', SABLE];

/**
 * Découpe une grille de pixels en rectangles horizontaux de même couleur (un dessin plus léger).
 * @param {string[]} grille lignes de lettres
 * @param {object} palette lettre → couleur
 * @returns {{x: number, y: number, w: number, c: string}[]} segments en pixels de grille
 */
function segments(grille, palette) {
  const out = [];
  grille.forEach((ligne, y) => {
    let i = 0;
    while (i < ligne.length) {
      const c = ligne[i];
      let j = i;
      while (j < ligne.length && ligne[j] === c) j++;
      if (palette[c]) out.push({ x: i, y, w: j - i, c: palette[c] });
      i = j;
    }
  });
  return out;
}
const SEG_CORN = segments(CORNICHON, PAL_CORN);
const SEG_VAISS = segments(VAISSEAU, PAL_VAISS);

/**
 * Dessine un sprite découpé en segments.
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {{x: number, y: number, w: number, c: string}[]} segs segments du sprite
 * @param {number} x coin haut gauche
 * @param {number} y coin haut gauche
 * @param {number} p taille d'un pixel
 */
function dessineSegments(ctx, segs, x, y, p) {
  for (const g of segs) { ctx.fillStyle = g.c; ctx.fillRect(x + g.x * p, y + g.y * p, g.w * p, p); }
}

/**
 * Borne une valeur entre deux bornes.
 * @param {number} v valeur
 * @param {number} a minimum
 * @param {number} b maximum
 * @returns {number}
 */
const borne = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Deux rectangles (x, y, largeur, hauteur) se chevauchent-ils ?
 * @returns {boolean}
 */
function chevauche(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Remet la formation en place : tous les cornichons vivants, au départ, à droite.
 * @returns {{vivants: boolean[], fx: number, fy: number, sens: number, tick: number}}
 */
function formation() {
  return { vivants: new Array(TOTAL).fill(true), fx: X0, fy: Y0, sens: 1, tick: 0 };
}

/**
 * Crée les trois abris, briques pleines (deux coups chacune).
 * @returns {{x: number, y: number, hp: number}[]}
 */
function creeAbris() {
  const briques = [];
  for (let k = 0; k < 3; k++) {
    const gauche = Math.round((W * (k + 1)) / 4 - ABRI_L / 2);
    MASQUE_ABRI.forEach((ligne, j) => {
      for (let i = 0; i < ligne.length; i++) if (ligne[i] === '#') briques.push({ x: gauche + i * CELL, y: ABRI_Y + j * CELL, hp: 2 });
    });
  }
  return briques;
}

/**
 * Bilan de la formation : nombre de cornichons vivants et colonnes / rangée extrêmes.
 * @param {object} s état de la partie
 * @returns {{n: number, minCol: number, maxCol: number, maxRow: number}}
 */
function bilan(s) {
  let n = 0, minCol = COLS, maxCol = -1, maxRow = -1;
  for (let i = 0; i < TOTAL; i++) {
    if (!s.vivants[i]) continue;
    const c = i % COLS, l = (i / COLS) | 0;
    n++;
    if (c < minCol) minCol = c;
    if (c > maxCol) maxCol = c;
    if (l > maxRow) maxRow = l;
  }
  return { n, minCol, maxCol, maxRow };
}

/**
 * Délai entre deux pas de la formation : court quand il reste peu de cornichons, plus court de 7 % à chaque vague (sans plafond).
 * @param {object} s état de la partie
 * @param {number} n cornichons vivants
 * @returns {number} secondes
 */
function intervalle(s, n) {
  const facteur = (1 / (1 + HAUSSE)) ** (s.vague - 1);
  return Math.max(0.03, (0.02 + (0.45 * n) / TOTAL) * facteur * (s.reduit ? 1.4 : 1));
}

/**
 * Fait avancer la formation d'un pas : de côté, ou d'un cran vers le bas et sens inversé au bord.
 * @param {object} s état de la partie
 * @param {{minCol: number, maxCol: number}} b bilan de la formation
 */
function avance(s, b) {
  const gauche = s.fx + b.minCol * ESP_X, droite = s.fx + b.maxCol * ESP_X + AW;
  if ((s.sens > 0 && droite + PAS > W - 8) || (s.sens < 0 && gauche - PAS < 8)) {
    s.fy += DECAL;
    s.sens = -s.sens;
  } else {
    s.fx += s.sens * PAS;
  }
}

/**
 * Un cornichon vivant chevauche-t-il la brique ? (les cornichons rongent les abris qu'ils touchent).
 * @param {object} s état de la partie
 * @param {{x: number, y: number}} c brique
 * @returns {boolean}
 */
function cornichonsSur(s, c) {
  for (let i = 0; i < TOTAL; i++) {
    if (!s.vivants[i]) continue;
    const x = s.fx + (i % COLS) * ESP_X, y = s.fy + ((i / COLS) | 0) * ESP_Y;
    if (chevauche(x, y, AW, AH, c.x, c.y, CELL, CELL)) return true;
  }
  return false;
}

/**
 * Un projectile (rectangle) abîme la première brique qu'il touche.
 * @param {object} s état de la partie
 * @param {number} x coin gauche du projectile
 * @param {number} y coin haut du projectile
 * @param {number} w largeur
 * @param {number} h hauteur
 * @returns {boolean} true si une brique a été touchée
 */
function frappeAbri(s, x, y, w, h) {
  for (let i = 0; i < s.abris.length; i++) {
    const c = s.abris[i];
    if (chevauche(x, y, w, h, c.x, c.y, CELL, CELL)) {
      c.hp--;
      if (c.hp <= 0) s.abris.splice(i, 1);
      return true;
    }
  }
  return false;
}

/**
 * Petit éclat à l'impact (pas d'éclat en animation réduite).
 * @param {object} s état de la partie
 * @param {number} x centre
 * @param {number} y centre
 */
function explose(s, x, y) {
  if (!s.reduit) s.explos.push({ x, y, vie: 0.35 });
}

/**
 * Le tir du joueur touche-t-il un cornichon, la soucoupe ou un abri ? Si oui, il est compté et disparaît.
 * @param {object} s état de la partie
 * @returns {boolean} true si le tir a touché quelque chose
 */
function tirTouche(s) {
  const x = s.tir.x - 1, y = s.tir.y;
  for (let i = 0; i < TOTAL; i++) {
    if (!s.vivants[i]) continue;
    const ax = s.fx + (i % COLS) * ESP_X, ay = s.fy + ((i / COLS) | 0) * ESP_Y;
    if (chevauche(x, y, 2, 10, ax, ay, AW, AH)) {
      s.vivants[i] = false;
      s.score += VALEUR[(i / COLS) | 0];
      explose(s, ax + AW / 2, ay + AH / 2);
      return true;
    }
  }
  if (s.soucoupe && chevauche(x, y, 2, 10, s.soucoupe.x - 15, SOUC_Y - 6, 30, 12)) {
    s.score += SOUC_POINTS;
    explose(s, s.soucoupe.x, SOUC_Y);
    s.soucoupe = null;
    return true;
  }
  return frappeAbri(s, x, y, 2, 10);
}

/**
 * Nombre maximum de gouttes en l'air (augmente un peu avec les vagues).
 * @param {object} s état de la partie
 * @returns {number}
 */
function gouttesMax(s) {
  return Math.min(5, 3 + Math.floor((s.vague - 1) / 2));
}

/**
 * Vitesse de chute des gouttes de vinaigre (pixels par seconde) : +7 % par vague, sans plafond.
 * @param {object} s état de la partie
 * @returns {number}
 */
function vitesseGoutte(s) {
  return 120 * (1 + HAUSSE) ** (s.vague - 1) * (s.reduit ? 0.7 : 1);
}

/**
 * Délai avant le prochain tir des cornichons (secondes), plus court de 7 % à chaque vague (sans plafond).
 * @param {object} s état de la partie
 * @returns {number}
 */
function prochainTir(s) {
  const r = (1 + HAUSSE) ** (s.vague - 1);
  return ((0.8 + Math.random() * 0.9) / r) * (s.reduit ? 1.3 : 1);
}

/**
 * Un cornichon tout en bas de sa colonne (au hasard parmi les colonnes vivantes) lâche une goutte de vinaigre.
 * @param {object} s état de la partie
 */
function lacheGoutte(s) {
  if (s.gouttes.length >= gouttesMax(s)) return;
  const colonnes = [];
  for (let c = 0; c < COLS; c++) {
    for (let l = LIGNES - 1; l >= 0; l--) {
      if (s.vivants[l * COLS + c]) { colonnes.push([c, l]); break; }
    }
  }
  if (!colonnes.length) return;
  const [c, l] = colonnes[Math.floor(Math.random() * colonnes.length)];
  s.gouttes.push({ x: s.fx + c * ESP_X + AW / 2, y: s.fy + l * ESP_Y + AH });
}

/**
 * Une goutte touche le vaisseau : une vie de moins (sauf code « immortel »), flash rouge et secousse.
 * @param {object} s état de la partie
 */
function perdUneVie(s) {
  s.vies--;
  s.flash = 0.35;
  if (!s.reduit) s.secousse = 0.3;
}

/**
 * Vague suivante : formation pleine, plus rapide ; les tirs en cours et les gouttes disparaissent.
 * @param {object} s état de la partie
 */
function vagueSuivante(s) {
  s.vague++;
  Object.assign(s, formation());
  s.gouttes = [];
  s.tir = null;
  s.attente = 1.2;
}

/**
 * Trace la soucoupe-raclette : galette jaune, dôme de fromage fondu et gouttes de raclette.
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x centre
 * @param {number} y centre
 */
function dessineSoucoupe(ctx, x, y) {
  ctx.fillStyle = OR;
  ctx.beginPath(); ctx.ellipse(x, y, 15, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = FROMAGE; ctx.fillRect(x - 7, y - 7, 14, 6);
  ctx.fillStyle = SABLE; ctx.fillRect(x - 10, y - 2, 20, 2);
  ctx.fillStyle = ROUGE; ctx.fillRect(x - 3, y - 6, 2, 2); ctx.fillRect(x + 2, y - 5, 2, 2);
  ctx.fillStyle = FROMAGE; ctx.fillRect(x - 12, y + 3, 2, 4); ctx.fillRect(x + 10, y + 3, 2, 4);
}

export const JEU = {
  id: 'invaders',
  titre: 'Space Invaders',
  action: true,
  aide: 'Souris, doigt ou flèches gauche et droite : déplace le vaisseau. Espace, flèche haut, clic ou doigt : tire (maintiens pour tirer sans arrêt). Évite les gouttes de vinaigre.',
  init: ({ reduit }) => ({
    reduit, score: 0, vies: VIES, vague: 1, ecoule: 0,
    x: W / 2, cible: W / 2, cd: 0, tir: null,
    gouttes: [], abris: creeAbris(), explos: [],
    soucoupe: null, prochaineSoucoupe: 14 + Math.random() * 6,
    tirE: 1.2, attente: 0.8, flash: 0, secousse: 0, perdu: false,
    ...formation(),
  }),
  update(s, dt, e) {
    if (s.perdu) return;
    s.ecoule += dt;
    s.flash = Math.max(0, s.flash - dt);
    s.secousse = Math.max(0, s.secousse - dt);
    // Code « domu » : plus aucune goutte, même celles déjà en l'air.
    if (s.triche?.coeurs && s.gouttes.length) s.gouttes = [];

    // Vaisseau : suit le pointeur (cible) ou les flèches (fleche).
    if (e.cible !== null) s.cible = borne(e.cible, MARGE, W - MARGE);
    if (e.fleche) s.cible = borne(s.cible + e.fleche * VIT_VAISS * dt, MARGE, W - MARGE);
    s.x += (s.cible - s.x) * Math.min(1, dt * 16);

    // Tir : à l'appui, puis en continu ; un seul tir à l'écran, au plus un toutes les 0,35 s.
    s.cd = Math.max(0, s.cd - dt);
    if ((e.action || e.tenu) && !s.tir && s.cd <= 0) { s.tir = { x: s.x, y: VAISS_Y - 10 }; s.cd = CADENCE; }
    if (s.tir) {
      s.tir.y -= VIT_TIR * dt;
      if (s.tir.y < -10 || tirTouche(s)) s.tir = null;
    }

    // Tout détruit : vague suivante.
    const b = bilan(s);
    if (b.n === 0) { vagueSuivante(s); return; }

    // Formation : un pas toutes les quelques images.
    if (s.attente > 0) s.attente = Math.max(0, s.attente - dt);
    else {
      s.tick -= dt;
      if (s.tick <= 0) { s.tick = intervalle(s, b.n); avance(s, b); }
    }

    // Les cornichons atteignent le bas : fin de partie, ou vague recommencée (code « immortel »).
    const bas = s.fy + b.maxRow * ESP_Y + AH;
    if (bas >= LIGNE_BAS) {
      if (!s.triche?.immortel) { s.perdu = true; return; }
      Object.assign(s, formation());
      s.gouttes = [];
      s.tir = null;
      s.attente = 0.8;
      return;
    }
    if (bas >= ABRI_Y) s.abris = s.abris.filter((c) => !cornichonsSur(s, c));

    // Soucoupe : passe en haut de temps en temps.
    if (s.soucoupe) {
      s.soucoupe.x += s.soucoupe.v * dt;
      if (s.soucoupe.x < -30 || s.soucoupe.x > W + 30) s.soucoupe = null;
    } else {
      s.prochaineSoucoupe -= dt;
      if (s.prochaineSoucoupe <= 0) {
        const depuisGauche = Math.random() < 0.5;
        s.soucoupe = { x: depuisGauche ? -20 : W + 20, v: depuisGauche ? SOUC_VIT : -SOUC_VIT };
        s.prochaineSoucoupe = 16 + Math.random() * 10;
      }
    }

    // Tirs des cornichons (aucun en code « domu », ni pendant une vague qui commence).
    s.tirE -= dt;
    if (s.tirE <= 0) {
      s.tirE = prochainTir(s);
      if (!s.triche?.coeurs && s.attente <= 0) lacheGoutte(s);
    }

    // Gouttes : chutent ; une touche le vaisseau (une vie) ou un abri (une brique).
    const vG = vitesseGoutte(s), immortel = !!s.triche?.immortel;
    s.gouttes = s.gouttes.filter((g) => {
      g.y += vG * dt;
      if (chevauche(g.x - 2, g.y - 4, 4, 8, s.x - VAISS_L / 2, VAISS_Y, VAISS_L, VAISS_H)) {
        if (!immortel) perdUneVie(s);
        return false;
      }
      if (frappeAbri(s, g.x - 2, g.y - 4, 4, 8)) return false;
      return g.y < H + 10;
    });

    for (const p of s.explos) p.vie -= dt;
    s.explos = s.explos.filter((p) => p.vie > 0);
  },
  draw(ctx, s) {
    const dx = s.secousse > 0 ? (Math.random() - 0.5) * 8 : 0;
    ctx.save();
    ctx.translate(dx, 0);
    for (const c of s.abris) { ctx.fillStyle = COULEUR_ABRI[c.hp]; ctx.fillRect(c.x, c.y, CELL - 1, CELL - 1); }
    for (let i = 0; i < TOTAL; i++) {
      if (!s.vivants[i]) continue;
      const x = s.fx + (i % COLS) * ESP_X, y = s.fy + ((i / COLS) | 0) * ESP_Y;
      if (s.triche?.coeurs) coeur(ctx, x + AW / 2, y + AH / 2, 10);
      else dessineSegments(ctx, SEG_CORN, x, y, PIX);
    }
    ctx.fillStyle = VINAIGRE;
    for (const g of s.gouttes) ctx.fillRect(g.x - 2, g.y - 4, 4, 8);
    if (s.soucoupe) dessineSoucoupe(ctx, s.soucoupe.x, SOUC_Y);
    if (s.tir) { ctx.fillStyle = OR; ctx.fillRect(s.tir.x - 1, s.tir.y, 2, 10); }
    if (s.triche?.coeurs) coeur(ctx, s.x, VAISS_Y + VAISS_H / 2, 11);
    else dessineSegments(ctx, SEG_VAISS, s.x - VAISS_L / 2, VAISS_Y, PIX);
    for (const p of s.explos) { ctx.globalAlpha = Math.max(0, p.vie / 0.35); ctx.fillStyle = OR; ctx.fillRect(p.x - 3, p.y - 3, 6, 6); }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (s.attente > 0) {
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, H / 2 - 26, W, 52);
      ctx.fillStyle = '#F2EFEA'; ctx.font = '18px "Archivo Black", system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`Vague ${s.vague}`, W / 2, H / 2 + 7);
      ctx.textAlign = 'start';
    }
    if (s.flash > 0) { ctx.fillStyle = `${FLASH}${s.flash})`; ctx.fillRect(0, 0, W, H); }
  },
  score: (s) => s.score,
  vies: (s) => ({ left: s.vies, max: VIES }),
  fini: (s) => s.perdu || s.vies <= 0,
};
