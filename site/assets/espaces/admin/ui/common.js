// ===== Humane Gang : petits éléments partagés par les composants admin/ui =====
// fold(texte) : minuscules sans accents, pour la recherche.
// pill(statut) : pastille colorée { id, label, tone } ; tone : open | prog | done | muted.
// statusSelect({ id, value, options, label }) : sélecteur de statut natif stylé ; bindStatus(select, onStatus) le branche.
// Utilisé par ui/list.js, ui/detail-header.js, ui/info-panel.js et les sections (support, idées).
import { svg } from '../../../commun/icons.js';
import { esc } from '../../../commun/core/util.js';
import { toast } from '../../../commun/core/ui.js';

/** Texte replié pour la recherche : sans accents (signes diacritiques retirés), en minuscules. */
export function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Ton (couleur) de la valeur `value` dans la liste d'options ; « muted » si elle n'y figure pas. */
export function toneOf(options, value) {
  return options?.find((o) => o.id === value)?.tone || 'muted';
}

/** Pastille HTML d'un statut { id, label, tone }. Chaîne vide si le statut est absent. */
export function pill(status) {
  if (!status) return '';
  return `<span class="ui-pill" data-tone="${esc(status.tone || 'muted')}">${esc(status.label)}</span>`;
}

/**
 * Sélecteur de statut : <select> natif (clavier et lecteurs d'écran OK), teinté selon le statut courant.
 * Renvoie du HTML ; le sélecteur est branché ensuite par bindStatus.
 */
export function statusSelect({ id, value, options = [], label = 'Statut', className = 'ui-status', disabled = false }) {
  const opts = options.map((o) => `<option value="${esc(o.id)}"${o.id === value ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  return `<select id="${esc(id)}" class="${className}" data-tone="${esc(toneOf(options, value))}" aria-label="${esc(label)}"${disabled ? ' disabled' : ''}>${opts}</select>`;
}

/** Branche un sélecteur de statut : onStatus(valeur) peut renvoyer une promesse ; en cas d'échec, retour à la valeur précédente. */
export function bindStatus(select, options, onStatus) {
  if (!select) return;
  let last = select.value;
  select.addEventListener('change', async () => {
    const next = select.value;
    select.dataset.tone = toneOf(options, next);
    if (!onStatus) return;
    select.disabled = true;
    try {
      await onStatus(next);
      last = next;
    } catch (err) {
      select.value = last;
      select.dataset.tone = toneOf(options, last);
      toast(err?.message || 'Statut non enregistré', 'error');
    } finally {
      select.disabled = false;
    }
  });
}

/** Icônes des composants ui/ : des fonctions, car chaque rendu crée un SVG neuf. */
export const ICON = {
  check: () => svg('check', { stroke: 2.2 }),
  send: () => svg('arrow'),
  next: () => svg('next', { stroke: 1.75 }),
  note: () => svg('edit', { stroke: 1.75 }),
};
