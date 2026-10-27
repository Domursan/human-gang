// ===== Cartes : tableau « Je cherche / Je donne » (idée C12, migration 081) =====
// Onglet « Tableau » des Échanges (monté par cartes-trades.js) : carte par carte, qui la cherche (liste de souhaits)
// et qui la donne (doubles libres), parmi les membres inscrits seulement (inscription volontaire, désinscription
// immédiate). « Proposer un échange » ouvre l'éditeur d'offre existant, déjà rempli : la carte voulue d'un côté et,
// si possible, une de mes cartes que l'autre cherche de l'autre côté.
// RPC : hg_trade_board (filtres série, rareté, « ce qui m'intéresse », pages de 60), hg_trade_board_set.
// Lectures pour le préremplissage : hg_card_copies et hg_card_wishlist (déjà lisibles par les membres).
// Exporte : mountBoard(el, ctx). ctx = { me, sets: Map(id -> nom), openEditor({ to, give, want }) }.
import { sb, esc, toast, errMsg } from '../../commun/core.js';
import { cardHtml, RARITIES } from './cartes-ui.js';

const B = { data: null, rows: [], mine: false, set: '', rarity: '', offset: 0, busy: false, err: '', noteDraft: null };
const MAX_NOTE = 80;

/** Liste de pseudos lisible : « Destru, Mycethyst » ; « Wae (×2) » pour les donneurs. */
const names = (list, me, withN = false) => list.map((p) => `${esc(p.pseudo)}${p.id === me ? ' (toi)' : ''}${withN ? ` (×${p.n})` : ''}`).join(', ');

/**
 * Exemplaires vivants et libres d'un membre (pas en échange) et sa liste de souhaits.
 * @param {string} uid membre
 */
async function peerData(uid) {
  const [cp, wi] = await Promise.all([
    sb.from('hg_card_copies').select('id,card_id,locked_trade,shiny').eq('owner_id', uid).is('recycled_at', null).order('id'),
    sb.from('hg_card_wishlist').select('card_id').eq('user_id', uid),
  ]);
  if (cp.error) throw cp.error;
  if (wi.error) throw wi.error;
  const copies = (cp.data || []).filter((c) => !c.locked_trade);
  const count = new Map();
  for (const c of cp.data || []) count.set(c.card_id, (count.get(c.card_id) || 0) + 1);
  return { copies, count, wish: new Set((wi.data || []).map((w) => w.card_id)) };
}

/**
 * Prépare une offre pour une ligne du tableau : si j'ai la carte en double et que quelqu'un la cherche, je la lui
 * propose (et je demande une carte de sa liste… que j'ai dans ma liste de souhaits) ; sinon je la demande au premier
 * donneur, en donnant si possible un de mes doubles qu'il cherche.
 * @returns {Promise<{to: string, give: string[], want: string[]}|null>}
 */
export async function prefill(row, me) {
  const iGive = row.givers.some((g) => g.id === me);
  const seeker = row.seekers.find((s) => s.id !== me);
  const giver = row.givers.find((g) => g.id !== me);
  const mine = await peerData(me);
  /** Un double libre à moi parmi les cartes voulues (non brillant d'abord). */
  const myDouble = (ok) => mine.copies.filter((c) => ok(c.card_id) && (mine.count.get(c.card_id) || 0) >= 2)
    .sort((a, b) => Number(a.shiny) - Number(b.shiny))[0];
  if (iGive && seeker) {
    const other = await peerData(seeker.id);
    const give = myDouble((id) => id === row.id);
    const want = other.copies.find((c) => mine.wish.has(c.card_id) && (other.count.get(c.card_id) || 0) >= 2);
    return { to: seeker.id, give: give ? [String(give.id)] : [], want: want ? [String(want.id)] : [] };
  }
  if (giver) {
    const other = await peerData(giver.id);
    const want = other.copies.filter((c) => c.card_id === row.id).sort((a, b) => Number(a.shiny) - Number(b.shiny))[0];
    const give = myDouble((id) => other.wish.has(id));
    return { to: giver.id, give: give ? [String(give.id)] : [], want: want ? [String(want.id)] : [] };
  }
  return null;
}

/** HTML du panneau. */
function html(ctx) {
  const d = B.data || {};
  const on = !!d.me?.on;
  const note = B.noteDraft ?? d.me?.note ?? '';
  const sets = [...(ctx.sets || new Map())].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'fr'));
  const notes = (d.notes || []).filter((n) => n.note).map((n) => `<li>« ${esc(n.note)} » · ${esc(n.pseudo)}</li>`).join('');
  const rows = B.rows.map((r, i) => {
    const can = r.givers.some((g) => g.id !== ctx.me.id) || (r.givers.some((g) => g.id === ctx.me.id) && r.seekers.some((s) => s.id !== ctx.me.id));
    return `<li class="card c2-brd-row">
      <div class="c2-brd-card">${cardHtml({ ...r, flavor: null }, { size: 'sm' })}</div>
      <div class="c2-brd-info">
        <h4 class="c2-brd-name">${esc(r.name)}</h4>
        <p class="small"><span class="c2-brd-k c2-brd-seek">Cherchée par</span> ${r.seekers.length ? names(r.seekers, ctx.me.id) : '<span class="muted">personne pour l’instant</span>'}</p>
        <p class="small"><span class="c2-brd-k c2-brd-give">Donnée par</span> ${r.givers.length ? names(r.givers, ctx.me.id, true) : '<span class="muted">personne pour l’instant</span>'}</p>
        ${can ? `<button type="button" class="btn ${i === 0 ? 'btn-sand' : 'btn-ghost'} c2-brd-go" data-c2="brd-offer" data-i="${i}">Proposer un échange</button>` : ''}
      </div></li>`;
  }).join('');
  return `<div class="c2-brd">
      <div class="card c2-brd-opt">
        <label class="c2-switch">
          <span><strong>Apparaître sur le tableau</strong><span class="small muted">Montre ta liste de souhaits et tes doubles</span></span>
          <input type="checkbox" role="switch" id="c2-brd-on" ${on ? 'checked' : ''} ${B.busy ? 'disabled' : ''}>
        </label>
        ${on ? `<form class="c2-brd-note" data-c2-form="brd-note" novalidate>
            <label for="c2-brd-note">Ton petit mot <span class="muted small">(${MAX_NOTE} caractères, visible par les inscrits)</span></label>
            <div class="c2-code-row"><input id="c2-brd-note" maxlength="${MAX_NOTE}" value="${esc(note)}" placeholder="J’échange mes Dorées contre les OG">
              <button type="submit" class="btn btn-ghost" ${B.busy ? 'disabled' : ''}>Enregistrer</button></div>
          </form>` : ''}
      </div>
      <div class="c2-brd-filters" role="group" aria-label="Filtres du tableau">
        <button type="button" class="trd-chip c2-chip" data-c2="brd-mine" aria-pressed="${B.mine}">Ce qui m’intéresse</button>
        <label class="visually-hidden" for="c2-brd-set">Série</label>
        <select id="c2-brd-set" class="c2-chip-sel" data-c2-sel="set"><option value="">Toutes séries</option>${sets.map(([id, n]) => `<option value="${esc(id)}" ${B.set === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <label class="visually-hidden" for="c2-brd-rar">Rareté</label>
        <select id="c2-brd-rar" class="c2-chip-sel" data-c2-sel="rarity"><option value="">Toutes raretés</option>${RARITIES.filter((r) => r.id !== 'identite' && r.id !== 'unique').map((r) => `<option value="${r.id}" ${B.rarity === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
      </div>
      ${notes ? `<ul class="c2-brd-notes small muted">${notes}</ul>` : ''}
      ${B.err ? `<p class="empty">${esc(B.err)}</p>` : ''}
      <p class="visually-hidden" aria-live="polite">${B.data ? `${d.total || 0} carte${(d.total || 0) > 1 ? 's' : ''} sur le tableau` : ''}</p>
      ${B.data && !B.rows.length && !B.err ? `<p class="empty">${B.mine ? 'Rien pour toi sur le tableau pour l’instant.' : 'Personne n’est encore inscrit sur le tableau.'}</p>` : ''}
      ${rows ? `<ul class="c2-brd-list">${rows}</ul>` : ''}
      ${B.data && B.rows.length < (d.total || 0) ? '<div class="btn-row"><button type="button" class="btn btn-ghost" data-c2="brd-more">Voir plus</button></div>' : ''}
    </div>`;
}

/**
 * Monte le tableau dans el (vidé). Peut être appelé à chaque ouverture de l'onglet : l'état (filtres) est gardé.
 * @param {HTMLElement} el conteneur (le panneau de l'onglet)
 * @param {{me: {id: string}, sets: Map<string, string>, openEditor: (o: object) => void}} ctx
 */
export async function mountBoard(el, ctx) {
  const box = document.createElement('div');
  el.replaceChildren(box);
  const draw = (focusSel = null) => {
    box.innerHTML = html(ctx);
    if (focusSel) box.querySelector(focusSel)?.focus({ preventScroll: true });
  };
  const load = async (more = false, focusSel = null) => {
    try {
      const { data, error } = await sb.rpc('hg_trade_board', { p_set: B.set || null, p_rarity: B.rarity || null, p_mine: B.mine, p_offset: more ? B.rows.length : 0 });
      if (error) throw error;
      B.data = data || {};
      B.rows = more ? [...B.rows, ...(data?.rows || [])] : (data?.rows || []);
      B.err = '';
    } catch (e) { B.err = `Impossible de charger le tableau : ${errMsg(e)}`; }
    draw(focusSel);
  };
  const save = async (on, note) => {
    B.busy = true; draw();
    try {
      const { error } = await sb.rpc('hg_trade_board_set', { p_on: on, p_note: note });
      if (error) throw error;
      toast(on ? 'Tu apparais sur le tableau' : 'Tu n’apparais plus sur le tableau', 'ok');
      B.noteDraft = null;
    } catch (e) { toast(errMsg(e), 'error'); }
    B.busy = false;
    await load(false, '#c2-brd-on');
  };
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-c2^="brd-"]');
    if (!b || b.disabled) return;
    if (b.dataset.c2 === 'brd-mine') { B.mine = !B.mine; return load(false, '[data-c2="brd-mine"]'); }
    if (b.dataset.c2 === 'brd-more') return load(true);
    if (b.dataset.c2 === 'brd-offer') {
      const row = B.rows[Number(b.dataset.i)];
      if (!row) return;
      b.disabled = true;
      try {
        const o = await prefill(row, ctx.me.id);
        if (o) ctx.openEditor(o); else toast('Personne avec qui échanger cette carte pour l’instant.');
      } catch (err) { toast(errMsg(err), 'error'); }
      b.disabled = false;
    }
  });
  box.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'c2-brd-on') return save(t.checked, t.checked ? (B.data?.me?.note ?? null) : (B.data?.me?.note ?? null));
    if (t.dataset.c2Sel) { B[t.dataset.c2Sel] = t.value; load(false, '#' + t.id); }
  });
  box.addEventListener('input', (e) => { if (e.target.id === 'c2-brd-note') B.noteDraft = e.target.value; });
  box.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-c2-form="brd-note"]')) return;
    e.preventDefault();
    save(true, (B.noteDraft ?? '').trim() || null);
  });
  box.innerHTML = '<p class="empty">Chargement du tableau…</p>';
  await load();
}
