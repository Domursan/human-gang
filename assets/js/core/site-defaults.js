// Réglages du site (hg_settings : clés site_identite et site_textes). Module pur : aucune requête, aucun import de Supabase
// (utilisable aussi par l'intro, qui se charge sans le client). Absence d'un réglage = valeur par défaut, donc le comportement
// est identique à celui d'avant les réglages. La base ne garde que les écarts aux valeurs par défaut.
// Le dernier état lu est gardé dans localStorage (hg_site_settings) pour le premier affichage ; il n'est jamais la source de vérité.
import { LOGO_SRC } from '../config.js';

export const DEFAULT_NOM = 'Humane Gang';
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
      { id: 'assistance', label: 'Assistance', visible: true },
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
export const FOOTER_IDS = SITE_DEFAULTS.textes.footer_liens.map((l) => l.id);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https:\/\/|assets\/)\S+$/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Valeur d'un champ texte, booléen ou chaîne : la valeur enregistrée si elle est valable, sinon la valeur par défaut. */
function cleanField(k, v, def) {
  if (typeof def === 'boolean') return typeof v === 'boolean' ? v : def;
  if (typeof v !== 'string') return def;
  const t = v.trim();
  if (!t && !VIDE_OK.has(k)) return def;
  if (t && k === 'contact_email' && !EMAIL_RE.test(t)) return def;
  if (t && k === 'logo_url' && !URL_RE.test(t)) return def;
  return t;
}

function cleanNav(v) {
  const out = {};
  if (!isObj(v)) return out;
  for (const slug of NAV_SLUGS) {
    const t = typeof v[slug] === 'string' ? v[slug].trim() : '';
    if (t) out[slug] = t.slice(0, 40);
  }
  return out;
}

/** Liste ordonnée du pied de page : libellés et visibilité enregistrés, identifiants inconnus ignorés, manquants ajoutés à la fin. */
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

/** Réglages fusionnés (valeurs valables uniquement) à partir des écarts enregistrés. */
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

/** Écarts aux valeurs par défaut d'un objet (ce qui est enregistré dans hg_settings). */
export function diffFromDefaults(obj, defaults) {
  const out = {};
  for (const k of Object.keys(defaults)) if (!sameValue(obj[k], defaults[k])) out[k] = obj[k];
  return out;
}

// --- État courant ---
let RAW = { identite: {}, textes: {} };
let STATE = buildSite(RAW);
try {
  const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  if (isObj(c)) { RAW = { identite: isObj(c.identite) ? c.identite : {}, textes: isObj(c.textes) ? c.textes : {} }; STATE = buildSite(RAW); }
} catch { /* stockage bloqué : valeurs par défaut */ }

/** Enregistre les écarts lus en base (appelée par core/site-load.js et par l'admin après enregistrement). */
export function setSiteRaw(raw) {
  RAW = { identite: isObj(raw?.identite) ? raw.identite : {}, textes: isObj(raw?.textes) ? raw.textes : {} };
  STATE = buildSite(RAW);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(RAW)); } catch { /* sans cache, le site reste correct */ }
  return STATE;
}
export const siteRaw = () => RAW;
export const siteIdentite = () => STATE.identite;
export const siteTexte = (k) => STATE.textes[k];
/** Libellé du menu saisi par l'admin, ou undefined (libellé automatique). */
export const navLibelle = (slug) => STATE.textes.nav_libelles[slug];
/** Pied de page : liste ordonnée { id, label, visible }. */
export const footerLiens = () => STATE.textes.footer_liens;
/** Logo par défaut du site (le logo d'un thème reste prioritaire, voir core/theme.js). */
export const siteLogo = () => STATE.identite.logo_url || LOGO_SRC;

/** Remplace {nom}, {annee} et {initiales} dans un texte. */
export function fmt(text, identite = STATE.identite) {
  return String(text ?? '')
    .replace(/\{nom\}/g, identite.nom)
    .replace(/\{initiales\}/g, identite.initiales)
    .replace(/\{annee\}/g, String(new Date().getFullYear()));
}

/**
 * Applique les réglages aux éléments marqués : [data-site-texte="cle"] (texte de site_textes),
 * [data-site-identite="cle"] (texte de site_identite) et le titre de la page quand le nom a changé.
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
