// ===== Humane Gang — administration : cartes à collectionner =====
// Séries (hg_card_sets), cartes (hg_cards), exemplaires (hg_card_copies), portefeuilles (hg_wallets, hg_wallet_log),
// échanges (hg_card_trades, hg_card_trade_items) et réglages (hg_settings.cards).
// Actions sensibles par RPC : hg_cards_admin_give, hg_cards_admin_paillettes, hg_cards_admin_take, hg_trade_cancel.
// Rendu d'une carte : cardHtml de cartes-ui.js. Images : bucket public hg-assets, dossier cards/.
import { sb, toast, errMsg, esc, $, $$, avatarHtml } from './core.js';
import { RARITIES, FAMILIES, rarityLabel, familyLabel, cardHtml, serialLabel, fmtP } from './cartes-ui.js';
import { toZurichInput, fromZurichInput } from './admin-events.js';

const TZ = 'Europe/Zurich';
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
  off: svg('<circle cx="12" cy="12" r="8"/><path d="M6 6l12 12"/>'),
  on: svg('<path d="M5 12l5 5 9-10"/>'),
};
const TABS = [['series', 'Séries'], ['cartes', 'Cartes'], ['economie', 'Économie'], ['joueurs', 'Joueurs'], ['stats', 'Statistiques'], ['echanges', 'Échanges']];
const RARITY_IDS = RARITIES.map((r) => r.id);
const CRAFT_IDS = ['commune', 'peu_commune', 'rare', 'epique', 'legendaire']; // mythique et identite ne se fabriquent jamais
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };
const REASON_LABEL = {
  booster: 'Booster', quotidien: 'Passage du jour', recyclage: 'Recyclage', fabrication: 'Fabrication', echange: 'Échange',
  reponse_sortie: 'Réponse à une sortie', sortie_creee: 'Sortie créée', photo: 'Photo publiée', moment: 'Moment publié',
  badge: 'Badge gagné', capture: 'Image attrapée', presence: 'Présence à une sortie', cadeau_santa: 'Cadeau Secret Santa',
  serie_complete: 'Série complète', admin: 'Ajustement admin',
};
// Valeurs de repli = celles de la migration 018 (utilisées seulement si hg_settings.cards est vide).
const CFG_DEFAULT = {
  booster_price: 100, booster_size: 5, free_booster_hours: 24, shiny_rate: 3, pity_epique: 10, max_open_trades: 10,
  rates: { commune: 60, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.88, mythique: 0.1, identite: 0.02 },
  recycle: { commune: 5, peu_commune: 10, rare: 25, epique: 60, legendaire: 150, mythique: 400, identite: 1000, shiny_multiplier: 3 },
  craft: { commune: 40, peu_commune: 80, rare: 200, epique: 500, legendaire: 1500, shiny_multiplier: 4 },
  rewards: { daily: 20, streak_bonus: 5, streak_max: 7, rsvp: 15, presence: 30, photo: 2, moment: 15, gift_sent: 50, badge: 40, capture: 10, event_created: 25, set_complete: 300 },
};
const REWARDS = [
  ['daily', 'Passage du jour'], ['streak_bonus', 'Bonus par jour de série (en plus)'], ['streak_max', 'Série maximale (jours)'],
  ['rsvp', 'Réponse « oui » à une sortie'], ['presence', 'Présence à une sortie passée'], ['photo', 'Photo publiée'],
  ['moment', 'Moment publié'], ['gift_sent', 'Cadeau Secret Santa envoyé'], ['badge', 'Badge gagné'],
  ['capture', 'Image attrapée (événement)'], ['event_created', 'Sortie ou événement créé'], ['set_complete', 'Série complète (une fois par série)'],
];
// Réglages éditables. k = chemin (« rates.commune ») ; le nom du champ de formulaire remplace le point par un tiret bas.
const ECON = [
  { g: 'Boosters', fields: [
    { k: 'booster_price', l: 'Prix d\'un booster', u: '✦', int: true },
    { k: 'booster_size', l: 'Cartes par booster', int: true, min: 1, max: 10 },
    { k: 'free_booster_hours', l: 'Délai du booster gratuit', u: 'heures', step: 0.5 },
  ] },
  { g: 'Taux de tirage', hint: 'Part de chaque rareté dans un booster. Le total devrait faire 100 %.', rates: true,
    fields: RARITY_IDS.map((r) => ({ k: `rates.${r}`, l: rarityLabel(r), u: '%', step: 0.01 })) },
  { g: 'Brillantes et garantie', fields: [
    { k: 'shiny_rate', l: 'Taux de carte brillante', u: '%', step: 0.1, max: 100 },
    { k: 'pity_epique', l: 'Garantie épique : une carte Épique ou mieux tous les N boosters (0 = aucune)', int: true },
  ] },
  { g: 'Recyclage', hint: 'Paillettes reçues en recyclant un exemplaire.', fields: [
    ...RARITY_IDS.map((r) => ({ k: `recycle.${r}`, l: rarityLabel(r), u: '✦', int: true })),
    { k: 'recycle.shiny_multiplier', l: 'Multiplicateur brillante', u: '×', int: true, min: 1 },
  ] },
  { g: 'Fabrication', hint: 'Coût pour fabriquer une carte précise. Vide = non fabricable. Mythique et Identité ne se fabriquent jamais.', fields: [
    ...CRAFT_IDS.map((r) => ({ k: `craft.${r}`, l: rarityLabel(r), u: '✦', int: true, optional: true })),
    { k: 'craft.shiny_multiplier', l: 'Multiplicateur brillante', u: '×', int: true, min: 1 },
  ] },
  { g: 'Récompenses', hint: 'Gains en Paillettes liés à l\'activité sur le site.', fields: REWARDS.map(([k, l]) => ({
    k: `rewards.${k}`, l, int: true, min: k === 'streak_max' ? 1 : 0 })) },
  { g: 'Échanges', fields: [{ k: 'max_open_trades', l: 'Offres en cours maximum par personne', int: true, min: 1 }] },
];

/* ---------- État ---------- */
const C = {
  root: null, panel: null, tab: 'series',
  sets: [], cards: [], copies: [], wallets: [], trades: [], items: [], profiles: [], cfgRaw: {},
  setById: new Map(), cardById: new Map(), copiesByCard: new Map(), copiesByOwner: new Map(), walletById: new Map(), byId: new Map(),
  f: { set: '', rarity: '', family: '' }, identSet: '', playerId: '',
};

/* ---------- Petits outils ---------- */
const check = (res) => { if (res.error) throw res.error; return res.data; };
const nf = (n) => new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 2 }).format(n || 0);
const fmtWhen = (iso) => (iso ? new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');
const pseudo = (id) => (id ? C.byId.get(id)?.pseudo ?? 'Ancien membre' : '—');
const friendly = (e, map = {}) => (e?.code && map[e.code]) || errMsg(e);
const group = (rows, key) => {
  const m = new Map();
  for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
};
const maxSerialOf = (cardId) => (C.copiesByCard.get(cardId) || []).reduce((m, x) => Math.max(m, x.serial || 0), 0);
const liveCount = (cardId) => (C.copiesByCard.get(cardId) || []).filter((x) => !x.recycled_at).length;
const nextFreeNumber = (setId) => {
  const used = new Set(C.cards.filter((k) => k.set_id === setId).map((k) => k.number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
};
const nextSetSort = () => C.sets.reduce((m, s) => Math.max(m, s.sort), -1) + 1;
const identSetId = () => (C.sets.some((s) => s.id === C.identSet) ? C.identSet : C.sets[0]?.id || '');
const thumb = (k) => (k.image_url ? `<img class="acd-thumb" src="${esc(k.image_url)}" alt="" loading="lazy">` : '<span class="acd-thumb acd-thumb-ph" aria-hidden="true"></span>');
const tile = (v, l) => `<div class="acd-tile"><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`;
const selField = (id, label, f, options, val) => `<div class="field"><label for="${id}">${esc(label)}</label>
  <select id="${id}" data-f="${f}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
const setState = (s, now = Date.now()) => {
  if (!s.active) return ['pill-todo', 'Désactivée'];
  if (s.starts_at && new Date(s.starts_at).getTime() > now) return ['pill-current', 'À venir'];
  if (s.ends_at && new Date(s.ends_at).getTime() <= now) return ['pill-todo', 'Terminée'];
  return ['pill-ok', 'Active'];
};
const period = (s) => (s.starts_at || s.ends_at
  ? `${s.starts_at ? 'du ' + fmtWhen(s.starts_at) : 'dès le début'}${s.ends_at ? ' au ' + fmtWhen(s.ends_at) : ', sans fin'}`
  : 'toujours disponible');
const dlgHead = (title) => `<div class="acd-dlg-head"><h2 id="acd-dlg-title" class="dialog-title">${esc(title)}</h2>
  <button class="btn btn-ghost btn-sm" type="button" data-acd-close>Fermer</button></div>`;

function dialog() {
  let d = document.getElementById('acd-dlg');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'acd-dlg'; d.className = 'hg-dialog acd-dlg';
    d.setAttribute('aria-labelledby', 'acd-dlg-title');
    d.addEventListener('click', (e) => { if (e.target.closest('[data-acd-close]')) d.close(); });
    document.body.append(d);
  }
  return d;
}
function confirmBox(title, body, { ok = 'Confirmer', danger = false } = {}) {
  const dlg = $('#confirm-dlg');
  $('#confirm-title').textContent = title;
  $('#confirm-body').textContent = body;
  const okBtn = $('#confirm-ok');
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}
async function act(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { toast(errMsg(e), 'error'); } finally { if (btn?.isConnected) btn.disabled = false; }
}
async function removeImages(urls) {
  const paths = urls.map((u) => /\/hg-assets\/(cards\/[^?#]+)/.exec(u || '')?.[1]).filter(Boolean).map((p) => decodeURIComponent(p));
  if (!paths.length) return;
  try { await sb.storage.from('hg-assets').remove(paths); } catch { /* image orpheline : non bloquant */ }
}
async function uploadCardImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choisis une image (PNG, JPG, WebP, GIF ou SVG).');
  if (file.size > 5 * 1024 * 1024) throw new Error('Image trop lourde (5 Mo maximum).');
  const path = `cards/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${EXT[file.type] || 'png'}`;
  check(await sb.storage.from('hg-assets').upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' }));
  return sb.storage.from('hg-assets').getPublicUrl(path).data.publicUrl;
}

/** Lecture complète d'une table (PostgREST renvoie au plus 1000 lignes par requête). */
async function fetchAll(make) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if ((data || []).length < PAGE) break;
  }
  return out;
}

/* ---------- Chargement ---------- */
async function load() {
  const [sets, cards, copies, wallets, trades, profiles, st] = await Promise.all([
    fetchAll(() => sb.from('hg_card_sets').select('*').order('id')),
    fetchAll(() => sb.from('hg_cards').select('*').order('id')),
    fetchAll(() => sb.from('hg_card_copies').select('id, card_id, owner_id, shiny, serial, source, obtained_at, locked_trade, recycled_at').order('id')),
    fetchAll(() => sb.from('hg_wallets').select('user_id, paillettes, boosters_opened, pity_epique').order('user_id')),
    fetchAll(() => sb.from('hg_card_trades').select('id, from_user, to_user, status, from_paillettes, to_paillettes, message, created_at').order('id')),
    fetchAll(() => sb.from('hg_profiles').select('id, pseudo, avatar_url, color, is_ghost, joined_on').order('id')),
    sb.from('hg_settings').select('value').eq('key', 'cards').maybeSingle(),
  ]);
  const stv = check(st);
  C.sets = sets.sort((a, b) => (a.sort - b.sort) || a.code.localeCompare(b.code));
  C.cards = cards;
  C.copies = copies;
  C.wallets = wallets;
  C.trades = trades;
  C.profiles = profiles.sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
  C.cfgRaw = stv?.value && typeof stv.value === 'object' && !Array.isArray(stv.value) ? structuredClone(stv.value) : {};
  C.setById = new Map(C.sets.map((s) => [s.id, s]));
  C.cardById = new Map(cards.map((k) => [k.id, k]));
  C.copiesByCard = group(copies, (x) => x.card_id);
  C.copiesByOwner = group(copies.filter((x) => x.owner_id && !x.recycled_at), (x) => x.owner_id);
  C.walletById = new Map(wallets.map((w) => [w.user_id, w]));
  C.byId = new Map(C.profiles.map((p) => [p.id, p]));
  const openIds = trades.filter((t) => t.status === 'proposee').map((t) => t.id);
  C.items = openIds.length ? (check(await sb.from('hg_card_trade_items').select('trade_id, side').in('trade_id', openIds)) ?? []) : [];
  if (!C.sets.some((s) => s.id === C.identSet)) C.identSet = C.sets[0]?.id || '';
}
async function refresh() {
  try { await load(); render(); } catch (e) { toast(errMsg(e), 'error'); }
}
async function boot() {
  C.panel.innerHTML = '<div class="empty">Chargement…</div>';
  try { await load(); render(); } catch (e) {
    C.panel.innerHTML = `<div class="empty">Impossible de charger les cartes : ${esc(errMsg(e))}
      <div class="btn-row acd-center"><button class="btn btn-ghost btn-sm" type="button" data-act="retry">Réessayer</button></div></div>`;
  }
}

/* =========================================================
   Séries
   ========================================================= */
function setsPanel() {
  const counts = group(C.cards, (k) => k.set_id);
  return `<div class="acd-head">
      <p class="small muted">Une série regroupe des cartes. Supprimer une série supprime aussi toutes ses cartes et les exemplaires qu'en ont les membres.</p>
      <button class="btn btn-primary" type="button" data-act="set-new">${ICON.plus} Nouvelle série</button>
    </div>
    ${C.sets.length ? `<ul class="acd-list">${C.sets.map((s) => {
      const n = (counts.get(s.id) || []).length;
      const [cls, label] = setState(s);
      return `<li class="acd-item">
        <div class="acd-item-main">
          <p><strong>${esc(s.name)}</strong> <code class="acd-code">${esc(s.code)}</code> <span class="pill ${cls}">${esc(label)}</span></p>
          <p class="small muted">${nf(n)} carte${n > 1 ? 's' : ''} · ${esc(period(s))} · ordre ${esc(s.sort)}</p>
          ${s.description ? `<p class="small">${esc(s.description)}</p>` : ''}
          ${s.active ? '' : '<p class="acd-note" role="note"><strong>Inactive :</strong> ses cartes ne sortent pas dans les boosters et les membres ne la voient pas.</p>'}
        </div>
        <div class="btn-row acd-set-actions">
          <button class="btn ${s.active ? 'btn-ghost' : 'btn-primary'} acd-set-toggle" type="button" data-act="set-toggle" data-id="${esc(s.id)}" aria-pressed="${s.active ? 'true' : 'false'}">${s.active ? `${ICON.off} Désactiver la série` : `${ICON.on} Activer la série`}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-act="set-edit" data-id="${esc(s.id)}">${ICON.edit} Modifier</button>
          <button class="btn btn-danger btn-sm" type="button" data-act="set-del" data-id="${esc(s.id)}">${ICON.trash} Supprimer</button>
        </div>
      </li>`;
    }).join('')}</ul>` : '<div class="empty">Aucune série pour l\'instant. Crée la première pour y ajouter des cartes.</div>'}`;
}

function openSetDialog(s = null) {
  const d = dialog();
  const isNew = !s;
  const v = s || {};
  d.innerHTML = `
    <form class="stack acd-form" id="acd-set-form" novalidate>
      ${dlgHead(isNew ? 'Nouvelle série' : `Modifier « ${s.name} »`)}
      <p class="form-error" role="alert" hidden></p>
      <div class="acd-grid-2">
        <div class="field"><label for="acs-code">Code unique</label>
          <input id="acs-code" name="code" required maxlength="32" autocomplete="off" placeholder="ex. hiver-2026" value="${esc(v.code ?? '')}">
          <span class="small muted">Lettres minuscules, chiffres et tirets.</span></div>
        <div class="field"><label for="acs-name">Nom</label><input id="acs-name" name="name" required maxlength="60" autocomplete="off" value="${esc(v.name ?? '')}"></div>
      </div>
      <div class="field"><label for="acs-desc">Description</label><textarea id="acs-desc" name="description" rows="2" maxlength="300">${esc(v.description ?? '')}</textarea></div>
      <fieldset class="acd-fs"><legend>Disponibilité <span class="muted small">(heure suisse, facultatif)</span></legend>
        <div class="acd-grid-2">
          <div class="field"><label for="acs-start">Début</label><input id="acs-start" name="starts_at" type="datetime-local" value="${esc(toZurichInput(v.starts_at))}"></div>
          <div class="field"><label for="acs-end">Fin</label><input id="acs-end" name="ends_at" type="datetime-local" value="${esc(toZurichInput(v.ends_at))}"></div>
        </div>
        <p class="small muted">Sans dates, la série est toujours disponible. Hors période, ses cartes ne sortent plus dans les boosters.</p>
      </fieldset>
      <div class="acd-grid-2">
        <div class="field"><label for="acs-sort">Ordre d'affichage</label><input id="acs-sort" name="sort" type="number" step="1" value="${esc(v.sort ?? nextSetSort())}"></div>
        <label class="switch"><input type="checkbox" name="active"${(v.active ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Série active</span></label>
      </div>
      <div class="btn-row dialog-actions">
        <button class="btn btn-ghost" type="button" data-acd-close>Annuler</button>
        <button class="btn btn-primary" type="submit">${isNew ? 'Créer la série' : 'Enregistrer'}</button>
      </div>
    </form>`;
  d.showModal();
  const form = $('#acd-set-form', d);
  form.elements.code.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const err = $('.form-error', form);
    const showErr = (m) => { err.textContent = m; err.hidden = !m; };
    showErr('');
    const E = form.elements;
    const row = {
      code: E.code.value.trim().toLowerCase(), name: E.name.value.trim(), description: E.description.value.trim() || null,
      starts_at: fromZurichInput(E.starts_at.value), ends_at: fromZurichInput(E.ends_at.value),
      sort: Math.round(Number(E.sort.value) || 0), active: E.active.checked,
    };
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(row.code)) return showErr('Le code doit faire 2 à 32 caractères : lettres minuscules, chiffres et tirets.');
    if (row.name.length < 2) return showErr('Donne un nom à la série (2 caractères minimum).');
    if (row.starts_at && row.ends_at && new Date(row.ends_at) <= new Date(row.starts_at)) return showErr('La fin doit être après le début.');
    if (btn) btn.disabled = true;
    try {
      if (isNew) check(await sb.from('hg_card_sets').insert(row));
      else check(await sb.from('hg_card_sets').update(row).eq('id', s.id));
      d.close();
      toast(isNew ? `Série « ${row.name} » créée` : 'Série enregistrée', 'ok');
      await refresh();
    } catch (err2) {
      showErr(friendly(err2, { 23505: 'Ce code de série existe déjà.' }));
    } finally { if (btn?.isConnected) btn.disabled = false; }
  });
}

/** Active ou désactive une série (réversible : pas de confirmation). */
async function toggleSet(btn, id) {
  const s = C.setById.get(id);
  if (!s) return;
  await act(btn, async () => {
    check(await sb.from('hg_card_sets').update({ active: !s.active }).eq('id', id));
    toast(s.active ? `Série « ${s.name} » désactivée` : `Série « ${s.name} » activée`, 'ok');
    await refresh();
  });
}

async function deleteSet(id) {
  const s = C.setById.get(id);
  if (!s) return;
  const cards = C.cards.filter((k) => k.set_id === id);
  const copies = cards.reduce((n, k) => n + (C.copiesByCard.get(k.id)?.length || 0), 0);
  const ok = await confirmBox(`Supprimer la série « ${s.name} » ?`,
    `Ses ${nf(cards.length)} carte${cards.length > 1 ? 's' : ''} seront supprimées définitivement, ainsi que ${nf(copies)} exemplaire${copies > 1 ? 's' : ''} chez les membres. Les échanges concernés restent visibles sans ces cartes. Action définitive.`,
    { ok: 'Supprimer', danger: true });
  if (!ok) return;
  check(await sb.from('hg_card_sets').delete().eq('id', id));
  await removeImages(cards.map((k) => k.image_url));
  toast('Série supprimée', 'ok');
  await refresh();
}

/* =========================================================
   Cartes
   ========================================================= */
function identityBox() {
  const idSet = identSetId();
  const ident = C.cards.filter((k) => k.set_id === idSet && k.rarity === 'identite');
  const missing = C.profiles.filter((p) => !ident.some((k) => k.member_id === p.id));
  return `<section class="card acd-ident" aria-labelledby="acd-ident-h">
    <h3 class="card-title" id="acd-ident-h">Cartes Identité</h3>
    <p class="small muted">Les cartes Identité sont les plus rares : une par membre, numérotée (max_copies conseillé : 5 à 10).</p>
    ${C.sets.length ? `<div class="acd-ident-row">
      ${selField('acd-ident-set', 'Série', 'identSet', C.sets.map((s) => [s.id, s.name]), idSet)}
      <button class="btn btn-sand" type="button" data-act="ident-make"${missing.length ? '' : ' disabled'}>${ICON.plus} Créer les cartes Identité manquantes</button>
    </div>
    <p class="small muted">${missing.length
      ? `${nf(missing.length)} membre${missing.length > 1 ? 's' : ''} sans carte Identité dans cette série : une carte par membre sera créée.`
      : 'Tous les membres ont leur carte Identité dans cette série.'}</p>`
    : '<p class="small muted">Crée une série pour pouvoir ajouter des cartes Identité.</p>'}
  </section>`;
}

function cardRow(k) {
  const id = esc(k.id);
  const exemp = k.max_copies
    ? `<span title="Numéros déjà distribués">${nf(maxSerialOf(k.id))} / ${nf(k.max_copies)}</span>`
    : `${nf(liveCount(k.id))} en circulation`;
  return `<tr${k.active ? '' : ' class="is-off"'}>
    <td>#${esc(k.number)}</td>
    <td><span class="acd-cardcell">${thumb(k)}<span>${esc(k.name)}${k.caption ? `<br><span class="small acd-caption">${esc(k.caption)}</span>` : ''}${k.member_id && pseudo(k.member_id) !== k.name ? `<br><span class="small muted">${esc(pseudo(k.member_id))}</span>` : ''}</span></span></td>
    <td>${esc(C.setById.get(k.set_id)?.name ?? '—')}</td>
    <td>${esc(familyLabel(k.family))}</td>
    <td><span class="pill acd-rar acd-rar-${esc(k.rarity)}">${esc(rarityLabel(k.rarity))}</span></td>
    <td>${exemp}</td>
    <td>${k.active ? '<span class="pill pill-ok">Active</span>' : '<span class="pill pill-todo">Désactivée</span>'}</td>
    <td class="acd-actions">
      <button class="btn btn-ghost btn-sm" type="button" data-act="card-edit" data-id="${id}">${ICON.edit} Modifier</button>
      <button class="btn btn-ghost btn-sm" type="button" data-act="card-toggle" data-id="${id}">${k.active ? `${ICON.off} Désactiver` : `${ICON.on} Activer`}</button>
      <button class="btn btn-danger btn-sm btn-icon" type="button" data-act="card-del" data-id="${id}" aria-label="Supprimer ${esc(k.name)}" title="Supprimer">${ICON.trash}</button>
    </td>
  </tr>`;
}

function cardsPanel() {
  if (!C.sets.length) return `${identityBox()}<div class="empty">Crée d'abord une série : les cartes s'y rangent.</div>`;
  const f = C.f;
  const list = C.cards
    .filter((k) => (!f.set || k.set_id === f.set) && (!f.rarity || k.rarity === f.rarity) && (!f.family || k.family === f.family))
    .sort((a, b) => (C.setById.get(a.set_id)?.sort ?? 0) - (C.setById.get(b.set_id)?.sort ?? 0) || a.number - b.number);
  return `${identityBox()}
    <div class="acd-toolbar" role="group" aria-label="Filtrer les cartes">
      ${selField('acd-f-set', 'Série', 'set', [['', 'Toutes les séries'], ...C.sets.map((s) => [s.id, s.name])], f.set)}
      ${selField('acd-f-rarity', 'Rareté', 'rarity', [['', 'Toutes les raretés'], ...RARITIES.map((r) => [r.id, r.label])], f.rarity)}
      ${selField('acd-f-family', 'Famille', 'family', [['', 'Toutes les familles'], ...FAMILIES.map((x) => [x.id, x.label])], f.family)}
      <button class="btn btn-primary" type="button" data-act="card-new">${ICON.plus} Nouvelle carte</button>
    </div>
    <p class="small muted">${nf(list.length)} carte${list.length > 1 ? 's' : ''} affichée${list.length > 1 ? 's' : ''} sur ${nf(C.cards.length)}.</p>
    ${list.length ? `<div class="acd-scroll" tabindex="0" role="region" aria-label="Liste des cartes">
      <table class="acd-table">
        <thead><tr><th scope="col">N°</th><th scope="col">Carte</th><th scope="col">Série</th><th scope="col">Famille</th><th scope="col">Rareté</th><th scope="col">Exemplaires</th><th scope="col">État</th><th scope="col"><span class="acd-sr">Actions</span></th></tr></thead>
        <tbody>${list.map(cardRow).join('')}</tbody>
      </table></div>`
      : '<div class="empty">Aucune carte ne correspond à ces filtres.</div>'}`;
}

function openCardDialog(k = null) {
  const d = dialog();
  const isNew = !k;
  const setDefault = k?.set_id || C.f.set || identSetId() || C.sets[0]?.id || '';
  const used = k ? maxSerialOf(k.id) : 0;
  d.innerHTML = `
    <form class="stack acd-form" id="acd-card-form" novalidate>
      ${dlgHead(isNew ? 'Nouvelle carte' : `Modifier « ${k.name} »`)}
      <p class="form-error" role="alert" hidden></p>
      <div class="acd-dlg-grid">
        <div class="stack">
          <div class="acd-grid-2">
            <div class="field"><label for="acc-set">Série</label>
              <select id="acc-set" name="set_id" required>${C.sets.map((s) => `<option value="${esc(s.id)}"${s.id === setDefault ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="acc-number">Numéro</label>
              <input id="acc-number" name="number" type="number" min="1" step="1" inputmode="numeric" required value="${esc(k ? k.number : nextFreeNumber(setDefault))}">
              <span class="small muted">Le plus petit numéro libre de la série.</span></div>
          </div>
          <div class="field"><label for="acc-name">Nom</label><input id="acc-name" name="name" required maxlength="60" autocomplete="off" value="${esc(k?.name ?? '')}"></div>
          <div class="field"><label for="acc-caption">Légende <span class="muted small">(facultatif)</span></label>
            <input id="acc-caption" name="caption" maxlength="80" autocomplete="off" placeholder="ex. 2015 · CD Projekt Red" value="${esc(k?.caption ?? '')}" aria-describedby="acc-caption-help">
            <span class="small muted" id="acc-caption-help"><span id="acc-caption-count">${nf((k?.caption ?? '').length)}</span> / 80 caractères, affichée sous le nom.</span></div>
          <div class="acd-grid-2">
            <div class="field"><label for="acc-family">Famille</label>
              <select id="acc-family" name="family">${FAMILIES.map((x) => `<option value="${x.id}"${(k?.family ?? 'membre') === x.id ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
            <div class="field"><label for="acc-rarity">Rareté</label>
              <select id="acc-rarity" name="rarity">${RARITIES.map((r) => `<option value="${r.id}"${(k?.rarity ?? 'commune') === r.id ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select></div>
          </div>
          <fieldset class="acd-fs"><legend>Image</legend>
            <div class="field"><label for="acc-file">Téléverser une image</label>
              <input id="acc-file" name="file" type="file" accept="image/png,image/webp,image/jpeg,image/gif,image/svg+xml"></div>
            <div class="field"><label for="acc-url">Ou URL de l'image</label>
              <input id="acc-url" name="image_url" type="url" inputmode="url" placeholder="https://…" value="${esc(k?.image_url ?? '')}"></div>
            <p class="small muted">Sans image, la carte affiche le logo du gang.</p>
            <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-acc-noimg>Retirer l'image</button></div>
          </fieldset>
          <div class="field"><label for="acc-flavor">Texte d'ambiance</label>
            <textarea id="acc-flavor" name="flavor" rows="2" maxlength="280">${esc(k?.flavor ?? '')}</textarea></div>
        </div>
        <div class="stack">
          <div class="field"><span class="label" id="acc-prev-l">Aperçu</span>
            <div class="acd-card-preview" id="acc-card-preview" role="img" aria-labelledby="acc-prev-l"></div></div>
          <div class="field"><label for="acc-member">Membre lié</label>
            <select id="acc-member" name="member_id"><option value="">Aucun</option>${C.profiles.map((p) => `<option value="${esc(p.id)}"${p.id === k?.member_id ? ' selected' : ''}>${esc(p.pseudo)}${p.is_ghost ? ' (fantôme)' : ''}</option>`).join('')}</select>
            <span class="small muted">Requis pour les familles Membre et la rareté Identité.</span></div>
          <div class="field"><label for="acc-max">Exemplaires numérotés maximum</label>
            <input id="acc-max" name="max_copies" type="number" min="1" step="1" inputmode="numeric" placeholder="illimité" value="${esc(k?.max_copies ?? '')}">
            <span class="small muted">Identité : 5 à 10 conseillé. Vide = illimité.${used ? ` ${nf(used)} numéro${used > 1 ? 's' : ''} déjà distribué${used > 1 ? 's' : ''}.` : ''}</span></div>
          <fieldset class="acd-fs"><legend>Options</legend>
            <label class="switch"><input type="checkbox" name="can_shiny"${(k?.can_shiny ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Peut être brillante</span></label>
            <label class="switch"><input type="checkbox" name="tradeable"${(k?.tradeable ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Échangeable</span></label>
            <label class="switch"><input type="checkbox" name="craftable"${(k?.craftable ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Fabricable</span></label>
            <label class="switch"><input type="checkbox" name="active"${(k?.active ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Active (tirée dans les boosters)</span></label>
          </fieldset>
        </div>
      </div>
      <div class="btn-row dialog-actions">
        <button class="btn btn-ghost" type="button" data-acd-close>Annuler</button>
        <button class="btn btn-primary" type="submit">${isNew ? 'Créer la carte' : 'Enregistrer'}</button>
      </div>
    </form>`;
  d.showModal();
  const form = $('#acd-card-form', d);
  const E = form.elements;
  let previewUrl = null;
  const readRaw = () => {
    const num = Number(E.number.value);
    const maxRaw = E.max_copies.value.trim();
    return {
      set_id: E.set_id.value, number: num, name: E.name.value.trim(), family: E.family.value, rarity: E.rarity.value,
      image_url: E.image_url.value.trim() || null, flavor: E.flavor.value.trim() || null, member_id: E.member_id.value || null,
      max_copies: maxRaw === '' ? null : Number(maxRaw),
    };
  };
  const paint = () => {
    const v = readRaw();
    $('#acc-card-preview', d).innerHTML = cardHtml({
      name: v.name || 'Nom de la carte', rarity: v.rarity, family: v.family, image_url: previewUrl || v.image_url,
      flavor: v.flavor, number: Number.isInteger(v.number) && v.number > 0 ? v.number : '?', max_copies: v.max_copies,
    }, { size: 'md' });
  };
  /** Valeurs validées du formulaire ; lève une erreur lisible sinon. */
  const validate = () => {
    const v = { ...readRaw(), can_shiny: E.can_shiny.checked, tradeable: E.tradeable.checked, craftable: E.craftable.checked, active: E.active.checked };
    if (!v.set_id) throw new Error('Choisis une série.');
    if (!Number.isInteger(v.number) || v.number < 1) throw new Error('Le numéro doit être un nombre entier, à partir de 1.');
    if (v.name.length < 2) throw new Error('Donne un nom à la carte (2 caractères minimum).');
    if (v.max_copies !== null && (!Number.isInteger(v.max_copies) || v.max_copies < 1)) throw new Error('Exemplaires maximum : un nombre entier à partir de 1 (ou vide pour illimité).');
    if (k && v.max_copies !== null && v.max_copies < used) throw new Error(`Des exemplaires sont déjà numérotés jusqu'au n° ${used} : le maximum ne peut pas descendre en dessous.`);
    if (v.image_url && !/^https?:\/\//.test(v.image_url)) throw new Error('L\'URL de l\'image doit commencer par https://');
    if ((v.family === 'membre' || v.rarity === 'identite') && !v.member_id) throw new Error('Une carte Membre ou Identité doit être liée à un membre.');
    return v;
  };

  E.file.addEventListener('change', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const f = E.file.files?.[0];
    previewUrl = f ? URL.createObjectURL(f) : null;
    paint();
  });
  $('[data-acc-noimg]', d).addEventListener('click', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; E.file.value = ''; E.image_url.value = ''; paint();
  });
  E.set_id.addEventListener('change', () => { if (isNew) E.number.value = nextFreeNumber(E.set_id.value); paint(); });
  E.rarity.addEventListener('change', () => {
    // Identité : 10 exemplaires numérotés proposés si rien n'est indiqué (modifiable)
    if (E.rarity.value === 'identite' && !E.max_copies.value.trim()) E.max_copies.value = '10';
    paint();
  });
  form.addEventListener('input', paint);
  d.addEventListener('close', () => { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; }, { once: true });
  paint();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const err = $('.form-error', form);
    const showErr = (m) => { err.textContent = m; err.hidden = !m; if (m) err.scrollIntoView({ block: 'nearest' }); };
    showErr('');
    if (btn) btn.disabled = true;
    try {
      const v = validate();
      const file = E.file.files?.[0] ?? null;
      const image_url = file ? await uploadCardImage(file) : v.image_url;
      const row = { ...v, image_url, flavor: v.flavor || null };
      if (isNew) check(await sb.from('hg_cards').insert(row));
      else check(await sb.from('hg_cards').update(row).eq('id', k.id));
      d.close();
      toast(isNew ? `Carte « ${v.name} » créée` : 'Carte enregistrée', 'ok');
      await refresh();
    } catch (err2) {
      showErr(friendly(err2, { 23505: 'Ce numéro est déjà pris dans cette série.' }));
    } finally { if (btn?.isConnected) btn.disabled = false; }
  });
  E.name.focus();
}

async function deleteCard(id) {
  const k = C.cardById.get(id);
  if (!k) return;
  const n = (C.copiesByCard.get(id) || []).length;
  const ok = await confirmBox(`Supprimer « ${k.name} » ?`,
    `${n ? `Ses ${nf(n)} exemplaire${n > 1 ? 's seront retirés' : ' sera retiré'} des collections des membres. ` : ''}Action définitive. Pour la retirer du tirage sans la perdre, désactive-la plutôt.`,
    { ok: 'Supprimer', danger: true });
  if (!ok) return;
  check(await sb.from('hg_cards').delete().eq('id', id));
  await removeImages([k.image_url]);
  toast('Carte supprimée', 'ok');
  await refresh();
}

async function makeIdentities(btn) {
  const setId = identSetId();
  const set = C.setById.get(setId);
  if (!set) return;
  const ident = C.cards.filter((k) => k.set_id === setId && k.rarity === 'identite');
  const missing = C.profiles.filter((p) => !ident.some((k) => k.member_id === p.id));
  if (!missing.length) return;
  const ok = await confirmBox('Créer les cartes Identité ?',
    `${nf(missing.length)} carte${missing.length > 1 ? 's' : ''} Identité seront créées dans « ${set.name} » : une par membre, nommée d'après son pseudo, avec son avatar et 10 exemplaires numérotés. Tu pourras les modifier ensuite.`,
    { ok: 'Créer' });
  if (!ok) return;
  const used = new Set(C.cards.filter((k) => k.set_id === setId).map((k) => k.number));
  const rows = missing.map((p) => {
    let num = 1;
    while (used.has(num)) num++;
    used.add(num);
    return {
      set_id: setId, number: num, name: p.pseudo, family: 'membre', rarity: 'identite', image_url: p.avatar_url || null,
      member_id: p.id, can_shiny: true, tradeable: true, craftable: true, max_copies: 10, active: true,
    };
  });
  await act(btn, async () => {
    check(await sb.from('hg_cards').insert(rows));
    toast(`${nf(rows.length)} carte${rows.length > 1 ? 's' : ''} Identité créée${rows.length > 1 ? 's' : ''}`, 'ok');
    await refresh();
  });
}

/* =========================================================
   Économie
   ========================================================= */
function getPath(obj, k) {
  const [a, b] = k.split('.');
  const v = b ? obj?.[a]?.[b] : obj?.[a];
  return v ?? null;
}
const cfgSource = () => (Object.keys(C.cfgRaw || {}).length ? C.cfgRaw : CFG_DEFAULT);
function econField(f) {
  const name = f.k.replace('.', '_');
  const val = getPath(cfgSource(), f.k);
  return `<div class="field"><label for="acd-e-${name}">${esc(f.l)}${f.u ? ` <span class="muted small">(${esc(f.u)})</span>` : ''}</label>
    <input id="acd-e-${name}" name="${name}" type="number" inputmode="decimal" step="${f.step ?? 1}" min="${f.min ?? 0}"${f.max != null ? ` max="${f.max}"` : ''}
      value="${val == null ? '' : esc(val)}"${f.optional ? ' placeholder="vide = non fabricable"' : ''}></div>`;
}
function econPanel() {
  return `<p class="small muted">Ces réglages s'appliquent aux prochains boosters, recyclages, fabrications et récompenses.</p>
    <form class="stack acd-econ" id="acd-econ-form" novalidate>
      <p class="form-error" role="alert" hidden></p>
      ${ECON.map((g) => `<fieldset class="acd-fs"><legend>${esc(g.g)}</legend>
        ${g.hint ? `<p class="small muted">${esc(g.hint)}</p>` : ''}
        <div class="acd-grid-2">${g.fields.map(econField).join('')}</div>
        ${g.rates ? '<p class="acd-sum" id="acd-rate-sum" aria-live="polite"></p>' : ''}
      </fieldset>`).join('')}
      <div class="btn-row">
        <button class="btn btn-primary" type="submit">Enregistrer les réglages</button>
        <button class="btn btn-ghost" type="button" data-act="econ-reset">Annuler les modifications</button>
      </div>
    </form>`;
}
function updateSum() {
  const form = $('#acd-econ-form', C.panel);
  const out = $('#acd-rate-sum', C.panel);
  if (!form || !out) return;
  const total = RARITY_IDS.reduce((s, r) => s + (Number(form.elements[`rates_${r}`]?.value) || 0), 0);
  const ok = Math.abs(total - 100) < 0.001;
  out.textContent = `Total des taux : ${nf(Math.round(total * 100) / 100)} %${ok ? '' : ' · le total devrait faire 100 %'}`;
  out.classList.toggle('is-warn', !ok);
}
/** Relit le formulaire et renvoie la configuration complète (les clés inconnues sont conservées). */
function readEcon(form) {
  const out = structuredClone(C.cfgRaw || {});
  for (const g of ECON) for (const f of g.fields) {
    const name = f.k.replace('.', '_');
    const [a, b] = f.k.split('.');
    const raw = String(form.elements[name].value).trim();
    if (f.optional && raw === '') { if (b && out[a]) delete out[a][b]; continue; }
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) throw new Error(`« ${f.l} » : indique un nombre.`);
    if (n < (f.min ?? 0) || (f.max != null && n > f.max)) throw new Error(`« ${f.l} » : valeur entre ${f.min ?? 0} et ${f.max ?? 'sans limite'}.`);
    if (f.int && !Number.isInteger(n)) throw new Error(`« ${f.l} » : nombre entier attendu.`);
    if (b) out[a] = { ...(out[a] || {}), [b]: n };
    else out[a] = n;
  }
  return out;
}
async function saveEcon(form, btn) {
  const err = $('.form-error', form);
  const showErr = (m) => { err.textContent = m; err.hidden = !m; if (m) err.scrollIntoView({ block: 'nearest' }); };
  showErr('');
  let next;
  try { next = readEcon(form); } catch (e) { return showErr(errMsg(e)); }
  await act(btn, async () => {
    check(await sb.from('hg_settings').upsert({ key: 'cards', value: next, updated_at: new Date().toISOString() }));
    toast('Réglages enregistrés', 'ok');
    await refresh();
  });
}

/* =========================================================
   Joueurs
   ========================================================= */
const REASON = (r) => REASON_LABEL[r] || r;
function playersPanel() {
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
async function refreshLog() {
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
async function adjustPaillettes(form, btn) {
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
async function giveCard(form, btn) {
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
async function takeCopy(btn, id) {
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

/* =========================================================
   Statistiques
   ========================================================= */
function statsPanel() {
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

/* =========================================================
   Échanges en cours
   ========================================================= */
function tradesPanel() {
  const open = C.trades.filter((t) => t.status === 'proposee').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const concluded = C.trades.filter((t) => t.status === 'acceptee').length;
  const count = (id, side) => C.items.filter((i) => i.trade_id === id && i.side === side).length;
  return `<p class="small muted">${nf(open.length)} offre${open.length > 1 ? 's' : ''} en attente de réponse · ${nf(concluded)} échange${concluded > 1 ? 's' : ''} conclu${concluded > 1 ? 's' : ''}.</p>
    ${open.length ? `<ul class="acd-list">${open.map((t) => `<li class="acd-item">
      <div class="acd-item-main">
        <p><strong>${esc(pseudo(t.from_user))}</strong> → <strong>${esc(pseudo(t.to_user))}</strong></p>
        <p class="small muted">Offre du ${esc(fmtWhen(t.created_at))} · ${nf(count(t.id, 'from'))} carte(s) offerte(s) contre ${nf(count(t.id, 'to'))} demandée(s)${t.from_paillettes || t.to_paillettes ? ` · ${nf(t.from_paillettes)} ✦ et ${nf(t.to_paillettes)} ✦` : ''}</p>
        ${t.message ? `<p class="small acd-msg">« ${esc(t.message)} »</p>` : ''}
      </div>
      <div class="btn-row"><button class="btn btn-danger btn-sm" type="button" data-act="trade-cancel" data-id="${esc(t.id)}">Annuler l'offre</button></div>
    </li>`).join('')}</ul>` : '<div class="empty">Aucun échange en cours.</div>'}`;
}
async function cancelTrade(btn, id) {
  const ok = await confirmBox('Annuler cette offre ?', 'Les cartes bloquées pour cette offre seront à nouveau disponibles pour leurs propriétaires.', { ok: 'Annuler l\'offre', danger: true });
  if (!ok) return;
  await act(btn, async () => {
    check(await sb.rpc('hg_trade_cancel', { p_trade: id }));
    toast('Offre annulée', 'ok');
    await refresh();
  });
}

/* =========================================================
   Rendu et événements
   ========================================================= */
const PANELS = { series: setsPanel, cartes: cardsPanel, economie: econPanel, joueurs: playersPanel, stats: statsPanel, echanges: tradesPanel };
function render() {
  $$('[data-tab]', C.root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === C.tab)));
  C.panel.innerHTML = PANELS[C.tab]();
  if (C.tab === 'joueurs') refreshLog();
  if (C.tab === 'economie') updateSum();
}

const ACTIONS = {
  retry: () => boot(),
  'set-new': () => openSetDialog(),
  'set-edit': (t, id) => openSetDialog(C.setById.get(id) || null),
  'set-toggle': (t, id) => toggleSet(t, id),
  'set-del': (t, id) => deleteSet(id),
  'card-new': () => openCardDialog(),
  'card-edit': (t, id) => openCardDialog(C.cardById.get(id) || null),
  'card-toggle': (t, id) => act(t, async () => {
    const k = C.cardById.get(id);
    if (!k) return;
    check(await sb.from('hg_cards').update({ active: !k.active }).eq('id', id));
    toast(k.active ? 'Carte désactivée' : 'Carte activée', 'ok');
    await refresh();
  }),
  'card-del': (t, id) => deleteCard(id),
  'ident-make': (t) => makeIdentities(t),
  'copy-take': (t, id) => takeCopy(t, id),
  'trade-cancel': (t, id) => cancelTrade(t, id),
  'econ-reset': () => render(),
};

function onClick(e) {
  const t = e.target.closest('[data-tab],[data-act]');
  if (!t || !C.root.contains(t)) return;
  if (t.dataset.tab) { C.tab = t.dataset.tab; render(); return; }
  ACTIONS[t.dataset.act]?.(t, t.dataset.id);
}
function onChange(e) {
  const t = e.target;
  if (t.id === 'acd-ident-set') C.identSet = t.value;
  else if (t.id === 'acd-pl-member') C.playerId = t.value;
  else if (t.dataset.f && t.dataset.f !== 'identSet') C.f[t.dataset.f] = t.value;
  else return;
  render();
}
function onInput(e) {
  if (e.target.form?.id === 'acd-econ-form') updateSum();
}
function onSubmit(e) {
  const form = e.target;
  if (form.id === 'acd-econ-form') { e.preventDefault(); return saveEcon(form, e.submitter); }
  if (form.id === 'acd-pl-pay') { e.preventDefault(); return adjustPaillettes(form, e.submitter); }
  if (form.id === 'acd-pl-give') { e.preventDefault(); return giveCard(form, e.submitter); }
}

/**
 * Monte la section « Cartes à collectionner » de l'admin dans container.
 * Autonome : ne dépend d'aucune autre section ; se recharge seul après chaque modification.
 */
export async function mountCardsSection(container) {
  if (!container) return;
  C.root = container;
  container.innerHTML = `<div class="acd">
    <div class="filters acd-tabs" role="group" aria-label="Parties de la section cartes">
      ${TABS.map(([id, label]) => `<button class="chip" type="button" data-tab="${id}" aria-pressed="${id === C.tab}">${label}</button>`).join('')}
    </div>
    <div id="acd-panel"></div>
  </div>`;
  C.panel = $('#acd-panel', container);
  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  container.addEventListener('input', onInput);
  container.addEventListener('submit', onSubmit);
  await boot();
}
