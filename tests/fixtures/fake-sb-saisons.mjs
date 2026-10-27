// Faux Supabase des rendez-vous saisonniers (migration 096) : enveloppe fake-sb.mjs et simule, avec état, les RPC
// du calendrier de l'Avent (T1), de la soirée déballage (T2), de la saison des Worlds (T3) et de l'anniversaire (T4).
// Les autres appels passent au faux client commun. Scénario (window.__SCN) :
//   avent: true, today: N (case débloquée), opened: [jours déjà ouverts], groupCount: { jour: n }
//   worlds: true, worldsNext: objet du prochain match (ou null)
//   anniv: { fenetre: true, today: true, claimed: false, age: 5 }
//   unwrap: true (édition E26 à l'étape « envoi »), pilot: true (le membre connecté est Staff « secret_santa »),
//   unwrapSeed: true (soirée préparée, ordre déjà tiré)
// Journal : chaque appel simulé est noté dans window.__LOG (['rpc', nom, arguments]).
const S = window.__SCN || {};
const { createClient: baseClient } = await import(`${location.origin}${S.prefix || ''}/tests/fixtures/fake-sb.mjs`);
const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const ok = (data) => ({ data, error: null });
const ko = (message) => ({ data: null, error: { message } });

/* ---------- T1 : calendrier ---------- */
const KIND = (d) => (d === 13 ? 'carte' : d === 3 ? 'souvenir' : d === 5 ? 'question' : d === 24 ? 'booster' : 'paillettes');
const GROUP = [6, 13, 20, 24];
const AV = { opened: new Set(S.opened || []), claimed: new Set(), answered: false, count: { ...(S.groupCount || {}) } };
function content(d) {
  const k = KIND(d);
  const base = { kind: k, reward: k === 'paillettes' ? 10 + d : 0, paid: k === 'paillettes' ? 10 + d : 0, label: null };
  if (k === 'carte') return { ...base, card: { id: 'k13', name: 'La Domu-mobile', rarity: 'rare', family: 'objet', image_url: null, number: 7, set_name: 'Hors série' }, shiny: false, serial: null };
  if (k === 'souvenir') return { ...base, moment: { id: 'm3', title: 'La soirée déballage', body: 'Le colis de Wae est arrivé ouvert.', happened_on: '2024-12-07', image_path: 'x/m3.webp' } };
  if (k === 'question') return { ...base, question: { id: 'q5', prompt: 'D’où vient le Tzatzikistan ?', qtype: 'choix_unique', options: [{ id: 'a', text: 'D’un Worldle' }, { id: 'b', text: 'D’un rêve de Wae' }], reward: 30, answered: AV.answered, correct: AV.answered ? true : null } };
  if (k === 'booster') return { ...base, booster: { id: 'collectionneur', name: 'Collectionneur', size: 5 } };
  return base;
}
function adventMe() {
  if (!S.avent) return { active: false };
  const t = S.today || 13;
  const days = Array.from({ length: 24 }, (_, i) => {
    const d = i + 1, op = AV.opened.has(d), g = GROUP.includes(d);
    return { day: d, state: op ? 'ouverte' : d > t ? 'verrouillee' : d === t ? 'a_ouvrir' : 'a_rattraper', ready: true, group: g,
      group_target: g ? 10 : null, group_count: g && d <= t ? (AV.count[d] || 0) + (op ? 1 : 0) : null, group_reward: g ? 25 : null,
      group_claimed: AV.claimed.has(d), content: op ? content(d) : null };
  });
  return { active: true, year: 2026, today: t, opened: AV.opened.size, complete: AV.opened.size >= 24, catch_up_until: '2026-12-31', days };
}

/* ---------- T2 : soirée déballage ---------- */
const PEOPLE = [ME, U(2), U(3), U(4)];
const UW = { event: null, order: [], status: 'envoi', votes: {} };
// Scénario « unwrapSeed » : soirée déjà préparée et ordre déjà tiré (ME en cours, U(3) fait, U(2) en attente).
if (S.unwrapSeed) {
  UW.event = { id: 'EV26', title: 'Soirée déballage 2026', starts_at: '2026-12-05T19:00:00Z', dates: [] };
  UW.order = [{ user_id: U(3), position: 1, status: 'fait', started_at: null, done_at: null },
    { user_id: ME, position: 2, status: 'en_cours', started_at: new Date().toISOString(), done_at: null },
    { user_id: U(2), position: 3, status: 'attente', started_at: null, done_at: null }];
}
function unwrapState() {
  return { edition: 'E26', year: 2026, status: UW.status, can_pilot: !!S.pilot, turn_seconds: 300, started_at: UW.order.length ? new Date().toISOString() : null,
    event: UW.event && { ...UW.event, photos: 0, dates: UW.event.dates.map((d) => ({ ...d, votes: UW.votes[d.id] ? 1 : 0, mine: !!UW.votes[d.id] })) },
    received: PEOPLE.map((id, i) => ({ user_id: id, received: i !== 2 })), all_received: false,
    order: UW.order.map((o) => ({ ...o })) };
}
const emitUnwrap = () => setTimeout(() => window.__fakeRealtime?.emit('hg_ss_unwrap', { eventType: 'UPDATE', new: {} }), 0);

/* ---------- T4 : anniversaire ---------- */
const AN = { claimed: !!S.anniv?.claimed };

/** Réponses simulées, par nom de fonction. */
const H = {
  hg_advent_me: () => ok(adventMe()),
  hg_advent_open: ({ p_day }) => {
    const t = S.today || 13;
    if (p_day > t) return ko(`Patience : cette case s'ouvre le ${p_day} décembre à 6 h`);
    if (AV.opened.has(p_day)) return ok({ day: p_day, already: true, content: content(p_day) });
    AV.opened.add(p_day);
    return ok({ day: p_day, already: false, paid: content(p_day).paid, badge: AV.opened.size >= 24, content: content(p_day) });
  },
  hg_advent_answer: () => { if (AV.answered) return ko('Tu as déjà répondu à cette question'); AV.answered = true; return ok({ correct: true, reward: 30 }); },
  hg_advent_claim_group: ({ p_day }) => {
    const c = (AV.count[p_day] || 0) + 1;
    if (c < 10) return ko(`Encore ${10 - c} membre(s) avant le bonus du gang`);
    if (AV.claimed.has(p_day)) return ok({ already: true, paid: 0 });
    AV.claimed.add(p_day); return ok({ already: false, paid: 25 });
  },
  hg_saison_state: () => ok({ worlds: S.worlds ? {
    fin: new Date(Date.now() + 10 * 864e5).toISOString(),
    booster: { id: 'worlds_2026', name: 'Saison esport', price: 150, size: 5, description: '', active: true },
    next: S.worldsNext === null ? null : { id: 'i1', label: 'Quart de finale · BO5', comp: 'Worlds 2026', locks_at: new Date(Date.now() + 5 * 36e5).toISOString(),
      options: [{ id: 't1', label: 'T1' }, { id: 'blg', label: 'BLG' }], bets: 11, mine: 't1' },
    quests: [{ code: 'q_saison_worlds_booster', label: 'Ouvre un booster de la saison esport', target: 1, reward: 40, progress: 1, claimed: false },
      { code: 'q_saison_worlds_pronos', label: 'Pronostique 3 matchs', target: 3, reward: 60, progress: 2, claimed: false },
      { code: 'q_saison_worlds_reaction', label: 'Réagis à un moment culte esport', target: 1, reward: 30, progress: 0, claimed: false }],
    fidele: { count: 6, target: 10, has: false }, pickem: false } : null }),
  hg_eggs_public: () => ok({ recompenses: {}, anniversaire_aujourdhui: !!S.anniv?.today, anniversaire_age: S.anniv ? S.anniv.age || 5 : 4,
    anniversaire_fenetre: !!S.anniv?.fenetre }),
  hg_anniv_me: () => ok({ age: S.anniv?.age || 5, date: '2027-01-08', fin: '2027-01-09', dans_fenetre: !!S.anniv?.fenetre, aujourdhui: !!S.anniv?.today,
    annee: 2022, claimed: AN.claimed, card: { id: 'ka', name: '8 janvier 2027 · 5 ans', rarity: 'legendaire', family: 'moment', image_url: null, number: 5, set_name: 'Anniversaires du gang' },
    booster: { id: 'anniversaire', name: 'Anniversaire', size: 5 } }),
  hg_anniv_claim: () => { if (!S.anniv?.fenetre) return ko('Le cadeau d’anniversaire s’ouvre autour du jour J'); const already = AN.claimed; AN.claimed = true; return ok({ already, booster: 'anniversaire', card: true }); },
  hg_gang_retro: () => ok({ age: 5, annee: 2022,
    years: [2022, 2023, 2024, 2025, 2026].map((y, i) => ({ year: y, sorties: 5 + i, photos: 100 * (i + 1), souvenirs: 10, secret_santa: 8, cartes: 0,
      moments: [{ id: `m${y}`, title: ['Le Tzatzikistan sort d’un Worldle', 'Premier nouvel an ensemble', 'Les Codenames passent la centaine', 'Campagne CK3 « Serge »', 'RDV de Lyon et ses gobelets'][i], happened_on: `${y}-06-01` }] })),
    totals: { sorties: 64, photos: 1912, souvenirs: 218, secret_santa: 5, cartes: 3000, membres: 14 }, photo_famille: null }),
  hg_ss_unwrap_state: ({ p_edition }) => (p_edition === 'E26' ? ok(unwrapState()) : ko('Édition introuvable')),
  hg_ss_unwrap_setup: ({ p_title, p_dates }) => {
    if (!S.pilot) return ko('Réservé au Staff « Secret Santa »');
    UW.event = { id: 'EV26', title: p_title || 'Soirée déballage 2026', starts_at: null, dates: (p_dates || []).map((at, i) => ({ id: `D${i + 1}`, at })) };
    return ok('EV26');
  },
  hg_ss_unwrap_fix_date: ({ p_date }) => { const d = UW.event.dates.find((x) => x.id === p_date); UW.event.starts_at = d.at; return ok(d.at); },
  hg_ss_unwrap_draw: () => {
    if (!S.pilot) return ko('Réservé au Staff « Secret Santa »');
    UW.order = [U(3), ME, U(2), U(4)].map((id, i) => ({ user_id: id, position: i + 1, status: i === 0 ? 'en_cours' : 'attente', started_at: i === 0 ? new Date().toISOString() : null, done_at: null }));
    emitUnwrap(); return ok(4);
  },
  hg_ss_unwrap_next: ({ p_action }) => {
    const cur = UW.order.find((o) => o.status === 'en_cours');
    if (cur) {
      if (p_action === 'suivant') cur.status = 'fait';
      else if (p_action === 'passer') { cur.status = 'passe'; cur.position = Math.max(...UW.order.map((o) => o.position)) + 1; }
      else if (p_action === 'en_route') cur.status = 'en_route';
    }
    UW.order.sort((a, b) => a.position - b.position);
    const nxt = UW.order.find((o) => ['attente', 'passe'].includes(o.status));
    if (nxt) { nxt.status = 'en_cours'; nxt.started_at = new Date().toISOString(); }
    emitUnwrap(); return ok({ current: nxt?.user_id || null });
  },
  hg_ss_unwrap_reveal: () => { UW.status = 'revelation'; return ok('revelation'); },
  /* ---------- Administration : Fête foraine › Avent, Worlds, Anniversaire. Les réglages viennent de hg_settings.saisons
     (lu dans window.__DB) ; les RPC d'écriture sont journalisées, et la fusion côté client est vérifiée sur la base simulée. ---------- */
  hg_advent_admin: ({ p_year }) => ok({ year: p_year, clock: null, gang: 14, days: [],
    cfg: { actif: true, seuil: 10, seuil_pct: 70, carte_repli: 20, plafond: 600, ...(sais().avent || {}) } }),
  hg_saison_admin: () => { const w = sais().worlds || {}; return ok({ worlds: { actif: !!w.actif, debut: null, fin: null, en_cours: false, booster: null,
      pronos: w.pronos || '/pages/jeux/jeux.html#pronos', quetes: w.quetes || [], mots: w.mots || [] }, theme: null, pronos_ready: false, quests: [],
    booster_types: window.__DB.hg_booster_types.map((t) => ({ id: t.id, name: t.name, active: t.active !== false })) }); },
  hg_saison_set: () => ok({ badges: 0 }),
  hg_anniv_admin: () => { const c = sais().anniversaire || {};
    return ok({ info: { date: '2027-01-08', age: 5, annee: c.annee ?? 2022, debut: '2027-01-07', fin: '2027-01-09', dans_fenetre: false, booster: c.booster || 'anniversaire' },
      cfg: c, cards: [], claims: 0, moments: [] }); },
};
/** Réglages saisonniers courants (hg_settings.saisons) lus dans la base simulée. */
function sais() { return window.__DB.hg_settings.find((r) => r.key === 'saisons')?.value || {}; }
window.__UW = UW;

export function createClient(...a) {
  const c = baseClient(...a);
  const rpc0 = c.rpc;
  c.rpc = async (fn, args) => {
    if (H[fn]) { window.__LOG.push(['rpc', fn, args]); return H[fn](args || {}); }
    return rpc0(fn, args);
  };
  // Votes de dates de la soirée : la table est simulée ici (hg_event_date_votes).
  const from0 = c.from;
  c.from = (t) => {
    if (t !== 'hg_event_date_votes') return from0(t);
    const q = { _op: null, _id: null,
      insert(p) { this._op = 'ins'; this._id = p.date_id; return this; }, delete() { this._op = 'del'; return this; },
      eq(col, v) { if (col === 'date_id') this._id = v; return this; },
      then(res) { window.__LOG.push(['from', t, this._op, this._id]); if (this._op === 'ins') UW.votes[this._id] = true; else delete UW.votes[this._id]; res({ data: null, error: null }); } };
    return q;
  };
  return c;
}
