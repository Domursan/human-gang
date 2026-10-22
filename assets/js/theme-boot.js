/* Mode d'affichage (sombre, clair, daltonien) posé avant le premier rendu.
   Fichier externe (et non script inline) pour que la Content-Security-Policy n'ait pas besoin de 'unsafe-inline'. */
/*
 * Rôle : script classique (pas un module) chargé dans <head>, AVANT le rendu. Il lit le mode d'affichage
 * dans localStorage (« hg_prefs ») et le pose sur <html> pour éviter un flash de mauvaises couleurs.
 * Ne fait que cela : le thème complet et les préférences sont appliqués ensuite par core/theme.js.
 * Si le mode est absent ou inconnu, le mode sombre est utilisé. Une erreur est ignorée (rien à afficher de mieux).
 * Dépendances : aucune. Clé lue : « hg_prefs » (sous-champ mode).
 */
try {
  var p = JSON.parse(localStorage.getItem('hg_prefs') || '{}'), r = document.documentElement;
  var m = { clair: 1, daltonien: 1 }[p.mode] ? p.mode : 'sombre';
  r.dataset.mode = m;
  r.style.colorScheme = m === 'clair' ? 'light' : 'dark';
} catch (e) {}
