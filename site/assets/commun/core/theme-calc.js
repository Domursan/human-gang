// Thèmes : constantes, choix du thème du jour et calculs de couleurs. Fonctions pures (sauf la valeur par
// défaut du mode de themeVars, lue dans les préférences).
/*
 * Rôle : calcule le thème à afficher (lequel, à partir des dates et du réglage), ses couleurs
 * (variables CSS selon le mode d'affichage) et les emojis / effets qui vont avec.
 * Page : toutes les pages, indirectement (theme.js et theme-load.js s'en servent ; admin-themes.js aussi).
 * Dépendances : prefs-state.js (mode d'affichage courant, pour themeVars).
 * Aucune requête : les thèmes sont fournis par l'appelant (theme-load.js les lit dans hg_themes).
 * Exporte : DEFAULT_THEME, THEME_EFFECTS, THEME_COLOR_KEYS, isValidMd, todayMd, mdInRange, pickTheme,
 *   isHex, luminance, contrast, themeVars, emojiAt.
 */
import { getPrefs } from './prefs-state.js';

/* ---------- Constantes ---------- */

// Thème de secours (identique au thème « Classique » de la base) : utilisé hors ligne ou avant le chargement.
export const DEFAULT_THEME = Object.freeze({
  slug: 'classique', name: 'Classique', is_default: true, active: true, start_md: null, end_md: null, priority: 0,
  logo_url: null, emojis: ['❤️', '🌈', '✨'], effect: 'etoiles',
  colors: { accent: '#9E3543', bg: '#0E0E10', surface: '#17171A', text: '#F2EFEA', muted: '#ABA7A0', highlight: '#E2C77E' },
});
/** Effets visuels proposés dans l'éditeur de thèmes, avec leur libellé. */
export const THEME_EFFECTS = { aucun: 'Aucun', pluie: "Pluie d'emojis", neige: 'Neige', 'neige-emojis': 'Neige et emojis qui tombent', etoiles: 'Étoiles scintillantes', fromage: 'Fromage fondu et gourmandises', braises: 'Braises qui montent' };
/** Couleurs qu'un thème peut définir (les autres variables sont calculées). */
export const THEME_COLOR_KEYS = ['accent', 'bg', 'surface', 'text', 'muted', 'highlight'];

/* ---------- Dates : jours « MM-DD » et plages ---------- */

/** Forme « MM-DD » (mois 01 à 12, jour 01 à 31). */
const MD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** Nombre de jours de chaque mois ; février compte 29 jours (année bissextile possible). */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/**
 * 'MM-DD' valide (29 février accepté).
 * @param {*} md Valeur à tester.
 * @returns {boolean}
 */
export function isValidMd(md) {
  const m = MD_RE.exec(String(md ?? ''));
  return !!m && Number(m[2]) <= MONTH_DAYS[Number(m[1]) - 1];
}
/**
 * Jour « MM-DD » d'une date (par défaut aujourd'hui, heure locale).
 * @param {Date} [d=new Date()]
 * @returns {string} Par exemple « 12-24 ».
 */
export function todayMd(d = new Date()) {
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/**
 * La plage [start, end] contient-elle md ? Gère les plages qui passent le nouvel an (12-21 → 03-19).
 * Une plage avec une date invalide ne contient jamais rien.
 * @param {string} md Jour à tester (« MM-DD »).
 * @param {string} start Début de la plage.
 * @param {string} end Fin de la plage (incluse).
 * @returns {boolean}
 */
export function mdInRange(md, start, end) {
  if (!isValidMd(start) || !isValidMd(end)) return false;
  return start <= end ? md >= start && md <= end : md >= start || md <= end;
}
/**
 * Durée d'une plage en jours. Sert à départager deux thèmes de même priorité : le plus court gagne.
 * Le numéro du jour de l'année sert de base de calcul ; une plage qui passe le nouvel an est comptée sur 366 jours.
 * @param {{start_md: string, end_md: string}} t Thème avec sa plage.
 * @returns {number}
 */
function rangeLength(t) {
  /** Numéro du jour dans l'année (1 à 366) pour un « MM-DD ». */
  const n = (md) => { const [m, d] = md.split('-').map(Number); return MONTH_DAYS.slice(0, m - 1).reduce((a, b) => a + b, 0) + d; };
  const a = n(t.start_md), b = n(t.end_md);
  return b >= a ? b - a : 366 - a + b;
}
/**
 * Dimanche de Pâques (calendrier grégorien). Algorithme de Meeus / Jones / Butcher.
 * @param {number} y Année.
 * @returns {Date} Le dimanche de Pâques de l'année y, à minuit.
 */
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
/**
 * Le thème « paques » suit automatiquement la date de Pâques : de 7 jours avant au lundi de Pâques.
 * Les autres thèmes sont renvoyés tels quels.
 * @param {object} t Thème.
 * @param {Date} date Date de référence (l'année est prise dedans).
 * @returns {object} Thème avec start_md et end_md recalculés pour l'année.
 */
function withDynamicDates(t, date) {
  if (t.slug !== 'paques') return t;
  const e = easterSunday(date.getFullYear());
  const from = new Date(e); from.setDate(e.getDate() - 7);
  const to = new Date(e); to.setDate(e.getDate() + 1);
  return { ...t, start_md: todayMd(from), end_md: todayMd(to) };
}

/* ---------- Choix du thème ---------- */

/**
 * Choisit le thème : forcé (si le réglage le demande et que le thème existe), sinon le thème actif dont la plage
 * contient la date avec la plus haute priorité (à égalité : la plage la plus courte), sinon le thème par défaut.
 * Le thème par défaut n'entre jamais dans la recherche de plage : il sert seulement de repli.
 * @param {Array<object>} [themes=[]] Thèmes de la base.
 * @param {object|null} [setting=null] Réglage : { mode: 'auto'|'forced', forced_slug }.
 * @param {Date} [date=new Date()] Date de référence.
 * @returns {object} Le thème choisi.
 */
export function pickTheme(themes = [], setting = null, date = new Date()) {
  const list = (Array.isArray(themes) ? themes : []).map((t) => withDynamicDates(t, date));
  if (setting?.mode === 'forced') {
    const slug = setting.forced_slug ?? setting.forced; // « forced » = ancien format
    const f = list.find((t) => t.slug === slug);
    if (f) return f;
  }
  const md = todayMd(date);
  // Tri : priorité décroissante, puis plage la plus courte, puis nom (ordre stable)
  const hit = list
    .filter((t) => t.active && !t.is_default && mdInRange(md, t.start_md, t.end_md))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || rangeLength(a) - rangeLength(b) || String(a.name).localeCompare(String(b.name)))[0];
  return hit ?? list.find((t) => t.is_default) ?? DEFAULT_THEME;
}

/* ---------- Couleurs : conversion et contraste ---------- */

/** Couleur hexadécimale complète, par exemple « #9E3543 ». */
const HEX_RE = /^#[0-9a-f]{6}$/i;
/**
 * Vrai si c est une couleur hexadécimale complète (#RRGGBB).
 * @param {*} c Valeur à tester.
 * @returns {boolean}
 */
export const isHex = (c) => HEX_RE.test(String(c ?? ''));
/**
 * Hexadécimal vers [r, g, b] (0 à 255).
 * @param {string} hex Couleur « #RRGGBB ».
 * @returns {number[]}
 */
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
/**
 * [r, g, b] vers hexadécimal ; chaque composante est arrondie et bornée entre 0 et 255.
 * @param {number[]} rgbArr Composantes.
 * @returns {string} « #RRGGBB ».
 */
function hex([r, g, b]) { return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`; }
/**
 * Mélange deux couleurs : t = 0 donne a, t = 1 donne b.
 * @param {string} a Couleur de départ.
 * @param {string} b Couleur d'arrivée.
 * @param {number} t Proportion de b (entre 0 et 1).
 * @returns {string} Couleur mélangée.
 */
function mix(a, b, t) { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); }
/**
 * Luminance relative (WCAG) d'une couleur, entre 0 (noir) et 1 (blanc).
 * La correction gamma est appliquée à chaque composante avant la somme pondérée.
 * @param {string} c Couleur « #RRGGBB ».
 * @returns {number}
 */
export function luminance(c) {
  const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/**
 * Rapport de contraste WCAG entre deux couleurs (de 1 à 21). 4.5 minimum pour un texte courant.
 * @param {string} a Première couleur.
 * @param {string} b Seconde couleur.
 * @returns {number}
 */
export function contrast(a, b) { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }
/**
 * Teinte (0 à 360°) et saturation (0 à 1) d'une couleur, en espace HSL.
 * @param {string} c Couleur « #RRGGBB ».
 * @returns {number[]} [teinte, saturation] ; [0, 0] pour un gris.
 */
function hueSat(c) {
  const [r, g, b] = rgb(c).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return [0, 0];
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const l = (max + min) / 2;
  return [h, d / (1 - Math.abs(2 * l - 1))];
}
/**
 * [teinte, saturation, luminosité] (HSL) d'une couleur « #RRGGBB ».
 * @param {string} c Couleur.
 * @returns {number[]}
 */
function toHsl(c) {
  const [r, g, b] = rgb(c).map((v) => v / 255);
  return [...hueSat(c), (Math.max(r, g, b) + Math.min(r, g, b)) / 2];
}
/**
 * [teinte, saturation, luminosité] (HSL) vers « #RRGGBB ».
 * @param {number} h Teinte (0 à 360).
 * @param {number} s Saturation (0 à 1).
 * @param {number} l Luminosité (0 à 1).
 * @returns {string}
 */
function fromHsl(h, s, l) {
  const C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - C / 2;
  const [r, g, b] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
  return hex([r + m, g + m, b + m].map((v) => v * 255));
}
/**
 * Ajuste la luminosité de c (vers le noir, ou vers le blanc si dir = 1) jusqu'à atteindre le contraste demandé avec
 * `against`. La teinte est gardée et la saturation ne descend pas sous 60 % (sauf pour un gris) : un jaune reste un or
 * et ne vire pas au brun-olive, comme le ferait un mélange avec du noir.
 * @param {string} c Couleur à corriger.
 * @param {string} against Couleur de fond.
 * @param {number} ratio Contraste minimal visé.
 * @param {number} [dir=-1] -1 pour assombrir, 1 pour éclaircir.
 * @returns {string} Couleur corrigée (inchangée si elle est déjà assez contrastée).
 */
function tuneContrast(c, against, ratio, dir = -1) {
  if (contrast(c, against) >= ratio) return c;
  const [h, s0, l0] = toHsl(c);
  const s = s0 < 0.1 ? s0 : Math.max(s0, 0.6);
  let l = l0;
  for (let i = 0; i < 90 && contrast(fromHsl(h, s, l), against) < ratio; i++) l = Math.max(0, Math.min(1, l + dir * 0.01));
  return fromHsl(h, s, l);
}
/**
 * Vrai si la couleur est rouge ou verte et assez vive : les personnes daltoniennes les confondent.
 * Plages de teintes : rouge (moins de 25° ou plus de 330°) et vert (70° à 170°).
 * @param {string} c Couleur à tester.
 * @returns {boolean}
 */
const isRedOrGreen = (c) => { const [h, s] = hueSat(c); return s > 0.18 && (h < 25 || h > 330 || (h > 70 && h < 170)); };

/* ---------- Variables CSS selon le mode ---------- */

/**
 * Variables CSS dérivées d'un objet colors {accent,bg,surface,text,muted,highlight}, composées avec le mode
 * d'affichage (sombre : couleurs du thème telles quelles ; clair : fond/surface/texte inversés, accent et
 * surlignage conservés mais assombris si besoin pour rester lisibles ; daltonien : contrastes renforcés,
 * accent rouge/vert remplacé par du bleu).
 * Une couleur invalide est remplacée par celle du thème par défaut.
 * @param {object} [colors={}] Couleurs du thème.
 * @param {string} [mode] Mode d'affichage ('sombre', 'clair' ou 'daltonien') ; par défaut celui des préférences.
 * @returns {Object<string, string>} Variables CSS (« --accent », « --bg », …) et leurs valeurs.
 */
export function themeVars(colors = {}, mode = getPrefs().mode) {
  const c = { ...DEFAULT_THEME.colors };
  for (const k of THEME_COLOR_KEYS) if (isHex(colors[k])) c[k] = colors[k];
  /** Texte blanc ou presque noir, selon celui qui contraste le mieux sur la couleur a. */
  const accentText = (a) => (contrast(a, '#ffffff') >= contrast(a, '#121212') ? '#ffffff' : '#121212');

  if (mode === 'clair') {
    const bg = mix('#F5F2ED', c.accent, 0.025), text = '#1B1A1F', muted = '#57534C';
    // Surface teintée par le fond du thème (blanc pur pour le thème sombre neutre, crème pour l'automne, froide pour l'hiver)
    const surface = mix('#FFFFFF', c.bg, 0.06);
    const accent = tuneContrast(c.accent, '#FFFFFF', 4.5);
    // Les jaunes de texte doivent tenir aussi sur les surfaces, un peu plus sombres que le fond (cartes, pastilles) :
    // le contraste est calculé contre une surface moyenne (fond + 6 % de texte), pas seulement contre le fond.
    const plusFonce = mix(bg, text, 0.06);
    const sand = tuneContrast(c.highlight, plusFonce, 4.8);
    return {
      '--accent': accent, '--accent-text': accentText(accent),
      '--bg': bg, '--surface': surface,
      '--surface-2': mix(bg, text, 0.035),
      '--border': mix(surface, text, 0.13),
      '--border-strong': mix(surface, text, 0.26),
      '--text': text, '--muted': muted,
      '--sand': sand,
      '--amber': tuneContrast(mix(c.highlight, c.accent, 0.3), plusFonce, 4.8),
      ...sectionVars(c, mode, surface, accent),
    };
  }
  let accent = c.accent;
  const dalto = mode === 'daltonien';
  if (dalto && isRedOrGreen(accent)) accent = '#3A72C2'; // bleu de remplacement, lisible pour tous
  return {
    '--accent': accent,
    '--accent-text': accentText(accent),
    '--bg': c.bg,
    '--surface': c.surface,
    '--surface-2': mix(c.surface, c.text, dalto ? 0.06 : 0.04),
    '--border': mix(c.surface, c.text, dalto ? 0.16 : 0.085),
    '--border-strong': mix(c.surface, c.text, dalto ? 0.3 : 0.155),
    '--text': c.text,
    '--muted': dalto ? mix(c.muted, c.text, 0.4) : c.muted,
    '--sand': c.highlight,
    '--amber': mix(c.highlight, c.accent, 0.3),
    ...sectionVars(c, mode, c.surface, accent),
  };
}

/**
 * Couleurs des bandeaux « historique », « pendant » et des bleus par défaut (--slate, --plum) : dérivées du thème pour
 * qu'aucun bleu fixe ne ressorte. Le mode daltonien garde ses couleurs propres (bleu = réussite), donc rien n'est posé.
 * @param {object} c Couleurs du thème (accent, highlight, bg…).
 * @param {string} mode Mode d'affichage.
 * @param {string} surface Surface du mode courant.
 * @param {string} accent Accent du mode courant.
 * @returns {Object<string, string>}
 */
function sectionVars(c, mode, surface, accent) {
  if (mode === 'daltonien') return {};
  if (mode === 'clair') {
    return {
      '--hist-bg': mix(surface, accent, 0.05), '--hist-border': mix(surface, accent, 0.16), '--hist-fg': accent,
      '--slate': accent,
      '--plum': tuneContrast(mix(c.highlight, c.accent, 0.5), '#FFFFFF', 4.5),
    };
  }
  return {
    '--hist-bg': mix(surface, accent, 0.1), '--hist-border': mix(surface, accent, 0.22), '--hist-fg': mix(accent, '#FFFFFF', 0.5),
    '--slate': mix(accent, '#FFFFFF', 0.35),
    '--plum': mix(c.highlight, c.accent, 0.5),
  };
}

/**
 * Couleurs de la barre arc-en-ciel (--rb-1 à --rb-6) pour un thème : elles reprennent la palette du thème au lieu des
 * couleurs fixes de la marque. Vide en mode daltonien.
 * @param {Object<string, string>} v Variables du thème (sortie de themeVars).
 * @param {string} [mode] Mode d'affichage (par défaut celui des préférences).
 * @returns {Object<string, string>}
 */
export function rainbowVars(v, mode = getPrefs().mode) {
  if (mode === 'daltonien') return {};
  return {
    '--rb-1': v['--accent'], '--rb-2': v['--sand'], '--rb-3': v['--amber'],
    '--rb-4': mix(v['--accent'], v['--text'], 0.35), '--rb-5': mix(v['--sand'], v['--accent'], 0.5), '--rb-6': v['--muted'],
  };
}

/* ---------- Emojis ---------- */

/**
 * Emoji n° i de la liste (modulo le nombre d'emojis), '' s'il n'y en a pas.
 * Les valeurs vides sont ignorées. Un indice négatif ou trop grand revient dans la liste.
 * @param {string[]|null|undefined} emojis Liste d'emojis du thème.
 * @param {number} [i=0] Position souhaitée.
 * @returns {string}
 */
export function emojiAt(emojis, i = 0) {
  const list = (emojis || []).filter(Boolean);
  if (!list.length) return '';
  const n = Number(i) || 0;
  return list[((n % list.length) + list.length) % list.length];
}
