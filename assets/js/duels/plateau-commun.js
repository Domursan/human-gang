// ===== Humane Gang — Duels : aide commune aux tables à cases (Échecs, Dames) =====
/*
 * Rôle : charge la feuille de style d'une table (assets/css/duels/<nom>.css) à son premier affichage. Le chemin part de
 *   ce module (et non de la page), pour fonctionner depuis duels.html comme depuis un banc de test.
 * Page : duels.html (les vues sont importées par vues/partie.js).
 * Dépendances : aucune.
 * Exporte : chargerCss.
 */

/**
 * Ajoute la feuille assets/css/duels/<nom>.css à la page, une seule fois.
 * @param {string} nom nom du fichier sans extension (ex. 'echecs').
 */
export function chargerCss(nom) {
  const url = new URL(`../../css/duels/${nom}.css`, import.meta.url);
  if (document.querySelector(`link[data-duels-css="${nom}"]`)) return;
  const lien = document.createElement('link');
  lien.rel = 'stylesheet';
  lien.href = url.href;
  lien.dataset.duelsCss = nom;
  document.head.append(lien);
}
