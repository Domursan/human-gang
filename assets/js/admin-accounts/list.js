// Comptes admin : liste des comptes (recherche, lignes, rechargement).
import { sb, esc, errMsg, fmtDate, fmtDateTime, avatarHtml, $ } from '../core.js';
import { fmtDay } from '../utils.js';
import { fetchAdminGhosts } from '../admin-ghosts.js';
import { moreHtml, PAGE_SIZE } from '../admin/list-tools.js';
import { IC, check, norm } from './common.js';
import { A, root } from './state.js';

/* =========================================================
   Liste des comptes
   ========================================================= */
export async function loadAccounts() {
  const [acc, mem, gh] = await Promise.all([
    sb.rpc('hg_admin_accounts'), sb.rpc('hg_members'),
    fetchAdminGhosts().catch((e) => { console.warn('[fantômes]', e); return []; }), // admin seulement : les membres ne les voient jamais
  ]);
  const real = check(acc) ?? [];
  const ids = new Set(real.map((a) => a.id));
  const ghosts = gh.filter((g) => !ids.has(g.id)).map((g) => ({
    id: g.id, pseudo: g.pseudo, email: null, is_admin: false, created_at: null, last_sign_in_at: null,
    is_ghost: true, avatar_url: g.avatar_url, joined_on: g.joined_on,
  }));
  A.accounts = [...real, ...ghosts].sort((a, b) => (!a.pseudo - !b.pseudo) || String(a.pseudo ?? a.email ?? '').localeCompare(String(b.pseudo ?? b.email ?? ''), 'fr'));
  A.avatars = new Map((mem.data ?? []).map((m) => [m.id, m]));
  for (const g of ghosts) A.avatars.set(g.id, { id: g.id, pseudo: g.pseudo, avatar_url: g.avatar_url });
  // Date d'arrivée réelle dans le gang (saisie par l'admin) : absente de hg_admin_accounts
  const jo = await sb.from('hg_profiles').select('id, joined_on');
  if (!jo.error) { const m = new Map((jo.data ?? []).map((r) => [r.id, r.joined_on])); for (const a of A.accounts) a.joined_on = m.get(a.id) ?? null; }
}
/** 'AAAA-MM-JJ' -> date lisible, sans décalage de fuseau. */

export function renderList() {
  root().innerHTML = `
    <div class="card stack">
      <div class="acc-toolbar">
        <div class="field acc-search">
          <label for="acc-q">Rechercher un compte</label>
          <div class="acc-search-box">${IC.search}<input id="acc-q" type="search" autocomplete="off" placeholder="Pseudo ou e-mail" value="${esc(A.q)}"></div>
        </div>
        <p class="small muted acc-count" id="acc-count" aria-live="polite"></p>
      </div>
      <div class="acc-head" aria-hidden="true"><span>Membre</span><span>E-mail</span><span>Inscrit le</span><span>Arrivée</span><span>Dernière connexion</span><span></span></div>
      <ul class="acc-list" id="acc-list"></ul>
    </div>`;
  renderRows();
}
export function renderRows() {
  const list = $('#acc-list'); if (!list) return;
  if (A.listError) { list.innerHTML = `<li class="empty">Impossible de charger les comptes : ${esc(errMsg(A.listError))}</li>`; return; }
  const q = norm(A.q.trim());
  const found = A.accounts.filter((a) => !q || norm(a.pseudo).includes(q) || norm(a.email).includes(q));
  const rows = found.slice(0, A.shown);
  $('#acc-count').textContent = q ? `${found.length} / ${A.accounts.length} comptes` : `${A.accounts.length} compte${A.accounts.length > 1 ? 's' : ''}`;
  list.innerHTML = (rows.length ? rows.map((a) => {
    const m = { ...(A.avatars.get(a.id) || {}), pseudo: a.pseudo || '?' };
    const inner = `
      <span class="acc-who">${avatarHtml(m, 36)}<span class="acc-name"><strong>${esc(a.pseudo || 'Sans profil')}</strong>
        ${a.is_ghost ? '<span class="pill pill-muted acc-pill">(fantôme)</span>' : ''}${a.is_admin ? '<span class="pill pill-ok acc-pill">admin</span>' : ''}${a.id === A.me.id ? '<span class="pill pill-muted acc-pill">toi</span>' : ''}</span></span>
      <span class="acc-email">${esc(a.email || '—')}</span>
      ${a.is_ghost
        ? '<span class="acc-date"><span class="acc-k">Statut : </span>pas encore inscrit</span>'
        : `<span class="acc-date"><span class="acc-k">Inscrit le </span>${esc(fmtDate(a.created_at))}</span>`}
      <span class="acc-date"><span class="acc-k">Arrivée dans le gang : </span>${a.joined_on ? esc(fmtDay(a.joined_on)) : '<span class="acc-none">non renseignée</span>'}</span>
      <span class="acc-date"><span class="acc-k">Dernière connexion : </span>${a.is_ghost ? '—' : a.last_sign_in_at ? esc(fmtDateTime(a.last_sign_in_at)) : 'jamais'}</span>
      <span class="acc-go">${a.pseudo ? IC.chev : ''}</span>`;
    return a.pseudo
      ? `<li><button class="acc-row" type="button" data-open="${esc(a.id)}" aria-label="Ouvrir la fiche de ${esc(a.pseudo)}">${inner}</button></li>`
      : `<li><div class="acc-row is-disabled" title="Compte créé sans code d'invitation : aucun profil Humane Gang">${inner}</div></li>`;
  }).join('') : '<li class="empty">Aucun compte ne correspond à la recherche.</li>')
    + (rows.length < found.length ? `<li class="lt-more-li">${moreHtml('acc-more', rows.length, found.length, 'data-more="accounts"')}</li>` : '');
}

/** Recharge la liste (ex. après un changement fait ailleurs dans l'admin). */
export async function refreshAccounts() {
  try { await loadAccounts(); A.listError = null; } catch (e) { A.listError = e; }
  if (!A.uid) renderRows();
}
