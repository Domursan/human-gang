// Admin : droits du panel. Source unique des permissions (clé de hg_perm_catalog).
// SECTION_PERM : section (id de <section>) -> permission. « admin » : réservé à l'administrateur (gestion du Staff).
// DOMAINS : coquille du panel (rail, colonne de navigation). Chaque sous-section pointe vers une section existante ;
// les sous-sections « Jeu de cartes » partagent la section #cartes (un onglet chacune). Une sous-section sans droit
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
  cartes: 'cartes', drops: 'cartes', defis: 'cartes',
  idees: 'support', assistance: 'support',
  messagerie: 'messages',
  journal: 'journal',
  bot: 'bot',
  theme: 'themes',
  staff: 'admin',
};

// Tuiles de la vue d'ensemble : la vue d'ensemble n'est proposée que si au moins une tuile est permise.
const TILE_SECTIONS = ['comptes', 'membres', 'secret-santa', 'idees', 'assistance'];

// Domaines et sous-sections, dans l'ordre d'affichage. id = segment de l'URL (#domaine/sous-section).
export const DOMAINS = [
  { id: 'pilotage', label: 'Pilotage', icon: 'gauge', subs: [
    { id: 'apercu', label: "Vue d'ensemble", section: 'apercu' },
    { id: 'journal', label: 'Journal', section: 'journal' },
    { id: 'staff', label: 'Staff', section: 'staff' },
  ] },
  { id: 'membres', label: 'Membres', icon: 'users', subs: [
    { id: 'comptes', label: 'Comptes', section: 'comptes' },
    { id: 'invitations', label: 'Invitations', section: 'membres' },
    { id: 'acces', label: 'Accès aux pages', section: 'acces' },
  ] },
  { id: 'vie', label: 'Vie du gang', icon: 'calendar', subs: [
    { id: 'sorties', label: 'Sorties IRL', section: 'sorties' },
    { id: 'souvenirs', label: 'Souvenirs et photos', section: 'souvenirs' },
    { id: 'secret-santa', label: 'Secret Santa', section: 'secret-santa' },
    { id: 'evenements', label: 'Événements', section: 'evenements' },
    { id: 'badges', label: 'Badges', section: 'badges' },
  ] },
  { id: 'cartes', label: 'Jeu de cartes', icon: 'cards', subs: [
    { id: 'series', label: 'Séries', section: 'cartes', tab: 'series' },
    { id: 'cartes', label: 'Cartes', section: 'cartes', tab: 'cartes' },
    { id: 'quetes', label: 'Quêtes', section: 'cartes', tab: 'quetes' },
    { id: 'economie', label: 'Économie', section: 'cartes', tab: 'economie' },
    { id: 'joueurs', label: 'Joueurs', section: 'cartes', tab: 'joueurs' },
    { id: 'stats', label: 'Statistiques', section: 'cartes', tab: 'stats' },
    { id: 'echanges', label: 'Échanges', section: 'cartes', tab: 'echanges' },
    { id: 'drops', label: 'Drops', section: 'drops' },
    { id: 'defis', label: 'Défis du gang', section: 'defis' },
  ] },
  { id: 'communication', label: 'Communication', icon: 'chat', subs: [
    { id: 'assistance', label: 'Assistance', section: 'assistance' },
    { id: 'idees', label: 'Boîte à idées', section: 'idees' },
    { id: 'messagerie', label: 'Messagerie', section: 'messagerie' },
    { id: 'bot', label: 'Bot Discord', section: 'bot' },
  ] },
  { id: 'site', label: 'Site', icon: 'globe', subs: [
    { id: 'reglages', label: 'Réglages', section: 'reglages' },
    { id: 'theme', label: 'Thème', section: 'theme' },
  ] },
];

/**
 * Ai-je accès à cette section ?
 * « apercu » est permis si au moins une de ses tuiles l'est ; « admin » exige l'administrateur.
 * @param {string} id Identifiant de section (voir SECTION_PERM).
 */
export function canSection(id) {
  if (id === 'apercu') return TILE_SECTIONS.some(canSection);
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
export const canSub = (sub) => canSection(sub.section);

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
