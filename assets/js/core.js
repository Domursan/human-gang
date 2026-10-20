// ===== Human Gang — socle commun (à importer dans chaque page) =====
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, LOGO_SRC } from './config.js';

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
export { LOGO_SRC };

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
  setTimeout(() => t.remove(), 4500);
}
export function errMsg(e) { return e?.message || String(e); }

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
/**
 * Choisit le thème : forcé (si le réglage le demande et que le thème existe), sinon le thème actif dont la plage
 * contient la date avec la plus haute priorité (à égalité : la plage la plus courte), sinon le thème par défaut.
 */
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
/** Variables CSS dérivées d'un objet colors {accent,bg,surface,text,muted,highlight}. */
export function themeVars(colors = {}) {
  const c = { ...DEFAULT_THEME.colors };
  for (const k of THEME_COLOR_KEYS) if (isHex(colors[k])) c[k] = colors[k];
  return {
    '--accent': c.accent,
    '--accent-text': contrast(c.accent, '#ffffff') >= contrast(c.accent, '#121212') ? '#ffffff' : '#121212',
    '--bg': c.bg,
    '--surface': c.surface,
    '--surface-2': mix(c.surface, c.text, 0.04),
    '--border': mix(c.surface, c.text, 0.085),
    '--border-strong': mix(c.surface, c.text, 0.155),
    '--text': c.text,
    '--muted': c.muted,
    '--sand': c.highlight,
    '--amber': mix(c.highlight, c.accent, 0.3),
  };
}

let _theme = DEFAULT_THEME;
let _themes = null;
let _setting = null;
const FX_KEY = 'hg_effects_off';

/** Pose les couleurs, data-theme, le logo et l'effet d'un thème sur la page (sans rien enregistrer). */
export function paintTheme(theme) {
  const t = theme || DEFAULT_THEME;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themeVars(t.colors))) root.style.setProperty(k, v);
  root.dataset.theme = t.slug || 'classique';
  _theme = t;
  const logo = currentLogo();
  document.querySelectorAll('img.brand-logo').forEach((img) => { if (img.getAttribute('src') !== logo) img.src = logo; });
  startEffects();
  return t;
}
/** Thème appliqué en ce moment (objet avec slug, name, emojis, logo_url, effect, colors…). */
export function getActiveTheme() { return _theme; }
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
      paintTheme(chosen);
      try { localStorage.setItem('hg_theme', JSON.stringify(chosen)); localStorage.removeItem('hg_season'); } catch {}
      return chosen;
    } catch (e) {
      console.warn('[thème]', e);
      return _theme;
    }
  })();
  return _loading;
}
/** Thèmes et réglage chargés par applyTheme (null tant que non chargés). */
export function getThemeState() { return { themes: _themes, setting: _setting, theme: _theme }; }

/* Effets visuels légers (calque derrière le contenu, sans interaction) */
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
export function effectsEnabled() { try { return localStorage.getItem(FX_KEY) !== '1'; } catch { return true; } }
export function setEffectsEnabled(on) {
  try { if (on) localStorage.removeItem(FX_KEY); else localStorage.setItem(FX_KEY, '1'); } catch {}
  startEffects();
}
function startEffects() {
  document.querySelector('.fx-layer')?.remove();
  const fx = _theme?.effect;
  syncFxButton();
  if (!document.body || !fx || fx === 'aucun' || reducedMotion() || !effectsEnabled()) return;
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
function syncFxButton() {
  const btn = document.querySelector('.fx-toggle');
  if (!btn) return;
  const has = _theme?.effect && _theme.effect !== 'aucun' && !reducedMotion();
  btn.hidden = !has;
  const on = effectsEnabled();
  btn.textContent = `Effets : ${on ? 'on' : 'off'}`;
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', `Effets visuels du thème : ${on ? 'activés' : 'désactivés'}`);
}

// Application immédiate du thème mis en cache (avant toute requête réseau)
try {
  const cached = JSON.parse(localStorage.getItem('hg_theme') || 'null');
  if (cached && typeof cached === 'object' && cached.colors) _theme = cached;
} catch {}
{
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themeVars(_theme.colors))) root.style.setProperty(k, v);
  root.dataset.theme = _theme.slug || 'classique';
}

/* Compatibilité avec l'ancien système saisonnier (déprécié : utiliser applyTheme / getActiveTheme) */
export const SEASONS = ['printemps', 'paques', 'ete', 'automne', 'halloween', 'hiver', 'noel'];
export const SEASON_LABELS = { printemps: 'Printemps', paques: 'Pâques', ete: 'Été', automne: 'Automne', halloween: 'Halloween', hiver: 'Hiver', noel: 'Noël' };
export function autoSeason() { return _theme?.slug || 'classique'; }
export const applySeason = applyTheme;

/* ---------- Mise en page commune ---------- */
const NAV = [
  ['secret-santa.html', 'Secret Santa'],
  ['irl.html', 'IRL'],
  ['historique.html', 'Historique'],
];
export function renderHeader(profile) {
  const here = location.pathname.split('/').pop() || 'accueil.html';
  const links = NAV.map(([href, label]) => `<a href="${href}"${here === href ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const admin = profile?.is_admin ? `<a class="nav-admin" href="admin.html"${here === 'admin.html' ? ' aria-current="page"' : ''}>Admin</a>` : '';
  const account = `<a class="nav-account" href="compte.html">${profile ? esc(profile.pseudo) : 'Connexion'}</a>`;
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `<div class="rainbow" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
    <div class="container">
      <a class="brand" href="accueil.html"><img class="brand-logo" src="${esc(currentLogo())}" alt=""><span>HUMAN GANG</span></a>
      <nav class="nav" aria-label="Navigation principale">${profile ? links : ''}${admin}${account}</nav>
    </div>`;
  document.body.prepend(header);
}
export function renderFooter() {
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="container">
      <div>© ${new Date().getFullYear()} Human Gang</div>
      <nav aria-label="Liens légaux">
        <a href="assistance.html">Assistance</a>
        <a href="legal.html#mentions">Mentions légales</a>
        <a href="legal.html#confidentialite">Confidentialité</a>
        <a href="legal.html#cookies">Cookies</a>
        <button class="fx-toggle" type="button" hidden>Effets : on</button>
      </nav>
    </div>`;
  document.body.append(footer);
  footer.querySelector('.fx-toggle').addEventListener('click', () => setEffectsEnabled(!effectsEnabled()));
  syncFxButton();
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

/**
 * Initialise une page : thème (applyTheme), en-tête, pied de page, bandeau cookies.
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
  return profile;
}
