// Cartes admin : onglet « Statistiques ».
import { esc } from '../core.js';
import { RARITIES, fmtP } from '../cartes-ui.js';
import { C } from './state.js';
import { liveCount, maxSerialOf, nf, tile } from './helpers.js';

/* =========================================================
   Statistiques
   ========================================================= */
export function statsPanel() {
  const live = C.copies.filter((x) => !x.recycled_at);
  const active = C.cards.filter((k) => k.active).length;
  const boosters = C.wallets.reduce((s, w) => s + (w.boosters_opened || 0), 0);
  const pail = C.wallets.reduce((s, w) => s + (w.paillettes || 0), 0);
  const openT = C.trades.filter((t) => t.status === 'proposee').length;
  const doneT = C.trades.filter((t) => t.status === 'acceptee').length;
  const rows = RARITIES.map((r) => {
    const cards = C.cards.filter((k) => k.rarity === r.id).length;
    const copies = live.filter((x) => C.cardById.get(x.card_id)?.rarity === r.id).length;
    return { r, cards, copies };
  });
  const idents = C.cards.filter((k) => k.rarity === 'identite').sort((a, b) => (C.setById.get(a.set_id)?.sort ?? 0) - (C.setById.get(b.set_id)?.sort ?? 0) || a.number - b.number);
  return `
    <div class="acd-tiles">
      ${tile(`${nf(active)} / ${nf(C.cards.length)}`, 'cartes actives')}
      ${tile(nf(live.length), 'exemplaires en circulation')}
      ${tile(nf(boosters), 'boosters ouverts')}
      ${tile(fmtP(pail), 'Paillettes en circulation')}
      ${tile(nf(openT), 'échanges en cours')}
      ${tile(nf(doneT), 'échanges conclus')}
    </div>
    <section class="card" aria-labelledby="acd-rar-h">
      <h3 class="card-title" id="acd-rar-h">Par rareté</h3>
      <div class="acd-scroll"><table class="acd-table acd-table-stats">
        <thead><tr><th scope="col">Rareté</th><th scope="col">Cartes</th><th scope="col">Exemplaires en circulation</th><th scope="col">Part</th></tr></thead>
        <tbody>${rows.map(({ r, cards, copies }) => {
          const share = live.length ? Math.round((copies / live.length) * 1000) / 10 : 0;
          return `<tr><td><span class="pill acd-rar acd-rar-${esc(r.id)}">${esc(r.label)}</span></td><td>${nf(cards)}</td><td>${nf(copies)}</td>
            <td><span class="acd-share"><span class="acd-bar" aria-hidden="true"><span style="width:${share}%"></span></span><span>${nf(share)} %</span></span></td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>
    <section class="card" aria-labelledby="acd-id-h">
      <h3 class="card-title" id="acd-id-h">Cartes Identité : numéros distribués</h3>
      ${idents.length ? `<ul class="acd-list">${idents.map((k) => `<li class="acd-item acd-item-tight">
          <div class="acd-item-main"><p><strong>${esc(k.name)}</strong> <span class="small muted">${esc(C.setById.get(k.set_id)?.name ?? '')}</span></p>
          <p class="small muted">${nf(liveCount(k.id))} en circulation</p></div>
          <span class="pill acd-rar acd-rar-identite">${nf(maxSerialOf(k.id))} / ${k.max_copies ? nf(k.max_copies) : '∞'}</span>
        </li>`).join('')}</ul>` : '<p class="small muted">Aucune carte Identité pour l\'instant.</p>'}
    </section>`;
}
