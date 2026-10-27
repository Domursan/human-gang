// ===== Humane Gang — Blackjack : encart de fin (plateaux/jeux/blackjack/fin.js) =====
/*
 * Rôle : une carte par joueur dans l'écran de fin : rang, pseudo dans sa couleur, jetons finaux et écart avec les jetons
 *   de départ. Le classement, les Paillettes et les badges sont dans l'écran de fin commun (../../vues/fin.js).
 * Dépendances : core.js (esc, initials).
 * Exporte : recap(etat, contenus) -> HTML (chaîne).
 *   etat.joueurs[i] = { pseudo, couleur, invite, rang, parti, etat: { jetons } } ; etat.partie.options.jetons = départ.
 */
import { esc, initials } from '../../../../commun/core.js';

/** Couleur de profil sûre (sinon texte clair). */
const couleurDe = (j) => (/^#[0-9a-f]{6}$/i.test(j?.couleur || '') && !j?.invite ? j.couleur : '#F2EFEA');

/** Rang en français : 1er, 2e… */
const rangTexte = (r) => (r === 1 ? '1er' : `${r}e`);

/** Nombre de jetons, format suisse, avec signe pour un écart. */
const jetons = (n) => Math.round(Number(n) || 0).toLocaleString('fr-CH');

/**
 * Encart de fin : une carte par joueur, classée par rang (puis jetons).
 * @param {object} etat état final de la partie (plat.etat).
 * @returns {string} HTML.
 */
export function recap(etat) {
  const depart = Number(etat?.partie?.options?.jetons) || 1000;
  const joueurs = [...(etat?.joueurs || [])].sort((a, b) => (a.rang ?? 99) - (b.rang ?? 99)
    || (Number(b.etat?.jetons) || 0) - (Number(a.etat?.jetons) || 0));
  if (!joueurs.length) return '';
  const cartes = joueurs.map((j, i) => {
    const total = Number(j.etat?.jetons) || 0;
    const ecart = total - depart;
    const rang = j.rang ?? i + 1;
    const signe = ecart > 0 ? `+${jetons(ecart)}` : ecart < 0 ? `−${jetons(-ecart)}` : '±0';
    return `<li class="bf-carte${rang === 1 ? ' is-gagnant' : ''}${j.parti ? ' is-parti' : ''}">
        <span class="bf-rang">${esc(rangTexte(rang))}${rang === 1 ? ' · Gagnant' : ''}</span>
        <span class="bf-disque" style="background:${esc(couleurDe(j))}" aria-hidden="true">${esc(initials(j.pseudo || '?'))}</span>
        <strong class="bf-pseudo">${esc(j.pseudo || '?')}${j.invite ? ' <span class="bf-etiquette">invité</span>' : ''}</strong>
        <span class="bf-jetons"><span class="visually-hidden">Jetons finaux : </span>${esc(jetons(total))}</span>
        <span class="bf-ecart small">${esc(signe)} depuis le départ (${esc(jetons(depart))})</span>
      </li>`;
  }).join('');
  return `<section class="bf-bloc" aria-labelledby="bf-fin-titre">
    <h2 id="bf-fin-titre" class="bf-bloc-titre">Les jetons de chacun</h2>
    <ol class="bf-grille">${cartes}</ol>
  </section>`;
}
