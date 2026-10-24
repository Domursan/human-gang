// Faux complémentaire « À faire » des lieux (admin/todos.js), pour tests/parcours-admin-todo.cjs.
// Chargé par scenario.extra = 'fake-sb-todo.mjs'. Données lues dans scenario.todo :
//   auctions : enchères renvoyées par hg_auctions_admin ; proofs : preuves en attente (nombre) ; relance : membres à relancer (nombre)
//   proposals : propositions de cartes en attente (nombre, table hg_card_proposals) ; sutom : décalages (jours) des mots programmés
//   framed : décalages des manches Framed ; heardle : [{ n, cancelled }] manches Heardle ; fail : noms de RPC en erreur.
// Les autres données (assistance, idées, échanges, erreurs, sorties, éditions) se passent dans le scénario même (S.support…).
export default ({ DB, S, ME }) => {
  const T = S.todo || {};
  const fails = new Set(T.fail || []);
  // Jour « AAAA-MM-JJ » décalé de n jours depuis aujourd'hui (UTC), comme les jours de la base.
  const jour = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();

  // Propositions de cartes : n en attente, plus une déjà acceptée (non comptée).
  DB.hg_card_proposals = [
    ...Array.from({ length: T.proposals || 0 }, (_, i) => ({ id: 'prop-' + i, set_id: 'set-1', proposed_by: ME, payload: { name: 'Carte ' + i }, status: 'en_attente', created_at: iso(-i) })),
    { id: 'prop-ok', set_id: 'set-1', proposed_by: ME, payload: { name: 'Acceptée' }, status: 'acceptee', created_at: iso(-50) },
  ];

  return {
    rpc(fn) {
      if (fails.has(fn)) return { data: null, error: { message: 'Erreur simulée : ' + fn } };
      if (fn === 'hg_auctions_admin') return { data: T.auctions || [], error: null };
      if (fn === 'hg_proof_queue') {
        const n = T.proofs || 0;
        return { data: { items: Array.from({ length: n }, (_, i) => ({ id: 'pr-' + i, paths: [], quest_code: 'q3', label: 'Quête 3', pseudo: 'Membre ' + i, week: jour(0), status: 'en_attente', own: false, updated_at: iso(-i - 1), color: '#6FA37F', note: null })), counts: { en_attente: n } }, error: null };
      }
      if (fn === 'hg_admin_to_remind') {
        const n = T.relance || 0;
        return { data: { todo: Array.from({ length: n }, (_, i) => ({ id: 'm-' + i, pseudo: 'Membre ' + i, weeks: 3, never: false, pending: {} })), done: [], paused: [] }, error: null };
      }
      if (fn === 'hg_sutom_admin') {
        return { data: { today: jour(0), dict: 0, bank: [], planned: (T.sutom || []).map((n) => ({ day: jour(n), word: 'MOT' + n, definition: null, picked_by: null })) }, error: null };
      }
      if (fn === 'hg_framed_admin') {
        return { data: { today: jour(0), films: [], rounds: (T.framed || []).map((n) => ({ day: jour(n), film_id: 'f' + n, title: 'Film ' + n, players: 0 })) }, error: null };
      }
      if (fn === 'hg_heardle_admin') {
        return { data: { today: jour(0), tracks: [], rounds: (T.heardle || []).map((h) => ({ day: jour(h.n), track_id: 't' + h.n, title: 'Titre ' + h.n, artist: 'Artiste', cancelled: !!h.cancelled, players: 0 })) }, error: null };
      }
      return undefined; // les autres RPC : réponses par défaut du faux client
    },
  };
};
