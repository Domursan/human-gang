// Chargement du thème depuis la base (hg_settings.theme + hg_themes), choix du thème du jour et mise en cache.
import { sb } from './supabase.js';
import { pickTheme } from './theme-calc.js';
import { commitSiteTheme, getActiveTheme } from './theme.js';

let _loading = null;

/** Charge le réglage + les thèmes, choisit le thème du jour et l'applique (mis en cache pour le chargement suivant). */
export function applyTheme({ force = false } = {}) {
  if (_loading && !force) return _loading;
  _loading = (async () => {
    try {
      const [s, t] = await Promise.all([
        sb.from('hg_settings').select('value').eq('key', 'theme').maybeSingle(),
        sb.from('hg_themes').select('*'),
      ]);
      if (t.error) throw t.error;
      const setting = s.data?.value ?? { mode: 'auto', forced_slug: null };
      const themes = t.data ?? [];
      const chosen = pickTheme(themes, setting);
      commitSiteTheme({ setting, themes, chosen });
      try { localStorage.setItem('hg_theme', JSON.stringify(chosen)); localStorage.removeItem('hg_season'); } catch {}
      return getActiveTheme();
    } catch (e) {
      console.warn('[thème]', e);
      return getActiveTheme();
    }
  })();
  return _loading;
}

/* Compatibilité avec l'ancien système saisonnier (déprécié : utiliser applyTheme / getActiveTheme) */
export const applySeason = applyTheme;
export function autoSeason() { return getActiveTheme()?.slug || 'classique'; }
