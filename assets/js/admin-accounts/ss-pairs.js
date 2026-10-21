// Comptes admin : bloc « Attributions » de la section Secret Santa (affiché à la demande).
import { sb, esc, fmtDate, $ } from '../core.js';
import { IC, busy, check } from './common.js';
import { A, pseudoOf } from './state.js';
import { loadAccounts } from './list.js';
import { openAccount, renderPanel } from './fiche.js';

/** Bloc « Attributions » (masqué par défaut). À insérer dans la section Secret Santa une fois le tirage fait. */
export function pairsBlockHtml(edition) {
  if (!edition?.drawn_at) return '';
  return `
    <div class="card stack ss-pairs" id="ss-pairs" data-edition="${esc(edition.id)}">
      <h3 class="card-title">Attributions ${esc(edition.year)}</h3>
      <p class="small muted">Qui offre à qui. Masqué par défaut pour éviter de te gâcher la surprise. Pour modifier une attribution, ouvre la fiche du membre dans « Comptes ».</p>
      <div class="btn-row"><button class="btn btn-ghost" type="button" data-pairs="show" aria-expanded="false" aria-controls="ss-pairs-body">${IC.eye} Afficher les attributions</button></div>
      <div id="ss-pairs-body" hidden></div>
    </div>`;
}
export async function togglePairs(btn) {
  const box = btn.closest('#ss-pairs'), body = $('#ss-pairs-body', box);
  if (btn.dataset.pairs === 'hide') {
    body.hidden = true; body.innerHTML = '';
    btn.dataset.pairs = 'show'; btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `${IC.eye} Afficher les attributions`;
    return;
  }
  await busy(btn, async () => {
    const ed = box.dataset.edition;
    const [a, p] = await Promise.all([
      sb.from('hg_ss_assignments').select('giver_id, receiver_id').eq('edition_id', ed),
      sb.from('hg_ss_participants').select('user_id, sent_at, received_at').eq('edition_id', ed),
    ]);
    const rows = check(a) ?? [], parts = check(p) ?? [];
    if (!A.accounts.length) await loadAccounts().catch(() => {});
    const st = new Map(parts.map((x) => [x.user_id, x]));
    const givers = new Set(rows.map((r) => r.giver_id)), receivers = new Set(rows.map((r) => r.receiver_id));
    const noTarget = parts.filter((x) => !givers.has(x.user_id)).map((x) => pseudoOf(x.user_id));
    const noSanta = parts.filter((x) => !receivers.has(x.user_id)).map((x) => pseudoOf(x.user_id));
    const sorted = rows.slice().sort((x, y) => pseudoOf(x.giver_id).localeCompare(pseudoOf(y.giver_id), 'fr'));
    body.innerHTML = `
      ${sorted.length ? `<div class="pairs-table" role="table" aria-label="Attributions">
        <div class="pairs-tr pairs-th" role="row"><span role="columnheader">Santa</span><span role="columnheader"><span class="visually-hidden">offre à</span></span><span role="columnheader">Cible</span><span role="columnheader">Envoyé</span><span role="columnheader">Reçu</span></div>
        ${sorted.map((r) => `<div class="pairs-tr" role="row">
          <span role="cell"><button class="linkish" type="button" data-open-fiche="${esc(r.giver_id)}">${esc(pseudoOf(r.giver_id))}</button></span>
          <span role="cell" class="pairs-arrow" aria-hidden="true">${IC.arrow}</span>
          <span role="cell"><button class="linkish" type="button" data-open-fiche="${esc(r.receiver_id)}">${esc(pseudoOf(r.receiver_id))}</button></span>
          <span role="cell" class="small">${st.get(r.giver_id)?.sent_at ? `<span class="pill pill-ok">${esc(fmtDate(st.get(r.giver_id).sent_at))}</span>` : '<span class="muted">—</span>'}</span>
          <span role="cell" class="small">${st.get(r.receiver_id)?.received_at ? `<span class="pill pill-ok">${esc(fmtDate(st.get(r.receiver_id).received_at))}</span>` : '<span class="muted">—</span>'}</span>
        </div>`).join('')}
      </div>` : '<div class="empty">Aucune attribution enregistrée.</div>'}
      ${noTarget.length ? `<p class="small pairs-warn">Sans cible : ${esc(noTarget.join(', '))}</p>` : ''}
      ${noSanta.length ? `<p class="small pairs-warn">Sans Santa : ${esc(noSanta.join(', '))}</p>` : ''}`;
    body.hidden = false;
    btn.dataset.pairs = 'hide'; btn.setAttribute('aria-expanded', 'true');
    btn.innerHTML = `${IC.eyeOff} Masquer les attributions`;
  });
}
// Clic sur un pseudo du tableau des attributions -> fiche du membre, onglet Secret Santa
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-open-fiche]');
  if (!b) return;
  A.ssEdition = b.closest('#ss-pairs')?.dataset.edition || A.ssEdition;
  openAccount(b.dataset.openFiche, { tab: 'ss' }).then(() => { A.showPair = true; if (A.d) renderPanel(); });
});
