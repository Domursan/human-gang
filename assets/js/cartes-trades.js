// ===== Cartes à collectionner — échanges entre membres =====
// Chargé par cartes.js : import('./cartes-trades.js').then((m) => m.mountTrades(el, ctx)).
// ctx = { me: profil courant (id, pseudo…), refresh: async () => {} } ; refresh recharge solde et collection côté page.
// Affichage des cartes : cartes-ui.js (cardHtml). Styles : cartes-trades.css (+ cartes-card.css).
import { sb, esc, toast, errMsg, avatarHtml, fmtDateTime, getUser, notify } from './core.js';
import { cardHtml, rarityRank, fmtP } from './cartes-ui.js';
import { confirmBox } from './ui-confirm.js';
import { pluralCount } from './utils.js';

const TABS = [
  { id: 'recues', label: 'Reçues' },
  { id: 'envoyees', label: 'Envoyées' },
  { id: 'proposer', label: 'Proposer' },
  { id: 'correspondances', label: 'Correspondances' },
  { id: 'historique', label: 'Historique' },
];
const STATUS_LABEL = { proposee: 'En attente', acceptee: 'Acceptée', refusee: 'Refusée', annulee: 'Annulée', remplacee: 'Remplacée' };
const PAGE = 1000;   // pagination PostgREST (plafond par défaut de la base)
const CHUNK = 100;   // identifiants par requête « in »
const COPY_COLS = 'id, card_id, owner_id, shiny, serial, locked_trade, recycled_at';

const toInt = (v) => Math.max(0, Math.floor(Number(v) || 0));
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const cmp = (a, b) => String(a).localeCompare(String(b), 'fr');
const unwrap = ({ data, error }) => { if (error) throw error; return data; };
const pill = (text, cls = '') => `<span class="pill ${cls}">${esc(text)}</span>`;

/** Lit toutes les lignes d'une requête paginée (build() renvoie un nouveau constructeur à chaque page). */
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

export async function mountTrades(el, ctx = {}) {
  el.innerHTML = `
    <div class="trd">
      <div class="trd-tabs" role="tablist" aria-label="Échanges de cartes"></div>
      <div class="trd-panel" id="trd-panel" role="tabpanel"></div>
      <dialog class="trd-dialog" id="trd-edit" aria-labelledby="trd-edit-title"><form class="trd-form" id="trd-form" novalidate></form></dialog>
    </div>`;
  const root = el.querySelector('.trd');
  const tabsEl = root.querySelector('.trd-tabs');
  const panel = root.querySelector('#trd-panel');
  const dlg = root.querySelector('#trd-edit');
  const form = root.querySelector('#trd-form');

  const S = {
    me: null, members: new Map(), cards: new Map(), copies: new Map(), trades: [], items: new Map(),
    wish: new Map(), balance: 0, tab: 'recues', pickWho: '', setNames: new Map(), setTotal: new Map(),
    peers: new Set(), matchesP: null,
  };
  const E = { to: '', parent: null, give: new Set(), want: new Set(), giveP: 0, wantP: 0, message: '', q: '', busy: false };

  /* ---------- Données ----------
     Chargement ciblé : mes exemplaires, mes échanges et les cartes qu'ils citent. Les exemplaires d'un membre
     (proposition) et les correspondances sont chargés à la demande. Le cache de session est vidé après chaque
     action sur un échange (resetCache). */
  function resetCache() {
    S.cards = new Map(); S.copies = new Map(); S.setTotal = new Map(); S.wish = new Map();
    S.peers = new Set(); S.matchesP = null;
  }
  /** Lit une table pour une liste d'identifiants (par lots de CHUNK, toutes les pages). */
  async function fetchIn(table, column, ids, select, { filter = (q) => q, order = 'id' } = {}) {
    const uniq = [...new Set(ids.filter((x) => x != null))];
    const out = [];
    for (let i = 0; i < uniq.length; i += CHUNK) {
      const chunk = uniq.slice(i, i + CHUNK);
      out.push(...await fetchAll(() => filter(sb.from(table).select(select).in(column, chunk)).order(order)));
    }
    return out;
  }
  /** Ajoute au cache les cartes absentes (et le total de chaque série rencontrée). */
  async function ensureCards(ids) {
    const missing = [...new Set(ids.filter((x) => x != null))].filter((id) => !S.cards.has(id));
    if (!missing.length) return;
    const rows = await fetchIn('hg_cards', 'id', missing, '*');
    for (const c of rows) S.cards.set(c.id, c);
    const sets = [...new Set(rows.map((c) => c.set_id).filter((x) => x != null))].filter((x) => !S.setTotal.has(x));
    await Promise.all(sets.map(async (sid) => { // nombre de cartes par série (numérotation « 012/100 ») : comptage seul
      const { count, error } = await sb.from('hg_cards').select('id', { count: 'exact', head: true }).eq('set_id', sid);
      if (!error) S.setTotal.set(sid, count || 0);
    }));
  }
  /** Ajoute au cache des exemplaires précis (et leurs cartes). */
  async function ensureCopies(ids) {
    const missing = [...new Set(ids.filter((x) => x != null).map(String))].filter((id) => !S.copies.has(id));
    if (!missing.length) return;
    const rows = await fetchIn('hg_card_copies', 'id', missing, COPY_COLS);
    for (const r of rows) S.copies.set(String(r.id), r);
    await ensureCards(rows.map((r) => r.card_id));
  }
  /** Exemplaires d'un membre (pour proposer un échange) : une seule requête, mise en cache pour la session. */
  async function ensurePeer(uid) {
    if (S.peers.has(uid)) return;
    const rows = await fetchAll(() => sb.from('hg_card_copies').select(COPY_COLS).eq('owner_id', uid).order('id'));
    for (const r of rows) S.copies.set(String(r.id), r);
    await ensureCards(rows.map((r) => r.card_id));
    S.peers.add(uid);
  }

  async function load() {
    resetCache();
    const me = S.me.id;
    const [mem, mine, trades, wish, wallet, sets] = await Promise.all([
      sb.rpc('hg_members').then(unwrap),
      fetchAll(() => sb.from('hg_card_copies').select(COPY_COLS).eq('owner_id', me).order('id')),
      fetchAll(() => sb.from('hg_card_trades').select('*').or(`from_user.eq.${me},to_user.eq.${me}`).order('id')),
      fetchAll(() => sb.from('hg_card_wishlist').select('card_id').eq('user_id', me).order('card_id')),
      sb.from('hg_wallets').select('paillettes').eq('user_id', me).maybeSingle().then(unwrap),
      sb.from('hg_card_sets').select('id, name').then(({ data }) => data || []).catch(() => []), // facultatif : sans lui, pas de nom de série
    ]);
    S.setNames = new Map(sets.map((x) => [x.id, x.name]));
    S.members = new Map((mem || []).map((m) => [m.id, m]));
    S.balance = wallet?.paillettes ?? 0;
    S.copies = new Map(mine.map((c) => [String(c.id), c]));
    S.wish = new Map([[me, new Set(wish.map((w) => w.card_id))]]);
    S.trades = trades;
    S.items = new Map(trades.map((t) => [t.id, { from: [], to: [] }]));
    const rows = await fetchIn('hg_card_trade_items', 'trade_id', trades.map((t) => t.id), 'trade_id, copy_id, side', { order: 'trade_id' });
    for (const r of rows) S.items.get(r.trade_id)?.[r.side]?.push(r.copy_id);
    await ensureCopies(rows.map((r) => r.copy_id));
    await ensureCards(mine.map((c) => c.card_id));
  }

  /* ---------- Outils ---------- */
  const memberOf = (id) => S.members.get(id) || { id, pseudo: 'Membre', color: null, avatar_url: null };
  const pseudo = (id) => memberOf(id).pseudo;
  const cardOf = (copy) => S.cards.get(copy.card_id) || { name: 'Carte inconnue', rarity: 'commune', family: 'objet', number: null, max_copies: null };
  /** Champs d'affichage en plus de la carte : série, total de la série, arrivée du membre (carte Identité). */
  const shown = (card) => (card.id ? {
    ...card,
    set_name: S.setNames.get(card.set_id), set_total: S.setTotal.get(card.set_id),
    member_since: card.rarity === 'identite' ? (S.members.get(card.member_id)?.member_since ?? null) : null,
  } : card);
  const copyOf = (id) => S.copies.get(String(id)) || null;
  const cardOk = (copy) => { const k = S.cards.get(copy.card_id); return !!k && k.active !== false && k.tradeable !== false; };
  const byCard = (a, b) => {
    const x = cardOf(a), y = cardOf(b);
    return rarityRank(y.rarity) - rarityRank(x.rarity) || cmp(x.name, y.name) || (a.serial || 0) - (b.serial || 0);
  };
  const byDateDesc = (a, b) => new Date(b.created_at) - new Date(a.created_at);
  /** Exemplaires que `owner` peut mettre en jeu : vivants, libres (ou bloqués par l'offre `parent`), carte échangeable. */
  const tradables = (owner, parent = null) => [...S.copies.values()]
    .filter((c) => c.owner_id === owner && !c.recycled_at && (!c.locked_trade || (parent && c.locked_trade === parent)) && cardOk(c))
    .sort(byCard);
  const idsOf = (t, side) => S.items.get(t.id)?.[side] || [];
  const itemsOf = (t, side) => idsOf(t, side).map(copyOf).filter(Boolean);
  const isGift = (t) => t.status === 'acceptee' && idsOf(t, 'to').length === 0;
  const incoming = () => S.trades.filter((t) => t.status === 'proposee' && t.to_user === S.me.id).sort(byDateDesc);
  const outgoing = () => S.trades.filter((t) => t.status === 'proposee' && t.from_user === S.me.id).sort(byDateDesc);

  /* ---------- Rendu : éléments communs ---------- */
  const copyCard = (c) => cardHtml(shown(cardOf(c)), { size: 'sm', shiny: c.shiny, serial: c.serial });
  function sideHtml([label, copies, p]) {
    const empty = !copies.length && !p;
    return `<section class="trd-side">
      <h4 class="trd-side-title">${esc(label)}</h4>
      ${copies.length ? `<div class="trd-cards">${copies.map(copyCard).join('')}</div>` : ''}
      ${p ? `<p class="trd-pails">${esc(fmtP(p))}</p>` : ''}
      ${empty ? '<p class="trd-none">Rien</p>' : ''}
    </section>`;
  }
  function articleHtml({ who, date, badge, sides, message, actions = '' }) {
    return `<article class="card trd-offer">
      <header class="trd-offer-head">
        <div class="trd-who">${avatarHtml(who, 40)}<div><h3>${esc(who.pseudo)}</h3><p class="trd-date">${esc(fmtDateTime(date))}</p></div></div>
        ${badge}
      </header>
      <div class="trd-sides">${sides.map(sideHtml).join('')}</div>
      ${message ? `<blockquote class="trd-msg">${esc(message)}</blockquote>` : ''}
      ${actions ? `<div class="btn-row trd-actions">${actions}</div>` : ''}
    </article>`;
  }
  const emptyBox = (text) => `<p class="empty">${esc(text)}</p>`;

  /* ---------- Rendu : onglets et panneaux ---------- */
  function renderTabs() {
    const n = incoming().length;
    tabsEl.innerHTML = TABS.map((t) => {
      const sel = S.tab === t.id;
      const label = t.id === 'recues' && n ? `${t.label} (${n})` : t.label;
      return `<button class="trd-tab" type="button" role="tab" id="trd-tab-${t.id}" data-tab="${t.id}"
        aria-selected="${sel}" aria-controls="trd-panel" tabindex="${sel ? 0 : -1}">${esc(label)}</button>`;
    }).join('');
  }

  function offerHtml(t, dir) {
    const who = memberOf(dir === 'in' ? t.from_user : t.to_user);
    const [l1, l2] = dir === 'in'
      ? [`${who.pseudo} te donne`, `${who.pseudo} te demande`]
      : ['Tu donnes', `Tu demandes à ${who.pseudo}`];
    const actions = dir === 'in'
      ? `<button class="btn btn-primary" type="button" data-act="accept" data-id="${esc(t.id)}">Accepter</button>
         <button class="btn btn-ghost" type="button" data-act="counter" data-id="${esc(t.id)}">Contre-proposer</button>
         <button class="btn btn-ghost" type="button" data-act="refuse" data-id="${esc(t.id)}">Refuser</button>`
      : `<button class="btn btn-ghost" type="button" data-act="cancel" data-id="${esc(t.id)}">Annuler l’offre</button>`;
    return articleHtml({
      who, date: t.created_at, badge: pill(STATUS_LABEL.proposee, 'pill-current'),
      sides: [[l1, itemsOf(t, 'from'), t.from_paillettes], [l2, itemsOf(t, 'to'), t.to_paillettes]],
      message: t.message, actions,
    });
  }

  function viewRecues() {
    const list = incoming();
    if (!list.length) return emptyBox('Aucune offre reçue en attente.');
    return `<div class="trd-list">${list.map((t) => offerHtml(t, 'in')).join('')}</div>`;
  }
  function viewEnvoyees() {
    const list = outgoing();
    if (!list.length) return emptyBox('Tu n’as aucune offre en attente.');
    return `<div class="trd-list">${list.map((t) => offerHtml(t, 'out')).join('')}</div>`;
  }

  function viewProposer() {
    const others = [...S.members.values()].filter((m) => m.id !== S.me.id).sort((a, b) => cmp(a.pseudo, b.pseudo));
    if (!others.length) return emptyBox('Aucun autre membre pour le moment.');
    return `<section class="card">
      <h2>Proposer un échange</h2>
      <p class="muted small">Choisis le membre, puis compose ton offre : les cartes que tu donnes, celles que tu demandes et des Paillettes.</p>
      <div class="trd-picker">
        <div class="field">
          <label for="trd-who">Membre</label>
          <select id="trd-who" class="input">
            <option value="">Choisir un membre…</option>
            ${others.map((m) => `<option value="${esc(m.id)}"${m.id === S.pickWho ? ' selected' : ''}>${esc(m.pseudo)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" type="button" data-act="compose" ${S.pickWho ? '' : 'disabled'}>Composer l’offre</button>
      </div>
      <p class="trd-hint">Ton solde : ${esc(fmtP(S.balance))}</p>
    </section>`;
  }

  /** Données des correspondances, ciblées : exemplaires des cartes que je souhaite, et souhaits des autres
      pour les cartes que j'ai en double. Mises en cache jusqu'au prochain échange. */
  function loadMatches() {
    return S.matchesP ??= computeMatchData().catch((e) => { S.matchesP = null; throw e; });
  }
  async function computeMatchData() {
    const me = S.me.id;
    const counts = new Map();
    for (const c of S.copies.values()) {
      if (c.owner_id === me && !c.recycled_at && cardOk(c)) counts.set(c.card_id, (counts.get(c.card_id) || 0) + 1);
    }
    const dupCards = [...counts].filter(([, n]) => n >= 2).map(([card]) => card);
    const [wanted, wishers] = await Promise.all([
      fetchIn('hg_card_copies', 'card_id', [...(S.wish.get(me) || [])], COPY_COLS, { filter: (q) => q.is('recycled_at', null) }),
      fetchIn('hg_card_wishlist', 'card_id', dupCards, 'user_id, card_id', { order: 'user_id' }),
    ]);
    for (const c of wanted) S.copies.set(String(c.id), c); // pour l'éditeur (« Proposer un échange »)
    await ensureCards([...wanted.map((c) => c.card_id), ...dupCards]);
    return { wanted, wishers };
  }

  /** Correspondances : doublons des autres et souhaits que tu peux satisfaire, regroupés par membre. */
  function computeMatches(data) {
    const me = S.me.id;
    const myWish = S.wish.get(me) || new Set();
    const stats = new Map(); // « propriétaire|carte » -> { total, free: [exemplaires libres] }
    const seen = new Map([...S.copies, ...data.wanted.map((c) => [String(c.id), c])]);
    for (const c of seen.values()) {
      if (c.recycled_at || !c.owner_id || !cardOk(c)) continue;
      const k = `${c.owner_id}|${c.card_id}`;
      const s = stats.get(k) || { total: 0, free: [] };
      s.total++;
      if (!c.locked_trade) s.free.push(c);
      stats.set(k, s);
    }
    const rows = [];
    // « X a une carte que tu souhaites » : X en a au moins deux exemplaires
    for (const [k, s] of stats) {
      const [owner, card] = k.split('|');
      if (owner === me || !S.members.has(owner) || !s.free.length || s.total < 2 || !myWish.has(card)) continue;
      rows.push({ kind: 'want', member: owner, copy: s.free[0] });
    }
    // « X souhaite une carte que tu as en double » : tu en as au moins deux exemplaires
    const wishOf = new Map();
    for (const w of data.wishers) {
      if (!wishOf.has(w.user_id)) wishOf.set(w.user_id, new Set());
      wishOf.get(w.user_id).add(w.card_id);
    }
    for (const [uid, wset] of wishOf) {
      if (uid === me || !S.members.has(uid)) continue;
      for (const card of wset) {
        const mine = stats.get(`${me}|${card}`);
        if (mine && mine.total >= 2 && mine.free.length) rows.push({ kind: 'offer', member: uid, copy: mine.free[0] });
      }
    }
    return rows;
  }
  function viewCorrespondances(data) {
    const rows = computeMatches(data);
    if (!rows.length) return emptyBox('Aucune correspondance pour le moment. Les correspondances apparaissent quand tes souhaits et les doublons des autres membres se rejoignent.');
    const groups = new Map();
    for (const r of rows) {
      if (!groups.has(r.member)) groups.set(r.member, []);
      groups.get(r.member).push(r);
    }
    const sorted = [...groups.entries()].sort((a, b) => cmp(pseudo(a[0]), pseudo(b[0])));
    return sorted.map(([uid, list]) => {
      const who = memberOf(uid);
      const items = list.sort((a, b) => byCard(a.copy, b.copy)).map((r) => {
        const label = r.kind === 'want'
          ? `${who.pseudo} a une carte que tu souhaites`
          : `${who.pseudo} souhaite une carte que tu as en double`;
        const attr = r.kind === 'want' ? `data-want="${r.copy.id}"` : `data-give="${r.copy.id}"`;
        return `<li class="trd-match">
          ${copyCard(r.copy)}
          <p>${esc(label)}</p>
          <button class="btn btn-ghost" type="button" data-act="open-match" data-to="${esc(uid)}" ${attr}>Proposer un échange</button>
        </li>`;
      }).join('');
      return `<section class="card trd-match-group">
        <header class="trd-who">${avatarHtml(who, 36)}<h2>${esc(who.pseudo)}</h2></header>
        <ul class="trd-match-list">${items}</ul>
      </section>`;
    }).join('');
  }

  function historyHtml(t) {
    const me = S.me.id;
    const other = t.from_user === me ? t.to_user : t.from_user;
    const mine = t.from_user === me ? 'from' : 'to';
    const theirs = mine === 'from' ? 'to' : 'from';
    const pails = (side) => (side === 'from' ? t.from_paillettes : t.to_paillettes);
    const accepted = t.status === 'acceptee';
    let badge, sides;
    if (isGift(t)) {
      badge = pill('Cadeau', 'pill-ok');
      sides = [[mine === 'from' ? 'Tu offres' : 'Tu reçois', itemsOf(t, 'from'), 0]];
    } else {
      const [lm, lt] = accepted ? ['Tu donnes', 'Tu reçois'] : ['Proposé : tu donnes', 'Demandé : tu reçois'];
      badge = pill(STATUS_LABEL[t.status] || t.status, accepted ? 'pill-ok' : '');
      sides = [[lm, itemsOf(t, mine), pails(mine)], [lt, itemsOf(t, theirs), pails(theirs)]];
    }
    return articleHtml({ who: memberOf(other), date: t.resolved_at || t.created_at, badge, sides, message: t.message });
  }
  function viewHistorique() {
    const list = S.trades.filter((t) => t.status !== 'proposee')
      .sort((a, b) => new Date(b.resolved_at || b.created_at) - new Date(a.resolved_at || a.created_at));
    if (!list.length) return emptyBox('Aucun échange terminé pour le moment.');
    return `<div class="trd-list">${list.map(historyHtml).join('')}</div>`;
  }

  function renderPanel() {
    renderTabs();
    panel.setAttribute('aria-labelledby', `trd-tab-${S.tab}`);
    if (S.tab === 'correspondances') {
      const tab = S.tab;
      panel.innerHTML = '<p class="empty">Recherche des correspondances…</p>';
      loadMatches()
        .then((data) => { if (S.tab === tab) panel.innerHTML = viewCorrespondances(data); })
        .catch((e) => { if (S.tab === tab) panel.innerHTML = `<div class="empty">Impossible de charger les correspondances : ${esc(errMsg(e))}</div>`; });
      return;
    }
    const view = { recues: viewRecues, envoyees: viewEnvoyees, proposer: viewProposer, historique: viewHistorique }[S.tab];
    panel.innerHTML = view();
  }
  const render = () => renderPanel();

  /* ---------- Éditeur d'offre (<dialog>) ---------- */
  async function openEditor({ to, parent = null, give = [], want = [], giveP = 0, wantP = 0, message = '' }) {
    if (!to || !S.members.has(to)) return toast('Choisis un membre pour l’échange.', 'error');
    try { await ensurePeer(to); } catch (e) { return toast(errMsg(e), 'error'); }
    Object.assign(E, { to, parent, give: new Set(give.map(String)), want: new Set(want.map(String)), giveP, wantP, message, q: '', busy: false });
    renderEditor();
    dlg.showModal();
  }

  function renderEditor() {
    const to = memberOf(E.to);
    const isCounter = !!E.parent;
    const title = isCounter ? `Contre-proposition à ${to.pseudo}` : `Proposer un échange à ${to.pseudo}`;
    const note = isCounter
      ? 'Ta contre-proposition remplace l’offre reçue : l’offre d’origine ne sera plus valable.'
      : 'Les cartes que tu donnes sont bloquées le temps que l’offre est en attente.';
    dlg.setAttribute('aria-labelledby', 'trd-edit-title');
    form.innerHTML = `
      <header class="trd-dlg-head">
        <div><p class="eyebrow">${isCounter ? 'Contre-proposition' : 'Nouvelle offre'}</p><h2 id="trd-edit-title">${esc(title)}</h2></div>
        <button class="trd-close" type="button" data-act="close-editor" aria-label="Fermer">×</button>
      </header>
      <div class="trd-dlg-body">
        <p class="trd-note">${esc(note)}</p>
        <div class="field">
          <label for="trd-q">Rechercher une carte</label>
          <input id="trd-q" type="search" value="${esc(E.q)}" autocomplete="off" placeholder="Nom de la carte">
        </div>
        <div class="trd-cols">
          <fieldset class="trd-col">
            <legend>Je donne</legend>
            <p class="trd-count" id="trd-n-give"></p>
            <div class="trd-grid" id="trd-grid-give"></div>
            <div class="field">
              <label for="trd-gp">Paillettes que je donne</label>
              <input id="trd-gp" type="number" min="0" step="1" inputmode="numeric" value="${E.giveP}">
              <p class="trd-hint">Ton solde : ${esc(fmtP(S.balance))}</p>
            </div>
          </fieldset>
          <fieldset class="trd-col">
            <legend>Je demande à ${esc(to.pseudo)}</legend>
            <p class="trd-count" id="trd-n-want"></p>
            <div class="trd-grid" id="trd-grid-want"></div>
            <div class="field">
              <label for="trd-wp">Paillettes que je demande</label>
              <input id="trd-wp" type="number" min="0" step="1" inputmode="numeric" value="${E.wantP}">
            </div>
          </fieldset>
        </div>
        <div class="field">
          <label for="trd-msg">Message (facultatif)</label>
          <textarea id="trd-msg" maxlength="500" rows="3">${esc(E.message)}</textarea>
          <p class="trd-hint" id="trd-mcount"></p>
        </div>
        <p class="trd-summary" id="trd-sum"></p>
        <p class="trd-err" id="trd-err" role="alert"></p>
      </div>
      <footer class="trd-dlg-foot">
        ${isCounter ? '' : '<button class="btn btn-ghost" type="button" data-act="gift" id="trd-gift">Offrir en cadeau</button>'}
        <button class="btn btn-ghost" type="button" data-act="close-editor">Annuler</button>
        <button class="btn btn-primary" type="submit" id="trd-send">${isCounter ? 'Envoyer la contre-proposition' : 'Envoyer l’offre'}</button>
      </footer>`;
    renderPicks();
    updateSummary();
  }

  /** Ajoute au besoin les exemplaires déjà sélectionnés (ex. offre pré-remplie) pour qu'ils restent visibles. */
  const withSelected = (base, set) => [...base, ...[...set].map(copyOf).filter((c) => c && !base.includes(c))].sort(byCard);
  function pickHtml(c, side, set) {
    const on = set.has(String(c.id));
    return `<div class="trd-pickwrap${on ? ' is-on' : ''}">${cardHtml(shown(cardOf(c)), {
      size: 'sm', shiny: c.shiny, serial: c.serial, button: true,
      attrs: `aria-pressed="${on}" data-side="${side}" data-id="${c.id}"`,
    })}<span class="trd-tick" aria-hidden="true">✓</span></div>`;
  }
  function renderPicks() {
    const q = norm(E.q.trim());
    const matchQ = (c) => !q || norm(cardOf(c).name).includes(q);
    const give = withSelected(tradables(S.me.id), E.give).filter(matchQ);
    const want = withSelected(tradables(E.to, E.parent), E.want).filter(matchQ);
    const none = q ? 'Aucune carte ne correspond à la recherche.' : 'Aucune carte disponible.';
    form.querySelector('#trd-grid-give').innerHTML = give.map((c) => pickHtml(c, 'give', E.give)).join('') || `<p class="trd-none">${none}</p>`;
    form.querySelector('#trd-grid-want').innerHTML = want.map((c) => pickHtml(c, 'want', E.want)).join('') || `<p class="trd-none">${none}</p>`;
  }
  function updateSummary() {
    const g = E.give.size, w = E.want.size;
    form.querySelector('#trd-n-give').textContent = `${pluralCount(g, 'carte sélectionnée', 'cartes sélectionnées')}`;
    form.querySelector('#trd-n-want').textContent = `${pluralCount(w, 'carte sélectionnée', 'cartes sélectionnées')}`;
    form.querySelector('#trd-sum').textContent = `Récapitulatif : tu donnes ${pluralCount(g, 'carte', 'cartes')}${E.giveP ? ` et ${fmtP(E.giveP)}` : ''} ; tu demandes ${pluralCount(w, 'carte', 'cartes')}${E.wantP ? ` et ${fmtP(E.wantP)}` : ''}.`;
    form.querySelector('#trd-mcount').textContent = `${E.message.length} / 500 caractères`;
  }
  function showErr(msg) {
    const box = form.querySelector('#trd-err');
    if (box) box.textContent = msg;
  }
  function setEditorBusy(on) {
    form.querySelectorAll('button').forEach((b) => { b.disabled = on; });
  }
  function togglePick(btn) {
    const set = btn.dataset.side === 'give' ? E.give : E.want;
    const id = btn.dataset.id;
    const on = !set.has(id);
    if (on) set.add(id); else set.delete(id);
    btn.setAttribute('aria-pressed', String(on));
    btn.parentElement.classList.toggle('is-on', on);
    showErr('');
    updateSummary();
  }

  async function sendOffer(gift) {
    if (E.busy) return;
    const isCounter = !!E.parent;
    const to = memberOf(E.to);
    const give = [...E.give].map(Number);
    const want = gift ? [] : [...E.want].map(Number);
    const message = E.message.trim() || null;
    if (gift) {
      if (!give.length) return showErr('Choisis au moins une carte à offrir.');
      const ok = await confirmBox('Offrir ce cadeau ?',
        `Tu offres ${pluralCount(give.length, 'carte', 'cartes')} à ${to.pseudo}. Le cadeau est définitif. Les cartes demandées et les Paillettes ne sont pas prises en compte.`,
        { ok: 'Offrir' });
      if (!ok) return;
    } else {
      if (!give.length && !want.length && !E.giveP && !E.wantP) return showErr('L’offre est vide : ajoute au moins une carte ou des Paillettes.');
      if (E.giveP > S.balance) return showErr(`Pas assez de Paillettes : tu en as ${fmtP(S.balance)}.`);
    }
    E.busy = true; setEditorBusy(true); showErr('');
    const res = gift
      ? await sb.rpc('hg_card_gift', { p_to: E.to, p_copies: give, p_message: message })
      : await sb.rpc('hg_trade_propose', { p_to: E.to, p_give: give, p_want: want, p_give_p: E.giveP, p_want_p: E.wantP, p_message: message, p_parent: E.parent });
    E.busy = false; setEditorBusy(false);
    if (res.error) return showErr(errMsg(res.error));
    if (!gift && res.data) notify('trade_offer', { trade_id: res.data }).catch(() => {}); // MP au destinataire (opt-in)
    dlg.close();
    const msg = gift ? `Cadeau offert à ${to.pseudo}` : isCounter ? 'Contre-proposition envoyée' : `Offre envoyée à ${to.pseudo}`;
    await finish(null, msg);
  }

  /* ---------- Actions sur les offres ---------- */
  async function respond(t, accept) {
    if (accept) {
      const give = itemsOf(t, 'from'), recv = itemsOf(t, 'to');
      const ok = await confirmBox('Accepter cet échange ?',
        `Tu reçois ${pluralCount(give.length, 'carte', 'cartes')}${t.from_paillettes ? ` et ${fmtP(t.from_paillettes)}` : ''} et tu donnes ${pluralCount(recv.length, 'carte', 'cartes')}${t.to_paillettes ? ` et ${fmtP(t.to_paillettes)}` : ''}. L’échange est définitif.`,
        { ok: 'Accepter' });
      if (!ok) return;
    }
    setPanelBusy(true);
    const { error } = await sb.rpc('hg_trade_respond', { p_trade: t.id, p_accept: accept });
    if (!error && accept) notify('card_trade', { trade_id: t.id }).catch(() => {});
    await finish(error, accept ? 'Échange conclu' : 'Offre refusée');
  }
  async function cancelOffer(t) {
    setPanelBusy(true);
    const { error } = await sb.rpc('hg_trade_cancel', { p_trade: t.id });
    await finish(error, 'Offre annulée');
  }
  function setPanelBusy(on) {
    panel.setAttribute('aria-busy', String(on));
    panel.querySelectorAll('button').forEach((b) => { b.disabled = on; });
  }
  /** Après une action : message, rechargement des données, rendu et refresh de la page. */
  async function finish(error, okMsg) {
    if (error) toast(errMsg(error), 'error');
    else toast(okMsg, 'ok');
    try { await load(); } catch (e) { toast(errMsg(e), 'error'); }
    render();
    if (!error) { try { await ctx.refresh?.(); } catch (e) { console.warn('[cartes-trades] refresh', e); } }
  }

  /* ---------- Événements ---------- */
  root.addEventListener('click', (e) => {
    const tab = e.target.closest('.trd-tab');
    if (tab && tabsEl.contains(tab)) {
      e.stopPropagation(); // les onglets de la page parente (cartes.js) ne doivent pas réagir à ceux-ci
      S.tab = tab.dataset.tab; render(); tabsEl.querySelector(`[data-tab="${S.tab}"]`)?.focus(); return;
    }
    const pick = e.target.closest('button[data-side]');
    if (pick && dlg.contains(pick)) return togglePick(pick);
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close-editor') return dlg.close();
    if (act === 'gift') return sendOffer(true);
    if (act === 'retry') return start();
    if (act === 'compose') return openEditor({ to: S.pickWho });
    if (act === 'open-match') return openEditor({
      to: b.dataset.to,
      give: b.dataset.give ? [b.dataset.give] : [],
      want: b.dataset.want ? [b.dataset.want] : [],
    });
    const t = S.trades.find((x) => x.id === b.dataset.id);
    if (!t) return;
    if (act === 'accept') return respond(t, true);
    if (act === 'refuse') return respond(t, false);
    if (act === 'cancel') return cancelOffer(t);
    if (act === 'counter') return openEditor({
      to: t.from_user, parent: t.id,
      give: idsOf(t, 'to'), want: idsOf(t, 'from'),
      giveP: t.to_paillettes, wantP: t.from_paillettes,
    });
  });
  root.addEventListener('change', (e) => {
    if (e.target.id !== 'trd-who') return;
    S.pickWho = e.target.value;
    const btn = panel.querySelector('[data-act="compose"]');
    if (btn) btn.disabled = !S.pickWho;
  });
  tabsEl.addEventListener('keydown', (e) => {
    const i = TABS.findIndex((t) => t.id === S.tab);
    const j = { ArrowRight: (i + 1) % TABS.length, ArrowLeft: (i - 1 + TABS.length) % TABS.length, Home: 0, End: TABS.length - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    S.tab = TABS[j].id;
    render();
    tabsEl.querySelector(`[data-tab="${S.tab}"]`)?.focus();
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); sendOffer(false); });
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); });
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'trd-gp') E.giveP = toInt(t.value);
    else if (t.id === 'trd-wp') E.wantP = toInt(t.value);
    else if (t.id === 'trd-msg') E.message = t.value;
    else if (t.id === 'trd-q') { E.q = t.value; renderPicks(); }
    else return;
    showErr('');
    updateSummary();
  });

  /* ---------- Démarrage ---------- */
  async function start() {
    panel.innerHTML = '<p class="empty">Chargement des échanges…</p>';
    try {
      if (!S.me) S.me = ctx.me?.id ? ctx.me : { id: (await getUser())?.id };
      if (!S.me?.id) throw new Error('Connexion requise.');
      await load();
      render();
    } catch (e) {
      panel.innerHTML = `<div class="empty">Impossible de charger les échanges : ${esc(errMsg(e))}
        <div class="btn-row trd-retry"><button class="btn btn-ghost" type="button" data-act="retry">Réessayer</button></div></div>`;
    }
  }
  await start();
}
