// ===== Humane Gang — Monopoly : dessin des cases (plateaux/jeux/monopoly/plateau.js) =====
/*
 * Rôle : les 40 cases du plateau carré officiel, placées en absolu sur un carré de 736 unités
 *   (coins 80 × 80, côtés 64 × 80), comme la maquette PolyPlateau (grille 11 × 11).
 *   Chaque case porte : bande de couleur du groupe (rues), nom, prix, propriétaire (liseré et pastille aux initiales),
 *   maisons (petits carrés verts) ou hôtel (rouge), hypothèque (grisée), pions des joueurs (initiales).
 *   Ce module ne fait que du HTML : table.js le monte et décide quand le refaire.
 *   Le centre du plateau (dés, carte, panneau d'action) est géré par table.js, à part.
 * Dépendances : core.js (esc, initials), ../../api.js (nomDe).
 * Exporte : positionCase(i) -> { col, row, cote }, plateauHtml(opts) -> HTML des cases (sans le cadre).
 *   opts = { plateau: [40 cases], contenus, joueurs, proprietes, maCase: case de mon pion|null, cliquable: bool }
 */
import { esc, initials } from '../../../core.js';
import { nomDe } from '../../api.js';

/** Dimension de référence du plateau (la grille de la maquette fait 736 px). */
const COTE = 736;
const COIN = 80;
const COTE_CASE = 64;
const COULEUR_GARE = '#8A93A0';
const COULEUR_HYPO = '#55534F';
const EUR = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} €`;

/**
 * Position d'une case sur la grille 11 × 11 : colonne, rangée, côté de la bande (bt, lf, tp, rt) ou coin (cn).
 * La case 0 est en bas à droite ; le plateau tourne dans le sens des aiguilles d'une montre.
 * @param {number} i numéro de case (0 à 39).
 * @returns {{col: number, row: number, cote: string}}
 */
export function positionCase(i) {
  if (i % 10 === 0) {
    const coin = { 0: [11, 11], 10: [1, 11], 20: [1, 1], 30: [11, 1] }[i];
    return { col: coin[0], row: coin[1], cote: 'cn' };
  }
  if (i < 10) return { col: 11 - i, row: 11, cote: 'bt' };
  if (i < 20) return { col: 1, row: 21 - i, cote: 'lf' };
  if (i < 30) return { col: 1 + (i - 20), row: 1, cote: 'tp' };
  return { col: 11, row: 1 + (i - 30), cote: 'rt' };
}

/** Début (en unités) d'une colonne ou d'une rangée de la grille, et sa taille. */
const debut = (n) => (n === 1 ? 0 : n === 11 ? COTE - COIN : COIN + (n - 2) * COTE_CASE);
const taille = (n) => (n === 1 || n === 11 ? COIN : COTE_CASE);
const pourcent = (v) => `${((v / COTE) * 100).toFixed(3)}%`;

/** Couleur de bande d'une case : groupe (rues), gare, sinon aucune. */
function couleurBande(def, contenus) {
  if (def?.type === 'rue') return (contenus.groupes || []).find((g) => g.id === def.groupe)?.couleur || null;
  if (def?.type === 'gare') return COULEUR_GARE;
  return null;
}

/** Joueur (de la liste) à partir de son identifiant. */
const joueurPar = (joueurs, uid) => joueurs.find((j) => j.user_id === uid) || null;
/** Couleur de joueur sûre (sinon gris clair). */
const couleurJ = (j) => (/^#[0-9a-f]{6}$/i.test(j?.couleur || '') && !j?.invite ? j.couleur : '#9A968F');

/**
 * HTML d'une case : bouton, avec son nom, son prix, son propriétaire, ses maisons et ses pions.
 * @returns {string}
 */
function caseHtml(i, { plateau, contenus, joueurs, proprietes, maCase }) {
  const def = plateau[i] || {};
  const pos = positionCase(i);
  const x = debut(pos.col);
  const y = debut(pos.row);
  const w = taille(pos.col);
  const h = taille(pos.row);
  const nom = nomDe(contenus, 'cases', `c${i}`) || `Case ${i}`;
  const bande = couleurBande(def, contenus);
  const etat = proprietes[String(i)] || null;
  const proprio = etat?.proprio ? joueurPar(joueurs, etat.proprio) : null;
  const maisons = Number(etat?.maisons) || 0;
  const hypo = !!etat?.hypotheque;

  let prix = '';
  if (def.type === 'impot') prix = def.montant ? EUR(def.montant) : '';
  else if (def.type === 'rue' || def.type === 'gare' || def.type === 'compagnie') prix = def.prix ? EUR(def.prix) : '';
  else if (def.type === 'caisse' || def.type === 'chance') prix = 'Piocher';
  else if (def.type === 'allez_prison') prix = 'Va en prison';
  else if (def.type === 'prison') prix = 'Simple visite';

  const classes = ['mo-case', `mo-${pos.cote}`];
  if (proprio) classes.push('has-proprio');
  if (hypo) classes.push('is-hypo');
  if (i === maCase) classes.push('is-moi');

  const ligneProp = proprio
    ? `<span class="mo-proprio" style="background:${couleurJ(proprio)}" aria-hidden="true">${esc(initials(proprio.pseudo))}</span>`
    : '';
  const maisonsHtml = maisons >= 5
    ? '<span class="mo-hotel">Hôtel</span>'
    : Array.from({ length: maisons }, () => '<span class="mo-maison" aria-hidden="true"></span>').join('');

  const pions = joueurs
    .filter((j) => !j.parti && !j.elimine && Number(j.etat?.pos) === i)
    .map((j) => {
      const pion = (contenus.pions || []).find((p) => p.id === j.etat?.pion)?.nom || 'Pion';
      return `<span class="mo-pion" style="background:${couleurJ(j)}" title="${esc(pion)}, ${esc(j.pseudo || '?')}">` +
        `<span class="visually-hidden">${esc(pion)} de ${esc(j.pseudo || '?')}</span><span aria-hidden="true">${esc(initials(j.pseudo))}</span></span>`;
    }).join('');

  const etiquette = [nom, prix, proprio ? `possédé par ${proprio.pseudo || '?'}` : '', maisons ? (maisons >= 5 ? 'hôtel' : `${maisons} maison${maisons > 1 ? 's' : ''}`) : '', hypo ? 'hypothéquée' : '']
    .filter(Boolean).join(', ');

  const style = `left:${pourcent(x)};top:${pourcent(y)};width:${pourcent(w)};height:${pourcent(h)};` +
    (bande ? `--bande:${esc(bande)};` : '') + (proprio ? `--proprio:${couleurJ(proprio)};` : '') + (hypo ? `--hypo:${COULEUR_HYPO};` : '');
  const contenu = `${bande ? '<span class="mo-bande" aria-hidden="true"></span>' : ''}` +
    `<span class="mo-nom">${esc(nom)}</span>` +
    (prix ? `<span class="mo-prix">${esc(prix)}</span>` : '') +
    `<span class="mo-etat">${ligneProp}${maisonsHtml}${hypo ? '<span class="mo-hypo-tag">Hypo</span>' : ''}</span>` +
    `<span class="mo-pions">${pions}</span>`;
  const attrs = `class="${classes.join(' ')}" style="${style}" data-case="${i}" aria-label="${esc(etiquette)}"`;
  return `<button type="button" ${attrs}>${contenu}</button>`;
}

/**
 * Cases du plateau (40 boutons en position absolue) : à placer dans le cadre .mo-cases de table.js.
 * @param {object} opts { plateau, contenus, joueurs, proprietes, maCase }.
 * @returns {string} HTML.
 */
export function plateauHtml({ plateau = [], contenus = {}, joueurs = [], proprietes = {}, maCase = null } = {}) {
  const ctx = { plateau, contenus, joueurs, proprietes, maCase };
  return Array.from({ length: 40 }, (_, i) => caseHtml(i, ctx)).join('');
}
