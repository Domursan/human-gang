// ===== Humane Gang — feuilles de style des rendez-vous saisonniers (chargées à la demande) =====
/*
 * Rôle : ajoute une seule fois les feuilles assets/css/saisons.css et, si besoin, assets/css/cartes-card.css (cartes).
 * Utilisé par avent.js, saisons.js, anniv.js et ss-unwrap.js (migration 096), pour ne pas toucher aux pages HTML.
 * Exporte : loadSeasonCss({ cards }).
 */

/**
 * Ajoute une feuille de style si elle n'est pas déjà là.
 * @param {string} file Nom du fichier dans assets/css.
 */
/** Dossier de chaque feuille, relatif à ce module. */
const DOSSIER = { 'saisons.css': './', 'cartes-card.css': '../cartes/' };

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
 * Charge saisons.css (et cartes-card.css si opts.cards).
 * @param {{cards?: boolean}} [opts]
 */
export function loadSeasonCss(opts = {}) {
  addCss('saisons.css');
  if (opts.cards) addCss('cartes-card.css');
}
