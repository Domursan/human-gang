// =====================================================================
// Comptes admin : bloc « Informations transmises aux Santas » des formulaires d'édition du Secret Santa.
// Un membre choisit quelles informations de son profil sont visibles par son Santa.
// Dépendances : core.js ($, $$, esc), profile-fields.js (INFO_GROUPS, INFO_FIELDS).
// Exporte : sharedFieldsHtml (bloc HTML des cases), readSharedFields (lit les cases cochées),
// bindSharedFields (branche les boutons « tout cocher » une seule fois).
// =====================================================================
import { $, $$, esc } from '../../../commun/core.js';
import { INFO_GROUPS, INFO_FIELDS } from '../../compte/profile-fields.js';

/* =========================================================
   Secret Santa (section de l'admin) : champs transmis + attributions
   ========================================================= */
/**
 * Bloc de cases « Informations transmises aux Santas » pour un formulaire d'édition.
 * Le bloc est replié si rien n'est coché, pour ne pas encombrer le formulaire.
 * @param {string} prefix préfixe unique des identifiants HTML (évite les doublons à l'écran).
 * @param {string[]} [selected=[]] identifiants déjà cochés.
 * @returns {string} HTML du bloc.
 */
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
/**
 * Clés cochées dans un formulaire, dans l'ordre de INFO_FIELDS.
 * @param {HTMLFormElement} form formulaire qui contient les cases.
 * @returns {string[]} identifiants des champs cochés.
 */
export function readSharedFields(form) {
  const on = new Set($$('input[name="shared_fields"]:checked', form).map((i) => i.value));
  return INFO_FIELDS.map((f) => f.id).filter((k) => on.has(k));
}
/** Met à jour le compteur « n / total » affiché dans le bloc. */
function updateSfCount(box) {
  const c = box?.querySelector('[data-sf-count]');
  if (c) c.textContent = `${$$('input[name="shared_fields"]:checked', box).length} / ${INFO_FIELDS.length}`;
}
// Vrai une fois les gestionnaires branchés : on ne les pose qu'une seule fois sur la page.
let sfBound = false;
/**
 * Branche les boutons « Tout cocher / Tout décocher » et le compteur.
 * Posé sur document.body (et non sur #secret-santa) parce que le bloc peut aussi vivre dans le tiroir.
 */
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
