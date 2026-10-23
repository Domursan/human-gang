// =====================================================================
// Cartes admin : onglet « Échanges » (offres en cours et annulation).
// Une offre en cours a le statut 'proposee'. L'admin peut seulement l'annuler (la fonction hg_trade_cancel).
// Dépendances : core.js (sb, toast, esc), ui-confirm.js (confirmBox), state.js (C), data.js (refresh), helpers.js.
// Exporte : tradesPanel (HTML de l'onglet), cancelTrade (annulation).
// =====================================================================
import { sb, toast, esc } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { C } from './state.js';
import { refresh } from './data.js';
import { act, check, fmtWhen, nf, pseudo } from './helpers.js';

/* =========================================================
   Échanges en cours
   ========================================================= */
/** HTML de l'onglet Échanges : la liste des offres en attente, avec un bouton pour annuler chacune. */
export function tradesPanel() {
  const open = C.trades.filter((t) => t.status === 'proposee').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const concluded = C.trades.filter((t) => t.status === 'acceptee').length;
  /* Nombre de cartes d'une offre d'un côté donné (from = offert, to = demandé). */
  const count = (id, side) => C.items.filter((i) => i.trade_id === id && i.side === side).length;
  return `<p class="small muted">${nf(open.length)} offre${open.length > 1 ? 's' : ''} en attente de réponse · ${nf(concluded)} échange${concluded > 1 ? 's' : ''} conclu${concluded > 1 ? 's' : ''}.</p>
    ${open.length ? `<ul class="acd-list">${open.map((t) => `<li class="acd-item">
      <div class="acd-item-main">
        <p><strong>${esc(pseudo(t.from_user))}</strong> → <strong>${esc(pseudo(t.to_user))}</strong></p>
        <p class="small muted">Offre du ${esc(fmtWhen(t.created_at))} · ${nf(count(t.id, 'from'))} carte(s) offerte(s) contre ${nf(count(t.id, 'to'))} demandée(s)${t.from_paillettes || t.to_paillettes ? ` · ${nf(t.from_paillettes)} ✦ et ${nf(t.to_paillettes)} ✦` : ''}</p>
        ${t.message ? `<p class="small acd-msg">« ${esc(t.message)} »</p>` : ''}
      </div>
      <div class="btn-row"><button class="btn btn-danger btn-sm" type="button" data-act="trade-cancel" data-id="${esc(t.id)}">Annuler l'offre</button></div>
    </li>`).join('')}</ul>` : '<div class="empty">Aucun échange en cours.</div>'}
    <section class="stack acd-brd" id="acd-brd-notes" aria-labelledby="acd-brd-h"></section>`;
}

/* =========================================================
   Tableau « Je cherche / Je donne » (idée C12) : modération des petits mots
   ========================================================= */
/** Charge les petits mots publics du tableau (hg_trade_board) et les affiche avec « Effacer ». Sans la fonction : rien. */
export async function loadBoardNotes() {
  const el = C.panel?.querySelector('#acd-brd-notes');
  if (!el) return;
  const { data, error } = await sb.rpc('hg_trade_board', { p_offset: 0 });
  if (error || !el.isConnected) return;
  const notes = (data?.notes || []).filter((n) => n.note);
  el.innerHTML = `<h3 id="acd-brd-h">Petits mots du tableau</h3>
    ${notes.length ? `<ul class="acd-list">${notes.map((n) => `<li class="acd-item acd-item-tight"><div class="acd-item-main"><p><strong>${esc(n.pseudo)}</strong> : « ${esc(n.note)} »</p></div>
      <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-act="board-note-clear" data-id="${esc(n.id)}">Effacer</button></div></li>`).join('')}</ul>`
      : '<p class="small muted">Aucun petit mot sur le tableau.</p>'}`;
}
/**
 * Efface le petit mot d'un membre (journal admin).
 * @param {HTMLButtonElement} btn bouton « Effacer »
 * @param {string} id membre
 */
export async function clearBoardNote(btn, id) {
  const ok = await confirmBox('Effacer ce petit mot ?', 'Le membre reste inscrit sur le tableau ; seul son texte disparaît.', { ok: 'Effacer', danger: true });
  if (!ok) return;
  await act(btn, async () => { check(await sb.rpc('hg_trade_board_note_clear', { p_user: id })); toast('Petit mot effacé', 'ok'); await loadBoardNotes(); });
}
/**
 * Annule une offre après confirmation. La base libère les cartes bloquées pour cette offre.
 * @param {HTMLButtonElement} btn bouton « Annuler l'offre ».
 * @param {string} id identifiant de l'offre.
 */
export async function cancelTrade(btn, id) {
  const ok = await confirmBox('Annuler cette offre ?', 'Les cartes bloquées pour cette offre seront à nouveau disponibles pour leurs propriétaires.', { ok: 'Annuler l\'offre', danger: true });
  if (!ok) return;
  await act(btn, async () => {
    check(await sb.rpc('hg_trade_cancel', { p_trade: id }));
    toast('Offre annulée', 'ok');
    await refresh();
  });
}
