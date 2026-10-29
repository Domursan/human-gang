// ===== Humane Gang — Duels : effets de fin partagés (Dames, Échecs, Morpion) =====
/**
 * Rôle : quand un duel vu en direct se termine, joue le son de fin, fait briller le gagnant sur l'écran de fin
 *   (vues/fin.js), puis affiche un bandeau bref au milieu de la page et des confettis pour le gagnant.
 *   Seulement si la table du jeu a reçu un état « en cours » dans cette page (pas en ouvrant un duel déjà fini).
 *   Mouvement réduit, préférence « effets » coupée ou réglage calme des duels : pas d'animation, le son reste.
 * Dépendances : core.js (motionAllowed), ../../../commun/sons-jeux.js (jouerSonJeu).
 * Exporte : vuEnCours(partie), effetsFinDuel(root, e, { jeu, son(issue), titre(issue, e) }).
 *   issue = 'gagnant' | 'perdant' | 'nulle' | 'spectateur' (vue par moi).
 */
import { motionAllowed } from '../../../commun/core.js';
import { jouerSonJeu } from '../../../commun/sons-jeux.js';

/** Parties (ids) dont une table a reçu un état « en cours » dans cette page. */
const EN_COURS = new Set();
const COULEURS = ['#D93A3F', '#F2B705', '#E2C77E', '#159946', '#2B5AE2', '#4E2398'];

/** À appeler par la table à chaque état : retient les parties vues en cours. */
export function vuEnCours(p) {
  if (p?.statut === 'en_cours' && p.id) EN_COURS.add(p.id);
}

/** Feuille de style des effets, ajoutée une seule fois. */
function styles() {
  if (document.getElementById('duels-fin-fx-css')) return;
  const s = document.createElement('style');
  s.id = 'duels-fin-fx-css';
  s.textContent = `
.duels-finfx-brille { animation: duels-finfx-pouls 1.2s ease-in-out 4; border-radius: 14px; }
@keyframes duels-finfx-pouls { 50% { box-shadow: 0 0 0 5px #E2C77E, 0 0 36px rgba(226, 199, 126, .85); } }
.duels-finfx-ban { position: fixed; left: 50%; top: 72%; transform: translate(-50%, -50%) scale(.5); opacity: 0; z-index: 9000;
  pointer-events: none; white-space: nowrap; font: 400 clamp(30px, 5vw, 56px) 'Archivo Black', Inter, sans-serif; color: #fff;
  text-shadow: 0 4px 0 rgba(0, 0, 0, .6), 0 0 30px rgba(226, 199, 126, .9); animation: duels-finfx-ban 2.2s cubic-bezier(.2, 1.4, .4, 1) forwards; }
.duels-finfx-ban small { display: block; text-align: center; font: 700 15px Inter, system-ui, sans-serif; letter-spacing: .1em; text-transform: uppercase; }
@keyframes duels-finfx-ban { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.5) rotate(-6deg); }
  20% { opacity: 1; transform: translate(-50%, -50%) scale(1.06) rotate(-2deg); } 35% { transform: translate(-50%, -50%) scale(1) rotate(-2deg); }
  85% { opacity: 1; } 100% { opacity: 0; } }
.duels-finfx-conf { position: fixed; top: -10px; width: 8px; height: 14px; z-index: 8999; pointer-events: none; animation: duels-finfx-tombe linear forwards; }
@keyframes duels-finfx-tombe { to { transform: translateY(105vh) rotate(720deg); } }
@media (prefers-reduced-motion: reduce) { .duels-finfx-brille, .duels-finfx-ban, .duels-finfx-conf { animation: none; display: none; } }`;
  document.head.append(s);
}

/** Bandeau fixe au milieu de la page (sans clic, retiré après 2,3 s). Textes posés en textContent. */
function bandeau(titre, sous) {
  const b = document.createElement('div');
  b.className = 'duels-finfx-ban';
  b.setAttribute('aria-hidden', 'true');
  b.append(titre);
  if (sous) { const s = document.createElement('small'); s.textContent = sous; b.append(s); }
  document.body.append(b);
  setTimeout(() => b.remove(), 2300);
}

/** Confettis : 70 rectangles qui tombent, retirés après 4 s. */
function confettis() {
  for (let i = 0; i < 70; i++) {
    const d = document.createElement('i');
    d.className = 'duels-finfx-conf';
    d.setAttribute('aria-hidden', 'true');
    d.style.left = `${Math.random() * 100}vw`;
    d.style.background = COULEURS[i % COULEURS.length];
    d.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
    d.style.animationDelay = `${Math.random() * 0.5}s`;
    document.body.append(d);
    setTimeout(() => d.remove(), 4000);
  }
}

/**
 * Effets de fin d'un duel vu en direct.
 * @param {HTMLElement} root écran de fin (vues/fin.js).
 * @param {object} e état du duel terminé.
 * @param {{jeu: string, son: (issue: string) => number|null, titre: (issue: string, e: object) => [string, string]|null}} o
 */
export function effetsFinDuel(root, e, o) {
  const p = e.partie || {};
  if (p.statut !== 'terminee' || !EN_COURS.has(p.id)) return;
  EN_COURS.delete(p.id);
  const js = e.joueurs || [];
  const gagnant = js.find((j) => j.gagne) || js.find((j) => j.user_id === p.vainqueur) || null;
  const moiJoue = !!e.moi?.joue;
  const issue = !moiJoue ? 'spectateur' : !gagnant ? 'nulle' : gagnant.user_id === e.moi.user_id ? 'gagnant' : 'perdant';
  const n = o.son(issue);
  if (n) jouerSonJeu(o.jeu, n);
  if (!motionAllowed() || document.body.classList.contains('duels-calme')) return;
  styles();
  const g = root.querySelector('.duels-fin-joueur.is-gagnant');
  if (g) { g.classList.add('duels-finfx-brille'); setTimeout(() => g.classList.remove('duels-finfx-brille'), 4800); }
  const t = o.titre(issue, e);
  setTimeout(() => {
    if (t) bandeau(t[0], t[1]);
    if (issue === 'gagnant') confettis();
  }, 300);
}
