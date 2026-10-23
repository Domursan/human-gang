// ===== Humane Gang — onglet « Question du jour » (J4) de la page Jeux =====
// Monte la question du jour complète (question, semaine, classement du mois) dans le panneau de l'onglet.
// Dépendances : ./jour-ui.js (affichage commun avec la tuile de l'accueil).
// Exporte : mount(panel, ctx).
import { mountDaily } from './jour-ui.js';

/**
 * Monte l'onglet.
 * @param {HTMLElement} panel Panneau vide de l'onglet.
 * @param {{sb: object, me: object, toast: Function, esc: Function}} ctx Contexte de la page Jeux.
 * @returns {Promise<void>}
 */
export async function mount(panel, { sb, me, toast, esc }) {
  const box = document.createElement('div');
  panel.append(box);
  await mountDaily(box, { sb, esc, toast, compact: false, meId: me?.id ?? null });
}
