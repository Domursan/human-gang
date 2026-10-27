/* ===== Intro quotidienne (page /pages/compte/accueil.html) =====
   Script classique (pas un module) chargé AVANT accueil.js, dans l'en-tête de /pages/compte/accueil.html.
   Dépendances : localStorage uniquement (clés hg_site_settings, hg_intro_day, hg_storage_test, hg_intro_seen).
   Il n'exporte rien. */

/* Accueil : si l'intro n'a pas encore été jouée aujourd'hui sur cet appareil, on la joue d'abord (une fois par jour).
   Seulement si le stockage local fonctionne, sinon l'intro ne pourrait pas retenir son passage et tournerait en boucle. */
/* Intro désactivée dans les réglages : jamais de renvoi vers l'intro. */
var introOff = false;
try { var rg = JSON.parse(localStorage.getItem('hg_site_settings') || 'null'); introOff = !!(rg && rg.identite && rg.identite.intro_active === false); } catch (e) {}
try {
  var d = new Date(), t = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  localStorage.setItem('hg_storage_test', '1'); localStorage.removeItem('hg_storage_test');
  localStorage.removeItem('hg_intro_seen'); // ancienne clé (intro jouée une seule fois)
  if (!introOff && localStorage.getItem('hg_intro_day') !== t && !/[?&]nointro\b/.test(location.search)) location.replace('/index.html');
} catch (e) {}
