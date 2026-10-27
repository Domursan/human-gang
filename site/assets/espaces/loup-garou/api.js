// ===== Humane Gang — Loup-Garou : accès aux données (fonctions serveur hg_lg_*, temps réel) =====
/*
 * Rôle : seul point de contact avec Supabase pour le jeu. Les écrans n'appellent jamais sb directement.
 * Toute la logique de jeu est côté serveur (migrations 118 et 119) : ici on envoie des intentions et on relit l'état.
 * Dépendances : core.js (sb, errMsg).
 * Mode invité (migration 120) : un visiteur sans compte joue avec un jeton secret gardé dans son navigateur ;
 *   tous ses appels passent par hg_lg_invite (pas de temps réel : relecture toutes les 4 s).
 * Exporte : lg (appels), suivrePartie (abonnement temps réel + secours périodique), messages, erreurTexte,
 *   activerInvite, estInvite, jetonInvite.
 */
import { sb, errMsg } from '../../commun/core.js';

/* ---------- Mode invité ---------- */
let invite = false;
/** Active le mode invité (visiteur sans compte), appelé par la page au démarrage. */
export function activerInvite(oui) { invite = !!oui; }
/** Vrai si le visiteur joue en invité. */
export function estInvite() { return invite; }
const CLE_JETON = (code) => `hg_lg_invite:${String(code || '').toUpperCase()}`;
/** Jeton d'invité pour une partie (lecture ; null si absent ou stockage indisponible). */
export function jetonInvite(code) { try { return localStorage.getItem(CLE_JETON(code)); } catch { return null; } }
function garderJeton(code, jeton) { try { localStorage.setItem(CLE_JETON(code), jeton); } catch { /* navigation privée stricte */ } }
function oublierJeton(code) { try { localStorage.removeItem(CLE_JETON(code)); } catch { /* sans effet */ } }
/** Appel invité : action de jeu au nom du jeton de cette partie. */
async function rpcInvite(action, code, args = {}) {
  return rpc('hg_lg_invite', { p_action: action, p_code: code, p_jeton: jetonInvite(code), p_args: args });
}
/** Aiguille vers l'appel membre ou l'appel invité. */
const deux = (membre, inv) => (...a) => (invite ? inv(...a) : membre(...a));

/** Appel d'une fonction serveur ; lève une Error avec un message lisible. */
async function rpc(nom, args = {}) {
  const { data, error } = await sb.rpc(nom, args);
  if (error) throw new Error(erreurTexte(error));
  return data;
}

/** Message d'erreur lisible (les fonctions du jeu renvoient déjà des phrases en français). */
export function erreurTexte(e) {
  const m = e?.message || String(e || '');
  if (/permission denied|42501/i.test(m)) return 'Accès réservé.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Connexion perdue. Réessaie dans un instant.';
  return m || errMsg(e) || 'Erreur inconnue.';
}

/** Appels du jeu. Les noms suivent les fonctions serveur. */
export const lg = {
  creer: (params) => rpc('hg_lg_creer', { p: params }),
  rejoindre: (code, pseudo = null) => rpc('hg_lg_rejoindre', { p_code: code, p_pseudo: pseudo }),
  /** Aperçu public d'une partie (sans compte) : { nom, code, statut, invites, nb_joueurs, inscrits, mode, hote_pseudo } ou null. */
  apercu: (code) => rpc('hg_lg_invite', { p_action: 'apercu', p_code: code }),
  /** Invité : rejoint avec un pseudo, garde le jeton dans le navigateur, renvoie le code. */
  async rejoindreInvite(code, pseudo) {
    const r = await rpc('hg_lg_invite', { p_action: 'rejoindre', p_code: code, p_args: { pseudo } });
    if (!r?.jeton) throw new Error('Impossible de rejoindre la partie.');
    garderJeton(r.code || code, r.jeton);
    return r.code || code;
  },
  oublierInvite: (code) => oublierJeton(code),
  quitter: deux((code) => rpc('hg_lg_quitter', { p_code: code }), async (code) => { await rpcInvite('quitter', code); oublierJeton(code); }),
  pret: deux((code, pret) => rpc('hg_lg_pret', { p_code: code, p_pret: pret }), (code, pret) => rpcInvite('pret', code, { pret })),
  exclure: (code, user) => rpc('hg_lg_exclure', { p_code: code, p_user: user }),
  lancer: (code) => rpc('hg_lg_lancer', { p_code: code }),
  vu: deux((code) => rpc('hg_lg_vu', { p_code: code }), (code) => rpcInvite('vu', code)),
  /** Action de nuit ou réaction : type = devorer, sonder, proteger, sorciere, cupidon, voleur, chasseur, succession, passer... */
  agir: deux((code, type, { cible = null, cible2 = null, choix = null } = {}) =>
    rpc('hg_lg_agir', { p_code: code, p_type: type, p_cible: cible, p_cible2: cible2, p_choix: choix }),
  (code, type, { cible = null, cible2 = null, choix = null } = {}) => rpcInvite('agir', code, { type, cible, cible2, choix })),
  voter: deux((code, cible) => rpc('hg_lg_voter', { p_code: code, p_cible: cible }), (code, cible) => rpcInvite('voter', code, { cible })),
  message: deux((code, canal, texte) => rpc('hg_lg_message', { p_code: code, p_canal: canal, p_texte: texte }),
    (code, canal, texte) => rpcInvite('message', code, { canal, texte })),
  avancer: deux((code, forcer = false) => rpc('hg_lg_avancer', { p_code: code, p_forcer: forcer }), (code) => rpcInvite('avancer', code)),
  etat: deux((code) => rpc('hg_lg_etat', { p_code: code }), (code) => rpcInvite('etat', code)),
  /** Meneur : action = eliminer, ressusciter, message, pause, reprendre, plus, arreter. */
  mj: (code, action, { cible = null, texte = null, secondes = 30 } = {}) =>
    rpc('hg_lg_mj', { p_code: code, p_action: action, p_cible: cible, p_texte: texte, p_secondes: secondes }),
  publiques: () => rpc('hg_lg_publiques'),
  mesParties: () => rpc('hg_lg_mes_parties'),
  stats: (user = null) => rpc('hg_lg_stats', { p_user: user }),
  adminReglages: () => rpc('hg_lg_admin_reglages'),
  adminEnregistrer: (p) => rpc('hg_lg_admin_enregistrer', { p }),
};

/** Messages d'un salon (lecture directe : la base ne renvoie que ce que le joueur a le droit de lire). */
export async function messages(partieId, canal, depuisId = 0, code = null) {
  if (invite) {
    const tous = await rpcInvite('messages', code);
    return (tous || []).filter((m) => m.canal === canal && m.id > depuisId).sort((a, b) => a.id - b.id);
  }
  const { data, error } = await sb.from('hg_lg_messages').select('id, canal, user_id, texte, created_at')
    .eq('partie', partieId).eq('canal', canal).gt('id', depuisId).order('id', { ascending: true }).limit(200);
  if (error) throw new Error(erreurTexte(error));
  return data || [];
}

/**
 * Suit une partie : appelle onEtat(etat) à chaque changement, onMessage(msg) à chaque nouveau message.
 * Temps réel (changements de la ligne de partie et des messages) + relecture de secours toutes les 4 s.
 * Quand le minuteur d'une étape est écoulé, demande au serveur d'avancer (il vérifie lui-même).
 * @returns {{ arreter: Function, rafraichir: Function, etat: Function }}
 */
export function suivrePartie(code, { onEtat, onMessage, onErreur } = {}) {
  let actif = true;
  let dernier = null;           // dernier état reçu
  let enCours = null;           // relecture en cours
  let relire = false;           // une relecture a été demandée pendant la précédente
  let canal = null;
  let decalage = 0;             // horloge serveur - horloge locale (ms)
  let avanceDemandee = '';      // évite de demander deux fois l'avance pour la même étape

  const rafraichir = async () => {
    if (!actif) return;
    if (enCours) { relire = true; return enCours; }
    enCours = (async () => {
      try {
        const e = await lg.etat(code);
        if (!actif) return;
        if (e?.partie?.maintenant) decalage = new Date(e.partie.maintenant).getTime() - Date.now();
        const change = !dernier || dernier.partie?.version !== e?.partie?.version || dernier.partie?.statut !== e?.partie?.statut
          || dernier.partie?.phase !== e?.partie?.phase;
        dernier = e;
        if (change || !e?.partie?.version) onEtat?.(e);
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
    if (!id || canal || invite) return;   // invité : pas de temps réel, la relecture suffit
    try {
      canal = sb.channel(`lg:${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hg_lg_parties', filter: `id=eq.${id}` }, () => rafraichir())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hg_lg_joueurs', filter: `partie=eq.${id}` }, () => rafraichir())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hg_lg_messages', filter: `partie=eq.${id}` }, (p) => onMessage?.(p.new))
        .subscribe();
    } catch (err) {
      console.warn('[loup-garou] temps réel indisponible', err);
    }
  };

  // Secours : relecture régulière (réseau capricieux, temps réel coupé) et fin de minuteur.
  const minuteur = setInterval(() => {
    if (!actif || document.hidden) return;
    const p = dernier?.partie;
    if (p?.phase_fin && ['revelation', 'en_cours'].includes(p.statut)) {
      const reste = new Date(p.phase_fin).getTime() - (Date.now() + decalage);
      const cle = `${p.phase}:${p.manche}:${p.version}`;
      if (reste <= 0 && avanceDemandee !== cle) {
        avanceDemandee = cle;
        lg.avancer(code).then(rafraichir).catch(() => {});
      }
    }
  }, 1000);
  const secours = setInterval(() => { if (actif && !document.hidden) rafraichir(); }, 4000);
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
    /** Secondes restantes de l'étape (heure du serveur). */
    secondesRestantes() {
      const p = dernier?.partie;
      if (!p) return null;
      if (p.pause_reste != null) return p.pause_reste;
      if (!p.phase_fin) return null;
      return Math.max(0, Math.ceil((new Date(p.phase_fin).getTime() - (Date.now() + decalage)) / 1000));
    },
  };
}
