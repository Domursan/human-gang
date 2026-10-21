// ===== Humane Gang — socle commun (à importer dans chaque page) =====
// Point d'entrée : le code est découpé dans assets/js/core/ ; ce fichier ré-exporte les mêmes noms qu'avant,
// les pages n'ont donc rien à changer dans leurs imports.
// Ordre volontaire : les modules de préférences et de thème (et leur cache) sont évalués AVANT le client Supabase
// (module à « await » de premier niveau), pour appliquer les couleurs sans flash pendant le chargement de supabase-js.
// Dépendances : utilitaires purs -> préférences / calcul des thèmes -> effets -> thème -> client Supabase
// -> profil, pages, fonctions -> préférences (panneau), mode sans limite, badges -> en-tête, pied -> initialisation.

export { LOGO_SRC } from './config.js';
export { playSound } from './sound.js';
export { esc, $, $$, fmtDate, fmtDateTime, daysUntil, initials, avatarHtml, errMsg } from './core/util.js';
export { toast } from './core/ui.js';
export { PREF_MODES, PREF_DEFAULTS, getPrefs } from './core/prefs-state.js';
export {
  DEFAULT_THEME, THEME_EFFECTS, THEME_COLOR_KEYS, isValidMd, todayMd, mdInRange, pickTheme, isHex, luminance, contrast,
  themeVars, SEASONS, SEASON_LABELS,
} from './core/theme-calc.js';
export { effectsEnabled, motionAllowed } from './core/effects.js';
export { paintTheme, getActiveTheme, getSiteTheme, themeEmoji, currentLogo, getThemeState } from './core/theme.js';
export { applyTheme, applySeason, autoSeason } from './core/theme-load.js';
export { sb, hasSession, isNavCancel } from './core/supabase.js';
export { setPrefs, setEffectsEnabled, openPrefs } from './core/prefs.js';
export { getUser, getProfile, requireMember, requireAdmin } from './core/profile.js';
export { callFn, notify } from './core/functions.js';
export { currentPageSlug, loadMyPages, getMyPages, canAccess, pageLabel } from './core/pages-access.js';
export { GOD_MINUTES, GOD_PHRASE, GOD_LIFTS, getGodMode, isGodMode, godTag, godLimitAttr, godLimit, setGodMode, disableGodMode, openGodDialog } from './core/godmode.js';
export { refreshUnread } from './core/unread.js';
export { updateHeaderProfile, updateNav, renderHeader } from './core/header.js';
export { renderFooter, cookieNotice } from './core/footer.js';
export { checkNewBadges, celebrateBadges } from './core/badges.js';
export { initPage } from './core/init.js';
