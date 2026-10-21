/* Réglage « Intro du site » désactivé (cache des réglages) : accueil direct, sans boucle avec intro-daily.js. */
try {
  var rg = JSON.parse(localStorage.getItem('hg_site_settings') || 'null');
  if (rg && rg.identite && rg.identite.intro_active === false && !/[?&]nointro\b/.test(location.search)) location.replace('accueil.html');
} catch (e) {}
/* Intro déjà vue aujourd'hui : on file directement à l'accueil, avant tout rendu (l'intro se rejoue une fois par jour). */
try {
  var d = new Date(), t = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  if (localStorage.getItem('hg_intro_day') === t) location.replace('accueil.html');
} catch (e) {}
