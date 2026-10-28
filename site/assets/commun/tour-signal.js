// ===== Humane Gang — Jeux à plusieurs : signal « à toi de jouer » =====
/*
 * Rôle : prévient le joueur quand son tour commence, dans tous les jeux à plusieurs (Uno, Loup-Garou, duels, plateaux) :
 *   petit son « Pièce arcade » (préférence « Son à toi de jouer », active par défaut) et, si l'onglet est en arrière-plan,
 *   titre de l'onglet préfixé « (À toi !) » jusqu'au retour sur la page.
 * Usage : const signal = creerSignalTour(); puis signal.maj(monTour) à chaque nouvel état ; signal.arreter() en quittant.
 *   Le premier appel ne sonne pas (ouverture de la page) : seul un passage de « pas mon tour » à « mon tour » prévient.
 * Dépendances : sound.js (playTurnSound).
 * Exporte : creerSignalTour.
 */
import { playTurnSound } from './sound.js';

const PREFIXE = '(À toi !) ';

/**
 * @returns {{ maj: (monTour: boolean) => void, arreter: () => void }}
 */
export function creerSignalTour() {
  let avant;            // undefined : aucun état reçu encore
  const nettoyer = () => {
    if (document.title.startsWith(PREFIXE)) document.title = document.title.slice(PREFIXE.length);
  };
  const visible = () => { if (!document.hidden) nettoyer(); };
  document.addEventListener('visibilitychange', visible);
  return {
    maj(monTour) {
      const premier = avant === undefined;
      const debut = !premier && monTour && !avant;
      avant = !!monTour;
      if (!monTour) { nettoyer(); return; }
      if (!debut) return;
      playTurnSound();
      if (document.hidden && !document.title.startsWith(PREFIXE)) document.title = PREFIXE + document.title;
    },
    arreter() {
      document.removeEventListener('visibilitychange', visible);
      nettoyer();
    },
  };
}
