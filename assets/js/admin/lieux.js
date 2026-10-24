// Admin : le plateau (accueil du panel) et la page de chaque lieu (admin/perms.js, LIEUX).
// - Page de lieu (#<lieu>) : bandeau à la couleur du lieu, zone « À faire maintenant » remplie par le registre
//   registerTodo, puis toutes les pages du lieu en tuiles groupées (icône, libellé, ligne d'aide, compteur).
// - Plateau (#plateau) : registerPlateau(mountFn) pose le contenu de l'accueil ; sans fournisseur, les 7 lieux en cartes.
//
// Registre « À faire » :
//   registerTodo(lieuId, async () => [{ title, meta?, actions: [{ label, href? , onClick? }] }])
//   Appelé à chaque visite de la page du lieu. Vide : « Rien à faire ici pour l'instant. » Plusieurs fournisseurs par lieu : possibles.
// Plateau :
//   registerPlateau((root, { lieux, countOf, totalOf }) => …)   root = #plateau-root (vidé avant l'appel).
//
// Exporte : registerTodo, registerPlateau, plateauMount, renderPlateau, renderLieu, lieuTotal.
// Dépend de core.js (esc), admin/perms.js (LIEUX), admin/panel-icons.js (panelIcon). Ne dépend pas de shell.js.

import { esc } from '../core.js';
import { panelIcon } from './panel-icons.js';

// Fournisseurs « À faire » : lieuId -> [fonction]. Un fournisseur qui échoue ne bloque pas les autres.
const TODO = new Map();
/**
 * Enregistre un fournisseur « À faire » pour un lieu (voir l'API en tête de fichier).
 * @param {string} lieuId Identifiant du lieu (ex. « poste »).
 * @param {() => Promise<Array<{title: string, meta?: string, actions: Array<{label: string, href?: string, onClick?: () => void}>}>>} fn
 */
export function registerTodo(lieuId, fn) {
  const list = TODO.get(lieuId) || [];
  list.push(fn);
  TODO.set(lieuId, list);
}

/** Éléments « À faire » d'un lieu : ceux de tous ses fournisseurs, dans l'ordre d'enregistrement. */
async function todoItems(lieuId) {
  const out = [];
  for (const fn of TODO.get(lieuId) || []) {
    try { out.push(...((await fn()) || [])); } catch (e) { console.warn('[lieu]', lieuId, e); }
  }
  return out;
}

// Fournisseur du plateau (registerPlateau). null : les 7 lieux en cartes (renderPlateau).
let plateauFn = null;
/** Pose le fournisseur du plateau : appelé avec (root, { lieux, countOf, totalOf }) à chaque visite. */
export function registerPlateau(mountFn) { plateauFn = mountFn; }
/** Fournisseur du plateau enregistré, ou null. */
export const plateauMount = () => plateauFn;

/** Nombre « à traiter » d'un lieu : somme des compteurs de ses sous-sections permises. */
export const lieuTotal = (lieu, countOf) => lieu.subs.reduce((t, s) => t + (countOf(s.id) || 0), 0);

/**
 * Cartes des lieux (plateau par défaut) : nom, accroche, icône colorée, pastille du nombre à traiter (repeinte par shell.js).
 * @param {HTMLElement} root Conteneur du plateau (#plateau-root).
 * @param {Array<object>} lieux Lieux permis (visibleLieux).
 */
export function renderPlateau(root, lieux) {
  root.innerHTML = `<p class="plateau-lead small muted">Pastille = ce qui attend une action. Chaque lieu s’ouvre sur ses pages.</p>
    <ul class="plateau-grid" aria-label="Lieux du gang">${lieux.map((l) => `<li>
        <a class="plateau-lieu" href="#${esc(l.id)}" style="--lieu: ${esc(l.color)}">
          <span class="plateau-ico" aria-hidden="true">${panelIcon(l.icon)}</span>
          <span class="plateau-txt"><span class="plateau-name">${esc(l.label)}</span><span class="plateau-tag">${esc(l.tagline)}</span></span>
          <span class="plateau-pastille" data-lieu-badge="${esc(l.id)}" hidden></span>
        </a>
      </li>`).join('')}</ul>`;
}

/**
 * Groupes de sous-sections permises, dans l'ordre (un groupe par titre contigu ; sans titre, la liste est seule).
 * @returns {Array<{heading: string|null, subs: Array<object>}>}
 */
function groupsOf(lieu) {
  const runs = [];
  for (const s of lieu.subs) {
    const last = runs[runs.length - 1];
    if (last && last.heading === (s.heading || null)) last.subs.push(s);
    else runs.push({ heading: s.heading || null, subs: [s] });
  }
  return runs;
}

/** Tuile d'une page du lieu : grande, icône, libellé, ligne d'aide, compteur « à traiter » (repeint par shell.js). */
function tileHtml(lieu, s, countOf) {
  const n = countOf(s.id) || 0;
  return `<a class="lieu-tile" href="#${esc(lieu.id)}/${esc(s.id)}" data-sub="${esc(s.id)}" style="--lieu: ${esc(lieu.color)}">
      <span class="lieu-tile-ico" aria-hidden="true">${panelIcon(s.icon)}</span>
      <span class="lieu-tile-txt"><span class="lieu-tile-name">${esc(s.label)}</span>${s.help ? `<span class="lieu-tile-help">${esc(s.help)}</span>` : ''}</span>
      <span class="nav-count lieu-tile-count" data-count="${esc(s.id)}"${n ? '' : ' hidden'}>${n || ''}</span>
    </a>`;
}

/** Corps de la page d'un lieu : bandeau, « À faire maintenant » (rempli après), toutes les pages groupées. */
function lieuHtml(lieu, countOf) {
  const total = lieuTotal(lieu, countOf);
  const groups = groupsOf(lieu).map((g) => `<section class="lieu-group">
        ${g.heading ? `<h3 class="lieu-group-title">${esc(g.heading)}</h3>` : ''}
        <div class="lieu-tiles">${g.subs.map((s) => tileHtml(lieu, s, countOf)).join('')}</div>
      </section>`).join('');
  return `<div class="lieu" style="--lieu: ${esc(lieu.color)}">
      <section class="lieu-banner" aria-label="${esc(lieu.label)}">
        <p class="lieu-tag">${esc(lieu.tagline)}</p>
        <span class="lieu-total" data-lieu-count="${esc(lieu.id)}"${total ? '' : ' hidden'}>${total} à traiter</span>
      </section>
      <section class="lieu-todo" aria-labelledby="lieu-todo-title">
        <h2 class="lieu-h" id="lieu-todo-title">À faire maintenant</h2>
        <div class="lieu-todo-box" data-lieu-todo><div class="empty">Chargement…</div></div>
      </section>
      <section class="lieu-pages" aria-labelledby="lieu-pages-title">
        <h2 class="lieu-h" id="lieu-pages-title">Toutes les pages de ce lieu</h2>
        ${groups}
      </section>
    </div>`;
}

/** HTML d'un élément « À faire » : titre, précision, actions (liens ou boutons). Les boutons sont liés par index. */
function todoHtml(items) {
  if (!items.length) return '<p class="lieu-todo-empty">Rien à faire ici pour l’instant.</p>';
  return `<ul class="lieu-todo-list">${items.map((it, i) => `<li class="lieu-todo-item">
      <div class="lieu-todo-text"><p class="lieu-todo-title">${esc(it.title)}</p>${it.meta ? `<p class="lieu-todo-meta">${esc(it.meta)}</p>` : ''}</div>
      <div class="lieu-todo-actions">${(it.actions || []).map((a, j) => (a.href
        ? `<a class="btn btn-sand btn-sm" href="${esc(a.href)}">${esc(a.label)}</a>`
        : `<button type="button" class="btn btn-sand btn-sm" data-lieu-act="${i}.${j}">${esc(a.label)}</button>`)).join('')}</div>
    </li>`).join('')}</ul>`;
}

/**
 * Affiche la page d'un lieu dans `root` (vidé d'abord) : bandeau, tuiles, puis « À faire » une fois les fournisseurs prêts.
 * Une visite plus récente (autre lieu) annule le remplissage de celle-ci.
 * @param {HTMLElement} root Conteneur de la page (#lieu-root).
 * @param {object} lieu Lieu permis (visibleLieux).
 * @param {(sub: string) => number} countOf Compteur « à traiter » d'une sous-section.
 */
export async function renderLieu(root, lieu, countOf) {
  root.innerHTML = lieuHtml(lieu, countOf);
  root.dataset.lieu = lieu.id;
  const box = root.querySelector('[data-lieu-todo]');
  const items = await todoItems(lieu.id);
  if (root.dataset.lieu !== lieu.id || !box.isConnected) return; // une autre page a pris la place
  box.innerHTML = todoHtml(items);
  // Clics des boutons « À faire » (index i = élément, j = action, comme dans todoHtml)
  const acts = items.map((it) => it.actions || []);
  root.onclick = (e) => {
    const b = e.target.closest('[data-lieu-act]');
    if (!b) return;
    const [i, j] = b.dataset.lieuAct.split('.').map(Number);
    acts[i]?.[j]?.onClick?.();
  };
}
