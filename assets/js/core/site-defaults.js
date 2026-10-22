// Réglages du site (hg_settings : clés site_identite et site_textes). Module pur : aucune requête, aucun import de Supabase
// (utilisable aussi par l'intro, qui se charge sans le client). Absence d'un réglage = valeur par défaut, donc le comportement
// est identique à celui d'avant les réglages. La base ne garde que les écarts aux valeurs par défaut.
// Le dernier état lu est gardé dans localStorage (hg_site_settings) pour le premier affichage ; il n'est jamais la source de vérité.
/*
 * Rôle : fournit les réglages du site (nom, logo, textes des pages, liens du menu et du pied de page)
 * avec leurs valeurs par défaut. Les valeurs saisies par l'admin ne sont utilisées que si elles sont valables.
 * Page : toutes les pages (en-tête, pied de page, intro, pages qui affichent un texte du site).
 * Dépendances : config.js (logo par défaut). Aucune requête : site-load.js fournit les données lues en base.
 * Exporte : DEFAULT_NOM, SITE_DEFAULTS, VIDE_OK, NAV_SLUGS, FOOTER_IDS, sameValue, buildSite, diffFromDefaults,
 *   setSiteRaw, siteIdentite, siteTexte, navLibelle, footerLiens, siteLogo, fmt, applySiteDom.
 */
import { LOGO_SRC } from '../config.js';

/* ---------- Constantes et valeurs par défaut ---------- */

/** Nom du site tel qu'il est écrit dans le code ; sert à reconnaître un nom personnalisé. */
export const DEFAULT_NOM = 'Humane Gang';
/** Clé localStorage du dernier état lu en base. */
const CACHE_KEY = 'hg_site_settings';

/** Valeurs par défaut (= comportement du site avant les réglages). */
export const SITE_DEFAULTS = {
  identite: {
    nom: DEFAULT_NOM,
    initiales: 'HG',
    editeur: '',
    contact_email: '',
    copyright: '© {annee} {nom}',
    logo_url: '',
    intro_active: true,
    bandeau_cookies: true,
  },
  textes: {
    intro_indice: 'Fais défiler vers le bas pour entrer sur le site',
    intro_bouton: 'Entrer',
    cookies_texte: 'Ce site utilise seulement le stockage nécessaire à son fonctionnement (connexion, préférences). Aucun traceur, aucune publicité.',
    assistance_intro: 'Ta demande est transmise à l\'admin sur Discord par le bot {nom}. Ces infos servent uniquement à traiter ta demande.',
    legal_mentions: '',
    legal_confidentialite: '',
    legal_cookies: '',
    nav_libelles: {},
    footer_liens: [
      { id: 'evenements', label: 'Événements', visible: true },
      { id: 'assistance', label: 'Assistance', visible: false },
      { id: 'mentions', label: 'Mentions légales', visible: true },
      { id: 'confidentialite', label: 'Confidentialité', visible: true },
      { id: 'cookies', label: 'Cookies', visible: true },
    ],
  },
};

/** Champs dont la valeur vide est permise (affichée « à compléter » ou absente). */
export const VIDE_OK = new Set(['editeur', 'contact_email', 'logo_url', 'legal_mentions', 'legal_confidentialite', 'legal_cookies']);
/** Liens du menu (en-tête) dont on peut régler le libellé. */
export const NAV_SLUGS = ['secret-santa', 'irl', 'historique', 'messages', 'cartes', 'membre', 'recap'];
/** Identifiants des liens du pied de page, dans l'ordre par défaut. */
export const FOOTER_IDS = SITE_DEFAULTS.textes.footer_liens.map((l) => l.id);

/* ---------- Validation ---------- */

/** Forme d'une adresse e-mail simple (quelque chose@domaine.ext). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Adresse acceptée pour un logo : https:// ou un fichier du dossier assets/. */
const URL_RE = /^(https:\/\/|assets\/)\S+$/;
/** true pour un objet simple (pas un tableau, pas null). */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Copie profonde d'une valeur simple (JSON). */
const clone = (v) => JSON.parse(JSON.stringify(v));
/**
 * Compare deux valeurs par leur contenu JSON.
 * @param {*} a
 * @param {*} b
 * @returns {boolean} true si elles ont le même contenu.
 */
export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Valeur d'un champ texte, booléen ou chaîne : la valeur enregistrée si elle est valable, sinon la valeur par défaut.
 * Un texte vide est refusé sauf pour les champs de VIDE_OK. Le texte est nettoyé (espaces retirés).
 * @param {string} k Nom du champ.
 * @param {*} v Valeur enregistrée.
 * @param {*} def Valeur par défaut (son type dit le type attendu).
 * @returns {*} Valeur valable.
 */
function cleanField(k, v, def) {
  if (typeof def === 'boolean') return typeof v === 'boolean' ? v : def;
  if (typeof v !== 'string') return def;
  const t = v.trim();
  if (!t && !VIDE_OK.has(k)) return def;
  if (t && k === 'contact_email' && !EMAIL_RE.test(t)) return def;
  if (t && k === 'logo_url' && !URL_RE.test(t)) return def;
  return t;
}

/**
 * Libellés du menu : seuls les liens connus sont gardés, chaque libellé est coupé à 40 caractères.
 * @param {*} v Objet { slug: libellé } enregistré.
 * @returns {Object<string, string>} Libellés valables uniquement.
 */
function cleanNav(v) {
  const out = {};
  if (!isObj(v)) return out;
  for (const slug of NAV_SLUGS) {
    const t = typeof v[slug] === 'string' ? v[slug].trim() : '';
    if (t) out[slug] = t.slice(0, 40);
  }
  return out;
}

/**
 * Liste ordonnée du pied de page : libellés et visibilité enregistrés, identifiants inconnus ignorés, manquants ajoutés à la fin.
 * Un identifiant en double n'est gardé qu'une fois (le premier).
 * @param {*} v Tableau enregistré.
 * @returns {Array<{id: string, label: string, visible: boolean}>}
 */
function cleanFooter(v) {
  const def = SITE_DEFAULTS.textes.footer_liens;
  if (!Array.isArray(v)) return clone(def);
  const out = [], seen = new Set();
  for (const item of v) {
    if (!isObj(item) || !FOOTER_IDS.includes(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    const d = def.find((x) => x.id === item.id);
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 40) : d.label;
    out.push({ id: item.id, label, visible: typeof item.visible === 'boolean' ? item.visible : true });
  }
  for (const d of def) if (!seen.has(d.id)) out.push(clone(d));
  return out;
}

/* ---------- Fusion et écarts ---------- */

/**
 * Réglages fusionnés (valeurs valables uniquement) à partir des écarts enregistrés.
 * @param {{identite?: object, textes?: object}} [raw={}] Écarts enregistrés en base.
 * @returns {{identite: object, textes: object}} Réglages complets.
 */
export function buildSite(raw = {}) {
  const r1 = isObj(raw.identite) ? raw.identite : {}, r2 = isObj(raw.textes) ? raw.textes : {};
  const identite = {}, textes = {};
  for (const k of Object.keys(SITE_DEFAULTS.identite)) identite[k] = cleanField(k, r1[k], SITE_DEFAULTS.identite[k]);
  for (const k of Object.keys(SITE_DEFAULTS.textes)) {
    if (k === 'nav_libelles') textes[k] = cleanNav(r2[k]);
    else if (k === 'footer_liens') textes[k] = cleanFooter(r2[k]);
    else textes[k] = cleanField(k, r2[k], SITE_DEFAULTS.textes[k]);
  }
  return { identite, textes };
}

/**
 * Écarts aux valeurs par défaut d'un objet (ce qui est enregistré dans hg_settings).
 * Seules les clés qui diffèrent de leur défaut sont gardées.
 * @param {object} obj Valeurs actuelles.
 * @param {object} defaults Valeurs par défaut.
 * @returns {object}
 */
export function diffFromDefaults(obj, defaults) {
  const out = {};
  for (const k of Object.keys(defaults)) if (!sameValue(obj[k], defaults[k])) out[k] = obj[k];
  return out;
}

/* ---------- État courant ---------- */

/** Écarts lus en base (ou dans le cache) : { identite, textes }. */
let RAW = { identite: {}, textes: {} };
/** Réglages utilisables (fusion de RAW avec les valeurs par défaut). */
let STATE = buildSite(RAW);
// Premier affichage : on reprend le dernier état connu, s'il existe
try {
  const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  if (isObj(c)) { RAW = { identite: isObj(c.identite) ? c.identite : {}, textes: isObj(c.textes) ? c.textes : {} }; STATE = buildSite(RAW); }
} catch { /* stockage bloqué : valeurs par défaut */ }

/**
 * Enregistre les écarts lus en base (appelée par core/site-load.js et par l'admin après enregistrement).
 * Met aussi le cache localStorage à jour.
 * @param {{identite?: object, textes?: object}} raw Écarts lus en base.
 * @returns {{identite: object, textes: object}} Réglages utilisables après enregistrement.
 */
export function setSiteRaw(raw) {
  RAW = { identite: isObj(raw?.identite) ? raw.identite : {}, textes: isObj(raw?.textes) ? raw.textes : {} };
  STATE = buildSite(RAW);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(RAW)); } catch { /* sans cache, le site reste correct */ }
  return STATE;
}

/* ---------- Lecture ---------- */

/** Réglages d'identité (nom, initiales, copyright, logo, options). */
export const siteIdentite = () => STATE.identite;
/**
 * Texte du site par sa clé (ex. 'cookies_texte').
 * @param {string} k Clé du texte.
 * @returns {*} Le texte, ou undefined si la clé n'existe pas.
 */
export const siteTexte = (k) => STATE.textes[k];
/** Libellé du menu saisi par l'admin, ou undefined (libellé automatique). */
export const navLibelle = (slug) => STATE.textes.nav_libelles[slug];
/** Pied de page : liste ordonnée { id, label, visible }. */
export const footerLiens = () => STATE.textes.footer_liens;
/** Logo par défaut du site (le logo d'un thème reste prioritaire, voir core/theme.js). */
export const siteLogo = () => STATE.identite.logo_url || LOGO_SRC;

/* ---------- Affichage ---------- */

/**
 * Remplace {nom}, {annee} et {initiales} dans un texte.
 * @param {string} text Texte avec des marqueurs entre accolades.
 * @param {object} [identite=STATE.identite] Identité à utiliser pour nom et initiales.
 * @returns {string}
 */
export function fmt(text, identite = STATE.identite) {
  return String(text ?? '')
    .replace(/\{nom\}/g, identite.nom)
    .replace(/\{initiales\}/g, identite.initiales)
    .replace(/\{annee\}/g, String(new Date().getFullYear()));
}

/**
 * Applique les réglages aux éléments marqués : [data-site-texte="cle"] (texte de site_textes),
 * [data-site-identite="cle"] (texte de site_identite) et le titre de la page quand le nom a changé.
 * Un élément dont la clé n'est pas une chaîne garde son contenu d'origine.
 * @param {Document|HTMLElement} [root=document] Racine où chercher les éléments.
 */
export function applySiteDom(root = document) {
  const id = STATE.identite;
  if (id.nom !== DEFAULT_NOM && root.title) root.title = root.title.split(DEFAULT_NOM).join(id.nom);
  root.querySelectorAll?.('[data-site-texte]').forEach((el) => {
    const k = el.dataset.siteTexte;
    if (typeof STATE.textes[k] === 'string') el.textContent = fmt(STATE.textes[k], id);
  });
  root.querySelectorAll?.('[data-site-identite]').forEach((el) => {
    const k = el.dataset.siteIdentite;
    if (typeof id[k] === 'string') el.textContent = fmt(id[k], id);
  });
}
