/* Logo du thème actif (cache posé par les autres pages), sinon le logo par défaut déjà préchargé.
   Préférence « Thème spécial » coupée (hg_prefs.special = false) : toujours le logo par défaut. */
try {
  var t = JSON.parse(localStorage.getItem('hg_theme') || 'null'), pr = JSON.parse(localStorage.getItem('hg_prefs') || 'null');
  if (pr && pr.special === false) t = null;
  if (t && typeof t.logo_url === 'string' && /^(https:\/\/|assets\/)/.test(t.logo_url)) document.getElementById('logo-img').src = t.logo_url;
} catch (e) {}
