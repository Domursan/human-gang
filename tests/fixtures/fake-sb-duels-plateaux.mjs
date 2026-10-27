// Faux client Supabase des tables à cases (Échecs, Dames) : enveloppe fake-sb.mjs et répond aux RPC des duels
// avec window.__DUELS (écrit par le banc tests/bancs/duels/ui/banc-plateaux.html) : hg_duel_possibles renvoie window.__DUELS.possibles,
// hg_duel_etat renvoie window.__DUELS.etat, hg_duel_jouer enregistre le coup dans window.__DUELS.appels. Les autres appels
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

/** Client : celui du faux de base, avec les RPC des duels à cases en plus. */
export function createClient(...args) {
  const c = base.createClient(...args);
  const rpc0 = c.rpc.bind(c);
  c.rpc = async (fn, a = {}) => {
    if (HANDLERS[fn]) { window.__LOG?.push(['rpc', fn, a]); return HANDLERS[fn](a); }
    return rpc0(fn, a);
  };
  return c;
}
