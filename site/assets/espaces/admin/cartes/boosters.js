// =====================================================================
// Cartes admin : onglet « Boosters » (types de boosters de la Boutique, hg_booster_types).
// Autonome : un seul point d'entrée, mountBoostersTab(el), qui lit ses propres données et gère ses propres
// événements (aucune dépendance à l'état partagé C de la section). Peut être monté ailleurs (nouvelle navigation).
// Liste : cartouche miniature, nom, prix, taille, limite, statut, ventes 7 j ; Modifier, Activer / Désactiver
// (confirmation dans la ligne), monter / descendre (ordre « sort »), « Nouveau type ». Statistiques par type.
// Éditeur (tiroir large, deux colonnes sur grand écran, sous-sections repliables) : Général, Chances (taux en direct,
// probabilités, valeur de recyclage, simulateur de 1 000 ouvertures), Contenu (pool, raretés et séries exclues), Limites.
// Écriture : RPC hg_booster_type_save(p jsonb) (migration 071) ; statistiques : RPC hg_booster_type_stats().
// Droits : admin ou Staff avec la permission « cartes » ; sinon lecture seule (champs désactivés, explication).
// Dépendances : core.js (sb, toast, errMsg, esc, $, $$, currentLogo, hasPerm), cartes-ui.js (rarityLabel),
// admin/ui/drawer.js (openDrawer), constants.js (CFG_DEFAULT, RARITY_IDS, ICON), helpers.js (check, nf).
// Style des cartouches : cartes-boosters.css et boosters-styles.css (chargées à la demande) + géométrie copiée dans admin-cards.css.
// Exporte : mountBoostersTab, BOOSTER_STYLES, effectiveRates, boosterOdds, recycleValue, simulate, savePayload.
// Contrat 071 : création { create: true, id, … } ; modification { id, …champs changés } ; réponse { type, created, free_daily_removed_from }.
// Statistiques : { types: [{ id, sales: { d7|d30|total: { boosters, paillettes } }, opens: { total… }, stock: { total, holders }, gifts: { total… } }], opens_since }.
// =====================================================================
import { paillSym } from '../../../commun/paillettes.js';
import { sb, toast, errMsg, esc, $, $$, currentLogo, hasPerm } from '../../../commun/core.js';
import { rarityLabel } from '../../cartes/cartes-ui.js';
import { openDrawer } from '../ui/drawer.js';
import { CFG_DEFAULT, RARITY_IDS, ICON } from './constants.js';
import { check, nf } from './helpers.js';
import { saisonDefaults, saisonSectionHtml, readSaison, validateSaison, saisonPayload } from './boosters-saison.js';
import { BOOSTER_STYLES, BOOSTER_STYLE_LIST, BOOSTER_STYLE_FAMILIES, boosterStyleClass } from '../../cartes/booster-styles.js';
import { themeDecor } from '../../cartes/booster-themes.js';
import { confirmBox } from '../../../commun/ui-confirm.js';

/* ---------- Constantes ---------- */
/** Les 56 styles de cartouche (9 d'origine + 30 couleurs + 14 thèmes + 3 de saison) : liste de référence dans booster-styles.js. */
export { BOOSTER_STYLES };
/** Contenu possible d'un booster (colonne pool). */
const POOLS = [
  ['tous', 'Toutes les séries', 'Les cartes sont tirées dans toutes les séries ouvertes.'],
  ['serie', 'Une série au choix', 'Le joueur choisit la série au moment d’ouvrir le booster.'],
  ['manquantes', 'Cartes manquantes', 'Seulement des cartes que le joueur n’a pas encore (sans doublon dans le booster).'],
];
/** Raretés « Épique ou mieux » (garantie épique et probabilités affichées). */
const HIGH = ['epique', 'legendaire', 'mythique', 'identite'];
/** Couleur de chaque rareté (barres du simulateur), comme la loupe des cartes. */
const TINT = { commune: '#c4c9d6', peu_commune: '#2fd17a', rare: '#4f80ff', epique: '#a674f5', legendaire: '#FCA301', mythique: '#FE3104', identite: '#FBD32D' };
/** Identifiant d'un type : lettres minuscules, chiffres, tiret bas (2 à 30). */
const ID_RE = /^[a-z0-9_]{2,30}$/;
/** Seuil d'alerte : valeur moyenne au recyclage au-delà de ce pourcentage du prix. */
const RECYCLE_WARN = 60;
/** Nombre d'ouvertures du simulateur. */
const SIM_N = 1000;
/** Icônes des flèches (ordre d'affichage). */
const ARROW = {
  up: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
};

/* ---------- État de l'onglet ---------- */
// root : conteneur monté ; types : lignes de hg_booster_types triées ; sets : séries (code, name) ;
// recycle : barème de recyclage (hg_settings.cards.recycle) ; stats : Map id -> chiffres ; statsErr : message si indisponibles ;
// canWrite : écriture permise ; confirm : identifiant du type dont le retrait attend confirmation.
const B = { root: null, types: [], sets: [], recycle: { ...CFG_DEFAULT.recycle }, stats: new Map(), statsErr: '', opensSince: null, canWrite: false, confirm: null };

/* ---------- Outils ---------- */
/** Nombre arrondi à d décimales. */
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
/** Pourcentage lisible (« 12,5 % »). */
const pct = (n) => `${nf(round(n, 1))} %`;
/** Libellé d'un style de cartouche. */
const styleLabel = (s) => BOOSTER_STYLES.find(([c]) => c === s)?.[1] || 'Classique';
/** Classe de style sûre (une des 39), sinon classique. */
const safeStyle = boosterStyleClass;
/** Liste de chaînes (colonne text[]), vide si absente. */
const arr = (v) => (Array.isArray(v) ? v.map(String) : []);

/**
 * HTML d'une cartouche miniature (même markup que cartridgeHtml de cartes.js), à l'échelle s.
 * @param {{style?: string, name?: string, size?: number}} t type (ou brouillon)
 * @param {number} s échelle (0.25 = 55 × 72 px)
 */
function cartHtml(t, s = 0.3) {
  const style = safeStyle(t.style);
  const deco = themeDecor(style); // thèmes à décor dessiné : SVG du corps et de l'écran, calque d'éléments (booster-themes.js)
  return `<span class="abt-cart" style="--s:${s}" aria-hidden="true"><span class="cart-box ${esc(style)}">`
    + `<span class="cart-body">${deco ? deco.body : ''}</span><span class="cart-notch"></span>`
    + `<span class="cart-label"><span class="cart-label-fl"></span><span class="cart-scr">${deco ? deco.scr : `<img src="${esc(currentLogo())}" alt="">`}</span></span>`
    + '<span class="cart-lbl1">LE GANG</span>'
    + `<span class="cart-lbl2">${esc(String(t.name || styleLabel(t.style)).toUpperCase())}</span>`
    + '<span class="cart-stripe"><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="cart-ridge"></span>'
    + `<span class="cart-foot">${esc(nf(Number(t.size) || 5))} CARTES</span>${deco ? deco.over : ''}</span></span>`;
}

/** Charge cartes-boosters.css (9 styles d'origine) et boosters-styles.css (30 couleurs) une seule fois. */
function ensureCss() {
  if (document.querySelector('link[data-abt-css]')) return;
  ['/assets/espaces/cartes/cartes-boosters.css', '/assets/espaces/cartes/boosters-styles.css'].forEach((href) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.dataset.abtCss = '1';
    document.head.append(l);
  });
}

/**
 * Sélecteur visuel des styles : un groupe par famille de couleurs (titre + grille de cartouches nommées).
 * Un seul groupe de boutons radio (name="style") ; le motif et la luminosité sont rappelés au survol (title).
 * @param {object} t type (ou brouillon) : style actuel, taille
 * @returns {string}
 */
function styleGridHtml(t) {
  const cur = safeStyle(t.style);
  return BOOSTER_STYLE_FAMILIES.map(([fam, famLabel]) => {
    const list = BOOSTER_STYLE_LIST.filter((st) => st.fam === fam);
    if (!list.length) return '';
    return `<div class="abt-style-fam" role="group" aria-labelledby="abt-fam-${fam}">
        <p class="abt-style-fh" id="abt-fam-${fam}">${esc(famLabel)} <span class="muted">(${list.length})</span></p>
        <div class="abt-style-grid">${list.map((st) => `<label class="abt-style"${st.motif ? ` title="${esc(`${st.label} : ${st.motif}`)}"` : ''}>
          <input type="radio" name="style" value="${esc(st.cls)}"${cur === st.cls ? ' checked' : ''}>
          ${cartHtml({ style: st.cls, name: st.label, size: t.size }, 0.25)}<span class="abt-style-l">${esc(st.label)}</span></label>`).join('')}</div>
      </div>`;
  }).join('');
}

/* =========================================================
   Calculs (purs) : taux effectifs, probabilités, recyclage, simulation
   ========================================================= */
/**
 * Taux effectifs après exclusion : le poids d'une rareté exclue passe à la rareté voisine inférieure
 * non exclue (sinon supérieure), comme le tirage en base. Renvoie null si toutes les raretés sont exclues.
 * @param {object} rates taux saisis par rareté
 * @param {string[]} excluded raretés exclues
 * @returns {object|null} rareté -> poids
 */
export function effectiveRates(rates, excluded = []) {
  const ok = RARITY_IDS.filter((r) => !excluded.includes(r));
  if (!ok.length) return null;
  const out = Object.fromEntries(RARITY_IDS.map((r) => [r, 0]));
  RARITY_IDS.forEach((r, i) => {
    const w = Math.max(0, Number(rates?.[r]) || 0);
    if (!w) return;
    if (ok.includes(r)) { out[r] += w; return; }
    let j = i - 1;
    while (j >= 0 && !ok.includes(RARITY_IDS[j])) j--;
    if (j < 0) { j = i + 1; while (j < RARITY_IDS.length && !ok.includes(RARITY_IDS[j])) j++; }
    out[RARITY_IDS[j]] += w;
  });
  return out;
}

/**
 * Chances par booster d'avoir au moins une carte d'une rareté donnée ou mieux.
 * @param {object} eff taux effectifs (effectiveRates)
 * @param {number} size cartes par booster
 * @returns {{epique: number, legendaire: number, mythique: number}} pourcentages
 */
export function boosterOdds(eff, size) {
  const total = RARITY_IDS.reduce((s, r) => s + (eff?.[r] || 0), 0) || 1;
  /* Chance (en %) d'avoir au moins une carte de la rareté from ou au-dessus dans le booster. */
  const atLeast = (from) => {
    const p = RARITY_IDS.slice(RARITY_IDS.indexOf(from)).reduce((s, r) => s + (eff?.[r] || 0), 0) / total;
    return (1 - (1 - p) ** Math.max(1, size)) * 100;
  };
  return { epique: atLeast('epique'), legendaire: atLeast('legendaire'), mythique: atLeast('mythique') };
}

/**
 * Valeur moyenne au recyclage d'un booster (Paillettes) : taille × Σ(part × valeur), brillantes comprises.
 * @param {object} eff taux effectifs
 * @param {number} size cartes par booster
 * @param {number} shiny taux de brillante (%)
 * @param {object} recycle barème (recycle.* de hg_settings.cards)
 */
export function recycleValue(eff, size, shiny, recycle) {
  const total = RARITY_IDS.reduce((s, r) => s + (eff?.[r] || 0), 0) || 1;
  const mult = Number(recycle?.shiny_multiplier) || 1;
  // Identité ne se recycle pas (hg_card_recycle) : valeur 0, comme hg_booster_ev (migration 093).
  const perCard = RARITY_IDS.reduce((s, r) => s + (r === 'identite' ? 0 : ((eff?.[r] || 0) / total) * (Number(recycle?.[r]) || 0)), 0);
  return perCard * size * (1 + (Math.min(100, Math.max(0, shiny)) / 100) * (mult - 1));
}

/**
 * Simule n ouvertures avec les taux saisis (tirage au hasard dans le navigateur), garantie épique comprise.
 * @param {{rates: object, excluded: string[], size: number, shiny: number, pity: number}} t réglages
 * @param {number} [n] nombre de boosters
 * @param {() => number} [rnd] générateur (Math.random par défaut)
 * @returns {{n: number, cards: number, counts: object, shiny: number, withHigh: number, pityUsed: number}}
 */
export function simulate({ rates, excluded = [], size = 5, shiny = 0, pity = 0 }, n = SIM_N, rnd = Math.random) {
  const eff = effectiveRates(rates, excluded);
  const counts = Object.fromEntries(RARITY_IDS.map((r) => [r, 0]));
  const res = { n, cards: 0, counts, shiny: 0, withHigh: 0, pityUsed: 0 };
  if (!eff) return res;
  const total = RARITY_IDS.reduce((s, r) => s + eff[r], 0);
  const highOk = HIGH.filter((r) => !excluded.includes(r) && eff[r] > 0);
  const highTotal = highOk.reduce((s, r) => s + eff[r], 0);
  /* Tire une rareté parmi ids, proportionnellement à leurs poids (somme sum). */
  const pick = (ids, sum) => {
    let x = rnd() * sum;
    for (const r of ids) { x -= eff[r]; if (x < 0) return r; }
    return ids[ids.length - 1];
  };
  let counter = 0;
  for (let b = 0; b < n; b++) {
    let high = false;
    for (let c = 0; c < size; c++) {
      let r = total > 0 ? pick(RARITY_IDS, total) : RARITY_IDS[0];
      // Garantie : dernière carte du booster tirée en Épique ou mieux quand le compteur arrive au seuil
      if (c === size - 1 && pity > 0 && !high && counter + 1 >= pity && highTotal > 0 && !HIGH.includes(r)) { r = pick(highOk, highTotal); res.pityUsed++; }
      counts[r]++;
      if (HIGH.includes(r)) high = true;
      if (rnd() * 100 < shiny) res.shiny++;
    }
    res.cards += size;
    if (high) { res.withHigh++; counter = 0; } else counter++;
  }
  return res;
}

/* =========================================================
   Chargement
   ========================================================= */
/** Lit les types, les séries, le barème de recyclage et les statistiques. Les statistiques sont facultatives. */
async function load() {
  const [types, sets, st] = await Promise.all([
    sb.from('hg_booster_types').select('*').order('sort'),
    sb.from('hg_card_sets').select('code, name, sort').order('sort'),
    sb.from('hg_settings').select('value').eq('key', 'cards').maybeSingle(),
  ]);
  B.types = (check(types) ?? []).map((t) => ({ ...t, excluded_rarities: arr(t.excluded_rarities), excluded_sets: arr(t.excluded_sets) }))
    .sort((a, b) => (a.sort - b.sort) || String(a.id).localeCompare(String(b.id)));
  B.sets = (check(sets) ?? []).filter((s) => s?.code).sort((a, b) => ((a.sort ?? 0) - (b.sort ?? 0)) || String(a.name).localeCompare(String(b.name), 'fr'));
  const cfg = check(st)?.value;
  B.recycle = { ...CFG_DEFAULT.recycle, ...(cfg && typeof cfg === 'object' && cfg.recycle && typeof cfg.recycle === 'object' ? cfg.recycle : {}) };
  // Seuil d'alerte « machine à Paillettes » (A7 : cards.alertes.booster_pct, borné comme hg_eco_health)
  const seuil = Number(cfg?.alertes?.booster_pct);
  B.alertPct = Number.isFinite(seuil) ? Math.min(200, Math.max(50, seuil)) : 100;
  await loadStats();
}
/** Lit hg_booster_type_stats ; accepte { types: [...] } ou directement une liste. Une erreur n'empêche pas l'onglet. */
async function loadStats() {
  B.stats = new Map();
  B.statsErr = '';
  try {
    const { data, error } = await sb.rpc('hg_booster_type_stats');
    if (error) throw error;
    const rows = Array.isArray(data) ? data : Array.isArray(data?.types) ? data.types : [];
    for (const r of rows) if (r?.id) B.stats.set(String(r.id), r);
    if (data == null) B.statsErr = 'Statistiques indisponibles pour l’instant.';
    B.opensSince = data?.opens_since || null;
  } catch (e) {
    B.statsErr = `Statistiques indisponibles : ${errMsg(e)}`;
  }
}
/** Relit tout puis redessine ; une erreur s'affiche en toast. */
async function reload() {
  try { await load(); render(); } catch (e) { toast(errMsg(e), 'error'); }
}

/* =========================================================
   Liste et statistiques
   ========================================================= */
/* Chemins des chiffres dans une ligne de hg_booster_type_stats (contrat 071 : objets imbriqués), avec repli sur des clés à plat. */
const STAT_PATH = {
  bought_7d: ['sales', 'd7', 'boosters'], spent_7d: ['sales', 'd7', 'paillettes'],
  bought_30d: ['sales', 'd30', 'boosters'], spent_30d: ['sales', 'd30', 'paillettes'],
  bought_total: ['sales', 'total', 'boosters'], spent_total: ['sales', 'total', 'paillettes'],
  opened_total: ['opens', 'total'], stock_total: ['stock', 'total'], holders: ['stock', 'holders'], gifted_total: ['gifts', 'total'],
};
/** Chiffre d'une statistique (0 si absent). */
const sv = (id, k) => {
  const row = B.stats.get(id);
  if (!row) return 0;
  const nested = (STAT_PATH[k] || []).reduce((o, x) => (o && typeof o === 'object' ? o[x] : undefined), row);
  return Number(nested ?? row[k]) || 0;
};

/** HTML d'une ligne de la liste des types. */
function rowHtml(t, i, n) {
  const sold7 = B.stats.has(t.id) ? `${nf(sv(t.id, 'bought_7d'))} vendus sur 7 j` : '';
  const meta = [`${nf(t.price)} ${paillSym()}`, `${nf(t.size)} cartes`, t.weekly_limit ? `${nf(t.weekly_limit)} par semaine` : 'sans limite', sold7].filter(Boolean);
  const pending = B.confirm === t.id;
  const actions = !B.canWrite
    ? `<button class="btn btn-ghost btn-sm" type="button" data-bt="edit" data-id="${esc(t.id)}">Voir les réglages</button>`
    : pending
      ? `<div class="abt-confirm" role="group" aria-label="Confirmer le retrait">
          <p class="small" id="abt-cf-${esc(t.id)}">Retirer « ${esc(t.name)} » de la Boutique ? Les joueurs gardent leur stock et peuvent encore l’ouvrir ou l’offrir.${t.free_daily ? ' C’est aussi le booster gratuit du jour.' : ''}</p>
          <div class="btn-row"><button class="btn btn-danger btn-sm" type="button" data-bt="off-ok" data-id="${esc(t.id)}" aria-describedby="abt-cf-${esc(t.id)}">Confirmer le retrait</button>
          <button class="btn btn-ghost btn-sm" type="button" data-bt="off-no" data-id="${esc(t.id)}">Annuler</button></div></div>`
      : `<div class="btn-row abt-acts">
          <button class="btn btn-ghost btn-sm abt-ico" type="button" data-bt="up" data-id="${esc(t.id)}" aria-label="Monter « ${esc(t.name)} »"${i === 0 ? ' disabled' : ''}>${ARROW.up}</button>
          <button class="btn btn-ghost btn-sm abt-ico" type="button" data-bt="down" data-id="${esc(t.id)}" aria-label="Descendre « ${esc(t.name)} »"${i === n - 1 ? ' disabled' : ''}>${ARROW.down}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-bt="edit" data-id="${esc(t.id)}">${ICON.edit} Modifier</button>
          ${t.active
            ? `<button class="btn btn-ghost btn-sm" type="button" data-bt="off" data-id="${esc(t.id)}">${ICON.off} Désactiver</button>`
            : `<button class="btn btn-primary btn-sm" type="button" data-bt="on" data-id="${esc(t.id)}">${ICON.on} Activer</button>`}
        </div>`;
  return `<li class="acd-item abt-row${t.active ? '' : ' is-off'}" data-type="${esc(t.id)}">
      ${cartHtml(t, 0.25)}
      <div class="acd-item-main">
        <p><strong>${esc(t.name)}</strong> <code class="acd-code">${esc(t.id)}</code>
          <span class="pill ${t.active ? 'pill-ok' : 'pill-todo'}">${t.active ? 'En vente' : 'Retiré'}</span>
          ${t.free_daily ? '<span class="pill pill-current">Gratuit du jour</span>' : ''}</p>
        <p class="small muted">${meta.map(esc).join(' · ')}</p>
      </div>
      ${actions}
    </li>`;
}

/** HTML du tableau des statistiques par type. */
function statsHtml() {
  if (B.statsErr) return `<p class="small muted">${esc(B.statsErr)}</p>`;
  if (!B.stats.size) return '<p class="small muted">Aucune vente pour l’instant.</p>';
  const cell = (id, n, p) => `<td>${nf(sv(id, n))}<span class="small muted"> · ${nf(sv(id, p))} ${paillSym()}</span></td>`;
  return `<div class="acd-scroll"><table class="acd-table abt-stats">
      <thead><tr><th scope="col">Type</th><th scope="col">7 jours</th><th scope="col">30 jours</th><th scope="col">Total</th>
        <th scope="col">Ouverts</th><th scope="col">En stock</th><th scope="col">Offerts</th></tr></thead>
      <tbody>${B.types.map((t) => `<tr${t.active ? '' : ' class="is-off"'}><th scope="row">${esc(t.name)}</th>
        ${cell(t.id, 'bought_7d', 'spent_7d')}${cell(t.id, 'bought_30d', 'spent_30d')}${cell(t.id, 'bought_total', 'spent_total')}
        <td>${nf(sv(t.id, 'opened_total'))}</td><td>${nf(sv(t.id, 'stock_total'))}</td><td>${nf(sv(t.id, 'gifted_total'))}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="small muted">Boosters achetés · Paillettes dépensées. « En stock » : boosters détenus par les joueurs, pas encore ouverts.${B.opensSince
      ? ` Ouvertures comptées depuis le ${esc(new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(B.opensSince)))}.` : ''}</p>`;
}

/** Dessine l'onglet (liste, statistiques). */
function render() {
  if (!B.root) return;
  B.root.innerHTML = `<div class="abt">
    <div class="acd-head">
      <p class="small muted">Les types de boosters vendus dans la Boutique, dans l’ordre d’affichage. Un type retiré n’est plus vendu, mais le stock des joueurs reste ouvrable. L’affiche A3 de la gamme lit les types actifs à l’ouverture : elle suit tes changements.</p>
      <div class="btn-row"><a class="btn btn-ghost" href="/affiches/boosters-gamme-a3.html" target="_blank" rel="noopener">Voir l’affiche</a>
      ${B.canWrite ? `<button class="btn btn-primary" type="button" data-bt="new">${ICON.plus} Nouveau type</button>` : ''}</div>
    </div>
    ${B.canWrite ? '' : '<p class="acd-note" role="note">Lecture seule : il faut la permission « Jeu de cartes » pour modifier les boosters.</p>'}
    ${B.types.length ? `<ul class="acd-list abt-list" aria-label="Types de boosters">${B.types.map((t, i) => rowHtml(t, i, B.types.length)).join('')}</ul>`
      : '<div class="empty">Aucun type de booster.</div>'}
    <section class="card" aria-labelledby="abt-st-h">
      <h3 class="card-title" id="abt-st-h">Ventes par type</h3>
      ${statsHtml()}
    </section>
  </div>`;
}

/* =========================================================
   Écriture
   ========================================================= */
/** Tous les champs d'un type, normalisés (base des charges utiles de hg_booster_type_save). */
function payloadOf(t) {
  return {
    id: t.id, name: t.name, price: Number(t.price), size: Number(t.size),
    rates: Object.fromEntries(RARITY_IDS.map((r) => [r, Number(t.rates?.[r]) || 0])),
    shiny_rate: Number(t.shiny_rate) || 0, pity_epique: Number(t.pity_epique) || 0, pool: t.pool,
    weekly_limit: t.weekly_limit == null || t.weekly_limit === '' ? null : Number(t.weekly_limit),
    free_daily: !!t.free_daily, style: safeStyle(t.style), description: t.description ? String(t.description) : null,
    active: t.active !== false, sort: Number(t.sort) || 0,
    excluded_rarities: arr(t.excluded_rarities), excluded_sets: arr(t.excluded_sets),
    ...saisonPayload(t), // fenêtre, série unique, plage horaire, style des brillantes (migration 080)
  };
}
/** Égalité de deux valeurs de champ (taux et listes comparés par contenu). */
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/**
 * Charge utile de hg_booster_type_save (contrat 071) :
 * création = { create: true, id, …tous les champs } ; modification = { id, …seulement les champs changés }.
 * @param {object} t type complet voulu
 * @param {object|null} orig type d'origine (null = création)
 */
export function savePayload(t, orig) {
  const full = payloadOf(t);
  if (!orig) return { create: true, ...full };
  const before = payloadOf(orig);
  const out = { id: orig.id };
  for (const [k, v] of Object.entries(full)) if (k !== 'id' && !same(v, before[k])) out[k] = v;
  return out;
}
/**
 * Envoie un type à hg_booster_type_save. Renvoie { type, created, free_daily_removed_from } (ou un objet vide).
 * Les messages d'erreur du serveur sont affichés tels quels.
 */
async function saveType(t, orig) {
  const data = check(await sb.rpc('hg_booster_type_save', { p: savePayload(t, orig) }));
  return data && typeof data === 'object' ? data : {};
}
/** Complément du toast quand le gratuit du jour a été retiré à d'autres types. */
function freeNote(res) {
  const ids = Array.isArray(res?.free_daily_removed_from) ? res.free_daily_removed_from : [];
  if (!ids.length) return '';
  const names = ids.map((id) => B.types.find((x) => x.id === id)?.name || id);
  return ` · gratuit du jour retiré de ${names.map((n) => `« ${n} »`).join(', ')}`;
}

/** Retire de la vente ou remet en vente un type (charge utile complète, active inversé). */
async function setActive(btn, id, active) {
  const t = B.types.find((x) => x.id === id);
  if (!t) return;
  btn.disabled = true;
  try {
    await saveType({ ...t, active }, t);
    B.confirm = null;
    toast(active ? `« ${t.name} » est de nouveau en vente` : `« ${t.name} » est retiré de la Boutique`, 'ok');
    await reload();
  } catch (e) { toast(errMsg(e), 'error'); if (btn.isConnected) btn.disabled = false; }
}

/**
 * Monte ou descend un type d'un cran. Les rangs sont renumérotés (10, 20, 30…) et seuls les types
 * dont le rang change sont envoyés (un appel par type).
 */
async function move(btn, id, dir) {
  const list = [...B.types];
  const i = list.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const changed = list.map((t, k) => ({ t, sort: (k + 1) * 10 })).filter(({ t, sort }) => t.sort !== sort);
  $$('[data-bt="up"],[data-bt="down"]', B.root).forEach((b) => { b.disabled = true; });
  try {
    for (const { t, sort } of changed) await saveType({ ...t, sort }, t);
    toast('Ordre enregistré', 'ok');
  } catch (e) { toast(errMsg(e), 'error'); }
  await reload();
  // Le focus reste sur le même bouton du type déplacé (s'il existe encore)
  const again = $(`[data-bt="${dir < 0 ? 'up' : 'down'}"][data-id="${CSS.escape(id)}"]`, B.root);
  (again && !again.disabled ? again : $(`[data-bt="edit"][data-id="${CSS.escape(id)}"]`, B.root))?.focus();
}

/* =========================================================
   Éditeur (tiroir)
   ========================================================= */
/** Brouillon d'un nouveau type (taux du booster Classique, rangé à la fin). */
function blankType() {
  return { id: '', name: '', price: 100, size: 5, rates: { ...CFG_DEFAULT.rates }, shiny_rate: 3, pity_epique: 20, pool: 'tous',
    weekly_limit: null, free_daily: false, style: 'cart--classique', description: '', active: false,
    sort: B.types.reduce((m, t) => Math.max(m, Number(t.sort) || 0), 0) + 10, excluded_rarities: [], excluded_sets: [], ...saisonDefaults() };
}

/** Champ numérique de l'éditeur. */
const numField = (name, label, value, { min = 0, max = null, step = 1, unit = '', help = '', placeholder = '' } = {}) => `
  <div class="field"><label for="abt-${name}">${esc(label)}${unit ? ` <span class="muted small">(${esc(unit)})</span>` : ''}</label>
    <input id="abt-${name}" name="${name}" type="number" inputmode="decimal" min="${min}"${max != null ? ` max="${max}"` : ''} step="${step}"
      value="${value == null ? '' : esc(value)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${help ? ` aria-describedby="abt-${name}-h"` : ''}>
    ${help ? `<span class="small muted" id="abt-${name}-h">${esc(help)}</span>` : ''}</div>`;

/** Sous-section repliable de l'éditeur. */
const section = (id, title, body, open = true) => `<details class="abt-sec" id="abt-sec-${id}"${open ? ' open' : ''}>
    <summary><span>${esc(title)}</span></summary><div class="abt-sec-body">${body}</div></details>`;

/** HTML de l'éditeur d'un type (t) ; isNew : création (identifiant modifiable). */
function editorHtml(t, isNew) {
  const ro = !B.canWrite;
  const general = `
    <div class="abt-gen">
      <div class="abt-preview" id="abt-preview">${cartHtml(t, 0.5)}</div>
      <div class="stack abt-gen-fields">
        <div class="field"><label for="abt-name">Nom</label>
          <input id="abt-name" name="name" required maxlength="60" autocomplete="off" value="${esc(t.name)}"></div>
        <div class="field"><label for="abt-id">Identifiant technique</label>
          <input id="abt-id" name="id" maxlength="30" autocomplete="off" spellcheck="false" value="${esc(t.id)}"${isNew ? ' required pattern="[a-z0-9_]{2,30}"' : ' readonly'} aria-describedby="abt-id-h">
          <span class="small muted" id="abt-id-h">${isNew ? 'Lettres minuscules, chiffres et tiret bas (2 à 30). Ne pourra plus être changé.' : 'Ne peut pas être changé : il relie les stocks et les achats des joueurs.'}</span></div>
      </div>
    </div>
    <div class="field"><label for="abt-desc">Description <span class="muted small">(Boutique, 300 caractères au maximum)</span></label>
      <textarea id="abt-desc" name="description" maxlength="300" rows="2">${esc(t.description || '')}</textarea></div>
    <fieldset class="abt-styles"><legend>Style de la cartouche <span class="small">· ${BOOSTER_STYLE_LIST.length} styles, rangés par famille de couleurs</span></legend>
      ${styleGridHtml(t)}
    </fieldset>
    <div class="acd-grid-2">
      ${numField('price', 'Prix', t.price, { unit: paillSym(), help: '0 = gratuit.' })}
      ${numField('size', 'Cartes par booster', t.size, { min: 1, max: 10, help: 'De 1 à 10.' })}
    </div>
    <div class="acd-grid-2">
      <label class="switch"><input type="checkbox" name="active"${t.active !== false ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>En vente dans la Boutique</span></label>
      <label class="switch"><input type="checkbox" name="free_daily" aria-describedby="abt-free-h"${t.free_daily ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Booster gratuit du jour</span></label>
    </div>
    <p class="small muted" id="abt-free-h">Un seul type peut être le gratuit du jour : le cocher ici le retire des autres. Un thème peut remplacer ce gratuit pendant sa période (réglage dans la section Thème) ; le booster du thème reste ouvrable gratuitement même hors vente.</p>`;

  const chances = `
    <p class="small muted">Part de chaque rareté pour chaque carte tirée. Le total doit faire exactement 100 %.</p>
    <div class="abt-rates">${RARITY_IDS.map((r) => `<div class="field abt-rate"><label for="abt-rate-${r}"><span class="abt-dot" style="--c:${TINT[r]}" aria-hidden="true"></span>${esc(rarityLabel(r))} <span class="muted small">(%)</span></label>
        <input id="abt-rate-${r}" name="rate_${r}" type="number" inputmode="decimal" min="0" max="100" step="0.01" value="${esc(Number(t.rates?.[r]) || 0)}"></div>`).join('')}</div>
    <p class="abt-total" id="abt-total" aria-live="polite"></p>
    ${numField('shiny_rate', 'Taux de carte brillante', t.shiny_rate, { max: 100, step: 0.1, unit: '%', help: 'Chance qu’une carte tirée soit brillante.' })}
    <div class="abt-live" id="abt-live" aria-live="polite"></div>`;

  const sim = `
    <p class="small muted">${nf(SIM_N)} ouvertures fictives dans ton navigateur, avec les réglages saisis (rien n’est enregistré).</p>
    <div class="btn-row"><button class="btn btn-ghost" type="button" data-sim>Simuler ${nf(SIM_N)} ouvertures</button></div>
    <div id="abt-sim" aria-live="polite"></div>`;

  const contenu = `
    <fieldset class="abt-fs"><legend>Cartes tirées</legend>
      ${POOLS.map(([v, l, h]) => `<label class="abt-radio"><input type="radio" name="pool" value="${v}"${t.pool === v ? ' checked' : ''}>
        <span><strong>${esc(l)}</strong><span class="small muted">${esc(h)}</span></span></label>`).join('')}
    </fieldset>
    <fieldset class="abt-fs"><legend>Raretés exclues</legend>
      <p class="small muted">Jamais tirées par ce type (l’Unique ne sort jamais). Leur part passe à la rareté voisine.</p>
      <div class="abt-checks">${RARITY_IDS.map((r) => `<label class="abt-check"><input type="checkbox" name="ex_rar" value="${r}"${t.excluded_rarities.includes(r) ? ' checked' : ''}>
        <span>${esc(rarityLabel(r))}</span></label>`).join('')}</div>
    </fieldset>
    <fieldset class="abt-fs"><legend>Séries exclues <span class="muted small" id="abt-sets-n"></span></legend>
      ${B.sets.length ? `<div class="field"><label for="abt-set-q" class="acd-sr">Chercher une série</label>
        <input id="abt-set-q" type="search" placeholder="Chercher une série…" autocomplete="off" data-set-q></div>
      <ul class="abt-setlist" id="abt-setlist">${B.sets.map((s) => `<li data-q="${esc(`${s.name} ${s.code}`.toLowerCase())}"><label class="abt-check">
          <input type="checkbox" name="ex_set" value="${esc(s.code)}"${t.excluded_sets.includes(s.code) ? ' checked' : ''}>
          <span>${esc(s.name)} <code class="acd-code">${esc(s.code)}</code></span></label></li>`).join('')}</ul>
      <p class="small muted" id="abt-set-none" hidden>Aucune série ne correspond.</p>`
        : '<p class="small muted">Aucune série pour l’instant.</p>'}
      ${t.excluded_sets.filter((c) => !B.sets.some((s) => s.code === c)).map((c) => `<input type="hidden" name="ex_set" value="${esc(c)}">`).join('')}
    </fieldset>`;

  const limites = `
    <div class="acd-grid-2">
      ${numField('weekly_limit', 'Limite d’achat par semaine', t.weekly_limit, { min: 1, help: 'Vide = sans limite. Semaine du lundi, heure de Zurich.', placeholder: 'sans limite' })}
      ${numField('pity_epique', 'Garantie Épique', t.pity_epique, { help: 'Une Épique ou mieux au plus tard au N-ième booster sans elle. 0 = aucune garantie.' })}
    </div>
    ${numField('sort', 'Ordre d’affichage', t.sort, { min: -100000, help: 'Plus petit = affiché en premier dans la Boutique.' })}`;

  return `<div class="abt-ed">
    ${ro ? '<p class="acd-note" role="note">Lecture seule : il faut la permission « Jeu de cartes » pour modifier ce booster. Le simulateur reste utilisable.</p>' : ''}
    <p class="form-error" role="alert" hidden></p>
    <div class="abt-cols">
      <fieldset class="abt-col"${ro ? ' disabled' : ''}>
        <legend class="acd-sr">Réglages</legend>
        ${section('general', 'Général', general)}
        ${section('contenu', 'Contenu', contenu, !isNew && (t.excluded_rarities.length > 0 || t.excluded_sets.length > 0 || t.pool !== 'tous'))}
        ${section('limites', 'Limites et garantie', limites, false)}
        ${section('saison', 'Saison et horaires', saisonSectionHtml(t, B.sets), !!(t.available_from || t.available_until || t.schedule || t.only_set || t.shiny_style))}
      </fieldset>
      <div class="abt-col">
        <fieldset class="abt-plain"${ro ? ' disabled' : ''}><legend class="acd-sr">Chances</legend>${section('chances', 'Chances', chances)}</fieldset>
        ${section('sim', 'Simulateur', sim, false)}
      </div>
    </div>
  </div>`;
}

/** Lit le formulaire de l'éditeur (valeurs brutes, sans validation). */
function readForm(form) {
  const E = form.elements;
  const val = (n) => String(E[n]?.value ?? '').trim();
  return {
    id: val('id').toLowerCase(), name: val('name'), description: val('description'),
    price: val('price'), size: val('size'), shiny_rate: val('shiny_rate'), pity_epique: val('pity_epique'),
    weekly_limit: val('weekly_limit'), sort: val('sort'),
    style: form.querySelector('input[name="style"]:checked')?.value || 'cart--classique',
    pool: form.querySelector('input[name="pool"]:checked')?.value || '',
    active: !!E.active?.checked, free_daily: !!E.free_daily?.checked,
    rates: Object.fromEntries(RARITY_IDS.map((r) => [r, val(`rate_${r}`)])),
    excluded_rarities: $$('input[name="ex_rar"]:checked', form).map((i) => i.value),
    excluded_sets: [...new Set($$('input[name="ex_set"]', form).filter((i) => i.type === 'hidden' || i.checked).map((i) => i.value))],
    saison: readSaison(form),
  };
}
/** Total des taux saisis (null si une valeur n'est pas un nombre positif). */
function ratesTotal(rates) {
  let s = 0;
  for (const r of RARITY_IDS) {
    const n = Number(rates[r]);
    if (rates[r] === '' || !Number.isFinite(n) || n < 0) return null;
    s += n;
  }
  return round(s, 4);
}
/** Vrai si le total vaut 100 (à 0,01 près, comme la contrainte en base). */
const totalOk = (s) => s != null && Math.abs(s - 100) <= 0.01;

/**
 * Valide le brouillon ; renvoie la ligne prête à envoyer, ou lève une erreur au message clair.
 * @param {object} v valeurs brutes (readForm)
 * @param {object|null} orig type d'origine (null = création)
 */
function validate(v, orig) {
  const int = (x) => Number.isInteger(Number(x)) && String(x) !== '';
  const fail = (m) => { throw new Error(m); };
  if (!orig) {
    if (!ID_RE.test(v.id)) fail('L’identifiant doit faire 2 à 30 caractères : lettres minuscules, chiffres ou tiret bas.');
    if (B.types.some((t) => t.id === v.id)) fail('Cet identifiant existe déjà. Choisis-en un autre.');
  }
  if (!v.name || v.name.length > 60) fail('Donne un nom (60 caractères au maximum).');
  if (v.description.length > 300) fail('La description fait 300 caractères au maximum.');
  if (!int(v.price) || Number(v.price) < 0) fail('Le prix doit être un nombre entier positif (0 = gratuit).');
  if (!int(v.size) || Number(v.size) < 1 || Number(v.size) > 10) fail('Un booster contient de 1 à 10 cartes.');
  const total = ratesTotal(v.rates);
  if (total == null) fail('Chaque taux doit être un nombre positif ou nul.');
  if (!totalOk(total)) fail(`Le total des taux doit faire 100 % (actuellement ${nf(total)} %).`);
  const shiny = Number(v.shiny_rate);
  if (v.shiny_rate === '' || !Number.isFinite(shiny) || shiny < 0 || shiny > 100) fail('Le taux de brillante est compris entre 0 et 100 %.');
  if (!int(v.pity_epique) || Number(v.pity_epique) < 0) fail('La garantie Épique est un nombre entier (0 = aucune).');
  if (v.weekly_limit !== '' && (!int(v.weekly_limit) || Number(v.weekly_limit) < 1)) fail('La limite par semaine est vide (sans limite) ou un nombre entier d’au moins 1.');
  if (!int(v.sort)) fail('L’ordre d’affichage est un nombre entier.');
  if (!POOLS.some(([p]) => p === v.pool)) fail('Choisis les cartes tirées (toutes les séries, une série au choix ou cartes manquantes).');
  if (v.excluded_rarities.length >= RARITY_IDS.length) fail('Garde au moins une rareté tirable.');
  const eff = effectiveRates(Object.fromEntries(RARITY_IDS.map((r) => [r, Number(v.rates[r])])), v.excluded_rarities);
  if (!eff || RARITY_IDS.every((r) => !eff[r])) fail('Aucune rareté tirable : vérifie les taux et les raretés exclues.');
  if (Number(v.pity_epique) > 0 && HIGH.every((r) => v.excluded_rarities.includes(r))) fail('La garantie Épique demande au moins une rareté Épique ou mieux non exclue (mets-la à 0).');
  if (v.pool === 'serie' && B.sets.length && B.sets.every((s) => v.excluded_sets.includes(s.code))) fail('Toutes les séries sont exclues : il ne resterait rien à choisir.');
  return {
    ...(orig || {}), id: orig ? orig.id : v.id, name: v.name, description: v.description || null,
    price: Number(v.price), size: Number(v.size), rates: Object.fromEntries(RARITY_IDS.map((r) => [r, round(Number(v.rates[r]), 4)])),
    shiny_rate: shiny, pity_epique: Number(v.pity_epique), pool: v.pool, weekly_limit: v.weekly_limit === '' ? null : Number(v.weekly_limit),
    free_daily: v.free_daily, style: v.style, active: v.active, sort: Number(v.sort),
    excluded_rarities: v.excluded_rarities, excluded_sets: v.excluded_sets,
    ...(v.saison ? validateSaison(v.saison, v.pool) : {}),
  };
}

/**
 * Met à jour la partie « en direct » de l'éditeur : total des taux (et bouton Enregistrer), chances par booster,
 * valeur moyenne au recyclage, aperçu de la cartouche, compteur des séries exclues.
 */
function updateLive(form) {
  const v = readForm(form);
  const total = ratesTotal(v.rates);
  const ok = totalOk(total);
  const out = $('#abt-total', form);
  out.textContent = total == null ? 'Total des taux : un taux n’est pas un nombre valide.' : `Total des taux : ${nf(total)} %${ok ? '' : ' · il doit faire exactement 100 %'}`;
  out.classList.toggle('is-err', !ok);
  out.classList.toggle('is-ok', ok);
  $$('.abt-rate input', form).forEach((i) => i.setAttribute('aria-invalid', String(!ok)));
  const submit = form.querySelector('[data-drawer-submit]');
  if (submit && !submit.getAttribute('aria-busy')) submit.disabled = !ok;
  const sim = $('[data-sim]', form);
  if (sim) sim.disabled = !ok;

  const size = Math.min(10, Math.max(1, Math.round(Number(v.size)) || 1));
  const live = $('#abt-live', form);
  if (ok) {
    const eff = effectiveRates(Object.fromEntries(RARITY_IDS.map((r) => [r, Number(v.rates[r])])), v.excluded_rarities);
    if (!eff) live.innerHTML = '<p class="abt-warn">Toutes les raretés sont exclues : rien ne peut être tiré.</p>';
    else {
      const odds = boosterOdds(eff, size);
      const price = Number(v.price) || 0;
      const rv = recycleValue(eff, size, Number(v.shiny_rate) || 0, B.recycle);
      const share = price > 0 ? (rv / price) * 100 : null;
      const warn = share != null && share > RECYCLE_WARN;
      const bad = share != null && share > (B.alertPct ?? 100); // A7 : ouvrir puis tout recycler fait gagner des Paillettes
      const shifted = v.excluded_rarities.filter((r) => Number(v.rates[r]) > 0);
      live.innerHTML = `<dl class="abt-odds">
          <div><dt>Au moins une Épique ou mieux</dt><dd>${pct(odds.epique)}</dd></div>
          <div><dt>Au moins une Légendaire ou mieux</dt><dd>${pct(odds.legendaire)}</dd></div>
          <div><dt>Au moins une Mythique ou mieux</dt><dd>${pct(odds.mythique)}</dd></div>
          <div class="${warn ? 'is-warn' : ''}"><dt>Valeur moyenne au recyclage</dt><dd>${nf(Math.round(rv))} ${paillSym()}${share != null ? ` · ${pct(share)} du prix` : ''}</dd></div>
        </dl>
        <p class="small muted">Par booster de ${nf(size)} cartes, sans la garantie Épique, brillantes comprises (barème de recyclage de l’onglet Économie).</p>
        ${bad ? `<p class="abt-warn abt-bad" role="status">Machine à Paillettes : ce booster rapporte ${pct(share)} de son prix au recyclage (seuil ${nf(B.alertPct ?? 100)} %). Ouvrir puis tout recycler ferait gagner des Paillettes.</p>`
    : warn ? `<p class="abt-warn" role="status">Attention : recycler ce booster rend en moyenne plus de ${RECYCLE_WARN} % de son prix.</p>` : ''}
        ${shifted.length ? `<p class="small muted">${esc(shifted.map(rarityLabel).join(', '))} : exclue${shifted.length > 1 ? 's' : ''}, leur part passe à la rareté voisine dans ces calculs.</p>` : ''}`;
    }
  } else live.innerHTML = '<p class="small muted">Les chances s’affichent quand le total fait 100 %.</p>';

  const prev = $('#abt-preview', form);
  if (prev) prev.innerHTML = cartHtml({ style: v.style, name: v.name || styleLabel(v.style), size }, 0.5);
  $$('.abt-style .cart-foot', form).forEach((f) => { f.textContent = `${nf(size)} CARTES`; });
  const n = $('#abt-sets-n', form);
  if (n) n.textContent = v.excluded_sets.length ? `(${nf(v.excluded_sets.length)} exclue${v.excluded_sets.length > 1 ? 's' : ''})` : '';
}

/** Lance le simulateur avec les valeurs saisies et affiche la répartition par rareté. */
function runSim(form) {
  const v = readForm(form);
  if (!totalOk(ratesTotal(v.rates))) return;
  const size = Math.min(10, Math.max(1, Math.round(Number(v.size)) || 1));
  const rates = Object.fromEntries(RARITY_IDS.map((r) => [r, Number(v.rates[r])]));
  const res = simulate({ rates, excluded: v.excluded_rarities, size, shiny: Number(v.shiny_rate) || 0, pity: Math.max(0, Math.round(Number(v.pity_epique)) || 0) });
  const eff = effectiveRates(rates, v.excluded_rarities) || {};
  const effTotal = RARITY_IDS.reduce((s, r) => s + (eff[r] || 0), 0) || 1;
  const max = Math.max(1, ...RARITY_IDS.map((r) => res.counts[r]));
  $('#abt-sim', form).innerHTML = `<table class="abt-simt">
      <caption class="acd-sr">Résultat de ${nf(res.n)} ouvertures</caption>
      <thead><tr><th scope="col">Rareté</th><th scope="col">Cartes</th><th scope="col">Part</th><th scope="col">Attendu</th></tr></thead>
      <tbody>${RARITY_IDS.map((r) => `<tr><th scope="row"><span class="abt-dot" style="--c:${TINT[r]}" aria-hidden="true"></span>${esc(rarityLabel(r))}</th>
        <td><span class="abt-simbar" aria-hidden="true"><span style="width:${(res.counts[r] / max) * 100}%;--c:${TINT[r]}"></span></span>${nf(res.counts[r])}</td>
        <td>${pct((res.counts[r] / (res.cards || 1)) * 100)}</td><td class="muted">${pct(((eff[r] || 0) / effTotal) * 100)}</td></tr>`).join('')}</tbody>
    </table>
    <p class="small">${nf(res.cards)} cartes, dont ${nf(res.shiny)} brillantes. ${nf(res.withHigh)} boosters sur ${nf(res.n)} avec une Épique ou mieux${res.pityUsed ? ` (dont ${nf(res.pityUsed)} grâce à la garantie)` : ''}.</p>`;
}

/** Ouvre l'éditeur d'un type (null = nouveau type). En lecture seule : pas de bouton Enregistrer. */
function openEditor(orig) {
  const isNew = !orig;
  const t = orig ? { ...orig, rates: { ...orig.rates } } : blankType();
  const dr = openDrawer({
    title: isNew ? 'Nouveau type de booster' : B.canWrite ? `Modifier « ${orig.name} »` : `Booster « ${orig.name} »`,
    subtitle: isNew ? 'Il sera créé retiré de la vente : coche « En vente » quand il est prêt.' : `Identifiant : ${orig.id}`,
    body: editorHtml(t, isNew),
    wide: true,
    submitLabel: isNew ? 'Créer le type' : 'Enregistrer',
    onSubmit: B.canWrite ? (form) => submitEditor(form, orig) : null,
  });
  dr.el.classList.add('abt-drawer');
  const form = dr.form;
  let idTouched = !isNew;
  form.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('[data-set-q]')) return filterSets(form, el.value);
    if (el.name === 'id') idTouched = true;
    // Nouveau type : l'identifiant suit le nom tant qu'il n'a pas été saisi à la main
    if (el.name === 'name' && !idTouched) {
      form.elements.id.value = el.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
    }
    updateLive(form);
  });
  form.addEventListener('change', () => updateLive(form));
  form.addEventListener('click', (e) => { if (e.target.closest('[data-sim]')) runSim(form); });
  // Entrée dans la recherche des séries : ne pas envoyer le formulaire
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-set-q]')) e.preventDefault(); });
  updateLive(form);
  (isNew ? form.elements.name : dr.el.querySelector('.ui-drawer-x'))?.focus();
}

/** Filtre la liste des séries exclues (nom ou code). */
function filterSets(form, q) {
  const s = q.trim().toLowerCase();
  let shown = 0;
  $$('#abt-setlist > li', form).forEach((li) => { const on = !s || li.dataset.q.includes(s); li.hidden = !on; if (on) shown++; });
  const none = $('#abt-set-none', form);
  if (none) none.hidden = shown > 0;
}

/** Envoi de l'éditeur : validation, hg_booster_type_save, toast, rechargement. Renvoie false pour garder le tiroir ouvert. */
async function submitEditor(form, orig) {
  const err = $('.form-error', form);
  /* Affiche l'erreur en haut du formulaire et garde le tiroir ouvert. */
  const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); return false; };
  err.hidden = true;
  let row;
  try { row = validate(readForm(form), orig); } catch (e) { return fail(errMsg(e)); }
  const payload = savePayload(row, orig);
  if (orig && Object.keys(payload).length === 1) { toast('Aucun changement', 'ok'); return true; }
  // A7 : avertissement avant d'enregistrer un type déséquilibré (valeur au recyclage au-delà du seuil d'alerte)
  const effR = effectiveRates(row.rates, row.excluded_rarities || []);
  const shareR = effR && row.price > 0 ? (recycleValue(effR, row.size, row.shiny_rate, B.recycle) / row.price) * 100 : null;
  if (shareR != null && shareR > (B.alertPct ?? 100)
    && !(await confirmBox('Booster déséquilibré', `« ${row.name} » rapporterait ${pct(shareR)} de son prix au recyclage : ouvrir puis tout recycler ferait gagner des Paillettes. Enregistrer quand même ?`, { ok: 'Enregistrer quand même' }))) return false;
  let res;
  try {
    res = await saveType(row, orig);
  } catch (e) {
    toast('Enregistrement impossible', 'error');
    return fail(errMsg(e)); // message du serveur, tel quel
  }
  toast(`${orig ? `« ${row.name} » enregistré` : `Type « ${row.name} » créé`}${freeNote(res)}`, 'ok');
  await reload();
  return true;
}

/* =========================================================
   Événements et point d'entrée
   ========================================================= */
/** Clics de la liste (boutons data-bt). */
function onClick(e) {
  const btn = e.target.closest('[data-bt]');
  if (!btn || !B.root?.contains(btn) || btn.disabled) return;
  const id = btn.dataset.id;
  const t = B.types.find((x) => x.id === id);
  switch (btn.dataset.bt) {
    case 'new': if (B.canWrite) openEditor(null); break;
    case 'edit': if (t) openEditor(t); break;
    case 'off': B.confirm = id; render(); $(`[data-bt="off-ok"][data-id="${CSS.escape(id)}"]`, B.root)?.focus(); break;
    case 'off-no': B.confirm = null; render(); $(`[data-bt="off"][data-id="${CSS.escape(id)}"]`, B.root)?.focus(); break;
    case 'off-ok': setActive(btn, id, false); break;
    case 'on': setActive(btn, id, true); break;
    case 'up': move(btn, id, -1); break;
    case 'down': move(btn, id, 1); break;
    case 'retry': boot(); break;
    default: break;
  }
}

/** Premier affichage : chargement, puis liste ; en cas d'échec, propose de réessayer. */
async function boot() {
  B.root.innerHTML = '<div class="empty">Chargement des boosters…</div>';
  try { await load(); render(); } catch (e) {
    B.root.innerHTML = `<div class="empty">Impossible de charger les boosters : ${esc(errMsg(e))}
      <div class="btn-row acd-center"><button class="btn btn-ghost btn-sm" type="button" data-bt="retry">Réessayer</button></div></div>`;
  }
}

/**
 * Monte l'onglet « Boosters » dans el (autonome : données, rendu et événements propres).
 * @param {HTMLElement} el conteneur
 * @param {{canWrite?: boolean}} [opts] canWrite : écriture permise (par défaut : admin ou permission « cartes »)
 * @returns {Promise<void>}
 */
export async function mountBoostersTab(el, { canWrite = hasPerm('cartes') } = {}) {
  if (!el) return;
  ensureCss();
  B.root = el;
  B.canWrite = !!canWrite;
  B.confirm = null;
  if (!el.dataset.abtBound) { el.addEventListener('click', onClick); el.dataset.abtBound = '1'; }
  await boot();
}
