// ===== Cartes à collectionner — composant partagé (rendu d'une carte, raretés, familles) =====
// Utilisé par cartes.js, cartes-trades.js, cartes-showcase.js, admin-cards.js et membre.js (vitrine).
// Styles : assets/css/cartes-card.css (à inclure sur chaque page qui affiche des cartes).
// Côté serveur : tables hg_cards / hg_card_copies, réglages hg_settings.cards, fonctions hg_* (migrations 018).
import { esc, currentLogo } from './core.js';

export const RARITIES = [
  { id: 'commune', label: 'Commune', short: 'C' },
  { id: 'peu_commune', label: 'Peu commune', short: 'PC' },
  { id: 'rare', label: 'Rare', short: 'R' },
  { id: 'epique', label: 'Épique', short: 'É' },
  { id: 'legendaire', label: 'Légendaire', short: 'L' },
  { id: 'mythique', label: 'Mythique', short: 'M' },
  { id: 'identite', label: 'Identité', short: 'ID' },
];
export const RARITY = Object.fromEntries(RARITIES.map((r, i) => [r.id, { ...r, rank: i + 1 }]));
export const rarityLabel = (id) => RARITY[id]?.label || id;
export const rarityRank = (id) => RARITY[id]?.rank || 0;

export const FAMILIES = [
  { id: 'membre', label: 'Membre' },
  { id: 'moment', label: 'Moment' },
  { id: 'lieu', label: 'Lieu' },
  { id: 'objet', label: 'Objet' },
  { id: 'evenement', label: 'Événement' },
  { id: 'jeu', label: 'Jeu vidéo' },
];
export const familyLabel = (id) => FAMILIES.find((f) => f.id === id)?.label || id;

/** Numéro d'exemplaire « N° 03/10 » pour les cartes limitées. */
export function serialLabel(serial, max) {
  if (!serial) return '';
  const w = String(max || serial).length;
  return `N° ${String(serial).padStart(Math.max(2, w), '0')}${max ? '/' + max : ''}`;
}

/** Numéro de la carte dans la série : « 012/100 » (le total est facultatif). */
function numberLabel(card) {
  if (card.number == null || card.number === '') return '';
  const total = card.set_total;
  const w = Math.max(3, String(total || '').length);
  return String(card.number).padStart(w, '0') + (total ? '/' + total : '');
}

/** Année d'arrivée : « 2022 » à partir d'une année ou d'une date ISO. */
function yearOf(v) {
  if (v == null || v === '') return '';
  const m = /^(\d{4})/.exec(String(v));
  return m ? m[1] : String(v);
}

const RAINBOW = ['#FE3104', '#FCA301', '#FBD32D', '#159946', '#2B5AE2', '#4E2398'];
// Gemme pixel 7×7 (losange) et étoile pixel pour la mythique (dessins inline, sans <use>).
const PATH_GEM = 'M3 0h1v1h-1zM2 1h3v1h-3zM1 2h5v1h-5zM0 3h7v1h-7zM1 4h5v1h-5zM2 5h3v1h-3zM3 6h1v1h-1z';
const PATH_STAR = 'M3 0h1v1h-1zM3 1h1v1h-1zM2 2h3v1h-3zM0 3h7v1h-7zM2 4h3v1h-3zM3 5h1v1h-1zM3 6h1v1h-1z';
const gemsHtml = (r, n) => Array.from({ length: n }, (_, i) => {
  const myth = r === 'mythique';
  const st = r === 'identite' ? ` style="color:${RAINBOW[i % RAINBOW.length]}"` : '';
  const shade = myth ? '' : '<path d="M2 1h1v1h-1zM1 2h1v1h-1z" fill="#fff" opacity=".85"/><path d="M6 3h1v1h-1zM5 4h1v1h-1zM4 5h2v1h-2zM3 6h1v1h-1z" fill="#000" opacity=".35"/>';
  return `<svg class="hgc-gem" viewBox="0 0 7 7" aria-hidden="true" focusable="false"${st}><path d="${myth ? PATH_STAR : PATH_GEM}" fill="currentColor"/>${shade}</svg>`;
}).join('');
const PORTRAIT = '<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><rect width="16" height="16" fill="#2a2640"/><rect x="2" y="13" width="12" height="3" fill="#2B5AE2"/><rect x="6" y="10" width="4" height="3" fill="#e0ad80"/><rect x="5" y="3" width="6" height="2" fill="#3b2a1e"/><rect x="4" y="4" width="1" height="4" fill="#3b2a1e"/><rect x="11" y="4" width="1" height="4" fill="#3b2a1e"/><rect x="5" y="5" width="6" height="5" fill="#f1c79d"/><rect x="6" y="7" width="1" height="1" fill="#111"/><rect x="9" y="7" width="1" height="1" fill="#111"/><rect x="7" y="9" width="2" height="1" fill="#9c4a3c"/></svg>';

/** Calques de la carte : cadre (out), liseré (mid), fond de la face (in) et décors cumulés selon la rareté. */
const LAYERS = '<span class="hgc-layer hgc-out"></span><span class="hgc-layer hgc-mid"></span>'
  + '<span class="hgc-layer hgc-in"><span class="hgc-ln"></span><span class="hgc-ln2"></span>'
  + '<span class="hgc-stud sl"></span><span class="hgc-stud sr"></span><span class="hgc-tab tt"></span><span class="hgc-tab tb"></span>'
  + '<span class="hgc-dia dtl"></span><span class="hgc-dia dtr"></span><span class="hgc-dia dbl"></span><span class="hgc-dia dbr"></span></span>';

/**
 * HTML d'une carte face visible.
 * card : { name, rarity, family, image_url, flavor, caption?, number, set_total?, set_name?, max_copies, member_since? }
 * opts : { shiny, serial, count (nb d'exemplaires possédés), size: 'sm'|'md'|'lg', locked, missing, button (true = <button>), attrs (string) }
 */
export function cardHtml(card, opts = {}) {
  const r = RARITY[card.rarity] ? card.rarity : 'commune';
  const size = opts.size || 'md';
  const miss = !!opts.missing;
  const ident = r === 'identite';
  const cls = ['hgc', `hgc-${r}`, `hgc-${size}`, opts.shiny ? 'is-shiny' : '', miss ? 'is-missing' : '', opts.locked ? 'is-locked' : ''].filter(Boolean).join(' ');
  const name = miss ? '???' : String(card.name ?? '');
  const famLine = [familyLabel(card.family), card.set_name].filter(Boolean).join(' · ');
  const flavor = miss ? '' : card.flavor;
  const caption = miss ? '' : card.caption;
  const ms = yearOf(card.member_since);

  let win;
  if (miss) {
    win = '<span class="hgc-win"><span class="hgc-q" aria-hidden="true">?</span></span>';
  } else if (ident) {
    const photo = card.image_url ? `<img class="hgc-win-img" src="${esc(card.image_url)}" alt="" aria-hidden="true" loading="lazy">` : PORTRAIT;
    win = `<span class="hgc-win hgc-win-id"><span class="hgc-photo">${photo}</span>`
      + `<span class="hgc-idinfo"><span class="hgc-idk">Pseudo</span><span class="hgc-idv">${esc(name)}</span>`
      + (ms ? `<span class="hgc-idk">Membre depuis</span><span class="hgc-idv">${esc(ms)}</span>` : '') + '</span></span>';
  } else {
    win = card.image_url
      ? `<span class="hgc-win"><img class="hgc-win-img" src="${esc(card.image_url)}" alt="" aria-hidden="true" loading="lazy"></span>`
      : `<span class="hgc-win"><img class="hgc-win-logo" src="${esc(currentLogo())}" alt="" aria-hidden="true" loading="lazy"></span>`;
  }

  const serialTxt = opts.serial ? serialLabel(opts.serial, card.max_copies) : '';
  const count = opts.count > 1 ? `<span class="hgc-count" aria-hidden="true">×${opts.count}</span>` : '';
  const lock = opts.locked ? '<span class="hgc-lock" title="Bloquée par une offre d\'échange">En échange</span>' : '';
  const label = `${name} — ${rarityLabel(r)}${opts.shiny ? ', brillante' : ''}${opts.serial ? ', ' + serialLabel(opts.serial, card.max_copies) : ''}`
    + `${opts.count > 1 ? ', ' + opts.count + ' exemplaires' : ''}${opts.locked ? ', en échange' : ''}${miss ? ' (pas encore obtenue)' : ''}`;
  const tag = opts.button ? 'button' : 'div';
  const typeAttr = opts.button ? ' type="button"' : '';
  const roleAttr = opts.button ? '' : ' role="img"';

  return `<${tag}${typeAttr} class="${cls}" aria-label="${esc(label)}"${roleAttr} ${opts.attrs || ''}>
    <span class="hgc-frame" aria-hidden="true">
      ${LAYERS}
      ${opts.shiny ? '<span class="hgc-holo"></span>' : ''}
      <span class="hgc-gems">${gemsHtml(r, rarityRank(r))}</span>
      <span class="hgc-plate"><span class="hgc-plate-t">${esc(ident ? (miss ? '???' : "Carte d'identité") : name)}</span></span>
      ${win}
      <span class="hgc-fam">${esc(famLine)}</span>
      <span class="hgc-amb">${flavor ? `<em class="hgc-flavor">« ${esc(flavor)} »</em>` : ''}${caption ? `<span class="hgc-cap">${esc(caption)}</span>` : ''}</span>
      <span class="hgc-pied"><span class="hgc-pied-n">${esc(miss ? '' : numberLabel(card))}</span><span class="hgc-pied-s">${esc(serialTxt)}</span></span>
    </span>
    ${count}${lock}
  </${tag}>`;
}

/** Dos de carte (booster pas encore retourné) : trame rouge, médaillon arc-en-ciel au logo, bandeau noir. */
export function cardBackHtml(size = 'md') {
  return `<div class="hgc hgc-back hgc-${size}" aria-hidden="true"><span class="hgc-frame">`
    + '<span class="hgc-layer hgc-out"></span><span class="hgc-layer hgc-mid"></span>'
    + `<span class="hgc-layer hgc-in"><span class="hgc-medal"><span class="hgc-medal-in"><img class="hgc-back-logo" src="${esc(currentLogo())}" alt=""></span></span>`
    + '<span class="hgc-band-back">Humane Gang</span></span></span></div>';
}

/** Formate un nombre de Paillettes. */
export const fmtP = (n) => `${new Intl.NumberFormat('fr-CH').format(n || 0)} ✦`;
