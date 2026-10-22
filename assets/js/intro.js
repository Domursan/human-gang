// ===== Intro « 3D » (index.html) : le défilement pilote une caméra qui plonge dans le cœur du logo, sous un ciel étoilé =====
// Pas de Supabase ici : la page doit rester légère. Le logo est déjà dans le HTML (préchargé).
// Dépendances : utils.js (rnd), core/site-defaults.js (textes de l'intro), et le localStorage (hg_intro_day, hg_prefs).
// Deux versions : mouvement réduit (ciel fixe, fondu) ou complète (défilement, caméra 3D). Sortie vers accueil.html.
// N'exporte rien.

/* ---------- Imports, constantes et éléments de la page ---------- */
import { rnd } from './utils.js';
const NEXT = 'accueil.html';
const PERSPECTIVE = 1000;       // doit correspondre à .intro-stage { perspective }
const MAX_SCALE = 26;           // grossissement du logo en fin de course

/** Raccourci : élément par identifiant. */
const $ = (id) => document.getElementById(id);
const world = $('world'), logo = $('logo'), img = $('logo-img');
const glow = $('glow'), hint = $('hint'), fade = $('fade'), canvas = $('sky');
const progressEl = $('progress'), fill = $('progress-fill'), skip = $('skip'), enterBtn = $('enter');

import { applySiteDom } from './core/site-defaults.js';
applySiteDom(); // textes de l'intro (cache des réglages du site)

/* ---------- Jour de l'intro (une fois par jour, comme intro-daily.js) ---------- */
/** Date du jour au format « A-M-J » (sans zéro devant), même format que intro-daily.js et intro-redirect.js. */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
/** Note que l'intro a été vue aujourd'hui, pour ne pas la rejouer avant demain. */
function markSeen() { try { localStorage.setItem('hg_intro_day', today()); } catch {} }

// Sécurité : si l'intro a déjà été vue aujourd'hui (le script en tête de page s'en charge normalement)
try { if (localStorage.getItem('hg_intro_day') === today()) location.replace(NEXT); } catch {}

/* ---------- Logo (déjà chargé par le HTML ; on gère seulement l'échec) ---------- */
if (img.complete && img.naturalWidth === 0) logo.classList.add('no-logo');
img.addEventListener('error', () => logo.classList.add('no-logo'), { once: true });

/* ---------- Sortie vers l'accueil ---------- */
let leaving = false;
/**
 * Quitte l'intro : marque la journée, fond la page en noir, puis va à l'accueil. Ne fait rien si déjà en cours.
 * @param {number} [delay=700] durée du fondu, en millisecondes
 */
function leave(delay = 700) {
  if (leaving) return;
  leaving = true;
  markSeen();
  fade.classList.add('on');
  // L'API Web Animations n'est pas neutralisée par la règle reduced-motion de base.css
  try { fade.animate([{ opacity: getComputedStyle(fade).opacity }, { opacity: 1 }], { duration: delay, fill: 'forwards', easing: 'ease' }); } catch {}
  setTimeout(() => location.replace(NEXT), delay);
}
skip.addEventListener('click', (e) => { e.preventDefault(); leave(350); });

/* ---------- Réglages de mouvement et petites fonctions mathématiques ---------- */
// reduced : l'utilisateur a demandé moins d'animations dans son système.
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Ramène une valeur entre 0 et 1. */
const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** Courbe en S (smoothstep) : 0 avant a, 1 après b, progression douce entre les deux. */
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/* Préférence « Effets visuels » (panneau des préférences, localStorage hg_prefs ; ancienne clé hg_effects_off) */
const fxOff = (() => {
  try {
    const p = JSON.parse(localStorage.getItem('hg_prefs') || 'null');
    if (p && typeof p.effects === 'boolean') return !p.effects;
    return localStorage.getItem('hg_effects_off') === '1';
  } catch { return false; }
})();

/* ======================================================================
   Ciel étoilé (canvas 2D) : fond, voie lactée, étoiles, étoiles filantes
   Chaque étoile a une position écran au repos (u, v) et une profondeur z0.
   La caméra avance de `travel` : la profondeur vue devient zc et l'étoile
   s'écarte du centre d'un facteur z0 / zc (effet hyperespace en fin de course).
   La voie lactée est pré-rendue une fois (canvas hors écran) puis simplement recopiée.
   ====================================================================== */
const ctx = canvas.getContext('2d', { alpha: false });
const Z_NEAR = 0.16, Z_FAR = 9, Z_RANGE = Z_FAR - Z_NEAR;
const TRAVEL = 8.5;              // distance parcourue par la caméra dans le champ d'étoiles
// Teintes pâles : blancs froids + rappel discret de l'arc-en-ciel du logo
const WHITES = ['#ffffff', '#eef3ff', '#dbe5ff', '#fdf6ec'];
const TINTS = ['#ffb4a6', '#ffd49c', '#fff0ad', '#b9efc9', '#b6caff', '#d4bcff'];
const BG = { inner: '#101d3c', mid: '#0a142d', outer: '#050a1b', edge: '#02040c' };
// Nébuleuse de la voie lactée : couleurs très pâles
const NEBULA = [[150, 172, 255], [196, 170, 255], [255, 186, 222], [255, 228, 190], [168, 226, 255]];
const BAND_ANGLE = -0.47;        // inclinaison de la bande (~ -27°)
const BAND_SCALE = 0.5;          // résolution du pré-rendu (le flou vient gratuitement à l'agrandissement)

let W = 0, H = 0, DPR = 1, stars = [], bgGrad = null, band = null, sprites = new Map();

// Nombre « normal » approché (somme de 4 uniformes) : la plupart des valeurs restent près de 0.
const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2; // ~N(0, 0.29)

/** Halo pré-rendu par couleur (moins coûteux qu'un arc + dégradé par étoile et par image). */
function sprite(color, flare) {
  const key = color + (flare ? '+' : '');
  let s = sprites.get(key);
  if (s) return s;
  const S = flare ? 96 : 48;
  s = document.createElement('canvas');
  s.width = s.height = S;
  const c = s.getContext('2d');
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, color); g.addColorStop(0.12, color + 'aa'); g.addColorStop(0.35, color + '22'); g.addColorStop(1, color + '00');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  if (flare) {
    // Aigrettes (croix fine) pour les plus brillantes
    for (const [x0, y0, x1, y1] of [[0, S / 2, S, S / 2], [S / 2, 0, S / 2, S]]) {
      const l = c.createLinearGradient(x0, y0, x1, y1);
      l.addColorStop(0, color + '00'); l.addColorStop(0.5, color + 'cc'); l.addColorStop(1, color + '00');
      c.strokeStyle = l; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
  }
  sprites.set(key, s);
  return s;
}

/** Position (écran, depuis le centre) d'un point de la bande : t le long, n en travers. */
function bandPoint(t, n) {
  const ca = Math.cos(BAND_ANGLE), sa = Math.sin(BAND_ANGLE);
  return [t * ca - n * sa, t * sa + n * ca - H * 0.06];
}

/**
 * Pré-rend la voie lactée une seule fois sur un canvas hors écran (nuages, poussière d'étoiles, zones sombres).
 * Ensuite drawSky ne fait que recopier cette image, ce qui reste rapide pendant le défilement.
 */
function buildBand() {
  // Couvre un peu plus que l'écran (parallaxe + léger zoom)
  const bw = Math.ceil(W * 1.3 * BAND_SCALE), bh = Math.ceil(H * 1.3 * BAND_SCALE);
  band = document.createElement('canvas');
  band.width = bw; band.height = bh;
  const c = band.getContext('2d');
  const diag = Math.hypot(W, H);
  const width = diag * 0.11;
  /** Convertit une position de la bande en coordonnées du canvas hors écran. */
  const toBand = ([x, y]) => [(x + W * 0.65) * BAND_SCALE, (y + H * 0.65) * BAND_SCALE];
  c.globalCompositeOperation = 'lighter';
  // Nuages diffus
  const blobs = Math.round(110 + diag / 12);
  for (let i = 0; i < blobs; i++) {
    const t = (Math.random() - 0.5) * diag * 1.25;
    const [x, y] = toBand(bandPoint(t, gauss() * width * 1.6));
    const r = (diag * (0.04 + Math.random() * 0.12)) * BAND_SCALE;
    const [R, G, B] = NEBULA[(Math.random() * NEBULA.length) | 0];
    const a = 0.016 + Math.random() * 0.032;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${R},${G},${B},${a})`); g.addColorStop(1, `rgba(${R},${G},${B},0)`);
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Poussière d'étoiles très fines le long de la bande
  const dust = Math.round(Math.min(5000, (W * H) / 260));
  for (let i = 0; i < dust; i++) {
    const t = (Math.random() - 0.5) * diag * 1.25;
    const [x, y] = toBand(bandPoint(t, gauss() * width));
    c.fillStyle = `rgba(230,236,255,${(0.12 + Math.random() * 0.4).toFixed(3)})`;
    const s = Math.random() < 0.85 ? 0.6 : 1.1;
    c.fillRect(x, y, s, s);
  }
  // Bande sombre de poussière au milieu (donne du relief)
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 60; i++) {
    const t = (Math.random() - 0.5) * diag * 1.2;
    const [x, y] = toBand(bandPoint(t, gauss() * width * 0.35 + width * 0.08));
    const r = diag * (0.02 + Math.random() * 0.05) * BAND_SCALE;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/**
 * (Re)construit le ciel selon la taille de l'écran : fond, voie lactée, et la liste des étoiles.
 * Appelée au départ et après un redimensionnement important.
 */
function buildSky() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = canvas.clientWidth || window.innerWidth;
  H = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Fond : même dégradé radial que le CSS (le canvas est opaque pour de meilleures performances)
  const R = Math.hypot(W, H) * 0.62;
  bgGrad = ctx.createRadialGradient(W / 2, H * 0.52, 0, W / 2, H * 0.52, R);
  bgGrad.addColorStop(0, BG.inner); bgGrad.addColorStop(0.38, BG.mid); bgGrad.addColorStop(0.7, BG.outer); bgGrad.addColorStop(1, BG.edge);
  buildBand();

  // Nombre d'étoiles adapté à la surface de l'écran (et plafonné pour rester fluide)
  const count = Math.round(Math.min(1500, Math.max(380, (W * H) / 850)));
  const half = Math.hypot(W, H) / 2;
  const diag = half * 2;
  stars = [];
  for (let i = 0; i < count; i++) {
    let u, v;
    if (Math.random() < 0.3) {                       // une partie des étoiles se concentre dans la voie lactée
      [u, v] = bandPoint((Math.random() - 0.5) * diag * 1.1, gauss() * diag * 0.12);
    } else {
      u = rnd(-0.55, 0.55) * W; v = rnd(-0.55, 0.55) * H;   // position écran au repos (depuis le centre)
    }
    const z0 = rnd(1, Z_FAR - 0.6);
    const roll = Math.random();
    // Tailles : beaucoup de petites, des moyennes, quelques grosses (halo) et de rares très brillantes (aigrettes)
    const r = roll < 0.6 ? rnd(0.45, 0.95) : roll < 0.89 ? rnd(0.95, 1.6) : roll < 0.982 ? rnd(1.6, 2.4) : rnd(2.4, 3.3);
    const tinted = Math.random() < 0.22;
    const strong = Math.random() < 0.45;              // scintillement marqué
    stars.push({
      x: u * z0, y: v * z0, z0, r,
      color: tinted ? TINTS[(Math.random() * TINTS.length) | 0] : WHITES[(Math.random() * WHITES.length) | 0],
      base: rnd(0.6, 1) * (r > 1.6 ? 1 : 0.9),
      tw: rnd(0.8, 3.2), ph: rnd(0, Math.PI * 2), amp: strong ? rnd(0.5, 0.85) : rnd(0.15, 0.4),
      halo: r > 1.6, flare: r > 2.4,
      dist: Math.hypot(u, v) / half,
    });
  }
  // Tri par couleur : moins de changements d'état du contexte
  stars.sort((a, b) => (a.color < b.color ? -1 : a.color > b.color ? 1 : 0));
}

/* Étoiles filantes : régulièrement, seulement au repos (jusqu'à deux à la fois) */
let shooting = [], nextShoot = performance.now() + rnd(1200, 2600);
/**
 * Lance une étoile filante si le moment est venu (et si la page est au repos).
 * @param {number} now horodatage de l'image (ms)
 * @param {boolean} calm true si la caméra ne bouge pas
 */
function maybeShoot(now, calm) {
  if (shooting.length >= 2 || !calm || now < nextShoot) return;
  const dir = Math.random() < 0.5 ? -1 : 1;
  const ang = rnd(0.3, 0.62);                     // ~17 à 35° sous l'horizontale
  shooting.push({
    t0: now, life: rnd(800, 1250),
    x: dir > 0 ? rnd(0.02, 0.55) * W : rnd(0.45, 0.98) * W,
    y: rnd(0.03, 0.4) * H,
    vx: Math.cos(ang) * dir, vy: Math.sin(ang),
    speed: Math.max(W, H) * rnd(0.8, 1.15),       // px/s
    len: Math.max(110, Math.min(W, H) * 0.28),
    color: Math.random() < 0.5 ? '#ffffff' : TINTS[(Math.random() * TINTS.length) | 0],
  });
  nextShoot = now + rnd(2600, 6500);
}
/**
 * Dessine les étoiles filantes en cours (traînée + petit halo) et retire celles qui sont finies.
 * @param {number} now horodatage de l'image (ms)
 */
function drawShooting(now) {
  if (!shooting.length) return;
  shooting = shooting.filter((s) => now - s.t0 < s.life);
  for (const s of shooting) {
    const k = (now - s.t0) / s.life;
    const d = s.speed * (now - s.t0) / 1000;
    const hx = s.x + s.vx * d, hy = s.y + s.vy * d;
    const tl = s.len * Math.min(1, k * 3);
    const tx = hx - s.vx * tl, ty = hy - s.vy * tl;
    const a = Math.sin(Math.PI * k);              // apparaît puis s'éteint
    const g = ctx.createLinearGradient(hx, hy, tx, ty);
    g.addColorStop(0, s.color); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 0.95 * a;
    ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.globalAlpha = 0.9 * a;
    ctx.drawImage(sprite(s.color, false), hx - 12, hy - 12, 24, 24);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(hx, hy, 1.6, 0, Math.PI * 2); ctx.fill();
  }
}

/**
 * Dessine le ciel.
 * travel : avancée de la caméra ; speed : vitesse d'avancée par seconde (longueur des traînées)
 * t : temps (s) pour le scintillement ; ox/oy : parallaxe ; dim : atténuation globale
 */
function drawSky(travel, speed, t, ox, oy, dim, twinkle) {
  const cx = W / 2, cy = H / 2;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

  // Voie lactée : grossit légèrement et s'efface quand on accélère
  const prog = clamp01(travel / TRAVEL);
  const bandA = (1 - smooth(0.05, 0.55, prog)) * dim;
  if (band && bandA > 0.01) {
    const z = 1 + prog * 0.9;
    const bw = W * 1.3 * z, bh = H * 1.3 * z;
    ctx.globalAlpha = bandA;
    ctx.drawImage(band, cx - bw / 2 + ox * 0.35, cy - bh / 2 + oy * 0.35, bw, bh);
  }

  // Hyperespace : traînées proportionnelles à la vitesse de la caméra
  const streak = Math.min(4.8, speed * 0.15);
  const warp = fxOff ? 0 : clamp01((speed - 0.04) * 3);   // 0 = points, 1 = traits
  if (warp > 0.02) {
    // Lueur de tunnel au centre
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) * 0.45);
    g.addColorStop(0, `rgba(190,205,255,${(0.22 * warp).toFixed(3)})`);
    g.addColorStop(0.35, `rgba(150,120,230,${(0.08 * warp).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = dim; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
  }
  ctx.lineCap = 'round';
  let color = '';
  const halos = [];
  for (const s of stars) {
    let zc = Z_NEAR + ((((s.z0 - travel - Z_NEAR) % Z_RANGE) + Z_RANGE) % Z_RANGE);
    const fadeFar = clamp01((Z_FAR - zc) / 0.9);
    const fadeNear = smooth(Z_NEAR, Z_NEAR + 0.35, zc);
    const tw = twinkle ? 1 - s.amp * (0.5 + 0.5 * Math.sin(t * s.tw + s.ph)) : 1;
    const a = s.base * tw * fadeFar * fadeNear * dim * (1 + warp * 0.4);
    if (a < 0.02) continue;
    const inv = 1 / zc;
    const px = cx + s.x * inv + ox * inv, py = cy + s.y * inv + oy * inv;
    if (px < -60 || px > W + 60 || py < -60 || py > H + 60) continue;
    const grow = Math.min(3.4, Math.pow(s.z0 / zc, 0.55));
    const r = s.r * grow;
    if (s.color !== color) { color = s.color; ctx.fillStyle = color; ctx.strokeStyle = color; }
    ctx.globalAlpha = Math.min(1, a);
    if (warp > 0.02) {
      // Trait : de la position actuelle vers la position « juste avant » (plus loin)
      const zb = zc + streak * warp;
      const bx = cx + (s.x + ox) / zb, by = cy + (s.y + oy) / zb;
      ctx.lineWidth = Math.max(0.7, r * (1.3 + warp * 0.7));
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(px, py); ctx.stroke();
    } else if (r < 0.9) {
      const d = r * 2;
      ctx.fillRect(px - r, py - r, d, d);
    } else {
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      if (s.halo) halos.push(s, px, py, r, a);
    }
  }
  // Halos (et aigrettes) des étoiles brillantes, en mode additif
  if (halos.length) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < halos.length; i += 5) {
      const s = halos[i], px = halos[i + 1], py = halos[i + 2], r = halos[i + 3], a = halos[i + 4];
      const size = r * (s.flare ? 16 : 9);
      ctx.globalAlpha = Math.min(1, a) * (s.flare ? 0.85 : 0.55);
      ctx.drawImage(sprite(s.color, s.flare), px - size / 2, py - size / 2, size, size);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

/* ---------- Redimensionnement ---------- */
let resizeTimer = 0;
/**
 * Surveille le redimensionnement de la fenêtre et reconstruit le ciel (avec un délai, pour ne pas le faire à chaque pixel).
 * @param {Function} [cb] fonction à rappeler après la reconstruction
 */
function onResize(cb) {
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // Sur mobile, l'apparition/disparition de la barre d'adresse ne doit pas tout régénérer
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (Math.abs(w - W) > 2 || Math.abs(h - H) > 120) { buildSky(); cb?.(); }
    }, 150);
  }, { passive: true });
}

/* ---------- Démarrage : construit le ciel, puis choisit la version ---------- */
buildSky();

if (reduced) {
  /* ---------- Version mouvement réduit : ciel fixe, apparition en fondu, puis fondu vers l'accueil ---------- */
  document.body.classList.add('reduced');
  /** Dessine le ciel sans animation (mouvement réduit). */
  const still = () => drawSky(0, 0, 0, 0, 0, 1, false);
  still();
  onResize(still);
  enterBtn.hidden = false;
  try {
    logo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: 'ease-out', fill: 'both' });
    glow.animate([{ opacity: 0 }, { opacity: 0.5 }], { duration: 1000, easing: 'ease-out', fill: 'both' });
  } catch {}
  fill.style.clipPath = 'inset(0 0 0 0)';
  progressEl.setAttribute('aria-valuenow', '100');
  enterBtn.addEventListener('click', () => leave(600));
  window.addEventListener('wheel', () => leave(600), { passive: true, once: true });
  window.addEventListener('touchmove', () => leave(600), { passive: true, once: true });
  window.addEventListener('keydown', (e) => {
    if (['Enter', ' ', 'ArrowDown', 'PageDown', 'End'].includes(e.key)) { e.preventDefault(); leave(600); }
  });
  enterBtn.focus({ preventScroll: true });
} else {
  /* ---------- Version complète ---------- */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  onResize();

  // Souris / doigt : léger parallax
  let mx = 0, my = 0, px = 0, py = 0;
  window.addEventListener('pointermove', (e) => {
    mx = (e.clientX / window.innerWidth) * 2 - 1;
    my = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { mx = 0; my = 0; });

  // Clavier : Entrée = entrer directement (les flèches / espace / Page suivante défilent nativement)
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter' && document.activeElement === document.body) leave(500); });

  let target = 0, cur = 0, lastT = performance.now(), lastTravel = 0, speedS = 0;
  /** Défilement maximal de la page, au moins 1 pour éviter une division par zéro. */
  const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  /** Lit la position de défilement et la convertit en progression de 0 à 1. */
  const readScroll = () => { target = clamp01(window.scrollY / maxScroll()); };
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', readScroll, { passive: true });

  let lastPct = -1;

  /**
   * Une image d'animation : fait avancer la progression, puis met à jour caméra, logo, lueur, ciel et barre de progression.
   * Se rappelle elle-même via requestAnimationFrame jusqu'à la sortie.
   * @param {number} now horodatage fourni par requestAnimationFrame (ms)
   */
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000) || 0.016; lastT = now;
    const k = 1 - Math.exp(-dt * 7);
    if (leaving) target = 1;
    cur += (target - cur) * k;
    if (Math.abs(target - cur) < 0.0004) cur = target;
    px += (mx - px) * (1 - Math.exp(-dt * 4));
    py += (my - py) * (1 - Math.exp(-dt * 4));

    // Caméra : grossissement exponentiel => sensation de vitesse constante
    const scale = Math.exp(cur * Math.log(MAX_SCALE));
    const camZ = PERSPECTIVE * (1 - 1 / scale);
    const t = now / 1000;
    const floatY = Math.sin(t * 1.1) * 7 * (1 - cur);
    const floatR = Math.sin(t * 0.7) * 1.2 * (1 - cur);
    const tilt = 1 - smooth(0, 0.6, cur);              // le parallax s'efface en approchant
    const rx = (-py * 7 + floatR) * tilt;
    const ry = (px * 9) * tilt;

    world.style.transform = `translate3d(0, ${floatY.toFixed(2)}px, ${camZ.toFixed(2)}px) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)`;
    // En approchant, le logo se floute (profondeur de champ) puis s'efface : on « passe à travers »
    logo.style.opacity = (1 - smooth(0.62, 0.93, cur)).toFixed(3);
    const blur = 14 * smooth(0.4, 0.95, cur);
    logo.style.filter = blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : '';
    glow.style.opacity = (0.5 + 0.4 * smooth(0.1, 0.75, cur) - 0.7 * smooth(0.85, 1, cur)).toFixed(3);
    glow.style.transform = `scale(${(1 + cur * 1.6).toFixed(3)})`;
    hint.style.opacity = (1 - smooth(0, 0.06, cur)).toFixed(3);
    if (!leaving) fade.style.opacity = (0.92 * smooth(0.9, 1, cur)).toFixed(3);

    // Étoiles : la caméra avance dans le champ (accélère avec le zoom) ; parallax inverse de la souris
    const travel = TRAVEL * Math.pow(cur, 1.5);
    const inst = (travel - lastTravel) / dt; lastTravel = travel;
    speedS += (Math.abs(inst) - speedS) * (1 - Math.exp(-dt * 10));
    const par = 26 * tilt;
    drawSky(travel, speedS, t, -px * par, -py * par * 0.7, 1, !fxOff);
    if (!fxOff) { maybeShoot(now, cur < 0.04 && target < 0.04); drawShooting(now); }

    const pct = Math.round(target * 100);
    fill.style.clipPath = `inset(0 ${(100 - target * 100).toFixed(2)}% 0 0)`;
    if (pct !== lastPct) { progressEl.setAttribute('aria-valuenow', String(pct)); lastPct = pct; }

    if (!leaving && target >= 0.985 && cur >= 0.95) leave(600);
    requestAnimationFrame(frame);
  }
  readScroll();
  requestAnimationFrame(frame);
}
