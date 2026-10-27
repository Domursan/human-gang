// ===== Humane Gang — Uno : accès aux données (fonctions serveur hg_uno_*, temps réel) =====
/*
 * Rôle : seul point de contact avec Supabase pour le Uno. Les écrans n'appellent jamais sb directement.
 * Toute la logique de jeu est côté serveur (migration 121) : ici on envoie des intentions et on relit l'état.
 * Mode invité : un visiteur sans compte joue avec un jeton secret gardé dans son navigateur ;
 *   tous ses appels passent par hg_uno_invite (pas de temps réel : relecture toutes les 2 s).
 * Dépendances : core.js (sb, errMsg).
 * Exporte : uno (appels), suivrePartie, messages, erreurTexte, activerInvite, estInvite, jetonInvite.
 */
import { sb, errMsg } from '../../commun/core.js';

/* ---------- Mode invité ---------- */
let invite = false;
/** Active le mode invité (visiteur sans compte), appelé par la page au démarrage. */
export function activerInvite(oui) { invite = !!oui; }
/** Vrai si le visiteur joue en invité. */
export function estInvite() { return invite; }
const CLE_JETON = (code) => `hg_uno_invite:${String(code || '').toUpperCase()}`;
/** Jeton d'invité pour une partie (null si absent ou stockage indisponible). */
export function jetonInvite(code) { try { return localStorage.getItem(CLE_JETON(code)); } catch { return null; } }
function garderJeton(code, jeton) { try { localStorage.setItem(CLE_JETON(code), jeton); } catch { /* navigation privée stricte */ } }
function oublierJeton(code) { try { localStorage.removeItem(CLE_JETON(code)); } catch { /* sans effet */ } }

/** Appel d'une fonction serveur ; lève une Error avec un message lisible. */
async function rpc(nom, args = {}) {
  const { data, error } = await sb.rpc(nom, args);
  if (error) throw new Error(erreurTexte(error));
  return data;
}
/** Appel invité : action de jeu au nom du jeton de cette partie. */
const rpcInvite = (action, code, args = {}) =>
  rpc('hg_uno_invite', { p_action: action, p_code: code, p_jeton: jetonInvite(code), p_args: args });
/** Aiguille vers l'appel membre ou l'appel invité. */
const deux = (membre, inv) => (...a) => (invite ? inv(...a) : membre(...a));

/** Message d'erreur lisible (les fonctions du jeu renvoient déjà des phrases en français). */
export function erreurTexte(e) {
  const m = e?.message || String(e || '');
  if (/permission denied|42501/i.test(m)) return 'Accès réservé.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Connexion perdue. Réessaie dans un instant.';
  return m || errMsg(e) || 'Erreur inconnue.';
}

/** Appels du jeu (noms calqués sur les fonctions serveur, voir la migration 121). */
export const uno = {
  creer: (p) => rpc('hg_uno_creer', { p }),
  rejoindre: (code) => rpc('hg_uno_rejoindre', { p_code: code }),
  /** Aperçu public d'une partie (sans compte) ou null. */
  apercu: (code) => rpc('hg_uno_invite', { p_action: 'apercu', p_code: code }),
  /** Invité : rejoint avec un pseudo, garde le jeton dans le navigateur, renvoie le code. */
  async rejoindreInvite(code, pseudo) {
    const r = await rpc('hg_uno_invite', { p_action: 'rejoindre', p_code: code, p_args: { pseudo } });
    if (!r?.jeton) throw new Error('Impossible de rejoindre la partie.');
    garderJeton(r.code || code, r.jeton);
    return r.code || code;
  },
  oublierInvite: (code) => oublierJeton(code),
  quitter: deux((code) => rpc('hg_uno_quitter', { p_code: code }), async (code) => { await rpcInvite('quitter', code); oublierJeton(code); }),
  pret: deux((code, pret) => rpc('hg_uno_pret', { p_code: code, p_pret: pret }), (code, pret) => rpcInvite('pret', code, { pret })),
  exclure: (code, user) => rpc('hg_uno_exclure', { p_code: code, p_user: user }),
  lancer: (code) => rpc('hg_uno_lancer', { p_code: code }),
  /** Pose une carte. couleur : obligatoire pour un Joker ; cible : pour un 7 en Sept-zéro. */
  jouer: deux((code, carte, { couleur = null, cible = null } = {}) =>
    rpc('hg_uno_jouer', { p_code: code, p_carte: carte, p_couleur: couleur, p_cible: cible }),
  (code, carte, { couleur = null, cible = null } = {}) => rpcInvite('jouer', code, { carte, couleur, cible })),
  piocher: deux((code) => rpc('hg_uno_piocher', { p_code: code }), (code) => rpcInvite('piocher', code)),
  passer: deux((code) => rpc('hg_uno_passer', { p_code: code }), (code) => rpcInvite('passer', code)),
  direUno: deux((code) => rpc('hg_uno_uno', { p_code: code }), (code) => rpcInvite('uno', code)),
  contrer: deux((code, cible) => rpc('hg_uno_contrer', { p_code: code, p_cible: cible }), (code, cible) => rpcInvite('contrer', code, { cible })),
  contester: deux((code, oui) => rpc('hg_uno_contester', { p_code: code, p_contester: !!oui }), (code, oui) => rpcInvite('contester', code, { contester: !!oui })),
  message: deux((code, texte) => rpc('hg_uno_message', { p_code: code, p_texte: texte }), (code, texte) => rpcInvite('message', code, { texte })),
  avancer: deux((code) => rpc('hg_uno_avancer', { p_code: code }), (code) => rpcInvite('avancer', code)),
  etat: deux((code) => rpc('hg_uno_etat', { p_code: code }), (code) => rpcInvite('etat', code)),
  rejouer: (code) => rpc('hg_uno_rejouer', { p_code: code }),
  publiques: () => rpc('hg_uno_publiques'),
  mesParties: () => rpc('hg_uno_mes_parties'),
  stats: (user = null) => rpc('hg_uno_stats', { p_user: user }),
  adminReglages: () => rpc('hg_uno_admin_reglages'),
  adminEnregistrer: (p) => rpc('hg_uno_admin_enregistrer', { p }),
  adminArreter: (code) => rpc('hg_uno_admin_arreter', { p_code: code }),
};

/** Messages du chat d'une partie (après l'id donné), triés du plus ancien au plus récent. */
export async function messages(partieId, depuisId = 0, code = null) {
  if (invite) {
    const tous = await rpcInvite('messages', code, depuisId ? { apres: depuisId } : {});
    return (tous || []).filter((m) => m.id > depuisId).sort((a, b) => a.id - b.id);
  }
  const { data, error } = await sb.rpc('hg_uno_messages', { p_partie: partieId, p_apres: depuisId });
  if (error) throw new Error(erreurTexte(error));
  return data || [];
}

/**
 * Suit une partie : appelle onEtat(etat) à chaque changement, onMessage(msg) à chaque nouveau message.
 * Temps réel (ligne de la partie + messages) et relecture de secours (4 s membre, 2 s invité).
 * Quand le chrono du tour est écoulé, demande au serveur de jouer pour l'absent (il vérifie lui-même).
 * @returns {{ arreter: Function, rafraichir: Function, etat: Function, secondesRestantes: Function }}
 */
export function suivrePartie(code, { onEtat, onMessage, onErreur } = {}) {
  let actif = true;
  let dernier = null;
  let enCours = null;
  let relire = false;
  let canal = null;
  let decalage = 0;            // horloge serveur - horloge locale (ms)
  let avanceDemandee = '';

  const rafraichir = async () => {
    if (!actif) return;
    if (enCours) { relire = true; return enCours; }
    enCours = (async () => {
      try {
        const e = await uno.etat(code);
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
      canal = sb.channel(`uno:${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hg_uno_parties', filter: `id=eq.${id}` }, () => rafraichir())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hg_uno_messages', filter: `partie=eq.${id}` }, (p) => onMessage?.(p.new))
        .subscribe();
    } catch (err) {
      console.warn('[uno] temps réel indisponible', err);
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
        uno.avancer(code).then(rafraichir).catch(() => {});
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
