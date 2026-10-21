// Admin : Communication › Assistance. Liste des demandes en colonne 2 (createList), demande ouverte dans la zone
// principale (en-tête de détail + fil), fiche rapide du membre dans le panneau d'infos.
// La base (hg_support) ne garde qu'un message initial, un statut « ouverte » / « traitee » et le contact : pas de fil de
// réponses, pas de note interne, pas de drapeau « lu ». Le fil n'affiche donc que le message, sans zone de réponse.
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
const DONE = { id: 'traitee', label: 'Traitée', tone: 'done' };
const OPTIONS = [OPEN, DONE];
const FILTERS = [
  { id: 'ouverte', label: 'Ouvertes', test: (it) => it.status.id === 'ouverte' },
  { id: 'traitee', label: 'Traitées', test: (it) => it.status.id === 'traitee' },
];
const STATS_TTL = 60_000;

// État de la vue (les éléments sont créés à la première visite, puis mis à jour en place)
const V = { host: null, list: null, infoEl: null, infoApi: null, sel: null, stats: new Map() };

const statusOf = (s) => (s.status === 'traitee' ? DONE : OPEN);
const memberOf = (s) => {
  const m = s.user_id ? S.byId.get(s.user_id) : null;
  return { id: s.user_id, pseudo: s.pseudo || m?.pseudo || 'Anonyme', color: m?.color, avatar_url: m?.avatar_url };
};
const openCount = () => S.support.filter((s) => s.status === 'ouverte').length;

function toItem(s) {
  return {
    id: s.id,
    member: memberOf(s),
    title: s.subject,
    excerpt: s.message,
    at: s.created_at,
    status: statusOf(s),
  };
}

async function run(fn) {
  try { await fn(); } catch (e) { toast(errMsg(e), 'error'); }
}

/** Passe une demande à « ouverte » ou « traitee » (le statut et les compteurs suivent). */
async function setStatus(s, status) {
  try {
    check(await sb.from('hg_support').update({ status }).eq('id', s.id));
  } catch (e) {
    toast(errMsg(e), 'error');
    renderSupport(); // resynchronise le sélecteur de statut avec la base
    return;
  }
  await loadSupport();
  renderSupport();
  renderStats();
  toast(status === 'traitee' ? 'Demande marquée comme traitée' : 'Demande rouverte', 'ok');
}

const badgeEligible = (s) => s.subject === SUBJECT_BUG && !!s.user_id && S.byId.has(s.user_id) && !hasBadge(s.user_id, 'chasseur_bugs');

async function offerBadge(s) {
  const uid = s.user_id;
  if (!(await confirmBox('Attribuer le badge ?', `Attribuer « ${badgeName('chasseur_bugs')} » à ${pseudoOf(uid)} ?`, { ok: 'Attribuer' }))) return;
  await run(async () => { await awardBadge(uid, 'chasseur_bugs'); renderSupport(); toast('Badge attribué', 'ok'); });
}

/* ---------- Zone principale : en-tête + fil ---------- */
function paintDetail() {
  const host = V.host;
  if (!host) return;
  const s = S.support.find((x) => x.id === V.sel);
  if (!s) {
    host.innerHTML = `<div class="detail-empty">${S.support.length ? 'Choisis une demande dans la liste.' : 'Aucune demande d’assistance pour le moment.'}</div>`;
    return;
  }
  const m = memberOf(s);
  const head = document.createElement('div');
  const thread = document.createElement('div');
  const note = document.createElement('p');
  note.className = 'detail-note';
  note.textContent = 'Le panel ne garde pas de réponses : seul le message initial de la demande est affiché.';
  host.replaceChildren(head, thread, note);

  const cur = statusOf(s);
  renderDetailHeader(head, {
    member: m,
    title: s.subject,
    subtitle: `${m.pseudo} · ${fmtDateTime(s.created_at)}${s.contact ? ` · contact : ${s.contact}` : ''}`,
    status: { value: cur.id, options: OPTIONS, label: 'Statut' },
    onStatus: (v) => setStatus(s, v),
    primary: cur.id === 'ouverte'
      ? { label: 'Résoudre', onClick: () => setStatus(s, 'traitee') }
      : { label: 'Rouvrir', icon: false, onClick: () => setStatus(s, 'ouverte') },
    actions: [
      ...(s.contact ? [{ label: 'Copier le contact', onClick: () => copyText(s.contact) }] : []),
      ...(badgeEligible(s) ? [{ label: `Badge ${badgeName('chasseur_bugs')}`, onClick: () => offerBadge(s) }] : []),
    ],
  });

  createThread(thread, {
    composer: false,
    label: 'Message de la demande',
    me: null,
    messages: [
      { type: 'event', text: `Demande ouverte par ${m.pseudo}`, at: s.created_at },
      { id: s.id, type: 'message', author: m, body: s.message, at: s.created_at, mine: false },
    ],
  });
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
  const history = uid
    ? S.support.filter((x) => x.user_id === uid && x.id !== s.id)
      .map((x) => ({ id: x.id, title: x.subject, status: statusOf(x), at: x.created_at }))
    : [];
  const actions = uid && S.byId.has(uid)
    ? [{ label: 'Ouvrir la fiche membre', onClick: () => { location.hash = `#membres/comptes/${uid}`; } }]
    : [];
  V.infoApi = renderInfoPanel(el, {
    member: { pseudo: m.pseudo, color: m.color, avatar_url: m.avatar_url, since: uid ? S.byId.get(uid)?.member_since : null },
    stats: stats || [],
    statsTitle: 'Fiche rapide',
    status: { value: statusOf(s).id, options: OPTIONS, label: 'Statut' },
    onStatus: (v) => setStatus(s, v),
    history,
    actions,
  });
}

function paintInfo() {
  const el = V.infoEl;
  if (!el) return;
  const s = S.support.find((x) => x.id === V.sel);
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
  loadStats(s.user_id).then((stats) => { if (V.sel === sel) drawInfo(s, stats); });
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
      items: S.support.map(toItem),
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
  V.list?.update(S.support.map(toItem));
  paintDetail();
  paintInfo();
}
