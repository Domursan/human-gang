// ===== Humane Gang — administration : section « Staff » (administrateur seulement) =====
// Liste des membres Staff, ajout (choix d'un membre, permissions, note), modification des permissions,
// désactivation / réactivation (jamais de suppression). Toutes les écritures passent par hg_staff_set,
// journalisée côté base ; la liste est relue après chaque écriture, sans recharger la page.
import { sb, toast, errMsg, esc, fmtDate, avatarHtml } from './core.js';
import { confirmBox } from './ui-confirm.js';
import { matches, searchHtml, setCount, emptyHtml, SEARCH_DELAY } from './admin/list-tools.js';

// Regroupement des permissions dans le formulaire (les clés absentes du catalogue vont dans « Autres »)
const GROUPS = [
  ['Communauté', ['membres', 'evenements', 'souvenirs', 'secret_santa']],
  ['Contenu du site', ['cartes', 'badges', 'themes']],
  ['Messages et support', ['messages', 'support']],
  ['Technique', ['bot', 'reglages', 'journal']],
];

const ST = {
  root: null,
  catalog: [],        // [{key,label,description,sort}]
  staff: [],          // hg_staff_list()
  candidates: null,   // membres qui peuvent être ajoutés (chargés à l'ouverture de l'ajout)
  busy: false,
  q: '',              // recherche dans la liste (pseudo, permissions, note)
};

/** Membres retenus par la recherche (pseudo, permissions accordées, note). */
const shownStaff = () => ST.staff.filter((s) => matches(ST.q, s.pseudo, (s.perms ?? []).map(labelOf).join(' '), s.note));
/** Liste seule, pour la mettre à jour pendant la frappe sans perdre le focus. */
function countStaff() {
  setCount(document.getElementById('staff-search-count'), shownStaff().length, ST.staff.length, ST.q, ['membre', 'membres']);
}
function listHtml() {
  const rows = shownStaff();
  if (!ST.staff.length) return '<div class="empty">Aucun membre du Staff pour l’instant.</div>';
  return rows.length ? `<div class="staff-list">${rows.map(rowHtml).join('')}</div>` : emptyHtml(ST.q, 'Aucun membre ne correspond.');
}

const labelOf = (k) => ST.catalog.find((c) => c.key === k)?.label ?? k;
/** Libellé d'une permission (la clé si le catalogue n'est pas encore chargé). */
export const permLabel = labelOf;
const pillsHtml = (perms) => (perms?.length
  ? perms.map((k) => `<span class="pill pill-muted staff-perm-pill">${esc(labelOf(k))}</span>`).join('')
  : '<span class="small muted">Aucune permission</span>');

async function loadStaff() {
  const [cat, list] = await Promise.all([
    sb.from('hg_perm_catalog').select('key, label, description, sort').order('sort'),
    sb.rpc('hg_staff_list'),
  ]);
  if (cat.error) throw cat.error;
  if (list.error) throw list.error;
  ST.catalog = cat.data ?? [];
  ST.staff = list.data ?? [];
}

function render() {
  const actifs = ST.staff.filter((s) => s.active).length;
  ST.root.innerHTML = `
    <div class="staff-head">
      <p class="small muted">Le Staff gère les domaines que tu lui accordes. Il ne peut ni gérer le Staff, ni changer les administrateurs, ni utiliser le mode sans limite.</p>
      <button class="btn btn-primary" type="button" data-staff-add>Ajouter un membre au Staff</button>
    </div>
    <div class="card staff-card">
      <h3 class="card-title">Membres du Staff <span class="muted small">(${actifs} actif${actifs > 1 ? 's' : ''} sur ${ST.staff.length})</span></h3>
      ${ST.staff.length ? searchHtml({ id: 'staff-search', label: 'Rechercher au Staff', placeholder: 'Pseudo, permission ou note…', value: ST.q }) : ''}
      <div id="staff-list">${listHtml()}</div>
    </div>`;
  countStaff();
}

function rowHtml(s) {
  const who = { pseudo: s.pseudo, avatar_url: s.avatar_url, color: s.color };
  const since = s.created_at ? `ajouté${s.added_by_pseudo ? ` par ${esc(s.added_by_pseudo)}` : ''} le ${esc(fmtDate(s.created_at))}` : '';
  return `
    <article class="staff-row${s.active ? '' : ' is-off'}" data-uid="${esc(s.user_id)}">
      <div class="staff-row-ident">${avatarHtml(who, 44)}</div>
      <div class="staff-row-main">
        <div class="staff-row-top">
          <strong class="staff-name">${esc(s.pseudo)}</strong>
          <span class="pill ${s.active ? 'pill-ok' : 'pill-muted'}">${s.active ? 'Actif' : 'Inactif'}</span>
        </div>
        <div class="staff-pills">${pillsHtml(s.perms)}</div>
        <div class="small muted">${since}</div>
        ${s.note ? `<p class="staff-note small">${esc(s.note)}</p>` : ''}
      </div>
      <div class="staff-row-actions btn-row">
        <button class="btn btn-ghost btn-sm" type="button" data-staff-edit="${esc(s.user_id)}" aria-label="Modifier les permissions de ${esc(s.pseudo)}">Modifier</button>
        ${s.active
          ? `<button class="btn btn-ghost btn-sm" type="button" data-staff-off="${esc(s.user_id)}" aria-label="Désactiver ${esc(s.pseudo)}">Désactiver</button>`
          : `<button class="btn btn-sand btn-sm" type="button" data-staff-on="${esc(s.user_id)}" aria-label="Réactiver ${esc(s.pseudo)}">Réactiver</button>`}
      </div>
    </article>`;
}

/* ---------- Écriture ---------- */
async function saveStaff({ uid, perms, active, note }) {
  const res = await sb.rpc('hg_staff_set', { p_user: uid, p_perms: perms, p_active: active, p_note: note ?? null });
  if (res.error) throw res.error;
  await loadStaff(); // relecture : ajouté par / date à jour
  render();
}

async function withBusy(btn, fn) {
  if (ST.busy) return;
  ST.busy = true;
  if (btn) { btn.disabled = true; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); }
  catch (e) { toast(errMsg(e), 'error'); }
  finally { ST.busy = false; if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); } }
}

async function toggleActive(uid, active, btn) {
  const row = ST.staff.find((s) => s.user_id === uid);
  if (!row) return;
  if (!active) {
    const ok = await confirmBox(
      `Désactiver ${row.pseudo} du Staff ?`,
      'Cette personne ne pourra plus ouvrir le panel ni agir sur les sections. Ses permissions sont gardées : tu pourras la réactiver.',
      { ok: 'Désactiver', danger: true });
    if (!ok) return;
  }
  await withBusy(btn, async () => {
    await saveStaff({ uid, perms: row.perms, active, note: null });
    toast(active ? `${row.pseudo} est de nouveau dans le Staff` : `${row.pseudo} a été désactivé`, 'ok');
  });
}

/* ---------- Dialogue : ajout ou modification ---------- */
async function loadCandidates() {
  const [members, accounts] = await Promise.all([sb.rpc('hg_members'), sb.rpc('hg_admin_accounts')]);
  if (members.error) throw members.error;
  if (accounts.error) throw accounts.error;
  const excluded = new Set((accounts.data ?? []).filter((a) => a.is_admin || a.is_ghost).map((a) => a.id));
  const staffIds = new Set(ST.staff.map((s) => s.user_id));
  ST.candidates = (members.data ?? []).filter((m) => !excluded.has(m.id) && !staffIds.has(m.id))
    .sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo), 'fr'));
}

function permFieldsetsHtml(checked) {
  const byKey = new Map(ST.catalog.map((c) => [c.key, c]));
  const used = new Set();
  const block = (title, keys) => {
    const items = keys.map((k) => byKey.get(k)).filter(Boolean);
    items.forEach((c) => used.add(c.key));
    if (!items.length) return '';
    return `<fieldset class="staff-group">
      <legend>${esc(title)}</legend>
      ${items.map((c) => `<label class="staff-perm">
        <input type="checkbox" name="perm" value="${esc(c.key)}"${checked.includes(c.key) ? ' checked' : ''}>
        <span><strong>${esc(c.label)}</strong><span class="small muted">${esc(c.description)}</span></span>
      </label>`).join('')}
    </fieldset>`;
  };
  const groups = GROUPS.map(([t, keys]) => block(t, keys)).join(''); // remplit « used » avant le reste
  const rest = ST.catalog.filter((c) => !used.has(c.key)).map((c) => c.key);
  return groups + block('Autres', rest);
}

function dialogEl() {
  let dlg = document.getElementById('staff-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'staff-dialog';
    dlg.className = 'hg-dialog staff-dlg';
    document.body.append(dlg);
  }
  return dlg;
}

/** Ouvre le formulaire. row = membre Staff existant (modification), sinon ajout d'un membre. */
async function openForm(row, btn) {
  const dlg = dialogEl();
  const editing = !!row;
  const checked = row ? row.perms : [];
  let picker = '';
  if (!editing) {
    if (!ST.candidates) {
      try { await withPending(btn, loadCandidates); }
      catch (e) { toast(errMsg(e), 'error'); return; }
    }
    picker = `<div class="field staff-search">
        <label for="staff-q">Chercher un membre</label>
        <input id="staff-q" type="search" autocomplete="off" placeholder="Pseudo">
      </div>
      <div class="staff-picks" role="radiogroup" aria-label="Membres à ajouter" id="staff-picks">
        ${ST.candidates.length ? ST.candidates.map((m) => `<label class="staff-pick">
            <input type="radio" name="uid" value="${esc(m.id)}" required>
            ${avatarHtml(m, 28)}<span>${esc(m.pseudo)}</span>
          </label>`).join('') : '<div class="empty">Tous les membres sont déjà dans le Staff.</div>'}
      </div>`;
  }
  dlg.innerHTML = `
    <form method="dialog" class="stack staff-form" novalidate>
      <h2 class="dialog-title">${editing ? `Permissions de ${esc(row.pseudo)}` : 'Ajouter un membre au Staff'}</h2>
      ${editing ? `<input type="hidden" name="uid" value="${esc(row.user_id)}">` : picker}
      <div class="staff-all btn-row">
        <button class="btn btn-ghost btn-sm" type="button" data-all="1">Tout cocher</button>
        <button class="btn btn-ghost btn-sm" type="button" data-all="0">Tout décocher</button>
      </div>
      <div class="staff-groups">${permFieldsetsHtml(checked)}</div>
      <div class="field">
        <label for="staff-note">Note (facultative)</label>
        <input id="staff-note" name="note" type="text" maxlength="200" value="${esc(row?.note ?? '')}" autocomplete="off" placeholder="Ex. aide sur les cartes pendant l’été">
      </div>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row dialog-actions">
        <button class="btn btn-ghost" type="button" data-cancel>Annuler</button>
        <button class="btn btn-primary" type="submit">${editing ? 'Enregistrer' : 'Ajouter au Staff'}</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  const err = dlg.querySelector('.form-error');
  const fail = (msg) => { err.textContent = msg; err.hidden = false; };

  dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
  dlg.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', () => {
    dlg.querySelectorAll('input[name="perm"]').forEach((c) => { c.checked = b.dataset.all === '1'; });
  }));
  const q = dlg.querySelector('#staff-q');
  q?.addEventListener('input', () => {
    const needle = q.value.trim().toLowerCase();
    dlg.querySelectorAll('.staff-pick').forEach((l) => { l.hidden = !!needle && !l.textContent.toLowerCase().includes(needle); });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const uid = editing ? row.user_id : form.querySelector('input[name="uid"]:checked')?.value;
    if (!uid) return fail('Choisis un membre dans la liste.');
    const perms = [...form.querySelectorAll('input[name="perm"]:checked')].map((c) => c.value);
    if (!perms.length) return fail('Coche au moins une permission. Pour retirer l’accès, désactive la personne depuis la liste.');
    const note = form.note.value.trim();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await saveStaff({ uid, perms, active: editing ? row.active : true, note });
      toast(editing ? 'Permissions mises à jour' : 'Membre ajouté au Staff', 'ok');
      dlg.close();
    } catch (ex) {
      fail(errMsg(ex));
    } finally {
      submit.disabled = false;
    }
  });
  dlg.addEventListener('close', () => { dlg.innerHTML = ''; }, { once: true });
  dlg.showModal();
  (q ?? dlg.querySelector('input[name="perm"]'))?.focus();
}

async function withPending(btn, fn) {
  if (btn?.dataset.busy) return;
  if (btn) { btn.disabled = true; btn.dataset.busy = '1'; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); } finally {
    if (btn) { delete btn.dataset.busy; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); btn.disabled = false; }
  }
}

/* ---------- Montage ---------- */
export async function mountStaffSection(root) {
  if (!root) return;
  ST.root = root;
  // Recherche : seule la liste est redessinée (le champ garde le focus)
  let timer = 0;
  root.addEventListener('input', (e) => {
    if (e.target.id !== 'staff-search') return;
    clearTimeout(timer);
    timer = setTimeout(() => { ST.q = e.target.value; const box = root.querySelector('#staff-list'); if (box) box.innerHTML = listHtml(); countStaff(); }, SEARCH_DELAY);
  });
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    if (t.matches('[data-staff-add]')) { ST.candidates = null; return openForm(null, t); }
    if (t.dataset.staffEdit) return openForm(ST.staff.find((s) => s.user_id === t.dataset.staffEdit), t);
    if (t.dataset.staffOff) return toggleActive(t.dataset.staffOff, false, t);
    if (t.dataset.staffOn) return toggleActive(t.dataset.staffOn, true, t);
    if (t.dataset.staffRetry) return load();
  });
  await load();
}

async function load() {
  ST.root.innerHTML = '<div class="empty">Chargement du Staff…</div>';
  try {
    await loadStaff();
    render();
  } catch (e) {
    ST.root.innerHTML = `<div class="empty">Impossible de charger le Staff : ${esc(errMsg(e))}
      <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-staff-retry="1">Réessayer</button></div></div>`;
  }
}
