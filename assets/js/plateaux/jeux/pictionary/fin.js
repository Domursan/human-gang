// ===== Humane Gang — Pictionary : encart de fin (plateaux/jeux/pictionary/fin.js) =====
/*
 * Rôle : HTML de l'encart de fin de Pictionary : le classement aux points de chacun (le classement et les
 *   récompenses communs sont dans l'écran de fin partagé, vues/fin.js).
 * Dépendances : core.js (esc), ../../vues/commun.js (avatarHtml, pseudoHtml).
 * Exporte : recap(etat, contenus) -> HTML (chaîne).
 *   etat.joueurs[i].etat.points : points de chaque joueur ; joueurs triés du plus au moins de points.
 */
import { esc } from '../../../core.js';
import { avatarHtml, pseudoHtml } from '../../vues/commun.js';

/**
 * Encart de fin : points de chaque joueur, du plus au moins.
 * @param {object} etat état final de la partie (plat.etat).
 * @returns {string} HTML.
 */
export function recap(etat) {
  const joueurs = (etat?.joueurs || [])
    .filter((j) => !j.parti)
    .map((j) => ({ ...j, points: Number(j.etat?.points) || 0 }))
    .sort((a, b) => b.points - a.points || (Number(a.place) || 0) - (Number(b.place) || 0));
  const lignes = joueurs.map((j, i) => `<li class="pi-fin-ligne">
      <span class="pi-rang" aria-hidden="true">${i + 1}</span>
      ${avatarHtml(j, 32)}
      <span class="pi-fin-nom">${pseudoHtml(j)}</span>
      <span class="pi-points"><span class="visually-hidden">Points : </span>${esc(j.points)} pt${j.points > 1 ? 's' : ''}</span>
    </li>`).join('');
  return `<section class="pi-fin" aria-labelledby="pi-fin-titre">
    <h2 id="pi-fin-titre" class="pi-bloc-titre">Points</h2>
    ${lignes ? `<ol class="pi-fin-liste">${lignes}</ol>` : '<p class="pi-vide small muted">Aucun point à afficher.</p>'}
  </section>`;
}
