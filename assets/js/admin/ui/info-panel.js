// ===== Humane Gang : panneau d'infos (colonne de droite, fiche rapide du membre) =====
// renderInfoPanel(el, { member, stats, status?, onStatus?, history?, actions? }) → { destroy() }
//   member  : { pseudo, color, avatar_url, since (Date|ISO), lastSeen (Date|ISO) }
//   stats   : [{ value, label }] affichés en grille 2×2
//   status  : { value, options: [{ id, label, tone }], label? } ; onStatus(id) à la modification
//   history : [{ id?, title, status { label, tone }, at }] (liste courte, plus récent d'abord)
//   actions : [{ label, onClick }] boutons pleine largeur en bas (ex. « Ouvrir la fiche membre »)
//   caption : ligne sous le nom (ex. « Organisateur ») ; emptyHistory (ou emptyText) : texte quand history est vide (défaut « Aucune autre demande. »)
// Utilisé par la colonne de droite de l'assistance (admin/support.js). Dépend de ui/time.js et ui/common.js.
import { esc, avatarHtml } from '../../core/util.js';
import { monthYear, fmtDay, seenAgo } from './time.js';
import { pill, statusSelect, bindStatus, ICON } from './common.js';

// Identifiant unique par panneau (pour relier le libellé au sélecteur).
let seq = 0;

/**
 * Affiche la fiche rapide dans `el` (remplace son contenu) et branche le statut et les actions.
 * @returns {{destroy: () => void}} destroy retire les écouteurs et vide le panneau.
 */
export function renderInfoPanel(el, { member = {}, stats = [], status, onStatus, history = [], actions = [], statsTitle = 'Fiche rapide', historyTitle = 'Historique des demandes', caption = '', emptyText, emptyHistory = emptyText ?? 'Aucune autre demande.' } = {}) {
  const uid = `ui-info-${++seq}`;
  el.classList.add('ui-info');

  // En-tête : avatar, pseudo, puis ligne de légende (membre depuis, dernière visite).
  const head = `<div class="ui-info-head">
      <div class="ui-info-av">${avatarHtml(member, 52)}</div>
      <div class="ui-info-id">
        <div class="ui-info-name">${esc(member.pseudo || '')}</div>
        <div class="ui-info-meta">${caption ? esc(caption) : ''}${member.since ? `${caption ? '<br>' : ''}Membre depuis ${esc(monthYear(member.since))}` : ''}${member.lastSeen ? `<br>${esc(seenAgo(member.lastSeen))}` : ''}</div>
      </div>
    </div>`;

  // Grille de chiffres clés (absente si aucune stat).
  const facts = stats.length ? `<section class="ui-info-sec">
      <h3 class="ui-grp">${esc(statsTitle)}</h3>
      <div class="ui-facts">${stats.map((s) => `<div class="ui-fact"><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join('')}</div>
    </section>` : '';

  const statusBlock = status ? `<section class="ui-info-sec">
      <label class="ui-grp" for="${uid}-st">${esc(status.label || 'Statut')}</label>
      ${statusSelect({ id: `${uid}-st`, value: status.value, options: status.options, label: status.label || 'Statut', className: 'ui-status ui-status-wide', disabled: !onStatus })}
    </section>` : '';

  // Historique : les autres demandes du même membre, ou un texte si la liste est vide.
  const hist = `<section class="ui-info-sec">
      <h3 class="ui-grp">${esc(historyTitle)}</h3>
      ${history.length ? `<ul class="ui-hist">${history.map((h) => `<li>
          <span class="ui-hist-t">${esc(h.title)}</span>
          ${pill(h.status)}
          <span class="ui-hist-d">${esc(fmtDay(h.at))}</span>
        </li>`).join('')}</ul>` : `<p class="ui-info-empty">${esc(emptyHistory)}</p>`}
    </section>`;

  const acts = actions.length ? `<div class="ui-info-actions">${actions.map((a, i) => `<button type="button" class="ui-linkbtn" data-action="${i}">
      <span>${esc(a.label)}</span>${ICON.next()}</button>`).join('')}</div>` : '';

  el.innerHTML = `${head}${facts}${statusBlock}${hist}${acts}`;

  const select = el.querySelector('select');
  bindStatus(select, status?.options || [], onStatus);

  // Délégation : un seul écouteur sur le panneau, qui retrouve l'action cliquée par son rang.
  const handlers = (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = actions[Number(b.dataset.action)];
    if (a?.onClick) a.onClick();
  };
  el.addEventListener('click', handlers);

  return {
    /** Retire l'écouteur et vide le panneau. */
    destroy() {
      el.removeEventListener('click', handlers);
      el.innerHTML = '';
      el.classList.remove('ui-info');
    },
  };
}
