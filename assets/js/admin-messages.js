// ===== Humane Gang — administration : messagerie (lecture + modération) =====
// Communication › Messagerie : conversations en colonne 2 (createList, filtres Toutes / Directes / Secret Santa),
// lecture en détail dans la zone principale (createThread en lecture seule). Route : #communication/messagerie[/<id>].
// Métadonnées des conversations via rpc hg_admin_conversations(). Les messages ne sont lus que par rpc
// hg_admin_read_conversation, qui journalise chaque lecture ; la suppression d'un message passe par hg_messages.
// L'admin voit les vrais expéditeurs, y compris le Santa.
import { sb, toast, errMsg, esc, $ } from './core.js';
import { svg } from './icons.js';
import { createList } from './admin/ui/list.js';
import { createThread } from './admin/ui/thread.js';
import { setActions } from './admin/shell.js';
import { confirmBox } from './ui-confirm.js';

const PAGE = 200; // messages par lecture journalisée (limite de la RPC : 500)
const FILTERS = [
  { id: 'direct', label: 'Directes', test: (c) => c.kind === 'direct' },
  { id: 'santa', label: 'Secret Santa', test: (c) => c.kind === 'santa' },
];
const dtFmt = new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmt = (d) => (d ? dtFmt.format(new Date(d)) : '');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const TRASH = svg('trash', { stroke: 2 });
function check(res) { if (res.error) throw res.error; return res.data; }

// État de la section (partagé entre la liste, la lecture et les visites successives)
const M = {
  convs: [], pseudo: new Map(), sel: null, conv: null, msgs: [], lastId: 0, more: false,
  list: null, reader: null, thread: null, mounted: false, token: 0,
};

function convTitle(c) {
  return c.kind === 'santa'
    ? `${c.santa || '?'} (Santa) → ${c.target || '?'}`
    : (c.members || 'Conversation vide');
}
function toItem(c) {
  return {
    id: c.id,
    name: convTitle(c),
    title: c.kind === 'santa' ? `Secret Santa${c.edition_year ? ` ${c.edition_year}` : ''}` : 'Conversation directe',
    excerpt: c.messages ? `${c.messages} message${c.messages > 1 ? 's' : ''}` : 'Aucun message',
    at: c.last_message_at,
    status: c.kind === 'santa' ? { id: 'santa', label: 'Secret Santa', tone: 'santa' } : { id: 'direct', label: 'Directe', tone: 'muted' },
    kind: c.kind,
  };
}
const convItems = () => M.convs.map(toItem);

async function loadPseudos() {
  // Annuaire public du Staff (hg_staff_directory) : accessible à tout Staff, sans lecture complète de hg_profiles
  const rows = check(await sb.rpc('hg_staff_directory')) ?? [];
  M.pseudo = new Map(rows.map((r) => [r.id, r.pseudo]));
}
async function loadConvs() {
  M.convs = check(await sb.rpc('hg_admin_conversations')) ?? [];
}

// Les messages passent par la RPC hg_admin_read_conversation, qui journalise chaque lecture (hg_admin_access_log).
// Une page = une lecture journalisée : on ne charge la suite qu'à la demande.
async function fetchMessages(id, after) {
  return check(await sb.rpc('hg_admin_read_conversation', { p_conv: id, p_after: after, p_limit: PAGE })) ?? [];
}

function senderName(m, conv) {
  if (!m.sender_id) return 'Ancien membre';
  const name = M.pseudo.get(m.sender_id) || 'Membre inconnu';
  return conv?.kind === 'santa' && m.sender_id === conv.santa_id ? `${name} (Santa)` : name;
}
function toMessages() {
  return M.msgs.map((m) => ({
    id: m.id,
    type: 'message',
    author: { id: m.sender_id, pseudo: senderName(m, M.conv) },
    body: m.body,
    at: m.created_at,
    mine: false,
  }));
}

function paintReader() {
  if (!M.reader) return;
  if (!M.sel) {
    M.reader.innerHTML = `<div class="empty">Choisis une conversation dans la liste pour la lire.</div>
      <p class="muted small amsg-hint">Les membres voient « Ton Santa » ; ici, le vrai expéditeur est affiché. À utiliser uniquement pour la modération.</p>`;
    M.thread = null;
    return;
  }
  const c = M.conv || {};
  const who = c.kind === 'santa'
    ? `${M.pseudo.get(c.santa_id) || c.santa || '?'} (Santa, anonyme pour sa cible) → ${M.pseudo.get(c.target_id) || c.target || '?'}`
    : (c.members || '');
  M.reader.innerHTML = `
    <div class="amsg-reader-head">
      <div class="amsg-reader-title">
        <h3 class="card-title">${c.kind === 'santa' ? 'Conversation Secret Santa' : 'Conversation directe'}</h3>
        <p class="muted small">${esc(who)}</p>
      </div>
      <p class="amsg-audit" role="note">Lecture journalisée : cette consultation est enregistrée</p>
    </div>
    ${M.more ? '<div class="btn-row"><button class="btn btn-ghost" type="button" id="amsg-more">Charger les messages suivants</button></div>' : ''}
    <div class="amsg-thread" id="amsg-thread"></div>`;
  $('#amsg-more', M.reader)?.addEventListener('click', (e) => loadMore(e.currentTarget));
  const host = $('#amsg-thread', M.reader);
  M.thread = createThread(host, {
    messages: toMessages(), composer: false, label: 'Messages de la conversation',
    rowAction: (m) => `<button class="btn btn-ghost btn-sm amsg-del" type="button" data-row-act="${esc(m.id)}" aria-label="Supprimer le message de ${esc(m.author?.pseudo || '')} du ${esc(fmt(m.at))}">${TRASH}<span>Supprimer</span></button>`,
    onRowAction: (m, b) => del(m, b),
  });
  if (!M.msgs.length) host.insertAdjacentHTML('afterbegin', '<div class="empty">Aucun message dans cette conversation.</div>');
}

async function openConv(id) {
  const token = ++M.token;
  M.sel = id;
  M.conv = M.convs.find((c) => c.id === id) || null;
  M.msgs = []; M.lastId = 0; M.more = false;
  M.list?.select(id);
  if (M.reader) M.reader.innerHTML = '<div class="empty">Chargement des messages…</div>';
  try {
    const [conv, msgs] = await Promise.all([
      sb.from('hg_conversations').select('id, kind, santa_id, target_id, edition_id, created_at').eq('id', id).maybeSingle(),
      fetchMessages(id, 0),
    ]);
    if (token !== M.token) return;
    M.conv = { ...(M.conv || {}), ...(check(conv) || {}) };
    M.msgs = msgs;
    M.lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
    M.more = msgs.length === PAGE;
    paintReader();
  } catch (e) {
    if (token === M.token && M.reader) M.reader.innerHTML = `<div class="empty">Impossible de charger : ${esc(errMsg(e))}</div>`;
  }
}

async function loadMore(btn) {
  const id = M.sel;
  btn.disabled = true;
  try {
    const msgs = await fetchMessages(id, M.lastId);
    if (M.sel !== id) return;
    M.msgs = M.msgs.concat(msgs);
    if (msgs.length) M.lastId = msgs[msgs.length - 1].id;
    M.more = msgs.length === PAGE;
    paintReader();
  } catch (e) {
    btn.disabled = false;
    toast(`Chargement impossible : ${errMsg(e)}`, 'error');
  }
}

function confirmDelete(body) {
  const q = body.length > 300 ? `${body.slice(0, 300)}…` : body;
  return confirmBox('Supprimer ce message ?', `Le message sera supprimé définitivement pour tous les membres de la conversation.\n\n« ${q} »`, { ok: 'Supprimer', danger: true });
}

async function del(m, btn) {
  if (!(await confirmDelete(m.body))) return;
  if (btn) btn.disabled = true;
  try {
    const gone = check(await sb.from('hg_messages').delete().eq('id', m.id).select('id'));
    if (Array.isArray(gone) && !gone.length) throw new Error('suppression refusée');
    M.msgs = M.msgs.filter((x) => x.id !== m.id);
    const c = M.convs.find((x) => x.id === M.sel);
    if (c) c.messages = Math.max(0, (c.messages || 1) - 1);
    paintReader();
    M.list?.update(convItems());
    toast('Message supprimé', 'ok');
  } catch (e) {
    toast(`Suppression impossible : ${errMsg(e)}`, 'error');
    if (btn) btn.disabled = false;
  }
}

async function refresh() {
  try {
    await Promise.all([loadConvs(), M.pseudo.size ? null : loadPseudos()]);
    M.list?.update(convItems());
    if (M.sel) await openConv(M.sel);
  } catch (e) {
    toast(`Actualisation impossible : ${errMsg(e)}`, 'error');
  }
}

/** Section Messagerie : zone principale (lecture). Montée à la première visite (admin.js). */
export function mountMessagesSection(container) {
  if (!container || M.mounted) return;
  M.mounted = true;
  container.innerHTML = '<div class="amsg-reader" id="amsg-reader" aria-live="polite"></div>';
  M.reader = container.querySelector('#amsg-reader');
  paintReader();
  refresh();
}

/** Colonne 2 : liste des conversations (registerSub list). */
export function listMessages(el) {
  M.list = createList(el, {
    items: convItems(),
    key: 'id',
    label: 'Conversations',
    filters: FILTERS,
    search: { placeholder: 'Rechercher un pseudo…', label: 'Rechercher un pseudo', fields: (it) => `${it.name} ${it.title}` },
    selectedId: M.sel,
    empty: 'Aucune conversation pour l’instant.',
    onSelect: (it) => { location.hash = `#communication/messagerie/${it.id}`; },
  });
}

/** Affichage (registerSub open, à chaque visite) : sélection, actions de l'en-tête. */
export function openMessages(_el, { id } = {}) {
  setActions(messageActions());
  if (!id) { M.token++; M.sel = null; M.conv = null; M.list?.select(null); paintReader(); return; }
  if (!M.convs.some((c) => c.id === id)) { toast('Conversation introuvable.', 'error'); return; }
  openConv(id);
}

function messageActions() {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.textContent = 'Actualiser';
  b.addEventListener('click', async () => { b.disabled = true; M.pseudo = new Map(); await refresh(); b.disabled = false; });
  return [b];
}
