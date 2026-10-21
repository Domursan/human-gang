// Préférences d'affichage : état et stockage (localStorage 'hg_prefs'), sans dépendance vers le thème ni l'interface.
// Les modules qui ont besoin de lire les préférences importent ce fichier ; c'est prefs.js qui les modifie
// et les répercute (thème, effets, panneau).
import { reducedMotion } from './util.js';

const PREFS_KEY = 'hg_prefs';
const OLD_FX_KEY = 'hg_effects_off';
export const PREF_MODES = { sombre: 'Sombre', clair: 'Clair', daltonien: 'Daltonien' };
export const PREF_DEFAULTS = Object.freeze({ mode: 'sombre', special: true, effects: true, sound: false, volume: 0.6 });

function normalizePrefs(p = {}) {
  const v = Number(p.volume);
  return {
    mode: Object.prototype.hasOwnProperty.call(PREF_MODES, p.mode) ? p.mode : PREF_DEFAULTS.mode,
    special: typeof p.special === 'boolean' ? p.special : PREF_DEFAULTS.special,
    effects: typeof p.effects === 'boolean' ? p.effects : PREF_DEFAULTS.effects,
    sound: typeof p.sound === 'boolean' ? p.sound : PREF_DEFAULTS.sound,
    volume: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : PREF_DEFAULTS.volume,
  };
}
function loadPrefs() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') || {}; } catch {}
  // Migration de l'ancienne clé « effets désactivés »
  try {
    const old = localStorage.getItem(OLD_FX_KEY);
    if (old !== null) {
      if (old === '1' && typeof raw.effects !== 'boolean') raw.effects = false;
      localStorage.setItem(PREFS_KEY, JSON.stringify(normalizePrefs(raw)));
      localStorage.removeItem(OLD_FX_KEY);
    }
  } catch {}
  return normalizePrefs(raw);
}
let _prefs = loadPrefs();

/** Préférences courantes (copie) : { mode, special, effects, sound, volume }. */
export function getPrefs() { return { ..._prefs }; }

/** Pose les attributs de préférence sur <html> (data-mode, data-fx, color-scheme). */
export function applyPrefsAttrs() {
  const root = document.documentElement;
  root.dataset.mode = _prefs.mode;
  root.dataset.fx = _prefs.effects && !reducedMotion() ? 'on' : 'off';
  root.style.colorScheme = _prefs.mode === 'clair' ? 'light' : 'dark';
}

/** Modifie et enregistre les préférences, applique les attributs. Ne repeint rien : renvoie l'état précédent. */
export function writePrefs(patch = {}) {
  const before = _prefs;
  _prefs = normalizePrefs({ ..._prefs, ...patch });
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(_prefs)); } catch {}
  applyPrefsAttrs();
  return before;
}
