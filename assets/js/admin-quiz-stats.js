// ===== Humane Gang — administration : Questions du gang, onglet « Réponses et statistiques » (en attente) =====
/**
 * Monte l'onglet « Réponses et statistiques » de la section Questions du gang dans son conteneur.
 * @param {HTMLElement} container Élément qui recevra l'onglet.
 */
export async function mountQuizStats(container) {
  if (!container) return;
  container.innerHTML = '<div class="empty">Bientôt</div>';
}
