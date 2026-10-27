// ===== Humane Gang : en-tête de détail (zone principale, au-dessus du fil) =====
// renderDetailHeader(el, { member?, title, subtitle?, status?, onStatus?, primary?, actions? }) → { destroy() }
//   member   : { pseudo, color, avatar_url } (avatar à gauche du titre)
//   status   : { value, options: [{ id, label, tone }], label? } : sélecteur de statut à droite ; onStatus(id)
//   primary  : { label, onClick, icon? (défaut : coche), disabled? } : bouton principal, ex. « Résoudre »
//   actions  : [{ label, onClick, icon? }] boutons secondaires, avant le principal
// Utilisé par les détails de l'assistance, des idées et du journal. Dépend de ui/common.js.
import { esc, avatarHtml } from '../../core/util.js';
import { statusSelect, bindStatus, ICON } from './common.js';

// Identifiant unique par en-tête (pour relier le libellé au sélecteur).
let seq = 0;

/**
 * Affiche l'en-tête de détail dans `el` (remplace son contenu) et branche ses boutons.
 * @returns {{destroy: () => void}} destroy retire les écouteurs et vide l'en-tête.
 */
export function renderDetailHeader(el, { member, title = '', subtitle = '', status, onStatus, primary, actions = [] } = {}) {
  const uid = `ui-dh-${++seq}`;
  el.classList.add('ui-dhead');
  el.innerHTML = `
    ${member ? `<div class="ui-dhead-av">${avatarHtml(member, 42)}</div>` : ''}
    <div class="ui-dhead-txt">
      <h2 class="ui-dhead-t">${esc(title)}</h2>
      ${subtitle ? `<p class="ui-dhead-s">${esc(subtitle)}</p>` : ''}
    </div>
    <div class="ui-sp"></div>
    <div class="ui-dhead-actions">
      ${status ? statusSelect({ id: `${uid}-st`, value: status.value, options: status.options, label: status.label || 'Statut', disabled: !onStatus }) : ''}
      ${actions.map((a, i) => `<button type="button" class="ui-btn" data-act="${i}">${esc(a.label)}</button>`).join('')}
      ${primary ? `<button type="button" class="ui-btn ui-btn-primary" data-primary="1"${primary.disabled ? ' disabled' : ''}>${primary.icon === false ? '' : ICON.check()}<span>${esc(primary.label)}</span></button>` : ''}
    </div>`;

  bindStatus(el.querySelector('select'), status?.options || [], onStatus);

  // Délégation : un seul écouteur sur l'en-tête, qui retrouve le bouton cliqué par ses attributs.
  const onClick = (e) => {
    const p = e.target.closest('[data-primary]');
    if (p && primary?.onClick) return primary.onClick();
    const b = e.target.closest('[data-act]');
    if (b) actions[Number(b.dataset.act)]?.onClick?.();
  };
  el.addEventListener('click', onClick);

  return {
    /** Retire l'écouteur et vide l'en-tête (avant de le réafficher pour un autre élément). */
    destroy() {
      el.removeEventListener('click', onClick);
      el.innerHTML = '';
      el.classList.remove('ui-dhead');
    },
  };
}
