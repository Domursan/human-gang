// Chargement du thème depuis la base (hg_settings.theme + hg_themes), choix du thème du jour et mise en cache.
/*
 * Rôle : lit le réglage du thème et la liste des thèmes en base, choisit le thème du jour, l'applique
 * et le garde dans localStorage pour la prochaine page.
 * Page : toutes les pages (init.js appelle applyTheme au démarrage ; badges.js s'en sert aussi).
 * Dépendances : supabase.js (requêtes), theme-calc.js (pickTheme), theme.js (application du thème).
 * Tables : hg_settings (clé 'theme'), hg_themes.
 * Stockage : localStorage « hg_theme » (thème choisi) ; la clé ancienne « hg_season » est supprimée.
 * Exporte : applyTheme.
 */
import { sb } from './supabase.js';
import { pickTheme } from './theme-calc.js';
import { commitSiteTheme, getActiveTheme } from './theme.js';

/** Promesse du chargement en cours ou terminé : on ne charge qu'une fois par page (sauf force). */
let _loading = null;

/**
 * Charge le réglage + les thèmes, choisit le thème du jour et l'applique (mis en cache pour le chargement suivant).
 * En cas d'erreur, le thème déjà affiché reste en place.
 * @param {{force?: boolean}} [options] force : relance le chargement même s'il a déjà eu lieu.
 * @returns {Promise<object>} Le thème actif.
 */
export function applyTheme({ force = false } = {}) {
  if (_loading && !force) return _loading;
  _loading = (async () => {
    try {
      const [s, t] = await Promise.all([
        sb.from('hg_settings').select('value').eq('key', 'theme').maybeSingle(),
        sb.from('hg_themes').select('*'),
      ]);
      if (t.error) throw t.error;
      // Pas de réglage en base : mode automatique (le thème suit le calendrier)
      const setting = s.data?.value ?? { mode: 'auto', forced_slug: null };
      const themes = t.data ?? [];
      const chosen = pickTheme(themes, setting);
      commitSiteTheme({ themes, chosen });
      // Mise en cache pour que la prochaine page s'affiche avec les bonnes couleurs dès le début
      try { localStorage.setItem('hg_theme', JSON.stringify(chosen)); localStorage.removeItem('hg_season'); } catch {}
      return getActiveTheme();
    } catch (e) {
      console.warn('[thème]', e);
      return getActiveTheme();
    }
  })();
  return _loading;
}
