// =====================================================================
// Cartes admin : constantes (libellés, réglages par défaut, description des réglages de l'économie).
// Rien ici n'appelle la base : ce sont des valeurs fixes et des listes de libellés.
// Dépendances : icons.js (svg), cartes-ui.js (RARITIES_TIRAGE, rarityLabel : libellés des raretés).
// Exporte : TZ, ICON, TABS, RARITY_IDS, REASON_LABEL, CFG_DEFAULT, ECON.
// =====================================================================
import { svg } from '../icons.js';
import { RARITIES_TIRAGE, rarityLabel } from '../cartes-ui.js';

/* Fuseau horaire d'affichage des dates (Suisse). */
export const TZ = 'Europe/Zurich';
/* Icônes SVG des boutons de la section : ajouter, modifier, supprimer, activer, désactiver. */
export const ICON = {
  plus: svg('plus', { stroke: 2 }),
  edit: svg('edit', { stroke: 2 }),
  trash: svg('trash', { stroke: 2 }),
  off: svg('off', { stroke: 2 }),
  on: svg('check2', { stroke: 2 }),
};
/* Onglets de la section, sous la forme [identifiant, libellé]. */
export const TABS = [['series', 'Séries'], ['cartes', 'Cartes'], ['quetes', 'Quêtes'], ['economie', 'Économie'], ['boosters', 'Boosters'], ['joueurs', 'Joueurs'], ['stats', 'Statistiques'], ['echanges', 'Échanges']];
/* Identifiants des raretés tirées dans les boosters (taux et recyclage), dans l'ordre de RARITIES. Sans « unique » : jamais tirée, jamais recyclée. */
export const RARITY_IDS = RARITIES_TIRAGE.map((r) => r.id);
const CRAFT_IDS = ['commune', 'peu_commune', 'rare', 'epique', 'legendaire']; // mythique et identite ne se fabriquent jamais
/* Libellés des raisons enregistrées dans le journal des Paillettes (hg_wallet_log). */
export const REASON_LABEL = {
  quete: 'Quête de la semaine', defi: 'Défi du gang',
  booster: 'Booster', quotidien: 'Passage du jour', recyclage: 'Recyclage', fabrication: 'Fabrication', echange: 'Échange',
  reponse_sortie: 'Réponse à une sortie', sortie_creee: 'Sortie créée', photo: 'Photo publiée', moment: 'Moment publié',
  badge: 'Badge gagné', capture: 'Image attrapée', presence: 'Présence à une sortie', cadeau_santa: 'Cadeau Secret Santa',
  serie_complete: 'Série complète', admin: 'Ajustement admin',
};
// Valeurs de repli = valeurs actuelles en base (hg_settings.cards, lues le 22/10/2026 ; migration 053 les reprend côté SQL).
// Utilisées seulement si hg_settings.cards est vide, et pour « Rétablir les valeurs par défaut ».
export const CFG_DEFAULT = {
  starting_paillettes: 1000, booster_price: 100, booster_size: 5, free_booster_hours: 24, shiny_rate: 3, pity_epique: 20, max_open_trades: 50,
  rates: { commune: 60, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.88, mythique: 0.1, identite: 0.02 },
  recycle: { commune: 5, peu_commune: 10, rare: 25, epique: 60, legendaire: 150, mythique: 400, identite: 1000, shiny_multiplier: 3 },
  craft: { commune: 100, peu_commune: 150, rare: 200, epique: 750, legendaire: 2000, shiny_multiplier: 6 },
  rewards: { daily: 100, streak_bonus: 20, streak_max: 30, rsvp: 50, presence: 100, photo: 100, moment: 100, gift_sent: 250, badge: 500, capture: 150, event_created: 100, set_complete: 300 },
  quetes_par_semaine: 3,
  drops: { quantite_max: 50, duree_max_min: 1440, duree_defaut_min: 30 },
  alertes: { paillettes_pct: 25, recyclage_pct: 60, booster_pct: 100, concentration_x: 5 },
};
/* Récompenses en Paillettes avec leur libellé ; les clés correspondent à rewards.* de CFG_DEFAULT. */
const REWARDS = [
  ['daily', 'Passage du jour'], ['streak_bonus', 'Bonus par jour de série (en plus)'], ['streak_max', 'Série maximale (jours)'],
  ['rsvp', 'Réponse « oui » à une sortie'], ['presence', 'Présence à une sortie passée'], ['photo', 'Photo publiée'],
  ['moment', 'Moment publié'], ['gift_sent', 'Cadeau Secret Santa envoyé'], ['badge', 'Badge gagné'],
  ['capture', 'Image attrapée (événement)'], ['event_created', 'Sortie ou événement créé'], ['set_complete', 'Série complète (une fois par série)'],
];
// Réglages éditables. k = chemin (« rates.commune ») ; le nom du champ de formulaire remplace chaque point par un tiret bas.
// help = aide courte affichée sous le champ. Défauts : CFG_DEFAULT.
export const ECON = [
  { g: 'Départ', hint: 'Paillettes offertes une seule fois à chaque nouveau joueur.', fields: [
    { k: 'starting_paillettes', l: 'Capital de départ', u: '✦', int: true, help: 'Paillettes données à l\'inscription.' },
  ] },
  { g: 'Boosters', fields: [
    { k: 'booster_price', l: 'Prix d\'un booster', u: '✦', int: true, help: 'Coût d\'un booster acheté par un membre.' },
    { k: 'booster_size', l: 'Cartes par booster', int: true, min: 1, max: 10, help: 'Nombre de cartes tirées dans un booster (1 à 10).' },
    { k: 'free_booster_hours', l: 'Délai du booster gratuit', u: 'heures', step: 0.5, help: 'Un booster gratuit est offert toutes les N heures.' },
  ] },
  { g: 'Taux de tirage', hint: 'Part de chaque rareté dans un booster. Le total devrait faire 100 %.', rates: true,
    fields: RARITY_IDS.map((r) => ({ k: `rates.${r}`, l: rarityLabel(r), u: '%', step: 0.01 })) },
  { g: 'Brillantes et garantie', fields: [
    { k: 'shiny_rate', l: 'Taux de carte brillante', u: '%', step: 0.1, max: 100, help: 'Chance qu\'une carte tirée soit brillante.' },
    { k: 'pity_epique', l: 'Garantie épique : une carte Épique ou mieux tous les N boosters (0 = aucune)', int: true, help: 'Garantit une carte Épique ou mieux après N boosters sans elle.' },
  ] },
  { g: 'Recyclage', hint: 'Paillettes reçues en recyclant un exemplaire.', fields: [
    ...RARITY_IDS.map((r) => ({ k: `recycle.${r}`, l: rarityLabel(r), u: '✦', int: true })),
    { k: 'recycle.shiny_multiplier', l: 'Multiplicateur brillante', u: '×', int: true, min: 1 },
  ] },
  { g: 'Fabrication', hint: 'Coût pour fabriquer une carte précise. Vide = non fabricable. Mythique et Identité ne se fabriquent jamais.', fields: [
    ...CRAFT_IDS.map((r) => ({ k: `craft.${r}`, l: rarityLabel(r), u: '✦', int: true, optional: true })),
    { k: 'craft.shiny_multiplier', l: 'Multiplicateur brillante', u: '×', int: true, min: 1, help: 'Coût d\'une version brillante = coût normal × ce nombre.' },
  ] },
  { g: 'Récompenses', hint: 'Gains en Paillettes liés à l\'activité sur le site.', fields: REWARDS.map(([k, l]) => ({
    k: `rewards.${k}`, l, int: true, min: k === 'streak_max' ? 1 : 0 })) },
  { g: 'Quêtes de la semaine', hint: 'Les quêtes sont tirées au sort chaque semaine parmi les modèles actifs (onglet Quêtes).', fields: [
    { k: 'quetes_par_semaine', l: 'Quêtes tirées chaque semaine', int: true, min: 0, max: 20, help: 'Nombre de quêtes proposées aux membres. Si moins de modèles sont actifs, on en propose moins.' },
  ] },
  { g: 'Cartes sauvages (drops)', hint: 'Bornes du formulaire « Lancer un drop » (Cartes › Drops).', fields: [
    { k: 'drops.quantite_max', l: 'Exemplaires maximum par drop', int: true, min: 1, max: 1000, help: 'Plafond du nombre de cartes à attraper pour un même drop (de 1 à 1000 ; 50 par défaut). Le formulaire « Lancer un drop » ne dépasse jamais cette valeur.' },
    { k: 'drops.duree_max_min', l: 'Durée maximale d\'un drop', u: 'minutes', int: true, min: 1, max: 10080, help: '1440 = 24 h. Au-delà, le drop ne peut pas être lancé.' },
    { k: 'drops.duree_defaut_min', l: 'Durée proposée par défaut', u: 'minutes', int: true, min: 1, max: 10080, help: 'Valeur pré-remplie dans le formulaire ; ne peut pas dépasser la durée maximale.' },
  ] },
  { g: 'Échanges', fields: [{ k: 'max_open_trades', l: 'Offres en cours maximum par personne', int: true, min: 1, help: 'Nombre d\'offres d\'échange qu\'un membre peut avoir ouvertes en même temps.' }] },
  // A7 : seuils du bloc « Santé de l'économie » (Pilotage › Vue d'ensemble), bornés aussi par hg_eco_health.
  { g: 'Alertes économie', hint: 'Seuils des alertes du bloc « Santé de l’économie » (Pilotage › Vue d’ensemble).', fields: [
    { k: 'alertes.paillettes_pct', l: 'Hausse des Paillettes en 7 jours', u: '%', int: true, min: 5, max: 500, help: 'Alerte au-delà (25 % par défaut).' },
    { k: 'alertes.recyclage_pct', l: 'Taux de recyclage de la semaine', u: '%', int: true, min: 10, max: 100, help: 'Cartes recyclées / cartes obtenues ; alerte au-delà (60 % par défaut).' },
    { k: 'alertes.booster_pct', l: 'Rendement d’un booster au recyclage', u: '%', int: true, min: 50, max: 200, help: 'Valeur moyenne au recyclage / prix ; alerte rouge au-delà (100 % par défaut).' },
    { k: 'alertes.concentration_x', l: 'Gains concentrés', u: '× la médiane', step: 0.5, min: 2, max: 50, help: 'Gains de la semaine d’un membre / médiane ; alerte au-delà (5 par défaut).' },
  ] },
];
