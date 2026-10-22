// Faux client Supabase pour l'onglet « Réponses et statistiques » des Questions du gang (tests/parcours-admin-quiz-stats.cjs).
// Servi à la place de supabase-js (voir lib/harness.cjs). Simule les RPC hg_quiz_stats, hg_quiz_answers_list et
// hg_quiz_validate à partir de données de démonstration, avec les mêmes formes de réponse que la base (migration 061).
// Scénarios (window.__SCN) : empty (aucune question), statsError (hg_quiz_stats échoue), validateError (validation refusée).
// Expose window.__QUIZ (données de démonstration, pour que les tests calculent leurs attendus) et window.__LOG (journal).
// Exporte createClient(). Ne doit jamais être remplacé par le vrai client : il est servi à la place de supabase-js.

/* ---------- Scénario et données de démonstration ---------- */
const S = window.__SCN || {};
window.__LOG = window.__LOG || [];
const MOI = 'u-ethan';
const JOUEURS = { E: ['u-ethan', 'Ethan'], A: ['u-alice', 'Alice'], B: ['u-bruno', 'Bruno'], C: ['u-chloe', 'Chloé'], D: ['u-david', 'David'], M: ['u-emma', 'Emma'] };
const JOUR = 864e5;
const now = Date.now();
const iso = (jours) => new Date(now + jours * JOUR).toISOString();

// Cinq questions : une par type sauf le texte (deux types de choix, un vrai ou faux, un texte, un nombre). Q5 est close.
const QUESTIONS = [
  { id: 'q1', prompt: 'Quelle est la capitale de la Suisse ?', qtype: 'choix_unique', difficulty: 'facile', category: 'Culture', reward: 50,
    options: [{ id: 'a', text: 'Zurich' }, { id: 'b', text: 'Berne' }, { id: 'c', text: 'Genève' }], active: true, starts: -10, ends: null },
  { id: 'q2', prompt: 'Le lac Léman est-il le plus grand lac entièrement situé en Suisse ?', qtype: 'vrai_faux', difficulty: 'difficile', category: 'Géographie', reward: 250,
    options: [{ id: 'vrai' }, { id: 'faux' }], active: true, starts: -8, ends: null },
  { id: 'q3', prompt: 'Quels cantons ont une frontière avec l’Italie ?', qtype: 'choix_multiple', difficulty: 'expert', category: 'Géographie', reward: 500,
    options: [{ id: 'a', text: 'Tessin' }, { id: 'b', text: 'Valais' }, { id: 'c', text: 'Grisons' }, { id: 'd', text: 'Vaud' }], active: true, starts: -6, ends: null },
  { id: 'q4', prompt: 'Comment s’appelle le gang en un mot ?', qtype: 'texte', difficulty: 'facile', category: 'Gang', reward: 50,
    options: [], active: true, starts: -4, ends: null },
  { id: 'q5', prompt: 'Combien de cartes compte une série complète ?', qtype: 'nombre', difficulty: 'moyen', category: 'Cartes', reward: 100,
    options: [], active: true, starts: -20, ends: -1 },
];

// Réponses : [question, joueur (clé de JOUEURS), réponse, résultat (true, false, ou null = en attente)].
// Les réponses libres (q4) sont en attente : elles doivent être validées à la main.
const REPONSES = [
  ['q1', 'A', 'b', true], ['q1', 'B', 'a', false], ['q1', 'C', 'b', true], ['q1', 'D', 'b', true], ['q1', 'M', 'c', false], ['q1', 'E', 'b', true],
  ['q2', 'A', 'vrai', false], ['q2', 'B', 'faux', true], ['q2', 'C', 'vrai', false], ['q2', 'D', 'vrai', false], ['q2', 'M', 'faux', true],
  ['q3', 'A', ['a', 'b', 'c'], true], ['q3', 'B', ['a', 'd'], false],
  ['q4', 'A', 'Humane Gang', null], ['q4', 'B', 'humane gang', null], ['q4', 'C', 'HG', null], ['q4', 'D', 'Human Gang', null], ['q4', 'M', 'Le gang', null],
  ['q5', 'A', 12, true], ['q5', 'B', 11, false], ['q5', 'C', 12, true], ['q5', 'M', 12, true], ['q5', 'D', 13, false],
];

const DB = { questions: [], answers: [] };
if (!S.empty) {
  DB.questions = QUESTIONS.map((q, i) => ({ ...q, created_at: iso(-30 + i), starts_at: iso(q.starts), ends_at: q.ends == null ? null : iso(q.ends) }));
  DB.answers = REPONSES.map(([qid, cle, reponse, ok], i) => {
    const q = DB.questions.find((x) => x.id === qid);
    const [user_id, pseudo] = JOUEURS[cle];
    return {
      id: i + 1, question_id: qid, prompt: q.prompt, qtype: q.qtype, difficulty: q.difficulty, user_id, pseudo, response: reponse,
      is_correct: ok, reward: ok ? q.reward : 0, answered_at: iso(-(0.5 + i * 0.35)),
      reviewed_at: ok === null ? null : iso(-(0.4 + i * 0.35)),
    };
  });
}
window.__QUIZ = DB; // données visibles par les tests (attendus calculés à partir d'elles)

/* ---------- Calculs semblables à ceux de la base ---------- */
/** Question d'une réponse (par id). */
const questionDe = (id) => DB.questions.find((q) => q.id === id);
/** Vrai si la question est ouverte à l'instant présent. */
const ouverte = (q) => q.active && new Date(q.starts_at) <= Date.now() && (!q.ends_at || new Date(q.ends_at) > Date.now());
/** Forme normalisée d'une réponse libre : sans accents, casse ni ponctuation, espaces réduits (comme hg_quiz_norm). */
const normalise = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Liste des choix d'une réponse (tableau ou valeur seule). */
const choixDe = (r) => (Array.isArray(r.response) ? r.response : [r.response]);

/** Réponse de hg_quiz_stats : résumé, par difficulté, par question, par membre. */
function statistiques() {
  const ans = DB.answers, qs = DB.questions;
  const compte = (f) => ans.filter(f).length;
  const summary = {
    questions: qs.length, open: qs.filter(ouverte).length,
    answers: ans.length, correct: compte((a) => a.is_correct === true), wrong: compte((a) => a.is_correct === false),
    pending: compte((a) => a.is_correct === null), players: new Set(ans.map((a) => a.user_id)).size,
    paillettes: ans.reduce((s, a) => s + (a.reward || 0), 0),
    last_7_days: compte((a) => Date.now() - new Date(a.answered_at) < 7 * JOUR),
  };
  const by_difficulty = ['facile', 'moyen', 'difficile', 'expert'].map((d) => ({
    difficulty: d, questions: qs.filter((q) => q.difficulty === d).length,
    answers: compte((a) => questionDe(a.question_id).difficulty === d),
    correct: compte((a) => questionDe(a.question_id).difficulty === d && a.is_correct === true),
  }));
  const questions = qs.map((q) => {
    const mes = ans.filter((a) => a.question_id === q.id);
    const choices = {};
    if (['choix_unique', 'choix_multiple', 'vrai_faux'].includes(q.qtype)) {
      for (const a of mes) for (const x of choixDe(a)) choices[x] = (choices[x] || 0) + 1;
    }
    const groupes = new Map();
    if (['texte', 'nombre'].includes(q.qtype)) {
      for (const a of mes) {
        const cle = normalise(a.response);
        const g = groupes.get(cle) || { text: String(a.response), n: 0 };
        g.n += 1; if (String(a.response) < g.text) g.text = String(a.response);
        groupes.set(cle, g);
      }
    }
    const top_texts = [...groupes.values()].sort((x, y) => y.n - x.n).slice(0, 10);
    return {
      id: q.id, prompt: q.prompt, type: q.qtype, difficulty: q.difficulty, category: q.category, reward: q.reward,
      options: q.options, active: q.active, starts_at: q.starts_at, ends_at: q.ends_at,
      answers: mes.length, correct: mes.filter((a) => a.is_correct === true).length, pending: mes.filter((a) => a.is_correct === null).length,
      paillettes: mes.reduce((s, a) => s + (a.reward || 0), 0), choices, top_texts,
    };
  }).sort((a, b) => b.id.localeCompare(a.id));
  const parJoueur = new Map();
  for (const a of ans) {
    const p = parJoueur.get(a.user_id) || { user_id: a.user_id, pseudo: a.pseudo, answers: 0, correct: 0, paillettes: 0 };
    p.answers += 1; if (a.is_correct === true) p.correct += 1; p.paillettes += a.reward || 0;
    parJoueur.set(a.user_id, p);
  }
  const players = [...parJoueur.values()].sort((x, y) => y.correct - x.correct || y.paillettes - x.paillettes);
  return { summary, by_difficulty, questions, players };
}

/** Réponses pour hg_quiz_answers_list : les plus récentes d'abord, avec le pseudo et l'énoncé. */
function listeReponses(question, enAttenteSeule) {
  return DB.answers
    .filter((a) => (!question || a.question_id === question) && (!enAttenteSeule || a.is_correct === null))
    .sort((a, b) => new Date(b.answered_at) - new Date(a.answered_at))
    .slice(0, 500)
    .map(({ id, question_id, prompt, qtype, difficulty, user_id, pseudo, response, is_correct, reward, answered_at, reviewed_at }) =>
      ({ id, question_id, prompt, qtype, difficulty, user_id, pseudo, response, is_correct, reward, answered_at, reviewed_at }));
}

/* ---------- Requêtes de table : vides (l'onglet n'en lit aucune) ---------- */
class Requete {
  select() { return this; } insert() { return this; } update() { return this; } upsert() { return this; } delete() { return this; }
  eq() { return this; } neq() { return this; } in() { return this; } is() { return this; } or() { return this; } not() { return this; }
  gte() { return this; } lte() { return this; } gt() { return this; } lt() { return this; } ilike() { return this; } match() { return this; }
  order() { return this; } limit() { return this; } range() { return this; } filter() { return this; }
  single() { return Promise.resolve({ data: null, error: null }); }
  maybeSingle() { return Promise.resolve({ data: null, error: null }); }
  then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); }
}

/* ---------- Client exporté ---------- */
/** Point d'entrée : crée le faux client utilisé par le site à la place de supabase-js. */
export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: MOI } } }, error: null }),
      getUser: async () => ({ data: { user: { id: MOI } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => new Requete(),
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: async () => {},
    /** Simule les RPC de l'onglet. Une fonction inconnue renvoie null sans erreur, comme le client réel. */
    rpc: async (fn, args = {}) => {
      window.__LOG.push(['rpc', fn, args]);
      if (fn === 'hg_quiz_stats') {
        if (S.statsError) return { data: null, error: { message: 'Réponse du serveur indisponible (test)' } };
        return { data: statistiques(), error: null };
      }
      if (fn === 'hg_quiz_answers_list') return { data: listeReponses(args.p_question, !!args.p_pending_only), error: null };
      if (fn === 'hg_quiz_validate') {
        if (S.validateError) return { data: null, error: { message: 'Validation refusée (test)' } };
        const a = DB.answers.find((x) => x.id === args.p_answer);
        if (!a) return { data: null, error: { message: 'Réponse introuvable' } };
        if (a.is_correct !== null) return { data: null, error: { message: 'Cette réponse est déjà corrigée' } };
        a.is_correct = !!args.p_correct;
        a.reward = a.is_correct ? questionDe(a.question_id).reward : 0;
        a.reviewed_at = new Date().toISOString();
        return { data: { correct: a.is_correct, reward: a.reward }, error: null };
      }
      return { data: null, error: null };
    },
  };
}
