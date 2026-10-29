/* Mode d'affichage (sombre, clair, daltonien) posé avant le premier rendu.
   Fichier externe (et non script inline) pour que la Content-Security-Policy n'ait pas besoin de 'unsafe-inline'. */
/*
 * Rôle : script classique (pas un module) chargé dans <head>, AVANT le rendu. Il lit le mode d'affichage
 * dans localStorage (« hg_prefs ») et le pose sur <html> pour éviter un flash de mauvaises couleurs.
 * Le thème complet et les préférences sont appliqués ensuite par core/theme.js.
 * Fait aussi l'anti-encadrement (voir plus bas) : chargé dans le <head> de toutes les pages, c'est le premier script exécuté.
 * Si le mode est absent ou inconnu, le mode sombre est utilisé. Une erreur est ignorée (rien à afficher de mieux).
 * Dépendances : aucune. Clé lue : « hg_prefs » (sous-champ mode).
 */
try {
  var p = JSON.parse(localStorage.getItem('hg_prefs') || '{}'), r = document.documentElement;
  var m = { clair: 1, daltonien: 1 }[p.mode] ? p.mode : 'sombre';
  r.dataset.mode = m;
  r.style.colorScheme = m === 'clair' ? 'light' : 'dark';
} catch (e) {}

/* Espace de la page (refonte Pixel Pop) : posé sur <html> en data-espace, il donne à chaque espace sa couleur de la
   traînée arc-en-ciel du logo (variable --c de base.css). Premier dossier ou nom de page reconnu, sinon « accueil ». */
(function () {
  var p = location.pathname, e = 'accueil';
  var t = [['/pages/admin/', 'admin'], ['/loup-garou', 'lg'], ['/secret-santa', 'ss'], ['/calendrier', 'calendrier'],
    ['/messages', 'messages'], ['/membre', 'compte'], ['/compte.html', 'compte'], ['/pages/cartes/', 'cartes'],
    ['/pages/jeux/', 'jeux'], ['/pages/irl/', 'irl'], ['/pages/infos/', 'infos']];
  for (var i = 0; i < t.length; i++) if (p.indexOf(t[i][0]) !== -1) { e = t[i][1]; break; }
  document.documentElement.setAttribute('data-espace', e);
})();

/* Traînée arc-en-ciel du logo au changement de page (refonte Pixel Pop) : classe px-arrivee sur <html> quand on arrive
   d'une autre page du site par un lien (pas au premier chargement, ni au rechargement, ni avec les effets coupés ou le
   mouvement réduit). Le dessin et l'animation sont dans base.css (html.px-arrivee::after) ; la classe est retirée ensuite. */
(function () {
  try {
    var r = document.documentElement, p = JSON.parse(localStorage.getItem('hg_prefs') || '{}');
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    var interne = document.referrer && document.referrer.indexOf(location.origin + '/') === 0;
    if (p.effects === false || !interne || (nav && nav.type !== 'navigate')) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    r.classList.add('px-arrivee');
    setTimeout(function () { r.classList.remove('px-arrivee'); }, 1200);
  } catch (e) {}
})();

/* Anti-encadrement (clickjacking) : GitHub Pages ne permet pas d'envoyer l'en-tête frame-ancestors, et la balise
   <meta> CSP l'ignore. Si la page est affichée dans un cadre d'un autre site, elle est masquée, rendue inerte,
   et le navigateur est invité à l'ouvrir en pleine fenêtre. Les cadres du même site restent permis (affiches dans l'Aide, simulateur de téléphone). */
(function () {
  if (window.top === window.self) return;
  var memeSite = false;
  try { memeSite = window.top.location.origin === window.location.origin; } catch (e) { memeSite = false; }
  if (memeSite) return;
  // Masquée et inerte : ni visible ni cliquable (inert ne peut pas être annulé par un élément enfant).
  document.documentElement.style.visibility = 'hidden';
  document.documentElement.inert = true;
  // Les navigateurs bloquent souvent cette redirection sans clic : la page reste alors masquée et inerte.
  try { window.top.location.replace(window.location.href); } catch (e) { /* navigation refusée */ }
})();
