// ===== Humane Gang — administration : fil d'activité de l'accueil (modération) =====
/*
 * Rôle : Communication › Fil d'activité. Liste les 200 dernières entrées de hg_activity (le fil affiché sur l'accueil),
 * avec recherche, filtre par type et suppression d'une entrée après confirmation.
 * Droits : lecture pour tout membre ; suppression permise à l'admin et au Staff « reglages » (RLS hg_activity_admin,
 * migration 027 : hg_has_perm('reglages')). Aucune autre écriture.
 * Route : #communication/fil (branchée par admin.js). Section : <section id="fil">, conteneur #fil-root.
 * Dépendances : core.js (sb, toast, errMsg, esc), ui-confirm.js (confirmation), admin/list-tools.js (recherche, compteur),
 * icons.js (icône corbeille).
 * Tables et RPC : hg_activity, hg_staff_directory (pseudos).
 * Exporte : mountFilSection, FIL_KINDS.
 */
import { sb, toast, errMsg, esc } from './core.js';
import { svg } from './icons.js';
import { confirmBox } from './ui-confirm.js';
import { matches, searchHtml, bindSearch, setCount, emptyHtml, moreHtml } from './admin/list-tools.js';

/* ---------- Constantes ---------- */

/** Entrées lues (les plus récentes). */
const LIMIT = 200;
/** Entrées affichées par lot (« Afficher plus ») : la section reste courte. */
const LOT = 20;
/** Libellé de chaque type d'entrée connu (colonne kind) ; un type inconnu s'affiche tel quel. */
export const FIL_KINDS = Object.freeze({
  join: 'Arrivée',
  badge: 'Badge',
  cartes: 'Cartes',
  ss_draw: 'Secret Santa',
  secret: 'Secret',
});
/** Dates : heure suisse. */
const dtFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDt = (d) => (d ? dtFmt.format(new Date(d)) : '');
/** Libellé d'un type. */
const kindLabel = (k) => FIL_KINDS[k] || k || 'Autre';
/** Icône corbeille des boutons « Supprimer ». */
const TRASH = svg('trash', { stroke: 2 });

/* ---------- État de la section ---------- */
// rows : entrées chargées ; pseudo : id -> pseudo ; query : recherche ; kind : filtre de type ('' = tous).
const F = { root: null, rows: [], pseudo: new Map(), query: '', kind: '', error: null, busy: new Set(), shown: LOT };

/* ---------- Montage et chargement ---------- */

/**
 * Monte la section dans son conteneur et charge le fil.
 * @param {HTMLElement} root Conteneur (#fil-root).
 * @returns {Promise<void>}
 */
export async function mountFilSection(root) {
  if (!root) return;
  F.root = root;
  root.innerHTML = `<div class="afl">
    <div class="afl-head">
      <p class="small muted">Le fil « Ça bouge dans le gang » de l’accueil. Supprime une entrée gênante ou erronée : elle disparaît pour tout le monde. Les entrées sont créées automatiquement par le site ; rien ne s’ajoute d’ici.</p>
      <button class="btn btn-ghost" type="button" data-afl="reload">Actualiser</button>
    </div>
    <div class="afl-tools">
      ${searchHtml({ id: 'afl-search', label: 'Rechercher dans le fil', placeholder: 'Texte, membre ou type…', value: F.query })}
      <div class="field afl-kind">
        <label for="afl-kind">Type</label>
        <select id="afl-kind"><option value="">Tous les types</option></select>
      </div>
    </div>
    <div id="afl-list" aria-live="polite"><div class="empty">Chargement du fil…</div></div>
  </div>`;
  bindSearch(root.querySelector('#afl-search'), (q) => { F.query = q; F.shown = LOT; renderList(); });
  root.querySelector('#afl-kind').addEventListener('change', (e) => { F.kind = e.target.value; F.shown = LOT; renderList(); });
  root.addEventListener('click', onClick);
  await reload();
}

/** Recharge les entrées et les pseudos, puis dessine la liste. */
async function reload() {
  try {
    const [act, dir] = await Promise.all([
      sb.from('hg_activity').select('id, user_id, kind, text, created_at').order('created_at', { ascending: false }).limit(LIMIT),
      sb.rpc('hg_staff_directory'),
    ]);
    if (act.error) throw act.error;
    F.rows = (act.data ?? []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    F.pseudo = new Map((dir.data ?? []).map((r) => [r.id, r.pseudo]));
    F.error = null;
  } catch (e) {
    F.rows = [];
    F.error = errMsg(e);
  }
  renderKinds();
  renderList();
}

/* ---------- Affichage ---------- */

/** Auteur d'une entrée : pseudo, « Le site » (entrée automatique sans membre) ou « Ancien membre ». */
const authorOf = (r) => (r.user_id ? F.pseudo.get(r.user_id) || 'Ancien membre' : 'Le site');

/** Options du filtre de type, d'après les types présents. */
function renderKinds() {
  const sel = F.root.querySelector('#afl-kind');
  const kinds = [...new Set(F.rows.map((r) => r.kind))].sort((a, b) => kindLabel(a).localeCompare(kindLabel(b), 'fr'));
  if (F.kind && !kinds.includes(F.kind)) F.kind = '';
  sel.innerHTML = `<option value="">Tous les types</option>${kinds.map((k) => `<option value="${esc(k)}"${k === F.kind ? ' selected' : ''}>${esc(kindLabel(k))} (${F.rows.filter((r) => r.kind === k).length})</option>`).join('')}`;
}

/** Dessine la liste filtrée. */
function renderList() {
  const box = F.root.querySelector('#afl-list');
  if (F.error) {
    box.innerHTML = `<div class="empty">Impossible de lire le fil : ${esc(F.error)}</div>`;
    setCount(F.root.querySelector('#afl-search-count'), 0, 0, '', ['entrée', 'entrées']);
    return;
  }
  const shown = F.rows.filter((r) => (!F.kind || r.kind === F.kind) && matches(F.query, r.text, authorOf(r), kindLabel(r.kind)));
  const filtered = F.kind ? F.rows.filter((r) => r.kind === F.kind).length : F.rows.length;
  setCount(F.root.querySelector('#afl-search-count'), shown.length, filtered, F.query, ['entrée', 'entrées']);
  if (!shown.length) { box.innerHTML = emptyHtml(F.query, F.rows.length ? 'Aucune entrée de ce type.' : 'Le fil est vide.'); return; }
  box.innerHTML = `<ul class="afl-list">${shown.slice(0, F.shown).map((r) => `<li class="afl-row" data-id="${esc(String(r.id))}">
      <div class="afl-meta">
        <span class="afl-kind-pill" data-kind="${esc(r.kind)}">${esc(kindLabel(r.kind))}</span>
        <span class="small muted">${esc(authorOf(r))} · <time datetime="${esc(r.created_at || '')}">${esc(fmtDt(r.created_at))}</time></span>
      </div>
      <p class="afl-text">${esc(r.text)}</p>
      <button class="btn btn-danger afl-del" type="button" data-afl="del" data-id="${esc(String(r.id))}"
        aria-label="Supprimer l’entrée « ${esc(String(r.text).slice(0, 60))} »"${F.busy.has(String(r.id)) ? ' disabled aria-busy="true"' : ''}>${TRASH}<span>Supprimer</span></button>
    </li>`).join('')}</ul>
    ${moreHtml('afl-more', Math.min(F.shown, shown.length), shown.length, 'data-afl="more"')}
    ${F.rows.length >= LIMIT ? `<p class="small muted afl-limit">Seules les ${LIMIT} entrées les plus récentes sont affichées.</p>` : ''}`;
}

/* ---------- Événements ---------- */

/** Actualiser, supprimer (après confirmation). */
async function onClick(ev) {
  const b = ev.target.closest('[data-afl]');
  if (!b || !F.root.contains(b)) return;
  if (b.dataset.afl === 'reload') { await reload(); return; }
  if (b.dataset.afl === 'more') {
    const first = F.shown;
    F.shown += LOT;
    renderList();
    F.root.querySelectorAll('.afl-row')[first]?.querySelector('.afl-del')?.focus();
    return;
  }
  if (b.dataset.afl !== 'del') return;
  const id = b.dataset.id;
  const row = F.rows.find((r) => String(r.id) === id);
  if (!row || F.busy.has(id)) return;
  const ok = await confirmBox('Supprimer cette entrée du fil ?',
    `« ${row.text} » (${authorOf(row)}, ${fmtDt(row.created_at)}). Elle disparaît de l’accueil pour tout le monde.`,
    { ok: 'Supprimer', danger: true });
  if (!ok) { b.focus(); return; }
  F.busy.add(id);
  renderList();
  try {
    const { error } = await sb.from('hg_activity').delete().eq('id', row.id);
    if (error) throw error;
    F.rows = F.rows.filter((r) => String(r.id) !== id);
    toast('Entrée supprimée du fil');
    renderKinds();
  } catch (e) {
    toast(`Suppression impossible : ${errMsg(e)}`, 'error');
  } finally {
    F.busy.delete(id);
    renderList();
    F.root.querySelector('#afl-search')?.focus({ preventScroll: true });
  }
}
