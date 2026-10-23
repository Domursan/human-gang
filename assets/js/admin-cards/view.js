// =====================================================================
// Cartes admin : rendu des onglets, délégation d'événements et point d'entrée mountCardsSection.
// Un seul écouteur par type d'événement sur le conteneur ; chaque bouton se repère à son data-act (ACTIONS) ou data-tab.
// Dépendances : core.js (sb, toast, $, $$), constants.js (TABS), state.js (C, H), data.js (boot, refresh),
// helpers.js (act, check), sets.js, list.js, editor.js, economy.js, bulk.js, players.js, stats.js, trades.js,
// quests.js, boosters.js (onglet Boosters, autonome), admin/list-tools.js (recherche, compteurs, pagination).
// Exporte : mountCardsSection (monte la section), openCardsTab (ouvre une partie).
// =====================================================================
import { sb, toast, $, $$ } from '../core.js';
import { TABS } from './constants.js';
import { C, H } from './state.js';
import { boot, refresh } from './data.js';
import { act, check } from './helpers.js';
import { setsPanel, openSetDialog, toggleSet, deleteSet } from './sets.js';
import { cardsPanel } from './list.js';
import { openCardDialog, deleteCard, makeIdentities } from './editor.js';
import { econPanel, updateSum, saveEcon, resetEconGroup } from './economy.js';
import { openBulkGift } from './bulk.js';
import { playersPanel, refreshLog, refreshPlayersList, playerActions, takeCopy } from './players.js';
import { statsPanel } from './stats.js';
import { tradesPanel, cancelTrade, loadBoardNotes, clearBoardNote } from './trades.js';
import { Q, loadQuests, questsPanel, questActions } from './quests.js';
import { SEARCH_DELAY, PAGE_SIZE, setCount } from '../admin/list-tools.js';
import { setsListData } from './sets.js';
import { cardsListData } from './list.js';
import { mountBoostersTab } from './boosters.js';
import { mountProposalsAdmin } from './proposals.js';
import { mountCodesTab } from './codes.js';
import { mountRecipesTab } from './recipes.js';
import { mountAuctionsTab } from './auctions.js';

/* =========================================================
   Rendu et événements
   ========================================================= */
/* Fabrique du HTML de chaque onglet, par identifiant d'onglet. */
const PANELS = { series: setsPanel, cartes: cardsPanel, quetes: questsPanel, economie: econPanel, boosters: () => '<div id="acd-boosters"></div>', joueurs: playersPanel, stats: statsPanel, echanges: tradesPanel,
  // Idées C9, C10, C11 (migration 081) : onglets autonomes, comme les boosters.
  codes: () => '<div id="acd-codes"></div>', recettes: () => '<div id="acd-recettes"></div>', encheres: () => '<div id="acd-encheres"></div>' };
/** Dessine l'onglet courant, puis lance les chargements propres à cet onglet (joueurs, quêtes, économie). */
function render() {
  $$('[data-tab]', C.root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === C.tab)));
  C.panel.innerHTML = PANELS[C.tab]();
  countLists();
  if (C.tab === 'joueurs') { refreshPlayersList(); refreshLog(); }
  if (C.tab === 'quetes' && !Q.loaded && !Q.loading && !Q.error) loadQuests(); // en cas d'erreur, « Réessayer » relance
  if (C.tab === 'economie') updateSum();
  if (C.tab === 'boosters') mountBoostersTab($('#acd-boosters', C.panel)); // onglet autonome (boosters.js)
  if (C.tab === 'series') mountProposalsAdmin($('#acd-props', C.panel)); // propositions des membres (migration 080)
  if (C.tab === 'echanges') loadBoardNotes(); // petits mots du tableau (idée C12)
  if (C.tab === 'codes') mountCodesTab($('#acd-codes', C.panel));
  if (C.tab === 'recettes') mountRecipesTab($('#acd-recettes', C.panel));
  if (C.tab === 'encheres') mountAuctionsTab($('#acd-encheres', C.panel));
}

/** Listes à rafraîchir seules pendant une recherche (le champ garde le focus). */
const LISTS = {
  series: { list: 'acd-sets-list', count: 'acd-search-series-count', noun: ['série', 'séries'], build: setsListData },
  cartes: { list: 'acd-cards-list', count: null, noun: ['carte', 'cartes'], build: cardsListData },
};
/** Met à jour le compteur de la recherche des séries. */
function countLists() {
  const s = setsListData(); setCount($('#acd-search-series-count', C.root), s.shown, s.total, C.q.series, LISTS.series.noun);
}
/* Minuteries de la recherche, une par champ, pour attendre la fin de la saisie avant de filtrer. */
const timers = {};
/** Redessine seulement la liste d'une recherche (le champ garde le focus). */
function renderList(key) {
  const L = LISTS[key], el = $(`#${L.list}`, C.root);
  if (!el) return;
  const r = L.build();
  el.innerHTML = r.html;
  if (L.count) setCount($(`#${L.count}`, C.root), r.shown, r.total, C.q[key], L.noun);
}

/* Actions des boutons data-act, avec leur gestionnaire. Les gestionnaires reçoivent (bouton, identifiant). */
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
  'board-note-clear': (t, id) => clearBoardNote(t, id),
  'econ-reset': () => render(),
  'econ-default': (t) => resetEconGroup(Number(t.dataset.g)),
  'bulk-open': () => openBulkGift(),
  ...questActions,
  ...playerActions,
};

/** Délégation des clics : onglets (data-tab) et actions (data-act). */
function onClick(e) {
  const t = e.target.closest('[data-tab],[data-act]');
  if (!t || !C.root.contains(t)) return;
  if (t.dataset.tab) { C.tab = t.dataset.tab; render(); return; }
  ACTIONS[t.dataset.act]?.(t, t.dataset.id);
}
/** Délégation des changements de filtre (liste déroulante) : remet la liste à la première page. */
function onChange(e) {
  const t = e.target;
  if (t.id === 'acd-ident-set') C.identSet = t.value;
  else if (t.dataset.f && t.dataset.f !== 'identSet') C.f[t.dataset.f] = t.value;
  else return;
  C.shown = PAGE_SIZE;
  render();
}
/** Délégation de la saisie : recherches avec délai, et mise à jour du total de l'économie. */
function onInput(e) {
  const t = e.target;
  if (t.form?.id === 'acd-econ-form') return updateSum();
  const key = t.dataset.search;
  if (!key) return;
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => { C.q[key] = t.value; C.shown = PAGE_SIZE; renderList(key); }, SEARCH_DELAY);
}
/** Délégation des envois : seul le formulaire de l'économie est traité ici. */
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

/** Ouvre une partie des cartes (series, cartes, quetes, economie, boosters, joueurs, stats, echanges). Sans effet avant le montage.
    id : membre affiché dans « joueurs » (adresse #cartes/joueurs/<id>). */
export function openCardsTab(tab, id = null) {
  if (!C.root || !PANELS[tab]) return;
  C.tab = tab;
  if (tab === 'joueurs') C.playerId = id ? String(id) : '';
  render();
}

H.render = render;
