// ===== Cartes à collectionner — page joueur =====
// RPC : hg_cards_me, hg_cards_daily, hg_open_booster, hg_card_recycle, hg_card_craft, hg_card_leaderboard.
// Lecture : hg_card_sets, hg_cards, hg_card_copies, hg_card_wishlist, hg_wallet_log. Rendu : cartes-ui.js.
// Paillettes (icône, solde LCD) : paillettes.js. Tout le texte de l'interface est en français ; tout texte venant de la base passe par esc().
import { sb, initPage, toast, errMsg, esc, $, fmtDate, avatarHtml, playSound, motionAllowed, notify, currentLogo } from './core.js';
import { RARITIES, rarityLabel, rarityRank, FAMILIES, familyLabel, cardHtml, cardBackHtml, fmtP, serialLabel } from './cartes-ui.js';
import { fmtPaillettes, pastilleHtml, lcdSet, lcdDelta, lcdBlink } from './paillettes.js';

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
// Couleur de lueur de l'écran de console selon la rareté (maquette « cartouche »).
const RARITY_TINT = { commune: '#c4c9d6', peu_commune: '#2fd17a', rare: '#4f80ff', epique: '#a674f5', legendaire: '#FCA301', mythique: '#FE3104', identite: '#FBD32D' };
const tintOf = (r) => RARITY_TINT[r] || '#FBD32D';

const S = {
  state: null, sets: [], cards: [], cardsById: new Map(), copies: [], wish: new Set(), log: [],
  tab: 'boosters', setId: null, filters: { rarity: '', family: '', owned: 'all' },
  reveal: null, busy: false, detailId: null, tradesMounted: false, massIds: [], massTotal: 0,
  lcdShown: null, lcdAnim: false,
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
const isBusy = () => S.busy || !!(S.reveal && S.reveal.phase === 'seq');
const seriesName = () => S.sets.find((s) => s.id === S.setId)?.name || 'Le Gang · Série 1';

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
    <nav class="cartes-tabs" id="cartes-tablist" role="tablist" aria-label="Sections du jeu">
      ${TABS.map(([id, label], i) => `<button type="button" role="tab" id="cartes-tab-${id}" class="cartes-tab" data-tab="${id}"
        aria-selected="${i === 0}" aria-controls="cartes-p-${id}" tabindex="${i === 0 ? 0 : -1}">${label}</button>`).join('')}
    </nav>
    ${TABS.map(([id]) => `<section role="tabpanel" id="cartes-p-${id}" class="cartes-panel" aria-labelledby="cartes-tab-${id}" ${id === 'boosters' ? '' : 'hidden'}>${id === 'echanges' ? '<div id="cartes-trades"></div>' : ''}</section>`).join('')}
    <details class="card cartes-block" id="cartes-history-wrap">
      <summary>Historique des Paillettes (30 derniers mouvements)</summary>
      <div id="cartes-history" class="cartes-block"></div>
    </details>
    <p id="cartes-live" class="visually-hidden" aria-live="polite"></p>

    <dialog id="cartes-detail" class="cartes-dialog" aria-labelledby="cartes-detail-title">
      <button type="button" class="cartes-close" data-action="close-dialog" aria-label="Fermer"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
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

/* ---------- En-tête : solde en pastille LCD ---------- */
function renderHeader() {
  const el = $('#cartes-wallet');
  if (!el || !S.state) return;
  const s = S.state;
  // Le solde affiché suit les gains par paliers (animateBalance) ; une dépense s'affiche tout de suite.
  if (S.lcdShown == null || bal() < S.lcdShown) S.lcdShown = bal();
  const daily = tableVal('rewards', 'daily') ?? 20;
  el.innerHTML = `
    ${pastilleHtml(S.lcdShown, { size: 'lg', id: 'cartes-lcd' })}
    ${isGod() ? '<span class="pill pill-current">Mode sans limite</span>' : ''}
    ${s.daily_available
      ? `<button type="button" class="btn btn-sand" data-action="daily">Passage du jour (+${fmtPaillettes(daily)})</button>
         <span class="cartes-small">Série actuelle : ${nf.format(s.daily_streak)} j</span>`
      : `<span class="pill pill-ok">Passage du jour pris · série de ${nf.format(s.daily_streak)} j</span>`}`;
  if (S.lcdShown < bal() && !S.lcdAnim) animateBalance();
}

// Gain : le compteur saute par paliers (4 au plus), chaque palier fait clignoter les segments et affiche +N.
function animateBalance() {
  const to = bal();
  const from = S.lcdShown;
  if (!motionAllowed() || to <= from) { S.lcdShown = to; lcdSet($('#cartes-lcd'), to); return; }
  S.lcdAnim = true;
  const gain = to - from;
  const steps = Math.min(4, gain);
  let k = 0;
  const tick = () => {
    k += 1;
    const v = k >= steps ? to : from + Math.round(gain * k / steps);
    const cur = $('#cartes-lcd');
    lcdDelta(cur, v - S.lcdShown);
    lcdBlink(cur);
    setTimeout(() => { S.lcdShown = v; lcdSet($('#cartes-lcd'), v); }, 240);
    if (k < steps) setTimeout(tick, 640);
    else setTimeout(() => {
      S.lcdAnim = false;
      if (bal() > S.lcdShown) animateBalance();
    }, 420);
  };
  tick();
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

/* ---------- Mise à l'échelle (cartouches et console dessinées à taille fixe) ---------- */
// Un élément .fit porte data-w (largeur de conception) et --h (hauteur de conception) ; son contenu .fit-in est mis à l'échelle.
function fitAll(root = document) {
  root.querySelectorAll('.fit').forEach((el) => {
    const w = Number(el.dataset.w) || 220;
    el.style.setProperty('--w', w);
    el.style.setProperty('--k', Math.min(1, (el.clientWidth / w) || 1));
  });
}

/* ---------- Cartouche de booster (concept « cartouche de jeu ») ---------- */
function cartridgeHtml({ free = false, ready = false } = {}) {
  const n = nf.format(cfg().booster_size ?? 5);
  const cls = ['cart-box', free && !ready ? 'is-idle' : ''].filter(Boolean).join(' ');
  return `<div class="${cls}" aria-hidden="true">`
    + '<div class="cart-body"></div><div class="cart-notch"></div>'
    + `<div class="cart-label"><div class="cart-label-fl"></div><div class="cart-scr"><img src="${esc(currentLogo())}" alt=""></div></div>`
    + '<p class="cart-lbl1">LE GANG</p>'
    + `<p class="cart-lbl2">${esc(seriesName())}</p>`
    + '<div class="cart-stripe"><i></i><i></i><i></i><i></i><i></i><i></i></div>'
    + '<div class="cart-ridge"></div>'
    + `<p class="cart-foot">${n} CARTES</p>`
    + (free && ready ? '<p class="cart-stk">Gratuit du jour</p>' : '')
    + '</div>';
}

/* ---------- Boosters ---------- */
function renderBoosters() {
  const el = $('#cartes-p-boosters');
  const c = cfg();
  const price = Number(c.booster_price ?? 100);
  const size = c.booster_size ?? 5;
  const rates = c.rates || {};
  const total = Object.values(rates).reduce((a, v) => a + Math.max(0, Number(v) || 0), 0) || 1;
  const canPay = isGod() || bal() >= price;
  const busy = isBusy();
  const odds = RARITIES.map((r) => `<tr><th scope="row">${esc(r.label)}</th><td>${pct((Number(rates[r.id]) || 0) / total * 100)}</td></tr>`).join('');

  el.innerHTML = `
    <section class="cart-shelf" aria-labelledby="cartes-shelf-h">
      <h2 id="cartes-shelf-h" class="visually-hidden">Boosters à ouvrir</h2>
      <div class="cart-tiles">
        <div class="cart-tile" id="cartes-free"></div>
        <div class="cart-tile" id="cartes-paid">
          <h2 class="cart-h">Booster payant</h2>
          <div class="fit cart-fit" data-w="220" style="--h:290"><div class="fit-in">${cartridgeHtml()}</div></div>
          <div class="cart-act">
            <button type="button" class="btn btn-ghost cart-btn" data-action="open-paid" ${busy || !canPay ? 'disabled' : ''}>Ouvrir un booster · ${pastilleHtml(price, { size: 'sm' })}</button>
            ${canPay ? '' : `<p class="muted small">Il te manque ${fmtPaillettes(price - bal())}</p>`}
          </div>
        </div>
      </div>
      <p class="muted small">Chaque booster contient ${plural(Number(size), 'carte', 'cartes')}. Le gratuit revient toutes les ${nf.format(c.free_booster_hours ?? 24)} h ; le payant coûte ${fmtPaillettes(price)}.</p>
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
    </section>`;
  renderFree();
  renderReveal();
  fitAll(el);
}

// Booster gratuit : cartouche + compte à rebours, ou bouton « Ouvrir » quand il est disponible.
function renderFree() {
  const box = $('#cartes-free');
  if (!box || !S.state) return;
  const at = S.state.free_booster_at ? new Date(S.state.free_booster_at).getTime() : 0;
  const ms = at - Date.now();
  const ready = ms <= 0;
  const busy = isBusy();
  if (box.dataset.ready === String(ready) && box.dataset.busy === String(busy)) {
    if (!ready) { const t = box.querySelector('.cartes-timer'); if (t) t.textContent = `Disponible dans ${fmtDuration(ms)}`; }
    return;
  }
  box.dataset.ready = String(ready);
  box.dataset.busy = String(busy);
  box.innerHTML = `
    <h2 class="cart-h">Booster gratuit</h2>
    <div class="fit cart-fit" data-w="220" style="--h:290"><div class="fit-in">${cartridgeHtml({ free: true, ready })}</div></div>
    <div class="cart-act">${ready
      ? `<button type="button" class="btn btn-primary cart-btn" data-action="open-free" ${busy ? 'disabled' : ''}>Ouvrir le booster gratuit</button>`
      : `<p class="cartes-timer" role="timer">Disponible dans ${fmtDuration(ms)}</p>`}
    </div>`;
  fitAll(box);
}

/* ---------- Ouverture : séquence d'animation (ou révélation directe) ---------- */
// Étapes : 1 cartouche insérée, 2 console « BOOT » et barre, 3 flash de la meilleure rareté,
// puis pour chaque carte i : 4+2i sortie par la fente, 5+2i retournement (révélation de la carte).
const lastStep = (R) => 4 + 2 * R.cards.length;
function seqDelay(s) {
  if (s === 0) return 80;
  if (s === 1) return 700;
  if (s === 2) return 1000;
  if (s === 3) return 520;
  return s % 2 === 0 ? 380 : 300;
}

function applyStage(R) {
  const root = $('#op-stage');
  if (!root) return;
  root.classList.toggle('is-in', R.step >= 1);
  root.classList.toggle('is-boot', R.step >= 2);
  root.classList.toggle('is-flash', R.step === 3);
  root.querySelectorAll('.op-card').forEach((card) => {
    const i = Number(card.dataset.i);
    card.classList.toggle('is-out', R.step >= 4 + 2 * i);
    card.classList.toggle('is-flip', R.step >= 5 + 2 * i);
  });
}

function startSeq(R) {
  const next = () => {
    R.timer = null;
    if (S.reveal !== R || R.phase !== 'seq') return;
    R.step += 1;
    if (R.step >= lastStep(R)) return finishSeq(R);
    applyStage(R);
    const s = R.step;
    if (s >= 5 && s % 2 === 1) revealCard(R, (s - 5) / 2);
    R.timer = setTimeout(next, seqDelay(s));
  };
  R.timer = setTimeout(next, seqDelay(R.step));
}

function revealCard(R, i) {
  const card = R.cards[i];
  if (!card) return;
  R.revealed.add(i);
  R.last = i;
  playSound(rarityRank(card.rarity) >= 5 ? 'badge' : 'click');
}

function finishSeq(R) {
  if (R.timer) clearTimeout(R.timer);
  R.timer = null;
  R.phase = 'done';
  R.step = lastStep(R);
  R.cards.forEach((_, i) => R.revealed.add(i));
  renderBoosters(); // réactive les cartouches et affiche le résumé
  $('#cartes-reveal [data-action="close-reveal"]')?.focus();
}

// « Tout révéler » : passe directement à la fin de la séquence.
function skipSeq() {
  const R = S.reveal;
  if (!R || R.phase !== 'seq') return;
  finishSeq(R);
}

function closeReveal() {
  if (S.reveal?.timer) clearTimeout(S.reveal.timer);
  S.reveal = null;
  renderBoosters();
}

// Contenu de la scène : cartouche, console, cartes en éventail (dos puis face).
function stageHtml(R) {
  const n = R.cards.length;
  const bestName = R.best ? rarityLabel(R.best) : 'aucune';
  const cards = R.cards.map((card, i) => {
    const off = i - (n - 1) / 2;
    return `<div class="op-card" data-i="${i}" style="--i:${off};--r:${off * 6}deg;--y:${330 + Math.abs(off) * 4};z-index:${10 + i}">`
      + `<div class="op-inner"><div class="op-face op-back">${cardBackHtml('sm')}</div>`
      + `<div class="op-face op-front">${cardHtml(card, { shiny: card.shiny, serial: card.serial, size: 'sm' })}</div></div></div>`;
  }).join('');
  const bars = Array.from({ length: 8 }, (_, k) => `<i style="--k:${k}"></i>`).join('');
  return `<div class="op-cart">${cartridgeHtml()}</div>`
    + '<div class="op-con"><div class="op-con-body"></div><div class="op-slot"></div>'
    + '<div class="op-scr"><div class="op-flash"></div>'
    + '<p class="op-l1">BOOT HG v1.0</p>'
    + `<p class="op-l2">LECTURE DU PAQUET ${n}/${n}</p>`
    + `<div class="op-bar">${bars}</div>`
    + `<p class="op-l3">&gt; MEILLEURE : ${esc(bestName.toUpperCase())}_</p></div>`
    + '<i class="op-led op-led1"></i><i class="op-led op-led2"></i><div class="op-tray"></div></div>'
    + cards;
}

function renderReveal() {
  const box = $('#cartes-reveal');
  if (!box) return;
  const R = S.reveal;
  if (!R) { box.innerHTML = ''; return; }
  const done = R.phase !== 'seq';
  const best = R.best ? rarityLabel(R.best) : '—';
  const body = R.seq
    ? `<div class="fit op-wrap" data-w="400" style="--h:520" aria-hidden="true"><div class="fit-in op-stage" id="op-stage" style="--fc:${tintOf(R.best)}">${stageHtml(R)}</div></div>`
    : `<div class="cartes-booster-grid">${R.cards.map((card) => cardHtml(card, { shiny: card.shiny, serial: card.serial, size: 'md' })).join('')}</div>`;
  const list = `<ul class="visually-hidden">${R.cards.map((c) => `<li>${esc(c.name)} : ${esc(rarityLabel(c.rarity))}${c.shiny ? ', brillante' : ''}</li>`).join('')}</ul>`;
  const actions = done
    ? `<p class="muted">Meilleure carte : ${esc(best)}</p>
       <button type="button" class="btn btn-primary" data-action="close-reveal">Fermer</button>`
    : '<button type="button" class="btn btn-ghost" data-action="reveal-all">Tout révéler</button>';
  box.innerHTML = `
    <section class="card cartes-block" aria-labelledby="cartes-reveal-h">
      <h2 id="cartes-reveal-h">Ton booster</h2>
      ${body}${list}
      <div class="cartes-row">${actions}</div>
    </section>`;
  if (R.seq) applyStage(R);
  fitAll(box);
  if (done && !R.announced) {
    R.announced = true;
    $('#cartes-live').textContent = `Booster ouvert. Meilleure carte : ${R.best ? rarityLabel(R.best) : 'aucune'}.`;
  }
}

async function openBooster(free) {
  if (isBusy()) return;
  S.busy = true;
  renderBoosters();
  let R = null;
  try {
    const { data, error } = await sb.rpc('hg_open_booster', { p_free: !!free });
    if (error) throw error;
    const cards = data?.cards || [];
    // Annonce Discord des belles cartes (vérifiée côté serveur par hg-notify)
    for (const c of cards) if (['legendaire', 'mythique', 'identite'].includes(c.rarity)) notify('card_pull', { card: c.card_id, rarity: c.rarity, shiny: c.shiny, serial: c.serial }).catch(() => {});
    const seq = motionAllowed() && cards.length > 0;
    R = { cards, best: data?.best, revealed: new Set(), last: -1, announced: false, seq, phase: seq ? 'seq' : 'done', step: 0, timer: null };
    if (!seq) R.cards.forEach((_, i) => R.revealed.add(i));
    S.reveal = R;
    await refreshData();
  } catch (e) {
    toast(errMsg(e), 'error');
  } finally {
    S.busy = false;
    renderAll();
    if (R && S.reveal === R && R.seq && R.phase === 'seq') {
      $('#cartes-live').textContent = 'Ouverture du booster en cours.';
      $('#cartes-reveal')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      startSeq(R);
    }
  }
}

async function claimDaily() {
  if (S.busy) return;
  S.busy = true;
  try {
    const { data, error } = await sb.rpc('hg_cards_daily');
    if (error) throw error;
    toast(`+${fmtP(data.gain)} · série de ${plural(data.streak, 'jour', 'jours')}`, 'ok');
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
    ? `<p>Tu vas recycler <strong>${plural(plan.ids.length, 'doublon', 'doublons')}</strong> pour environ <strong>${fmtPaillettes(plan.total)}</strong>.</p>
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
  else action = `<button type="button" class="btn btn-ghost cd-btn" data-action="recycle" data-copy="${esc(String(cp.id))}" ${S.busy ? 'disabled' : ''}>Recycler · ${fmtPaillettes(val)}</button>`;
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
    <p class="cd-meta">${esc(rarityLabel(k.rarity))} · ${esc(familyLabel(k.family))} · n° ${esc(k.number)}${k.max_copies ? ` · ${nf.format(k.max_copies)} exemplaires au total` : ''}</p>
    <button type="button" class="cd-wish${wished ? ' is-on' : ''}" data-action="wish" aria-pressed="${wished}">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="${wished ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>
      <span>${wished ? 'Dans ma liste de souhaits' : 'Ajouter à ma liste de souhaits'}</span>
    </button>
    ${k.flavor ? `<p class="cartes-flavor">${esc(k.flavor)}</p>` : ''}
    <section class="cd-sec">
      <h3 class="cd-h">Mes exemplaires</h3>
      ${n ? `<ul class="cartes-copies">${cps.map((cp) => copyRow(cp, k)).join('')}</ul>` : '<p class="cd-empty">Pas encore obtenue.</p>'}
    </section>
    <section class="cd-sec">
      <h3 class="cd-h">Fabriquer</h3>
      ${craftable
        ? `<ul class="cartes-copies">
            <li><span>Version normale</span><button type="button" class="btn btn-sand cd-btn" data-action="craft" data-shiny="0" ${S.busy || short(costN) ? 'disabled' : ''}>Fabriquer · ${fmtPaillettes(costN ?? 0)}</button></li>
            ${k.can_shiny ? `<li><span>Version brillante</span><button type="button" class="btn btn-ghost cd-btn" data-action="craft" data-shiny="1" ${S.busy || short(costS) ? 'disabled' : ''}>Fabriquer · ${fmtPaillettes(costS ?? 0)}</button></li>` : ''}
          </ul>
          ${short(costN) ? `<p class="cd-empty">Il te manque ${fmtPaillettes(costN - bal())} pour cette carte.</p>` : ''}`
        : '<p class="cd-empty">Cette carte ne peut pas être fabriquée.</p>'}
    </section>`;
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
          <span class="${d >= 0 ? 'cartes-delta-pos' : 'cartes-delta-neg'}">${d > 0 ? '+' : ''}${fmtPaillettes(d)}</span></li>`;
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
    case 'reveal-all': return skipSeq();
    case 'close-reveal': return closeReveal();
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
  window.addEventListener('resize', () => fitAll(app));
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
  // Pas de rafraîchissement quand l'onglet est caché ; une mise à jour immédiate au retour
  setInterval(() => { if (S.tab === 'boosters' && !document.hidden) renderFree(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.tab === 'boosters') renderFree(); });
}

boot();
