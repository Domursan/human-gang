// ===== Humane Gang : liste compacte (colonne 2 de l'admin) =====
// createList(el, { items, key, render?, filters, search, onSelect, selectedId, label, empty })
//   → { update(items), select(id), destroy() }
//   items   : tableaux d'objets. Champs lus par défaut : id (ou key), member { pseudo, color, avatar_url },
//             name (si pas de member), title (sujet), excerpt, at (Date|ISO), status { id, label, tone }, unread.
//   key     : nom du champ identifiant, ou fonction (item) => identifiant. Défaut : 'id'.
//   render  : (item) => HTML optionnel remplaçant le contenu d'une ligne (sans avatar : la ligne n'a qu'une colonne, classe ui-row--plain).
//   filters : [{ id, label, test(item) }] ; « Toutes » (id 'all') est ajoutée en tête si absente.
//             Les compteurs (« Ouvertes 3 ») comptent les éléments de la liste, sans la recherche.
//   search  : false pour masquer ; { placeholder, label, fields(item) } sinon. Insensible à la casse et aux accents, délai 150 ms.
//   onSelect: (item) => … appelé à la sélection (clic, Entrée, ou flèches : la sélection suit le focus).
//   selectedId, label (nom accessible de la liste), empty (texte de l'état vide).
//   defaultFilter : id du filtre affiché au départ (défaut : 'all').
// Lignes par lots de 50 (bouton « Afficher plus »). Navigation : ↑ ↓ Début Fin, Entrée ; ↓ depuis la recherche va à la première ligne.
import { esc, avatarHtml } from '../../core/util.js';
import { svg } from '../../icons.js';
import { relTime } from './time.js';
import { fold, pill } from './common.js';

const PAGE = 50;
const DEBOUNCE = 150;
let seq = 0;

function normalizeFilters(filters) {
  const list = (filters && filters.length ? filters : []).map((f) => ({ test: () => true, ...f }));
  if (!list.some((f) => f.id === 'all')) list.unshift({ id: 'all', label: 'Toutes', test: () => true });
  return list;
}

function defaultSearchText(it) {
  return [it.member?.pseudo, it.name, it.title, it.excerpt].filter(Boolean).join(' ');
}

export function createList(el, opts = {}) {
  const keyOf = typeof opts.key === 'function' ? opts.key : (it) => String(it[opts.key || 'id']);
  const filters = normalizeFilters(opts.filters);
  const searchOpts = opts.search === false ? null : { placeholder: 'Rechercher…', label: 'Rechercher', ...(typeof opts.search === 'object' ? opts.search : {}) };
  const onSelect = opts.onSelect || (() => {});
  const uid = `ui-list-${++seq}`;
  const state = {
    items: opts.items || [],
    filterId: opts.defaultFilter || 'all',
    query: '',
    shown: PAGE,
    selectedId: opts.selectedId != null ? String(opts.selectedId) : null,
    timer: 0,
  };

  el.classList.add('ui-list');
  el.innerHTML = `
    ${searchOpts ? `<div class="ui-search" role="search">
      ${svg('search', { stroke: 1.75 })}
      <label class="ui-sr" for="${uid}-q">${esc(searchOpts.label)}</label>
      <input id="${uid}-q" type="search" placeholder="${esc(searchOpts.placeholder)}" autocomplete="off" spellcheck="false">
    </div>` : ''}
    <div class="ui-filters" role="group" aria-label="Filtrer la liste"></div>
    <ul class="ui-rows" role="listbox" aria-label="${esc(opts.label || 'Liste')}"></ul>
    <div class="ui-empty" hidden></div>
    <div class="ui-more"></div>
    <p class="ui-sr" role="status" aria-live="polite"></p>`;

  const $filters = el.querySelector('.ui-filters');
  const $rows = el.querySelector('.ui-rows');
  const $empty = el.querySelector('.ui-empty');
  const $more = el.querySelector('.ui-more');
  const $status = el.querySelector('.ui-sr[role="status"]');
  const $q = el.querySelector('input[type="search"]');

  function count(f) { return state.items.reduce((n, it) => n + (f.test(it) ? 1 : 0), 0); }

  function paintFilters() {
    const cur = state.filterId;
    $filters.innerHTML = filters.map((f) => `<button type="button" class="ui-chip" data-filter="${esc(f.id)}" aria-pressed="${f.id === cur}">
      <span>${esc(f.label)}</span> <span class="ui-count">${count(f)}</span></button>`).join('');
  }

  function visible() {
    const f = filters.find((x) => x.id === state.filterId) || filters[0];
    const q = fold(state.query.trim());
    const text = searchOpts?.fields || defaultSearchText;
    return state.items.filter((it) => f.test(it) && (!q || fold(text(it)).includes(q)));
  }

  function rowHtml(it) {
    const id = keyOf(it);
    const name = it.member?.pseudo || it.name || '';
    const sel = id === state.selectedId;
    const label = [name, it.title, it.status?.label, it.unread ? 'non lu' : ''].filter(Boolean).join(', ');
    const body = opts.render ? opts.render(it) : `
      <div class="ui-row-body">
        <div class="ui-row-top">
          <span class="ui-row-name">${esc(name)}</span>
          ${it.at ? `<time class="ui-row-time" datetime="${esc(new Date(it.at).toISOString())}">${esc(relTime(it.at))}</time>` : ''}
        </div>
        ${it.title ? `<div class="ui-row-title">${esc(it.title)}</div>` : ''}
        ${it.excerpt ? `<div class="ui-row-excerpt">${esc(it.excerpt)}</div>` : ''}
        <div class="ui-row-foot">${pill(it.status)}${it.unread ? '<span class="ui-udot" aria-hidden="true"></span>' : ''}</div>
      </div>`;
    const av = opts.render ? '' : `<div class="ui-row-av">${avatarHtml(it.member || { pseudo: name, color: it.color }, 38)}</div>`;
    return `<li role="option" class="ui-row${opts.render ? ' ui-row--plain' : ''}${sel ? ' is-sel' : ''}${it.unread ? ' is-unread' : ''}" data-id="${esc(id)}"
      aria-selected="${sel}" aria-label="${esc(label)}" tabindex="-1">${av}${body}</li>`;
  }

  function paint() {
    paintFilters();
    const vis = visible();
    const shown = vis.slice(0, state.shown);
    $rows.innerHTML = shown.map(rowHtml).join('');
    const q = state.query.trim();
    $empty.hidden = vis.length > 0;
    $empty.textContent = vis.length ? '' : (q ? `Aucun résultat pour « ${q} ».` : (opts.empty || 'Rien à afficher.'));
    const rest = vis.length - shown.length;
    $more.innerHTML = rest > 0 ? `<button type="button" class="ui-more-btn">Afficher plus (${rest} restant${rest > 1 ? 's' : ''})</button>` : '';
    $status.textContent = `${vis.length} élément${vis.length > 1 ? 's' : ''}`;
    markSelected();
  }

  /** Met à jour l'état sélectionné et le focus de tabulation (roving tabindex) sans reconstruire la liste. */
  function markSelected() {
    const rows = [...$rows.children];
    const hasSel = rows.some((li) => li.dataset.id === state.selectedId);
    rows.forEach((li, i) => {
      const sel = li.dataset.id === state.selectedId;
      li.classList.toggle('is-sel', sel);
      li.setAttribute('aria-selected', String(sel));
      li.tabIndex = sel || (!hasSel && i === 0) ? 0 : -1;
    });
  }

  function choose(id, { notify = true } = {}) {
    state.selectedId = id;
    markSelected();
    if (notify) {
      const it = state.items.find((x) => keyOf(x) === id);
      if (it) onSelect(it);
    }
  }

  // ----- événements (délégation sur el : tout disparaît avec el.innerHTML) -----
  el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (chip) {
      state.filterId = chip.dataset.filter;
      state.shown = PAGE;
      paint();
      return;
    }
    if (e.target.closest('.ui-more-btn')) {
      state.shown += PAGE;
      paint();
      return;
    }
    const li = e.target.closest('[role="option"]');
    if (li) choose(li.dataset.id);
  });

  $rows.addEventListener('keydown', (e) => {
    const li = e.target.closest('[role="option"]');
    if (!li) return;
    const rows = [...$rows.children];
    const i = rows.indexOf(li);
    let next = null;
    if (e.key === 'ArrowDown') next = rows[Math.min(i + 1, rows.length - 1)];
    else if (e.key === 'ArrowUp') next = rows[Math.max(i - 1, 0)];
    else if (e.key === 'Home') next = rows[0];
    else if (e.key === 'End') next = rows[rows.length - 1];
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(li.dataset.id); return; }
    if (!next) return;
    e.preventDefault();
    next.focus();
    choose(next.dataset.id);
    next.scrollIntoView({ block: 'nearest' });
  });

  if ($q) {
    $q.addEventListener('input', () => {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.query = $q.value;
        state.shown = PAGE;
        paint();
      }, DEBOUNCE);
    });
    $q.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $q.value) {
        e.preventDefault();
        $q.value = '';
        clearTimeout(state.timer);
        state.query = '';
        state.shown = PAGE;
        paint();
      } else if (e.key === 'ArrowDown') {
        const first = $rows.querySelector('[role="option"]');
        if (first) { e.preventDefault(); first.focus(); choose(first.dataset.id); }
      }
    });
  }

  paint();

  return {
    update(items) {
      state.items = items || [];
      paint();
    },
    select(id) {
      state.selectedId = id == null ? null : String(id);
      const idx = visible().findIndex((it) => keyOf(it) === state.selectedId);
      if (idx >= state.shown) {
        state.shown = Math.ceil((idx + 1) / PAGE) * PAGE;
        paint();
      } else {
        markSelected();
      }
      const li = [...$rows.children].find((x) => x.dataset.id === state.selectedId);
      if (li) li.scrollIntoView({ block: 'nearest' });
    },
    destroy() {
      clearTimeout(state.timer);
      el.innerHTML = '';
      el.classList.remove('ui-list');
    },
  };
}
