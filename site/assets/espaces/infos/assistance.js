// ===== Humane Gang — assistance (/pages/infos/assistance.html, accessible sans compte) =====
// Formulaire de demande d'aide (envoyé par la fonction edge hg-support), suivi des demandes du membre connecté
// (« Mes demandes », avec les réponses publiques), et préremplissage du sujet depuis l'adresse (?sujet=…).
// Pièces jointes (membres connectés) : support-files.js ; fichiers déposés dans le bucket privé, puis chemins envoyés à hg-support.
// Dépendances : core.js (initPage, callFn, sb = Supabase), tables hg_settings, hg_support, hg_support_replies, hg_support_files, RPC hg_members.
// N'exporte rien.
import { initPage, callFn, $, errMsg, sb, esc, fmtDateTime } from '../../commun/core.js';
import { SUPPORT_MAX_FILES, prepareSupportFile, uploadSupportFile, removeSupportFiles, fileSize, attachmentsHtml, hydrateAttachments } from './support-files.js';

/* ---------- Initialisation : session facultative (un visiteur peut écrire sans compte) ---------- */
// me = personne connectée, ou null pour un visiteur.
const me = await initPage({ auth: 'optional' });

/* ---------- Réglages du formulaire (sujets, longueurs de message, délai de réponse) ---------- */
// Réglages de l'assistance (hg_settings.support, lisible sans compte). Repli sur les défauts si la lecture échoue
// ou si la valeur est invalide. Même règle que supabase/functions/_shared/reglages.ts (le serveur revalide tout).
const SUPPORT_DEFAUT = {
  sujets: ['Problème de compte / connexion', 'Secret Santa', 'Sortie IRL', 'Bug sur le site', 'Mes données personnelles', 'Autre'],
  message_min: 10, message_max: 4000, delai_reponse_jours: 30,
};
// Le sujet « Bug sur le site » doit toujours exister : c'est celui que le formulaire de bug attend.
const BUG_SUBJECT = 'Bug sur le site';
/**
 * Lit les réglages publics de l'assistance (RPC hg_support_public), en gardant les défauts pour tout champ invalide.
 * Une lecture qui échoue donne simplement les défauts : le formulaire reste utilisable.
 * @returns {Promise<{sujets: string[], message_min: number, message_max: number, delai_reponse_jours: number}>}
 */
async function loadSupportRules() {
  const r = { ...SUPPORT_DEFAUT };
  try {
    // RPC hg_support_public : sujets et longueurs seulement (les seuils anti-spam restent côté serveur).
    const { data } = await sb.rpc('hg_support_public');
    const s = data && typeof data === 'object' ? data : {};
    if (Array.isArray(s.sujets)) {
      const clean = [...new Set(s.sujets.filter((x) => typeof x === 'string').map((x) => x.trim()).filter((x) => x && x.length <= 80))];
      if (clean.length && clean.length <= 20 && clean.includes(BUG_SUBJECT)) r.sujets = clean;
    }
    /** Renvoie v s'il est un entier entre min et max, sinon la valeur par défaut def. */
    const int = (v, def, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : def);
    r.message_min = int(s.message_min, r.message_min, 1, 1000);
    r.message_max = int(s.message_max, r.message_max, r.message_min + 1, 4000);
    r.delai_reponse_jours = int(s.delai_reponse_jours, r.delai_reponse_jours, 1, 365);
  } catch { /* défauts */ }
  return r;
}
/* ---------- Formulaire : sujets, longueurs, préremplissage ---------- */
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

// Préremplissage : pseudo verrouillé pour un membre connecté ; contact Discord obligatoire pour un visiteur.
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
// Message prérempli (?message=…), par exemple depuis une page qui renvoie vers l'assistance.
const wantedMsg = new URLSearchParams(location.search).get('message');
if (wantedMsg && !form.message.value) form.message.value = wantedMsg.slice(0, RULES.message_max);

/* ---------- Pièces jointes à envoyer (membre connecté seulement) ---------- */
// pending : fichiers choisis, compressés, pas encore envoyés. { prepared, url } ; url = aperçu d'une image (à libérer).
const pending = [];
const filesField = $('#sp-files-field');
const filesList = $('#sp-files-list');
const filesErr = $('#sp-files-error');
const filesInput = $('#sp-files-input');
if (me) filesField.hidden = false;

/** Affiche une erreur liée aux pièces jointes (vide pour l'effacer). */
function showFilesError(msg) {
  filesErr.textContent = msg || '';
  filesErr.hidden = !msg;
}
/** Dessine la liste des pièces jointes à envoyer : vignette, nom, poids (avant et après compression), retrait. */
function renderPending() {
  filesList.innerHTML = pending.map((it, i) => {
    const p = it.prepared;
    const meta = p.isImage
      ? `Image · ${fileSize(p.original)}${p.size < p.original ? ` → ${fileSize(p.size)} après compression` : ''}`
      : `PDF · ${fileSize(p.size)}`;
    const thumb = p.isImage
      ? `<span class="sf-thumb"><img alt="" src="${esc(it.url)}"></span>`
      : `<span class="sf-thumb sf-pdf" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg><span>PDF</span></span>`;
    return `<li>${thumb}<span class="sf-meta"><strong class="sf-nm">${esc(p.name)}</strong><span>${esc(meta)}</span></span>`
      + `<button class="sf-rm" type="button" data-rm="${i}" aria-label="Retirer ${esc(p.name)}">`
      + `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>`;
  }).join('');
  $('#sp-files-add').disabled = pending.length >= SUPPORT_MAX_FILES;
}
/** Libère les aperçus et vide la liste (après envoi, ou « Nouvelle demande »). */
function clearPending() {
  for (const it of pending) if (it.url) URL.revokeObjectURL(it.url);
  pending.length = 0;
  renderPending();
  showFilesError('');
}
// Ajout : chaque fichier est contrôlé et compressé ; les refus sont listés sans bloquer les autres.
filesInput.addEventListener('change', async () => {
  const chosen = [...filesInput.files];
  filesInput.value = '';
  const errors = [];
  for (const file of chosen) {
    if (pending.length >= SUPPORT_MAX_FILES) { errors.push(`Trois fichiers au maximum (« ${file.name} » n'a pas été ajouté).`); break; }
    try {
      const prepared = await prepareSupportFile(file);
      pending.push({ prepared, url: prepared.isImage ? URL.createObjectURL(prepared.blob) : null });
    } catch (e) { errors.push(errMsg(e)); }
  }
  renderPending();
  showFilesError(errors.join(' '));
  $('#sp-files-add').focus();
});
$('#sp-files-add').addEventListener('click', () => filesInput.click());
// Retrait avant envoi : la liste se redessine, le focus reste dans la zone.
filesList.addEventListener('click', (e) => {
  const b = e.target.closest('[data-rm]');
  if (!b) return;
  const [it] = pending.splice(Number(b.dataset.rm), 1);
  if (it?.url) URL.revokeObjectURL(it.url);
  renderPending();
  showFilesError('');
  $('#sp-files-add').focus();
});

const counter = $('#sp-counter');
/** Texte du compteur de caractères, par exemple « 12 / 4000 ». */
const counterText = (n) => `${n} / ${RULES.message_max}`;
form.message.addEventListener('input', () => { counter.textContent = counterText(form.message.value.length); });
counter.textContent = counterText(form.message.value.length);

/* ---------- Validation et envoi ---------- */
/**
 * Affiche l'erreur dans la boîte dédiée, marque le champ fautif (aria-invalid) et le met au premier plan.
 * @param {string} msg message d'erreur
 * @param {HTMLElement} [field] champ concerné
 */
function showError(msg, field) {
  errBox.textContent = msg; errBox.hidden = false;
  field?.setAttribute('aria-invalid', 'true');
  field?.focus();
}
/**
 * Contrôle le formulaire avant envoi : pseudo, sujet, longueur du message, contact pour un visiteur.
 * Le serveur revalide tout de toute façon ; ici on évite un aller-retour inutile.
 * @returns {boolean} true si le formulaire peut partir
 */
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

// Envoi : appel de la fonction edge hg-support. Le champ « website » est un piège à robots (pot de miel) : il doit rester vide.
form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!validate()) return;
  const btn = ev.submitter || form.querySelector('[type="submit"]');
  btn.disabled = true; btn.textContent = 'Envoi…';
  // Pièces jointes : déposées d'abord dans le dossier du membre, puis leurs chemins partent avec la demande.
  const uploaded = [];
  let stage = 'upload'; // upload, puis envoi, puis fin : ce qui a échoué dicte le message
  try {
    for (const it of pending) uploaded.push({ path: await uploadSupportFile(me.id, it.prepared), name: it.prepared.name });
    stage = 'envoi';
    await callFn('hg-support', {
      pseudo: form.pseudo.value.trim(),
      subject: form.subject.value,
      message: form.message.value.trim(),
      contact: form.contact.value.trim(),
      website: form.website.value, // pot de miel : doit rester vide
      files: uploaded,
    });
    stage = 'fin';
    clearPending();
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
    // Échec avant la fin : les fichiers déposés mais non rattachés à une demande sont retirés du bucket.
    if (stage !== 'fin') await removeSupportFiles(uploaded.map((u) => u.path));
    showError(`Envoi impossible : ${stage === 'upload' ? errMsg(e) : await fnError(e)}`);
  } finally {
    btn.disabled = false; btn.textContent = 'Envoyer la demande';
  }
});

// « Nouvelle demande » : vide le formulaire et revient à l'écran de saisie.
$('#support-again').addEventListener('click', () => {
  form.subject.value = ''; form.message.value = ''; counter.textContent = counterText(0);
  clearPending();
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
let mineFiles = [];

// Statut affiché : « Traitée », « En cours » (quelqu'un l'a prise), ou « Ouverte ».
/** Libellé du statut d'une demande. */
const statusLabel = (d) => (d.status === 'traitee' ? 'Traitée' : d.taken_by ? 'En cours' : 'Ouverte');
/** Classe de couleur du statut d'une demande : done, prog ou open. */
const statusClass = (d) => (d.status === 'traitee' ? 'done' : d.taken_by ? 'prog' : 'open');
/** Pastille HTML du statut d'une demande. */
const pill = (d) => `<span class="sp-pill" data-tone="${statusClass(d)}">${statusLabel(d)}</span>`;
/** Tri : les demandes les plus récemment mises à jour en premier. */
const byActivity = (a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);

/**
 * Affiche une erreur dans la section « Mes demandes ».
 * @param {string} msg message d'erreur
 */
function showMineError(msg) {
  const box = $('#my-support-error');
  box.textContent = msg; box.hidden = false;
}

/**
 * Charge les demandes du membre connecté et leur liste, puis ouvre celle désignée par l'adresse (#id) si besoin.
 * Ne fait rien pour un visiteur.
 */
async function loadMine() {
  if (!me) return;
  $('#my-support-error').hidden = true;
  try {
    const [req, names, files] = await Promise.all([
      sb.from('hg_support').select('id, subject, message, status, taken_by, created_at, updated_at, conversation_id').eq('user_id', me.id),
      sb.rpc('hg_members'),
      sb.from('hg_support_files').select('id, support_id, path, name, mime, size').order('created_at'),
    ]);
    if (req.error) throw req.error;
    mineItems = (req.data || []).sort(byActivity);
    // Pièces jointes : la base ne renvoie que les miennes (RLS) ; une erreur ne bloque pas la liste.
    mineFiles = files?.error ? [] : (files?.data || []);
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
        ${d.conversation_id ? '<span class="small my-support-conv">Discussion ouverte dans tes Messages</span>' : ''}
        <time class="small muted" datetime="${esc(new Date(d.created_at).toISOString())}">${esc(fmtDateTime(d.created_at))}</time>
      </button>
    </li>`).join('');
  openMineFromHash();
}

/**
 * Ouvre le détail d'une demande : le message du membre, puis les réponses publiques (internes exclues).
 * @param {string} id identifiant de la demande (hg_support)
 */
async function openMine(id) {
  const d = mineItems.find((x) => x.id === id);
  if (!d) return;
  mineView.hidden = true;
  mineDetail.hidden = false;
  $('#my-support-subject').textContent = d.subject;
  $('#my-support-meta').innerHTML = `${esc(fmtDateTime(d.created_at))} · ${pill(d)}`;
  const thread = $('#my-support-thread');
  const own = mineFiles.filter((f) => f.support_id === d.id);
  thread.innerHTML = `<div class="my-msg is-me"><div class="my-meta">Toi · ${esc(fmtDateTime(d.created_at))}</div><div class="my-bubble">${esc(d.message ?? '')}</div>${attachmentsHtml(own)}</div>`;
  if (own.length) hydrateAttachments(thread);
  // Prise en charge : la discussion avec le Staff continue dans une conversation privée (page Messages).
  if (d.conversation_id) {
    thread.insertAdjacentHTML('afterbegin', `<div class="my-support-convbox"><p>Ta demande a été prise en charge : la discussion se passe dans une conversation privée avec le Staff.</p>
      <a class="btn btn-primary" href="/pages/compte/messages.html?c=${encodeURIComponent(d.conversation_id)}">Ouvrir la conversation</a></div>`);
  }
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

/** Revient à la liste des demandes depuis le détail. */
function closeMine() {
  mineDetail.hidden = true;
  mineView.hidden = false;
}

/** Si l'adresse contient l'identifiant d'une demande connue (#id), ouvre son détail. */
function openMineFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (mineItems.some((x) => x.id === id)) openMine(id);
}

// Clic sur une demande : l'adresse prend son identifiant (pour un lien direct), puis le détail s'ouvre.
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
