// Admin : état partagé entre les sections. Un seul objet `S` que toutes les sections lisent et modifient :
// données chargées depuis Supabase (membres, invitations, Secret Santa, badges, idées, assistance, fantômes),
// filtres de recherche et sélections. Ce fichier ne fait aucun appel réseau : loaders.js remplit les données.

/* ---------- État ---------- */
/** État partagé du panel (voir l'en-tête du fichier). */
export const S = {
  members: [], byId: new Map(), invites: [], editions: [], editionId: null, participants: [], exclusions: [],
  badges: [], userBadges: [], ideas: [], support: [], supportReplies: [], meId: null, bot: null, theme: null, ghosts: [],
  badgeMember: '', lastDraw: null, lastCodes: [], ssLoaded: false,
  // Recherche par liste (texte saisi, vide = tout afficher)
  q: { idees: '', assistance: '', membres: '', badges: '' },
};
/** Pseudo d'un membre à partir de son identifiant. « Ancien membre » si l'identifiant est inconnu, « — » s'il est vide. */
export const pseudoOf = (id) => (id ? S.byId.get(id)?.pseudo ?? 'Ancien membre' : '—');
/** Étapes d'une édition Secret Santa, dans l'ordre : [identifiant, libellé]. */
export const STATUS = [
  ['inscriptions', 'Inscriptions ouvertes'], ['tirage', 'Tirage'], ['envoi', 'Envoi des cadeaux'],
  ['revelation', 'Révélation'], ['termine', 'Terminé'],
];
/** Libellé d'une étape : STATUS_LABEL.tirage vaut « Tirage ». */
export const STATUS_LABEL = Object.fromEntries(STATUS);
/** Sujet « bug » du formulaire d'assistance : c'est lui qui donne le badge « Chasseur de bugs ». Doit rester identique au formulaire. */
export const SUBJECT_BUG = 'Bug sur le site';
