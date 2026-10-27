// =====================================================================
// Cartes admin : onglet « Enchères » (idée C11, migration 081).
// Planifier l'enchère d'une carte unique (par défaut du vendredi 18 h au dimanche 18 h, mise 500 ✦, pas 50 ✦),
// annuler une enchère prévue ou ouverte (la meilleure offre est remboursée), historique des 50 dernières.
// Le serveur refuse une carte non unique, déjà attribuée, qui représente un membre, ou déjà aux enchères.
// Règles réglables par enchère (migration 097) : à la création et ensuite (« Modifier les règles »), via enchere-regles.js.
// RPC : hg_auctions_admin, hg_auction_create, hg_auction_update, hg_auction_cancel (Staff « cartes », journal admin).
// Exporte : mountAuctionsTab(el), nextWeekend(now). Les cartes viennent de C (state.js).
// =====================================================================
import { sb, toast, esc, errMsg } from '../../../commun/core.js';
import { confirmBox } from '../../../commun/ui-confirm.js';
import { C } from './state.js';
import { act, check, fmtWhen, nf } from './helpers.js';
import { rulesFieldsHtml, readRules, rulesSummary } from '../../cartes/enchere-regles.js';

const X = { el: null, list: null, err: '', edit: null };
const STATUS = { prevue: 'Prévue', ouverte: 'Ouverte', close: 'Terminée', annulee: 'Annulée' };
/** Valeur d'un champ datetime-local (heure locale). */
const toLocal = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
/**
 * Prochain week-end d'enchère : vendredi 18 h → dimanche 18 h (heure locale du navigateur).
 * @param {Date} [now]
 * @returns {{start: Date, end: Date}}
 */
export function nextWeekend(now = new Date()) {
  const start = new Date(now);
  start.setHours(18, 0, 0, 0);
  start.setDate(start.getDate() + ((5 - start.getDay() + 7) % 7));
  if (start <= now) start.setDate(start.getDate() + 7);
  const end = new Date(start); end.setDate(end.getDate() + 2);
  return { start, end };
}

function formHtml() {
  const taken = new Set((X.list || []).filter((a) => a.status === 'prevue' || a.status === 'ouverte').map((a) => a.card_id));
  const cards = C.cards.filter((k) => k.rarity === 'unique' && !k.member_id && k.family !== 'membre' && !(C.copiesByCard.get(k.id) || []).length && !taken.has(k.id));
  const { start, end } = nextWeekend();
  return `<form class="card stack" id="acd-auc-form" novalidate>
      <h3 class="card-title">Nouvelle enchère</h3>
      <p class="small muted">Une carte unique pas encore attribuée, jamais une carte qui représente un membre. Les Paillettes du gagnant sont détruites.</p>
      ${cards.length ? `<div class="acd-grid-2">
        <div class="field"><label for="au-card">Carte unique</label><select id="au-card" name="card_id">${cards.map((k) => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="au-start">Début</label><input id="au-start" name="starts_at" type="datetime-local" value="${toLocal(start)}"></div>
        <div class="field"><label for="au-end">Fin</label><input id="au-end" name="ends_at" type="datetime-local" value="${toLocal(end)}"></div>
      </div>
      ${rulesFieldsHtml('au-new')}
      <div class="btn-row"><button class="btn btn-primary" type="submit">Planifier l’enchère</button></div>`
      : '<p class="empty">Aucune carte unique disponible : crée une carte de rareté « Unique » (Catalogue › Cartes).</p>'}
    </form>`;
}

function listHtml() {
  if (X.err) return `<p class="empty">${esc(X.err)}</p>`;
  if (!X.list) return '<p class="empty">Chargement…</p>';
  if (!X.list.length) return '<p class="empty">Aucune enchère pour le moment.</p>';
  return `<ul class="acd-list">${X.list.map((a) => `<li class="acd-item">
      <div class="acd-item-main">
        <p><strong>${esc(a.card_name)}</strong> <span class="pill">${esc(STATUS[a.status] || a.status)}</span></p>
        <p class="small muted">${esc(fmtWhen(a.starts_at))} → ${esc(fmtWhen(a.ends_at))} · mise ${nf(a.min_bid)} ✦, pas ${nf(a.step)} ✦ · ${nf(a.bids)} offre${a.bids > 1 ? 's' : ''}</p>
        <p class="small">${a.status === 'close' ? (a.winner ? `Remportée par ${esc(a.winner)} pour ${nf(a.price)} ✦` : 'Sans offre : carte en réserve')
          : a.top ? `Meilleure offre : ${nf(a.top)} ✦ (${esc(a.top_pseudo || 'membre')})` : 'Pas encore d’offre'}</p>
      </div>
      ${a.status === 'prevue' || a.status === 'ouverte' ? `<div class="btn-row">
        <button class="btn btn-ghost btn-sm" type="button" data-au="edit" data-id="${esc(a.id)}" aria-expanded="${X.edit === a.id}">${X.edit === a.id ? 'Fermer' : 'Modifier les règles'}</button>
        <button class="btn btn-danger btn-sm" type="button" data-au="cancel" data-id="${esc(a.id)}">Annuler</button></div>` : ''}
      ${X.edit === a.id ? editHtml(a) : a.rules ? `<ul class="small muted enr-sum">${rulesSummary(a.rules).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </li>`).join('')}</ul>`;
}

/** Formulaire de modification d'une enchère prévue ou ouverte (dates et règles). */
function editHtml(a) {
  const id = `au-e-${a.id.slice(0, 8)}`;
  return `<form class="card stack enr-edit" data-au-form="edit" data-id="${esc(a.id)}" novalidate>
      <div class="acd-grid-2">
        <div class="field"><label for="${id}-start">Début</label><input id="${id}-start" name="starts_at" type="datetime-local" value="${toLocal(a.starts_at)}"${a.started ? ' readonly aria-describedby="' + id + '-sh"' : ''}>
          ${a.started ? `<p class="small muted" id="${id}-sh">Déjà ouverte : le début ne change plus.</p>` : ''}</div>
        <div class="field"><label for="${id}-end">Fin</label><input id="${id}-end" name="ends_at" type="datetime-local" value="${toLocal(a.ends_at)}"></div>
      </div>
      ${rulesFieldsHtml(id, a.rules || {}, { lockMin: a.bids > 0 })}
      <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer les règles</button></div>
    </form>`;
}

function render() {
  if (!X.el) return;
  X.el.innerHTML = `<div class="stack">${formHtml()}<section class="stack"><h3>Enchères</h3>${listHtml()}</section></div>`;
}

async function load() {
  try { X.list = check(await sb.rpc('hg_auctions_admin')) || []; X.err = ''; }
  catch (e) { X.err = `Enchères indisponibles : ${errMsg(e)}`; X.list = []; }
  render();
}

/**
 * Monte l'onglet « Enchères » dans el.
 * @param {HTMLElement} el conteneur
 */
export function mountAuctionsTab(el) {
  if (!el) return;
  X.el = el;
  render();
  el.addEventListener('submit', async (e) => {
    if (e.target.dataset.auForm === 'edit') {
      e.preventDefault();
      const f = new FormData(e.target);
      const p = { ...readRules(e.target), starts_at: new Date(f.get('starts_at')).toISOString(), ends_at: new Date(f.get('ends_at')).toISOString() };
      await act(e.submitter, async () => { check(await sb.rpc('hg_auction_update', { p_id: e.target.dataset.id, p })); toast('Règles enregistrées', 'ok'); X.edit = null; await load(); });
      return;
    }
    if (e.target.id !== 'acd-auc-form') return;
    e.preventDefault();
    const f = new FormData(e.target);
    const p = { ...readRules(e.target), card_id: f.get('card_id'), starts_at: new Date(f.get('starts_at')).toISOString(), ends_at: new Date(f.get('ends_at')).toISOString() };
    await act(e.submitter, async () => { check(await sb.rpc('hg_auction_create', { p })); toast('Enchère planifiée', 'ok'); await load(); });
  });
  el.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-au="edit"]');
    if (ed) { X.edit = X.edit === ed.dataset.id ? null : ed.dataset.id; render(); X.el.querySelector(`[data-au="edit"][data-id="${ed.dataset.id}"]`)?.focus(); return; }
    const b = e.target.closest('[data-au="cancel"]');
    if (!b) return;
    if (!(await confirmBox('Annuler cette enchère ?', 'La meilleure offre est remboursée. La carte reste en réserve.', { ok: 'Annuler l’enchère', danger: true }))) return;
    await act(b, async () => { check(await sb.rpc('hg_auction_cancel', { p_id: b.dataset.id })); toast('Enchère annulée', 'ok'); await load(); });
  });
  load();
}
