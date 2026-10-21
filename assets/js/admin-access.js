// ===== Humane Gang — administration : accès aux pages =====
// Tables : hg_pages(slug, label, mode 'membres'|'admin'|'liste', in_nav, sort) et hg_page_access(page_slug, user_id, allowed).
//  - mode 'membres' : tout le monde sauf les lignes allowed=false (bloqués) ;
//  - mode 'liste'   : seulement les lignes allowed=true (membres choisis) ;
//  - mode 'admin'   : admins seulement. Les admins ont toujours accès à tout.
// Rôle : section « Accès aux pages » (vue Pages ou matrice membres × pages), dialogue « Personnes » d'une page,
// tiroir de création et de modification d'une page, et onglet « Accès » de la fiche membre.
// Contrôle d'affichage seulement : les données restent protégées par les règles de la base.
// Importé par admin.js (section) et admin-accounts.js (onglet « Accès » de la fiche).
// Dépendances : core.js (Supabase, toast), core/profile.js (profil en cache), icons.js, ui-confirm.js, admin/ui/drawer.js, admin/shell.js.
// Exporte : MODES, ensureAccessData, accessPages, hasAccess, setAccess, memberAccessHtml, accessActions, mountAccessSection, refreshAccessSection.
import { sb, toast, errMsg, esc, $, $$, avatarHtml } from './core.js';
import { confirmBox } from './ui-confirm.js';
import { svg } from './icons.js';
import { getCachedProfile } from './core/profile.js';
import { openDrawer } from './admin/ui/drawer.js';
import { setActions, currentSub } from './admin/shell.js';

export const MODES = [
  ['membres', 'Tous les membres'],
  ['admin', 'Admin seulement'],
  ['liste', 'Membres choisis'],
];
// Libellé d'un mode à partir de son identifiant (« membres », « admin », « liste »).
const MODE_LABEL = Object.fromEntries(MODES);
// Page de repli : jamais bloquée (la redirection d'une page interdite y mène)
const ALWAYS_OPEN = new Set(['accueil']);

/* ---------- Constantes et icônes ---------- */
// Icônes SVG : flèches de l'ordre, interrupteurs, fermeture, recherche, membres.
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
// État de la section : pages, exceptions d'accès (rows), membres, chargement, vue (pages ou matrice), page ouverte,
// recherche du dialogue, racine, fonction d'ouverture de fiche membre, et droit de gérer la structure des pages.
const AC = {
  pages: [], rows: [], members: [], loaded: false, loading: null, error: null,
  view: 'pages', openSlug: null, q: '', root: null, openMember: null, canPages: false,
};
/* ---------- Outils ---------- */
/** Renvoie les données d'une réponse Supabase, ou lève l'erreur si la requête a échoué. */
function check(res) { if (res.error) throw res.error; return res.data; }
/** Comparaison sans accents ni casse (recherche de membres). */
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Date actuelle au format ISO, pour la colonne updated_at. */
const nowIso = () => new Date().toISOString();
/** Page à partir de son identifiant, ou undefined. */
const pageBySlug = (slug) => AC.pages.find((p) => p.slug === slug);
/** Exception (ligne hg_page_access) d'un membre sur une page, ou undefined. */
const rowOf = (slug, uid) => AC.rows.find((r) => r.page_slug === slug && r.user_id === uid);
/** Prévient le reste de l'admin que les accès ont changé (événement « hg:access »). */
function emit() { try { window.dispatchEvent(new CustomEvent('hg:access')); } catch {} }

/** Charge les pages (ordre « sort », puis slug) dans AC.pages. */
async function loadPages() {
  AC.pages = (check(await sb.from('hg_pages').select('slug, label, mode, in_nav, sort').order('sort')) ?? [])
    .slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.slug).localeCompare(String(b.slug)));
}
/** Charge toutes les exceptions d'accès dans AC.rows. */
async function loadRows() { AC.rows = check(await sb.from('hg_page_access').select('page_slug, user_id, allowed')) ?? []; }
/**
 * Charge les comptes et joint leurs avatars (hg_members). Un compte sans pseudo n'est pas un membre.
 * Liste triée par pseudo.
 */
async function loadMembers() {
  const [acc, mem] = await Promise.all([sb.rpc('hg_admin_accounts'), sb.rpc('hg_members')]);
  const avatars = new Map((mem.data ?? []).map((m) => [m.id, m]));
  AC.members = (check(acc) ?? []).filter((a) => a.pseudo) // sans profil = pas membre
    .map((a) => ({ ...(avatars.get(a.id) || {}), id: a.id, pseudo: a.pseudo, is_admin: !!a.is_admin }))
    .sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo), 'fr'));
}

/** Droit de gérer la structure des pages (créer, renommer, supprimer) : admin ou permission « reglages ». Ne jette pas. */
async function loadPerms() {
  try {
    const { data, error } = await sb.rpc('hg_my_perms');
    if (error) throw error;
    AC.canPages = !!(data?.is_admin || (data?.perms ?? []).includes('reglages'));
  } catch { AC.canPages = false; }
  if (getCachedProfile()?.is_admin) AC.canPages = true;
}

/** Charge pages, exceptions et membres (une fois, sauf force). Jette en cas d'échec. */
export function ensureAccessData(force = false) {
  if (AC.loaded && !force) return Promise.resolve(AC);
  if (AC.loading && !force) return AC.loading;
  AC.loading = (async () => {
    try {
      await Promise.all([loadPages(), loadRows(), loadMembers(), loadPerms()]);
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
/**
 * Nombre d'exceptions qui comptent pour le mode d'une page : bloqués en « membres », autorisés en « liste ».
 * @param {object} page Page.
 * @returns {number}
 */
function exceptionCount(page) {
  const ids = new Set(AC.members.filter((m) => !m.is_admin).map((m) => m.id));
  if (page.mode === 'membres') return AC.rows.filter((r) => r.page_slug === page.slug && r.allowed === false && ids.has(r.user_id)).length;
  if (page.mode === 'liste') return AC.rows.filter((r) => r.page_slug === page.slug && r.allowed === true && ids.has(r.user_id)).length;
  return 0;
}
/** Nombre de membres ayant accès à la page (admins compris). */
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
/* ---------- Rendu de la section ---------- */
/**
 * HTML de la section : bascule « Pages » / « Matrice », puis la vue choisie.
 * @returns {string}
 */
function sectionHtml() {
  return `
    <p class="small muted pa-note">Contrôle d'affichage : les liens sont masqués et la page renvoie vers l'accueil ; les données restent protégées par les règles de la base.</p>
    <div class="pa-views" role="group" aria-label="Affichage">
      <button class="chip" type="button" data-pa-view="pages" aria-pressed="${AC.view === 'pages'}">Pages</button>
      <button class="chip" type="button" data-pa-view="matrice" aria-pressed="${AC.view === 'matrice'}">Matrice membres × pages</button>
    </div>
    <div class="card pa-card">${AC.view === 'pages' ? pagesTableHtml() : matrixHtml()}</div>`;
}

/**
 * Tableau des pages : ordre (flèches), libellé, mode d'accès, présence dans le menu, exceptions, bouton « Personnes ».
 * Les pages « Toujours accessible » n'ont pas de mode modifiable.
 * @returns {string}
 */
function pagesTableHtml() {
  const head = AC.canPages ? `<div class="pa-head">
      <p class="small muted">Déclare une page, change son libellé, son accès ou sa place dans le menu. « + Nouvelle page » est en haut.</p>
    </div>` : '';
  if (!AC.pages.length) return `${head}<div class="empty">Aucune page déclarée.</div>`;
  const last = AC.pages.length - 1;
  return `${head}
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
            <th scope="row" class="pa-page"><span class="pa-page-in"><strong>${esc(p.label)}</strong><span class="small muted code-sm">${esc(p.slug)}.html</span>${AC.canPages ? `<button class="btn btn-ghost btn-sm pa-edit" type="button" data-pa-edit="${esc(p.slug)}">Modifier la page</button>` : ''}</span></th>
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

/**
 * Matrice membres × pages en lecture seule : une case par membre et par page. Cliquer ouvre la gestion de la page.
 * @returns {string}
 */
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

/**
 * Redessine la section, ou affiche un message de chargement ou d'erreur. Garde le focus sur le contrôle utilisé.
 */
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
// Dialogue « Personnes » : créé une seule fois, puis réutilisé pour chaque page.
let dlg = null;
/* ---------- Dialog « Personnes » d'une page ---------- */
/**
 * Crée le dialogue « Personnes » et branche ses écouteurs (clics, saisie, changements, fermeture).
 * @returns {HTMLDialogElement}
 */
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
/**
 * Ouvre le dialogue « Personnes » pour une page. Les pages « Toujours accessible » ne s'ouvrent pas.
 * @param {string} slug Identifiant de la page.
 */
function openDialog(slug) {
  if (!pageBySlug(slug) || ALWAYS_OPEN.has(slug)) return;
  dlg ||= buildDialog();
  AC.openSlug = slug; AC.q = '';
  renderDialog();
  if (!dlg.open) dlg.showModal();
  ($('#pa-q', dlg) || $('.pa-dlg-close', dlg))?.focus();
}
/**
 * Écrit le contenu du dialogue : en-tête, mode, aide, outils de recherche et de sélection, puis la liste des membres.
 */
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
/**
 * Membres affichés dans le dialogue, filtrés par la recherche (sans accents ni casse).
 * @returns {object[]}
 */
function visibleMembers() {
  const q = norm(AC.q.trim());
  return AC.members.filter((m) => !q || norm(m.pseudo).includes(q));
}
/**
 * Redessine la liste des membres du dialogue (cases à cocher, pastilles) et le résumé « n membres sur N ».
 * Les admins et les pages en mode « admin » n'ont que des lignes fixes.
 */
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
/**
 * Gère les boutons du dialogue : fermer, « Tous » ou « Aucun » pour les membres affichés.
 * @param {Event} e Événement de clic.
 */
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
/**
 * Gère les changements du dialogue : une case de membre, ou le mode de la page.
 * En cas d'échec, la case revient à son état précédent.
 * @param {Event} e Événement de changement.
 */
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

/* ---------- Tiroir « Modifier la page » / « Nouvelle page » ---------- */
let pgDrawer = null; // { close } du tiroir ouvert
/* ---------- Tiroir « Modifier la page » / « Nouvelle page » ---------- */
/**
 * HTML du formulaire de page : identifiant (création seulement), libellé, mode, menu, suppression.
 * @param {object|null} p Page existante, ou null pour une création.
 * @param {boolean} isNew Vrai pour une création.
 * @param {boolean} locked Vrai pour l'accueil : mode et suppression figés.
 * @returns {string}
 */
function pageFormHtml(p, isNew, locked) {
  return `
    ${isNew ? `<div class="field"><label for="pa-pg-slug">Nom de la page (sans .html)</label>
        <input id="pa-pg-slug" name="slug" required maxlength="40" autocomplete="off" placeholder="ex. galerie" aria-describedby="pa-pg-slug-h">
        <span class="small muted" id="pa-pg-slug-h">Lettres minuscules, chiffres et tirets. Le fichier <code>nom.html</code> doit exister à la racine du site, sinon la page est introuvable.</span></div>`
      : `<p class="small muted">Adresse : <code>${esc(p.slug)}.html</code></p>`}
    <div class="field"><label for="pa-pg-label">Libellé dans le menu</label>
      <input id="pa-pg-label" name="label" required maxlength="60" autocomplete="off" value="${esc(p?.label ?? '')}"></div>
    <div class="field"><label for="pa-pg-mode">Qui y a accès</label>
      <select id="pa-pg-mode" name="mode"${locked ? ' disabled' : ''} aria-describedby="pa-pg-mode-h">${MODES.map(([v, l]) => `<option value="${v}"${(p?.mode ?? 'membres') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <span class="small muted" id="pa-pg-mode-h">${locked ? 'L\'accueil reste toujours accessible.' : 'Tous les membres, les admins seulement, ou les membres choisis (bouton « Personnes » du tableau).'}</span></div>
    <label class="switch"><input type="checkbox" name="in_nav"${(p?.in_nav ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Afficher dans le menu des membres qui y ont accès</span></label>
    ${p && !locked ? '<div class="pa-pg-danger"><button class="btn btn-danger" type="button" data-pa-pg-del>Supprimer la page</button></div>' : ''}`;
}

/**
 * Ouvre le tiroir de création (slug = null) ou de modification d'une page.
 * @param {string|null} slug Identifiant de la page à modifier, ou null.
 * @returns {object} Tiroir ouvert.
 */
function openPageDialog(slug) {
  const p = slug ? pageBySlug(slug) : null;
  const isNew = !p;
  const locked = !!p && ALWAYS_OPEN.has(p.slug); // accueil : mode et suppression figés
  const body = document.createElement('div');
  body.className = 'pa-pg-form';
  body.id = 'pa-pg-form';
  body.innerHTML = `<p class="form-error" role="alert" hidden></p>${pageFormHtml(p, isNew, locked)}`;
  const trigger = document.activeElement;
  const d = openDrawer({
    title: isNew ? 'Déclarer une page' : p.label,
    subtitle: isNew ? 'Nouvelle page' : 'Page du site',
    body, submitLabel: isNew ? 'Déclarer la page' : 'Enregistrer',
    onSubmit: (form) => savePage(form, slug),
    onClose: () => {
      pgDrawer = null;
      (p && AC.root?.querySelector(`[data-pa-edit="${CSS.escape(p.slug)}"]`) || trigger)?.focus?.();
    },
  });
  pgDrawer = d;
  // Le bouton de suppression est dans le corps : son clic ne passe pas par le pied du tiroir
  body.addEventListener('click', (e) => { if (e.target.closest('[data-pa-pg-del]')) deletePage(slug); });
  return d;
}

/** Enregistre la page (création ou modification). Renvoie false pour garder le tiroir ouvert en cas d'erreur. */
async function savePage(form, slug) {
  const E = form.elements;
  const err = form.querySelector('.form-error');
  const fail = (m) => { err.textContent = m; err.hidden = false; return false; };
  err.hidden = true;
  const isNew = !slug;
  const p = isNew ? null : pageBySlug(slug);
  const label = E.label.value.trim();
  const mode = p && ALWAYS_OPEN.has(p.slug) ? p.mode : E.mode.value;
  const in_nav = E.in_nav.checked;
  const newSlug = isNew ? E.slug.value.trim().toLowerCase() : p.slug;
  if (isNew && !/^[a-z0-9][a-z0-9-]{1,39}$/.test(newSlug)) return fail('Le nom doit faire 2 à 40 caractères : lettres minuscules, chiffres et tirets.');
  if (isNew && pageBySlug(newSlug)) return fail('Une page porte déjà ce nom.');
  if (!label || label.length > 60) return fail('Donne un libellé (60 caractères au maximum).');
  if (!MODE_LABEL[mode]) return fail('Choisis qui a accès dans la liste.');
  if (p && p.mode !== mode) { // même garde que le changement de mode dans le tableau
    const before = AC.members.filter((m) => hasAccess(p, m)).length;
    const after = AC.members.filter((m) => hasAccess({ ...p, mode }, m)).length;
    if (after < before && !(await confirmLoss(p, before - after, mode))) return false;
  }
  try {
    if (isNew) {
      const sort = AC.pages.reduce((m, x) => Math.max(m, x.sort ?? 0), -1) + 1;
      check(await sb.from('hg_pages').insert({ slug: newSlug, label, mode, in_nav, sort, updated_at: nowIso() }));
      toast(`Page « ${label} » déclarée. Vérifie que ${newSlug}.html existe sur le site.`, 'ok');
    } else {
      check(await sb.from('hg_pages').update({ label, mode, in_nav, updated_at: nowIso() }).eq('slug', p.slug));
      toast(`Page « ${label} » enregistrée.`, 'ok');
    }
    await loadPages();
    await loadRows();
    emit();
    return true;
  } catch (ex) {
    return fail(`Enregistrement impossible : ${errMsg(ex)}`);
  }
}

/**
 * Supprime une page après confirmation : son lien disparaît du menu et ses exceptions sont effacées.
 * @param {string} slug Identifiant de la page.
 */
async function deletePage(slug) {
  const p = pageBySlug(slug);
  if (!p || ALWAYS_OPEN.has(slug)) return;
  const n = AC.rows.filter((r) => r.page_slug === slug).length;
  const ok = await confirmBox(`Supprimer la page « ${p.label} » ?`,
    `Son lien disparaît du menu. Une page supprimée n'est plus contrôlée : tous les membres pourront l'ouvrir à son adresse, même si elle était réservée aux admins.${n ? ` Les ${n} exception${n > 1 ? 's' : ''} d'accès enregistrée${n > 1 ? 's' : ''} sont effacées.` : ''} Le fichier ${p.slug}.html reste sur le site. Définitif.`,
    { ok: 'Supprimer la page', danger: true });
  if (!ok) return;
  try {
    check(await sb.from('hg_pages').delete().eq('slug', slug));
    toast(`Page « ${p.label} » supprimée.`, 'ok');
    pgDrawer?.close();
    await loadPages();
    await loadRows();
    emit();
  } catch (ex) { toast(errMsg(ex), 'error'); }
}

/* ---------- Actions de la table ---------- */
/* ---------- Actions de la table ---------- */
/**
 * Change le mode d'une page depuis le tableau. Si des membres perdraient l'accès, demande confirmation.
 * En cas d'échec, le menu revient à l'ancien mode.
 * @param {string} slug Identifiant de la page.
 * @param {string} mode Nouveau mode.
 * @param {HTMLSelectElement} el Menu déroulant du mode.
 */
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
/**
 * Demande confirmation avant un changement qui retire l'accès à n membres. Le dialogue « Personnes » est fermé pendant la question, puis rouvert.
 * @param {object} p Page concernée.
 * @param {number} n Nombre de membres qui perdraient l'accès.
 * @param {string} mode Nouveau mode.
 * @returns {Promise<boolean>} true si l'admin confirme.
 */
async function confirmLoss(p, n, mode) {
  const body = `${n} membre${n > 1 ? 's' : ''} perdr${n > 1 ? 'ont' : 'a'} l'accès (mode « ${MODE_LABEL[mode]} »). Les exceptions déjà enregistrées sont conservées.`;
  // Le dialog « Personnes » est modal : on le referme le temps de la confirmation
  const reopen = dlg?.open ? AC.openSlug : null;
  if (reopen) { dlg.dataset.suspend = '1'; dlg.close(); }
  const ok = await confirmBox(`Restreindre « ${p.label} » ?`, body, { ok: 'Restreindre', danger: true });
  if (reopen) { AC.openSlug = reopen; renderDialog(); dlg.showModal(); $('[data-pa-dlg-mode]', dlg)?.focus(); }
  return ok;
}
/**
 * Déplace une page d'un cran (dir = -1 ou 1) dans l'ordre. Seules les pages dont le rang change sont mises à jour.
 * En cas d'échec, les données sont rechargées.
 * @param {string} slug Identifiant de la page.
 * @param {number} dir Sens du déplacement.
 * @param {HTMLButtonElement} btn Bouton fléché, désactivé pendant l'envoi.
 */
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

/* ---------- Écouteurs de la section ---------- */
/**
 * Branche les clics et les changements de la section (vues, gestion, édition, déplacement, mode, menu).
 * @param {HTMLElement} root Racine de la section.
 */
function bindSection(root) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.paView) { AC.view = b.dataset.paView; render(); $(`[data-pa-view="${AC.view}"]`, root)?.focus(); return; }
    if (b.dataset.paManage) { openDialog(b.dataset.paManage); return; }
    if (b.dataset.paEdit) { openPageDialog(b.dataset.paEdit); return; }
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

/** Boutons de l'en-tête de zone (admin.js, à chaque visite) : « + Nouvelle page » si la personne peut gérer les pages. */
export function accessActions() {
  if (!AC.canPages) return [];
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn btn-primary btn-sm'; b.textContent = '+ Nouvelle page'; b.dataset.paNew = '';
  b.addEventListener('click', () => openPageDialog(null));
  return [b];
}
/** Remet les boutons d'en-tête à jour si la section « Accès » est affichée. */
function refreshAccessActions() { if (currentSub() === 'membres/acces') setActions(accessActions()); }

/** Point d'entrée (admin.js). openMember(uid) : ouvre la fiche d'un membre (optionnel). */
export async function mountAccessSection(root, { openMember } = {}) {
  if (!root) return;
  AC.root = root; AC.openMember = openMember || null;
  bindSection(root);
  // Un changement d'accès (événement « hg:access », émis par emit()) redessine la section.
  window.addEventListener('hg:access', render);
  render();
  try { await ensureAccessData(); } catch (e) { console.error(e); }
  render();
  refreshAccessActions();
}
/** Recharge les données (ex. après une modification des membres). */
export async function refreshAccessSection() {
  try { await ensureAccessData(true); } catch (e) { console.error(e); }
  render();
  refreshAccessActions();
  emit();
}
