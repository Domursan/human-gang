// ===== Cartes à collectionner — page joueur =====
// RPC : hg_cards_me, hg_cards_daily, hg_open_booster, hg_card_recycle, hg_card_craft, hg_card_leaderboard.
// Lecture : hg_card_sets, hg_cards, hg_card_copies, hg_card_wishlist, hg_wallet_log. Rendu : cartes-ui.js.
// Tout le texte de l'interface est en français ; tout texte venant de la base passe par esc().
import { sb, initPage, toast, errMsg, esc, $, fmtDate, avatarHtml, playSound, motionAllowed } from './core.js';
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
