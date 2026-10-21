// Admin : Communication › Boîte à idées. Liste des idées en colonne 2 (createList), idée ouverte dans la zone principale
// (en-tête avec auteur et statut, fil d'une seule bulle). La base (hg_ideas) ne garde ni réponses ni note : le fil est
// en lecture seule. Route : #communication/idees[/<id>]. Droits : admin/perms.js (section « idees », permission « support »).
import { sb, toast, errMsg, fmtDateTime } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { S, pseudoOf } from './state.js';
import { check } from './common.js';
import { loadIdeas } from './loaders.js';
import { renderStats } from './overview.js';
import { hasBadge, awardBadge, badgeName } from './badges.js';
import { setCount } from './shell.js';
import { createList } from './ui/list.js';
import { createThread } from './ui/thread.js';
import { renderDetailHeader } from './ui/detail-header.js';

const LABEL = { nouvelle: 'Nouvelle', retenue: 'Retenue', ecartee: 'Écartée' };
const TONE = { nouvelle: 'open', retenue: 'done', ecartee: 'muted' };
const OPTIONS = ['nouvelle', 'retenue', 'ecartee'].map((id) => ({ id, label: LABEL[id], tone: TONE[id] }));
const FILTERS = [
  { id: 'nouvelle', label: 'Nouvelles', test: (it) => it.status.id === 'nouvelle' },
  { id: 'retenue', label: 'Retenues', test: (it) => it.status.id === 'retenue' },
  { id: 'ecartee', label: 'Écartées', test: (it) => it.status.id === 'ecartee' },
];

const V = { host: null, list: null, sel: null };

const statusOf = (i) => ({ id: i.status, label: LABEL[i.status] || i.status, tone: TONE[i.status] || 'muted' });
const authorOf = (i) => {
  const m = i.user_id ? S.byId.get(i.user_id) : null;
  return { id: i.user_id, pseudo: i.user_id ? pseudoOf(i.user_id) : 'Membre parti', color: m?.color, avatar_url: m?.avatar_url };
};
const short = (text, n = 90) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const newCount = () => S.ideas.filter((i) => i.status === 'nouvelle').length;

function toItem(i) {
  return { id: i.id, member: authorOf(i), title: short(i.body), at: i.created_at, status: statusOf(i) };
}

async function run(fn) {
  try { await fn(); } catch (e) { toast(errMsg(e), 'error'); }
}

const badgeEligible = (i) => i.status === 'retenue' && !!i.user_id && S.byId.has(i.user_id) && !hasBadge(i.user_id, 'boite_a_idees');

async function offerBadge(uid) {
  if (!uid || !S.byId.has(uid) || hasBadge(uid, 'boite_a_idees')) return;
  if (await confirmBox('Attribuer le badge ?', `Attribuer le badge « ${badgeName('boite_a_idees')} » à ${pseudoOf(uid)} ?`, { ok: 'Attribuer' })) {
    await run(async () => { await awardBadge(uid, 'boite_a_idees'); toast(`Badge attribué à ${pseudoOf(uid)}`, 'ok'); renderIdeas(); });
  }
}

/** Change le statut d'une idée ; « retenue » propose d'attribuer le badge à son auteur. */
async function setStatus(idea, status) {
  try {
    check(await sb.from('hg_ideas').update({ status }).eq('id', idea.id));
  } catch (e) {
    toast(errMsg(e), 'error');
    renderIdeas();
    return;
  }
  await loadIdeas();
  renderIdeas();
  renderStats();
  toast(`Idée ${LABEL[status].toLowerCase()}`, 'ok');
  if (status === 'retenue') await offerBadge(idea.user_id);
  renderIdeas();
}

/* ---------- Zone principale : en-tête + idée ---------- */
function paintDetail() {
  const host = V.host;
  if (!host) return;
  const i = S.ideas.find((x) => x.id === V.sel);
  if (!i) {
    host.innerHTML = `<div class="detail-empty">${S.ideas.length ? 'Choisis une idée dans la liste.' : 'Aucune idée déposée pour le moment.'}</div>`;
    return;
  }
  const a = authorOf(i);
  const head = document.createElement('div');
  const thread = document.createElement('div');
  const note = document.createElement('p');
  note.className = 'detail-note';
  note.textContent = 'Une idée ne reçoit pas de réponse depuis le panel : son statut indique la suite donnée.';
  host.replaceChildren(head, thread, note);

  renderDetailHeader(head, {
    member: a,
    title: short(i.body, 70),
    subtitle: `${a.pseudo} · ${fmtDateTime(i.created_at)}`,
    status: { value: i.status, options: OPTIONS, label: 'Statut' },
    onStatus: (v) => setStatus(i, v),
    primary: i.status !== 'retenue' ? { label: 'Retenir', onClick: () => setStatus(i, 'retenue') } : undefined,
    actions: badgeEligible(i) ? [{ label: `Attribuer le badge`, onClick: () => offerBadge(i.user_id) }] : [],
  });

  createThread(thread, {
    composer: false,
    label: 'Idée',
    me: null,
    messages: [
      { type: 'event', text: `Idée déposée par ${a.pseudo}`, at: i.created_at },
      { id: i.id, type: 'message', author: a, body: i.body, at: i.created_at, mine: false },
    ],
  });
}

/* ---------- Liste (colonne 2) ---------- */
function go(id) {
  location.hash = `#communication/idees/${id}`;
}

/* ---------- API de la coquille (registerSub) ---------- */
export const ideasSub = {
  main(el) {
    el.dataset.fill = '';
    V.host = document.getElementById('ideas-root');
    paintDetail();
  },
  list(el) {
    V.list = createList(el, {
      items: S.ideas.map(toItem),
      key: 'id',
      label: 'Idées',
      filters: FILTERS,
      search: { placeholder: 'Rechercher une idée', label: 'Rechercher une idée', fields: (it) => [it.member.pseudo, it.title].join(' ') },
      selectedId: V.sel,
      empty: 'Aucune idée.',
      onSelect: (it) => go(it.id),
    });
  },
  open(_el, { id } = {}) {
    V.sel = id || null;
    V.list?.select(V.sel);
    paintDetail();
  },
};

/** Redessine la liste et le détail après un changement de données (temps réel, actions). */
export function renderIdeas() {
  setCount('idees', newCount());
  V.list?.update(S.ideas.map(toItem));
  paintDetail();
}
