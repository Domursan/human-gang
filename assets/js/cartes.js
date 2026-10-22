// ===== Cartes à collectionner — page joueur =====
// RPC : hg_cards_me, hg_cards_daily, hg_open_booster_req (repli hg_open_booster), hg_card_recycle, hg_card_craft, hg_card_leaderboard.
// Lecture : hg_card_sets, hg_cards, hg_card_copies, hg_card_wishlist, hg_wallet_log. Rendu : cartes-ui.js.
// Collection d'un autre membre (lecture seule) : cartes.html#collection/<id> ; RPC hg_members pour le pseudo.
// Paillettes (icône, solde LCD) : paillettes.js. Tout le texte de l'interface est en français ; tout texte venant de la base passe par esc().
// Fichier de la page cartes.html : il n'exporte rien. boot() (en bas) lance la page.
// Plan : données, squelette, solde, onglets, boosters (cartouches, ouverture, révélation), collection,
// recyclage, fiche détail, collection d'un autre membre, classement, échanges, historique, événements, démarrage.
import { sb, initPage, toast, errMsg, esc, $, fmtDate, avatarHtml, playSound, motionAllowed, notify, currentLogo } from './core.js';
import { RARITIES, rarityLabel, rarityRank, FAMILIES, familyLabel, cardHtml, cardBackHtml, fmtP, serialLabel } from './cartes-ui.js';
import { fmtPaillettes, pastilleHtml, lcdSet, lcdDelta, lcdBlink } from './paillettes.js';
import { pluralCount } from './utils.js';
import { createZoom, ICON_ZOOM, TINT as RARITY_TINT } from './cartes-zoom.js';
import { keepPlace, holdHeight } from './cartes-place.js';

/* ---------- Constantes et outils de formatage ---------- */
// me : profil du membre connecté (initPage vérifie qu'il y a une session membre avant la suite).
const me = await initPage({ auth: 'member' });
const app = $('#app');
const nf = new Intl.NumberFormat('fr-CH'); // nombres à la suisse (1'234)
/** Pourcentage à deux décimales maximum, ex. « 12,5 % ». */
const pct = (v) => `${new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 2 }).format(v)} %`;
// Onglets : [identifiant, libellé]. L'ordre est celui de l'affichage et des flèches clavier.
const TABS = [['boosters', 'Boosters'], ['collection', 'Collection'], ['classement', 'Classement'], ['echanges', 'Échanges']];
// Libellés des sources d'une carte (colonne source de hg_card_copies).
const SOURCE_LABEL = { booster: 'Booster', cadeau: 'Cadeau', admin: 'Attribuée par le gang', fabrication: 'Fabriquée', evenement: 'Événement', echange: 'Échange' };
// Libellés du journal des Paillettes (hg_wallet_log.reason), affichés dans l'historique.
const REASON_LABEL = {
  quotidien: 'Passage du jour', booster: 'Booster ouvert', recyclage: 'Recyclage', fabrication: 'Fabrication',
  serie_complete: 'Série complétée', reponse_sortie: 'Réponse à une sortie', presence: 'Présence à une sortie', photo: 'Photo partagée',
  moment: 'Moment culte', badge: 'Badge obtenu', capture: 'Capture d’événement', sortie_creee: 'Sortie créée',
  cadeau_santa: 'Cadeau Secret Santa', echange: 'Échange de cartes', admin: 'Ajustement du gang',
  quete: 'Quête de la semaine', defi: 'Défi du gang', don_admin: 'Don du gang',
};
// Couleur de lueur de l'écran de console selon la rareté (maquette « cartouche ») : table partagée avec cartes-zoom.js (RARITY_TINT = TINT).
// Tint (couleur d'accent) de la console selon la rareté ; repli sur la couleur de l'identité.
const tintOf = (r) => RARITY_TINT[r] || '#FBD32D';
// Ouverture groupée : nombre de boosters payants ouverts d'un coup, et délai entre deux cartes révélées.
const MULTI_COUNT = 5;
const MULTI_STEP_MS = 110;
// Valeur du sélecteur « Toutes les séries » (Collection) : toutes les séries ouvertes, groupées.
const ALL = '__all__';
/** Enveloppe une fonction de rendu pour qu'elle garde la place de l'utilisateur (défilement de la page et des zones data-keep). */
const kept = (fn) => (...args) => keepPlace(() => fn(...args));

/* ---------- État de la page ----------
   S regroupe tout l'état : données chargées (sets, cards, copies, state), onglet et filtres, ouverture en cours
   (reveal, busy), collection d'un membre (peer), échanges (tradeApi). */
const S = {
  state: null, sets: [], cards: [], cardsById: new Map(), copies: [], wish: new Set(), log: [],
  tab: 'boosters', setId: null, filters: { rarity: '', family: '', owned: 'all' },
  reveal: null, busy: false, detailId: null, tradesMounted: false, massIds: [],
  lcdShown: null, lcdAnim: false, quests: null, shownIds: [],
  peer: null, returnY: 0, tradeApi: null, tradesReady: null,
};
/** Configuration du jeu (tarifs, taux, durées) renvoyée par hg_cards_me. Vide avant le premier chargement. */
const cfg = () => S.state?.config || {};
/** Vrai pour un admin en mode sans limite (pas de coûts ni de délais). */
const isGod = () => !!S.state?.god;
/** Solde en Paillettes. */
const bal = () => Number(S.state?.paillettes ?? 0);
/** Vrai si une série a commencé (ou n'a pas de date de début). */
const started = (s) => !s.starts_at || new Date(s.starts_at) <= new Date();
/** Exemplaires de l'utilisateur pour une carte. */
const copiesOf = (cardId) => S.copies.filter((c) => c.card_id === cardId);
/** Valeur d'une table de réglages pour une rareté (ex. craft.rare), ou null si absente. */
const tableVal = (table, rarity) => { const v = cfg()[table]?.[rarity]; return v == null ? null : Number(v); };
/**
 * Durée lisible : « 3 h 05 min » ou « 12 min » (au moins 1 min).
 * @param {number} ms durée en millisecondes
 */
const fmtDuration = (ms) => {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${Math.max(1, m)} min`;
};
/** Vrai pendant une action en cours (appel réseau ou séquence d'ouverture) : les boutons restent désactivés. */
const isBusy = () => S.busy || !!(S.reveal && S.reveal.phase === 'seq');
/** Nom de la série affichée dans la cartouche (la plus récente à défaut). */
const seriesName = () => S.sets.find((s) => s.id === S.setId)?.name || S.sets.at(-1)?.name || 'Le Gang · Série 1';
// Une seule fenêtre de carte agrandie : elle suit la vue affichée (collection ou collection d'un membre).
const zoom = createZoom({ ids: () => (S.peer ? S.peer.shownIds : S.shownIds), info: (id) => (S.peer ? peerZoomInfo(id) : zoomInfo(id)) });

/* ---------- Données ---------- */
/**
 * Lit toutes les lignes d'une requête (l'API renvoie au plus 1000 lignes par appel). Continue tant qu'une page est pleine.
 * @param {() => object} build fonction qui renvoie une nouvelle requête
 * @param {number} [page] taille d'une page
 * @returns {Promise<object[]>}
 */
async function fetchAllRows(build, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build().range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < page) return out;
  }
}

/* ---------- Chargement des données ---------- */
/**
 * Charge les séries ouvertes (dont la date de début est passée) et leurs cartes actives.
 * Seules les cartes des séries ouvertes sont lues ; les autres sont chargées plus tard si on les possède.
 * @returns {Promise<void>} lève une erreur si la lecture des séries échoue
 */
async function loadStatic() {
  const sets = await sb.from('hg_card_sets').select('*').eq('active', true).order('sort');
  if (sets.error) throw sets.error;
  S.sets = (sets.data || []).filter(started);
  // Seulement les cartes des séries ouvertes (il y en a des milliers au total), en lisant toutes les pages
  const setIds = S.sets.map((x) => x.id);
  S.cards = setIds.length
    ? await fetchAllRows(() => sb.from('hg_cards').select('*').eq('active', true).in('set_id', setIds).order('number').order('id'))
    : [];
  S.cardsById = new Map(S.cards.map((c) => [c.id, c]));
  if (S.setId !== ALL && !S.sets.some((s) => s.id === S.setId)) S.setId = S.sets.at(-1)?.id || null;
}

/**
 * Recharge l'état du membre : solde et configuration (hg_cards_me), ses exemplaires non recyclés,
 * sa liste de souhaits et le journal des Paillettes. Les cartes qu'il possède mais qui ne sont
 * pas dans une série ouverte sont chargées en plus.
 * @returns {Promise<void>} lève la première erreur rencontrée
 */
async function refreshData() {
  // Les quatre lectures partent en parallèle ; une erreur sur l'une d'elles fait échouer le tout (voir plus bas).
  const [st, cp, wi, lg] = await Promise.all([
    sb.rpc('hg_cards_me'),
    fetchAllRows(() => sb.from('hg_card_copies').select('id,card_id,owner_id,shiny,serial,source,obtained_at,locked_trade').eq('owner_id', me.id).is('recycled_at', null).order('obtained_at').order('id'))
      .then((data) => ({ data, error: null }), (error) => ({ data: null, error })),
    sb.from('hg_card_wishlist').select('card_id').eq('user_id', me.id),
    sb.from('hg_wallet_log').select('delta,reason,created_at').eq('user_id', me.id).neq('reason', 'booster_requete').order('created_at', { ascending: false }).limit(30),
  ]);
  for (const r of [st, cp, wi, lg]) if (r.error) throw r.error;
  S.state = st.data;
  S.copies = cp.data || [];
  // Cartes possédées qui n'appartiennent pas à une série ouverte (série fermée depuis) : on les charge aussi
  const missing = [...new Set(S.copies.map((c) => c.card_id))].filter((id) => !S.cardsById.has(id));
  for (let i = 0; i < missing.length; i += 150) {
    const r = await sb.from('hg_cards').select('*').in('id', missing.slice(i, i + 150));
    if (r.error) throw r.error;
    for (const c of r.data || []) S.cardsById.set(c.id, c);
  }
  S.wish = new Set((wi.data || []).map((w) => w.card_id));
  S.log = lg.data || [];
}

/* ---------- Squelette ---------- */
/**
 * HTML de la page : en-tête, onglets, panneaux (un par onglet), fiche membre, historique et deux fenêtres
 * (détail d'une carte, recyclage de masse). Le contenu des panneaux est rempli ensuite par les fonctions de rendu.
 * @returns {string}
 */
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
    <section class="cartes-peer" id="cartes-peer" hidden></section>
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
/** Dessine l'en-tête : solde (pastille LCD), passage du jour, série de jours. */
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

/**
 * Anime le solde après un gain : le compteur saute par paliers (4 au plus), chaque palier fait clignoter
 * les segments et affiche +N. Sans mouvement (préférence d'accessibilité), le solde change d'un coup.
 */
function animateBalance() {
  const to = bal();
  const from = S.lcdShown;
  if (!motionAllowed() || to <= from) { S.lcdShown = to; lcdSet($('#cartes-lcd'), to); return; }
  S.lcdAnim = true;
  const gain = to - from;
  const steps = Math.min(4, gain);
  let k = 0;
  /** Un palier du compteur : fait avancer le solde affiché, clignote les segments, puis programme le palier suivant. */
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

/* ---------- Onglets et vues ---------- */
/** Met à jour l'état ARIA des onglets (sélectionné ou non), puis affiche la bonne vue. */
function showTab() {
  for (const [id] of TABS) {
    const on = S.tab === id;
    const tab = $(`#cartes-tab-${id}`);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  applyView();
}

/**
 * Affiche la vue courante : les onglets (cas normal) ou la collection d'un membre (S.peer), qui remplace les onglets.
 */
function applyView() {
  const peer = !!S.peer;
  $('#cartes-tablist').hidden = peer;
  $('#cartes-history-wrap').hidden = peer;
  for (const [id] of TABS) $(`#cartes-p-${id}`).hidden = peer || S.tab !== id;
  $('#cartes-peer').hidden = !peer;
}

/**
 * Dessine le panneau de l'onglet courant. Chaque rendu garde la place de l'utilisateur :
 * la page ne remonte pas en haut après une action.
 */
function renderTab() {
  keepPlace(() => {
    if (S.tab === 'boosters') renderBoosters();
    else if (S.tab === 'collection') renderCollection();
    else if (S.tab === 'classement') return renderLeaderboard();
    else if (S.tab === 'echanges') mountTradesOnce();
  });
}

/**
 * Change d'onglet puis dessine le nouveau panneau.
 * @param {string} id identifiant de l'onglet (boosters, collection, classement, echanges)
 */
function setTab(id) {
  keepPlace(() => {
    S.tab = id;
    showTab();
    renderTab();
  });
}

/** Redessine toute la page (en-tête, historique, onglets, panneau courant). */
function renderAll() {
  keepPlace(() => {
    renderHeader();
    renderHistory();
    showTab();
    renderTab();
  });
}

/* ---------- Mise à l'échelle (cartouches et console dessinées à taille fixe) ---------- */
// Un élément .fit porte data-w (largeur de conception) et --h (hauteur de conception) ; son contenu .fit-in est mis à l'échelle.
/**
 * Met à l'échelle les cartouches et consoles à la largeur réelle de leur conteneur (jamais agrandies au-delà de 1).
 * @param {ParentNode} [root] zone à parcourir
 */
function fitAll(root = document) {
  root.querySelectorAll('.fit').forEach((el) => {
    const w = Number(el.dataset.w) || 220;
    el.style.setProperty('--w', w);
    el.style.setProperty('--k', Math.min(1, (el.clientWidth / w) || 1));
  });
}

/* ---------- Cartouche de booster (concept « cartouche de jeu ») ---------- */
/**
 * HTML d'une cartouche de booster (décor seulement, aria-hidden).
 * @param {{free?: boolean, ready?: boolean}} [opts] free : booster gratuit ; ready : gratuit disponible maintenant
 * @returns {string}
 */
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
/**
 * Dessine l'onglet Boosters : boosters gratuit et payant (avec ouverture groupée), boosters offerts,
 * quêtes, séquence ou révélation en cours, et tableau des chances. Les boutons restent désactivés si le
 * solde ne suffit pas ou si une action est en cours.
 */
function drawBoosters() {
  const el = $('#cartes-p-boosters');
  const c = cfg();
  const price = Number(c.booster_price ?? 100);
  const size = c.booster_size ?? 5;
  const rates = c.rates || {};
  const total = Object.values(rates).reduce((a, v) => a + Math.max(0, Number(v) || 0), 0) || 1;
  const canPay = isGod() || bal() >= price;
  // Reprise d'une ouverture groupée interrompue : on propose les boosters restants.
  const k5 = pendingX5();
  const canPay5 = isGod() || bal() >= price * k5;
  const busy = isBusy();
  // Boosters offerts (stock donné par le gang) : ouverts sans Paillettes ni délai, même animation.
  const gift = Math.max(0, Number(S.state?.gift_boosters) || 0);
  // Le tableau des chances affiche chaque rareté en pourcentage de la somme des taux.
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
            <button type="button" class="btn btn-ghost cart-btn" data-action="open-paid-x5" ${busy || !canPay5 ? 'disabled' : ''}>${k5 === 1 ? 'Ouvrir le dernier booster' : `Ouvrir ${nf.format(k5)} boosters`} · ${pastilleHtml(price * k5, { size: 'sm' })}</button>
            ${canPay ? '' : `<p class="muted small">Il te manque ${fmtPaillettes(price - bal())}</p>`}
            ${canPay5 ? '' : `<p class="muted small">Pour ${nf.format(k5)} boosters, il te manque ${fmtPaillettes(price * k5 - bal())}</p>`}
          </div>
        </div>
      </div>
      ${gift > 0 ? `<section class="card cartes-block cart-gift" id="cartes-gift" aria-labelledby="cartes-gift-h">
        <h2 class="cart-h" id="cartes-gift-h">Boosters offerts</h2>
        <p class="muted small">Le gang t'en a offert ${pluralCount(gift, 'booster', 'boosters', nf.format)}. Ils s'ouvrent sans Paillettes et sans délai.</p>
        <button type="button" class="btn btn-primary cart-btn" data-action="open-gift" ${busy ? 'disabled' : ''}>Ouvrir un booster offert (${nf.format(gift)} restant${gift > 1 ? 's' : ''})</button>
      </section>` : ''}
      <p class="muted small">Chaque booster contient ${pluralCount(Number(size), 'carte', 'cartes', nf.format)}. Le gratuit revient toutes les ${nf.format(c.free_booster_hours ?? 24)} h ; le payant coûte ${fmtPaillettes(price)}.</p>
    </section>
    <section class="card cartes-block cq" id="cartes-quests" aria-labelledby="cartes-quests-h"></section>
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
  renderQuests();
  fitAll(el);
}
// Versions « qui gardent la place » des fonctions de dessin (voir kept).
const renderBoosters = kept(drawBoosters);

/* ---------- Quêtes de la semaine (3 par semaine, lundi 00:00 heure de Zurich) ---------- */
// Chargées à part : un échec de ces quêtes ne bloque pas le reste de la page.
/** Charge les quêtes de la semaine (hg_card_quests_me). En cas d'erreur, la section l'indique sans bloquer la page. */
async function loadQuests() {
  try {
    const { data, error } = await sb.rpc('hg_card_quests_me');
    if (error) throw error;
    S.quests = data || { quests: [] };
  } catch (e) {
    console.warn('[quêtes]', e);
    S.quests = { error: true };
  }
  renderQuests();
}

/**
 * Une ligne de quête : libellé, barre de progression, et état (en cours, à réclamer, reçue).
 * @param {object} q quête (code, label, target, progress, reward, done, claimed)
 * @returns {string}
 */
function questHtml(q) {
  const target = Math.max(1, Number(q.target) || 1);
  const value = Math.min(Math.max(0, Number(q.progress) || 0), target);
  const pctDone = Math.round((value / target) * 100);
  const state = q.claimed
    ? '<span class="pill pill-ok">Récompense reçue</span>'
    : q.done
      ? `<button type="button" class="btn btn-sand cq-btn" data-action="quest-claim" data-code="${esc(q.code)}" ${S.busy ? 'disabled' : ''}>Réclamer · ${fmtPaillettes(q.reward)}</button>`
      : '<span class="pill pill-current">En cours</span>';
  return `<li class="cq-item${q.claimed ? ' is-claimed' : ''}">
      <div class="cq-main">
        <p class="cq-label">${esc(q.label)}</p>
        <div class="progress cq-bar" role="progressbar" aria-label="${esc(q.label)}" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${value}" aria-valuetext="${nf.format(value)} sur ${nf.format(target)}">
          <span style="width:${pctDone}%"></span>
        </div>
        <p class="cartes-small cq-count">${nf.format(value)} / ${nf.format(target)} · récompense ${fmtPaillettes(q.reward)}</p>
      </div>
      <div class="cq-act">${state}</div>
    </li>`;
}

/** Dessine la section des quêtes : chargement, erreur, liste vide ou liste des quêtes. */
function drawQuests() {
  const box = $('#cartes-quests');
  if (!box) return;
  const Q = S.quests;
  const head = '<h2 id="cartes-quests-h">Quêtes de la semaine</h2>';
  // Encart « Questions du gang » : toujours affiché sous les quêtes, même pendant le chargement ou en erreur
  const encart = '<p class="cq-encart">Questions du gang : gagne des Paillettes en répondant aux questions de l’admin, sur la page <a href="quiz.html">Questions du gang</a>.</p>';
  if (!Q) { box.innerHTML = `${head}<p class="muted small">Chargement des quêtes…</p>${encart}`; return; }
  if (Q.error) { box.innerHTML = `${head}<p class="muted small">Quêtes indisponibles pour le moment.</p>${encart}`; return; }
  const list = Q.quests || [];
  if (!list.length) { box.innerHTML = `${head}<p class="muted small">Aucune quête cette semaine.</p>${encart}`; return; }
  const done = list.filter((q) => q.done).length;
  box.innerHTML = `${head}
    <p class="cartes-small">${nf.format(done)} sur ${nf.format(list.length)} terminée${done > 1 ? 's' : ''}${Q.ends_at ? ` · nouvelles quêtes le lundi suivant (${esc(fmtDate(Q.ends_at))})` : ''}.</p>
    <ul class="cq-list">${list.map(questHtml).join('')}</ul>
    ${encart}`;
}
const renderQuests = kept(drawQuests);

/**
 * Réclame la récompense d'une quête (hg_card_quest_claim), puis recharge les données.
 * @param {string} code identifiant de la quête
 */
async function claimQuest(code) {
  if (S.busy) return;
  S.busy = true;
  renderQuests();
  try {
    const { data, error } = await sb.rpc('hg_card_quest_claim', { p_code: code });
    if (error) throw error;
    toast(`Quête terminée : +${fmtP(data?.reward ?? 0)}`, 'ok');
    await refreshData();
  } catch (e) {
    toast(errMsg(e), 'error');
  } finally {
    S.busy = false;
    await loadQuests();
    renderAll();
  }
}

// Booster gratuit : cartouche + compte à rebours, ou bouton « Ouvrir » quand il est disponible.
/**
 * Dessine le booster gratuit. Ne redessine que si son état (disponible ou non, occupé ou non) change ;
 * sinon met seulement le compte à rebours à jour, pour ne pas perdre le focus.
 */
function drawFree() {
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
const renderFree = kept(drawFree);

/* ---------- Ouverture : séquence d'animation (ou révélation directe) ---------- */
// Étapes : 1 cartouche insérée, 2 console « BOOT » et barre, 3 flash de la meilleure rareté,
// puis pour chaque carte i : 4+2i sortie par la fente, 5+2i retournement (révélation de la carte).
/**
 * Numéro de la dernière étape de la séquence d'un booster (la fin d'animation).
 * @param {{cards: object[]}} R ouverture en cours
 * @returns {number}
 */
const lastStep = (R) => 4 + 2 * R.cards.length;
/**
 * Durée (ms) de l'étape s : pause plus longue pour les étapes d'installation, puis alternance rapide.
 * @param {number} s numéro de l'étape
 * @returns {number}
 */
function seqDelay(s) {
  if (s === 0) return 80;
  if (s === 1) return 700;
  if (s === 2) return 1000;
  if (s === 3) return 520;
  return s % 2 === 0 ? 380 : 300;
}

/**
 * Applique à la scène les classes correspondant à l'étape courante (inséré, boot, flash, sorties et retournements).
 * @param {object} R ouverture en cours
 */
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

/**
 * Lance la séquence d'ouverture d'un booster : une étape après l'autre, à intervalle variable (seqDelay).
 * Chaque étape peut être interrompue par « Tout révéler » (skipSeq).
 * @param {object} R ouverture en cours
 */
function startSeq(R) {
  /** Passe à l'étape suivante ; à la fin, termine la séquence. */
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

/**
 * Marque la carte i comme révélée et joue un son (plus fort pour une rareté à partir de légendaire).
 * @param {object} R ouverture en cours
 * @param {number} i index de la carte
 */
function revealCard(R, i) {
  const card = R.cards[i];
  if (!card) return;
  R.revealed.add(i);
  playSound(rarityRank(card.rarity) >= 5 ? 'badge' : 'click');
}

/**
 * Termine la séquence : toutes les cartes sont révélées, les boutons se réactivent, le focus va à « Fermer ».
 * @param {object} R ouverture en cours
 */
function finishSeq(R) {
  if (R.timer) clearTimeout(R.timer);
  R.timer = null;
  R.phase = 'done';
  R.step = lastStep(R);
  R.cards.forEach((_, i) => R.revealed.add(i));
  renderBoosters(); // réactive les cartouches et affiche le résumé
  $('#cartes-reveal [data-action="close-reveal"]')?.focus({ preventScroll: true });
}

// « Tout révéler » : passe directement à la fin de la séquence.
/** Bouton « Tout révéler » : termine tout de suite l'ouverture en cours (simple ou groupée). */
function skipSeq() {
  const R = S.reveal;
  if (!R || R.phase !== 'seq') return;
  if (R.multi) finishMulti(R);
  else finishSeq(R);
}

/* ---------- Révélation groupée (ouverture de plusieurs boosters) ---------- */
/** Titre du résumé d'une ouverture groupée : « 5 boosters · 25 cartes · meilleure : Rare ». */
const multiHead = (R) => `${pluralCount(R.opened, 'booster', 'boosters', nf.format)}${R.opened < R.total ? ` sur ${nf.format(R.total)}` : ''}`
  + ` · ${pluralCount(R.cards.length, 'carte', 'cartes', nf.format)}`
  + (R.best ? ` · meilleure : ${rarityLabel(R.best)}` : '');
/** Ligne sous le résumé : nombre de cartes nouvelles pour la collection et de brillantes. */
const multiSub = (R) => pluralCount(R.fresh, 'nouvelle pour ta collection', 'nouvelles pour ta collection', nf.format)
  + (R.shinies ? ` · ${pluralCount(R.shinies, 'brillante', 'brillantes', nf.format)}` : '');

// Grille de toutes les cartes obtenues, la plus rare en premier ; les cartes non encore révélées montrent le dos.
/**
 * HTML de la grille d'une ouverture groupée : chaque carte est un dos tant qu'elle n'est pas révélée.
 * @param {object} R ouverture groupée
 * @returns {string}
 */
function multiHtml(R) {
  const done = R.phase !== 'seq';
  const cells = R.cards.map((card, i) => {
    const rank = rarityRank(card.rarity);
    const cls = ['x5-cell', R.revealed.has(i) ? '' : 'is-pending', card.shiny ? 'is-shiny' : '', rank >= 5 ? 'is-top' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" id="x5-c${i}" data-rank="${rank}">`
      + `<div class="x5-back">${cardBackHtml('sm')}</div>`
      + `<div class="x5-front">${cardHtml(card, { shiny: card.shiny, serial: card.serial, size: 'sm' })}</div></div>`;
  }).join('');
  const list = `<ul class="visually-hidden">${R.cards.map((c) => `<li>${esc(c.name)} : ${esc(rarityLabel(c.rarity))}${c.shiny ? ', brillante' : ''}</li>`).join('')}</ul>`;
  const actions = done
    ? '<button type="button" class="btn btn-primary" data-action="close-reveal">Fermer</button>'
    : '<button type="button" class="btn btn-ghost" data-action="reveal-all">Tout révéler</button>';
  return `
    <section class="card cartes-block" aria-labelledby="cartes-reveal-h">
      <h2 id="cartes-reveal-h">Tes boosters</h2>
      <div class="x5-sum">
        <p class="x5-head">${esc(multiHead(R))}</p>
        <p class="cartes-small">${esc(multiSub(R))}</p>
        ${done && R.note ? `<p class="muted small">${esc(R.note)}</p>` : ''}
      </div>
      <div class="x5-grid" aria-hidden="true">${cells}</div>${list}
      <div class="cartes-row">${actions}</div>
    </section>`;
}

/**
 * Dessine la révélation groupée dans `box`, et annonce le résumé aux lecteurs d'écran une seule fois à la fin.
 * @param {HTMLElement} box zone de la révélation
 * @param {object} R ouverture groupée
 */
function renderMultiReveal(box, R) {
  box.innerHTML = multiHtml(R);
  if (R.phase !== 'seq' && !R.announced) {
    R.announced = true;
    $('#cartes-live').textContent = `Boosters ouverts. ${multiHead(R)}. ${multiSub(R)}.`;
  }
}

/** Ferme la révélation (simple ou groupée) et redessine les boosters. */
function closeReveal() {
  if (S.reveal?.timer) clearTimeout(S.reveal.timer);
  S.reveal = null;
  renderBoosters();
}

// Contenu de la scène : cartouche, console, cartes en éventail (dos puis face).
/**
 * HTML de la scène d'ouverture : cartouche, console (BOOT, barre, meilleure rareté) et cartes en éventail.
 * @param {object} R ouverture en cours
 * @returns {string}
 */
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

/** Dessine la révélation d'un booster simple (scène animée ou grille directe). Ne fait rien s'il n'y en a pas. */
function renderReveal() {
  const box = $('#cartes-reveal');
  if (!box) return;
  const R = S.reveal;
  if (!R) { box.innerHTML = ''; return; }
  if (R.multi) { renderMultiReveal(box, R); return; }
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

// Identifiant d'une demande d'ouverture (un par booster) : le serveur ne rouvre pas deux fois la même demande.
/** Crée un identifiant de demande (UUID si le navigateur sait en faire, sinon un repli horodaté). */
const newReqId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Appel d'ouverture : hg_open_booster_req (migrations 021 et 042) ; repli sur l'ancienne RPC si elle n'est pas encore déployée.
// Un booster offert (offert = true, migration 042) n'a pas de repli : l'ancienne RPC ouvrirait un booster payant.
/**
 * Ouvre un booster côté serveur.
 * @param {boolean} free true pour le booster gratuit
 * @param {string} reqId identifiant de la demande (le serveur ne rouvre pas deux fois la même demande)
 * @param {boolean} [offert=false] true pour un booster offert (pas de repli sur l'ancienne RPC)
 * @returns {Promise<object>} résultat : cartes, meilleure rareté, nombre demandé et livré
 */
async function rpcOpenBooster(free, reqId, offert = false) {
  if (offert) {
    const { data, error } = await sb.rpc('hg_open_booster_req', { p_free: false, p_request: reqId, p_offert: true });
    if (error) throw error;
    if (data == null) throw new Error('Les boosters offerts ne sont pas encore disponibles. Réessaie plus tard.');
    return data;
  }
  let { data, error } = await sb.rpc('hg_open_booster_req', { p_free: !!free, p_request: reqId });
  // Repli sur l'ancienne fonction seulement si la nouvelle n'existe pas (PGRST202) : une réponse « null » sans erreur n'en est pas une.
  if (error && /hg_open_booster_req|PGRST202|not find|introuvable/i.test(`${error.code || ''} ${error.message || ''}`)) {
    ({ data, error } = await sb.rpc('hg_open_booster', { p_free: !!free }));
  }
  if (error) throw error;
  return data;
}

// Annonce Discord des belles cartes et alerte des membres qui les souhaitent (vérifiées côté serveur par hg-notify).
/**
 * Envoie les notifications après une ouverture : cartes légendaires, mythiques ou identité, et alerte des
 * membres qui souhaitent ces cartes. Les erreurs sont ignorées (une notification ne doit pas casser l'ouverture).
 * @param {object[]} cards cartes obtenues
 */
function announceCards(cards) {
  for (const c of cards) if (['legendaire', 'mythique', 'identite'].includes(c.rarity)) notify('card_pull', { card: c.card_id, rarity: c.rarity, shiny: c.shiny, serial: c.serial }).catch(() => {});
  if (cards.length) notify('card_wish', { cards: cards.map((c) => c.card_id) }).catch(() => {}); // alerte des membres qui souhaitent ces cartes (opt-in)
}

/**
 * Ouvre un booster (gratuit, payant ou offert), puis lance sa révélation.
 * La même demande garde le même identifiant tant qu'elle n'a pas abouti (voir S.bootReq).
 * @param {boolean} free true pour le booster gratuit du jour
 * @param {boolean} [offert=false] true pour un booster offert par le gang
 * @returns {Promise<void>}
 */
async function openBooster(free, offert = false) {
  if (isBusy()) return;
  S.busy = true;
  renderBoosters();
  let R = null;
  // Une même demande garde le même identifiant tant qu'elle n'a pas abouti :
  // si la réponse se perd et que l'utilisateur relance, le serveur ne rouvre pas de booster.
  const mode = offert ? 'offert' : free ? 'gratuit' : 'payant';
  if (!S.bootReq || S.bootReq.mode !== mode) S.bootReq = { mode, id: newReqId() };
  try {
    const data = await rpcOpenBooster(free, S.bootReq.id, offert);
    S.bootReq = null;
    const cards = data?.cards || [];
    // Nombre réellement livré (peut être inférieur au nombre payé si le tirage n'a pas trouvé de carte)
    const asked = Number(data?.demandees) || cards.length;
    const got = Number(data?.livrees) || cards.length;
    if (got < asked) toast(`${got} carte${got > 1 ? 's' : ''} livrée${got > 1 ? 's' : ''} sur ${asked} : le tirage n'a pas trouvé de carte pour certains emplacements.`);
    announceCards(cards);
    // Animation seulement si la préférence de mouvement le permet et qu'il y a des cartes.
    const seq = motionAllowed() && cards.length > 0;
    R = { cards, best: data?.best, revealed: new Set(), announced: false, seq, phase: seq ? 'seq' : 'done', step: 0, timer: null };
    if (!seq) R.cards.forEach((_, i) => R.revealed.add(i));
    S.reveal = R;
    await refreshData();
  } catch (e) {
    if (String(e?.message || '').includes('booster_deja_ouvert')) {
      // Le serveur a déjà traité cette demande : on ne la renvoie pas, on recharge l'état.
      S.bootReq = null;
      toast('Ce booster a déjà été ouvert. Ton inventaire est à jour.');
      await refreshData().catch(() => {});
    } else {
      toast(errMsg(e), 'error');
    }
  } finally {
    S.busy = false;
    renderAll();
    loadQuests(); // l'ouverture d'un booster fait avancer les quêtes
    if (R && S.reveal === R && R.seq && R.phase === 'seq') {
      $('#cartes-live').textContent = 'Ouverture du booster en cours.';
      $('#cartes-reveal')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      startSeq(R);
    }
  }
}

/* ---------- Ouverture de plusieurs boosters d'un coup ---------- */
// Plusieurs appels successifs à la même RPC, chacun avec son propre identifiant de demande.
// S.x5 garde ces identifiants tant que la série n'est pas terminée : après un arrêt (solde, réseau),
// une relance ne renvoie que les boosters restants, sans jamais en ouvrir deux fois.
/** Nombre de boosters restant à ouvrir dans la série en cours (MULTI_COUNT si aucune série n'a été interrompue). */
const pendingX5 = () => (S.x5 ? S.x5.ids.length - S.x5.next : MULTI_COUNT);

// Tri de la révélation : la carte la plus rare d'abord, les brillantes avant, puis le numéro de la série.
/** Comparaison pour trier les cartes : rareté décroissante, brillantes d'abord, puis numéro croissant. */
const byRarityDesc = (a, b) => (rarityRank(b.rarity) - rarityRank(a.rarity))
  || (Number(!!b.shiny) - Number(!!a.shiny))
  || ((Number(a.number) || 0) - (Number(b.number) || 0));

/**
 * Ouvre d'un coup la série de boosters payants (MULTI_COUNT, ou les restants si une série a été interrompue).
 * Les ouvertures sont faites une à une ; à la première erreur, on s'arrête et on garde l'état pour reprendre.
 * @returns {Promise<void>}
 */
async function openBoostersMulti() {
  if (isBusy()) return;
  S.busy = true;
  renderBoosters();
  if (!S.x5) {
    S.x5 = { ids: Array.from({ length: MULTI_COUNT }, newReqId), next: 0, opened: 0, cards: [], owned: new Set(S.copies.map((c) => c.card_id)) };
  }
  const st = S.x5;
  const total = st.ids.length;
  let stopMsg = '';
  while (st.next < total) {
    const i = st.next;
    try {
      const data = await rpcOpenBooster(false, st.ids[i]);
      const cards = data?.cards || [];
      st.cards.push(...cards);
      st.opened += 1;
      st.next = i + 1;
      announceCards(cards);
    } catch (e) {
      if (String(e?.message || '').includes('booster_deja_ouvert')) {
        st.next = i + 1; // le serveur a déjà traité cette demande : on ne la renvoie pas
        stopMsg = 'Ce booster a déjà été ouvert. Ton inventaire est à jour.';
      } else {
        stopMsg = errMsg(e);
      }
      break; // on s'arrête à la première erreur : les boosters suivants ne sont pas ouverts
    }
  }
  if (st.next >= total) S.x5 = null; // série terminée : rien à reprendre
  let R = null;
  if (st.cards.length) {
    const cards = [...st.cards].sort(byRarityDesc);
    const seq = motionAllowed();
    R = {
      multi: true, cards, opened: st.opened, total, best: cards[0].rarity,
      fresh: new Set(cards.filter((c) => !st.owned.has(c.card_id)).map((c) => c.card_id)).size,
      shinies: cards.filter((c) => c.shiny).length,
      note: stopMsg ? `Ouverture interrompue : ${stopMsg}` : '',
      seq, phase: seq ? 'seq' : 'done', revealed: new Set(), timer: null, announced: false,
    };
    if (!seq) cards.forEach((_, i) => R.revealed.add(i));
    S.reveal = R;
  }
  if (stopMsg) {
    const n = st.opened;
    toast(n ? `${n} booster${n > 1 ? 's' : ''} ouvert${n > 1 ? 's' : ''} sur ${total} : ${stopMsg}` : stopMsg, 'error');
  }
  S.busy = false;
  if (st.opened) await refreshData().catch((e) => console.warn('[boosters]', e));
  renderAll();
  loadQuests(); // l'ouverture de boosters fait avancer les quêtes
  if (R?.seq) {
    $('#cartes-live').textContent = 'Ouverture des boosters en cours.';
    $('#cartes-reveal')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    startMulti(R);
  }
}

// Révélation en cascade, de la carte la plus rare à la moins rare.
/**
 * Lance la révélation en cascade d'une ouverture groupée : une carte toutes les MULTI_STEP_MS.
 * @param {object} R ouverture groupée
 */
function startMulti(R) {
  /** Révèle la carte i, puis programme la suivante (ou termine après la dernière). */
  const step = (i) => {
    R.timer = null;
    if (S.reveal !== R || R.phase !== 'seq') return;
    revealMulti(R, i);
    if (i + 1 >= R.cards.length) return finishMulti(R);
    R.timer = setTimeout(() => step(i + 1), MULTI_STEP_MS);
  };
  R.timer = setTimeout(() => step(0), 350);
}

/**
 * Révèle la carte i d'une ouverture groupée (retire son dos) ; joue un son pour une rareté à partir de légendaire.
 * @param {object} R ouverture groupée
 * @param {number} i index de la carte
 */
function revealMulti(R, i) {
  const card = R.cards[i];
  if (!card) return;
  R.revealed.add(i);
  $(`#x5-c${i}`)?.classList.remove('is-pending');
  if (rarityRank(card.rarity) >= 5) playSound('badge');
}

/**
 * Termine l'ouverture groupée : toutes les cartes sont révélées, le résumé s'affiche.
 * @param {object} R ouverture groupée
 */
function finishMulti(R) {
  if (R.timer) clearTimeout(R.timer);
  R.timer = null;
  R.phase = 'done';
  R.cards.forEach((_, i) => R.revealed.add(i));
  renderBoosters(); // réactive les boutons et affiche le résumé (annoncé par renderMultiReveal)
  $('#cartes-reveal [data-action="close-reveal"]')?.focus({ preventScroll: true });
}

/** Réclame le passage du jour (hg_cards_daily) : Paillettes et série de jours consécutifs. */
async function claimDaily() {
  if (S.busy) return;
  S.busy = true;
  try {
    const { data, error } = await sb.rpc('hg_cards_daily');
    if (error) throw error;
    toast(`+${fmtP(data.gain)} · série de ${pluralCount(data.streak, 'jour', 'jours', nf.format)}`, 'ok');
    await refreshData();
  } catch (e) {
    toast(errMsg(e), 'error');
  } finally {
    S.busy = false;
    renderAll();
  }
}

/* ---------- Collection ---------- */
// Une carte de la collection : la carte (bouton, fiche détail) et, à côté, la loupe qui ouvre la carte agrandie.
/**
 * Une case de la collection : la carte (ouvre la fiche détail) et le bouton loupe.
 * @param {object} c carte (hg_cards)
 * @returns {string} HTML de la case
 */
function cardCell(c) {
  const cps = copiesOf(c.id);
  const n = cps.length;
  const shinyCp = cps.find((x) => x.shiny);
  const card = cardHtml(c, {
    size: 'md', count: n, shiny: !!shinyCp,
    serial: n === 1 && c.max_copies ? cps[0].serial : null,
    missing: n === 0, button: true,
    attrs: `data-action="open-card" data-card="${esc(c.id)}"`,
  });
  const what = n ? esc(c.name) : 'la carte';
  return `<div class="cz-cell">${card}`
    + `<button type="button" class="cz-zoom" data-action="zoom-card" data-card="${esc(c.id)}" aria-label="Agrandir ${what}">${ICON_ZOOM}</button>`
    + '<span class="cz-tip" aria-hidden="true">Agrandir</span></div>';
}

// Fiche d'une carte pour la fenêtre agrandie (cartes-zoom.js) : tout est déjà chargé, aucune requête.
/**
 * Fiche de la collection pour la fenêtre agrandie (cartes-zoom.js).
 * @param {string} id identifiant de la carte
 * @returns {object|null} fiche (carte, exemplaires, série), ou null si la carte est inconnue
 */
function zoomInfo(id) {
  const k = S.cardsById.get(id);
  if (!k) return null;
  const cps = copiesOf(id);
  return {
    card: k,
    count: cps.length,
    shiny: cps.some((x) => x.shiny),
    serial: cps.length === 1 && k.max_copies ? cps[0].serial : null,
    missing: cps.length === 0,
    setName: S.sets.find((s) => s.id === k.set_id)?.name || '',
    setTotal: S.cards.filter((c) => c.set_id === k.set_id).length,
    lines: cps.map((cp) => [cp.serial ? serialLabel(cp.serial, k.max_copies) : '', cp.shiny ? 'brillante' : '', SOURCE_LABEL[cp.source] || cp.source, fmtDate(cp.obtained_at)].filter(Boolean).join(' · ')),
  };
}

// Un intertitre par série dans « Toutes les séries » : nom, possédées / total, barre, cartes.
/**
 * Intertitre d'une série (vue « Toutes les séries ») : nom, compte possédées / total, barre, cartes.
 * @param {{set: object, scored: number, have: number, shown: object[]}} g série et ses cartes affichées
 * @param {number} i numéro du groupe (sert à relier le titre à sa section)
 */
function groupHtml(g, i) {
  const pct = g.scored ? Math.round(g.have / g.scored * 100) : 0;
  const hid = `cz-g-${i}`;
  return `<section class="cz-group" aria-labelledby="${hid}">
    <div class="cz-group-head">
      <h2 class="cz-group-title" id="${hid}">${esc(g.set.name)}</h2>
      <p class="cz-group-count">${nf.format(g.have)} / ${nf.format(g.scored)} possédées</p>
    </div>
    <div class="progress cz-group-bar" role="progressbar" aria-label="Progression de ${esc(g.set.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
    <div class="cartes-grid">${g.shown.map(cardCell).join('')}</div>
  </section>`;
}

/**
 * Dessine l'onglet Collection : choix de la série, filtres, progression et grille des cartes.
 * Les compteurs de progression ignorent les filtres ; seules les cartes affichées sont filtrées.
 * @param {string} [focusId] id du champ à remettre au focus après le rendu (sans défilement)
 */
function drawCollection(focusId) {
  const el = $('#cartes-p-collection');
  const none = '<p class="empty">Aucune série disponible pour le moment.</p>';
  if (!S.sets.length) { el.innerHTML = none; S.shownIds = []; return; }
  const all = S.setId === ALL;
  const set = all ? null : S.sets.find((s) => s.id === S.setId);
  if (!all && !set) { el.innerHTML = none; S.shownIds = []; return; }
  const f = S.filters;
  /** Vrai si la carte passe les filtres de la collection (rareté, famille, possession). */
  const keep = (c) => {
    const n = copiesOf(c.id).length;
    if (f.rarity && c.rarity !== f.rarity) return false;
    if (f.family && c.family !== f.family) return false;
    if (f.owned === 'owned' && n === 0) return false;
    if (f.owned === 'missing' && n > 0) return false;
    if (f.owned === 'dupes' && n < 2) return false;
    return true;
  };
  // Une entrée par série affichée : ses compteurs (sans filtre) et ses cartes (filtrées).
  const groups = (all ? S.sets : [set]).map((s) => {
    const cards = S.cards.filter((c) => c.set_id === s.id);
    const scored = cards.filter((c) => c.rarity !== 'identite');
    return { set: s, scored: scored.length, have: scored.filter((c) => copiesOf(c.id).length > 0).length, shown: cards.filter(keep) };
  });
  const scoredAll = groups.reduce((a, g) => a + g.scored, 0);
  const haveAll = groups.reduce((a, g) => a + g.have, 0);
  const pctDone = scoredAll ? Math.round(haveAll / scoredAll * 100) : 0;
  const withCards = groups.filter((g) => g.shown.length);
  S.shownIds = withCards.flatMap((g) => g.shown.map((c) => c.id)); // ordre affiché : sert à précédent / suivant
  const plan = massPlan();
  const body = !withCards.length
    ? '<p class="empty">Aucune carte ne correspond à ces filtres.</p>'
    : all
      ? `<div class="cz-groups">${withCards.map(groupHtml).join('')}</div>`
      : `<div class="cartes-grid">${groups[0].shown.map(cardCell).join('')}</div>`;
  el.innerHTML = `
    <section class="card cartes-block">
      <div class="cartes-series">
        <div class="field">
          <label for="cartes-set">Série</label>
          <select id="cartes-set" data-change="set">
            <option value="${ALL}" ${all ? 'selected' : ''}>Toutes les séries</option>
            ${S.sets.map((s) => `<option value="${esc(s.id)}" ${s.id === S.setId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="cartes-progress">
          <p class="cartes-progress-label">${nf.format(haveAll)} / ${nf.format(scoredAll)} cartes obtenues${all ? ' (toutes les séries)' : ''}</p>
          <div class="progress" role="progressbar" aria-label="${all ? 'Progression de la collection' : 'Progression de la série'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctDone}"><span style="width:${pctDone}%"></span></div>
        </div>
      </div>
      ${set?.description ? `<p class="muted small">${esc(set.description)}</p>` : ''}
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
        <p class="muted small">${pluralCount(plan.ids.length, 'doublon recyclable', 'doublons recyclables', nf.format)} (on garde un exemplaire de chaque carte)</p>
        <button type="button" class="btn btn-ghost" data-action="mass">Recycler les doublons</button>
      </div>
    </section>
    ${body}`;
  // Le focus revient au champ modifié sans faire défiler la page
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}
const renderCollection = kept(drawCollection); // voir renderBoosters

/* ---------- Recyclage de masse ---------- */
/**
 * Valeur en Paillettes d'un exemplaire recyclé : tarif de la rareté, multiplié si l'exemplaire est brillant.
 * @param {object} cp exemplaire (hg_card_copies)
 * @param {object} k carte (hg_cards)
 * @returns {number}
 */
function recycleValue(cp, k) {
  const base = tableVal('recycle', k.rarity) ?? 0;
  return base * (cp.shiny ? Number(cfg().recycle?.shiny_multiplier ?? 3) : 1);
}

/**
 * Liste les doublons recyclables : pour chaque carte, on garde un exemplaire (le brillant d'abord, puis
 * le non échangé). Exclut les cartes Identité et les exemplaires en cours d'échange.
 * @returns {{ids: number[], total: number}} identifiants des exemplaires à recycler et leur valeur en Paillettes
 */
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

/** Ouvre la fenêtre de recyclage de masse, avec le nombre de doublons et leur valeur estimée. */
function openMass() {
  const plan = massPlan();
  S.massIds = plan.ids;
  $('#cartes-mass-body').innerHTML = plan.ids.length
    ? `<p>Tu vas recycler <strong>${pluralCount(plan.ids.length, 'doublon', 'doublons', nf.format)}</strong> pour environ <strong>${fmtPaillettes(plan.total)}</strong>.</p>
       <p class="muted small">Il te restera au moins un exemplaire de chaque carte. Les cartes Identité et celles en cours d’échange ne sont pas touchées. Cette action est définitive.</p>`
    : '<p>Aucun doublon à recycler pour le moment.</p>';
  $('#cartes-mass-confirm').hidden = !plan.ids.length;
  const dlg = $('#cartes-mass');
  if (!dlg.open) dlg.showModal();
}

/**
 * Recycle les doublons prévus (hg_card_recycle), puis recharge l'état et la page.
 * @returns {Promise<void>}
 */
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
/**
 * Ouvre la fiche détail d'une carte dans sa fenêtre.
 * @param {string} cardId identifiant de la carte
 */
function openDetail(cardId) {
  S.detailId = cardId;
  renderDetail();
  const d = $('#cartes-detail');
  if (!d.open) d.showModal();
}

/**
 * Une ligne « Mes exemplaires » : numéro, brillance, origine, date, et le bouton de recyclage
 * (ou « En échange » / « Ne se recycle pas » selon le cas).
 * @param {object} cp exemplaire
 * @param {object} k carte
 * @returns {string} HTML de la ligne
 */
function copyRow(cp, k) {
  const val = recycleValue(cp, k);
  const parts = [cp.serial ? serialLabel(cp.serial, k.max_copies) : '', cp.shiny ? 'Brillante' : '', SOURCE_LABEL[cp.source] || cp.source, fmtDate(cp.obtained_at)].filter(Boolean);
  let action;
  if (cp.locked_trade) action = '<span class="pill pill-todo">En échange</span>';
  else if (k.rarity === 'identite') action = '<span class="muted small">Ne se recycle pas</span>';
  else action = `<button type="button" class="btn btn-ghost cd-btn" data-action="recycle" data-copy="${esc(String(cp.id))}" ${S.busy ? 'disabled' : ''}>Recycler · ${fmtPaillettes(val)}</button>`;
  return `<li><span>${parts.map(esc).join(' · ')}</span>${action}</li>`;
}

/**
 * Dessine la fiche détail de la carte choisie : carte en grand, liste de souhaits, exemplaires, fabrication.
 * Une carte fabricable doit avoir un coût défini ; Identité et Mythique ne se fabriquent pas.
 */
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
  /** Vrai si le solde ne suffit pas pour ce coût (jamais en mode sans limite). */
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

/**
 * Exécute une action de la fiche détail : souhait (ajout ou retrait), fabrication, recyclage.
 * Recharge les données si l'action change l'inventaire, puis remet le focus sur le bouton utilisé.
 * @param {'wish'|'craft'|'recycle'} action
 * @param {HTMLElement} el bouton cliqué (data-shiny ou data-copy selon l'action)
 * @returns {Promise<void>}
 */
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
  renderDetail(); // fiche à jour : boutons réactivés, exemplaire recyclé retiré
  if (refreshed) renderAll();
  else renderTab();
  // renderDetail a remplacé le bouton utilisé : le focus revient à son équivalent, sans défilement
  const again = action === 'wish' ? '.cd-wish'
    : action === 'craft' ? `[data-action="craft"][data-shiny="${el.dataset.shiny}"]`
    : `[data-action="recycle"][data-copy="${el.dataset.copy}"]`;
  $('#cartes-detail')?.querySelector(again)?.focus({ preventScroll: true });
}

/* ---------- Collection d'un autre membre (lecture seule) ---------- */
/* Vue ouverte par l'adresse #collection/<id> ou par un lien du classement (voir routeFromHash). */
// Adresse : cartes.html#collection/<id>. Mêmes données et mêmes composants que « Collection » (cartes-zoom.js compris),
// mais rien n'est modifiable : on voit ses cartes, on coche celles qu'on lui demande, puis on ouvre l'éditeur d'offre.
// S.peer = { id, member, copies, byCard, loading, error, setId, filters, picks (Set de cartes demandées), shownIds }.
/** Forme de l'adresse d'une collection (#collection/<uuid>). */
const PEER_RE = /^#collection\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const PEER_OWNED = [['all', 'Toutes les cartes'], ['owned', 'Possédées par lui'], ['missing', 'Manquantes chez lui'],
  ['dupes', 'Doublons chez lui'], ['dupes_missing', 'Ses doublons que je n’ai pas']];
/** Exemplaires du membre consulté pour une carte (tableau vide si aucun). */
const peerCopies = (cardId) => S.peer?.byCard.get(cardId) || [];

/** Exemplaires d'un membre, par carte. Une seule lecture (RLS : tout membre peut lire hg_card_copies, migration 018 c). */
async function loadPeer(id) {
  const [mem, copies] = await Promise.all([
    sb.rpc('hg_members'),
    fetchAllRows(() => sb.from('hg_card_copies').select('id, card_id, owner_id, shiny, serial, source, obtained_at, locked_trade')
      .eq('owner_id', id).is('recycled_at', null).order('obtained_at').order('id')),
  ]);
  if (mem.error) throw mem.error;
  const byCard = new Map();
  for (const cp of copies) {
    if (!byCard.has(cp.card_id)) byCard.set(cp.card_id, []);
    byCard.get(cp.card_id).push(cp);
  }
  // Les fantômes ne figurent pas dans hg_members : leur collection reste invisible
  return { member: (mem.data || []).find((m) => m.id === id) || null, copies, byCard };
}

/**
 * Ouvre la collection d'un autre membre en lecture seule. Ouvrir sa propre collection revient à l'onglet normal.
 * Si une autre collection est ouverte entre-temps, la réponse tardive est ignorée.
 * @param {string} id identifiant du membre (en minuscules)
 * @returns {Promise<void>}
 */
async function openPeer(id) {
  if (id === me.id) { // sa propre collection : l'onglet normal
    leavePeer();
    S.tab = 'collection';
    cleanHash();
    renderAll();
    return;
  }
  if (!S.peer) S.returnY = window.scrollY;
  S.peer = { id, member: null, copies: [], byCard: new Map(), loading: true, error: '', setId: ALL,
    filters: { rarity: '', family: '', owned: 'all' }, picks: new Set(), shownIds: [] };
  applyView();
  renderPeer();
  $('#cartes-peer').scrollIntoView({ block: 'start' });
  try {
    const data = await loadPeer(id);
    if (S.peer?.id !== id) return; // une autre collection a été ouverte entre-temps
    Object.assign(S.peer, data, { loading: false, error: data.member ? '' : 'Ce membre est introuvable ou sa collection n’est pas disponible.' });
  } catch (e) {
    if (S.peer?.id !== id) return;
    Object.assign(S.peer, { loading: false, error: errMsg(e) });
  }
  renderPeer();
  $('#cartes-peer-title')?.focus({ preventScroll: true });
}

/** Ferme la collection d'un membre, revient aux onglets et remet la page à sa position d'avant. */
function leavePeer() {
  if (!S.peer) return;
  S.peer = null;
  cleanHash();
  renderAll();
  window.scrollTo({ top: S.returnY, behavior: 'instant' });
}

// L'adresse ne garde pas le #collection/… une fois la vue fermée (sinon un rechargement rouvrirait la vue).
/** Retire #collection/… de l'adresse, sans ajouter d'entrée dans l'historique du navigateur. */
function cleanHash() {
  if (PEER_RE.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
}

/** Suit l'adresse : #collection/<id> ouvre la collection du membre, sinon la vue revient aux onglets. */
function routeFromHash() {
  const m = PEER_RE.exec(location.hash);
  if (m) openPeer(m[1].toLowerCase());
  else leavePeer();
}

/**
 * Filtre de la collection d'un membre : vrai si la carte passe les filtres (rareté, famille, possession).
 * « Doublons chez lui que je n'ai pas » : il en a au moins deux et je n'en ai aucun.
 * @param {object} c carte
 * @returns {boolean}
 */
function peerKeep(c) {
  const f = S.peer.filters;
  const n = peerCopies(c.id).length;
  const mine = copiesOf(c.id).length;
  if (f.rarity && c.rarity !== f.rarity) return false;
  if (f.family && c.family !== f.family) return false;
  if (f.owned === 'owned' && n === 0) return false;
  if (f.owned === 'missing' && n > 0) return false;
  if (f.owned === 'dupes' && n < 2) return false;
  if (f.owned === 'dupes_missing' && !(n >= 2 && mine === 0)) return false;
  return true;
}

// Une carte de sa collection : carte (bouton de sélection si elle la possède), loupe, repères d'échange.
/**
 * Une case de la collection d'un membre : carte, étiquettes (« Tu ne l'as pas », « Doublon chez lui », « Demandée ») et loupe.
 * @param {object} c carte
 * @returns {string} HTML de la case
 */
function peerCell(c) {
  const cps = peerCopies(c.id);
  const n = cps.length;
  const mine = copiesOf(c.id).length;
  const shinyCp = cps.find((x) => x.shiny);
  const on = S.peer.picks.has(c.id);
  const pickable = n > 0;
  const card = cardHtml(c, {
    size: 'md', count: n, shiny: !!shinyCp,
    serial: n === 1 && c.max_copies ? cps[0].serial : null,
    missing: n === 0, button: pickable,
    attrs: pickable ? `data-action="peer-pick" data-card="${esc(c.id)}" aria-pressed="${on}"` : '',
  });
  const tags = [
    n && !mine ? ['Tu ne l’as pas', 'is-need'] : null,
    n >= 2 ? ['Doublon chez lui', 'is-dupe'] : null,
    on ? ['Demandée', 'is-picked'] : null,
  ].filter(Boolean);
  const what = n ? esc(c.name) : 'la carte';
  return `<div class="cz-cell pv-cell${on ? ' is-picked' : ''}">${card}`
    + (tags.length ? `<ul class="pv-tags">${tags.map(([t, cls]) => `<li class="pv-tag ${cls}">${esc(t)}</li>`).join('')}</ul>` : '')
    + `<button type="button" class="cz-zoom" data-action="peer-zoom" data-card="${esc(c.id)}" aria-label="Agrandir ${what}">${ICON_ZOOM}</button>`
    + '<span class="cz-tip" aria-hidden="true">Agrandir</span></div>';
}

/**
 * Intertitre d'une série dans la collection d'un membre (vue « Toutes les séries »).
 * @param {{set: object, scored: number, have: number, shown: object[]}} g série et ses cartes affichées
 * @param {number} i numéro du groupe
 */
function peerGroupHtml(g, i) {
  const pct = g.scored ? Math.round(g.have / g.scored * 100) : 0;
  const hid = `pv-g-${i}`;
  return `<section class="cz-group" aria-labelledby="${hid}">
    <div class="cz-group-head">
      <h2 class="cz-group-title" id="${hid}">${esc(g.set.name)}</h2>
      <p class="cz-group-count">${nf.format(g.have)} / ${nf.format(g.scored)} possédées</p>
    </div>
    <div class="progress cz-group-bar" role="progressbar" aria-label="Progression de ${esc(g.set.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
    <div class="cartes-grid">${g.shown.map(peerCell).join('')}</div>
  </section>`;
}

/**
 * Fiche d'une carte pour la fenêtre agrandie, vue depuis la collection d'un membre (cartes-zoom.js).
 * @param {string} id identifiant de la carte
 * @returns {object|null} fiche, ou null si la carte ou la collection n'est pas chargée
 */
function peerZoomInfo(id) {
  const P = S.peer;
  const k = S.cardsById.get(id);
  if (!P || !k) return null;
  const cps = peerCopies(id);
  return {
    card: k,
    count: cps.length,
    shiny: cps.some((x) => x.shiny),
    serial: cps.length === 1 && k.max_copies ? cps[0].serial : null,
    missing: cps.length === 0,
    setName: S.sets.find((s) => s.id === k.set_id)?.name || '',
    setTotal: S.cards.filter((c) => c.set_id === k.set_id).length,
    lines: cps.map((cp) => [cp.serial ? serialLabel(cp.serial, k.max_copies) : '', cp.shiny ? 'brillante' : '', SOURCE_LABEL[cp.source] || cp.source, fmtDate(cp.obtained_at)].filter(Boolean).join(' · ')),
    kicker: `Collection de ${P.member?.pseudo || ''}`,
    heading: 'Dans sa collection',
  };
}

/**
 * En-tête de la collection d'un membre : retour, nom, compteurs, sélection et bouton « Proposer un échange ».
 * @param {object} P état de la collection (S.peer)
 */
function peerHead(P) {
  const m = P.member;
  const n = P.picks.size;
  return `<section class="card cartes-peer-head" aria-labelledby="cartes-peer-title">
      <div class="cartes-row"><button type="button" class="btn btn-ghost" data-action="peer-back">← Retour</button></div>
      <div class="cartes-peer-who">${avatarHtml(m, 48)}
        <div>
          <p class="eyebrow">Collection · lecture seule</p>
          <h2 class="cartes-peer-title" id="cartes-peer-title" tabindex="-1">Collection de ${esc(m.pseudo)}</h2>
          <p class="muted small">${pluralCount(P.byCard.size, 'carte différente', 'cartes différentes', nf.format)} · ${pluralCount(P.copies.length, 'exemplaire', 'exemplaires', nf.format)}</p>
        </div>
      </div>
      <p class="muted small">Tu peux voir cette collection, pas la modifier. Clique sur une carte qu’il possède pour la demander, puis propose un échange.</p>
      <div class="cartes-peer-offer">
        <p class="cartes-small" id="peer-sel" aria-live="polite">${pluralCount(n, 'carte sélectionnée', 'cartes sélectionnées', nf.format)}${n ? ' · elles seront pré-cochées dans « Je demande »' : ''}</p>
        <button type="button" class="btn btn-primary" data-action="peer-offer">Proposer un échange</button>
        ${n ? '<button type="button" class="btn btn-ghost" data-action="peer-clear">Vider la sélection</button>' : ''}
      </div>
    </section>`;
}

/**
 * HTML complet de la collection d'un membre : en-tête, série, progression, filtres et grille.
 * @param {object} P état de la collection (S.peer), chargé
 * @returns {string}
 */
function peerHtml(P) {
  const all = P.setId === ALL;
  const set = all ? null : S.sets.find((s) => s.id === P.setId);
  const f = P.filters;
  const groups = (all ? S.sets : [set].filter(Boolean)).map((s) => {
    const cards = S.cards.filter((c) => c.set_id === s.id);
    const scored = cards.filter((c) => c.rarity !== 'identite');
    return { set: s, scored: scored.length, have: scored.filter((c) => peerCopies(c.id).length > 0).length, shown: cards.filter(peerKeep) };
  });
  const scoredAll = groups.reduce((a, g) => a + g.scored, 0);
  const haveAll = groups.reduce((a, g) => a + g.have, 0);
  const pctDone = scoredAll ? Math.round(haveAll / scoredAll * 100) : 0;
  const withCards = groups.filter((g) => g.shown.length);
  P.shownIds = withCards.flatMap((g) => g.shown.map((c) => c.id));
  const body = !S.sets.length ? '<p class="empty">Aucune série disponible pour le moment.</p>'
    : !withCards.length ? '<p class="empty">Aucune carte ne correspond à ces filtres.</p>'
      : all ? `<div class="cz-groups">${withCards.map(peerGroupHtml).join('')}</div>`
        : `<div class="cartes-grid">${groups[0].shown.map(peerCell).join('')}</div>`;
  return `${peerHead(P)}
    <section class="card cartes-block">
      <div class="cartes-series">
        <div class="field">
          <label for="peer-set">Série</label>
          <select id="peer-set" data-change="peer-set">
            <option value="${ALL}" ${all ? 'selected' : ''}>Toutes les séries</option>
            ${S.sets.map((s) => `<option value="${esc(s.id)}" ${s.id === P.setId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="cartes-progress">
          <p class="cartes-progress-label">${nf.format(haveAll)} / ${nf.format(scoredAll)} cartes obtenues par ${esc(P.member.pseudo)}${all ? ' (toutes les séries)' : ''}</p>
          <div class="progress" role="progressbar" aria-label="Progression de la collection de ${esc(P.member.pseudo)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctDone}"><span style="width:${pctDone}%"></span></div>
        </div>
      </div>
      <div class="cartes-filters">
        <div class="field">
          <label for="peer-f-rarity">Rareté</label>
          <select id="peer-f-rarity" data-pfilter="rarity">
            <option value="">Toutes</option>
            ${RARITIES.map((r) => `<option value="${r.id}" ${f.rarity === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="peer-f-family">Famille</label>
          <select id="peer-f-family" data-pfilter="family">
            <option value="">Toutes</option>
            ${FAMILIES.map((x) => `<option value="${x.id}" ${f.family === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="peer-f-owned">Afficher</label>
          <select id="peer-f-owned" data-pfilter="owned">
            ${PEER_OWNED.map(([v, l]) => `<option value="${v}" ${f.owned === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </div>
      </div>
    </section>
    ${body}`;
}

/** Redessine la vue membre ; focusSel (sélecteur) reçoit le focus après le rendu, sans défilement. */
function renderPeer(focusSel) {
  const el = $('#cartes-peer');
  const P = S.peer;
  if (!el || !P) return;
  keepPlace(() => {
    if (P.loading) el.innerHTML = '<p class="muted" aria-live="polite">Chargement de la collection…</p>';
    else if (P.error) el.innerHTML = `<section class="card cartes-peer-head"><div class="cartes-row"><button type="button" class="btn btn-ghost" data-action="peer-back">← Retour</button></div><p class="empty">${esc(P.error)}</p></section>`;
    else el.innerHTML = peerHtml(P);
    if (focusSel) el.querySelector(focusSel)?.focus({ preventScroll: true });
  });
}

/**
 * Coche ou décoche une carte qu'on demande au membre (elle sera pré-cochée dans l'éditeur d'offre).
 * @param {string} cardId identifiant de la carte
 */
function togglePeerPick(cardId) {
  const P = S.peer;
  if (!P) return;
  if (P.picks.has(cardId)) P.picks.delete(cardId); else P.picks.add(cardId);
  renderPeer(`[data-action="peer-pick"][data-card="${CSS.escape(cardId)}"]`);
}

/** Ouvre l'éditeur d'offre (cartes-trades.js) avec ce membre ; les cartes cochées sont pré-cochées dans « Je demande ». */
async function peerOffer() {
  const P = S.peer;
  if (!P || P.loading || P.error) return;
  const want = [];
  let locked = 0;
  for (const cid of P.picks) {
    const cp = peerCopies(cid).find((x) => !x.locked_trade);
    if (cp) want.push(String(cp.id)); else locked++;
  }
  let api = null;
  try { await mountTradesOnce(); api = S.tradeApi; } catch { api = null; }
  if (!api) return toast('Les échanges ne sont pas disponibles pour le moment.', 'error');
  if (locked) toast('Certaines cartes sont déjà en échange : elles ne sont pas pré-cochées.');
  const to = P.id;
  S.peer = null;
  cleanHash();
  S.tab = 'echanges';
  renderAll();
  api.offer({ to, want });
}

/* ---------- Classement ---------- */
/** Dessine le classement (hg_card_leaderboard). Les pseudos des autres membres mènent à leur collection. */
async function renderLeaderboard() {
  const el = $('#cartes-p-classement');
  const release = holdHeight(el); // le texte d'attente garde la hauteur : la page ne raccourcit pas
  el.innerHTML = '<p class="muted" aria-live="polite">Chargement du classement…</p>';
  try {
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
              <span><strong>${r.user_id === me.id ? esc(r.pseudo) : `<a class="cartes-lb-link" href="#collection/${esc(r.user_id)}" title="Voir la collection de ${esc(r.pseudo)}">${esc(r.pseudo)}</a>`}</strong>${r.user_id === me.id ? ' <span class="muted small">(toi)</span>' : ''}<br>
              <span class="cartes-lb-stats">${pluralCount(Number(r.uniques), 'unique', 'uniques', nf.format)} · ${pluralCount(Number(r.copies), 'exemplaire', 'exemplaires', nf.format)} · ${nf.format(Number(r.shinies))} brillantes · ${nf.format(Number(r.identites))} identités · ${nf.format(Number(r.series))} séries</span></span>
            </span>
            <span class="cartes-lb-score">${nf.format(Number(r.score))}</span>
          </li>`).join('')}
        </ol>` : '<p class="empty">Personne n’a encore de carte.</p>'}
      </section>`;
  } finally {
    release();
  }
}

/* ---------- Échanges (module séparé, chargé à la demande) ---------- */
/**
 * Charge le module des échanges (cartes-trades.js) une seule fois, à la première ouverture de l'onglet.
 * @returns {Promise<void>} résolue quand le module est monté (ou remplacé par « Bientôt » si le chargement échoue)
 */
function mountTradesOnce() {
  if (S.tradesMounted) return S.tradesReady;
  S.tradesMounted = true;
  const el = $('#cartes-trades');
  const ctx = {
    me,
    refresh: async () => { await refreshData(); renderAll(); },
    expose: (api) => { S.tradeApi = api; }, // api.offer({ to, want }) ouvre l'éditeur d'offre
  };
  S.tradesReady = import('./cartes-trades.js')
    .then((m) => m.mountTrades(el, ctx))
    .catch(() => { el.innerHTML = '<p class="empty">Bientôt.</p>'; });
  return S.tradesReady;
}

/* ---------- Historique ---------- */
/** Dessine l'historique des 30 derniers mouvements de Paillettes (en vert : gain, en rouge : dépense). */
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
/**
 * Délégation des clics sur la page : onglets et tous les boutons [data-action] (un seul écouteur pour toute la page).
 * @param {MouseEvent} e
 */
function onClick(e) {
  const t = e.target.closest('.cartes-tab[data-tab], [data-action]');
  if (!t || t.disabled) return;
  if (t.dataset.tab) { setTab(t.dataset.tab); $(`#cartes-tab-${t.dataset.tab}`).focus({ preventScroll: true }); return; }
  switch (t.dataset.action) {
    case 'daily': return claimDaily();
    case 'open-free': return openBooster(true);
    case 'open-paid': return openBooster(false);
    case 'open-gift': return openBooster(false, true);
    case 'open-paid-x5': return openBoostersMulti();
    case 'quest-claim': return claimQuest(t.dataset.code);
    case 'reveal-all': return skipSeq();
    case 'close-reveal': return closeReveal();
    case 'open-card': return openDetail(t.dataset.card);
    case 'zoom-card': return zoom.open(t.dataset.card, t);
    case 'mass': return openMass();
    case 'peer-back': leavePeer(); $(`#cartes-tab-${S.tab}`)?.focus({ preventScroll: true }); return;
    case 'peer-zoom': return zoom.open(t.dataset.card, t);
    case 'peer-pick': return togglePeerPick(t.dataset.card);
    case 'peer-clear': if (S.peer) { S.peer.picks.clear(); renderPeer('[data-action="peer-offer"]'); } return;
    case 'peer-offer': return peerOffer();
    case 'mass-confirm': return confirmMass();
    case 'wish':
    case 'craft':
    case 'recycle': return detailAction(t.dataset.action, t);
    case 'close-dialog': return t.closest('dialog')?.close();
  }
}

/**
 * Délégation des changements (sélecteurs de série, filtres de la collection et de la collection d'un membre).
 * @param {Event} e
 */
function onChange(e) {
  const t = e.target;
  if (t.dataset.change === 'set') { S.setId = t.value; renderCollection('cartes-set'); }
  else if (t.dataset.filter) { S.filters[t.dataset.filter] = t.value; renderCollection(t.id); }
  else if (t.dataset.change === 'peer-set' && S.peer) { S.peer.setId = t.value; renderPeer('#peer-set'); }
  else if (t.dataset.pfilter && S.peer) { S.peer.filters[t.dataset.pfilter] = t.value; renderPeer('#' + t.id); }
}

/**
 * Flèches, Début et Fin dans la liste des onglets : déplace la sélection et le focus (motif ARIA « tabs »).
 * @param {KeyboardEvent} e
 */
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
/**
 * Point d'entrée de la page : squelette, écouteurs, chargement des données, routage de l'adresse,
 * quêtes et compte à rebours du booster gratuit. Une erreur de chargement est affichée sans bloquer la page.
 * @returns {Promise<void>}
 */
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
  window.addEventListener('hashchange', routeFromHash);
  routeFromHash(); // lien direct vers une collection ou retour arrière depuis elle
  loadQuests();
  app.removeAttribute('aria-busy');
  // Le compte à rebours du booster gratuit se met à jour sans recharger la page
  // Pas de rafraîchissement quand l'onglet est caché ; une mise à jour immédiate au retour
  setInterval(() => { if (S.tab === 'boosters' && !document.hidden) renderFree(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.tab === 'boosters') renderFree(); });
}

boot();
