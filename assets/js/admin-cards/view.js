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
import { playersPanel, refreshLog, adjustPaillettes, giveCard, takeCopy } from './players.js';
import { statsPanel } from './stats.js';
import { tradesPanel, cancelTrade } from './trades.js';
import { Q, loadQuests, questsPanel, questActions } from './quests.js';

/* =========================================================
   Rendu et événements
   ========================================================= */
const PANELS = { series: setsPanel, cartes: cardsPanel, quetes: questsPanel, economie: econPanel, joueurs: playersPanel, stats: statsPanel, echanges: tradesPanel };
function render() {
  $$('[data-tab]', C.root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === C.tab)));
  C.panel.innerHTML = PANELS[C.tab]();
  if (C.tab === 'joueurs') refreshLog();
  if (C.tab === 'quetes' && !Q.loaded && !Q.loading && !Q.error) loadQuests(); // en cas d'erreur, « Réessayer » relance
  if (C.tab === 'economie') updateSum();
}

const ACTIONS = {
  retry: () => boot(),
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
  ...questActions,
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
  else if (t.id === 'acd-pl-member') C.playerId = t.value;
  else if (t.dataset.f && t.dataset.f !== 'identSet') C.f[t.dataset.f] = t.value;
  else return;
  render();
}
function onInput(e) {
  if (e.target.form?.id === 'acd-econ-form') updateSum();
}
function onSubmit(e) {
  const form = e.target;
  if (form.id === 'acd-econ-form') { e.preventDefault(); return saveEcon(form, e.submitter); }
  if (form.id === 'acd-pl-pay') { e.preventDefault(); return adjustPaillettes(form, e.submitter); }
  if (form.id === 'acd-pl-give') { e.preventDefault(); return giveCard(form, e.submitter); }
}

/**
 * Monte la section « Cartes à collectionner » de l'admin dans container.
 * Autonome : ne dépend d'aucune autre section ; se recharge seul après chaque modification.
 */
export async function mountCardsSection(container) {
  if (!container) return;
  C.root = container;
  container.innerHTML = `<div class="acd">
    <div class="filters acd-tabs" role="group" aria-label="Parties de la section cartes">
      ${TABS.map(([id, label]) => `<button class="chip" type="button" data-tab="${id}" aria-pressed="${id === C.tab}">${label}</button>`).join('')}
    </div>
    <div id="acd-panel"></div>
  </div>`;
  C.panel = $('#acd-panel', container);
  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  container.addEventListener('input', onInput);
  container.addEventListener('submit', onSubmit);
  await boot();
}

H.render = render;
