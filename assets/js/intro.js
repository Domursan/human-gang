// ===== Intro « 3D » : le défilement pilote une caméra qui traverse le logo =====
// Pas de Supabase ici : la page doit rester légère. On n'importe que la config (chemin du logo).
import { LOGO_SRC } from './config.js';

const NEXT = 'accueil.html';
const PERSPECTIVE = 1000;       // doit correspondre à .intro-stage { perspective }
const MAX_SCALE = 26;           // grossissement du logo en fin de course
const DUST_COUNT = 70;

const $ = (id) => document.getElementById(id);
const track = $('track'), world = $('world'), logo = $('logo'), img = $('logo-img');
const dust = $('dust'), glow = $('glow'), hint = $('hint'), fade = $('fade');
const progressEl = $('progress'), fill = $('progress-fill'), skip = $('skip'), enterBtn = $('enter');

function markSeen() { try { localStorage.setItem('hg_intro_seen', '1'); } catch {} }

// Sécurité : si l'intro a déjà été vue (le script en tête de page s'en charge normalement)
try { if (localStorage.getItem('hg_intro_seen')) location.replace(NEXT); } catch {}

/* ---------- Logo ---------- */
img.addEventListener('error', () => logo.classList.add('no-logo'), { once: true });
img.src = LOGO_SRC;

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

if (reduced) {
  /* ---------- Version mouvement réduit : apparition en fondu, puis fondu vers l'accueil ---------- */
  document.body.classList.add('reduced');
  enterBtn.hidden = false;
  try {
    logo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: 'ease-out', fill: 'both' });
    glow.animate([{ opacity: 0 }, { opacity: 0.55 }], { duration: 1200, easing: 'ease-out', fill: 'both' });
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

  // Poussière répartie autour et derrière le logo
  const specks = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < DUST_COUNT; i++) {
    const el = document.createElement('i');
    const z = rnd(-2600, 500);
    // Plus c'est loin, plus on écarte (pour remplir le champ de vision)
    const spread = 1 + (-Math.min(z, 0) / PERSPECTIVE);
    let x = rnd(-0.75, 0.75) * window.innerWidth * spread;
    let y = rnd(-0.75, 0.75) * window.innerHeight * spread;
    // Éviter le centre exact pour ne pas parasiter le logo
    if (Math.abs(x) < 120 && Math.abs(y) < 120) { x += 160 * Math.sign(x || 1); y += 120 * Math.sign(y || 1); }
    const size = rnd(1.5, 3.5);
    el.style.width = el.style.height = `${size}px`;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px)`;
    const base = rnd(0.25, 0.8);
    el.style.opacity = '0';
    specks.push({ el, z, base, last: -1 });
    frag.append(el);
  }
  dust.append(frag);

  // Souris / doigt : léger parallax
  let mx = 0, my = 0, px = 0, py = 0;
  window.addEventListener('pointermove', (e) => {
    mx = (e.clientX / window.innerWidth) * 2 - 1;
    my = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { mx = 0; my = 0; });

  // Clavier : Entrée = entrer directement (les flèches / espace / Page suivante défilent nativement)
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter' && document.activeElement === document.body) leave(500); });

  let target = 0, cur = 0, lastT = performance.now();
  const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const readScroll = () => { target = Math.min(1, Math.max(0, window.scrollY / maxScroll())); };
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', readScroll, { passive: true });

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  let lastPct = -1;

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
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
    logo.style.opacity = (1 - smooth(0.6, 0.93, cur)).toFixed(3);
    const blur = 16 * smooth(0.35, 0.95, cur);
    logo.style.filter = blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : '';
    glow.style.opacity = (0.55 + 0.45 * smooth(0.1, 0.75, cur) - 0.7 * smooth(0.85, 1, cur)).toFixed(3);
    glow.style.transform = `scale(${(1 + cur * 1.6).toFixed(3)})`;
    hint.style.opacity = (1 - smooth(0, 0.08, cur)).toFixed(3);
    if (!leaving) fade.style.opacity = (0.92 * smooth(0.9, 1, cur)).toFixed(3);

    // Poussière : visible quand elle est devant le fond, s'efface avant de passer la caméra
    for (const s of specks) {
      const dz = s.z + camZ;                    // profondeur vue depuis la caméra
      const near = 1 - smooth(PERSPECTIVE * 0.55, PERSPECTIVE * 0.85, dz);
      const far = smooth(-2600, -1600, dz);
      const o = Math.round(s.base * near * far * 100) / 100;
      if (o !== s.last) { s.el.style.opacity = o; s.last = o; }
    }

    const pct = Math.round(target * 100);
    fill.style.clipPath = `inset(0 ${(100 - target * 100).toFixed(2)}% 0 0)`;
    if (pct !== lastPct) { progressEl.setAttribute('aria-valuenow', String(pct)); lastPct = pct; }

    if (!leaving && target >= 0.985 && cur >= 0.95) leave(600);
    requestAnimationFrame(frame);
  }
  readScroll();
  requestAnimationFrame(frame);
}
