// ===== Humane Gang — messagerie (messages.html) : conversations directes + messages anonymes du Secret Santa =====
// Page réservée aux membres. Deux colonnes : la liste des conversations, et le fil de la conversation ouverte.
// Dépendances : core.js (Supabase, notifications), sound.js (son), icons.js.
// Tables et RPC : hg_members, hg_my_conversations, hg_get_messages, hg_send_message, hg_mark_read, hg_open_direct.
// Temps réel : canal privé « conv:<id> » (Supabase Realtime), avec actualisation périodique de secours.
// N'exporte rien.
import * as core from './core.js';
import { sb, initPage, toast, errMsg, esc, $, avatarHtml, notify } from './core.js';
import { svg } from './icons.js';

const me = await initPage({ auth: 'member' });
const app = $('#app');

const MAX_LEN = 4000;
const POLL_THREAD_MS = 4000;
const POLL_LIST_MS = 15000;
const POLL_SAFETY_MS = 60000; // interrogation de secours quand le temps réel est actif
const MOBILE = matchMedia('(max-width: 760px)');

/* ---------- Icônes (SVG à trait) ---------- */
const I = {
  plus: svg('plus', { size: 18, stroke: 2 }),
  back: svg('back', { size: 20, stroke: 2 }),
  send: svg('send2', { size: 20, stroke: 2 }),
  mask: svg('mask2', { size: 20, stroke: 1.8 }),
  chat: svg('chat', { size: 28, stroke: 1.6 }),
  lock: svg('lock2', { size: 14, stroke: 2 }),
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
// Canal Supabase Realtime de la conversation ouverte (Broadcast privé « conv:<id> ») ; ok = abonnement confirmé
const RT = { thread: null, threadOk: false };
let pendingPull = false;

/* ---------- Outils ---------- */
const memberOf = (id) => S.members.get(id) || null;
/** Conversation à partir de son identifiant, ou null. */
const convOf = (id) => S.convs.find((c) => c.id === id) || null;
/** Côté Secret Santa : 'target' = je suis la cible (mon Santa est anonyme), 'santa' = je suis le Santa (je reste anonyme). */
function santaSide(c) { return c?.kind === 'santa' ? (c.other_id ? 'santa' : 'target') : null; }
/** Joue un son de notification (chargé à la demande, sans bloquer la page). */
function playSound(name) { import('./sound.js').then((m) => m.playSound?.(name)).catch(() => {}); }
/** Met à jour le compteur de messages non lus dans l'en-tête ; silencieux si la fonction n'existe pas. */
function refreshUnread() { try { core.refreshUnread?.(); } catch {} }

const timeFmt = new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long' });
const dayYearFmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: '2-digit' });
const shortYearFmt = new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: '2-digit', year: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'short' });
const fullFmt = new Intl.DateTimeFormat('fr-CH', { dateStyle: 'full', timeStyle: 'short' });
/** Début du jour (minuit local) d'une date, en millisecondes. Sert à comparer des jours entiers. */
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
/** Nombre de jours calendaires entre aujourd'hui et la date donnée (0 = aujourd'hui, 1 = hier). */
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
/**
 * Libellé d'une date pour le séparateur de jour : « Aujourd’hui », « Hier », ou la date complète.
 * @param {string} ts date ISO du message
 * @returns {string}
 */
function dayLabel(ts) {
  const d = new Date(ts), dd = dayDiff(d);
  if (dd === 0) return 'Aujourd’hui';
  if (dd === 1) return 'Hier';
  const s = (d.getFullYear() === new Date().getFullYear() ? dayFmt : dayYearFmt).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Texte → HTML : échappé, URLs http(s) transformées en liens, sauts de ligne conservés (CSS pre-wrap). */
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
/** Échappe le texte et transforme les adresses http ou https en liens sûrs, ouvrant un nouvel onglet. */
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
/** Charge l'annuaire des membres (pseudo, avatar, couleur) dans S.members. Lève une erreur si la RPC échoue. */
async function loadMembers() {
  const { data, error } = await sb.rpc('hg_members');
  if (error) throw error;
  S.members = new Map((data || []).map((m) => [m.id, m]));
}
/** Charge la liste de mes conversations (hg_my_conversations) dans S.convs. Lève une erreur si la RPC échoue. */
async function loadConvs() {
  const { data, error } = await sb.rpc('hg_my_conversations');
  if (error) throw error;
  S.convs = data || [];
}
/**
 * Lit tous les messages d'une conversation qui suivent l'identifiant after, par pages de 500.
 * Limite : 20 pages au plus (10 000 messages par passe).
 * @param {string} conv identifiant de la conversation
 * @param {number} after identifiant du dernier message déjà connu (0 = depuis le début)
 * @returns {Promise<Array<object>>} messages, dans l'ordre
 */
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
/** Marque une conversation comme lue côté serveur, puis remet son compteur à zéro localement. */
async function markRead(conv) {
  const { error } = await sb.rpc('hg_mark_read', { p_conv: conv });
  if (error) { console.warn('[hg_mark_read]', error); return; }
  const c = convOf(conv); if (c) c.unread = 0;
  refreshUnread();
}

/* ---------- Squelette ---------- */
/**
 * Dessine la structure de la page : en-tête, colonne des conversations, zone du fil (vide au départ),
 * et la note sur la consultation des messages par l’admin. Le bouton « Nouveau message » est branché ici.
 */
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
/**
 * Avatar d'une conversation. Dans un Secret Santa, la cible voit un masque (le Santa reste anonyme),
 * et le Santa voit son propre avatar avec un petit masque.
 * @param {object} c la conversation
 * @param {number} [size=44] taille en pixels
 * @returns {string} HTML
 */
function convAvatar(c, size = 44) {
  const side = santaSide(c);
  if (side === 'target') return `<span class="msg-av msg-av-santa" style="width:${size}px;height:${size}px" aria-hidden="true">${I.mask}</span>`;
  const m = memberOf(c.other_id) || { pseudo: c.title };
  return side === 'santa'
    ? `<span class="msg-av-wrap">${avatarHtml(m, size)}<span class="msg-av-badge" aria-hidden="true">${I.mask}</span></span>`
    : avatarHtml(m, size);
}
/** Dessine la liste des conversations (aperçu, heure, non-lus, étiquette Secret Santa) et branche les clics. */
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
/**
 * En-tête du fil : retour (mobile), avatar, titre et sous-titre selon le côté Secret Santa.
 * @param {object} c la conversation
 * @returns {string} HTML
 */
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
/**
 * Dessine le fil d'une conversation ouverte : en-tête, zone des messages (en attente), et formulaire d'envoi.
 * Le texte d'invite change selon le côté Secret Santa, pour ne jamais révéler l'identité du Santa.
 * @param {object} c la conversation
 */
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
/** Ajuste la hauteur de la zone de saisie, le compteur de caractères, et l'état du bouton d'envoi. */
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

/**
 * Bulle d'un message. Le nom de l'expéditeur n'apparaît que pour le premier message d'un groupe.
 * Un message « sameGroup » (même auteur, moins de 5 min, même jour) est collé au précédent.
 * @param {object} m le message
 * @param {object|null} prev le message précédent (pour regrouper)
 * @param {object} c la conversation
 * @returns {string} HTML
 */
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
/**
 * HTML d'une suite de messages, avec un séparateur à chaque changement de jour.
 * @param {Array<object>} list messages à afficher
 * @param {object|null} prevMsg message qui précède la liste (pour le regroupement)
 * @param {object} c la conversation
 * @returns {string} HTML
 */
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
/** Remplace tout le contenu du fil par les messages chargés, ou par un texte d'accueil s'il n'y en a aucun. */
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
/**
 * Ajoute de nouveaux messages en bas du fil. Ne fait défiler que si mon message vient d'être envoyé,
 * ou si la personne était déjà en bas (pour ne pas la déranger en pleine lecture).
 * @param {Array<object>} list nouveaux messages
 */
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
/**
 * Fait défiler le fil jusqu'en bas.
 * @param {boolean} [instant=false] true : sans animation
 */
function scrollBottom(instant = false) {
  const box = $('#msg-thread'); if (!box) return;
  box.scrollTo({ top: box.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
}

/* ---------- Navigation ---------- */
/**
 * Affiche la liste ou le fil. Sur mobile, le fil passe en plein écran (classe msg-fullscreen sur body).
 * @param {'list'|'thread'} v vue demandée
 */
function setView(v) {
  const el = $('#msg-app'); if (el) el.dataset.view = v;
  document.body.classList.toggle('msg-fullscreen', v === 'thread');
}
/** Met l'identifiant de la conversation dans l'adresse (?c=…), sans recharger la page. Pas d'historique ajouté. */
function setUrl(conv) {
  const u = new URL(location.href);
  u.searchParams.delete('to');
  if (conv) u.searchParams.set('c', conv); else u.searchParams.delete('c');
  history.replaceState(null, '', u.pathname.split('/').pop() + u.search + u.hash);
}
/**
 * Ouvre une conversation : affiche le fil, charge les messages, marque comme lue, et lance le temps réel et les actualisations.
 * @param {string} id identifiant de la conversation
 * @param {{focus?: boolean}} [opts] focus : placer le curseur dans la zone de saisie (hors mobile)
 */
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
  subscribeThreadRt(id);
  startThreadPolling();
}
/** Quitte le fil : arrête les actualisations et le temps réel de cette conversation, puis revient à la liste. */
function backToList() {
  S.current = null; S.msgs = []; S.lastId = 0;
  stopThreadPolling();
  unsubscribeThreadRt();
  setUrl(null);
  setView('list');
  renderConvs();
  const main = $('#msg-main');
  main.innerHTML = `<div class="msg-placeholder"><span class="msg-placeholder-icon">${I.chat}</span><h2 id="msg-thread-t">Choisis une conversation</h2><p class="muted">Ou écris à un membre avec « Nouveau message ».</p></div>`;
  $('#msg-convs button')?.focus();
}

/* ---------- Envoi ---------- */
/**
 * Envoie le message saisi (RPC hg_send_message). Le bot anti-spam est prévenu côté serveur.
 * Après l'envoi, le fil est actualisé tout de suite et la conversation remonte en tête de liste.
 */
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
/**
 * Charge les nouveaux messages de la conversation ouverte (depuis S.lastId). Joue un son et marque comme lue
 * si un message arrive de l'autre. Une seule passe à la fois ; une demande pendant une passe en relance une autre.
 */
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
  finally {
    polling = false;
    if (pendingPull) { pendingPull = false; pollThread(); }
  }
}
/** Empreinte de ce que renderConvs affiche : sert à ne réécrire la liste que si quelque chose a changé. */
const convsKey = () => JSON.stringify([S.current, S.convs.map((c) => [c.id, c.title, c.kind, c.other_id, c.last_body, c.last_mine, c.last_message_at, c.unread])]);
/** Actualise la liste des conversations ; joue un son si un nouveau message non lu apparaît dans une autre conversation. */
async function pollList() {
  try {
    const before = new Map(S.convs.map((c) => [c.id, c.unread || 0]));
    const key = convsKey();
    await loadConvs();
    const gained = S.convs.some((c) => c.id !== S.current && (c.unread || 0) > (before.get(c.id) ?? 0));
    if (gained) { playSound('message'); refreshUnread(); }
    if (convsKey() !== key) renderConvs();
  } catch (e) { console.warn('[messages] liste', e); }
}
/** Lance l'actualisation du fil : cadence rapide sans temps réel, cadence de secours avec temps réel. */
function startThreadPolling() {
  stopThreadPolling();
  const ms = RT.threadOk ? POLL_SAFETY_MS : POLL_THREAD_MS;
  threadTimer = setInterval(() => { if (!document.hidden) pollThread(); }, ms);
}
/** Arrête l'actualisation du fil. */
function stopThreadPolling() { clearInterval(threadTimer); threadTimer = null; }
/** Lance l'actualisation périodique de la liste des conversations (en pause quand l'onglet est caché). */
function startListPolling() {
  clearInterval(listTimer);
  listTimer = setInterval(() => { if (!document.hidden) pollList(); }, POLL_LIST_MS);
}

/* ---------- Temps réel (Supabase Realtime, Broadcast privé) ----------
   La base publie sur le canal « conv:<id> » un payload minimal après chaque message (trigger hg_msg_realtime,
   migration 025) : aucun expéditeur n'y figure. Seuls les membres de la conversation peuvent s'abonner (policy).
   Un événement déclenche le rechargement du fil par la RPC habituelle. Sans canal confirmé (échec, indisponible,
   ou client de test sans Realtime), les cadences d'interrogation d'origine restent en vigueur. */
/**
 * Abonne le fil de la conversation au canal temps réel. Un événement déclenche une actualisation immédiate.
 * En cas d'échec, l'actualisation périodique reste en place (aucune perte de messages).
 * @param {string} id identifiant de la conversation
 */
function subscribeThreadRt(id) {
  unsubscribeThreadRt();
  try {
    const ch = sb.channel(`conv:${id}`, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'new_message' }, requestThreadPull);
    RT.thread = ch;
    ch.subscribe((status) => {
      if (RT.thread !== ch) return; // canal remplacé ou fermé entre-temps
      const ok = status === 'SUBSCRIBED';
      if (RT.threadOk === ok) return;
      RT.threadOk = ok;
      if (ok) requestThreadPull(); // rattrape un message arrivé pendant l'abonnement
      if (S.current) startThreadPolling();
    });
  } catch (e) {
    console.warn('[messages] temps réel indisponible', e);
    RT.thread = null; RT.threadOk = false;
  }
}
/** Ferme le canal temps réel de la conversation précédente, s'il existe. */
function unsubscribeThreadRt() {
  const ch = RT.thread;
  RT.thread = null; RT.threadOk = false;
  if (ch) { try { sb.removeChannel(ch); } catch { /* sans effet */ } }
}
/** Actualisation du fil demandée par le temps réel ; si une passe est en cours, on en relance une à la fin. */
function requestThreadPull() {
  if (polling) { pendingPull = true; return; }
  pollThread();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  pollList();
  pollThread();
});

/* ---------- Nouveau message ---------- */
const dlg = $('#msg-new-dlg');
/**
 * Liste des membres proposés dans « Nouveau message », filtrée par la recherche (sans accents, sans casse).
 * @param {string} [q=''] texte de recherche
 */
function renderPick(q = '') {
  const ul = $('#msg-new-list');
  /** Texte normalisé (sans accents, en minuscules) pour la recherche de membres. */
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
/** Ouvre la fenêtre « Nouveau message » avec la liste complète des membres. */
function openNewDialog() {
  $('#msg-new-search').value = '';
  renderPick();
  dlg.showModal();
  $('#msg-new-search').focus();
}
$('#msg-new-search').addEventListener('input', (e) => renderPick(e.target.value));
$('#msg-new-form').addEventListener('submit', (e) => { if (e.submitter?.value !== 'cancel') e.preventDefault(); });

/**
 * Ouvre (ou crée) une conversation directe avec un membre (RPC hg_open_direct).
 * @param {string} userId identifiant du membre
 * @returns {Promise<boolean>} true si la conversation s'est ouverte
 */
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
