// Cartes admin : onglet « Joueurs » (portefeuille, exemplaires, journal, Paillettes, dons de cartes).
import { sb, toast, errMsg, esc, $, avatarHtml } from '../core.js';
import { rarityLabel, serialLabel, fmtP } from '../cartes-ui.js';
import { confirmBox } from '../ui-confirm.js';
import { ICON, REASON_LABEL } from './constants.js';
import { C } from './state.js';
import { refresh } from './data.js';
import { check, act, nf, tile, pseudo, fmtWhen } from './helpers.js';

/* =========================================================
   Joueurs
   ========================================================= */
const REASON = (r) => REASON_LABEL[r] || r;
export function playersPanel() {
  if (!C.profiles.length) return '<div class="empty">Aucun membre.</div>';
  const uid = C.byId.has(C.playerId) ? C.playerId : C.profiles[0].id;
  C.playerId = uid;
  const p = C.byId.get(uid);
  const w = C.walletById.get(uid) || { paillettes: 0, boosters_opened: 0, pity_epique: 0 };
  const copies = (C.copiesByOwner.get(uid) || []).slice().sort((a, b) => (C.cardById.get(a.card_id)?.number ?? 0) - (C.cardById.get(b.card_id)?.number ?? 0));
  const cardOptions = C.sets.map((s) => {
    const list = C.cards.filter((k) => k.set_id === s.id && k.active).sort((a, b) => a.number - b.number);
    return list.length ? `<optgroup label="${esc(s.name)}">${list.map((k) => `<option value="${esc(k.id)}">#${esc(k.number)} · ${esc(k.name)} (${esc(rarityLabel(k.rarity))})</option>`).join('')}</optgroup>` : '';
  }).join('');
  const copyRows = copies.map((x) => {
    const k = C.cardById.get(x.card_id);
    if (!k) return '';
    const meta = [x.shiny ? 'Brillante' : '', x.serial ? serialLabel(x.serial, k.max_copies) : '', x.locked_trade ? 'En échange' : ''].filter(Boolean).join(' · ');
    return `<li class="acd-item acd-item-tight">
      <div class="acd-item-main"><p><strong>${esc(k.name)}</strong> <span class="small muted">${esc(rarityLabel(k.rarity))}</span></p>
        <p class="small muted">${esc(meta || 'Exemplaire standard')} · ${esc(x.source)}</p></div>
      <button class="btn btn-danger btn-sm" type="button" data-act="copy-take" data-id="${esc(x.id)}">${ICON.trash} Retirer</button>
    </li>`;
  }).join('');
  return `
    <div class="acd-toolbar"><div class="field acd-field-wide"><label for="acd-pl-member">Membre</label>
      <select id="acd-pl-member">${C.profiles.map((m) => `<option value="${esc(m.id)}"${m.id === uid ? ' selected' : ''}>${esc(m.pseudo)}${m.is_ghost ? ' (fantôme)' : ''}</option>`).join('')}</select></div></div>
    <section class="card acd-player" aria-labelledby="acd-pl-h">
      <div class="acd-player-head">${avatarHtml(p, 48)}
        <div><h3 class="card-title" id="acd-pl-h">${esc(p.pseudo)}</h3>
        <p class="small muted">${nf(copies.length)} exemplaire${copies.length > 1 ? 's' : ''} · ${nf(w.boosters_opened)} booster${w.boosters_opened > 1 ? 's' : ''} ouvert${w.boosters_opened > 1 ? 's' : ''}</p></div>
      </div>
      <div class="acd-tiles">${tile(fmtP(w.paillettes), 'Paillettes')}${tile(nf(w.boosters_opened), 'Boosters ouverts')}${tile(nf(w.pity_epique), 'Boosters sans épique')}</div>
    </section>
    <div class="acd-grid-2 acd-pl-grid">
      <section class="card" aria-labelledby="acd-pay-h">
        <h3 class="card-title" id="acd-pay-h">Paillettes</h3>
        <form class="stack" id="acd-pl-pay" novalidate>
          <p class="form-error" role="alert" hidden></p>
          <div class="acd-grid-2">
            <div class="field"><label for="acd-pay-amount">Nombre de Paillettes</label><input id="acd-pay-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" required></div>
            <div class="field"><label for="acd-pay-reason">Motif <span class="muted small">(facultatif)</span></label><input id="acd-pay-reason" name="reason" maxlength="60" autocomplete="off" placeholder="ex. Gagnant du concours"></div>
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" type="submit" data-sign="1">Ajouter</button>
            <button class="btn btn-ghost" type="submit" data-sign="-1">Retirer</button>
          </div>
        </form>
      </section>
      <section class="card" aria-labelledby="acd-give-h">
        <h3 class="card-title" id="acd-give-h">Donner une carte</h3>
        <form class="stack" id="acd-pl-give" novalidate>
          <p class="form-error" role="alert" hidden></p>
          <div class="field"><label for="acd-give-card">Carte</label><select id="acd-give-card" name="card" required>${cardOptions || '<option value="">Aucune carte active</option>'}</select></div>
          <div class="acd-grid-2">
            <div class="field"><label for="acd-give-count">Nombre d'exemplaires</label><input id="acd-give-count" name="count" type="number" min="1" max="100" step="1" inputmode="numeric" value="1"></div>
            <label class="switch acd-switch"><input type="checkbox" name="shiny"><span class="switch-ui" aria-hidden="true"></span><span>Brillante</span></label>
          </div>
          <p class="small muted">Les cartes limitées reçoivent le prochain numéro disponible.</p>
          <div class="btn-row"><button class="btn btn-primary" type="submit">Donner</button></div>
        </form>
      </section>
    </div>
    <section class="card" aria-labelledby="acd-ex-h">
      <h3 class="card-title" id="acd-ex-h">Exemplaires <span class="muted">(${nf(copies.length)})</span></h3>
      ${copies.length ? `<ul class="acd-list acd-scroll-y">${copyRows}</ul>` : '<p class="small muted">Aucun exemplaire.</p>'}
    </section>
    <section class="card" aria-labelledby="acd-log-h">
      <h3 class="card-title" id="acd-log-h">Journal des Paillettes</h3>
      <div id="acd-pl-log"><p class="small muted">Chargement…</p></div>
    </section>`;
}
export async function refreshLog() {
  const box = $('#acd-pl-log', C.panel);
  if (!box) return;
  const uid = C.playerId;
  try {
    const rows = check(await sb.from('hg_wallet_log').select('delta, reason, ref, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(60)) ?? [];
    if (uid !== C.playerId) return;
    box.innerHTML = rows.length
      ? `<ul class="acd-list">${rows.map((r) => `<li class="acd-log-row">
          <span class="acd-log-delta ${r.delta < 0 ? 'is-neg' : 'is-pos'}">${r.delta > 0 ? '+' : ''}${esc(nf(r.delta))} ✦</span>
          <span>${esc(REASON(r.reason))}</span><span class="small muted">${esc(fmtWhen(r.created_at))}</span></li>`).join('')}</ul>`
      : '<p class="small muted">Aucun mouvement de Paillettes.</p>';
  } catch (e) { if (box.isConnected) box.innerHTML = `<p class="small muted">Journal indisponible : ${esc(errMsg(e))}</p>`; }
}
export async function adjustPaillettes(form, btn) {
  const err = $('.form-error', form);
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  showErr('');
  const n = Number(String(form.elements.amount.value).trim());
  if (!Number.isInteger(n) || n <= 0) return showErr('Indique un nombre entier de Paillettes (1 ou plus).');
  const sign = btn?.dataset.sign === '-1' ? -1 : 1;
  const reason = String(form.elements.reason.value).trim() || 'admin';
  const uid = C.playerId;
  if (btn) btn.disabled = true;
  try {
    const bal = check(await sb.rpc('hg_cards_admin_paillettes', { p_user: uid, p_delta: sign * n, p_reason: reason }));
    toast(`Solde de ${pseudo(uid)} : ${fmtP(bal)}`, 'ok');
    await refresh();
  } catch (e) { showErr(errMsg(e)); } finally { if (btn?.isConnected) btn.disabled = false; }
}
export async function giveCard(form, btn) {
  const err = $('.form-error', form);
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  showErr('');
  const cardId = form.elements.card.value;
  const count = Number(form.elements.count.value);
  if (!cardId) return showErr('Choisis une carte.');
  if (!Number.isInteger(count) || count < 1 || count > 100) return showErr('Nombre d\'exemplaires : entre 1 et 100.');
  const uid = C.playerId;
  if (btn) btn.disabled = true;
  try {
    check(await sb.rpc('hg_cards_admin_give', { p_user: uid, p_card: cardId, p_shiny: form.elements.shiny.checked, p_count: count }));
    toast(`${nf(count)} carte${count > 1 ? 's' : ''} donnée${count > 1 ? 's' : ''} à ${pseudo(uid)}`, 'ok');
    await refresh();
  } catch (e) { showErr(errMsg(e)); } finally { if (btn?.isConnected) btn.disabled = false; }
}
export async function takeCopy(btn, id) {
  const x = C.copies.find((c) => String(c.id) === id);
  const k = x && C.cardById.get(x.card_id);
  if (!x || !k) return;
  const ok = await confirmBox('Retirer cet exemplaire ?',
    `« ${k.name} »${x.serial ? ` ${serialLabel(x.serial, k.max_copies)}` : ''} sera retiré de la collection de ${pseudo(x.owner_id)}. Il n'est ni recyclé ni remboursé, et son numéro reste attribué.`,
    { ok: 'Retirer', danger: true });
  if (!ok) return;
  await act(btn, async () => {
    check(await sb.rpc('hg_cards_admin_take', { p_copy: Number(x.id) }));
    toast('Exemplaire retiré', 'ok');
    await refresh();
  });
}
