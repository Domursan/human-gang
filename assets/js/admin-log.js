// ===== Humane Gang — administration : journal =====
// Lecture seule de hg_admin_log (actions de l'administrateur) et de hg_admin_access_log (consultations
// des conversations dans la messagerie). Pseudos résolus via hg_profiles (policy de lecture admin).
import { sb, esc, errMsg, fmtDateTime, $ } from './core.js';
import { onTableChange } from './admin/live.js';

const PAGE = 25;
// Libellés des actions journalisées par hg_admin_audit et les triggers. Une action inconnue s'affiche telle quelle.
const ACTION_LABEL = {
  carte_donnee: 'Carte donnée',
  exemplaire_retire: 'Exemplaire retiré',
  carte_supprimee: 'Carte supprimée',
  ajustement_paillettes: 'Ajustement de Paillettes',
};
const KIND_LABEL = { santa: 'Secret Santa', direct: 'Conversation directe' };

function check(res) { if (res.error) throw res.error; return res.data; }
const actionLabel = (a) => ACTION_LABEL[a] ?? a;
const errBox = (e) => `<div class="empty">Impossible de charger : ${esc(errMsg(e))}</div>`;

function detailsHtml(d) {
  const entries = Object.entries(d ?? {});
  if (!entries.length) return '';
  return `<dl class="log-details">${entries.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v))}</dd></div>`).join('')}</dl>`;
}

export function mountLogSection(container) {
  if (!container) return;
  const S = { pseudo: new Map(), actions: new Set(), action: '', rows: [], more: false, access: [], accessMore: false };

  container.innerHTML = `
    <div class="card stack">
      <h3 class="card-title">Actions de l'administrateur</h3>
      <p class="muted small">Tirages, cartes données ou retirées, ajustements de Paillettes, suppressions de cartes.</p>
      <div class="field narrow">
        <label for="log-action">Filtrer par action</label>
        <select id="log-action"><option value="">Toutes les actions</option></select>
      </div>
      <div id="log-list" aria-live="polite"><div class="empty">Chargement…</div></div>
      <div class="btn-row" id="log-more-row" hidden><button class="btn btn-ghost" type="button" id="log-more">Charger plus</button></div>
    </div>
    <div class="card stack">
      <h3 class="card-title">Consultations des messages</h3>
      <p class="muted small">Chaque ouverture d'une conversation dans la messagerie est enregistrée ici, avec l'administrateur qui l'a lue.</p>
      <div id="log-access" aria-live="polite"><div class="empty">Chargement…</div></div>
      <div class="btn-row" id="log-access-more-row" hidden><button class="btn btn-ghost" type="button" id="log-access-more">Charger plus</button></div>
    </div>`;

  const who = (id) => (id ? S.pseudo.get(id) ?? 'Compte supprimé' : 'Système');
  const select = $('#log-action', container);

  function syncActionOptions() {
    const known = new Set([...Object.keys(ACTION_LABEL), ...S.actions]);
    const current = select.value;
    select.innerHTML = '<option value="">Toutes les actions</option>'
      + [...known].sort().map((a) => `<option value="${esc(a)}">${esc(actionLabel(a))}</option>`).join('');
    select.value = current;
  }

  async function loadPseudos() {
    const rows = check(await sb.from('hg_profiles').select('id, pseudo')) ?? [];
    S.pseudo = new Map(rows.map((r) => [r.id, r.pseudo]));
  }

  function renderLog() {
    const box = $('#log-list', container);
    box.innerHTML = S.rows.length ? `<ol class="log-list">${S.rows.map((r) => `
      <li class="log-row">
        <div class="item-meta"><time datetime="${esc(r.created_at)}">${esc(fmtDateTime(r.created_at))}</time>
          <strong>${esc(actionLabel(r.action))}</strong></div>
        <p class="small muted">Par ${esc(who(r.admin_id))}${r.target_user ? ` · cible : ${esc(who(r.target_user))}` : ''}${r.target_ref ? ` · réf. ${esc(r.target_ref)}` : ''}</p>
        ${detailsHtml(r.details)}
      </li>`).join('')}</ol>`
      : `<div class="empty">${S.action ? 'Aucune entrée pour cette action.' : 'Aucune action journalisée pour l’instant.'}</div>`;
    $('#log-more-row', container).hidden = !S.more;
  }

  async function loadLog(reset) {
    const from = reset ? 0 : S.rows.length;
    try {
      let q = sb.from('hg_admin_log').select('id, admin_id, action, target_user, target_ref, details, created_at')
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(from, from + PAGE); // une ligne de plus que la page : indique s'il reste des entrées
      if (S.action) q = q.eq('action', S.action);
      const got = check(await q) ?? [];
      S.more = got.length > PAGE;
      const page = got.slice(0, PAGE);
      got.forEach((r) => S.actions.add(r.action));
      S.rows = reset ? page : S.rows.concat(page);
      syncActionOptions();
      renderLog();
    } catch (e) {
      $('#log-list', container).innerHTML = errBox(e);
      $('#log-more-row', container).hidden = true;
    }
  }

  function renderAccess() {
    const box = $('#log-access', container);
    box.innerHTML = S.access.length ? `<ol class="log-list">${S.access.map((r) => `
      <li class="log-row">
        <div class="item-meta"><time datetime="${esc(r.accessed_at)}">${esc(fmtDateTime(r.accessed_at))}</time>
          <strong>${esc(who(r.admin_id))}</strong></div>
        <p class="small muted">${esc(KIND_LABEL[r.conversation_kind] ?? 'Conversation')} · réf. ${esc(String(r.conversation_id ?? '').slice(0, 8))}</p>
      </li>`).join('')}</ol>`
      : '<div class="empty">Aucune consultation enregistrée.</div>';
    $('#log-access-more-row', container).hidden = !S.accessMore;
  }

  async function loadAccess(reset) {
    const from = reset ? 0 : S.access.length;
    try {
      const got = check(await sb.from('hg_admin_access_log').select('id, admin_id, conversation_id, conversation_kind, accessed_at')
        .order('accessed_at', { ascending: false }).order('id', { ascending: false })
        .range(from, from + PAGE)) ?? [];
      S.accessMore = got.length > PAGE;
      const page = got.slice(0, PAGE);
      S.access = reset ? page : S.access.concat(page);
      renderAccess();
    } catch (e) {
      $('#log-access', container).innerHTML = errBox(e);
      $('#log-access-more-row', container).hidden = true;
    }
  }

  select.addEventListener('change', () => { S.action = select.value; S.rows = []; loadLog(true); });
  $('#log-more', container).addEventListener('click', (e) => { e.currentTarget.disabled = true; loadLog(false).finally(() => { e.currentTarget.disabled = false; }); });
  $('#log-access-more', container).addEventListener('click', (e) => { e.currentTarget.disabled = true; loadAccess(false).finally(() => { e.currentTarget.disabled = false; }); });

  async function init() {
    try { await loadPseudos(); } catch (e) { console.warn('[journal] pseudos', e); }
    await Promise.all([loadLog(true), loadAccess(true)]);
  }
  init();
  onTableChange('journal', ['hg_admin_log'], () => Promise.all([loadLog(true), loadAccess(true)]));
}
