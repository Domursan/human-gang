// ===== Humane Gang — page Jeux (jeux.html) =====
// VERSION MINIMALE du paquet xJ2 (contrat JEUX-CONTRAT.md) : la version finale est livrée par le paquet xJ1.
// Barre d'onglets ARIA (role tablist, flèches gauche / droite, Début / Fin), un panneau par jeu, module chargé à la
// première ouverture (import paresseux), onglet choisi dans l'adresse (jeux.html#<id>) et retenu dans localStorage.
// Dépendances : core.js (sb, initPage, esc, $, toast, errMsg), jeux/onglets.js (liste des onglets).
// Le fichier n'exporte rien.
import { sb, initPage, esc, $, toast, errMsg } from './core.js';
import { ONGLETS } from './jeux/onglets.js';

const me = await initPage();

/** Clé localStorage du dernier onglet ouvert. */
const CLE = 'hg_jeux_onglet';
const bar = $('#jeux-tabs');
const panels = $('#jeux-panels');
/** Modules déjà montés : id -> module. */
const montes = new Map();
let courant = null;

/** Lecture prudente du dernier onglet (stockage bloqué : rien). */
const lu = () => { try { return localStorage.getItem(CLE); } catch { return null; } };
/** Écriture prudente du dernier onglet. */
const ecrit = (id) => { try { localStorage.setItem(CLE, id); } catch { /* stockage bloqué */ } };
/** Onglet valide à partir d'un identifiant (sinon le premier). */
const valide = (id) => (ONGLETS.some((o) => o.id === id) ? id : ONGLETS[0]?.id);

bar.innerHTML = ONGLETS.map((o) => `<button type="button" role="tab" class="jeux-tab" id="tab-${esc(o.id)}" aria-controls="panel-${esc(o.id)}" aria-selected="false" tabindex="-1" data-id="${esc(o.id)}">${esc(o.titre)}</button>`).join('');
panels.innerHTML = ONGLETS.map((o) => `<section role="tabpanel" class="jeux-panel" id="panel-${esc(o.id)}" aria-labelledby="tab-${esc(o.id)}" tabindex="0" hidden></section>`).join('');

/**
 * Ouvre un onglet : met à jour la barre, l'adresse et le stockage, puis monte le module à la première ouverture.
 * @param {string} id Identifiant de l'onglet.
 * @param {{focus?: boolean}} [opts] focus : donne le focus à l'onglet (navigation au clavier).
 */
async function ouvre(id, { focus = false } = {}) {
  id = valide(id);
  if (!id) return;
  for (const b of bar.querySelectorAll('[role="tab"]')) {
    const on = b.dataset.id === id;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on) { if (focus) b.focus(); b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  for (const p of panels.children) p.hidden = p.id !== `panel-${id}`;
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
  ecrit(id);
  if (courant && courant !== id) montes.get(courant)?.unmount?.();
  courant = id;
  const panel = $(`#panel-${id}`);
  const def = ONGLETS.find((o) => o.id === id);
  try {
    let mod = montes.get(id);
    if (!mod) {
      panel.innerHTML = '<p class="muted jeux-wait">Chargement…</p>';
      mod = await import(new URL(def.module, new URL('./jeux/', import.meta.url)).href);
      montes.set(id, mod);
      panel.innerHTML = '';
      await mod.mount(panel, { sb, me, toast, esc });
    }
  } catch (e) {
    console.warn('[jeux]', e);
    panel.innerHTML = `<p class="card muted">Ce jeu n’a pas pu se charger (${esc(errMsg(e))}). Recharge la page dans un instant.</p>`;
  }
}

// Clic et clavier (flèches, Début, Fin) sur la barre d'onglets.
bar.addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) ouvre(b.dataset.id); });
bar.addEventListener('keydown', (e) => {
  const ids = ONGLETS.map((o) => o.id);
  const i = ids.indexOf(courant);
  const cible = { ArrowRight: ids[(i + 1) % ids.length], ArrowLeft: ids[(i - 1 + ids.length) % ids.length], Home: ids[0], End: ids[ids.length - 1] }[e.key];
  if (!cible) return;
  e.preventDefault();
  ouvre(cible, { focus: true });
});
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== courant) ouvre(h); });

$('#app').setAttribute('aria-busy', 'false');
await ouvre(location.hash.slice(1) || lu());
