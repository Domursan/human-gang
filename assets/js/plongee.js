// ===== Humane Gang — transition « Plongée » =====
// Quand on change de page (lien interne : menu, cartes, liens), la caméra « plonge » dans l'élément cliqué :
// la page grossit autour de lui, des traînées arc-en-ciel jaillissent, puis la page suivante sort du flou.
// Désactivée si l'utilisateur a coupé les effets (préférences) ou demande moins d'animations.
import { motionAllowed } from './core.js';

const DURATION = 1600;          // vitesse « ralentie » choisie par Ethan
const ARRIVE_KEY = 'hg_plongee'; // sessionStorage : horodatage du départ, pour animer l'arrivée
const COLORS = ['#FE3104', '#FCA301', '#FBD32D', '#159946', '#2B5AE2', '#4E2398', '#E0909A'];
let busy = false;

/* ---------- Arrivée sur la nouvelle page ---------- */
function arrive() {
  const root = document.documentElement;
  let fresh = false;
  try { fresh = Date.now() - Number(sessionStorage.getItem(ARRIVE_KEY) || 0) < 4000; sessionStorage.removeItem(ARRIVE_KEY); } catch {}
  root.classList.remove('hg-arrive');
  if (!fresh || !motionAllowed()) return;
  document.body.animate(
    [{ opacity: 0, transform: 'scale(.6)', filter: 'blur(10px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }],
    { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)' },
  );
}

/* ---------- Traînées arc-en-ciel ---------- */
function warp(cx, cy, dur) {
  const c = document.createElement('canvas');
  c.setAttribute('aria-hidden', 'true');
  Object.assign(c.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '2147483000', pointerEvents: 'none' });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  document.documentElement.append(c); // hors de <body>, qui est lui-même animé
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const far = Math.hypot(innerWidth, innerHeight);
  const ps = Array.from({ length: 140 }, () => ({
    a: Math.random() * Math.PI * 2, r0: Math.random() * 40, v: 0.6 + Math.random() * 0.8,
    w: 1 + Math.random() * 2.5, c: COLORS[(Math.random() * COLORS.length) | 0], delay: Math.random() * 0.3,
  }));
  const t0 = performance.now();
  return new Promise((resolve) => {
    (function frame(now) {
      const t = Math.min(1, (now - t0) / dur);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(40, far * t * 0.9));
      g.addColorStop(0, `rgba(158,53,67,${0.55 * Math.min(1, t * 1.5)})`); g.addColorStop(1, 'rgba(158,53,67,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, innerWidth, innerHeight);
      for (const p of ps) {
        const k = Math.min(1, Math.max(0, (t - p.delay) / (1 - p.delay)));
        if (k <= 0) continue;
        const e = k * k;
        const r1 = p.r0 + far * e * p.v, r2 = p.r0 + far * Math.max(0, e - 0.08 - 0.12 * k) * p.v;
        ctx.strokeStyle = p.c; ctx.globalAlpha = Math.min(1, k * 3) * (1 - k * 0.4); ctx.lineWidth = p.w * (0.5 + k * 1.5);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(p.a) * r2, cy + Math.sin(p.a) * r2); ctx.lineTo(cx + Math.cos(p.a) * r1, cy + Math.sin(p.a) * r1); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (t < 1) requestAnimationFrame(frame); else resolve(c);
    })(t0);
  });
}

/* ---------- Départ : plongée dans l'élément cliqué ---------- */
async function dive(el, href) {
  busy = true;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const body = document.body;
  body.style.transformOrigin = `${cx + scrollX}px ${cy + scrollY}px`;
  const fill = Math.max(innerWidth / Math.max(r.width, 1), innerHeight / Math.max(r.height, 1)) * 1.6;
  const end = Math.min(60, fill * 1.8);
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.94)' }, { transform: 'scale(1)' }], { duration: 220 });
  const w = warp(cx, cy, DURATION * 1.1);
  const s = body.animate([
    { transform: 'scale(1)', filter: 'blur(0) brightness(1) saturate(1)', opacity: 1 },
    { transform: 'scale(.96)', filter: 'blur(0) brightness(1) saturate(1)', opacity: 1, offset: 0.12 },
    { transform: `scale(${(fill * 0.35).toFixed(2)})`, filter: 'blur(1px) brightness(1.1) saturate(1.4)', opacity: 1, offset: 0.55 },
    { transform: `scale(${fill.toFixed(2)})`, filter: 'blur(3px) brightness(1.4) saturate(1.8)', opacity: 1, offset: 0.8 },
    { transform: `scale(${end.toFixed(2)})`, filter: 'blur(10px) brightness(2.2) saturate(2)', opacity: 0 },
  ], { duration: DURATION, easing: 'cubic-bezier(.6,0,.85,.25)', fill: 'forwards' }).finished;
  try { sessionStorage.setItem(ARRIVE_KEY, String(Date.now())); } catch {}
  // On navigue un peu avant la fin pour que l'enchaînement soit continu ; garde-fou si l'animation ne se termine pas.
  const go = () => { location.href = href; };
  const safety = setTimeout(go, DURATION + 600);
  await Promise.race([s, new Promise((res) => setTimeout(res, DURATION * 0.95))]);
  clearTimeout(safety);
  go();
  // Retour arrière (cache du navigateur) : remettre la page dans son état normal.
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    body.getAnimations().forEach((a) => a.cancel());
    w.then((c) => c.remove());
    busy = false;
  }, { once: true });
}

/** Le clic doit-il déclencher la plongée ? (lien interne vers une autre page du site, clic simple) */
function targetLink(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!a || a.target && a.target !== '_self' || a.hasAttribute('download') || a.dataset.noPlongee !== undefined) return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return null;
  if (!/\.html$/.test(url.pathname)) return null;
  if (url.pathname === location.pathname) return null; // même page (ancre, paramètres) : pas de plongée
  return { a, href: url.href };
}

export function initPlongee() {
  arrive();
  document.addEventListener('click', (e) => {
    if (busy || !motionAllowed()) return;
    const t = targetLink(e);
    if (!t) return;
    e.preventDefault();
    dive(t.a, t.href);
  });
}
