// Faux supabase-js avec état (tests hors ligne de l'admin v4).
// Copie de qa/fake-sb.mjs, complétée par la connexion simulée (signInWithPassword) pour le test de connexion.
// Ne doit jamais être remplacé par le vrai client : il est servi à la place de cdn.jsdelivr.net/…/supabase-js.
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
// Scénario badgeCount : le membre de test (ME) obtient exactement N badges (0, 3 par défaut, 20…).
// Les badges ajoutés alternent image et repli (initiales) ; le premier est à niveaux.
if (Number.isInteger(S.badgeCount)) {
  const mine = DB.hg_user_badges.filter((u) => u.user_id === ME);
  DB.hg_user_badges = DB.hg_user_badges.filter((u) => u.user_id !== ME || mine.indexOf(u) < S.badgeCount);
  for (let i = mine.length; i < S.badgeCount; i++) {
    const code = `test_badge_${String(i).padStart(2, '0')}`;
    DB.hg_badges.push({ code, name: `Badge test ${i + 1}`, description: 'Badge de test', image_url: i % 3 ? PUMPKIN : null, sort: 1000 + i,
      levels_enabled: i === 0, levels: i === 0 ? [{ level: 1, threshold: 1, name: 'Bronze' }, { level: 2, threshold: 3, name: 'Argent' }] : [] });
    DB.hg_user_badges.push({ user_id: ME, badge_code: code, awarded_at: iso(-i - 1), level: i === 0 ? 2 : 1 });
  }
}
window.__DB = DB; window.__LOG = [];
// Session : un visiteur (S.guest) n'est connecté qu'après signInWithPassword. La session tient dans
// localStorage, comme le vrai client, pour survivre à la redirection qui suit la connexion.
const SESSION_KEY = 'hg_test_session';
const signed = () => !S.guest || (() => { try { return localStorage.getItem(SESSION_KEY) === '1'; } catch (e) { return false; } })();
const setSigned = (on) => { try { if (on) localStorage.setItem(SESSION_KEY, '1'); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* stockage indisponible */ } };
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
      // Ajout par rapport au faux de qa/ : connexion simulée. Un visiteur (S.guest) devient
      // connecté après signInWithPassword réussi, sauf si S.badPassword.
      getSession: async () => ({ data: { session: signed() ? { user: { id: S.uid || ME } } : null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getUser: async () => ({ data: { user: signed() ? { id: S.uid || ME } : null } }),
      signInWithPassword: async ({ email, password } = {}) => {
        window.__LOG.push(['auth', 'signInWithPassword', email]);
        if (S.badPassword || !password) return { data: { session: null, user: null }, error: { message: 'Invalid login credentials' } };
        setSigned(true);
        return { data: { session: { user: { id: S.uid || ME } }, user: { id: S.uid || ME } }, error: null };
      },
      signOut: async () => { setSigned(false); return {}; },
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
