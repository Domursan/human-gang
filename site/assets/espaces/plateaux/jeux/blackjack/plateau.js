// ===== Humane Gang — Blackjack : tapis de jeu (plateaux/jeux/blackjack/plateau.js) =====
/*
 * Rôle : dessin du tapis vert en HTML : la banque en haut (ses cartes, son total quand il est connu), puis les sièges
 *   de chaque joueur (pseudo, jetons, mains avec cartes, total, mise et statut). Ce module ne fait que du HTML ;
 *   table.js décide quand le refaire.
 * Dépendances : core.js (esc), ../cartes.js (carteHtml).
 * Exporte : tapisHtml(opts) -> HTML ; STATUTS (statut serveur -> libellé français) ; valeurCarte(code) -> 'A', '2'…'10'→'X' pour les figures.
 *   opts = {
 *     banque: ['AS', '??'] (cartes de la banque, '??' = carte cachée), totalBanque: number|null, phase: 'mise'|'jeu'|'banque'|…,
 *     sieges: [{ id, pseudo, couleur, initiale, invite, jetons, mise, tour, moi, sorti, parti, mains: [{ cartes, mise, statut, total, active }] }]
 *   }
 */
import { esc } from '../../../../commun/core.js';
import { carteHtml } from '../cartes.js';

/** Libellé affiché pour chaque statut de main renvoyé par le serveur. */
export const STATUTS = {
  joue: 'En jeu',
  reste: 'Reste',
  double: 'Doublé',
  saute: 'Saute',
  blackjack: 'Blackjack',
};

/** Phrase de la banque selon la phase de la manche. */
const PHASE_BANQUE = {
  mise: 'Faites vos jeux',
  jeu: 'Les joueurs jouent',
  banque: 'La banque joue',
  reglement: 'Règlement',
};

/**
 * Valeur d'une carte pour comparer deux cartes (figures réunies, « X ») : sert à repérer une paire.
 * @param {string} code carte, ex. 'TH'.
 * @returns {string} 'A', '2' à '9', ou 'X' pour 10 et figures.
 */
export function valeurCarte(code) {
  const v = String(code || '')[0] || '';
  return ['T', 'J', 'Q', 'K'].includes(v) ? 'X' : v;
}

/** Montant en jetons, avec espaces de milliers (format suisse). */
const jetons = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-CH')}`;

/** Une main d'un siège : cartes petites, total, mise, statut. */
function mainHtml(m, numero) {
  const cartes = (m.cartes || []).map((c) => carteHtml(c, { petite: true })).join('');
  const statut = STATUTS[m.statut] || '';
  const titre = m.totalMains > 1 ? `Main ${numero}` : 'Main';
  return `<div class="bj-main${m.active ? ' is-active' : ''}${m.statut === 'saute' ? ' is-saute' : ''}">
      <p class="bj-main-tete"><span class="bj-main-titre">${esc(titre)}</span>${m.active ? ' <span class="bj-etiquette is-tour">à jouer</span>' : ''}</p>
      <div class="bj-cartes" role="group" aria-label="${esc(titre)} : ${esc(String(m.total ?? '?'))}">${cartes}</div>
      <p class="bj-main-info small">
        <span>Total <strong>${esc(m.total ?? '–')}</strong></span>
        <span>Mise <strong>${esc(jetons(m.mise))}</strong></span>
        ${statut ? `<span class="bj-statut is-${esc(m.statut)}">${esc(statut)}</span>` : ''}
      </p>
    </div>`;
}

/** Un siège (joueur) : en-tête, jetons, mains ou mise en attente. */
function siegeHtml(s) {
  const couleur = /^#[0-9a-f]{6}$/i.test(s.couleur || '') && !s.invite ? s.couleur : '#F2EFEA';
  const classes = ['bj-siege'];
  if (s.tour) classes.push('is-tour');
  if (s.moi) classes.push('is-moi');
  if (s.sorti) classes.push('is-sorti');
  if (s.parti) classes.push('is-parti');
  const mains = s.mains || [];
  const corps = mains.length
    ? `<div class="bj-mains">${mains.map((m, i) => mainHtml({ ...m, totalMains: mains.length }, i + 1)).join('')}</div>`
    : `<p class="bj-attente small">${s.sorti ? 'Sorti du jeu' : s.parti ? 'A quitté la partie' : s.mise ? `Mise ${esc(jetons(s.mise))} jetons` : 'Pas encore de mise'}</p>`;
  return `<li class="${classes.join(' ')}" data-joueur="${esc(s.id)}"${s.tour ? ' aria-current="step"' : ''}>
      <header class="bj-siege-tete">
        <span class="bj-pastille" style="background:${esc(couleur)}" aria-hidden="true">${esc(s.initiale || '?')}</span>
        <span class="bj-siege-nom">
          <strong class="bj-pseudo">${esc(s.pseudo || '?')}</strong>
          ${s.invite ? '<span class="bj-etiquette">invité</span>' : ''}
          ${s.moi ? '<span class="bj-etiquette">toi</span>' : ''}
        </span>
      </header>
      <p class="bj-jetons"><span class="bj-jetons-nombre">${esc(jetons(s.jetons))}</span> <span class="small">jetons</span></p>
      ${corps}
    </li>`;
}

/**
 * Tapis complet : banque en haut, sièges ensuite.
 * @param {object} opts voir l'en-tête.
 * @returns {string} HTML (<section class="bj-tapis">).
 */
export function tapisHtml({ banque = [], totalBanque = null, phase = '', sieges = [] } = {}) {
  const cartes = banque.length
    ? banque.map((c) => carteHtml(c)).join('')
    : '<span class="bj-vide small">Pas encore de cartes</span>';
  const total = totalBanque != null
    ? `Total <strong>${esc(totalBanque)}</strong>`
    : (banque.length ? 'Total <strong>?</strong>' : '');
  return `<section class="bj-tapis" aria-label="Table de blackjack">
    <div class="bj-banque" role="group" aria-labelledby="bj-banque-titre">
      <p class="bj-banque-tete">
        <span id="bj-banque-titre" class="bj-banque-titre">Banque</span>
        <span class="bj-banque-phase small">${esc(PHASE_BANQUE[phase] || '')}</span>
      </p>
      <div class="bj-cartes bj-cartes-banque" role="group" aria-label="Cartes de la banque">${cartes}</div>
      <p class="bj-banque-total small">${total}</p>
    </div>
    <ol class="bj-sieges" aria-label="Joueurs">${sieges.map(siegeHtml).join('')}</ol>
  </section>`;
}
