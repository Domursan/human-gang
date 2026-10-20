// ===== Humane Gang — administration : création / modification / suppression des badges =====
// Les 15 badges d'origine sont attribués automatiquement par la base : ils restent modifiables mais jamais supprimables.
// Les badges créés ici s'attribuent à la main (section Badges ou fiche du membre).
import { sb, toast, errMsg, esc, $ } from './core.js';

export const AUTO_BADGES = new Set([
  'premier_noel', 'veteran', 'lutin_express', 'sur_le_fil', 'liste_parfaite', 'toujours_la', 'organisateur', 'globe_trotter',
  'paparazzi', 'boite_a_idees', 'fondateur', 'fidele', 'chasseur_bugs', 'saisonnier', 'cupidon',
]);
export const isAutoBadge = (code) => AUTO_BADGES.has(code);

const CODE_RE = /^[a-z0-9_]{2,40}$/;
/** « Roi du karaoké ! » -> « roi_du_karaoke » */
export function slugify(name) {
  return String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).replace(/_+$/, '');
}
/** Code libre à partir du nom : suffixe _2, _3… si déjà pris. */
export function uniqueCode(name, taken) {
  const base = slugify(name) || 'badge';
  const b = base.length < 2 ? `${base}_badge` : base;
  if (!taken.has(b)) return b;
  for (let i = 2; i < 1000; i++) { const c = `${b.slice(0, 36)}_${i}`; if (!taken.has(c)) return c; }
  return `${b.slice(0, 30)}_${Date.now().toString(36)}`;
}

function check(res) { if (res.error) throw res.error; return res.data; }
async function uploadBadgeImage(code, file) {
  if (!file.type.startsWith('image/')) throw new Error('Choisis une image (PNG, JPG, WebP ou SVG).');
  if (file.size > 10 * 1024 * 1024) throw new Error('Image trop lourde (10 Mo maximum).');
  const path = `badges/${code}.png`;
  check(await sb.storage.from('hg-assets').upload(path, file, { upsert: true, contentType: file.type, cacheControl: '300' }));
  const { data } = sb.storage.from('hg-assets').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
function confirmBox(title, body, { ok = 'Confirmer', danger = false } = {}) {
  const dlg = $('#confirm-dlg');
  $('#confirm-title').textContent = title;
  $('#confirm-body').textContent = body;
  const okBtn = $('#confirm-ok');
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

const BADGE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/></svg>';

/**
 * Ouvre le formulaire (création si badge = null). badges = liste actuelle (codes pris, ordre par défaut).
 * onSaved(row) après enregistrement.
 */
export function openBadgeEditor({ badge = null, badges = [], onSaved = async () => {} } = {}) {
  const isNew = !badge;
  const taken = new Set(badges.map((b) => b.code));
  const nextSort = Math.max(0, ...badges.map((b) => Number(b.sort) || 0)) + 10;
  let dlg = $('#bdg-dlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'bdg-dlg'; dlg.className = 'hg-dialog bdg-dlg';
    dlg.setAttribute('aria-labelledby', 'bdg-title');
    document.body.append(dlg);
  }
  const auto = !isNew && isAutoBadge(badge.code);
  dlg.innerHTML = `
    <form class="stack" id="bdg-form" novalidate>
      <h2 id="bdg-title" class="dialog-title">${isNew ? 'Nouveau badge' : `Modifier « ${esc(badge.name)} »`}</h2>
      ${auto ? '<p class="small muted">Badge automatique : la base l\'attribue toute seule. Tu peux changer son nom, sa description, son image et son ordre.</p>'
        : isNew ? '<p class="small muted">Un badge créé ici s\'attribue à la main (section Badges ou fiche d\'un membre).</p>' : ''}
      <p class="form-error" role="alert" hidden></p>
      <div class="field"><label for="bdg-name">Nom</label><input id="bdg-name" name="name" required maxlength="60" autocomplete="off" value="${esc(badge?.name ?? '')}"></div>
      <div class="field"><label for="bdg-code">Code ${isNew ? '<span class="muted small">(généré depuis le nom, modifiable)</span>' : '<span class="muted small">(non modifiable)</span>'}</label>
        <input id="bdg-code" name="code" ${isNew ? 'required' : 'readonly'} maxlength="40" pattern="[a-z0-9_]{2,40}" autocomplete="off" spellcheck="false" class="code" value="${esc(badge?.code ?? '')}" aria-describedby="bdg-code-help">
        <span class="small muted" id="bdg-code-help">Minuscules, chiffres et « _ » uniquement. Sert aussi de nom d'image (badges/&lt;code&gt;.png).</span></div>
      <div class="field"><label for="bdg-desc">Description</label><textarea id="bdg-desc" name="description" rows="2" maxlength="200" required>${esc(badge?.description ?? '')}</textarea></div>
      <div class="bdg-row">
        <div class="field"><label for="bdg-sort">Ordre d'affichage</label><input id="bdg-sort" name="sort" type="number" step="1" inputmode="numeric" value="${esc(badge?.sort ?? nextSort)}"></div>
        <div class="field bdg-img-field">
          <label for="bdg-file">Image <span class="muted small">(carrée, PNG conseillé)</span></label>
          <div class="bdg-img-edit">
            <span class="badge-img" id="bdg-preview">${badge?.image_url ? `<img src="${esc(badge.image_url)}" alt="">` : BADGE_SVG}</span>
            <input id="bdg-file" name="file" type="file" accept="image/png,image/webp,image/jpeg,image/svg+xml">
          </div>
        </div>
      </div>
      <div class="btn-row dialog-actions">
        <button class="btn btn-ghost" type="button" data-bdg-cancel>Annuler</button>
        <button class="btn btn-primary" type="submit">${isNew ? 'Créer le badge' : 'Enregistrer'}</button>
      </div>
    </form>`;
  const form = $('#bdg-form', dlg);
  const err = $('.form-error', form);
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  let codeTouched = false;
  if (isNew) {
    form.elements.code.addEventListener('input', () => { codeTouched = true; });
    form.elements.name.addEventListener('input', () => { if (!codeTouched) form.elements.code.value = form.elements.name.value.trim() ? uniqueCode(form.elements.name.value, taken) : ''; });
  }
  let previewUrl = null;
  form.elements.file.addEventListener('change', () => {
    const f = form.elements.file.files?.[0];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = f ? URL.createObjectURL(f) : null;
    $('#bdg-preview', dlg).innerHTML = previewUrl ? `<img src="${previewUrl}" alt="">` : (badge?.image_url ? `<img src="${esc(badge.image_url)}" alt="">` : BADGE_SVG);
  });
  $('[data-bdg-cancel]', dlg).addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, { once: true });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter; showErr('');
    const name = form.elements.name.value.trim(), description = form.elements.description.value.trim();
    const code = isNew ? form.elements.code.value.trim().toLowerCase() : badge.code;
    const sort = Number.parseInt(form.elements.sort.value, 10);
    if (name.length < 2) return showErr('Le nom doit faire au moins 2 caractères.');
    if (!description) return showErr('Ajoute une courte description (comment on l\'obtient).');
    if (isNew && !CODE_RE.test(code)) return showErr('Code invalide : 2 à 40 caractères, minuscules, chiffres et « _ ».');
    if (isNew && taken.has(code)) return showErr(`Le code « ${code} » est déjà utilisé par un autre badge.`);
    if (!Number.isFinite(sort)) return showErr('L\'ordre doit être un nombre entier.');
    const file = form.elements.file.files?.[0] ?? null;
    if (btn) btn.disabled = true;
    try {
      let row;
      if (isNew) {
        row = check(await sb.from('hg_badges').insert({ code, name, description, sort, image_url: null }).select().single());
        if (file) {
          try {
            const url = await uploadBadgeImage(code, file);
            row = check(await sb.from('hg_badges').update({ image_url: url }).eq('code', code).select().single());
          } catch (e) { toast(`Badge créé, mais l'image n'a pas pu être envoyée : ${errMsg(e)}`, 'error'); }
        }
      } else {
        const patch = { name, description, sort };
        if (file) patch.image_url = await uploadBadgeImage(code, file);
        row = check(await sb.from('hg_badges').update(patch).eq('code', code).select().single());
      }
      dlg.close();
      toast(isNew ? `Badge « ${name} » créé` : 'Badge enregistré', 'ok');
      await onSaved(row);
    } catch (e) {
      const m = errMsg(e);
      showErr(/duplicate key|23505/i.test(m) || e?.code === '23505' ? `Le code « ${code} » est déjà utilisé.` : m);
    } finally { if (btn?.isConnected) btn.disabled = false; }
  });
  dlg.showModal();
  form.elements.name.focus();
}

/** Supprime un badge créé par l'admin (jamais un badge automatique). Renvoie true si supprimé. */
export async function deleteBadge(badge, holderCount = 0) {
  if (isAutoBadge(badge.code)) throw new Error('Les badges automatiques ne peuvent pas être supprimés.');
  const ok = await confirmBox(`Supprimer le badge « ${badge.name} » ?`,
    holderCount ? `${holderCount} membre${holderCount > 1 ? 's le perdront' : ' le perdra'}. Cette action est définitive.` : 'Personne ne l\'a encore. Cette action est définitive.',
    { ok: 'Supprimer', danger: true });
  if (!ok) return false;
  check(await sb.from('hg_badges').delete().eq('code', badge.code)); // hg_user_badges : ON DELETE CASCADE
  if (badge.image_url) await sb.storage.from('hg-assets').remove([`badges/${badge.code}.png`]).catch(() => {});
  return true;
}
