// ===== Humane Gang — administration : création / modification / suppression des badges =====
// Les 15 badges d'origine sont attribués automatiquement par la base. Ils sont modifiables et supprimables (un badge supprimé n'est plus jamais attribué).
// Les badges créés ici s'attribuent à la main (section Badges ou fiche du membre).
import { sb, toast, errMsg, esc, $, fmtDate } from './core.js';
import { METRICS, roman, sortedLevels } from './badge-levels.js';
import { prepareImage, otherVariants } from './image-compress.js';
import { confirmBox } from './ui-confirm.js';
import { openDrawer } from './admin/ui/drawer.js';

export const AUTO_BADGES = new Set([
  'premier_noel', 'veteran', 'lutin_express', 'sur_le_fil', 'liste_parfaite', 'toujours_la', 'organisateur', 'globe_trotter',
  'paparazzi', 'boite_a_idees', 'fondateur', 'anciennete', 'fidele', 'chasseur_bugs', 'saisonnier', 'cupidon',
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
async function uploadBadgeImage(code, file, level = null) {
  if (!file.type.startsWith('image/')) throw new Error('Choisis une image (PNG, JPG, WebP ou SVG).');
  if (file.size > 10 * 1024 * 1024) throw new Error('Image trop lourde (10 Mo maximum).');
  const base = level ? `badges/${code}-n${level}` : `badges/${code}`;
  const img = await prepareImage(file);
  const path = `${base}.${img.ext}`;
  check(await sb.storage.from('hg-assets').upload(path, img.blob, { upsert: true, contentType: img.contentType, cacheControl: '300' }));
  sb.storage.from('hg-assets').remove(otherVariants(base, img.ext)).catch(() => {});
  const { data } = sb.storage.from('hg-assets').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

const BADGE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/></svg>';

/**
 * Ouvre le formulaire dans le tiroir (création si badge = null). badges = liste actuelle (codes pris, ordre par défaut).
 * onSaved(row) après enregistrement.
 */
export function openBadgeEditor({ badge = null, badges = [], preset = null, onSaved = async () => {} } = {}) {
  const isNew = !badge;
  const src = badge ?? preset ?? {}; // valeurs de départ (preset : création depuis un événement)
  const taken = new Set(badges.map((b) => b.code));
  const nextSort = Math.max(0, ...badges.map((b) => Number(b.sort) || 0)) + 10;
  const auto = !isNew && isAutoBadge(badge.code);
  const note = auto ? 'Badge automatique : la base l\'attribue toute seule. Tu peux changer son nom, sa description, son image, son ordre et lui ajouter des niveaux.'
    : isNew && preset?.event_id ? 'Badge lié à l\'événement : sans niveaux, il est gagné à la première image attrapée ; à niveaux, il monte avec le nombre d\'images attrapées.'
      : isNew ? 'Un badge créé ici s\'attribue à la main (section Badges ou fiche d\'un membre), sauf s\'il est à niveaux.' : '';
  let previewUrl = null;
  let lv = null;
  const d = openDrawer({
    title: isNew ? (preset?.title ? preset.title : 'Nouveau badge') : `Modifier « ${badge.name} »`,
    subtitle: note,
    body: `
      <p class="form-error" role="alert" hidden></p>
      <div class="field"><label for="bdg-name">Nom</label><input id="bdg-name" name="name" required maxlength="60" autocomplete="off" value="${esc(src.name ?? '')}"></div>
      <div class="field"><label for="bdg-code">Code ${isNew ? '<span class="muted small">(généré depuis le nom, modifiable)</span>' : '<span class="muted small">(non modifiable)</span>'}</label>
        <input id="bdg-code" name="code" ${isNew ? 'required' : 'readonly'} maxlength="40" pattern="[a-z0-9_]{2,40}" autocomplete="off" spellcheck="false" class="code" value="${esc(badge?.code ?? (preset?.name ? uniqueCode(preset.name, taken) : ''))}" aria-describedby="bdg-code-help">
        <span class="small muted" id="bdg-code-help">Minuscules, chiffres et « _ » uniquement. Sert aussi de nom d'image (badges/&lt;code&gt;.webp).</span></div>
      <div class="field"><label for="bdg-desc">Description</label><textarea id="bdg-desc" name="description" rows="2" maxlength="200" required>${esc(src.description ?? '')}</textarea></div>
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
      ${levelsFieldsetHtml(src)}`,
    submitLabel: isNew ? 'Créer le badge' : 'Enregistrer',
    onSubmit: (form) => save(form),
    onClose: () => { if (previewUrl) URL.revokeObjectURL(previewUrl); lv?.dispose(); },
    wide: true,
  });
  const { form, body } = d;
  const err = $('.form-error', body);
  const showErr = (m) => { err.textContent = m; err.hidden = !m; if (m) err.scrollIntoView({ block: 'nearest' }); };
  let codeTouched = false;
  if (isNew) {
    form.elements.code.addEventListener('input', () => { codeTouched = true; });
    form.elements.name.addEventListener('input', () => { if (!codeTouched) form.elements.code.value = form.elements.name.value.trim() ? uniqueCode(form.elements.name.value, taken) : ''; });
  }
  form.elements.file.addEventListener('change', () => {
    const f = form.elements.file.files?.[0];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = f ? URL.createObjectURL(f) : null;
    $('#bdg-preview', body).innerHTML = previewUrl ? `<img src="${previewUrl}" alt="">` : (badge?.image_url ? `<img src="${esc(badge.image_url)}" alt="">` : BADGE_SVG);
  });
  lv = bindLevels(body, form, src);

  /** Enregistrement : true (le tiroir se ferme) ou false (erreur affichée, le tiroir reste ouvert). */
  async function save(formEl) {
    showErr('');
    const name = formEl.elements.name.value.trim(), description = formEl.elements.description.value.trim();
    const code = isNew ? formEl.elements.code.value.trim().toLowerCase() : badge.code;
    const sort = Number.parseInt(formEl.elements.sort.value, 10);
    if (name.length < 2) { showErr('Le nom doit faire au moins 2 caractères.'); return false; }
    if (!description) { showErr('Ajoute une courte description (comment on l\'obtient).'); return false; }
    if (isNew && !CODE_RE.test(code)) { showErr('Code invalide : 2 à 40 caractères, minuscules, chiffres et « _ ».'); return false; }
    if (isNew && taken.has(code)) { showErr(`Le code « ${code} » est déjà utilisé par un autre badge.`); return false; }
    if (!Number.isFinite(sort)) { showErr('L\'ordre doit être un nombre entier.'); return false; }
    const lvErr = lv.validate();
    if (lvErr) { showErr(lvErr); return false; }
    const lvPatch = lv.patch();
    const file = formEl.elements.file.files?.[0] ?? null;
    try {
      let row;
      if (isNew) {
        row = check(await sb.from('hg_badges').insert({ code, name, description, sort, image_url: null, ...lvPatch }).select().single());
        if (file || lv.hasFiles()) {
          try {
            const patch = {};
            if (file) patch.image_url = await uploadBadgeImage(code, file);
            if (lv.hasFiles()) patch.levels = await lv.uploadFiles(code, lvPatch.levels);
            row = check(await sb.from('hg_badges').update(patch).eq('code', code).select().single());
          } catch (e) { toast(`Badge créé, mais une image n'a pas pu être envoyée : ${errMsg(e)}`, 'error'); }
        }
      } else {
        const patch = { name, description, sort, ...lvPatch };
        if (file) patch.image_url = await uploadBadgeImage(code, file);
        if (lv.hasFiles()) patch.levels = await lv.uploadFiles(code, lvPatch.levels);
        row = check(await sb.from('hg_badges').update(patch).eq('code', code).select().single());
      }
      toast(isNew ? `Badge « ${name} » créé` : 'Badge enregistré', 'ok');
      await onSaved(row);
      return true;
    } catch (e) {
      const m = errMsg(e);
      showErr(/duplicate key|23505/i.test(m) || e?.code === '23505' ? `Le code « ${code} » est déjà utilisé.` : m);
      return false;
    }
  }
  form.elements.name.focus();
}

/** Supprime un badge (y compris un badge automatique d'origine). Renvoie true si supprimé. */
export async function deleteBadge(badge, holderCount = 0) {
  const autoNote = isAutoBadge(badge.code) ? ' C\'est un badge automatique d\'origine : il ne sera plus attribué.' : '';
  const ok = await confirmBox(`Supprimer le badge « ${badge.name} » ?`,
    (holderCount ? `${holderCount} membre${holderCount > 1 ? 's le perdront' : ' le perdra'}. Cette action est définitive.` : 'Personne ne l\'a encore. Cette action est définitive.') + autoNote,
    { ok: 'Supprimer', danger: true });
  if (!ok) return false;
  check(await sb.from('hg_badges').delete().eq('code', badge.code)); // hg_user_badges : ON DELETE CASCADE
  if (badge.image_url) await sb.storage.from('hg-assets').remove(otherVariants(`badges/${badge.code}`, '')).catch(() => {});
  return true;
}

/* =========================================================
   Badges à niveaux (levels_enabled, metric, levels, event_id)
   ========================================================= */
const LV_UNIT = { anciennete_annees: 'années dans le gang', event_captures: 'images attrapées', events_dynamiques: 'événements avec au moins une capture' };
const DEFAULT_LEVELS = (metric) => (metric === 'anciennete_annees'
  ? [[1, 'Bronze'], [3, 'Argent'], [5, 'Or']]
  : [[1, 'Bronze'], [5, 'Argent'], [10, 'Or']]).map(([threshold, name]) => ({ threshold, name, image_url: null }));

function levelsFieldsetHtml(src) {
  const on = !!src.levels_enabled;
  const metric = src.metric || '';
  return `
    <fieldset class="bdg-levels">
      <legend class="visually-hidden">Niveaux</legend>
      <label class="switch">
        <input type="checkbox" name="levels_enabled"${on ? ' checked' : ''} aria-describedby="bdg-lv-help">
        <span class="switch-ui" aria-hidden="true"></span><span><strong>Badge à niveaux</strong></span>
      </label>
      <p class="small muted" id="bdg-lv-help">Le badge monte de niveau selon un compteur (ex. « Fidèle » : 1, 3, 5 ans dans le gang).</p>
      <div class="bdg-lv-body"${on ? '' : ' hidden'}>
        <div class="grid-2">
          <div class="field"><label for="bdg-metric">Compteur</label>
            <select id="bdg-metric" name="metric">
              <option value="">Choisir…</option>
              ${METRICS.map(([k, l]) => `<option value="${k}"${k === metric ? ' selected' : ''}>${esc(l)}</option>`).join('')}
            </select></div>
          <div class="field" data-lv-event${metric === 'event_captures' ? '' : ' hidden'}><label for="bdg-event">Événement</label>
            <select id="bdg-event" name="event_id"><option value="">Tous les événements</option>
              ${src.event_id ? `<option value="${esc(src.event_id)}" selected>Événement lié</option>` : ''}</select></div>
        </div>
        <p class="small muted lv-unit"></p>
        <div class="lv-head" aria-hidden="true"><span>Niveau</span><span>Seuil</span><span>Nom (facultatif)</span><span>Image (facultative)</span><span></span></div>
        <ol class="lv-list" aria-label="Niveaux du badge"></ol>
        <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-lv-add>+ Ajouter un niveau</button></div>
        <p class="small muted lv-note">Seuils strictement croissants. Les niveaux sont recalculés par la base : toutes les heures, à chaque visite d'un membre et après chaque image attrapée. Un niveau atteint n'est jamais retiré. Sans image de niveau, c'est l'image du badge qui s'affiche.</p>
      </div>
    </fieldset>`;
}

/** Branche l'éditeur de niveaux. Renvoie { validate, patch, hasFiles, uploadFiles, dispose }. */
function bindLevels(dlg, form, src) {
  const box = $('.bdg-levels', dlg);
  const body = $('.bdg-lv-body', box);
  const list = $('.lv-list', box);
  const sw = form.elements.levels_enabled, metricSel = form.elements.metric, eventSel = form.elements.event_id;
  let rows = sortedLevels(src).map((l) => ({ threshold: l.threshold, name: l.name || '', image_url: l.image_url || null, file: null, preview: null }));
  const urls = new Set();
  const BADGE_SVG_SM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/></svg>';

  const render = () => {
    $('.lv-unit', box).textContent = metricSel.value
      ? `Seuil = nombre de ${LV_UNIT[metricSel.value] || (METRICS.find(([k]) => k === metricSel.value)?.[3] ?? '')} à atteindre pour chaque niveau.` : '';
    list.innerHTML = rows.map((r, i) => `
      <li class="lv-row" data-i="${i}">
        <span class="lv-num" aria-hidden="true"><span class="lvl-pip is-on">${roman(i + 1)}</span></span>
        <div class="field"><label class="visually-hidden" for="lv-t-${i}">Seuil du niveau ${i + 1}</label>
          <input id="lv-t-${i}" type="number" min="0" step="1" inputmode="numeric" data-lv="threshold" value="${esc(r.threshold ?? '')}"></div>
        <div class="field"><label class="visually-hidden" for="lv-n-${i}">Nom du niveau ${i + 1}</label>
          <input id="lv-n-${i}" type="text" maxlength="30" data-lv="name" placeholder="ex. ${esc(['Bronze', 'Argent', 'Or', 'Platine', 'Diamant'][i] || 'Légende')}" value="${esc(r.name)}"></div>
        <div class="lv-img">
          <span class="badge-img lv-thumb">${r.preview || r.image_url ? `<img src="${esc(r.preview || r.image_url)}" alt="">` : BADGE_SVG_SM}</span>
          <label class="btn btn-ghost btn-sm lv-file">Choisir<input type="file" accept="image/png,image/webp,image/jpeg,image/svg+xml" data-lv="file" class="visually-hidden" aria-label="Image du niveau ${i + 1}"></label>
          ${r.preview || r.image_url ? `<button class="btn btn-ghost btn-sm btn-icon" type="button" data-lv-noimg aria-label="Retirer l'image du niveau ${i + 1}" title="Retirer l'image">×</button>` : ''}
        </div>
        <button class="btn btn-danger btn-sm btn-icon" type="button" data-lv-del aria-label="Supprimer le niveau ${i + 1}" title="Supprimer"${rows.length < 2 ? ' disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>
      </li>`).join('');
  };
  const sync = () => {
    body.hidden = !sw.checked;
    $('[data-lv-event]', box).hidden = metricSel.value !== 'event_captures';
    if (sw.checked && !rows.length) rows = DEFAULT_LEVELS(metricSel.value);
    render();
  };
  sw.addEventListener('change', sync);
  metricSel.addEventListener('change', sync);
  list.addEventListener('input', (e) => {
    const li = e.target.closest('.lv-row'); if (!li) return;
    const r = rows[Number(li.dataset.i)], k = e.target.dataset.lv;
    if (k === 'threshold') r.threshold = e.target.value === '' ? '' : Number(e.target.value);
    if (k === 'name') r.name = e.target.value;
  });
  list.addEventListener('change', (e) => {
    if (e.target.dataset.lv !== 'file') return;
    const r = rows[Number(e.target.closest('.lv-row').dataset.i)], f = e.target.files?.[0];
    if (!f) return;
    if (r.preview) URL.revokeObjectURL(r.preview);
    r.file = f; r.preview = URL.createObjectURL(f); urls.add(r.preview);
    render();
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-lv-add')) {
      const last = rows[rows.length - 1];
      rows.push({ threshold: last && Number.isFinite(Number(last.threshold)) ? Number(last.threshold) + (Number(last.threshold) >= 10 ? 10 : 5) : 1, name: '', image_url: null, file: null, preview: null });
      render();
      $(`#lv-t-${rows.length - 1}`, box)?.focus();
    }
    const li = b.closest('.lv-row'); if (!li) return;
    const i = Number(li.dataset.i);
    if (b.hasAttribute('data-lv-del') && rows.length > 1) { rows.splice(i, 1); render(); $('[data-lv-add]', box).focus(); }
    if (b.hasAttribute('data-lv-noimg')) { Object.assign(rows[i], { file: null, preview: null, image_url: null }); render(); }
  });
  // Liste des événements (pour le compteur « Images attrapées »)
  sb.from('hg_dyn_events').select('id, name, starts_at').order('starts_at', { ascending: false }).then(({ data, error }) => {
    if (error || !Array.isArray(data)) return;
    const cur = eventSel.value || src.event_id || '';
    eventSel.innerHTML = '<option value="">Tous les événements</option>' + data.map((ev) =>
      `<option value="${esc(ev.id)}"${ev.id === cur ? ' selected' : ''}>${esc(ev.name)} (${esc(fmtDate(ev.starts_at))})</option>`).join('');
  }, () => {});
  sync();

  return {
    validate() {
      if (!sw.checked) return '';
      if (!metricSel.value) return 'Choisis le compteur qui fait monter le badge de niveau.';
      if (!rows.length) return 'Ajoute au moins un niveau.';
      let prev = -Infinity;
      for (const [i, r] of rows.entries()) {
        const t = Number(r.threshold);
        if (r.threshold === '' || !Number.isInteger(t) || t < 0) return `Niveau ${roman(i + 1)} : le seuil doit être un nombre entier positif.`;
        if (t <= prev) return `Niveau ${roman(i + 1)} : le seuil doit être plus grand que celui du niveau précédent (${prev}).`;
        prev = t;
      }
      return '';
    },
    patch() {
      const enabled = sw.checked;
      return {
        levels_enabled: enabled,
        metric: enabled ? metricSel.value || null : (src.metric ?? null),
        event_id: enabled ? (metricSel.value === 'event_captures' ? eventSel.value || null : null) : (src.event_id ?? null),
        levels: enabled ? rows.map((r, i) => ({ level: i + 1, threshold: Number(r.threshold), ...(r.name.trim() ? { name: r.name.trim().slice(0, 30) } : {}), ...(r.image_url ? { image_url: r.image_url } : {}) }))
          : (Array.isArray(src.levels) ? src.levels : []),
      };
    },
    hasFiles: () => sw.checked && rows.some((r) => r.file),
    async uploadFiles(code, levels) {
      const out = levels.map((l) => ({ ...l }));
      for (const [i, r] of rows.entries()) if (r.file) out[i].image_url = await uploadBadgeImage(code, r.file, i + 1);
      return out;
    },
    dispose() { urls.forEach((u) => URL.revokeObjectURL(u)); },
  };
}
