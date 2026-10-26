// Faux Supabase du Pictionary (moteur des plateaux, migration 145) : enveloppe le faux de base (fake-sb.mjs) et répond
// aux RPC hg_plat_* d'une partie : état (hg_plat_etat), choisir, dessin, deviner, quitter. Les règles ne sont PAS rejouées
// ici (le serveur est testé côté SQL) : l'action fait passer l'état à l'étape suivante, avec la même forme de réponse.
// Le canal temps réel « pict:<id> » est simulé : les envois sont journalisés (window.__LOG, ['canal', nom, message]) et
// window.__CANAUX.emettre(événement, charge) fait arriver un message aux écouteurs du canal (comme un autre joueur).
// Scénario (window.__SCN) :
//   dessinateur : 'moi' (le membre connecté dessine, défaut) ou 'alice' (un autre joueur dessine) ;
//   phase : 'choix' (défaut si je dessine) ou 'dessin' (défaut si Alice dessine) ;
//   mot : mot à deviner (défaut « montagne ») ; precedent : true pour un tour précédent à montrer ;
//   fin : true pour une partie terminée (classement aux points).
// Expose window.__PICT : { jeu() } (l'état du jeu, pour les tests).
// Exporte createClient().
const S = window.__SCN || {};
const prefix = location.pathname.replace(/\/[^/]*$/, '');
const base = await import(`${location.origin}${prefix}/tests/fixtures/fake-sb.mjs`);

const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const ALICE = U(2), BRUNO = U(3), CHLOE = U(4);
const CODE = 'HGPIC-1234';
const ID = 'partie-pict';
const ok = (data) => ({ data, error: null });
const erreur = (message) => ({ data: null, error: { message } });
const iso = (s = 0) => new Date(Date.now() + s * 1000).toISOString();

const MOT = S.mot || 'montagne';
const DESSINATEUR = S.dessinateur === 'alice' ? ALICE : ME;
const PHASE = S.phase || (DESSINATEUR === ME ? 'choix' : 'dessin');
const CHOIX = ['raclette', 'montagne', 'chat'];

/** Joueur de la partie (forme de hg_plat_etat). */
function joueur(id, pseudo, couleur, place, points) {
  return { user_id: id, pseudo, couleur, avatar_url: null, invite: false, place, pret: true, parti: false, absent: false,
    elimine: false, etat: { points }, gagne: null, rang: null, paillettes: 0 };
}

/** État de la partie (partie, joueurs, jeu, journal) : une seule copie pour tous les appels. */
const ETAT = {
  partie: { id: ID, jeu: 'pictionary', nom_jeu: 'Pictionary', code: CODE, nom: 'Soirée dessin', statut: S.fin ? 'terminee' : 'en_cours',
    hote: ME, visibilite: 'privee', invites: true, nb_places: 10, t_tour: 20, options: { manches: 2, duree: 80 },
    tour: DESSINATEUR, tour_fin: iso(PHASE === 'choix' ? 20 : 60), nb_tours: 1, suite: null, raison: null, version: 1,
    started_at: iso(-300), ended_at: S.fin ? iso() : null },
  joueurs: [joueur(ME, 'Ethan', '#4F6A8F', 1, 14), joueur(ALICE, 'Alice', '#D97757', 2, 22),
    joueur(BRUNO, 'Bruno', '#7E93C9', 3, 4), joueur(CHLOE, 'Chloé', '#6FA37F', 4, 0)],
  journal: [
    { id: 5, user_id: BRUNO, type: 'propose', texte: 'Bruno : chien', prive: false, created_at: iso(-8) },
    { id: 4, user_id: ALICE, type: 'trouve', texte: 'Alice a trouvé ! (+12)', prive: false, created_at: iso(-20) },
    { id: 3, user_id: null, type: 'info', texte: 'Manche 1 : Alice dessine (8 lettres).', prive: false, created_at: iso(-30) },
    { id: 2, user_id: null, type: 'info', texte: 'Le mot était : « lune ».', prive: false, created_at: iso(-200) },
    { id: 1, user_id: null, type: 'info', texte: 'À vos crayons ! Chacun dessine à son tour, les autres devinent.', prive: false, created_at: iso(-600) },
  ],
};
/** Jeu (forme de hg_plat__pictionary_vue, les champs réservés sont filtrés par qui regarde). */
const J = {
  phase: PHASE, dessinateur: DESSINATEUR, manche: 1, manches: 2, duree: 80, tour_n: 1,
  choix: CHOIX, mot: PHASE === 'choix' && DESSINATEUR === ME ? null : MOT, trouves: [], traits: [],
  precedent: S.precedent ? { mot: 'chat', dessinateur: BRUNO, trouves: [ALICE], traits: [{ s: 'p1', c: '#B70127', e: 0.02, p: [[0.1, 0.1], [0.9, 0.2], [0.5, 0.8]] }] } : null,
  canal: `pict:${ID}`,
};
if (PHASE === 'choix') J.indice = null;
let seq = 100;

/** Indice : une case par lettre, les espaces du mot restent des espaces (comme le serveur). */
function indiceDe(mot) {
  return [...mot].map((c) => (c === ' ' ? ' ' : '_')).join(' ');
}
if (PHASE === 'dessin') J.indice = indiceDe(MOT);

/** Vrai si a ne diffère de b que d'une lettre (même règle que le serveur, « presque »). */
function presque(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1 || a.length < 3) return false;
  let i = 0;
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  if (a.length > b.length) return a.slice(i + 1) === b.slice(i);
  return a.slice(i) === b.slice(i + 1);
}
const norme = (t) => String(t).trim().toLowerCase();
const ajouterJournal = (type, texte, user_id = null, prive = false) => { ETAT.journal.unshift({ id: ++seq, user_id, type, texte, prive, created_at: iso() }); };

/** Forme renvoyée par hg_plat_etat pour le membre connecté. */
function etatRenvoye() {
  const moiDessine = J.dessinateur === ME;
  const jeu = {
    ...J,
    choix: J.phase === 'choix' && moiDessine ? J.choix : undefined,
    mot: moiDessine || J.trouves.includes(ME) ? J.mot : undefined,
    indice: J.phase === 'dessin' ? J.indice : undefined,
    precedent: J.precedent,
  };
  return { partie: { ...ETAT.partie }, maintenant: iso(), moi: { user_id: ME, joue: true, hote: true, invite: false },
    joueurs: ETAT.joueurs, jeu: S.fin ? null : jeu, journal: ETAT.journal, badges: [] };
}

/* ---------- Actions ---------- */

const ACTIONS = {
  /** choisir { mot } : le dessinateur prend un des trois mots ; le dessin commence. */
  choisir(args) {
    if (J.phase !== 'choix' || J.dessinateur !== ME) return erreur('Ce n\'est pas à toi de choisir.');
    if (!J.choix.includes(args.mot)) return erreur('Choisis un des trois mots proposés.');
    J.mot = args.mot; J.phase = 'dessin'; J.indice = indiceDe(args.mot);
    ETAT.partie.tour_fin = iso(80);
    ajouterJournal('info', `Ethan dessine (${[...args.mot].length} lettres).`, ME);
    return ok({});
  },
  /** dessin { traits } : enregistre le dessin complet du tour (pour ceux qui arrivent en cours de route). */
  dessin(args) {
    if (J.phase !== 'dessin' || J.dessinateur !== ME) return erreur('Ce n\'est pas toi qui dessines.');
    J.traits = Array.isArray(args.traits) ? args.traits : [];
    return ok({});
  },
  /** deviner { texte } : bonne réponse = points ; presque = ligne privée ; sinon proposition publique. */
  deviner(args) {
    if (J.phase !== 'dessin') return erreur('Attends que le dessin commence.');
    if (J.dessinateur === ME) return erreur('Tu dessines : pas de proposition !');
    if (J.trouves.includes(ME)) return erreur('Tu as déjà trouvé.');
    const t = String(args.texte || '').trim();
    if (!t || t.length > 60) return erreur('Proposition vide ou trop longue.');
    if (norme(t) === norme(J.mot)) {
      J.trouves.push(ME);
      ETAT.joueurs.find((j) => j.user_id === ME).etat.points += 12;
      ajouterJournal('trouve', 'Ethan a trouvé ! (+12)', ME);
      return ok({ ok: true, points: 12 });
    }
    if (presque(norme(t), norme(J.mot))) {
      ajouterJournal('info', `« ${t} » : presque !`, ME, true);
      return ok({ ok: false });
    }
    ajouterJournal('propose', `Ethan : ${t}`, ME);
    return ok({ ok: false });
  },
};

const HANDLERS = {
  hg_plat_etat: () => ok(etatRenvoye()),
  hg_plat_agir: (a) => {
    const f = ACTIONS[a.p_action];
    if (!f) return erreur('Action inconnue.');
    ETAT.partie.version += 1;
    const r = f(a.p_args || {});
    ETAT.partie.version += 1;
    return r;
  },
  hg_plat_creer: () => ok(CODE),
  hg_plat_rejoindre: () => ok(CODE),
  hg_plat_rejouer: () => ok(CODE),
  hg_plat_quitter: () => ok(null),
  hg_plat_avancer: () => ok(null),
  hg_plat_pret: () => ok(null),
  hg_plat_message: () => ok(null),
  hg_plat_messages: () => ok([]),
  hg_plat_contenus: () => ok({}),
  hg_plat_mes_parties: () => ok([]),
  hg_plat_publiques: () => ok([]),
};

/* ---------- Canal temps réel simulé ---------- */

/** Canaux « pict: » ouverts (les autres canaux restent ceux du faux de base). */
const canaux = new Set();
window.__CANAUX = {
  /** Fait arriver un message (événement, charge) à tous les écouteurs de cet événement, comme un autre joueur. */
  emettre(evenement, charge) {
    for (const c of canaux) for (const h of c.handlers) if (h.event === evenement) h.cb({ type: 'broadcast', event: evenement, payload: charge });
  },
  nombre: () => canaux.size,
};
window.__PICT = { jeu: () => J };

/** Client : celui du faux de base, avec les RPC du Pictionary et un canal « pict: » simulé (journalisé). */
export function createClient(...args) {
  const c = base.createClient(...args);
  const rpc0 = c.rpc.bind(c);
  c.rpc = async (fn, a = {}) => {
    if (HANDLERS[fn]) { window.__LOG.push(['rpc', fn, a]); return HANDLERS[fn](a); }
    return rpc0(fn, a);
  };
  const channel0 = c.channel.bind(c);
  const removeChannel0 = c.removeChannel.bind(c);
  c.channel = (nom, opts) => {
    if (!String(nom).startsWith('pict:')) return channel0(nom, opts);
    const mien = {
      nom, handlers: [], cb: null,
      on(type, filtre, cb) { if (type === 'broadcast') this.handlers.push({ event: filtre?.event, cb }); return this; },
      subscribe(cb) { this.cb = cb; canaux.add(this); setTimeout(() => cb?.('SUBSCRIBED'), 0); return this; },
      send(message) { window.__LOG.push(['canal', nom, message]); return Promise.resolve('ok'); },
    };
    return mien;
  };
  c.removeChannel = (ch) => { canaux.delete(ch); return ch?.handlers ? undefined : removeChannel0(ch); };
  return c;
}
