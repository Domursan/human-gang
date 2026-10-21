// Cartes admin : fiche de création et de modification d'une carte, suppression, cartes Identité.
import { sb, toast, esc, $ } from '../core.js';
import { openDrawer } from '../admin/ui/drawer.js';
import { RARITIES, FAMILIES, cardHtml } from '../cartes-ui.js';
import { confirmBox } from '../ui-confirm.js';
import { C } from './state.js';
import { refresh } from './data.js';
import { check, act, friendly, nf, nextFreeNumber, identSetId, maxSerialOf, removeImages, uploadCardImage } from './helpers.js';

export function openCardDialog(k = null) {
  const isNew = !k;
  const setDefault = k?.set_id || C.f.set || identSetId() || C.sets[0]?.id || '';
  const used = k ? maxSerialOf(k.id) : 0;
  let previewUrl = null;
  const dr = openDrawer({
    title: isNew ? 'Nouvelle carte' : `Modifier « ${k.name} »`,
    submitLabel: isNew ? 'Créer la carte' : 'Enregistrer',
    wide: true,
    onClose: () => { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; },
    onSubmit: (form) => saveCard(form),
    body: `<div class="stack acd-form" id="acd-card-form">
      <p class="form-error" role="alert" hidden></p>
      <div class="acd-dlg-grid">
        <div class="stack">
          <div class="acd-grid-2">
            <div class="field"><label for="acc-set">Série</label>
              <select id="acc-set" name="set_id" required>${C.sets.map((s) => `<option value="${esc(s.id)}"${s.id === setDefault ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="acc-number">Numéro</label>
              <input id="acc-number" name="number" type="number" min="1" step="1" inputmode="numeric" required value="${esc(k ? k.number : nextFreeNumber(setDefault))}">
              <span class="small muted">Le plus petit numéro libre de la série.</span></div>
          </div>
          <div class="field"><label for="acc-name">Nom</label><input id="acc-name" name="name" required maxlength="60" autocomplete="off" value="${esc(k?.name ?? '')}"></div>
          <div class="field"><label for="acc-caption">Légende <span class="muted small">(facultatif)</span></label>
            <input id="acc-caption" name="caption" maxlength="80" autocomplete="off" placeholder="ex. 2015 · CD Projekt Red" value="${esc(k?.caption ?? '')}" aria-describedby="acc-caption-help">
            <span class="small muted" id="acc-caption-help"><span id="acc-caption-count">${nf((k?.caption ?? '').length)}</span> / 80 caractères, affichée sous le nom.</span></div>
          <div class="acd-grid-2">
            <div class="field"><label for="acc-family">Famille</label>
              <select id="acc-family" name="family">${FAMILIES.map((x) => `<option value="${x.id}"${(k?.family ?? 'membre') === x.id ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
            <div class="field"><label for="acc-rarity">Rareté</label>
              <select id="acc-rarity" name="rarity">${RARITIES.map((r) => `<option value="${r.id}"${(k?.rarity ?? 'commune') === r.id ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select></div>
          </div>
          <fieldset class="acd-fs"><legend>Image</legend>
            <div class="field"><label for="acc-file">Téléverser une image</label>
              <input id="acc-file" name="file" type="file" accept="image/png,image/webp,image/jpeg,image/gif,image/svg+xml"></div>
            <div class="field"><label for="acc-url">Ou URL de l'image</label>
              <input id="acc-url" name="image_url" type="url" inputmode="url" placeholder="https://…" value="${esc(k?.image_url ?? '')}"></div>
            <p class="small muted">Sans image, la carte affiche le logo du gang.</p>
            <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-acc-noimg>Retirer l'image</button></div>
          </fieldset>
          <div class="field"><label for="acc-flavor">Texte d'ambiance</label>
            <textarea id="acc-flavor" name="flavor" rows="2" maxlength="280">${esc(k?.flavor ?? '')}</textarea></div>
        </div>
        <div class="stack">
          <div class="field"><span class="label" id="acc-prev-l">Aperçu</span>
            <div class="acd-card-preview" id="acc-card-preview" role="img" aria-labelledby="acc-prev-l"></div></div>
          <div class="field"><label for="acc-member">Membre lié</label>
            <select id="acc-member" name="member_id"><option value="">Aucun</option>${C.profiles.map((p) => `<option value="${esc(p.id)}"${p.id === k?.member_id ? ' selected' : ''}>${esc(p.pseudo)}${p.is_ghost ? ' (fantôme)' : ''}</option>`).join('')}</select>
            <span class="small muted">Requis pour les familles Membre et la rareté Identité.</span></div>
          <div class="field"><label for="acc-max">Exemplaires numérotés maximum</label>
            <input id="acc-max" name="max_copies" type="number" min="1" step="1" inputmode="numeric" placeholder="illimité" value="${esc(k?.max_copies ?? '')}">
            <span class="small muted">Identité : 5 à 10 conseillé. Vide = illimité.${used ? ` ${nf(used)} numéro${used > 1 ? 's' : ''} déjà distribué${used > 1 ? 's' : ''}.` : ''}</span></div>
          <fieldset class="acd-fs"><legend>Options</legend>
            <label class="switch"><input type="checkbox" name="can_shiny"${(k?.can_shiny ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Peut être brillante</span></label>
            <label class="switch"><input type="checkbox" name="tradeable"${(k?.tradeable ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Échangeable</span></label>
            <label class="switch"><input type="checkbox" name="craftable"${(k?.craftable ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Fabricable</span></label>
            <label class="switch"><input type="checkbox" name="active"${(k?.active ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Active (tirée dans les boosters)</span></label>
          </fieldset>
        </div>
      </div>
    </div>`,
  });
  const root = dr.body;
  const form = dr.form;
  const E = form.elements;

  /* La coquille ouvre le tiroir ; la logique de la carte suit, relue depuis le formulaire. */
  const readRaw = () => {
    const num = Number(E.number.value);
    const maxRaw = E.max_copies.value.trim();
    return {
      set_id: E.set_id.value, number: num, name: E.name.value.trim(), family: E.family.value, rarity: E.rarity.value,
      image_url: E.image_url.value.trim() || null, flavor: E.flavor.value.trim() || null, member_id: E.member_id.value || null,
      caption: E.caption.value.trim() || null, max_copies: maxRaw === '' ? null : Number(maxRaw),
    };
  };
  const paint = () => {
    const v = readRaw();
    $('#acc-caption-count', root).textContent = nf(E.caption.value.length);
    // Total de la série : cartes actives de la série (celle-ci comprise si elle est active), jamais sous son propre numéro.
    const activeInSet = C.cards.filter((x) => x.set_id === v.set_id && x.active && x.id !== k?.id).length + (E.active.checked ? 1 : 0);
    const setTotal = Math.max(activeInSet, Number.isInteger(v.number) ? v.number : 0);
    const member = v.member_id ? C.byId.get(v.member_id) : null;
    $('#acc-card-preview', root).innerHTML = cardHtml({
      name: v.name || 'Nom de la carte', rarity: v.rarity, family: v.family, image_url: previewUrl || v.image_url,
      flavor: v.flavor, caption: v.caption, number: Number.isInteger(v.number) && v.number > 0 ? v.number : '?',
      set_total: setTotal || undefined, set_name: C.setById.get(v.set_id)?.name, max_copies: v.max_copies,
      member_since: v.rarity === 'identite' && member ? (member.joined_on || new Date().getFullYear()) : undefined,
    }, { size: 'md' });
  };
  /** Valeurs validées du formulaire ; lève une erreur lisible sinon. */
  const validate = () => {
    const v = { ...readRaw(), can_shiny: E.can_shiny.checked, tradeable: E.tradeable.checked, craftable: E.craftable.checked, active: E.active.checked };
    if (!v.set_id) throw new Error('Choisis une série.');
    if (!Number.isInteger(v.number) || v.number < 1) throw new Error('Le numéro doit être un nombre entier, à partir de 1.');
    if (v.name.length < 2) throw new Error('Donne un nom à la carte (2 caractères minimum).');
    if (v.caption && v.caption.length > 80) throw new Error('La légende ne doit pas dépasser 80 caractères.');
    if (v.max_copies !== null && (!Number.isInteger(v.max_copies) || v.max_copies < 1)) throw new Error('Exemplaires maximum : un nombre entier à partir de 1 (ou vide pour illimité).');
    if (k && v.max_copies !== null && v.max_copies < used) throw new Error(`Des exemplaires sont déjà numérotés jusqu'au n° ${used} : le maximum ne peut pas descendre en dessous.`);
    if (v.image_url && !/^https?:\/\//.test(v.image_url)) throw new Error('L\'URL de l\'image doit commencer par https://');
    if ((v.family === 'membre' || v.rarity === 'identite') && !v.member_id) throw new Error('Une carte Membre ou Identité doit être liée à un membre.');
    return v;
  };
  /** Enregistrement : renvoie false (tiroir ouvert, erreur affichée) en cas d'échec. */
  async function saveCard() {
    const err = $('.form-error', root);
    const showErr = (m) => { err.textContent = m; err.hidden = !m; if (m) err.scrollIntoView({ block: 'nearest' }); };
    showErr('');
    try {
      const v = validate();
      const file = E.file.files?.[0] ?? null;
      const image_url = file ? await uploadCardImage(file) : v.image_url;
      const row = { ...v, image_url, flavor: v.flavor || null };
      if (isNew) check(await sb.from('hg_cards').insert(row));
      else check(await sb.from('hg_cards').update(row).eq('id', k.id));
      toast(isNew ? `Carte « ${v.name} » créée` : 'Carte enregistrée', 'ok');
      await refresh();
    } catch (err2) {
      showErr(friendly(err2, { 23505: 'Ce numéro est déjà pris dans cette série.' }));
      return false;
    }
  }

  E.file.addEventListener('change', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const f = E.file.files?.[0];
    previewUrl = f ? URL.createObjectURL(f) : null;
    paint();
  });
  $('[data-acc-noimg]', root).addEventListener('click', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; E.file.value = ''; E.image_url.value = ''; paint();
  });
  E.set_id.addEventListener('change', () => { if (isNew) E.number.value = nextFreeNumber(E.set_id.value); paint(); });
  E.rarity.addEventListener('change', () => {
    // Identité : 10 exemplaires numérotés proposés si rien n'est indiqué (modifiable)
    if (E.rarity.value === 'identite' && !E.max_copies.value.trim()) E.max_copies.value = '10';
    paint();
  });
  form.addEventListener('input', paint);
  paint();
}

/** Suppression d'une carte : refusée tant qu'elle a des exemplaires (la désactivation les garde) ;
    sinon, il faut retaper le nom exact de la carte. */
export async function deleteCard(id) {
  const k = C.cardById.get(id);
  if (!k) return;
  const n = (C.copiesByCard.get(id) || []).length;
  if (n) return refuseCardDelete(k, n);
  const typed = await typedConfirm({
    title: `Supprimer « ${k.name} » ?`,
    text: 'Action définitive. Pour confirmer, tape le nom exact de la carte.',
    expected: k.name,
  });
  if (!typed) return;
  check(await sb.from('hg_cards').delete().eq('id', id));
  await removeImages([k.image_url]);
  toast('Carte supprimée', 'ok');
  await refresh();
}
async function refuseCardDelete(k, n) {
  if (k.active === false) return toast(`Suppression impossible : ${nf(n)} exemplaire${n > 1 ? 's existent' : ' existe'} encore chez les membres.`, 'error');
  const ok = await confirmBox(`Suppression impossible pour « ${k.name} »`,
    `${nf(n)} exemplaire${n > 1 ? 's sont' : ' est'} déjà dans les collections des membres, et la suppression les effacerait. Désactive la carte à la place : elle ne sera plus tirée ni proposée aux échanges, et les exemplaires restent.`,
    { ok: 'Désactiver la carte' });
  if (!ok) return;
  check(await sb.from('hg_cards').update({ active: false }).eq('id', k.id));
  toast('Carte désactivée', 'ok');
  await refresh();
}
/** Confirmation par saisie du nom exact : le bouton reste inactif tant que le nom ne correspond pas. */
function typedConfirm({ title, text, expected, ok = 'Supprimer' }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'hg-dialog';
  dlg.setAttribute('aria-labelledby', 'acd-typed-title');
  dlg.innerHTML = `
    <form method="dialog" class="stack">
      <h2 id="acd-typed-title" class="dialog-title">${esc(title)}</h2>
      <p class="muted">${esc(text)}</p>
      <div class="field">
        <label for="acd-typed-input">Nom de la carte</label>
        <input id="acd-typed-input" class="input" type="text" autocomplete="off" spellcheck="false" aria-describedby="acd-typed-hint">
      </div>
      <p class="small muted" id="acd-typed-hint">Tape exactement : <strong>${esc(expected)}</strong></p>
      <div class="btn-row dialog-actions">
        <button class="btn btn-ghost" value="cancel" type="submit">Annuler</button>
        <button class="btn btn-danger" value="ok" type="submit" id="acd-typed-ok" disabled>${esc(ok)}</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const input = dlg.querySelector('#acd-typed-input');
  const okBtn = dlg.querySelector('#acd-typed-ok');
  input.addEventListener('input', () => { okBtn.disabled = input.value.trim() !== expected.trim(); });
  dlg.returnValue = '';
  dlg.showModal();
  input.focus();
  return new Promise((resolve) => dlg.addEventListener('close', () => {
    const yes = dlg.returnValue === 'ok' && input.value.trim() === expected.trim();
    dlg.remove();
    resolve(yes);
  }, { once: true }));
}

export async function makeIdentities(btn) {
  const setId = identSetId();
  const set = C.setById.get(setId);
  if (!set) return;
  const ident = C.cards.filter((k) => k.set_id === setId && k.rarity === 'identite');
  const missing = C.profiles.filter((p) => !ident.some((k) => k.member_id === p.id));
  if (!missing.length) return;
  const ok = await confirmBox('Créer les cartes Identité ?',
    `${nf(missing.length)} carte${missing.length > 1 ? 's' : ''} Identité seront créées dans « ${set.name} » : une par membre, nommée d'après son pseudo, avec son avatar et 10 exemplaires numérotés. Tu pourras les modifier ensuite.`,
    { ok: 'Créer' });
  if (!ok) return;
  const used = new Set(C.cards.filter((k) => k.set_id === setId).map((k) => k.number));
  const rows = missing.map((p) => {
    let num = 1;
    while (used.has(num)) num++;
    used.add(num);
    return {
      set_id: setId, number: num, name: p.pseudo, family: 'membre', rarity: 'identite', image_url: p.avatar_url || null,
      member_id: p.id, can_shiny: true, tradeable: true, craftable: true, max_copies: 10, active: true,
    };
  });
  await act(btn, async () => {
    check(await sb.from('hg_cards').insert(rows));
    toast(`${nf(rows.length)} carte${rows.length > 1 ? 's' : ''} Identité créée${rows.length > 1 ? 's' : ''}`, 'ok');
    await refresh();
  });
}
