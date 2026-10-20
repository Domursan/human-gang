// ===== Humane Gang — messagerie (conversations directes + Secret Santa anonyme) =====
import * as core from './core.js';
import { sb, initPage, toast, errMsg, esc, $, avatarHtml, notify } from './core.js';

const me = await initPage({ auth: 'member' });
const app = $('#app');

const MAX_LEN = 4000;
const POLL_THREAD_MS = 4000;
const POLL_LIST_MS = 15000;
const MOBILE = matchMedia('(max-width: 760px)');

/* ---------- Icônes (SVG à trait) ---------- */
const I = {
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  send: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5L4 12z"/><path d="M11.5 13.5L20 4"/></svg>',
  mask: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0v3c0 4-3 6-5.5 6-1.6 0-2.6-1.3-3.5-3-.9 1.7-1.9 3-3.5 3C6 17 3 15 3 11V8z"/><path d="M7 11.5h2M15 11.5h2"/></svg>',
  chat: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5z"/><path d="M8 9.5h8M8 12.5h5"/></svg>',
  lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
};

/* ---------- État ---------- */
const S = {
  convs: [],           // hg_my_conversations()
  members: new Map(),  // id -> {pseudo, avatar_url, color}
  current: null,       // id de la conversation ouverte
  msgs: [],            // messages de la conversation ouverte
  lastId: 0,
  sending: false,
  loadingThread: false,
};
let threadTimer = null, listTimer = null;

/* ---------- Outils ---------- */
const memberOf = (id) => S.members.get(id) || null;
const convOf = (id) => S.convs.find((c) => c.id === id) || null;
/** Côté Secret Santa : 'target' = je suis la cible (mon Santa est anonyme), 'santa' = je suis le Santa (je reste anonyme). */
function santaSide(c) { return c?.kind === 'santa' ? (c.other_id ? 'santa' : 'target') : null; }
function playSound(name) { import('./sound.js').then((m) => m.playSound?.(name)).catch(() => {}); }
function refreshUnread() { try { core.refreshUnread?.(); } catch {} }

const timeFmt = new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long' });
const dayYearFmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: '2-digit' });
const shortYearFmt = new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: '2-digit', year: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'short' });
const fullFmt = new Intl.DateTimeFormat('fr-CH', { dateStyle: 'full', timeStyle: 'short' });
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const dayDiff = (d) => Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);

/** Heure relative courte pour la liste des conversations. */
function relTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `${min} min`;
  const dd = dayDiff(d);
  if (dd === 0) return timeFmt.format(d);
  if (dd === 1) return 'hier';
  if (dd < 7) return weekdayFmt.format(d);
  return d.getFullYear() === new Date().getFullYear() ? shortFmt.format(d) : shortYearFmt.format(d);
}
function dayLabel(ts) {
  const d = new Date(ts), dd = dayDiff(d);
  if (dd === 0) return 'Aujourd’hui';
  if (dd === 1) return 'Hier';
  const s = (d.getFullYear() === new Date().getFullYear() ? dayFmt : dayYearFmt).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Texte → HTML : échappé, URLs http(s) transformées en liens, sauts de ligne conservés (CSS pre-wrap). */
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
function linkify(text) {
  const src = String(text ?? '');
  let out = '', last = 0;
  for (const m of src.matchAll(URL_RE)) {
    let url = m[0];
    const trail = /[.,;:!?)\]}»]+$/.exec(url); // ponctuation finale = hors du lien
    if (trail) url = url.slice(0, -trail[0].length);
    out += esc(src.slice(last, m.index));
    let ok = false;
    try { const u = new URL(url); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch {}
    out += ok ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>` : esc(url);
    last = m.index + url.length;
  }
  return out + esc(src.slice(last));
}

/* ---------- Données ---------- */
async function loadMembers() {
  const { data, error } = await sb.rpc('hg_members');
  if (error) throw error;
  S.members = new Map((data || []).map((m) => [m.id, m]));
}
async function loadConvs() {
  const { data, error } = await sb.rpc('hg_my_conversations');
  if (error) throw error;
  S.convs = data || [];
}
async function fetchMessages(conv, after) {
  const all = [];
  for (let i = 0; i < 20; i++) { // pages de 500 (limite côté base)
    const { data, error } = await sb.rpc('hg_get_messages', { p_conv: conv, p_after: after, p_limit: 500 });
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < 500) break;
    after = rows[rows.length - 1].id;
  }
  return all;
}
async function markRead(conv) {
  const { error } = await sb.rpc('hg_mark_read', { p_conv: conv });
  if (error) { console.warn('[hg_mark_read]', error); return; }
  const c = convOf(conv); if (c) c.unread = 0;
  refreshUnread();
}

/* ---------- Squelette ---------- */
function renderShell() {
  app.innerHTML = `
    <div class="page-head msg-head">
      <div>
        <div class="eyebrow">Entre nous</div>
        <h1 class="page-title">Messages</h1>
      </div>
      <button class="btn btn-primary" type="button" id="msg-new" aria-label="Nouveau message">${I.plus}<span>Nouveau message</span></button>
    </div>
    <div class="msg-app" id="msg-app" data-view="list">
      <section class="msg-side" aria-labelledby="msg-side-t">
        <h2 id="msg-side-t" class="visually-hidden">Conversations</h2>
        <ul class="msg-convs" id="msg-convs"></ul>
      </section>
      <section class="msg-main" id="msg-main" aria-labelledby="msg-thread-t">
        <div class="msg-placeholder">
          <span class="msg-placeholder-icon">${I.chat}</span>
          <h2 id="msg-thread-t">Choisis une conversation</h2>
          <p class="muted">Ou écris à un membre avec « Nouveau message ».</p>
        </div>
      </section>
    </div>
    <p class="muted small msg-admin-note">${I.lock}<span>Les messages peuvent être consultés par l’admin. <a href="legal.html#confidentialite">En savoir plus</a></span></p>`;
  $('#msg-new').addEventListener('click', openNewDialog);
}

/* ---------- Liste des conversations ---------- */
function convAvatar(c, size = 44) {
  const side = santaSide(c);
  if (side === 'target') return `<span class="msg-av msg-av-santa" style="width:${size}px;height:${size}px" aria-hidden="true">${I.mask}</span>`;
  const m = memberOf(c.other_id) || { pseudo: c.title };
  return side === 'santa'
    ? `<span class="msg-av-wrap">${avatarHtml(m, size)}<span class="msg-av-badge" aria-hidden="true">${I.mask}</span></span>`
    : avatarHtml(m, size);
}
function renderConvs() {
  const ul = $('#msg-convs'); if (!ul) return;
  if (!S.convs.length) {
    ul.innerHTML = `<li class="msg-convs-empty"><div class="empty">Aucune conversation pour l’instant.<br>Lance-toi avec « Nouveau message ».</div></li>`;
    return;
  }
  ul.innerHTML = S.convs.map((c) => {
    const side = santaSide(c);
    const unread = c.id === S.current ? 0 : (c.unread || 0);
    const preview = c.last_body ? `${c.last_mine ? 'Toi : ' : ''}${c.last_body}` : 'Pas encore de message';
    const tag = side === 'target' ? '<span class="msg-tag">Anonyme</span>' : side === 'santa' ? '<span class="msg-tag">Tu es son Santa</span>' : '';
    return `<li>
      <button type="button" class="msg-conv${side ? ' is-santa' : ''}${unread ? ' is-unread' : ''}" data-conv="${esc(c.id)}"${c.id === S.current ? ' aria-current="true"' : ''}>
        ${convAvatar(c)}
        <span class="msg-conv-body">
          <span class="msg-conv-top"><span class="msg-conv-title">${esc(c.title)}</span><time class="msg-conv-time" datetime="${esc(c.last_message_at)}">${esc(relTime(c.last_message_at))}</time></span>
          <span class="msg-conv-bottom"><span class="msg-conv-preview">${esc(preview.replace(/\s+/g, ' '))}</span>${unread ? `<span class="msg-unread" aria-label="${unread} non lu${unread > 1 ? 's' : ''}">${unread > 99 ? '99+' : unread}</span>` : ''}</span>
          ${tag}
        </span>
      </button>
    </li>`;
  }).join('');
  ul.querySelectorAll('[data-conv]').forEach((b) => b.addEventListener('click', () => openConv(b.dataset.conv)));
}

/* ---------- Fil ---------- */
function threadHeadHtml(c) {
  const side = santaSide(c);
  const sub = side === 'target' ? 'Secret Santa · son identité reste secrète jusqu’à la révélation'
    : side === 'santa' ? 'Secret Santa · tu apparais comme « Ton Santa »'
    : 'Conversation privée';
  return `
    <header class="msg-thread-head${side ? ' is-santa' : ''}">
      <button class="btn btn-ghost msg-icon-btn msg-back" type="button" id="msg-back" aria-label="Retour aux conversations">${I.back}</button>
      ${convAvatar(c, 40)}
      <div class="msg-thread-who">
        <h2 id="msg-thread-t" class="msg-thread-title">${esc(c.title)}</h2>
        <p class="msg-thread-sub">${esc(sub)}</p>
      </div>
    </header>`;
}
function renderThreadShell(c) {
  const main = $('#msg-main');
  const side = santaSide(c);
  const ph = side === 'target' ? 'Écris à ton Santa…' : side === 'santa' ? `Écris à ${c.title.replace(/^Ta cible : /, '')} (anonyme)…` : `Écris à ${c.title}…`;
  main.innerHTML = `
    ${threadHeadHtml(c)}
    <div class="msg-thread" id="msg-thread" role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages" tabindex="0">
      <div class="msg-loading" role="status"><span class="msg-spinner" aria-hidden="true"></span> Chargement…</div>
    </div>
    <form class="msg-compose" id="msg-compose" novalidate>
      <label class="visually-hidden" for="msg-input">Ton message</label>
      <textarea id="msg-input" rows="1" maxlength="${MAX_LEN}" placeholder="${esc(ph)}" aria-describedby="msg-hint msg-count"></textarea>
      <button class="btn btn-primary msg-send" type="submit" id="msg-send" aria-label="Envoyer" disabled>${I.send}</button>
      <div class="msg-compose-foot">
        <span id="msg-hint" class="msg-hint">Entrée pour envoyer · Maj + Entrée pour aller à la ligne</span>
        <span class="msg-adm">Les messages peuvent être consultés par l’admin.</span>
        <span id="msg-count" class="msg-count" aria-live="polite">0 / ${MAX_LEN}</span>
      </div>
    </form>`;
  $('#msg-back').addEventListener('click', backToList);
  const ta = $('#msg-input');
  ta.addEventListener('input', onInput);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $('#msg-compose').addEventListener('submit', (e) => { e.preventDefault(); send(); });
}
function onInput() {
  const ta = $('#msg-input'); if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  const n = ta.value.length;
  const cnt = $('#msg-count');
  cnt.textContent = `${n} / ${MAX_LEN}`;
  cnt.classList.toggle('is-near', n > MAX_LEN * 0.9);
  $('#msg-send').disabled = S.sending || !ta.value.trim();
}

function bubbleHtml(m, prev, c) {
  const isSanta = !m.mine && santaSide(c) === 'target' && m.sender_label === 'Ton Santa';
  const sameGroup = prev && prev.mine === m.mine && prev.sender_label === m.sender_label
    && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000 && dayDiff(prev.created_at) === dayDiff(m.created_at);
  const label = !m.mine && !sameGroup
    ? `<span class="msg-sender${isSanta ? ' is-santa' : ''}">${isSanta ? I.mask : ''}${esc(m.sender_label)}</span>` : '';
  const d = new Date(m.created_at);
  return `<div class="msg-row ${m.mine ? 'is-mine' : 'is-other'}${isSanta ? ' is-santa' : ''}${sameGroup ? ' is-cont' : ''}" data-id="${esc(m.id)}">
    ${label}
    <div class="msg-bubble"><span class="visually-hidden">${m.mine ? 'Toi' : esc(m.sender_label)} : </span><span class="msg-text">${linkify(m.body)}</span>
      <time class="msg-time" datetime="${esc(m.created_at)}" title="${esc(fullFmt.format(d))}">${esc(timeFmt.format(d))}</time></div>
  </div>`;
}
function messagesHtml(list, prevMsg, c) {
  let html = '', prev = prevMsg;
  for (const m of list) {
    if (!prev || dayDiff(prev.created_at) !== dayDiff(m.created_at)) {
      html += `<div class="msg-day" role="separator"><span>${esc(dayLabel(m.created_at))}</span></div>`;
    }
    html += bubbleHtml(m, prev, c);
    prev = m;
  }
  return html;
}
function renderMessages() {
  const box = $('#msg-thread'); if (!box) return;
  const c = convOf(S.current);
  if (!S.msgs.length) {
    const side = santaSide(c);
    box.innerHTML = `<div class="msg-thread-empty">${side === 'target'
      ? 'Ton Santa ne t’a pas encore écrit. Tu peux lui poser une question : il ne saura pas que tu as deviné, et tu ne sauras pas qui il est.'
      : side === 'santa' ? 'Ta cible ne saura pas que c’est toi : tes messages s’affichent comme « Ton Santa ».'
      : 'Aucun message pour l’instant. Dis bonjour !'}</div>`;
    return;
  }
  box.innerHTML = messagesHtml(S.msgs, null, c);
  scrollBottom(true);
}
function appendMessages(list) {
  const box = $('#msg-thread'); if (!box || !list.length) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  if (!S.msgs.length) box.innerHTML = '';
  const prev = S.msgs[S.msgs.length - 1] || null;
  box.insertAdjacentHTML('beforeend', messagesHtml(list, prev, convOf(S.current)));
  S.msgs.push(...list);
  if (list.some((m) => m.mine)) scrollBottom(true);
  else if (nearBottom) scrollBottom();
}
function scrollBottom(instant = false) {
  const box = $('#msg-thread'); if (!box) return;
  box.scrollTo({ top: box.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
}

/* ---------- Navigation ---------- */
function setView(v) {
  const el = $('#msg-app'); if (el) el.dataset.view = v;
  document.body.classList.toggle('msg-fullscreen', v === 'thread');
}
function setUrl(conv) {
  const u = new URL(location.href);
  u.searchParams.delete('to');
  if (conv) u.searchParams.set('c', conv); else u.searchParams.delete('c');
  history.replaceState(null, '', u.pathname.split('/').pop() + u.search + u.hash);
}
async function openConv(id, { focus = true } = {}) {
  let c = convOf(id);
  if (!c) {
    try { await loadConvs(); } catch (e) { toast(errMsg(e), 'error'); }
    c = convOf(id);
    if (!c) { toast('Conversation introuvable.', 'error'); setUrl(null); return; }
  }
  S.current = id; S.msgs = []; S.lastId = 0;
  setUrl(id);
  setView('thread');
  renderConvs();
  renderThreadShell(c);
  S.loadingThread = true;
  try {
    const rows = await fetchMessages(id, 0);
    if (S.current !== id) return;
    S.msgs = rows;
    S.lastId = rows.length ? rows[rows.length - 1].id : 0;
    renderMessages();
    markRead(id).then(renderConvs);
  } catch (e) {
    $('#msg-thread').innerHTML = `<div class="msg-thread-empty">Chargement impossible : ${esc(errMsg(e))}</div>`;
  } finally { S.loadingThread = false; }
  if (focus && !MOBILE.matches) $('#msg-input')?.focus();
  startThreadPolling();
}
function backToList() {
  S.current = null; S.msgs = []; S.lastId = 0;
  stopThreadPolling();
  setUrl(null);
  setView('list');
  renderConvs();
  const main = $('#msg-main');
  main.innerHTML = `<div class="msg-placeholder"><span class="msg-placeholder-icon">${I.chat}</span><h2 id="msg-thread-t">Choisis une conversation</h2><p class="muted">Ou écris à un membre avec « Nouveau message ».</p></div>`;
  $('#msg-convs button')?.focus();
}

/* ---------- Envoi ---------- */
async function send() {
  const ta = $('#msg-input');
  const conv = S.current;
  if (!ta || !conv || S.sending) return;
  const body = ta.value.trim();
  if (!body) return;
  if (body.length > MAX_LEN) { toast(`${MAX_LEN} caractères maximum.`, 'error'); return; }
  S.sending = true; $('#msg-send').disabled = true;
  try {
    const { error } = await sb.rpc('hg_send_message', { p_conv: conv, p_body: body });
    if (error) throw error;
    ta.value = ''; onInput();
    notify('message_new', { conversation_id: conv }); // le bot décide (anti-spam côté serveur)
    for (let i = 0; polling && i < 50; i++) await new Promise((r) => setTimeout(r, 100)); // laisse finir une actualisation en cours
    await pollThread();
    const c = convOf(conv);
    if (c) { c.last_body = body.slice(0, 140); c.last_mine = true; c.last_message_at = new Date().toISOString(); }
    S.convs.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
    renderConvs();
  } catch (e) {
    toast(`Envoi impossible : ${errMsg(e)}`, 'error');
  } finally {
    S.sending = false; onInput(); ta.focus();
  }
}

/* ---------- Rafraîchissement ---------- */
let polling = false;
async function pollThread() {
  const conv = S.current;
  if (!conv || polling || S.loadingThread) return;
  polling = true;
  try {
    const rows = await fetchMessages(conv, S.lastId);
    if (S.current !== conv || !rows.length) return;
    const fresh = rows.filter((r) => r.id > S.lastId);
    if (!fresh.length) return;
    S.lastId = fresh[fresh.length - 1].id;
    appendMessages(fresh);
    const incoming = fresh.filter((m) => !m.mine);
    if (incoming.length) {
      playSound('message');
      const last = fresh[fresh.length - 1], c = convOf(conv);
      if (c) { c.last_body = last.body.slice(0, 140); c.last_mine = last.mine; c.last_message_at = last.created_at; }
      await markRead(conv);
      renderConvs();
    }
  } catch (e) { console.warn('[messages] actualisation', e); }
  finally { polling = false; }
}
async function pollList() {
  try {
    const before = new Map(S.convs.map((c) => [c.id, c.unread || 0]));
    await loadConvs();
    const gained = S.convs.some((c) => c.id !== S.current && (c.unread || 0) > (before.get(c.id) ?? 0));
    if (gained) { playSound('message'); refreshUnread(); }
    renderConvs();
  } catch (e) { console.warn('[messages] liste', e); }
}
function startThreadPolling() {
  stopThreadPolling();
  threadTimer = setInterval(() => { if (!document.hidden) pollThread(); }, POLL_THREAD_MS);
}
function stopThreadPolling() { clearInterval(threadTimer); threadTimer = null; }
function startListPolling() {
  clearInterval(listTimer);
  listTimer = setInterval(() => { if (!document.hidden) pollList(); }, POLL_LIST_MS);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  pollList();
  pollThread();
});

/* ---------- Nouveau message ---------- */
const dlg = $('#msg-new-dlg');
function renderPick(q = '') {
  const ul = $('#msg-new-list');
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = [...S.members.values()].filter((m) => m.id !== me.id && norm(m.pseudo).includes(norm(q)))
    .sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo), 'fr'));
  ul.innerHTML = list.length
    ? list.map((m) => `<li><button type="button" class="msg-pick-btn" data-user="${esc(m.id)}">${avatarHtml(m, 36)}<span>${esc(m.pseudo)}</span></button></li>`).join('')
    : '<li class="muted small msg-pick-empty">Aucun membre trouvé.</li>';
  ul.querySelectorAll('[data-user]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    const ok = await openDirect(b.dataset.user);
    if (ok) dlg.close(); else b.disabled = false;
  }));
}
function openNewDialog() {
  $('#msg-new-search').value = '';
  renderPick();
  dlg.showModal();
  $('#msg-new-search').focus();
}
$('#msg-new-search').addEventListener('input', (e) => renderPick(e.target.value));
$('#msg-new-form').addEventListener('submit', (e) => { if (e.submitter?.value !== 'cancel') e.preventDefault(); });

async function openDirect(userId) {
  try {
    if (userId === me.id) throw new Error('Tu ne peux pas t’écrire à toi-même.');
    const { data, error } = await sb.rpc('hg_open_direct', { p_user: userId });
    if (error) throw error;
    const id = Array.isArray(data) ? data[0] : data;
    if (!id) throw new Error('Conversation non créée');
    if (!convOf(id)) await loadConvs();
    await openConv(id);
    return true;
  } catch (e) { toast(`Impossible d’ouvrir la conversation : ${errMsg(e)}`, 'error'); return false; }
}

/* ---------- Démarrage ---------- */
try {
  await Promise.all([loadMembers(), loadConvs()]);
  renderShell();
  renderConvs();
  const params = new URLSearchParams(location.search);
  const to = params.get('to'), c = params.get('c');
  const UUID = /^[0-9a-f-]{36}$/i;
  if (to && UUID.test(to)) await openDirect(to);
  else if (c && UUID.test(c)) await openConv(c, { focus: false });
  else if (!MOBILE.matches && S.convs.length) await openConv(S.convs[0].id, { focus: false });
  startListPolling();
} catch (e) {
  if (String(e?.message) !== 'redirect') {
    app.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Entre nous</div><h1 class="page-title">Messages</h1></div></div>
      <div class="card"><h2>Chargement impossible</h2><p class="muted">${esc(errMsg(e))}</p>
      <div class="btn-row"><button class="btn btn-primary" type="button" id="msg-retry">Réessayer</button></div></div>`;
    $('#msg-retry')?.addEventListener('click', () => location.reload());
    toast(`Messages : ${errMsg(e)}`, 'error');
  }
}
