// Faux client Supabase pour le thème « Social et profils » (migration 090 : profil gaming, groupes, mercis, sondages).
// Enveloppe tests/fixtures/fake-sb.mjs (chargé depuis le site de test) : les RPC sociales sont simulées ici,
// tout le reste part vers le faux client commun. Lit window.__SCN (scénario) ; état dans window.__SOC.
// Scénario : gaming (user_id → profil), thanks, polls, votes, groups (conversations de groupe), groupMembers, groupMessages,
// rsvps (via le faux commun), merciPlafond (raison 'plafond').
const base = await import(`${location.origin}${window.__HG_RACINE || ''}/tests/fixtures/fake-sb.mjs`);
const S = window.__SCN || {};
const ME = '11111111-1111-4111-8111-111111111111';
const now = () => new Date().toISOString();
let seq = 9000;
const id = () => `99999999-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const ok = (data) => ({ data, error: null });
const ko = (message) => ({ data: null, error: { message, code: 'P0001' } });

const PLATS = [
  { key: 'riot', label: 'Riot ID', color: '#CF7055' }, { key: 'steam', label: 'Steam', color: '#7E93C9' },
  { key: 'geoguessr', label: 'GeoGuessr', color: '#5FA88F' }, { key: 'switch', label: 'Code ami Switch', color: '#E0909A' },
];
const GAMES = [{ nom: 'LoL', plateforme: 'riot' }, { nom: 'GeoGuessr', plateforme: 'geoguessr' }, { nom: 'CK3', plateforme: 'steam' }, { nom: 'Codenames', plateforme: null }];
const SOC = window.__SOC = {
  gaming: { ...(S.gaming || {}) },
  thanks: (S.thanks || []).map((t) => ({ ...t })),
  polls: (S.polls || []).map((p) => ({ ...p })),
  votes: (S.votes || []).map((v) => ({ ...v })),
  convs: (S.groups || []).map((c) => ({ ...c })),
  members: (S.groupMembers || []).map((m) => ({ role: 'membre', joined_at: now(), muted_until: null, ...m })),
  msgs: (S.groupMessages || []).map((m) => ({ system: false, ...m })),
};

export function createClient() {
  const c = base.createClient();
  const DB = window.__DB;
  const uid = () => S.uid || ME;
  const prof = (u) => DB.hg_profiles.find((p) => p.id === u);
  const pseudo = (u) => prof(u)?.pseudo || 'Un membre';
  const isMember = (conv, u = uid()) => SOC.members.some((m) => m.conversation_id === conv && m.user_id === u);
  const sys = (conv, actor, body) => { SOC.msgs.push({ id: ++seq, conversation_id: conv, sender_id: actor, body, created_at: now(), system: true }); };
  const pollOut = (p) => {
    const me = uid(), n = p.options.length;
    const vs = SOC.votes.filter((v) => v.poll_id === p.id);
    const closed = !!p.closed_at || new Date(p.closes_at) <= new Date();
    return { ...p, closed, total: new Set(vs.map((v) => v.user_id)).size,
      counts: Array.from({ length: n }, (_, i) => vs.filter((v) => v.option_idx === i).length),
      voters: p.anonymous ? null : Array.from({ length: n }, (_, i) => vs.filter((v) => v.option_idx === i).map((v) => v.user_id)),
      mine: vs.filter((v) => v.user_id === me).map((v) => v.option_idx).sort(),
      can_close: p.created_by === me && !closed, can_remove: p.created_by === me && !vs.length };
  };
  const rpc = c.rpc;
  c.rpc = async (fn, a = {}) => {
    const me = uid();
    switch (fn) {
      case 'hg_social_settings': return ok({ gaming: { plateformes: PLATS, jeux: GAMES }, plafonds: { mercis_jour: 3, groupe_membres_max: 30, groupes_semaine: 5, sondages_jour: 3, sondages_accueil: 5 } });
      /* ----- P1 ----- */
      case 'hg_gaming_get': {
        window.__LOG.push(['rpc', fn, a]);
        const g = SOC.gaming[a.p_user];
        return ok(g && (!g.hidden || a.p_user === me) ? { user_id: a.p_user, ...g } : null);
      }
      case 'hg_gaming_save': {
        window.__LOG.push(['rpc', fn, a]);
        const keys = new Set(PLATS.map((p) => p.key));
        for (const k of Object.keys(a.p_accounts || {})) if (!keys.has(k)) return ko('Plateforme inconnue : ' + k);
        const accounts = Object.fromEntries(Object.entries(a.p_accounts).filter(([, v]) => String(v).trim()));
        SOC.gaming[me] = { accounts, now_playing: a.p_now_playing, favorites: a.p_favorites || [], hidden: !!a.p_hidden };
        return ok(SOC.gaming[me]);
      }
      case 'hg_gaming_list': {
        const plat = GAMES.find((g) => g.nom === a.p_game)?.plateforme;
        return ok(Object.entries(SOC.gaming).filter(([u, g]) => !g.hidden && prof(u) && (!a.p_game || (g.favorites || []).includes(a.p_game)))
          .map(([u, g]) => ({ user_id: u, pseudo: pseudo(u), avatar_url: null, color: prof(u).color, now_playing: g.now_playing, favorites: g.favorites || [], accounts: g.accounts || {}, game_account: plat ? g.accounts?.[plat] : null })));
      }
      /* ----- P4 ----- */
      case 'hg_thanks_for': {
        const mine = SOC.thanks.filter((t) => t.to_id === a.p_user && !t.removed);
        const today = SOC.thanks.filter((t) => t.from_id === me && Date.now() - new Date(t.created_at) < 864e5).length;
        const week = SOC.thanks.some((t) => t.from_id === me && t.to_id === a.p_user && Date.now() - new Date(t.created_at) < 6 * 864e5);
        const reason = a.p_user === me ? 'soi' : (S.merciPlafond || today >= 3) ? 'plafond' : week ? 'semaine' : null;
        const events = a.p_user === me ? [] : (S.merciEvents || []).filter((e) => !SOC.thanks.some((t) => t.from_id === me && t.to_id === a.p_user && t.event_id === e.id));
        return ok({ count: mine.filter((t) => !t.hidden).length, given: 0, today, cap: 3, reason, can_thank: !reason || reason === 'semaine', events,
          recent: mine.filter((t) => !t.hidden || a.p_user === me).slice(-5).reverse().map((t) => ({ ...t, from_pseudo: pseudo(t.from_id) })) });
      }
      case 'hg_thank': {
        window.__LOG.push(['rpc', fn, a]);
        if (a.p_to === me) return ko('Tu ne peux pas te remercier toi-même');
        if (a.p_body && a.p_body.length > 140) return ko('Message : 140 caractères au plus');
        const t = { id: id(), from_id: me, to_id: a.p_to, body: a.p_body, event_id: a.p_event, hidden: false, created_at: now() };
        SOC.thanks.push(t);
        DB.hg_activity.unshift({ id: ++seq, user_id: me, kind: 'merci', text: `${pseudo(me)} remercie ${pseudo(a.p_to)}${a.p_body ? ` : « ${a.p_body} »` : ''}`, ref: 'merci:' + t.id, created_at: now() });
        return ok(t.id);
      }
      case 'hg_thank_hide': {
        const t = SOC.thanks.find((x) => x.id === a.p_id && x.to_id === me);
        if (!t) return ko('Merci introuvable');
        t.hidden = a.p_hidden !== false; return ok(null);
      }
      /* ----- P5 ----- */
      case 'hg_polls_get': {
        const list = a.p_ids ? SOC.polls.filter((p) => a.p_ids.includes(p.id)) : SOC.polls.slice().sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
        return ok(list.map(pollOut));
      }
      case 'hg_poll_create': {
        window.__LOG.push(['rpc', fn, a]);
        const p = { id: id(), created_by: me, question: a.p_question, options: a.p_options, multi: !!a.p_multi, anonymous: !!a.p_anonymous,
          closes_at: new Date(Date.now() + a.p_hours * 36e5).toISOString(), closed_at: null, created_at: now() };
        SOC.polls.push(p);
        DB.hg_activity.unshift({ id: ++seq, user_id: me, kind: 'sondage', text: `${pseudo(me)} a lancé un sondage : « ${p.question} »`, ref: 'poll:' + p.id, created_at: now() });
        return ok(p.id);
      }
      case 'hg_poll_vote': {
        window.__LOG.push(['rpc', fn, a]);
        const p = SOC.polls.find((x) => x.id === a.p_poll);
        if (!p) return ko('Sondage introuvable');
        if (pollOut(p).closed) return ko('Ce sondage est clos');
        if (!p.multi && a.p_options.length > 1) return ko('Une seule réponse possible');
        SOC.votes = SOC.votes.filter((v) => !(v.poll_id === p.id && v.user_id === me));
        for (const o of a.p_options) SOC.votes.push({ poll_id: p.id, user_id: me, option_idx: o });
        return ok(null);
      }
      case 'hg_poll_close': { const p = SOC.polls.find((x) => x.id === a.p_poll); if (p) p.closed_at = now(); return ok(null); }
      case 'hg_poll_remove': {
        SOC.polls = SOC.polls.filter((x) => x.id !== a.p_poll);
        DB.hg_activity = DB.hg_activity.filter((r) => r.ref !== 'poll:' + a.p_poll);
        return ok(null);
      }
      /* ----- P3 ----- */
      case 'hg_my_conversations': {
        const res = await rpc(fn, a);
        const groups = SOC.convs.filter((g) => isMember(g.id)).map((g) => {
          const ms = SOC.msgs.filter((x) => x.conversation_id === g.id), last = ms[ms.length - 1];
          const mem = SOC.members.filter((m) => m.conversation_id === g.id);
          const mine = mem.find((m) => m.user_id === me);
          return { id: g.id, kind: 'group', title: g.title, other_id: null, last_message_at: g.last_message_at || last?.created_at || g.created_at,
            last_body: last?.body ?? null, last_mine: last ? last.sender_id === me : null, unread: 0, color: g.color || null,
            members_count: mem.length, member_ids: mem.filter((m) => m.user_id !== me).slice(0, 5).map((m) => m.user_id),
            muted_until: mine.muted_until, event_id: g.event_id || null, my_role: mine.role };
        });
        return ok([...groups, ...(res.data || [])].sort((x, y) => new Date(y.last_message_at) - new Date(x.last_message_at)));
      }
      case 'hg_get_messages': {
        if (!SOC.convs.some((g) => g.id === a.p_conv)) return rpc(fn, a);
        if (!isMember(a.p_conv)) return ok([]);
        return ok(SOC.msgs.filter((x) => x.conversation_id === a.p_conv && x.id > (a.p_after || 0)).map((x) => ({
          id: x.id, mine: x.sender_id === me, sender_label: x.sender_id === me ? 'Moi' : pseudo(x.sender_id), body: x.body,
          created_at: x.created_at, sender_id: x.sender_id, system: !!x.system })));
      }
      case 'hg_send_message': {
        if (!SOC.convs.some((g) => g.id === a.p_conv)) return rpc(fn, a);
        window.__LOG.push(['rpc', fn, a]);
        if (!isMember(a.p_conv)) return ko('Conversation introuvable');
        SOC.msgs.push({ id: ++seq, conversation_id: a.p_conv, sender_id: me, body: a.p_body, created_at: now(), system: false });
        return ok(seq);
      }
      case 'hg_group_create': {
        window.__LOG.push(['rpc', fn, a]);
        if (!a.p_title?.trim()) return ko('Nom du groupe : 1 à 60 caractères');
        const g = { id: id(), title: a.p_title.trim(), color: a.p_color, created_at: now(), created_by: me };
        SOC.convs.push(g);
        SOC.members.push({ conversation_id: g.id, user_id: me, role: 'resp', joined_at: now(), muted_until: null });
        for (const u of a.p_members) SOC.members.push({ conversation_id: g.id, user_id: u, role: 'membre', joined_at: now(), muted_until: null });
        sys(g.id, me, `${pseudo(me)} a créé le groupe « ${g.title} »`);
        return ok(g.id);
      }
      case 'hg_group_info': {
        const g = SOC.convs.find((x) => x.id === a.p_conv);
        if (!g || !isMember(g.id)) return ko('Groupe introuvable');
        const mem = SOC.members.filter((m) => m.conversation_id === g.id);
        return ok({ id: g.id, title: g.title, color: g.color, event_id: g.event_id || null, event_title: g.event_title || null, max: 30,
          my_role: mem.find((m) => m.user_id === me).role, muted_until: mem.find((m) => m.user_id === me).muted_until,
          members: mem.map((m) => ({ id: m.user_id, pseudo: pseudo(m.user_id), avatar_url: null, color: prof(m.user_id)?.color, role: m.role, joined_at: m.joined_at })) });
      }
      case 'hg_group_add': {
        window.__LOG.push(['rpc', fn, a]);
        for (const u of a.p_users) SOC.members.push({ conversation_id: a.p_conv, user_id: u, role: 'membre', joined_at: now(), muted_until: null });
        sys(a.p_conv, me, `${pseudo(me)} a ajouté ${a.p_users.map(pseudo).join(', ')}`);
        return ok(a.p_users.length);
      }
      case 'hg_group_remove': {
        window.__LOG.push(['rpc', fn, a]);
        SOC.members = SOC.members.filter((m) => !(m.conversation_id === a.p_conv && m.user_id === a.p_user));
        sys(a.p_conv, me, `${pseudo(me)} a retiré ${pseudo(a.p_user)}`);
        return ok(null);
      }
      case 'hg_group_rename': {
        window.__LOG.push(['rpc', fn, a]);
        const g = SOC.convs.find((x) => x.id === a.p_conv);
        g.title = a.p_title; g.color = a.p_color || g.color;
        sys(g.id, me, `${pseudo(me)} a renommé le groupe en « ${a.p_title} »`);
        return ok(null);
      }
      case 'hg_group_leave': {
        window.__LOG.push(['rpc', fn, a]);
        SOC.members = SOC.members.filter((m) => !(m.conversation_id === a.p_conv && m.user_id === me));
        sys(a.p_conv, me, `${pseudo(me)} a quitté le groupe`);
        return ok(null);
      }
      case 'hg_group_mute': {
        window.__LOG.push(['rpc', fn, a]);
        const m = SOC.members.find((x) => x.conversation_id === a.p_conv && x.user_id === me);
        m.muted_until = a.p_mode === 'off' ? null : a.p_mode === 'toujours' ? 'infinity' : new Date(Date.now() + (a.p_mode === '8h' ? 8 * 36e5 : 7 * 864e5)).toISOString();
        return ok(m.muted_until);
      }
      case 'hg_event_conv_open': {
        window.__LOG.push(['rpc', fn, a]);
        let g = SOC.convs.find((x) => x.event_id === a.p_event);
        if (!g) {
          const ev = DB.hg_events.find((e) => e.id === a.p_event);
          if (!ev) return ko('Sortie introuvable');
          g = { id: id(), title: ev.title, event_id: ev.id, event_title: ev.title, created_at: now(), created_by: ev.created_by };
          SOC.convs.push(g);
          SOC.members.push({ conversation_id: g.id, user_id: ev.created_by || me, role: 'resp', joined_at: now(), muted_until: null });
          for (const r of DB.hg_event_rsvps.filter((x) => x.event_id === ev.id && ['oui', 'peut-etre'].includes(x.status))) {
            if (!isMember(g.id, r.user_id)) SOC.members.push({ conversation_id: g.id, user_id: r.user_id, role: 'membre', joined_at: now(), muted_until: null });
          }
          if (!isMember(g.id)) SOC.members.push({ conversation_id: g.id, user_id: me, role: 'membre', joined_at: now(), muted_until: null });
          sys(g.id, me, `${pseudo(me)} a ouvert la discussion de la sortie · les réponses « oui » et « peut-être » y sont ajoutées`);
        }
        return ok(g.id);
      }
      default: return rpc(fn, a);
    }
  };
  return c;
}
