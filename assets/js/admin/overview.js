// Admin : vue d'ensemble (Pilotage > Vue d'ensemble, route #pilotage/apercu), en deux moitiés.
// Moitié gauche (≈ 60 %) : chiffres clés (#stats), une tuile par domaine visible (couleur propre, filtre de la file,
// raccourcis vers ses premières sous-sections), puis économie et activité récente.
// Moitié droite (≈ 40 %) : la file « À traiter » (#ov-todo) : demandes d'assistance, Secret Santa, économie, échanges,
// idées ; un élément se déplie sur place, et l'on peut répondre, trier, ouvrir ou marquer une demande comme traitée.
// Téléphone (≤ 760 px) : deux onglets, « Domaines » et « À traiter (n) ». La coquille (shell.js) masque rail et colonne
// sur cette route (classe admin-home) ; le style est dans admin-accueil.css.
// Chaque élément n'apparaît que si les droits de la personne le permettent ; chaque ligne mène à sa sous-section.
// Utilisé par admin.js (loadOverview, overviewTables, renderStats) et par live.js (renderStats après chaque changement).
// Dépend de core.js (sb, $, esc, avatarHtml), ui/time.js (relTime), state.js, perms.js (DOMAINS visibles, canSection),
// shell.js (setCount, domainIcon), admin-log.js (libellés d'actions), eco-health.js (alertes économie),
// loaders.js (ensureSupport, ensureIdeas) et support.js (setState : passer une demande à « traitée »).
import { $, esc, sb, avatarHtml } from '../core.js';
import { relTime } from './ui/time.js';
import { S, pseudoOf } from './state.js';
import { canSection, visibleDomains } from './perms.js';
import { setCount, domainIcon } from './shell.js';
import { actionLabel } from '../admin-log.js';
import { loadEco, renderEco, ecoTodo, ecoTile } from './eco-health.js'; // A7 : santé de l'économie
import { ensureSupport, ensureIdeas } from './loaders.js';
import { setState } from './support.js';

// Données hors coquille, chargées à l'ouverture de la vue et à chaque changement temps réel :
// nombre d'échanges de cartes en attente, et les dernières actions du journal.
const OV = { trades: 0, activity: [] };
// Affichage de la vue, conservé d'un rafraîchissement à l'autre :
// filter = identifiant du domaine filtré (ou null) ; open = clé de l'élément déplié (undefined : le premier, null : aucun) ;
// tab = onglet affiché sur téléphone (« todo » ou « domains »).
const UI = { filter: null, open: undefined, tab: 'todo' };
// Longueur maximale du texte déplié d'un élément de la file.
const TEXT_MAX = 280;

/** « 1 idée » / « 3 idées » : nombre suivi du mot au singulier ou au pluriel. */
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
/** Texte sur une seule ligne, coupé à n caractères (« … » à la fin). */
const clip = (text, n) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

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
      out.push({ key: `sup:${s.id}`, dom: 'communication', tag: 'Assistance', phrase,
        title: s.subject || 'Demande sans sujet', text: clip(s.message, TEXT_MAX), when: s.created_at,
        who: s.user_id ? pseudoOf(s.user_id) : (s.pseudo || 'Anonyme'),
        href: `#communication/assistance/${encodeURIComponent(s.id)}`, act: 'Répondre', done: s.id });
    }
  }
  if (canSection('secret-santa') && ed && ed.status === 'tirage') {
    out.push({ key: 'ss', dom: 'vie', tag: 'Secret Santa', phrase: `Tirage du Secret Santa ${ed.year} à faire`,
      title: `Tirage du Secret Santa ${ed.year} à faire`, text: `L’édition ${ed.year} est au stade du tirage.`,
      when: null, who: null, href: '#vie/secret-santa', act: 'Ouvrir', done: null });
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
      out.push({ key: `idea:${i.id}`, dom: 'communication', tag: 'Idée à relire', phrase,
        title: clip(i.body, 90), text: clip(i.body, TEXT_MAX), when: i.created_at,
        who: i.user_id ? pseudoOf(i.user_id) : 'Membre parti', href: '#communication/idees', act: 'Trier', done: null });
    }
  }
  return out;
}

/** Tuile d'un domaine : nom, phrase d'état, compteur « à traiter », trois raccourcis et « Tout voir ». */
function tileHtml(d, items) {
  const on = UI.filter === d.id;
  const state = [...new Set(items.map((i) => i.phrase))].join(' · ') || 'Rien à traiter';
  const links = d.subs.slice(0, 3).map((s) => `<li><a href="#${esc(d.id)}/${esc(s.id)}">${esc(s.label)}</a></li>`).join('');
  return `<article class="ov-tile${on ? ' is-on' : ''}" data-dom="${esc(d.id)}" aria-labelledby="ov-t-${esc(d.id)}">
      <button type="button" class="ov-tile-head" aria-pressed="${on}" data-ov-filter="${esc(d.id)}" data-ov-k="filter:${esc(d.id)}">
        <span class="ov-tile-top">
          <span class="ov-tile-ico" aria-hidden="true">${domainIcon(d.icon)}</span>
          <span class="ov-tile-count"><strong>${items.length}</strong><span>à traiter</span></span>
        </span>
        <span class="ov-tile-name" id="ov-t-${esc(d.id)}">${esc(d.label)}</span>
        <span class="ov-tile-state">${esc(state)}</span>
      </button>
      <ul class="ov-tile-links">${links}</ul>
      <a class="ov-tile-all" href="#${esc(d.id)}/${esc(d.subs[0].id)}">Tout voir</a>
    </article>`;
}

/** En-tête de la file : titre, nombre affiché, « n sur N » et la puce du filtre (retire le filtre au clic). */
function todoHeadHtml(shown, total) {
  const chip = UI.filter ? visibleDomains().find((d) => d.id === UI.filter) : null;
  return `<div class="ov-todo-title-row">
      <h3 class="ov-todo-title" id="ov-todo-title">À traiter</h3>
      <span class="ov-todo-badge" aria-hidden="true">${shown}</span>
    </div>
    <p class="ov-todo-sub small">${shown} sur ${total}</p>
    ${chip ? `<div class="ov-chips"><button type="button" class="ov-chip" data-dom="${esc(chip.id)}" data-ov-chip data-ov-k="chip" aria-label="Retirer le filtre ${esc(chip.label)}">${esc(chip.label)} <span aria-hidden="true">×</span></button></div>` : ''}`;
}

/**
 * Liste de la file. Un seul élément déplié à la fois ; sans choix de la personne, le premier.
 * Déplié : texte court, « Répondre » / « Ouvrir » (lien vers la sous-section) et, pour une demande, « Marquer comme traitée ».
 */
function queueHtml(items, expandedKey) {
  if (!items.length) return `<div class="empty">${UI.filter ? 'Rien à traiter dans ce domaine.' : 'Rien à traiter pour l’instant.'}</div>`;
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

/**
 * Gestion des clics de la vue (délégation, posée une seule fois sur #ov) : filtre par tuile, puce de filtre,
 * onglets du téléphone, déplier un élément, marquer une demande comme traitée.
 */
let bound = false;
function bindOnce() {
  const root = document.getElementById('ov');
  if (!root || bound) return;
  bound = true;
  root.addEventListener('click', (e) => {
    const filt = e.target.closest('[data-ov-filter]');
    if (filt) { const id = filt.dataset.ovFilter; UI.filter = UI.filter === id ? null : id; renderStats(); return; }
    if (e.target.closest('[data-ov-chip]')) { UI.filter = null; renderStats(); return; }
    const tab = e.target.closest('[data-ov-tab]');
    if (tab) { UI.tab = tab.dataset.ovTab; renderStats(); return; }
    const head = e.target.closest('[data-ov-q]');
    if (head) { const key = head.dataset.ovQ; UI.open = head.getAttribute('aria-expanded') === 'true' ? null : key; renderStats(); return; }
    const done = e.target.closest('[data-ov-done]');
    if (done) markDone(done.dataset.ovDone, done);
  });
}

/** Tables à relire quand elles changent, selon les droits (temps réel). Le reste (demandes, idées) passe par live.js. */
export function overviewTables() {
  return [...(canSection('journal') ? ['hg_admin_log'] : []), ...(canSection('cartes') ? ['hg_card_trades'] : [])];
}

/* =========================================================
   Vue d'ensemble : chiffres, tuiles, file, activité
   ========================================================= */
/**
 * Redessine la vue à partir des données déjà chargées (S, OV) : chiffres clés, tuiles, file, activité, compteurs.
 * Ne charge rien : c'est loadOverview qui charge les données avant d'appeler cette fonction.
 */
export function renderStats() {
  bindOnce();
  const root = document.getElementById('ov');
  // Focus conservé : une élément du panneau (tuile, élément de la file, bouton) reste focalisé après le redessin.
  const focusKey = root && document.activeElement && root.contains(document.activeElement) ? document.activeElement.dataset.ovK : null;

  const ed = S.editions[0];
  // Codes libres : ni utilisés, ni rattachés à un lien, et pas expirés.
  const free = S.invites.filter((i) => !i.used_by && !i.link_id && !(i.expires_at && new Date(i.expires_at) < new Date())).length;
  const newIdeas = S.ideas.filter((i) => i.status === 'nouvelle').length;
  const open = S.support.filter((s) => s.status === 'ouverte').length;
  // Inscrits : compte seulement si l'édition affichée est bien la plus récente (sinon « – »).
  const partCount = ed && ed.id === S.editionId ? S.participants.length : null;
  // [section, route, valeur, libellé, à traiter]. Une tuile n'apparaît que si sa section est accessible.
  const tiles = [
    ['comptes', '#membres/comptes', S.members.length, 'membres'],
    ['membres', '#membres/invitations', free, free > 1 ? 'codes disponibles' : 'code disponible'],
    ['secret-santa', '#vie/secret-santa', ed ? (partCount ?? '–') : '–', ed ? `inscrits · Secret Santa ${ed.year}` : 'aucune édition'],
    ['idees', '#communication/idees', newIdeas, newIdeas > 1 ? 'nouvelles idées' : 'nouvelle idée', newIdeas > 0],
    ['assistance', '#communication/assistance', open, open > 1 ? 'demandes ouvertes' : 'demande ouverte', open > 0],
  ];
  const shown = tiles.filter(([section]) => canSection(section));
  const eco = ecoTile(); // A7 : alertes économie (droit « cartes »)
  if (eco) shown.push(['cartes', eco.href, eco.value, eco.label, eco.warn]);
  $('#stats').innerHTML = shown.length
    ? shown.map(([, href, v, l, warn]) =>
      `<a class="stat${warn ? ' attention' : ''}" href="${href}"><span class="stat-value">${esc(v)}</span><span class="stat-label">${esc(l)}</span></a>`).join('')
    : '<div class="empty">Aucun indicateur à afficher pour tes droits.</div>';

  // File « À traiter » et tuiles (une par domaine visible, compteur = éléments de la file pour ce domaine)
  const items = queueItems(ed, open, newIdeas, ecoTodo());
  if (UI.open !== undefined && UI.open !== null && !items.some((it) => it.key === UI.open)) UI.open = undefined; // élément disparu : le premier reprend
  const domains = visibleDomains();
  if (UI.filter && !domains.some((d) => d.id === UI.filter)) UI.filter = null;
  const tilesEl = $('#ov-tiles');
  if (tilesEl) tilesEl.innerHTML = domains.map((d) => tileHtml(d, items.filter((it) => it.dom === d.id))).join('');
  const shownItems = UI.filter ? items.filter((it) => it.dom === UI.filter) : items;
  // Sans choix de la personne, le premier élément affiché (filtré ou non) est déplié
  const expandedKey = UI.open === undefined ? (shownItems[0]?.key ?? null) : UI.open;
  const $head = $('#ov-todo-head');
  if ($head) $head.innerHTML = todoHeadHtml(shownItems.length, items.length);
  const $todo = $('#ov-todo');
  if ($todo) $todo.innerHTML = queueHtml(shownItems, expandedKey);
  // Onglets du téléphone : « À traiter (n) » avec le total, panneau affiché selon UI.tab
  const $tabTodo = $('#ov-tab-todo');
  if ($tabTodo) $tabTodo.textContent = `À traiter (${items.length})`;
  if (root) {
    root.dataset.mtab = UI.tab;
    for (const t of root.querySelectorAll('[data-ov-tab]')) t.setAttribute('aria-selected', String(t.dataset.ovTab === UI.tab));
  }

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

  // Compteurs « à traiter » : colonne de navigation, rail et onglets
  if (canSection('idees')) setCount('idees', newIdeas);
  if (canSection('assistance')) setCount('assistance', open);

  if (root && focusKey) {
    const again = [...root.querySelectorAll('[data-ov-k]')].find((x) => x.dataset.ovK === focusKey);
    again?.focus({ preventScroll: true });
  }
}

/**
 * Charge les données de la vue (échanges en attente, dernières actions, alertes économie, demandes et idées si permises),
 * puis redessine. Une requête qui échoue est signalée dans la console ; la vue s'affiche quand même.
 */
export async function loadOverview() {
  const jobs = [];
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
