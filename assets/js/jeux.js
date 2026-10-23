// ===== Humane Gang — page « Jeux » (jeux.html) : un onglet par jeu =====
/*
 * VERSION MINIMALE DU CONTRAT (JEUX-CONTRAT.md) livrée par le paquet xJ3 pour ses tests : la version finale de ce
 * fichier est celle du paquet xJ1, propriétaire de la page. Comportement attendu par le contrat :
 *  - barre d'onglets ARIA (role tablist, flèches gauche/droite, Début/Fin, défilement horizontal de la barre seule) ;
 *  - import paresseux du module de l'onglet à sa première ouverture : mount(panel, ctx), unmount() facultatif ;
 *  - onglet choisi dans l'adresse (jeux.html#framed) et retenu en localStorage (« hg_jeux_tab »).
 * ctx = { sb, me, toast, esc }.
 * Dépendances : core.js, jeux/onglets.js (ONGLETS).
 */
import { sb, initPage, toast, esc, $ } from './core.js';
import { ONGLETS } from './jeux/onglets.js';

const me = await initPage();
const ctx = { sb, me, toast, esc };
const tabs = $('#jeux-tabs');
const panels = $('#jeux-panels');
const KEY = 'hg_jeux_tab';
/** Modules déjà montés : id -> module. */
const mounted = new Map();
let current = null;

/** Lit l'onglet retenu (stockage bloqué : aucun). */
function saved() { try { return localStorage.getItem(KEY); } catch { return null; } }
/** Retient l'onglet choisi. */
function remember(id) { try { localStorage.setItem(KEY, id); } catch { /* stockage bloqué */ } }

tabs.innerHTML = ONGLETS.map((o) => `<button type="button" role="tab" id="jeux-tab-${esc(o.id)}" aria-controls="jeux-panel-${esc(o.id)}" aria-selected="false" tabindex="-1" data-tab="${esc(o.id)}">${esc(o.titre)}</button>`).join('');
panels.innerHTML = ONGLETS.map((o) => `<section role="tabpanel" id="jeux-panel-${esc(o.id)}" aria-labelledby="jeux-tab-${esc(o.id)}" tabindex="0" hidden></section>`).join('');

/**
 * Affiche l'onglet id (monte son module à la première visite).
 * @param {string} id Identifiant d'onglet.
 * @param {boolean} [focus] Donner le focus au bouton d'onglet.
 */
async function show(id, focus = false) {
  const o = ONGLETS.find((x) => x.id === id) || ONGLETS[0];
  if (!o) return;
  if (current && current !== o.id) mounted.get(current)?.unmount?.();
  current = o.id;
  for (const b of tabs.querySelectorAll('[role="tab"]')) {
    const on = b.dataset.tab === o.id;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on) { b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); if (focus) b.focus(); }
  }
  for (const p of panels.children) p.hidden = p.id !== `jeux-panel-${o.id}`;
  if (location.hash !== '#' + o.id) history.replaceState(null, '', '#' + o.id);
  remember(o.id);
  const panel = document.getElementById(`jeux-panel-${o.id}`);
  if (!mounted.has(o.id)) {
    try {
      const m = await import(new URL(o.module, new URL('./jeux/', import.meta.url)).href);
      mounted.set(o.id, m);
      await m.mount(panel, ctx);
    } catch (e) {
      console.warn('[jeux]', o.id, e);
      panel.innerHTML = '<p class="card muted">Ce jeu n’a pas pu se charger. Recharge la page.</p>';
    }
  }
}

tabs.addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) show(b.dataset.tab); });
tabs.addEventListener('keydown', (e) => {
  const list = [...tabs.querySelectorAll('[role="tab"]')];
  const i = list.findIndex((b) => b.dataset.tab === current);
  let j = null;
  if (e.key === 'ArrowRight') j = (i + 1) % list.length;
  else if (e.key === 'ArrowLeft') j = (i - 1 + list.length) % list.length;
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = list.length - 1;
  if (j === null) return;
  e.preventDefault();
  show(list[j].dataset.tab, true);
});
addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== current) show(id); });

$('#app').removeAttribute('aria-busy');
show(location.hash.slice(1) || saved() || ONGLETS[0]?.id);
