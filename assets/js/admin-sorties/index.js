// =====================================================================
// Admin : section « Sorties IRL » — liste en colonne 2, détail dans la zone principale, panneau d'infos.
// Montage par admin.js (registerSub 'irl/sorties') : main = mountSortiesSection, open = openSortie,
// list = listSorties (colonne 2), info = infoSorties (panneau d'infos, ≥ 1440 px).
// L'URL suit la sortie choisie : #irl/sorties/<id>. Les écritures passent par data.js (mêmes tables que irl.js) ;
// les fenêtres d'édition par dialogs.js. Droits : hg_has_perm('evenements') côté base.
// Dépendances : core.js, ui-confirm.js, data.js, format.js, dialogs.js, admin/live.js, admin/ui/* (liste, panneau, pastille),
// admin/common.js, utils.js, admin-reglages/lot3-ui.js (bloc de réglages), reglages-valeurs-lot3.js.
// Exporte : mountSortiesSection, openSortie, listSorties, infoSorties.
// =====================================================================
import { toast, errMsg, esc } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import * as api from './data.js';
import { statusOf, whenLabel, rsvpCounts } from './format.js';
import { mountDialogs, mountDetail, openEdit, showDetail } from './dialogs.js';
import { onTableChange } from '../admin/live.js';
import { createList } from '../admin/ui/list.js';
import { renderInfoPanel } from '../admin/ui/info-panel.js';
import { pill } from '../admin/ui/common.js';
import { sectionError } from '../admin/common.js';
import { pluralCount } from '../utils.js';
import { blocReglages } from '../admin-reglages/lot3-ui.js';
import { chargerReglagesLot3 } from '../reglages-valeurs-lot3.js';

/* État de la section : zones d'affichage, sorties, réponses, dates, votes, photos, tri et sortie choisie. */
const S = { root: null, me: null, members: new Map(), events: [], rsvps: [], dates: [], votes: [], photos: [],
  sort: 'asc', selId: null, list: null, colEl: null, infoEl: null, infoApi: null };

/* Filtres de la liste : à venir (par défaut), passées ou toutes. */
const FILTERS = [
  { id: 'avenir', label: 'À venir', test: (it) => it.group === 'avenir' },
  { id: 'passees', label: 'Passées', test: (it) => it.group === 'passees' },
  { id: 'all', label: 'Toutes' },
];

/* Pont vers dialogs.js : il lit l'état, recharge, supprime, sélectionne. */
const ctx = {
  get me() { return S.me; },
  get: () => S,
  reload: async () => { await load(); repaint(); },
  remove: (ev) => deleteEvent(ev, null),
  select: (id) => setHash(id),
};

/** Relit toutes les données de la section dans S. */
async function load() {
  Object.assign(S, await api.loadAll());
}

/** Change l'URL pour sélectionner une sortie (le routeur affiche le détail). */
function setHash(id) {
  location.hash = `#irl/sorties/${encodeURIComponent(id)}`;
}

/** Lignes de la liste : tri par date (les sorties « à caler » restent en fin de liste), puis filtres et recherche dans createList. */
function listItems() {
  const now = Date.now();
  const dir = S.sort === 'desc' ? -1 : 1;
  return [...S.events]
    .sort((a, b) => {
      if (!a.starts_at || !b.starts_at) return (a.starts_at ? 0 : 1) - (b.starts_at ? 0 : 1) || new Date(b.created_at) - new Date(a.created_at);
      return (new Date(a.starts_at) - new Date(b.starts_at)) * dir;
    })
    .map((ev) => {
      const st = statusOf(ev, now);
      const c = rsvpCounts(S.rsvps, ev.id, S.members);
      const nDates = S.dates.filter((d) => d.event_id === ev.id).length;
      return {
        id: ev.id,
        name: ev.title,
        group: st.group,
        when: ev.starts_at ? whenLabel(ev) : `Sondage · ${pluralCount(nDates, 'date', 'dates')}`,
        location: ev.location || '',
        inscrits: c.oui,
        status: { label: st.label, tone: st.tone },
      };
    });
}

/** HTML d'une ligne de la liste : titre, état, date, lieu et nombre d'inscrits. */
function rowHtml(it) {
  return `<div class="sx-row">
    <span class="sx-row-title">${esc(it.name)}</span>
    <div class="sx-row-top">${pill(it.status)}<span class="sx-row-when">${esc(it.when)}</span></div>
    <div class="sx-row-meta">${esc(it.location || 'Lieu à définir')} · ${pluralCount(it.inscrits, 'inscrit', 'inscrits')}</div>
  </div>`;
}

/** Zone principale : détail de la sortie sélectionnée. */
function paintDetail() {
  showDetail(S.selId);
}

/** Panneau d'infos : organisateur, chiffres des réponses, photos liées. */
function paintInfo() {
  if (!S.infoEl) return;
  S.infoApi?.destroy();
  S.infoApi = null;
  const ev = S.events.find((x) => x.id === S.selId);
  if (!ev) {
    S.infoEl.innerHTML = '<p class="ui-info-empty">Choisis une sortie pour voir son organisateur, ses réponses et ses photos.</p>';
    return;
  }
  const c = rsvpCounts(S.rsvps, ev.id, S.members);
  const photos = S.photos.filter((p) => p.event_id === ev.id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  S.infoApi = renderInfoPanel(S.infoEl, {
    member: S.members.get(ev.created_by) || { pseudo: 'Ancien membre' },
    caption: 'Organisateur',
    statsTitle: 'Inscriptions',
    stats: [
      { value: c.oui, label: 'Je viens' },
      { value: c['peut-etre'], label: 'Peut-être' },
      { value: c.non, label: 'Pas dispo' },
      { value: photos.length, label: 'Photos' },
    ],
    historyTitle: 'Photos liées',
    emptyText: 'Aucune photo pour cette sortie.',
    history: photos.slice(0, 5).map((p) => ({ title: p.caption || 'Photo de l\'album', at: p.created_at, status: null })),
  });
}

/** Redessine la liste, le détail et le panneau d'infos après un changement de données. */
function repaint() {
  S.list?.update(listItems());
  paintDetail();
  paintInfo();
}

/** Supprime la sortie (confirmation, fichiers compris). Appelé depuis l'en-tête du détail. */
async function deleteEvent(ev, btn) {
  const nRsvp = S.rsvps.filter((r) => r.event_id === ev.id).length;
  const nDates = S.dates.filter((d) => d.event_id === ev.id).length;
  const nVotes = S.votes.filter((v) => S.dates.some((d) => d.id === v.date_id && d.event_id === ev.id)).length;
  const photos = S.photos.filter((p) => p.event_id === ev.id);
  const lines = [
    `${nRsvp} inscription${nRsvp > 1 ? 's' : ''} (dont ${rsvpCounts(S.rsvps, ev.id, S.members).oui} « je viens »)`,
    `${nDates} date${nDates > 1 ? 's' : ''} proposée${nDates > 1 ? 's' : ''} et ${nVotes} vote${nVotes > 1 ? 's' : ''}`,
    `${photos.length} photo${photos.length > 1 ? 's' : ''} de l'album (fichiers compris)`,
  ];
  const ok = await confirmBox(
    `Supprimer « ${ev.title} » ?`,
    `Cette action est définitive. Seront supprimés : ${lines.join(', ')}.`,
    { ok: 'Supprimer la sortie', danger: true });
  if (!ok) return;
  if (btn) btn.disabled = true;
  try {
    await api.deleteEvent(ev, photos.map((p) => p.path));
    toast('Sortie supprimée.', 'ok');
    await load();
    repaint();
    if (S.selId === ev.id) location.hash = '#irl/sorties';
    S.colEl?.querySelector('#ass-new')?.focus();
  } catch (e) {
    toast(`Suppression impossible : ${errMsg(e)}`, 'error');
    if (btn) btn.disabled = false;
  }
}

/**
 * Monte la section dans `root` (#sorties-root) : zone principale (détail) et fenêtre d'édition.
 * Une erreur de chargement s'affiche dans la zone ; elle n'empêche pas les autres sections.
 */
export async function mountSortiesSection(root, { me } = {}) {
  if (!root) return;
  S.root = root;
  S.me = me;
  root.innerHTML = '<div class="sx-zone"></div>';
  root.prepend(blocReglages('irl'));
  mountDialogs(root, ctx);
  mountDetail(root.querySelector('.sx-zone'));
  onTableChange('sorties', ['hg_events', 'hg_event_rsvps'], () => ctx.reload()); // temps réel
  await chargerReglagesLot3({ force: true });
  try {
    await load();
  } catch (e) {
    root.querySelector('#ass-d-body').innerHTML = sectionError(e);
  }
  repaint();
}

/** Sélection d'une sortie : appelé à chaque visite de la sous-section (URL #irl/sorties/<id>). */
export function openSortie({ id } = {}) {
  S.selId = id || null;
  S.list?.select(S.selId);
  paintDetail();
  paintInfo();
}

/** Colonne 2 : puces de filtre, recherche, liste compacte, tri et bouton de création. */
export function listSorties(el) {
  el.innerHTML = `<div class="sx-col">
      <div class="sx-col-tools">
        <button type="button" class="btn btn-primary btn-sm" id="ass-new">+ Nouvelle sortie</button>
        <div class="field sx-sort">
          <label for="ass-sort">Tri par date</label>
          <select id="ass-sort">
            <option value="asc"${S.sort === 'asc' ? ' selected' : ''}>Croissant</option>
            <option value="desc"${S.sort === 'desc' ? ' selected' : ''}>Décroissant</option>
          </select>
        </div>
      </div>
      <div class="sx-col-list"></div>
    </div>`;
  S.colEl = el;
  el.querySelector('#ass-new').addEventListener('click', (e) => openEdit(null, e.currentTarget));
  el.querySelector('#ass-sort').addEventListener('change', (e) => { S.sort = e.target.value; S.list?.update(listItems()); });
  S.list = createList(el.querySelector('.sx-col-list'), {
    items: listItems(),
    key: 'id',
    defaultFilter: 'avenir',
    filters: FILTERS,
    search: { placeholder: 'Titre ou lieu', label: 'Rechercher une sortie', fields: (it) => `${it.name} ${it.location}` },
    render: rowHtml,
    selectedId: S.selId,
    label: 'Sorties IRL',
    empty: 'Aucune sortie pour ces filtres. Propose-en une avec « + Nouvelle sortie ».',
    onSelect: (it) => setHash(it.id),
  });
}

/** Panneau d'infos (≥ 1440 px) : rempli à chaque sélection. */
export function infoSorties(el) {
  S.infoEl = el;
  paintInfo();
}
