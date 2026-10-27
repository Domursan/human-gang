// Faux serveur de la présence et des notifications du site (migration 153) pour les tests Playwright.
// Script injecté avant la page par openPage({ init: 'fake-presence.js' }) ; il répond par window.__FAKE_RPC.
// Le membre 00000002-… est en ligne, les autres hors ligne. Deux notifications, dont une non lue.
// hg_membres_en_ligne : Alice et Bob (aucun si window.__PRES.personne). Expose window.__PRES (appels reçus) pour les vérifications.
(() => {
  const now = Date.now();
  const P = window.__PRES = { pings: 0, lues: [], masque: false };
  const LISTE = [
    { id: 2, cat: 'messages', titre: 'Nouveau message de Alice', texte: 'On se voit samedi ?', lien: '/pages/compte/messages.html', created_at: new Date(now - 5 * 60000).toISOString(), lu: false },
    { id: 1, cat: 'jeux', titre: 'Bob te défie au Morpion', texte: null, lien: null, created_at: new Date(now - 3 * 3600000).toISOString(), lu: true },
  ];
  const ok = (data) => ({ data, error: null });
  const precedent = window.__FAKE_RPC;
  window.__FAKE_RPC = async (fn, args) => {
    if (fn === 'hg_presence_ping') { P.pings++; return ok(LISTE.filter((n) => !n.lu).length); }
    if (fn === 'hg_mes_notifs') return ok({ non_lues: LISTE.filter((n) => !n.lu).length, masque: P.masque, liste: LISTE.map((n) => ({ ...n })) });
    if (fn === 'hg_notifs_lues') { const ids = args?.p_ids; P.lues.push(ids); for (const n of LISTE) if (!ids || ids.includes(n.id)) n.lu = true; return ok(1); }
    if (fn === 'hg_presence_masquer') { P.masque = !!args?.p_masque; return ok(P.masque); }
    if (fn === 'hg_en_ligne') return ok((args?.p_ids || []).map((id) => ({ user_id: id, en_ligne: id.startsWith('00000002'), vu_at: new Date(now - (id.startsWith('00000002') ? 30000 : 7200000)).toISOString() })));
    if (fn === 'hg_membres_en_ligne') return ok(P.personne ? [] : [
      { user_id: '00000002-0000-4000-8000-000000000002', pseudo: 'Alice', color: '#33aa66', avatar_url: null, vu_at: new Date(now - 30000).toISOString() },
      { user_id: '00000003-0000-4000-8000-000000000003', pseudo: 'Bob', color: '#3366cc', avatar_url: null, vu_at: new Date(now - 60000).toISOString() },
    ]);
    return typeof precedent === 'function' ? precedent(fn, args) : undefined;
  };
})();
