// Faux client Supabase des jeux solo (migration 138) : Démineur, Sudoku du jour, 2048 Paillettes.
// Enveloppe fake-sb.mjs (ou window.__SCN.jeuxBase) et répond aux RPC hg_nj_solo_etat, hg_nj_solo_debut et hg_nj_solo_fin
// avec un état en mémoire (window.__SOLO : grille du jour, parties, Paillettes). Les autres appels passent au faux de base.
// Scénario (window.__SCN) : sudokuFait ({ secondes } : grille du jour déjà terminée), sudokuRefuse (le serveur refuse la
// grille envoyée), recompense (Paillettes déjà reçues aujourd'hui), uid, jeuxBase. Le temps de jeu est celui de l'horloge
// réelle entre hg_nj_solo_debut et hg_nj_solo_fin, arrondi au centième, comme le serveur.
// Le faux ne vérifie pas le temps minimal du démineur ni la limite de points du 2048 : ce sont des règles serveur.
// Exporte createClient().
const S = window.__SCN || {};
const prefix = window.__HG_RACINE || ''; // préfixe du site servi (HG_PREFIX), injecté par le harnais
const base = await import(`${location.origin}${prefix}/tests/fixtures/${S.jeuxBase || 'fake-sb.mjs'}`);

const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const uid = () => S.uid || ME;
const today = new Date().toISOString().slice(0, 10);
const ok = (data) => ({ data, error: null });
const err = (message) => ({ data: null, error: { message } });

/* ---------- Grille du jour (sudoku) : 0 = case vide ; solution connue du test ---------- */
const DONNES = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';

/* ---------- État ---------- */
const SOLO = window.__SOLO = {
  solution: SOLUTION,
  donnes: DONNES,
  recompense: { demineur: !!S.recompense, sudoku: !!S.recompense, '2048': !!S.recompense },
  sudokuFait: S.sudokuFait ?? null,
  parties: [],
  // Classements de départ : d'autres membres du gang (le membre connecté s'y ajoute à la fin d'une partie)
  autres: {
    demineur: [{ user_id: U(2), pseudo: 'SwanNex', avatar_url: null, color: '#D97757', score: 112, secondes: 112 }, { user_id: U(3), pseudo: 'Domu', avatar_url: null, color: '#7E93C9', score: 128, secondes: 128 }],
    sudoku: [{ user_id: U(2), pseudo: 'SwanNex', avatar_url: null, color: '#D97757', score: 252, secondes: 252 }, { user_id: U(4), pseudo: 'Zelka', avatar_url: null, color: '#9A88C4', score: 303, secondes: 303 }],
    '2048': [{ user_id: U(2), pseudo: 'Domu', avatar_url: null, color: '#7E93C9', score: 9120, secondes: null }, { user_id: U(3), pseudo: 'Wae', avatar_url: null, color: '#6FA37F', score: 4096, secondes: null }],
  },
};

/** Classement de la semaine pour un jeu et une variante : le meilleur résultat de chacun, trié comme le serveur. */
function classement(jeu) {
  const rows = [...SOLO.autres[jeu]];
  for (const p of SOLO.parties.filter((x) => x.jeu === jeu && x.ok)) {
    const i = rows.findIndex((r) => r.user_id === uid());
    const deja = i >= 0 ? rows[i] : null;
    const mieux = deja && (jeu === '2048' ? p.score > deja.score : p.secondes < deja.secondes);
    if (!deja) rows.push({ user_id: uid(), pseudo: 'Ethan', avatar_url: null, color: '#4F6A8F', score: p.score, secondes: p.secondes });
    else if (mieux) Object.assign(deja, { score: p.score, secondes: p.secondes });
  }
  return rows.sort((a, b) => (jeu === '2048' ? b.score - a.score : a.secondes - b.secondes));
}

/* ---------- RPC ---------- */
const HANDLERS = {
  hg_nj_solo_etat: (a) => {
    const jeu = a.p_jeu;
    const base0 = { jeu, variante: a.p_var, day: today, gain: 10, recompense_aujourdhui: !!SOLO.recompense[jeu], board: classement(jeu) };
    if (jeu === 'sudoku') {
      return ok({ ...base0, day: a.p_var, sudoku: { niveau: 'facile', donnes: SOLO.donnes }, sudoku_fait: SOLO.sudokuFait });
    }
    return ok(base0);
  },
  hg_nj_solo_debut: (a) => {
    const id = `00000000-0000-4000-8000-${String(SOLO.parties.length + 100).padStart(12, '0')}`;
    SOLO.parties.push({ id, jeu: a.p_jeu, var: a.p_var, t0: performance.now(), ok: false });
    return ok(id);
  },
  hg_nj_solo_fin: (a) => {
    const p = SOLO.parties.find((x) => x.id === a.p_run);
    if (!p) return err('Partie introuvable');
    if (p.fin) return err('Partie déjà terminée');
    const res = a.p_res || {};
    const secondes = Math.round((performance.now() - p.t0) / 10) / 100;
    let ok_ = !!res.gagne, score = 0;
    if (p.jeu === 'demineur') score = Math.ceil(secondes);
    else if (p.jeu === 'sudoku') {
      score = Math.ceil(secondes);
      ok_ = ok_ && res.grille === SOLUTION && !S.sudokuRefuse;
    } else {
      score = Math.max(0, Number(res.score) || 0);
      ok_ = score > 0;
    }
    Object.assign(p, { fin: true, ok: ok_, secondes, score, gagne: !!res.gagne });
    let reward = 0;
    if (ok_ && !SOLO.recompense[p.jeu]) { reward = 10; SOLO.recompense[p.jeu] = true; }
    return ok({ ok: ok_, score: ok_ ? score : 0, secondes, reward, board: classement(p.jeu) });
  },
};

/** Client : celui du faux de base, avec les RPC solo en plus. */
export function createClient(...args) {
  const c = base.createClient(...args);
  const rpc0 = c.rpc.bind(c);
  c.rpc = async (fn, a = {}) => {
    if (HANDLERS[fn]) { window.__LOG?.push(['rpc', fn, a]); return HANDLERS[fn](a); }
    return rpc0(fn, a);
  };
  return c;
}
