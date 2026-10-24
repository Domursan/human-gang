// Admin : vue d'ensemble (Pilotage > Vue d'ensemble, route #pilotage/apercu), en deux moitiés (migration 103).
// Moitié gauche : chiffres clés (#stats), « Mes raccourcis » (#ov-shortcuts) : une grande tuile par sous-section choisie,
// puis « + Ajouter un raccourci ». L'économie et l'activité récente restent dessous.
// Moitié droite : la file « À traiter » (#ov-todo) : demandes d'assistance, Secret Santa, économie, échanges, idées.
// Mes raccourcis : identifiants de sous-section enregistrés par personne (hg_admin_shortcuts_get / _set). Sans choix
// enregistré (null), les défauts ci-dessous, limités aux sous-sections permises. Le dialogue (#ov-dialog), ouvert par
// « Modifier » ou « + Ajouter », choisit et range les raccourcis ; il s'enregistre par hg_admin_shortcuts_set.
// Téléphone (≤ 760 px) et tablette : une colonne, dans l'ordre chiffres clés, raccourcis, file, économie, activité.
// Chaque élément n'apparaît que si les droits de la personne le permettent ; chaque ligne mène à sa sous-section.
// Utilisé par admin.js (loadOverview, overviewTables, renderStats) et par live.js (renderStats après chaque changement).
// Dépend de core.js (sb, $, esc, avatarHtml, toast, errMsg), ui/time.js (relTime), state.js, perms.js (DOMAINS visibles,
// canSection), shell.js (setCount, countOf, domainIcon), admin-log.js (libellés), eco-health.js (alertes économie),
// loaders.js (ensureSupport, ensureIdeas) et support.js (setState : passer une demande à « traitée »).
import { $, esc, sb, avatarHtml, toast, errMsg } from '../core.js';
import { relTime } from './ui/time.js';
import { S, pseudoOf } from './state.js';
import { canSection, visibleDomains } from './perms.js';
import { setCount, countOf, domainIcon } from './shell.js';
import { actionLabel } from '../admin-log.js';
import { loadEco, renderEco, ecoTodo, ecoTile } from './eco-health.js'; // A7 : santé de l'économie
import { ensureSupport, ensureIdeas } from './loaders.js';
import { setState } from './support.js';

// Données hors coquille, chargées à l'ouverture de la vue et à chaque changement temps réel :
// nombre d'échanges de cartes en attente, et les dernières actions du journal.
const OV = { trades: 0, activity: [] };
// Raccourcis enregistrés (ids de sous-section ; null : jamais réglés, défauts). Dialogue : brouillon ordonné de la
// sélection (draft), filtre de recherche (q), bouton ou élément qui a ouvert le dialogue (opener), enregistrement en cours.
const SC = { ids: null, draft: null, q: '', opener: null, saving: false };
// Affichage de la file, conservé d'un rafraîchissement à l'autre : open = clé de l'élément déplié
// (undefined : le premier, null : aucun).
const UI = { open: undefined };
// Longueur maximale du texte déplié d'un élément de la file.
const TEXT_MAX = 280;
// Raccourcis par défaut (aucun choix enregistré) : les sous-sections permises parmi celles-ci, six au plus.
const DEFAULT_SHORTCUTS = ['assistance', 'idees', 'encheres', 'secret-santa', 'sorties', 'comptes'];
// Nombre maximal de raccourcis (la fonction hg_admin_shortcuts_set en garde 24).
const MAX_SHORTCUTS = 24;

/** « 1 idée » / « 3 idées » : nombre suivi du mot au singulier ou au pluriel. */
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
/** Texte sur une seule ligne, coupé à n caractères (« … » à la fin). */
const clip = (text, n) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
/** Texte normalisé pour la recherche : sans accents, en minuscules, sans espaces autour. */
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * File « À traiter », dans l'ordre d'affichage : assistance (la plus ancienne d'abord), Secret Santa, économie,
 * échanges, idées. Chaque élément porte son domaine (identifiant de DOMAINS) et ce qu'il faut pour le déplier.
 * @param {object|undefined} ed Édition Secret Santa la plus récente.
 * @param {number} open Nombre de demandes d'assistance ouvertes.
 * @param {number} newIdeas Nombre d'idées nouvelles.
 * @param {{label: string, href: string, act: string}|null} ecoT Alerte économie (eco-health.js), ou null.
 * @returns {Array<object>} Éléments : key, dom, tag, phrase, title, text, when, who, href, act, done (id de demande ou null).
 */
function queueItems(ed, open, newIdeas, ecoT) {
  const out = [];
  if (canSection('assistance') && open) {
    const phrase = plural(open, 'demande ouverte', 'demandes ouvertes');
    const oldest = S.support.filter((s) => s.status === 'ouverte')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    for (const s of oldest) {
      out.push({ key: `sup:${s.id}`, dom: 'pilotage', tag: 'Assistance', phrase,
        title: s.subject || 'Demande sans sujet', text: clip(s.message, TEXT_MAX), when: s.created_at,
        who: s.user_id ? pseudoOf(s.user_id) : (s.pseudo || 'Anonyme'),
        href: `#pilotage/assistance/${encodeURIComponent(s.id)}`, act: 'Répondre', done: s.id });
    }
  }
  if (canSection('secret-santa') && ed && ed.status === 'tirage') {
    out.push({ key: 'ss', dom: 'irl', tag: 'Secret Santa', phrase: `Tirage du Secret Santa ${ed.year} à faire`,
      title: `Tirage du Secret Santa ${ed.year} à faire`, text: `L’édition ${ed.year} est au stade du tirage.`,
      when: null, who: null, href: '#irl/secret-santa', act: 'Ouvrir', done: null });
  }
  if (ecoT) {
    out.push({ key: 'eco', dom: 'cartes', tag: 'Économie', phrase: ecoT.label,
      title: ecoT.label, text: 'Un indicateur de l’économie dépasse son seuil. Le détail et le réglage sont dans la sous-section.',
      when: null, who: null, href: ecoT.href, act: ecoT.act, done: null });
  }
  if (canSection('cartes') && OV.trades) {
    const phrase = plural(OV.trades, 'échange en attente', 'échanges en attente');
    out.push({ key: 'trades', dom: 'cartes', tag: 'Échanges', phrase, title: phrase,
      text: 'Des échanges de cartes proposés attendent une réponse.', when: null, who: null,
      href: '#cartes/echanges', act: 'Examiner', done: null });
  }
  if (canSection('idees') && newIdeas) {
    const phrase = plural(newIdeas, 'idée nouvelle', 'idées nouvelles');
    for (const i of S.ideas.filter((x) => x.status === 'nouvelle')) {
      out.push({ key: `idea:${i.id}`, dom: 'pilotage', tag: 'Idée à relire', phrase,
        title: clip(i.body, 90), text: clip(i.body, TEXT_MAX), when: i.created_at,
        who: i.user_id ? pseudoOf(i.user_id) : 'Membre parti', href: '#pilotage/idees', act: 'Trier', done: null });
    }
  }
  return out;
}

/** En-tête de la file : titre et nombre d'éléments. */
function todoHeadHtml(total) {
  return `<div class="ov-todo-title-row">
      <h3 class="ov-todo-title" id="ov-todo-title">À traiter</h3>
      <span class="ov-todo-badge" aria-hidden="true">${total}</span>
    </div>
    <p class="ov-todo-sub small">${esc(plural(total, 'élément', 'éléments'))}</p>`;
}

/**
 * Liste de la file. Un seul élément déplié à la fois ; sans choix de la personne, le premier.
 * Déplié : texte court, « Répondre » / « Ouvrir » (lien vers la sous-section) et, pour une demande, « Marquer comme traitée ».
 */
function queueHtml(items, expandedKey) {
  if (!items.length) return '<div class="empty">Rien à traiter pour l’instant.</div>';
  return `<ul class="ov-q" aria-labelledby="ov-todo-title">${items.map((it, idx) => {
    const open = it.key === expandedKey;
    const meta = [it.who, it.when ? relTime(it.when) : ''].filter(Boolean).join(' · ');
    return `<li class="ov-q-item${open ? ' is-open' : ''}" data-dom="${esc(it.dom)}">
        <button type="button" class="ov-q-head" aria-expanded="${open}"${open ? ` aria-controls="ov-q-${idx}"` : ''} data-ov-q="${esc(it.key)}" data-ov-k="q:${esc(it.key)}">
          <span class="ov-q-top"><span class="ov-q-tag">${esc(it.tag)}</span></span>
          <span class="ov-q-title">${esc(it.title)}</span>
          ${meta ? `<span class="ov-q-who">${esc(meta)}</span>` : ''}
        </button>
        ${open ? `<div class="ov-q-body" id="ov-q-${idx}">
          ${it.text ? `<p class="ov-q-text">${esc(it.text)}</p>` : ''}
          <div class="ov-q-actions">
            <a class="btn btn-ghost btn-sm" href="${esc(it.href)}">${esc(it.act)}</a>
            ${it.done ? `<button type="button" class="btn btn-sand btn-sm" data-ov-done="${esc(it.done)}" data-ov-k="done:${esc(it.done)}">Marquer comme traitée</button>` : ''}
          </div>
        </div>` : ''}
      </li>`;
  }).join('')}</ul>`;
}

/** Marque une demande comme traitée (réutilise setState de support.js : écriture, journal, toasts, redessin). */
async function markDone(id, btn) {
  btn.disabled = true;
  await setState(id, 'traitee');
  if (btn.isConnected) btn.disabled = false; // échec : la file n'a pas été redessinée, le bouton reste utilisable
}

/* =========================================================
   Mes raccourcis : choix, affichage, dialogue
   ========================================================= */

/** Sous-sections permises, par identifiant : { dom, sub }. Les sous-sections désactivées ou sans droit n'y figurent pas. */
function allowedSubs() {
  const map = new Map();
  for (const d of visibleDomains()) for (const s of d.subs) map.set(s.id, { dom: d, sub: s });
  return map;
}
/** Chemin discret d'une sous-section : « Domaine › Groupe » (le groupe seulement s'il a un titre distinct du libellé). */
const pathOf = (dom, sub) => [dom.label, sub.heading && sub.heading !== sub.label ? sub.heading : ''].filter(Boolean).join(' › ');
/** Raccourcis affichés : identifiants choisis (ou défauts), dans l'ordre, sans les sous-sections non permises. */
function shortcutList() {
  const allowed = allowedSubs();
  const ids = SC.ids ?? DEFAULT_SHORTCUTS.filter((id) => allowed.has(id));
  return ids.filter((id) => allowed.has(id)).map((id) => allowed.get(id));
}

/** Tuile d'un raccourci : grande, couleur du domaine, compteur « à traiter » s'il est > 0. */
function shortcutTile({ dom, sub }) {
  const n = countOf(sub.id);
  return `<li class="ov-sc-item">
      <a class="ov-sc" href="#${esc(dom.id)}/${esc(sub.id)}" data-dom="${esc(dom.id)}" data-ov-k="sc:${esc(sub.id)}">
        <span class="ov-sc-ico" aria-hidden="true">${domainIcon(dom.icon)}</span>
        <span class="ov-sc-text">
          <span class="ov-sc-name">${esc(sub.label)}</span>
          <span class="ov-sc-path">${esc(pathOf(dom, sub))}</span>
        </span>
        ${n > 0 ? `<span class="ov-sc-count"><strong>${n}</strong> à traiter</span>` : ''}
      </a>
    </li>`;
}

/** Grille « Mes raccourcis » : une tuile par raccourci, puis la tuile en pointillés « + Ajouter un raccourci ». */
function shortcutsHtml() {
  const list = shortcutList();
  return `<ul class="ov-sc-grid">${list.map(shortcutTile).join('')}
      <li class="ov-sc-item"><button type="button" class="ov-sc-add" data-ov-add data-ov-k="sc:add"><span class="ov-sc-plus" aria-hidden="true">+</span> Ajouter un raccourci</button></li>
    </ul>${list.length ? '' : '<p class="small muted ov-sc-empty">Aucun raccourci pour l’instant.</p>'}`;
}

/** Ouvre le dialogue « Ajouter un raccourci » : la sélection du moment est copiée dans le brouillon. */
function openDialog(opener) {
  const dlg = document.getElementById('ov-dialog');
  if (!dlg || dlg.open) return;
  const allowed = allowedSubs();
  SC.draft = (SC.ids ?? DEFAULT_SHORTCUTS.filter((id) => allowed.has(id))).filter((id) => allowed.has(id));
  SC.q = '';
  SC.opener = opener || document.activeElement;
  $('#ov-sc-q').value = '';
  paintOrder();
  paintPicks();
  dlg.showModal();
  $('#ov-sc-q').focus();
}

/** Liste « Ordre » : les raccourcis choisis, dans l'ordre, avec un bouton pour monter et un pour descendre. */
function paintOrder() {
  const allowed = allowedSubs();
  const order = SC.draft.filter((id) => allowed.has(id));
  $('#ov-sc-order').innerHTML = order.length
    ? order.map((id, i) => {
      const { dom, sub } = allowed.get(id);
      return `<li class="ov-order-item" data-dom="${esc(dom.id)}">
          <span class="ov-order-text"><span class="ov-order-name">${esc(sub.label)}</span><span class="ov-order-path">${esc(pathOf(dom, sub))}</span></span>
          <span class="ov-order-btns">
            <button type="button" class="btn btn-ghost btn-sm" data-ov-move="-1" data-id="${esc(id)}" aria-label="Monter ${esc(sub.label)}"${i === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="btn btn-ghost btn-sm" data-ov-move="1" data-id="${esc(id)}" aria-label="Descendre ${esc(sub.label)}"${i === order.length - 1 ? ' disabled' : ''}>↓</button>
          </span>
        </li>`;
    }).join('')
    : '<li class="ov-order-empty">Aucun raccourci choisi.</li>';
  $('#ov-sc-count').textContent = `${order.length} sur ${MAX_SHORTCUTS} au plus`;
}

/** Liste de toutes les sous-sections permises, groupées par domaine, filtrée par la recherche. */
function paintPicks() {
  const q = norm(SC.q);
  const html = visibleDomains().map((d) => {
    const subs = d.subs.filter((s) => !q || norm(`${d.label} ${s.heading || ''} ${s.label}`).includes(q));
    if (!subs.length) return '';
    return `<section class="ov-pick-group" data-dom="${esc(d.id)}" aria-labelledby="ov-pick-${esc(d.id)}">
        <h3 class="ov-pick-title" id="ov-pick-${esc(d.id)}"><span class="ov-pick-dot" aria-hidden="true"></span>${esc(d.label)}</h3>
        <ul class="ov-pick-list">${subs.map((s) => `<li><label class="ov-pick">
            <input type="checkbox" value="${esc(s.id)}"${SC.draft.includes(s.id) ? ' checked' : ''}>
            <span class="ov-pick-label">${esc(s.label)}</span>
            ${s.heading && s.heading !== s.label ? `<span class="ov-pick-group-name">${esc(s.heading)}</span>` : ''}
          </label></li>`).join('')}</ul>
      </section>`;
  }).join('');
  $('#ov-sc-groups').innerHTML = html || `<p class="empty">Aucune page ne correspond à « ${esc(SC.q)} ».</p>`;
}

/** Coche ou décoche un raccourci dans le brouillon. Renvoie false si la limite est atteinte (rien n'est ajouté). */
function togglePick(id, on) {
  if (!on) { SC.draft = SC.draft.filter((x) => x !== id); return true; }
  if (SC.draft.includes(id)) return true;
  if (SC.draft.length >= MAX_SHORTCUTS) { toast(`Au plus ${MAX_SHORTCUTS} raccourcis.`, 'error'); return false; }
  SC.draft.push(id);
  return true;
}

/** Monte (dir = -1) ou descend (dir = 1) un raccourci du brouillon ; le focus suit le bouton. */
function moveDraft(id, dir) {
  const i = SC.draft.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= SC.draft.length) return;
  [SC.draft[i], SC.draft[j]] = [SC.draft[j], SC.draft[i]];
  paintOrder();
  document.querySelector(`#ov-sc-order [data-id="${CSS.escape(id)}"][data-ov-move="${dir}"]`)?.focus();
}

/** Enregistre le brouillon (hg_admin_shortcuts_set), ferme le dialogue et redessine la vue. */
async function saveShortcuts() {
  if (SC.saving) return;
  SC.saving = true;
  const btn = $('#ov-sc-save');
  btn.disabled = true;
  try {
    const r = await sb.rpc('hg_admin_shortcuts_set', { p_items: SC.draft });
    if (r.error) throw r.error;
    SC.ids = Array.isArray(r.data) ? r.data : [...SC.draft];
    document.getElementById('ov-dialog').close();
    renderStats();
    toast('Raccourcis enregistrés.');
  } catch (e) {
    toast(`Raccourcis non enregistrés : ${errMsg(e)}`, 'error');
  } finally {
    SC.saving = false;
    btn.disabled = false;
  }
}

/** Lit les raccourcis enregistrés (une fois par visite de la vue). Une erreur laisse les défauts. */
async function loadShortcuts() {
  const r = await sb.rpc('hg_admin_shortcuts_get');
  if (r.error) throw r.error;
  SC.ids = Array.isArray(r.data) ? r.data : null;
}

/* =========================================================
   Liaison des événements (une fois), tableau de bord
   ========================================================= */

/** Tables à relire quand elles changent, selon les droits (temps réel). Le reste (demandes, idées) passe par live.js. */
export function overviewTables() {
  return [...(canSection('journal') ? ['hg_admin_log'] : []), ...(canSection('cartes') ? ['hg_card_trades'] : [])];
}

let bound = false;
/**
 * Gestion des clics et du dialogue (délégation, posée une seule fois sur #ov) : raccourcis (Modifier, Ajouter),
 * déplier un élément de la file, marquer une demande comme traitée, et le dialogue (recherche, cases, ordre, enregistrement).
 */
function bindOnce() {
  const root = document.getElementById('ov');
  if (!root || bound) return;
  bound = true;
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-ov-edit], [data-ov-add]')) { openDialog(e.target.closest('button')); return; }
    if (e.target.closest('[data-ov-dialog-close]')) { document.getElementById('ov-dialog').close(); return; }
    const mv = e.target.closest('[data-ov-move]');
    if (mv) { moveDraft(mv.dataset.id, Number(mv.dataset.ovMove)); return; }
    const head = e.target.closest('[data-ov-q]');
    if (head) { const key = head.dataset.ovQ; UI.open = head.getAttribute('aria-expanded') === 'true' ? null : key; renderStats(); return; }
    const done = e.target.closest('[data-ov-done]');
    if (done) markDone(done.dataset.ovDone, done);
  });
  const dlg = document.getElementById('ov-dialog');
  if (!dlg) return;
  dlg.addEventListener('close', () => {
    SC.draft = null;
    const back = SC.opener;
    SC.opener = null;
    if (back && back.isConnected) back.focus();
  });
  dlg.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    if (!togglePick(cb.value, cb.checked)) cb.checked = false;
    paintOrder();
  });
  $('#ov-sc-q').addEventListener('input', (e) => { SC.q = e.target.value; paintPicks(); });
  dlg.querySelector('#ov-dialog-form').addEventListener('submit', (e) => { e.preventDefault(); saveShortcuts(); });
}

/* =========================================================
   Vue d'ensemble : chiffres, raccourcis, file, activité
   ========================================================= */
/**
 * Redessine la vue à partir des données déjà chargées (S, OV, SC) : chiffres clés, raccourcis, file, activité, compteurs.
 * Ne charge rien : c'est loadOverview qui charge les données avant d'appeler cette fonction.
 */
export function renderStats() {
  bindOnce();
  const root = document.getElementById('ov');
  // Focus conservé : un élément de la vue (raccourci, élément de la file, bouton) reste focalisé après le redessin.
  const focusKey = root && document.activeElement && root.contains(document.activeElement) ? document.activeElement.dataset.ovK : null;

  const ed = S.editions[0];
  // Codes libres : ni utilisés, ni rattachés à un lien, et pas expirés.
  const free = S.invites.filter((i) => !i.used_by && !i.link_id && !(i.expires_at && new Date(i.expires_at) < new Date())).length;
  const newIdeas = S.ideas.filter((i) => i.status === 'nouvelle').length;
  const open = S.support.filter((s) => s.status === 'ouverte').length;
  // Inscrits : compte seulement si l'édition affichée est bien la plus récente (sinon « – »).
  const partCount = ed && ed.id === S.editionId ? S.participants.length : null;
  const eco = ecoTile(); // A7 : alertes économie (droit « cartes »)
  // Compteurs « à traiter » : colonne de navigation, rail, onglets et tuiles « Mes raccourcis ».
  if (canSection('idees')) setCount('idees', newIdeas);
  if (canSection('assistance')) setCount('assistance', open);
  if (canSection('cartes')) { setCount('echanges', OV.trades); setCount('economie', eco?.warn ? eco.value : 0); }
  if (canSection('secret-santa')) setCount('secret-santa', ed?.status === 'tirage' ? 1 : 0);

  // [section, route, valeur, libellé, à traiter]. Une tuile n'apparaît que si sa section est accessible.
  const tiles = [
    ['comptes', '#membres/comptes', S.members.length, 'membres'],
    ['membres', '#membres/invitations', free, free > 1 ? 'codes disponibles' : 'code disponible'],
    ['secret-santa', '#irl/secret-santa', ed ? (partCount ?? '–') : '–', ed ? `inscrits · Secret Santa ${ed.year}` : 'aucune édition'],
    ['idees', '#pilotage/idees', newIdeas, newIdeas > 1 ? 'nouvelles idées' : 'nouvelle idée', newIdeas > 0],
    ['assistance', '#pilotage/assistance', open, open > 1 ? 'demandes ouvertes' : 'demande ouverte', open > 0],
  ];
  const shown = tiles.filter(([section]) => canSection(section));
  if (eco) shown.push(['cartes', eco.href, eco.value, eco.label, eco.warn]);
  $('#stats').innerHTML = shown.length
    ? shown.map(([, href, v, l, warn]) =>
      `<a class="stat${warn ? ' attention' : ''}" href="${href}"><span class="stat-value">${esc(v)}</span><span class="stat-label">${esc(l)}</span></a>`).join('')
    : '<div class="empty">Aucun indicateur à afficher pour tes droits.</div>';

  // Mes raccourcis
  const $sc = $('#ov-shortcuts');
  if ($sc) $sc.innerHTML = shortcutsHtml();

  // File « À traiter » (les éléments sont tous affichés, le premier est déplié sans choix de la personne)
  const items = queueItems(ed, open, newIdeas, ecoTodo());
  if (UI.open !== undefined && UI.open !== null && !items.some((it) => it.key === UI.open)) UI.open = undefined; // élément disparu : le premier reprend
  const expandedKey = UI.open === undefined ? (items[0]?.key ?? null) : UI.open;
  const $head = $('#ov-todo-head');
  if ($head) $head.innerHTML = todoHeadHtml(items.length);
  const $todo = $('#ov-todo');
  if ($todo) $todo.innerHTML = queueHtml(items, expandedKey);

  // Activité récente (journal) : seulement si le journal est permis
  const card = $('#ov-activity-card');
  if (card) card.hidden = !canSection('journal');
  const $act = $('#ov-activity');
  if ($act && canSection('journal')) {
    $act.innerHTML = OV.activity.length
      ? `<ul class="ov-act">${OV.activity.map((r) => {
        const who = r.admin_id ? pseudoOf(r.admin_id) : 'Système';
        const cible = r.target_user ? ` · ${pseudoOf(r.target_user)}` : '';
        return `<li>
            <span class="ov-av" aria-hidden="true">${avatarHtml({ pseudo: who }, 28)}</span>
            <span><strong>${esc(who)}</strong> · ${esc(actionLabel(r.action))}${esc(cible)}</span>
            <time datetime="${esc(r.created_at)}">${esc(relTime(r.created_at))}</time>
          </li>`;
      }).join('')}</ul>`
      : '<div class="empty">Aucune action journalisée pour l’instant.</div>';
  }

  renderEco();

  if (root && focusKey) {
    const again = [...root.querySelectorAll('[data-ov-k]')].find((x) => x.dataset.ovK === focusKey);
    again?.focus({ preventScroll: true });
  }
}

/**
 * Charge les données de la vue (raccourcis, échanges en attente, dernières actions, alertes économie, demandes et idées
 * si permises), puis redessine. Une requête qui échoue est signalée dans la console ; la vue s'affiche quand même.
 */
export async function loadOverview() {
  const jobs = [loadShortcuts()];
  if (canSection('cartes')) {
    jobs.push(sb.from('hg_card_trades').select('id').eq('status', 'proposee')
      .then((r) => { if (r.error) throw r.error; OV.trades = r.data?.length ?? 0; }));
    jobs.push(loadEco());
  }
  if (canSection('journal')) {
    jobs.push(sb.from('hg_admin_log').select('id, admin_id, action, target_user, created_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(6)
      .then((r) => { if (r.error) throw r.error; OV.activity = r.data ?? []; }));
  }
  // File : demandes d'assistance et idées (chargées une seule fois, puis mises à jour par le temps réel)
  if (canSection('assistance')) jobs.push(ensureSupport());
  if (canSection('idees')) jobs.push(ensureIdeas());
  await Promise.all(jobs.map((p) => p.catch((e) => console.warn('[apercu]', e))));
  renderStats();
}

// A7 : « Ignorer cette semaine » a changé l'état des alertes : on redessine la vue.
document.addEventListener('hg:eco-changed', () => renderStats());
