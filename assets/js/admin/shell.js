// ===== Humane Gang — administration : coquille du panel (rail, colonne de navigation, zone principale) =====
//
// Structure (admin.html) : rail (#shell-rail) | colonne de navigation (#shell-col) | zone principale (#app) | panneau d'infos (#shell-info).
// Le rail et la colonne sont remplis ici ; les sections (<section class="admin-section">) restent dans #shell-parking
// jusqu'à leur première visite, puis sont déplacées dans le conteneur de leur sous-section.
//
// ---------- API des sous-sections (phase 2) ----------
//   registerSub('domaine/sous-section', {
//     group?: 'id',             // sous-sections partageant un même conteneur (ex. les onglets du Jeu de cartes : group 'cartes')
//     main?: (el) => …,         // appelé UNE fois par groupe, à la première visite ; el = conteneur du groupe.
//                               // La section (id = `section` de DOMAINS) y est déjà placée. Peut être async.
//     open?: (el, { id, tab }) => …, // appelé à chaque visite, après main ; id/tab = segments /id/onglet de l'URL
//     list?: (el) => …,         // colonne 2, sous les sous-sections : appelé une fois par sous-section (phase 2)
//     info?: (el) => …,         // panneau d'infos à droite (affiché ≥ 1440 px seulement) : appelé une fois par sous-section
//   })
// Toutes les sections n'utilisent pour l'instant que `main`. Une sous-section sans fournisseur affiche sa section seule.
// Les droits viennent de admin/perms.js (DOMAINS, canSection) : une sous-section non permise n'est jamais montée.
// setCount(sous-section, n) : compteur « à traiter » affiché dans la colonne et sur les domaines (rail et onglets).
// ------------------------------------------------------

import { $, sb, esc, openPrefs, openGodDialog, disableGodMode, isGodMode, getGodMode, clearPerms } from '../core.js';
import { svg as iconSvg } from '../icons.js';
import { DOMAINS, SECTION_PERM, visibleDomains, canSection } from './perms.js';
import { resolve } from './router.js';

const MOBILE = matchMedia('(max-width: 760px)');
const WIDE = matchMedia('(min-width: 1440px)');

const ICON = {
  gauge: '<path d="M4 15.5a8 8 0 1 1 16 0"/><path d="M12 15.5l3.6-3.6"/><path d="M7 19h10"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.8 20c.6-3.4 3.1-5.5 6.2-5.5s5.6 2.1 6.2 5.5"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6"/><path d="M18.6 14.7c1.7.9 2.7 2.8 2.9 5.3"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>',
  cards: '<rect x="5" y="3.5" width="11" height="14" rx="2.2"/><path d="M8.5 20.5H17a2.5 2.5 0 0 0 2.5-2.5V8.5"/><path d="M9.5 8.2l3 .1M9.5 11.2h4"/>',
  chat: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c-2.6 2.6-2.6 14.4 0 17c2.6-2.6 2.6-14.4 0-17z"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.3-3 7.8-7 9.5-4-1.7-7-5.2-7-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[name] || ''}</svg>`;
// Libellés courts des onglets de la barre mobile
const SHORT = { communication: 'Comm.', vie: 'Vie du gang', cartes: 'Cartes', membres: 'Membres', pilotage: 'Pilotage', site: 'Site' };

const groups = new Map();   // groupe -> { el, ready }
const providers = new Map(); // 'domaine/sous-section' -> fournisseur
const slots = { list: new Map(), info: new Map() };
const counts = new Map();   // sous-section -> n
let seq = 0;
let started = false;
let profile = null;
let curKey = null;
let el = {};

/** Enregistre le fournisseur d'une sous-section (voir l'API en tête de fichier). */
export function registerSub(key, provider = {}) {
  providers.set(key, { group: key, ...provider });
}

/** Place la section `id` dans le conteneur `host` (sans changer ses droits). */
export function place(host, id) {
  const s = document.getElementById(id);
  if (s && host && s.parentElement !== host) host.append(s);
}

/** Compteur « à traiter » d'une sous-section (0 = masqué). */
export function setCount(sub, n) {
  counts.set(sub, n || 0);
  paintCounts();
}

/* ---------- Construction (rail, colonne, onglets mobiles, menu) ---------- */

function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
}

function buildChrome() {
  const doms = visibleDomains();
  el.doms.innerHTML = doms.map((d) => `<a class="shell-dom" href="#${d.id}/${d.subs[0].id}" data-dom="${d.id}" aria-label="${esc(d.label)}">
      ${icon(d.icon)}<span class="shell-badge" data-dom-badge="${d.id}" hidden></span><span class="shell-tip" aria-hidden="true">${esc(d.label)}</span></a>`).join('');
  el.tabs.innerHTML = doms.map((d) => `<a class="shell-tab" href="#${d.id}/" data-dom="${d.id}">
      <span class="shell-tab-pic">${icon(d.icon)}<span class="shell-badge" data-dom-badge="${d.id}" hidden></span></span>
      <span class="shell-tab-label">${esc(SHORT[d.id] || d.label)}</span></a>`).join('');
  el.subsHost.innerHTML = doms.map((d) => `<div class="shell-dom-subs" data-dom-subs="${d.id}" hidden>
      ${d.subs.map((s) => `<a class="shell-sub" href="#${d.id}/${s.id}" data-sub="${s.id}" data-perm="${esc(SECTION_PERM[s.section] || '')}">
        <span>${esc(s.label)}</span><span class="nav-count" data-count="${s.id}" hidden></span></a>`).join('')}
    </div>`).join('');
  // Permissions des éléments de pied (Staff : administrateur seulement ; Réglages : droit « reglages »)
  for (const n of el.foot.querySelectorAll('[data-icon]')) n.innerHTML = icon(n.dataset.icon);
  el.god.innerHTML = iconSvg('bolt', { size: 22, stroke: 1.9 });
  el.foot.querySelector('[data-rail-reglages]').hidden = !canSection('reglages');
  for (const n of el.foot.querySelectorAll('[data-admin-only]')) n.hidden = !profile?.is_admin;
  el.avatar.textContent = initials(profile?.pseudo);
  el.avatar.setAttribute('aria-label', `Compte : ${profile?.pseudo || ''}`);
}

/* ---------- Compteurs ---------- */

function paintCounts() {
  if (!el.col) return;
  for (const [sub, n] of counts) {
    const b = document.querySelector(`.nav-count[data-count="${sub}"]`);
    if (!b) continue;
    b.hidden = !n;
    b.textContent = n || '';
    b.classList.toggle('hot', n > 0);
  }
  for (const d of DOMAINS) {
    const total = d.subs.reduce((t, s) => t + (counts.get(s.id) || 0), 0);
    for (const b of document.querySelectorAll(`[data-dom-badge="${d.id}"]`)) {
      b.hidden = !total;
      b.textContent = total || '';
    }
  }
}

/* ---------- Bouton « Mode sans limite » (réutilise core/godmode.js) ---------- */

function paintGod() {
  const btn = el.god;
  if (!btn) return;
  const { on, until } = getGodMode();
  const left = on && until ? new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' }).format(until) : '';
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('is-on', on);
  const label = on ? `Mode sans limite actif${left ? ` jusqu'à ${left}` : ''} : désactiver` : 'Activer le mode sans limite';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

/* ---------- Menu compte ---------- */

function setMenu(open) {
  el.menu.hidden = !open;
  el.avatar.setAttribute('aria-expanded', String(open));
  if (open) el.menu.querySelector('a, button')?.focus();
}
function bindMenu() {
  el.avatar.addEventListener('click', (e) => { e.stopPropagation(); setMenu(el.menu.hidden); });
  el.menu.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    if (b.dataset.menu === 'prefs') { setMenu(false); openPrefs(e); return; }
    if (b.dataset.menu === 'logout') {
      b.disabled = true;
      try { await sb.auth.signOut(); } catch { /* sans effet */ }
      try { sessionStorage.removeItem('hg_badges_checked'); } catch { /* stockage bloqué */ }
      clearPerms();
      location.href = 'compte.html';
    }
  });
  document.addEventListener('click', (e) => { if (!el.menu.hidden && !el.menu.contains(e.target) && e.target !== el.avatar) setMenu(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.menu.hidden) { setMenu(false); el.avatar.focus(); }
  });
  el.god.addEventListener('click', (e) => {
    if (isGodMode()) disableGodMode(e.currentTarget);
    else openGodDialog(e);
  });
  window.addEventListener('hg:godmode', paintGod);
}

/* ---------- Affichage d'une route ---------- */

function markActive(domId, subId) {
  for (const a of document.querySelectorAll('.shell-dom, .shell-tab')) setCurrent(a, a.dataset.dom === domId);
  for (const a of document.querySelectorAll('.shell-sub')) {
    setCurrent(a, a.dataset.sub === subId && a.closest('[data-dom-subs]')?.dataset.domSubs === domId);
  }
}
function setCurrent(a, on) {
  if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
}

function paintColumn(dom) {
  for (const h of document.querySelectorAll('[data-dom-subs]')) h.hidden = h.dataset.domSubs !== dom.id;
  el.colEyebrow.textContent = 'Domaine';
  el.colTitle.textContent = dom.label;
  const n = dom.subs.reduce((t, s) => t + (counts.get(s.id) || 0), 0);
  el.colSub.textContent = n ? `${n} élément${n > 1 ? 's' : ''} à traiter` : 'Rien à traiter';
}

function slotFor(map, host, key) {
  let node = map.get(key);
  if (node) return { node, fresh: false };
  node = document.createElement('div');
  node.className = 'shell-slot';
  node.dataset.key = key;
  host.append(node);
  map.set(key, node);
  return { node, fresh: true };
}

async function show(r) {
  const token = ++seq;
  if (!r.sub) { // écran du domaine (mobile) : liste des sous-sections
    el.shell.dataset.screen = 'domain';
    el.shell.dataset.info = 'no';
    paintColumn(r.dom);
    markActive(r.dom.id, null);
    el.zoneEyebrow.textContent = r.dom.label;
    el.zoneTitle.textContent = r.dom.label;
    for (const g of groups.values()) g.el.hidden = true;
    return;
  }
  const key = `${r.dom.id}/${r.sub.id}`;
  const p = providers.get(key) || {};
  curKey = key;
  el.shell.dataset.screen = 'sub';
  paintColumn(r.dom);
  markActive(r.dom.id, r.sub.id);
  el.zoneEyebrow.textContent = r.dom.label;
  el.zoneTitle.textContent = r.sub.label;
  // Mobile : liste (colonne 2) plein écran, puis détail ; « retour » ramène à la liste quand un élément est ouvert
  el.back.setAttribute('href', r.id ? `#${r.dom.id}/${r.sub.id}` : `#${r.dom.id}/`);
  el.shell.dataset.sel = r.id ? 'yes' : 'no';
  el.shell.dataset.list = p.list ? 'yes' : 'no';
  // Conteneur du groupe (une seule sous-section visible à la fois ; les déjà montées restent en mémoire)
  const gid = p.group || key;
  let g = groups.get(gid);
  if (!g) {
    const node = document.createElement('div');
    node.className = 'shell-group';
    node.dataset.group = gid;
    el.groupsHost.append(node);
    g = { el: node, ready: null };
    groups.set(gid, g);
  }
  for (const x of groups.values()) x.el.hidden = x !== g;
  if (!g.ready) {
    g.ready = (async () => {
      place(g.el, r.sub.section);
      await p.main?.(g.el);
    })().catch((err) => {
      console.error('[panel]', key, err);
      g.el.innerHTML = '<div class="empty">Cette section n’a pas pu s’afficher. Recharge la page.</div>';
    });
  }
  await g.ready;
  if (token !== seq) return;
  if (p.open) {
    try { await p.open(g.el, { id: r.id, tab: r.tab }); } catch (err) { console.error('[panel]', key, err); }
    if (token !== seq) return;
  }
  // Colonne 2 (liste) et panneau d'infos : une fois par sous-section, seul le courant est affiché
  for (const [k, node] of slots.list) node.hidden = k !== key;
  if (p.list) { const s = slotFor(slots.list, el.listHost, key); if (s.fresh) await p.list(s.node); s.node.hidden = false; }
  for (const [k, node] of slots.info) node.hidden = k !== key;
  if (p.info) { const s = slotFor(slots.info, el.infoHost, key); if (s.fresh) await p.info(s.node); s.node.hidden = false; }
  el.shell.dataset.info = p.info ? 'yes' : 'no';
  el.infoPanel.hidden = !p.info;
  if (token !== seq) return;
  el.zone.scrollTop = 0;
}

function renderNoAccess() {
  el.shell.dataset.screen = 'sub';
  el.shell.dataset.info = 'no';
  el.zoneEyebrow.textContent = 'Panel';
  el.zoneTitle.textContent = 'Aucune section accessible';
  for (const g of groups.values()) g.el.hidden = true;
  el.noAccess.hidden = false;
}

/** Résout le fragment, le remplace si besoin (sans nouvelle entrée d'historique), puis affiche. */
function sync(depth = 0) {
  const r = resolve(location.hash, { mobile: MOBILE.matches });
  if (r.redirect !== undefined) {
    if (!r.redirect) { renderNoAccess(); return; }
    history.replaceState(null, '', `#${r.redirect}`);
    if (depth < 3) return sync(depth + 1);
  }
  el.noAccess.hidden = true;
  show(r);
}

/**
 * Construit la coquille (rail, colonne, onglets mobiles, menu compte) et écoute le routage.
 * Le routage (et le montage de la première sous-section) démarre à startShell(), une fois les données chargées.
 */
export function initShell({ me = null } = {}) {
  profile = me;
  document.querySelector('.site-header')?.remove();   // en-tête du site : remplacé par le rail et le menu compte
  document.querySelector('.site-footer')?.remove();
  el = {
    shell: $('#shell'), rail: $('#shell-rail'), doms: $('#shell-doms'), foot: $('#shell-foot'), god: $('#shell-god'),
    avatar: $('#shell-avatar'), menu: $('#shell-menu'), tabs: $('#shell-tabs'), col: $('#shell-col'),
    colEyebrow: $('#shell-col-eyebrow'), colTitle: $('#shell-col-title'), colSub: $('#shell-col-sub'),
    subsHost: $('#shell-subs'), listHost: $('#shell-col-list'), zone: $('#app'), zoneEyebrow: $('#zone-eyebrow'),
    zoneTitle: $('#zone-title'), back: $('#zone-back'), groupsHost: $('#shell-groups'), noAccess: $('#shell-noaccess'),
    infoPanel: $('#shell-info'), infoHost: $('#shell-info-host'),
  };
  buildChrome();
  bindMenu();
  paintGod();
  el.avatar.setAttribute('aria-expanded', 'false');
  window.addEventListener('hashchange', () => { if (started) sync(); });
  MOBILE.addEventListener('change', () => { if (started) sync(); });
  WIDE.addEventListener('change', () => { if (started) sync(); });
}

/** Démarre le routage : affiche la sous-section demandée (ou la première permise). */
export function startShell() {
  if (started) return;
  started = true;
  paintCounts();
  sync();
}

/** Clé de la sous-section affichée (ex. « membres/comptes ») ou null. */
export const currentSub = () => curKey;
