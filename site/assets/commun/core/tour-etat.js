// ===== Humane Gang — état de la visite guidée (sans le code de la visite) =====
/*
 * Rôle : dire si la visite guidée peut se lancer ou proposer son bandeau pour un profil. Ce petit module est chargé
 * par l'accueil ; le code de la visite (core/tour.js, bulles et étapes) n'est chargé que si une visite est due.
 * Page : accueil.js (décide si tour.js se charge), tour.js (ré-exporte ces noms).
 * Dépendances : aucune.
 * Exporte : TOUR_ANCIEN, tourState.
 */

/** Date posée par la migration 094 pour les membres inscrits avant la visite (bandeau au lieu de la visite). */
export const TOUR_ANCIEN = '1970-01-01';

/**
 * État de la visite pour un profil.
 * - 'jamais' : jamais vue (tour_done_at null) → visite automatique ;
 * - 'ancien' : membre inscrit avant la visite → bandeau proposé une fois ;
 * - 'vue' : déjà vue ou passée ;
 * - 'inconnu' : colonne absente (migration pas encore appliquée) → rien d'automatique.
 * @param {object|null} p Profil (ligne hg_profiles).
 * @returns {'jamais'|'ancien'|'vue'|'inconnu'}
 */
export function tourState(p) {
  if (!p || !('tour_done_at' in p)) return 'inconnu';
  if (p.tour_done_at === null) return 'jamais';
  return String(p.tour_done_at).startsWith(TOUR_ANCIEN) ? 'ancien' : 'vue';
}
