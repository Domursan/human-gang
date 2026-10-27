// ===== Humane Gang — secret des sept lettres cachées =====
/*
 * Rôle : cache une lettre du mot secret sur chacune des sept pages (lettre_1 … lettre_7). La lettre est presque
 * invisible, s'illumine au survol, à la tabulation et au toucher. Un clic lance une petite animation et signale la
 * lettre au serveur (qui dit « Lettre X sur 7 » et donne le badge à 7 sur 7).
 * Emplacement : le pied de page, commun à toutes les pages, après le texte de droits. Le pied est parfois reconstruit
 * par le socle : un observateur remet la lettre en place.
 * Page : toutes les pages (importé dynamiquement par site-boot.js) ; une page sans lettre ne fait rien.
 * Dépendances : eggs/api.js (eggFound), feuille assets/espaces/arcade/eggs.css (ajoutée ici).
 * Exporte : rien (effets de bord).
 */
import { eggFound } from './api.js';

/** Lettre cachée sur chaque page (nom du fichier sans .html) : numéro de la lettre et lettre. */
const LETTRES = {
  accueil: { n: 1, lettre: 'S' },
  cartes: { n: 2, lettre: 'E' },
  irl: { n: 3, lettre: 'C' },
  historique: { n: 4, lettre: 'R' },
  membre: { n: 5, lettre: 'E' },
  aide: { n: 6, lettre: 'T' },
  'secret-santa': { n: 7, lettre: 'S' },
};

/** Nom de la page courante, sans chemin ni extension (« accueil » pour /pages/compte/accueil.html). */
const pageCourante = () => location.pathname.split('/').pop().replace(/\.html$/, '');

/**
 * Ajoute la feuille de style des secrets (une seule fois).
 * Le chemin est relatif à ce module, donc il marche sous /human-gang/ comme dans les tests.
 */
function ajouteStyle() {
  if (document.querySelector('link[data-eggs-css], link[data-eggs]')) return; // une seule balise pour eggs.css (core.js la pose aussi)
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./eggs.css', import.meta.url).href;
  l.dataset.eggsCss = '';
  document.head.append(l);
}

/**
 * Pose la lettre dans le pied de page (juste après le bloc de droits) si elle n'y est pas. Sans effet tant que le pied n'est pas rendu.
 * @param {{ n: number, lettre: string }} info lettre de la page courante
 */
function pose(info) {
  if (document.querySelector('.lettre-secret')) return;
  const cible = document.querySelector('.site-footer .container > div:first-child');
  if (!cible) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lettre-secret';
  b.textContent = info.lettre;
  b.setAttribute('aria-label', 'Un secret ?');
  b.dataset.lettre = String(info.n);
  b.addEventListener('click', () => trouve(b, info.n));
  cible.after(b); // à côté du texte de droits, sans s'y mêler (le texte de copyright reste intact)
}

/**
 * Clic sur la lettre : petite animation, puis signalement au serveur.
 * @param {HTMLElement} b la lettre cliquée
 * @param {number} n numéro de la lettre (1 à 7)
 */
function trouve(b, n) {
  b.classList.remove('trouvee');
  void b.offsetWidth; // redémarre l'animation si on clique à nouveau
  b.classList.add('trouvee');
  eggFound(`lettre_${n}`);
}

const info = LETTRES[pageCourante()];
if (info && document.body) {
  ajouteStyle();
  pose(info);
  // Le pied de page est reconstruit par le socle (changement de profil, rendu tardif) : on remet la lettre.
  let attente = false;
  new MutationObserver(() => {
    if (attente) return;
    attente = true;
    requestAnimationFrame(() => { attente = false; pose(info); });
  }).observe(document.body, { childList: true, subtree: true });
}
