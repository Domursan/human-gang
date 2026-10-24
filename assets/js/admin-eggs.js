// ===== Humane Gang — administration : secrets cachés (easter eggs) =====
/*
 * Rôle : Jeux et cartes › Secrets. Formulaire du réglage hg_settings.eggs (date d'anniversaire du gang, mot secret,
 * récompense en Paillettes de chacun des secrets, cueillette : page de chaque saison et anecdotes) et journal
 * « Qui a trouvé quoi » (table hg_egg_log). Les quatre champignons (champi_<saison>) forment un seul secret « champi ».
 * Enregistrement : upsert de la seule clé « eggs », en conservant les clés inconnues (et les récompenses inconnues).
 * Le journal n'est lisible que par l'administrateur (RLS hg_egg_log_own, migration 062) : le Staff voit une explication.
 * Écriture permise à l'admin et au Staff « reglages » (RLS hg_settings_admin, hg_settings_perm('eggs') = 'reglages').
 * Route : #fete/secrets (branchée par admin.js). Section : <section id="eggs">, conteneur #eggs-root.
 * Dépendances : core.js (sb, toast, errMsg, esc, droits en cache), admin/list-tools.js (recherche du journal).
 * Tables et RPC : hg_settings (clé eggs), hg_egg_log (lecture admin), hg_staff_directory (pseudos).
 * Exporte : mountEggsSection, EGGS_DEFAULTS, EGG_NOMS, validateEggs.
 */
import { sb, toast, errMsg, esc, getCachedPerms, hasPerm } from './core.js';
import { matches, searchHtml, bindSearch, setCount, emptyHtml, moreHtml } from './admin/list-tools.js';

/* ---------- Constantes ---------- */

/** Saisons de la cueillette (champignon caché) : code de la saison et libellé. */
const SAISONS = [['printemps', 'Printemps'], ['ete', 'Été'], ['automne', 'Automne'], ['hiver', 'Hiver']];
/** Limites de la cueillette : nom de page (slug), nombre et longueur des anecdotes. */
const PAGE_RE = /^[a-z0-9-]{2,40}$/;
const FAITS_MAX = 20;
const FAIT_MAX = 200;

/** Valeurs par défaut (celles de la migration 062, et de la migration 101 pour les nouveaux secrets). */
export const EGGS_DEFAULTS = Object.freeze({
  anniversaire_gang: null,
  mot_secret: 'SECRETS',
  recompenses: Object.freeze({ konami: 100, logo: 50, humane: 25, jeu404: 5, heure_gang: 13, anniversaire: 100, console: 50, lettres: 200, secousse: 0, nuit: 30, rembobine: 25, arcade: 5,
    tzatziki: 25, champi: 20, livre: 10, kc: 10, creeper: 1, serge: 25, domumobile: 15 }),
  champi: Object.freeze({
    pages: Object.freeze({ printemps: 'irl', ete: 'historique', automne: 'compte', hiver: 'cartes' }),
    facts: Object.freeze(['Certains Mycena brillent dans le noir.', 'Un champignon n’est ni une plante ni un animal.',
      'Le plus grand être vivant connu est un champignon souterrain.', 'Les champignons respirent de l’oxygène, comme nous.']),
  }),
});

/** Nom de chaque secret, comme sur la page secrète (secret.js, NOMS), dans le même ordre. */
export const EGG_NOMS = Object.freeze({
  konami: 'Le code des anciens',
  logo: 'Le clic obstiné',
  humane: 'L’arc-en-ciel discret',
  jeu404: 'Le perdu de la page 404',
  heure_gang: 'L’heure du gang',
  anniversaire: 'La part de gâteau',
  console: 'Le chercheur d’indices',
  lettres: 'Les sept lettres cachées',
  secousse: 'La secousse',
  nuit: 'La chouette insomniaque',
  rembobine: 'Le retour en arrière',
  tzatziki: 'Le pays imaginaire',
  champi: 'La cueillette',
  livre: 'Le livre est mieux',
  kc: 'Le supporter',
  creeper: 'Le démineur',
  serge: 'Le maître du jeu',
  domumobile: 'La voiture du gang',
  arcade: 'L’arcade du jour (page Jeux)',
});

/** Fréquence et bonus de chaque secret (règles de hg_egg_found, migration 062), affichés en aide. */
const EGG_AIDE = {
  konami: 'Une fois · badge « Initié »',
  logo: 'Une fois · carte « Le Curieux »',
  humane: 'Une fois',
  jeu404: 'Une fois par jour',
  heure_gang: 'Une fois, à 13 h 37',
  anniversaire: 'Une fois par an · carte « Gâteau du gang »',
  console: 'Une fois (énigme de la console)',
  lettres: 'Une fois, aux 7 lettres · badge',
  secousse: 'Une fois par mois · un booster offert',
  nuit: 'Une fois, entre 3 h et 4 h du matin',
  rembobine: 'Une fois',
  tzatziki: 'Une fois · carte « Drapeau du Tzatzikistan »',
  champi: 'Une fois par saison, quatre saisons · carte « Mycena » et badge « Cueilleur »',
  livre: 'Une fois · carte « Le Projectionniste »',
  kc: 'Une fois',
  creeper: 'Une fois par jour',
  serge: 'Une fois · carte « Le Maître de Serge »',
  domumobile: 'Une fois · carte « La Domu-mobile »',
  arcade: 'Une partie par jour · 50 au plus',
};

/** Limites des champs. */
const REWARD_MAX = 100000;
const MOT_RE = /^[A-Z]{3,12}$/;
const MMJJ_RE = /^(\d{2})-(\d{2})$/;
/** Jours maximum par mois (février : 29, pour accepter le 29 février). */
const JOURS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Membres affichés par lot dans le journal (« Afficher plus ») : la section reste courte. */
const LOT = 10;
/** Dates du journal : heure suisse. */
const dtFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDt = (d) => (d ? dtFmt.format(new Date(d)) : '');

/* ---------- État de la section ---------- */
// raw : valeur lue en base (objet complet, clés inconnues comprises) ; log : lignes du journal ; pseudo : id -> pseudo.
const E = { root: null, raw: null, loadError: null, log: null, logError: null, pseudo: new Map(), query: '', busy: false, limit: LOT, members: [], tab: 'reglages', logLoaded: false };

/* ---------- Validation ---------- */

/**
 * Vérifie une date « MM-JJ » (mois-jour). Vide : permis (pas d'anniversaire).
 * @param {string} v Valeur saisie.
 * @returns {string|null} Message d'erreur, ou null si la valeur est bonne.
 */
function checkMmJj(v) {
  if (!v) return null;
  const m = MMJJ_RE.exec(v);
  if (!m) return 'Écris la date au format MM-JJ (mois puis jour), par exemple 08-14 pour le 14 août.';
  const mois = Number(m[1]), jour = Number(m[2]);
  if (mois < 1 || mois > 12) return 'Le mois doit être entre 01 et 12.';
  if (jour < 1 || jour > JOURS[mois - 1]) return `Ce mois n’a pas de jour ${m[2]}.`;
  return null;
}

/**
 * Vérifie les valeurs du formulaire. Renvoie les erreurs par champ (vide si tout est bon).
 * @param {{anniversaire_gang: string, mot_secret: string, recompenses: Object<string, string|number>}} v Valeurs saisies (texte).
 * @returns {Object<string, string>} Champ -> message (clés : anniversaire_gang, mot_secret, r.<code>).
 */
export function validateEggs(v) {
  const errs = {};
  const a = checkMmJj(String(v.anniversaire_gang ?? '').trim());
  if (a) errs.anniversaire_gang = a;
  const mot = String(v.mot_secret ?? '').trim();
  if (!MOT_RE.test(mot)) errs.mot_secret = 'De 3 à 12 lettres majuscules sans accent (A à Z).';
  for (const code of Object.keys(EGG_NOMS)) {
    const t = String(v.recompenses?.[code] ?? '').trim();
    const n = Number(t);
    if (t === '' || !Number.isInteger(n) || n < 0 || n > REWARD_MAX) errs[`r.${code}`] = `Un nombre entier entre 0 et ${REWARD_MAX.toLocaleString('fr-CH')}.`;
  }
  for (const [saison] of SAISONS) {
    if (!PAGE_RE.test(String(v.champi?.pages?.[saison] ?? '').trim())) errs[`c.${saison}`] = 'Le nom de la page en minuscules, sans accent ni espace (ex. irl, historique).';
  }
  const faits = faitsDe(v.champi?.facts);
  if (faits.length > FAITS_MAX) errs['c.facts'] = `Au plus ${FAITS_MAX} anecdotes (une par ligne).`;
  else if (faits.some((f) => f.length > FAIT_MAX)) errs['c.facts'] = `Une anecdote fait au plus ${FAIT_MAX} caractères.`;
  return errs;
}

/**
 * Anecdotes saisies : une par ligne, lignes vides ignorées.
 * @param {string} texte Contenu du champ.
 * @returns {string[]}
 */
function faitsDe(texte) {
  return String(texte ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
}

/* ---------- Montage ---------- */

/**
 * Monte la section Secrets dans son conteneur : formulaire du réglage, puis journal (admin seulement).
 * @param {HTMLElement} root Conteneur (#eggs-root).
 * @returns {Promise<void>}
 */
export async function mountEggsSection(root) {
  if (!root) return;
  E.root = root;
  root.innerHTML = '<div class="empty">Chargement des secrets…</div>';
  if (!root.dataset.aegBound) {
    root.dataset.aegBound = '1';
    root.addEventListener('submit', onSubmit);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
  }
  E.log = null; E.logLoaded = false;
  await loadSetting();
  render();
  if (E.tab === 'journal') await openTab('journal');
}

/**
 * Affiche l'onglet « Réglages » ou « Qui a trouvé quoi ». Le journal est lu à sa première ouverture (admin seulement).
 * @param {'reglages'|'journal'} tab
 * @param {boolean} [focus=false] Donne le focus à l'onglet (navigation au clavier).
 */
async function openTab(tab, focus = false) {
  E.tab = tab === 'journal' ? 'journal' : 'reglages';
  for (const [t, on] of [['reglages', E.tab === 'reglages'], ['journal', E.tab === 'journal']]) {
    const b = E.root.querySelector(`#aeg-tab-${t}`), pan = E.root.querySelector(`#aeg-pan-${t}`);
    if (!b || !pan) continue;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    pan.hidden = !on;
    if (on && focus) b.focus();
  }
  if (E.tab !== 'journal') return;
  if (!isAdmin()) { renderLog(); return; }
  if (!E.logLoaded) { E.logLoaded = true; await loadLog(); }
}

/** Vrai pour l'administrateur (le seul qui peut lire tout le journal). */
const isAdmin = () => !!getCachedPerms()?.is_admin;
/** Vrai si l'utilisateur peut enregistrer (admin ou Staff « reglages »). */
const canWrite = () => hasPerm('reglages');

/* ---------- Chargement ---------- */

/** Lit la clé « eggs » (sans elle : valeurs par défaut). */
async function loadSetting() {
  try {
    const { data, error } = await sb.from('hg_settings').select('key, value').eq('key', 'eggs').maybeSingle();
    if (error) throw error;
    const v = data?.value;
    E.raw = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    E.loadError = null;
  } catch (e) {
    E.raw = null;
    E.loadError = errMsg(e);
  }
}

/** Lit le journal (2 000 dernières trouvailles) et les pseudos, puis dessine le tableau. */
async function loadLog() {
  const host = E.root.querySelector('#aeg-log');
  if (host) host.innerHTML = '<div class="empty">Chargement du journal…</div>';
  try {
    const [log, dir] = await Promise.all([
      sb.from('hg_egg_log').select('user_id, egg, period, reward, found_at').order('found_at', { ascending: false }).limit(2000),
      sb.rpc('hg_staff_directory'),
    ]);
    if (log.error) throw log.error;
    E.log = log.data ?? [];
    E.pseudo = new Map((dir.data ?? []).map((r) => [r.id, r.pseudo]));
    E.logError = null;
  } catch (e) {
    E.log = null;
    E.logError = errMsg(e);
  }
  renderLog();
}

/* ---------- Valeurs ---------- */

/** Page de la cueillette pour une saison (enregistrée si valable, sinon défaut). */
function pageOf(saison) {
  const p = E.raw?.champi?.pages?.[saison];
  return typeof p === 'string' && PAGE_RE.test(p) ? p : EGGS_DEFAULTS.champi.pages[saison];
}
/** Anecdotes de la cueillette (enregistrées si c'est une liste, sinon défaut). */
function faitsOf() {
  const f = E.raw?.champi?.facts;
  return Array.isArray(f) ? f.filter((x) => typeof x === 'string') : [...EGGS_DEFAULTS.champi.facts];
}
/** Valeur effective d'une récompense (enregistrée si valable, sinon défaut). */
function rewardOf(code) {
  const v = E.raw?.recompenses?.[code];
  return Number.isInteger(v) && v >= 0 ? v : EGGS_DEFAULTS.recompenses[code];
}
/** Valeurs à afficher dans le formulaire. */
function current() {
  const r = E.raw || {};
  return {
    anniversaire_gang: typeof r.anniversaire_gang === 'string' ? r.anniversaire_gang : '',
    mot_secret: typeof r.mot_secret === 'string' && r.mot_secret ? r.mot_secret : EGGS_DEFAULTS.mot_secret,
    recompenses: Object.fromEntries(Object.keys(EGG_NOMS).map((c) => [c, rewardOf(c)])),
    champi: { pages: Object.fromEntries(SAISONS.map(([s]) => [s, pageOf(s)])), facts: faitsOf() },
  };
}

/* ---------- Affichage : formulaire ---------- */

/**
 * Un champ de récompense (nombre de Paillettes).
 * @param {string} code Code du secret.
 * @param {number} v Valeur affichée.
 * @param {boolean} ro Lecture seule.
 * @returns {string} HTML
 */
function rewardHtml(code, v, ro) {
  const id = `aeg-r-${code}`;
  return `<div class="aeg-reward">
    <label class="aeg-reward-label" for="${id}">${esc(EGG_NOMS[code])}</label>
    <input class="input aeg-reward-input" id="${id}" name="r.${code}" type="number" inputmode="numeric" min="0" max="${REWARD_MAX}" step="1" value="${esc(String(v))}"
      aria-describedby="${id}-h ${id}-e"${ro ? ' disabled' : ''}>
    <span class="small muted aeg-reward-hint" id="${id}-h">${esc(EGG_AIDE[code])}</span>
    <p class="form-error aeg-reward-err" id="${id}-e" data-err="r.${code}" hidden></p>
  </div>`;
}

/** Dessine le formulaire et l'emplacement du journal. */
function render() {
  const ro = !canWrite();
  if (E.loadError) {
    E.root.innerHTML = `<div class="empty">Impossible de lire les réglages des secrets : ${esc(E.loadError)}</div>
      <p><button class="btn btn-ghost" type="button" data-aeg="reload">Réessayer</button></p>`;
    return;
  }
  const v = current();
  const sel = (t) => (E.tab === t ? 'aria-selected="true"' : 'aria-selected="false" tabindex="-1"');
  E.root.innerHTML = `<div class="aeg">
    <p class="small muted aeg-intro">Les secrets cachés du site : chaque trouvaille rapporte des Paillettes, une seule fois par période. Les gains sont petits et plafonnés : ce sont des jeux, pas une économie.</p>
    <div class="aeg-tabs" role="tablist" aria-label="Secrets">
      <button class="aeg-tab" type="button" role="tab" id="aeg-tab-reglages" aria-controls="aeg-pan-reglages" ${sel('reglages')} data-aeg="tab" data-tab="reglages">Réglages</button>
      <button class="aeg-tab" type="button" role="tab" id="aeg-tab-journal" aria-controls="aeg-pan-journal" ${sel('journal')} data-aeg="tab" data-tab="journal">Qui a trouvé quoi</button>
    </div>
    <div class="aeg-panel" id="aeg-pan-reglages" role="tabpanel" aria-labelledby="aeg-tab-reglages"${E.tab === 'reglages' ? '' : ' hidden'}>
    ${ro ? '<p class="aeg-ro" role="note">Lecture seule : il faut le droit « Réglages du site » pour modifier les secrets.</p>' : ''}
    <form id="aeg-form" class="aeg-form" novalidate>
      <fieldset class="aeg-group">
        <legend class="aeg-legend">Date et mot secret</legend>
        <div class="aeg-grid">
          <div class="field">
            <label for="aeg-anniv">Anniversaire du gang</label>
            <input id="aeg-anniv" name="anniversaire_gang" type="text" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="MM-JJ, ex. 08-14"
              value="${esc(v.anniversaire_gang)}" aria-describedby="aeg-anniv-h aeg-anniv-e"${ro ? ' disabled' : ''}>
            <span class="small muted" id="aeg-anniv-h">Mois puis jour (heure de Zurich). Ce jour-là, le secret « ${esc(EGG_NOMS.anniversaire)} » s’ouvre. Vide : pas d’anniversaire.</span>
            <p class="form-error" id="aeg-anniv-e" data-err="anniversaire_gang" hidden></p>
          </div>
          <div class="field">
            <label for="aeg-mot">Mot des sept lettres</label>
            <input id="aeg-mot" name="mot_secret" type="text" autocomplete="off" autocapitalize="characters" maxlength="12" spellcheck="false"
              value="${esc(v.mot_secret)}" aria-describedby="aeg-mot-h aeg-mot-e"${ro ? ' disabled' : ''}>
            <span class="small muted" id="aeg-mot-h">Affiché quand un membre réunit les 7 lettres. Les lettres posées sur les pages (S, E, C, R, E, T, S) sont écrites dans le code : garde un mot qui leur correspond.</span>
            <p class="form-error" id="aeg-mot-e" data-err="mot_secret" hidden></p>
          </div>
        </div>
      </fieldset>
      <fieldset class="aeg-group">
        <legend class="aeg-legend">Récompenses en Paillettes</legend>
        <p class="small muted">Paillettes versées à chaque trouvaille. 0 : aucune Paillette (le bonus éventuel reste donné).</p>
        <div class="aeg-rewards">${Object.keys(EGG_NOMS).map((c) => rewardHtml(c, v.recompenses[c], ro)).join('')}</div>
      </fieldset>
      <fieldset class="aeg-group">
        <legend class="aeg-legend">Cueillette : le champignon caché</legend>
        <p class="small muted">Chaque saison, le champignon caché renvoie à une page du site (son nom, par exemple irl). Une anecdote est tirée au hasard chaque jour. Une anecdote par ligne ; vide : les anecdotes d’origine.</p>
        <div class="aeg-grid">${SAISONS.map(([s, label]) => `<div class="field">
          <label for="aeg-c-${s}">Page de la saison : ${esc(label)}</label>
          <input id="aeg-c-${s}" name="c.${s}" type="text" autocomplete="off" spellcheck="false" maxlength="40" value="${esc(v.champi.pages[s])}"
            aria-describedby="aeg-c-${s}-e"${ro ? ' disabled' : ''}>
          <p class="form-error" id="aeg-c-${s}-e" data-err="c.${s}" hidden></p>
        </div>`).join('')}</div>
        <div class="field">
          <label for="aeg-c-facts">Anecdotes (une par ligne)</label>
          <textarea id="aeg-c-facts" name="c.facts" rows="5" maxlength="6000" aria-describedby="aeg-c-facts-h aeg-c-facts-e"${ro ? ' disabled' : ''}>${esc(v.champi.facts.join('\n'))}</textarea>
          <span class="small muted" id="aeg-c-facts-h">${FAITS_MAX} anecdotes au plus, ${FAIT_MAX} caractères chacune.</span>
          <p class="form-error" id="aeg-c-facts-e" data-err="c.facts" hidden></p>
        </div>
      </fieldset>
      <div class="aeg-actions">
        <p class="aeg-status" id="aeg-status" role="status" aria-live="polite"></p>
        ${ro ? '' : `<button class="btn btn-ghost" type="button" data-aeg="defaults">Rétablir les valeurs par défaut</button>
        <button class="btn btn-primary" type="submit" id="aeg-save">Enregistrer les secrets</button>`}
      </div>
    </form>
    </div>
    <div class="aeg-panel" id="aeg-pan-journal" role="tabpanel" aria-labelledby="aeg-tab-journal"${E.tab === 'journal' ? '' : ' hidden'}>
      <div id="aeg-log" aria-live="polite"></div>
    </div>
  </div>`;
  E.root.querySelector('.aeg-tabs').addEventListener('keydown', onTabKey);
}

/* ---------- Affichage : journal ---------- */

/**
 * Regroupe le journal par membre : secrets distincts (lettres comptées ensemble), Paillettes, détail par secret.
 * @param {Array<object>} rows Lignes de hg_egg_log.
 * @returns {Array<{id: string, pseudo: string, total: number, count: number, last: string, letters: number, eggs: Array<object>}>}
 */
function groupByMember(rows) {
  const by = new Map();
  for (const r of rows) {
    let m = by.get(r.user_id);
    if (!m) { m = { id: r.user_id, pseudo: E.pseudo.get(r.user_id) || 'Ancien membre', total: 0, last: r.found_at, eggs: new Map(), letters: new Set(), saisons: new Set(), cueillette: null }; by.set(r.user_id, m); }
    m.total += Number(r.reward) || 0;
    if (r.found_at > m.last) m.last = r.found_at;
    if (/^lettre_[1-7]$/.test(r.egg)) { m.letters.add(r.egg); continue; }
    // Cueillette : les saisons (champi_<saison>) et la case « champis » forment un seul secret « champi »
    if (/^champi(_|s$)/.test(r.egg)) {
      if (r.egg.startsWith('champi_')) m.saisons.add(r.egg);
      if (!m.cueillette || r.found_at < m.cueillette) m.cueillette = r.found_at;
      continue;
    }
    const e = m.eggs.get(r.egg) || { egg: r.egg, n: 0, first: r.found_at };
    e.n += 1;
    if (r.found_at < e.first) e.first = r.found_at;
    m.eggs.set(r.egg, e);
  }
  return [...by.values()].map((m) => {
    const eggs = [...m.eggs.values()];
    if (m.cueillette) eggs.push({ egg: 'champi', n: m.saisons.size, first: m.cueillette, saisons: m.saisons.size });
    eggs.sort((a, b) => String(a.first).localeCompare(String(b.first)));
    // Comme hg_eggs_count : les lettres comptent pour un seul secret (« lettres »)
    const count = new Set([...eggs.map((e) => e.egg), ...(m.letters.size ? ['lettres'] : [])]).size;
    return { id: m.id, pseudo: m.pseudo, total: m.total, last: m.last, count, letters: m.letters.size, eggs };
  }).sort((a, b) => b.count - a.count || b.total - a.total || a.pseudo.localeCompare(b.pseudo, 'fr'));
}

/**
 * Pastille d'un secret trouvé (nom, nombre de fois si répétable, date de la première fois).
 * @param {{egg: string, n: number, first: string}} e
 * @returns {string} HTML
 */
function chipHtml(e) {
  const nom = EGG_NOMS[e.egg] || e.egg;
  let fois = e.n > 1 ? ` <span class="aeg-times">× ${e.n}</span>` : '';
  if (e.egg === 'champi') fois = e.saisons < SAISONS.length ? ` <span class="aeg-times">${e.saisons} / ${SAISONS.length}</span>` : '';
  return `<li class="aeg-chip" title="Première fois : ${esc(fmtDt(e.first))}">${esc(nom)}${fois}</li>`;
}

/** Dessine le journal (ou l'explication pour le Staff). */
function renderLog() {
  const host = E.root?.querySelector('#aeg-log');
  if (!host) return;
  if (!isAdmin()) {
    host.innerHTML = '<p class="aeg-ro" role="note">Le journal des trouvailles est réservé à l’administrateur : la base ne le montre qu’à lui (chaque membre ne voit que ses propres secrets).</p>';
    return;
  }
  if (E.logError) {
    host.innerHTML = `<div class="empty">Impossible de lire le journal : ${esc(E.logError)}</div>
      <p><button class="btn btn-ghost" type="button" data-aeg="reload-log">Réessayer</button></p>`;
    return;
  }
  if (!E.log) { host.innerHTML = '<div class="empty">Chargement du journal…</div>'; return; }
  const members = groupByMember(E.log);
  // Nombre de membres par secret (vue d'ensemble)
  const perEgg = Object.keys(EGG_NOMS).filter((c) => c !== 'arcade').map((c) => ({ c, n: members.filter((m) => (c === 'lettres' ? m.letters > 0 || m.eggs.some((e) => e.egg === 'lettres') : m.eggs.some((e) => e.egg === c))).length }));
  host.innerHTML = `${members.length ? `<ul class="aeg-overview" aria-label="Membres par secret">${perEgg.map(({ c, n }) =>
      `<li><span>${esc(EGG_NOMS[c])}</span><strong>${n}</strong></li>`).join('')}</ul>` : ''}
    ${searchHtml({ id: 'aeg-search', label: 'Rechercher un membre', placeholder: 'Pseudo ou secret…', value: E.query })}
    <div id="aeg-members"></div>`;
  E.members = members;
  bindSearch(host.querySelector('#aeg-search'), (q) => { E.query = q; E.limit = LOT; renderMembers(members); });
  renderMembers(members);
}

/**
 * Dessine la liste des membres (filtrée par la recherche).
 * @param {Array<object>} members Résultat de groupByMember.
 */
function renderMembers(members) {
  const box = E.root.querySelector('#aeg-members');
  if (!box) return;
  const shown = members.filter((m) => matches(E.query, m.pseudo, m.eggs.map((e) => EGG_NOMS[e.egg] || e.egg).join(' ')));
  setCount(E.root.querySelector('#aeg-search-count'), shown.length, members.length, E.query, ['membre', 'membres']);
  if (!shown.length) { box.innerHTML = emptyHtml(E.query, 'Personne n’a encore trouvé de secret.'); return; }
  box.innerHTML = `<ul class="aeg-members">${shown.slice(0, E.limit).map((m) => `<li class="aeg-member" data-user="${esc(m.id)}">
      <div class="aeg-member-head">
        <strong class="aeg-pseudo">${esc(m.pseudo)}</strong>
        <span class="small muted">${m.count} secret${m.count > 1 ? 's' : ''} · ${m.total.toLocaleString('fr-CH')} Paillettes · dernier le ${esc(fmtDt(m.last))}</span>
      </div>
      <ul class="aeg-chips">${m.eggs.map(chipHtml).join('')}${m.letters && !m.eggs.some((e) => e.egg === 'lettres') ? `<li class="aeg-chip aeg-chip-part">Lettres ${m.letters}/7</li>` : ''}</ul>
    </li>`).join('')}</ul>${moreHtml('aeg-more', Math.min(E.limit, shown.length), shown.length, 'data-aeg="more"')}`;
}

/* ---------- Événements ---------- */

/** Lit les valeurs du formulaire (texte brut). */
function readForm(form) {
  const fd = new FormData(form);
  return {
    anniversaire_gang: String(fd.get('anniversaire_gang') ?? '').trim(),
    mot_secret: String(fd.get('mot_secret') ?? '').trim().toUpperCase(),
    recompenses: Object.fromEntries(Object.keys(EGG_NOMS).map((c) => [c, String(fd.get(`r.${c}`) ?? '').trim()])),
    champi: { pages: Object.fromEntries(SAISONS.map(([s]) => [s, String(fd.get(`c.${s}`) ?? '').trim()])), facts: String(fd.get('c.facts') ?? '') },
  };
}

/**
 * Affiche les erreurs sous chaque champ (et aria-invalid) ; renvoie le premier champ en erreur.
 * @param {HTMLFormElement} form
 * @param {Object<string, string>} errs
 * @returns {HTMLElement|null}
 */
function showErrors(form, errs) {
  let first = null;
  form.querySelectorAll('[data-err]').forEach((p) => {
    const k = p.dataset.err, msg = errs[k];
    const input = form.querySelector(`[name="${CSS.escape(k)}"]`);
    p.textContent = msg || '';
    p.hidden = !msg;
    if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    if (msg && !first) first = input;
  });
  return first;
}

/** Message d'état sous le formulaire. */
function status(msg, tone = '') {
  const el = E.root.querySelector('#aeg-status');
  if (!el) return;
  el.textContent = msg;
  el.dataset.tone = tone;
}

/** Enregistrement : valide, puis upsert de la clé « eggs » en gardant les clés et récompenses inconnues. */
async function onSubmit(ev) {
  if (ev.target?.id !== 'aeg-form') return;
  ev.preventDefault();
  if (E.busy || !canWrite()) return;
  const form = ev.target;
  const v = readForm(form);
  const errs = validateEggs(v);
  const first = showErrors(form, errs);
  if (first) { status(`${Object.keys(errs).length} champ${Object.keys(errs).length > 1 ? 's' : ''} à corriger.`, 'error'); first.focus(); return; }
  const base = E.raw || {};
  const value = {
    ...base,
    anniversaire_gang: v.anniversaire_gang || null,
    mot_secret: v.mot_secret,
    recompenses: { ...(base.recompenses && typeof base.recompenses === 'object' ? base.recompenses : {}),
      ...Object.fromEntries(Object.entries(v.recompenses).map(([c, n]) => [c, Number(n)])) },
    champi: { ...(base.champi && typeof base.champi === 'object' && !Array.isArray(base.champi) ? base.champi : {}),
      pages: { ...(base.champi?.pages && typeof base.champi.pages === 'object' ? base.champi.pages : {}), ...v.champi.pages },
      facts: faitsDe(v.champi.facts) },
  };
  const btn = form.querySelector('#aeg-save');
  E.busy = true;
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  status('Enregistrement…');
  try {
    const { error } = await sb.from('hg_settings').upsert({ key: 'eggs', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    E.raw = value;
    status('Secrets enregistrés.', 'ok');
    toast('Secrets enregistrés');
  } catch (e) {
    status(`Enregistrement impossible : ${errMsg(e)}`, 'error');
  } finally {
    E.busy = false;
    if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
}

/** Boutons : valeurs par défaut (dans le formulaire, sans enregistrer), réessayer. */
async function onClick(ev) {
  const b = ev.target.closest('[data-aeg]');
  if (!b) return;
  const act = b.dataset.aeg;
  if (act === 'reload') { await mountEggsSection(E.root); return; }
  if (act === 'reload-log') { await loadLog(); return; }
  if (act === 'tab') { await openTab(b.dataset.tab); return; }
  if (act === 'more') {
    const first = E.limit;
    E.limit += LOT;
    renderMembers(E.members);
    E.root.querySelectorAll('.aeg-member')[first]?.querySelector('.aeg-pseudo')?.setAttribute('tabindex', '-1');
    E.root.querySelectorAll('.aeg-member')[first]?.querySelector('.aeg-pseudo')?.focus();
    return;
  }
  if (act === 'defaults') {
    const form = E.root.querySelector('#aeg-form');
    form.anniversaire_gang.value = EGGS_DEFAULTS.anniversaire_gang ?? '';
    form.mot_secret.value = EGGS_DEFAULTS.mot_secret;
    for (const [c, n] of Object.entries(EGGS_DEFAULTS.recompenses)) form.querySelector(`[name="r.${c}"]`).value = String(n);
    for (const [s] of SAISONS) form.querySelector(`[name="c.${s}"]`).value = EGGS_DEFAULTS.champi.pages[s];
    form.querySelector('[name="c.facts"]').value = EGGS_DEFAULTS.champi.facts.join('\n');
    showErrors(form, {});
    status('Valeurs par défaut remises dans le formulaire : enregistre pour les appliquer.');
  }
}

/** Onglets au clavier : flèches gauche/droite, Début, Fin. */
function onTabKey(ev) {
  const order = ['reglages', 'journal'];
  const i = order.indexOf(E.tab);
  const next = { ArrowRight: order[(i + 1) % 2], ArrowLeft: order[(i + 1) % 2], Home: order[0], End: order[1] }[ev.key];
  if (!next) return;
  ev.preventDefault();
  openTab(next, true);
}

/** Mot secret : majuscules pendant la saisie ; efface l'erreur du champ modifié. */
function onInput(ev) {
  const t = ev.target;
  if (t?.name === 'mot_secret') {
    const pos = t.selectionStart;
    t.value = t.value.toUpperCase();
    try { t.setSelectionRange(pos, pos); } catch { /* sans objet */ }
  }
  const p = t?.name && E.root.querySelector(`[data-err="${CSS.escape(t.name)}"]`);
  if (p && !p.hidden) { p.hidden = true; t.removeAttribute('aria-invalid'); }
}
