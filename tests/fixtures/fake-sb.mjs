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
  // S.ideas, S.support, S.adminLog, S.accessLog : données de départ facultatives (tests de recherche et de pagination)
  hg_ideas: S.ideas || [], hg_support: S.support || [], hg_activity: [], hg_messages: [], hg_profile_info: [],
  // Journal admin (Pilotage > Journal) : entrées d'exemple ; scénario S.adminLog / S.accessLog pour en fournir d'autres.
  hg_admin_log: S.adminLog || [
    { id: 1, admin_id: ME, action: 'carte_donnee', target_user: U(2), target_ref: 'Série Printemps #12', details: { carte: 'Renard', quantite: 1 }, created_at: iso(-30) },
    { id: 2, admin_id: ME, action: 'ajustement_paillettes', target_user: U(3), target_ref: null, details: { before: 120, after: 150, motif: 'Sortie IRL' }, created_at: iso(-90) },
    { id: 3, admin_id: U(2), action: 'carte_supprimee', target_user: U(4), target_ref: 'Carte #7', details: { carte: 'Hibou' }, created_at: iso(-600) },
  ],
  hg_admin_access_log: S.accessLog || [
    { id: 1, admin_id: ME, conversation_id: 'cccccccc-0000-4000-8000-000000000001', conversation_kind: 'direct', accessed_at: iso(-10) },
  ],
  hg_card_trades: S.trades || [],
  // Sorties IRL : vides par défaut ; un scénario peut fournir S.sorties, S.rsvps, S.eventDates, S.eventVotes, S.photos.
  hg_event_rsvps: S.rsvps || [], hg_event_dates: S.eventDates || [], hg_event_date_votes: S.eventVotes || [], 
  // Staff : catalogue des permissions (migration 026) et membres Staff. Scénario S.staff : le membre connecté (S.uid) est Staff.
  hg_perm_catalog: [['membres','Membres'],['evenements','Sorties IRL'],['souvenirs','Souvenirs et photos'],['secret_santa','Secret Santa'],
    ['cartes','Jeu de cartes'],['badges','Badges'],['themes','Thèmes et événements'],['messages','Messagerie'],['support','Assistance et idées'],
    ['bot','Bot Discord'],['reglages','Réglages du site'],['journal','Journal admin']]
    .map(([key, label], i) => ({ key, label, description: 'Description de ' + label.toLowerCase(), sort: (i + 1) * 10 })),
  hg_staff: S.staffRows || Array.isArray(S.staff) && S.staff.length ? (S.staffRows || [{ user_id: S.uid, perms: [...S.staff], active: true, note: 'Aide sur les cartes', added_by: ME,
    created_at: iso(-20), updated_at: iso(-20) }]) : [],
  // Souvenirs, photos et réactions (section admin « Souvenirs et photos »)
  hg_events: S.sorties || [{ id: 'eeeeeeee-0000-4000-8000-000000000001', title: 'Raclette de test', location: 'Lausanne', starts_at: iso(-30), created_by: ME }],
  hg_moments: [
    { id: 'mmmmmmmm-0000-4000-8000-000000000001', title: 'Le karaoké de Noël', body: 'Alice a chanté plus fort que tout le monde.', happened_on: iso(-20).slice(0, 10), image_path: null, created_by: U(2), created_at: iso(-20) },
    { id: 'mmmmmmmm-0000-4000-8000-000000000002', title: 'La partie de cartes', body: null, happened_on: iso(-60).slice(0, 10), image_path: `${U(3)}/moments/photo-souvenir.webp`, created_by: U(3), created_at: iso(-60) },
    { id: 'mmmmmmmm-0000-4000-8000-000000000003', title: 'Le sapin du lutin', body: 'Le sapin est tombé deux fois.', happened_on: iso(-400).slice(0, 10), image_path: null, created_by: ME, created_at: iso(-400) },
  ],
  hg_photos: S.photos || [
    { id: 'pppppppp-0000-4000-8000-000000000001', event_id: 'eeeeeeee-0000-4000-8000-000000000001', user_id: U(2), path: `${U(2)}/raclette-1.webp`, caption: 'Le fromage', created_at: iso(-30) },
    { id: 'pppppppp-0000-4000-8000-000000000002', event_id: 'eeeeeeee-0000-4000-8000-000000000001', user_id: ME, path: `${ME}/raclette-2.webp`, caption: null, created_at: iso(-30) },
  ],
  hg_reactions: [
    { id: 'rrrrrrrr-0000-4000-8000-000000000001', target_kind: 'moment', target_id: 'mmmmmmmm-0000-4000-8000-000000000001', user_id: U(3), emoji: '😂', created_at: iso(-19), active: true },
    { id: 'rrrrrrrr-0000-4000-8000-000000000002', target_kind: 'photo', target_id: 'pppppppp-0000-4000-8000-000000000001', user_id: U(4), emoji: '🔥', created_at: iso(-29), active: true },
    { id: 'rrrrrrrr-0000-4000-8000-000000000003', target_kind: 'moment', target_id: 'mmmmmmmm-0000-4000-8000-000000000003', user_id: U(5), emoji: '❤️', created_at: iso(-398), active: true },
    { id: 'rrrrrrrr-0000-4000-8000-000000000004', target_kind: 'moment', target_id: 'mmmmmmmm-0000-4000-8000-000000000001', user_id: U(6), emoji: '👏', created_at: iso(-18), active: false },
  ],
  hg_card_quests_templates: [
    { code: 'boosters_5', label: 'Ouvrir 5 boosters', metric: 'boosters_ouverts', target: 5, reward: 80, active: true, sort: 1 },
    { code: 'echange_1', label: 'Conclure un échange de cartes', metric: 'echanges_conclus', target: 1, reward: 50, active: true, sort: 2 },
    { code: 'photo_1', label: 'Ajouter une photo', metric: 'photos_ajoutees', target: 1, reward: 30, active: true, sort: 3 },
    { code: 'recycle_5', label: 'Recycler 5 cartes', metric: 'cartes_recyclees', target: 5, reward: 40, active: true, sort: 4 },
    { code: 'jour_3', label: 'Passer 3 fois au passage du jour', metric: 'passages_du_jour', target: 3, reward: 30, active: false, sort: 5 },
  ],
  hg_challenges: [
    { id: '00000000-0000-4000-8000-000000000024', title: 'Vingt sorties ce trimestre', description: 'Le gang fixe ensemble vingt sorties IRL.', metric: 'sorties_tenues', target: 20, reward: 100,
      starts_at: iso(-10), ends_at: iso(80), active: false },
  ],
};
DB.hg_settings.push({ key: 'push_vapid_public', value: 'BOOPdSa019_test' });
const CATALOG_KEYS = DB.hg_perm_catalog.map((c) => c.key);
const uidNow = () => S.uid || ME;
const isAdminNow = () => !!DB.hg_profiles.find((p) => p.id === uidNow())?.is_admin;
const denied = { data: null, error: { message: 'Réservé à l\'admin', code: '42501' } };
const myPermsNow = () => {
  if (isAdminNow()) return { is_admin: true, perms: [...CATALOG_KEYS] };
  const row = DB.hg_staff.find((x) => x.user_id === uidNow() && x.active);
  return { is_admin: false, perms: row ? [...row.perms] : [] };
};
const staffRowsNow = () => DB.hg_staff.map((x) => {
  const p = DB.hg_profiles.find((q) => q.id === x.user_id) || {};
  const a = DB.hg_profiles.find((q) => q.id === x.added_by);
  return { user_id: x.user_id, pseudo: p.pseudo, avatar_url: p.avatar_url ?? null, color: p.color ?? null, perms: [...x.perms], active: x.active,
    note: x.note, added_by_pseudo: a?.pseudo ?? null, created_at: x.created_at, updated_at: x.updated_at };
}).sort((a, b) => Number(b.active) - Number(a.active) || String(a.pseudo).localeCompare(String(b.pseudo)));
// Image de remplacement pour les URL signées du bucket hg-photos (carré gris, sans réseau).
const PHOTO_SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#8a7f9c"/></svg>');
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
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
// Sans clé enregistrée : visiteur (S.guest) = non connecté, membre = connecté. Après une déconnexion, la clé vaut '0'
// (le membre reste alors déconnecté, comme en ligne).
const SESSION_KEY = 'hg_test_session';
const signed = () => { try { const v = localStorage.getItem(SESSION_KEY); if (v !== null) return v === '1'; } catch (e) { /* stockage indisponible */ } return !S.guest; };
const setSigned = (on) => { try { localStorage.setItem(SESSION_KEY, on ? '1' : '0'); } catch (e) { /* stockage indisponible */ } };
// Fonctions SQL exécutables par le rôle anon (sinon : 401 « permission denied » sans session). Relevé en lecture seule
// sur le projet (has_function_privilege('anon', …)). Toute autre RPC appelée sans session est refusée et journalisée.
// Suppressions en cascade, comme les clés étrangères ON DELETE CASCADE de la base : table enfant, colonne, clé parente.
const CASCADE = {
  hg_ss_editions: [['hg_ss_participants', 'edition_id', 'id'], ['hg_ss_exclusions', 'edition_id', 'id'], ['hg_ss_assignments', 'edition_id', 'id'], ['hg_ss_wishes', 'edition_id', 'id'], ['hg_conversations', 'edition_id', 'id']],
  hg_pages: [['hg_page_access', 'page_slug', 'slug']],
};
const ANON_OK = new Set(['hg_auth_user_gone', 'hg_card_rank', 'hg_card_roll', 'hg_cards_admin_audit_del', 'hg_claim_invite_link', 'hg_msg_push_trg', 'hg_msg_realtime_trg']);
let seq = 0;
const getv = (r, c) => r[c];
class Q {
  constructor(t) { this.t = t; this.f = []; this.one = false; this.op = 'select'; this.payload = null; this.ret = false; }
  select(_c, o) { if (this.op !== 'select') this.ret = true; this.head = !!o?.head; return this; }
  eq(c, v) { this.f.push((r) => getv(r, c) === v); return this; }
  neq(c, v) { this.f.push((r) => getv(r, c) !== v); return this; }
  in(c, v) { this.f.push((r) => v.includes(getv(r, c))); return this; }
  is(c, v) { this.f.push((r) => (getv(r, c) ?? null) === v); return this; }
  not(c, op, v) { if (op === 'is') this.f.push((r) => (getv(r, c) ?? null) !== v); return this; }
  or() { return this; } order() { return this; } limit() { return this; } gte() { return this; } lte() { return this; } lt() { return this; } gt() { return this; } contains() { return this; }
  // range(a, b) : lignes a à b incluses (pagination) ; appliqué après les filtres.
  range(a, b) { this.rg = [a, b]; return this; }
  // ilike(c, motif) : % et _ joker, insensible à la casse (comme PostgREST).
  ilike(c, pat) {
    const re = new RegExp('^' + String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
    this.f.push((r) => re.test(String(getv(r, c) ?? '')));
    return this;
  }
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
        if (r.id === undefined && ['hg_moments', 'hg_photos', 'hg_events'].includes(this.t)) r.id = uid(); // comme la base (gen_random_uuid)
        if (this.t === 'hg_moments' && r.created_at === undefined) r.created_at = new Date().toISOString();
        tab.unshift(r);
      }
      return { data: this.one ? rows[0] : rows, error: null };
    }
    if (this.op === 'update') { const rows = tab.filter(match); rows.forEach((r) => Object.assign(r, this.payload)); return { data: this.one ? rows[0] ?? null : rows, error: null }; }
    if (this.op === 'delete') {
      const gone = tab.filter(match), keep = tab.filter((r) => !match(r));
      tab.length = 0; tab.push(...keep);
      for (const [child, col, key] of CASCADE[this.t] || []) {
        const ids = new Set(gone.map((r) => r[key])), kids = DB[child] || [];
        const kept = kids.filter((r) => !ids.has(r[col]));
        kids.length = 0; kids.push(...kept);
      }
      return { data: null, error: null, count: gone.length };
    }
    const out = tab.filter(match);
    if (this.head) return { data: null, error: null, count: out.length };
    if (this.one) return { data: out[0] ?? null, error: null };
    return { data: this.rg ? out.slice(this.rg[0], this.rg[1] + 1) : out, error: null };
  }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
}
// Temps réel simulé. sb.channel(nom).on(type, filtre, cb).subscribe(cb) : le canal s'enregistre ici.
// Par défaut il ne se confirme pas (comme un client sans Realtime) ; scénario realtime: true → SUBSCRIBED.
// window.__fakeRealtime.emit(table, payload) : déclenche les écouteurs « postgres_changes » de cette table
// (payload : { eventType, new, old }, INSERT par défaut). .status(s) : envoie un état à tous les canaux.
// .tables() : tables abonnées par les canaux ouverts.
const RT = { channels: new Set() };
function makeChannel(name) {
  const ch = {
    name, handlers: [], cb: null,
    on(type, filter, cb) { this.handlers.push({ type, filter: filter || {}, cb }); return this; },
    subscribe(cb) {
      this.cb = typeof cb === 'function' ? cb : null;
      RT.channels.add(this);
      if (S.realtime && this.cb) setTimeout(() => this.cb('SUBSCRIBED'), 0);
      return this;
    },
  };
  return ch;
}
window.__fakeRealtime = {
  tables: () => [...RT.channels].flatMap((c) => c.handlers.filter((h) => h.type === 'postgres_changes').map((h) => h.filter.table)),
  emit(table, payload = {}) {
    const ev = { schema: 'public', table, commit_timestamp: new Date().toISOString(), eventType: payload.eventType || 'INSERT',
      new: payload.new || {}, old: payload.old || {}, errors: null };
    for (const c of [...RT.channels]) for (const h of c.handlers) {
      if (h.type === 'postgres_changes' && h.filter.table === table && (!h.filter.event || h.filter.event === '*' || h.filter.event === ev.eventType)) h.cb(ev);
    }
  },
  status(s) { for (const c of [...RT.channels]) if (c.cb) c.cb(s); },
};

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
      signOut: async () => { setSigned(false); window.__LOG.push(['auth', 'signOut']); return {}; },
    },
    from: (t) => new Q(t),
    rpc: async (fn, args) => {
      window.__LOG.push(['rpc', fn, args]);
      if (!signed() && !ANON_OK.has(fn)) { // ce que fait PostgREST sans session : 401, « permission denied »
        window.__LOG.push(['rpc-401', fn]);
        return { data: null, error: { message: 'permission denied for function ' + fn, code: '42501' } };
      }
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
      if (fn === 'hg_my_perms') return { data: myPermsNow(), error: null };
      if (fn === 'hg_is_staff') { const m = myPermsNow(); return { data: m.is_admin || m.perms.length > 0, error: null }; }
      if (fn === 'hg_staff_list') return isAdminNow() ? { data: staffRowsNow(), error: null } : denied;
      if (fn === 'hg_staff_set') {
        if (!isAdminNow()) return denied;
        window.__LOG.push(['staff_set', args.p_user, args.p_perms]);
        if (args.p_user === ME) return { data: null, error: { message: 'Tu es déjà admin' } };
        if (!DB.hg_profiles.some((x) => x.id === args.p_user)) return { data: null, error: { message: 'Membre introuvable' } };
        const perms = [...new Set(args.p_perms || [])];
        const bad = perms.filter((k) => !CATALOG_KEYS.includes(k));
        if (bad.length) return { data: null, error: { message: 'Permission inconnue : ' + bad.join(', ') } };
        const now = new Date().toISOString();
        const row = DB.hg_staff.find((x) => x.user_id === args.p_user);
        if (row) Object.assign(row, { perms, active: args.p_active ?? true, note: args.p_note ?? row.note, updated_at: now });
        else DB.hg_staff.push({ user_id: args.p_user, perms, active: args.p_active ?? true, note: args.p_note ?? '', added_by: ME, created_at: now, updated_at: now });
        return { data: null, error: null };
      }
      if (fn === 'hg_admin_ghosts') return { data: window.__SCN?.ghosts ?? [], error: null }; // fantômes : fournis par le scénario du test
      if (fn === 'hg_ss_manual_draw') return { data: args.p_pairs.length, error: null };
      return { data: null, error: null };
    },
    channel: (name) => makeChannel(name), removeChannel: (ch) => { RT.channels.delete(ch); }, removeAllChannels() { RT.channels.clear(); },
    storage: { from: () => ({
      getPublicUrl: (p) => ({ data: { publicUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="gold"/></svg>') } }),
      upload: async (p) => { window.__LOG.push(['upload', p]); return { data: { path: p }, error: null }; },
      remove: async (p) => { window.__LOG.push(['remove', p]); return { data: [], error: null }; },
      createSignedUrl: async () => ({ data: { signedUrl: PHOTO_SVG } }),
      createSignedUrls: async (paths = []) => ({ data: paths.map((p) => ({ path: p, signedUrl: PHOTO_SVG, error: null })) }),
    }) },
    functions: { invoke: async (name, { body } = {}) => { window.__LOG.push(['fn', name, body]); return { data: body?.event === 'dyn_announce' ? { ok: true, sent: true } : {}, error: null }; } },
  };
}
