// Faux client Supabase pour les idées « Contenu et souvenirs » (S1 Ce jour-là, S2 Lexique, S3 Jeux, S6 Gartic).
// Enveloppe fake-sb.mjs sans le modifier : charge le faux de base (même état window.__DB / __LOG), ajoute les tables
// de la migration 088 et simule ses RPC. Servi à la place de supabase-js (tests/lib/harness.cjs, fixture 'fake-sb-contenu.mjs').
// Scénario (window.__SCN) : ceJour (liste renvoyée par hg_on_this_day, [] par défaut : tuile masquée), ceJourOff (null),
//   gartic.vote_open (vote ouvert), uid (membre connecté), staff (permissions), lexFail (lecture du lexique en erreur).
// Exporte createClient().

const base = await import(`${location.origin}${window.__HG_RACINE || ''}/tests/fixtures/fake-sb.mjs`);
const S = window.__SCN || {};
const DB = window.__DB;
const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const me = () => S.uid || ME;
const now = Date.now(), iso = (d) => new Date(now + d * 864e5).toISOString();
const day = (d) => iso(d).slice(0, 10);
let seq = 500;
const nid = () => `aaaa0000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const GIF = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#fff"/><circle cx="2" cy="1.5" r="1" fill="#9A88C4"/></svg>');

/* ---------- Pages ajoutées par 088 ---------- */
for (const [slug, label, in_nav, sort] of [['lexique', 'Lexique', true, 10], ['ludotheque', 'Ludothèque', true, 11], ['gartic', 'Galerie Gartic Phone', false, 12]]) {
  if (!DB.hg_pages.some((p) => p.slug === slug)) DB.hg_pages.push({ slug, label, mode: 'admin', in_nav, sort });
}

// Scénario S.ideesOuvertes : les pages des idées sont ouvertes aux membres (après l'ouverture par l'admin, hors lancement).
if (S.ideesOuvertes) for (const p of DB.hg_pages) if (['lexique', 'ludotheque', 'gartic'].includes(p.slug)) p.mode = 'membres';

/* ---------- Données ---------- */
DB.hg_settings.push({ key: 'contenu', value: { ce_jour_la: true, gartic_vote: S.garticVote || 'auto', lexique_gain: 20 } });
DB.hg_lexicon = [
  { id: 'lx-1', term: 'Tzatzikistan', slug: 'tzatzikistan', definition: 'Pays imaginaire né d’un Worldle raté. Tout pays introuvable est « en Tzatzikistan ».', origin_on: '2022-03-14', origin_label: 'Worldle du matin', example: '2 300 km plein ouest… c’est encore le Tzatzikistan.', moment_id: 'mmmmmmmm-0000-4000-8000-000000000001', event_id: null, status: 'valide', proposed_by: U(2), created_at: iso(-200) },
  { id: 'lx-2', term: 'Le livre est mieux', slug: 'le-livre-est-mieux', definition: 'La réponse automatique à toute adaptation du ciné du dimanche.', origin_on: '2023-05-01', origin_label: null, example: null, moment_id: null, event_id: null, status: 'valide', proposed_by: null, created_at: iso(-150) },
  { id: 'lx-3', term: 'Serge', slug: 'serge', definition: 'Notre campagne multi CK3, menée par Terrow. <script>alert(1)</script>', origin_on: '2024-02-01', origin_label: 'Campagne CK3', example: null, moment_id: null, event_id: null, status: 'valide', proposed_by: null, created_at: iso(-100) },
  { id: 'lx-4', term: 'Éclair au fromage', slug: 'eclair-au-fromage', definition: 'Proposition encore en attente.', origin_on: null, origin_label: null, example: null, moment_id: null, event_id: null, status: 'propose', proposed_by: U(3), created_at: iso(-1) },
  { id: 'lx-5', term: 'Mot refusé', slug: 'mot-refuse', definition: 'Refusé par le Staff.', origin_on: null, origin_label: null, example: null, moment_id: null, event_id: null, status: 'refuse', refusal_reason: 'Vise quelqu’un sans son accord', proposed_by: ME, created_at: iso(-3) },
];
DB.hg_ludo_games = [
  { slug: 'ck3', name: 'Crusader Kings III', kind: 'long', color: '#E0909A', icon: 'couronne', links: [{ label: 'Wiki', url: 'https://ck3.paradoxwikis.com/Home' }], rules_md: '**Un duché** chacun.\n- Pas de guerre avant 1100\n- *Tirage* au sort\n<img src=x onerror=alert(1)>', rules_updated_by: U(2), rules_updated_at: iso(-10), sort: 20, active: true },
  { slug: 'minecraft', name: 'Minecraft', kind: 'long', color: '#6FA37F', icon: 'bloc', links: [], rules_md: null, sort: 40, active: true },
  { slug: 'gartic-phone', name: 'Gartic Phone', kind: 'soiree', color: '#9A88C4', icon: 'crayon', links: [], rules_md: null, sort: 120, active: true },
  { slug: 'codenames', name: 'Codenames', kind: 'soiree', color: '#CF7055', icon: 'cartes', links: [], rules_md: null, sort: 130, active: true },
];
DB.hg_ludo_referents = [{ game_slug: 'ck3', user_id: U(2) }];
DB.hg_ludo_players = [{ game_slug: 'ck3', user_id: U(2), level: 'regulier', role_label: 'Meneur · Empire de Serge' }, { game_slug: 'ck3', user_id: U(3), level: 'apprendre', role_label: null }];
DB.hg_ludo_sessions = [{ id: 'gs-1', game_slug: 'ck3', starts_at: iso(2), note: 'Session 13 de la campagne Serge.', created_by: U(2), cancelled_at: null },
  { id: 'gs-0', game_slug: 'ck3', starts_at: iso(-12), note: 'Session 12', created_by: U(2), cancelled_at: null }];
DB.hg_ludo_session_rsvps = [{ session_id: 'gs-1', user_id: U(2), status: 'oui' }, { session_id: 'gs-1', user_id: U(4), status: 'peut-etre' }];
DB.hg_ludo_private = [{ game_slug: 'ck3', links: [{ label: 'Mot de passe', value: 'serge1066' }] }];
DB.hg_ludo_rules_history = [{ id: 1, game_slug: 'ck3', edited_by: U(2), edited_at: iso(-10) }, { id: 2, game_slug: 'ck3', edited_by: U(2), edited_at: iso(-30) }];
DB.hg_gartic_parties = [{ id: 'gp-1', played_on: day(-12), title: 'Soirée du 11 octobre', created_by: U(2), hidden: false }];
DB.hg_gartic_chains = [1, 2, 3].map((i) => ({ id: `gc-${i}`, party_id: 'gp-1', path: `${U(2)}/gartic/c${i}.gif`, thumb_path: `${U(2)}/gartic/c${i}-v.webp`,
  prompt_start: i === 1 ? 'Un canard qui fait ses impôts' : `Départ ${i}`, prompt_end: i === 1 ? 'Le Tzatzikistan déclare la guerre' : `Arrivée ${i}`, created_by: i === 3 ? ME : U(2), hidden: false, created_at: iso(-12 + i / 100) }));
DB.hg_gartic_votes = [];

/* ---------- RPC simulées ---------- */
const ok = (data) => ({ data, error: null });
const ko = (message) => ({ data: null, error: { message } });
const cfg = () => DB.hg_settings.find((r) => r.key === 'contenu').value;
const RPC = {
  hg_on_this_day: () => ok(S.ceJourOff ? null : (S.ceJour || [])),
  hg_lexicon_word_of_day: () => ok(S.noWord ? null : { term: 'Tzatzikistan', slug: 'tzatzikistan', definition: DB.hg_lexicon[0].definition }),
  hg_contenu_reglages: () => ok({ ...cfg() }),
  hg_contenu_reglages_set: ({ p }) => { Object.assign(cfg(), p); return ok({ ...cfg() }); },
  hg_on_this_day_hide: () => ok(true),
  hg_lexicon_propose: ({ p_term, p_definition, p_origin_on, p_origin_label, p_example }) => {
    if (!p_term || String(p_definition).length < 10) return ko('La définition fait de 10 à 600 caractères');
    const id = nid();
    DB.hg_lexicon.push({ id, term: p_term, slug: p_term.toLowerCase().replace(/[^a-z0-9]+/g, '-'), definition: p_definition, origin_on: p_origin_on, origin_label: p_origin_label, example: p_example, status: 'propose', proposed_by: me(), created_at: new Date().toISOString() });
    return ok(id);
  },
  hg_lexicon_review: ({ p_id, p_status, p_reason, p_consent, p_patch }) => {
    const r = DB.hg_lexicon.find((x) => x.id === p_id);
    if (!r) return ko('Mot introuvable');
    if (p_status === 'valide' && !p_consent) return ko('Coche « La personne concernée est OK » pour valider');
    if (p_status === 'refuse' && !(p_reason || '').trim()) return ko('Donne un motif court (2 à 200 caractères)');
    Object.assign(r, p_patch || {}, { status: p_status, refusal_reason: p_status === 'refuse' ? p_reason : null, consent_ok: p_status === 'valide' || r.consent_ok });
    const paid = p_status === 'valide' && r.proposed_by && !r.rewarded_at ? 20 : 0;
    if (paid) r.rewarded_at = new Date().toISOString();
    return ok({ status: p_status, paid });
  },
  hg_ludo_session_create: ({ p_slug, p_starts, p_note }) => {
    const id = nid();
    DB.hg_ludo_sessions.push({ id, game_slug: p_slug, starts_at: p_starts, note: p_note, created_by: me(), cancelled_at: null });
    DB.hg_ludo_session_rsvps.push({ session_id: id, user_id: me(), status: 'oui' });
    return ok(id);
  },
  hg_ludo_session_cancel: ({ p_id }) => { const s = DB.hg_ludo_sessions.find((x) => x.id === p_id); if (s) s.cancelled_at = new Date().toISOString(); return ok(null); },
  hg_ludo_rules_save: ({ p_slug, p_rules }) => { const g = DB.hg_ludo_games.find((x) => x.slug === p_slug); Object.assign(g, { rules_md: p_rules, rules_updated_by: me(), rules_updated_at: new Date().toISOString() }); return ok(g.rules_updated_at); },
  hg_ludo_links_save: ({ p_slug, p_links, p_private }) => {
    if ((p_links || []).some((l) => !/^https:\/\/([a-z0-9-]+\.)*(paradoxwikis\.com|discord\.gg|codenames\.game)\//.test(l.url))) return ko('Lien refusé : adresse https d’un site de la liste blanche seulement.');
    DB.hg_ludo_games.find((x) => x.slug === p_slug).links = p_links;
    const pr = DB.hg_ludo_private.find((x) => x.game_slug === p_slug);
    if (pr) pr.links = p_private; else DB.hg_ludo_private.push({ game_slug: p_slug, links: p_private });
    return ok(null);
  },
  hg_ludo_save: ({ p }) => {
    let g = DB.hg_ludo_games.find((x) => x.slug === p.slug);
    if (p.create) { if (g) return ko(`Une fiche « ${p.slug} » existe déjà`); g = { slug: p.slug, links: [], rules_md: null }; DB.hg_ludo_games.push(g); }
    Object.assign(g, { name: p.name, kind: p.kind, color: p.color, icon: p.icon, sort: p.sort, active: p.active });
    DB.hg_ludo_referents = DB.hg_ludo_referents.filter((r) => r.game_slug !== p.slug).concat((p.referents || []).map((u) => ({ game_slug: p.slug, user_id: u })));
    return ok(p.slug);
  },
  hg_gartic_state: () => {
    const y = new Date().getFullYear();
    return ok({ year: y, vote_open: !!S.voteOpen, my_vote: (DB.hg_gartic_votes.find((v) => v.user_id === me()) || {}).chain_id || null, results: S.voteOpen ? null : (S.results || null) });
  },
  hg_gartic_party_create: ({ p_played_on, p_title }) => { const id = nid(); DB.hg_gartic_parties.unshift({ id, played_on: p_played_on, title: p_title, created_by: me(), hidden: false }); return ok(id); },
  hg_gartic_add_chain: ({ p_party, p_path, p_thumb, p_start, p_end }) => {
    if (!String(p_path).startsWith(`${me()}/gartic/`)) return ko('Fichier refusé');
    if (DB.hg_gartic_chains.filter((c) => c.party_id === p_party && !c.hidden).length >= 10) return ko('Cet album a déjà 10 chaînes : garde les meilleures.');
    const id = nid();
    DB.hg_gartic_chains.push({ id, party_id: p_party, path: p_path, thumb_path: p_thumb, prompt_start: p_start, prompt_end: p_end, created_by: me(), hidden: false, created_at: new Date().toISOString() });
    return ok(id);
  },
  hg_gartic_vote: ({ p_chain }) => {
    if (!S.voteOpen) return ko('Le vote du dessin de l’année n’est pas ouvert');
    const c = DB.hg_gartic_chains.find((x) => x.id === p_chain);
    if (c.created_by === me()) return ko('Tu ne peux pas voter pour une chaîne que tu as déposée');
    DB.hg_gartic_votes = DB.hg_gartic_votes.filter((v) => v.user_id !== me()).concat({ user_id: me(), chain_id: p_chain });
    return ok(new Date().getFullYear());
  },
  hg_gartic_hide: ({ p_kind, p_id, p_hidden }) => { const t = p_kind === 'chain' ? DB.hg_gartic_chains : DB.hg_gartic_parties; const r = t.find((x) => x.id === p_id); if (r) r.hidden = p_hidden; return ok(p_hidden); },
};

/* ---------- Upserts sur clé composée (comme la base) ---------- */
const KEYS = { hg_ludo_players: ['game_slug', 'user_id'], hg_ludo_session_rsvps: ['session_id', 'user_id'] };

/** Client : celui du faux de base, avec les RPC de 088 et les upserts sur clé composée. */
export function createClient(...args) {
  const c = base.createClient(...args);
  const rpc = c.rpc.bind(c), from = c.from.bind(c);
  c.rpc = async (fn, a = {}) => {
    if (!RPC[fn]) return rpc(fn, a);
    window.__LOG.push(['rpc', fn, a]);
    return RPC[fn](a);
  };
  c.from = (t) => {
    const q = from(t);
    if (t === 'hg_lexicon' && S.lexFail) { const sel = q.select.bind(q); q.select = (...x) => { sel(...x); q.f.push(() => false); q.run = () => ko('Failed to fetch'); return q; }; }
    if (KEYS[t]) {
      const up = q.upsert.bind(q);
      q.upsert = (p, o) => {
        const rows = Array.isArray(p) ? p : [p];
        DB[t] = (DB[t] || []).filter((r) => !rows.some((n) => KEYS[t].every((k) => n[k] === r[k])));
        return up(p, o);
      };
    }
    return q;
  };
  c.storage.from = ((orig) => (bucket) => {
    const b = orig(bucket);
    if (bucket !== 'hg-photos') return b;
    return { ...b, createSignedUrls: async (paths = []) => ({ data: paths.map((p) => ({ path: p, signedUrl: GIF, error: null })) }), createSignedUrl: async () => ({ data: { signedUrl: GIF } }) };
  })(c.storage.from.bind(c.storage));
  return c;
}
