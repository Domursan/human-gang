// =====================================================================
// Cartes admin : état partagé de la section (séries, cartes, exemplaires, portefeuilles, échanges, onglet).
// Un seul objet C, lu et modifié par les autres fichiers de admin-cards/. Les index (…ById, …ByCard) sont
// reconstruits à chaque chargement (data.js).
// Exporte : C (état), H (hook de rendu, branché par view.js).
// =====================================================================

/* ---------- État ---------- */
// État de la section. Les listes contiennent les lignes lues ; les Map servent à retrouver une ligne par son identifiant.
export const C = {
  root: null, panel: null, tab: 'series',
  sets: [], cards: [], copies: [], wallets: [], trades: [], items: [], profiles: [], cfgRaw: {},
  setById: new Map(), cardById: new Map(), copiesByCard: new Map(), copiesByOwner: new Map(), walletById: new Map(), byId: new Map(),
  f: { set: '', rarity: '', family: '' }, identSet: '', playerId: '',
  q: { series: '', cartes: '' }, shown: 50, // recherche par liste ; nombre de cartes affichées (par lots de 50)
};

/** Hook de rendu, renseigné par view.js (évite un import circulaire). */
export const H = { render: () => {} };
