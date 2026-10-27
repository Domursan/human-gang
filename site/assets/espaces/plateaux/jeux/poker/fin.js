// ===== Humane Gang — Poker : encart de fin (plateaux/jeux/poker/fin.js) =====
/*
 * Rôle : une carte par joueur dans l'écran de fin : rang (le dernier qui reste est 1er, puis l'ordre d'élimination),
 *   pseudo dans sa couleur, jetons finaux et mention « éliminé » ou « en lice ». Le classement, les Paillettes et les badges
 *   sont dans l'écran de fin commun (../../vues/fin.js).
 * Dépendances : core.js (esc, initials).
 * Exporte : recap(etat, contenus) -> HTML (chaîne).
 *   etat.joueurs[i] = { pseudo, couleur, invite, rang, elimine, parti, etat: { jetons } }.
 */
import { esc, initials } from '../../../core.js';

/** Couleur de profil sûre (sinon texte clair). */
const couleurDe = (j) => (/^#[0-9a-f]{6}$/i.test(j?.couleur || '') && !j?.invite ? j.couleur : '#F2EFEA');

/** Rang en français : 1er, 2e… */
const rangTexte = (r) => (r === 1 ? '1er' : `${r}e`);

/** Nombre de jetons, format suisse. */
const jetons = (n) => Math.round(Number(n) || 0).toLocaleString('fr-CH');

/**
 * Encart de fin : une carte par joueur, classée par rang.
 * @param {object} etat état final de la partie (plat.etat).
 * @returns {string} HTML.
 */
export function recap(etat) {
  const joueurs = [...(etat?.joueurs || [])].sort((a, b) => (a.rang ?? 99) - (b.rang ?? 99)
    || (Number(b.etat?.jetons) || 0) - (Number(a.etat?.jetons) || 0));
  if (!joueurs.length) return '';
  const cartes = joueurs.map((j, i) => {
    const rang = j.rang ?? i + 1;
    const etiquette = rang === 1 ? 'Gagnant' : j.elimine ? 'Éliminé' : 'En lice';
    return `<li class="pf-carte${rang === 1 ? ' is-gagnant' : ''}${j.elimine ? ' is-elimine' : ''}${j.parti ? ' is-parti' : ''}">
        <span class="pf-rang">${esc(rangTexte(rang))} · ${esc(etiquette)}</span>
        <span class="pf-disque" style="background:${esc(couleurDe(j))}" aria-hidden="true">${esc(initials(j.pseudo || '?'))}</span>
        <strong class="pf-pseudo">${esc(j.pseudo || '?')}${j.invite ? ' <span class="pf-etiquette">invité</span>' : ''}</strong>
        <span class="pf-jetons"><span class="visually-hidden">Jetons finaux : </span>${esc(jetons(j.etat?.jetons))}</span>
        <span class="pf-muet small">jetons à la fin</span>
      </li>`;
  }).join('');
  return `<section class="pf-bloc" aria-labelledby="pf-fin-titre">
    <h2 id="pf-fin-titre" class="pf-bloc-titre">Les joueurs</h2>
    <ol class="pf-grille">${cartes}</ol>
  </section>`;
}
