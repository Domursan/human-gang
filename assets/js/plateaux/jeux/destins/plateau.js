// ===== Humane Gang — Destins : chemin de vie (plateaux/jeux/destins/plateau.js) =====
/*
 * Rôle : dessin du chemin de vie (91 cases, index 0 à 90) en HTML positionné en %.
 *   Trois embranchements : Université (1 à 10) ou Carrière (11 à 20), puis 21 à 51 ; au 51,
 *   Famille (52 à 61) ou Aventure (62 à 71) ; puis 72 à 90 (retraite).
 *   Les positions viennent d'un tracé en polylignes (repère 640 × 560 de la maquette), échantillonnées
 *   à égale distance : elles sont en % du plan, donc elles suivent la largeur de l'écran.
 *   Si une image de fond existe (assets/img/plateaux/destins/plateau.webp, 2000 × 2000), elle sert de fond.
 *   Ce module ne fait que du HTML : table.js décide quand le refaire.
 * Dépendances : core.js (esc).
 * Exporte : POSITIONS (91 paires [x, y] en %), LIBELLES (type de case -> nom affiché), plateauHtml(opts) -> HTML.
 *   opts = { image: string|null, types: [type de case, index 0..90], pions: [{couleur, initiale, pseudo, nom, invite, case}],
 *            prochaine: index|null, moi: index|null }
 */
import { esc } from '../../../core.js';

const LARGEUR = 640;
const HAUTEUR = 560;

/* Polylignes du tracé, en repère 640 × 560. Chaque segment part du point de jonction (exclu de l'échantillon). */
// Tracé sans croisement : départ à gauche, deux voies parallèles (Université en haut, Carrière dessous), chemin principal
// en lacet, embranchement Famille (à droite) / Aventure (en bas), puis le dernier lacet jusqu'à la retraite.
const DEPART = [40, 60];
const UNIVERSITE = [[40, 60], [40, 25], [470, 25]];                                   // 10 cases : 1 à 10
const CARRIERE = [[40, 60], [40, 95], [470, 95]];                                     // 10 cases : 11 à 20
const MAIN = [[470, 60], [600, 60], [600, 160], [40, 160], [40, 230], [300, 230]];    // 31 cases : 21 à 51 (choix)
const FAMILLE = [[300, 230], [600, 230], [600, 300]];                                 // 10 cases : 52 à 61
const AVENTURE = [[300, 230], [300, 370], [600, 370]];                                // 10 cases : 62 à 71
const RETRAITE = [[620, 335], [620, 440], [40, 440], [40, 520], [400, 520]];          // 19 cases : 72 à 90

/** Longueur cumulée des segments d'une polyligne. */
function longueurs(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  return cum;
}

/** n points répartis à égale distance le long de la polyligne, sans le premier point. */
function echantillon(points, n) {
  const cum = longueurs(points);
  const total = cum[cum.length - 1];
  const sortie = [];
  for (let j = 1; j <= n; j++) {
    const d = (total * j) / n;
    let k = 1;
    while (k < cum.length - 1 && cum[k] < d) k++;
    const seg = cum[k] - cum[k - 1] || 1;
    const t = Math.min(1, Math.max(0, (d - cum[k - 1]) / seg));
    const [ax, ay] = points[k - 1];
    const [bx, by] = points[k];
    sortie.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
  }
  return sortie;
}

/** Positions des 91 cases, en % du plan. */
function construire() {
  const brut = [DEPART]
    .concat(echantillon(UNIVERSITE, 10), echantillon(CARRIERE, 10), echantillon(MAIN, 31),
      echantillon(FAMILLE, 10), echantillon(AVENTURE, 10), echantillon(RETRAITE, 19));
  return brut.map(([x, y]) => [+((x / LARGEUR) * 100).toFixed(3), +((y / HAUTEUR) * 100).toFixed(3)]);
}

/** Positions des 91 cases (index = case). */
export const POSITIONS = construire();

/** Nom affiché et lettre de chaque type de case (couleurs dans destins.css, classe dp-t-<type>). */
export const LIBELLES = {
  depart: { lettre: 'D', nom: 'Départ' },
  paie: { lettre: '€', nom: 'Jour de paie' },
  evenement: { lettre: '!', nom: 'Événement' },
  vacances: { lettre: 'V', nom: 'Vacances' },
  assurance: { lettre: 'A', nom: 'Assurance' },
  diplome: { lettre: 'T', nom: 'Diplôme' },
  mariage: { lettre: '&', nom: 'Mariage' },
  bebe: { lettre: 'B', nom: 'Bébé' },
  jumeaux: { lettre: '2', nom: 'Jumeaux' },
  achat: { lettre: 'M', nom: 'Achat' },
  impots: { lettre: 'I', nom: 'Impôts' },
  proces: { lettre: 'J', nom: 'Procès' },
  augmentation: { lettre: '+', nom: 'Augmentation' },
  choix: { lettre: '?', nom: 'Choix' },
  risque: { lettre: 'Q', nom: 'Risque' },
  retraite: { lettre: 'R', nom: 'Retraite' },
};

/** Libellé d'un type de case (repli : le type lui-même). */
const libelleDe = (type) => LIBELLES[type] || { lettre: '·', nom: String(type || 'Case') };

/** Décalage des pions posés sur une même case, pour rester lisibles. */
function decalage(index, total) {
  if (total <= 1) return { dx: 0, dy: 0 };
  const angle = (index / total) * 2 * Math.PI;
  return { dx: Math.cos(angle) * 10, dy: Math.sin(angle) * 7 };
}

/**
 * HTML du chemin de vie.
 * @param {{image?: string|null, types?: string[], pions?: object[], prochaine?: number|null, moi?: number|null}} opts
 * @returns {string} HTML (<div class="dp-plan">).
 */
export function plateauHtml({ image = null, types = [], pions = [], prochaine = null, moi = null } = {}) {
  const cases = POSITIONS.map(([x, y], i) => {
    const type = types[i] || 'vacances';
    const { lettre, nom } = libelleDe(type);
    const classes = ['dp-case', `dp-t-${esc(type)}`];
    if (i === prochaine) classes.push('is-prochaine');
    if (i === moi) classes.push('is-moi');
    const etiquette = i === prochaine ? '<span class="dp-tag">Prochaine case</span>' : '';
    return `<div class="${classes.join(' ')}" style="left:${x}%;top:${y}%" title="${esc(nom)}" aria-label="Case ${i}, ${esc(nom)}">` +
      `<span class="dp-disque" aria-hidden="true">${esc(lettre)}</span>` +
      `<span class="dp-nom" aria-hidden="true">${esc(nom)}</span>${etiquette}</div>`;
  }).join('');

  // Pions : regroupés par case pour les décaler.
  const parCase = {};
  pions.forEach((p) => { (parCase[p.case] ||= []).push(p); });
  const pionsHtml = Object.entries(parCase).flatMap(([c, liste]) => {
    const pos = POSITIONS[Number(c)];
    if (!pos) return [];
    return liste.map((p, i) => {
      const { dx, dy } = decalage(i, liste.length);
      const couleur = /^#[0-9a-f]{6}$/i.test(p.couleur || '') ? p.couleur : '#F2EFEA';
      const libelle = `${p.pseudo || '?'}${p.invite ? ', invité' : ''}, case ${c}`;
      return `<div class="dp-pion" style="left:calc(${pos[0]}% + ${dx}px);top:calc(${pos[1]}% + ${dy}px)" role="img" aria-label="${esc(libelle)}">` +
        `<span class="dp-pion-disque" style="background:${couleur}" aria-hidden="true">${esc(p.initiale || '?')}</span>` +
        `<span class="dp-pion-tag" aria-hidden="true">${esc(p.pseudo || '')}</span></div>`;
    });
  }).join('');

  const fond = image ? `<img class="dp-plan-img" src="${esc(image)}" alt="" width="640" height="560">` : '';
  return `<div class="dp-plan" role="group" aria-label="Chemin de vie">${fond}${cases}${pionsHtml}</div>`;
}
