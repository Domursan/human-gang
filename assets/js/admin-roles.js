// ===== Humane Gang — administration : rôles et accès par rôle (migration 103) =====
/*
 * Rôle : un rôle (hg_roles) pré-règle l'accès à des pages « sur liste » pour les membres qui le portent (hg_member_roles).
 * Un réglage à la main (hg_page_access) l'emporte toujours sur les rôles. Toute écriture passe par une RPC :
 * hg_role_save, hg_role_remove, hg_member_role_set, hg_member_access_reset. L'accès d'un membre, avec son origine,
 * est lu par hg_member_access (fiche : admin-accounts/fiche.js).
 * Vues : Membres › Rôles (liste des rôles, détail d'un rôle : pages, membres), IRL › Membres IRL (membres du rôle « irl »),
 * et le bloc « Rôles et accès » de la fiche d'un membre (memberRolesHtml).
 * Droits : « membres » (admin/perms.js). Routes : #membres/roles (conteneur #roles-root), #irl/membres-irl (#membres-irl-root).
 * Dépendances : core.js (sb, toast, errMsg, esc, fmtDate, avatarHtml), ui-confirm.js (confirmBox), admin/common.js (busy, check, sectionError).
 * Exporte : mountRolesSection, mountMembresIrlSection, refreshRolesViews (après une modification faite depuis une fiche),
 * memberRolesHtml (bloc des rôles de la fiche), memberRoleChange, memberAccessReset, roleIdFromLabel.
 */
import { sb, toast, errMsg, esc, fmtDate, avatarHtml } from './core.js';
import { confirmBox } from './ui-confirm.js';
import { busy, check, sectionError } from './admin/common.js';

/* ---------- Constantes et outils ---------- */
const ID_RE = /^[a-z0-9-]{2,30}$/;       // identifiant d'un rôle (même règle que la base)
const DEFAULT_COLOR = '#7E93C9';
const PICK_LIMIT = 30;                    // résultats affichés dans la recherche de membres
/** Couleur sûre (#rrggbb), sinon la couleur par défaut. */
const colorOf = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : DEFAULT_COLOR);
/** Texte comparable : sans accents, sans casse. */
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** Identifiant d'un rôle dérivé de son libellé : minuscules, sans accents, tirets, 30 caractères au plus. */
export function roleIdFromLabel(label) {
  return fold(label).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
}
/** « aucun membre », « 1 membre », « 9 membres ». */
const nMembres = (n) => (n === 0 ? 'aucun membre' : `${n} membre${n > 1 ? 's' : ''}`);
const pseudoOf = (m) => m?.pseudo || 'Ancien membre';

/* ---------- Données partagées par les vues (une lecture, relue après chaque écriture) ---------- */
// roles : hg_roles (triés) ; links : hg_member_roles (user_id, role_id, added_at) ; members : hg_members ; pages : hg_pages.
const D = { roles: [], links: [], members: [], pages: [] };

/** Lit les rôles, les liens membre-rôle, les membres et les pages. Jette en cas d'échec. */
async function loadData() {
  const [roles, links, members, pages] = await Promise.all([
    sb.from('hg_roles').select('*').order('sort'),
    sb.from('hg_member_roles').select('user_id, role_id, added_at'),
    sb.rpc('hg_members'),
    sb.from('hg_pages').select('slug, label, mode, sort').order('sort'),
  ]);
  D.roles = check(roles) ?? [];
  D.links = check(links) ?? [];
  D.members = (check(members) ?? []).filter((m) => m.pseudo).sort((a, b) => fold(a.pseudo).localeCompare(fold(b.pseudo)));
  D.pages = check(pages) ?? [];
}
const roleById = (id) => D.roles.find((r) => r.id === id) || null;
const memberById = (id) => D.members.find((m) => m.id === id) || null;
const holdersOf = (roleId) => D.links.filter((l) => l.role_id === roleId);
/** Membres qui portent le rôle, triés par pseudo (les comptes qui ne sont plus membres sont ignorés). */
const withRole = (roleId) => holdersOf(roleId)
  .map((l) => ({ ...l, m: memberById(l.user_id) }))
  .filter((x) => x.m)
  .sort((a, b) => fold(pseudoOf(a.m)).localeCompare(fold(pseudoOf(b.m))));

/** Membres qui ne portent pas encore le rôle et correspondent à la recherche. */
function candidates(roleId, q) {
  const held = new Set(holdersOf(roleId).map((l) => l.user_id));
  const needle = fold(q);
  return D.members.filter((m) => !held.has(m.id) && (!needle || fold(m.pseudo).includes(needle)));
}

/* ---------- Composants communs : recherche de membres, liste de membres ---------- */
/** Dialogue d'ajout : champ de recherche et résultats (les résultats se redessinent seuls à la saisie). */
function pickerHtml(prefix, roleId, q) {
  return `<div class="rl-picker">
    <div class="field"><label for="${prefix}-q">Chercher un membre</label>
      <input id="${prefix}-q" type="search" autocomplete="off" value="${esc(q)}"></div>
    <ul class="rl-people rl-results" data-picker-results="${esc(roleId)}">${resultsHtml(roleId, q)}</ul>
  </div>`;
}
/** Lignes des résultats : un bouton « Ajouter » par membre. */
function resultsHtml(roleId, q) {
  const role = roleById(roleId);
  const list = candidates(roleId, q);
  if (!list.length) return `<li class="small muted">${fold(q) ? 'Aucun membre ne correspond.' : 'Tous les membres ont déjà ce rôle.'}</li>`;
  const rows = list.slice(0, PICK_LIMIT).map((m) => `<li class="rl-person">
      ${avatarHtml(m, 32)}<span class="rl-person-name">${esc(pseudoOf(m))}</span>
      <button type="button" class="btn btn-ghost" data-rl-member-add="${esc(m.id)}" data-role="${esc(roleId)}" aria-label="Ajouter ${esc(pseudoOf(m))} au rôle ${esc(role?.label ?? roleId)}">Ajouter</button>
    </li>`).join('');
  const more = list.length > PICK_LIMIT ? `<li class="small muted">Affine la recherche : ${list.length - PICK_LIMIT} autres membres.</li>` : '';
  return rows + more;
}
/** Liste des membres qui portent le rôle, avec la date d'attribution et un bouton « Retirer ». */
function peopleHtml(roleId) {
  const role = roleById(roleId);
  const rows = withRole(roleId);
  if (!rows.length) return '<li class="small muted">Aucun membre pour l’instant.</li>';
  return rows.map(({ m, added_at }) => `<li class="rl-person">
      ${avatarHtml(m, 32)}
      <span class="rl-person-txt"><span class="rl-person-name">${esc(pseudoOf(m))}</span>${added_at ? `<span class="small muted">depuis le ${esc(fmtDate(added_at))}</span>` : ''}</span>
      <button type="button" class="btn btn-ghost" data-rl-member-rm="${esc(m.id)}" data-role="${esc(roleId)}" aria-label="Retirer le rôle ${esc(role?.label ?? roleId)} à ${esc(pseudoOf(m))}">Retirer</button>
    </li>`).join('');
}

/* =========================================================
   Membres › Rôles
   ========================================================= */
// Vue : rôle sélectionné (R.sel), création (R.creating), dialogue d'ajout ouvert (R.pick) et recherche (R.q).
const R = { root: null, mounted: false, sel: null, creating: false, pick: false, q: '' };

/** Monte la section Rôles (une fois) : liste des rôles à gauche, détail du rôle choisi à droite. */
export async function mountRolesSection(root) {
  if (!root) return;
  R.root = root; R.sel = null; R.creating = false; R.pick = false; R.q = '';
  root.innerHTML = '<div class="empty">Chargement des rôles…</div>';
  try { await loadData(); } catch (e) { root.innerHTML = sectionError(e); return; }
  R.mounted = true;
  R.sel = D.roles[0]?.id ?? null;
  root.addEventListener('click', onRolesClick);
  root.addEventListener('input', onRolesInput);
  root.addEventListener('submit', onRolesSubmit);
  renderRoles();
}

/** Dessine la section Rôles. focus : sélecteur de l'élément à remettre au point après le dessin. */
function renderRoles(focus = null) {
  const role = R.creating ? null : roleById(R.sel);
  R.root.innerHTML = `
    <div class="rl-head">
      <p class="rl-intro muted">Un rôle pré-règle les accès de chaque membre qui le porte.</p>
      <button type="button" class="btn btn-ghost rl-new" data-rl-new>Nouveau rôle</button>
    </div>
    <div class="rl-layout">
      <div class="rl-list">${D.roles.length ? D.roles.map(roleItemHtml).join('') : '<p class="small muted">Aucun rôle pour l’instant. Crée le premier.</p>'}</div>
      <section class="rl-detail card" aria-labelledby="rl-titre">${R.creating ? newRoleHtml() : role ? roleDetailHtml(role) : '<p class="small muted">Choisis un rôle dans la liste.</p>'}</section>
    </div>`;
  if (focus) R.root.querySelector(focus)?.focus();
}

/** Bouton d'un rôle dans la liste : barre de couleur, libellé, nombre de membres. */
function roleItemHtml(r) {
  const on = !R.creating && R.sel === r.id;
  return `<button type="button" class="rl-item" aria-pressed="${on}" data-rl-pick="${esc(r.id)}" style="--rl-c:${colorOf(r.color)}">
    <span class="rl-bar" aria-hidden="true"></span>
    <span class="rl-item-txt"><span class="rl-item-name">${esc(r.label)}</span><span class="small muted">${nMembres(holdersOf(r.id).length)}</span></span>
  </button>`;
}

/** Champs d'un rôle : libellé, description, couleur. */
function fieldsHtml(r, creating) {
  return `<div class="field"><label for="rl-label">Libellé</label>
      <input id="rl-label" name="label" maxlength="40" required autocomplete="off" value="${esc(r?.label ?? '')}"></div>
    ${creating ? '<p class="small muted" id="rl-id-hint">Identifiant : à partir du libellé</p>' : ''}
    <div class="field"><label for="rl-desc">Description</label>
      <textarea id="rl-desc" name="description" maxlength="300" rows="3">${esc(r?.description ?? '')}</textarea></div>
    <div class="field rl-color"><label for="rl-color">Couleur</label>
      <input id="rl-color" name="color" type="color" value="${esc(colorOf(r?.color))}"></div>`;
}

/** Cases des pages : « sur liste » cochables ; les autres sont indiquées comme déjà ouvertes. */
function pagesHtml(r) {
  const mine = r.pages ?? [];
  return D.pages.map((p) => (p.mode === 'liste'
    ? `<label class="rl-page"><input type="checkbox" name="pages" value="${esc(p.slug)}"${mine.includes(p.slug) ? ' checked' : ''}><span>${esc(p.label)}</span></label>`
    : `<p class="rl-page rl-page-fixed"><span>${esc(p.label)}</span><span class="small muted">${p.mode === 'admin' ? 'réservée aux admins' : 'déjà ouverte à tous'}</span></p>`)).join('')
    || '<p class="small muted">Aucune page.</p>';
}

/** Détail d'un rôle existant : formulaire, membres, note. */
function roleDetailHtml(r) {
  return `<div class="rl-title"><h2 id="rl-titre" class="rl-h">${esc(r.label)}</h2><span class="rl-count">${nMembres(holdersOf(r.id).length)}</span></div>
    <form class="rl-form" data-rl-form="${esc(r.id)}" novalidate>
      ${fieldsHtml(r, false)}
      <fieldset class="rl-pages"><legend>Ce rôle donne accès à</legend><div class="rl-page-grid">${pagesHtml(r)}</div></fieldset>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary">Enregistrer le rôle</button>
        <button type="button" class="btn btn-danger" data-rl-delete="${esc(r.id)}">Supprimer le rôle</button>
      </div>
    </form>
    <section class="rl-members" aria-labelledby="rl-members-h">
      <div class="rl-members-head"><h3 id="rl-members-h" class="rl-sub">Membres avec ce rôle</h3>
        <button type="button" class="btn btn-ghost" data-rl-pick-open aria-expanded="${R.pick}">${R.pick ? 'Fermer' : 'Ajouter un membre'}</button></div>
      ${R.pick ? pickerHtml('rl', r.id, R.q) : ''}
      <ul class="rl-people">${peopleHtml(r.id)}</ul>
    </section>
    <p class="rl-note">Un réglage fait à la main sur un membre l’emporte sur ses rôles.</p>`;
}

/** Formulaire de création : l'identifiant vient du libellé ; les membres s'ajoutent une fois le rôle enregistré. */
function newRoleHtml() {
  return `<div class="rl-title"><h2 id="rl-titre" class="rl-h">Nouveau rôle</h2></div>
    <form class="rl-form" data-rl-form="new" novalidate>
      ${fieldsHtml(null, true)}
      <fieldset class="rl-pages"><legend>Ce rôle donne accès à</legend><div class="rl-page-grid">${pagesHtml({ pages: [] })}</div></fieldset>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary">Créer le rôle</button>
        <button type="button" class="btn btn-ghost" data-rl-cancel>Annuler</button>
      </div>
    </form>
    <p class="rl-note">Les membres s’ajoutent au rôle une fois celui-ci enregistré.</p>`;
}

/** Clics de la section Rôles. */
async function onRolesClick(ev) {
  const b = ev.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.rlPick !== undefined) { R.sel = d.rlPick; R.creating = false; R.pick = false; R.q = ''; return renderRoles(`[data-rl-pick="${CSS.escape(d.rlPick)}"]`); }
  if (d.rlNew !== undefined) { R.creating = true; R.sel = null; R.pick = false; return renderRoles('#rl-label'); }
  if (d.rlCancel !== undefined) { R.creating = false; return renderRoles(); }
  if (d.rlPickOpen !== undefined) { R.pick = !R.pick; R.q = ''; return renderRoles(R.pick ? '#rl-q' : '[data-rl-pick-open]'); }
  if (d.rlDelete !== undefined) return removeRole(b);
  if (d.rlMemberRm !== undefined) return memberSet(b, d.role, d.rlMemberRm, false, 'roles');
  if (d.rlMemberAdd !== undefined) return memberSet(b, d.role, d.rlMemberAdd, true, 'roles');
}

/** Saisie dans la section Rôles : recherche de membres, identifiant affiché pendant la création. */
function onRolesInput(ev) {
  const t = ev.target;
  if (t.id === 'rl-q') {
    R.q = t.value;
    const ul = R.root.querySelector('[data-picker-results]');
    if (ul) ul.innerHTML = resultsHtml(R.sel, R.q);
    return;
  }
  if (t.id === 'rl-label' && R.creating) {
    const hint = R.root.querySelector('#rl-id-hint');
    const id = roleIdFromLabel(t.value);
    if (hint) hint.textContent = id ? `Identifiant : ${id}` : 'Identifiant : à partir du libellé';
  }
}

/** Enregistre un rôle (création ou modification) par hg_role_save. Validation avant envoi, erreur affichée dans le formulaire. */
async function onRolesSubmit(ev) {
  const f = ev.target;
  if (!f.matches('form[data-rl-form]')) return;
  ev.preventDefault();
  const btn = ev.submitter ?? f.querySelector('button[type="submit"]');
  const errEl = f.querySelector('.form-error');
  const fail = (msg) => { errEl.textContent = msg; errEl.hidden = false; f.elements.label.focus(); };
  const label = f.elements.label.value.trim();
  const description = f.elements.description.value.trim();
  const color = colorOf(f.elements.color.value);
  const pages = [...f.querySelectorAll('input[name="pages"]:checked')].map((i) => i.value);
  const creating = f.dataset.rlForm === 'new';
  if (!label || label.length > 40) return fail('Le libellé fait de 1 à 40 caractères.');
  if (description.length > 300) return fail('La description fait 300 caractères au plus.');
  let id = f.dataset.rlForm, sort = roleById(id)?.sort ?? 0;
  if (creating) {
    id = roleIdFromLabel(label);
    if (!ID_RE.test(id)) return fail('Le libellé doit contenir au moins deux lettres ou chiffres.');
    if (roleById(id)) return fail(`Un rôle porte déjà ce nom (« ${id} »).`);
    sort = Math.max(0, ...D.roles.map((r) => Number(r.sort) || 0)) + 1;
  }
  errEl.hidden = true;
  await busy(btn, async () => {
    check(await sb.rpc('hg_role_save', { p: { id, label, description, color, pages, sort } }));
    await loadData();
    R.creating = false; R.sel = id; R.pick = false; R.q = '';
    renderRoles(`[data-rl-pick="${CSS.escape(id)}"]`);
    toast(creating ? 'Rôle créé' : 'Rôle enregistré', 'ok');
  });
}

/** Supprime le rôle choisi (après confirmation). Les accès qu'il donnait disparaissent, sauf ceux réglés à la main. */
async function removeRole(btn) {
  const r = roleById(R.sel);
  if (!r) return;
  const n = holdersOf(r.id).length;
  const qui = n === 0 ? '' : n === 1 ? '1 membre perd ce rôle. ' : `${n} membres perdent ce rôle. `;
  const ok = await confirmBox(`Supprimer le rôle « ${r.label} » ?`, `${qui}Les accès qu’il donnait disparaissent, sauf ceux réglés à la main.`, { ok: 'Supprimer', danger: true });
  if (!ok) return;
  await busy(btn, async () => {
    check(await sb.rpc('hg_role_remove', { p_id: r.id }));
    await loadData();
    R.creating = false; R.sel = D.roles[0]?.id ?? null; R.pick = false; R.q = '';
    renderRoles();
    toast('Rôle supprimé', 'ok');
  });
}

/* =========================================================
   IRL › Membres IRL (membres du rôle « irl »)
   ========================================================= */
const I = { root: null, mounted: false, pick: false, q: '' };

/** Monte la section Membres IRL (une fois) : membres qui ont le rôle « irl », ajout et retrait. */
export async function mountMembresIrlSection(root) {
  if (!root) return;
  I.root = root; I.pick = false; I.q = '';
  root.innerHTML = '<div class="empty">Chargement des membres IRL…</div>';
  try { await loadData(); } catch (e) { root.innerHTML = sectionError(e); return; }
  I.mounted = true;
  root.addEventListener('click', onIrlClick);
  root.addEventListener('input', onIrlInput);
  renderIrl();
}

/** Dessine la section Membres IRL. focus : sélecteur à remettre au point après le dessin. */
function renderIrl(focus = null) {
  if (!roleById('irl')) {
    I.root.innerHTML = '<p class="rl-intro">Le rôle « IRL » n’existe pas. <a href="#membres/roles">Crée-le dans Membres › Rôles</a>.</p>';
    return;
  }
  I.root.innerHTML = `
    <div class="rl-head">
      <p class="rl-intro muted">Membres qui participent aux sorties en vrai. Le rôle IRL ouvre les pages de la vie IRL.</p>
      <a class="rl-link" href="#membres/roles">Voir tous les rôles</a>
    </div>
    <section class="rl-detail card" aria-labelledby="irl-members-h">
      <div class="rl-members-head">
        <h3 id="irl-members-h" class="rl-h">Membres du rôle IRL <span class="rl-count">${nMembres(holdersOf('irl').length)}</span></h3>
        <button type="button" class="btn btn-ghost" data-rl-pick-open aria-expanded="${I.pick}">${I.pick ? 'Fermer' : 'Ajouter un membre'}</button>
      </div>
      ${I.pick ? pickerHtml('irl', 'irl', I.q) : ''}
      <ul class="rl-people">${peopleHtml('irl')}</ul>
    </section>`;
  if (focus) I.root.querySelector(focus)?.focus();
}

/** Clics de la section Membres IRL. */
function onIrlClick(ev) {
  const b = ev.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.rlPickOpen !== undefined) { I.pick = !I.pick; I.q = ''; return renderIrl(I.pick ? '#irl-q' : '[data-rl-pick-open]'); }
  if (d.rlMemberRm !== undefined) return memberSet(b, 'irl', d.rlMemberRm, false, 'irl');
  if (d.rlMemberAdd !== undefined) return memberSet(b, 'irl', d.rlMemberAdd, true, 'irl');
}

/** Recherche dans le dialogue d'ajout des membres IRL. */
function onIrlInput(ev) {
  if (ev.target.id !== 'irl-q') return;
  I.q = ev.target.value;
  const ul = I.root.querySelector('[data-picker-results]');
  if (ul) ul.innerHTML = resultsHtml('irl', I.q);
}

/* =========================================================
   Écritures communes (une ligne membre-rôle)
   ========================================================= */
/**
 * Donne (on) ou retire un rôle à un membre depuis une vue du panel, puis redessine les deux vues.
 * view : la vue où le clic a eu lieu (son champ de recherche reste au point).
 */
async function memberSet(btn, roleId, uid, on, view) {
  const label = roleById(roleId)?.label ?? roleId;
  const name = pseudoOf(memberById(uid));
  await busy(btn, async () => {
    check(await sb.rpc('hg_member_role_set', { p_user: uid, p_role: roleId, p_on: on }));
    await loadData();
    if (view === 'roles') { renderRoles(R.pick ? '#rl-q' : null); if (I.mounted) renderIrl(); }
    else { renderIrl(I.pick ? '#irl-q' : null); if (R.mounted) renderRoles(); }
    toast(on ? `${name} a le rôle ${label}` : `${name} n’a plus le rôle ${label}`, 'ok');
  });
}

/**
 * Relit les rôles et les membres, puis redessine les vues ouvertes. Appelée après une modification faite
 * depuis la fiche d'un membre (rôles ou accès), pour que les sections restent à jour.
 */
export async function refreshRolesViews() {
  if (!R.mounted && !I.mounted) return;
  try { await loadData(); } catch (e) { toast(errMsg(e), 'error'); return; }
  if (R.mounted) renderRoles();
  if (I.mounted) renderIrl();
}

/* =========================================================
   Fiche d'un membre (admin-accounts/fiche.js) : bloc des rôles
   ========================================================= */
/**
 * Bloc « Rôles » de la fiche : puces des rôles du membre (un clic retire), et menu pour en ajouter un.
 * @param {{pseudo: string, roles: Array<{id, label, color}>, mine: string[]}} v Rôles connus et identifiants donnés au membre.
 */
export function memberRolesHtml({ pseudo, roles, mine }) {
  const held = roles.filter((r) => mine.includes(r.id));
  const free = roles.filter((r) => !mine.includes(r.id));
  const who = esc(pseudo || 'ce membre');
  const chips = held.length
    ? `<ul class="ra-chips">${held.map((r) => `<li><button type="button" class="ra-chip" data-role-remove="${esc(r.id)}" style="--ra-c:${colorOf(r.color)}" aria-label="Retirer le rôle ${esc(r.label)} à ${who}"><span>${esc(r.label)}</span><span class="ra-x" aria-hidden="true">×</span></button></li>`).join('')}</ul>`
    : '<p class="small muted">Aucun rôle : les accès viennent des réglages à la main et des pages ouvertes à tous.</p>';
  const add = free.length
    ? `<div class="ra-add"><div class="field"><label for="ra-role-select">Ajouter un rôle</label>
         <select id="ra-role-select">${free.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('')}</select></div>
         <button type="button" class="btn btn-ghost" data-role-add>Ajouter le rôle</button></div>`
    : `<p class="small muted">${roles.length ? 'Tous les rôles sont déjà donnés.' : 'Aucun rôle n’existe encore : crée-les dans Membres › Rôles.'}</p>`;
  return `<div class="ra-roles">
    <h4 class="ra-sub">Rôles</h4>
    ${chips}
    ${add}
    <p class="small"><a href="#membres/roles">Gérer les rôles</a></p>
  </div>`;
}

/** Donne (on) ou retire un rôle à un membre, depuis sa fiche. Renvoie rien ; l'erreur remonte à l'appelant. */
export async function memberRoleChange(uid, roleId, on) {
  check(await sb.rpc('hg_member_role_set', { p_user: uid, p_role: roleId, p_on: on }));
}

/** Remet une page au réglage par défaut pour un membre : son accès revient au rôle qui la donne, ou au mode de la page. */
export async function memberAccessReset(uid, slug) {
  check(await sb.rpc('hg_member_access_reset', { p_user: uid, p_slug: slug }));
}
