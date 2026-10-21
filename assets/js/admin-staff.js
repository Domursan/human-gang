// ===== Humane Gang : administration : section « Staff » (Pilotage > Staff, administrateur seulement) =====
// Colonne 2 : membres du Staff (Actifs / Inactifs, « + Ajouter au Staff »). Zone principale : fiche du membre
// (en-tête, permissions par domaine en cases à cocher, barre d'enregistrement, désactiver / réactiver).
// Panneau d'infos : ajouté par, date, dernières actions du membre dans le journal.
// Écritures : hg_staff_set uniquement (journalisée côté base). Jamais de suppression.
import { sb, toast, errMsg, esc, avatarHtml } from './core.js';
import { confirmBox } from './ui-confirm.js';
import { onTableChange } from './admin/live.js';
import { createList } from './admin/ui/list.js';
import { renderDetailHeader } from './admin/ui/detail-header.js';
import { renderInfoPanel } from './admin/ui/info-panel.js';
import { shortDate } from './admin/ui/time.js';
import { actionLabel } from './admin-log.js';

// Regroupement des permissions dans la fiche (les clés absentes du catalogue vont dans « Autres »)
const GROUPS = [
  ['Communauté', ['membres', 'evenements', 'souvenirs', 'secret_santa'], 'var(--slate)'],
  ['Contenu du site', ['cartes', 'badges', 'themes'], 'var(--plum)'],
  ['Messages et support', ['messages', 'support'], 'var(--sage)'],
  ['Technique', ['bot', 'reglages', 'journal'], 'var(--rose)'],
];

const ST = {
  root: null,         // zone principale (fiche)
  catalog: [],        // [{key,label,description,sort}]
  staff: [],          // hg_staff_list()
  candidates: null,   // membres qui peuvent être ajoutés (chargés à l'ouverture de l'ajout)
  busy: false,
  sel: null,          // uid du membre affiché
  draft: null,        // { uid, perms: Set } : permissions en cours de modification
  recent: [],         // dernières actions du membre sélectionné (journal)
  recentFor: null,
  list: null,         // createList de la colonne 2
  infoEl: null, info: null, dhead: null,
};

const labelOf = (k) => ST.catalog.find((c) => c.key === k)?.label ?? k;
/** Libellé d'une permission (la clé si le catalogue n'est pas encore chargé). */
export const permLabel = labelOf;

const selRow = () => ST.staff.find((s) => s.user_id === ST.sel) || null;
const memberOf = (s) => ({ pseudo: s.pseudo, avatar_url: s.avatar_url, color: s.color });
const permCount = (s) => s.perms?.length ?? 0;

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

async function loadRecent(uid) {
  const res = await sb.from('hg_admin_log').select('id, admin_id, action, target_user, target_ref, created_at')
    .or(`admin_id.eq.${uid},target_user.eq.${uid}`).order('created_at', { ascending: false }).limit(6);
  if (res.error) throw res.error;
  ST.recent = (res.data ?? []).filter((r) => r.admin_id === uid || r.target_user === uid).slice(0, 5);
  ST.recentFor = uid;
}

/* ---------- Colonne 2 : liste ---------- */
function itemsOf() {
  return ST.staff.map((s) => ({
    id: s.user_id, member: memberOf(s), name: s.pseudo, active: !!s.active,
    title: `${permCount(s)} permission${permCount(s) > 1 ? 's' : ''}`,
    status: { label: s.active ? 'Actif' : 'Inactif', tone: s.active ? 'done' : 'muted' },
  })).sort((a, b) => Number(b.active) - Number(a.active) || String(a.name).localeCompare(String(b.name), 'fr'));
}

/** Colonne 2 (registerSub list) */
export function listStaff(el) {
  el.innerHTML = `<div class="stf-col">
      <button class="btn btn-primary stf-add" type="button" data-staff-add>+ Ajouter au Staff</button>
      <div class="stf-listhost"></div>
      <p class="stf-foot small muted">Le Staff gère les domaines que tu lui accordes. Il ne peut ni gérer le Staff, ni changer les administrateurs, ni utiliser le mode sans limite.</p>
    </div>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-staff-add]');
    if (!b) return;
    ST.candidates = null;
    openForm(null, b);
  });
  ST.list = createList(el.querySelector('.stf-listhost'), {
    items: itemsOf(),
    filters: [
      { id: 'actifs', label: 'Actifs', test: (it) => it.active },
      { id: 'inactifs', label: 'Inactifs', test: (it) => !it.active },
    ],
    label: 'Membres du Staff',
    empty: 'Aucun membre du Staff pour l’instant.',
    search: { placeholder: 'Rechercher un membre', label: 'Rechercher un membre' },
    selectedId: ST.sel,
    onSelect: pick,
  });
}

/** Choix d'un membre dans la liste : la fiche suit l'URL (#pilotage/staff/<uid>). */
async function pick(it) {
  if (it.id === ST.sel) return;
  if (dirtyCount() && !(await confirmBox('Modifications non enregistrées', 'Quitter cette fiche sans enregistrer les permissions ?', { ok: 'Quitter', danger: true }))) {
    ST.list?.select(ST.sel);
    return;
  }
  location.hash = `#pilotage/staff/${it.id}`;
}

/** Affichage d'un membre (registerSub open, à chaque visite de #pilotage/staff[/uid]). */
export async function openStaff(_el, { id } = {}) {
  const next = id ? String(id) : null;
  if (next === ST.sel && ST.draft) { ST.list?.select(next); return; }
  ST.sel = next;
  ST.draft = null;
  renderDetail();
  ST.list?.select(next);
  if (next && ST.recentFor !== next) {
    try { await loadRecent(next); } catch (e) { console.warn('[staff] journal', e); ST.recent = []; ST.recentFor = next; }
    if (ST.sel === next) renderInfo();
  }
}

/* ---------- Panneau d'infos ---------- */
export function infoStaff(el) {
  ST.infoEl = el;
  renderInfo();
}

function renderInfo() {
  const el = ST.infoEl;
  if (!el) return;
  ST.info?.destroy();
  ST.info = null;
  const s = selRow();
  if (!s) {
    el.innerHTML = '<p class="ui-info-empty">Choisis un membre du Staff pour voir sa fiche.</p>';
    return;
  }
  const loaded = ST.recentFor === s.user_id;
  ST.info = renderInfoPanel(el, {
    member: memberOf(s),
    statsTitle: 'Fiche Staff',
    stats: [
      { value: permCount(s), label: 'permissions' },
      { value: s.active ? 'Oui' : 'Non', label: 'actif' },
      { value: s.added_by_pseudo || '—', label: 'ajouté par' },
      { value: s.created_at ? shortDate(s.created_at) : '—', label: 'ajouté le' },
    ],
    historyTitle: 'Dernières actions',
    emptyHistory: loaded ? 'Aucune action journalisée pour ce membre.' : 'Chargement…',
    history: loaded ? ST.recent.map((r) => ({
      id: r.id,
      title: `${actionLabel(r.action)} · ${r.admin_id === s.user_id ? 'par lui' : 'sur lui'}`,
      status: null,
      at: r.created_at,
    })) : [],
  });
}

/* ---------- Zone principale : fiche ---------- */
function groupsOf() {
  const byKey = new Map(ST.catalog.map((c) => [c.key, c]));
  const used = new Set();
  const out = GROUPS.map(([title, keys, color]) => {
    const items = keys.map((k) => byKey.get(k)).filter(Boolean);
    items.forEach((c) => used.add(c.key));
    return { title, color, items };
  });
  out.push({ title: 'Autres', color: 'var(--sand)', items: ST.catalog.filter((c) => !used.has(c.key)) });
  return out.filter((g) => g.items.length);
}

function groupsHtml() {
  return groupsOf().map((g) => `<section class="stf-card" style="--dot:${g.color}">
      <h3 class="stf-card-t"><span class="stf-dot" aria-hidden="true"></span>${esc(g.title)}</h3>
      ${g.items.map((c) => `<label class="stf-perm">
        <input type="checkbox" data-perm-key="${esc(c.key)}"${ST.draft.perms.has(c.key) ? ' checked' : ''}>
        <span><strong>${esc(c.label)}</strong><small>${esc(c.description)}</small></span>
      </label>`).join('')}
    </section>`).join('');
}

/** Nombre de permissions modifiées par rapport à l'enregistrement. */
function dirtyCount() {
  const s = selRow();
  if (!s || !ST.draft || ST.draft.uid !== s.user_id) return 0;
  const saved = new Set(s.perms ?? []);
  let n = 0;
  for (const k of ST.draft.perms) if (!saved.has(k)) n++;
  for (const k of saved) if (!ST.draft.perms.has(k)) n++;
  return n;
}

function paintBar() {
  const bar = ST.root?.querySelector('#stf-bar');
  if (!bar) return;
  const n = dirtyCount();
  bar.innerHTML = `<span class="stf-dirty${n ? ' is-dirty' : ''}" role="status">${n ? `${n} modification${n > 1 ? 's' : ''} non enregistrée${n > 1 ? 's' : ''}` : 'Aucune modification en attente'}</span>
    <div class="btn-row">
      <button class="btn btn-ghost" type="button" data-staff-cancel${n ? '' : ' disabled'}>Annuler</button>
      <button class="btn btn-primary" type="button" data-staff-save${n ? '' : ' disabled'}>Enregistrer</button>
    </div>`;
}

function renderDetail() {
  const host = ST.root;
  if (!host) return;
  ST.dhead?.destroy();
  ST.dhead = null;
  const s = selRow();
  if (!s) {
    host.innerHTML = '<div class="empty stf-empty">Choisis un membre dans la liste, ou ajoute-en un au Staff.</div>';
    renderInfo();
    return;
  }
  if (!ST.draft || ST.draft.uid !== s.user_id) ST.draft = { uid: s.user_id, perms: new Set(s.perms ?? []) };
  host.innerHTML = `<div class="stf-detail">
      <div id="stf-head"></div>
      ${s.note ? `<p class="stf-note">${esc(s.note)}</p>` : ''}
      <div class="stf-groups">${groupsHtml()}</div>
      <div class="stf-bar" id="stf-bar"></div>
    </div>`;
  const sub = [s.active ? 'Membre du Staff' : 'Membre du Staff · inactif',
    s.added_by_pseudo ? `ajouté par ${s.added_by_pseudo}` : '',
    s.created_at ? `le ${shortDate(s.created_at)}` : ''].filter(Boolean).join(' · ');
  ST.dhead = renderDetailHeader(host.querySelector('#stf-head'), {
    member: memberOf(s),
    title: s.pseudo,
    subtitle: sub,
    actions: [
      { label: 'Modifier la note', onClick: () => openForm(s, null) },
      s.active
        ? { label: 'Désactiver', onClick: () => toggleActive(s.user_id, false, null) }
        : { label: 'Réactiver', onClick: () => toggleActive(s.user_id, true, null) },
    ],
  });
  paintBar();
  renderInfo();
}

/** Après une lecture du Staff : colonne 2 et fiche à jour. Le brouillon est gardé sauf si reset. */
function refresh({ reset = false } = {}) {
  if (reset) ST.draft = null;
  ST.list?.update(itemsOf());
  if (ST.sel) ST.list?.select(ST.sel);
  renderDetail();
}

/* ---------- Écriture ---------- */
async function saveStaff({ uid, perms, active, note }) {
  const res = await sb.rpc('hg_staff_set', { p_user: uid, p_perms: perms, p_active: active, p_note: note ?? null });
  if (res.error) throw res.error;
  await loadStaff(); // relecture : ajouté par / date à jour
  refresh({ reset: true });
}

async function withBusy(btn, fn) {
  if (ST.busy) return;
  ST.busy = true;
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { toast(errMsg(e), 'error'); }
  finally { ST.busy = false; if (btn) btn.disabled = false; }
}

/** Enregistre les permissions cochées dans la fiche (le statut actif et la note sont gardés). */
async function saveDraft(btn) {
  const s = selRow();
  if (!s || !ST.draft) return;
  const perms = [...ST.draft.perms];
  if (!perms.length) {
    toast('Coche au moins une permission. Pour retirer l’accès, désactive la personne.', 'error');
    return;
  }
  await withBusy(btn, async () => {
    await saveStaff({ uid: s.user_id, perms, active: s.active, note: s.note ?? null });
    toast('Permissions enregistrées', 'ok');
  });
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
    await saveStaff({ uid, perms: row.perms, active, note: row.note ?? null });
    toast(active ? `${row.pseudo} est de nouveau dans le Staff` : `${row.pseudo} a été désactivé`, 'ok');
  });
}

/* ---------- Dialogue : ajout ou modification de la note ---------- */
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
      if (!editing) location.hash = `#pilotage/staff/${uid}`; // la fiche du nouveau membre s'ouvre
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
  if (btn) btn.disabled = true;
  try { return await fn(); } finally { if (btn) btn.disabled = false; }
}

/* ---------- Montage (zone principale) ---------- */
export async function mountStaffSection(root) {
  if (!root) return;
  ST.root = root;
  root.addEventListener('change', (e) => {
    const cb = e.target.closest?.('input[data-perm-key]');
    if (!cb || !ST.draft) return;
    if (cb.checked) ST.draft.perms.add(cb.dataset.permKey); else ST.draft.perms.delete(cb.dataset.permKey);
    paintBar();
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.matches('[data-staff-cancel]')) { ST.draft = null; renderDetail(); return; }
    if (b.matches('[data-staff-save]')) { saveDraft(b); return; }
    if (b.dataset.staffRetry) load();
  });
  onTableChange('staff', ['hg_staff'], async () => { // temps réel : relecture du Staff, brouillon conservé
    try { await loadStaff(); refresh(); } catch (e) { console.warn('[staff] temps réel', e); }
  });
  await load();
}

async function load() {
  ST.root.innerHTML = '<div class="empty">Chargement du Staff…</div>';
  try {
    await loadStaff();
    ST.draft = null;
    renderDetail();
  } catch (e) {
    ST.root.innerHTML = `<div class="empty">Impossible de charger le Staff : ${esc(errMsg(e))}
      <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-staff-retry="1">Réessayer</button></div></div>`;
  }
}
