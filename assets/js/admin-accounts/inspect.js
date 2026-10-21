// Comptes admin : fermeture de la fiche (bouton « Fermer la fiche », touche Échap).
import { A } from './state.js';

/** Quitte la fiche : l'URL revient à la liste ; la sous-section remet la zone à zéro (fiche.js). */
export function closeDetail() {
  location.hash = '#membres/comptes';
}

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || !A.uid || ev.defaultPrevented) return;
  if (document.querySelector('dialog[open]')) return;
  ev.preventDefault();
  closeDetail();
});
