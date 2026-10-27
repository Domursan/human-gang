// Faux client Supabase des tables à cases (Échecs, Dames) : enveloppe fake-sb.mjs et répond aux RPC des duels
// avec window.__DUELS (écrit par le banc tests/bancs/duels/ui/banc-plateaux.html) : hg_duel_possibles renvoie window.__DUELS.possibles,
// hg_duel_etat renvoie window.__DUELS.etat, hg_duel_jouer enregistre le coup dans window.__DUELS.appels ; window.__DUELS.rpc[fn] (facultatif) répond à fn. Les autres appels
// passent au faux de base. Exporte createClient().
// Le banc est sous tests/bancs/duels/ui/ : le socle est tests/fixtures/fake-sb.mjs, relatif à la racine du site servi.
const racine = window.__HG_RACINE || ''; // préfixe du site servi (HG_PREFIX), injecté par le harnais
const base = await import(`${location.origin}${racine}/tests/fixtures/fake-sb.mjs`);

const ok = (data) => ({ data, error: null });
window.__DUELS = window.__DUELS || { possibles: [], etat: null, appels: [] };

const HANDLERS = {
  hg_duel_possibles: () => ok(window.__DUELS.possibles || []),
  hg_duel_etat: () => ok(window.__DUELS.etat),
  hg_duel_jouer: (a) => {
    window.__DUELS.appels.push({ code: a.p_code, coup: a.p_coup, action: a.p_action });
    return ok(null);
  },
  hg_duel_messages: () => ok([]),
  hg_duel_avancer: () => ok(null),
};
/* Facultatif (parcours des défis, parcours/jeux/parcours-duels-defi.cjs) : si window.__DUELS.rpc[fn] est une fonction,
   elle répond à fn (hg_duel_rejoindre, hg_duel_refuser, hg_duel_accueil…) : valeur renvoyée → data, exception → error. */
const parScenario = (fn) => typeof window.__DUELS.rpc?.[fn] === 'function';
const appelScenario = (fn, a) => {
  try { return ok(window.__DUELS.rpc[fn](a)); } catch (e) { return { data: null, error: { message: e?.message || String(e), code: 'P0001' } }; }
};

/** Client : celui du faux de base, avec les RPC des duels à cases en plus. */
export function createClient(...args) {
  const c = base.createClient(...args);
  const rpc0 = c.rpc.bind(c);
  c.rpc = async (fn, a = {}) => {
    if (parScenario(fn)) { window.__LOG?.push(['rpc', fn, a]); return appelScenario(fn, a); }
    if (HANDLERS[fn]) { window.__LOG?.push(['rpc', fn, a]); return HANDLERS[fn](a); }
    return rpc0(fn, a);
  };
  return c;
}
