// Cartes admin : rendu des onglets, délégation d'événements et point d'entrée mountCardsSection.
import { sb, toast, $, $$ } from '../core.js';
import { TABS } from './constants.js';
import { C, H } from './state.js';
import { boot, refresh } from './data.js';
import { act, check } from './helpers.js';
import { setsPanel, openSetDialog, toggleSet, deleteSet } from './sets.js';
import { cardsPanel } from './list.js';
import { openCardDialog, deleteCard, makeIdentities } from './editor.js';
import { econPanel, updateSum, saveEcon } from './economy.js';
import { openBulkGift } from './bulk.js';
import { playersPanel, refreshLog, refreshPlayersList, playerActions, takeCopy } from './players.js';
import { statsPanel } from './stats.js';
import { tradesPanel, cancelTrade } from './trades.js';
import { Q, loadQuests, questsPanel, questActions } from './quests.js';
import { SEARCH_DELAY, PAGE_SIZE, setCount } from '../admin/list-tools.js';
import { setsListData } from './sets.js';
import { cardsListData } from './list.js';

/* =========================================================
   Rendu et événements
   ========================================================= */
const PANELS = { series: setsPanel, cartes: cardsPanel, quetes: questsPanel, economie: econPanel, joueurs: playersPanel, stats: statsPanel, echanges: tradesPanel };
function render() {
  $$('[data-tab]', C.root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === C.tab)));
  C.panel.innerHTML = PANELS[C.tab]();
  countLists();
  if (C.tab === 'joueurs') { refreshPlayersList(); refreshLog(); }
  if (C.tab === 'quetes' && !Q.loaded && !Q.loading && !Q.error) loadQuests(); // en cas d'erreur, « Réessayer » relance
  if (C.tab === 'economie') updateSum();
}

/** Listes à rafraîchir seules pendant une recherche (le champ garde le focus). */
const LISTS = {
  series: { list: 'acd-sets-list', count: 'acd-search-series-count', noun: ['série', 'séries'], build: setsListData },
  cartes: { list: 'acd-cards-list', count: null, noun: ['carte', 'cartes'], build: cardsListData },
};
function countLists() {
  const s = setsListData(); setCount($('#acd-search-series-count', C.root), s.shown, s.total, C.q.series, LISTS.series.noun);
}
const timers = {};
function renderList(key) {
  const L = LISTS[key], el = $(`#${L.list}`, C.root);
  if (!el) return;
  const r = L.build();
  el.innerHTML = r.html;
  if (L.count) setCount($(`#${L.count}`, C.root), r.shown, r.total, C.q[key], L.noun);
}

const ACTIONS = {
  retry: () => boot(),
  'cards-more': () => { C.shown += PAGE_SIZE; renderList('cartes'); },
  'set-new': () => openSetDialog(),
  'set-edit': (t, id) => openSetDialog(C.setById.get(id) || null),
  'set-toggle': (t, id) => toggleSet(t, id),
  'set-del': (t, id) => deleteSet(id),
  'card-new': () => openCardDialog(),
  'card-edit': (t, id) => openCardDialog(C.cardById.get(id) || null),
  'card-toggle': (t, id) => act(t, async () => {
    const k = C.cardById.get(id);
    if (!k) return;
    check(await sb.from('hg_cards').update({ active: !k.active }).eq('id', id));
    toast(k.active ? 'Carte désactivée' : 'Carte activée', 'ok');
    await refresh();
  }),
  'card-del': (t, id) => deleteCard(id),
  'ident-make': (t) => makeIdentities(t),
  'copy-take': (t, id) => takeCopy(t, id),
  'trade-cancel': (t, id) => cancelTrade(t, id),
  'econ-reset': () => render(),
  'bulk-open': () => openBulkGift(),
  ...questActions,
  ...playerActions,
};

function onClick(e) {
  const t = e.target.closest('[data-tab],[data-act]');
  if (!t || !C.root.contains(t)) return;
  if (t.dataset.tab) { C.tab = t.dataset.tab; render(); return; }
  ACTIONS[t.dataset.act]?.(t, t.dataset.id);
}
function onChange(e) {
  const t = e.target;
  if (t.id === 'acd-ident-set') C.identSet = t.value;
  else if (t.dataset.f && t.dataset.f !== 'identSet') C.f[t.dataset.f] = t.value;
  else return;
  C.shown = PAGE_SIZE;
  render();
}
function onInput(e) {
  const t = e.target;
  if (t.form?.id === 'acd-econ-form') return updateSum();
  const key = t.dataset.search;
  if (!key) return;
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => { C.q[key] = t.value; C.shown = PAGE_SIZE; renderList(key); }, SEARCH_DELAY);
}
function onSubmit(e) {
  const form = e.target;
  if (form.id === 'acd-econ-form') { e.preventDefault(); return saveEcon(form, e.submitter); }
}

/**
 * Monte la section « Cartes à collectionner » de l'admin dans container.
 * Autonome : ne dépend d'aucune autre section ; se recharge seul après chaque modification.
 * tabs:false : la coquille affiche les parties (Séries, Cartes…) comme sous-sections et appelle openCardsTab.
 */
export async function mountCardsSection(container, { tabs = true } = {}) {
  if (!container) return;
  C.root = container;
  container.innerHTML = `<div class="acd">
    ${tabs ? `<div class="filters acd-tabs" role="group" aria-label="Parties de la section cartes">
      ${TABS.map(([id, label]) => `<button class="chip" type="button" data-tab="${id}" aria-pressed="${id === C.tab}">${label}</button>`).join('')}
    </div>` : ''}
    <div id="acd-panel"></div>
  </div>`;
  C.panel = $('#acd-panel', container);
  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  container.addEventListener('input', onInput);
  container.addEventListener('submit', onSubmit);
  await boot();
}

/** Ouvre une partie des cartes (series, cartes, quetes, economie, joueurs, stats, echanges). Sans effet avant le montage.
    id : membre affiché dans « joueurs » (adresse #cartes/joueurs/<id>). */
export function openCardsTab(tab, id = null) {
  if (!C.root || !PANELS[tab]) return;
  C.tab = tab;
  if (tab === 'joueurs') C.playerId = id ? String(id) : '';
  render();
}

H.render = render;
