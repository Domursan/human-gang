// Admin : état partagé entre les sections (données chargées depuis Supabase, filtres, sélections).

/* ---------- État ---------- */
export const S = {
  members: [], byId: new Map(), invites: [], editions: [], editionId: null, participants: [], exclusions: [],
  badges: [], userBadges: [], ideas: [], support: [], supportReplies: [], meId: null, bot: null, theme: null, ghosts: [],
  ideaFilter: 'nouvelle', supportFilter: 'ouverte', badgeMember: '', lastDraw: null, lastCodes: [], ssLoaded: false,
  // Recherche par liste (texte saisi, vide = tout afficher)
  q: { idees: '', assistance: '', membres: '', badges: '' },
};
export const pseudoOf = (id) => (id ? S.byId.get(id)?.pseudo ?? 'Ancien membre' : '—');
export const STATUS = [
  ['inscriptions', 'Inscriptions ouvertes'], ['tirage', 'Tirage'], ['envoi', 'Envoi des cadeaux'],
  ['revelation', 'Révélation'], ['termine', 'Terminé'],
];
export const STATUS_LABEL = Object.fromEntries(STATUS);
export const SUBJECT_BUG = 'Bug sur le site';
