// =====================================================================
// Admin : Site › Fonctionnement › Erreurs du site (idée A9).
// Erreurs JavaScript remontées par les navigateurs (hg_client_errors, migration 093), regroupées par signature :
// tableau des groupes (filtre Nouvelles / Connues / Corrigées / Toutes) et détail du groupe choisi (pages,
// navigateurs, 7 derniers jours, statut, « Créer une demande »). Aucune donnée personnelle n'est stockée.
// Droits : permission « reglages » (admin/perms.js, section « erreurs »). Lecture par RLS, statut par RPC
// hg_client_error_set, demande d'assistance par hg_client_error_ticket (journalisés en base).
// Compteur du rail : nombre de groupes « Nouvelle » (setCount('erreurs', n)).
// Dépendances : core.js (sb, toast, errMsg, esc), admin/shell.js (setCount), admin/ui/time.js (relTime).
// Exporte : mountErrorsSection (montage), countNewErrors (compteur au démarrage du panel).
// =====================================================================
import { sb, toast, errMsg, esc } from './core.js';
import { setCount } from './admin/shell.js';
import { relTime } from './admin/ui/time.js';

/** Statuts : libellé et ton de pastille (ui-pill). */
const STATUS = {
  nouvelle: { label: 'Nouvelle', tone: 'open' },
  connue: { label: 'Connue', tone: 'prog' },
  corrigee: { label: 'Corrigée', tone: 'done' },
};
const FILTERS = [['nouvelle', 'Nouvelles'], ['connue', 'Connues'], ['corrigee', 'Corrigées'], ['all', 'Toutes']];
// Groupes affichés dans le tableau (les plus récents d'abord) : au-delà, « Afficher plus ».
const PAGE = 12;

// État de la section
const E = { root: null, rows: [], filter: 'nouvelle', sel: null, shown: PAGE, error: null };

const nf = new Intl.NumberFormat('fr-CH');
const dateFmt = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'short', timeZone: 'Europe/Zurich' });
/** Jour AAAA-MM-JJ à Zurich (clés de « days »). */
const dayKey = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(d);

/** Nombre de groupes « Nouvelle » (compteur du rail), sans charger le reste. Silencieux en cas d'erreur. */
export async function countNewErrors() {
  try {
    const { count, error } = await sb.from('hg_client_errors').select('id', { count: 'exact', head: true }).eq('status', 'nouvelle');
    if (error) throw error;
    setCount('erreurs', count || 0);
  } catch (e) { console.warn('[erreurs]', e?.message || e); }
}

/** Charge tous les groupes (les plus récents d'abord), met à jour le compteur et redessine. */
async function load() {
  try {
    const { data, error } = await sb.from('hg_client_errors').select('*').order('last_seen', { ascending: false }).limit(300);
    if (error) throw error;
    E.rows = data ?? [];
    E.error = null;
  } catch (e) { E.error = errMsg(e); }
  setCount('erreurs', E.rows.filter((r) => r.status === 'nouvelle').length);
  if (!E.sel || !E.rows.some((r) => r.id === E.sel)) E.sel = shownRows()[0]?.id ?? null;
  render();
}

/** Groupes du filtre courant. */
const shownRows = () => (E.filter === 'all' ? E.rows : E.rows.filter((r) => r.status === E.filter));
/** Pastille de statut. */
const pill = (s) => `<span class="ui-pill" data-tone="${STATUS[s]?.tone || 'open'}">${esc(STATUS[s]?.label || s)}</span>`;
/** « fichier:ligne ». */
const where = (r) => `${r.file}${r.line != null ? `:${r.line}` : ''}`;
/** Moment de la dernière occurrence, court (« 2 h », « Hier », « 12 oct. »). */
const lastSeen = (iso) => relTime(iso);

/** Tableau des groupes du filtre courant. */
function tableHtml(rows) {
  if (!rows.length) return `<p class="detail-empty">${E.filter === 'nouvelle' ? 'Aucune nouvelle erreur : tout va bien.' : 'Aucune erreur dans cette catégorie.'}</p>`;
  const list = rows.slice(0, E.shown);
  return `<table class="er-tbl">
    <caption class="visually-hidden">Groupes d’erreurs</caption>
    <thead><tr><th scope="col">Erreur</th><th scope="col" class="er-n">Fois</th><th scope="col" class="er-last">Dernière</th><th scope="col">Statut</th></tr></thead>
    <tbody>${list.map((r) => `<tr class="${r.id === E.sel ? 'is-sel' : ''}">
      <td><button type="button" class="er-pick" data-er-pick="${r.id}" aria-pressed="${r.id === E.sel}">
        <span class="er-msg code">${esc(r.message)}</span><span class="er-file code small muted">${esc(where(r))}</span></button></td>
      <td class="er-n"><strong>${nf.format(r.count)}</strong></td>
      <td class="er-last small muted"><time datetime="${esc(r.last_seen)}">${esc(lastSeen(r.last_seen))}</time></td>
      <td>${pill(r.status)}</td></tr>`).join('')}</tbody></table>
    ${rows.length > E.shown ? `<div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" data-er-more>Afficher plus (${rows.length - E.shown})</button></div>` : ''}`;
}

/** Détail d'un groupe : message, pages, navigateurs, 7 derniers jours, actions. */
function detailHtml(r) {
  if (!r) return '<p class="detail-empty">Choisis une erreur dans le tableau.</p>';
  const browsers = Object.entries(r.browsers || {}).sort((a, b) => b[1] - a[1]);
  const top = Math.max(1, ...browsers.map(([, n]) => n));
  const days = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5); return { d, n: Number(r.days?.[dayKey(d)] || 0) }; });
  const dmax = Math.max(1, ...days.map((x) => x.n));
  const actions = [];
  actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-er-ticket>${r.support_id ? 'Voir la demande' : 'Créer une demande'}</button>`);
  const st = [];
  if (r.status !== 'nouvelle') st.push('<button type="button" class="btn btn-ghost btn-sm" data-er-status="nouvelle">Nouvelle</button>');
  if (r.status !== 'connue') st.push('<button type="button" class="btn btn-ghost btn-sm" data-er-status="connue">Connue</button>');
  if (r.status !== 'corrigee') st.push('<button type="button" class="btn btn-sand btn-sm" data-er-status="corrigee">Corrigée</button>');
  return `<div class="er-dhead">${pill(r.status)}<span class="small muted">vue la 1re fois le ${esc(dateFmt.format(new Date(r.first_seen)))}${r.last_version ? ` · version ${esc(r.last_version)}` : ''}</span></div>
    <pre class="er-box code">${esc(r.message)}\n<span class="muted">à ${esc(where(r))}${r.col != null ? `:${r.col}` : ''}</span></pre>
    <p class="small muted">${nf.format(r.count)} fois · dernière : ${esc(relTime(r.last_seen))}${r.fixed_version ? ` · corrigée en ${esc(r.fixed_version)}` : ''}</p>
    <div><h4 class="er-lbl">Pages</h4><div class="er-pills">${(r.pages || []).map((p) => `<span class="pill code">${esc(p)}</span>`).join('') || '<span class="small muted">—</span>'}</div></div>
    <div><h4 class="er-lbl">Navigateurs</h4><ul class="er-bars">${browsers.map(([b, n]) => `<li><span>${esc(b)}</span>
      <span class="er-track" aria-hidden="true"><span style="width:${Math.round((100 * n) / top)}%"></span></span><strong>${nf.format(n)}</strong></li>`).join('')}</ul></div>
    <div><h4 class="er-lbl">7 derniers jours</h4><div class="er-days" role="img" aria-label="${esc(days.map((x) => `${dateFmt.format(x.d)} : ${x.n}`).join(', '))}">
      ${days.map((x) => `<span style="height:${Math.max(4, Math.round((100 * x.n) / dmax))}%" title="${esc(`${dateFmt.format(x.d)} : ${x.n}`)}"></span>`).join('')}</div></div>
    ${r.note ? `<p class="small"><strong>Note :</strong> ${esc(r.note)}</p>` : ''}
    <div class="er-actions">${actions.join('')}<span class="er-sp"></span>${st.join('')}</div>`;
}

/** Dessine la section entière. */
function render() {
  const root = E.root;
  if (!root) return;
  if (E.error) { root.innerHTML = `<p class="form-error" role="alert">Impossible de lire le journal : ${esc(E.error)}</p>`; return; }
  const rows = shownRows();
  const count = (s) => (s === 'all' ? E.rows.length : E.rows.filter((r) => r.status === s).length);
  root.innerHTML = `<p class="small muted">Erreurs JavaScript remontées par les navigateurs des membres, regroupées. Aucune donnée personnelle : ni compte, ni pseudo, ni contenu saisi.</p>
    <div class="ui-filters" role="group" aria-label="Filtrer les erreurs">${FILTERS.map(([id, l]) =>
      `<button type="button" class="ui-chip" data-er-filter="${id}" aria-pressed="${E.filter === id}">${esc(l)} <span class="ui-count">${count(id)}</span></button>`).join('')}</div>
    <div class="er-grid">
      <div class="card er-list">${tableHtml(rows)}</div>
      <div class="card er-detail" aria-live="polite">${detailHtml(E.rows.find((r) => r.id === E.sel && (E.filter === 'all' || r.status === E.filter)))}</div>
    </div>`;
}

/** Change le statut d'un groupe (RPC journalisée), puis recharge. */
async function setStatus(id, status) {
  try {
    const { error } = await sb.rpc('hg_client_error_set', { p_id: id, p_status: status, p_note: null });
    if (error) throw error;
    toast(`Erreur marquée « ${STATUS[status].label} »`, 'ok');
    await load();
  } catch (e) { toast(errMsg(e), 'error'); }
}

/** Crée (ou retrouve) la demande d'assistance du groupe, puis l'ouvre dans Communication › Assistance. */
async function ticket(id) {
  try {
    const { data, error } = await sb.rpc('hg_client_error_ticket', { p_id: id });
    if (error) throw error;
    const r = E.rows.find((x) => x.id === id);
    if (r && data) r.support_id = data;
    toast('Demande d’assistance prête', 'ok');
    if (data) location.hash = `#poste/assistance/${data}`;
  } catch (e) { toast(errMsg(e), 'error'); }
}

/** Clics délégués : filtre, choix d'un groupe, « Afficher plus », statut, demande. */
function onClick(e) {
  const b = e.target.closest('button');
  if (!b || !E.root.contains(b)) return;
  if (b.dataset.erFilter) { E.filter = b.dataset.erFilter; E.shown = PAGE; E.sel = shownRows()[0]?.id ?? null; render(); return; }
  if (b.dataset.erPick) { E.sel = Number(b.dataset.erPick); render(); E.root.querySelector(`[data-er-pick="${E.sel}"]`)?.focus(); return; }
  if (b.hasAttribute('data-er-more')) { E.shown += PAGE; render(); return; }
  if (b.dataset.erStatus && E.sel != null) { setStatus(E.sel, b.dataset.erStatus); return; }
  if (b.hasAttribute('data-er-ticket') && E.sel != null) ticket(E.sel);
}

/** Point d'entrée (admin.js, première visite de Site › Erreurs du site). */
export async function mountErrorsSection(root) {
  if (!root) return;
  E.root = root;
  root.addEventListener('click', onClick);
  root.innerHTML = '<div class="empty">Chargement des erreurs…</div>';
  await load();
}
