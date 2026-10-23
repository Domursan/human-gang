// Admin : droits du panel. Source unique des permissions (clé de hg_perm_catalog).
// SECTION_PERM : section (id de <section>) -> permission. « admin » : réservé à l'administrateur (gestion du Staff).
// DOMAINS : coquille du panel (rail, colonne de navigation). Chaque sous-section pointe vers une section existante ;
// les sous-sections « Jeux et cartes » partagent la section #cartes (un onglet chacune). Une sous-section sans droit
// est masquée et jamais montée. Un domaine sans sous-section permise est masqué.
// Utilisé par shell.js (rail, colonne), router.js (routage), live.js (tables visibles) et les sections (canSection).
// Dépend de core/perms.js (permissions en cache, hasPerm) et core/util.js ($$).
import { getCachedPerms, hasPerm } from '../core/perms.js';
import { $$ } from '../core/util.js';

/** Section (id de <section>) -> permission requise. null : pas de permission (apercu gère ses propres tuiles). */
export const SECTION_PERM = {
  apercu: null,
  comptes: 'membres', acces: 'membres', membres: 'membres',
  'secret-santa': 'secret_santa',
  badges: 'badges',
  evenements: 'themes',
  sorties: 'evenements',
  souvenirs: 'souvenirs',
  reglages: 'reglages',
  cartes: 'cartes', drops: 'cartes', defis: 'cartes', quiz: 'quiz',
  sutom: 'souvenirs', // Sutom du gang (J8)
  cagnotte: 'cartes', champions: 'cartes', // idées C13/C15 et C17 (migration 082)
  idees: 'support', assistance: 'support',
  messagerie: 'messages',
  journal: 'journal',
  bot: 'bot',
  theme: 'themes',
  staff: 'admin',
  // Sections ajoutées avec les sous-menus : réglages (clés eggs, profile_fields, table hg_activity) → droit « reglages »
  eggs: 'reglages', fil: 'reglages', champs: 'reglages', social: 'reglages', // social : Vie sociale (migration 090)
  // Page « Jeux » (migration 083) : GeoGuessr (photos des sorties), citations (quiz)
  'jeux-geo': 'souvenirs', 'jeux-citations': 'quiz',
  // Jeux (paquet xJ3) : preuves des quêtes (J11), Framed et Heardle (J9, J10), Bataille (J15)
  preuves: 'preuves', 'jeux-medias': 'souvenirs', bataille: 'cartes',
  // Idées A3 et A4 (migration 092) : Mes jeux (permission « Maître du jeu ») et À relancer. Le Planning (A2) est à part :
  // permis dès qu'une de ses sources l'est (PLANNING_PERMS), chaque bloc étant filtré par la base.
  mj: 'mj', relance: 'membres',
  // Idées « Social et profils » (migration 091) : parrainage et compétences → « membres » ; accueil des membres → « reglages »
  parrainage: 'membres', competences: 'membres', 'accueil-membres': 'reglages',
  // Idées A8 et A9 : Site › Fonctionnement › Erreurs du site (droit « reglages ») et Archives (administrateur seulement)
  erreurs: 'reglages', archives: 'admin',
  // Idées V8, V9 (calendrier, ciné-club) et D3 (commandes slash) : migration 087
  rdv: 'evenements', commandes: 'bot',
  saisons: 'themes', // rendez-vous saisonniers (migration 096) : calendrier de l'Avent, saison des Worlds, anniversaire du gang
};

// Tuiles de la vue d'ensemble : la vue d'ensemble n'est proposée que si au moins une tuile est permise.
const TILE_SECTIONS = ['comptes', 'membres', 'secret-santa', 'idees', 'assistance'];
// Planning (idée A2) : visible si l'une de ces permissions est accordée (quiz, cartes, événements, sorties, Secret Santa, bot).
const PLANNING_PERMS = ['quiz', 'cartes', 'themes', 'evenements', 'secret_santa', 'bot'];

// Sous-menus : `heading` (facultatif) = titre du groupe de sous-sections dans la colonne de navigation et dans la palette
// (« Groupe · Libellé »). Les sous-sections d'un même groupe se suivent. Un groupe sans sous-section permise n'affiche pas
// son titre. Plusieurs sous-sections peuvent monter la même section (`section`) : ce sont alors des « parties » (onglets
// des cartes, parties de l'Économie, des Réglages, des Badges, de l'Accès aux pages), ouvertes par admin.js.
// Les identifiants de sous-section sont uniques sur tout le panel (compteurs de shell.js indexés par identifiant seul).
/** Donne le titre de groupe `heading` à chaque sous-section de la liste. */
const under = (heading, subs) => subs.map((s) => ({ ...s, heading }));

// Domaines et sous-sections, dans l'ordre d'affichage. id = segment de l'URL (#domaine/sous-section).
export const DOMAINS = [
  { id: 'pilotage', label: 'Pilotage', icon: 'gauge', subs: [
    { id: 'apercu', label: "Vue d'ensemble", section: 'apercu' },
    { id: 'planning', label: 'Planning', section: 'planning' },
    { id: 'journal', label: 'Journal', section: 'journal' },
    { id: 'staff', label: 'Staff', section: 'staff' },
  ] },
  { id: 'membres', label: 'Membres', icon: 'users', subs: [
    ...under('Comptes', [
      { id: 'comptes', label: 'Comptes', section: 'comptes' },
      { id: 'relance', label: 'À relancer', section: 'relance' },
      { id: 'invitations', label: 'Invitations', section: 'membres' },
      { id: 'champs', label: 'Champs du profil', section: 'champs' },
      { id: 'social', label: 'Vie sociale', section: 'social' },
    ]),
    ...under('Entraide', [
      { id: 'parrainage', label: 'Parrainage', section: 'parrainage' },
      { id: 'competences', label: 'Compétences', section: 'competences' },
    ]),
    ...under('Accès aux pages', [
      { id: 'acces', label: 'Pages', section: 'acces', part: 'pages' },
      { id: 'acces-matrice', label: 'Matrice membres × pages', section: 'acces', part: 'matrice' },
    ]),
  ] },
  { id: 'vie', label: 'Vie du gang', icon: 'calendar', subs: [
    ...under('Sorties et souvenirs', [
      { id: 'sorties', label: 'Sorties IRL', section: 'sorties' },
      { id: 'souvenirs', label: 'Souvenirs et photos', section: 'souvenirs' },
    ]),
    ...under('Rendez-vous', [
      { id: 'secret-santa', label: 'Secret Santa', section: 'secret-santa' },
      { id: 'evenements', label: 'Événements', section: 'evenements' },
      { id: 'rdv', label: 'Calendrier et ciné', section: 'rdv' },
      { id: 'avent', label: 'Calendrier de l’Avent', section: 'saisons', part: 'avent' },
      { id: 'saison-worlds', label: 'Saison des Worlds', section: 'saisons', part: 'worlds' },
      { id: 'anniv-gang', label: 'Anniversaire du gang', section: 'saisons', part: 'anniv' },
    ]),
    ...under('Badges', [
      { id: 'badges', label: 'Catalogue', section: 'badges', part: 'catalogue' },
      { id: 'badges-attribution', label: 'Attribution', section: 'badges', part: 'attribution' },
      { id: 'badges-criteres', label: 'Critères automatiques', section: 'badges', part: 'criteres' },
    ]),
  ] },
  { id: 'cartes', label: 'Jeux et cartes', icon: 'cards', subs: [
    ...under('Catalogue', [
      { id: 'series', label: 'Séries', section: 'cartes', tab: 'series' },
      { id: 'cartes', label: 'Cartes', section: 'cartes', tab: 'cartes' },
      { id: 'boosters', label: 'Boosters', section: 'cartes', tab: 'boosters' },
    ]),
    ...under('Économie', [
      { id: 'economie', label: 'Paillettes et dons', section: 'cartes', tab: 'economie', part: 'paillettes' },
      { id: 'tirage', label: 'Tirage', section: 'cartes', tab: 'economie', part: 'tirage' },
      { id: 'recyclage', label: 'Recyclage et fabrication', section: 'cartes', tab: 'economie', part: 'recyclage' },
      { id: 'limites', label: 'Limites', section: 'cartes', tab: 'economie', part: 'limites' },
    ]),
    ...under('Animation', [
      { id: 'quetes', label: 'Quêtes', section: 'cartes', tab: 'quetes' },
      { id: 'defis', label: 'Défis du gang', section: 'defis' },
      { id: 'drops', label: 'Drops', section: 'drops' },
      { id: 'cagnotte', label: 'Cagnotte et bulletin', section: 'cagnotte' },
      { id: 'champions', label: 'Cartes Champions', section: 'champions' },
      { id: 'codes', label: 'Codes cadeaux', section: 'cartes', tab: 'codes' },
      { id: 'recettes', label: 'Atelier (recettes)', section: 'cartes', tab: 'recettes' },
      { id: 'encheres', label: 'Enchères', section: 'cartes', tab: 'encheres' },
    ]),
    ...under('Suivi', [
      { id: 'joueurs', label: 'Joueurs', section: 'cartes', tab: 'joueurs' },
      { id: 'echanges', label: 'Échanges', section: 'cartes', tab: 'echanges' },
      { id: 'stats', label: 'Statistiques', section: 'cartes', tab: 'stats' },
    ]),
    ...under('Jeux', [
      { id: 'questions', label: 'Questions du gang', section: 'quiz' },
      { id: 'sutom', label: 'Sutom du gang', section: 'sutom' },
      { id: 'secrets', label: 'Secrets', section: 'eggs' },
      { id: 'geoguessr', label: 'GeoGuessr', section: 'jeux-geo' },
      { id: 'citations', label: 'Citations « Qui a dit ça ? »', section: 'jeux-citations' },
      { id: 'preuves', label: 'Preuves de quêtes', section: 'preuves' },
      { id: 'framed-heardle', label: 'Framed et Heardle', section: 'jeux-medias' },
      { id: 'bataille', label: 'Bataille', section: 'bataille' },
      { id: 'mes-jeux', label: 'Mes jeux', section: 'mj' },
    ]),
  ] },
  { id: 'communication', label: 'Communication', icon: 'chat', subs: [
    ...under('Demandes', [
      { id: 'assistance', label: 'Assistance', section: 'assistance' },
      { id: 'idees', label: 'Boîte à idées', section: 'idees' },
    ]),
    ...under('Conversations', [
      { id: 'messagerie', label: 'Messagerie', section: 'messagerie' },
      { id: 'fil', label: 'Fil d’activité', section: 'fil' },
    ]),
    ...under('Discord', [
      { id: 'bot', label: 'Bot Discord', section: 'bot' },
      { id: 'commandes', label: 'Commandes slash', section: 'commandes' },
    ]),
  ] },
  { id: 'site', label: 'Site', icon: 'globe', subs: [
    ...under('Identité et textes', [
      { id: 'identite', label: 'Identité et mentions légales', section: 'reglages', part: 'identite' },
      { id: 'textes', label: 'Textes et intro', section: 'reglages', part: 'textes' },
      { id: 'menu', label: 'Menu et pied de page', section: 'reglages', part: 'menu' },
    ]),
    ...under('Fonctionnement', [
      { id: 'etat', label: 'État du site', section: 'reglages', part: 'etat' },
      { id: 'erreurs', label: 'Erreurs du site', section: 'erreurs' },
      { id: 'archives', label: 'Archives', section: 'archives' },
      { id: 'reglages', label: 'Clés avancées', section: 'reglages', part: 'cles' },
      { id: 'accueil', label: 'Accueil des membres', section: 'accueil-membres' },
    ]),
    ...under('Apparence', [
      { id: 'theme', label: 'Thème', section: 'theme' },
    ]),
  ] },
];

// Sous-sections retirées au démarrage parce que leur module est absent (ex. section livrée plus tard) : admin.js
// appelle disableSubs avant de construire la coquille. Elles sont alors traitées comme non permises.
const disabled = new Set();
/**
 * Retire des sous-sections du panel (module absent). À appeler avant initShell.
 * @param {...string} ids Identifiants de sous-section (ex. « champs »).
 */
export function disableSubs(...ids) { for (const id of ids) disabled.add(id); }

/**
 * Ai-je accès à cette section ?
 * « apercu » est permis si au moins une de ses tuiles l'est ; « admin » exige l'administrateur.
 * @param {string} id Identifiant de section (voir SECTION_PERM).
 */
export function canSection(id) {
  if (id === 'apercu') return TILE_SECTIONS.some(canSection);
  if (id === 'planning') return PLANNING_PERMS.some((k) => hasPerm(k));
  const need = SECTION_PERM[id];
  if (!need) return false;
  if (need === 'admin') return !!getCachedPerms()?.is_admin;
  return hasPerm(need);
}
/** Au moins une des sections est-elle accessible ? (chargement partagé de données) */
export const anySection = (...ids) => ids.some(canSection);
/** Vrai pour l'administrateur (et non pour un membre du Staff). */
export const isAdminView = () => !!getCachedPerms()?.is_admin;

/** Sous-section permise ? (sous-section = objet de DOMAINS, dont la section donne le droit) */
export const canSub = (sub) => !disabled.has(sub.id) && canSection(sub.section);

/**
 * Domaines permis, avec leurs sous-sections permises (sans domaine vide).
 * Une copie : DOMAINS n'est jamais modifié.
 */
export function visibleDomains() {
  return DOMAINS
    .map((d) => ({ ...d, subs: d.subs.filter(canSub) }))
    .filter((d) => d.subs.length);
}

/**
 * Masque les sections non accessibles et les éléments réservés à l'administrateur.
 * Appelé une fois au démarrage, avant que la coquille ne soit construite.
 */
export function applyPanelAccess() {
  for (const s of $$('.admin-section')) s.hidden = !canSection(s.id);
  if (!isAdminView()) for (const el of $$('[data-admin-only]')) el.hidden = true;
}
