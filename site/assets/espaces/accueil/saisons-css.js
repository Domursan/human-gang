// Feuilles de style des rendez-vous saisonniers de l'accueil et de la popup de l'Avent (chargées à la demande)
/*
 * Rôle : ajoute une seule fois les feuilles saisons.css, avent-popup.css (popup et paquet cadeau de l'Avent) et, si besoin,
 * assets/espaces/cartes/cartes-card.css (cartes). Utilisé par avent.js, avent-popup.js, avent-gift.js, saisons.js, anniv.js
 * et ss-unwrap.js (migration 096), pour ne pas toucher aux pages HTML.
 * Exporte : loadSeasonCss({ cards, popup }).
 */

/** Dossier de chaque feuille, relatif à ce module. */
const DOSSIER = { 'saisons.css': './', 'avent-popup.css': './', 'cartes-card.css': '../cartes/' };

/**
 * Ajoute une feuille de style si elle n'est pas déjà là.
 * @param {string} file Nom du fichier.
 */
function addCss(file) {
  if ([...document.styleSheets].some((s) => s.href && s.href.endsWith(`/${file}`))
    || document.querySelector(`link[data-season-css="${file}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL(`${DOSSIER[file]}${file}`, import.meta.url).href;
  l.dataset.seasonCss = file;
  document.head.append(l);
}

/**
 * Charge saisons.css ; avent-popup.css si opts.popup ; cartes-card.css si opts.cards.
 * @param {{cards?: boolean, popup?: boolean}} [opts]
 */
export function loadSeasonCss(opts = {}) {
  addCss('saisons.css');
  if (opts.popup) addCss('avent-popup.css');
  if (opts.cards) addCss('cartes-card.css');
}
