// ===== Humane Gang — administration : souvenirs (hg_moments) — formulaire et suppression =====
// La liste et le détail sont dans index.js ; ici, la fenêtre de création/modification et la suppression.
// Droits : hg_moments_insert exige created_by = administrateur ; la modification peut changer l'auteur.
import { sb, esc, toast, errMsg } from '../core.js';
import { prepareImage } from '../image-compress.js';
import { uploadImage, removeObjects, uuid } from '../photos.js';
import { confirmBox } from '../ui-confirm.js';
import { todayIso, peopleOptions } from './helpers.js';

/**
 * Fenêtre de création (m = null) ou de modification d'un souvenir.
 * people : annuaire (Map). onDone(id) est appelé après l'enregistrement, avec l'identifiant du souvenir.
 */
export function openMomentForm({ me, m = null, people, onDone }) {
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
        <select id="sv-mo-f-author" name="created_by">${peopleOptions(people, m.created_by || '', 'Sans auteur')}</select>
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
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  dlg.showModal();
  f.title.focus();

  async function save() {
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
        newPath = `${me.id}/moments/${uuid()}.${img.ext}`; // dossier de l'administrateur : règle de stockage hg-photos
        await uploadImage(newPath, img.blob);
        payload.image_path = newPath;
      } else if (removeImg) payload.image_path = null;

      let id = m?.id;
      if (m) {
        const res = await sb.from('hg_moments').update(payload).eq('id', m.id);
        if (res.error) throw res.error;
      } else {
        const res = await sb.from('hg_moments').insert({ ...payload, created_by: me.id }).select('id').single();
        if (res.error) throw res.error;
        id = res.data?.id;
      }
      if (m?.image_path && (file || removeImg)) removeObjects([m.image_path]).catch(() => toast('Ancienne image non supprimée du stockage.', 'error'));
      toast(m ? 'Souvenir mis à jour.' : 'Souvenir ajouté.', 'ok');
      dlg.close();
      await onDone?.(m ? null : id);
    } catch (err) {
      if (newPath) removeObjects([newPath]).catch(() => {});
      toast(`Enregistrement impossible : ${errMsg(err)}`, 'error');
    } finally {
      submit.disabled = false;
    }
  }
}

/** Supprime un souvenir (confirmation) : la ligne, puis l'image du stockage. onDone() après coup. */
export async function removeMoment(m, { btn = null, onDone } = {}) {
  if (!(await confirmBox(`Supprimer le souvenir « ${m.title} » ?`, 'Son texte et son image seront supprimés définitivement.', { ok: 'Supprimer', danger: true }))) return;
  if (btn) btn.disabled = true;
  try {
    const { error } = await sb.from('hg_moments').delete().eq('id', m.id);
    if (error) throw error;
    if (m.image_path) removeObjects([m.image_path]).catch(() => toast('Image non supprimée du stockage.', 'error'));
    toast('Souvenir supprimé.', 'ok');
    await onDone?.();
  } catch (e) {
    toast(`Suppression impossible : ${errMsg(e)}`, 'error');
    if (btn) btn.disabled = false;
  }
}
