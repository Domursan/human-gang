// ===== Humane Gang — administration : temps réel du panel =====
// Un seul canal Supabase Realtime (« postgres_changes ») abonné aux tables publiées par la migration 030,
// et seulement à celles dont l'utilisateur a le droit (TABLE_PERM). La base ne livre que les lignes que la RLS
// autorise à lire : le filtre de droits ici n'est qu'un allègement.
// Les événements sont regroupés (800 ms), puis :
//  - les données de la vue d'ensemble et les compteurs de navigation sont rechargés ;
//  - chaque section enregistrée (onTableChange) est actualisée. Si l'utilisateur est en train de saisir ou qu'un
//    dialogue est ouvert, la section affiche plutôt un bandeau « Mises à jour disponibles — Actualiser » ;
//  - l'événement document « hg-admin:changed » ({ detail: { table } }) est émis pour chaque table.
// Sans temps réel (réseau coupé, publication absente, client de test), le panel fonctionne comme avant :
// l'indicateur reste gris et rien n'est journalisé dans la console.
import { sb } from '../core.js';
import { hasPerm } from '../core/perms.js';
import { S } from './state.js';
import { canSection } from './perms.js';
import { loadIdeas, loadSupport, loadEditionDetails, loadMembers } from './loaders.js';
import { renderStats } from './overview.js';
import { renderIdeas } from './ideas.js';
import { renderSupport } from './support.js';
import { renderSS } from './ss-render.js';

const CHANNEL = 'hg-admin-live';
const DEBOUNCE_MS = 800;
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 60000;

// Tables publiées (migration 030) -> permission qui donne le droit de les lire (clé de hg_perm_catalog,
// ou « admin » pour l'administrateur seul : hg_staff n'a de lecture que pour lui ; hg_admin_log relève de « journal »).
export const TABLE_PERM = {
  hg_ideas: 'support',
  hg_support: 'support',
  hg_profiles: 'membres',
  hg_staff: 'admin',
  hg_admin_log: 'journal',
  hg_card_trades: 'cartes',
  hg_events: 'evenements',
  hg_event_rsvps: 'evenements',
  hg_moments: 'souvenirs',
  hg_photos: 'souvenirs',
  hg_ss_participants: 'secret_santa',
};

// Rechargement des données partagées (vue d'ensemble, compteurs) avant l'actualisation des sections.
const LOAD = {
  hg_ideas: loadIdeas,
  hg_support: loadSupport,
  hg_profiles: loadMembers,
  hg_ss_participants: loadEditionDetails,
};

/* ---------- Sections enregistrées ---------- */
const entries = []; // { id, tables:Set, refresh, banner }

/**
 * Enregistre le rafraîchissement d'une section (id = identifiant de la <section>) pour ses tables.
 * refresh() est appelé à chaque changement, ou au clic sur « Actualiser » du bandeau si la saisie était en cours.
 * Renvoie une fonction qui retire l'enregistrement.
 */
export function onTableChange(sectionId, tables, refresh) {
  const e = { id: sectionId, tables: new Set(tables), refresh, banner: null };
  entries.push(e);
  return () => { const i = entries.indexOf(e); if (i >= 0) entries.splice(i, 1); };
}

/** Une saisie est-elle en cours (champ modifié ou ayant le focus dans la section, dialogue ouvert) ? */
function busy(el) {
  if (document.querySelector('dialog[open]')) return true;
  if (!el) return false;
  const a = document.activeElement;
  if (a && el.contains(a) && a.matches('input, textarea, [contenteditable="true"]') && !a.matches('[type="search"], [type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="hidden"]')) return true;
  return [...el.querySelectorAll('input, textarea')].some((f) => !f.matches('[type="search"], [type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="hidden"]') && f.value !== f.defaultValue);
}

function safeRun(fn) {
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') r.catch((err) => console.warn('[panel]', err?.message || err));
  } catch (err) { console.warn('[panel]', err?.message || err); }
}

function showBanner(e) {
  const el = document.getElementById(e.id);
  if (!el) return;
  if (!e.banner) {
    const b = document.createElement('div');
    b.className = 'live-banner';
    b.setAttribute('role', 'status');
    b.innerHTML = '<span>Mises à jour disponibles</span> <button class="btn btn-ghost btn-sm" type="button">Actualiser</button>';
    b.querySelector('button').addEventListener('click', () => {
      hideBanner(e);
      safeRun(e.refresh);
    });
    const title = el.querySelector(':scope > .section-title');
    if (title) title.after(b); else el.prepend(b);
    e.banner = b;
  }
}
function hideBanner(e) {
  if (e.banner) e.banner.remove();
  e.banner = null;
}

function runEntry(e) {
  const el = document.getElementById(e.id);
  if (el && busy(el)) { showBanner(e); return; }
  hideBanner(e);
  safeRun(e.refresh);
}

/* ---------- Regroupement des événements ---------- */
const pending = new Set();
let timer = null;

function queue(table) {
  pending.add(table);
  clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
}

async function flush() {
  timer = null;
  const batch = [...pending];
  pending.clear();
  if (!batch.length) return;
  await Promise.all(batch.map((t) => (LOAD[t] ? LOAD[t]().catch((err) => console.warn('[panel]', t, err?.message || err)) : null)));
  safeRun(renderStats);
  for (const e of entries.slice()) if (batch.some((t) => e.tables.has(t))) runEntry(e);
  for (const table of batch) document.dispatchEvent(new CustomEvent('hg-admin:changed', { detail: { table } }));
}

/* ---------- Canal ---------- */
let channel = null;
let subscribed = [];        // tables abonnées
let connected = false;
let lost = false;           // une coupure a eu lieu : rattrapage au retour
let retryMs = RETRY_MIN_MS;
let retryTimer = null;
let stopped = false;
let indicator = null;

function allowedTables() {
  return Object.keys(TABLE_PERM).filter((t) => hasPerm(TABLE_PERM[t]));
}

function connect() {
  if (stopped || !subscribed.length) return;
  let ch = null;
  try {
    ch = sb.channel(CHANNEL);
    for (const table of subscribed) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => queue(table));
    }
    ch.subscribe((status) => onStatus(ch, status));
    channel = ch;
  } catch {
    setConnected(false);
    scheduleRetry();
  }
}

function onStatus(ch, status) {
  if (stopped || ch !== channel) return;
  if (status === 'SUBSCRIBED') {
    setConnected(true);
    retryMs = RETRY_MIN_MS;
    if (lost) { lost = false; for (const t of subscribed) queue(t); } // rattrape ce qui a pu être manqué
    return;
  }
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    setConnected(false);
    lost = true;
    scheduleRetry();
  }
}

function scheduleRetry() {
  if (stopped) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = null; drop(); connect(); }, retryMs);
  retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
}

function drop() {
  const ch = channel;
  channel = null;
  if (ch) { try { sb.removeChannel(ch); } catch { /* sans effet */ } }
}

function stop() {
  stopped = true;
  clearTimeout(timer);
  clearTimeout(retryTimer);
  drop();
}

/* ---------- Indicateur « En direct » ---------- */
function mountIndicator() {
  const head = document.querySelector('.page-head > div:first-child');
  if (!head) return;
  indicator = document.createElement('p');
  indicator.className = 'live-status';
  indicator.setAttribute('role', 'status');
  indicator.innerHTML = '<span class="live-dot" aria-hidden="true"></span><span class="live-label"></span>';
  head.append(indicator);
  paintIndicator();
}
function setConnected(on) {
  connected = on;
  paintIndicator();
}
function paintIndicator() {
  if (!indicator) return;
  indicator.dataset.state = connected ? 'on' : 'off';
  indicator.querySelector('.live-label').textContent = connected ? 'En direct' : 'Hors direct';
  indicator.title = connected ? 'Les données du panel se mettent à jour en direct.' : 'Temps réel indisponible : les données se mettent à jour au rechargement.';
}

/* ---------- Démarrage ---------- */
let started = false;

/**
 * Démarre le temps réel du panel (une seule fois), après le montage des sections.
 * Les sections « Boîte à idées », « Assistance » et « Secret Santa » sont actualisées ici ; les autres
 * s'enregistrent via onTableChange à leur montage.
 */
export function initLive() {
  if (started) return;
  started = true;
  if (canSection('idees')) onTableChange('idees', ['hg_ideas'], renderIdeas);
  if (canSection('assistance')) onTableChange('assistance', ['hg_support'], renderSupport);
  if (canSection('secret-santa')) onTableChange('secret-santa', ['hg_ss_participants'], () => { if (S.ssLoaded) renderSS(); });
  mountIndicator();
  window.addEventListener('pagehide', stop);
  subscribed = allowedTables();
  if (subscribed.length) connect();
}
