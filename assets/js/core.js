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

/* ---------- Thèmes saisonniers ---------- */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
export const SEASONS = ['printemps', 'paques', 'ete', 'automne', 'halloween', 'hiver', 'noel'];
export const SEASON_LABELS = { printemps: 'Printemps', paques: 'Pâques', ete: 'Été', automne: 'Automne', halloween: 'Halloween', hiver: 'Hiver', noel: 'Noël' };
export function autoSeason(now = new Date()) {
  const y = now.getFullYear(), md = (now.getMonth() + 1) * 100 + now.getDate();
  const e = easter(y); const diff = (now - e) / 86400000;
  if (diff >= -7 && diff <= 1) return 'paques';
  if (md >= 1015 && md <= 1031) return 'halloween';
  if (md >= 1201 && md <= 1226) return 'noel';
  if (md >= 320 && md <= 620) return 'printemps';
  if (md >= 621 && md <= 922) return 'ete';
  if (md >= 923 && md <= 1220) return 'automne';
  return 'hiver';
}
export async function applySeason() {
  let season = autoSeason();
  try {
    const cached = localStorage.getItem('hg_season');
    if (cached) document.documentElement.dataset.season = cached;
  } catch {}
  const { data } = await sb.from('hg_settings').select('value').eq('key', 'theme').maybeSingle();
  if (data?.value?.mode === 'forced' && data.value.forced) season = data.value.forced;
  document.documentElement.dataset.season = season;
  try { localStorage.setItem('hg_season', season); } catch {}
  return season;
}

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
      <a class="brand" href="accueil.html"><img src="${LOGO_SRC}" alt=""><span>HUMAN GANG</span></a>
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
      </nav>
    </div>`;
  document.body.append(footer);
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
 * Initialise une page : thème, en-tête, pied de page, bandeau cookies.
 * options.auth : 'member' | 'admin' | 'optional'
 * Renvoie le profil (ou null).
 */
export async function initPage({ auth = 'member' } = {}) {
  applySeason();
  let profile = null;
  if (auth === 'member') profile = await requireMember();
  else if (auth === 'admin') profile = await requireAdmin();
  else profile = await getProfile();
  renderHeader(profile);
  renderFooter();
  cookieNotice();
  return profile;
}
