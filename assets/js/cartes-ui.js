// ===== Cartes à collectionner — composant partagé (rendu d'une carte, raretés, familles) =====
// Utilisé par cartes.js, cartes-trades.js, admin-cards.js et membre.js (vitrine).
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
];
export const familyLabel = (id) => FAMILIES.find((f) => f.id === id)?.label || id;

/** Numéro d'exemplaire « N° 03/10 » pour les cartes limitées. */
export function serialLabel(serial, max) {
  if (!serial) return '';
  const w = String(max || serial).length;
  return `N° ${String(serial).padStart(Math.max(2, w), '0')}${max ? '/' + max : ''}`;
}

/**
 * HTML d'une carte face visible.
 * card : { name, rarity, family, image_url, flavor, number, max_copies, set_name? }
 * opts : { shiny, serial, count (nb d'exemplaires possédés), size: 'sm'|'md'|'lg', locked, missing, button (true = <button>), attrs (string) }
 */
export function cardHtml(card, opts = {}) {
  const r = RARITY[card.rarity] ? card.rarity : 'commune';
  const size = opts.size || 'md';
  const cls = ['hgc', `hgc-${r}`, `hgc-${size}`, opts.shiny ? 'is-shiny' : '', opts.missing ? 'is-missing' : '', opts.locked ? 'is-locked' : ''].filter(Boolean).join(' ');
  const img = card.image_url
    ? `<img class="hgc-img" src="${esc(card.image_url)}" alt="" loading="lazy">`
    : `<img class="hgc-img hgc-img-ph" src="${esc(currentLogo())}" alt="" loading="lazy">`;
  const serial = opts.serial ? `<span class="hgc-serial">${esc(serialLabel(opts.serial, card.max_copies))}</span>` : '';
  const count = opts.count > 1 ? `<span class="hgc-count" aria-label="${opts.count} exemplaires">×${opts.count}</span>` : '';
  const label = `${card.name} — ${rarityLabel(r)}${opts.shiny ? ', brillante' : ''}${opts.serial ? ', ' + serialLabel(opts.serial, card.max_copies) : ''}${opts.missing ? ' (pas encore obtenue)' : ''}`;
  const tag = opts.button ? 'button' : 'div';
  const typeAttr = opts.button ? ' type="button"' : '';
  return `<${tag}${typeAttr} class="${cls}" aria-label="${esc(label)}" ${opts.attrs || ''}>
    <span class="hgc-frame">
      <span class="hgc-top"><span class="hgc-fam">${esc(familyLabel(card.family))}</span>${card.number != null ? `<span class="hgc-num">#${esc(card.number)}</span>` : ''}</span>
      <span class="hgc-art">${opts.missing ? '<span class="hgc-q" aria-hidden="true">?</span>' : img}</span>
      <span class="hgc-name">${esc(opts.missing ? '???' : card.name)}</span>
      <span class="hgc-foot"><span class="hgc-rar">${esc(rarityLabel(r))}</span>${serial}</span>
    </span>
    ${count}${opts.locked ? '<span class="hgc-lock" title="Bloquée par une offre d\'échange">En échange</span>' : ''}
  </${tag}>`;
}

/** Dos de carte (booster pas encore retourné). */
export function cardBackHtml(size = 'md') {
  return `<div class="hgc hgc-back hgc-${size}" aria-hidden="true"><span class="hgc-frame"><img class="hgc-back-logo" src="${esc(currentLogo())}" alt=""></span></div>`;
}

/** Formate un nombre de Paillettes. */
export const fmtP = (n) => `${new Intl.NumberFormat('fr-CH').format(n || 0)} ✦`;
