// =====================================================================
// Comptes admin : fermeture de la fiche (bouton « Fermer la fiche », touche Échap).
// Dépendances : state.js (A, pour savoir si une fiche est ouverte).
// Exporte : closeDetail. Le gestionnaire Échap est branché dès le chargement du module.
// =====================================================================
import { A } from './state.js';

/** Quitte la fiche : l'URL revient à la liste ; la sous-section remet la zone à zéro (fiche.js). */
export function closeDetail() {
  location.hash = '#place/comptes';
}

// Échap ferme la fiche, sauf si une boîte de dialogue est ouverte (Échap sert alors à la fermer)
// ou si un autre gestionnaire a déjà traité la touche.
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || !A.uid || ev.defaultPrevented) return;
  if (document.querySelector('dialog[open]')) return;
  ev.preventDefault();
  closeDetail();
});
