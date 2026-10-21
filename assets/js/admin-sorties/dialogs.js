// ===== Admin : sorties IRL — fenêtres d'édition et de gestion (inscriptions, votes, date retenue) =====
import { toast, errMsg, esc, fmtDateTime } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { toZurichInput, fromZurichInput } from '../admin-events.js';
import { pluralCount } from '../utils.js';
import * as api from './data.js';
import { RSVP_ORDER, RSVP_LABEL, whenLabel, memberName, statusOf } from './format.js';

const MIN_DATES = 2, MAX_DATES = 6, TITLE_MAX = 120, LOC_MAX = 160, DESC_MAX = 1000;

// CTX : { me, get() → état de la section, reload() → recharge et redessine }
let CTX = null;
const E = { dlg: null, form: null, editId: null, opener: null };   // fenêtre d'édition
const D = { dlg: null, body: null, id: null, opener: null };        // fenêtre de gestion

/* ---------- Montage ---------- */
export function mountDialogs(root, ctx) {
  CTX = ctx;
  E.dlg = buildEdit();
  D.dlg = buildDetail();
  root.append(E.dlg, D.dlg);
}

/* ---------- Édition ---------- */
function buildEdit() {
  const dlg = document.createElement('dialog');
  dlg.id = 'ass-edit';
  dlg.className = 'hg-dialog ass-dlg';
  dlg.setAttribute('aria-labelledby', 'ass-e-title');
  dlg.innerHTML = `<form class="ass-form" id="ass-e-form" novalidate>
    <h2 class="dialog-title" id="ass-e-title">Nouvelle sortie</h2>
    <div class="ass-grid">
      <div class="field ass-wide">
        <label for="ass-e-name">Titre</label>
        <input id="ass-e-name" type="text" maxlength="${TITLE_MAX}" required autocomplete="off">
      </div>
      <div class="field">
        <label for="ass-e-org">Organisateur</label>
        <select id="ass-e-org"></select>
      </div>
      <div class="field">
        <label for="ass-e-loc">Lieu (facultatif)</label>
        <input id="ass-e-loc" type="text" maxlength="${LOC_MAX}" autocomplete="off">
      </div>
      <div class="field ass-wide">
        <label for="ass-e-desc">Description (facultative)</label>
        <textarea id="ass-e-desc" rows="3" maxlength="${DESC_MAX}"></textarea>
      </div>
      <fieldset class="ass-wide ass-mode">
        <legend>Date</legend>
        <label class="ass-radio"><input type="radio" name="ass-e-mode" value="fixed"> Date fixée</label>
        <label class="ass-radio"><input type="radio" name="ass-e-mode" value="poll"> À caler (sondage)</label>
      </fieldset>
      <div class="field ass-wide" id="ass-e-fixed">
        <label for="ass-e-start">Début (heure suisse)</label>
        <input id="ass-e-start" type="datetime-local">
      </div>
      <div class="ass-wide" id="ass-e-poll" hidden>
        <p class="small muted">Propose entre ${MIN_DATES} et ${MAX_DATES} dates. Le gang votera pour celle qui convient.</p>
        <div id="ass-e-dates" class="ass-dates"></div>
        <button class="btn btn-ghost btn-sm" type="button" id="ass-e-add">+ Ajouter une date</button>
      </div>
      <label class="ass-check ass-wide"><input id="ass-e-retro" type="checkbox"> Rencontre passée, ajoutée après coup (pas d'annonce)</label>
    </div>
    <p class="form-error" id="ass-e-err" role="alert" hidden></p>
    <div class="btn-row">
      <button class="btn btn-primary" type="submit" id="ass-e-submit">Créer la sortie</button>
      <button class="btn btn-ghost" type="button" data-close>Annuler</button>
    </div>
  </form>`;
  E.form = dlg.querySelector('form');
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  E.form.addEventListener('change', (e) => {
    if (e.target.name === 'ass-e-mode') setMode(e.target.value);
    if (e.target.id === 'ass-e-retro') onRetro(e.target.checked);
  });
  E.form.querySelector('#ass-e-add').addEventListener('click', () => {
    addDateRow();
    E.form.querySelector('#ass-e-dates .ass-date-row:last-child input').focus();
  });
  E.form.querySelector('#ass-e-dates').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove-date]');
    if (!b) return;
    b.closest('.ass-date-row').remove();
    updateDateRows();
    E.form.querySelector('#ass-e-add').focus();
  });
  E.form.addEventListener('submit', onSave);
  dlg.addEventListener('close', () => restoreFocus(E));
  return dlg;
}

function setMode(mode) {
  E.form.querySelector('#ass-e-fixed').hidden = mode !== 'fixed';
  E.form.querySelector('#ass-e-poll').hidden = mode !== 'poll';
  if (mode === 'poll') while (rows().length < MIN_DATES) addDateRow();
}
function onRetro(on) {
  const poll = E.form.querySelector('input[name="ass-e-mode"][value="poll"]');
  const fixed = E.form.querySelector('input[name="ass-e-mode"][value="fixed"]');
  poll.disabled = on;
  if (on) fixed.checked = true;
  setMode(on ? 'fixed' : currentMode());
}
const currentMode = () => E.form.querySelector('input[name="ass-e-mode"]:checked')?.value || 'fixed';
const rows = () => [...E.form.querySelectorAll('#ass-e-dates .ass-date-row')];

function addDateRow(value = '', id = '') {
  const row = document.createElement('div');
  row.className = 'ass-date-row';
  row.innerHTML = `<input class="input" type="datetime-local" value="${esc(value)}" data-orig="${esc(value)}" data-id="${esc(id)}">
    <button type="button" class="btn btn-ghost btn-sm" data-remove-date>Retirer</button>`;
  E.form.querySelector('#ass-e-dates').append(row);
  updateDateRows();
}
function updateDateRows() {
  const list = rows();
  list.forEach((r, i) => {
    r.querySelector('input').setAttribute('aria-label', `Date proposée ${i + 1}`);
    r.querySelector('button').setAttribute('aria-label', `Retirer la date proposée ${i + 1}`);
    r.querySelector('button').disabled = list.length <= MIN_DATES;
  });
  E.form.querySelector('#ass-e-add').disabled = list.length >= MAX_DATES;
}

/** Ouvre la fenêtre pour créer (ev = null) ou modifier une sortie. */
export function openEdit(ev = null, opener = null) {
  const f = E.form, S = CTX.get();
  E.editId = ev?.id || null;
  E.opener = opener;
  f.reset();
  f.querySelector('#ass-e-dates').innerHTML = '';
  f.querySelector('#ass-e-err').hidden = true;
  f.querySelector('#ass-e-poll').hidden = true;
  f.querySelector('#ass-e-retro').checked = !!ev?.retro;
  f.querySelector('input[name="ass-e-mode"][value="poll"]').disabled = false;
  E.dlg.querySelector('#ass-e-title').textContent = ev ? 'Modifier la sortie' : 'Proposer une sortie';
  f.querySelector('#ass-e-submit').textContent = ev ? 'Enregistrer' : 'Créer la sortie';

  // Organisateur : les fantômes ne peuvent pas être créateurs (compte réel requis).
  const orgId = ev?.created_by || CTX.me.id;
  const orgOpts = [...S.members.values()].filter((m) => !m.is_ghost || m.id === orgId).sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
  if (!S.members.has(orgId)) orgOpts.unshift({ id: orgId, pseudo: 'Ancien membre' });
  f.querySelector('#ass-e-org').innerHTML = orgOpts.map((m) => `<option value="${esc(m.id)}">${esc(m.pseudo)}</option>`).join('');
  f.querySelector('#ass-e-org').value = orgId;
  // À la création, la base n'accepte que le compte connecté comme créateur (RLS hg_events_insert).
  f.querySelector('#ass-e-org').disabled = !ev;

  f.querySelector('#ass-e-name').value = ev?.title || '';
  f.querySelector('#ass-e-loc').value = ev?.location || '';
  f.querySelector('#ass-e-desc').value = ev?.description || '';
  f.querySelector('#ass-e-start').value = toZurichInput(ev?.starts_at);
  const mode = ev && !ev.starts_at ? 'poll' : 'fixed';
  f.querySelector(`input[name="ass-e-mode"][value="${mode}"]`).checked = true;
  if (mode === 'poll') {
    const ds = S.dates.filter((d) => d.event_id === ev.id);
    ds.forEach((d) => addDateRow(toZurichInput(d.proposed_at), d.id));
  }
  onRetro(!!ev?.retro);
  if (ev?.retro) f.querySelector('input[name="ass-e-mode"][value="fixed"]').checked = true;
  setMode(f.querySelector('input[name="ass-e-mode"]:checked').value);
  E.dlg.showModal();
  f.querySelector('#ass-e-name').focus();
}

async function onSave(e) {
  e.preventDefault();
  const f = E.form, err = f.querySelector('#ass-e-err'), btn = f.querySelector('#ass-e-submit');
  const fail = (msg, el) => { err.textContent = msg; err.hidden = false; el?.focus(); };
  const title = f.querySelector('#ass-e-name').value.trim();
  const retro = f.querySelector('#ass-e-retro').checked;
  const mode = retro ? 'fixed' : currentMode();
  if (!title) return fail('Donne un titre à la sortie.', f.querySelector('#ass-e-name'));
  if (title.length > TITLE_MAX) return fail(`Le titre dépasse ${TITLE_MAX} caractères.`, f.querySelector('#ass-e-name'));

  let starts_at = null, wanted = [];
  if (mode === 'fixed') {
    const el = f.querySelector('#ass-e-start');
    starts_at = fromZurichInput(el.value);
    if (!starts_at) return fail('Indique une date de début, ou choisis « À caler (sondage) ».', el);
  } else {
    const inputs = rows().map((r) => r.querySelector('input')).filter((i) => i.value);
    const isos = inputs.map((i) => fromZurichInput(i.value));
    if (new Set(isos).size !== isos.length) return fail('Deux dates proposées sont identiques.', inputs[0]);
    if (isos.length < MIN_DATES || isos.length > MAX_DATES) return fail(`Propose entre ${MIN_DATES} et ${MAX_DATES} dates.`, inputs[0]);
    wanted = inputs.map((i, k) => ({ id: i.dataset.id || null, iso: isos[k] }));
  }
  const patch = {
    title,
    location: f.querySelector('#ass-e-loc').value.trim() || null,
    description: f.querySelector('#ass-e-desc').value.trim() || null,
    starts_at,
    retro,
    created_by: E.editId ? f.querySelector('#ass-e-org').value : CTX.me.id,
  };

  btn.disabled = true;
  try {
    let id = E.editId;
    if (id) {
      const prev = CTX.get().events.find((x) => x.id === id);
      if (prev?.created_by === patch.created_by) delete patch.created_by;
      await api.updateEvent(id, patch);
    } else {
      id = (await api.createEvent(patch)).id;
    }
    if (id && (E.editId || wanted.length)) await api.syncDates(id, wanted, CTX.get().dates.filter((d) => d.event_id === id));
    if (!E.editId && !retro) await api.announceNew(id);
    toast(E.editId ? 'Sortie mise à jour.' : 'Sortie créée. Le gang est prévenu.', 'ok');
    E.dlg.close();
    await CTX.reload();
  } catch (ex) {
    fail(`Enregistrement impossible : ${errMsg(ex)}`);
  } finally { btn.disabled = false; }
}

/* ---------- Gestion : inscriptions, votes, date retenue ---------- */
function buildDetail() {
  const dlg = document.createElement('dialog');
  dlg.id = 'ass-detail';
  dlg.className = 'hg-dialog ass-dlg ass-dlg-wide';
  dlg.setAttribute('aria-labelledby', 'ass-d-title');
  dlg.innerHTML = `<div class="ass-dlg-head">
      <h2 class="dialog-title" id="ass-d-title">Sortie</h2>
      <button class="btn btn-ghost btn-sm" type="button" data-close>Fermer</button>
    </div>
    <div id="ass-d-body" class="ass-d-body"></div>`;
  D.body = dlg.querySelector('#ass-d-body');
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  D.body.addEventListener('click', onDetailClick);
  D.body.addEventListener('change', onDetailChange);
  D.body.addEventListener('submit', onDetailSubmit);
  dlg.addEventListener('close', () => { D.id = null; restoreFocus(D); });
  return dlg;
}

export function openDetail(eventId, opener = null) {
  D.id = eventId;
  D.opener = opener;
  renderDetail();
  D.dlg.showModal();
  D.dlg.querySelector('#ass-d-title').focus();
}

/** Redessine la fenêtre de gestion si elle est ouverte (après un rechargement). */
export function refreshDetail() {
  if (!D.dlg?.open) return;
  renderDetail();
  applyPendingFocus();
}

const dateFmt = (iso) => fmtDateTime(iso);

function renderDetail() {
  const S = CTX.get();
  const ev = S.events.find((x) => x.id === D.id);
  if (!ev) { D.dlg.close(); return; }
  const dates = S.dates.filter((d) => d.event_id === ev.id);
  const ids = new Set(S.rsvps.filter((r) => r.event_id === ev.id).map((r) => r.user_id));
  const members = [...S.members.values()].sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
  const pseudo = (id) => memberName(S.members, id);
  const retained = (d) => ev.starts_at && new Date(d.proposed_at).getTime() === new Date(ev.starts_at).getTime();
  D.dlg.querySelector('#ass-d-title').textContent = ev.title;

  const groups = Object.fromEntries(RSVP_ORDER.map((s) => [s, []]));
  for (const r of S.rsvps) if (r.event_id === ev.id && groups[r.status] && S.members.has(r.user_id)) groups[r.status].push(r.user_id);
  const total = Object.values(groups).reduce((n, l) => n + l.length, 0);

  const rsvpList = RSVP_ORDER.map((s) => {
    const list = groups[s].sort((a, b) => pseudo(a).localeCompare(pseudo(b), 'fr'));
    const items = list.map((uid) => `<li class="ass-person">
        <span class="ass-person-name">${esc(pseudo(uid))}</span>
        <label class="visually-hidden" for="ass-st-${esc(uid)}">Réponse de ${esc(pseudo(uid))}</label>
        <select id="ass-st-${esc(uid)}" data-rsvp-user="${esc(uid)}" data-key="st:${esc(uid)}">
          ${RSVP_ORDER.map((v) => `<option value="${v}"${v === s ? ' selected' : ''}>${esc(RSVP_LABEL[v])}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" type="button" data-act="rm-rsvp" data-user="${esc(uid)}" data-key="rm:${esc(uid)}"
          aria-label="Retirer ${esc(pseudo(uid))} de la sortie">Retirer</button>
      </li>`).join('');
    return `<div class="ass-rsvp-group">
      <h4 class="ass-h-sm">${esc(RSVP_LABEL[s])} <span class="muted">(${list.length})</span></h4>
      ${items ? `<ul class="ass-people">${items}</ul>` : '<p class="small muted">Personne pour l\'instant.</p>'}
    </div>`;
  }).join('');

  const addable = members.filter((m) => !ids.has(m.id));
  const addRsvp = addable.length ? `<form class="ass-inline" data-form="add-rsvp">
      <div class="field"><label for="ass-d-add-user">Ajouter un membre</label>
        <select id="ass-d-add-user" name="user">${addable.map((m) => `<option value="${esc(m.id)}">${esc(m.pseudo)}</option>`).join('')}</select></div>
      <div class="field"><label for="ass-d-add-status">Réponse</label>
        <select id="ass-d-add-status" name="status">${RSVP_ORDER.map((v) => `<option value="${v}">${esc(RSVP_LABEL[v])}</option>`).join('')}</select></div>
      <button class="btn btn-primary btn-sm" type="submit">Ajouter</button>
    </form>` : '<p class="small muted">Tous les membres sont déjà sur la liste.</p>';

  const dateList = dates.map((d) => {
    const vs = S.votes.filter((v) => v.date_id === d.id && S.members.has(v.user_id));
    const voted = new Set(vs.map((v) => v.user_id));
    const chips = vs.map((v) => `<li class="ass-chip"><span>${esc(pseudo(v.user_id))}</span>
        <button class="ass-chip-x" type="button" data-act="rm-vote" data-date="${esc(d.id)}" data-user="${esc(v.user_id)}"
          data-key="vx:${esc(d.id)}:${esc(v.user_id)}" aria-label="Retirer le vote de ${esc(pseudo(v.user_id))} pour le ${esc(dateFmt(d.proposed_at))}">×</button></li>`).join('');
    const voters = members.filter((m) => !voted.has(m.id));
    return `<li class="ass-date${retained(d) ? ' is-retained' : ''}">
      <div class="ass-date-main">
        <strong>${esc(dateFmt(d.proposed_at))}</strong>
        <span class="small muted">${pluralCount(vs.length, 'vote', 'votes')}</span>
        ${retained(d) ? '<span class="ass-tag ass-tag-ok">Date retenue</span>' : ''}
      </div>
      ${chips ? `<ul class="ass-chips" aria-label="Votants">${chips}</ul>` : ''}
      <div class="ass-date-actions">
        ${voters.length ? `<form class="ass-inline" data-form="add-vote" data-date="${esc(d.id)}">
          <div class="field"><label for="ass-v-${esc(d.id)}">Voter à la place de</label>
            <select id="ass-v-${esc(d.id)}" name="user">${voters.map((m) => `<option value="${esc(m.id)}">${esc(m.pseudo)}</option>`).join('')}</select></div>
          <button class="btn btn-ghost btn-sm" type="submit">Ajouter le vote</button>
        </form>` : ''}
        <button class="btn btn-ghost btn-sm" type="button" data-act="fix" data-date="${esc(d.id)}" data-key="fix:${esc(d.id)}"
          aria-label="Fixer la sortie au ${esc(dateFmt(d.proposed_at))}">Fixer cette date</button>
      </div>
    </li>`;
  }).join('');

  D.body.innerHTML = `
    <p class="small muted ass-d-summary">${esc(whenLabel(ev))}${ev.location ? ` · ${esc(ev.location)}` : ''} · ${esc(statusOf(ev).label)}</p>
    <section class="ass-d-sec" aria-labelledby="ass-d-rsvp-h">
      <h3 class="ass-h" id="ass-d-rsvp-h">Inscriptions <span class="muted">· ${total}</span></h3>
      ${rsvpList}
      ${addRsvp}
    </section>
    <section class="ass-d-sec" aria-labelledby="ass-d-dates-h">
      <h3 class="ass-h" id="ass-d-dates-h">Dates proposées <span class="muted">· ${dates.length}</span></h3>
      ${dates.length ? `<ol class="ass-dates-list">${dateList}</ol>` : '<p class="small muted">Aucune date proposée. Sans date fixée, la sortie reste à caler.</p>'}
    </section>`;
}

// Après une action, on rend le focus au contrôle concerné (il a été remplacé par le redessin).
let pendingFocus = null;
function focusAfterRender(key) { pendingFocus = key; }
export function applyPendingFocus() {
  if (!pendingFocus || !D.dlg?.open) return;
  const el = [...D.body.querySelectorAll('[data-key]')].find((x) => x.dataset.key === pendingFocus);
  (el || D.dlg.querySelector('#ass-d-title'))?.focus();
  pendingFocus = null;
}

async function run(el, key, fn, okMsg) {
  if (el) el.disabled = true;
  focusAfterRender(key);
  try {
    await fn();
    if (okMsg) toast(okMsg, 'ok');
    await CTX.reload();
  } catch (ex) {
    toast(`Action impossible : ${errMsg(ex)}`, 'error');
    if (el) el.disabled = false;
    pendingFocus = null;
  }
}

function onDetailClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const { act, user, date } = b.dataset;
  if (act === 'rm-rsvp') return run(b, `rm:${user}`, () => api.removeRsvp(D.id, user), 'Membre retiré de la sortie.');
  if (act === 'rm-vote') return run(b, `vx:${date}:${user}`, () => api.setVote(date, user, false), 'Vote retiré.');
  if (act === 'fix') return fixDate(date, b);
}

function onDetailChange(e) {
  const sel = e.target.closest('select[data-rsvp-user]');
  if (sel) run(sel, `st:${sel.dataset.rsvpUser}`, () => api.setRsvp(D.id, sel.dataset.rsvpUser, sel.value), 'Réponse mise à jour.');
}

function onDetailSubmit(e) {
  const f = e.target;
  if (f.dataset.form === 'add-rsvp') {
    e.preventDefault();
    const user = f.elements.user.value, status = f.elements.status.value;
    const btn = f.querySelector('button[type="submit"]');
    return run(btn, `st:${user}`, () => api.setRsvp(D.id, user, status), 'Membre ajouté à la sortie.');
  }
  if (f.dataset.form === 'add-vote') {
    e.preventDefault();
    const date = f.dataset.date, user = f.elements.user.value;
    const btn = f.querySelector('button[type="submit"]');
    return run(btn, `vx:${date}:${user}`, () => api.setVote(date, user, true), 'Vote ajouté.');
  }
}

async function fixDate(dateId, btn) {
  const S = CTX.get();
  const d = S.dates.find((x) => x.id === dateId);
  const ev = S.events.find((x) => x.id === D.id);
  if (!d || !ev) return;
  const ok = await confirmBox(
    `Fixer la sortie « ${ev.title} » au ${dateFmt(d.proposed_at)} ?`,
    'La date devient la date retenue. Les dates proposées restent visibles.',
    { ok: 'Fixer la date' });
  if (!ok) return;
  await run(btn, `fix:${dateId}`, () => api.fixDate(ev.id, d.proposed_at), 'Date fixée.');
}

/* ---------- Focus au retour ---------- */
function restoreFocus(W) {
  const el = W.opener;
  W.opener = null;
  if (el?.isConnected) el.focus();
  else document.querySelector('#ass-list')?.focus(); // le bouton d'origine a été redessiné : on revient à la liste
}
