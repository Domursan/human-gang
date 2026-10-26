// ===== Humane Gang — Jeux de plateau : accès aux données (fonctions serveur hg_plat_*, temps réel) =====
/*
 * Rôle : seul point de contact avec Supabase pour les 5 jeux de plateau (Cluedo, Shadow Hunters, Destins, Monopoly, Risk).
 * Toute la logique est côté serveur (migrations 125 à 130) : on envoie des intentions (plat.agir) et on relit l'état.
 * Le jeu de la page est fixé une fois au démarrage (choisirJeu), d'après <body data-jeu="…">.
 * Mode invité : un visiteur sans compte joue avec un jeton secret gardé dans son navigateur ;
 *   tous ses appels passent par hg_plat_invite (pas de temps réel : relecture toutes les 2 s).
 * Contenus (noms des suspects, rues, territoires…) : modifiables dans le panel admin, chargés une fois (contenus()).
 * Dépendances : core.js (sb, errMsg).
 * Exporte : JEUX, choisirJeu, jeu, plat, contenus, nomDe, suivrePartie, messages, erreurTexte, activerInvite, estInvite, imageExiste.
 */
import { sb, errMsg } from '../core.js';

/** Description fixe des jeux (le nom affiché vient des contenus, modifiable en admin). */
export const JEUX = {
  cluedo: { id: 'cluedo', page: 'cluedo.html', slug: 'cluedo', nom: 'Cluedo', min: 3, max: 6, prefixe: 'HGCLU',
    accroche: 'Une victime, six suspects, six armes, neuf pièces. Mène l\'enquête.' },
  shadow: { id: 'shadow', page: 'shadow-hunters.html', slug: 'shadow-hunters', nom: 'Shadow Hunters', min: 4, max: 8, prefixe: 'HGSHH',
    accroche: 'Hunters, Shadows et Neutres : personne ne sait qui est qui.' },
  destins: { id: 'destins', page: 'destins.html', slug: 'destins', nom: 'Destins', min: 2, max: 6, prefixe: 'HGDES',
    accroche: 'Études, métier, mariage, maison : fais tourner la roue de la vie.' },
  monopoly: { id: 'monopoly', page: 'monopoly.html', slug: 'monopoly', nom: 'Monopoly', min: 2, max: 6, prefixe: 'HGMON',
    accroche: 'Achète, construis, échange… et ruine tes amis en une heure.' },
  risk: { id: 'risk', page: 'risk.html', slug: 'risk', nom: 'Risk', min: 2, max: 6, prefixe: 'HGRSK',
    accroche: '42 territoires, 6 continents, une mission secrète.' },
};

let JEU = null;
/** Fixe le jeu de la page ('cluedo', 'shadow', 'destins', 'monopoly', 'risk'). */
export function choisirJeu(id) { JEU = JEUX[id] || null; return JEU; }
/** Jeu de la page (objet de JEUX). */
export function jeu() { return JEU; }

/* ---------- Mode invité ---------- */
let invite = false;
/** Active le mode invité (visiteur sans compte), appelé par la page au démarrage. */
export function activerInvite(oui) { invite = !!oui; }
/** Vrai si le visiteur joue en invité. */
export function estInvite() { return invite; }
const CLE_JETON = (code) => `hg_plat_invite:${String(code || '').toUpperCase()}`;
function jetonInvite(code) { try { return localStorage.getItem(CLE_JETON(code)); } catch { return null; } }
function garderJeton(code, jeton) { try { localStorage.setItem(CLE_JETON(code), jeton); } catch { /* navigation privée stricte */ } }
function oublierJeton(code) { try { localStorage.removeItem(CLE_JETON(code)); } catch { /* sans effet */ } }

/** Message d'erreur lisible (les fonctions du jeu renvoient déjà des phrases en français). */
export function erreurTexte(e) {
  const m = e?.message || String(e || '');
  if (/permission denied|42501/i.test(m)) return 'Accès réservé.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Connexion perdue. Réessaie dans un instant.';
  return m || errMsg(e) || 'Erreur inconnue.';
}

async function rpc(nom, args = {}) {
  const { data, error } = await sb.rpc(nom, args);
  if (error) throw new Error(erreurTexte(error));
  return data;
}
const rpcInvite = (action, code, args = {}) =>
  rpc('hg_plat_invite', { p_action: action, p_code: code, p_jeton: jetonInvite(code), p_args: args });
const deux = (membre, inv) => (...a) => (invite ? inv(...a) : membre(...a));

/** Appels (noms calqués sur les fonctions serveur de la migration 125). */
export const plat = {
  /** Crée une partie : p = { nom, visibilite, nb_places, invites, t_tour, annonce_discord, options }. Renvoie le code. */
  creer: (p) => rpc('hg_plat_creer', { p: { ...p, jeu: JEU.id } }),
  rejoindre: (code) => rpc('hg_plat_rejoindre', { p_code: code }),
  /** Aperçu public d'une partie (sans compte) ou null : { jeu, nom_jeu, nom, code, statut, invites, nb_places, inscrits, hote_pseudo, t_tour }. */
  apercu: (code) => rpc('hg_plat_invite', { p_action: 'apercu', p_code: code }),
  /** Invité : rejoint avec un pseudo, garde le jeton dans le navigateur, renvoie le code. */
  async rejoindreInvite(code, pseudo) {
    const r = await rpc('hg_plat_invite', { p_action: 'rejoindre', p_code: code, p_args: { pseudo } });
    if (!r?.jeton) throw new Error('Impossible de rejoindre la partie.');
    garderJeton(r.code || code, r.jeton);
    return r.code || code;
  },
  oublierInvite: (code) => oublierJeton(code),
  quitter: deux((code) => rpc('hg_plat_quitter', { p_code: code }), async (code) => { await rpcInvite('quitter', code); oublierJeton(code); }),
  pret: deux((code, pret) => rpc('hg_plat_pret', { p_code: code, p_pret: pret }), (code, pret) => rpcInvite('pret', code, { pret })),
  exclure: (code, user) => rpc('hg_plat_exclure', { p_code: code, p_user: user }),
  lancer: (code) => rpc('hg_plat_lancer', { p_code: code }),
  /** Action de jeu (voir le moteur du jeu) : agir(code, 'deplacer', { piece: 'hall' }). */
  agir: deux((code, action, args = {}) => rpc('hg_plat_agir', { p_code: code, p_action: action, p_args: args }),
    (code, action, args = {}) => rpcInvite('agir', code, { action, args })),
  message: deux((code, texte) => rpc('hg_plat_message', { p_code: code, p_texte: texte }), (code, texte) => rpcInvite('message', code, { texte })),
  avancer: deux((code) => rpc('hg_plat_avancer', { p_code: code }), (code) => rpcInvite('avancer', code)),
  etat: deux((code) => rpc('hg_plat_etat', { p_code: code }), (code) => rpcInvite('etat', code)),
  rejouer: (code) => rpc('hg_plat_rejouer', { p_code: code }),
  publiques: () => rpc('hg_plat_publiques', { p_jeu: JEU.id }),
  mesParties: () => rpc('hg_plat_mes_parties', { p_jeu: JEU.id }),
  stats: (user = null) => rpc('hg_plat_stats', { p_jeu: JEU.id, p_user: user }),
  // Administration (assets/js/admin-plateaux.js)
  adminReglages: (jeuId) => rpc('hg_plat_admin_reglages', { p_jeu: jeuId }),
  adminEnregistrer: (jeuId, p) => rpc('hg_plat_admin_enregistrer', { p_jeu: jeuId, p }),
  adminContenu: (jeuId, cle, valeur) => rpc('hg_plat_admin_contenu', { p_jeu: jeuId, p_cle: cle, p_valeur: valeur }),
  adminArreter: (code) => rpc('hg_plat_admin_arreter', { p_code: code }),
};

/* ---------- Contenus paramétrables ---------- */
let cacheContenus = null;
/**
 * Contenus du jeu de la page : { nom, victime, suspects: [{id, nom, couleur}], … } (selon le jeu).
 * @param {string|null} code partie (utile en invité). Chargé une seule fois.
 */
export async function contenus(code = null) {
  if (cacheContenus) return cacheContenus;
  cacheContenus = invite && code
    ? await rpc('hg_plat_invite', { p_action: 'contenus', p_code: code })
    : await rpc('hg_plat_contenus', { p_jeu: JEU.id });
  return cacheContenus || {};
}
/** Nom d'un élément d'une liste de contenus (ou l'identifiant s'il manque). */
export function nomDe(c, liste, id) {
  return (c?.[liste] || []).find((x) => x.id === id)?.nom || id || '';
}

/** Vrai si l'image existe (sert aux visuels fournis plus tard : sinon on garde le dessin de repli). */
export function imageExiste(src) {
  return new Promise((ok) => {
    const i = new Image();
    i.onload = () => ok(true);
    i.onerror = () => ok(false);
    i.src = src;
  });
}

/** Messages du chat d'une partie (après l'id donné), du plus ancien au plus récent. */
export async function messages(partieId, depuisId = 0, code = null) {
  if (invite) {
    const tous = await rpcInvite('messages', code, depuisId ? { apres: depuisId } : {});
    return (tous || []).filter((m) => m.id > depuisId).sort((a, b) => a.id - b.id);
  }
  return (await rpc('hg_plat_messages', { p_partie: partieId, p_apres: depuisId })) || [];
}

/**
 * Suit une partie : onEtat(etat) à chaque changement, onMessage(msg) à chaque nouveau message.
 * Temps réel (ligne de la partie + messages) et relecture de secours (4 s membre, 2 s invité).
 * Quand le chrono est écoulé, demande au serveur de jouer pour l'absent (il vérifie lui-même).
 * @returns {{ arreter: Function, rafraichir: Function, etat: Function, secondesRestantes: Function }}
 */
export function suivrePartie(code, { onEtat, onMessage, onErreur } = {}) {
  let actif = true;
  let dernier = null;
  let enCours = null;
  let relire = false;
  let canal = null;
  let decalage = 0;
  let avanceDemandee = '';

  const rafraichir = async () => {
    if (!actif) return;
    if (enCours) { relire = true; return enCours; }
    enCours = (async () => {
      try {
        const e = await plat.etat(code);
        if (!actif) return;
        if (e?.maintenant) decalage = new Date(e.maintenant).getTime() - Date.now();
        const change = !dernier || dernier.partie?.version !== e?.partie?.version || dernier.partie?.statut !== e?.partie?.statut;
        dernier = e;
        if (change) onEtat?.(e);
        abonner(e);
      } catch (err) {
        onErreur?.(err);
      } finally {
        enCours = null;
        if (relire && actif) { relire = false; rafraichir(); }
      }
    })();
    return enCours;
  };

  const abonner = (e) => {
    const id = e?.partie?.id;
    if (!id || canal || invite) return;
    try {
      canal = sb.channel(`plat:${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hg_plat_parties', filter: `id=eq.${id}` }, () => rafraichir())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hg_plat_messages', filter: `partie=eq.${id}` }, (p) => onMessage?.(p.new))
        .subscribe();
    } catch (err) {
      console.warn('[plateaux] temps réel indisponible', err);
    }
  };

  const minuteur = setInterval(() => {
    if (!actif || document.hidden) return;
    const p = dernier?.partie;
    if (p?.tour_fin && p.statut === 'en_cours') {
      const reste = new Date(p.tour_fin).getTime() - (Date.now() + decalage);
      const cle = `${p.version}`;
      if (reste <= -500 && avanceDemandee !== cle) {
        avanceDemandee = cle;
        plat.avancer(code).then(rafraichir).catch(() => {});
      }
    }
  }, 1000);
  const secours = setInterval(() => { if (actif && !document.hidden) rafraichir(); }, invite ? 2000 : 4000);
  const visible = () => { if (!document.hidden) rafraichir(); };
  document.addEventListener('visibilitychange', visible);

  rafraichir();
  return {
    arreter() {
      actif = false;
      clearInterval(minuteur); clearInterval(secours);
      document.removeEventListener('visibilitychange', visible);
      if (canal) { try { sb.removeChannel(canal); } catch { /* sans effet */ } }
    },
    rafraichir,
    etat: () => dernier,
    /** Secondes restantes du tour en cours (heure du serveur), ou null. */
    secondesRestantes() {
      const p = dernier?.partie;
      if (!p?.tour_fin) return null;
      return Math.max(0, Math.ceil((new Date(p.tour_fin).getTime() - (Date.now() + decalage)) / 1000));
    },
  };
}
