// Admin : Communication › Assistance. Liste des demandes en colonne 2 (createList), demande ouverte dans la zone
// principale (en-tête de détail + fil de réponses + zone de réponse), fiche rapide du membre dans le panneau d'infos.
// Trois états affichés : « Ouverte » (statut ouverte, personne n'a pris la demande), « En cours » (statut ouverte
// avec taken_by), « Traitée ». Non lu = read_at nul, posé à l'ouverture. Le fil mêle le message initial, la prise en
// charge (séparateur), les réponses publiques (visibles par le membre) et les notes internes (panel seulement).
// Route : #communication/assistance[/<id>]. Droits : admin/perms.js (section « assistance », permission « support »).
import { sb, toast, fmtDateTime, errMsg } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { S, pseudoOf, SUBJECT_BUG } from './state.js';
import { copyText, check } from './common.js';
import { loadSupport } from './loaders.js';
import { renderStats } from './overview.js';
import { hasBadge, awardBadge, badgeName } from './badges.js';
import { setCount } from './shell.js';
import { createList } from './ui/list.js';
import { createThread } from './ui/thread.js';
import { renderDetailHeader } from './ui/detail-header.js';
import { renderInfoPanel } from './ui/info-panel.js';

const OPEN = { id: 'ouverte', label: 'Ouverte', tone: 'open' };
const PROG = { id: 'encours', label: 'En cours', tone: 'prog' };
const DONE = { id: 'traitee', label: 'Traitée', tone: 'done' };
const OPTIONS = [OPEN, PROG, DONE];
const FILTERS = [
  { id: 'ouverte', label: 'Ouvertes', test: (it) => it.status.id === 'ouverte' },
  { id: 'encours', label: 'En cours', test: (it) => it.status.id === 'encours' },
  { id: 'traitee', label: 'Traitées', test: (it) => it.status.id === 'traitee' },
];
const STATS_TTL = 60_000;

// État de la vue (les éléments sont créés à la première visite, puis mis à jour en place)
const V = { host: null, list: null, infoEl: null, infoApi: null, sel: null, stats: new Map(), thread: null, threadFor: null, threadEl: null };

const stateOf = (s) => (s.status === 'traitee' ? DONE : s.taken_by ? PROG : OPEN);
const memberOf = (s) => {
  const m = s.user_id ? S.byId.get(s.user_id) : null;
  return { id: s.user_id, pseudo: s.pseudo || m?.pseudo || 'Anonyme', color: m?.color, avatar_url: m?.avatar_url };
};
const authorOf = (id) => {
  const m = id ? S.byId.get(id) : null;
  return { id, pseudo: m?.pseudo || 'Admin', color: m?.color, avatar_url: m?.avatar_url };
};
const activity = (s) => new Date(s.updated_at || s.created_at).getTime();
const openCount = () => S.support.filter((s) => s.status === 'ouverte').length;
const byActivity = () => [...S.support].sort((a, b) => activity(b) - activity(a));
const repliesOf = (id) => S.supportReplies.filter((r) => r.support_id === id);
const find = (id) => S.support.find((x) => x.id === id);

function toItem(s) {
  return {
    id: s.id,
    member: memberOf(s),
    title: s.subject,
    excerpt: s.message,
    at: s.updated_at || s.created_at,
    status: stateOf(s),
    unread: !s.read_at,
  };
}

async function run(fn) {
  try { await fn(); } catch (e) { toast(errMsg(e), 'error'); }
}

/** Fil de la demande : message initial, prise en charge, réponses et notes, dans l'ordre chronologique. */
function threadMessages(s, m) {
  const items = [
    { at: s.created_at, rank: 0, msg: { type: 'event', text: `Demande ouverte par ${m.pseudo}`, at: s.created_at } },
    { at: s.created_at, rank: 1, msg: { id: s.id, type: 'message', author: m, body: s.message, at: s.created_at, mine: false } },
  ];
  if (s.taken_by && s.taken_at) {
    items.push({ at: s.taken_at, rank: 2, msg: { type: 'event', text: `${pseudoOf(s.taken_by)} a pris en charge`, at: s.taken_at } });
  }
  for (const r of repliesOf(s.id)) {
    items.push({ at: r.created_at, rank: 3, msg: {
      id: r.id, type: 'message', author: authorOf(r.author_id), body: r.body, at: r.created_at,
      internal: !!r.internal, mine: r.author_id === S.meId,
    } });
  }
  items.sort((a, b) => new Date(a.at) - new Date(b.at) || a.rank - b.rank);
  return items.map((x) => x.msg);
}

/* ---------- Actions (retrouvent la demande par son identifiant : les données peuvent avoir été rechargées) ---------- */
const MSG_STATE = { ouverte: 'Demande remise en file', encours: 'Demande prise en charge', traitee: 'Demande marquée comme traitée' };

/** Passe une demande à « ouverte », « encours » (prise en charge par l'admin connecté) ou « traitee ». */
async function setState(id, target) {
  const s = find(id);
  if (!s || stateOf(s).id === target) return;
  const now = new Date().toISOString();
  let patch;
  if (target === 'traitee') patch = { status: 'traitee', updated_at: now };
  else if (target === 'ouverte') patch = { status: 'ouverte', taken_by: null, taken_at: null, updated_at: now };
  else patch = { status: 'ouverte', taken_by: S.meId, taken_at: now, updated_at: now };
  try {
    check(await sb.from('hg_support').update(patch).eq('id', id));
  } catch (e) {
    toast(errMsg(e), 'error');
    renderSupport(); // resynchronise les sélecteurs de statut avec la base
    return;
  }
  Object.assign(s, patch);
  renderSupport();
  renderStats();
  toast(MSG_STATE[target], 'ok');
}

/** Envoie une réponse (publique) ou une note interne. La première réponse prend la demande en charge (trigger). */
async function sendReply(id, text, internal) {
  check(await sb.from('hg_support_replies').insert({ support_id: id, author_id: S.meId, body: text, internal }).select().single());
  await loadSupport().catch((e) => console.warn('[panel]', e?.message || e));
  renderSupport();
}

/** Marque la demande comme lue à l'ouverture (optimiste ; revient en arrière si l'écriture échoue). */
async function markRead(s) {
  const now = new Date().toISOString();
  s.read_at = now;
  V.list?.update(byActivity().map(toItem));
  try {
    check(await sb.from('hg_support').update({ read_at: now }).eq('id', s.id).is('read_at', null));
  } catch (e) {
    s.read_at = null;
    V.list?.update(byActivity().map(toItem));
    toast(errMsg(e), 'error');
  }
}

const badgeEligible = (s) => s.subject === SUBJECT_BUG && !!s.user_id && S.byId.has(s.user_id) && !hasBadge(s.user_id, 'chasseur_bugs');

async function offerBadge(s) {
  const uid = s.user_id;
  if (!(await confirmBox('Attribuer le badge ?', `Attribuer « ${badgeName('chasseur_bugs')} » à ${pseudoOf(uid)} ?`, { ok: 'Attribuer' }))) return;
  await run(async () => { await awardBadge(uid, 'chasseur_bugs'); renderSupport(); toast('Badge attribué', 'ok'); });
}

/* ---------- Zone principale : en-tête + fil + zone de réponse ---------- */
function paintDetail() {
  const host = V.host;
  if (!host) return;
  const s = find(V.sel);
  if (!s) {
    V.thread?.destroy();
    V.thread = null; V.threadFor = null; V.threadEl = null;
    host.innerHTML = `<div class="detail-empty">${S.support.length ? 'Choisis une demande dans la liste.' : 'Aucune demande d’assistance pour le moment.'}</div>`;
    return;
  }
  if (!s.read_at) markRead(s);
  const id = s.id;
  const m = memberOf(s);
  const cur = stateOf(s);

  // En-tête : recréé à chaque passage (ses boutons sont liés à la demande courante)
  const head = document.createElement('div');
  const actions = [];
  if (!s.taken_by && cur.id !== 'traitee') actions.push({ label: 'Prendre en charge', onClick: () => setState(id, 'encours') });
  if (s.contact) actions.push({ label: 'Copier le contact', onClick: () => copyText(s.contact) });
  if (badgeEligible(s)) actions.push({ label: `Badge ${badgeName('chasseur_bugs')}`, onClick: () => offerBadge(find(id)) });
  renderDetailHeader(head, {
    member: m,
    title: s.subject,
    subtitle: `${m.pseudo} · ${fmtDateTime(s.created_at)}${s.contact ? ` · contact : ${s.contact}` : ''}`,
    status: { value: cur.id, options: OPTIONS, label: 'Statut' },
    onStatus: (v) => setState(id, v),
    primary: cur.id === 'traitee'
      ? { label: 'Rouvrir', icon: false, onClick: () => setState(id, 'ouverte') }
      : { label: 'Résoudre', onClick: () => setState(id, 'traitee') },
    actions,
  });

  // Fil : gardé tant qu'on reste sur la même demande (le brouillon de réponse survit aux mises à jour)
  if (!V.thread || V.threadFor !== id) {
    V.thread?.destroy();
    V.threadEl = document.createElement('div');
    V.thread = createThread(V.threadEl, {
      label: 'Fil de la demande',
      me: S.meId,
      placeholder: `Répondre à ${m.pseudo}…`,
      hint: 'Le membre voit tes réponses dans Assistance › Mes demandes. Les notes internes restent dans le panel.',
      onSend: (text) => sendReply(id, text, false),
      onNote: (text) => sendReply(id, text, true),
      messages: [],
    });
    V.threadFor = id;
  }
  V.thread.update(threadMessages(s, m));
  host.replaceChildren(head, V.threadEl);
}

/* ---------- Panneau d'infos : fiche rapide du membre ---------- */
function loadStats(uid) {
  const hit = V.stats.get(uid);
  if (hit && Date.now() - hit.at < STATS_TTL) return hit.p;
  const dash = '–';
  const p = Promise.all([
    sb.rpc('hg_member_card', { p_user: uid }),
    sb.from('hg_wallets').select('paillettes').eq('user_id', uid).maybeSingle(),
    sb.from('hg_card_copies').select('id', { count: 'exact', head: true }).eq('owner_id', uid).is('recycled_at', null),
  ]).then(([card, wallet, copies]) => {
    const st = card.data?.stats ?? null;
    return [
      { value: wallet.error ? dash : new Intl.NumberFormat('fr-CH').format(wallet.data?.paillettes ?? 0), label: 'Paillettes' },
      { value: st ? st.sorties : dash, label: 'Sorties IRL' },
      { value: copies.error ? dash : (copies.count ?? 0), label: 'Cartes' },
      { value: st ? st.secret_santa : dash, label: 'Secret Santa' },
    ];
  }).catch(() => [
    { value: dash, label: 'Paillettes' }, { value: dash, label: 'Sorties IRL' },
    { value: dash, label: 'Cartes' }, { value: dash, label: 'Secret Santa' },
  ]);
  V.stats.set(uid, { at: Date.now(), p });
  return p;
}

function drawInfo(s, stats) {
  const el = V.infoEl;
  if (!el) return;
  V.infoApi?.destroy();
  const m = memberOf(s);
  const uid = s.user_id;
  const id = s.id;
  const history = uid
    ? S.support.filter((x) => x.user_id === uid && x.id !== s.id)
      .map((x) => ({ id: x.id, title: x.subject, status: stateOf(x), at: x.created_at }))
    : [];
  const actions = uid && S.byId.has(uid)
    ? [{ label: 'Ouvrir la fiche membre', onClick: () => { location.hash = `#membres/comptes/${uid}`; } }]
    : [];
  V.infoApi = renderInfoPanel(el, {
    member: { pseudo: m.pseudo, color: m.color, avatar_url: m.avatar_url, since: uid ? S.byId.get(uid)?.member_since : null },
    stats: stats || [],
    statsTitle: 'Fiche rapide',
    status: { value: stateOf(s).id, options: OPTIONS, label: 'Statut' },
    onStatus: (v) => setState(id, v),
    history,
    actions,
  });
}

function paintInfo() {
  const el = V.infoEl;
  if (!el) return;
  const s = find(V.sel);
  if (!s) {
    V.infoApi?.destroy();
    V.infoApi = null;
    el.innerHTML = '<p class="detail-empty">Aucune demande sélectionnée.</p>';
    return;
  }
  // Non connecté (pas de compte) : pas de statistiques ni de fiche à ouvrir
  if (!s.user_id) { drawInfo(s, []); return; }
  drawInfo(s, null);
  const sel = s.id;
  loadStats(s.user_id).then((stats) => { if (V.sel === sel) drawInfo(find(sel) || s, stats); });
}

/* ---------- Liste (colonne 2) ---------- */
function go(id) {
  location.hash = `#communication/assistance/${id}`;
}

/* ---------- API de la coquille (registerSub) ---------- */
export const supportSub = {
  main(el) {
    el.dataset.fill = '';
    V.host = document.getElementById('support-root');
    paintDetail();
  },
  list(el) {
    V.list = createList(el, {
      items: byActivity().map(toItem),
      key: 'id',
      label: 'Demandes d’assistance',
      filters: FILTERS,
      search: { placeholder: 'Rechercher une demande', label: 'Rechercher une demande', fields: (it) => [it.member.pseudo, it.title, it.excerpt].join(' ') },
      selectedId: V.sel,
      empty: 'Aucune demande.',
      onSelect: (it) => go(it.id),
    });
  },
  info(el) {
    V.infoEl = el;
    paintInfo();
  },
  open(_el, { id } = {}) {
    V.sel = id || null;
    V.list?.select(V.sel);
    paintDetail();
    paintInfo();
  },
};

/** Redessine la liste, le détail et le panneau après un changement de données (temps réel, actions). */
export function renderSupport() {
  setCount('assistance', openCount());
  V.list?.update(byActivity().map(toItem));
  paintDetail();
  paintInfo();
}
