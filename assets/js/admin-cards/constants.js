// Cartes admin : constantes (libellés, réglages par défaut, description des réglages de l'économie).
import { svg } from '../icons.js';
import { RARITIES, rarityLabel } from '../cartes-ui.js';

export const TZ = 'Europe/Zurich';
export const ICON = {
  plus: svg('plus', { stroke: 2 }),
  edit: svg('edit', { stroke: 2 }),
  trash: svg('trash', { stroke: 2 }),
  off: svg('off', { stroke: 2 }),
  on: svg('check2', { stroke: 2 }),
};
export const TABS = [['series', 'Séries'], ['cartes', 'Cartes'], ['economie', 'Économie'], ['joueurs', 'Joueurs'], ['stats', 'Statistiques'], ['echanges', 'Échanges']];
export const RARITY_IDS = RARITIES.map((r) => r.id);
const CRAFT_IDS = ['commune', 'peu_commune', 'rare', 'epique', 'legendaire']; // mythique et identite ne se fabriquent jamais
export const REASON_LABEL = {
  quete: 'Quête de la semaine', defi: 'Défi du gang',
  booster: 'Booster', quotidien: 'Passage du jour', recyclage: 'Recyclage', fabrication: 'Fabrication', echange: 'Échange',
  reponse_sortie: 'Réponse à une sortie', sortie_creee: 'Sortie créée', photo: 'Photo publiée', moment: 'Moment publié',
  badge: 'Badge gagné', capture: 'Image attrapée', presence: 'Présence à une sortie', cadeau_santa: 'Cadeau Secret Santa',
  serie_complete: 'Série complète', admin: 'Ajustement admin',
};
// Valeurs de repli = celles de la migration 018 (utilisées seulement si hg_settings.cards est vide).
export const CFG_DEFAULT = {
  starting_paillettes: 1000, booster_price: 100, booster_size: 5, free_booster_hours: 24, shiny_rate: 3, pity_epique: 10, max_open_trades: 10,
  rates: { commune: 60, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.88, mythique: 0.1, identite: 0.02 },
  recycle: { commune: 5, peu_commune: 10, rare: 25, epique: 60, legendaire: 150, mythique: 400, identite: 1000, shiny_multiplier: 3 },
  craft: { commune: 40, peu_commune: 80, rare: 200, epique: 500, legendaire: 1500, shiny_multiplier: 4 },
  rewards: { daily: 20, streak_bonus: 5, streak_max: 7, rsvp: 15, presence: 30, photo: 2, moment: 15, gift_sent: 50, badge: 40, capture: 10, event_created: 25, set_complete: 300 },
};
const REWARDS = [
  ['daily', 'Passage du jour'], ['streak_bonus', 'Bonus par jour de série (en plus)'], ['streak_max', 'Série maximale (jours)'],
  ['rsvp', 'Réponse « oui » à une sortie'], ['presence', 'Présence à une sortie passée'], ['photo', 'Photo publiée'],
  ['moment', 'Moment publié'], ['gift_sent', 'Cadeau Secret Santa envoyé'], ['badge', 'Badge gagné'],
  ['capture', 'Image attrapée (événement)'], ['event_created', 'Sortie ou événement créé'], ['set_complete', 'Série complète (une fois par série)'],
];
// Réglages éditables. k = chemin (« rates.commune ») ; le nom du champ de formulaire remplace le point par un tiret bas.
export const ECON = [
  { g: 'Départ', hint: 'Paillettes offertes une seule fois à chaque nouveau joueur.', fields: [
    { k: 'starting_paillettes', l: 'Capital de départ', u: '✦', int: true },
  ] },
  { g: 'Boosters', fields: [
    { k: 'booster_price', l: 'Prix d\'un booster', u: '✦', int: true },
    { k: 'booster_size', l: 'Cartes par booster', int: true, min: 1, max: 10 },
    { k: 'free_booster_hours', l: 'Délai du booster gratuit', u: 'heures', step: 0.5 },
  ] },
  { g: 'Taux de tirage', hint: 'Part de chaque rareté dans un booster. Le total devrait faire 100 %.', rates: true,
    fields: RARITY_IDS.map((r) => ({ k: `rates.${r}`, l: rarityLabel(r), u: '%', step: 0.01 })) },
  { g: 'Brillantes et garantie', fields: [
    { k: 'shiny_rate', l: 'Taux de carte brillante', u: '%', step: 0.1, max: 100 },
    { k: 'pity_epique', l: 'Garantie épique : une carte Épique ou mieux tous les N boosters (0 = aucune)', int: true },
  ] },
  { g: 'Recyclage', hint: 'Paillettes reçues en recyclant un exemplaire.', fields: [
    ...RARITY_IDS.map((r) => ({ k: `recycle.${r}`, l: rarityLabel(r), u: '✦', int: true })),
    { k: 'recycle.shiny_multiplier', l: 'Multiplicateur brillante', u: '×', int: true, min: 1 },
  ] },
  { g: 'Fabrication', hint: 'Coût pour fabriquer une carte précise. Vide = non fabricable. Mythique et Identité ne se fabriquent jamais.', fields: [
    ...CRAFT_IDS.map((r) => ({ k: `craft.${r}`, l: rarityLabel(r), u: '✦', int: true, optional: true })),
    { k: 'craft.shiny_multiplier', l: 'Multiplicateur brillante', u: '×', int: true, min: 1 },
  ] },
  { g: 'Récompenses', hint: 'Gains en Paillettes liés à l\'activité sur le site.', fields: REWARDS.map(([k, l]) => ({
    k: `rewards.${k}`, l, int: true, min: k === 'streak_max' ? 1 : 0 })) },
  { g: 'Échanges', fields: [{ k: 'max_open_trades', l: 'Offres en cours maximum par personne', int: true, min: 1 }] },
];
