// =====================================================================
// Admin : section « Souvenirs et photos ». Sous-section unique (vie/souvenirs) avec trois vues, choisies par
// des puces en haut de la colonne 2 :
//   #vie/souvenirs            liste des souvenirs (colonne 2) et détail (zone principale)
//   #vie/souvenirs/<id>       un souvenir sélectionné
//   #vie/souvenirs/photos     vue Photos (albums des sorties et images des souvenirs)
//   #vie/souvenirs/reactions  vue Réactions (réactions actives, masquage)
// Montage par admin.js (registerSub 'vie/souvenirs') : main, open, list. Droits : hg_moments, hg_photos, hg_reactions côté base.
// Dépendances : core.js, photos.js (miniatures, lightbox), admin/ui/* (liste, en-tête), admin/common.js, admin/live.js,
// helpers.js, moments.js (formulaire), photos.js (vue Photos), reactions.js (vue Réactions),
// admin-reglages/lot3-ui.js (bloc de réglages), reglages-valeurs-lot3.js.
// Exporte : mountSouvenirsSection, openSouvenirs, listSouvenirs.
// =====================================================================
import { sb, esc } from '../core.js';
import { signedUrls, thumbHtml, openLightbox } from '../photos.js';
import { createList } from '../admin/ui/list.js';
import { renderDetailHeader } from '../admin/ui/detail-header.js';
import { sectionError } from '../admin/common.js';
import { onTableChange } from '../admin/live.js';
import { loadPeople, dayLabel } from './helpers.js';
import { openMomentForm, removeMoment } from './moments.js';
import { createPhotosPanel } from './photos.js';
import { createReactionsPanel } from './reactions.js';
import { blocReglages } from '../admin-reglages/lot3-ui.js';
import { chargerReglagesLot3 } from '../reglages-valeurs-lot3.js';

/* Vues de la section : [identifiant, libellé]. Souvenirs est la vue par défaut. */
const VIEWS = [['souvenirs', 'Souvenirs'], ['photos', 'Photos'], ['reactions', 'Réactions']];
const LIMIT = 500; // souvenirs chargés d'un coup ; la liste affiche par lots (createList)

/* État de la section : auteur, annuaire, souvenirs chargés, URL signées, vue, souvenir choisi et zones d'affichage. */
const S = {
  me: null, ctx: null, people: new Map(), rows: [], urls: new Map(), error: null, loaded: false, seq: 0,
  view: 'souvenirs', selId: null,
  zones: {}, panels: {}, colEl: null, list: null, headApi: null, detailHead: null, detailBody: null,
};

/* ---------- Données ---------- */

/** Recharge les souvenirs (et l'annuaire, une fois), puis redessine. */
async function reload() {
  const my = ++S.seq;
  try {
    const [people, res] = await Promise.all([
      S.ctx.people(),
      sb.from('hg_moments').select('*').order('happened_on', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT),
    ]);
    if (res.error) throw res.error;
    const rows = res.data || [];
    const urls = await signedUrls(rows.map((m) => m.image_path));
    if (my !== S.seq) return; // un rechargement plus récent a remplacé celui-ci
    Object.assign(S, { people, rows, urls, error: null });
  } catch (e) {
    if (my !== S.seq) return;
    S.error = e;
  }
  S.loaded = true;
  repaint();
}

/* Pseudo de l'auteur d'un souvenir (« Sans auteur » si absent, « Ancien membre » si inconnu). */
const authorOf = (id) => (id ? (S.people.get(id)?.pseudo ?? 'Ancien membre') : 'Sans auteur');

/** Lignes de la liste des souvenirs, avec l'URL de la miniature quand elle existe. */
function listItems() {
  if (S.error) return [];
  return S.rows.map((m) => ({
    id: m.id,
    name: m.title,
    title: m.title,
    date: m.happened_on,
    author: authorOf(m.created_by),
    url: m.image_path ? S.urls.get(m.image_path) : null,
  }));
}

/* ---------- Affichage ---------- */

/** HTML d'une ligne de la liste : miniature, titre, date et auteur. */
function rowHtml(it) {
  return `<div class="sv-li">
    <div class="sv-li-thumb">${it.url ? thumbHtml(it.url) : '<span class="thumb-missing" aria-hidden="true"></span>'}</div>
    <div class="sv-li-body">
      <div class="sv-li-title">${esc(it.title)}</div>
      <div class="sv-li-meta">${esc(dayLabel(it.date))} · ${esc(it.author)}</div>
    </div>
  </div>`;
}

/** Zone principale : le souvenir sélectionné (en-tête avec Modifier / Supprimer, image, texte). */
function paintDetail() {
  if (!S.detailHead) return;
  S.headApi?.destroy();
  S.headApi = null;
  const m = S.rows.find((r) => r.id === S.selId);
  if (!m) {
    S.detailHead.innerHTML = '';
    S.detailBody.innerHTML = S.error
      ? sectionError(S.error)
      : `<div class="empty">${S.loaded ? 'Choisis un souvenir dans la liste, ou ajoute-en un.' : 'Chargement des souvenirs…'}</div>`;
    return;
  }
  const url = m.image_path ? S.urls.get(m.image_path) : null;
  S.headApi = renderDetailHeader(S.detailHead, {
    title: m.title,
    subtitle: `${dayLabel(m.happened_on)} · Raconté par ${authorOf(m.created_by)}`,
    actions: [
      { label: 'Modifier', onClick: () => editMoment(m) },
      { label: 'Supprimer', onClick: () => removeMoment(m, { onDone: afterRemove }) },
    ],
  });
  S.detailBody.innerHTML = `${url ? `<button type="button" class="sv-d-img" data-sv-zoom aria-label="Voir l'image en grand">${thumbHtml(url, m.title)}</button>` : ''}
    ${m.body ? `<p class="sv-d-text">${esc(m.body)}</p>` : '<p class="small muted">Pas de texte pour ce souvenir.</p>'}`;
  S.detailBody.querySelector('[data-sv-zoom]')?.addEventListener('click', () => openLightbox([{ url, alt: m.title, caption: m.title }], 0));
}

/** Puces des vues, et affichage de la colonne et de la zone selon la vue. */
function paintViews() {
  for (const k of Object.keys(S.zones)) S.zones[k].hidden = k !== S.view;
  if (!S.colEl) return;
  for (const a of S.colEl.querySelectorAll('[data-view]')) {
    if (a.dataset.view === S.view) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  }
  S.colEl.querySelector('.sv-col-tools').hidden = S.view !== 'souvenirs';
  S.colEl.querySelector('.sv-col-list').hidden = S.view !== 'souvenirs';
}

/** Redessine la liste, le détail et les vues après un changement de données. */
function repaint() {
  S.list?.update(listItems());
  paintDetail();
  paintViews();
}

/* ---------- Actions ---------- */

/* Change l'URL de la section (le routeur réaffiche la bonne vue). */
const setHash = (path) => { location.hash = `#vie/souvenirs${path}`; };

/** Ouvre le formulaire d'un souvenir (création si m est absent). Après enregistrement, ouvre le nouveau souvenir. */
async function editMoment(m = null) {
  S.people = await S.ctx.people().catch(() => S.people);
  openMomentForm({
    me: S.me,
    m,
    people: S.people,
    onDone: async (newId) => {
      await reload();
      if (newId) setHash(`/${encodeURIComponent(newId)}`); // nouveau souvenir : on l'ouvre
    },
  });
}

/** Après une suppression : relit les souvenirs, revient à la liste et place le focus sur « Nouveau souvenir ». */
async function afterRemove() {
  const was = S.selId;
  await reload();
  if (was) setHash('');
  S.colEl?.querySelector('#sv-new')?.focus();
}

/* ---------- Points d'entrée de la sous-section ---------- */

/** Monte la sous-section : zones (souvenir, photos, réactions) et temps réel. Les données se chargent sans bloquer. */
export function mountSouvenirsSection(root, { me }) {
  S.me = me;
  let peoplePromise = null;
  // Annuaire partagé par les vues (membres + fantômes), chargé une seule fois.
  S.ctx = {
    me,
    people: () => {
      peoplePromise ??= loadPeople().catch((e) => { peoplePromise = null; throw e; });
      return peoplePromise;
    },
  };
  root.innerHTML = `<div class="sv-zone">
    <div class="sv-d" data-zone="souvenirs"><div class="ass-d-head sv-d-head" id="sv-d-head"></div><div class="ass-d-body sv-d-body" id="sv-d-body"></div></div>
    <div class="sv-z" data-zone="photos" hidden></div>
    <div class="sv-z" data-zone="reactions" hidden></div>
  </div>`;
  S.zones = { souvenirs: root.querySelector('[data-zone="souvenirs"]'), photos: root.querySelector('[data-zone="photos"]'), reactions: root.querySelector('[data-zone="reactions"]') };
  S.detailHead = root.querySelector('#sv-d-head');
  S.detailBody = root.querySelector('#sv-d-body');
  root.prepend(blocReglages('souvenirs'));
  chargerReglagesLot3();
  S.panels = { photos: createPhotosPanel(S.ctx), reactions: createReactionsPanel(S.ctx) };
  S.zones.photos.append(S.panels.photos.el);
  S.zones.reactions.append(S.panels.reactions.el);
  // Temps réel : souvenirs et photos ; la vue Photos est relue si elle est affichée
  onTableChange('souvenirs', ['hg_moments', 'hg_photos'], () => {
    reload();
    if (S.view === 'photos') S.panels.photos.load();
  });
  reload();
}

/** Sélection de vue ou de souvenir : appelé à chaque visite (URL #vie/souvenirs[/<id|vue>]). */
export function openSouvenirs({ id } = {}) {
  const view = VIEWS.some(([k]) => k === id) ? id : 'souvenirs';
  const changed = view !== S.view;
  S.view = view;
  S.selId = view === 'souvenirs' ? (id || null) : null;
  if (changed && (view === 'photos' || view === 'reactions')) S.panels[view].load();
  S.list?.select(S.selId);
  paintDetail();
  paintViews();
}

/** Colonne 2 : puces des vues, nouveau souvenir, liste des souvenirs. */
export function listSouvenirs(el) {
  el.innerHTML = `<div class="sv-col">
    <nav class="sv-views" aria-label="Vues de la section">
      ${VIEWS.map(([k, label]) => `<a class="chip" href="#vie/souvenirs${k === 'souvenirs' ? '' : `/${k}`}" data-view="${k}">${label}</a>`).join('')}
    </nav>
    <div class="sv-col-tools">
      <button type="button" class="btn btn-primary btn-sm" id="sv-new">+ Nouveau souvenir</button>
    </div>
    <div class="sv-col-list"></div>
  </div>`;
  S.colEl = el;
  el.querySelector('#sv-new').addEventListener('click', () => editMoment(null));
  S.list = createList(el.querySelector('.sv-col-list'), {
    items: listItems(),
    key: 'id',
    search: { placeholder: 'Titre du souvenir', label: 'Rechercher un souvenir', fields: (it) => `${it.title} ${it.author}` },
    render: rowHtml,
    selectedId: S.selId,
    label: 'Souvenirs',
    empty: 'Aucun souvenir à afficher. Ajoute le premier avec le bouton ci-dessus.',
    onSelect: (it) => setHash(`/${encodeURIComponent(it.id)}`),
  });
  paintViews();
}
