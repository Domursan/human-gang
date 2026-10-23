// ===== Humane Gang — icônes des ludothèque (dessinées pour le gang, jamais de logo officiel) =====
/*
 * Rôle : petites icônes à trait (SVG) des jeux du gang. La liste des clés est la même que hg_ludo_icons() en base
 *   (migration 088) : une icône inconnue retombe sur la manette.
 * Pages : ludotheque.html, fiche-jeu.html, gartic.html, et l'admin (Ludothèque).
 * Exporte : GAME_ICONS (clé -> libellé), gameIcon, gameColor.
 */

/** Tracés des icônes (viewBox 24 × 24, trait). */
const PATHS = {
  couronne: '<path d="M4 18h16l-1-10-4 4-3-6-3 6-4-4z"/>',
  casque: '<path d="M6 12a6 6 0 0 1 12 0v6H6z"/><path d="M9 12h6v3H9z"/>',
  bloc: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  epee: '<path d="M14 4h6v6L9 21l-2-2-2 2-2-2 2-2-2-2z"/><path d="M12 12l-4-4"/>',
  navire: '<path d="M3 16l2 4h14l2-4z"/><path d="M12 3v13M12 4l6 9h-6"/>',
  engrenage: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  crayon: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  cartes: '<rect x="3" y="6" width="11" height="15" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v13"/>',
  manette: '<path d="M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6L14 15h-4l-1 .6A4 4 0 0 1 2 13v-1a4 4 0 0 1 4-4z"/><path d="M7 11v3M5.5 12.5h3M16 12h.01M18 13.5h.01"/>',
  de: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h.01M15 15h.01M15 9h.01M9 15h.01M12 12h.01"/>',
  ampoule: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>',
  chateau: '<path d="M4 21V9h3V6h2v3h2V6h2v3h2V6h2v3h3v12z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/>',
  etoile: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
};

/** Libellé de chaque icône (choix dans l'admin). */
export const GAME_ICONS = {
  couronne: 'Couronne', casque: 'Casque', bloc: 'Bloc', epee: 'Épée', navire: 'Navire', engrenage: 'Engrenage',
  crayon: 'Crayon', cartes: 'Cartes', manette: 'Manette', de: 'Dé', ampoule: 'Ampoule', chateau: 'Château', etoile: 'Étoile',
};

/**
 * SVG d'une icône de jeu (décoratif : aria-hidden).
 * @param {string} key clé de l'icône
 * @param {number} [size] taille en pixels
 * @returns {string}
 */
export function gameIcon(key, size = 26) {
  const d = PATHS[key] || PATHS.manette;
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

/** Couleur d'un jeu (#RRVVBB vérifiée), sinon l'ardoise du thème. */
export const gameColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : 'var(--slate)');
