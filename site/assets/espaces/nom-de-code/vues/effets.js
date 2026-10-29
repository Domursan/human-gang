// ===== Humane Gang — Nom de code : effets visuels et sonores des vues (table et fin) =====
/*
 * Rôle : fabrique les calques d'effet posés au-dessus de la page (bannière « Au tour des… », indice en grand,
 *   flash rouge, confettis, secousse, brillance du titre) et joue les sons de la partie (maquette validée, numéros 1 à 5).
 *   Les calques sont sur <body>, sans interaction (pointer-events:none), retirés après quelques secondes.
 *   Le CSS est dans assets/espaces/nom-de-code/nom-de-code.css (section « Effets »), classes ndc-fx-*.
 *   Rien n'est animé quand le mouvement est réduit ou que les effets sont coupés (motionAllowed) : l'écran reste tel quel.
 *   Les sons ne dépendent que de la préférence « Sons des jeux » (sons-jeux.js).
 * Dépendances : commun/core.js (esc, motionAllowed), commun/sons-jeux.js (jouerSonJeu).
 * Exporte : animationsOk, son, banniere, grandIndice, flashRouge, secouer, confettis, brille.
 */
import { esc, motionAllowed } from '../../../commun/core.js';
import { jouerSonJeu } from '../../../commun/sons-jeux.js';

/** Vrai quand les animations sont jouées (préférence « effets » et pas de mouvement réduit). */
export const animationsOk = () => motionAllowed();

/**
 * Joue un son de Nom de code (numéros de la maquette : 1 indice donné, 2 carte de l'équipe, 3 carte passante,
 * 4 assassin, 5 victoire).
 * @param {number} n numéro du son.
 */
export function son(n) {
  jouerSonJeu('nom-de-code', n);
}

/**
 * Ajoute un calque au corps de la page et le retire après ms.
 * @returns {HTMLElement} le calque.
 */
function calque(classes, html, ms) {
  const d = document.createElement('div');
  d.className = classes;
  d.innerHTML = html;
  document.body.append(d);
  setTimeout(() => d.remove(), ms);
  return d;
}

/**
 * Bannière centrée de 2,5 s (« Au tour des Roses », « Victoire des Jaunes »…).
 * @param {string} texte titre de la bannière.
 * @param {string} sous ligne plus petite sous le titre.
 * @param {'jaune'|'rose'|'rouge'} variante couleur de fond.
 */
export function banniere(texte, sous, variante) {
  if (!animationsOk()) return;
  calque(`ndc-fx-banniere ${variante}`, `${esc(texte)}<small>${esc(sous)}</small>`, 2500);
}

/**
 * Indice de l'espion affiché en grand, au centre, pendant 2,7 s.
 * @param {string} mot le mot donné.
 * @param {string} essais libellé des essais (« essais restants : 3 », « illimité »).
 */
export function grandIndice(mot, essais) {
  if (!animationsOk()) return;
  calque('ndc-fx-grand', `<div><small>Indice de l’espion</small><b>${esc(mot)}</b><small>${esc(essais)}</small></div>`, 2700);
}

/** Flash rouge plein écran (1 s), pour l'assassin. */
export function flashRouge() {
  if (!animationsOk()) return;
  calque('ndc-fx-voile ndc-fx-flash', '', 1000);
}

/**
 * Secoue un élément (1 s), pour l'assassin.
 * @param {HTMLElement|null} el élément à secouer.
 */
export function secouer(el) {
  if (!animationsOk() || !el) return;
  el.classList.add('ndc-fx-choc');
  setTimeout(() => el.classList.remove('ndc-fx-choc'), 1000);
}

/** Confettis aux couleurs des équipes (70 morceaux, chacun tombe en moins de 3 s). */
export function confettis() {
  if (!animationsOk()) return;
  const couleurs = ['#F2B71F', '#E8559A', '#FFD970', '#FF9CCB', '#E2C77E', '#FFFFFF'];
  for (let i = 0; i < 70; i += 1) {
    const d = document.createElement('i');
    d.className = 'ndc-fx-conf';
    d.style.left = `${(Math.random() * 100).toFixed(1)}vw`;
    d.style.background = couleurs[i % couleurs.length];
    d.style.animationDuration = `${(1.4 + Math.random()).toFixed(2)}s`;
    d.style.animationDelay = `${(Math.random() * 0.4).toFixed(2)}s`;
    document.body.append(d);
    setTimeout(() => d.remove(), 2900);
  }
}

/**
 * Fait briller un titre (2 × 1,2 s).
 * @param {HTMLElement|null} el titre.
 */
export function brille(el) {
  if (!animationsOk() || !el) return;
  el.classList.add('ndc-fx-brille');
  setTimeout(() => el.classList.remove('ndc-fx-brille'), 2500);
}
