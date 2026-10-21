// ===== Humane Gang — événements dynamiques : une image spéciale traverse le site =====
// Appelé par initPage (core.js) pour les membres. À chaque page vue :
//   rpc hg_dyn_active() → pour chaque événement non épuisé, tirage selon `probability` (« 1 chance sur N pages »),
//   puis 1 à max_per_page apparitions à des moments aléatoires (≈ 5 à 40 s). Clic / tap / Entrée → rpc hg_dyn_capture.
// Sans mouvement (prefers-reduced-motion ou effets coupés) : l'image apparaît en fondu, immobile, dans un coin.
// Le calque est en position fixe au-dessus du contenu, sans capter les clics (seule l'image est cliquable).
import { sb, toast, esc, playSound, motionAllowed, checkNewBadges, isGodMode } from './core.js';
import { rnd } from './utils.js';

const FALLBACK_EMOJI = '✨';
const REASONS = {
  termine: 'Trop tard : cet événement est terminé.',
  limite_perso: 'Tu as déjà attrapé le maximum pour cet événement.',
  epuise: 'Raté ! Toutes les images ont déjà été attrapées.',
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Données ---------- */
let _active = null;
/** Événements en cours (rpc hg_dyn_active), mis en cache pour la page. Jamais d'erreur : [] si la RPC échoue. */
export function getActiveDynEvents({ force = false } = {}) {
  if (_active && !force) return _active;
  _active = (async () => {
    try {
      const { data, error } = await sb.rpc('hg_dyn_active');
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[événements]', e?.message || e);
      return [];
    }
  })();
  return _active;
}

/* ---------- Calque + styles (injectés une fois) ---------- */
function ensureLayer(host = document.body) {
  let layer = host.querySelector(':scope > .dyn-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'dyn-layer';
    layer.innerHTML = '<p class="visually-hidden dyn-live" aria-live="polite"></p>';
    host.append(layer);
  }
  return layer;
}
function announce(layer, msg) {
  const live = layer.querySelector('.dyn-live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 50);
}
const preload = (src) => new Promise((resolve) => {
  if (!src) return resolve(false);
  const im = new Image();
  im.onload = () => resolve(true);
  im.onerror = () => resolve(false);
  im.src = src;
});

/* ---------- Trajectoires ---------- */
const STEPS = 48;
/** Renvoie une liste de keyframes (transform) pour traverser un écran W×H avec une image de taille s. */
function trajectory(kind, W, H, s) {
  const dir = Math.random() < 0.5 ? 1 : -1;
  const xa = dir > 0 ? -s - 10 : W + 10, xb = dir > 0 ? W + 10 : -s - 10;
  const wobble = rnd(6, 16), wobbleF = rnd(1.5, 3.5), r0 = rnd(-10, 10);
  const pts = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    let x, y, r = r0 + Math.sin(t * Math.PI * 2 * wobbleF) * wobble;
    if (kind === 'diagonale') {
      if (!pts.y0) { pts.y0 = rnd(0.05, 0.6) * H; pts.y1 = clamp(pts.y0 + rnd(-0.45, 0.45) * H, 0, H - s); }
      x = xa + (xb - xa) * t; y = pts.y0 + (pts.y1 - pts.y0) * t;
    } else if (kind === 'vague') {
      if (!pts.yc) { pts.yc = rnd(0.2, 0.7) * H; pts.A = rnd(40, Math.max(60, 0.16 * H)); pts.f = rnd(1.2, 2.6); }
      x = xa + (xb - xa) * t; y = clamp(pts.yc + pts.A * Math.sin(t * Math.PI * 2 * pts.f), 0, H - s);
    } else if (kind === 'rebond') {
      if (!pts.floor) { pts.floor = H - s - 12; pts.h0 = rnd(0.45, 0.75) * H; pts.b = Math.round(rnd(3, 5)); }
      const h = pts.h0 * (1 - 0.55 * t);
      x = xa + (xb - xa) * t; y = pts.floor - Math.abs(Math.cos(Math.PI * pts.b * t)) * h;
      r = r0 + Math.sin(t * Math.PI * pts.b) * wobble; // léger roulis à chaque rebond
    } else { // chute : du haut vers le bas en se balançant
      if (!pts.xc) { pts.xc = rnd(0.1, 0.85) * W; pts.A = rnd(30, 90); pts.f = rnd(1, 2.2); }
      x = clamp(pts.xc + pts.A * Math.sin(t * Math.PI * 2 * pts.f), 0, W - s); y = -s - 10 + (H + s + 20) * t;
    }
    pts.push({ transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${r.toFixed(1)}deg)`, offset: t });
  }
  return pts;
}
const KINDS = ['diagonale', 'vague', 'rebond', 'chute'];

/* ---------- Effet de capture ---------- */
function burst(layer, cx, cy, size, motion) {
  const plus = document.createElement('span');
  plus.className = 'dyn-plus';
  plus.textContent = '+1';
  plus.style.left = `${cx}px`; plus.style.top = `${cy - size / 2}px`;
  layer.append(plus);
  const lifePlus = motion ? 1100 : 900;
  plus.animate(motion
    ? [{ transform: 'translate(-50%, 0) scale(.6)', opacity: 0 }, { transform: 'translate(-50%, -18px) scale(1.15)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%, -64px) scale(1)', opacity: 0 }]
    : [{ opacity: 0, transform: 'translate(-50%, 0)' }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.2 }, { opacity: 0, transform: 'translate(-50%, 0)' }],
  { duration: lifePlus, easing: 'ease-out', fill: 'forwards' }).finished.finally(() => plus.remove());
  if (!motion) return;
  const css = getComputedStyle(document.documentElement);
  const colors = [1, 2, 3, 4, 5, 6].map((i) => css.getPropertyValue(`--rb-${i}`).trim() || '#E2C77E');
  const n = 18;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'dyn-px';
    const px = Math.round(rnd(2, 4)) * 3;
    p.style.cssText = `left:${cx}px;top:${cy}px;width:${px}px;height:${px}px;background:${colors[i % colors.length]}`;
    layer.append(p);
    const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2), d = rnd(size * 0.6, size * 1.4);
    const dx = Math.round((Math.cos(a) * d) / 3) * 3, dy = Math.round((Math.sin(a) * d) / 3) * 3;
    p.animate([
      { transform: 'translate(-50%, -50%)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`, opacity: 1, offset: 0.7 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 18}px))`, opacity: 0 },
    ], { duration: rnd(550, 850), easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).finished.finally(() => p.remove());
  }
}

/**
 * Fait apparaître l'image d'un événement une fois. Résout quand l'image a disparu (attrapée ou non).
 * ev : { id, name, image_url, emoji, duration_ms, size_px }.
 * opts.preview : aperçu admin (aucune capture enregistrée). opts.host : élément hôte (ex. <dialog> ouvert).
 * opts.onCatch(result) : appelé après une capture réussie.
 */
export async function flyDynImage(ev, { preview = false, host = document.body, onCatch } = {}) {
  const size = clamp(Number(ev.size_px) || 72, 24, 320);
  const duration = clamp(Number(ev.duration_ms) || 6000, 1500, 30000);
  const name = String(ev.name || 'l\'image spéciale');
  const hasImg = ev.image_url ? await preload(ev.image_url) : false;
  const layer = ensureLayer(host);
  const motion = motionAllowed();
  const W = innerWidth, H = innerHeight;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `dyn-fly${motion ? '' : ' is-still'}`;
  btn.setAttribute('aria-label', `Attraper ${name}`);
  btn.style.width = `${size}px`; btn.style.height = `${size}px`;
  btn.innerHTML = hasImg
    ? `<img src="${esc(ev.image_url)}" alt="" draggable="false">`
    : `<span class="dyn-emoji" style="font-size:${Math.round(size * 0.82)}px">${esc(ev.emoji || FALLBACK_EMOJI)}</span>`;
  layer.append(btn);
  announce(layer, `${name} vient d'apparaître ! Appuie sur le bouton « Attraper » pour l'attraper.`);

  let anim;
  if (motion) {
    anim = btn.animate(trajectory(pick(KINDS), W, H, size), { duration, easing: 'linear', fill: 'forwards' });
  } else {
    const corners = [['16px', null, '96px', null], [null, '16px', '96px', null], ['16px', null, null, '24px']];
    const [l, r, t, b] = pick(corners);
    Object.assign(btn.style, { left: l ?? 'auto', right: r ?? 'auto', top: t ?? 'auto', bottom: b ?? 'auto' });
    const fade = Math.min(400, duration / 6);
    anim = btn.animate([{ opacity: 0 }, { opacity: 1, offset: fade / duration }, { opacity: 1, offset: 1 - fade / duration }, { opacity: 0 }],
      { duration, easing: 'linear', fill: 'forwards' });
  }

  return new Promise((resolve) => {
    let caught = false;
    const cleanup = () => { btn.remove(); resolve(caught); };
    anim.finished.then(() => { if (!caught) cleanup(); }, () => {});
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (caught) return;
      caught = true;
      btn.disabled = true;
      anim.pause();
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      burst(layer, cx, cy, size, motion); // le calque est fixe et couvre la fenêtre : coordonnées écran
      const tf = getComputedStyle(btn).transform;
      const base = tf && tf !== 'none' ? tf : '';
      const pop = btn.animate(motion
        ? [{ transform: `${base} scale(1)`, opacity: 1 }, { transform: `${base} scale(1.35)`, opacity: 0 }]
        : [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out', fill: 'forwards' });
      pop.finished.finally(() => { anim.cancel(); cleanup(); });

      if (preview) {
        playSound('success');
        toast(`Aperçu : tu as attrapé ${name}. Rien n'est enregistré.`);
        onCatch?.({ ok: true, preview: true });
        return;
      }
      try {
        const { data, error } = await sb.rpc('hg_dyn_capture', { p_event: ev.id });
        if (error) throw error;
        const res = (Array.isArray(data) ? data[0] : data) || {};
        if (!res.ok) {
          toast(REASONS[res.reason] || 'Capture impossible.', 'error');
          onCatch?.(res);
          return;
        }
        playSound(res.badge_new ? 'badge' : 'success');
        toast(`Tu as attrapé ${name} (${Number(res.mine) || 1})`);
        onCatch?.(res);
        // Nouveau badge ou montée de niveau : la célébration de core.js s'en charge (elle compare aussi les niveaux).
        setTimeout(() => checkNewBadges({ force: true }), motion ? 1100 : 300); // laisse l'éclatement se jouer
      } catch (err) {
        toast(`Capture impossible : ${err?.message || err}`, 'error');
      }
    });
  });
}

/* ---------- Planification sur une page ---------- */
const waitVisible = () => (document.hidden
  ? new Promise((r) => document.addEventListener('visibilitychange', function f() { if (!document.hidden) { document.removeEventListener('visibilitychange', f); r(); } }))
  : Promise.resolve());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Mode sans limite (admin) : chaque événement existant (même inactif ou terminé) apparaît une fois à chaque page,
   peu après le chargement, sans limite de captures (le serveur ignore dates, actif et maximums pour l'admin en mode actif). */
let _forced = false;
async function forceAllDynEvents() {
  if (_forced) return;
  _forced = true;
  let list = [];
  try {
    const { data, error } = await sb.from('hg_dyn_events').select('*').order('starts_at', { ascending: false });
    if (error) throw error;
    list = Array.isArray(data) ? data : [];
  } catch (e) { console.warn('[événements] mode sans limite', e?.message || e); return; }
  list.forEach((ev, i) => {
    (async () => {
      await sleep(1200 + i * 2200);
      await waitVisible();
      if (!isGodMode()) return;
      await flyDynImage(ev, {});
    })().catch((e) => console.warn('[événements]', e));
  });
}

let _started = false;
/** Lance les apparitions de la page pour un membre. Ne jette jamais. */
export async function startDynEvents(profile) {
  if (_started || !profile?.id) return;
  _started = true;
  try {
    if (profile.is_admin) {
      window.addEventListener('hg:godmode', (e) => { if (e.detail?.on) forceAllDynEvents(); });
      if (isGodMode()) { await forceAllDynEvents(); return; }
    }
    if (/(^|\/)admin\.html$/.test(location.pathname)) return; // l'admin a son bouton « Tester l'apparition »
    const list = await getActiveDynEvents();
    for (const ev of list) {
      const state = { mine: Number(ev.my_captures) || 0, remaining: ev.remaining_total == null ? null : Number(ev.remaining_total) };
      const exhausted = () => (ev.max_per_user != null && state.mine >= Number(ev.max_per_user)) || (state.remaining != null && state.remaining <= 0);
      if (exhausted()) continue;
      const p = clamp(Number(ev.probability) || 0, 0, 1);
      if (Math.random() >= p) continue;
      const count = 1 + Math.floor(Math.random() * Math.max(1, Number(ev.max_per_page) || 1));
      // Moments aléatoires entre 5 et 40 s, espacés d'au moins 3 s
      const times = Array.from({ length: count }, () => rnd(5000, 40000)).sort((a, b) => a - b);
      for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i], times[i - 1] + 3000);
      (async () => {
        let t0 = 0;
        for (const t of times) {
          await sleep(t - t0); t0 = t;
          await waitVisible();
          if (exhausted()) return;
          await flyDynImage(ev, {
            onCatch: (res) => {
              if (res?.ok) { state.mine = Number(res.mine) || state.mine + 1; if (state.remaining != null) state.remaining--; }
              else if (res?.reason) { state.remaining = 0; } // terminé / épuisé / limite : on arrête pour cet événement
            },
          });
        }
      })().catch((e) => console.warn('[événements]', e));
    }
  } catch (e) {
    console.warn('[événements]', e);
  }
}
