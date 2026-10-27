// ===== Humane Gang : boîte de confirmation partagée =====
// confirmBox(titre, texte, { ok, cancel, danger, input }) → Promise<boolean | string>
//   - boolean : true si l'utilisateur valide, false s'il annule (bouton, Échap, fermeture).
//   - string  : seulement si `input` est fourni ({ label, value, placeholder, required }) ;
//               renvoie la saisie (sans espaces de bord) ou false si annulé.
// Le focus part sur le bouton le moins dangereux : « Annuler » pour une action destructive,
// « Valider » sinon (ou sur le champ de saisie quand il existe). Le texte est posé en textContent.

/*
 * Rôle : ouvre une boîte de dialogue de confirmation (ou de saisie courte) et attend la réponse.
 * Page : toutes les pages qui demandent une confirmation (suppressions, validations, saisies).
 * Dépendances : feuille de style assets/css/ui-confirm.css (chargée une seule fois).
 * Exporte : confirmBox.
 */

/* ---------- Constantes et état ---------- */

/** Adresse de la feuille de style, relative à ce fichier. */
const CSS_HREF = new URL('./ui-confirm.css', import.meta.url).href;
/** Compteur qui rend unique l'identifiant du titre et du texte de chaque boîte ouverte. */
let seq = 0;

/* ---------- Styles ---------- */

/**
 * Ajoute la feuille de style à la page, si elle n'y est pas déjà (par son attribut ou son adresse).
 */
function ensureStyles() {
  if (document.querySelector('link[data-ui-confirm], link[href$="ui-confirm.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  link.dataset.uiConfirm = '';
  document.head.append(link);
}

/* ---------- Boîte de confirmation ---------- */

/**
 * Affiche la boîte de confirmation et renvoie la réponse une fois qu'elle est fermée.
 * Le dialogue est retiré du document à la fermeture (aucune trace laissée).
 * @param {string} title Titre (texte brut).
 * @param {string} [text=''] Explication facultative (texte brut).
 * @param {{ok?: string, cancel?: string, danger?: boolean, input?: ({label?: string, value?: string, placeholder?: string, required?: boolean}|null)}} [options]
 *   ok / cancel : libellés des boutons ; danger : bouton rouge et focus sur « Annuler » ;
 *   input : ajoute un champ de saisie.
 * @returns {Promise<boolean|string|false>} true si validé, false si annulé ; avec input, la saisie (sans espaces de bord) ou false.
 */
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
  cancelBtn.formNoValidate = true; // Annuler doit fermer même si le champ obligatoire est vide
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = cancel;
  const okBtn = document.createElement('button');
  okBtn.type = 'submit';
  okBtn.value = 'ok';
  okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  okBtn.textContent = ok;
  actions.append(cancelBtn, okBtn);
  form.append(actions);

  // Entrée dans le champ : le navigateur validerait avec le PREMIER bouton du formulaire (« Annuler »).
  // On redirige donc la touche vers « Valider ».
  field?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); okBtn.click(); }
  });

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
