// Thème affiché : état (thème du jour, thème du site, liste et réglage), pose des variables CSS, du logo et de
// l'effet. Ne charge rien : le chargement depuis la base est dans theme-load.js.
import { siteLogo } from './site-defaults.js';
import { getPrefs, applyPrefsAttrs } from './prefs-state.js';
import { DEFAULT_THEME, pickTheme, themeVars, emojiAt } from './theme-calc.js';
import { startEffects } from './effects.js';

let _theme = DEFAULT_THEME;      // thème affiché
let _siteTheme = DEFAULT_THEME;  // thème choisi pour le site (peut différer si « Thème spécial » est coupé)
let _themes = null;
let _setting = null;

/** Thème à afficher pour moi : celui du site, ou le thème par défaut si j'ai coupé les thèmes spéciaux. */
function displayTheme(site) {
  if (getPrefs().special || !site || site.is_default) return site || DEFAULT_THEME;
  return (_themes || []).find((t) => t.is_default) || DEFAULT_THEME;
}
function setRootVars(t) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themeVars(t.colors))) root.style.setProperty(k, v);
  root.dataset.theme = t.slug || 'classique';
}

/** Pose les couleurs (composées avec le mode d'affichage), data-theme, le logo et l'effet d'un thème (sans rien enregistrer). */
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

/** Enregistre le réglage, la liste et le thème du jour choisi, puis les applique (appelée par applyTheme). */
export function commitSiteTheme({ setting, themes, chosen }) {
  _setting = setting;
  _themes = themes;
  _siteTheme = chosen;
  paintTheme(displayTheme(chosen));
}

/** Thème appliqué en ce moment (objet avec slug, name, emojis, logo_url, effect, colors…). */
export function getActiveTheme() { return _theme; }
/** Thème du site aujourd'hui (indépendamment de la préférence « Thème spécial »). */
export function getSiteTheme() { return _siteTheme; }
/** Emoji n° i du thème actif (modulo le nombre d'emojis), '' s'il n'y en a pas. */
export function themeEmoji(i = 0) { return emojiAt(_theme?.emojis, i); }
/** Logo du thème actif, sinon le logo du site. */
export function currentLogo() { return _theme?.logo_url || siteLogo(); }
/** Thèmes et réglage chargés par applyTheme (null tant que non chargés). */
export function getThemeState() { return { themes: _themes, setting: _setting, theme: _theme, siteTheme: _siteTheme }; }

// Application immédiate (avant toute requête réseau) : préférences puis thème mis en cache
applyPrefsAttrs();
try {
  const cached = JSON.parse(localStorage.getItem('hg_theme') || 'null');
  if (cached && typeof cached === 'object' && cached.colors) { _siteTheme = cached; _theme = displayTheme(cached); }
} catch {}
setRootVars(_theme);
try { matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { applyPrefsAttrs(); startEffects(_theme); }); } catch {}
