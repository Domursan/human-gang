// ===== Humane Gang — administration : accès aux pages =====
// Tables : hg_pages(slug, label, mode 'membres'|'admin'|'liste', in_nav, sort) et hg_page_access(page_slug, user_id, allowed).
//  - mode 'membres' : tout le monde sauf les lignes allowed=false (bloqués) ;
//  - mode 'liste'   : seulement les lignes allowed=true (membres choisis) ;
//  - mode 'admin'   : admins seulement. Les admins ont toujours accès à tout.
// Importé par admin.js (section) et admin-accounts.js (onglet « Accès » de la fiche). N'importe que core.js.
import { sb, toast, errMsg, esc, $, $$, avatarHtml } from './core.js';
import { confirmBox } from './ui-confirm.js';
import { svg } from './icons.js';

export const MODES = [
  ['membres', 'Tous les membres'],
  ['admin', 'Admin seulement'],
  ['liste', 'Membres choisis'],
];
const MODE_LABEL = Object.fromEntries(MODES);
// Page de repli : jamais bloquée (la redirection d'une page interdite y mène)
const ALWAYS_OPEN = new Set(['accueil']);

const IC = {
  up: svg('up', { stroke: 2 }),
  down: svg('down', { stroke: 2 }),
  yes: svg('check2', { stroke: 2.4 }),
  no: svg('no', { stroke: 2.2 }),
  close: svg('close', { stroke: 2 }),
  search: svg('search', { stroke: 2 }),
  users: svg('users', { stroke: 2 }),
};

/* ---------- État partagé ---------- */
const AC = {
  pages: [], rows: [], members: [], loaded: false, loading: null, error: null,
  view: 'pages', openSlug: null, q: '', root: null, openMember: null,
};
function check(res) { if (res.error) throw res.error; return res.data; }
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nowIso = () => new Date().toISOString();
const pageBySlug = (slug) => AC.pages.find((p) => p.slug === slug);
const rowOf = (slug, uid) => AC.rows.find((r) => r.page_slug === slug && r.user_id === uid);
function emit() { try { window.dispatchEvent(new CustomEvent('hg:access')); } catch {} }

async function loadPages() {
  AC.pages = (check(await sb.from('hg_pages').select('slug, label, mode, in_nav, sort').order('sort')) ?? [])
    .slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.slug).localeCompare(String(b.slug)));
}
async function loadRows() { AC.rows = check(await sb.from('hg_page_access').select('page_slug, user_id, allowed')) ?? []; }
async function loadMembers() {
  const [acc, mem] = await Promise.all([sb.rpc('hg_admin_accounts'), sb.rpc('hg_members')]);
  const avatars = new Map((mem.data ?? []).map((m) => [m.id, m]));
  AC.members = (check(acc) ?? []).filter((a) => a.pseudo) // sans profil = pas membre
    .map((a) => ({ ...(avatars.get(a.id) || {}), id: a.id, pseudo: a.pseudo, is_admin: !!a.is_admin }))
    .sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo), 'fr'));
}

/** Charge pages, exceptions et membres (une fois, sauf force). Jette en cas d'échec. */
export function ensureAccessData(force = false) {
  if (AC.loaded && !force) return Promise.resolve(AC);
  if (AC.loading && !force) return AC.loading;
  AC.loading = (async () => {
    try {
      await Promise.all([loadPages(), loadRows(), loadMembers()]);
      AC.loaded = true; AC.error = null;
      return AC;
    } catch (e) { AC.error = e; throw e; } finally { AC.loading = null; }
  })();
  return AC.loading;
}
/** Pages déclarées (copie), triées. */
export function accessPages() { return AC.pages.map((p) => ({ ...p })); }

/** Accès effectif d'un membre ({id, is_admin}) à une page. */
export function hasAccess(page, member) {
  if (!page || !member) return false;
  if (member.is_admin) return true;
  const r = rowOf(page.slug, member.id);
  if (page.mode === 'admin') return false;
  if (page.mode === 'liste') return r?.allowed === true;
  return r?.allowed !== false;
}
/** Nombre d'exceptions qui comptent pour le mode courant (bloqués en « membres », autorisés en « liste »). */
function exceptionCount(page) {
  const ids = new Set(AC.members.filter((m) => !m.is_admin).map((m) => m.id));
  if (page.mode === 'membres') return AC.rows.filter((r) => r.page_slug === page.slug && r.allowed === false && ids.has(r.user_id)).length;
  if (page.mode === 'liste') return AC.rows.filter((r) => r.page_slug === page.slug && r.allowed === true && ids.has(r.user_id)).length;
  return 0;
}
const accessCount = (page) => AC.members.filter((m) => hasAccess(page, m)).length;

/**
 * Donne (allow=true) ou retire l'accès d'une liste de membres à une page, selon son mode :
 * 'membres' → retirer = ligne allowed=false, donner = suppression de la ligne ;
 * 'liste'   → donner = ligne allowed=true, retirer = suppression de la ligne.
 */
export async function setAccess(slug, uids, allow) {
  const page = pageBySlug(slug);
  if (!page) throw new Error('Page inconnue.');
  if (page.mode === 'admin') throw new Error('Cette page est réservée aux admins : change d\'abord son mode.');
  if (ALWAYS_OPEN.has(slug)) throw new Error('L\'accueil reste toujours accessible.');
  const ids = [...new Set(uids)].filter((id) => !AC.members.find((m) => m.id === id)?.is_admin);
  if (!ids.length) return;
  const keepRow = page.mode === 'membres' ? !allow : allow;
  if (keepRow) {
    check(await sb.from('hg_page_access').upsert(ids.map((id) => ({ page_slug: slug, user_id: id, allowed: page.mode === 'liste' })), { onConflict: 'page_slug,user_id' }));
  } else {
    check(await sb.from('hg_page_access').delete().eq('page_slug', slug).in('user_id', ids));
  }
  await loadRows();
  emit();
}

async function updatePage(slug, patch) {
  check(await sb.from('hg_pages').update({ ...patch, updated_at: nowIso() }).eq('slug', slug));
  Object.assign(pageBySlug(slug) || {}, patch);
}

/* =========================================================
   Onglet « Accès » de la fiche membre (admin-accounts.js)
   ========================================================= */
/** HTML de l'onglet : accès effectif de ce membre à chaque page, avec interrupteur. */
export function memberAccessHtml(member) {
  if (AC.error && !AC.loaded) return `<div class="empty">Impossible de charger les accès : ${esc(errMsg(AC.error))}</div>`;
  if (!AC.loaded) return '<div class="empty">Chargement des accès…</div>';
  const isAdmin = !!member.is_admin;
  return `
    <p class="small muted">${isAdmin
      ? `${esc(member.pseudo)} est admin : accès à toutes les pages.`
      : `Accès effectif de ${esc(member.pseudo)}. L'interrupteur crée ou retire une exception selon le mode de la page (section « Accès aux pages »).`}</p>
    <ul class="pa-member">${AC.pages.map((p) => {
      const on = hasAccess(p, member);
      const fixed = isAdmin || p.mode === 'admin' || ALWAYS_OPEN.has(p.slug);
      const why = isAdmin ? 'admin' : ALWAYS_OPEN.has(p.slug) ? 'toujours accessible' : p.mode === 'admin' ? 'réservée aux admins' : '';
      const ex = !isAdmin && rowOf(p.slug, member.id) && ((p.mode === 'membres' && rowOf(p.slug, member.id).allowed === false) || (p.mode === 'liste' && rowOf(p.slug, member.id).allowed === true));
      return `<li class="pa-member-row">
        <label class="switch">
          <input type="checkbox" role="switch" data-page-access="${esc(p.slug)}"${on ? ' checked' : ''}${fixed ? ' disabled' : ''}>
          <span class="switch-ui" aria-hidden="true"></span>
          <span class="pa-member-txt"><strong>${esc(p.label)}</strong>
            <span class="small muted">${esc(MODE_LABEL[p.mode] ?? p.mode)}${why ? ` · ${esc(why)}` : ''}${ex ? ' · exception' : ''}</span></span>
        </label>
        <span class="pill ${on ? 'pill-ok' : 'pill-muted'} pa-state">${on ? 'Accès' : 'Pas d\'accès'}</span>
      </li>`;
    }).join('')}</ul>`;
}

/* =========================================================
   Section « Accès aux pages »
   ========================================================= */
function sectionHtml() {
  return `
    <p class="small muted pa-note">Contrôle d'affichage : les liens sont masqués et la page renvoie vers l'accueil ; les données restent protégées par les règles de la base.</p>
    <div class="pa-views" role="group" aria-label="Affichage">
      <button class="chip" type="button" data-pa-view="pages" aria-pressed="${AC.view === 'pages'}">Pages</button>
      <button class="chip" type="button" data-pa-view="matrice" aria-pressed="${AC.view === 'matrice'}">Matrice membres × pages</button>
    </div>
    <div class="card pa-card">${AC.view === 'pages' ? pagesTableHtml() : matrixHtml()}</div>`;
}

function pagesTableHtml() {
  if (!AC.pages.length) return '<div class="empty">Aucune page déclarée.</div>';
  const last = AC.pages.length - 1;
  return `
    <div class="pa-table-wrap">
      <table class="pa-table">
        <caption class="visually-hidden">Pages du site et leurs accès</caption>
        <thead><tr>
          <th scope="col">Ordre</th><th scope="col">Page</th><th scope="col">Qui y a accès</th>
          <th scope="col">Dans le menu</th><th scope="col">Exceptions</th><th scope="col"><span class="visually-hidden">Personnes</span></th>
        </tr></thead>
        <tbody>${AC.pages.map((p, i) => {
          const n = exceptionCount(p), open = ALWAYS_OPEN.has(p.slug);
          const exLabel = p.mode === 'membres' ? `${n} bloqué${n > 1 ? 's' : ''}` : p.mode === 'liste' ? `${n} autorisé${n > 1 ? 's' : ''}` : '—';
          return `<tr data-slug="${esc(p.slug)}">
            <td class="pa-order">
              <button class="btn btn-ghost btn-icon pa-move" type="button" data-pa-move="-1" aria-label="Monter « ${esc(p.label)} »"${i === 0 ? ' disabled' : ''}>${IC.up}</button>
              <button class="btn btn-ghost btn-icon pa-move" type="button" data-pa-move="1" aria-label="Descendre « ${esc(p.label)} »"${i === last ? ' disabled' : ''}>${IC.down}</button>
            </td>
            <th scope="row" class="pa-page"><span class="pa-page-in"><strong>${esc(p.label)}</strong><span class="small muted code-sm">${esc(p.slug)}.html</span></span></th>
            <td>${open
              ? '<span class="pill pill-muted">Toujours accessible</span>'
              : `<div class="field pa-field"><label class="visually-hidden" for="pa-mode-${esc(p.slug)}">Qui a accès à ${esc(p.label)}</label>
                 <select id="pa-mode-${esc(p.slug)}" data-pa-mode>${MODES.map(([v, l]) => `<option value="${v}"${p.mode === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`}</td>
            <td><label class="switch pa-switch"><input type="checkbox" role="switch" data-pa-nav${p.in_nav ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span class="visually-hidden">Afficher « ${esc(p.label)} » dans le menu</span></label></td>
            <td class="pa-count"><span class="${n ? 'pa-count-on' : 'muted'}">${esc(exLabel)}</span><span class="small muted">${accessCount(p)} / ${AC.members.length} avec accès</span></td>
            <td><button class="btn btn-ghost btn-sm" type="button" data-pa-manage="${esc(p.slug)}"${open ? ' disabled' : ''}>${IC.users} Personnes</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
    <p class="small muted">Les admins ont toujours accès à tout. « Dans le menu » : lien dans l'en-tête pour les membres qui y ont accès.</p>`;
}

function matrixHtml() {
  if (!AC.members.length) return '<div class="empty">Aucun membre.</div>';
  return `
    <p class="small muted">Lecture seule. Touche une case ou un titre de colonne pour gérer la page.</p>
    <div class="pa-table-wrap pa-matrix-wrap">
      <table class="pa-matrix">
        <caption class="visually-hidden">Accès de chaque membre à chaque page</caption>
        <thead><tr><th scope="col" class="pa-mx-corner">Membre</th>${AC.pages.map((p) => `
          <th scope="col"><button class="pa-mx-head" type="button" data-pa-manage="${esc(p.slug)}"${ALWAYS_OPEN.has(p.slug) ? ' disabled' : ''} title="${esc(MODE_LABEL[p.mode] ?? p.mode)}">
            <span>${esc(p.label)}</span><span class="pa-mx-mode pa-mode-${esc(p.mode)}">${esc(MODE_LABEL[p.mode] ?? p.mode)}</span></button></th>`).join('')}</tr></thead>
        <tbody>${AC.members.map((m) => `<tr>
          <th scope="row" class="pa-mx-who">${AC.openMember ? `<button class="linkish pa-mx-member" type="button" data-pa-member="${esc(m.id)}">` : '<span class="pa-mx-member">'}${avatarHtml(m, 26)}<span>${esc(m.pseudo)}</span>${m.is_admin ? ' <span class="pill pill-ok acc-pill">admin</span>' : ''}${AC.openMember ? '</button>' : '</span>'}</th>
          ${AC.pages.map((p) => {
            const on = hasAccess(p, m);
            return `<td><button class="pa-cell ${on ? 'is-yes' : 'is-no'}" type="button" data-pa-manage="${esc(p.slug)}"${ALWAYS_OPEN.has(p.slug) ? ' disabled' : ''} aria-label="${esc(m.pseudo)}, ${esc(p.label)} : ${on ? 'accès' : 'pas d\'accès'}. Gérer la page">${on ? IC.yes : IC.no}</button></td>`;
          }).join('')}
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function render() {
  if (!AC.root) return;
  if (!AC.loaded) {
    AC.root.innerHTML = AC.error ? `<div class="empty">Impossible de charger les accès : ${esc(errMsg(AC.error))}</div>` : '<div class="empty">Chargement des accès…</div>';
    return;
  }
  // Conserve le focus (même contrôle) après un nouveau rendu
  const a = document.activeElement;
  const key = a && AC.root.contains(a)
    ? (a.closest('tr')?.dataset.slug ? `tr[data-slug="${CSS.escape(a.closest('tr').dataset.slug)}"] ${a.matches('[data-pa-mode]') ? '[data-pa-mode]' : a.matches('[data-pa-nav]') ? '[data-pa-nav]' : a.dataset.paMove ? `[data-pa-move="${a.dataset.paMove}"]` : '[data-pa-manage]'}` : a.dataset.paView ? `[data-pa-view="${a.dataset.paView}"]` : null)
    : null;
  AC.root.innerHTML = sectionHtml();
  if (key) { const el = AC.root.querySelector(key); if (el && !el.disabled) el.focus(); }
  if (AC.openSlug) renderDialog();
}

/* ---------- Dialog « Personnes » d'une page ---------- */
let dlg = null;
function buildDialog() {
  const d = document.createElement('dialog');
  d.className = 'hg-dialog pa-dialog';
  d.setAttribute('aria-labelledby', 'pa-dlg-title');
  d.innerHTML = '<div class="pa-dlg-in"></div>';
  d.addEventListener('click', onDialogClick);
  d.addEventListener('change', onDialogChange);
  d.addEventListener('input', (e) => { if (e.target.id === 'pa-q') { AC.q = e.target.value; renderDialogList(); } });
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => {
    if (d.dataset.suspend) { delete d.dataset.suspend; return; } // fermé le temps d'une confirmation
    const slug = AC.openSlug; AC.openSlug = null; AC.q = '';
    AC.root?.querySelector(`[data-pa-manage="${CSS.escape(slug || '')}"]`)?.focus();
  });
  document.body.append(d);
  return d;
}
function openDialog(slug) {
  if (!pageBySlug(slug) || ALWAYS_OPEN.has(slug)) return;
  dlg ||= buildDialog();
  AC.openSlug = slug; AC.q = '';
  renderDialog();
  if (!dlg.open) dlg.showModal();
  ($('#pa-q', dlg) || $('.pa-dlg-close', dlg))?.focus();
}
function renderDialog() {
  const p = pageBySlug(AC.openSlug);
  if (!dlg || !p) return;
  const help = {
    membres: 'Tous les membres y ont accès. Coche les personnes à <strong>bloquer</strong>.',
    liste: 'Seuls les membres cochés y ont accès (<strong>autorisés</strong>).',
    admin: 'Réservée aux admins : aucun membre n\'y a accès. Change le mode pour choisir des personnes.',
  }[p.mode] || '';
  const hadFocus = dlg.contains(document.activeElement) ? document.activeElement : null;
  const restore = hadFocus?.id === 'pa-q' ? '#pa-q' : hadFocus?.dataset.paSel ? `[data-pa-sel="${hadFocus.dataset.paSel}"]` : hadFocus?.matches?.('[data-pa-dlg-mode]') ? '[data-pa-dlg-mode]' : null;
  $('.pa-dlg-in', dlg).innerHTML = `
    <div class="pa-dlg-head">
      <div><p class="eyebrow">Accès à la page</p><h2 id="pa-dlg-title" class="dialog-title">${esc(p.label)}</h2></div>
      <button class="btn btn-ghost btn-icon pa-dlg-close" type="button" data-pa-close aria-label="Fermer">${IC.close}</button>
    </div>
    <div class="field">
      <label for="pa-dlg-mode">Qui y a accès</label>
      <select id="pa-dlg-mode" data-pa-dlg-mode>${MODES.map(([v, l]) => `<option value="${v}"${p.mode === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <p class="small muted pa-dlg-help">${help}</p>
    ${p.mode === 'admin' ? '' : `
    <div class="pa-dlg-tools">
      <div class="field pa-dlg-search"><label for="pa-q" class="visually-hidden">Rechercher un membre</label>
        <div class="acc-search-box">${IC.search}<input id="pa-q" type="search" autocomplete="off" placeholder="Rechercher un membre" value="${esc(AC.q)}"></div></div>
      <div class="pa-dlg-all" role="group" aria-label="Accès pour tous les membres affichés">
        <span class="small muted">Accès :</span>
        <button class="btn btn-ghost btn-sm" type="button" data-pa-sel="all">Tous</button>
        <button class="btn btn-ghost btn-sm" type="button" data-pa-sel="none">Aucun</button>
      </div>
    </div>`}
    <ul class="pa-people" id="pa-people"></ul>
    <p class="small muted pa-dlg-sum" id="pa-dlg-sum" aria-live="polite"></p>
    <div class="btn-row dialog-actions"><button class="btn btn-primary" type="button" data-pa-close>Terminé</button></div>`;
  renderDialogList();
  if (restore) $(restore, dlg)?.focus();
}
function visibleMembers() {
  const q = norm(AC.q.trim());
  return AC.members.filter((m) => !q || norm(m.pseudo).includes(q));
}
function renderDialogList() {
  const p = pageBySlug(AC.openSlug);
  const ul = dlg && $('#pa-people', dlg);
  if (!p || !ul) return;
  const list = p.mode === 'admin' ? AC.members.filter((m) => m.is_admin) : visibleMembers();
  const col = p.mode === 'membres' ? 'Bloqué' : 'Autorisé';
  ul.innerHTML = list.length ? list.map((m) => {
    const r = rowOf(p.slug, m.id);
    const checked = p.mode === 'membres' ? r?.allowed === false : r?.allowed === true;
    const on = hasAccess(p, m);
    if (m.is_admin || p.mode === 'admin') {
      return `<li class="pa-person is-fixed">${avatarHtml(m, 32)}<span class="pa-person-name">${esc(m.pseudo)}</span><span class="pill pill-ok">admin · accès</span></li>`;
    }
    return `<li class="pa-person">
      <label class="check pa-person-check">
        <input type="checkbox" data-pa-user="${esc(m.id)}"${checked ? ' checked' : ''}>
        ${avatarHtml(m, 32)}<span class="pa-person-name">${esc(m.pseudo)}</span>
        <span class="small pa-person-col">${col}</span>
      </label>
      <span class="pill ${on ? 'pill-ok' : 'pill-muted'}">${on ? 'Accès' : 'Pas d\'accès'}</span>
    </li>`;
  }).join('') : '<li class="empty">Aucun membre ne correspond.</li>';
  const n = AC.members.filter((m) => hasAccess(p, m)).length;
  $('#pa-dlg-sum', dlg).textContent = `${n} membre${n > 1 ? 's' : ''} sur ${AC.members.length} ont accès à cette page.`;
}
async function onDialogClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.hasAttribute('data-pa-close')) { dlg.close(); return; }
  if (b.dataset.paSel) {
    const ids = visibleMembers().filter((m) => !m.is_admin).map((m) => m.id);
    if (!ids.length) return;
    b.disabled = true;
    try {
      await setAccess(AC.openSlug, ids, b.dataset.paSel === 'all');
      toast(b.dataset.paSel === 'all' ? 'Accès donné aux membres affichés' : 'Accès retiré aux membres affichés', 'ok');
    } catch (ex) { toast(errMsg(ex), 'error'); } finally { if (b.isConnected) b.disabled = false; }
  }
}
async function onDialogChange(e) {
  const el = e.target;
  if (el.matches('[data-pa-user]')) {
    const p = pageBySlug(AC.openSlug);
    const allow = p.mode === 'membres' ? !el.checked : el.checked;
    el.disabled = true;
    try { await setAccess(p.slug, [el.dataset.paUser], allow); }
    catch (ex) { toast(errMsg(ex), 'error'); el.checked = !el.checked; }
    const again = $(`[data-pa-user="${CSS.escape(el.dataset.paUser)}"]`, dlg);
    if (again) { again.disabled = false; again.focus(); }
    return;
  }
  if (el.matches('[data-pa-dlg-mode]')) await changeMode(AC.openSlug, el.value, el);
}

/* ---------- Actions de la table ---------- */
async function changeMode(slug, mode, el) {
  const p = pageBySlug(slug);
  if (!p || p.mode === mode) return;
  const before = AC.members.filter((m) => hasAccess(p, m)).length;
  const after = AC.members.filter((m) => hasAccess({ ...p, mode }, m)).length;
  if (after < before && !(await confirmLoss(p, before - after, mode))) { el.value = p.mode; return; }
  el.disabled = true;
  try {
    await updatePage(slug, { mode });
    toast(`« ${p.label} » : ${MODE_LABEL[mode].toLowerCase()}`, 'ok');
    emit();
  } catch (ex) { toast(errMsg(ex), 'error'); el.value = p.mode; } finally { if (el.isConnected) el.disabled = false; }
}
async function confirmLoss(p, n, mode) {
  const body = `${n} membre${n > 1 ? 's' : ''} perdr${n > 1 ? 'ont' : 'a'} l'accès (mode « ${MODE_LABEL[mode]} »). Les exceptions déjà enregistrées sont conservées.`;
  // Le dialog « Personnes » est modal : on le referme le temps de la confirmation
  const reopen = dlg?.open ? AC.openSlug : null;
  if (reopen) { dlg.dataset.suspend = '1'; dlg.close(); }
  const ok = await confirmBox(`Restreindre « ${p.label} » ?`, body, { ok: 'Restreindre', danger: true });
  if (reopen) { AC.openSlug = reopen; renderDialog(); dlg.showModal(); $('[data-pa-dlg-mode]', dlg)?.focus(); }
  return ok;
}
async function move(slug, dir, btn) {
  const i = AC.pages.findIndex((p) => p.slug === slug), j = i + dir;
  if (i < 0 || j < 0 || j >= AC.pages.length) return;
  const order = AC.pages.slice();
  [order[i], order[j]] = [order[j], order[i]];
  const changes = order.map((p, k) => [p, k]).filter(([p, k]) => p.sort !== k);
  btn.disabled = true;
  try {
    const at = nowIso();
    const res = await Promise.all(changes.map(([p, k]) => sb.from('hg_pages').update({ sort: k, updated_at: at }).eq('slug', p.slug)));
    res.forEach(check);
    changes.forEach(([p, k]) => { p.sort = k; });
    AC.pages = order;
    emit();
  } catch (ex) { toast(errMsg(ex), 'error'); await ensureAccessData(true).catch(() => {}); emit(); }
  finally { if (btn.isConnected) btn.disabled = false; }
}

function bindSection(root) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.paView) { AC.view = b.dataset.paView; render(); $(`[data-pa-view="${AC.view}"]`, root)?.focus(); return; }
    if (b.dataset.paManage) { openDialog(b.dataset.paManage); return; }
    if (b.dataset.paMember && AC.openMember) { AC.openMember(b.dataset.paMember); return; }
    if (b.dataset.paMove) { const slug = b.closest('tr')?.dataset.slug; if (slug) await move(slug, Number(b.dataset.paMove), b); }
  });
  root.addEventListener('change', async (e) => {
    const el = e.target, slug = el.closest('tr')?.dataset.slug;
    if (!slug) return;
    if (el.matches('[data-pa-mode]')) { await changeMode(slug, el.value, el); return; }
    if (el.matches('[data-pa-nav]')) {
      const p = pageBySlug(slug);
      el.disabled = true;
      try { await updatePage(slug, { in_nav: el.checked }); toast(el.checked ? `« ${p.label} » affichée dans le menu` : `« ${p.label} » retirée du menu`, 'ok'); emit(); }
      catch (ex) { toast(errMsg(ex), 'error'); el.checked = !el.checked; } finally { if (el.isConnected) el.disabled = false; }
    }
  });
}

/** Point d'entrée (admin.js). openMember(uid) : ouvre la fiche d'un membre (optionnel). */
export async function mountAccessSection(root, { openMember } = {}) {
  if (!root) return;
  AC.root = root; AC.openMember = openMember || null;
  bindSection(root);
  window.addEventListener('hg:access', render);
  render();
  try { await ensureAccessData(); } catch (e) { console.error(e); }
  render();
}
/** Recharge les données (ex. après une modification des membres). */
export async function refreshAccessSection() {
  try { await ensureAccessData(true); } catch (e) { console.error(e); }
  render();
  emit();
}
