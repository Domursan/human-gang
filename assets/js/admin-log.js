// ===== Humane Gang : administration : journal (Pilotage > Journal) =====
// Colonne 2 : liste chronologique des actions de l'administrateur (hg_admin_log) et des consultations de la
// messagerie (hg_admin_access_log), filtres par type, recherche. Zone principale : détail de l'entrée, avec
// avant / après lus dans le JSON `details`. Lecture seule. Pseudos résolus via hg_profiles (lecture admin).
import { sb, esc, errMsg, fmtDateTime, toast } from './core.js';
import { onTableChange } from './admin/live.js';
import { createList } from './admin/ui/list.js';
import { renderDetailHeader } from './admin/ui/detail-header.js';

const PAGE = 50;
// Libellés des actions journalisées par hg_admin_audit et les triggers. Une action inconnue s'affiche telle quelle.
export const ACTION_LABEL = {
  carte_donnee: 'Carte donnée',
  exemplaire_retire: 'Exemplaire retiré',
  carte_supprimee: 'Carte supprimée',
  ajustement_paillettes: 'Ajustement de Paillettes',
};
const KIND_LABEL = { santa: 'Secret Santa', direct: 'Conversation directe' };
export const actionLabel = (a) => ACTION_LABEL[a] ?? a;

const LG = {
  pseudo: new Map(), rows: [], access: [], more: false, accessMore: false,
  sel: null, list: null, detail: null, dh: null, root: null,
};

const check = (res) => { if (res.error) throw res.error; return res.data; };
const who = (id) => (id ? LG.pseudo.get(id) ?? 'Compte supprimé' : 'Système');
const fmtVal = (v) => (v === undefined || v === null || v === '' ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/* ---------- Filtres (puces) : un par action connue, « autres » et « consultations » ---------- */
const FILTERS = [
  ...Object.entries(ACTION_LABEL).map(([id, label]) => ({ id, label, test: (it) => it.kind === 'action' && it.action === id })),
  { id: 'autres', label: 'Autres actions', test: (it) => it.kind === 'action' && !(it.action in ACTION_LABEL) },
  { id: 'access', label: 'Consultations', test: (it) => it.kind === 'access' },
];

/* ---------- Données ---------- */
function entries() {
  const acts = LG.rows.map((r) => ({
    id: `l${r.id}`, kind: 'action', action: r.action, admin_id: r.admin_id, target_user: r.target_user,
    target_ref: r.target_ref, details: r.details, at: r.created_at,
  }));
  const acc = LG.access.map((r) => ({
    id: `c${r.id}`, kind: 'access', admin_id: r.admin_id, conversation_id: r.conversation_id,
    conversation_kind: r.conversation_kind, at: r.accessed_at,
  }));
  return [...acts, ...acc].sort((a, b) => new Date(b.at) - new Date(a.at));
}

/** Élément de liste : nom = auteur, titre = action, extrait = cible / référence. */
function itemsOf() {
  return entries().map((e) => {
    const name = who(e.admin_id);
    if (e.kind === 'access') {
      return { ...e, name, title: 'Conversation ouverte', excerpt: `${KIND_LABEL[e.conversation_kind] ?? 'Conversation'} · réf. ${String(e.conversation_id ?? '').slice(0, 8)}` };
    }
    const cible = e.target_user ? `cible : ${who(e.target_user)}` : '';
    const ref = e.target_ref ? `réf. ${e.target_ref}` : '';
    return { ...e, name, title: actionLabel(e.action), excerpt: [cible, ref].filter(Boolean).join(' · ') };
  });
}

async function loadPseudos() {
  const rows = check(await sb.from('hg_profiles').select('id, pseudo')) ?? [];
  LG.pseudo = new Map(rows.map((r) => [r.id, r.pseudo]));
}

/** Charge la première page (reset) ou la page suivante des deux flux. */
async function loadPage(reset) {
  const fromA = reset ? 0 : LG.rows.length;
  const fromC = reset ? 0 : LG.access.length;
  const [a, c] = await Promise.all([
    sb.from('hg_admin_log').select('id, admin_id, action, target_user, target_ref, details, created_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(fromA, fromA + PAGE), // une ligne de plus que la page : indique s'il reste des entrées
    sb.from('hg_admin_access_log').select('id, admin_id, conversation_id, conversation_kind, accessed_at')
      .order('accessed_at', { ascending: false }).order('id', { ascending: false })
      .range(fromC, fromC + PAGE),
  ]);
  const gotA = check(a) ?? [];
  const gotC = check(c) ?? [];
  LG.more = gotA.length > PAGE;
  LG.accessMore = gotC.length > PAGE;
  LG.rows = reset ? gotA.slice(0, PAGE) : LG.rows.concat(gotA.slice(0, PAGE));
  LG.access = reset ? gotC.slice(0, PAGE) : LG.access.concat(gotC.slice(0, PAGE));
  paintList();
  if (LG.sel) renderDetail(LG.sel);
}

/* ---------- Détail ---------- */
function detailsHtml(d) {
  const entries = Object.entries(d ?? {});
  if (!entries.length) return '<p class="muted small">Aucun détail enregistré.</p>';
  return `<dl class="log-details">${entries.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(fmtVal(v))}</dd></div>`).join('')}</dl>`;
}

/** Avant / après : deux colonnes lisibles si `details` a before/after (ou avant/après) ; le reste en liste. */
function changesHtml(d) {
  if (!isObj(d)) return detailsHtml(d);
  const bKey = ['before', 'avant'].find((k) => k in d);
  const aKey = ['after', 'apres', 'après'].find((k) => k in d);
  if (!bKey && !aKey) return detailsHtml(d);
  const b = bKey ? d[bKey] : undefined;
  const a = aKey ? d[aKey] : undefined;
  const rows = isObj(b) || isObj(a)
    ? [...new Set([...Object.keys(isObj(b) ? b : {}), ...Object.keys(isObj(a) ? a : {})])]
      .map((k) => [k, isObj(b) ? b[k] : undefined, isObj(a) ? a[k] : undefined])
    : [['Valeur', b, a]];
  const others = Object.keys(d).filter((k) => k !== bKey && k !== aKey);
  return `<table class="log-diff">
      <thead><tr><th scope="col">Champ</th><th scope="col">Avant</th><th scope="col">Après</th></tr></thead>
      <tbody>${rows.map(([k, x, y]) => `<tr${fmtVal(x) !== fmtVal(y) ? ' class="is-changed"' : ''}><th scope="row">${esc(k)}</th><td>${esc(fmtVal(x))}</td><td>${esc(fmtVal(y))}</td></tr>`).join('')}</tbody>
    </table>${others.length ? detailsHtml(Object.fromEntries(others.map((k) => [k, d[k]]))) : ''}`;
}

function renderDetail(id) {
  const box = LG.detail;
  if (!box) return;
  LG.dh?.destroy(); LG.dh = null;
  const it = entries().find((e) => (e.id === id));
  if (!it) {
    box.innerHTML = '<div class="empty">Choisis une entrée dans la liste pour voir son détail.</div>';
    return;
  }
  const name = who(it.admin_id);
  const isAccess = it.kind === 'access';
  box.innerHTML = `<div class="log-detail">
      <div id="log-dhead"></div>
      <dl class="log-facts">
        <div><dt>Date</dt><dd><time datetime="${esc(it.at)}">${esc(fmtDateTime(it.at))}</time></dd></div>
        <div><dt>Auteur</dt><dd>${esc(name)}</dd></div>
        ${isAccess
          ? `<div><dt>Type</dt><dd>${esc(KIND_LABEL[it.conversation_kind] ?? 'Conversation')}</dd></div>
             <div><dt>Conversation</dt><dd>${esc(String(it.conversation_id ?? '').slice(0, 8) || '—')}</dd></div>`
          : `<div><dt>Cible</dt><dd>${esc(it.target_user ? who(it.target_user) : '—')}</dd></div>
             <div><dt>Référence</dt><dd>${esc(it.target_ref || '—')}</dd></div>`}
      </dl>
      <section class="card stack"><h3 class="card-title">${isAccess ? 'Détail de la consultation' : 'Modifications'}</h3>
        ${isAccess ? '<p class="muted small">Ouverture d’une conversation de la messagerie par cet administrateur. Le contenu n’est pas journalisé.</p>' : changesHtml(it.details)}
      </section>
    </div>`;
  LG.dh = renderDetailHeader(box.querySelector('#log-dhead'), {
    member: { pseudo: name },
    title: isAccess ? 'Conversation ouverte' : actionLabel(it.action),
    subtitle: `Par ${name} · ${fmtDateTime(it.at)}`,
  });
}

/* ---------- Colonne 2 ---------- */
function paintList() {
  LG.list?.update(itemsOf());
  if (LG.moreRow) LG.moreRow.hidden = !(LG.more || LG.accessMore);
  if (LG.sel) LG.list?.select(LG.sel);
}

/** Colonne 2 (registerSub list) : liste du journal, filtres et recherche. */
export function listLog(el) {
  const host = document.createElement('div');
  const more = document.createElement('div');
  more.className = 'log-more';
  more.hidden = true;
  more.innerHTML = '<button class="btn btn-ghost btn-sm" type="button" id="log-more">Charger plus</button>';
  el.append(host, more);
  LG.moreRow = more;
  LG.list = createList(host, {
    items: itemsOf(),
    filters: FILTERS,
    label: 'Entrées du journal',
    empty: 'Aucune entrée pour ce filtre.',
    search: { placeholder: 'Rechercher dans le journal', label: 'Rechercher dans le journal', fields: (it) => [it.name, it.title, it.excerpt].join(' ') },
    selectedId: LG.sel,
    onSelect: (it) => { if (it.id !== LG.sel) location.hash = `#pilotage/journal/${it.id}`; },
  });
  more.querySelector('#log-more').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try { await loadPage(false); } catch (err) { toast(`Journal : ${errMsg(err)}`, 'error'); } finally { b.disabled = false; }
  });
  more.hidden = !(LG.more || LG.accessMore);
}

/** Affichage d'une entrée (registerSub open, à chaque visite de #pilotage/journal[/id]). */
export function openLog(_el, { id } = {}) {
  LG.sel = id ? String(id) : null;
  if (LG.root) renderDetail(LG.sel);
  LG.list?.select(LG.sel);
}


/* ---------- Zone principale ---------- */
export function mountLogSection(container) {
  if (!container) return;
  LG.root = container;
  container.innerHTML = '<div id="log-detail"></div>';
  LG.detail = container.querySelector('#log-detail');
  renderDetail(LG.sel);
  (async () => {
    try { await loadPseudos(); } catch (e) { console.warn('[journal] pseudos', e); }
    try { await loadPage(true); } catch (e) { LG.detail.innerHTML = `<div class="empty">Impossible de charger le journal : ${esc(errMsg(e))}</div>`; }
  })();
  onTableChange('journal', ['hg_admin_log'], async () => { await loadPage(true); });
}

