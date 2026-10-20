// ===== Cartes à collectionner — page joueur =====
// RPC : hg_cards_me, hg_cards_daily, hg_open_booster, hg_card_recycle, hg_card_craft, hg_card_leaderboard.
// Lecture : hg_card_sets, hg_cards, hg_card_copies, hg_card_wishlist, hg_wallet_log. Rendu : cartes-ui.js.
// Tout le texte de l'interface est en français ; tout texte venant de la base passe par esc().
import { sb, initPage, toast, errMsg, esc, $, fmtDate, avatarHtml, playSound, motionAllowed, notify } from './core.js';
import { RARITIES, rarityLabel, rarityRank, FAMILIES, familyLabel, cardHtml, cardBackHtml, fmtP, serialLabel } from './cartes-ui.js';

const me = await initPage({ auth: 'member' });
const app = $('#app');
const nf = new Intl.NumberFormat('fr-CH');
const pct = (v) => `${new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 2 }).format(v)} %`;
const TABS = [['boosters', 'Boosters'], ['collection', 'Collection'], ['classement', 'Classement'], ['echanges', 'Échanges']];
const SOURCE_LABEL = { booster: 'Booster', cadeau: 'Cadeau', admin: 'Attribuée par le gang', fabrication: 'Fabriquée', evenement: 'Événement', echange: 'Échange' };
const REASON_LABEL = {
  quotidien: 'Passage du jour', booster: 'Booster ouvert', recyclage: 'Recyclage', fabrication: 'Fabrication',
  serie_complete: 'Série complétée', reponse_sortie: 'Réponse à une sortie', presence: 'Présence à une sortie', photo: 'Photo partagée',
  moment: 'Moment culte', badge: 'Badge obtenu', capture: 'Capture d’événement', sortie_creee: 'Sortie créée',
  cadeau_santa: 'Cadeau Secret Santa', echange: 'Échange de cartes', admin: 'Ajustement du gang',
};

const S = {
  state: null, sets: [], cards: [], cardsById: new Map(), copies: [], wish: new Set(), log: [],
  tab: 'boosters', setId: null, filters: { rarity: '', family: '', owned: 'all' },
  reveal: null, busy: false, detailId: null, tradesMounted: false, massIds: [], massTotal: 0,
};
const cfg = () => S.state?.config || {};
const isGod = () => !!S.state?.god;
const bal = () => Number(S.state?.paillettes ?? 0);
const started = (s) => !s.starts_at || new Date(s.starts_at) <= new Date();
const copiesOf = (cardId) => S.copies.filter((c) => c.card_id === cardId);
const tableVal = (table, rarity) => { const v = cfg()[table]?.[rarity]; return v == null ? null : Number(v); };
const fmtDuration = (ms) => {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${Math.max(1, m)} min`;
};
const plural = (n, one, many) => `${nf.format(n)} ${n > 1 ? many : one}`;

/* ---------- Données ---------- */
async function loadStatic() {
  const [sets, cards] = await Promise.all([
    sb.from('hg_card_sets').select('*').eq('active', true).order('sort'),
    sb.from('hg_cards').select('*').eq('active', true).order('number'),
  ]);
  if (sets.error) throw sets.error;
  if (cards.error) throw cards.error;
  S.sets = (sets.data || []).filter(started);
  S.cards = cards.data || [];
  S.cardsById = new Map(S.cards.map((c) => [c.id, c]));
  if (!S.sets.some((s) => s.id === S.setId)) S.setId = S.sets.at(-1)?.id || null;
}

async function refreshData() {
  const [st, cp, wi, lg] = await Promise.all([
    sb.rpc('hg_cards_me'),
    sb.from('hg_card_copies').select('id,card_id,owner_id,shiny,serial,source,obtained_at,locked_trade').eq('owner_id', me.id).is('recycled_at', null).order('obtained_at'),
    sb.from('hg_card_wishlist').select('card_id').eq('user_id', me.id),
    sb.from('hg_wallet_log').select('delta,reason,created_at').eq('user_id', me.id).order('created_at', { ascending: false }).limit(30),
  ]);
  for (const r of [st, cp, wi, lg]) if (r.error) throw r.error;
  S.state = st.data;
  S.copies = cp.data || [];
  S.wish = new Set((wi.data || []).map((w) => w.card_id));
  S.log = lg.data || [];
}

/* ---------- Squelette ---------- */
function skeleton() {
  return `
    <section class="page-head cartes-head">
      <div>
        <p class="eyebrow">Jeu de cartes</p>
        <h1 class="page-title">Cartes</h1>
      </div>
      <div class="cartes-wallet" id="cartes-wallet" aria-live="polite"></div>
    </section>
    <p class="cartes-small">Aucun argent réel : les Paillettes se gagnent uniquement en participant à la vie du gang.</p>
    <nav class="cartes-tabs" id="cartes-tablist" role="tablist" aria-label="Sections du jeu">
      ${TABS.map(([id, label], i) => `<button type="button" role="tab" id="cartes-tab-${id}" class="cartes-tab" data-tab="${id}"
        aria-selected="${i === 0}" aria-controls="cartes-p-${id}" tabindex="${i === 0 ? 0 : -1}">${label}</button>`).join('')}
    </nav>
    ${TABS.map(([id]) => `<section role="tabpanel" id="cartes-p-${id}" class="cartes-panel" aria-labelledby="cartes-tab-${id}" ${id === 'boosters' ? '' : 'hidden'}>${id === 'echanges' ? '<div id="cartes-trades"></div>' : ''}</section>`).join('')}
    <details class="card cartes-block" id="cartes-history-wrap">
      <summary>Historique des Paillettes (30 derniers mouvements)</summary>
      <div id="cartes-history" class="cartes-block"></div>
    </details>
    <p class="cartes-foot-note">Les cartes et les Paillettes restent dans le jeu : rien n’a de valeur en argent.</p>
    <p id="cartes-live" class="visually-hidden" aria-live="polite"></p>

    <dialog id="cartes-detail" class="cartes-dialog" aria-labelledby="cartes-detail-title">
      <button type="button" class="btn btn-ghost cartes-close" data-action="close-dialog">Fermer</button>
      <div class="cartes-dialog-body">
        <div class="cartes-big" id="cartes-detail-card"></div>
        <div id="cartes-detail-info"></div>
      </div>
    </dialog>
    <dialog id="cartes-mass" class="cartes-dialog" aria-labelledby="cartes-mass-title">
      <div class="cartes-dialog-pad">
        <h2 id="cartes-mass-title">Recycler les doublons</h2>
        <div id="cartes-mass-body"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-ghost" data-action="close-dialog">Annuler</button>
          <button type="button" class="btn btn-primary" id="cartes-mass-confirm" data-action="mass-confirm">Recycler</button>
        </div>
      </div>
    </dialog>`;
}

/* ---------- En-tête ---------- */
function renderHeader() {
  const el = $('#cartes-wallet');
  if (!el || !S.state) return;
  const s = S.state;
  const daily = tableVal('rewards', 'daily') ?? 20;
  el.innerHTML = `
    <div>
      <p class="cartes-bal-label">Paillettes</p>
      <p class="cartes-bal">${fmtP(bal())}</p>
    </div>
    ${isGod() ? '<span class="pill pill-current">Mode sans limite</span>' : ''}
    ${s.daily_available
      ? `<button type="button" class="btn btn-sand" data-action="daily">Passage du jour (+${nf.format(daily)} ✦)</button>
         <span class="cartes-small">Série actuelle : ${nf.format(s.daily_streak)} j</span>`
      : `<span class="pill pill-ok">Passage du jour pris · série de ${nf.format(s.daily_streak)} j</span>`}`;
}

/* ---------- Onglets ---------- */
function showTab() {
  for (const [id] of TABS) {
    const on = S.tab === id;
    const tab = $(`#cartes-tab-${id}`);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`#cartes-p-${id}`).hidden = !on;
  }
}

function renderTab() {
  if (S.tab === 'boosters') renderBoosters();
  else if (S.tab === 'collection') renderCollection();
  else if (S.tab === 'classement') renderLeaderboard();
  else if (S.tab === 'echanges') mountTradesOnce();
}

function setTab(id) {
  S.tab = id;
  showTab();
  renderTab();
}

function renderAll() {
  renderHeader();
  renderHistory();
  showTab();
  renderTab();
}

/* ---------- Boosters ---------- */
function renderBoosters() {
  const el = $('#cartes-p-boosters');
  const c = cfg();
  const price = Number(c.booster_price ?? 100);
  const size = c.booster_size ?? 5;
  const rates = c.rates || {};
  const total = Object.values(rates).reduce((a, v) => a + Math.max(0, Number(v) || 0), 0) || 1;
  const pity = Number(c.pity_epique ?? 10);
  const untilGuarantee = Math.max(0, pity - 1 - Number(S.state?.pity ?? 0));
  const canPay = isGod() || bal() >= price;
  const odds = RARITIES.map((r) => `<tr><th scope="row">${esc(r.label)}</th><td>${pct((Number(rates[r.id]) || 0) / total * 100)}</td></tr>`).join('');

  el.innerHTML = `
    <section class="card cartes-block" aria-labelledby="cartes-free-h">
      <h2 id="cartes-free-h">Booster gratuit</h2>
      <p class="muted small">Un booster de ${nf.format(size)} cartes toutes les ${nf.format(c.free_booster_hours ?? 24)} h.</p>
      <div id="cartes-free" class="cartes-row"></div>
    </section>
    <section class="card cartes-block" aria-labelledby="cartes-paid-h">
      <h2 id="cartes-paid-h">Booster payant</h2>
      <p class="muted small">${nf.format(size)} cartes pour ${fmtP(price)}.</p>
      <div class="cartes-row">
        <button type="button" class="btn btn-ghost" data-action="open-paid" ${S.busy || !canPay ? 'disabled' : ''}>Ouvrir un booster · ${fmtP(price)}</button>
        ${canPay ? '' : `<span class="muted small">Il te manque ${nf.format(price - bal())} ✦</span>`}
      </div>
      <p class="cartes-small">${untilGuarantee === 0
        ? 'Le prochain booster contient au moins une carte Épique ou plus.'
        : `Encore ${plural(untilGuarantee, 'ouverture', 'ouvertures')} avant la garantie d’une carte Épique ou plus.`}</p>
    </section>
    <div id="cartes-reveal"></div>
    <section class="card cartes-block" aria-labelledby="cartes-odds-h">
      <h2 id="cartes-odds-h">Chances</h2>
      <table class="cartes-odds">
        <caption class="visually-hidden">Chances d’obtenir chaque rareté dans un booster</caption>
        <thead><tr><th scope="col">Rareté</th><th scope="col">Chance</th></tr></thead>
        <tbody>${odds}
          <tr><th scope="row">Version brillante (par carte)</th><td>${pct(Number(c.shiny_rate ?? 0))}</td></tr>
        </tbody>
      </table>
      <p class="cartes-small">Un booster contient une carte Épique ou plus au moins une fois toutes les ${nf.format(pity)} ouvertures.</p>
    </section>`;
  renderFree();
  renderReveal();
}

function renderFree() {
  const box = $('#cartes-free');
  if (!box || !S.state) return;
  const at = S.state.free_booster_at ? new Date(S.state.free_booster_at).getTime() : 0;
  const ms = at - Date.now();
  const ready = ms <= 0;
  if (box.dataset.ready === String(ready) && box.dataset.busy === String(S.busy)) {
    if (!ready) box.querySelector('.cartes-timer').textContent = `Disponible dans ${fmtDuration(ms)}`;
    return;
  }
  box.dataset.ready = String(ready);
  box.dataset.busy = String(S.busy);
  box.innerHTML = ready
    ? `<button type="button" class="btn btn-primary" data-action="open-free" ${S.busy ? 'disabled' : ''}>Ouvrir le booster gratuit</button>`
    : `<p class="cartes-timer" role="timer">Disponible dans ${fmtDuration(ms)}</p>`;
}

function renderReveal() {
  const box = $('#cartes-reveal');
  if (!box) return;
  const R = S.reveal;
  if (!R) { box.innerHTML = ''; return; }
  const n = R.cards.length;
  const done = R.revealed.size === n;
  const motion = motionAllowed();
  box.innerHTML = `
    <section class="card cartes-block" aria-labelledby="cartes-reveal-h">
      <h2 id="cartes-reveal-h">Ton booster</h2>
      <div class="cartes-booster-grid">
        ${R.cards.map((card, i) => R.revealed.has(i)
          ? `<div class="cartes-flip ${motion && R.last === i ? 'cartes-flip-in' : ''}">${cardHtml(card, { shiny: card.shiny, serial: card.serial, size: 'md' })}</div>`
          : `<button type="button" class="cartes-reveal-btn" data-action="reveal" data-i="${i}" aria-label="Retourner la carte ${i + 1} sur ${n}">${cardBackHtml('md')}</button>`).join('')}
      </div>
      <div class="cartes-row">
        ${done
          ? `<p class="muted">Meilleure carte : ${esc(R.best ? rarityLabel(R.best) : '—')}</p>
             <button type="button" class="btn btn-primary" data-action="close-reveal">Fermer</button>`
          : `<button type="button" class="btn btn-ghost" data-action="reveal-all">Tout révéler</button>`}
      </div>
    </section>`;
  if (done && !R.announced) {
    R.announced = true;
    $('#cartes-live').textContent = `Booster ouvert. Meilleure carte : ${R.best ? rarityLabel(R.best) : 'aucune'}.`;
  }
}

function reveal(i) {
  const R = S.reveal;
  if (!R || R.revealed.has(i)) return;
  R.revealed.add(i);
  R.last = i;
  playSound(rarityRank(R.cards[i].rarity) >= 5 ? 'badge' : 'click');
  renderReveal();
  $('#cartes-reveal [data-action="reveal"], #cartes-reveal [data-action="close-reveal"], #cartes-reveal [data-action="reveal-all"]')?.focus();
}

function revealAll() {
  const R = S.reveal;
  if (!R) return;
  R.cards.forEach((_, i) => R.revealed.add(i));
  R.last = -1;
  playSound('badge');
  renderReveal();
  $('#cartes-reveal [data-action="close-reveal"]')?.focus();
}

async function openBooster(free) {
  if (S.busy) return;
  S.busy = true;
  renderBoosters();
  try {
    const { data, error } = await sb.rpc('hg_open_booster', { p_free: !!free });
    if (error) throw error;
    const cards = data?.cards || [];
    // Annonce Discord des belles cartes (vérifiée côté serveur par hg-notify)
    for (const c of cards) if (['legendaire', 'mythique', 'identite'].includes(c.rarity)) notify('card_pull', { card: c.card_id, rarity: c.rarity, shiny: c.shiny, serial: c.serial }).catch(() => {});
    S.reveal = { cards, best: data?.best, revealed: new Set(), last: -1, announced: false };
    if (!motionAllowed()) S.reveal.revealed = new Set(cards.map((_, i) => i));
    await refreshData();
  } catch (e) {
    toast(errMsg(e), 'error');
  } finally {
    S.busy = false;
    renderAll();
  }
}

async function claimDaily() {
  if (S.busy) return;
  S.busy = true;
  try {
    const { data, error } = await sb.rpc('hg_cards_daily');
    if (error) throw error;
    toast(`+${nf.format(data.gain)} ✦ · série de ${plural(data.streak, 'jour', 'jours')}`, 'ok');
    await refreshData();
  } catch (e) {
    toast(errMsg(e), 'error');
  } finally {
    S.busy = false;
    renderAll();
  }
}

/* ---------- Collection ---------- */
function cardCell(c) {
  const cps = copiesOf(c.id);
  const n = cps.length;
  const shinyCp = cps.find((x) => x.shiny);
  return cardHtml(c, {
    size: 'md', count: n, shiny: !!shinyCp,
    serial: n === 1 && c.max_copies ? cps[0].serial : null,
    missing: n === 0, button: true,
    attrs: `data-action="open-card" data-card="${esc(c.id)}"`,
  });
}

function renderCollection(focusId) {
  const el = $('#cartes-p-collection');
  const set = S.sets.find((s) => s.id === S.setId);
  if (!set) { el.innerHTML = '<p class="empty">Aucune série disponible pour le moment.</p>'; return; }
  const setCards = S.cards.filter((c) => c.set_id === set.id);
  const scored = setCards.filter((c) => c.rarity !== 'identite');
  const have = scored.filter((c) => copiesOf(c.id).length > 0).length;
  const pctDone = scored.length ? Math.round(have / scored.length * 100) : 0;
  const f = S.filters;
  const shown = setCards.filter((c) => {
    const n = copiesOf(c.id).length;
    if (f.rarity && c.rarity !== f.rarity) return false;
    if (f.family && c.family !== f.family) return false;
    if (f.owned === 'owned' && n === 0) return false;
    if (f.owned === 'missing' && n > 0) return false;
    if (f.owned === 'dupes' && n < 2) return false;
    return true;
  });
  const plan = massPlan();
  el.innerHTML = `
    <section class="card cartes-block">
      <div class="cartes-series">
        <div class="field">
          <label for="cartes-set">Série</label>
          <select id="cartes-set" data-change="set">
            ${S.sets.map((s) => `<option value="${esc(s.id)}" ${s.id === set.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="cartes-progress">
          <p class="cartes-progress-label">${nf.format(have)} / ${nf.format(scored.length)} cartes obtenues</p>
          <div class="progress" role="progressbar" aria-label="Progression de la série" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctDone}"><span style="width:${pctDone}%"></span></div>
        </div>
      </div>
      ${set.description ? `<p class="muted small">${esc(set.description)}</p>` : ''}
      <div class="cartes-filters">
        <div class="field">
          <label for="cartes-f-rarity">Rareté</label>
          <select id="cartes-f-rarity" data-filter="rarity">
            <option value="">Toutes</option>
            ${RARITIES.map((r) => `<option value="${r.id}" ${f.rarity === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="cartes-f-family">Famille</label>
          <select id="cartes-f-family" data-filter="family">
            <option value="">Toutes</option>
            ${FAMILIES.map((x) => `<option value="${x.id}" ${f.family === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="cartes-f-owned">Afficher</label>
          <select id="cartes-f-owned" data-filter="owned">
            <option value="all" ${f.owned === 'all' ? 'selected' : ''}>Toutes les cartes</option>
            <option value="owned" ${f.owned === 'owned' ? 'selected' : ''}>Possédées</option>
            <option value="missing" ${f.owned === 'missing' ? 'selected' : ''}>Manquantes</option>
            <option value="dupes" ${f.owned === 'dupes' ? 'selected' : ''}>Doublons</option>
          </select>
        </div>
      </div>
      <div class="cartes-mass">
        <p class="muted small">${plural(plan.ids.length, 'doublon recyclable', 'doublons recyclables')} (on garde un exemplaire de chaque carte)</p>
        <button type="button" class="btn btn-ghost" data-action="mass">Recycler les doublons</button>
      </div>
    </section>
    ${shown.length
      ? `<div class="cartes-grid">${shown.map(cardCell).join('')}</div>`
      : '<p class="empty">Aucune carte ne correspond à ces filtres.</p>'}`;
  if (focusId) document.getElementById(focusId)?.focus();
}

/* ---------- Recyclage de masse ---------- */
function recycleValue(cp, k) {
  const base = tableVal('recycle', k.rarity) ?? 0;
  return base * (cp.shiny ? Number(cfg().recycle?.shiny_multiplier ?? 3) : 1);
}

// Garde un exemplaire par carte (brillant d'abord, non échangé d'abord). Exclut identite et échanges en cours.
function massPlan() {
  const groups = new Map();
  for (const cp of S.copies) {
    if (!groups.has(cp.card_id)) groups.set(cp.card_id, []);
    groups.get(cp.card_id).push(cp);
  }
  const ids = [];
  let total = 0;
  for (const [cardId, list] of groups) {
    const k = S.cardsById.get(cardId);
    if (!k || k.rarity === 'identite' || list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (Number(b.shiny) - Number(a.shiny)) || (Number(!!a.locked_trade) - Number(!!b.locked_trade)));
    for (const cp of sorted.slice(1)) {
      if (cp.locked_trade) continue;
      ids.push(cp.id);
      total += recycleValue(cp, k);
    }
  }
  return { ids, total };
}

function openMass() {
  const plan = massPlan();
  S.massIds = plan.ids;
  S.massTotal = plan.total;
  $('#cartes-mass-body').innerHTML = plan.ids.length
    ? `<p>Tu vas recycler <strong>${plural(plan.ids.length, 'doublon', 'doublons')}</strong> pour environ <strong>${fmtP(plan.total)}</strong>.</p>
       <p class="muted small">Il te restera au moins un exemplaire de chaque carte. Les cartes Identité et celles en cours d’échange ne sont pas touchées. Cette action est définitive.</p>`
    : '<p>Aucun doublon à recycler pour le moment.</p>';
  $('#cartes-mass-confirm').hidden = !plan.ids.length;
  const dlg = $('#cartes-mass');
  if (!dlg.open) dlg.showModal();
}

async function confirmMass() {
  if (S.busy || !S.massIds.length) return;
  S.busy = true;
  try {
    const { data, error } = await sb.rpc('hg_card_recycle', { p_copies: S.massIds });
    if (error) throw error;
    toast(`Recyclage terminé : +${fmtP(data)}`, 'ok');
    $('#cartes-mass').close();
    await refreshData();
  } catch (e) {
    toast(errMsg(e), 'error');
  } finally {
    S.busy = false;
    renderAll();
  }
}

/* ---------- Détail d'une carte ---------- */
function openDetail(cardId) {
  S.detailId = cardId;
  renderDetail();
  const d = $('#cartes-detail');
  if (!d.open) d.showModal();
}

function copyRow(cp, k) {
  const val = recycleValue(cp, k);
  const parts = [cp.serial ? serialLabel(cp.serial, k.max_copies) : '', cp.shiny ? 'Brillante' : '', SOURCE_LABEL[cp.source] || cp.source, fmtDate(cp.obtained_at)].filter(Boolean);
  let action;
  if (cp.locked_trade) action = '<span class="pill pill-todo">En échange</span>';
  else if (k.rarity === 'identite') action = '<span class="muted small">Ne se recycle pas</span>';
  else action = `<button type="button" class="btn btn-ghost" data-action="recycle" data-copy="${esc(String(cp.id))}" ${S.busy ? 'disabled' : ''}>Recycler · ${fmtP(val)}</button>`;
  return `<li><span>${parts.map(esc).join(' · ')}</span>${action}</li>`;
}

function renderDetail() {
  const k = S.cardsById.get(S.detailId);
  if (!k) return;
  const cps = copiesOf(k.id);
  const n = cps.length;
  const shinyCp = cps.find((x) => x.shiny);
  const god = isGod();
  const costN = tableVal('craft', k.rarity);
  const costS = costN == null ? null : costN * Number(cfg().craft?.shiny_multiplier ?? 4);
  const craftable = god || (k.craftable && k.rarity !== 'mythique' && k.rarity !== 'identite' && costN != null);
  const wished = S.wish.has(k.id);
  const short = (cost) => !god && bal() < cost;

  $('#cartes-detail-card').innerHTML = cardHtml(k, {
    size: 'lg', count: n, shiny: !!shinyCp, missing: n === 0,
    serial: n === 1 && k.max_copies ? cps[0].serial : null,
  });
  $('#cartes-detail-info').innerHTML = `
    <h2 id="cartes-detail-title">${esc(k.name)}</h2>
    <p class="muted small">${esc(rarityLabel(k.rarity))} · ${esc(familyLabel(k.family))} · n° ${esc(k.number)}${k.max_copies ? ` · ${nf.format(k.max_copies)} exemplaires au total` : ''}</p>
    ${k.flavor ? `<p class="cartes-flavor">${esc(k.flavor)}</p>` : ''}
    <h3 class="small">Mes exemplaires</h3>
    ${n ? `<ul class="cartes-copies">${cps.map((cp) => copyRow(cp, k)).join('')}</ul>` : '<p class="muted">Pas encore obtenue.</p>'}
    <div class="btn-row">
      <button type="button" class="btn btn-ghost" data-action="wish" aria-pressed="${wished}">${wished ? 'Retirer de ma liste de souhaits' : 'Ajouter à ma liste de souhaits'}</button>
    </div>
    <h3 class="small">Fabriquer</h3>
    ${craftable
      ? `<div class="btn-row">
          <button type="button" class="btn btn-sand" data-action="craft" data-shiny="0" ${S.busy || short(costN) ? 'disabled' : ''}>Fabriquer · ${fmtP(costN ?? 0)}</button>
          ${k.can_shiny ? `<button type="button" class="btn btn-ghost" data-action="craft" data-shiny="1" ${S.busy || short(costS) ? 'disabled' : ''}>Fabriquer brillante · ${fmtP(costS ?? 0)}</button>` : ''}
        </div>
        ${short(costN) ? `<p class="muted small">Il te manque ${nf.format(costN - bal())} ✦ pour cette carte.</p>` : ''}`
      : '<p class="muted small">Cette carte ne peut pas être fabriquée.</p>'}`;
}

async function detailAction(action, el) {
  if (S.busy || !S.detailId) return;
  S.busy = true;
  renderDetail();
  let refreshed = false;
  try {
    if (action === 'wish') {
      const id = S.detailId;
      if (S.wish.has(id)) {
        const { error } = await sb.from('hg_card_wishlist').delete().eq('user_id', me.id).eq('card_id', id);
        if (error) throw error;
        S.wish.delete(id);
      } else {
        const { error } = await sb.from('hg_card_wishlist').insert({ user_id: me.id, card_id: id });
        if (error) throw error;
        S.wish.add(id);
      }
    } else if (action === 'craft') {
      const shiny = el.dataset.shiny === '1';
      const { data, error } = await sb.rpc('hg_card_craft', { p_card: S.detailId, p_shiny: shiny });
      if (error) throw error;
      toast(`Carte fabriquée${shiny ? ' (brillante)' : ''} · −${fmtP(data.cost)}`, 'ok');
      await refreshData();
      refreshed = true;
    } else if (action === 'recycle') {
      const { data, error } = await sb.rpc('hg_card_recycle', { p_copies: [Number(el.dataset.copy)] });
      if (error) throw error;
      toast(`Recyclé : +${fmtP(data)}`, 'ok');
      await refreshData();
      refreshed = true;
    }
  } catch (e) {
    toast(errMsg(e), 'error');
  } finally {
    S.busy = false;
  }
  if (refreshed) renderAll();
  else { renderDetail(); renderTab(); }
}

/* ---------- Classement ---------- */
async function renderLeaderboard() {
  const el = $('#cartes-p-classement');
  el.innerHTML = '<p class="muted" aria-live="polite">Chargement du classement…</p>';
  const { data, error } = await sb.rpc('hg_card_leaderboard');
  if (error) { el.innerHTML = `<p class="empty">${esc(errMsg(error))}</p>`; return; }
  const rows = data || [];
  el.innerHTML = `
    <section class="card">
      <h2>Classement</h2>
      <p class="muted small">Le score additionne la valeur des cartes possédées (une carte brillante compte double).</p>
      ${rows.length ? `<ol class="cartes-lb">
        ${rows.map((r, i) => `<li>
          <span class="cartes-lb-rank">${i + 1}</span>
          <span class="cartes-row">${avatarHtml(r, 36)}
            <span><strong>${esc(r.pseudo)}</strong>${r.user_id === me.id ? ' <span class="muted small">(toi)</span>' : ''}<br>
            <span class="cartes-lb-stats">${plural(Number(r.uniques), 'unique', 'uniques')} · ${plural(Number(r.copies), 'exemplaire', 'exemplaires')} · ${nf.format(Number(r.shinies))} brillantes · ${nf.format(Number(r.identites))} identités · ${nf.format(Number(r.series))} séries</span></span>
          </span>
          <span class="cartes-lb-score">${nf.format(Number(r.score))}</span>
        </li>`).join('')}
      </ol>` : '<p class="empty">Personne n’a encore de carte.</p>'}
    </section>`;
}

/* ---------- Échanges (module séparé, chargé à la demande) ---------- */
function mountTradesOnce() {
  if (S.tradesMounted) return;
  S.tradesMounted = true;
  const el = $('#cartes-trades');
  const ctx = {
    me,
    refresh: async () => { await refreshData(); renderAll(); },
  };
  import('./cartes-trades.js')
    .then((m) => m.mountTrades(el, ctx))
    .catch(() => { el.innerHTML = '<p class="empty">Bientôt.</p>'; });
}

/* ---------- Historique ---------- */
function renderHistory() {
  const el = $('#cartes-history');
  if (!el) return;
  el.innerHTML = S.log.length
    ? `<ul class="cartes-log">${S.log.map((l) => {
        const d = Number(l.delta);
        return `<li><span>${esc(REASON_LABEL[l.reason] || l.reason)} <span class="muted small">${esc(fmtDate(l.created_at))}</span></span>
          <span class="${d >= 0 ? 'cartes-delta-pos' : 'cartes-delta-neg'}">${d > 0 ? '+' : ''}${nf.format(d)} ✦</span></li>`;
      }).join('')}</ul>`
    : '<p class="muted small">Aucun mouvement pour le moment.</p>';
}

/* ---------- Événements ---------- */
function onClick(e) {
  const t = e.target.closest('[data-tab], [data-action]');
  if (!t || t.disabled) return;
  if (t.dataset.tab) { setTab(t.dataset.tab); $(`#cartes-tab-${t.dataset.tab}`).focus(); return; }
  switch (t.dataset.action) {
    case 'daily': return claimDaily();
    case 'open-free': return openBooster(true);
    case 'open-paid': return openBooster(false);
    case 'reveal': return reveal(Number(t.dataset.i));
    case 'reveal-all': return revealAll();
    case 'close-reveal': S.reveal = null; return renderBoosters();
    case 'open-card': return openDetail(t.dataset.card);
    case 'mass': return openMass();
    case 'mass-confirm': return confirmMass();
    case 'wish':
    case 'craft':
    case 'recycle': return detailAction(t.dataset.action, t);
    case 'close-dialog': return t.closest('dialog')?.close();
  }
}

function onChange(e) {
  const t = e.target;
  if (t.dataset.change === 'set') { S.setId = t.value; renderCollection('cartes-set'); }
  else if (t.dataset.filter) { S.filters[t.dataset.filter] = t.value; renderCollection(t.id); }
}

function onTabKey(e) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const ids = TABS.map(([id]) => id);
  const i = ids.indexOf(S.tab);
  const n = e.key === 'ArrowRight' ? (i + 1) % ids.length
    : e.key === 'ArrowLeft' ? (i - 1 + ids.length) % ids.length
    : e.key === 'Home' ? 0 : ids.length - 1;
  e.preventDefault();
  setTab(ids[n]);
  $(`#cartes-tab-${ids[n]}`).focus();
}

/* ---------- Démarrage ---------- */
async function boot() {
  app.innerHTML = skeleton();
  app.addEventListener('click', onClick);
  app.addEventListener('change', onChange);
  $('#cartes-tablist').addEventListener('keydown', onTabKey);
  $('#cartes-detail').addEventListener('close', () => { S.detailId = null; });
  try {
    await loadStatic();
    await refreshData();
    renderAll();
  } catch (e) {
    app.querySelector('#cartes-wallet').innerHTML = `<p class="empty">${esc(errMsg(e))}</p>`;
    toast(errMsg(e), 'error');
  }
  app.removeAttribute('aria-busy');
  // Le compte à rebours du booster gratuit se met à jour sans recharger la page
  setInterval(() => { if (S.tab === 'boosters') renderFree(); }, 30000);
}

boot();
