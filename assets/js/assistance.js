// ===== Humane Gang — assistance (accessible sans compte) =====
import { initPage, callFn, $, errMsg, sb, esc, fmtDateTime } from './core.js';

const me = await initPage({ auth: 'optional' });

// Réglages de l'assistance (hg_settings.support, lisible sans compte). Repli sur les défauts si la lecture échoue
// ou si la valeur est invalide. Même règle que supabase/functions/_shared/reglages.ts (le serveur revalide tout).
const SUPPORT_DEFAUT = {
  sujets: ['Problème de compte / connexion', 'Secret Santa', 'Sortie IRL', 'Bug sur le site', 'Mes données personnelles', 'Autre'],
  message_min: 10, message_max: 4000, delai_reponse_jours: 30,
};
const BUG_SUBJECT = 'Bug sur le site';
async function loadSupportRules() {
  const r = { ...SUPPORT_DEFAUT };
  try {
    const { data } = await sb.from('hg_settings').select('value').eq('key', 'support').maybeSingle();
    const s = data?.value && typeof data.value === 'object' ? data.value : {};
    if (Array.isArray(s.sujets)) {
      const clean = [...new Set(s.sujets.filter((x) => typeof x === 'string').map((x) => x.trim()).filter((x) => x && x.length <= 80))];
      if (clean.length && clean.length <= 20 && clean.includes(BUG_SUBJECT)) r.sujets = clean;
    }
    const int = (v, def, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : def);
    r.message_min = int(s.message_min, r.message_min, 1, 1000);
    r.message_max = int(s.message_max, r.message_max, r.message_min + 1, 4000);
    r.delai_reponse_jours = int(s.delai_reponse_jours, r.delai_reponse_jours, 1, 365);
  } catch { /* défauts */ }
  return r;
}
const RULES = await loadSupportRules();
const SUBJECTS = RULES.sujets;
const form = $('#support-form');
const errBox = $('#sp-error');
// Liste des sujets : rendue depuis le réglage (les options du HTML servent de repli sans JavaScript)
{
  const keep = form.subject.value;
  form.subject.innerHTML = '<option value="">Choisir…</option>' + SUBJECTS.map((s) => `<option>${esc(s)}</option>`).join('');
  form.subject.value = keep;
}
form.message.minLength = RULES.message_min;
form.message.maxLength = RULES.message_max;

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
const counterText = (n) => `${n} / ${RULES.message_max}`;
form.message.addEventListener('input', () => { counter.textContent = counterText(form.message.value.length); });
counter.textContent = counterText(form.message.value.length);

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
  if (msg.length < RULES.message_min) return showError(`Ton message est un peu court : donne quelques détails (${RULES.message_min} caractères minimum).`, form.message), false;
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
    $('#done-contact').textContent = `${contact
      ? `La réponse arrivera sur Discord (${contact}).`
      : 'La réponse arrivera sur Discord ou directement sur le site.'} Une réponse t'est apportée dans un délai de ${RULES.delai_reponse_jours} jours.`;
    $('.support-layout').hidden = true;
    const done = $('#support-done');
    done.hidden = false; done.focus();
    window.scrollTo({ top: 0 });
    if (me) loadMine();
  } catch (e) {
    showError(`Envoi impossible : ${await fnError(e)}`);
  } finally {
    btn.disabled = false; btn.textContent = 'Envoyer la demande';
  }
});

$('#support-again').addEventListener('click', () => {
  form.subject.value = ''; form.message.value = ''; counter.textContent = counterText(0);
  if (!me) form.contact.value = '';
  $('#support-done').hidden = true;
  $('.support-layout').hidden = false;
  form.subject.focus();
});

/* ---------- Mes demandes (membre connecté) : statut, et fil des réponses publiques ---------- */
// La base ne renvoie au membre que ses demandes et les réponses non internes (RLS) ; le filtre ici est une ceinture de plus.
const mine = $('#my-support');
const mineList = $('#my-support-list');
const mineView = $('#my-support-list-view');
const mineDetail = $('#my-support-detail');
let mineItems = [];
let minePseudos = new Map();

const statusLabel = (d) => (d.status === 'traitee' ? 'Traitée' : d.taken_by ? 'En cours' : 'Ouverte');
const statusClass = (d) => (d.status === 'traitee' ? 'done' : d.taken_by ? 'prog' : 'open');
const pill = (d) => `<span class="sp-pill" data-tone="${statusClass(d)}">${statusLabel(d)}</span>`;
const byActivity = (a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);

function showMineError(msg) {
  const box = $('#my-support-error');
  box.textContent = msg; box.hidden = false;
}

async function loadMine() {
  if (!me) return;
  $('#my-support-error').hidden = true;
  try {
    const [req, names] = await Promise.all([
      sb.from('hg_support').select('id, subject, message, status, taken_by, created_at, updated_at').eq('user_id', me.id),
      sb.rpc('hg_members'),
    ]);
    if (req.error) throw req.error;
    mineItems = (req.data || []).sort(byActivity);
    // Pseudos des répondants (annuaire des membres) ; sans annuaire, les réponses sont signées « L’équipe »
    minePseudos = new Map((names?.error ? [] : names?.data || []).map((m) => [m.id, m.pseudo]));
  } catch (e) {
    showMineError(`Impossible de charger tes demandes : ${errMsg(e)}`);
    return;
  }
  mine.hidden = false;
  $('#my-support-empty').hidden = mineItems.length > 0;
  mineList.innerHTML = mineItems.map((d) => `<li>
      <button type="button" class="my-support-row" data-id="${esc(d.id)}">
        <span class="my-support-top"><span class="my-support-name">${esc(d.subject)}</span>${pill(d)}</span>
        <time class="small muted" datetime="${esc(new Date(d.created_at).toISOString())}">${esc(fmtDateTime(d.created_at))}</time>
      </button>
    </li>`).join('');
  openMineFromHash();
}

async function openMine(id) {
  const d = mineItems.find((x) => x.id === id);
  if (!d) return;
  mineView.hidden = true;
  mineDetail.hidden = false;
  $('#my-support-subject').textContent = d.subject;
  $('#my-support-meta').innerHTML = `${esc(fmtDateTime(d.created_at))} · ${pill(d)}`;
  const thread = $('#my-support-thread');
  thread.innerHTML = `<div class="my-msg is-me"><div class="my-meta">Toi · ${esc(fmtDateTime(d.created_at))}</div><div class="my-bubble">${esc(d.message ?? '')}</div></div>`;
  try {
    const res = await sb.from('hg_support_replies').select('id, author_id, body, created_at, internal')
      .eq('support_id', id).eq('internal', false).order('created_at');
    if (res.error) throw res.error;
    const replies = (res.data || []).filter((r) => !r.internal).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    for (const r of replies) {
      const who = minePseudos.get(r.author_id) || 'L’équipe';
      thread.insertAdjacentHTML('beforeend', `<div class="my-msg is-staff"><div class="my-meta">${esc(who)} · ${esc(fmtDateTime(r.created_at))}</div><div class="my-bubble">${esc(r.body)}</div></div>`);
    }
  } catch (e) {
    thread.insertAdjacentHTML('beforeend', `<p class="small muted">Réponses indisponibles : ${esc(errMsg(e))}</p>`);
  }
}

function closeMine() {
  mineDetail.hidden = true;
  mineView.hidden = false;
}

function openMineFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (mineItems.some((x) => x.id === id)) openMine(id);
}

mineList.addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  const id = b.dataset.id;
  history.replaceState(null, '', `#${encodeURIComponent(id)}`);
  openMine(id);
});
$('#my-support-back').addEventListener('click', () => {
  history.replaceState(null, '', location.pathname + location.search);
  closeMine();
  $('#my-support-list .my-support-row')?.focus();
});

if (me) loadMine();
