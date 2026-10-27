// ===== Humane Gang — arcade : « Flappy Domu » =====
/*
 * Rôle : le cœur du logo bat des ailes entre des tuyaux (sable et ardoise) qui défilent de droite à gauche. Il laisse
 * derrière lui une traînée arc-en-ciel à six bandes qui suit sa trajectoire et s'estompe. 1 point par tuyau franchi.
 * Une seule vie : un contact avec un tuyau, le sol ou le plafond finit la partie. Pas de limite de temps. Le passage
 * rétrécit un peu (jusqu'à 112 px, vers 120 s) et la vitesse monte par paliers de 10 s (+7 %), sans plafond : au départ
 * au plus 0,44 point par seconde (le plafond serveur est de 2 par seconde).
 * Commandes : espace, flèche haut, clic ou appui = battement d'ailes (impulsion vers le haut). Avant le premier
 * battement, le cœur flotte sur place : la gravité attend cet appui.
 * Codes de triche (s.triche, eggs/arcade.js) :
 *   coeurs = plus de tuyaux dangereux : ils deviennent des alignements de deux petits cœurs à ramasser (1 point chacun),
 *   et le héros devient un cœur rouge ; immortel = les tuyaux ne comptent plus, le cœur rebondit sur le sol et le plafond.
 * Animation réduite : tout va un peu plus lentement, pas d'explosion de particules.
 * Moteur : eggs/arcade.js (creeArcade ; jeu.action = true : espace, flèche haut, clic ou appui).
 * Exporte : JEU (règles du mini-jeu pour creeArcade).
 */
import { W, H, coeur } from './arcade.js';

/** Dessus du sol (le sol occupe le bas du canevas). */
const SOL = H - 36;
/** Position horizontale du cœur : il ne bouge pas, le décor défile. */
const HX = 96;
/** Zone de contact du cœur (plus petite que son dessin de 26 × 22). */
const DEMI_W = 10, DEMI_H = 9;
/** Rayon d'attraction d'un cœur ramassé (code « domu »). */
const RAYON_C = 7;
/** Physique (px et secondes) : gravité, impulsion d'un battement, chute maximale. */
const GRAVITE = 900, BATTEMENT = 300, CHUTE_MAX = 520;
/** Distance (px) entre deux tuyaux, largeur d'un tuyau, hauteur de son rebord, débord du rebord. */
const ESPACE = 240, PW = 46, REBORD = 18, DEBORD = 5;
/** Accélération : +7 % de vitesse toutes les 10 s, sans plafond. */
const HAUSSE = 0.07, PALIER_S = 10;
const paliers = (t) => (1 + HAUSSE) ** Math.floor(t / PALIER_S);
/** Au-delà de cette seconde, le passage ne rétrécit plus. */
const PLAFOND = 120;
/** Ouverture d'un passage : de 150 px au départ jusqu'à 112 px. */
const OUVERTURE_MAX = 150, OUVERTURE_MIN = 112;
/** Traînée : six bandes (ordre du logo), épaisseur d'une bande en px. */
const ARC = ['#FE3104', '#FCA301', '#FBD32D', '#159946', '#2B5AE2', '#4E2398'];
const BANDE = 3;
/** Couleurs : cœur (contour noir, intérieur #B0102A), tuyaux sable et ardoise du site. */
const CONTOUR = '#0A0A0C', ROUGE = '#B0102A', REFLET = '#D9405A';
const SABLE = '#E2C77E', SABLE_OMBRE = '#9E8A4E', SABLE_CLAIR = '#F4E6B4';
const ARDOISE = '#4A5263', ARDOISE_CLAIR = '#5E6779', ARDOISE_FONCE = '#2C313D', CONTOUR_TUYAU = '#14122a';
const SOL_TRAIT = '#3A4150';

/**
 * Cœur du logo en pixel art : 13 × 11 pixels, affichés à 2 px par pixel (26 × 22).
 * k = contour noir, r = intérieur, h = reflet, . = vide.
 */
const COEUR_PX = [
  '..kkk...kkk..',
  '.kkrrk.krrkk.',
  'krhrrkkkrrrrk',
  'krrrrrrrrrrrk',
  'kkrrrrrrrrrkk',
  '.krrrrrrrrrk.',
  '..krrrrrrrk..',
  '...krrrrrk...',
  '....krrrk....',
  '.....krk.....',
  '......k......',
];

/**
 * Vitesse de défilement (px/s) selon le temps écoulé : paliers de 10 s (+7 %), sans plafond.
 * @param {number} ecoule secondes de jeu
 * @returns {number}
 */
function vitesse(ecoule) {
  return 105 * paliers(ecoule);
}

/**
 * Crée un tuyau (passage vertical) qui arrive à droite de l'écran.
 * @param {number} ecoule secondes de jeu (le passage rétrécit avec le temps, jusqu'à OUVERTURE_MIN)
 * @returns {{x: number, haut: number, ouverture: number, passe: boolean, coeurs: {y: number, pris: boolean}[]}}
 */
function nouveauTuyau(ecoule) {
  const ouverture = Math.max(OUVERTURE_MIN, OUVERTURE_MAX - Math.min(ecoule, PLAFOND) * 0.38);
  const haut = 30 + Math.random() * (SOL - ouverture - 60);
  const milieu = haut + ouverture / 2;
  return {
    x: W + DEBORD, haut, ouverture, passe: false,
    // Code « domu » : deux petits cœurs au centre du passage, à la place du tuyau.
    coeurs: [{ y: milieu - 20, pris: false }, { y: milieu + 20, pris: false }],
  };
}

/**
 * Dessine le cœur du logo en pixel art, centré en (x, y).
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x centre
 * @param {number} y centre
 */
function coeurPixel(ctx, x, y) {
  const x0 = Math.round(x) - 13, y0 = Math.round(y) - 11;
  for (let j = 0; j < COEUR_PX.length; j++) {
    for (let i = 0; i < 13; i++) {
      const c = COEUR_PX[j][i];
      if (c === '.') continue;
      ctx.fillStyle = c === 'k' ? CONTOUR : c === 'r' ? ROUGE : REFLET;
      ctx.fillRect(x0 + i * 2, y0 + j * 2, 2, 2);
    }
  }
}

/**
 * Dessine le corps d'un tuyau (ardoise, stries, contour sombre).
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x bord gauche
 * @param {number} y haut du corps
 * @param {number} h hauteur du corps
 */
function corps(ctx, x, y, h) {
  if (h <= 0) return;
  ctx.fillStyle = CONTOUR_TUYAU; ctx.fillRect(x - 2, y, PW + 4, h);
  ctx.fillStyle = ARDOISE; ctx.fillRect(x, y, PW, h);
  ctx.fillStyle = ARDOISE_CLAIR;
  for (let i = 8; i < PW - 8; i += 10) ctx.fillRect(x + i, y, 3, h);
  ctx.fillStyle = ARDOISE_FONCE; ctx.fillRect(x + PW - 6, y, 6, h);
}

/**
 * Dessine le rebord (sable) d'un tuyau, plus large que le corps.
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x bord gauche du corps
 * @param {number} y haut du rebord
 */
function rebord(ctx, x, y) {
  ctx.fillStyle = CONTOUR_TUYAU; ctx.fillRect(x - DEBORD - 2, y - 2, PW + 2 * DEBORD + 4, REBORD + 4);
  ctx.fillStyle = SABLE; ctx.fillRect(x - DEBORD, y, PW + 2 * DEBORD, REBORD);
  ctx.fillStyle = SABLE_OMBRE; ctx.fillRect(x - DEBORD, y + REBORD - 4, PW + 2 * DEBORD, 4);
  ctx.fillStyle = SABLE_CLAIR; ctx.fillRect(x - DEBORD + 3, y + 3, 8, 3);
}

/**
 * Dessine un tuyau complet : une partie haute et une partie basse, avec le passage entre les deux.
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {{x: number, haut: number, ouverture: number}} p tuyau
 */
function tuyauDessine(ctx, p) {
  corps(ctx, p.x, 0, p.haut - REBORD);
  rebord(ctx, p.x, p.haut - REBORD);
  const bas = p.haut + p.ouverture;
  rebord(ctx, p.x, bas);
  corps(ctx, p.x, bas + REBORD, SOL - bas - REBORD);
}

/**
 * Dessine le sol défilant (bande sable au-dessus, ardoise foncée, traits qui glissent).
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {{sol: number}} s état de la partie
 */
function sol(ctx, s) {
  ctx.fillStyle = ARDOISE_FONCE; ctx.fillRect(0, SOL, W, H - SOL);
  ctx.fillStyle = SABLE; ctx.fillRect(0, SOL, W, 4);
  ctx.fillStyle = SOL_TRAIT;
  for (let x = -s.sol; x < W; x += 24) ctx.fillRect(x, SOL + 12, 12, 4);
}

/**
 * Dessine la traînée arc-en-ciel : six bandes horizontales qui suivent les anciennes positions du cœur et s'estompent.
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {{x: number, y: number}[]} pts positions, de la plus ancienne à la plus récente
 */
function traineDessine(ctx, pts) {
  const n = pts.length;
  if (n < 2) return;
  ctx.lineWidth = BANDE; ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
  for (let b = 0; b < ARC.length; b++) {
    const decal = (b - (ARC.length - 1) / 2) * BANDE;
    ctx.strokeStyle = ARC[b];
    for (let i = 0; i < n - 1; i += 3) {
      ctx.globalAlpha = 0.15 + 0.85 * (i / n);
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y + decal);
      for (let k = i + 1; k <= Math.min(n - 1, i + 3); k++) ctx.lineTo(pts[k].x, pts[k].y + decal);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Ajoute des éclats colorés (explosion légère) ; sans effet en animation réduite (l'appelant vérifie).
 * @param {object} s état de la partie
 * @param {number} x centre
 * @param {number} y centre
 * @param {number} n nombre d'éclats
 * @param {string} [couleur] couleur unique ; sinon les six couleurs de l'arc-en-ciel
 */
function eclate(s, x, y, n, couleur) {
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n;
    s.eclats.push({ x, y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 30, vie: 0.5, c: couleur || ARC[i % ARC.length] });
  }
}

/**
 * Fin de partie : le cœur touche un tuyau, le sol ou le plafond (flash rouge, secousse et éclats sauf animation réduite).
 * @param {object} s état de la partie
 */
function meurs(s) {
  s.mort = true;
  s.flash = 0.35;
  if (!s.reduit) { s.secousse = 0.3; eclate(s, HX, s.y, 10); }
}

export const JEU = {
  id: 'flappy',
  titre: 'Flappy Domu',
  action: true,
  aide: 'Espace, flèche haut, clic ou appui : bats des ailes pour passer entre les tuyaux, sans toucher le sol, le plafond ni un tuyau.',
  init: ({ reduit }) => ({
    reduit, lent: reduit ? 0.8 : 1,
    score: 0, ecoule: 0, debut: false, mort: false,
    y: H / 2, vy: 0, traine: [], acc: 0,
    tuyaux: [], depuis: ESPACE - 150, sol: 0,
    eclats: [], flash: 0, secousse: 0,
  }),
  update(s, dt, e) {
    if (s.mort) return;
    const d = dt * s.lent;
    const v = vitesse(s.ecoule);
    s.ecoule += d;
    s.sol = (s.sol + v * d) % 24;

    // Le cœur : flotte avant le premier battement, puis gravité et impulsions.
    if (!s.debut && e.action) { s.debut = true; s.vy = -BATTEMENT; }
    if (!s.debut) {
      s.y = H / 2 + Math.sin(s.ecoule * 3) * 5;
      s.vy = 0;
    } else {
      if (e.action) s.vy = -BATTEMENT;
      s.vy = Math.min(CHUTE_MAX, s.vy + GRAVITE * d);
      s.y += s.vy * d;
    }
    const plafond = s.y - DEMI_H < 0, sol = s.y + DEMI_H > SOL;
    if (s.triche?.immortel) {
      // Code « immortel » : le cœur rebondit sur le sol et le plafond.
      if (sol) { s.y = SOL - DEMI_H; s.vy = -BATTEMENT * 0.8; }
      if (plafond) { s.y = DEMI_H; s.vy = Math.abs(s.vy) * 0.5; }
    } else if (plafond || sol) {
      meurs(s);
      return;
    }

    // Traînée : les points glissent vers la gauche avec le décor ; un point toutes les 1/30 s.
    for (const q of s.traine) q.x -= v * d;
    s.acc += d;
    if (s.acc >= 1 / 30) { s.acc = 0; s.traine.push({ x: HX, y: s.y }); }
    while (s.traine.length && s.traine[0].x < -10) s.traine.shift();

    // Tuyaux : défilement, apparition à droite, retrait à gauche.
    for (const p of s.tuyaux) p.x -= v * d;
    s.depuis += v * d;
    if (s.depuis >= ESPACE) { s.depuis -= ESPACE; s.tuyaux.push(nouveauTuyau(s.ecoule)); }
    s.tuyaux = s.tuyaux.filter((p) => p.x + PW + DEBORD > -10);

    const coeurs = !!s.triche?.coeurs, immortel = !!s.triche?.immortel;
    for (const p of s.tuyaux) {
      if (!p.passe && p.x + PW < HX - DEMI_W) {
        p.passe = true;
        if (!coeurs) s.score++;
      }
      if (coeurs) {
        // Code « domu » : les deux petits cœurs se ramassent (1 point chacun), le tuyau ne fait rien.
        for (const c of p.coeurs) {
          if (!c.pris && Math.abs(HX - (p.x + PW / 2)) < DEMI_W + RAYON_C && Math.abs(s.y - c.y) < DEMI_H + RAYON_C) {
            c.pris = true;
            s.score++;
            if (!s.reduit) eclate(s, p.x + PW / 2, c.y, 4, ROUGE);
          }
        }
      } else if (!immortel && HX + DEMI_W > p.x - DEBORD && HX - DEMI_W < p.x + PW + DEBORD
        && (s.y - DEMI_H < p.haut || s.y + DEMI_H > p.haut + p.ouverture)) {
        meurs(s);
        return;
      }
    }

    for (const c of s.eclats) { c.vie -= d; c.x += c.vx * d; c.y += c.vy * d; c.vy += 220 * d; }
    s.eclats = s.eclats.filter((c) => c.vie > 0);
    s.secousse = Math.max(0, s.secousse - d);
    s.flash = Math.max(0, s.flash - d);
  },
  draw(ctx, s) {
    const dx = s.secousse > 0 ? (Math.random() - 0.5) * 8 : 0;
    ctx.save();
    ctx.translate(dx, 0);
    sol(ctx, s);
    const coeurs = !!s.triche?.coeurs;
    for (const p of s.tuyaux) {
      if (coeurs) { for (const c of p.coeurs) if (!c.pris) coeur(ctx, p.x + PW / 2, c.y, 7); }
      else tuyauDessine(ctx, p);
    }
    traineDessine(ctx, s.traine);
    for (const c of s.eclats) { ctx.globalAlpha = Math.max(0, c.vie / 0.5); ctx.fillStyle = c.c; ctx.fillRect(c.x, c.y, 3, 3); }
    ctx.globalAlpha = 1;
    // Code « domu » : le héros devient un cœur rouge.
    if (coeurs) coeur(ctx, HX, s.y, 12);
    else coeurPixel(ctx, HX, s.y);
    ctx.restore();
    if (s.mort) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, H / 2 - 34, W, 68);
      ctx.fillStyle = '#F2EFEA'; ctx.font = '22px "Archivo Black", system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Aïe !', W / 2, H / 2 + 8);
      ctx.textAlign = 'start';
    }
    if (s.flash > 0) { ctx.fillStyle = `rgba(176, 16, 42, ${s.flash})`; ctx.fillRect(0, 0, W, H); }
  },
  score: (s) => s.score,
  /* Une seule vie : pas de compteur ; la partie finit au premier contact. */
  vies: () => null,
  fini: (s) => s.mort,
};
