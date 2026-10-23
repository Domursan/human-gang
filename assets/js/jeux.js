// ===== Humane Gang — page Jeux (jeux.html) : un onglet par jeu =====
/*
 * Rôle : barre d'onglets ARIA (flèches gauche/droite, Début/Fin), import paresseux du module d'un onglet à sa première
 * ouverture, onglet choisi dans l'adresse (jeux.html#<id>) et retenu dans le navigateur.
 * VERSION MINIMALE du paquet xJ4, conforme au contrat (JEUX-CONTRAT) : la version finale est livrée par xJ1.
 * Page : jeux.html (session membre requise).
 * Dépendances : core.js (initPage, sb, toast, esc, $), jeux/onglets.js (ONGLETS).
 * Exporte : rien.
 */
import { sb, initPage, toast, esc, $ } from './core.js';
import { ONGLETS } from './jeux/onglets.js';

const me = await initPage();
const CLE = 'hg_jeux_onglet';
const tabs = $('#jeux-tabs');
const panels = $('#jeux-panels');
const ctx = { sb, me, toast, esc };
/** Modules déjà montés (id → module), pour ne monter qu'une fois. */
const montes = new Map();

/** Lecture prudente du dernier onglet ouvert (stockage parfois bloqué). */
function dernier() { try { return localStorage.getItem(CLE); } catch { return null; } }

tabs.innerHTML = ONGLETS.map((o) => `<button class="jeux-tab" type="button" role="tab" id="tab-${esc(o.id)}" aria-controls="panel-${esc(o.id)}" aria-selected="false" tabindex="-1" data-id="${esc(o.id)}">${esc(o.titre)}</button>`).join('');
panels.innerHTML = ONGLETS.map((o) => `<section class="jeux-panel" role="tabpanel" id="panel-${esc(o.id)}" aria-labelledby="tab-${esc(o.id)}" tabindex="0" hidden></section>`).join('');

/**
 * Ouvre un onglet : sélection ARIA, panneau visible, module importé et monté à la première ouverture.
 * @param {string} id identifiant de l'onglet
 * @param {{focus?: boolean}} [opts] focus : donner le focus au bouton de l'onglet (navigation au clavier)
 */
async function ouvre(id, opts = {}) {
  const o = ONGLETS.find((x) => x.id === id) || ONGLETS[0];
  if (!o) return;
  for (const b of tabs.querySelectorAll('[role="tab"]')) {
    const on = b.dataset.id === o.id;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && opts.focus) b.focus();
    if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  for (const p of panels.children) p.hidden = p.id !== `panel-${o.id}`;
  if (location.hash !== `#${o.id}`) history.replaceState(null, '', `#${o.id}`);
  try { localStorage.setItem(CLE, o.id); } catch { /* stockage bloqué : sans importance */ }
  if (montes.has(o.id)) return;
  montes.set(o.id, null);
  const panel = $(`#panel-${o.id}`);
  try {
    const m = await import(new URL(o.module, new URL('./jeux/', import.meta.url)).href);
    montes.set(o.id, m);
    await m.mount(panel, ctx);
  } catch (e) {
    console.warn('[jeux]', o.id, e);
    panel.innerHTML = '<p class="card">Ce jeu n’a pas pu se charger. Recharge la page.</p>';
  }
}

tabs.addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) ouvre(b.dataset.id); });
tabs.addEventListener('keydown', (e) => {
  const ids = ONGLETS.map((o) => o.id);
  const cur = ids.indexOf(document.activeElement?.dataset?.id);
  if (cur < 0) return;
  let n = null;
  if (e.key === 'ArrowRight') n = (cur + 1) % ids.length;
  else if (e.key === 'ArrowLeft') n = (cur - 1 + ids.length) % ids.length;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = ids.length - 1;
  if (n === null) return;
  e.preventDefault();
  ouvre(ids[n], { focus: true });
});
addEventListener('hashchange', () => ouvre(location.hash.slice(1)));

await ouvre(location.hash.slice(1) || dernier() || ONGLETS[0]?.id);
$('#app').removeAttribute('aria-busy');
