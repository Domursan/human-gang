// ===== Human Gang — socle commun (à importer dans chaque page) =====
// Ordre volontaire : préférences d'affichage et thème en cache sont appliqués AVANT le chargement
// de supabase-js (import dynamique en fin de module), pour éviter un flash de couleurs.
import { SUPABASE_URL, SUPABASE_KEY, LOGO_SRC } from './config.js';
import { playSound } from './sound.js';

export { LOGO_SRC, playSound };

/* ---------- Utilitaires ---------- */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

const dateFmt = new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (d) => (d ? dateFmt.format(new Date(d)) : '');
export const fmtDateTime = (d) => (d ? dateTimeFmt.format(new Date(d)) : '');
export function daysUntil(d) {
  if (!d) return null;
  const ms = new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}
export function initials(name) { return String(name || '?').trim().slice(0, 2).toUpperCase(); }
export function avatarHtml(p, size = 40) {
  const style = `width:${size}px;height:${size}px;background:${esc(p?.color || 'var(--surface-2)')}`;
  return p?.avatar_url
    ? `<img class="avatar" src="${esc(p.avatar_url)}" alt="" style="${style}">`
    : `<span class="avatar" aria-hidden="true" style="${style}">${esc(initials(p?.pseudo))}</span>`;
}

/* ---------- Toasts ---------- */
export function toast(msg, type = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg;
  box.append(t);
  if (type === 'ok' || type === 'success') playSound('success');
  else if (type === 'error') playSound('error');
  setTimeout(() => t.remove(), 4500);
}
export function errMsg(e) { return e?.message || String(e); }

/* ---------- Préférences d'affichage (par appareil : localStorage 'hg_prefs') ---------- */
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
/** Modifie et enregistre les préférences, puis les applique immédiatement. Renvoie les nouvelles préférences. */
export function setPrefs(patch = {}) {
  const before = _prefs;
  _prefs = normalizePrefs({ ..._prefs, ...patch });
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(_prefs)); } catch {}
  applyPrefsAttrs();
  if (before.special !== _prefs.special) paintTheme(displayTheme(_siteTheme));
  else if (before.mode !== _prefs.mode) paintTheme(_theme);
  else if (before.effects !== _prefs.effects) startEffects();
  syncPrefsDialog();
  try { window.dispatchEvent(new CustomEvent('hg:prefs', { detail: getPrefs() })); } catch {}
  return getPrefs();
}
function applyPrefsAttrs() {
  const root = document.documentElement;
  root.dataset.mode = _prefs.mode;
  root.dataset.fx = _prefs.effects && !reducedMotion() ? 'on' : 'off';
  root.style.colorScheme = _prefs.mode === 'clair' ? 'light' : 'dark';
}

/* ---------- Thèmes paramétrables (table hg_themes + hg_settings.theme) ---------- */
// Thème de secours (identique au thème « Classique » de la base) : utilisé hors ligne ou avant le chargement.
export const DEFAULT_THEME = Object.freeze({
  slug: 'classique', name: 'Classique', is_default: true, active: true, start_md: null, end_md: null, priority: 0,
  logo_url: null, emojis: ['❤️', '🌈', '✨'], effect: 'etoiles',
  colors: { accent: '#9E3543', bg: '#0E0E10', surface: '#17171A', text: '#F2EFEA', muted: '#ABA7A0', highlight: '#E2C77E' },
});
export const THEME_EFFECTS = { aucun: 'Aucun', pluie: "Pluie d'emojis", neige: 'Neige', etoiles: 'Étoiles scintillantes' };
export const THEME_COLOR_KEYS = ['accent', 'bg', 'surface', 'text', 'muted', 'highlight'];

const MD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** 'MM-DD' valide (29 février accepté). */
export function isValidMd(md) {
  const m = MD_RE.exec(String(md ?? ''));
  return !!m && Number(m[2]) <= MONTH_DAYS[Number(m[1]) - 1];
}
export function todayMd(d = new Date()) {
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** La plage [start, end] contient-elle md ? Gère les plages qui passent le nouvel an (12-21 → 03-19). */
export function mdInRange(md, start, end) {
  if (!isValidMd(start) || !isValidMd(end)) return false;
  return start <= end ? md >= start && md <= end : md >= start || md <= end;
}
function rangeLength(t) {
  const n = (md) => { const [m, d] = md.split('-').map(Number); return MONTH_DAYS.slice(0, m - 1).reduce((a, b) => a + b, 0) + d; };
  const a = n(t.start_md), b = n(t.end_md);
  return b >= a ? b - a : 366 - a + b;
}
/** Dimanche de Pâques (calendrier grégorien). */
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
/** Le thème « paques » suit automatiquement la date de Pâques : de 7 jours avant au lundi de Pâques. */
function withDynamicDates(t, date) {
  if (t.slug !== 'paques') return t;
  const e = easterSunday(date.getFullYear());
  const from = new Date(e); from.setDate(e.getDate() - 7);
  const to = new Date(e); to.setDate(e.getDate() + 1);
  return { ...t, start_md: todayMd(from), end_md: todayMd(to) };
}

/**
 * Choisit le thème : forcé (si le réglage le demande et que le thème existe), sinon le thème actif dont la plage
 * contient la date avec la plus haute priorité (à égalité : la plage la plus courte), sinon le thème par défaut.
 */
export function pickTheme(themes = [], setting = null, date = new Date()) {
  const list = (Array.isArray(themes) ? themes : []).map((t) => withDynamicDates(t, date));
  if (setting?.mode === 'forced') {
    const slug = setting.forced_slug ?? setting.forced; // « forced » = ancien format
    const f = list.find((t) => t.slug === slug);
    if (f) return f;
  }
  const md = todayMd(date);
  const hit = list
    .filter((t) => t.active && !t.is_default && mdInRange(md, t.start_md, t.end_md))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || rangeLength(a) - rangeLength(b) || String(a.name).localeCompare(String(b.name)))[0];
  return hit ?? list.find((t) => t.is_default) ?? DEFAULT_THEME;
}

/* Couleurs */
const HEX_RE = /^#[0-9a-f]{6}$/i;
export const isHex = (c) => HEX_RE.test(String(c ?? ''));
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hex([r, g, b]) { return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`; }
function mix(a, b, t) { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); }
export function luminance(c) {
  const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }
/** Assombrit (ou éclaircit) c jusqu'à atteindre le contraste demandé avec `against`. */
function ensureContrast(c, against, ratio, toward = '#000000') {
  let x = c;
  for (let i = 0; i < 24 && contrast(x, against) < ratio; i++) x = mix(x, toward, 0.07);
  return x;
}
function hueSat(c) {
  const [r, g, b] = rgb(c).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return [0, 0];
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const l = (max + min) / 2;
  return [h, d / (1 - Math.abs(2 * l - 1))];
}
const isRedOrGreen = (c) => { const [h, s] = hueSat(c); return s > 0.18 && (h < 25 || h > 330 || (h > 70 && h < 170)); };

/**
 * Variables CSS dérivées d'un objet colors {accent,bg,surface,text,muted,highlight}, composées avec le mode
 * d'affichage (sombre : couleurs du thème telles quelles ; clair : fond/surface/texte inversés, accent et
 * surlignage conservés mais assombris si besoin pour rester lisibles ; daltonien : contrastes renforcés,
 * accent rouge/vert remplacé par du bleu).
 */
export function themeVars(colors = {}, mode = _prefs.mode) {
  const c = { ...DEFAULT_THEME.colors };
  for (const k of THEME_COLOR_KEYS) if (isHex(colors[k])) c[k] = colors[k];
  const accentText = (a) => (contrast(a, '#ffffff') >= contrast(a, '#121212') ? '#ffffff' : '#121212');

  if (mode === 'clair') {
    const bg = mix('#F5F2ED', c.accent, 0.025), surface = '#FFFFFF', text = '#1B1A1F', muted = '#57534C';
    const accent = ensureContrast(c.accent, '#FFFFFF', 4.5);
    const sand = ensureContrast(c.highlight, bg, 4.6);
    return {
      '--accent': accent, '--accent-text': accentText(accent),
      '--bg': bg, '--surface': surface,
      '--surface-2': mix(bg, text, 0.035),
      '--border': mix(surface, text, 0.13),
      '--border-strong': mix(surface, text, 0.26),
      '--text': text, '--muted': muted,
      '--sand': sand,
      '--amber': ensureContrast(mix(c.highlight, c.accent, 0.3), bg, 4.6),
    };
  }
  let accent = c.accent;
  const dalto = mode === 'daltonien';
  if (dalto && isRedOrGreen(accent)) accent = '#3A72C2';
  return {
    '--accent': accent,
    '--accent-text': accentText(accent),
    '--bg': c.bg,
    '--surface': c.surface,
    '--surface-2': mix(c.surface, c.text, dalto ? 0.06 : 0.04),
    '--border': mix(c.surface, c.text, dalto ? 0.16 : 0.085),
    '--border-strong': mix(c.surface, c.text, dalto ? 0.3 : 0.155),
    '--text': c.text,
    '--muted': dalto ? mix(c.muted, c.text, 0.4) : c.muted,
    '--sand': c.highlight,
    '--amber': mix(c.highlight, c.accent, 0.3),
  };
}

let _theme = DEFAULT_THEME;      // thème affiché
let _siteTheme = DEFAULT_THEME;  // thème choisi pour le site (peut différer si « Thème spécial » est coupé)
let _themes = null;
let _setting = null;

/** Thème à afficher pour moi : celui du site, ou le thème par défaut si j'ai coupé les thèmes spéciaux. */
function displayTheme(site) {
  if (_prefs.special || !site || site.is_default) return site || DEFAULT_THEME;
  return (_themes || []).find((t) => t.is_default) || DEFAULT_THEME;
}
function setRootVars(t) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themeVars(t.colors))) root.style.setProperty(k, v);
  root.dataset.theme = t.slug || 'classique';
}

/** Pose les couleurs (composées avec le mode d'affichage), data-theme, le logo et l'effet d'un thème (sans rien enregistrer). */
export function paintTheme(theme) {
  const t = theme || DEFAULT_THEME;
  setRootVars(t);
  _theme = t;
  const logo = currentLogo();
  document.querySelectorAll('img.brand-logo').forEach((img) => { if (img.getAttribute('src') !== logo) img.src = logo; });
  startEffects();
  return t;
}
/** Thème appliqué en ce moment (objet avec slug, name, emojis, logo_url, effect, colors…). */
export function getActiveTheme() { return _theme; }
/** Thème du site aujourd'hui (indépendamment de la préférence « Thème spécial »). */
export function getSiteTheme() { return _siteTheme; }
/** Emoji n° i du thème actif (modulo le nombre d'emojis), '' s'il n'y en a pas. */
export function themeEmoji(i = 0) {
  const list = (_theme?.emojis || []).filter(Boolean);
  if (!list.length) return '';
  const n = Number(i) || 0;
  return list[((n % list.length) + list.length) % list.length];
}
/** Logo du thème actif, sinon le logo du site. */
export function currentLogo() { return _theme?.logo_url || LOGO_SRC; }

/** Charge le réglage + les thèmes, choisit le thème du jour et l'applique (mis en cache pour le chargement suivant). */
let _loading = null;
export function applyTheme({ force = false } = {}) {
  if (_loading && !force) return _loading;
  _loading = (async () => {
    try {
      const [s, t] = await Promise.all([
        sb.from('hg_settings').select('value').eq('key', 'theme').maybeSingle(),
        sb.from('hg_themes').select('*'),
      ]);
      if (t.error) throw t.error;
      _setting = s.data?.value ?? { mode: 'auto', forced_slug: null };
      _themes = t.data ?? [];
      const chosen = pickTheme(_themes, _setting);
      _siteTheme = chosen;
      paintTheme(displayTheme(chosen));
      try { localStorage.setItem('hg_theme', JSON.stringify(chosen)); localStorage.removeItem('hg_season'); } catch {}
      return _theme;
    } catch (e) {
      console.warn('[thème]', e);
      return _theme;
    }
  })();
  return _loading;
}
/** Thèmes et réglage chargés par applyTheme (null tant que non chargés). */
export function getThemeState() { return { themes: _themes, setting: _setting, theme: _theme, siteTheme: _siteTheme }; }

/* Effets visuels légers (calque derrière le contenu, sans interaction) */
function reducedMotion() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }
/** Effets visuels autorisés par l'utilisateur (préférence) — ne tient pas compte de prefers-reduced-motion. */
export function effectsEnabled() { return _prefs.effects; }
/** Effets réellement joués : préférence on ET pas de demande de mouvement réduit. */
export function motionAllowed() { return _prefs.effects && !reducedMotion(); }
export function setEffectsEnabled(on) { setPrefs({ effects: !!on }); }
function startEffects() {
  document.querySelector('.fx-layer')?.remove();
  const fx = _theme?.effect;
  if (!document.body || !fx || fx === 'aucun' || !motionAllowed()) return;
  const layer = document.createElement('div');
  layer.className = `fx-layer fx-${fx}`;
  layer.setAttribute('aria-hidden', 'true');
  const rnd = (a, b) => a + Math.random() * (b - a);
  const small = innerWidth < 600;
  const count = { pluie: small ? 7 : 12, neige: small ? 16 : 30, etoiles: small ? 14 : 26 }[fx] ?? 0;
  let html = '';
  for (let i = 0; i < count; i++) {
    if (fx === 'pluie') {
      const e = themeEmoji(i);
      if (!e) break;
      const d = rnd(16, 28);
      html += `<span style="left:${rnd(0, 97).toFixed(1)}%;font-size:${rnd(16, 26).toFixed(0)}px;animation-duration:${d.toFixed(1)}s;animation-delay:-${rnd(0, d).toFixed(1)}s;--dx:${rnd(-40, 40).toFixed(0)}px;--r:${rnd(-160, 160).toFixed(0)}deg">${esc(e)}</span>`;
    } else if (fx === 'neige') {
      const d = rnd(12, 24), s = rnd(3, 7);
      html += `<span style="left:${rnd(0, 99).toFixed(1)}%;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;animation-duration:${d.toFixed(1)}s;animation-delay:-${rnd(0, d).toFixed(1)}s;--dx:${rnd(-50, 50).toFixed(0)}px;opacity:${rnd(0.35, 0.8).toFixed(2)}"></span>`;
    } else if (fx === 'etoiles') {
      const d = rnd(3, 7), s = rnd(2, 3.5);
      html += `<span style="left:${rnd(0, 99).toFixed(1)}%;top:${rnd(0, 99).toFixed(1)}%;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;animation-duration:${d.toFixed(1)}s;animation-delay:-${rnd(0, d).toFixed(1)}s"></span>`;
    }
  }
  if (!html) return;
  layer.innerHTML = html;
  document.body.prepend(layer);
}

// Application immédiate (avant toute requête réseau) : préférences puis thème mis en cache
applyPrefsAttrs();
try {
  const cached = JSON.parse(localStorage.getItem('hg_theme') || 'null');
  if (cached && typeof cached === 'object' && cached.colors) { _siteTheme = cached; _theme = displayTheme(cached); }
} catch {}
setRootVars(_theme);
try { matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { applyPrefsAttrs(); startEffects(); }); } catch {}

/* Son discret sur les boutons principaux (délégation) */
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('.btn-primary') : null;
  if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') playSound('click');
}, true);

/* Compatibilité avec l'ancien système saisonnier (déprécié : utiliser applyTheme / getActiveTheme) */
export const SEASONS = ['printemps', 'paques', 'ete', 'automne', 'halloween', 'hiver', 'noel'];
export const SEASON_LABELS = { printemps: 'Printemps', paques: 'Pâques', ete: 'Été', automne: 'Automne', halloween: 'Halloween', hiver: 'Hiver', noel: 'Noël' };
export function autoSeason() { return _theme?.slug || 'classique'; }
export const applySeason = applyTheme;

/* ---------- Session & profil ---------- */
let _profile;
export async function getUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
export async function getProfile(force = false) {
  if (_profile !== undefined && !force) return _profile;
  const user = await getUser();
  if (!user) return (_profile = null);
  const { data } = await sb.from('hg_profiles').select('*').eq('id', user.id).maybeSingle();
  return (_profile = data ?? null);
}
/** Redirige vers compte.html si non membre. Renvoie le profil. */
export async function requireMember() {
  const p = await getProfile();
  if (!p) { location.href = `compte.html?next=${encodeURIComponent(location.pathname.split('/').pop())}`; throw new Error('redirect'); }
  return p;
}
export async function requireAdmin() {
  const p = await requireMember();
  if (!p.is_admin) { location.href = 'accueil.html'; throw new Error('redirect'); }
  return p;
}

/** Appelle une fonction edge Supabase (avec le jeton de la session). */
export async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) throw error;
  return data;
}
/** Notifie le bot Discord (silencieux en cas d'échec : le site continue de fonctionner sans bot). */
export async function notify(event, payload = {}) {
  try { await callFn('hg-notify', { event, ...payload }); } catch (e) { console.warn('[hg-notify]', e); }
}

/* ---------- Mise en page commune ---------- */
const NAV = [
  ['secret-santa.html', 'Secret Santa'],
  ['irl.html', 'IRL'],
  ['historique.html', 'Historique'],
];
const ICON_MSG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>';
const ICON_PREFS = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function accountInner(profile) {
  return profile
    ? `${avatarHtml(profile, 32)}<span class="nav-account-name">${esc(profile.pseudo)}</span>`
    : '<span class="nav-account-name nav-account-login">Connexion</span>';
}
let _accountObserver = null;
/** Met à jour le bouton compte de l'en-tête (avatar + pseudo). À appeler après une modification du profil. */
export function updateHeaderProfile(profile = _profile) {
  const a = document.querySelector('.site-header .nav-account');
  if (!a) return;
  _accountObserver?.disconnect();
  a.innerHTML = accountInner(profile);
  a.classList.toggle('is-guest', !profile);
  a.setAttribute('aria-label', profile ? `Mon compte (${profile.pseudo})` : 'Connexion');
  _accountObserver?.observe(a, { childList: true });
}

export function renderHeader(profile) {
  document.querySelector('.site-header')?.remove();
  const here = location.pathname.split('/').pop() || 'accueil.html';
  const cur = (href) => (here === href ? ' aria-current="page"' : '');
  const links = NAV.map(([href, label]) => `<a href="${href}"${cur(href)}>${label}</a>`).join('');
  const messages = profile
    ? `<a class="nav-msg" href="messages.html"${cur('messages.html')} aria-label="Messages">${ICON_MSG}<span class="nav-msg-label">Messages</span><span class="nav-badge" hidden></span></a>`
    : '';
  const admin = profile?.is_admin ? `<a class="nav-admin" href="admin.html"${cur('admin.html')}>Admin</a>` : '';
  const prefs = `<button class="nav-icon prefs-open" type="button" aria-label="Préférences d'affichage" aria-haspopup="dialog" title="Préférences d'affichage">${ICON_PREFS}</button>`;
  const account = `<a class="nav-account" href="compte.html"${cur('compte.html')}></a>`;
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `<div class="rainbow" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
    <div class="container">
      <a class="brand" href="accueil.html"><img class="brand-logo" src="${esc(currentLogo())}" alt=""><span>HUMAN GANG</span></a>
      <nav class="nav" aria-label="Navigation principale">${profile ? links : ''}${messages}${admin}</nav>
      <div class="nav-tools">${prefs}${account}</div>
    </div>`;
  document.body.prepend(header);
  updateHeaderProfile(profile);
  // Si une page remplace le contenu du bouton compte (ex. textContent = pseudo), on remet l'avatar
  const a = header.querySelector('.nav-account');
  _accountObserver = new MutationObserver(() => {
    if (a.querySelector('.nav-account-name')) return;
    const txt = a.textContent.trim();
    updateHeaderProfile(!txt || txt === 'Connexion' ? null : { ...(_profile || {}), pseudo: txt });
  });
  _accountObserver.observe(a, { childList: true });
  header.querySelector('.prefs-open').addEventListener('click', openPrefs);
}

/* Messages non lus */
let _unreadTimer = 0;
let _unreadBound = false;
/** Rafraîchit la pastille « messages non lus » de l'en-tête. Renvoie le nombre (ou null en cas d'échec). */
export async function refreshUnread() {
  const link = document.querySelector('.site-header .nav-msg');
  if (!link) return null;
  try {
    const { data, error } = await sb.rpc('hg_unread_count');
    if (error) throw error;
    const raw = Array.isArray(data) ? data[0] : data;
    const n = Math.max(0, Number(typeof raw === 'object' && raw ? Object.values(raw)[0] : raw) || 0);
    const badge = link.querySelector('.nav-badge');
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    link.setAttribute('aria-label', n ? `Messages, ${n} non lu${n > 1 ? 's' : ''}` : 'Messages');
    return n;
  } catch (e) {
    console.warn('[non lus]', e);
    return null;
  }
}
function startUnread() {
  refreshUnread();
  clearInterval(_unreadTimer);
  _unreadTimer = setInterval(() => { if (!document.hidden) refreshUnread(); }, 60000);
  if (_unreadBound) return;
  _unreadBound = true;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshUnread(); });
}

export function renderFooter() {
  document.querySelector('.site-footer')?.remove();
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="container">
      <div>© ${new Date().getFullYear()} Human Gang</div>
      <nav aria-label="Liens légaux">
        <a href="assistance.html">Assistance</a>
        <a href="legal.html#mentions">Mentions légales</a>
        <a href="legal.html#confidentialite">Confidentialité</a>
        <a href="legal.html#cookies">Cookies</a>
        <button class="footer-prefs prefs-open" type="button" aria-haspopup="dialog">${ICON_PREFS}<span>Préférences d'affichage</span></button>
      </nav>
    </div>`;
  document.body.append(footer);
  footer.querySelector('.prefs-open').addEventListener('click', openPrefs);
}
export function cookieNotice() {
  try { if (localStorage.getItem('hg_cookie_ok')) return; } catch { return; }
  const n = document.createElement('div');
  n.className = 'cookie-notice';
  n.setAttribute('role', 'region'); n.setAttribute('aria-label', 'Information cookies');
  n.innerHTML = `<p>Ce site utilise seulement le stockage nécessaire à son fonctionnement (connexion, préférences). Aucun traceur, aucune publicité. <a href="legal.html#cookies">En savoir plus</a></p>
    <button class="btn btn-light" type="button">OK, compris</button>`;
  n.querySelector('button').addEventListener('click', () => { try { localStorage.setItem('hg_cookie_ok', '1'); } catch {} n.remove(); });
  document.body.append(n);
}

/* ---------- Panneau « Préférences d'affichage » (<dialog>) ---------- */
let _prefsDialog = null;
let _prefsOpener = null;
function buildPrefsDialog() {
  const d = document.createElement('dialog');
  d.className = 'prefs-dialog';
  d.setAttribute('aria-labelledby', 'prefs-title');
  const modes = [
    ['sombre', 'Sombre', 'Par défaut'],
    ['clair', 'Clair', 'Fond clair, texte foncé'],
    ['daltonien', 'Daltonien', 'Bleu / orange, contrastes renforcés'],
  ];
  d.innerHTML = `<form method="dialog" class="prefs-form">
      <div class="prefs-head">
        <h2 id="prefs-title" class="display">Préférences</h2>
        <button class="prefs-close" type="submit" value="close" aria-label="Fermer les préférences">${ICON_CLOSE}</button>
      </div>
      <p class="muted small prefs-note">Enregistrées sur cet appareil seulement.</p>
      <fieldset class="prefs-modes">
        <legend>Mode d'affichage</legend>
        <div class="prefs-mode-grid">
          ${modes.map(([v, l, s]) => `<label class="mode-opt">
            <input type="radio" name="mode" value="${v}">
            <span class="mode-swatch sw-${v}" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="mode-txt"><strong>${l}</strong><small>${s}</small></span>
          </label>`).join('')}
        </div>
      </fieldset>
      <div class="prefs-switches">
        <label class="switch-row">
          <span class="switch-txt"><strong>Thème spécial</strong><small>Thèmes de saison (Noël, Halloween…). Coupé : toujours le thème Classique.</small></span>
          <input class="switch" type="checkbox" role="switch" name="special">
        </label>
        <label class="switch-row">
          <span class="switch-txt"><strong>Effets visuels</strong><small class="fx-note">Animations décoratives : étoiles, neige, confettis…</small></span>
          <input class="switch" type="checkbox" role="switch" name="effects">
        </label>
        <label class="switch-row">
          <span class="switch-txt"><strong>Sons</strong><small>Petits sons discrets : clics, confirmations, messages, badges.</small></span>
          <input class="switch" type="checkbox" role="switch" name="sound">
        </label>
        <div class="volume-row">
          <label for="prefs-volume">Volume</label>
          <input id="prefs-volume" type="range" name="volume" min="0" max="100" step="5">
          <output for="prefs-volume" class="volume-out">60 %</output>
          <button class="btn btn-ghost prefs-test" type="button">Tester</button>
        </div>
      </div>
      <div class="btn-row prefs-actions">
        <button class="btn btn-ghost prefs-reset" type="button">Réinitialiser</button>
        <button class="btn btn-primary" type="submit" value="close">Terminé</button>
      </div>
    </form>`;
  const f = d.querySelector('form');
  f.addEventListener('change', (e) => {
    const el = e.target;
    if (el.name === 'mode') setPrefs({ mode: el.value });
    else if (el.name === 'special' || el.name === 'effects') setPrefs({ [el.name]: el.checked });
    else if (el.name === 'sound') { setPrefs({ sound: el.checked }); if (el.checked) playSound('success'); }
  });
  const vol = f.elements.volume;
  vol.addEventListener('input', () => { setPrefs({ volume: Number(vol.value) / 100 }); });
  vol.addEventListener('change', () => playSound('click'));
  f.querySelector('.prefs-test').addEventListener('click', () => playSound('badge'));
  f.querySelector('.prefs-reset').addEventListener('click', () => { setPrefs({ ...PREF_DEFAULTS }); });
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // clic sur le fond
  d.addEventListener('close', () => { _prefsOpener?.focus?.(); _prefsOpener = null; });
  document.body.append(d);
  return d;
}
function syncPrefsDialog() {
  const d = _prefsDialog;
  if (!d) return;
  const f = d.querySelector('form');
  for (const r of f.querySelectorAll('input[name="mode"]')) r.checked = r.value === _prefs.mode;
  f.elements.special.checked = _prefs.special;
  f.elements.effects.checked = _prefs.effects;
  f.elements.sound.checked = _prefs.sound;
  f.elements.volume.value = String(Math.round(_prefs.volume * 100));
  f.elements.volume.disabled = !_prefs.sound;
  f.querySelector('.prefs-test').disabled = !_prefs.sound;
  f.querySelector('.volume-out').textContent = `${Math.round(_prefs.volume * 100)} %`;
  f.querySelector('.volume-row').classList.toggle('is-off', !_prefs.sound);
  f.querySelector('.fx-note').textContent = reducedMotion()
    ? 'Ton appareil demande de réduire les animations : elles restent coupées.'
    : 'Animations décoratives : étoiles, neige, confettis…';
}
/** Ouvre le panneau des préférences d'affichage. */
export function openPrefs(e) {
  _prefsDialog ||= buildPrefsDialog();
  _prefsOpener = e?.currentTarget || document.activeElement;
  syncPrefsDialog();
  if (!_prefsDialog.open) _prefsDialog.showModal();
  _prefsDialog.querySelector('input[name="mode"]:checked')?.focus();
}

/* ---------- Badges : vérification + célébration ---------- */
const BADGES_SEEN_KEY = 'hg_badges_seen';
const BADGES_SESSION_KEY = 'hg_badges_checked';

function readJson(store, key, fallback) { try { return JSON.parse(store.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
function badgeInitials(name) {
  const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
}

/**
 * Vérifie mes badges et célèbre les nouveaux. Appelée par initPage au plus une fois par session ;
 * { force: true } la relance (ex. après une action qui peut débloquer un badge).
 */
export async function checkNewBadges({ force = false } = {}) {
  const p = _profile;
  if (!p?.id) return [];
  try {
    if (!force && sessionStorage.getItem(BADGES_SESSION_KEY)) return [];
    sessionStorage.setItem(BADGES_SESSION_KEY, '1');
  } catch { if (!force) return []; }
  try {
    await applyTheme();
    const site = _siteTheme;
    if (site && !site.is_default && site.slug) {
      const r = await sb.rpc('hg_mark_theme_seen', { p_slug: site.slug });
      if (r.error) console.warn('[badges] thème vu', r.error);
    }
    const ref = await sb.rpc('hg_refresh_my_badges');
    if (ref.error) console.warn('[badges] rafraîchissement', ref.error);
    const [mine, all] = await Promise.all([
      sb.from('hg_user_badges').select('badge_code, awarded_at').eq('user_id', p.id),
      sb.from('hg_badges').select('code, name, description, image_url, sort'),
    ]);
    if (mine.error) throw mine.error;
    const codes = (mine.data || []).map((b) => b.badge_code);
    const seenAll = readJson(localStorage, BADGES_SEEN_KEY, null);
    const map = seenAll && typeof seenAll === 'object' && !Array.isArray(seenAll) ? seenAll : {};
    const known = Array.isArray(map[p.id]) ? map[p.id] : null;
    map[p.id] = [...new Set([...(known || []), ...codes])];
    try { localStorage.setItem(BADGES_SEEN_KEY, JSON.stringify(map)); } catch {}
    if (!known) return []; // premier passage sur cet appareil : on enregistre sans célébrer
    const fresh = codes.filter((c) => !known.includes(c));
    if (!fresh.length) return [];
    const info = new Map((all.data || []).map((b) => [b.code, b]));
    const list = fresh.map((c) => info.get(c) || { code: c, name: c, description: '' });
    celebrateBadges(list);
    return list;
  } catch (e) {
    console.warn('[badges]', e);
    return [];
  }
}

/** Affiche la célébration (plein écran) pour une liste de badges { code, name, description, image_url }. */
export function celebrateBadges(list) {
  const queue = [...(list || [])];
  if (!queue.length) return;
  const total = queue.length;
  const d = document.createElement('dialog');
  d.className = 'badge-celebrate';
  d.setAttribute('aria-labelledby', 'bc-title');
  d.setAttribute('aria-describedby', 'bc-desc');
  d.innerHTML = `<canvas class="bc-confetti" aria-hidden="true"></canvas>
    <div class="bc-card">
      <p class="eyebrow">Nouveau badge débloqué</p>
      <div class="bc-badge"></div>
      <h2 id="bc-title" class="display"></h2>
      <p id="bc-desc" class="bc-desc"></p>
      <p class="bc-count small muted" hidden></p>
      <div class="btn-row bc-actions">
        <button class="btn btn-primary bc-ok" type="button">Super !</button>
        <a class="btn btn-ghost bc-link" href="compte.html">Voir mes badges</a>
      </div>
    </div>`;
  document.body.append(d);
  const canvas = d.querySelector('canvas');
  let stop = () => {};
  let idx = 0;
  const show = () => {
    const b = queue[idx];
    const box = d.querySelector('.bc-badge');
    box.innerHTML = b.image_url
      ? `<img src="${esc(b.image_url)}" alt="">`
      : `<span class="bc-initials" aria-hidden="true">${esc(badgeInitials(b.name))}</span>`;
    d.querySelector('#bc-title').textContent = b.name || b.code;
    d.querySelector('#bc-desc').textContent = b.description || '';
    const cnt = d.querySelector('.bc-count');
    cnt.hidden = total < 2;
    cnt.textContent = `${idx + 1} / ${total}`;
    d.querySelector('.bc-ok').textContent = idx < total - 1 ? 'Suivant' : 'Super !';
    d.classList.remove('bc-pop'); void d.offsetWidth; d.classList.add('bc-pop');
    stop(); stop = motionAllowed() ? confetti(canvas) : () => {};
    playSound('badge');
  };
  const next = () => {
    if (++idx < total) show();
    else d.close();
  };
  d.addEventListener('click', (e) => { if (!e.target.closest('.bc-link')) { e.preventDefault(); next(); } });
  d.addEventListener('cancel', (e) => { e.preventDefault(); d.close(); }); // Échap : tout fermer
  d.addEventListener('close', () => { stop(); d.remove(); });
  d.showModal();
  d.querySelector('.bc-ok').focus();
  show();
}

/** Confettis « pixel » arc-en-ciel sur un canvas plein écran. Renvoie une fonction d'arrêt. */
function confetti(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const css = getComputedStyle(document.documentElement);
  const colors = [1, 2, 3, 4, 5, 6].map((i) => css.getPropertyValue(`--rb-${i}`).trim() || '#ffffff');
  const n = Math.round(Math.min(160, Math.max(70, (W * H) / 9000)));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const parts = Array.from({ length: n }, (_, i) => {
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? rnd(-10, W * 0.15) : rnd(W * 0.85, W + 10), y: rnd(H * 0.55, H * 0.9),
      vx: (fromLeft ? 1 : -1) * rnd(120, 420), vy: -rnd(520, 980),
      s: Math.round(rnd(2, 4)) * 3, c: colors[i % colors.length], ph: rnd(0, 6.28), sp: rnd(6, 14),
    };
  });
  let raf = 0, t0 = performance.now(), last = t0;
  const LIFE = 3200;
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const k = (now - t0) / LIFE;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = k > 0.75 ? Math.max(0, 1 - (k - 0.75) / 0.25) : 1;
    for (const p of parts) {
      p.vy += 900 * dt; p.vx *= 1 - 0.9 * dt; p.vy *= 1 - 0.35 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const flip = Math.abs(Math.cos(p.ph + now / 1000 * p.sp)); // « retournement » sans rotation : reste pixel
      const h = Math.max(3, Math.round((p.s * flip) / 3) * 3);
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x / 3) * 3, Math.round(p.y / 3) * 3, p.s, h);
    }
    if (k < 1) raf = requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H); };
}

/**
 * Initialise une page : thème (applyTheme), en-tête, pied de page, bandeau cookies,
 * puis (membre) pastille des messages non lus et vérification des badges.
 * options.auth : 'member' | 'admin' | 'optional'
 * Renvoie le profil (ou null).
 */
export async function initPage({ auth = 'member' } = {}) {
  applyTheme();
  let profile = null;
  if (auth === 'member') profile = await requireMember();
  else if (auth === 'admin') profile = await requireAdmin();
  else profile = await getProfile();
  renderHeader(profile);
  renderFooter();
  cookieNotice();
  startEffects();
  if (profile) {
    startUnread();
    checkNewBadges();
  }
  return profile;
}

/* ---------- Client Supabase (chargé en dernier, voir en tête de fichier) ---------- */
const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');

// Verrou simple en mémoire à la place du verrou navigateur (Navigator LockManager) :
// celui-ci provoquait l'erreur « Acquiring an exclusive Navigator LockManager lock … immediately failed »
// et bloquait le chargement quand plusieurs requêtes partaient en même temps.
const memoryLock = (() => {
  let queue = Promise.resolve();
  return async (_name, _timeout, fn) => {
    const run = queue.then(() => fn());
    queue = run.catch(() => {});
    return run;
  };
})();

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, lock: memoryLock },
});
