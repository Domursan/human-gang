// ===== Humane Gang — Jeux de plateau : cartes à jouer en HTML (plateaux/jeux/cartes.js) =====
/*
 * Rôle : dessin des cartes du blackjack et du poker. Une carte est une chaîne de 2 caractères envoyée par le serveur :
 *   valeur (A 2 3 4 5 6 7 8 9 T J Q K, T = 10) puis couleur (S pique, H cœur, D carreau, C trèfle) ; ex. 'TH' = 10 de cœur.
 *   '??' (ou une carte cachée) = dos de carte au motif du site. Rouge pour cœur et carreau (la couleur ne porte pas seule le sens :
 *   le symbole et le nom de la carte sont écrits, et l'aria-label donne le nom complet).
 * Dépendances : core.js (esc).
 * Exporte : carteHtml(code, opts) -> HTML ; dosHtml(opts) -> HTML ; nomCarte(code) -> « Dame de cœur » ; estCarte(code).
 *   opts = { petite: boolean, cachee: boolean } ; petite = format réduit (sièges, cartes communes).
 */
import { esc } from '../../core.js';

const SYMBOLES = { S: '♠', H: '♥', D: '♦', C: '♣' };
const COULEURS = { S: 'pique', H: 'cœur', D: 'carreau', C: 'trèfle' };
const VALEURS = { A: 'As', K: 'Roi', Q: 'Dame', J: 'Valet', T: '10' };
const FORME = /^[AKQJT2-9][SHDC]$/;

/** Vrai si le code est une carte connue (2 caractères valides). */
export function estCarte(code) {
  return typeof code === 'string' && FORME.test(code);
}

/** Nom complet d'une carte, pour les lecteurs d'écran et le journal : « Dame de cœur », « 7 de trèfle ». */
export function nomCarte(code) {
  if (!estCarte(code)) return 'Carte cachée';
  const v = code[0];
  return `${VALEURS[v] || v} de ${COULEURS[code[1]]}`;
}

/**
 * Dos de carte (cachée, ou carte d'un adversaire non révélée).
 * @param {{ petite?: boolean }} [opts] format réduit.
 * @returns {string} HTML.
 */
export function dosHtml({ petite = false } = {}) {
  return `<span class="cd cd-dos${petite ? ' is-petite' : ''}" role="img" aria-label="Carte cachée"></span>`;
}

/**
 * Carte visible (ou dos si cachee, ou code inconnu).
 * @param {string} code deux caractères, ex. 'AS' (as de pique), 'TH' (10 de cœur), '??' (dos).
 * @param {{ petite?: boolean, cachee?: boolean }} [opts] format réduit ; cachee : dos quelle que soit la carte.
 * @returns {string} HTML.
 */
export function carteHtml(code, { petite = false, cachee = false } = {}) {
  if (cachee || !estCarte(code)) return dosHtml({ petite });
  const v = code[0];
  const c = code[1];
  const valeur = v === 'T' ? '10' : v;
  const rouge = c === 'H' || c === 'D';
  const sym = SYMBOLES[c];
  return `<span class="cd${petite ? ' is-petite' : ''}${rouge ? ' is-rouge' : ''}" role="img" aria-label="${esc(nomCarte(code))}">
      <span class="cd-coin" aria-hidden="true"><span class="cd-valeur">${esc(valeur)}</span><span class="cd-sym">${esc(sym)}</span></span>
      <span class="cd-centre" aria-hidden="true">${esc(sym)}</span>
    </span>`;
}
