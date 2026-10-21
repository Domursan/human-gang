// Admin : palette « Aller à… » (Ctrl/Cmd+K ou bouton du menu). Filtre les sections permises et les membres (pseudo).
// Entrée ouvre la section ou la fiche. Dialogue modal : focus piégé, Échap ferme, le reste de la page est inerte.
// Propre à admin.html : la recherche globale du site (core/search.js) ne s'ouvre pas en même temps.
import { esc } from '../core.js';
import { S } from './state.js';
import { ensureMembers } from './loaders.js';
import { canSection } from './perms.js';
import { go } from './router.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const MAX_MEMBERS = 12;
let ui = null;

function build() {
  const root = document.createElement('div');
  root.className = 'apal-backdrop';
  root.hidden = true;
  root.innerHTML = `<div class="apal" role="dialog" aria-modal="true" aria-labelledby="apal-title">
      <div class="apal-head">
        <h2 class="apal-title" id="apal-title">Aller à…</h2>
        <button class="btn btn-ghost btn-sm" type="button" data-apal-close>Fermer</button>
      </div>
      <input class="apal-input" id="apal-q" type="text" role="combobox" aria-expanded="true" aria-controls="apal-list"
        aria-autocomplete="list" aria-activedescendant="" autocomplete="off" spellcheck="false" placeholder="Section ou pseudo">
      <ul class="apal-list" id="apal-list" role="listbox" aria-label="Résultats"></ul>
      <p class="apal-hint small muted">Flèches pour choisir, Entrée pour ouvrir, Échap pour fermer.</p>
    </div>`;
  document.body.append(root);
  ui = {
    root, dialog: root.firstElementChild, input: root.querySelector('#apal-q'), list: root.querySelector('#apal-list'),
    closeBtn: root.querySelector('[data-apal-close]'), items: [], active: 0, opener: null, inerted: [], membersState: 'idle',
  };
  ui.input.addEventListener('input', () => { ui.active = 0; render(); });
  ui.input.addEventListener('keydown', onInputKey);
  ui.dialog.addEventListener('keydown', onDialogKey);
  ui.list.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) choose(Number(li.dataset.i)); });
  ui.list.addEventListener('mousemove', (e) => {
    const li = e.target.closest('[data-i]'); if (!li) return;
    const i = Number(li.dataset.i); if (i !== ui.active) { ui.active = i; paintActive(); }
  });
  ui.closeBtn.addEventListener('click', close);
  ui.root.addEventListener('click', (e) => { if (e.target === ui.root) close(); });
}

/** Sections accessibles : celles de la navigation, qui ne sont pas masquées pour ce compte. */
function sectionItems() {
  return [...document.querySelectorAll('.admin-nav a')]
    .filter((a) => !a.hidden && canSection(a.getAttribute('href').slice(1)))
    .map((a) => ({
      kind: 'Section',
      label: [...a.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(),
      path: a.getAttribute('href').slice(1),
    }));
}
function memberItems(q) {
  if (!q || !canSection('comptes') || ui.membersState !== 'ready') return [];
  const pick = (list, kind) => list.filter((m) => m.pseudo && norm(m.pseudo).includes(q))
    .map((m) => ({ kind, label: m.pseudo, path: `comptes/${m.id}` }));
  return [...pick(S.members, 'Membre'), ...pick(S.ghosts, 'Fantôme')].slice(0, MAX_MEMBERS);
}
function items() {
  const q = norm(ui.input.value);
  return [...sectionItems().filter((s) => !q || norm(s.label).includes(q)), ...memberItems(q)];
}

function render() {
  ui.items = items();
  ui.active = Math.min(ui.active, Math.max(0, ui.items.length - 1));
  let html = ui.items.map((it, i) => `<li class="apal-item" role="option" id="apal-o-${i}" data-i="${i}" aria-selected="${i === ui.active}">
      <span class="apal-kind">${esc(it.kind)}</span><span class="apal-label">${esc(it.label)}</span></li>`).join('');
  if (!ui.items.length) {
    const loading = norm(ui.input.value) && canSection('comptes') && ui.membersState === 'loading';
    html = `<li class="apal-empty">${loading ? 'Chargement des membres…' : ui.membersState === 'error' ? 'Membres indisponibles.' : 'Aucun résultat.'}</li>`;
  }
  ui.list.innerHTML = html;
  paintActive();
}
function paintActive() {
  ui.list.querySelectorAll('[role="option"]').forEach((li, i) => li.setAttribute('aria-selected', String(i === ui.active)));
  const id = ui.items.length ? `apal-o-${ui.active}` : '';
  ui.input.setAttribute('aria-activedescendant', id);
  if (id) document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
}

function onInputKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = ui.items.length; if (!n) return;
    ui.active = (ui.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    paintActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (ui.items.length) choose(ui.active);
  }
}
/** Échap et piège du Tab : le focus reste dans la palette (champ et bouton Fermer). */
function onDialogKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key !== 'Tab') return;
  const f = [ui.input, ui.closeBtn];
  const i = f.indexOf(document.activeElement);
  e.preventDefault();
  const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i === f.length - 1 ? 0 : i + 1);
  f[next].focus();
}

function choose(i) {
  const it = ui.items[i];
  if (!it) return;
  close();
  go(it.path);
}

/** Ouvre la palette ; `opener` reçoit le focus à la fermeture. */
export function openPalette(opener) {
  if (!ui) build();
  if (!ui.root.hidden) return;
  ui.opener = opener || document.activeElement;
  ui.root.hidden = false;
  for (const el of document.body.children) {
    if (el !== ui.root && !el.inert) { el.inert = true; ui.inerted.push(el); }
  }
  ui.input.value = '';
  ui.active = 0;
  if (canSection('comptes') && ui.membersState === 'idle') {
    ui.membersState = 'loading';
    ensureMembers()
      .then(() => { ui.membersState = 'ready'; })
      .catch((e) => { console.error(e); ui.membersState = 'error'; })
      .finally(() => { if (!ui.root.hidden) render(); });
  }
  render();
  ui.input.focus();
}
function close() {
  ui.root.hidden = true;
  ui.inerted.splice(0).forEach((el) => { el.inert = false; });
  const back = ui.opener;
  ui.opener = null;
  if (back && document.contains(back)) back.focus();
}

/** Branche le raccourci Ctrl/Cmd+K (phase de capture : la recherche du site ne s'ouvre pas en même temps) et le bouton du menu. */
export function setupPalette() {
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 'k') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openPalette();
  }, true);
  document.getElementById('admin-goto')?.addEventListener('click', (e) => openPalette(e.currentTarget));
}
