// ===== Humane Gang — petits sons synthétisés (WebAudio, aucun fichier) =====
// playSound(name) : 'click' | 'success' | 'error' | 'message' | 'badge' | 'fanfare'
// Ne fait rien si les sons sont désactivés dans les préférences (localStorage 'hg_prefs', défaut : off).
/*
 * Rôle : produit de petits sons (clic, succès, erreur, message, badge) avec l'API WebAudio, sans fichier audio.
 * Page : toutes les pages (ui.js, badges.js, prefs.js, godmode.js, etc.). Le son reste coupé tant que
 *   l'utilisateur ne l'a pas activé dans les préférences d'affichage.
 * Dépendances : aucune (lit seulement la préférence dans localStorage « hg_prefs »).
 * Exporte : playSound.
 */

/* ---------- Constantes et état ---------- */

/** Clé localStorage des préférences (son activé, volume). */
const PREFS_KEY = 'hg_prefs';
/** Contexte audio, créé à la première demande (le navigateur l'exige après un geste de l'utilisateur). */
let ctx = null;
/** Sortie générale (gain) : tous les sons passent par elle, ce qui règle le volume. */
let master = null;
/** Dernier instant (performance.now) où chaque son a été joué, pour éviter les rafales. */
let lastPlay = {};

/* ---------- Préférences et contexte audio ---------- */

/**
 * Lit les préférences de son : activé ou non, et volume (entre 0 et 1, 0,6 par défaut).
 * @returns {{on: boolean, volume: number}}
 */
function soundPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') || {};
    const vol = Number(p.volume);
    return { on: p.sound === true, volume: Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.6 };
  } catch { return { on: false, volume: 0.6 }; }
}

/**
 * Crée (une seule fois) le contexte audio et sa sortie générale.
 * @returns {AudioContext|null} Le contexte, ou null si WebAudio n'est pas disponible.
 */
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
// Premier geste (souris, clavier, tactile) sur la page : on débloque le son sans attendre le premier play
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));

/* ---------- Synthèse ---------- */

/**
 * Une note : oscillateur + enveloppe courte. t = départ (s, relatif), d = durée (s).
 * L'enveloppe monte vite (attaque) puis descend jusqu'au silence, pour éviter les clics.
 * @param {AudioContext} c Contexte audio.
 * @param {AudioNode} out Sortie où envoyer la note (master).
 * @param {object} p Paramètres : f (fréquence Hz), t (départ), d (durée), type (forme d'onde),
 *   g (volume de crête), f2 (fréquence finale pour une glissade), attack (durée de l'attaque).
 */
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

/**
 * Numéro de note MIDI vers fréquence en Hz (69 = A4 = 440 Hz).
 * @param {number} n Numéro MIDI.
 * @returns {number} Fréquence en Hz.
 */
const N = (n) => 440 * 2 ** ((n - 69) / 12);

/** Les sons, par nom. Chacun reçoit le contexte et la sortie, et programme ses notes. */
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
  // Fanfare de quatre notes montantes (secret « kc », voir eggs/core.js)
  fanfare: (c, o) => {
    [[72, 0, 0.1], [76, 0.11, 0.1], [79, 0.22, 0.1], [84, 0.33, 0.36]].forEach(([n, t, d]) => {
      note(c, o, { f: N(n), t, d, type: 'square', g: 0.1 });
      note(c, o, { f: N(n - 12), t, d, type: 'triangle', g: 0.12 });
    });
  },
};

/* ---------- Point d'entrée ---------- */

/**
 * Joue un son court. Silencieux (et sans erreur) si les sons sont coupés ou si WebAudio est indisponible.
 * Un même son ne peut pas repartir moins de 40 ms après le précédent (anti-rafale).
 * @param {'click'|'success'|'error'|'message'|'badge'|'fanfare'} name Nom du son.
 */
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
