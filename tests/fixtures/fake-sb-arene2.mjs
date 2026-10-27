// Faux client Supabase de l'Arène v2 (paquet Arène v2, docs/ARENE.md) : hg_arena_me, hg_arena_attack, hg_arena_seen,
// hg_arena_board, hg_arena_admin, hg_arena_settings_save, hg_arena_season_close. Enveloppe le faux de l'Arène actuelle
// (fake-sb-jeux3.mjs, qui fournit hg_battle_set_deck et le reste). Ajout seulement : aucune RPC existante n'est modifiée.
// Scénario (window.__SCN) : uid (membre connecté ; par défaut l'administrateur Ethan), v2Public (Arène ouverte aux membres).
// État en mémoire (window.__ARENE) ; chaque appel est journalisé dans window.__LOG comme les autres RPC.
// Exporte createClient().
const S = window.__SCN || {};
const prefix = window.__HG_RACINE || ''; // préfixe du site servi (HG_PREFIX), injecté par le harnais
const base = await import(`${location.origin}${prefix}/tests/fixtures/fake-sb-jeux3.mjs`);

const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const uid = () => S.uid || ME;
const isAdmin = () => uid() === ME;
const ok = (data) => ({ data, error: null });
const err = (message) => ({ data: null, error: { message } });

/* ---------- Réglages et état ---------- */
const CFG = () => ({
  v2_public: !!S.v2Public, actif: true, gains: true, depart: 1000, plancher: 500, k: 32, reset_pct: 50, duree_jours: 30, min_combats: 3,
  attaques_jour: 5, meme_adversaire: 2, defenses_recues_jour: 4, gain_jour: 5, gain_defense: 3, defenses_jour: 3, plafond_jour: 20, plafond_saison: 300,
  seuils: { argent: 1050, or: 1200, diamant: 1400, legende: 1600 }, recompenses: { argent: 10, or: 25, diamant: 50, legende: 100 },
  boosters: { diamant: 1, legende: 2 }, podium: { 1: 150, 2: 100, 3: 60 },
});
const SEASON = () => ({ id: 1, label: 'Saison 1', starts_at: new Date(Date.now() - 3 * 864e5).toISOString(), ends_at: new Date(Date.now() + 27 * 864e5).toISOString() });
const A = window.__ARENE = window.__ARENE || {
  cfg: CFG(), season: SEASON(), ratings: { [ME]: 1000, [U(2)]: 1180, [U(3)]: 1000, [U(4)]: 1430 }, matches: { [ME]: 3, [U(2)]: 4, [U(3)]: 3, [U(4)]: 4 },
  fights: [], past: [], closed: false, seq: 0,
};

/* ---------- Cartes (mains) : mêmes exemplaires que l'Arène actuelle, avec des cotes de puissance ---------- */
const CARD = (copy_id, name, rarity, family, shiny = false) => ({ copy_id, card_id: 'c' + copy_id, name, rarity, family, shiny, image_url: null, number: copy_id,
  power: ({ commune: 1, peu_commune: 2, rare: 3, epique: 4, legendaire: 5, mythique: 6, identite: 6, unique: 6 })[rarity] + (shiny ? 1 : 0) });
const COPIES = [CARD(1, 'La Domu-mobile', 'epique', 'objet'), CARD(2, 'Xali', 'rare', 'membre'), CARD(3, 'Tzatzikistan', 'legendaire', 'moment'),
  CARD(4, 'Le chalet', 'commune', 'lieu'), CARD(5, 'Raclette 2023', 'commune', 'moment'), CARD(6, 'Serge', 'mythique', 'moment'), CARD(7, 'Ethan', 'identite', 'membre')];
const DEF = [CARD(11, 'Lyon 2026', 'commune', 'lieu'), CARD(12, 'Le gobelet', 'peu_commune', 'objet', true), CARD(13, 'Wae', 'rare', 'membre'), CARD(14, 'Serge', 'mythique', 'moment'), CARD(15, 'La gare', 'rare', 'lieu')];
const beats = (a, b) => ({ membre: 'objet', objet: 'lieu', lieu: 'moment', moment: 'membre' })[a] === b;
const LIGUE = (r) => (r >= A.cfg.seuils.legende ? 'legende' : r >= A.cfg.seuils.diamant ? 'diamant' : r >= A.cfg.seuils.or ? 'or' : r >= A.cfg.seuils.argent ? 'argent' : 'bronze');
const PSEUDO = { [ME]: 'Ethan', [U(2)]: 'Alice', [U(3)]: 'Bruno', [U(4)]: 'Chloé', [U(5)]: 'David' };
const COULEUR = { [U(2)]: '#D97757', [U(3)]: '#7E93C9', [U(4)]: '#8F5F4F' };
const DECK_OF = (id) => (id === U(3) ? null : DEF.map((c) => ({ ...c })));
const today = () => new Date().toISOString().slice(0, 10);
const cote = (id) => A.ratings[id] ?? A.cfg.depart;
const mesCombats = () => A.fights.filter((f) => f.attacker_id === uid() || f.defender_id === uid());
const aujourdhui = (f) => f.created_at.slice(0, 10) === today();
const vueDe = (f, me) => ({ id: f.id, created_at: f.created_at, season_id: 1, role: f.attacker_id === me ? 'attaque' : 'defense',
  attacker: { id: f.attacker_id, pseudo: PSEUDO[f.attacker_id] || 'Ethan', color: '#4F6A8F' }, defender: { id: f.defender_id, pseudo: PSEUDO[f.defender_id] || 'Alice', color: COULEUR[f.defender_id] || '#4F6A8F' },
  attack: f.attack, defense: f.defense, duels: f.duels, wins_a: f.wins_a, wins_d: f.wins_d, result: f.result,
  paid: f.attacker_id === me ? f.paid_a : f.paid_d, rating: f.attacker_id === me ? f.rating_a : f.rating_d, delta: f.attacker_id === me ? f.delta_a : f.delta_d, seen: !!f.seen });

/* ---------- RPC ---------- */
function arenaMe() {
  if (!(A.cfg.v2_public || isAdmin())) return err('L’Arène v2 n’est pas encore ouverte aux membres');
  const me = uid(), c = A.cfg, r = cote(me);
  const mine = A.fights.filter((f) => f.attacker_id === me && aujourdhui(f));
  const recus = A.fights.filter((f) => f.defender_id === me && aujourdhui(f));
  const classes = Object.keys(A.ratings).filter((id) => (A.matches[id] || 0) >= c.min_combats).sort((a, b) => cote(b) - cote(a));
  const rk = classes.indexOf(me);
  const opp = [U(2), U(3), U(4), U(5)].filter((id) => id !== me).map((id) => ({ id, pseudo: PSEUDO[id], color: COULEUR[id], rating: cote(id), league: LIGUE(cote(id)),
    has_deck: !!DECK_OF(id), attacks_today: A.fights.filter((f) => f.attacker_id === me && f.defender_id === id && aujourdhui(f)).length,
    received_today: A.fights.filter((f) => f.defender_id === id && aujourdhui(f)).length }))
    .sort((a, b) => Math.abs(a.rating - r) - Math.abs(b.rating - r));
  const wins = A.fights.filter((f) => (f.attacker_id === me && f.result === 'victoire') || (f.defender_id === me && f.result === 'defaite')).length;
  const losses = A.fights.filter((f) => (f.attacker_id === me && f.result === 'defaite') || (f.defender_id === me && f.result === 'victoire')).length;
  const draws = A.fights.filter((f) => (f.attacker_id === me || f.defender_id === me) && f.result === 'egalite').length;
  return ok({ admin: isAdmin(), me_id: me, preview: !c.v2_public, cfg: c, season: { id: A.season.id, label: A.season.label, starts_at: A.season.starts_at, ends_at: A.season.ends_at },
    me: { rating: r, league: LIGUE(r), rank: rk >= 0 ? rk + 1 : null, matches: A.matches[me] || 0, wins, losses, draws, peak: r,
      qualified: (A.matches[me] || 0) >= c.min_combats, attacks_today: mine.length, attacks_left: Math.max(0, c.attaques_jour - mine.length),
      paid_today: 0, defenses_today: 0, received_today: recus.length, unseen: mesCombats().filter((f) => f.defender_id === me && !f.seen).length },
    deck: window.__J3?.deck ?? null, deck_ids: window.__J3?.deck ? window.__J3.deck.map((x) => x.copy_id) : null,
    copies: COPIES.slice().sort((a, b) => b.power - a.power || a.name.localeCompare(b.name)),
    opponents: opp.slice(0, 8), history: mesCombats().slice().reverse().map((f) => vueDe(f, me)),
    past: A.past.map((p) => ({ ...p })) });
}

function attack(def, ids) {
  if (!ids || ids.length !== 5) return err('Choisis exactement 5 cartes');
  const me = uid(), c = A.cfg;
  if (A.fights.filter((f) => f.attacker_id === me && aujourdhui(f)).length >= c.attaques_jour) return err(`Assez de combats pour aujourd’hui (${c.attaques_jour} au plus). Reviens demain !`);
  if (A.fights.filter((f) => f.attacker_id === me && f.defender_id === def && aujourdhui(f)).length >= c.meme_adversaire) return err(`Tu as déjà attaqué ce membre ${c.meme_adversaire} fois aujourd’hui`);
  if (A.fights.filter((f) => f.defender_id === def && aujourdhui(f)).length >= c.defenses_recues_jour) return err('Ce membre a déjà reçu assez d’attaques aujourd’hui. Reviens demain !');
  if (!DECK_OF(def)) return err('Ce membre n’a pas encore de deck de défense');
  const a = ids.map((id) => COPIES.find((x) => x.copy_id === id));
  const d = DECK_OF(def);
  let wa = 0, wd = 0;
  const duels = a.map((x, i) => {
    let pa = x.power, pd = d[i].power, adv = null;
    if (beats(x.family, d[i].family)) { pa += 2; adv = 'a'; } else if (beats(d[i].family, x.family)) { pd += 2; adv = 'd'; }
    if (pa > pd) wa++; else if (pd > pa) wd++;
    return { a: pa, d: pd, adv, win: pa > pd ? 'a' : pd > pa ? 'd' : 'nul' };
  });
  const res = wa > wd ? 'victoire' : wd > wa ? 'defaite' : 'egalite';
  const ra = cote(me), rd = cote(def);
  const sa = res === 'victoire' ? 1 : res === 'defaite' ? 0 : 0.5;
  const ea = 1 / (1 + Math.pow(10, (rd - ra) / 400));
  const dl = Math.round(c.k * (sa - ea));
  A.ratings[me] = ra + dl; A.ratings[def] = Math.max(c.plancher, rd - dl);
  A.matches[me] = (A.matches[me] || 0) + 1; A.matches[def] = (A.matches[def] || 0) + 1;
  const f = { id: 'arene-' + (++A.seq), created_at: new Date().toISOString(), season_id: 1, attacker_id: me, defender_id: def, attack: a, defense: d,
    duels, wins_a: wa, wins_d: wd, result: res, rating_a: ra, rating_d: rd, delta_a: A.ratings[me] - ra, delta_d: A.ratings[def] - rd,
    paid_a: res === 'victoire' ? 5 : 0, paid_d: res === 'defaite' ? 3 : 0, seen: false };
  A.fights.push(f);
  return ok(vueDe(f, me));
}

function board(season) {
  const sid = season ?? 1;
  const closed = A.closed && sid === 1;
  if (sid !== 1 && !A.past.some((p) => p.id === sid)) return err('Saison introuvable');
  if (sid !== 1) { const p = A.past.find((x) => x.id === sid); return ok({ season: { id: sid, label: p.season, starts_at: p.ends_at, ends_at: p.ends_at, status: 'close' }, participants: 2,
    top: [{ rank: 1, user_id: U(4), pseudo: 'Chloé', color: '#8F5F4F', rating: 1430, league: 'diamant', wins: 3, matches: 4, paid: 200 }, { rank: 2, user_id: ME, pseudo: 'Ethan', color: '#4F6A8F', rating: 1040, league: 'bronze', wins: 1, matches: 4, paid: 100 }], me: { rank: 2, rating: 1040, league: 'bronze', wins: 1, matches: 4 } }); }
  const classes = Object.keys(A.ratings).filter((id) => (A.matches[id] || 0) >= A.cfg.min_combats).sort((a, b) => cote(b) - cote(a));
  const top = classes.map((id, i) => ({ rank: i + 1, user_id: id, pseudo: PSEUDO[id] || 'Membre', color: COULEUR[id] || '#4F6A8F', rating: cote(id), league: LIGUE(cote(id)),
    wins: A.fights.filter((f) => (f.attacker_id === id && f.result === 'victoire') || (f.defender_id === id && f.result === 'defaite')).length, matches: A.matches[id] || 0, paid: null }));
  const me = top.find((x) => x.user_id === uid());
  return ok({ season: { id: 1, label: A.season.label, starts_at: A.season.starts_at, ends_at: A.season.ends_at, status: closed ? 'close' : 'en_cours' },
    participants: top.length, top: top.slice(0, 20), me: me ? { rank: me.rank, rating: me.rating, league: me.league, wins: me.wins, matches: me.matches } : null });
}

function settings(p) {
  for (const [k, v] of Object.entries(p)) {
    if (k === 'v2_public') { if (!isAdmin()) return err('Seul l’administrateur peut ouvrir l’Arène aux membres'); A.cfg.v2_public = !!v; continue; }
    if (k === 'actif' || k === 'gains') { A.cfg[k] = !!v; continue; }
    const n = Number(v);
    const m = k.match(/^(seuils|recompenses|boosters|podium)_(.+)$/);
    if (m) { A.cfg[m[1]][m[2]] = n; continue; }
    if (n < 0 || n > 9999) return err(`Valeur hors limites pour ${k}`);
    A.cfg[k] = n;
  }
  return ok(A.cfg);
}

const HANDLERS = {
  hg_arena_me: () => arenaMe(),
  hg_arena_attack: (a) => attack(a.p_defender, a.p_copies),
  hg_arena_seen: () => { const n = mesCombats().filter((f) => f.defender_id === uid() && !f.seen).length; A.fights.forEach((f) => { if (f.defender_id === uid()) f.seen = true; }); return ok(n); },
  hg_arena_board: (a) => board(a.p_season ?? null),
  hg_arena_admin: () => (isAdmin() || window.__SCN?.staff ? ok({ admin: isAdmin(), cfg: A.cfg, board: board(1).data, fights_today: A.fights.filter(aujourdhui).length,
    seasons: [{ id: 1, label: A.season.label, starts_at: A.season.starts_at, ends_at: A.season.ends_at, closed_at: null, status: A.closed ? 'close' : 'en_cours', participants: 2, paid: 300 }, ...A.past] }) : err('Réservé au Staff « cartes »')),
  hg_arena_settings_save: (a) => (isAdmin() || window.__SCN?.staff ? settings(a.p) : err('Réservé au Staff « cartes »')),
  hg_arena_season_close: () => {
    if (!(isAdmin() || window.__SCN?.staff)) return err('Réservé au Staff « cartes »');
    A.past.push({ id: 1, season: A.season.label, ends_at: A.season.ends_at, rating: cote(ME), league: LIGUE(cote(ME)), rank: 2, matches: A.matches[ME] || 0, wins: 1, losses: 0, draws: 0, paid: 100, boosters: 0 });
    A.closed = true;
    return ok({ season: 1, classes: 2, paillettes: 300, boosters: 0, suivante: 2 });
  },
};

/** Client : celui du faux de l'Arène actuelle, avec les RPC de l'Arène v2 en plus. */
export function createClient(...args) {
  // Scénario deck : l'Arène actuelle a déjà un deck de défense (5 premières cartes).
  if (S.deck && window.__J3 && !window.__J3.deck) window.__J3.deck = COPIES.slice(0, 5);
  const c = base.createClient(...args);
  // Un membre (non administrateur) doit pouvoir ouvrir la page Cartes : la page est en mode « membres » pour ce faux.
  const pg = window.__DB?.hg_pages?.find((x) => x.slug === 'cartes');
  if (pg && !isAdmin()) pg.mode = 'membres';
  const rpc0 = c.rpc.bind(c);
  c.rpc = async (fn, a = {}) => {
    if (HANDLERS[fn]) { window.__LOG.push(['rpc', fn, a]); return HANDLERS[fn](a); }
    return rpc0(fn, a);
  };
  return c;
}
