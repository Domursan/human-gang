// ===== Humane Gang — administration : messagerie (lecture + modération) =====
// Lecture directe des tables hg_conversations / hg_conversation_members / hg_messages (policies admin),
// liste via rpc hg_admin_conversations(). L'admin voit les vrais expéditeurs, y compris le Santa.
import { sb, toast, errMsg, esc, $ } from './core.js';

const ICON = {
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  mask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0v3c0 4-3 6-5.5 6-1.6 0-2.6-1.3-3.5-3-.9 1.7-1.9 3-3.5 3C6 17 3 15 3 11V8z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6L20 8"/><path d="M20 3v5h-5"/></svg>',
};
const FILTERS = [['all', 'Toutes'], ['direct', 'Directes'], ['santa', 'Secret Santa']];
const dtFmt = new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmt = (d) => (d ? dtFmt.format(new Date(d)) : '');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function check(res) { if (res.error) throw res.error; return res.data; }

export function mountMessagesSection(container) {
  if (!container) return;
  const S = { convs: [], pseudo: new Map(), filter: 'all', q: '', current: null, msgs: [], conv: null };

  container.innerHTML = `
    <div class="card amsg">
      <div class="amsg-tools">
        <div class="filters" role="group" aria-label="Filtrer les conversations" id="amsg-filters">
          ${FILTERS.map(([k, l]) => `<button class="chip" type="button" data-filter="${k}" aria-pressed="${k === 'all'}">${l}</button>`).join('')}
        </div>
        <div class="field amsg-search">
          <label for="amsg-q" class="visually-hidden">Rechercher par pseudo</label>
          <input id="amsg-q" type="search" placeholder="Rechercher un pseudo…" autocomplete="off">
        </div>
        <button class="btn btn-ghost btn-icon" type="button" id="amsg-refresh" aria-label="Actualiser">${ICON.refresh}</button>
      </div>
      <p class="muted small">Les membres voient « Ton Santa » ; ici, le vrai expéditeur est affiché. À utiliser uniquement pour la modération (suppression d’un message abusif).</p>
      <div class="amsg-layout" data-view="list">
        <div class="amsg-list" id="amsg-list"><div class="empty">Chargement…</div></div>
        <div class="amsg-reader" id="amsg-reader" aria-live="polite"><div class="empty">Choisis une conversation pour la lire.</div></div>
      </div>
    </div>
    <dialog class="hg-dialog" id="amsg-dlg" aria-labelledby="amsg-dlg-t">
      <form method="dialog" class="stack">
        <h2 id="amsg-dlg-t" class="dialog-title">Supprimer ce message ?</h2>
        <p class="muted">Le message sera supprimé définitivement pour tous les membres de la conversation.</p>
        <blockquote class="amsg-quote" id="amsg-dlg-q"></blockquote>
        <div class="btn-row dialog-actions">
          <button class="btn btn-ghost" value="cancel" type="submit">Annuler</button>
          <button class="btn btn-danger" value="ok" type="submit">Supprimer</button>
        </div>
      </form>
    </dialog>`;

  const listEl = $('#amsg-list', container), reader = $('#amsg-reader', container), layout = $('.amsg-layout', container);
  const dlg = $('#amsg-dlg', container);

  function confirmDelete(body) {
    $('#amsg-dlg-q', container).textContent = body.length > 300 ? `${body.slice(0, 300)}…` : body;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
  }

  async function loadPseudos() {
    let rows = null;
    try { rows = check(await sb.rpc('hg_admin_accounts')); } catch (e) { console.warn('[admin messages] hg_admin_accounts', e); }
    if (!rows) rows = check(await sb.from('hg_profiles').select('id, pseudo')) ?? [];
    S.pseudo = new Map(rows.map((r) => [r.id, r.pseudo]));
  }
  async function loadConvs() {
    S.convs = check(await sb.rpc('hg_admin_conversations')) ?? [];
  }

  function visible() {
    const q = norm(S.q.trim());
    return S.convs.filter((c) => (S.filter === 'all' || c.kind === S.filter)
      && (!q || norm(`${c.members} ${c.santa} ${c.target}`).includes(q)));
  }
  function convLabel(c) {
    return c.kind === 'santa'
      ? `<span class="amsg-who">${esc(c.santa || '?')} <span class="muted">(Santa)</span> → ${esc(c.target || '?')}</span>`
      : `<span class="amsg-who">${esc(c.members || 'Conversation vide')}</span>`;
  }
  function renderList() {
    const rows = visible();
    if (!rows.length) {
      listEl.innerHTML = `<div class="empty">${S.convs.length ? 'Aucune conversation ne correspond.' : 'Aucune conversation pour l’instant.'}</div>`;
      return;
    }
    listEl.innerHTML = `<ul class="amsg-convs">${rows.map((c) => `
      <li><button type="button" class="amsg-conv${c.kind === 'santa' ? ' is-santa' : ''}" data-conv="${esc(c.id)}"${c.id === S.current ? ' aria-current="true"' : ''}>
        <span class="amsg-conv-top">
          <span class="pill ${c.kind === 'santa' ? 'amsg-pill-santa' : 'pill-muted'}">${c.kind === 'santa' ? `${ICON.mask}Secret Santa${c.edition_year ? ` ${esc(c.edition_year)}` : ''}` : 'Directe'}</span>
          <span class="muted small">${esc(c.messages)} msg</span>
        </span>
        ${convLabel(c)}
        <span class="muted small">${c.messages ? `Dernier message le ${esc(fmt(c.last_message_at))}` : `Créée le ${esc(fmt(c.last_message_at))}`}</span>
      </button></li>`).join('')}</ul>`;
  }

  async function openConv(id) {
    S.current = id;
    S.conv = S.convs.find((c) => c.id === id) || null;
    layout.dataset.view = 'reader';
    renderList();
    reader.innerHTML = '<div class="empty">Chargement des messages…</div>';
    try {
      const [conv, msgs] = await Promise.all([
        sb.from('hg_conversations').select('id, kind, santa_id, target_id, edition_id, created_at').eq('id', id).maybeSingle(),
        sb.from('hg_messages').select('id, sender_id, body, created_at').eq('conversation_id', id).order('id', { ascending: true }).limit(2000),
      ]);
      S.conv = { ...(S.conv || {}), ...(check(conv) || {}) };
      S.msgs = check(msgs) ?? [];
      if (S.current !== id) return;
      renderReader();
    } catch (e) {
      reader.innerHTML = `<div class="empty">Impossible de charger : ${esc(errMsg(e))}</div>`;
    }
  }
  function senderName(m) {
    if (!m.sender_id) return 'Ancien membre';
    return S.pseudo.get(m.sender_id) || 'Membre inconnu';
  }
  function renderReader() {
    const c = S.conv || {};
    const head = `
      <div class="amsg-reader-head">
        <button class="btn btn-ghost btn-icon amsg-back" type="button" id="amsg-back" aria-label="Retour à la liste">${ICON.back}</button>
        <div class="amsg-reader-title">
          <h3 class="card-title">${c.kind === 'santa' ? 'Conversation Secret Santa' : 'Conversation directe'}</h3>
          <p class="muted small">${c.kind === 'santa' ? `${esc(S.pseudo.get(c.santa_id) || c.santa || '?')} (Santa, anonyme pour sa cible) → ${esc(S.pseudo.get(c.target_id) || c.target || '?')}` : esc(c.members || '')}</p>
        </div>
      </div>`;
    const body = S.msgs.length
      ? `<ol class="amsg-msgs" aria-label="Messages">${S.msgs.map((m) => {
          const isSanta = c.kind === 'santa' && m.sender_id && m.sender_id === c.santa_id;
          return `<li class="amsg-msg${isSanta ? ' is-santa' : ''}">
            <div class="item-meta"><strong>${esc(senderName(m))}</strong>${isSanta ? '<span class="pill amsg-pill-santa">Santa</span>' : ''}<time datetime="${esc(m.created_at)}">${esc(fmt(m.created_at))}</time></div>
            <p class="item-body">${esc(m.body)}</p>
            <button class="btn btn-ghost btn-sm amsg-del" type="button" data-del="${esc(m.id)}" aria-label="Supprimer le message de ${esc(senderName(m))} du ${esc(fmt(m.created_at))}">${ICON.trash}<span>Supprimer</span></button>
          </li>`;
        }).join('')}</ol>`
      : '<div class="empty">Aucun message dans cette conversation.</div>';
    reader.innerHTML = head + body;
    $('#amsg-back', reader).addEventListener('click', () => { layout.dataset.view = 'list'; S.current = null; renderList(); });
    reader.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => del(b)));
  }
  async function del(btn) {
    const id = Number(btn.dataset.del);
    const m = S.msgs.find((x) => x.id === id);
    if (!m || !(await confirmDelete(m.body))) return;
    btn.disabled = true;
    try {
      const res = await sb.from('hg_messages').delete().eq('id', id).select('id');
      const gone = check(res);
      if (Array.isArray(gone) && !gone.length) throw new Error('suppression refusée');
      S.msgs = S.msgs.filter((x) => x.id !== id);
      const c = S.convs.find((x) => x.id === S.current);
      if (c) c.messages = Math.max(0, (c.messages || 1) - 1);
      renderReader(); renderList();
      toast('Message supprimé', 'ok');
    } catch (e) { toast(`Suppression impossible : ${errMsg(e)}`, 'error'); btn.disabled = false; }
  }

  async function refresh() {
    try {
      await Promise.all([loadConvs(), S.pseudo.size ? null : loadPseudos()]);
      renderList();
      if (S.current) await openConv(S.current);
    } catch (e) { listEl.innerHTML = `<div class="empty">Impossible de charger : ${esc(errMsg(e))}</div>`; }
  }

  $('#amsg-filters', container).addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]'); if (!b) return;
    S.filter = b.dataset.filter;
    container.querySelectorAll('#amsg-filters .chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderList();
  });
  $('#amsg-q', container).addEventListener('input', (e) => { S.q = e.target.value; renderList(); });
  $('#amsg-refresh', container).addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    S.pseudo = new Map();
    await refresh(); b.disabled = false;
  });
  listEl.addEventListener('click', (e) => { const b = e.target.closest('[data-conv]'); if (b) openConv(b.dataset.conv); });

  refresh();
}
