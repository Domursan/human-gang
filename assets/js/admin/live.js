// ===== Humane Gang — administration : temps réel du panel =====
// Le voyant « En direct » est placé dans le rail (#shell-live, admin/shell.js).
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
// Utilisé par admin.js (initLive) et par les sections (onTableChange). Dépend de core.js (sb), state.js, loaders.js.
import { sb } from '../core.js';
import { hasPerm } from '../core/perms.js';
import { S } from './state.js';
import { canSection } from './perms.js';
import { loadIdeas, loadSupport, loadEditionDetails, loadMembers } from './loaders.js';
import { renderStats } from './overview.js';
import { renderIdeas } from './ideas.js';
import { renderSupport } from './support.js';
import { renderSS } from './ss-render.js';

// Nom du canal Realtime, et temporisations : regroupement, puis nouvelles tentatives (2 s doublées jusqu'à 60 s).
const CHANNEL = 'hg-admin-live';
const DEBOUNCE_MS = 800;
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 60000;

// Tables publiées (migration 030) -> permission qui donne le droit de les lire (clé de hg_perm_catalog,
// ou « admin » pour l'administrateur seul : hg_staff n'a de lecture que pour lui ; hg_admin_log relève de « journal »).
export const TABLE_PERM = {
  hg_ideas: 'support',
  hg_support: 'support',
  hg_support_replies: 'support',
  hg_profiles: 'membres',
  hg_staff: 'admin',
  hg_admin_log: 'journal',
  hg_card_trades: 'cartes',
  hg_card_drop_claims: 'cartes',
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
  hg_support_replies: loadSupport,
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

/**
 * Une saisie est-elle en cours (champ ayant le focus dans la section, champ modifié, dialogue ouvert) ?
 * Dans ce cas la section n'est pas redessinée, pour ne pas effacer ce que la personne écrit.
 * Les cases, boutons et champs cachés ne comptent pas comme saisie.
 */
function busy(el) {
  if (document.querySelector('dialog[open]')) return true;
  if (!el) return false;
  const a = document.activeElement;
  if (a && el.contains(a) && a.matches('input, textarea, [contenteditable="true"]') && !a.matches('[type="search"], [type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="hidden"]')) return true;
  return [...el.querySelectorAll('input, textarea')].some((f) => !f.matches('[type="search"], [type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="hidden"]') && f.value !== f.defaultValue);
}

/** Lance `fn` sans jamais laisser remonter une erreur (un rafraîchissement raté ne doit pas casser le live). */
function safeRun(fn) {
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') r.catch((err) => console.warn('[panel]', err?.message || err));
  } catch (err) { console.warn('[panel]', err?.message || err); }
}

/** Affiche le bandeau « Mises à jour disponibles » en tête de la section (une seule fois). */
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
/** Retire le bandeau d'une section, s'il est affiché. */
function hideBanner(e) {
  if (e.banner) e.banner.remove();
  e.banner = null;
}

/** Actualise une section, ou affiche le bandeau si une saisie est en cours. */
function runEntry(e) {
  const el = document.getElementById(e.id);
  if (el && busy(el)) { showBanner(e); return; }
  hideBanner(e);
  safeRun(e.refresh);
}

/* ---------- Regroupement des événements ---------- */
// Tables modifiées pendant la temporisation, et minuteur en cours.
const pending = new Set();
let timer = null;

/** Note qu'une table a changé et repousse le traitement : une rafale d'écritures ne donne qu'un seul passage. */
function queue(table) {
  pending.add(table);
  clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
}

/**
 * Traite les tables modifiées : recharge leurs données, puis les vues et les sections concernées.
 * Les tables sans rechargement (LOAD) ne font que notifier les sections et l'événement document.
 */
async function flush() {
  timer = null;
  const batch = [...pending];
  pending.clear();
  if (!batch.length) return;
  await Promise.all(batch.map((t) => (LOAD[t] ? LOAD[t]().catch((err) => console.warn('[panel]', t, err?.message || err)) : null)));
  safeRun(renderStats);
  // Copie de la liste : une section peut se retirer pendant le parcours.
  for (const e of entries.slice()) if (batch.some((t) => e.tables.has(t))) runEntry(e);
  for (const table of batch) document.dispatchEvent(new CustomEvent('hg-admin:changed', { detail: { table } }));
}

/* ---------- Canal ---------- */
let channel = null;         // canal Realtime courant (null si fermé)
let subscribed = [];        // tables abonnées
let connected = false;      // état affiché par le voyant
let lost = false;           // une coupure a eu lieu : rattrapage au retour
let retryMs = RETRY_MIN_MS; // délai avant la prochaine tentative (doublé à chaque échec)
let retryTimer = null;
let stopped = false;        // page quittée : plus aucune tentative
let indicator = null;       // voyant « En direct » du rail

/** Tables publiées auxquelles la personne a le droit de lire. */
function allowedTables() {
  return Object.keys(TABLE_PERM).filter((t) => hasPerm(TABLE_PERM[t]));
}

/** Ouvre le canal et s'abonne aux tables. Une erreur synchrone passe en « hors direct » et programme une reprise. */
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

/**
 * Réagit à l'état du canal. Au retour après une coupure, relit toutes les tables abonnées :
 * les changements manqués pendant la coupure sont ainsi rattrapés.
 */
function onStatus(ch, status) {
  if (stopped || ch !== channel) return; // canal remplacé ou page quittée : on ignore
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

/** Programme une reconnexion dans `retryMs`, puis double ce délai (plafonné à 60 s). */
function scheduleRetry() {
  if (stopped) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = null; drop(); connect(); }, retryMs);
  retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
}

/** Ferme le canal courant, s'il existe. */
function drop() {
  const ch = channel;
  channel = null;
  if (ch) { try { sb.removeChannel(ch); } catch { /* sans effet */ } }
}

/** Arrête tout (page quittée) : plus de minuteur, plus de reconnexion. */
function stop() {
  stopped = true;
  clearTimeout(timer);
  clearTimeout(retryTimer);
  drop();
}

/* ---------- Indicateur « En direct » ---------- */
/** Ajoute le voyant dans le rail, s'il existe. */
function mountIndicator() {
  const head = document.getElementById('shell-live'); // voyant du rail (coquille admin)
  if (!head) return;
  indicator = document.createElement('p');
  indicator.className = 'live-status';
  indicator.setAttribute('role', 'status');
  indicator.innerHTML = '<span class="live-dot" aria-hidden="true"></span><span class="live-label"></span>';
  head.append(indicator);
  paintIndicator();
}
/** Mémorise l'état de la connexion et met le voyant à jour. */
function setConnected(on) {
  connected = on;
  paintIndicator();
}
/** Affiche « En direct » ou « Hors direct », avec une info-bulle explicative. */
function paintIndicator() {
  if (!indicator) return;
  indicator.dataset.state = connected ? 'on' : 'off';
  indicator.querySelector('.live-label').textContent = connected ? 'En direct' : 'Hors direct';
  indicator.title = connected ? 'Les données du panel se mettent à jour en direct.' : 'Temps réel indisponible : les données se mettent à jour au rechargement.';
}

/* ---------- Démarrage ---------- */
// Vrai une fois initLive lancé : il ne se lance qu'une seule fois.
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
  if (canSection('assistance')) onTableChange('assistance', ['hg_support', 'hg_support_replies'], renderSupport);
  if (canSection('secret-santa')) onTableChange('secret-santa', ['hg_ss_participants'], () => { if (S.ssLoaded) renderSS(); });
  mountIndicator();
  window.addEventListener('pagehide', stop);
  subscribed = allowedTables();
  if (subscribed.length) connect();
}
