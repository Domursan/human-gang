// =====================================================================
// Cartes admin : séries (liste, création et modification, activation, suppression).
// Une série regroupe des cartes. Elle peut être masquée, ou limitée à une période (dates en heure suisse).
// Dépendances : core.js (sb, toast, esc, $), ui-confirm.js (confirmBox), admin-events.js (dates en heure suisse),
// constants.js (ICON), state.js (C), helpers.js, data.js (refresh), admin/ui/drawer.js, admin/list-tools.js.
// Exporte : setsListData (liste retenue par la recherche), setsPanel (onglet), openSetDialog, toggleSet, deleteSet.
// =====================================================================
import { sb, toast, esc, $ } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { toZurichInput, fromZurichInput } from '../admin-events.js';
import { ICON } from './constants.js';
import { C } from './state.js';
import { check, act, friendly, group, nf, nextSetSort, period, setState, removeImages } from './helpers.js';
import { openDrawer } from '../admin/ui/drawer.js';
import { refresh } from './data.js';
import { matches, searchHtml } from '../admin/list-tools.js';

/* =========================================================
   Séries
   ========================================================= */
/** Vignette d'une série : image de sa première carte illustrée, sinon initiales. */
function setThumb(s, cards) {
  const first = cards.filter((k) => k.image_url).sort((a, b) => a.number - b.number)[0];
  if (first) return `<img class="acd-setcard-img" src="${esc(first.image_url)}" alt="" loading="lazy">`;
  const ini = String(s.name || '?').trim().slice(0, 2).toUpperCase();
  return `<span class="acd-setcard-img acd-setcard-ph" aria-hidden="true">${esc(ini)}</span>`;
}
/** Carte d'une série dans la grille : vignette, nom, code, période, interrupteur Active / Masquée et boutons. */
function setCard(s, cards) {
  const id = esc(s.id);
  const [cls, label] = setState(s);
  // Pastille seulement pour les états de calendrier (à venir, terminée) : Active et Masquée se lisent sur l'interrupteur.
  const state = s.active && label !== 'Active' ? `<span class="pill ${cls}">${esc(label)}</span>` : '';
  return `<li class="acd-setcard${s.active ? '' : ' is-off'}">
    <div class="acd-setcard-top">
      ${setThumb(s, cards)}
      <div class="acd-setcard-txt">
        <p class="acd-setcard-name"><strong>${esc(s.name)}</strong></p>
        <p class="small muted"><code class="acd-code">${esc(s.code)}</code> · ordre ${esc(s.sort)}</p>
        <p class="small muted">${nf(cards.length)} carte${cards.length > 1 ? 's' : ''}</p>
        <p class="small muted">${esc(period(s))}</p>
        ${state}
      </div>
    </div>
    ${s.description ? `<p class="small acd-setcard-desc">${esc(s.description)}</p>` : ''}
    <div class="acd-setcard-foot">
      <button class="acd-switch" type="button" role="switch" aria-checked="${s.active ? 'true' : 'false'}" data-act="set-toggle" data-id="${id}"
        aria-label="Série « ${esc(s.name)} » ${s.active ? 'active' : 'masquée'}">
        <span class="acd-switch-track" aria-hidden="true"></span><span class="acd-switch-label">${s.active ? 'Active' : 'Masquée'}</span></button>
      <div class="btn-row acd-setcard-btns">
        <button class="btn btn-ghost btn-sm" type="button" data-act="set-edit" data-id="${id}">${ICON.edit} Modifier</button>
        <button class="btn btn-danger btn-sm btn-icon" type="button" data-act="set-del" data-id="${id}" aria-label="Supprimer ${esc(s.name)}" title="Supprimer">${ICON.trash}</button>
      </div>
    </div>
    ${s.active ? '' : `<p class="acd-note acd-setcard-note" role="note"><strong>Masquée :</strong> ses cartes ne sortent pas dans les boosters et les membres ne la voient pas.</p>`}
  </li>`;
}

/** Séries retenues par la recherche : { html, shown, total } (la grille seule, pour la mise à jour sans perte de frappe). */
export function setsListData() {
  const counts = group(C.cards, (k) => k.set_id);
  const rows = C.sets.filter((s) => matches(C.q.series, s.name, s.code, s.description));
  const html = rows.length ? `<ul class="acd-setgrid">${rows.map((s) => setCard(s, counts.get(s.id) || [])).join('')}</ul>`
    : (C.q.series.trim() ? `<div class="empty">Aucun résultat pour « ${esc(C.q.series.trim())} ».</div>`
      : '<div class="empty">Aucune série pour l\'instant. Crée la première pour y ajouter des cartes.</div>');
  return { html, shown: rows.length, total: C.sets.length };
}
/** HTML de l'onglet Séries : bouton de création, recherche et grille des séries. */
export function setsPanel() {
  return `<div class="acd-head">
      <p class="small muted">Une série regroupe des cartes. Supprimer une série supprime aussi toutes ses cartes et les exemplaires qu'en ont les membres.</p>
      <button class="btn btn-primary" type="button" data-act="set-new">${ICON.plus} Nouvelle série</button>
    </div>
    ${C.sets.length ? searchHtml({ id: 'acd-search-series', label: 'Rechercher une série', placeholder: 'Nom, code ou description…', value: C.q.series, attrs: 'data-search="series"' }) : ''}
    <div id="acd-sets-list">${setsListData().html}</div>`;
}

/** Formulaire de série, ouvert dans le tiroir. */
export function openSetDialog(s = null) {
  const isNew = !s;
  const v = s || {};
  openDrawer({
    title: isNew ? 'Nouvelle série' : `Modifier « ${s.name} »`,
    submitLabel: isNew ? 'Créer la série' : 'Enregistrer',
    body: `<div class="stack acd-form" id="acd-set-form">
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
    </div>`,
    onSubmit: async (form) => {
      const err = $('.form-error', form);
      /* Affiche le message d'erreur dans le formulaire, ou le masque si le message est vide. */
      const showErr = (m) => { err.textContent = m; err.hidden = !m; };
      showErr('');
      const E = form.elements;
      const row = {
        code: E.code.value.trim().toLowerCase(), name: E.name.value.trim(), description: E.description.value.trim() || null,
        starts_at: fromZurichInput(E.starts_at.value), ends_at: fromZurichInput(E.ends_at.value),
        sort: Math.round(Number(E.sort.value) || 0), active: E.active.checked,
      };
      if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(row.code)) return showErr('Le code doit faire 2 à 32 caractères : lettres minuscules, chiffres et tirets.'), false;
      if (row.name.length < 2) return showErr('Donne un nom à la série (2 caractères minimum).'), false;
      if (row.starts_at && row.ends_at && new Date(row.ends_at) <= new Date(row.starts_at)) return showErr('La fin doit être après le début.'), false;
      try {
        if (isNew) check(await sb.from('hg_card_sets').insert(row));
        else check(await sb.from('hg_card_sets').update(row).eq('id', s.id));
        toast(isNew ? `Série « ${row.name} » créée` : 'Série enregistrée', 'ok');
        await refresh();
      } catch (err2) {
        showErr(friendly(err2, { 23505: 'Ce code de série existe déjà.' }));
        return false;
      }
    },
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

/**
 * Supprime une série après confirmation, avec toutes ses cartes et leurs images.
 * Les échanges concernés restent visibles sans ces cartes (c'est la base qui le gère).
 * @param {string} id identifiant de la série.
 */
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
