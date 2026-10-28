// Interface commune : notifications (toasts) et son discret sur les boutons principaux.
/*
 * Rôle : affiche de petits messages temporaires en bas de l'écran (« toasts ») et ajoute un clic
 * sonore discret sur tous les boutons principaux du site.
 * Page : toutes les pages.
 * Dépendances : sound.js (playSound), util.js ($).
 * Exporte : toast.
 */
import { playSound } from '../sound.js';
import { $ } from './util.js';

/* ---------- Toasts ---------- */

/**
 * Conteneur des notifications. Créé dès le chargement de la page : la zone « live » existe déjà,
 * donc les messages qu'on y ajoute sont annoncés par les lecteurs d'écran.
 * @returns {HTMLElement} Le conteneur (créé s'il n'existe pas).
 */
function toastBox() {
  let box = $('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  return box;
}
/**
 * Affiche un message temporaire (4,5 secondes). Un son est joué selon le type.
 * @param {string} msg Texte affiché (jamais interprété comme HTML).
 * @param {'ok'|'success'|'error'|''} [type=''] Type : 'ok' ou 'success' (son de succès), 'error' (alerte annoncée tout de suite).
 * @param {string} [classe=''] Classe ajoutée au message (ex. « egg-toast » : le message ne bloque pas les clics, voir eggs.css).
 */
export function toast(msg, type = '', classe = '') {
  const box = toastBox();
  const t = document.createElement('div');
  t.className = `toast ${type} ${classe}`.trim(); t.textContent = msg;
  if (type === 'error') t.setAttribute('role', 'alert'); // les erreurs sont annoncées tout de suite
  box.append(t);
  if (type === 'ok' || type === 'success') playSound('success');
  else if (type === 'error') playSound('error');
  setTimeout(() => t.remove(), 4500);
}
// Le script est chargé comme module différé : le body existe déjà, on crée le conteneur tout de suite.
if (document.body) toastBox();

/* ---------- Son des boutons principaux ---------- */

// Son discret sur les boutons principaux (délégation) : un seul écouteur pour toute la page, en phase de capture
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('.btn-primary') : null;
  if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') playSound('click');
}, true);
