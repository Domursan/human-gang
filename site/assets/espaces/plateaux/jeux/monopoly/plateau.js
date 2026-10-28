// ===== Humane Gang — Monopoly : dessin des cases (plateaux/jeux/monopoly/plateau.js) =====
/*
 * Rôle : les 40 cases du plateau carré, placées en absolu sur un carré de 736 unités
 *   (coins 80 × 80, côtés 64 × 80), dans le style de la maquette « Paris · Édition 1936 » :
 *   cases crème bordées de noir, bande de couleur du groupe, nom en capitales, prix, coins avec leurs emojis.
 *   Chaque case porte : propriétaire (étiquette au nom du joueur), maisons (petits carrés verts) ou hôtel (rouge),
 *   hypothèque (grisée), et son nom pour les lecteurs d'écran (pions compris).
 *   Les pions ne sont PAS ici : table.js les dessine dans une couche à part, pour pouvoir les faire avancer case par case.
 *   Ce module ne fait que du HTML : table.js le monte et décide quand le refaire.
 * Dépendances : core.js (esc, initials), ../../api.js (nomDe).
 * Exporte : positionCase(i), pointCase(i, k) -> { left, top } en %, plateauHtml(opts) -> HTML des cases (sans le cadre).
 *   opts = { plateau: [40 cases], contenus, joueurs, proprietes, maCase: case de mon pion|null }
 */
import { esc } from '../../../../commun/core.js';
import { nomDe } from '../../api.js';

/** Dimension de référence du plateau (736 unités, le plateau s'adapte en pourcentage). */
const COTE = 736;
const COIN = 80;
const COTE_CASE = 64;
const COULEUR_GARE = '#2F2F2F';
const EUR = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} €`;

/** Emojis des coins, comme dans la maquette. */
const EMOJI_COIN = { depart: '⬅️', prison: '🔒', parc: '🚗', allez_prison: '👮' };
/** Fond des coins, comme dans la maquette. */
const FOND_COIN = { depart: '#F7E7C4', prison: '#E3D9F0', parc: '#CFEBD8', allez_prison: '#F6D6D2' };

/** Pictogrammes (SVG décoratifs, traits noirs). */
const ICONE_GARE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 11h14M9 19l-2 2M15 19l2 2"/></svg>';
const ICONE_ELEC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>';
const ICONE_EAU = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/></svg>';
const ICONE_CAISSE = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" aria-hidden="true"><rect x="3" y="9" width="18" height="11" rx="1.5"/><path d="M3 13h18M9 9V6a3 3 0 0 1 6 0v3"/></svg>';

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

/**
 * Point où se place un pion : sur le bord de la case tourné vers le centre du plateau (hors du nom et du prix).
 * Si plusieurs pions sont sur la même case, ils se répartissent le long de ce bord, en plus petit.
 * @param {number} i case.
 * @param {number} k rang du pion parmi ceux de la même case (0, 1, 2…).
 * @param {number} n nombre de pions sur la case.
 * @returns {{left: string, top: string, f: number}} position en % du plateau et facteur de taille.
 */
const RECUL = -2;         // distance (unités) entre le bord intérieur et le centre du pion
export function pointCase(i, k = 0, n = 1) {
  const pos = positionCase(i);
  const x0 = debut(pos.col);
  const y0 = debut(pos.row);
  const w = taille(pos.col);
  const h = taille(pos.row);
  let ax;
  let ay;
  let axe;
  if (pos.cote === 'cn') {
    ax = pos.col === 1 ? COIN - RECUL : COTE - COIN + RECUL;
    ay = pos.row === 1 ? COIN - RECUL : COTE - COIN + RECUL;
    axe = 'coin';
  } else if (pos.cote === 'bt') { ax = x0 + w / 2; ay = y0 + RECUL; axe = 'x'; }
  else if (pos.cote === 'tp') { ax = x0 + w / 2; ay = y0 + h - RECUL; axe = 'x'; }
  else if (pos.cote === 'lf') { ax = x0 + w - RECUL; ay = y0 + h / 2; axe = 'y'; }
  else { ax = x0 + RECUL; ay = y0 + h / 2; axe = 'y'; }
  const nb = Math.max(1, n);
  const f = nb === 1 ? 1 : nb === 2 ? 0.8 : nb === 3 ? 0.7 : 0.6;
  let u;
  let v = 0;
  if (nb === 1) { u = 0; }
  else if (nb === 2) { u = k === 0 ? -11 : 11; }
  else if (nb === 3) { u = [-17, 0, 17][k]; }
  else { u = k % 2 === 0 ? -9 : 9; v = k < 2 ? -9 : 9; }
  const du = u;
  const dv = v;
  const dx = axe === 'y' ? dv : du;
  const dy = axe === 'y' ? du : dv;
  const cx = ax + dx;
  const cy = ay + dy;
  return { left: `${((cx / COTE) * 100).toFixed(3)}%`, top: `${((cy / COTE) * 100).toFixed(3)}%`, f };
}

/** Couleur de bande d'une case : groupe (rues), gare (noir), sinon aucune. */
function couleurBande(def, contenus) {
  if (def?.type === 'rue') return (contenus.groupes || []).find((g) => g.id === def.groupe)?.couleur || null;
  if (def?.type === 'gare') return COULEUR_GARE;
  return null;
}

/** Joueur (de la liste) à partir de son identifiant. */
const joueurPar = (joueurs, uid) => joueurs.find((j) => j.user_id === uid) || null;
/** Couleur de joueur sûre (sinon gris clair). */
const couleurJ = (j) => (/^#[0-9a-f]{6}$/i.test(j?.couleur || '') && !j?.invite ? j.couleur : '#9A968F');

/** Pictogramme d'une case (gare, compagnie) ; rien pour les autres. */
function icone(def) {
  if (def?.type === 'gare') return ICONE_GARE;
  if (def?.type === 'compagnie') return /eau/i.test(def.nom || '') ? ICONE_EAU : ICONE_ELEC;
  return '';
}

/**
 * HTML d'une case : bouton, avec son nom, son prix, son propriétaire et ses maisons.
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
  const coin = pos.cote === 'cn';
  const pions = joueurs.filter((j) => !j.parti && !j.elimine && Number(j.etat?.pos) === i);

  let prix = '';
  if (def.type === 'impot') prix = def.montant ? EUR(def.montant) : '';
  else if (def.type === 'rue' || def.type === 'gare' || def.type === 'compagnie') prix = def.prix ? EUR(def.prix) : '';
  else if (def.type === 'caisse' || def.type === 'chance') prix = '';
  else if (def.type === 'allez_prison') prix = 'Va en prison';
  else if (def.type === 'prison') prix = 'Simple visite';
  else if (def.type === 'parc') prix = '';
  else if (def.type === 'depart') prix = 'Touchez 200 €';

  const classes = ['mo-case', `mo-${pos.cote}`, `mo-type-${def.type || 'inconnu'}`];
  if (coin) classes.push('mo-cn');
  if (proprio) classes.push('has-proprio');
  if (hypo) classes.push('is-hypo');
  if (i === maCase) classes.push('is-moi');

  const styleCouleurs = [
    bande ? `--bande:${esc(bande)};` : '',
    coin ? `--fond-coin:${FOND_COIN[def.type] || '#F7E7C4'};` : '',
  ].join('');
  const style = `left:${pourcent(x)};top:${pourcent(y)};width:${pourcent(w)};height:${pourcent(h)};${styleCouleurs}`;

  const emoji = EMOJI_COIN[def.type];
  const haut = emoji
    ? `<span class="mo-emoji" aria-hidden="true">${emoji}</span><span class="mo-nom">${esc(nom)}</span>`
    : def.type === 'chance'
      ? `<span class="mo-point-int" aria-hidden="true">?</span><span class="mo-nom">${esc(nom)}</span>`
      : def.type === 'caisse'
        ? `<span class="mo-picto" aria-hidden="true">${ICONE_CAISSE}</span><span class="mo-nom">${esc(nom)}</span>`
        : `<span class="mo-picto" aria-hidden="true">${icone(def)}</span><span class="mo-nom">${esc(nom)}</span>`;

  const etat2 = [
    proprio ? `<span class="mo-proprio" style="--proprio:${couleurJ(proprio)}">${esc(proprio.pseudo || '?')}</span>` : '',
    maisons >= 5 ? '<span class="mo-hotel">Hôtel</span>' : Array.from({ length: maisons }, () => '<span class="mo-maison" aria-hidden="true"></span>').join(''),
    hypo ? '<span class="mo-hypo-tag">Hypo</span>' : '',
  ].join('');

  const etiquette = [nom, prix, proprio ? `possédé par ${proprio.pseudo || '?'}` : '', maisons ? (maisons >= 5 ? 'hôtel' : `${maisons} maison${maisons > 1 ? 's' : ''}`) : '', hypo ? 'hypothéquée' : '',
    pions.length ? `pions : ${pions.map((j) => j.pseudo || '?').join(', ')}` : '']
    .filter(Boolean).join(', ');

  const contenu = `${bande ? '<span class="mo-bande" aria-hidden="true"></span>' : ''}` +
    `<span class="mo-haut">${haut}</span>` +
    `<span class="mo-bas">${etat2 ? `<span class="mo-etat">${etat2}</span>` : ''}${prix ? `<span class="mo-prix">${esc(prix)}</span>` : ''}</span>`;
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
