// Admin : correspondance section -> permission (clé de hg_perm_catalog).
// « admin » : réservé à l'administrateur (gestion du Staff). « apercu » : toujours visible (ses tuiles suivent les droits).
// Une section sans droit est masquée (navigation et contenu) et ses données ne sont pas chargées.
import { getCachedPerms, hasPerm } from '../core/perms.js';
import { $$ } from '../core/util.js';

export const SECTION_PERM = {
  apercu: null,
  comptes: 'membres', fantomes: 'membres', acces: 'membres', membres: 'membres',
  'secret-santa': 'secret_santa',
  badges: 'badges',
  evenements: 'evenements',
  cartes: 'cartes', defis: 'cartes',
  idees: 'support', assistance: 'support',
  messagerie: 'messages',
  journal: 'journal',
  bot: 'bot',
  theme: 'themes',
  staff: 'admin',
};

/** Ai-je accès à cette section ? */
export function canSection(id) {
  if (id === 'apercu') return !!getCachedPerms();
  const need = SECTION_PERM[id];
  if (!need) return false;
  if (need === 'admin') return !!getCachedPerms()?.is_admin;
  return hasPerm(need);
}
/** Au moins une des sections est-elle accessible ? (chargement partagé de données) */
export const anySection = (...ids) => ids.some(canSection);
export const isAdminView = () => !!getCachedPerms()?.is_admin;

/** Masque la navigation et les sections non accessibles. Les sections masquées ne sont pas initialisées. */
export function applyPanelAccess() {
  for (const a of $$('.admin-nav a')) a.hidden = !canSection(a.getAttribute('href').slice(1));
  for (const s of $$('.admin-section')) s.hidden = !canSection(s.id);
  if (!isAdminView()) for (const el of $$('[data-admin-only]')) el.hidden = true;
}
