// ===== Humane Gang — administration : souvenirs (hg_moments) =====
// Liste paginée (30), recherche sur le titre, création, modification (titre, texte, date, auteur, image), suppression.
// Droits : hg_moments_insert exige created_by = administrateur ; la modification peut changer l'auteur.
import { sb, esc, toast, errMsg } from '../core.js';
import { prepareImage } from '../image-compress.js';
import { uploadImage, removeObjects, signedUrls, uuid, thumbHtml } from '../photos.js';
import { confirmBox } from '../ui-confirm.js';
import { svg } from '../icons.js';
import { sectionError } from '../admin/common.js';
import { PAGE, pageRange, pageOf, pagerHtml, dayLabel, searchTerm, todayIso, peopleOptions } from './helpers.js';

const ICON = {
  plus: svg('plus', { stroke: 2 }),
  edit: svg('edit2', { size: 16, stroke: 1.8 }),
  trash: svg('trash2', { size: 16, stroke: 1.8 }),
  search: svg('search', { size: 16, stroke: 1.8 }),
};

export function createMomentsPanel(ctx) {
  const el = document.createElement('div');
  el.className = 'sv-panel stack';
  el.innerHTML = `
    <div class="sv-toolbar">
      <div class="field sv-search">
        <label for="sv-mo-q">Rechercher un souvenir</label>
        <input id="sv-mo-q" type="search" autocomplete="off" placeholder="Titre du souvenir">
      </div>
      <button type="button" class="btn btn-primary" data-sv-new>${ICON.plus}<span>Nouveau souvenir</span></button>
    </div>
    <div class="sv-list" id="sv-mo-list" aria-live="polite"></div>
    <div id="sv-mo-pager"></div>`;
  const list = el.querySelector('#sv-mo-list');
  const pager = el.querySelector('#sv-mo-pager');
  const S = { q: '', page: 0, rows: [], urls: new Map(), people: new Map(), seqNo: 0, timer: null };

  async function load() {
    const my = ++S.seqNo;
    list.innerHTML = '<p class="empty">Chargement des souvenirs…</p>';
    pager.innerHTML = '';
    try {
      S.people = await ctx.people();
      let q = sb.from('hg_moments').select('*').order('happened_on', { ascending: false }).order('created_at', { ascending: false });
      const term = searchTerm(S.q);
      if (term) q = q.ilike('title', `%${term}%`);
      const { data, error } = await q.range(...pageRange(S.page));
      if (error) throw error;
      const { rows, hasNext } = pageOf(data);
      const urls = await signedUrls(rows.map((m) => m.image_path));
      if (my !== S.seqNo) return; // une recherche plus récente a remplacé celle-ci
      S.rows = rows; S.urls = urls;
      render(hasNext, term);
    } catch (e) {
      if (my !== S.seqNo) return;
      list.innerHTML = sectionError(e);
    }
  }

  function render(hasNext, term) {
    if (!S.rows.length) {
      list.innerHTML = `<p class="empty">${term ? `Aucun souvenir ne correspond à « ${esc(S.q.trim())} ».` : 'Aucun souvenir pour l\'instant.'}</p>`;
    } else {
      list.innerHTML = `<ul class="sv-items">${S.rows.map(row).join('')}</ul>`;
    }
    pager.innerHTML = pagerHtml(S.page, hasNext);
  }

  function row(m) {
    const author = m.created_by ? (S.people.get(m.created_by)?.pseudo ?? 'Ancien membre') : 'Sans auteur';
    const url = m.image_path ? S.urls.get(m.image_path) : null;
    return `<li class="sv-row" data-id="${esc(m.id)}">
      <div class="sv-thumb">${url ? thumbHtml(url) : '<span class="thumb-missing" aria-hidden="true"></span>'}</div>
      <div class="sv-main">
        <h3 class="sv-title">${esc(m.title)}</h3>
        <p class="small muted">${esc(dayLabel(m.happened_on))} · Raconté par ${esc(author)}</p>
        ${m.body ? `<p class="sv-excerpt">${esc(m.body)}</p>` : ''}
      </div>
      <div class="btn-row sv-row-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-sv-act="edit" data-id="${esc(m.id)}" aria-label="Modifier « ${esc(m.title)} »">${ICON.edit}<span>Modifier</span></button>
        <button type="button" class="btn btn-danger btn-sm" data-sv-act="delete" data-id="${esc(m.id)}" aria-label="Supprimer « ${esc(m.title)} »">${ICON.trash}<span>Supprimer</span></button>
      </div>
    </li>`;
  }

  /* ---------- Formulaire (création et modification) ---------- */
  function openForm(m) {
    const dlg = document.createElement('dialog');
    dlg.className = 'hg-dialog sv-dialog';
    dlg.setAttribute('aria-labelledby', 'sv-mo-dlg-title');
    dlg.innerHTML = `<form class="stack" novalidate>
      <h2 id="sv-mo-dlg-title" class="dialog-title">${m ? 'Modifier le souvenir' : 'Nouveau souvenir'}</h2>
      <div class="field">
        <label for="sv-mo-f-title">Titre</label>
        <input id="sv-mo-f-title" name="title" maxlength="140" required value="${esc(m?.title || '')}">
      </div>
      <div class="field">
        <label for="sv-mo-f-body">Texte (facultatif)</label>
        <textarea id="sv-mo-f-body" name="body" rows="4">${esc(m?.body || '')}</textarea>
      </div>
      <div class="sv-form-row">
        <div class="field">
          <label for="sv-mo-f-date">Date</label>
          <input id="sv-mo-f-date" name="happened_on" type="date" required value="${esc(m?.happened_on?.slice(0, 10) || todayIso())}">
        </div>
        ${m ? `<div class="field">
          <label for="sv-mo-f-author">Auteur</label>
          <select id="sv-mo-f-author" name="created_by">${peopleOptions(S.people, m.created_by || '', 'Sans auteur')}</select>
        </div>` : ''}
      </div>
      <div class="field">
        <label for="sv-mo-f-image">Image (facultatif)</label>
        <input id="sv-mo-f-image" name="image" type="file" accept="image/png,image/webp,image/jpeg">
        ${m?.image_path ? `<label class="check"><input type="checkbox" name="remove_image"><span>Retirer l'image actuelle</span></label>` : ''}
      </div>
      <div class="btn-row dialog-actions">
        <button type="button" class="btn btn-ghost" data-sv-cancel>Annuler</button>
        <button type="submit" class="btn btn-primary">${m ? 'Enregistrer' : 'Ajouter'}</button>
      </div>
    </form>`;
    document.body.append(dlg);
    const form = dlg.querySelector('form');
    const f = form.elements;
    dlg.addEventListener('close', () => dlg.remove(), { once: true });
    dlg.querySelector('[data-sv-cancel]').addEventListener('click', () => dlg.close());
    form.addEventListener('submit', (e) => { e.preventDefault(); save(m, f, dlg); });
    dlg.showModal();
    f.title.focus();
  }

  async function save(m, f, dlg) {
    const title = f.title.value.trim();
    if (!title) { toast('Donne un titre à ce souvenir.', 'error'); f.title.focus(); return; }
    if (!f.happened_on.value) { toast('Indique la date du souvenir.', 'error'); f.happened_on.focus(); return; }
    const payload = { title, body: f.body.value.trim() || null, happened_on: f.happened_on.value };
    if (m) payload.created_by = f.created_by.value || null;
    const file = f.image.files[0];
    const removeImg = !!f.remove_image?.checked;
    const submit = dlg.querySelector('[type="submit"]');
    submit.disabled = true;
    let newPath = null;
    try {
      if (file) {
        const img = await prepareImage(file);
        newPath = `${ctx.me.id}/moments/${uuid()}.${img.ext}`; // dossier de l'administrateur : règle de stockage hg-photos
        await uploadImage(newPath, img.blob);
        payload.image_path = newPath;
      } else if (removeImg) payload.image_path = null;

      const res = m
        ? await sb.from('hg_moments').update(payload).eq('id', m.id)
        : await sb.from('hg_moments').insert({ ...payload, created_by: ctx.me.id });
      if (res.error) throw res.error;
      if (m?.image_path && (file || removeImg)) removeObjects([m.image_path]).catch(() => toast('Ancienne image non supprimée du stockage.', 'error'));
      toast(m ? 'Souvenir mis à jour.' : 'Souvenir ajouté.', 'ok');
      dlg.close();
      await load();
    } catch (err) {
      if (newPath) removeObjects([newPath]).catch(() => {});
      toast(`Enregistrement impossible : ${errMsg(err)}`, 'error');
    } finally {
      submit.disabled = false;
    }
  }

  async function remove(m, btn) {
    if (!(await confirmBox(`Supprimer le souvenir « ${m.title} » ?`, 'Son texte et son image seront supprimés définitivement.', { ok: 'Supprimer', danger: true }))) return;
    btn.disabled = true;
    try {
      const { error } = await sb.from('hg_moments').delete().eq('id', m.id);
      if (error) throw error;
      if (m.image_path) removeObjects([m.image_path]).catch(() => toast('Image non supprimée du stockage.', 'error'));
      toast('Souvenir supprimé.', 'ok');
      await load();
    } catch (e) {
      toast(`Suppression impossible : ${errMsg(e)}`, 'error');
      btn.disabled = false;
    }
  }

  /* ---------- Interactions ---------- */
  el.querySelector('[data-sv-new]').addEventListener('click', async () => {
    S.people = await ctx.people().catch(() => S.people);
    openForm(null);
  });
  el.querySelector('#sv-mo-q').addEventListener('input', (e) => {
    clearTimeout(S.timer);
    S.timer = setTimeout(() => { S.q = e.target.value; S.page = 0; load(); }, 300);
  });
  el.addEventListener('click', async (e) => {
    const pageBtn = e.target.closest('[data-sv-page]');
    if (pageBtn && !pageBtn.disabled) { S.page = Number(pageBtn.dataset.svPage); load(); return; }
    const b = e.target.closest('[data-sv-act]');
    if (!b) return;
    const m = S.rows.find((x) => x.id === b.dataset.id);
    if (!m) return;
    if (b.dataset.svAct === 'edit') {
      S.people = await ctx.people().catch(() => S.people);
      openForm(m);
    } else if (b.dataset.svAct === 'delete') remove(m, b);
  });

  return { el, load };
}
