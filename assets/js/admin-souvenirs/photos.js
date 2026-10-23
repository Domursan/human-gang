// =====================================================================
// Admin : photos. Deux sources : les albums des sorties (hg_photos) et les images des souvenirs (hg_moments.image_path).
// Les fichiers sont dans le bucket privé hg-photos ; miniatures signées, chargées au défilement (loading="lazy").
// Supprimer un album : fichier du stockage, puis ligne. Retirer l'image d'un souvenir : ligne, puis fichier.
// Q3 : la grille montre la vignette 480 px (thumb_path) quand elle existe. « Générer les vignettes manquantes » traite
// les anciennes photos par lots de 20 dans le navigateur (téléchargement, réduction, envoi de <chemin>.thumb.webp, mise à
// jour de la ligne) ; on peut fermer l'onglet : un nouveau clic reprend là où il en était (lignes sans vignette).
// Dépendances : core.js (sb, esc, toast, errMsg), photos.js (stockage, miniatures, lightbox), ui-confirm.js,
// icons.js, admin/common.js (sectionError), helpers.js (pagination, dates, annuaire).
// Exporte : createPhotosPanel (fabrique la vue : élément HTML et fonction de rechargement).
// =====================================================================
import { sb, esc, toast, errMsg } from '../core.js';
import { removeObjects, signedUrls, signedUrl, thumbHtml, openLightbox, selectPhotos, gridPath, thumbPathOf, uploadImage } from '../photos.js';
import { prepareThumb } from '../image-compress.js';
import { confirmBox } from '../ui-confirm.js';
import { svg } from '../icons.js';
import { sectionError } from '../admin/common.js';
import { pageRange, pageOf, pagerHtml, dayLabel, peopleOptions } from './helpers.js';

/* Icônes des boutons Légende et Supprimer. */
const ICON = {
  edit: svg('edit2', { size: 16, stroke: 1.8 }),
  trash: svg('trash2', { size: 16, stroke: 1.8 }),
};

/** Fabrique la vue Photos. ctx.people() donne l'annuaire. Renvoie { el, load }. */
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
    <div class="sv-thumbs-gen" id="sv-ph-gen">
      <button type="button" class="btn btn-ghost btn-sm" id="sv-ph-gen-btn">Générer les vignettes manquantes</button>
      <span class="small muted" id="sv-ph-gen-status" role="status" aria-live="polite"></span>
    </div>
    <div id="sv-ph-grid" aria-live="polite"></div>
    <div id="sv-ph-pager"></div>`;
  const grid = el.querySelector('#sv-ph-grid');
  const pager = el.querySelector('#sv-ph-pager');
  const evField = el.querySelector('#sv-ph-event-field');
  const evSel = el.querySelector('#sv-ph-event');
  const authorSel = el.querySelector('#sv-ph-author');
  const genBox = el.querySelector('#sv-ph-gen');
  const genBtn = el.querySelector('#sv-ph-gen-btn');
  const genStatus = el.querySelector('#sv-ph-gen-status');
  const S = { source: 'albums', event: '', author: '', page: 0, items: [], urls: new Map(), people: new Map(), events: new Map(), seqNo: 0, filled: false };

  /* Libellé d'une photo : nom de la sortie pour un album, titre du souvenir sinon. */
  const labelOf = (it) => (it.kind === 'album' ? `Sortie : ${S.events.get(it.event)?.title ?? 'sortie supprimée'}` : `Souvenir : ${it.title}`);
  /* Pseudo de l'auteur d'une photo (« Sans auteur » ou « Ancien membre » selon le cas). */
  const authorOf = (id) => (id ? (S.people.get(id)?.pseudo ?? 'Ancien membre') : 'Sans auteur');

  /** Charge l'annuaire, la liste des sorties (200 dernières) et la liste des auteurs, pour les filtres. */
  async function loadLists() {
    S.people = await ctx.people();
    const r = await sb.from('hg_events').select('id,title,starts_at').order('starts_at', { ascending: false }).limit(200);
    if (r.error) throw r.error;
    S.events = new Map((r.data || []).map((e) => [e.id, e]));
    evSel.innerHTML = `<option value="">Toutes les sorties</option>${[...S.events.values()].map((e) => `<option value="${esc(e.id)}">${esc(e.title)}</option>`).join('')}`;
    authorSel.innerHTML = peopleOptions(S.people, '', 'Tous les auteurs');
    S.filled = true;
  }

  /** Charge la page de photos de la source choisie, avec ses filtres, puis affiche la grille. Ignore une réponse périmée. */
  async function load() {
    const my = ++S.seqNo;
    grid.innerHTML = '<p class="empty">Chargement des photos…</p>';
    pager.innerHTML = '';
    evField.hidden = S.source !== 'albums';
    genBox.hidden = S.source !== 'albums';
    try {
      if (!S.filled) await loadLists();
      let rows; let hasNext;
      if (S.source === 'albums') {
        const { data, error } = await selectPhotos((cols) => {
          let q = sb.from('hg_photos').select(cols).order('created_at', { ascending: false });
          if (S.event) q = q.eq('event_id', S.event);
          if (S.author) q = q.eq('user_id', S.author);
          return q.range(...pageRange(S.page));
        });
        if (error) throw error;
        ({ rows, hasNext } = pageOf(data));
        S.items = rows.map((p) => ({ kind: 'album', id: p.id, path: p.path, thumb: gridPath(p), thumb_path: p.thumb_path || null, width: p.width, height: p.height, caption: p.caption, author: p.user_id, date: p.created_at, event: p.event_id }));
      } else {
        let q = sb.from('hg_moments').select('id,title,happened_on,image_path,created_by').not('image_path', 'is', null).order('created_at', { ascending: false });
        if (S.author) q = q.eq('created_by', S.author);
        const { data, error } = await q.range(...pageRange(S.page));
        if (error) throw error;
        ({ rows, hasNext } = pageOf(data));
        S.items = rows.map((m) => ({ kind: 'moment', id: m.id, path: m.image_path, title: m.title, author: m.created_by, date: m.happened_on }));
      }
      const urls = await signedUrls(S.items.flatMap((it) => [it.path, it.thumb]));
      if (my !== S.seqNo) return;
      S.urls = urls;
      render(hasNext);
    } catch (e) {
      if (my !== S.seqNo) return;
      grid.innerHTML = sectionError(e);
    }
  }

  /** Affiche la grille des photos, ou un message si la liste est vide, puis les boutons de page. */
  function render(hasNext) {
    if (!S.items.length) {
      grid.innerHTML = `<p class="empty">${S.source === 'albums' ? 'Aucune photo pour ces filtres.' : 'Aucune image de souvenir pour ces filtres.'}</p>`;
    } else {
      grid.innerHTML = `<ul class="sv-grid">${S.items.map((it, i) => card(it, i)).join('')}</ul>`;
    }
    pager.innerHTML = pagerHtml(S.page, hasNext);
  }

  /** HTML d'une photo : vignette (zoom), légende, auteur, date et boutons d'action. */
  function card(it, i) {
    const label = labelOf(it);
    const url = S.urls.get(it.thumb || it.path) || S.urls.get(it.path);
    const album = it.kind === 'album';
    return `<li class="sv-photo">
      <button type="button" class="sv-photo-img" data-sv-zoom="${i}" aria-label="Voir en grand : ${esc(label)}">${url ? thumbHtml(url, '', it) : '<span class="thumb-missing" aria-hidden="true"></span>'}</button>
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
        // Ligne supprimée d'abord, puis le fichier : en cas d'échec, il ne reste pas une fiche sans image.
        const { error } = await sb.from('hg_photos').delete().eq('id', it.id);
        if (error) throw error;
        await removeObjects([it.path, it.thumb_path]);
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

  /** Modifie la légende d'une photo d'album, via une boîte de saisie. */
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

  /* ---------- Vignettes manquantes (Q3) ---------- */
  const GEN_LOT = 20;
  let genRun = null; // { stop: boolean } pendant un traitement

  /** Dimensions d'une image (pour hg_photos.width / height). */
  async function dimsOf(blob) {
    try { const b = await createImageBitmap(blob); const d = { width: b.width, height: b.height }; b.close?.(); return d; } catch { return {}; }
  }
  /**
   * Crée la vignette d'une photo : téléchargement de l'original (adresse signée), réduction à 480 px, envoi de
   * <chemin>.thumb.webp (un fichier déjà présent est réutilisé), puis mise à jour de la ligne.
   */
  async function makeThumb(p) {
    const url = await signedUrl(p.path);
    if (!url) throw new Error('adresse de la photo indisponible');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`téléchargement impossible (${res.status})`);
    const blob = await res.blob();
    const th = await prepareThumb(blob);
    if (!th) throw new Error('vignette impossible (format non pris en charge)');
    const tp = thumbPathOf(p.path);
    try { await uploadImage(tp, th); } catch (e) { if (!/exist|duplicate|409/i.test(String(e?.message || e?.statusCode || e))) throw e; }
    const d = await dimsOf(blob);
    const patch = { thumb_path: tp };
    if (d.width > 0 && d.height > 0 && d.width <= 20000 && d.height <= 20000) Object.assign(patch, d);
    const { error } = await sb.from('hg_photos').update(patch).eq('id', p.id);
    if (error) throw error;
  }
  /** Traite toutes les photos sans vignette, par lots de 20 ; un second clic arrête après la photo en cours. */
  async function generateThumbs() {
    if (genRun) { genRun.stop = true; genBtn.disabled = true; genStatus.textContent = 'Arrêt après la photo en cours…'; return; }
    const run = genRun = { stop: false };
    genBtn.textContent = 'Arrêter';
    const failed = new Set();
    let done = 0;
    try {
      while (!run.stop) {
        const { data, error } = await sb.from('hg_photos').select('id,path,thumb_path').is('thumb_path', null)
          .order('created_at', { ascending: true }).limit(GEN_LOT + failed.size);
        if (error) throw error;
        const lot = (data || []).filter((p) => !failed.has(p.id)).slice(0, GEN_LOT);
        if (!lot.length) break;
        for (const p of lot) {
          if (run.stop) break;
          try { await makeThumb(p); done++; } catch (e) { failed.add(p.id); console.warn('[vignettes]', p.path, e?.message || e); }
          genStatus.textContent = `${done} vignette${done > 1 ? 's' : ''} créée${done > 1 ? 's' : ''}${failed.size ? ` · ${failed.size} en échec` : ''}…`;
        }
      }
      genStatus.textContent = run.stop
        ? `Arrêté : ${done} vignette${done > 1 ? 's' : ''} créée${done > 1 ? 's' : ''}. Un nouveau clic reprend là où tu t’es arrêté.`
        : `Terminé : ${done} vignette${done > 1 ? 's' : ''} créée${done > 1 ? 's' : ''}${failed.size ? `, ${failed.size} en échec (voir la console)` : ''}.`;
      if (done) toast(`${done} vignette${done > 1 ? 's' : ''} créée${done > 1 ? 's' : ''}.`, 'ok');
    } catch (e) {
      genStatus.textContent = '';
      toast(`Vignettes : ${errMsg(e)}`, 'error');
    } finally {
      genRun = null;
      genBtn.disabled = false;
      genBtn.textContent = 'Générer les vignettes manquantes';
      if (done) load();
    }
  }
  genBtn.addEventListener('click', generateThumbs);

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
