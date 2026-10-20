// ===== Human Gang — assistance (accessible sans compte) =====
import { initPage, callFn, $, errMsg } from './core.js';

const me = await initPage({ auth: 'optional' });

const SUBJECTS = ['Problème de compte / connexion', 'Secret Santa', 'Sortie IRL', 'Bug sur le site', 'Mes données personnelles', 'Autre'];
const form = $('#support-form');
const errBox = $('#sp-error');

/* Préremplissage */
if (me) {
  form.pseudo.value = me.pseudo;
  form.pseudo.readOnly = true;
  $('#sp-pseudo-hint').hidden = false;
  $('#sp-contact-label').textContent = 'Ton pseudo Discord pour la réponse (facultatif)';
} else {
  form.contact.required = true;
  $('#sp-contact-label').textContent = 'Ton pseudo Discord pour la réponse (obligatoire)';
}
const wanted = new URLSearchParams(location.search).get('sujet');
if (wanted && SUBJECTS.includes(wanted)) form.subject.value = wanted;

const counter = $('#sp-counter');
form.message.addEventListener('input', () => { counter.textContent = `${form.message.value.length} / 4000`; });

function showError(msg, field) {
  errBox.textContent = msg; errBox.hidden = false;
  field?.setAttribute('aria-invalid', 'true');
  field?.focus();
}
function validate() {
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  errBox.hidden = true;
  const pseudo = form.pseudo.value.trim(), msg = form.message.value.trim(), contact = form.contact.value.trim();
  if (pseudo.length < 2) return showError('Indique ton pseudo (2 caractères minimum).', form.pseudo), false;
  if (!SUBJECTS.includes(form.subject.value)) return showError('Choisis un sujet.', form.subject), false;
  if (msg.length < 10) return showError('Ton message est un peu court : donne quelques détails (10 caractères minimum).', form.message), false;
  if (!me && contact.length < 2) return showError('Indique ton pseudo Discord pour qu\'on puisse te répondre.', form.contact), false;
  return true;
}

/** Récupère le message d'erreur renvoyé par la fonction edge (corps JSON { error }). */
async function fnError(e) {
  try {
    const body = await e?.context?.json?.();
    if (body?.error) return body.error;
  } catch {}
  return errMsg(e);
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!validate()) return;
  const btn = ev.submitter || form.querySelector('[type="submit"]');
  btn.disabled = true; btn.textContent = 'Envoi…';
  try {
    await callFn('hg-support', {
      pseudo: form.pseudo.value.trim(),
      subject: form.subject.value,
      message: form.message.value.trim(),
      contact: form.contact.value.trim(),
      website: form.website.value, // pot de miel : doit rester vide
    });
    const contact = form.contact.value.trim();
    $('#done-contact').textContent = contact
      ? `La réponse arrivera sur Discord (${contact}).`
      : 'La réponse arrivera sur Discord ou directement sur le site.';
    $('.support-layout').hidden = true;
    const done = $('#support-done');
    done.hidden = false; done.focus();
    window.scrollTo({ top: 0 });
  } catch (e) {
    showError(`Envoi impossible : ${await fnError(e)}`);
  } finally {
    btn.disabled = false; btn.textContent = 'Envoyer la demande';
  }
});

$('#support-again').addEventListener('click', () => {
  form.subject.value = ''; form.message.value = ''; counter.textContent = '0 / 4000';
  if (!me) form.contact.value = '';
  $('#support-done').hidden = true;
  $('.support-layout').hidden = false;
  form.subject.focus();
});
