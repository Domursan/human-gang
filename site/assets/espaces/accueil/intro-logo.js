/* ===== Logo de l'intro (page /index.html) =====
   Script classique, chargé juste après le bloc du logo dans /index.html. Il ne fait que changer la source de l'image
   #logo-img. Il ne lit que le localStorage (hg_theme, hg_prefs, hg_site_settings) et n'exporte rien. */

/* Logo du thème actif (cache posé par les autres pages), sinon le logo par défaut déjà préchargé.
   Préférence « Thème spécial » coupée (hg_prefs.special = false) : toujours le logo par défaut. */
try {
  var t = JSON.parse(localStorage.getItem('hg_theme') || 'null'), pr = JSON.parse(localStorage.getItem('hg_prefs') || 'null');
  if (pr && pr.special === false) t = null;
  if (t && typeof t.logo_url === 'string' && /^(https:\/\/|assets\/)/.test(t.logo_url)) document.getElementById('logo-img').src = t.logo_url;
  var rg = JSON.parse(localStorage.getItem('hg_site_settings') || 'null'), lu = rg && rg.identite && rg.identite.logo_url;
  if (!(t && t.logo_url) && typeof lu === 'string' && /^(https:\/\/|assets\/)/.test(lu)) document.getElementById('logo-img').src = lu;
} catch (e) {}
