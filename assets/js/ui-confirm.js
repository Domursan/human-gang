// ===== Humane Gang : boîte de confirmation partagée =====
// confirmBox(titre, texte, { ok, cancel, danger, input }) → Promise<boolean | string>
//   - boolean : true si l'utilisateur valide, false s'il annule (bouton, Échap, fermeture).
//   - string  : seulement si `input` est fourni ({ label, value, placeholder, required }) ;
//               renvoie la saisie (sans espaces de bord) ou false si annulé.
// Le focus part sur le bouton le moins dangereux : « Annuler » pour une action destructive,
// « Valider » sinon (ou sur le champ de saisie quand il existe). Le texte est posé en textContent.

const CSS_HREF = new URL('../css/ui-confirm.css', import.meta.url).href;
let seq = 0;

function ensureStyles() {
  if (document.querySelector('link[data-ui-confirm], link[href$="ui-confirm.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  link.dataset.uiConfirm = '';
  document.head.append(link);
}

export function confirmBox(title, text = '', { ok = 'Confirmer', cancel = 'Annuler', danger = false, input = null } = {}) {
  ensureStyles();
  const n = ++seq;
  const dlg = document.createElement('dialog');
  dlg.className = 'hg-dialog';
  const titleId = `uc-title-${n}`;
  dlg.setAttribute('aria-labelledby', titleId);

  const form = document.createElement('form');
  form.method = 'dialog';
  form.className = 'stack';

  const h2 = document.createElement('h2');
  h2.id = titleId;
  h2.className = 'dialog-title';
  h2.textContent = title;
  form.append(h2);

  if (text) {
    const p = document.createElement('p');
    p.id = `uc-body-${n}`;
    p.className = 'muted';
    p.textContent = text;
    dlg.setAttribute('aria-describedby', p.id);
    form.append(p);
  }

  let field = null;
  if (input) {
    const label = document.createElement('label');
    label.className = 'field';
    const span = document.createElement('span');
    span.textContent = input.label ?? '';
    field = document.createElement('input');
    field.type = 'text';
    field.value = input.value ?? '';
    field.placeholder = input.placeholder ?? '';
    field.required = input.required !== false;
    field.autocomplete = 'off';
    label.append(span, field);
    form.append(label);
  }

  const actions = document.createElement('div');
  actions.className = 'btn-row dialog-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'submit';
  cancelBtn.value = 'cancel';
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = cancel;
  const okBtn = document.createElement('button');
  okBtn.type = 'submit';
  okBtn.value = 'ok';
  okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  okBtn.textContent = ok;
  actions.append(cancelBtn, okBtn);
  form.append(actions);

  dlg.append(form);

  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const confirmed = dlg.returnValue === 'ok';
      const value = field ? field.value.trim() : null;
      dlg.remove();
      resolve(input ? (confirmed ? value : false) : confirmed);
    }, { once: true });
    document.body.append(dlg);
    dlg.showModal();
    (field ?? (danger ? cancelBtn : okBtn)).focus();
  });
}
