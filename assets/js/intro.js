// ===== Intro « 3D » : le défilement pilote une caméra qui plonge dans le cœur du logo, sous un ciel étoilé =====
// Pas de Supabase ici : la page doit rester légère. Le logo est déjà dans le HTML (préchargé).

const NEXT = 'accueil.html';
const PERSPECTIVE = 1000;       // doit correspondre à .intro-stage { perspective }
const MAX_SCALE = 26;           // grossissement du logo en fin de course

const $ = (id) => document.getElementById(id);
const world = $('world'), logo = $('logo'), img = $('logo-img');
const glow = $('glow'), hint = $('hint'), fade = $('fade'), canvas = $('sky');
const progressEl = $('progress'), fill = $('progress-fill'), skip = $('skip'), enterBtn = $('enter');

function markSeen() { try { localStorage.setItem('hg_intro_seen', '1'); } catch {} }

// Sécurité : si l'intro a déjà été vue (le script en tête de page s'en charge normalement)
try { if (localStorage.getItem('hg_intro_seen')) location.replace(NEXT); } catch {}

/* ---------- Logo (déjà chargé par le HTML ; on gère seulement l'échec) ---------- */
if (img.complete && img.naturalWidth === 0) logo.classList.add('no-logo');
img.addEventListener('error', () => logo.classList.add('no-logo'), { once: true });

/* ---------- Sortie ---------- */
let leaving = false;
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

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);

/* ======================================================================
   Ciel étoilé (canvas 2D)
   Chaque étoile a une position écran au repos (u, v) et une profondeur z0.
   La caméra avance de `travel` : la profondeur vue devient zc et l'étoile
   s'écarte du centre d'un facteur z0 / zc (effet hyperespace en fin de course).
   ====================================================================== */
const ctx = canvas.getContext('2d', { alpha: false });
const Z_NEAR = 0.16, Z_FAR = 9, Z_RANGE = Z_FAR - Z_NEAR;
const TRAVEL = 7.5;              // distance parcourue par la caméra dans le champ d'étoiles
// Teintes pâles : blancs froids + rappel discret de l'arc-en-ciel du logo
const WHITES = ['#ffffff', '#eef3ff', '#dbe5ff', '#fdf6ec'];
const TINTS = ['#ffb4a6', '#ffd49c', '#fff0ad', '#b9efc9', '#b6caff', '#d4bcff'];
const BG = { inner: '#0e1a36', mid: '#091229', outer: '#050a1a', edge: '#02040c' };

let W = 0, H = 0, DPR = 1, stars = [], bgGrad = null;

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

  // Nombre d'étoiles adapté à la surface de l'écran
  const count = Math.round(Math.min(700, Math.max(180, (W * H) / 1900)));
  const half = Math.hypot(W, H) / 2;
  stars = [];
  for (let i = 0; i < count; i++) {
    const u = rnd(-0.55, 0.55) * W, v = rnd(-0.55, 0.55) * H;       // position écran au repos (depuis le centre)
    const z0 = rnd(1, Z_FAR - 0.6);
    const roll = Math.random();
    // Tailles : beaucoup de petites, quelques moyennes, de rares grosses (avec halo)
    const r = roll < 0.72 ? rnd(0.35, 0.8) : roll < 0.95 ? rnd(0.8, 1.35) : rnd(1.4, 2.1);
    const tinted = Math.random() < 0.2;
    stars.push({
      x: u * z0, y: v * z0, z0, r,
      color: tinted ? TINTS[(Math.random() * TINTS.length) | 0] : WHITES[(Math.random() * WHITES.length) | 0],
      base: rnd(0.45, 1) * (r > 1.3 ? 1 : 0.85),
      tw: rnd(0.6, 2.2), ph: rnd(0, Math.PI * 2), amp: rnd(0.15, 0.45),
      dist: Math.hypot(u, v) / half,
    });
  }
  // Tri par couleur : moins de changements d'état du contexte
  stars.sort((a, b) => (a.color < b.color ? -1 : a.color > b.color ? 1 : 0));
}

/* Étoiles filantes : de temps en temps, seulement au repos */
let shooting = null, nextShoot = performance.now() + rnd(2500, 4500);
function maybeShoot(now, calm) {
  if (shooting || !calm || now < nextShoot) return;
  const dir = Math.random() < 0.5 ? -1 : 1;
  const ang = rnd(0.32, 0.6);                     // ~18 à 34° sous l'horizontale
  shooting = {
    t0: now, life: rnd(750, 1100),
    x: dir > 0 ? rnd(0.05, 0.55) * W : rnd(0.45, 0.95) * W,
    y: rnd(0.04, 0.35) * H,
    vx: Math.cos(ang) * dir, vy: Math.sin(ang),
    speed: Math.max(W, H) * rnd(0.75, 1.05),       // px/s
    len: Math.max(90, Math.min(W, H) * 0.22),
    color: Math.random() < 0.5 ? '#ffffff' : TINTS[(Math.random() * TINTS.length) | 0],
  };
  nextShoot = now + rnd(6000, 14000);
}
function drawShooting(now) {
  if (!shooting) return;
  const s = shooting, k = (now - s.t0) / s.life;
  if (k >= 1) { shooting = null; return; }
  const d = s.speed * (now - s.t0) / 1000;
  const hx = s.x + s.vx * d, hy = s.y + s.vy * d;
  const tl = s.len * Math.min(1, k * 3);
  const tx = hx - s.vx * tl, ty = hy - s.vy * tl;
  const a = Math.sin(Math.PI * k);                // apparaît puis s'éteint
  const g = ctx.createLinearGradient(hx, hy, tx, ty);
  g.addColorStop(0, s.color); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 0.85 * a;
  ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(hx, hy, 1.4, 0, Math.PI * 2); ctx.fill();
}

/**
 * Dessine le ciel.
 * travel : avancée de la caméra ; speed : vitesse d'avancée par seconde (longueur des traînées)
 * t : temps (s) pour le scintillement ; ox/oy : parallaxe ; dim : atténuation globale
 */
function drawSky(travel, speed, t, ox, oy, dim, twinkle) {
  const cx = W / 2, cy = H / 2;
  ctx.globalAlpha = 1;
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
  // Longueur de traînée en profondeur (proportionnelle à la vitesse de la caméra)
  const streak = Math.min(1.2, speed * 0.06);
  const warp = clamp01((speed - 0.05) * 4);              // 0 = points, 1 = traits
  ctx.lineCap = 'round';
  let color = '';
  for (const s of stars) {
    let zc = Z_NEAR + ((((s.z0 - travel - Z_NEAR) % Z_RANGE) + Z_RANGE) % Z_RANGE);
    const fadeFar = clamp01((Z_FAR - zc) / 0.9);
    const fadeNear = smooth(Z_NEAR, Z_NEAR + 0.35, zc);
    const tw = twinkle ? 1 - s.amp * (0.5 + 0.5 * Math.sin(t * s.tw + s.ph)) : 1;
    const a = s.base * tw * fadeFar * fadeNear * dim;
    if (a < 0.02) continue;
    const inv = 1 / zc;
    const px = cx + s.x * inv + ox * inv, py = cy + s.y * inv + oy * inv;
    if (px < -40 || px > W + 40 || py < -40 || py > H + 40) continue;
    const grow = Math.min(3.2, Math.pow(s.z0 / zc, 0.55));
    const r = s.r * grow;
    if (s.color !== color) { color = s.color; ctx.fillStyle = color; ctx.strokeStyle = color; }
    ctx.globalAlpha = Math.min(1, a);
    if (warp > 0.02) {
      // Trait : de la position actuelle vers la position « juste avant » (plus loin)
      const zb = zc + streak * warp;
      const bx = cx + (s.x + ox) / zb, by = cy + (s.y + oy) / zb;
      ctx.lineWidth = Math.max(0.6, r * 1.6);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(px, py); ctx.stroke();
    } else if (r < 0.9) {
      const d = r * 2;
      ctx.fillRect(px - r, py - r, d, d);
    } else {
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      if (r > 1.35) {                                  // petit halo pour les plus brillantes
        ctx.globalAlpha = Math.min(1, a) * 0.18;
        ctx.beginPath(); ctx.arc(px, py, r * 3.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

let resizeTimer = 0;
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

buildSky();

if (reduced) {
  /* ---------- Version mouvement réduit : ciel fixe, apparition en fondu, puis fondu vers l'accueil ---------- */
  document.body.classList.add('reduced');
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
  const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const readScroll = () => { target = clamp01(window.scrollY / maxScroll()); };
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', readScroll, { passive: true });

  let lastPct = -1;

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
    const travel = TRAVEL * Math.pow(cur, 1.6);
    const inst = (travel - lastTravel) / dt; lastTravel = travel;
    speedS += (Math.abs(inst) - speedS) * (1 - Math.exp(-dt * 10));
    const par = 26 * tilt;
    drawSky(travel, speedS, t, -px * par, -py * par * 0.7, 1, true);
    maybeShoot(now, cur < 0.04 && target < 0.04);
    drawShooting(now);

    const pct = Math.round(target * 100);
    fill.style.clipPath = `inset(0 ${(100 - target * 100).toFixed(2)}% 0 0)`;
    if (pct !== lastPct) { progressEl.setAttribute('aria-valuenow', String(pct)); lastPct = pct; }

    if (!leaving && target >= 0.985 && cur >= 0.95) leave(600);
    requestAnimationFrame(frame);
  }
  readScroll();
  requestAnimationFrame(frame);
}
