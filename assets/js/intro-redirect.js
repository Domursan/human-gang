/* Intro déjà vue aujourd'hui : on file directement à l'accueil, avant tout rendu (l'intro se rejoue une fois par jour). */
try {
  var d = new Date(), t = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  if (localStorage.getItem('hg_intro_day') === t) location.replace('accueil.html');
} catch (e) {}
