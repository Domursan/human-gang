// Faux supabase-js avec état + données cartes (copie de visuel-carte/fake-sb.mjs).
// Sert au test d'ouverture de booster dans cartes.html (hg_open_booster, hg_cards_me, …).
const S = window.__SCN || {};
const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const now = Date.now(), iso = (d) => new Date(now + d * 864e5).toISOString();
const people = [['Ethan', ME], ['Alice', U(2)], ['Bruno', U(3)], ['Chloé', U(4)], ['David', U(5)], ['Emma', U(6)]];
const AUTO = ['premier_noel','veteran','lutin_express','sur_le_fil','liste_parfaite','toujours_la','organisateur','globe_trotter','paparazzi','boite_a_idees','fondateur','fidele','chasseur_bugs','saisonnier','cupidon'];
const PUMPKIN = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect x="3" y="4" width="10" height="10" fill="#E8862A"/><rect x="2" y="6" width="12" height="6" fill="#E8862A"/><rect x="7" y="1" width="2" height="3" fill="#3C7A3A"/><rect x="5" y="7" width="2" height="2" fill="#1a1a1a"/><rect x="9" y="7" width="2" height="2" fill="#1a1a1a"/><rect x="5" y="11" width="6" height="1" fill="#1a1a1a"/></svg>');
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
};
Object.assign(DB.hg_badges.find((b) => b.code === 'fidele'), { name: 'Fidèle', description: 'Membre du gang depuis des années', levels_enabled: true, metric: 'anciennete_annees',
  levels: [{ level: 1, threshold: 1, name: 'Bronze' }, { level: 2, threshold: 3, name: 'Argent' }, { level: 3, threshold: 5, name: 'Or', image_url: PUMPKIN }] });
DB.hg_profiles[0].created_at = iso(-4 * 365);
for (const [u, n] of [[U(2), 4], [ME, 2], [U(3), 1]]) for (let i = 0; i < n; i++) DB.hg_dyn_captures.push({ event_id: 'aaaaaaaa-0000-4000-8000-000000000001', user_id: u, captured_at: iso(-1 + i / 10) });
for (const [u, n] of [[U(4), 6], [ME, 3], [U(5), 2], [U(2), 1]]) for (let i = 0; i < n; i++) DB.hg_dyn_captures.push({ event_id: 'aaaaaaaa-0000-4000-8000-000000000002', user_id: u, captured_at: iso(-310 + i / 10) });
window.__DB = DB; window.__LOG = [];
// ---- données cartes (factices) ----
{
  const sets = [{ id: 'SET1', code: 'hg1', name: 'Première édition', description: 'Les premiers membres du gang.', starts_at: null, ends_at: null, active: true, sort: 1 },
                { id: 'SET2', code: 'hg2', name: 'Saison 2', description: null, starts_at: iso(30), ends_at: null, active: true, sort: 2 }];
  const R = ['commune','commune','commune','peu_commune','peu_commune','rare','rare','epique','legendaire','mythique','identite','commune'];
  const F = ['membre','moment','lieu','objet','evenement','membre','lieu','objet','moment','membre','membre','objet'];
  const cards = R.map((r, i) => ({ id: 'C' + (i + 1), set_id: 'SET1', number: i + 1, name: ['Ethan','Le Paleto','Château Marius','Pompe à essence','Soirée pizza','Alice','Grapeseed','Cocktail','Braquage raté','Bruno','Carte identité Chloé','Tracteur'][i], family: F[i], rarity: r,
    image_url: null, flavor: 'Un souvenir qui fait sourire le gang.', member_id: null, can_shiny: i !== 0, tradeable: true, craftable: r !== 'identite', max_copies: r === 'identite' ? 3 : null, active: true }));
  cards.push({ id: 'C13', set_id: 'SET2', number: 1, name: 'Saison deux', family: 'moment', rarity: 'rare', image_url: null, flavor: null, can_shiny: true, tradeable: true, craftable: true, max_copies: null, active: true });
  // S.bigCards : N cartes supplémentaires « Carte test N » (pagination de la liste admin)
  for (let i = 0; i < (S.bigCards || 0); i++) cards.push({ ...cards[0], id: 'B' + i, number: 1000 + i, name: 'Carte test ' + i, rarity: 'commune', family: 'objet', max_copies: null, member_id: null });
  DB.hg_card_sets = sets; DB.hg_cards = cards;
  // Mes exemplaires : C1 x3 (dont une brillante), C2 x1, C3 x2, C7 x1 brillante, C11 (identite) x1 numéroté, C9 x1 (en échange)
  const cp = (id, card, extra = {}) => ({ id, card_id: card, owner_id: ME, shiny: false, serial: null, source: 'booster', obtained_at: iso(-2), locked_trade: null, recycled_at: null, ...extra });
  DB.hg_card_copies = [cp(1,'C1'), cp(2,'C1',{shiny:true}), cp(3,'C1'), cp(4,'C2'), cp(5,'C3'), cp(6,'C3',{source:'fabrication'}), cp(7,'C7',{shiny:true}), cp(8,'C11',{serial:1, max_copies:3}), cp(9,'C9',{locked_trade:'T1'}), cp(10,'C5'), cp(11, 'C5', {shiny: true})];
  DB.hg_card_wishlist = [{ user_id: ME, card_id: 'C4', created_at: iso(-1) }];
  DB.hg_wallet_log = [{ user_id: ME, delta: 20, reason: 'quotidien', created_at: iso(-1) }, { user_id: ME, delta: -100, reason: 'booster', created_at: iso(-3) }, { user_id: ME, delta: 15, reason: 'reponse_sortie', created_at: iso(-5) }];
  DB.hg_wallets = [{ user_id: ME, paillettes: S.bal ?? 230, pity_epique: S.pity ?? 3, daily_streak: 2, last_daily: null }];
// Panel admin (polish cartes) : quêtes, défis et journal des Paillettes
DB.hg_card_quests_templates = [
  { code: 'boosters_5', label: 'Ouvrir 5 boosters', metric: 'boosters_ouverts', target: 5, reward: 80, active: true, sort: 1 },
  { code: 'photo_1', label: 'Ajouter une photo', metric: 'photos_ajoutees', target: 1, reward: 30, active: true, sort: 2 },
];
DB.hg_challenges = [{ id: '00000000-0000-4000-8000-0000000000c1', title: 'Vingt sorties ce trimestre', description: null, metric: 'sorties_tenues', target: 20, reward: 100, starts_at: iso(-10), ends_at: iso(80), active: true }];
DB.hg_wallet_log = [{ user_id: ME, delta: 100, reason: 'booster', ref: null, created_at: iso(-1) }];
}
window.__CARDS = { config: { booster_price: 100, booster_size: 5, free_booster_hours: 24, shiny_rate: 3, pity_epique: 10,
  rates: { commune: 60, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.88, mythique: 0.1, identite: 0.02 },
  recycle: { commune: 5, peu_commune: 10, rare: 25, epique: 60, legendaire: 150, mythique: 400, identite: 1000, shiny_multiplier: 3 },
  craft: { commune: 40, peu_commune: 80, rare: 200, epique: 500, legendaire: 1500, shiny_multiplier: 4 }, rewards: { daily: 20, streak_bonus: 5, streak_max: 7 }, max_open_trades: 10 } };

let seq = 0;
const getv = (r, c) => r[c];
class Q {
  constructor(t) { this.t = t; this.f = []; this.one = false; this.op = 'select'; this.payload = null; this.ret = false; }
  select() { if (this.op !== 'select') this.ret = true; return this; }
  eq(c, v) { this.f.push((r) => getv(r, c) === v); return this; }
  neq(c, v) { this.f.push((r) => getv(r, c) !== v); return this; }
  in(c, v) { this.f.push((r) => v.includes(getv(r, c))); return this; }
  is(c, v) { this.f.push((r) => (getv(r, c) ?? null) === v); return this; }
  not(c, op, v) { if (op === 'is') this.f.push((r) => (getv(r, c) ?? null) !== v); return this; }
  or() { return this; } order() { return this; } limit() { return this; } gte() { return this; } lte() { return this; } lt() { return this; } gt() { return this; } range() { return this; } ilike() { return this; } contains() { return this; }
  maybeSingle() { this.one = true; return this; } single() { this.one = true; return this; }
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  upsert(p) { this.op = 'upsert'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  run() {
    const tab = DB[this.t] || (DB[this.t] = []);
    const match = (r) => this.f.every((f) => f(r));
    window.__LOG.push([this.op, this.t, this.payload]);
    if (this.op === 'upsert' && this.t === 'hg_page_access') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]);
      for (const r of rows) { const i = tab.findIndex((x) => x.page_slug === r.page_slug && x.user_id === r.user_id); if (i >= 0) tab[i] = { ...r }; else tab.push({ ...r }); }
      return { data: rows, error: null };
    }
    if (this.op === 'insert' || this.op === 'upsert') {
      if (this.t === 'hg_ss_editions' && S.guardError) return { data: null, error: { message: "Termine d'abord l'édition en cours avant d'en créer une nouvelle" } };
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => ({ ...r }));
      for (const r of rows) {
        if (this.t === 'hg_badges' && tab.some((x) => x.code === r.code)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "hg_badges_pkey"' } };
        if (this.t === 'hg_invite_links') Object.assign(r, { id: 'L' + (++seq + 10), token: 'new' + String(seq).padStart(21, '0'), active: true, codes_generated: 0, created_at: new Date().toISOString() });
        if (!r.id && this.t === 'hg_card_sets') r.id = 'SETN' + (++seq);
        if (!r.id && this.t === 'hg_challenges') r.id = '00000000-0000-4000-8000-0000000d' + String(++seq).padStart(4, '0');
        tab.unshift(r);
      }
      return { data: this.one ? rows[0] : rows, error: null };
    }
    if (this.op === 'update') { const rows = tab.filter(match); rows.forEach((r) => Object.assign(r, this.payload)); return { data: this.one ? rows[0] ?? null : rows, error: null }; }
    if (this.op === 'delete') { const keep = tab.filter((r) => !match(r)); const n = tab.length - keep.length; tab.length = 0; tab.push(...keep); return { data: null, error: null, count: n }; }
    const out = tab.filter(match);
    return this.one ? { data: out[0] ?? null, error: null } : { data: out, error: null };
  }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
}
export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: S.guest ? null : { user: { id: S.uid || ME } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getUser: async () => ({ data: { user: S.guest ? null : { id: S.uid || ME } } }),
      signOut: async () => ({}),
    },
    from: (t) => new Q(t),
    rpc: async (fn, args) => {
      window.__LOG.push(['rpc', fn, args]);
      if (fn === 'hg_my_pages') {
        if (S.pagesFail) return { data: null, error: { message: 'Failed to fetch' } };
        const uid = S.uid || ME; const adm = DB.hg_profiles.find((p) => p.id === uid)?.is_admin;
        const acc = (slug) => DB.hg_page_access.find((a) => a.page_slug === slug && a.user_id === uid);
        return { data: DB.hg_pages.filter((p) => adm || (p.mode === 'membres' && acc(p.slug)?.allowed !== false) || (p.mode === 'liste' && acc(p.slug)?.allowed === true))
          .sort((a, b) => a.sort - b.sort).map(({ slug, label, in_nav, sort }) => ({ slug, label, in_nav, sort })), error: null };
      }
      if (fn === 'hg_unread_count') return { data: 0, error: null };
      if (fn === 'hg_my_perms') return { data: { is_admin: true, perms: ['membres', 'evenements', 'souvenirs', 'secret_santa', 'cartes', 'badges', 'themes', 'messages', 'support', 'bot', 'reglages', 'journal'] }, error: null };
      if (fn === 'hg_cards_admin_paillettes') {
        if (args.p_user === ME) { DB.hg_wallets[0].paillettes += args.p_delta; return { data: DB.hg_wallets[0].paillettes, error: null }; }
        return { data: 0, error: null };
      }
      if (fn === 'hg_cards_admin_give') return { data: args.p_count, error: null };
      if (fn === 'hg_cards_admin_take') return { data: null, error: null };
      if (fn === 'hg_staff_directory') return { data: DB.hg_profiles.map((p) => ({ id: p.id, pseudo: p.pseudo, avatar_url: p.avatar_url, color: p.color, is_ghost: !!p.is_ghost, joined_on: p.joined_on })), error: null };
      if (fn === 'hg_members') return { data: DB.hg_profiles.map((p) => ({ id: p.id, pseudo: p.pseudo, avatar_url: null, color: p.color, member_since: p.joined_on || p.created_at })), error: null };
      if (fn === 'hg_admin_accounts') return { data: DB.hg_profiles.map((p) => ({ id: p.id, pseudo: p.pseudo, email: p.pseudo.toLowerCase() + '@ex.ch', is_admin: p.is_admin, created_at: p.created_at, last_sign_in_at: null })), error: null };
      if (fn === 'hg_claim_invite_link') {
        window.__CLAIMS = (window.__CLAIMS || 0) + 1;
        if (S.claimError) return { data: null, error: { message: "Lien d'invitation invalide ou expiré" } };
        return { data: 'HG-Q7W' + 'XYZ'.slice(0, 3), error: null };
      }
      if (fn === 'hg_member_card') { const p = DB.hg_profiles.find((x) => x.id === args.p_user);
        const badges = DB.hg_user_badges.filter((u) => u.user_id === p.id).map((u) => { const b = DB.hg_badges.find((x) => x.code === u.badge_code); return { code: b.code, name: b.name, description: b.description, image_url: b.image_url, awarded_at: u.awarded_at }; });
        return { data: { ...p, member_since: p.joined_on || p.created_at, member_number: 7, badges, stats: { secret_santa: 3, sorties: 5 } }, error: null }; }
      if (fn === 'hg_dyn_active') {
        if (S.dynFail) return { data: null, error: { message: 'rpc indisponible' } };
        const t = Date.now();
        return { data: DB.hg_dyn_events.filter((e) => e.active && new Date(e.starts_at) <= t && new Date(e.ends_at) > t).map((e) => ({ ...e,
          my_captures: DB.hg_dyn_captures.filter((c) => c.event_id === e.id && c.user_id === ME).length,
          remaining_total: e.max_total == null ? null : e.max_total - DB.hg_dyn_captures.filter((c) => c.event_id === e.id).length })), error: null };
      }
      if (fn === 'hg_dyn_capture') {
        DB.hg_dyn_captures.push({ event_id: args.p_event, user_id: ME, captured_at: new Date().toISOString() });
        const mine = DB.hg_dyn_captures.filter((c) => c.event_id === args.p_event && c.user_id === ME).length;
        const ub = DB.hg_user_badges.find((u) => u.user_id === ME && u.badge_code === 'citrouille');
        if (ub && mine >= 3) ub.level = 2;
        return { data: { ok: true, mine, badge_new: false }, error: null };
      }
      if (fn === 'hg_dyn_leaderboard') {
        const m = new Map(); for (const c of DB.hg_dyn_captures.filter((c) => c.event_id === args.p_event)) m.set(c.user_id, (m.get(c.user_id) || 0) + 1);
        return { data: [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => { const p = DB.hg_profiles.find((x) => x.id === id); return { user_id: id, pseudo: p.pseudo, avatar_url: null, captures: n }; }), error: null };
      }
      if (fn === 'hg_my_badge_progress') { if (S.noProgress) return { data: null, error: { message: 'function not found' } }; return { data: [{ badge_code: 'fidele', metric: 'anciennete_annees', value: 4 }, { badge_code: 'citrouille', metric: 'event_captures', value: DB.hg_dyn_captures.filter((c) => c.user_id === ME && c.event_id === 'aaaaaaaa-0000-4000-8000-000000000001').length }], error: null }; }

      if (fn === 'hg_cards_me') { const w = DB.hg_wallets[0]; return { data: { paillettes: w.paillettes, boosters_opened: 4, pity: w.pity_epique, daily_streak: w.daily_streak, daily_available: !w.last_daily, free_booster_at: S.freeAt ?? iso(-0.1), god: !!S.god, config: window.__CARDS.config }, error: null }; }
      if (fn === 'hg_cards_daily') { const w = DB.hg_wallets[0]; w.last_daily = 'today'; w.paillettes += 20; return { data: { gain: 20, streak: 3 }, error: null }; }
      // hg_open_booster_req (migration 021), seulement si scenario.reqRpc : idempotence par p_request,
      // solde vérifié, et scenario.x5FailAt = numéro de la tentative qui échoue (rien n'est débité ni enregistré).
      if (fn === 'hg_open_booster_req' && S.reqRpc) {
        const w = DB.hg_wallets[0];
        window.__ATT = (window.__ATT || 0) + 1;
        window.__OK = window.__OK || new Set();
        if (S.x5FailAt && window.__ATT === S.x5FailAt) return { data: null, error: { message: 'Pas assez de Paillettes (il en faut 100)' } };
        if (window.__OK.has(args.p_request)) return { data: null, error: { message: 'booster_deja_ouvert' } };
        if (!args.p_free && w.paillettes < 100) return { data: null, error: { message: 'Pas assez de Paillettes (il en faut 100)' } };
        window.__OK.add(args.p_request);
        if (!args.p_free) w.paillettes -= 100;
        const pool = DB.hg_cards.filter((c) => c.rarity !== 'identite');
        const k = window.__OK.size - 1;
        const cards = Array.from({ length: 5 }, (_, i) => {
          const c = pool[(k * 5 + i) % pool.length];
          return { copy_id: 1000 + k * 5 + i, card_id: c.id, name: c.name, rarity: c.rarity, family: c.family, image_url: null, flavor: c.flavor, number: c.number, shiny: (k * 5 + i) % 7 === 0, serial: null, max_copies: null };
        });
        const ORD = ['commune', 'peu_commune', 'rare', 'epique', 'legendaire', 'mythique'];
        const best = cards.reduce((b, c) => (ORD.indexOf(c.rarity) > ORD.indexOf(b) ? c.rarity : b), 'commune');
        return { data: { cards, best, demandees: 5, livrees: 5 }, error: null };
      }
      if (fn === 'hg_open_booster') { const w = DB.hg_wallets[0]; if (S.paidFail && !args.p_free) return { data: null, error: { message: 'Pas assez de Paillettes (il en faut 100)' } };
        const pool = DB.hg_cards.filter((c) => c.rarity !== 'identite').slice(0, 5);
        const cards = pool.map((c, i) => ({ copy_id: 900 + i, card_id: c.id, name: c.name, rarity: i === 4 ? 'legendaire' : c.rarity, family: c.family, image_url: null, flavor: c.flavor, number: c.number, shiny: i === 2, serial: null, max_copies: null }));
        if (!args.p_free) w.paillettes -= 100; w.pity_epique = 0;
        return { data: { cards, best: 'legendaire' }, error: null }; }
      if (fn === 'hg_card_recycle') { if (S.recycleFail) return { data: null, error: { message: 'Certaines cartes ne peuvent pas être recyclées (échange en cours ?)' } };
        const ids = args.p_copies; const total = ids.length * 5; DB.hg_wallets[0].paillettes += total; DB.hg_card_copies = DB.hg_card_copies.filter((c) => !ids.includes(c.id)); return { data: total, error: null }; }
      if (fn === 'hg_card_craft') { const w = DB.hg_wallets[0]; const cost = args.p_shiny ? 160 : 40; if (!S.god && w.paillettes < cost) return { data: null, error: { message: `Pas assez de Paillettes (il en faut ${cost})` } }; w.paillettes -= cost; DB.hg_card_copies.push({ id: 500 + DB.hg_card_copies.length, card_id: args.p_card, owner_id: ME, shiny: !!args.p_shiny, serial: null, source: 'fabrication', obtained_at: iso(0), locked_trade: null, recycled_at: null }); return { data: { copy_id: 1, cost }, error: null }; }
      if (fn === 'hg_card_leaderboard') return { data: [{ user_id: ME, pseudo: 'Ethan', avatar_url: null, uniques: 5, copies: 11, shinies: 3, identites: 1, series: 0, score: 120 }, { user_id: U(2), pseudo: 'Alice', avatar_url: null, uniques: 3, copies: 4, shinies: 0, identites: 0, series: 1, score: 40 }], error: null };
      if (fn === 'hg_ss_manual_draw') return { data: args.p_pairs.length, error: null };
      return { data: null, error: null };
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {}, removeAllChannels() {},
    storage: { from: () => ({
      getPublicUrl: (p) => ({ data: { publicUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="gold"/></svg>') } }),
      upload: async (p) => { window.__LOG.push(['upload', p]); return { data: { path: p }, error: null }; },
      remove: async (p) => { window.__LOG.push(['remove', p]); return { data: [], error: null }; },
      createSignedUrl: async () => ({ data: { signedUrl: '' } }), createSignedUrls: async () => ({ data: [] }),
    }) },
    functions: { invoke: async (name, { body } = {}) => { window.__LOG.push(['fn', name, body]); return { data: body?.event === 'dyn_announce' ? { ok: true, sent: true } : {}, error: null }; } },
  };
}
