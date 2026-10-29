// ===== Humane Gang — Loup-Garou : la table autour du feu de camp =====
/*
 * Rôle : dessine les joueurs assis en cercle autour du feu (image de nuit ou de jour), chaque pseudo posé sur une bûche.
 * Les places sont celles du serveur (voisins réels pour le Montreur d'ours, le Renard, le Chevalier).
 * Les sièges sont des <button> quand on peut choisir une cible (vote, pouvoir de nuit), sinon des <div>.
 * Dépendances : core.js (esc), ui.js, roles.js.
 * Exporte : tableHtml.
 */
import { esc } from '../../commun/core.js';
import { icone, avatar } from './ui.js';
import { roleById } from './roles.js';

/* Fond du prénom (loup-garou.css, .lg-siege-buche) : la teinte la plus claire du bandeau, et seuil de contraste visé. */
const FOND_BANDEAU = [0x1C, 0x13, 0x0D];
const CONTRASTE_MIN = 4.6;

/** Luminance relative WCAG d'une couleur [r, g, b] (0 à 255). */
function luminance([r, g, b]) {
  const c = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

/**
 * Couleur du prénom lisible sur le bandeau sombre : même teinte, éclaircie vers le blanc juste assez pour
 * atteindre le contraste visé. Une couleur déjà assez claire est rendue telle quelle.
 * @param {string} hex couleur #rrggbb du joueur
 * @returns {string} #rrggbb
 */
export function couleurPrenom(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lf = luminance(FOND_BANDEAU);
  const contraste = (rgb) => (Math.max(luminance(rgb), lf) + 0.05) / (Math.min(luminance(rgb), lf) + 0.05);
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const m = c.map((v) => Math.round(v + (255 - v) * t));
    if (contraste(m) >= CONTRASTE_MIN) return '#' + m.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  return '#FFFFFF';
}

/**
 * HTML de la table.
 * @param {Array<object>} joueurs joueurs de hg_lg_etat (place, pseudo, couleur, invite, vivant, role, capitaine…).
 * @param {object} o
 * @param {'nuit'|'jour'} o.ambiance image du feu.
 * @param {string} o.moi user_id du joueur connecté.
 * @param {string|null} o.cible user_id sélectionné (anneau).
 * @param {string} [o.anneau] couleur de l'anneau de la cible.
 * @param {(j:object)=>boolean} [o.choisissable] si vrai, le siège est un bouton (data-cible=user_id).
 * @param {Object<string,number>} [o.votes] nombre de voix par user_id.
 * @param {string} [o.centre] texte au centre (« Le village dort », « 7 votes sur 10 »).
 * @param {(j:object)=>string} [o.sous] petite étiquette sous la bûche (HTML déjà échappé).
 */
export function tableHtml(joueurs, o = {}) {
  const assis = joueurs.filter((j) => j.place != null).sort((a, b) => a.place - b.place);
  const n = assis.length || 1;
  const feu = o.ambiance === 'jour' ? '/assets/images/loup-garou/feu-jour.svg' : '/assets/images/loup-garou/feu-nuit.svg';
  const sieges = assis.map((j, k) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
    const x = 50 + 39 * Math.cos(a);
    const y = 50 + 39 * Math.sin(a);
    const classes = ['lg-siege'];
    if (j.user_id === o.moi) classes.push('moi');
    if (!j.vivant) classes.push('mort');
    if (o.cible && j.user_id === o.cible) classes.push('cible');
    const bouton = !!o.choisissable?.(j);
    const couleur = couleurPrenom(j.invite ? '#9A968F' : (/^#[0-9a-f]{6}$/i.test(j.couleur || '') ? j.couleur : '#F2EFEA'));
    const nbVotes = o.votes?.[j.user_id];
    const role = !j.vivant && j.role ? roleById(j.role).nom : '';
    let sous = o.sous ? o.sous(j) : '';
    if (!sous && !j.vivant && role) sous = esc(role);
    if (!sous && j.user_id === o.moi) sous = '<span class="lg-etiquette sable">Toi</span>';
    if (!sous && j.capitaine) sous = '<span class="lg-etiquette sable">Capitaine ×2</span>';
    const etiquette = `${esc(j.pseudo)}${j.user_id === o.moi ? ' (toi)' : ''}${!j.vivant ? `, mort·e${role ? `, ${role}` : ''}` : ''}${nbVotes ? `, ${nbVotes} voix` : ''}`;
    const inner = `<span class="lg-siege-av">${j.vivant ? avatar(j, 46) : icone('crane', 18)}`
      + `${nbVotes ? `<span class="lg-siege-badge" aria-hidden="true">${nbVotes}</span>` : ''}</span>`
      + `<span class="lg-siege-buche" style="color:${couleur}">${esc(j.pseudo)}</span>`
      + (sous ? `<span class="lg-siege-sous">${sous}</span>` : '');
    const style = `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%`;
    return bouton
      ? `<button type="button" class="${classes.join(' ')}" style="${style}" data-cible="${esc(j.user_id)}" aria-label="${esc(etiquette)}" aria-pressed="${o.cible === j.user_id}">${inner}</button>`
      : `<div class="${classes.join(' ')}" style="${style}" role="img" aria-label="${esc(etiquette)}">${inner}</div>`;
  }).join('');
  // Beaucoup de joueurs : sièges plus petits pour que les voisins ne se chevauchent pas (CSS : .lg-table--dense / --serre).
  const taille = n > 20 ? ' lg-table--serre' : n > 12 ? ' lg-table--dense' : '';
  return `<section class="lg-table${taille}" aria-label="Table de jeu autour du feu" style="--lg-anneau:${esc(o.anneau || '#7E93C9')}">
    <img class="lg-table-feu" src="${feu}" alt="">
    <div class="lg-table-lueur" aria-hidden="true"></div>
    ${sieges}
    ${o.centre ? `<div class="lg-table-centre">${esc(o.centre)}</div>` : ''}
  </section>`;
}
