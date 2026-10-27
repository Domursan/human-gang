// ===== Humane Gang — Poker : table ovale (plateaux/jeux/poker/plateau.js) =====
/*
 * Rôle : dessin de la table de Texas Hold'em en HTML : feutre ovale, cinq emplacements pour les cartes communes au centre
 *   (avec la phase, le numéro de main, les blindes et le pot), et les sièges autour. Chaque siège porte son pseudo, ses jetons,
 *   sa mise du tour, sa dernière action, le badge « D » du donneur, et les dos de ses cartes (ou ses cartes révélées à l'abattage).
 *   Les sièges sont placés par deux nombres (cos, sin de leur angle) : CSS les étale selon la taille de l'écran (--rx, --ry).
 *   Ce module ne fait que du HTML ; table.js décide quand le refaire.
 * Dépendances : core.js (esc), ../cartes.js (carteHtml, dosHtml).
 * Exporte : tableHtml(opts) -> HTML ; placeSiege(k, n) -> { cx, cy } ; ACTIONS (action serveur -> libellé) ; PHASES.
 *   opts = {
 *     board: ['AS', 'KD', …] (0 à 5 cartes), pot: number, phase: 'preflop'|'flop'|'turn'|'river'|'abattage',
 *     main: number (numéro de main), blinde: number (grosse blinde), sieges: [{ id, pseudo, couleur, invite, initiale,
 *       jetons, mise, action, couche, tapis, sorti, parti, tour, moi, donneur, carteVisibles: boolean, cartes: [code, code]|null,
 *       nomMain: 'Paire'|null }]
 *   }
 */
import { esc } from '../../../../commun/core.js';
import { carteHtml, dosHtml } from '../cartes.js';

/** Libellé des phases de la main. */
export const PHASES = {
  preflop: 'Préflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  abattage: 'Abattage',
};

/** Libellé de la dernière action d'un joueur (valeur envoyée par le serveur). */
export const ACTIONS = {
  'couché': 'Couché',
  suit: 'Suit',
  parole: 'Parole',
  relance: 'Relance',
  tapis: 'Tapis',
};

/** Montant en jetons, format suisse. */
const jetons = (n) => Math.round(Number(n) || 0).toLocaleString('fr-CH');

/**
 * Position d'un siège sur l'ovale : le siège 0 (moi) est en bas, les autres suivent dans le sens des aiguilles.
 * @param {number} k rang du siège (0 à n-1), après rotation pour que moi soit en bas.
 * @param {number} n nombre de sièges.
 * @returns {{ cx: string, cy: string }} cosinus et sinus de l'angle, à 3 décimales (valeurs CSS --cx, --cy).
 */
export function placeSiege(k, n) {
  const a = Math.PI / 2 + (2 * Math.PI * k) / Math.max(1, n);
  return { cx: Math.cos(a).toFixed(3), cy: Math.sin(a).toFixed(3) };
}

/** Un emplacement de carte commune (vide, ou carte posée). */
function emplacement(code) {
  return code ? carteHtml(code) : '<span class="pk-emplacement" aria-hidden="true"></span>';
}

/** Cartes d'un siège : dos (en jeu), cartes révélées, ou rien (couché ou sorti). */
function cartesSiege(s) {
  if (s.sorti || s.parti) return '';
  if (s.carteVisibles && Array.isArray(s.cartes) && s.cartes.length) {
    return s.cartes.map((c) => carteHtml(c, { petite: true })).join('');
  }
  if (s.couche) return '';
  if (s.moi) return '';
  return `${dosHtml({ petite: true })}${dosHtml({ petite: true })}`;
}

/** Un siège. */
function siegeHtml(s, k, n) {
  const { cx, cy } = placeSiege(k, n);
  const couleur = /^#[0-9a-f]{6}$/i.test(s.couleur || '') && !s.invite ? s.couleur : '#F2EFEA';
  const classes = ['pk-siege'];
  if (s.tour) classes.push('is-tour');
  if (s.moi) classes.push('is-moi');
  if (s.couche) classes.push('is-couche');
  if (s.tapis) classes.push('is-tapis');
  if (s.sorti) classes.push('is-sorti');
  if (s.parti) classes.push('is-parti');
  const etiquettes = [];
  if (s.donneur) etiquettes.push('<span class="pk-etiquette is-donneur" title="Donneur">D</span>');
  if (s.invite) etiquettes.push('<span class="pk-etiquette">invité</span>');
  if (s.moi) etiquettes.push('<span class="pk-etiquette">toi</span>');
  if (s.tapis) etiquettes.push('<span class="pk-etiquette is-tapis">Tapis</span>');
  if (s.sorti) etiquettes.push('<span class="pk-etiquette">éliminé</span>');
  if (s.parti) etiquettes.push('<span class="pk-etiquette">a quitté</span>');
  const action = ACTIONS[s.action] || '';
  return `<li class="${classes.join(' ')}" style="--cx:${cx};--cy:${cy}"${s.tour ? ' aria-current="step"' : ''}>
      <div class="pk-siege-cartes">${cartesSiege(s)}</div>
      <div class="pk-siege-corps">
        <p class="pk-siege-nom">
          <span class="pk-pastille" style="background:${esc(couleur)}" aria-hidden="true">${esc(s.initiale || '?')}</span>
          <strong class="pk-pseudo">${esc(s.pseudo || '?')}</strong>
        </p>
        <p class="pk-siege-etiquettes">${etiquettes.join('')}</p>
        <p class="pk-jetons"><span class="pk-jetons-n">${esc(jetons(s.jetons))}</span> <span class="pk-muet">jetons</span></p>
        ${Number(s.mise) > 0 ? `<p class="pk-mise">Mise ${esc(jetons(s.mise))}</p>` : ''}
        ${action ? `<p class="pk-action">${esc(action)}</p>` : ''}
        ${s.nomMain ? `<p class="pk-main">${esc(s.nomMain)}</p>` : ''}
      </div>
    </li>`;
}

/**
 * Table complète : centre (phase, main, blindes, cartes communes, pot) et sièges.
 * @param {object} opts voir l'en-tête.
 * @returns {string} HTML (<section class="pk-tapis">).
 */
export function tableHtml({ board = [], pot = 0, phase = '', main = null, blinde = null, sieges = [] } = {}) {
  const cases = [0, 1, 2, 3, 4].map((i) => emplacement(board[i] || null)).join('');
  const titrePhase = PHASES[phase] || '';
  const n = sieges.length;
  return `<section class="pk-tapis" aria-label="Table de poker">
    <div class="pk-centre">
      <p class="pk-phase">${esc(titrePhase)}${main ? ` · Main n° ${esc(main)}` : ''}</p>
      <p class="pk-blindes small">${blinde ? `Blindes ${esc(Math.round(blinde / 2))} / ${esc(blinde)}` : ''}</p>
      <div class="pk-board" role="group" aria-label="Cartes communes">${cases}</div>
      <p class="pk-pot"><span>Pot</span> <strong>${esc(jetons(pot))}</strong> <span class="pk-muet">jetons</span></p>
    </div>
    <ol class="pk-sieges" aria-label="Joueurs">${sieges.map((s, k) => siegeHtml(s, k, n)).join('')}</ol>
  </section>`;
}
