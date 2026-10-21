// ===== Humane Gang — administration : photos =====
// Deux sources : les albums des sorties (hg_photos) et les images des souvenirs (hg_moments.image_path).
// Les fichiers sont dans le bucket privé hg-photos ; miniatures signées, chargées au défilement (loading="lazy").
// Supprimer un album : fichier du stockage puis ligne. Retirer l'image d'un souvenir : ligne puis fichier.
import { sb, esc, toast, errMsg } from '../core.js';
import { removeObjects, signedUrls, thumbHtml, openLightbox } from '../photos.js';
import { confirmBox } from '../ui-confirm.js';
import { svg } from '../icons.js';
import { sectionError } from '../admin/common.js';
import { pageRange, pageOf, pagerHtml, dayLabel, peopleOptions } from './helpers.js';

const ICON = {
  edit: svg('edit2', { size: 16, stroke: 1.8 }),
  trash: svg('trash2', { size: 16, stroke: 1.8 }),
};

export function createPhotosPanel(ctx) {
  const el = document.createElement('div');
  el.className = 'sv-panel stack';
  el.innerHTML = `
    <div class="filters" role="group" aria-label="Source des photos">
      <button class="chip" type="button" data-sv-src="albums" aria-pressed="true">Albums des sorties</button>
      <button class="chip" type="button" data-sv-src="souvenirs" aria-pressed="false">Images des souvenirs</button>
    </div>
    <div class="sv-toolbar sv-filters">
      <div class="field" id="sv-ph-event-field">
        <label for="sv-ph-event">Sortie</label>
        <select id="sv-ph-event"></select>
      </div>
      <div class="field">
        <label for="sv-ph-author">Auteur</label>
        <select id="sv-ph-author"></select>
      </div>
    </div>
    <div id="sv-ph-grid" aria-live="polite"></div>
    <div id="sv-ph-pager"></div>`;
  const grid = el.querySelector('#sv-ph-grid');
  const pager = el.querySelector('#sv-ph-pager');
  const evField = el.querySelector('#sv-ph-event-field');
  const evSel = el.querySelector('#sv-ph-event');
  const authorSel = el.querySelector('#sv-ph-author');
  const S = { source: 'albums', event: '', author: '', page: 0, items: [], urls: new Map(), people: new Map(), events: new Map(), seqNo: 0, filled: false };

  const labelOf = (it) => (it.kind === 'album' ? `Sortie : ${S.events.get(it.event)?.title ?? 'sortie supprimée'}` : `Souvenir : ${it.title}`);
  const authorOf = (id) => (id ? (S.people.get(id)?.pseudo ?? 'Ancien membre') : 'Sans auteur');

  async function loadLists() {
    S.people = await ctx.people();
    const r = await sb.from('hg_events').select('id,title,starts_at').order('starts_at', { ascending: false }).limit(200);
    if (r.error) throw r.error;
    S.events = new Map((r.data || []).map((e) => [e.id, e]));
    evSel.innerHTML = `<option value="">Toutes les sorties</option>${[...S.events.values()].map((e) => `<option value="${esc(e.id)}">${esc(e.title)}</option>`).join('')}`;
    authorSel.innerHTML = peopleOptions(S.people, '', 'Tous les auteurs');
    S.filled = true;
  }

  async function load() {
    const my = ++S.seqNo;
    grid.innerHTML = '<p class="empty">Chargement des photos…</p>';
    pager.innerHTML = '';
    evField.hidden = S.source !== 'albums';
    try {
      if (!S.filled) await loadLists();
      let rows; let hasNext;
      if (S.source === 'albums') {
        let q = sb.from('hg_photos').select('id,event_id,user_id,path,caption,created_at').order('created_at', { ascending: false });
        if (S.event) q = q.eq('event_id', S.event);
        if (S.author) q = q.eq('user_id', S.author);
        const { data, error } = await q.range(...pageRange(S.page));
        if (error) throw error;
        ({ rows, hasNext } = pageOf(data));
        S.items = rows.map((p) => ({ kind: 'album', id: p.id, path: p.path, caption: p.caption, author: p.user_id, date: p.created_at, event: p.event_id }));
      } else {
        let q = sb.from('hg_moments').select('id,title,happened_on,image_path,created_by').not('image_path', 'is', null).order('created_at', { ascending: false });
        if (S.author) q = q.eq('created_by', S.author);
        const { data, error } = await q.range(...pageRange(S.page));
        if (error) throw error;
        ({ rows, hasNext } = pageOf(data));
        S.items = rows.map((m) => ({ kind: 'moment', id: m.id, path: m.image_path, title: m.title, author: m.created_by, date: m.happened_on }));
      }
      const urls = await signedUrls(S.items.map((it) => it.path));
      if (my !== S.seqNo) return;
      S.urls = urls;
      render(hasNext);
    } catch (e) {
      if (my !== S.seqNo) return;
      grid.innerHTML = sectionError(e);
    }
  }

  function render(hasNext) {
    if (!S.items.length) {
      grid.innerHTML = `<p class="empty">${S.source === 'albums' ? 'Aucune photo pour ces filtres.' : 'Aucune image de souvenir pour ces filtres.'}</p>`;
    } else {
      grid.innerHTML = `<ul class="sv-grid">${S.items.map((it, i) => card(it, i)).join('')}</ul>`;
    }
    pager.innerHTML = pagerHtml(S.page, hasNext);
  }

  function card(it, i) {
    const label = labelOf(it);
    const url = S.urls.get(it.path);
    const album = it.kind === 'album';
    return `<li class="sv-photo">
      <button type="button" class="sv-photo-img" data-sv-zoom="${i}" aria-label="Voir en grand : ${esc(label)}">${url ? thumbHtml(url) : '<span class="thumb-missing" aria-hidden="true"></span>'}</button>
      <div class="sv-photo-meta">
        <strong>${esc(label)}</strong>
        <span class="small muted">${esc(authorOf(it.author))} · ${esc(dayLabel(album ? String(it.date).slice(0, 10) : it.date))}</span>
        ${album && it.caption ? `<span class="small">${esc(it.caption)}</span>` : ''}
      </div>
      <div class="btn-row sv-photo-actions">
        ${album ? `<button type="button" class="btn btn-ghost btn-sm" data-sv-act="caption" data-idx="${i}" aria-label="Modifier la légende de la photo">${ICON.edit}<span>Légende</span></button>` : ''}
        <button type="button" class="btn btn-danger btn-sm" data-sv-act="delete" data-idx="${i}" aria-label="${album ? 'Supprimer la photo' : "Retirer l'image du souvenir"} : ${esc(label)}">${ICON.trash}<span>${album ? 'Supprimer' : "Retirer l'image"}</span></button>
      </div>
    </li>`;
  }

  /** Supprime une photo d'album (fichier puis ligne) ou retire l'image d'un souvenir (ligne puis fichier). */
  async function deleteItem(it, { confirm = true } = {}) {
    const album = it.kind === 'album';
    if (confirm && !(await confirmBox(
      album ? 'Supprimer cette photo ?' : 'Retirer l\'image de ce souvenir ?',
      album ? 'Le fichier et sa fiche seront supprimés définitivement de l\'album.' : 'Le souvenir reste, sans image. Le fichier est supprimé du stockage.',
      { ok: album ? 'Supprimer' : 'Retirer', danger: true }))) return false;
    try {
      if (album) {
        await removeObjects([it.path]);
        const { error } = await sb.from('hg_photos').delete().eq('id', it.id);
        if (error) throw error;
        toast('Photo supprimée.', 'ok');
      } else {
        const { error } = await sb.from('hg_moments').update({ image_path: null }).eq('id', it.id);
        if (error) throw error;
        await removeObjects([it.path]);
        toast('Image retirée du souvenir.', 'ok');
      }
      await load();
      return true;
    } catch (e) {
      toast(`Suppression impossible : ${errMsg(e)}`, 'error');
      return false;
    }
  }

  async function editCaption(it) {
    const v = await confirmBox('Légende de la photo', '', {
      ok: 'Enregistrer',
      input: { label: 'Légende (facultative)', value: it.caption || '', required: false, placeholder: 'Ex. : la fondue de 2025' },
    });
    if (v === false) return;
    const { error } = await sb.from('hg_photos').update({ caption: v || null }).eq('id', it.id);
    if (error) return toast(`Légende non enregistrée : ${errMsg(error)}`, 'error');
    toast('Légende enregistrée.', 'ok');
    await load();
  }

  /* ---------- Interactions ---------- */
  el.querySelectorAll('[data-sv-src]').forEach((b) => b.addEventListener('click', () => {
    S.source = b.dataset.svSrc; S.page = 0;
    el.querySelectorAll('[data-sv-src]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load();
  }));
  evSel.addEventListener('change', () => { S.event = evSel.value; S.page = 0; load(); });
  authorSel.addEventListener('change', () => { S.author = authorSel.value; S.page = 0; load(); });

  el.addEventListener('click', (e) => {
    const pageBtn = e.target.closest('[data-sv-page]');
    if (pageBtn && !pageBtn.disabled) { S.page = Number(pageBtn.dataset.svPage); load(); return; }
    const z = e.target.closest('[data-sv-zoom]');
    if (z) {
      const shown = S.items.filter((it) => S.urls.get(it.path));
      const it = S.items[Number(z.dataset.svZoom)];
      const index = shown.indexOf(it);
      if (index < 0) return;
      openLightbox(shown.map((x) => ({
        url: S.urls.get(x.path),
        alt: labelOf(x),
        caption: `${labelOf(x)} · ${authorOf(x.author)}`,
        onDelete: () => deleteItem(x, { confirm: false }),
      })), index);
      return;
    }
    const b = e.target.closest('[data-sv-act]');
    if (!b) return;
    const it = S.items[Number(b.dataset.idx)];
    if (!it) return;
    if (b.dataset.svAct === 'caption') editCaption(it);
    else if (b.dataset.svAct === 'delete') deleteItem(it);
  });

  return { el, load };
}
