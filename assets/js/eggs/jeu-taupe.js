// ===== Humane Gang — arcade : « Tape-taupe » (les membres sortent des terriers) =====
/*
 * Rôle : neuf terriers ; des membres du gang (avatars ronds à l'initiale) sortent un instant puis rentrent. On les tape
 * (clic, doigt, ou espace sur la case du curseur aux flèches) : +1 point, avec un « Paf ! ».
 * Pièges : parfois un cornichon sort à la place. Le taper coûte une vie. Un membre raté (rentré sans être tapé) ne coûte
 * rien, sauf cinq ratés de suite : une vie. Trois vies ; pas de limite de temps. Le rythme accélère doucement (plafonné).
 * Cadence : une sortie au plus toutes les 0,5 s, donc au plus 3 points dans une même seconde (2 par seconde en moyenne),
 * sous le plafond serveur de 5 points par seconde. Au plus trois avatars sortis en même temps.
 * Codes de triche (s.triche, eggs/arcade.js) : coeurs = plus de cornichons, les avatars deviennent des cœurs ;
 * immortel = aucune vie perdue.
 * Moteur : eggs/arcade.js (creeArcade ; jeu « directions » et action). Animation réduite : rythme plus lent, pas de particules.
 * Exporte : JEU (règles du mini-jeu pour creeArcade).
 */
import { W, H, coeur } from './arcade.js';

const VIES = 3, SERIE_RATEE = 5, TERRIERS = 9;
/** Centres des terriers (3 × 3). */
const XS = [70, 180, 290], YS = [125, 225, 325];
/** Hauteur dont un avatar sort du terrier, et durée de la montée ou de la descente (secondes). */
const ALT = 30, MONTEE = 0.12;
/** Rythme : une sortie toutes les « intervalle » secondes, plancher à 0,5 s ; sortie tenue de 1,6 s à 0,8 s. */
const PLANCHER_SORTIE = 0.5, PLAFOND = 60;
const CORNICHON_P = 0.2;
const LETTRES = ['D', 'S', 'N', 'W', 'Z', 'T'];
/** Couleurs du site par initiale, et couleur de l'initiale (sombre sur les fonds clairs). */
const COULEUR = {
  D: ['#9E3543', '#F2EFEA'], S: ['#2B5AE2', '#F2EFEA'], N: ['#4E2398', '#F2EFEA'],
  W: ['#FCA301', '#14122a'], Z: ['#FE3104', '#F2EFEA'], T: ['#FBD32D', '#14122a'],
};
const TERRE = '#5B4330', TROU = '#120D09', HERBE = '#211D3A', CONTOUR = '#0E0E10', CORNI = '#159946', CORNI_FONCE = '#0E6B31';
const OR = '#FBD32D';

/**
 * Disque en pixel art : lignes de 3 px, largeur arrondie en escalier, centré en (x, y).
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x centre
 * @param {number} y centre
 * @param {number} rx demi-largeur
 * @param {number} ry demi-hauteur
 * @param {string} couleur remplissage
 */
function disque(ctx, x, y, rx, ry, couleur) {
  ctx.fillStyle = couleur;
  for (let dy = -ry; dy < ry; dy += 3) {
    const bas = dy + 3 > ry ? ry : dy + 3;
    const l = rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry)));
    ctx.fillRect(Math.round(x - l), Math.round(y + dy), Math.round(2 * l), Math.round(bas - dy));
  }
}

/**
 * Trace le terrier (le trou sombre au fond, la motte devant). Dessiné avant et après l'avatar.
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x centre
 * @param {number} y niveau du sol
 * @param {'fond' | 'devant'} part partie à tracer
 */
function terrier(ctx, x, y, part) {
  if (part === 'fond') { disque(ctx, x, y, 38, 15, TROU); return; }
  disque(ctx, x, y + 9, 42, 15, TERRE);
  ctx.fillStyle = '#7A5C43';
  ctx.fillRect(Math.round(x - 30), Math.round(y + 12), 6, 3);
  ctx.fillRect(Math.round(x + 18), Math.round(y + 15), 6, 3);
}

/**
 * Trace l'avatar d'un membre : disque coloré, contour sombre, reflet et initiale.
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x centre
 * @param {number} y centre
 * @param {string} lettre initiale (D, S, N, W, Z ou T)
 */
function avatar(ctx, x, y, lettre) {
  const [fond, texte] = COULEUR[lettre];
  disque(ctx, x, y, 27, 27, CONTOUR);
  disque(ctx, x, y, 24, 24, fond);
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.fillRect(Math.round(x - 16), Math.round(y - 16), 6, 6);
  ctx.fillStyle = texte; ctx.font = '26px "Archivo Black", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(lettre, x, y + 2);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'start';
}

/**
 * Trace un cornichon vert en pixel art (à ne pas taper).
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x centre
 * @param {number} y centre
 */
function cornichon(ctx, x, y) {
  disque(ctx, x, y, 27, 10, CORNI_FONCE);
  disque(ctx, x, y, 25, 8, CORNI);
  ctx.fillStyle = CORNI_FONCE;
  ctx.fillRect(Math.round(x - 16), Math.round(y - 3), 4, 3);
  ctx.fillRect(Math.round(x - 2), Math.round(y + 2), 4, 3);
  ctx.fillRect(Math.round(x + 9), Math.round(y - 4), 4, 3);
  ctx.fillStyle = '#7A4A22'; ctx.fillRect(Math.round(x + 24), Math.round(y - 2), 6, 4);
}

/**
 * Trouve le terrier dont l'avatar visible contient le point (x, y).
 * @param {object} s état de la partie
 * @param {number} x point (coordonnées du canevas)
 * @param {number} y point (coordonnées du canevas)
 * @returns {object | null} le terrier, ou null
 */
function trouAvatar(s, x, y) {
  for (const t of s.trous) {
    if (!sorti(t)) continue;
    if (Math.hypot(x - t.x, y - (t.y - t.h * ALT)) <= 34) return t;
  }
  return null;
}

/** true si l'avatar du terrier est assez visible pour être tapé (montée ou sortie). */
function sorti(t) {
  return (t.etat === 'monte' || t.etat === 'sorti') && t.h >= 0.3;
}

/**
 * Un terrier passe en descente (le membre rentre).
 * @param {object} t terrier
 */
function rentre(t) {
  t.etat = 'rentre'; t.t = 0; t.h0 = t.h;
}

/**
 * Une vie perdue : flash rouge et message.
 * @param {object} s état de la partie
 * @param {string} texte message affiché
 */
function perdUneVie(s, texte) {
  s.vies--;
  s.flash = 0.35;
  s.message = texte; s.msgT = 1.4;
}

/**
 * Tape un terrier : un membre rapporte un point, un cornichon coûte une vie.
 * @param {object} s état de la partie
 * @param {object} t terrier
 */
function frappe(s, t) {
  if (!sorti(t) || t.fait) return;
  t.fait = true;
  if (t.cornichon) { if (!s.triche?.immortel) perdUneVie(s, 'Pas le cornichon !'); }
  else { s.score++; s.serie = 0; t.paf = 0.5; }
  rentre(t);
}

export const JEU = {
  id: 'taupe',
  titre: 'Tape-taupe',
  directions: true,
  action: true,
  aide: 'Clique ou touche un membre qui sort (ou flèches + espace). Un cornichon vert ne se tape pas (-1 vie). Cinq membres ratés de suite : -1 vie.',
  init: ({ reduit }) => ({
    reduit, lent: reduit ? 0.8 : 1,
    ecoule: 0, score: 0, vies: VIES, serie: 0, pousse: 0.6,
    curseur: { c: 1, l: 1 }, clavier: false,
    trous: Array.from({ length: TERRIERS }, (_, i) => ({
      x: XS[i % 3], y: YS[Math.floor(i / 3)], etat: 'vide', t: 0, h: 0, h0: 0, duree: 1,
      lettre: null, cornichon: false, fait: false, paf: 0,
    })),
    flash: 0, message: '', msgT: 0,
  }),
  update(s, dt, e) {
    s.ecoule += dt;
    s.flash = Math.max(0, s.flash - dt);
    s.msgT = Math.max(0, s.msgT - dt);
    // Flèches : déplacent le curseur de case ; le pointeur n'est plus visé (espace tape la case du curseur).
    if (e.dir) {
      s.clavier = true; e.cible = null; e.cibleY = null;
      const c = s.curseur;
      if (e.dir === 'haut') c.l = Math.max(0, c.l - 1);
      else if (e.dir === 'bas') c.l = Math.min(2, c.l + 1);
      else if (e.dir === 'gauche') c.c = Math.max(0, c.c - 1);
      else if (e.dir === 'droite') c.c = Math.min(2, c.c + 1);
    }
    // Clic ou doigt sur un avatar ; espace sans pointeur tape la case du curseur.
    if (e.action) {
      if (e.cible !== null && e.cibleY !== null) {
        s.clavier = false;
        const t = trouAvatar(s, e.cible, e.cibleY);
        if (t) frappe(s, t);
      } else {
        frappe(s, s.trous[s.curseur.l * 3 + s.curseur.c]);
      }
    }
    // Sorties : une seule à la fois par intervalle (au plus une toutes les 0,5 s).
    const intervalle = (s.reduit ? 1.25 : 1) * Math.max(PLANCHER_SORTIE, 1 - 0.5 * Math.min(s.ecoule, PLAFOND) / PLAFOND) / s.lent;
    s.pousse += dt;
    if (s.pousse >= Math.max(PLANCHER_SORTIE, intervalle)) {
      s.pousse = 0;
      const libres = s.trous.filter((t) => t.etat === 'vide');
      if (libres.length) {
        const t = libres[Math.floor(Math.random() * libres.length)];
        const cornichonCeTour = !s.triche?.coeurs && Math.random() < CORNICHON_P;
        t.etat = 'monte'; t.t = 0; t.h = 0; t.h0 = 0;
        t.duree = Math.max(0.8, 1.6 - 0.8 * Math.min(s.ecoule, PLAFOND) / PLAFOND) * (s.reduit ? 1.3 : 1);
        t.cornichon = cornichonCeTour;
        t.lettre = cornichonCeTour ? null : LETTRES[Math.floor(Math.random() * LETTRES.length)];
        t.fait = false; t.paf = 0;
      }
    }
    // Évolution des terriers : montée, sortie, descente ; un membre rentré sans être tapé compte comme raté.
    for (const t of s.trous) {
      if (t.paf > 0) t.paf = Math.max(0, t.paf - dt);
      if (t.etat === 'vide') continue;
      t.t += dt;
      if (t.etat === 'monte') {
        t.h = Math.min(1, t.t / MONTEE);
        if (t.t >= MONTEE) { t.etat = 'sorti'; t.t = 0; t.h = 1; }
      } else if (t.etat === 'sorti') {
        if (t.t >= t.duree) rentre(t);
      } else if (t.etat === 'rentre') {
        t.h = t.h0 * Math.max(0, 1 - t.t / MONTEE);
        if (t.t >= MONTEE) {
          if (!t.cornichon && !t.fait) {
            s.serie++;
            if (s.serie >= SERIE_RATEE) { s.serie = 0; if (!s.triche?.immortel) perdUneVie(s, 'Cinq ratés de suite !'); }
          }
          t.etat = 'vide'; t.h = 0; t.h0 = 0;
        }
      }
    }
  },
  draw(ctx, s) {
    ctx.save();
    ctx.fillStyle = HERBE; ctx.fillRect(0, 70, W, 300);
    for (const t of s.trous) terrier(ctx, t.x, t.y, 'fond');
    for (const t of s.trous) {
      if (t.h <= 0.02 || t.etat === 'vide') continue;
      // L'avatar n'apparaît qu'au-dessus de la motte.
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, t.y + 4); ctx.clip();
      const y = t.y - t.h * ALT;
      if (t.cornichon) cornichon(ctx, t.x, y);
      else if (s.triche?.coeurs) coeur(ctx, t.x, y, 22);
      else avatar(ctx, t.x, y, t.lettre);
      ctx.restore();
    }
    for (const t of s.trous) terrier(ctx, t.x, t.y, 'devant');
    if (s.clavier) {
      const c = s.trous[s.curseur.l * 3 + s.curseur.c];
      ctx.strokeStyle = OR; ctx.lineWidth = 2;
      ctx.strokeRect(c.x - 46, c.y - 46, 92, 70);
    }
    ctx.font = 'bold 18px "Archivo Black", system-ui, sans-serif'; ctx.textAlign = 'center';
    for (const t of s.trous) {
      if (t.paf <= 0) continue;
      ctx.globalAlpha = Math.min(1, t.paf / 0.25);
      ctx.fillStyle = OR;
      ctx.fillText('Paf !', t.x, t.y - 62);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'start';
    if (s.msgT > 0) {
      ctx.globalAlpha = Math.min(1, s.msgT / 0.4);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, H - 52, W, 30);
      ctx.fillStyle = '#F2EFEA'; ctx.font = '16px "Archivo Black", system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(s.message, W / 2, H - 31);
      ctx.globalAlpha = 1; ctx.textAlign = 'start';
    }
    if (s.flash > 0) { ctx.fillStyle = `rgba(224, 64, 75, ${s.flash})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  },
  score: (s) => s.score,
  vies: (s) => ({ left: s.vies, max: VIES }),
  fini: (s) => s.vies <= 0,
};
