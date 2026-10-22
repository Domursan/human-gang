// Admin : Communication › Boîte à idées. Liste des idées en colonne 2 (createList), idée ouverte dans la zone principale
// (en-tête avec auteur et statut, fil d'une seule bulle). La base (hg_ideas) ne garde ni réponses ni note : le fil est
// en lecture seule. Route : #communication/idees[/<id>]. Droits : admin/perms.js (section « idees », permission « support »).
// Utilisé par admin.js (registerSub) et live.js (renderIdeas). Dépend de core.js, ui-confirm.js, badges.js (badge
// « Boîte à idées »), shell.js (compteur) et des composants ui/.
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

/* ---------- Libellés, options et filtres ---------- */
// Libellé et ton (couleur) de chaque statut d'une idée.
const LABEL = { nouvelle: 'Nouvelle', retenue: 'Retenue', ecartee: 'Écartée' };
const TONE = { nouvelle: 'open', retenue: 'done', ecartee: 'muted' };
const OPTIONS = ['nouvelle', 'retenue', 'ecartee'].map((id) => ({ id, label: LABEL[id], tone: TONE[id] }));
const FILTERS = [
  { id: 'nouvelle', label: 'Nouvelles', test: (it) => it.status.id === 'nouvelle' },
  { id: 'retenue', label: 'Retenues', test: (it) => it.status.id === 'retenue' },
  { id: 'ecartee', label: 'Écartées', test: (it) => it.status.id === 'ecartee' },
];

// État de la vue : éléments de l'écran (zone principale, liste) et idée sélectionnée.
const V = { host: null, list: null, sel: null };

/** Statut d'une idée au format attendu par les composants ui/ : { id, label, tone }. */
const statusOf = (i) => ({ id: i.status, label: LABEL[i.status] || i.status, tone: TONE[i.status] || 'muted' });
/** Auteur d'une idée. Si le compte a été supprimé, « Membre parti » ; avatar et couleur pris dans S.byId. */
const authorOf = (i) => {
  const m = i.user_id ? S.byId.get(i.user_id) : null;
  return { id: i.user_id, pseudo: i.user_id ? pseudoOf(i.user_id) : 'Membre parti', color: m?.color, avatar_url: m?.avatar_url };
};
/** Raccourcit un texte à `n` caractères (espaces normalisés), avec « … » si coupé. */
const short = (text, n = 90) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
/** Nombre d'idées au statut « nouvelle ». Sert au compteur à traiter. */
const newCount = () => S.ideas.filter((i) => i.status === 'nouvelle').length;

/** Élément de liste pour une idée (champs lus par ui/list.js). */
function toItem(i) {
  return { id: i.id, member: authorOf(i), title: short(i.body), at: i.created_at, status: statusOf(i) };
}

/** Exécute `fn` ; une erreur est affichée en toast au lieu d'être levée. */
async function run(fn) {
  try { await fn(); } catch (e) { toast(errMsg(e), 'error'); }
}

/** Badge « Boîte à idées » proposable : idée retenue, auteur encore inscrit, et badge pas encore attribué. */
const badgeEligible = (i) => i.status === 'retenue' && !!i.user_id && S.byId.has(i.user_id) && !hasBadge(i.user_id, 'boite_a_idees');

/** Propose d'attribuer le badge « Boîte à idées » à l'auteur, après confirmation. Ne fait rien si ce n'est pas possible. */
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
    renderIdeas(); // remet le sélecteur sur le statut réel
    return;
  }
  // Écriture réussie : le nouveau statut est gardé en mémoire, même si le rechargement de la liste échoue.
  const local = S.ideas.find((x) => x.id === idea.id);
  if (local) local.status = status;
  let reloadErr = null;
  try { await loadIdeas(); } catch (e) { reloadErr = e; }
  renderIdeas();
  renderStats();
  toast(reloadErr ? `Statut enregistré, mais la liste n'a pas pu être rechargée : ${errMsg(reloadErr)}` : `Idée ${LABEL[status].toLowerCase()}`, reloadErr ? 'error' : 'ok');
  if (status === 'retenue') await offerBadge(idea.user_id);
  renderIdeas();
}

/* ---------- Zone principale : en-tête + idée ---------- */
/** Dessine l'idée sélectionnée (en-tête, fil, note) dans la zone principale. Sans sélection, affiche un message. */
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

  // Fil en lecture seule : pas de zone de réponse (composer: false), seulement l'événement et le texte de l'idée.
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
/** Ouvre une idée : la sélection passe par l'adresse, puis la coquille appelle `open`. */
function go(id) {
  location.hash = `#communication/idees/${id}`;
}

/* ---------- API de la coquille (registerSub) ---------- */
/** Fournisseurs de la sous-section « Boîte à idées » (voir admin/shell.js, registerSub). */
export const ideasSub = {
  /** Montage unique : prépare la zone principale. */
  main(el) {
    el.dataset.fill = '';
    V.host = document.getElementById('ideas-root');
    paintDetail();
  },
  /** Colonne 2 : la liste des idées, avec filtres et recherche. */
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
  /** À chaque visite : retient l'idée de l'adresse (#communication/idees/<id>) et redessine le détail. */
  open(_el, { id } = {}) {
    V.sel = id || null;
    V.list?.select(V.sel);
    paintDetail();
  },
};

/** Redessine la liste, le compteur et le détail après un changement de données (temps réel, actions). */
export function renderIdeas() {
  setCount('idees', newCount());
  V.list?.update(S.ideas.map(toItem));
  paintDetail();
}
