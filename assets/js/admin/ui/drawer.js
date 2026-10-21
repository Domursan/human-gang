// Tiroir latéral du panel (option C) : formulaires de création / modification ouverts à la demande,
// au lieu d'être dépliés en permanence dans la page. Basé sur <dialog> (focus piégé, Échap ferme).
//
//   const d = openDrawer({ title: 'Nouveau défi', body: formElementOuHtml, submitLabel: 'Créer',
//                          onSubmit: async (form) => { … }, wide: false });
//   d.close();
//
// onSubmit reçoit le <form> ; s'il renvoie false ou lève une erreur, le tiroir reste ouvert
// (l'erreur est affichée par toast). Le bouton principal est désactivé pendant l'envoi.
import { esc, toast, errMsg } from '../../core.js';

let seq = 0;

export function openDrawer({ title, subtitle = '', body = '', submitLabel = 'Enregistrer', cancelLabel = 'Annuler', onSubmit = null, onClose = null, wide = false } = {}) {
  const id = `ui-drawer-${++seq}`;
  const dlg = document.createElement('dialog');
  dlg.className = `ui-drawer${wide ? ' is-wide' : ''}`;
  dlg.setAttribute('aria-labelledby', `${id}-t`);
  dlg.innerHTML = `
    <form method="dialog" class="ui-drawer-form" novalidate>
      <header class="ui-drawer-head">
        <div><h2 id="${id}-t" class="ui-drawer-title">${esc(title)}</h2>${subtitle ? `<p class="ui-drawer-sub">${esc(subtitle)}</p>` : ''}</div>
        <button type="button" class="ui-drawer-x" data-drawer-close aria-label="Fermer">×</button>
      </header>
      <div class="ui-drawer-body"></div>
      ${onSubmit ? `<footer class="ui-drawer-foot">
        <button type="button" class="btn btn-ghost" data-drawer-close>${esc(cancelLabel)}</button>
        <button type="submit" class="btn btn-primary" data-drawer-submit>${esc(submitLabel)}</button>
      </footer>` : ''}
    </form>`;
  const bodyEl = dlg.querySelector('.ui-drawer-body');
  if (body instanceof Node) bodyEl.append(body); else bodyEl.innerHTML = body;
  document.body.append(dlg);

  const close = () => { if (dlg.open) dlg.close(); };
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-drawer-close]')) { e.preventDefault(); close(); return; }
    if (e.target === dlg) close(); // clic sur le voile
  });
  const form = dlg.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    if (!form.reportValidity()) return;
    const btn = form.querySelector('[data-drawer-submit]');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const ok = await onSubmit(form);
      if (ok !== false) close();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });
  dlg.showModal();
  (bodyEl.querySelector('input, select, textarea, button') || dlg.querySelector('.ui-drawer-x'))?.focus();
  return { el: dlg, form, body: bodyEl, close };
}
