// Faux client Supabase avec état et données de la collection de cartes (copie de visuel-carte/fake-sb.mjs).
// Sert aux tests de la collection et du panel Jeu de cartes (fixture 'fake-sb-cartes.mjs' passée à openPage() dans lib/harness.cjs).
// Sert au test d'ouverture de booster dans cartes.html (hg_open_booster, hg_cards_me, …).
// Exporte createClient(). Lit window.__SCN ; expose window.__DB, window.__LOG et window.__CARDS (configuration du jeu).

/* ---------- Scénario et constantes ---------- */
const S = window.__SCN || {};
const ME = '11111111-1111-4111-8111-111111111111';
/** Identifiant factice du membre n (même format que ME, pour les données de test). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
// Dates relatives à maintenant : iso(d) donne la date décalée de d jours.
const now = Date.now(), iso = (d) => new Date(now + d * 864e5).toISOString();
// Membres de test : Ethan (le membre connecté, admin) et cinq autres.
const people = [['Ethan', ME], ['Alice', U(2)], ['Bruno', U(3)], ['Chloé', U(4)], ['David', U(5)], ['Emma', U(6)]];
// Codes des badges automatiques (attribués par le site, pas par un admin).
const AUTO = ['premier_noel','veteran','lutin_express','sur_le_fil','liste_parfaite','toujours_la','organisateur','globe_trotter','paparazzi','boite_a_idees','fondateur','fidele','chasseur_bugs','saisonnier','cupidon'];
// Image SVG 16 × 16 d'une citrouille, utilisée comme image de badge et d'événement.
const PUMPKIN = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect x="3" y="4" width="10" height="10" fill="#E8862A"/><rect x="2" y="6" width="12" height="6" fill="#E8862A"/><rect x="7" y="1" width="2" height="3" fill="#3C7A3A"/><rect x="5" y="7" width="2" height="2" fill="#1a1a1a"/><rect x="9" y="7" width="2" height="2" fill="#1a1a1a"/><rect x="5" y="11" width="6" height="1" fill="#1a1a1a"/></svg>');
// Base simulée : données de départ, une clé par table Supabase.
const DB = {
  hg_profiles: people.map(([p, id], i) => ({ id, pseudo: p, is_admin: id === ME, color: '#4F6A8F', avatar_url: null, created_at: iso(-300 + i), joined_on: i === 1 ? '2019-03-12' : null, birthday: null })),
  hg_settings: [{ key: 'theme', value: { mode: 'auto' } }, { key: 'bot', value: { notify: {} } }],
  hg_themes: [{ slug: 'classique', name: 'Classique', is_default: true, active: true, effect: 'aucun', emojis: [], colors: {} }],
  hg_badges: [...AUTO.map((c, i) => ({ code: c, name: c.replace(/_/g, ' '), description: 'Badge automatique', image_url: null, sort: i * 10 })),
    { code: 'roi_karaoke', name: 'Roi du karaoké', description: 'A chanté plus fort que tout le monde', image_url: null, sort: 200 },
    { code: 'citrouille', name: 'Chasseur de citrouilles', description: 'A attrapé des citrouilles d\'Halloween', image_url: PUMPKIN, sort: 210, levels_enabled: true, metric: 'event_captures', event_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      levels: [{ level: 1, threshold: 1, name: 'Bronze' }, { level: 2, threshold: 3, name: 'Argent' }, { level: 3, threshold: 10, name: 'Or' }] },
    { code: 'flocon', name: 'Flocon d\'or', description: 'A attrapé un flocon de Noël', image_url: null, sort: 220, levels_enabled: false, levels: [] }],
  hg_user_badges: [{ user_id: U(2), badge_code: 'roi_karaoke', awarded_at: iso(-3), level: 1 },
    { user_id: ME, badge_code: 'fidele', awarded_at: iso(-200), level: 2 }, { user_id: ME, badge_code: 'citrouille', awarded_at: iso(-1), level: 1 },
    { user_id: ME, badge_code: 'flocon', awarded_at: iso(-305), level: 1 }, { user_id: U(2), badge_code: 'citrouille', awarded_at: iso(-1), level: 2 }],
  hg_invites: [
    { code: 'HG-ABCD', created_by: ME, used_by: null, created_at: iso(-2), link_id: null },
    { code: 'HG-K7P2QX', created_by: ME, used_by: U(3), used_at: iso(-1), created_at: iso(-1.2), link_id: 'L1', expires_at: iso(1) },
    { code: 'HG-M3N8RT', created_by: ME, used_by: null, created_at: iso(-0.3), link_id: 'L1', expires_at: iso(1.7) },
    { code: 'HG-ZZ22AA', created_by: ME, used_by: null, created_at: iso(-4), link_id: 'L1', expires_at: iso(-2) },
  ],
  hg_invite_links: [
    { id: 'L1', token: 'a1b2c3d4e5f6a1b2c3d4e5f6', label: 'Soirée raclette', active: true, max_codes: 10, codes_generated: 3, expires_at: iso(20), created_by: ME, created_at: iso(-5) },
    { id: 'L2', token: 'ffff0000ffff0000ffff0000', label: 'Ancien lien Discord', active: false, max_codes: null, codes_generated: 0, expires_at: null, created_by: ME, created_at: iso(-40) },
  ],
  hg_ss_editions: S.editions || [
    { id: 'E25', year: 2025, status: 'inscriptions', budget: '20 CHF', drawn_at: null, shared_fields: [] },
    { id: 'E24', year: 2024, status: 'termine', budget: '20 CHF', drawn_at: iso(-300), shared_fields: [] },
  ],
  hg_ss_participants: people.map(([, id]) => ({ edition_id: 'E25', user_id: id, joined_at: iso(-5) })),
  hg_ss_exclusions: [{ edition_id: 'E25', user_a: U(2), user_b: U(3) }],
  hg_ss_assignments: [{ edition_id: 'E24', giver_id: ME, receiver_id: U(2) }, { edition_id: 'E24', giver_id: U(2), receiver_id: ME }],
  hg_dyn_events: [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'La citrouille d\'Halloween', description: 'Des citrouilles se baladent sur le site toute la semaine.', image_url: PUMPKIN, emoji: '🎃',
      starts_at: iso(-2), ends_at: iso(5), probability: 1, max_per_page: 2, max_per_user: 20, max_total: null, duration_ms: 7000, size_px: 88,
      badge_code: 'citrouille', announce: true, announced_start_at: iso(-2), announced_end_at: null, active: true, created_by: ME, created_at: iso(-3) },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Flocons de Noël', description: 'Attrape les flocons !', image_url: null, emoji: '❄️',
      starts_at: iso(-320), ends_at: iso(-300), probability: 0.1, max_per_page: 1, max_per_user: null, max_total: 50, duration_ms: 6000, size_px: 64,
      badge_code: 'flocon', announce: true, announced_start_at: iso(-320), announced_end_at: iso(-300), active: true, created_by: ME, created_at: iso(-330) },
    { id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Œufs de Pâques', description: null, image_url: null, emoji: '🥚',
      starts_at: iso(150), ends_at: iso(152), probability: 0.05, max_per_page: 3, max_per_user: null, max_total: null, duration_ms: 5000, size_px: 56,
      badge_code: null, announce: false, announced_start_at: null, announced_end_at: null, active: true, created_by: ME, created_at: iso(-1) },
  ],
  hg_dyn_captures: [],
  hg_pages: [['accueil','Accueil','membres',false],['secret-santa','Secret Santa','membres',true],['irl','IRL','membres',true],['historique','Historique','membres',true],['messages','Messages','membres',true],['evenements','Événements','membres',false],['membre',"Carte d'identité & annuaire",'membres',false],['recap','Récap annuel','membres',false],['cartes','Cartes à collectionner','admin',true]].map(([slug,label,mode,in_nav],sort)=>({slug,label,mode,in_nav,sort})),
  hg_page_access: S.access || [],
  hg_ideas: [], hg_support: [], hg_activity: [], hg_messages: [], hg_events: [], hg_event_rsvps: [], hg_photos: [], hg_profile_info: [],
  hg_card_trades: [], hg_card_trade_items: [],
  // Drops de cartes (card-drops.js, admin-cards/drops.js) : scénario S.drops / S.dropClaims (dates ISO)
  // Drops de cartes : ce que la page reçoit (scénario S.drops et S.dropClaims).
  hg_card_drops: S.drops || [], hg_card_drop_claims: S.dropClaims || [],
};
// Le badge « Fidèle » a des niveaux, pour la page de badges.
Object.assign(DB.hg_badges.find((b) => b.code === 'fidele'), { name: 'Fidèle', description: 'Membre du gang depuis des années', levels_enabled: true, metric: 'anciennete_annees',
  levels: [{ level: 1, threshold: 1, name: 'Bronze' }, { level: 2, threshold: 3, name: 'Argent' }, { level: 3, threshold: 5, name: 'Or', image_url: PUMPKIN }] });
// L'administrateur est membre depuis quatre ans (ancienneté des badges).
DB.hg_profiles[0].created_at = iso(-4 * 365);
// Captures de démonstration : quelques joueurs ont attrapé des citrouilles, puis des flocons.
for (const [u, n] of [[U(2), 4], [ME, 2], [U(3), 1]]) for (let i = 0; i < n; i++) DB.hg_dyn_captures.push({ event_id: 'aaaaaaaa-0000-4000-8000-000000000001', user_id: u, captured_at: iso(-1 + i / 10) });
for (const [u, n] of [[U(4), 6], [ME, 3], [U(5), 2], [U(2), 1]]) for (let i = 0; i < n; i++) DB.hg_dyn_captures.push({ event_id: 'aaaaaaaa-0000-4000-8000-000000000002', user_id: u, captured_at: iso(-310 + i / 10) });
// Rend la base et le journal lisibles par les tests (page.evaluate).
window.__DB = DB; window.__LOG = [];
/* ---------- Collection de cartes (données factices) ---------- */
// ---- données cartes (factices) ----
{
  // Deux séries : « Première édition » et « Saison 2 » (ouverte seulement si le scénario ne demande pas set2Open).
  const sets = [{ id: 'SET1', code: 'hg1', name: 'Première édition', description: 'Les premiers membres du gang.', starts_at: null, ends_at: null, active: true, sort: 1 },
                { id: 'SET2', code: 'hg2', name: 'Saison 2', description: null, starts_at: S.set2Open ? null : iso(30), ends_at: null, active: true, sort: 2 }];
  // Raretés des douze cartes de la première série, dans l'ordre des numéros.
  const R = ['commune','commune','commune','peu_commune','peu_commune','rare','rare','epique','legendaire','mythique','identite','commune'];
  // Familles des douze cartes de la première série (membre, moment, lieu, objet, évènement), même ordre que R.
  const F = ['membre','moment','lieu','objet','evenement','membre','lieu','objet','moment','membre','membre','objet'];
  // Cartes de la première série, construites à partir de R et F.
  const cards = R.map((r, i) => ({ id: 'C' + (i + 1), set_id: 'SET1', number: i + 1, name: ['Ethan','Le Paleto','Château Marius','Pompe à essence','Soirée pizza','Alice','Grapeseed','Cocktail','Braquage raté','Bruno','Carte identité Chloé','Tracteur'][i], family: F[i], rarity: r,
    image_url: null, flavor: 'Un souvenir qui fait sourire le gang.', member_id: null, can_shiny: i !== 0, tradeable: true, craftable: r !== 'identite', max_copies: r === 'identite' ? 3 : null, active: true }));
  // Une carte de la série « Saison 2 » (identifiant C13).
  cards.push({ id: 'C13', set_id: 'SET2', number: 1, name: 'Saison deux', family: 'moment', rarity: 'rare', image_url: null, flavor: null, can_shiny: true, tradeable: true, craftable: true, max_copies: null, active: true });
  // S.bigCards : N cartes supplémentaires « Carte test N » (pagination de la liste admin)
  for (let i = 0; i < (S.bigCards || 0); i++) cards.push({ ...cards[0], id: 'B' + i, number: 1000 + i, name: 'Carte test ' + i, rarity: 'commune', family: 'objet', max_copies: null, member_id: null });
  DB.hg_card_sets = sets; DB.hg_cards = cards;
  // Mes exemplaires : C1 x3 (dont une brillante), C2 x1, C3 x2, C7 x1 brillante, C11 (identite) x1 numéroté, C9 x1 (en échange)
  /** Fabrique un exemplaire possédé par le membre connecté ; extra remplace les champs par défaut. */
  const cp = (id, card, extra = {}) => ({ id, card_id: card, owner_id: ME, shiny: false, serial: null, source: 'booster', obtained_at: iso(-2), locked_trade: null, recycled_at: null, ...extra });
  DB.hg_card_copies = [cp(1,'C1'), cp(2,'C1',{shiny:true}), cp(3,'C1'), cp(4,'C2'), cp(5,'C3'), cp(6,'C3',{source:'fabrication'}), cp(7,'C7',{shiny:true}), cp(8,'C11',{serial:1, max_copies:3}), cp(9,'C9',{locked_trade:'T1'}), cp(10,'C5'), cp(11, 'C5', {shiny: true})];
  // Liste de souhaits du membre connecté : la carte C4.
  DB.hg_card_wishlist = [{ user_id: ME, card_id: 'C4', created_at: iso(-1) }];
  // Scénario « echanges » (parcours-echanges-filtres.cjs) : Alice (U(2)) a des doublons et des cartes d'une autre série ;
  // j'ai aussi une carte de la série « Saison 2 ». Ailleurs, rien ne change.
  if (S.echanges) {
    /** Comme cp, pour un exemplaire possédé par Alice (scénario echanges). */
    const cpa = (id, card, extra = {}) => ({ id, card_id: card, owner_id: U(2), shiny: false, serial: null, source: 'booster', obtained_at: iso(-2), locked_trade: null, recycled_at: null, ...extra });
    DB.hg_card_copies.push(cpa(101,'C1'), cpa(102,'C1'), cpa(103,'C5'), cpa(104,'C8', { serial: 3 }), cpa(105,'C13'), cpa(106,'C12'), cpa(107,'C12'), cpa(108,'C9', { shiny: true }),
      { id: 12, card_id: 'C13', owner_id: ME, shiny: false, serial: null, source: 'booster', obtained_at: iso(-2), locked_trade: null, recycled_at: null });
  }
  // Scénario « suggest » (parcours-echanges-suggeres.cjs) : échanges possibles.
  //  - moi : souhaits C4 et C1 ; doublons C1 (x3), C3 (x2), C5 (x2) ;
  //  - Alice : C1 x2 (un doublon que je souhaite) et souhaits C1, C5 (mes doublons) => échange gagnant-gagnant ;
  //  - Bruno : C4 x2 (un doublon que je souhaite) et aucun souhait ;
  //  - Chloé : souhait C3 (un de mes doublons), rien à offrir ;
  //  - David (fantôme) : souhaite C3 mais n'apparaît jamais.
  if (S.suggest) {
    const cpo = (id, card, owner, extra = {}) => ({ id, card_id: card, owner_id: owner, shiny: false, serial: null, source: 'booster', obtained_at: iso(-2), locked_trade: null, recycled_at: null, ...extra });
    DB.hg_card_copies.push(cpo(101, 'C1', U(2)), cpo(102, 'C1', U(2)), cpo(201, 'C4', U(3)), cpo(202, 'C4', U(3)));
    DB.hg_card_wishlist.push({ user_id: ME, card_id: 'C1', created_at: iso(-1) },
      { user_id: U(2), card_id: 'C1', created_at: iso(-1) }, { user_id: U(2), card_id: 'C5', created_at: iso(-1) },
      { user_id: U(4), card_id: 'C3', created_at: iso(-1) });
    // David : fantôme, il ne doit pas apparaître dans les suggestions.
    DB.hg_profiles.find((p) => p.id === U(5)).is_ghost = true;
    DB.hg_card_wishlist.push({ user_id: U(5), card_id: 'C3', created_at: iso(-1) });
  }
  // Journal initial des Paillettes ; le journal du bas du bloc le remplace.
  DB.hg_wallet_log = [{ user_id: ME, delta: 20, reason: 'quotidien', created_at: iso(-1) }, { user_id: ME, delta: -100, reason: 'booster', created_at: iso(-3) }, { user_id: ME, delta: 15, reason: 'reponse_sortie', created_at: iso(-5) }];
  // Portefeuille du membre connecté : Paillettes (S.bal), pity (S.pity), cadeaux (S.gift).
  DB.hg_wallets = [{ user_id: ME, paillettes: S.bal ?? 230, pity_epique: S.pity ?? 3, daily_streak: 2, last_daily: null, gift_boosters: S.gift ?? 0 }];
// Panel admin (polish cartes) : quêtes, défis et journal des Paillettes
// Quêtes de la semaine (panel admin, Jeu de cartes › Quêtes).
DB.hg_card_quests_templates = [
  { code: 'boosters_5', label: 'Ouvrir 5 boosters', metric: 'boosters_ouverts', target: 5, reward: 80, active: true, sort: 1 },
  { code: 'photo_1', label: 'Ajouter une photo', metric: 'photos_ajoutees', target: 1, reward: 30, active: true, sort: 2 },
];
// Défi de test (panel admin, Défis).
DB.hg_challenges = [{ id: '00000000-0000-4000-8000-0000000000c1', title: 'Vingt sorties ce trimestre', description: null, metric: 'sorties_tenues', target: 20, reward: 100, starts_at: iso(-10), ends_at: iso(80), active: true }];
// Journal des Paillettes de la fin : il remplace celui du début (une seule entrée gardée).
DB.hg_wallet_log = [{ user_id: ME, delta: 100, reason: 'booster', ref: null, created_at: iso(-1) }];
}
// Configuration du jeu lue par la page : prix, taux, recyclage, fabrication, récompenses quotidiennes.
window.__CARDS = { config: { booster_price: 100, booster_size: 5, free_booster_hours: 24, shiny_rate: 3, pity_epique: 10,
  rates: { commune: 60, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.88, mythique: 0.1, identite: 0.02 },
  recycle: { commune: 5, peu_commune: 10, rare: 25, epique: 60, legendaire: 150, mythique: 400, identite: 1000, shiny_multiplier: 3 },
  craft: { commune: 40, peu_commune: 80, rare: 200, epique: 500, legendaire: 1500, shiny_multiplier: 4 }, rewards: { daily: 20, streak_bonus: 5, streak_max: 7 }, max_open_trades: 10 } };

// Compteur utilisé pour produire des identifiants distincts.
let seq = 0;
/**
 * Suggestions d'échanges calculées comme la RPC hg_trade_suggestions (même règle) : membres actifs, doublons
 * vivants, exemplaire libre le plus ancien. Renvoie le même format que la RPC (user_id, want, give, both…).
 * @returns {object[]} lignes triées : deux sens d'abord, puis nombre de cartes, puis pseudo
 */
function suggestionsFromDb() {
  const me = ME;
  const members = new Set(DB.hg_profiles.filter((p) => !p.is_ghost).map((p) => p.id));
  const ok = (c) => { const k = DB.hg_cards.find((x) => x.id === c.card_id); return !!k && k.active !== false && !!k.tradeable; };
  const live = DB.hg_card_copies.filter((c) => !c.recycled_at && ok(c));
  const wish = new Set(DB.hg_card_wishlist.filter((w) => w.user_id === me).map((w) => w.card_id));
  // Mes doublons et l'exemplaire libre le plus ancien de chaque carte (ce que je mets dans l'offre).
  const mine = live.filter((c) => c.owner_id === me);
  const cnt = new Map(); for (const c of mine) cnt.set(c.card_id, (cnt.get(c.card_id) || 0) + 1);
  const giveCopy = new Map();
  for (const c of mine) if ((cnt.get(c.card_id) || 0) >= 2 && c.locked_trade == null && (!giveCopy.has(c.card_id) || Number(c.id) < Number(giveCopy.get(c.card_id)))) giveCopy.set(c.card_id, c.id);
  // Ce que je demande : doublons des autres pour mes souhaits, un exemplaire libre par carte.
  const want = new Map(); const tot = new Map(); const free = new Map();
  for (const c of live) {
    if (c.owner_id === me || !members.has(c.owner_id) || !wish.has(c.card_id)) continue;
    const k = c.owner_id + '|' + c.card_id;
    tot.set(k, (tot.get(k) || 0) + 1);
    if (c.locked_trade == null && (!free.has(k) || Number(c.id) < Number(free.get(k)))) free.set(k, c.id);
  }
  for (const [k, n] of tot) {
    if (n < 2 || !free.has(k)) continue;
    const [uid, card] = k.split('|');
    if (!want.has(uid)) want.set(uid, []);
    want.get(uid).push({ card_id: card, copy_id: Number(free.get(k)) });
  }
  // Ce qu'ils donnent : leurs souhaits qui tombent sur mes doublons.
  const give = new Map();
  for (const w of DB.hg_card_wishlist) {
    if (w.user_id === me || !members.has(w.user_id) || !giveCopy.has(w.card_id)) continue;
    if (!give.has(w.user_id)) give.set(w.user_id, []);
    give.get(w.user_id).push({ card_id: w.card_id, copy_id: Number(giveCopy.get(w.card_id)) });
  }
  const uids = new Set([...want.keys(), ...give.keys()]);
  const rows = [...uids].map((uid) => {
    const p = DB.hg_profiles.find((x) => x.id === uid);
    const w = want.get(uid) || [], g = give.get(uid) || [];
    return { user_id: uid, pseudo: p.pseudo, avatar_url: p.avatar_url, color: p.color, want: w, give: g,
      both: w.length > 0 && g.length > 0, n_want: w.length, n_give: g.length };
  });
  rows.sort((a, b) => Number(b.both) - Number(a.both) || (b.n_want + b.n_give) - (a.n_want + a.n_give) || a.pseudo.localeCompare(b.pseudo, 'fr'));
  return rows;
}
/** Lit la colonne c d'une ligne (valeur brute, sans transformation). */
const getv = (r, c) => r[c];
/* ---------- Requêtes factices (faux .from()) ---------- */
/** Requête factice : chaînage de filtres et d'opérations, exécutée quand on l'attend (await), comme PostgREST. */
class Q {
  /** Prépare une requête sur la table t, en lecture (select) par défaut. */
  constructor(t) { this.t = t; this.f = []; this.one = false; this.op = 'select'; this.payload = null; this.ret = false; }
  /** Choisit les colonnes : sans effet ici, toutes les colonnes sont renvoyées. */
  select() { if (this.op !== 'select') this.ret = true; return this; }
  /** Filtre : la colonne c vaut v. */
  eq(c, v) { this.f.push((r) => getv(r, c) === v); return this; }
  /** Filtre : la colonne c ne vaut pas v. */
  neq(c, v) { this.f.push((r) => getv(r, c) !== v); return this; }
  /** Filtre : la colonne c est dans la liste v. */
  // Comparaison en texte : PostgREST accepte les identifiants en chaîne (ex. copy_id numériques lus en « in »).
  in(c, v) { const set = new Set(v.map(String)); this.f.push((r) => set.has(String(getv(r, c)))); return this; }
  /** Filtre : la colonne c vaut exactement v (null compris). */
  is(c, v) { this.f.push((r) => (getv(r, c) ?? null) === v); return this; }
  /** Filtre négatif : seul l'opérateur « is » est simulé. */
  not(c, op, v) { if (op === 'is') this.f.push((r) => (getv(r, c) ?? null) !== v); return this; }
  // Méthodes sans effet ici : tri, limite et bornes ne sont pas simulés (range renvoie toutes les lignes).
  or() { return this; } order() { return this; } limit() { return this; } gte() { return this; } lte() { return this; } lt() { return this; } gt() { return this; } range() { return this; } ilike() { return this; } contains() { return this; }
  /** Attend une seule ligne (ou null). */
  maybeSingle() { this.one = true; return this; } single() { this.one = true; return this; }
  /** Prépare une insertion ; la requête s'exécute à l'attente (await). */
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  /** Prépare une mise à jour ; les lignes filtrées reçoivent la charge utile. */
  update(p) { this.op = 'update'; this.payload = p; return this; }
  /** Prépare un upsert (insertion ou mise à jour selon la clé). */
  upsert(p) { this.op = 'upsert'; this.payload = p; return this; }
  /** Prépare une suppression des lignes filtrées. */
  delete() { this.op = 'delete'; return this; }
  /** Exécute la requête sur DB et renvoie { data, error } comme le vrai client. */
  run() {
    const tab = DB[this.t] || (DB[this.t] = []);
    // Vrai si la ligne respecte tous les filtres de la requête.
    const match = (r) => this.f.every((f) => f(r));
    // Journal des appels : chaque lecture et écriture est notée pour les vérifications des tests.
    window.__LOG.push([this.op, this.t, this.payload]);
    // Upsert sur hg_page_access : une ligne par couple (page, utilisateur), remplacée si elle existe.
    if (this.op === 'upsert' && this.t === 'hg_page_access') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]);
      for (const r of rows) { const i = tab.findIndex((x) => x.page_slug === r.page_slug && x.user_id === r.user_id); if (i >= 0) tab[i] = { ...r }; else tab.push({ ...r }); }
      return { data: rows, error: null };
    }
    // Insertion : les lignes reçoivent un identifiant si la table en exige un (comme gen_random_uuid en base).
    if (this.op === 'insert' || this.op === 'upsert') {
      // Scénario guardError : refus de créer une édition tant que la précédente n'est pas terminée.
      if (this.t === 'hg_ss_editions' && S.guardError) return { data: null, error: { message: "Termine d'abord l'édition en cours avant d'en créer une nouvelle" } };
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => ({ ...r }));
      for (const r of rows) {
        // Code de badge déjà présent : même erreur que la clé primaire en base (23505).
        if (this.t === 'hg_badges' && tab.some((x) => x.code === r.code)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "hg_badges_pkey"' } };
        // Un lien d'invitation reçoit un identifiant et un jeton simulés.
        if (this.t === 'hg_invite_links') Object.assign(r, { id: 'L' + (++seq + 10), token: 'new' + String(seq).padStart(21, '0'), active: true, codes_generated: 0, created_at: new Date().toISOString() });
        // Séries et défis créés sans identifiant reçoivent un identifiant factice, comme la base.
        if (!r.id && this.t === 'hg_card_sets') r.id = 'SETN' + (++seq);
        if (!r.id && this.t === 'hg_challenges') r.id = '00000000-0000-4000-8000-0000000d' + String(++seq).padStart(4, '0');
        tab.unshift(r);
      }
      return { data: this.one ? rows[0] : rows, error: null };
    }
    // Mise à jour : les lignes qui respectent les filtres reçoivent les champs de la charge utile.
    if (this.op === 'update') { const rows = tab.filter(match); rows.forEach((r) => Object.assign(r, this.payload)); return { data: this.one ? rows[0] ?? null : rows, error: null }; }
    // Suppression : retire les lignes filtrées et renvoie leur nombre (count).
    if (this.op === 'delete') { const keep = tab.filter((r) => !match(r)); const n = tab.length - keep.length; tab.length = 0; tab.push(...keep); return { data: null, error: null, count: n }; }
    // Lecture : les lignes qui respectent les filtres ; une seule si maybeSingle ou single.
    const out = tab.filter(match);
    return this.one ? { data: out[0] ?? null, error: null } : { data: out, error: null };
  }
  /** Permet d'attendre la requête avec await : exécute run() et transmet son résultat. */
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
}
// Scénarios des affiches et des tutos : valeurs de réglages surchargées (S.cardsCfg fusionné dans la configuration, S.badgesCfg = hg_settings.badges).
if (S.cardsCfg) Object.assign(window.__CARDS.config, S.cardsCfg);
if (S.badgesCfg) DB.hg_settings.push({ key: 'badges', value: S.badgesCfg });
// S.supportCfg = hg_settings.support ; S.ancienneteLevels = niveaux du badge Ancienneté (hg_badges.levels).
if (S.supportCfg) DB.hg_settings.push({ key: 'support', value: S.supportCfg });
// S.settingsExtra = { clé: valeur } : autres réglages hg_settings (irl, invites…).
if (S.settingsExtra) for (const [key, value] of Object.entries(S.settingsExtra)) DB.hg_settings.push({ key, value });
if (S.ancienneteLevels) DB.hg_badges.push({ code: 'anciennete', name: 'Ancienneté', description: 'Années dans le gang', image_url: null, sort: 999, levels_enabled: true, metric: 'anciennete_annees', levels: S.ancienneteLevels });

/* ---------- Client exporté ---------- */
/** Point d'entrée : crée le faux client que les pages utilisent à la place de supabase-js. */
export function createClient() {
  return {
    auth: {
      // Session : absente si le scénario indique un visiteur (S.guest).
      getSession: async () => ({ data: { session: S.guest ? null : { user: { id: S.uid || ME } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getUser: async () => ({ data: { user: S.guest ? null : { id: S.uid || ME } } }),
      // Déconnexion sans effet ici.
      signOut: async () => ({}),
    },
    // Commence une requête sur la table t.
    from: (t) => new Q(t),
    /** Simule les fonctions SQL (RPC) : chaque nom a sa réponse ; une fonction inconnue renvoie null sans erreur. */
    rpc: async (fn, args) => {
      window.__LOG.push(['rpc', fn, args]);
      // Secrets cachés (migration 062) : la secousse offre un booster ; l'appel reste dans window.__LOG.
      if (fn === 'hg_egg_found') return { data: { new: true, reward: 0, message: 'Un booster offert t\'attend sur la page Cartes.', card: null, badge: null, found: 1 }, error: null };
      // Pages visibles pour l'utilisateur connecté (même logique que fake-sb.mjs).
      if (fn === 'hg_my_pages') {
        if (S.pagesFail) return { data: null, error: { message: 'Failed to fetch' } };
        const uid = S.uid || ME; const adm = DB.hg_profiles.find((p) => p.id === uid)?.is_admin;
        /** Accès de l'utilisateur connecté à la page slug (ligne de hg_page_access), ou undefined. */
        const acc = (slug) => DB.hg_page_access.find((a) => a.page_slug === slug && a.user_id === uid);
        return { data: DB.hg_pages.filter((p) => adm || (p.mode === 'membres' && acc(p.slug)?.allowed !== false) || (p.mode === 'liste' && acc(p.slug)?.allowed === true))
          .sort((a, b) => a.sort - b.sort).map(({ slug, label, in_nav, sort }) => ({ slug, label, in_nav, sort })), error: null };
      }
      if (fn === 'hg_unread_count') return { data: 0, error: null };
      // Secrets cachés (migration 062) : hg_egg_found répond « nouveau » ; hg_eggs_me renvoie le carnet.
      if (fn === 'hg_egg_found') return { data: { new: true, reward: 10, message: 'ok', found: 1 }, error: null };
      if (fn === 'hg_eggs_me') return { data: { found: 1, total: 12, eggs: [{ egg: 'konami', first: new Date().toISOString() }], letters: 0 }, error: null };
      // Configuration du jeu seule (migration 018) : lue par les affiches et les tutos. S.cardsFail = la RPC refuse.
      if (fn === 'hg_card_cfg') {
        if (S.cardsFail) return { data: null, error: { message: 'permission denied for function hg_card_cfg' } };
        return { data: window.__CARDS.config, error: null };
      }
      // Droits codés en dur : admin avec tout le catalogue, pour cette fixture.
      if (fn === 'hg_my_perms') return { data: { is_admin: true, perms: ['membres', 'evenements', 'souvenirs', 'secret_santa', 'cartes', 'badges', 'themes', 'messages', 'support', 'bot', 'reglages', 'journal'] }, error: null };
      // Ajustement de Paillettes : seul le membre connecté est crédité.
      if (fn === 'hg_cards_admin_paillettes') {
        if (args.p_user === ME) { DB.hg_wallets[0].paillettes += args.p_delta; return { data: DB.hg_wallets[0].paillettes, error: null }; }
        return { data: 0, error: null };
      }
      // Don de cartes : renvoie le nombre donné ; échoue si le scénario giveFail est fourni.
      if (fn === 'hg_cards_admin_give') {
        if (S.giveFail) return { data: null, error: { message: 'Réservé à l\'admin' } };
        return { data: args.p_count, error: null };
      }
      // Don groupé (migration 042) : p_users null = tout le gang (comptes actifs). scenario.bulkFail = la RPC refuse.
      if (fn === 'hg_cards_admin_bulk_give') {
        if (S.bulkFail) return { data: null, error: { message: 'Plus assez d\'exemplaires pour « Carte test » : il en reste 1, il en faut 4' } };
        const ids = [...new Set(args.p_users ?? DB.hg_profiles.filter((p) => !p.is_ghost).map((p) => p.id))];
        return { data: { membres: ids.length, type: args.p_kind, montant: args.p_amount, annonce: args.p_announce, batch: 'lot-test',
          detail: ids.map((id) => ({ user_id: id, pseudo: DB.hg_profiles.find((p) => p.id === id)?.pseudo ?? '' })) }, error: null };
      }
      // Retrait de cartes : sans effet ici.
      if (fn === 'hg_cards_admin_take') return { data: null, error: null };
      // Annuaire pour le Staff : pseudo, couleur, fantôme ou non.
      if (fn === 'hg_staff_directory') return { data: DB.hg_profiles.map((p) => ({ id: p.id, pseudo: p.pseudo, avatar_url: p.avatar_url, color: p.color, is_ghost: !!p.is_ghost, joined_on: p.joined_on })), error: null };
      // Liste des membres : les fantômes n'y figurent pas.
      if (fn === 'hg_members') return { data: DB.hg_profiles.filter((p) => !p.is_ghost).map((p) => ({ id: p.id, pseudo: p.pseudo, avatar_url: null, color: p.color, member_since: p.joined_on || p.created_at })), error: null };
      if (fn === 'hg_admin_accounts') return { data: DB.hg_profiles.map((p) => ({ id: p.id, pseudo: p.pseudo, email: p.pseudo.toLowerCase() + '@ex.ch', is_admin: p.is_admin, created_at: p.created_at, last_sign_in_at: null })), error: null };
      if (fn === 'hg_claim_invite_link') {
        window.__CLAIMS = (window.__CLAIMS || 0) + 1;
        if (S.claimError) return { data: null, error: { message: "Lien d'invitation invalide ou expiré" } };
        return { data: 'HG-Q7W' + 'XYZ'.slice(0, 3), error: null };
      }
      if (fn === 'hg_member_card') { const p = DB.hg_profiles.find((x) => x.id === args.p_user);
        const badges = DB.hg_user_badges.filter((u) => u.user_id === p.id).map((u) => { const b = DB.hg_badges.find((x) => x.code === u.badge_code); return { code: b.code, name: b.name, description: b.description, image_url: b.image_url, awarded_at: u.awarded_at }; });
        return { data: { ...p, member_since: p.joined_on || p.created_at, member_number: 7, badges, stats: { secret_santa: 3, sorties: 5 } }, error: null }; }
      // Événements dynamiques actifs à l'instant présent (entre starts_at et ends_at).
      if (fn === 'hg_dyn_active') {
        if (S.dynFail) return { data: null, error: { message: 'rpc indisponible' } };
        const t = Date.now();
        return { data: DB.hg_dyn_events.filter((e) => e.active && new Date(e.starts_at) <= t && new Date(e.ends_at) > t).map((e) => ({ ...e,
          my_captures: DB.hg_dyn_captures.filter((c) => c.event_id === e.id && c.user_id === ME).length,
          remaining_total: e.max_total == null ? null : e.max_total - DB.hg_dyn_captures.filter((c) => c.event_id === e.id).length })), error: null };
      }
      // Attrape une citrouille : ajoute une capture ; à trois captures, le badge passe au niveau 2.
      if (fn === 'hg_dyn_capture') {
        DB.hg_dyn_captures.push({ event_id: args.p_event, user_id: ME, captured_at: new Date().toISOString() });
        const mine = DB.hg_dyn_captures.filter((c) => c.event_id === args.p_event && c.user_id === ME).length;
        const ub = DB.hg_user_badges.find((u) => u.user_id === ME && u.badge_code === 'citrouille');
        if (ub && mine >= 3) ub.level = 2;
        return { data: { ok: true, mine, badge_new: false }, error: null };
      }
      // Classement des captures d'un événement, du plus au moins.
      if (fn === 'hg_dyn_leaderboard') {
        const m = new Map(); for (const c of DB.hg_dyn_captures.filter((c) => c.event_id === args.p_event)) m.set(c.user_id, (m.get(c.user_id) || 0) + 1);
        return { data: [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => { const p = DB.hg_profiles.find((x) => x.id === id); return { user_id: id, pseudo: p.pseudo, avatar_url: null, captures: n }; }), error: null };
      }
      // Progression des badges de l'utilisateur ; scénario noProgress : la fonction paraît absente.
      if (fn === 'hg_my_badge_progress') { if (S.noProgress) return { data: null, error: { message: 'function not found' } }; return { data: [{ badge_code: 'fidele', metric: 'anciennete_annees', value: 4 }, { badge_code: 'citrouille', metric: 'event_captures', value: DB.hg_dyn_captures.filter((c) => c.user_id === ME && c.event_id === 'aaaaaaaa-0000-4000-8000-000000000001').length }], error: null }; }

      // Compteurs du compte Cartes : Paillettes, pity, bonus quotidien, booster gratuit, cadeaux.
      if (fn === 'hg_cards_me') { const w = DB.hg_wallets[0]; return { data: { paillettes: w.paillettes, boosters_opened: 4, pity: w.pity_epique, daily_streak: w.daily_streak, daily_available: !w.last_daily, free_booster_at: S.freeAt ?? iso(-0.1), gift_boosters: w.gift_boosters ?? 0, god: !!S.god, config: window.__CARDS.config }, error: null }; }
      // Bonus quotidien : +20 Paillettes et série à 3.
      if (fn === 'hg_cards_daily') { const w = DB.hg_wallets[0]; w.last_daily = 'today'; w.paillettes += 20; return { data: { gain: 20, streak: 3 }, error: null }; }
      // hg_open_booster_req (migration 021), seulement si scenario.reqRpc : idempotence par p_request,
      // solde vérifié, et scenario.x5FailAt = numéro de la tentative qui échoue (rien n'est débité ni enregistré).
      if (fn === 'hg_open_booster_req' && S.reqRpc) {
        const w = DB.hg_wallets[0];
        window.__ATT = (window.__ATT || 0) + 1;
        window.__OK = window.__OK || new Set();
        if (S.x5FailAt && window.__ATT === S.x5FailAt) return { data: null, error: { message: 'Pas assez de Paillettes (il en faut 100)' } };
        if (window.__OK.has(args.p_request)) return { data: null, error: { message: 'booster_deja_ouvert' } };
        // Booster offert (migration 042) : consomme le stock, sans Paillettes ni délai.
        if (args.p_offert && !(w.gift_boosters > 0)) return { data: null, error: { message: 'Aucun booster offert disponible' } };
        if (!args.p_offert && !args.p_free && w.paillettes < 100) return { data: null, error: { message: 'Pas assez de Paillettes (il en faut 100)' } };
        window.__OK.add(args.p_request);
        if (args.p_offert) w.gift_boosters -= 1;
        else if (!args.p_free) w.paillettes -= 100;
        const pool = DB.hg_cards.filter((c) => c.rarity !== 'identite');
        const k = window.__OK.size - 1;
        const cards = Array.from({ length: 5 }, (_, i) => {
          const c = pool[(k * 5 + i) % pool.length];
          return { copy_id: 1000 + k * 5 + i, card_id: c.id, name: c.name, rarity: c.rarity, family: c.family, image_url: null, flavor: c.flavor, number: c.number, shiny: (k * 5 + i) % 7 === 0, serial: null, max_copies: null };
        });
        const ORD = ['commune', 'peu_commune', 'rare', 'epique', 'legendaire', 'mythique'];
        const best = cards.reduce((b, c) => (ORD.indexOf(c.rarity) > ORD.indexOf(b) ? c.rarity : b), 'commune');
        return { data: { cards, best, demandees: 5, livrees: 5, offert: !!args.p_offert, offerts_restants: w.gift_boosters }, error: null };
      }
      // Sans le scénario reqRpc, la nouvelle fonction « n'existe pas » : erreur PGRST202 (comme la base sans la migration), pour tester le repli.
      if (fn === 'hg_open_booster_req') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.hg_open_booster_req' } };
      // Ancienne ouverture de booster, sans requête : débite 100 Paillettes sauf booster gratuit, renvoie toujours les cinq mêmes cartes.
      if (fn === 'hg_open_booster') { const w = DB.hg_wallets[0]; if (S.paidFail && !args.p_free) return { data: null, error: { message: 'Pas assez de Paillettes (il en faut 100)' } };
        const pool = DB.hg_cards.filter((c) => c.rarity !== 'identite').slice(0, 5);
        const cards = pool.map((c, i) => ({ copy_id: 900 + i, card_id: c.id, name: c.name, rarity: i === 4 ? 'legendaire' : c.rarity, family: c.family, image_url: null, flavor: c.flavor, number: c.number, shiny: i === 2, serial: null, max_copies: null }));
        if (!args.p_free) w.paillettes -= 100;
        // Comme la vraie fonction (hg_open_booster) : la jauge épique repart à zéro si la meilleure carte est épique ou plus,
        // sinon elle monte, booster gratuit compris. Ici la meilleure carte est une légendaire.
        const RK = ['commune', 'peu_commune', 'rare', 'epique', 'legendaire', 'mythique'];
        w.pity_epique = RK.indexOf('legendaire') >= 3 ? 0 : w.pity_epique + 1;
        return { data: { cards, best: 'legendaire' }, error: null }; }
      // Échanges possibles (migration 058) : suggestions du membre connecté, dans le format de la RPC réelle.
      // S.suggestions remplace le résultat (scénario de test) ; S.suggFail simule une fonction absente (repli client).
      if (fn === 'hg_trade_suggestions') {
        if (S.suggFail) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.hg_trade_suggestions' } };
        if (S.suggestions) return { data: S.suggestions, error: null };
        return { data: suggestionsFromDb(), error: null };
      }
      // Recyclage : ajoute 5 Paillettes par carte et retire les exemplaires ; échec si le scénario recycleFail est fourni.
      if (fn === 'hg_card_recycle') { if (S.recycleFail) return { data: null, error: { message: 'Certaines cartes ne peuvent pas être recyclées (échange en cours ?)' } };
        const ids = args.p_copies; const total = ids.length * 5; DB.hg_wallets[0].paillettes += total; DB.hg_card_copies = DB.hg_card_copies.filter((c) => !ids.includes(c.id)); return { data: total, error: null }; }
      // Fabrication : 40 Paillettes, 160 pour une version brillante ; le scénario god ignore le solde.
      if (fn === 'hg_card_craft') { const w = DB.hg_wallets[0]; const cost = args.p_shiny ? 160 : 40; if (!S.god && w.paillettes < cost) return { data: null, error: { message: `Pas assez de Paillettes (il en faut ${cost})` } }; w.paillettes -= cost; const kc = DB.hg_cards.find((c) => c.id === args.p_card); const cid = 500 + DB.hg_card_copies.length; DB.hg_card_copies.push({ id: cid, card_id: args.p_card, owner_id: ME, shiny: !!args.p_shiny, serial: null, source: 'fabrication', obtained_at: iso(0), locked_trade: null, recycled_at: null });
        // Comme hg_card_craft : copy_id, coût, carte, rareté, brillance et numéro de série de l'exemplaire créé.
        return { data: { copy_id: cid, cost, card_id: args.p_card, rarity: kc?.rarity, shiny: !!args.p_shiny, serial: null }, error: null }; }
      // Délai artificiel du classement (scénario rpcDelay), pour tester le chargement.
      if (fn === 'hg_card_leaderboard' && S.rpcDelay) await new Promise((r) => setTimeout(r, S.rpcDelay));
      // Classement de N lignes (scénario lbRows), pour tester la liste longue.
      if (fn === 'hg_card_leaderboard' && S.lbRows) return { data: Array.from({ length: S.lbRows }, (_, i) => ({ user_id: U(2), pseudo: 'Joueur ' + i, avatar_url: null, uniques: 1, copies: 1, shinies: 0, identites: 0, series: 1, score: 100 - i })), error: null };
      // Classement par défaut : Ethan en tête, puis Alice.
      if (fn === 'hg_card_leaderboard') return { data: [{ user_id: ME, pseudo: 'Ethan', avatar_url: null, uniques: 5, copies: 11, shinies: 3, identites: 1, series: 0, score: 120 }, { user_id: U(2), pseudo: 'Alice', avatar_url: null, uniques: 3, copies: 4, shinies: 0, identites: 0, series: 1, score: 40 }], error: null };
      // Offre d'échange (cartes-trades.js) : l'offre est créée et son id renvoyé, comme la RPC réelle (uuid).
      if (fn === 'hg_trade_propose') { if (S.tradeFail) return { data: null, error: { message: 'Trop d\'offres en cours' } }; const id = '7e57c0de-0000-4000-8000-000000000001';
        DB.hg_card_trades.unshift({ id, from_user: ME, to_user: args.p_to, status: 'proposee', from_paillettes: args.p_give_p, to_paillettes: args.p_want_p, message: args.p_message, parent_id: args.p_parent, created_at: new Date().toISOString(), resolved_at: null });
        return { data: id, error: null }; }
      // Drops (migration 043) : même logique que la base (fenêtre de temps, un gain par membre, plafond d'exemplaires).
      // Drops actifs que le membre n'a pas encore attrapés, avec le nombre d'exemplaires restants.
      if (fn === 'hg_drops_active') {
        if (S.dropsFail) return { data: null, error: { message: 'rpc indisponible' } };
        const t = Date.now(), me = S.uid || ME;
        const rows = DB.hg_card_drops.filter((d) => new Date(d.starts_at) <= t && new Date(d.ends_at) > t)
          .filter((d) => !DB.hg_card_drop_claims.some((c) => c.drop_id === d.id && c.user_id === me))
          .filter((d) => DB.hg_card_drop_claims.filter((c) => c.drop_id === d.id).length < d.quantity)
          .map((d) => { const k = DB.hg_cards.find((x) => x.id === d.card_id); const set = DB.hg_card_sets.find((x) => x.id === k.set_id);
            return { drop_id: d.id, card_id: k.id, name: k.name, rarity: k.rarity, family: k.family, image_url: k.image_url, flavor: k.flavor, number: k.number,
              max_copies: k.max_copies, set_name: set.name, shiny: !!d.shiny, quantity: d.quantity, remaining: d.quantity - DB.hg_card_drop_claims.filter((c) => c.drop_id === d.id).length, ends_at: d.ends_at }; });
        return { data: rows, error: null };
      }
      // Réclamation d'un drop : vérifie la fenêtre de temps, le doublon et le stock, puis note l'activité.
      if (fn === 'hg_drop_claim') {
        window.__CLAIMS_DROP = (window.__CLAIMS_DROP || 0) + 1;
        const me = S.uid || ME, d = DB.hg_card_drops.find((x) => x.id === args.p_drop), t = Date.now();
        if (S.dropLate) return { data: null, error: { message: 'Trop tard, tous les exemplaires sont partis !' } }; // course perdue : affiché sans attendre
        if (!d || new Date(d.starts_at) > t || new Date(d.ends_at) <= t) return { data: null, error: { message: 'Trop tard : ce drop est terminé.' } };
        if (DB.hg_card_drop_claims.some((c) => c.drop_id === d.id && c.user_id === me)) return { data: null, error: { message: 'Tu as déjà attrapé cette carte.' } };
        const got = DB.hg_card_drop_claims.filter((c) => c.drop_id === d.id).length;
        if (got >= d.quantity) return { data: null, error: { message: 'Trop tard, tous les exemplaires sont partis !' } };
        const k = DB.hg_cards.find((x) => x.id === d.card_id), set = DB.hg_card_sets.find((x) => x.id === k.set_id);
        const copy = 2000 + DB.hg_card_drop_claims.length;
        DB.hg_card_drop_claims.push({ drop_id: d.id, user_id: me, copy_id: copy, claimed_at: new Date().toISOString() });
        if (d.announce !== false) DB.hg_activity.unshift({ user_id: me, kind: 'cartes', text: 'Ethan a attrapé « ' + k.name + ' » !', created_at: new Date().toISOString() });
        return { data: { copy_id: copy, card_id: k.id, name: k.name, rarity: k.rarity, family: k.family, image_url: k.image_url, flavor: k.flavor,
          number: k.number, max_copies: k.max_copies, set_name: set.name, shiny: !!d.shiny, serial: null, remaining: d.quantity - got - 1 }, error: null };
      }
      // Création d'un drop : échec si le scénario dropFail est fourni.
      if (fn === 'hg_drop_create') {
        if (S.dropFail) return { data: null, error: { message: 'Réservé à l\'admin' } };
        const k = DB.hg_cards.find((x) => x.id === args.p_card);
        const id = 'd0000000-0000-4000-8000-' + String(DB.hg_card_drops.length + 1).padStart(12, '0');
        DB.hg_card_drops.unshift({ id, card_id: args.p_card, shiny: !!args.p_shiny, quantity: args.p_quantity, starts_at: new Date().toISOString(),
          ends_at: new Date(Date.now() + args.p_minutes * 6e4).toISOString(), announce: args.p_announce, created_by: ME });
        return { data: id, error: null };
      }
      // Arrêt d'un drop : il se termine maintenant.
      if (fn === 'hg_drop_stop') {
        const d = DB.hg_card_drops.find((x) => x.id === args.p_drop);
        if (!d || new Date(d.ends_at) <= Date.now()) return { data: null, error: { message: 'Ce drop est déjà terminé.' } };
        d.ends_at = new Date().toISOString();
        return { data: null, error: null };
      }
      // Tirage manuel du Secret Santa : renvoie le nombre de paires reçues.
      if (fn === 'hg_ss_manual_draw') return { data: args.p_pairs.length, error: null };
      return { data: null, error: null };
    },
    // Canal temps réel factice : aucun événement n'est émis.
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {}, removeAllChannels() {},
    // Stockage factice : URL publique en cercle doré, images signées vides.
    storage: { from: () => ({
      getPublicUrl: (p) => ({ data: { publicUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="gold"/></svg>') } }),
      upload: async (p) => { window.__LOG.push(['upload', p]); return { data: { path: p }, error: null }; },
      remove: async (p) => { window.__LOG.push(['remove', p]); return { data: [], error: null }; },
      createSignedUrl: async () => ({ data: { signedUrl: '' } }), createSignedUrls: async () => ({ data: [] }),
    }) },
    /** Fonctions edge simulées : notées dans le journal, avec une réponse pour dyn_announce, sinon une réponse vide. */
    functions: { invoke: async (name, { body } = {}) => { window.__LOG.push(['fn', name, body]); return { data: body?.event === 'dyn_announce' ? { ok: true, sent: true } : {}, error: null }; } },
  };
}
