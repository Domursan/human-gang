// ===== Human Gang — petits sons synthétisés (WebAudio, aucun fichier) =====
// playSound(name) : 'click' | 'success' | 'error' | 'message' | 'badge'
// Ne fait rien si les sons sont désactivés dans les préférences (localStorage 'hg_prefs', défaut : off).

const PREFS_KEY = 'hg_prefs';
let ctx = null;
let master = null;
let lastPlay = {};

function soundPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') || {};
    const vol = Number(p.volume);
    return { on: p.sound === true, volume: Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.6 };
  } catch { return { on: false, volume: 0.6 }; }
}

function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
  } catch { ctx = null; }
  return ctx;
}

/** Débloque l'AudioContext au premier geste (exigence des navigateurs). */
function unlock() {
  if (!soundPrefs().on) return;
  const c = audio();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));

/** Une note : oscillateur + enveloppe courte. t = départ (s, relatif), d = durée (s). */
function note(c, out, { f, t = 0, d = 0.1, type = 'square', g = 0.2, f2 = null, attack = 0.004 }) {
  const t0 = c.currentTime + t;
  const o = c.createOscillator();
  const e = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
  e.gain.setValueAtTime(0.0001, t0);
  e.gain.exponentialRampToValueAtTime(g, t0 + attack);
  e.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(e); e.connect(out);
  o.start(t0); o.stop(t0 + d + 0.02);
}

const N = (n) => 440 * 2 ** ((n - 69) / 12); // numéro MIDI -> Hz

const SOUNDS = {
  click: (c, o) => note(c, o, { f: 1400, f2: 900, d: 0.035, type: 'square', g: 0.05 }),
  success: (c, o) => {
    note(c, o, { f: N(84), t: 0, d: 0.09, type: 'triangle', g: 0.22 });
    note(c, o, { f: N(91), t: 0.08, d: 0.16, type: 'triangle', g: 0.22 });
  },
  error: (c, o) => {
    note(c, o, { f: N(57), t: 0, d: 0.11, type: 'square', g: 0.09 });
    note(c, o, { f: N(53), t: 0.1, d: 0.18, type: 'square', g: 0.09 });
  },
  message: (c, o) => {
    note(c, o, { f: N(88), t: 0, d: 0.28, type: 'sine', g: 0.2, attack: 0.006 });
    note(c, o, { f: N(95), t: 0.09, d: 0.38, type: 'sine', g: 0.16, attack: 0.006 });
  },
  // Petite fanfare 8-bit (assortie au logo pixel art)
  badge: (c, o) => {
    const seq = [[72, 0, 0.09], [76, 0.09, 0.09], [79, 0.18, 0.09], [84, 0.27, 0.16], [79, 0.45, 0.09], [84, 0.54, 0.42]];
    for (const [n, t, d] of seq) {
      note(c, o, { f: N(n), t, d, type: 'square', g: 0.09 });
      note(c, o, { f: N(n - 12), t, d, type: 'triangle', g: 0.12 }); // basse douce
    }
    note(c, o, { f: N(96), t: 0.54, d: 0.35, type: 'square', g: 0.025 }); // scintillement
  },
};

/** Joue un son court. Silencieux (et sans erreur) si les sons sont coupés ou si WebAudio est indisponible. */
export function playSound(name) {
  const fn = SOUNDS[name];
  const p = soundPrefs();
  if (!fn || !p.on || p.volume <= 0) return;
  const now = performance.now();
  if (now - (lastPlay[name] || 0) < 40) return; // anti-rafale
  lastPlay[name] = now;
  const c = audio();
  if (!c) return;
  try {
    if (c.state === 'suspended') c.resume().catch(() => {});
    master.gain.setValueAtTime(p.volume * p.volume, c.currentTime); // courbe perçue plus naturelle
    fn(c, master);
  } catch (e) { console.warn('[son]', e); }
}

export const SOUND_NAMES = Object.keys(SOUNDS);
