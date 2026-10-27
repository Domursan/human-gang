// Thème affiché : état (thème du jour, thème du site, liste et réglage), pose des variables CSS, du logo et de
// l'effet. Ne charge rien : le chargement depuis la base est dans theme-load.js.
/*
 * Rôle : garde en mémoire le thème affiché et le thème du site, et sait les peindre sur la page
 * (couleurs, logo, effet visuel). Le thème de la dernière visite est appliqué dès le chargement du module,
 * avant toute requête, pour éviter un flash de couleurs.
 * Page : toutes les pages (theme-load.js fournit le thème du jour ; prefs.js le repeint après un changement).
 * Dépendances : site-defaults.js (logo du site), prefs-state.js (préférences), theme-calc.js (couleurs, thème par défaut),
 * effects.js (calque d'effets et classe fx-fromage).
 * Stockage : lit localStorage « hg_theme » (dernier thème du jour connu).
 * Exporte : paintTheme, paintSiteTheme, paintActiveTheme, commitSiteTheme, getActiveTheme, getSiteTheme, currentLogo.
 */
import { siteLogo } from './site-defaults.js';
import { getPrefs, applyPrefsAttrs } from './prefs-state.js';
import { DEFAULT_THEME, themeVars, rainbowVars } from './theme-calc.js';
import { startEffects, applyFromageClass } from './effects.js';

/* ---------- État ---------- */

/** Thème affiché (peut être le thème par défaut si « Thème spécial » est coupé). */
let _theme = DEFAULT_THEME;      // thème affiché
/** Thème choisi pour le site aujourd'hui (indépendamment de la préférence). */
let _siteTheme = DEFAULT_THEME;  // thème choisi pour le site (peut différer si « Thème spécial » est coupé)
/** Liste des thèmes chargée depuis la base (null tant qu'elle ne l'est pas). */
let _themes = null;

/* ---------- Choix du thème à afficher ---------- */

/**
 * Thème à afficher pour moi : celui du site, ou le thème par défaut si j'ai coupé les thèmes spéciaux.
 * @param {object|null} site Thème choisi pour le site.
 * @returns {object} Thème à peindre.
 */
function displayTheme(site) {
  if (getPrefs().special || !site || site.is_default) return site || DEFAULT_THEME;
  return (_themes || []).find((t) => t.is_default) || DEFAULT_THEME;
}
/**
 * Pose les variables CSS de couleur sur <html> et l'attribut data-theme (utilisé par le CSS).
 * @param {object} t Thème à poser.
 */
function setRootVars(t) {
  const root = document.documentElement;
  const vars = themeVars(t.colors);
  // Barre arc-en-ciel : palette du thème pour un thème spécial, couleurs de marque sinon (retirées si on revient au défaut)
  Object.assign(vars, t.is_default ? {} : rainbowVars(vars));
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  if (t.is_default) for (let i = 1; i <= 6; i++) root.style.removeProperty(`--rb-${i}`);
  root.dataset.theme = t.slug || 'classique';
  // Emoji de la Paillette pendant ce thème (ex. 🧀 pour Raclette) : lu par paillettes.js ; retiré sinon
  if (t.paillette_emoji) root.dataset.paillette = t.paillette_emoji; else delete root.dataset.paillette;
  // Le même emoji en variable CSS (--paill-emoji, lue par var() dans les feuilles de style) ; retirée sinon
  if (t.paillette_emoji) root.style.setProperty('--paill-emoji', JSON.stringify(t.paillette_emoji));
  else root.style.removeProperty('--paill-emoji');
}

/* ---------- Peinture ---------- */

/**
 * Pose les couleurs (composées avec le mode d'affichage), data-theme, le logo et l'effet d'un thème (sans rien enregistrer).
 * Le logo des images de l'en-tête est mis à jour seulement s'il a changé.
 * @param {object|null} theme Thème à peindre (le thème par défaut si absent).
 * @returns {object} Le thème peint.
 */
export function paintTheme(theme) {
  const t = theme || DEFAULT_THEME;
  setRootVars(t);
  _theme = t;
  const logo = currentLogo();
  document.querySelectorAll('img.brand-logo').forEach((img) => { if (img.getAttribute('src') !== logo) img.src = logo; });
  startEffects(t);
  return t;
}
/** Repeint le thème du site (avec la préférence « Thème spécial » courante). */
export function paintSiteTheme() { return paintTheme(displayTheme(_siteTheme)); }
/** Repeint le thème affiché (après un changement de mode d'affichage). */
export function paintActiveTheme() { return paintTheme(_theme); }

/**
 * Enregistre la liste et le thème du jour choisi, puis les applique (appelée par applyTheme).
 * @param {{themes: Array<object>, chosen: object}} args Liste des thèmes et thème retenu pour aujourd'hui.
 */
export function commitSiteTheme({ themes, chosen }) {
  _themes = themes;
  _siteTheme = chosen;
  paintTheme(displayTheme(chosen));
}

/* ---------- Lecture ---------- */

/**
 * Thème appliqué en ce moment (objet avec slug, name, emojis, logo_url, effect, colors…).
 * @returns {object}
 */
export function getActiveTheme() { return _theme; }
/**
 * Thème du site aujourd'hui (indépendamment de la préférence « Thème spécial »).
 * @returns {object}
 */
export function getSiteTheme() { return _siteTheme; }
/**
 * Logo à afficher : celui du thème actif, sinon le logo du site.
 * @returns {string} Adresse de l'image.
 */
export function currentLogo() { return _theme?.logo_url || siteLogo(); }

/* ---------- Démarrage (avant tout appel réseau) ---------- */

// Application immédiate (avant toute requête réseau) : préférences puis thème mis en cache
applyPrefsAttrs();
try {
  const cached = JSON.parse(localStorage.getItem('hg_theme') || 'null');
  if (cached && typeof cached === 'object' && cached.colors) { _siteTheme = cached; _theme = displayTheme(cached); }
} catch {}
setRootVars(_theme);
applyFromageClass(_theme); // thème fromage : classe posée dès le premier affichage (l'en-tête garde sa place)
// Si le système demande moins d'animations, on recalcule les attributs et les effets sans attendre un rechargement
try { matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { applyPrefsAttrs(); startEffects(_theme); }); } catch {}
