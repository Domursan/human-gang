// Complément du faux Supabase pour les idées « Social et profils » (P6, P7, P8, P9, migration 091).
// Chargé par fake-sb.mjs quand le scénario porte extra: 'fake-sb-social.mjs'. Ajoute les réglages (competences, social,
// parrainage, home_default), les tables hg_member_skills, hg_home_layout, hg_mentorships, et répond aux RPC du paquet.
// Scénario : S.amitie (réponse de hg_friendship), S.amitieHidden, S.mentor (duo de hg_mentor_progress), S.homeLayout,
// S.homeDefault, S.skills (lignes hg_member_skills de départ).
export default function social({ DB, S, uidNow, ME, U }) {
  const set = (key, value) => { const i = DB.hg_settings.findIndex((r) => r.key === key); if (i >= 0) DB.hg_settings[i] = { key, value }; else DB.hg_settings.push({ key, value }); };
  set('competences', [{ code: 'cuisine', label: 'Cuisine' }, { code: 'nature', label: 'Champignons et nature' }, { code: 'maths', label: 'Maths et sciences' }, { code: 'informatique', label: 'Informatique' }]);
  set('social', { amitie: S.amitieOff ? false : true });
  set('parrainage', { actif: true, paillettes: 50, duree_jours: 7, max_filleuls: 2, nouveau_jours: 30, carte_parrain: null, carte_filleul: null });
  set('home_default', S.homeDefault || { ordre: ['evenement', 'defi', 'secret_santa', 'irl', 'historique', 'fil', 'anniversaires', 'idees'], obligatoires: ['evenement'] });
  DB.hg_member_skills = S.skills || [
    { user_id: U(2), skill_code: 'nature', note: 'cèpes et girolles' }, { user_id: U(2), skill_code: 'cuisine', note: null },
    { user_id: U(3), skill_code: 'nature', note: 'balades en forêt' }, { user_id: ME, skill_code: 'informatique', note: 'le site' },
  ];
  // Disposition : celle du scénario, sinon la copie locale tient lieu de base persistante (la page se recharge après « Terminé »)
  DB.hg_home_layout = S.homeLayout ? [{ user_id: uidNow(), blocks: S.homeLayout }] : [];
  if (!S.homeLayout) { try { const v = JSON.parse(localStorage.getItem('hg_home_layout') || 'null'); if (v?.uid) DB.hg_home_layout = [{ user_id: v.uid, blocks: v.blocks }]; } catch { /* rien */ } }
  DB.hg_mentorships = [];
  const now = Date.now(), iso = (d) => new Date(now + d * 864e5).toISOString();
  const pseudo = (id) => DB.hg_profiles.find((p) => p.id === id)?.pseudo;
  let mentorClaimed = false;
  return {
    async rpc(fn, args) {
      if (fn === 'hg_friendship') {
        if (S.amitieOff) return { data: { active: false }, error: null };
        if (S.amitieHidden) return { data: { active: true, hidden: true }, error: null };
        return { data: S.amitie || { active: true, hidden: false, pseudo: pseudo(args.p_other), sorties: 7, premiere_sortie: { title: 'Nouvel an 2023 chez Litver', date: '2023-01-01' },
          echanges: 3, dons: 1, dernier_echange: { de_moi: true, carte_donnee: 'Domu-mobile', carte_recue: 'Le Tzatzikistan' },
          secret_santa: [{ year: 2023, sens: 'donne' }], mercis: null, ensemble_depuis: 2022 }, error: null };
      }
      if (fn === 'hg_friendship_top') return { data: [{ user_id: U(2), pseudo: 'Alice', avatar_url: null, color: '#6FA37F', sorties: 7 }, { user_id: U(3), pseudo: 'Bruno', avatar_url: null, color: '#CF7055', sorties: 2 }], error: null };
      if (fn === 'hg_skills_list') {
        const code = args?.p_code || null;
        return { data: DB.hg_member_skills.filter((r) => !code || r.skill_code === code).map((r) => {
          const p = DB.hg_profiles.find((x) => x.id === r.user_id);
          return { user_id: r.user_id, pseudo: p?.pseudo, avatar_url: null, color: p?.color, skill_code: r.skill_code, note: r.note };
        }), error: null };
      }
      if (fn === 'hg_mentor_progress') {
        if (!S.mentor) return { data: { actif: true, paillettes: 50, duos: [] }, error: null };
        const d = { mentee_id: uidNow(), mentor_id: U(2), role: 'filleul', mentee: pseudo(uidNow()), mentor: 'Alice', started_at: iso(-3), ends_at: iso(4), carte: true,
          steps: [{ code: 'profil', done: true }, { code: 'message', done: true }, { code: 'echange', done: !!S.mentorAll }, { code: 'sortie', done: !!S.mentorAll }],
          claimed: mentorClaimed, expired: false, ...(typeof S.mentor === 'object' ? S.mentor : {}) };
        return { data: { actif: true, paillettes: 50, duos: [d] }, error: null };
      }
      if (fn === 'hg_open_direct') { // conversation directe du scénario (S.conversations / S.convMembers), créée au besoin
        const me = uidNow(), mem = (S.convMembers = S.convMembers || []);
        let c = (DB.hg_conversations || []).find((x) => x.kind === 'direct' && mem.some((m) => m.conversation_id === x.id && m.user_id === me) && mem.some((m) => m.conversation_id === x.id && m.user_id === args.p_user));
        if (!c) {
          c = { id: 'c0000000-0000-4000-8000-0000000000ff', kind: 'direct', last_message_at: new Date().toISOString() };
          DB.hg_conversations.push(c); mem.push({ conversation_id: c.id, user_id: me }, { conversation_id: c.id, user_id: args.p_user });
        }
        return { data: c.id, error: null };
      }
      if (fn === 'hg_mentor_claim') { mentorClaimed = true; return { data: { ok: true, role: 'filleul', paillettes: 50, carte: true }, error: null }; }
      if (fn === 'hg_mentor_assign' || fn === 'hg_mentor_cancel' || fn === 'hg_invite_link_set_mentor') return { data: true, error: null };
      if (fn === 'hg_card_quests_me') return { data: { week: '2026-10-19', quests: [
        { code: 'q1', label: 'Ouvrir 3 boosters', target: 3, progress: 3, done: true }, { code: 'q2', label: 'Faire un échange', target: 1, progress: 0, done: false },
        { code: 'q3', label: 'Répondre à une sortie', target: 1, progress: 1, done: true }] }, error: null };
      if (fn === 'hg_cards_me') return { data: { paillettes: 1250, daily_available: true, daily_streak: 3, free_booster_at: null }, error: null };
      if (fn === 'hg_cards_daily') return { data: { gain: 30, streak: 4 }, error: null };
      return undefined;
    },
  };
}
