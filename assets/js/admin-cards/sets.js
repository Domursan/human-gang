// Cartes admin : séries (liste, création et modification, activation, suppression).
import { sb, toast, esc, $ } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { toZurichInput, fromZurichInput } from '../admin-events.js';
import { ICON } from './constants.js';
import { C } from './state.js';
import { check, act, dialog, dlgHead, friendly, group, nf, nextSetSort, period, setState, removeImages } from './helpers.js';
import { refresh } from './data.js';

/* =========================================================
   Séries
   ========================================================= */
export function setsPanel() {
  const counts = group(C.cards, (k) => k.set_id);
  return `<div class="acd-head">
      <p class="small muted">Une série regroupe des cartes. Supprimer une série supprime aussi toutes ses cartes et les exemplaires qu'en ont les membres.</p>
      <button class="btn btn-primary" type="button" data-act="set-new">${ICON.plus} Nouvelle série</button>
    </div>
    ${C.sets.length ? `<ul class="acd-list">${C.sets.map((s) => {
      const n = (counts.get(s.id) || []).length;
      const [cls, label] = setState(s);
      return `<li class="acd-item">
        <div class="acd-item-main">
          <p><strong>${esc(s.name)}</strong> <code class="acd-code">${esc(s.code)}</code> <span class="pill ${cls}">${esc(label)}</span></p>
          <p class="small muted">${nf(n)} carte${n > 1 ? 's' : ''} · ${esc(period(s))} · ordre ${esc(s.sort)}</p>
          ${s.description ? `<p class="small">${esc(s.description)}</p>` : ''}
          ${s.active ? '' : '<p class="acd-note" role="note"><strong>Inactive :</strong> ses cartes ne sortent pas dans les boosters et les membres ne la voient pas.</p>'}
        </div>
        <div class="btn-row acd-set-actions">
          <button class="btn ${s.active ? 'btn-ghost' : 'btn-primary'} acd-set-toggle" type="button" data-act="set-toggle" data-id="${esc(s.id)}" aria-pressed="${s.active ? 'true' : 'false'}">${s.active ? `${ICON.off} Désactiver la série` : `${ICON.on} Activer la série`}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-act="set-edit" data-id="${esc(s.id)}">${ICON.edit} Modifier</button>
          <button class="btn btn-danger btn-sm" type="button" data-act="set-del" data-id="${esc(s.id)}">${ICON.trash} Supprimer</button>
        </div>
      </li>`;
    }).join('')}</ul>` : '<div class="empty">Aucune série pour l\'instant. Crée la première pour y ajouter des cartes.</div>'}`;
}

export function openSetDialog(s = null) {
  const d = dialog();
  const isNew = !s;
  const v = s || {};
  d.innerHTML = `
    <form class="stack acd-form" id="acd-set-form" novalidate>
      ${dlgHead(isNew ? 'Nouvelle série' : `Modifier « ${s.name} »`)}
      <p class="form-error" role="alert" hidden></p>
      <div class="acd-grid-2">
        <div class="field"><label for="acs-code">Code unique</label>
          <input id="acs-code" name="code" required maxlength="32" autocomplete="off" placeholder="ex. hiver-2026" value="${esc(v.code ?? '')}">
          <span class="small muted">Lettres minuscules, chiffres et tirets.</span></div>
        <div class="field"><label for="acs-name">Nom</label><input id="acs-name" name="name" required maxlength="60" autocomplete="off" value="${esc(v.name ?? '')}"></div>
      </div>
      <div class="field"><label for="acs-desc">Description</label><textarea id="acs-desc" name="description" rows="2" maxlength="300">${esc(v.description ?? '')}</textarea></div>
      <fieldset class="acd-fs"><legend>Disponibilité <span class="muted small">(heure suisse, facultatif)</span></legend>
        <div class="acd-grid-2">
          <div class="field"><label for="acs-start">Début</label><input id="acs-start" name="starts_at" type="datetime-local" value="${esc(toZurichInput(v.starts_at))}"></div>
          <div class="field"><label for="acs-end">Fin</label><input id="acs-end" name="ends_at" type="datetime-local" value="${esc(toZurichInput(v.ends_at))}"></div>
        </div>
        <p class="small muted">Sans dates, la série est toujours disponible. Hors période, ses cartes ne sortent plus dans les boosters.</p>
      </fieldset>
      <div class="acd-grid-2">
        <div class="field"><label for="acs-sort">Ordre d'affichage</label><input id="acs-sort" name="sort" type="number" step="1" value="${esc(v.sort ?? nextSetSort())}"></div>
        <label class="switch"><input type="checkbox" name="active"${(v.active ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Série active</span></label>
      </div>
      <div class="btn-row dialog-actions">
        <button class="btn btn-ghost" type="button" data-acd-close>Annuler</button>
        <button class="btn btn-primary" type="submit">${isNew ? 'Créer la série' : 'Enregistrer'}</button>
      </div>
    </form>`;
  d.showModal();
  const form = $('#acd-set-form', d);
  form.elements.code.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const err = $('.form-error', form);
    const showErr = (m) => { err.textContent = m; err.hidden = !m; };
    showErr('');
    const E = form.elements;
    const row = {
      code: E.code.value.trim().toLowerCase(), name: E.name.value.trim(), description: E.description.value.trim() || null,
      starts_at: fromZurichInput(E.starts_at.value), ends_at: fromZurichInput(E.ends_at.value),
      sort: Math.round(Number(E.sort.value) || 0), active: E.active.checked,
    };
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(row.code)) return showErr('Le code doit faire 2 à 32 caractères : lettres minuscules, chiffres et tirets.');
    if (row.name.length < 2) return showErr('Donne un nom à la série (2 caractères minimum).');
    if (row.starts_at && row.ends_at && new Date(row.ends_at) <= new Date(row.starts_at)) return showErr('La fin doit être après le début.');
    if (btn) btn.disabled = true;
    try {
      if (isNew) check(await sb.from('hg_card_sets').insert(row));
      else check(await sb.from('hg_card_sets').update(row).eq('id', s.id));
      d.close();
      toast(isNew ? `Série « ${row.name} » créée` : 'Série enregistrée', 'ok');
      await refresh();
    } catch (err2) {
      showErr(friendly(err2, { 23505: 'Ce code de série existe déjà.' }));
    } finally { if (btn?.isConnected) btn.disabled = false; }
  });
}

/** Active ou désactive une série (réversible : pas de confirmation). */
export async function toggleSet(btn, id) {
  const s = C.setById.get(id);
  if (!s) return;
  await act(btn, async () => {
    check(await sb.from('hg_card_sets').update({ active: !s.active }).eq('id', id));
    toast(s.active ? `Série « ${s.name} » désactivée` : `Série « ${s.name} » activée`, 'ok');
    await refresh();
  });
}

export async function deleteSet(id) {
  const s = C.setById.get(id);
  if (!s) return;
  const cards = C.cards.filter((k) => k.set_id === id);
  const copies = cards.reduce((n, k) => n + (C.copiesByCard.get(k.id)?.length || 0), 0);
  const ok = await confirmBox(`Supprimer la série « ${s.name} » ?`,
    `Ses ${nf(cards.length)} carte${cards.length > 1 ? 's' : ''} seront supprimées définitivement, ainsi que ${nf(copies)} exemplaire${copies > 1 ? 's' : ''} chez les membres. Les échanges concernés restent visibles sans ces cartes. Action définitive.`,
    { ok: 'Supprimer', danger: true });
  if (!ok) return;
  check(await sb.from('hg_card_sets').delete().eq('id', id));
  await removeImages(cards.map((k) => k.image_url));
  toast('Série supprimée', 'ok');
  await refresh();
}
