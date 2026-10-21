// Cartes admin : état partagé de la section (séries, cartes, exemplaires, portefeuilles, échanges, onglet).

/* ---------- État ---------- */
export const C = {
  root: null, panel: null, tab: 'series',
  sets: [], cards: [], copies: [], wallets: [], trades: [], items: [], profiles: [], cfgRaw: {},
  setById: new Map(), cardById: new Map(), copiesByCard: new Map(), copiesByOwner: new Map(), walletById: new Map(), byId: new Map(),
  f: { set: '', rarity: '', family: '' }, identSet: '', playerId: '',
  q: { series: '', cartes: '' }, shown: 50, // recherche par liste ; nombre de cartes affichées (par lots de 50)
};

/** Hook de rendu, renseigné par view.js (évite un import circulaire). */
export const H = { render: () => {} };
