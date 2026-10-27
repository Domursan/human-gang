// Faux client Supabase des pages « Contenu et souvenirs » (idées S7, S8, S11, S12, S13) :
// citations.html, playlist.html, carnet.html, capsule.html, /pages/irl/recap.html et la vue admin « Contenus proposés ».
// Reprend le faux client général (fake-sb.mjs, chargé depuis le site de test) et y ajoute les tables et les RPC de la
// migration 089, avec les mêmes formes de réponse et les mêmes refus que la base (plafonds, vote pour soi, etc.).
// Scénarios (window.__SCN) : uid (membre connecté, Ethan admin par défaut), capsuleOpen (capsule ouverte),
//   capsuleClosed (dépôts fermés), recapYear (année du récap simulé), emptyWall (aucune citation).
// Expose window.__DB (base) et window.__LOG (journal) comme fake-sb.mjs.
const base = await import(new URL('tests/fixtures/fake-sb.mjs', document.baseURI).href);

const S = window.__SCN || {};
const DB = window.__DB;
const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const uidNow = () => S.uid || ME;
const now = Date.now();
const iso = (d) => new Date(now + d * 864e5).toISOString();
const day = (d) => iso(d).slice(0, 10);
let seq = 100;
const nid = () => `aaaaaaaa-bbbb-4ccc-8ddd-${String(++seq).padStart(12, '0')}`;
const err = (message) => ({ data: null, error: { message } });
/** Lundi de la semaine en cours (AAAA-MM-JJ). */
const weekStart = (() => { const d = new Date(); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return d.toISOString().slice(0, 10); })();
const lastWeek = (() => { const d = new Date(`${weekStart}T12:00:00`); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();

/* ---------- Pages du menu ---------- */
for (const [slug, label, sort] of [['citations', 'Citations', 12], ['playlist', 'Playlist', 13], ['carnet', 'Carnet de voyage', 14], ['capsule', 'Capsules', 15]]) {
  if (!DB.hg_pages.some((p) => p.slug === slug)) DB.hg_pages.push({ slug, label, mode: 'membres', in_nav: true, sort });
}

/* ---------- S13 : citations ---------- */
DB.hg_quotes = S.emptyWall ? [] : [
  { id: 'q-1', text: 'Le livre est mieux.', author_id: U(2), author_label: null, said_on: '2023-05-01', context: 'sortie ciné', status: 'valide', author_ok_game: true, author_seen_at: iso(-10), proposed_by: U(3), validated_at: iso(-9), created_at: iso(-10) },
  { id: 'q-2', text: 'T’es en retard !', author_id: null, author_label: 'Tout le gang', said_on: null, context: 'depuis 2022', status: 'valide', author_ok_game: false, proposed_by: ME, validated_at: iso(-8), created_at: iso(-9) },
  { id: 'q-3', text: 'C’est pas un pays, ça. C’est le Tzatzikistan.', author_id: U(3), author_label: null, said_on: '2022-03-02', context: 'Worldle', status: 'valide', author_ok_game: false, proposed_by: U(2), validated_at: iso(-7), created_at: iso(-8) },
  { id: 'q-4', text: 'On dit pâté-saucisses, pas raclette.', author_id: U(4), author_label: null, said_on: '2024-11-08', context: 'soirée jeux', status: 'valide', author_ok_game: false, proposed_by: U(2), validated_at: iso(-6), created_at: iso(-7) },
  // Proposition en attente qui cite Ethan (bandeau « On t'a cité »).
  { id: 'q-5', text: 'Je lance la Domu-mobile.', author_id: ME, author_label: null, said_on: null, context: 'RDV Lyon 2026', status: 'propose', author_ok_game: false, author_seen_at: null, proposed_by: U(5), validated_at: null, created_at: iso(-1) },
  // Proposition d'Ethan en attente (visible seulement par lui et le Staff).
  { id: 'q-6', text: 'Encore une partie et je dors.', author_id: U(6), author_label: null, said_on: null, context: null, status: 'propose', author_ok_game: false, proposed_by: ME, validated_at: null, created_at: iso(-0.5) },
];
if (!DB.hg_reactions) DB.hg_reactions = [];
DB.hg_reactions.push({ id: 'r-q1', target_kind: 'quote', target_id: 'q-1', user_id: U(3), emoji: '😂', active: true, created_at: iso(-2) },
  { id: 'r-q2', target_kind: 'quote', target_id: 'q-1', user_id: U(4), emoji: '😂', active: true, created_at: iso(-2) });

/* ---------- S8 : playlist ---------- */
DB.hg_tracks = [
  { id: 't-1', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', platform: 'youtube', title: 'Factory Theme', artist: 'Satisfactory OST', note: 'la musique de Satisfactory qui tourne en boucle', tag: 'jeux', heardle_ok: false, hidden: false, added_by: U(3), week_start: weekStart, created_at: iso(-0.4) },
  { id: 't-2', url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', platform: 'spotify', title: 'Tattoo', artist: 'Loreen', note: 'on en reparle en mai', tag: 'eurovision', heardle_ok: false, hidden: false, added_by: ME, week_start: weekStart, created_at: iso(-0.3) },
  { id: 't-0', url: 'https://www.youtube.com/watch?v=abcdefghijk', platform: 'youtube', title: 'Mea Culpa', artist: 'Gojira', note: null, tag: 'sport', heardle_ok: true, hidden: false, added_by: U(5), week_start: lastWeek, created_at: iso(-8) },
];
DB.hg_track_votes = [{ week_start: weekStart, user_id: U(4), track_id: 't-1' }];
DB.hg_track_weeks = [{ week_start: lastWeek, winner_id: 't-0', votes: 9 }];

/* ---------- S12 : cartes postales ---------- */
DB.hg_postcards = [
  { id: 'p-1', user_id: U(2), path: `${U(2)}/postcards/p1.webp`, place_label: 'Kyoto, Japon', country_code: 'jp', lat: 35.0, lng: 135.8, message: 'Mille torii plus tard, mes mollets demandent l’asile.', taken_on: day(-1), publish_at: iso(-1), geoguessr_ok: false, hidden: false, created_at: iso(-1) },
  { id: 'p-2', user_id: U(6), path: `${U(6)}/postcards/p2.webp`, place_label: 'Chamonix, France', country_code: 'fr', lat: 45.9, lng: 6.9, message: 'Première descente, zéro chute. Bon, une.', taken_on: day(-3), publish_at: iso(-3), geoguessr_ok: true, hidden: false, created_at: iso(-3) },
  { id: 'p-3', user_id: ME, path: `${ME}/postcards/p3.webp`, place_label: 'Rome, Italie', country_code: 'it', lat: 41.9, lng: 12.5, message: 'Carte différée', taken_on: day(0), publish_at: iso(5), geoguessr_ok: false, hidden: false, created_at: iso(0) },
];

/* ---------- S7 : capsules ---------- */
const CAP = 'cccccccc-0000-4000-8000-000000000001';
(DB.hg_events ||= []).push({ id: 'ev-na', title: 'Nouvel an chez Litver', starts_at: iso(60), created_by: ME });
DB.hg_capsules = [{ id: CAP, title: 'Nouvel an 2027', description: 'Un mot pour le gang de 2027.', event_id: 'ev-na', event_title: 'Nouvel an chez Litver',
  deposit_until: S.capsuleOpen || S.capsuleClosed ? iso(-1) : iso(60), opens_at: S.capsuleOpen ? iso(-0.01) : iso(69.4), created_by: ME }];
DB.hg_capsule_items = [
  { id: 'ci-1', capsule_id: CAP, user_id: ME, kind: 'prediction', body: 'En 2027, on finit enfin la campagne Serge.', path: null, hidden: false, created_at: iso(-2) },
  { id: 'ci-2', capsule_id: CAP, user_id: U(2), kind: 'mot', body: 'Bonne année le gang !', path: null, hidden: false, created_at: iso(-2) },
  { id: 'ci-3', capsule_id: CAP, user_id: U(3), kind: 'photo', body: 'Lyon 2026', path: `${CAP}/${U(3)}/x.webp`, hidden: false, created_at: iso(-1) },
];
DB.hg_capsule_votes = [];

/* ---------- Récap (S11) ---------- */
const RECAP = {
  year: S.recapYear || new Date().getFullYear() - 1,
  gang: {
    membres_total: 14, nouveaux_membres: ['Alice'], sorties: [{ id: 'e1', title: 'RDV Lyon', location: 'Lyon', starts_at: iso(-200), presents: 9 }],
    photos: 40, top_photographes: [{ pseudo: 'Alice', n: 20 }], plus_presents: [], secret_santa: null, moments: [], badges_debloques: 3, messages: 120,
    carte_plus_rare: { id: 'k1', name: 'La Domu-mobile', rarity: 'legendaire', family: 'objet', image_url: null, flavor: 'Elle démarre quand elle veut.', number: 2, max_copies: null, set_name: 'Les OG', obtained_at: iso(-100) },
    morceaux: { n: 5, titres: [{ title: 'Mea Culpa', artist: 'Gojira' }, { title: 'Tattoo', artist: 'Loreen' }] },
    citations: { n: 4, extraits: ['Le livre est mieux.', 'T’es en retard !'] },
    cartes_postales: { n: 2, pays: 2 },
  },
  moi: { sorties: 3, photos: 4, badges: [], secret_santa: 1, messages_envoyes: 12, boosters_ouverts: 87,
    carte_plus_rare: { id: 'k2', name: 'Le Raclettor', rarity: 'epique', family: 'objet', image_url: null, flavor: 'Il a fondu avant la fin du film.', number: 1, max_copies: null, obtained_at: iso(-260) },
    cartes_postales: { n: 1, pays: 1 } },
  masquees: S.recapMasquees || [],
};

/* ---------- RPC de la migration 089 ---------- */
const me = () => uidNow();
const isStaff = () => DB.hg_profiles.find((p) => p.id === me())?.is_admin;
const playlist = () => ({
  week_start: weekStart, today: DB.hg_tracks.filter((t) => t.added_by === me() && Date.now() - new Date(t.created_at) < 864e5).length, cap: 3,
  my_vote: DB.hg_track_votes.find((v) => v.week_start === weekStart && v.user_id === me())?.track_id || null,
  tracks: DB.hg_tracks.filter((t) => !t.hidden || t.added_by === me()).map((t) => ({ ...t, votes: t.week_start === weekStart ? DB.hg_track_votes.filter((v) => v.track_id === t.id).length : null })),
  winners: DB.hg_track_weeks.map((w) => { const t = DB.hg_tracks.find((x) => x.id === w.winner_id); return { week_start: w.week_start, votes: w.votes, ...t }; }),
});
const capsule = (c) => {
  const open = new Date(c.opens_at) <= Date.now();
  const items = DB.hg_capsule_items.filter((i) => i.capsule_id === c.id);
  return {
    now: new Date().toISOString(),
    capsule: { ...c, is_open: open, can_manage: isStaff() || c.created_by === me() },
    members: new Set(items.map((i) => i.user_id)).size, items_count: items.length,
    mine: items.filter((i) => i.user_id === me()),
    items: open ? items.filter((i) => !i.hidden || i.user_id === me() || isStaff()).map((i) => ({ ...i,
      realisee: DB.hg_capsule_votes.filter((v) => v.item_id === i.id && v.verdict === 'realisee').length,
      ratee: DB.hg_capsule_votes.filter((v) => v.item_id === i.id && v.verdict === 'ratee').length,
      my_vote: DB.hg_capsule_votes.find((v) => v.item_id === i.id && v.user_id === me())?.verdict || null })) : null,
  };
};

const RPC = {
  hg_quote_propose: (a) => {
    if (!a.p_text || a.p_text.length < 2) return err('La citation fait entre 2 et 280 caractères.');
    if (DB.hg_quotes.filter((q) => q.proposed_by === me() && Date.now() - new Date(q.created_at) < 864e5).length >= 5) return err('Tu as déjà proposé 5 citations aujourd’hui. Reviens demain !');
    const id = nid();
    DB.hg_quotes.push({ id, text: a.p_text, author_id: a.p_author, author_label: a.p_author_label, said_on: a.p_said_on, context: a.p_context, status: 'propose', author_ok_game: false, proposed_by: me(), created_at: new Date().toISOString() });
    return { data: id, error: null };
  },
  hg_quote_author_decide: (a) => {
    const q = DB.hg_quotes.find((x) => x.id === a.p_id);
    if (!q || q.author_id !== me()) return err('Seule la personne citée peut décider.');
    if (a.p_action === 'retirer') q.status = q.status === 'propose' ? 'refuse' : 'retire';
    if (a.p_action === 'jeu_oui' || a.p_action === 'jeu_non') q.author_ok_game = a.p_action === 'jeu_oui';
    q.author_seen_at = new Date().toISOString();
    return { data: q.status, error: null };
  },
  hg_quote_review: (a) => {
    const q = DB.hg_quotes.find((x) => x.id === a.p_id);
    if (!q) return err('Citation introuvable');
    if (a.p_action !== 'retirer' && q.status !== 'propose') return err('Cette citation n’est plus en attente.');
    q.status = a.p_action === 'valider' ? 'valide' : a.p_action === 'refuser' ? 'refuse' : 'retire';
    if (q.status === 'valide') q.validated_at = new Date().toISOString();
    return { data: { status: q.status, reward: q.status === 'valide' && q.proposed_by !== me() ? 20 : 0 }, error: null };
  },
  hg_playlist: () => ({ data: playlist(), error: null }),
  hg_track_add: (a) => {
    if (!/^https:\/\//.test(a.p_url || '')) return err('Lien non accepté : YouTube, Spotify, Deezer ou SoundCloud, en https.');
    if (playlist().today >= 3) return err('Tu as déjà partagé 3 morceaux aujourd’hui.');
    const id = nid();
    const platform = /spotify/.test(a.p_url) ? 'spotify' : /deezer/.test(a.p_url) ? 'deezer' : /soundcloud/.test(a.p_url) ? 'soundcloud' : 'youtube';
    DB.hg_tracks.unshift({ id, url: a.p_url, platform, title: a.p_title, artist: a.p_artist, note: a.p_note, tag: a.p_tag, heardle_ok: false, hidden: false, added_by: me(), week_start: weekStart, created_at: new Date().toISOString() });
    return { data: id, error: null };
  },
  hg_track_vote: (a) => {
    DB.hg_track_votes = DB.hg_track_votes.filter((v) => !(v.week_start === weekStart && v.user_id === me()));
    if (!a.p_track) return { data: null, error: null };
    const t = DB.hg_tracks.find((x) => x.id === a.p_track);
    if (t.added_by === me()) return err('Tu ne peux pas voter pour ton propre morceau.');
    DB.hg_track_votes.push({ week_start: weekStart, user_id: me(), track_id: a.p_track });
    return { data: a.p_track, error: null };
  },
  hg_track_moderate: (a) => {
    const t = DB.hg_tracks.find((x) => x.id === a.p_id);
    if (a.p_action === 'masquer') t.hidden = true;
    if (a.p_action === 'afficher') t.hidden = false;
    if (a.p_action === 'heardle_oui') t.heardle_ok = true;
    if (a.p_action === 'heardle_non') t.heardle_ok = false;
    return { data: null, error: null };
  },
  hg_postcard_add: (a) => {
    if (!new RegExp(`^${me()}/postcards/`).test(a.p_path || '')) return err('Chemin de photo invalide');
    const id = nid();
    const r = (x) => (x == null ? null : Math.round(Number(x) * 10) / 10);
    const pub = a.p_publish_at || new Date().toISOString();
    const nouveau = a.p_country && !DB.hg_postcards.some((p) => p.user_id === me() && p.country_code === a.p_country);
    DB.hg_postcards.unshift({ id, user_id: me(), path: a.p_path, place_label: a.p_place, country_code: a.p_country, lat: r(a.p_lat), lng: r(a.p_lng),
      message: a.p_message, taken_on: a.p_taken_on, publish_at: pub, geoguessr_ok: !!a.p_geoguessr, hidden: false, created_at: new Date().toISOString() });
    return { data: { id, reward: nouveau ? 30 : 0, publish_at: pub }, error: null };
  },
  hg_postcard_hide: (a) => { const p = DB.hg_postcards.find((x) => x.id === a.p_id); p.hidden = !!a.p_hidden; return { data: null, error: null }; },
  hg_capsules_list: () => ({ data: { now: new Date().toISOString(), can_create: isStaff(), events: [{ id: 'ev-na', title: 'Nouvel an chez Litver', starts_at: iso(60) }],
    capsules: DB.hg_capsules.map((c) => { const k = capsule(c); return { ...k.capsule, members: k.members, items: k.items_count, mine: k.mine.length }; }) }, error: null }),
  hg_capsule_get: (a) => { const c = DB.hg_capsules.find((x) => x.id === a.p_capsule); return { data: c ? capsule(c) : null, error: null }; },
  hg_capsule_save: (a) => {
    if (new Date(a.p_opens_at) < new Date(a.p_deposit_until)) return err('L’ouverture doit suivre la fin des dépôts.');
    if (a.p_id) {
      const c = DB.hg_capsules.find((x) => x.id === a.p_id);
      if (new Date(a.p_opens_at) < new Date(c.opens_at)) return err('Des objets sont déjà déposés : l’ouverture peut être repoussée, jamais avancée.');
      Object.assign(c, { title: a.p_title, description: a.p_description, deposit_until: a.p_deposit_until, opens_at: a.p_opens_at });
      return { data: c.id, error: null };
    }
    const id = nid();
    DB.hg_capsules.push({ id, title: a.p_title, description: a.p_description, event_id: a.p_event, deposit_until: a.p_deposit_until, opens_at: a.p_opens_at, created_by: me() });
    return { data: id, error: null };
  },
  hg_capsule_deposit: (a) => {
    const c = DB.hg_capsules.find((x) => x.id === a.p_capsule);
    if (new Date(c.deposit_until) <= Date.now()) return err('Les dépôts sont fermés pour cette capsule.');
    if (DB.hg_capsule_items.filter((i) => i.capsule_id === c.id && i.user_id === me()).length >= 3) return err('Tu as déjà glissé 3 objets dans cette capsule.');
    const id = nid();
    DB.hg_capsule_items.push({ id, capsule_id: c.id, user_id: me(), kind: a.p_kind, body: a.p_body, path: a.p_path, hidden: false, created_at: new Date().toISOString() });
    return { data: id, error: null };
  },
  hg_capsule_withdraw: (a) => {
    const i = DB.hg_capsule_items.find((x) => x.id === a.p_item && x.user_id === me());
    if (!i) return err('Objet introuvable');
    DB.hg_capsule_items = DB.hg_capsule_items.filter((x) => x !== i);
    return { data: i.path, error: null };
  },
  hg_capsule_vote: (a) => {
    DB.hg_capsule_votes = DB.hg_capsule_votes.filter((v) => !(v.item_id === a.p_item && v.user_id === me()));
    if (a.p_verdict) DB.hg_capsule_votes.push({ item_id: a.p_item, user_id: me(), verdict: a.p_verdict });
    return { data: null, error: null };
  },
  hg_capsule_hide: (a) => { const i = DB.hg_capsule_items.find((x) => x.id === a.p_item); i.hidden = !!a.p_hidden; return { data: null, error: null }; },
  hg_year_recap: () => ({ data: RECAP, error: null }),
  hg_recap_diapos_set: (a) => { RECAP.masquees = a.p_keys || []; return { data: RECAP.masquees, error: null }; },
  hg_toggle_reaction: (a) => {
    const r = DB.hg_reactions.find((x) => x.target_kind === a.p_kind && x.target_id === a.p_id && x.user_id === me() && x.emoji === a.p_emoji);
    if (r) { r.active = !r.active; return { data: r.active, error: null }; }
    DB.hg_reactions.push({ id: nid(), target_kind: a.p_kind, target_id: a.p_id, user_id: me(), emoji: a.p_emoji, active: true, created_at: new Date().toISOString() });
    return { data: true, error: null };
  },
};

/* ---------- Client exporté ---------- */
/** Faux client : celui de fake-sb.mjs, avec les RPC de la migration 089 en plus. */
export function createClient(...args) {
  const c = base.createClient(...args);
  const rpc = c.rpc.bind(c);
  c.rpc = async (fn, a = {}) => {
    if (RPC[fn]) { window.__LOG.push(['rpc', fn, a]); return RPC[fn](a); }
    return rpc(fn, a);
  };
  const st = c.storage.from.bind(c.storage);
  c.storage.from = (bucket) => {
    const b = st(bucket);
    if (bucket !== 'hg-capsules') return b;
    return { ...b, upload: async (p) => { window.__LOG.push(['upload', bucket, p]); return { data: { path: p }, error: null }; },
      remove: async (ps) => { window.__LOG.push(['remove', bucket, ps]); return { data: null, error: null }; } };
  };
  return c;
}
