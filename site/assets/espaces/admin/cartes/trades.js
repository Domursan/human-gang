// =====================================================================
// Cartes admin : onglet « Échanges » (offres en cours et annulation).
// Une offre en cours a le statut 'proposee'. L'admin peut seulement l'annuler (la fonction hg_trade_cancel).
// Dépendances : core.js (sb, toast, esc), ui-confirm.js (confirmBox), state.js (C), data.js (refresh), helpers.js.
// Exporte : tradesPanel (HTML de l'onglet), cancelTrade (annulation), loadTradeLimits et saveTradeLimits (limites anti-abus,
// réglage hg_settings « echanges », enregistré par fusion).
// =====================================================================
import { sb, toast, esc, errMsg } from '../../../commun/core.js';
import { confirmBox } from '../../../commun/ui-confirm.js';
import { C } from './state.js';
import { refresh } from './data.js';
import { act, check, fmtWhen, nf, pseudo } from './helpers.js';
import { lireReglage, ecrireReglage } from '../reglages-merge.js';

/* =========================================================
   Limites anti-abus (réglage echanges)
   ========================================================= */
/* Champs de hg_settings.echanges : clé, libellé, aide, borne basse et haute. Valeurs par défaut = celles de la base. */
const ECHANGES_CHAMPS = [
  ['anciennete_jours', 'Âge minimal du compte (jours)', 'Pour offrir des cartes ou des boosters, et pour donner des Paillettes dans un échange. De 0 à 365 jours.', 0, 365, 7],
  ['paillettes_max_semaine', 'Paillettes reçues par échange, par semaine', 'Plafond des Paillettes qu’un membre peut recevoir grâce aux échanges, sur 7 jours (0 à 100 000).', 0, 100000, 5000],
  ['dons_valeur_max_semaine', 'Valeur des cadeaux reçus, par semaine', 'Plafond de la valeur des cartes et boosters offerts à un membre, sur 7 jours (0 à 100 000 Paillettes de valeur).', 0, 100000, 5000],
];

/**
 * Affiche le formulaire des limites, rempli avec le réglage echanges (valeur par défaut si une sous-clé manque).
 * Appelé à l'ouverture de l'onglet Échanges (le conteneur #acd-echanges-cfg est dans tradesPanel).
 */
export async function loadTradeLimits() {
  const el = C.panel?.querySelector('#acd-echanges-cfg');
  if (!el) return;
  let cur;
  try { cur = await lireReglage('echanges'); } catch (e) {
    if (el.isConnected) el.innerHTML = `<p class="small">Impossible de lire les limites : ${esc(errMsg(e))}</p>`;
    return;
  }
  if (!el.isConnected) return;
  el.innerHTML = `<form id="acd-echanges-form" class="stack acd-form" novalidate>
    <h3>Limites anti-abus</h3>
    <p class="small muted">Protègent la monnaie et les cadeaux entre membres. Enregistrées dans le réglage « echanges ».</p>
    <p class="form-error" role="alert" hidden></p>
    <div class="acd-grid-2">${ECHANGES_CHAMPS.map(([k, l, h, lo, hi, def]) => {
      const v = cur[k] == null || cur[k] === '' ? def : cur[k];
      return `<div class="field"><label for="ace-${k}">${esc(l)}</label>
        <input id="ace-${k}" name="${k}" type="number" min="${lo}" max="${hi}" step="1" inputmode="numeric" value="${esc(v)}" aria-describedby="ace-${k}-h">
        <span class="small muted" id="ace-${k}-h">${esc(h)}</span></div>`;
    }).join('')}</div>
    <div class="btn-row"><button class="btn btn-ghost" type="submit">Enregistrer les limites</button></div>
  </form>`;
}

/**
 * Enregistre les limites anti-abus par fusion dans hg_settings.echanges (les autres sous-clés sont gardées).
 * @param {HTMLFormElement} form formulaire des limites.
 * @param {HTMLElement|null} btn bouton d'envoi.
 */
export async function saveTradeLimits(form, btn) {
  const err = form.querySelector('.form-error');
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  err.hidden = true;
  const next = {};
  for (const [k, l, , lo, hi] of ECHANGES_CHAMPS) {
    const raw = form.elements[k].value.trim(), n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < lo || n > hi) return fail(`« ${l} » : nombre entier de ${lo} à ${hi}.`);
    next[k] = n;
  }
  await act(btn, async () => {
    await ecrireReglage('echanges', (e) => { Object.assign(e, next); });
    toast('Limites des échanges enregistrées.', 'ok');
    await loadTradeLimits();
  });
}

/* =========================================================
   Échanges en cours
   ========================================================= */
/** HTML de l'onglet Échanges : les limites anti-abus (formulaire rempli par loadTradeLimits), puis les offres en attente. */
export function tradesPanel() {
  const open = C.trades.filter((t) => t.status === 'proposee').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const concluded = C.trades.filter((t) => t.status === 'acceptee').length;
  /* Nombre de cartes d'une offre d'un côté donné (from = offert, to = demandé). */
  const count = (id, side) => C.items.filter((i) => i.trade_id === id && i.side === side).length;
  return `<section class="stack acd-brd" id="acd-echanges-cfg" aria-label="Limites anti-abus"></section>
    <p class="small muted">${nf(open.length)} offre${open.length > 1 ? 's' : ''} en attente de réponse · ${nf(concluded)} échange${concluded > 1 ? 's' : ''} conclu${concluded > 1 ? 's' : ''}.</p>
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
