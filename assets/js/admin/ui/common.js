// ===== Humane Gang : petits éléments partagés par les composants admin/ui =====
// fold(texte) : minuscules sans accents, pour la recherche.
// pill(statut) : pastille colorée { id, label, tone } ; tone : open | prog | done | muted.
// statusSelect({ id, value, options, label }) : sélecteur de statut natif stylé ; bindStatus(select, onStatus) le branche.
import { svg } from '../../icons.js';
import { esc } from '../../core/util.js';
import { toast } from '../../core/ui.js';

export function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function toneOf(options, value) {
  return options?.find((o) => o.id === value)?.tone || 'muted';
}

export function pill(status) {
  if (!status) return '';
  return `<span class="ui-pill" data-tone="${esc(status.tone || 'muted')}">${esc(status.label)}</span>`;
}

/** Sélecteur de statut : <select> natif (clavier et lecteurs d'écran OK), teinté selon le statut courant. */
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

export const ICON = {
  check: () => svg('check', { stroke: 2.2 }),
  send: () => svg('arrow'),
  chevron: () => svg('down', { stroke: 1.75 }),
  next: () => svg('next', { stroke: 1.75 }),
  note: () => svg('edit', { stroke: 1.75 }),
};
