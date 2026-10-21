// ===== Admin : section « Sorties IRL » (liste, recherche, création, gestion) =====
// Les écritures passent par data.js (mêmes tables que irl.js) ; les fenêtres par dialogs.js.
// Droits : hg_has_perm('evenements') côté base. La section est repérée par data-perm="evenements" dans admin.html.
import { toast, errMsg, esc } from '../core.js';
import { norm } from '../irl-history.js';
import { confirmBox } from '../ui-confirm.js';
import * as api from './data.js';
import { BATCH, statusOf, whenLabel, rsvpCounts, countsLine, memberName } from './format.js';
import { mountDialogs, openEdit, openDetail, refreshDetail } from './dialogs.js';

const S = { root: null, me: null, members: new Map(), events: [], rsvps: [], dates: [], votes: [], photos: [],
  filter: 'avenir', sort: 'asc', q: '', shown: BATCH };

/** Sorties affichées : filtre (à venir / passées / toutes), recherche titre ou lieu, tri par date. */
function visible() {
  const now = Date.now();
  const q = norm(S.q);
  const list = S.events.filter((ev) => {
    const g = statusOf(ev, now).group;
    if (S.filter !== 'toutes' && g !== S.filter) return false;
    if (!q) return true;
    return norm(`${ev.title} ${ev.location || ''}`).includes(q);
  });
  const dir = S.sort === 'desc' ? -1 : 1;
  // Les sorties « à caler » (sans date) restent en fin de liste, quel que soit le tri.
  list.sort((a, b) => {
    if (!a.starts_at || !b.starts_at) return (a.starts_at ? 0 : 1) - (b.starts_at ? 0 : 1) || new Date(b.created_at) - new Date(a.created_at);
    return (new Date(a.starts_at) - new Date(b.starts_at)) * dir;
  });
  return list;
}

const ctx = {
  get me() { return S.me; },
  get: () => S,
  reload: async () => { await load(); render(); refreshDetail(); },
};

async function load() {
  const d = await api.loadAll();
  Object.assign(S, d);
}

const TONE = { current: 'ass-tag-current', ok: 'ass-tag-ok', todo: 'ass-tag-todo', past: 'ass-tag-past', retro: 'ass-tag-retro' };

function rowHtml(ev, now) {
  const st = statusOf(ev, now);
  const c = rsvpCounts(S.rsvps, ev.id, S.members);
  const photos = S.photos.filter((p) => p.event_id === ev.id).length;
  const title = esc(ev.title);
  const org = memberName(S.members, ev.created_by);
  return `<article class="card ass-row" data-id="${esc(ev.id)}" aria-labelledby="ass-t-${esc(ev.id)}">
    <div class="ass-row-head">
      <div class="ass-row-info">
        <span class="ass-tag ${TONE[st.tone] || ''}">${esc(st.label)}</span>
        <h3 class="ass-row-title" id="ass-t-${esc(ev.id)}">${title}</h3>
        <p class="small muted">${esc(whenLabel(ev))}${ev.location ? ` · ${esc(ev.location)}` : ''} · Organisateur : ${esc(org)}</p>
        <p class="small muted">${esc(countsLine(c))} · ${photos} photo${photos > 1 ? 's' : ''}</p>
      </div>
      <div class="ass-row-actions btn-row">
        <button class="btn btn-ghost btn-sm" type="button" data-act="detail" data-id="${esc(ev.id)}" aria-label="Gérer les inscriptions et les dates de « ${title} »">Gérer</button>
        <button class="btn btn-ghost btn-sm" type="button" data-act="edit" data-id="${esc(ev.id)}" aria-label="Modifier « ${title} »">Modifier</button>
        <button class="btn btn-danger btn-sm" type="button" data-act="delete" data-id="${esc(ev.id)}" aria-label="Supprimer « ${title} »">Supprimer</button>
      </div>
    </div>
  </article>`;
}

function render() {
  const now = Date.now();
  const all = visible();
  const list = all.slice(0, S.shown);
  const rest = all.length - list.length;
  const box = S.root.querySelector('#ass-list');
  S.root.querySelector('#ass-count').textContent = all.length
    ? `${list.length} sur ${all.length} sortie${all.length > 1 ? 's' : ''} affichée${all.length > 1 ? 's' : ''}`
    : '';
  box.innerHTML = all.length
    ? list.map((ev) => rowHtml(ev, now)).join('')
    : `<div class="empty">${S.events.length ? 'Aucune sortie ne correspond à ces filtres.' : 'Aucune sortie pour l\'instant. Propose la première avec le bouton ci-dessus.'}</div>`;
  const more = S.root.querySelector('#ass-more');
  more.hidden = rest <= 0;
  more.textContent = `Afficher ${Math.min(BATCH, rest)} de plus (${rest} restante${rest > 1 ? 's' : ''})`;
}

async function deleteEvent(ev, btn) {
  const c = rsvpCounts(S.rsvps, ev.id, S.members);
  const nRsvp = S.rsvps.filter((r) => r.event_id === ev.id).length;
  const nDates = S.dates.filter((d) => d.event_id === ev.id).length;
  const nVotes = S.votes.filter((v) => S.dates.some((d) => d.id === v.date_id && d.event_id === ev.id)).length;
  const photos = S.photos.filter((p) => p.event_id === ev.id);
  const lines = [
    `${nRsvp} inscription${nRsvp > 1 ? 's' : ''} (dont ${c.oui} « je viens »)`,
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
    render();
    refreshDetail();
    S.root.querySelector('#ass-list').focus();
  } catch (e) {
    toast(`Suppression impossible : ${errMsg(e)}`, 'error');
    if (btn) btn.disabled = false;
  }
}

function bindList() {
  S.root.querySelector('#ass-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const ev = S.events.find((x) => x.id === b.dataset.id);
    if (!ev) return;
    if (b.dataset.act === 'detail') openDetail(ev.id, b);
    else if (b.dataset.act === 'edit') openEdit(ev, b);
    else if (b.dataset.act === 'delete') deleteEvent(ev, b);
  });
  S.root.querySelector('#ass-more').addEventListener('click', () => { S.shown += BATCH; render(); });
  S.root.querySelector('#ass-q').addEventListener('input', (e) => { S.q = e.target.value; S.shown = BATCH; render(); });
  S.root.querySelector('#ass-filter').addEventListener('change', (e) => { S.filter = e.target.value; S.shown = BATCH; render(); });
  S.root.querySelector('#ass-sort').addEventListener('change', (e) => { S.sort = e.target.value; S.shown = BATCH; render(); });
  S.root.querySelector('#ass-new').addEventListener('click', (e) => openEdit(null, e.currentTarget));
}

/**
 * Monte la section dans `root` (#sorties-root). `me` : profil de l'administrateur connecté.
 * Une erreur de chargement reste dans la section ; elle n'empêche pas les autres sections.
 */
export async function mountSortiesSection(root, { me } = {}) {
  if (!root) return;
  S.root = root;
  S.me = me;
  root.innerHTML = `<div class="ass">
    <div class="ass-toolbar card">
      <div class="field ass-search">
        <label for="ass-q">Rechercher</label>
        <input id="ass-q" type="search" placeholder="Titre ou lieu" autocomplete="off">
      </div>
      <div class="field">
        <label for="ass-filter">Afficher</label>
        <select id="ass-filter">
          <option value="avenir">À venir et à caler</option>
          <option value="passees">Passées</option>
          <option value="toutes">Toutes</option>
        </select>
      </div>
      <div class="field">
        <label for="ass-sort">Tri par date</label>
        <select id="ass-sort">
          <option value="asc">Croissant</option>
          <option value="desc">Décroissant</option>
        </select>
      </div>
      <button class="btn btn-primary" type="button" id="ass-new">+ Nouvelle sortie</button>
    </div>
    <p class="small muted" id="ass-count" aria-live="polite"></p>
    <div id="ass-list" class="ass-list" tabindex="-1"><div class="empty">Chargement des sorties…</div></div>
    <div class="ass-more"><button class="btn btn-ghost" type="button" id="ass-more" hidden></button></div>
  </div>`;
  mountDialogs(root, ctx);
  bindList();
  try {
    await load();
    render();
  } catch (e) {
    root.querySelector('#ass-list').innerHTML = `<div class="empty">Impossible de charger les sorties : ${esc(errMsg(e))}</div>`;
  }
}
