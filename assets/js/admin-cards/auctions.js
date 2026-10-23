// =====================================================================
// Cartes admin : onglet « Enchères » (idée C11, migration 081).
// Planifier l'enchère d'une carte unique (par défaut du vendredi 18 h au dimanche 18 h, mise 500 ✦, pas 50 ✦),
// annuler une enchère prévue ou ouverte (la meilleure offre est remboursée), historique des 50 dernières.
// Le serveur refuse une carte non unique, déjà attribuée, qui représente un membre, ou déjà aux enchères.
// RPC : hg_auctions_admin, hg_auction_create, hg_auction_cancel (Staff « cartes », journal admin).
// Exporte : mountAuctionsTab(el), nextWeekend(now). Les cartes viennent de C (state.js).
// =====================================================================
import { sb, toast, esc, errMsg } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { C } from './state.js';
import { act, check, fmtWhen, nf } from './helpers.js';

const X = { el: null, list: null, err: '' };
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
        <div class="field"><label for="au-min">Mise de départ (✦)</label><input id="au-min" name="min_bid" type="number" min="1" max="100000" value="500" inputmode="numeric"></div>
        <div class="field"><label for="au-step">Pas minimal (✦)</label><input id="au-step" name="step" type="number" min="1" max="10000" value="50" inputmode="numeric"></div>
      </div>
      <p class="small muted">Une offre dans les 5 dernières minutes prolonge de 5 minutes (une heure au plus). Plafond d’un membre : la moitié de son solde du lundi ; le gagnant de la dernière enchère ne peut pas enchérir.</p>
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
      ${a.status === 'prevue' || a.status === 'ouverte' ? `<div class="btn-row"><button class="btn btn-danger btn-sm" type="button" data-au="cancel" data-id="${esc(a.id)}">Annuler</button></div>` : ''}
    </li>`).join('')}</ul>`;
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
    if (e.target.id !== 'acd-auc-form') return;
    e.preventDefault();
    const f = new FormData(e.target);
    const p = { card_id: f.get('card_id'), starts_at: new Date(f.get('starts_at')).toISOString(), ends_at: new Date(f.get('ends_at')).toISOString(),
      min_bid: Number(f.get('min_bid')), step: Number(f.get('step')) };
    await act(e.submitter, async () => { check(await sb.rpc('hg_auction_create', { p })); toast('Enchère planifiée', 'ok'); await load(); });
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-au="cancel"]');
    if (!b) return;
    if (!(await confirmBox('Annuler cette enchère ?', 'La meilleure offre est remboursée. La carte reste en réserve.', { ok: 'Annuler l’enchère', danger: true }))) return;
    await act(b, async () => { check(await sb.rpc('hg_auction_cancel', { p_id: b.dataset.id })); toast('Enchère annulée', 'ok'); await load(); });
  });
  load();
}
