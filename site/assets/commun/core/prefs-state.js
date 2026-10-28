// Préférences d'affichage : état et stockage (localStorage 'hg_prefs'), sans dépendance vers le thème ni l'interface.
// Les modules qui ont besoin de lire les préférences importent ce fichier ; c'est prefs.js qui les modifie
// et les répercute (thème, effets, panneau).
/*
 * Rôle : garde les préférences de l'appareil (mode d'affichage, thème spécial, effets, sons, volume,
 * révélation directe des boosters, raccourcis clavier),
 * les valide, les enregistre et pose les attributs correspondants sur <html>.
 * Page : toutes les pages (chargé dès le premier import, donc avant tout rendu).
 * Dépendances : util.js (reducedMotion).
 * Stockage : localStorage « hg_prefs » ; ancienne clé « hg_effects_off » migrée puis supprimée.
 * Exporte : PREF_MODES, PREF_DEFAULTS, getPrefs, applyPrefsAttrs, writePrefs.
 */
import { reducedMotion } from './util.js';

/* ---------- Constantes ---------- */

/** Clé localStorage des préférences. */
const PREFS_KEY = 'hg_prefs';
/** Ancienne clé (« effets désactivés »), lue une fois pour migrer les anciens réglages. */
const OLD_FX_KEY = 'hg_effects_off';
/** Modes d'affichage proposés, avec leur libellé. */
export const PREF_MODES = { sombre: 'Sombre', clair: 'Clair', daltonien: 'Daltonien' };
/**
 * Valeurs par défaut : sombre, thème spécial et effets actifs, sons coupés, volume 60 %,
 * boosters révélés avec leur séquence animée (revealDirect coupé), raccourcis clavier actifs,
 * son « à toi de jouer » des jeux actif (sonTour, indépendant des autres sons).
 */
export const PREF_DEFAULTS = Object.freeze({ mode: 'sombre', special: true, effects: true, sound: false, volume: 0.6, revealDirect: false, shortcuts: true, sonTour: true });

/* ---------- Validation et chargement ---------- */

/**
 * Ramène un objet quelconque à des préférences valides : valeurs inconnues remplacées par les défauts,
 * volume borné entre 0 et 1.
 * @param {object} [p={}] Préférences brutes (par exemple lues dans localStorage).
 * @returns {{mode: string, special: boolean, effects: boolean, sound: boolean, volume: number, revealDirect: boolean, shortcuts: boolean, sonTour: boolean}}
 */
function normalizePrefs(p = {}) {
  const v = Number(p.volume);
  return {
    mode: Object.prototype.hasOwnProperty.call(PREF_MODES, p.mode) ? p.mode : PREF_DEFAULTS.mode,
    special: typeof p.special === 'boolean' ? p.special : PREF_DEFAULTS.special,
    effects: typeof p.effects === 'boolean' ? p.effects : PREF_DEFAULTS.effects,
    sound: typeof p.sound === 'boolean' ? p.sound : PREF_DEFAULTS.sound,
    volume: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : PREF_DEFAULTS.volume,
    revealDirect: typeof p.revealDirect === 'boolean' ? p.revealDirect : PREF_DEFAULTS.revealDirect,
    shortcuts: typeof p.shortcuts === 'boolean' ? p.shortcuts : PREF_DEFAULTS.shortcuts,
    sonTour: typeof p.sonTour === 'boolean' ? p.sonTour : PREF_DEFAULTS.sonTour,
  };
}
/**
 * Lit les préférences dans localStorage, migre l'ancienne clé si elle existe, puis valide le tout.
 * Un localStorage bloqué ou corrompu donne simplement les valeurs par défaut.
 * @returns {object} Préférences valides.
 */
function loadPrefs() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') || {}; } catch {}
  // Migration de l'ancienne clé « effets désactivés »
  try {
    const old = localStorage.getItem(OLD_FX_KEY);
    if (old !== null) {
      if (old === '1' && typeof raw.effects !== 'boolean') raw.effects = false; // l'ancien réglage « coupé » l'emporte
      localStorage.setItem(PREFS_KEY, JSON.stringify(normalizePrefs(raw)));
      localStorage.removeItem(OLD_FX_KEY);
    }
  } catch {}
  return normalizePrefs(raw);
}
/** Préférences en mémoire, chargées une fois au chargement du module. */
let _prefs = loadPrefs();

/* ---------- Lecture et écriture ---------- */

/**
 * Préférences courantes (copie) : { mode, special, effects, sound, volume, revealDirect, shortcuts, sonTour }.
 * @returns {object} Copie de l'état ; la modifier ne change rien.
 */
export function getPrefs() { return { ..._prefs }; }

/**
 * Pose les attributs de préférence sur <html> (data-mode, data-fx, color-scheme).
 * data-fx vaut « off » si les effets sont coupés ou si le système demande moins d'animations.
 * Le CSS s'appuie sur ces attributs.
 */
export function applyPrefsAttrs() {
  const root = document.documentElement;
  root.dataset.mode = _prefs.mode;
  root.dataset.fx = _prefs.effects && !reducedMotion() ? 'on' : 'off';
  root.style.colorScheme = _prefs.mode === 'clair' ? 'light' : 'dark';
}

/**
 * Modifie et enregistre les préférences, applique les attributs. Ne repeint rien : renvoie l'état précédent.
 * Les valeurs passées sont validées comme au chargement.
 * @param {object} [patch={}] Champs à changer (les autres restent inchangés).
 * @returns {object} Préférences avant la modification (utilisé par prefs.js pour savoir quoi repeindre).
 */
export function writePrefs(patch = {}) {
  const before = _prefs;
  _prefs = normalizePrefs({ ..._prefs, ...patch });
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(_prefs)); } catch {}
  applyPrefsAttrs();
  return before;
}
