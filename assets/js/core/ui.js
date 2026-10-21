// Interface commune : notifications (toasts) et son discret sur les boutons principaux.
import { playSound } from '../sound.js';
import { $ } from './util.js';

/* ---------- Toasts ---------- */
/* Conteneur des notifications : créé dès le chargement de la page (région live déjà présente, donc annoncée) */
function toastBox() {
  let box = $('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  return box;
}
export function toast(msg, type = '') {
  const box = toastBox();
  const t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg;
  if (type === 'error') t.setAttribute('role', 'alert'); // les erreurs sont annoncées tout de suite
  box.append(t);
  if (type === 'ok' || type === 'success') playSound('success');
  else if (type === 'error') playSound('error');
  setTimeout(() => t.remove(), 4500);
}
if (document.body) toastBox(); // module différé : le body existe déjà

/* Son discret sur les boutons principaux (délégation) */
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('.btn-primary') : null;
  if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') playSound('click');
}, true);
