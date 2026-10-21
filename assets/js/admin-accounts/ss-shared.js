// Comptes admin : bloc « Informations transmises aux Santas » des formulaires d'édition du Secret Santa.
import { $, $$, esc } from '../core.js';
import { INFO_GROUPS, INFO_FIELDS } from '../profile-fields.js';

/* =========================================================
   Secret Santa (section de l'admin) : champs transmis + attributions
   ========================================================= */
/** Bloc de cases « Informations transmises aux Santas » pour un formulaire d'édition. */
export function sharedFieldsHtml(prefix, selected = []) {
  const sel = new Set(selected || []);
  const total = INFO_FIELDS.length;
  return `
    <details class="sf-box"${sel.size ? '' : ' open'}>
      <summary><span class="sf-sum-title">Informations transmises aux Santas</span> <span class="pill pill-muted sf-count" data-sf-count>${sel.size} / ${total}</span></summary>
      <p class="small muted">Chaque Santa verra ces informations (si sa cible les a remplies) sous la liste de souhaits. Rien d'autre n'est partagé.</p>
      ${INFO_GROUPS.map((g) => `
        <fieldset class="sf-group" data-sf-group="${esc(g.id)}">
          <legend>${esc(g.label)}</legend>
          <div class="sf-group-actions">
            <button class="btn btn-ghost btn-sm" type="button" data-sf-all="1">Tout cocher</button>
            <button class="btn btn-ghost btn-sm" type="button" data-sf-all="0">Tout décocher</button>
          </div>
          <div class="sf-checks">${g.fields.map((f) => `
            <label class="check"><input type="checkbox" name="shared_fields" value="${esc(f.id)}" id="${esc(prefix)}-sf-${esc(f.id)}"${sel.has(f.id) ? ' checked' : ''}> <span>${esc(f.label)}</span></label>`).join('')}
          </div>
        </fieldset>`).join('')}
    </details>`;
}
/** Clés cochées, dans l'ordre de INFO_FIELDS. */
export function readSharedFields(form) {
  const on = new Set($$('input[name="shared_fields"]:checked', form).map((i) => i.value));
  return INFO_FIELDS.map((f) => f.id).filter((k) => on.has(k));
}
function updateSfCount(box) {
  const c = box?.querySelector('[data-sf-count]');
  if (c) c.textContent = `${$$('input[name="shared_fields"]:checked', box).length} / ${INFO_FIELDS.length}`;
}
let sfBound = false;
export function bindSharedFields() {
  // Le document entier : les cases et le bloc des attributions vivent aussi dans le tiroir (hors de #secret-santa)
  const sec = document.body; if (sfBound) return;
  sfBound = true;
  sec.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-sf-all]');
    if (b) {
      const on = b.dataset.sfAll === '1';
      $$('input[name="shared_fields"]', b.closest('fieldset')).forEach((i) => { i.checked = on; });
      updateSfCount(b.closest('.sf-box'));
      return;
    }
  });
  sec.addEventListener('change', (ev) => { if (ev.target.name === 'shared_fields') updateSfCount(ev.target.closest('.sf-box')); });
}
