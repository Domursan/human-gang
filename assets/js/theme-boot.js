/* Mode d'affichage (sombre, clair, daltonien) posé avant le premier rendu.
   Fichier externe (et non script inline) pour que la Content-Security-Policy n'ait pas besoin de 'unsafe-inline'. */
try {
  var p = JSON.parse(localStorage.getItem('hg_prefs') || '{}'), r = document.documentElement;
  var m = { clair: 1, daltonien: 1 }[p.mode] ? p.mode : 'sombre';
  r.dataset.mode = m;
  r.style.colorScheme = m === 'clair' ? 'light' : 'dark';
} catch (e) {}
