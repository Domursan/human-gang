// ===== Humane Gang — Codenames : accès aux données (fonctions serveur hg_ndc_*, temps réel) =====
/*
 * Rôle : seul point de contact avec Supabase pour Codenames. Les écrans n'appellent jamais sb directement.
 * Toute la logique de jeu est côté serveur (migration 123) : ici on envoie des intentions et on relit l'état.
 * Les couleurs secrètes des cartes ne sont renvoyées qu'aux espions (ou une fois la carte révélée).
 * Mode invité : un visiteur sans compte joue avec un jeton secret gardé dans son navigateur ;
 *   tous ses appels passent par hg_ndc_invite (pas de temps réel : relecture toutes les 2 s).
 * Dépendances : core.js (sb, errMsg, notify).
 * Exporte : ndc (appels), suivrePartie, messages, erreurTexte, activerInvite, estInvite, jetonInvite, EQUIPES.
 */
import { sb, errMsg, notify } from '../core.js';

/** Les deux équipes : nom affiché, couleur de fond, couleur du texte posé dessus. */
export const EQUIPES = {
  jaune: { nom: 'Jaune', fond: '#F2B71F', texte: '#2A1C00', fonce: '#7A5200', clair: '#FFD970' },
  rose: { nom: 'Rose', fond: '#E8559A', texte: '#FFFFFF', fonce: '#8C1F55', clair: '#FF9CCB' },
};

/* ---------- Mode invité ---------- */
let invite = false;
/** Active le mode invité (visiteur sans compte), appelé par la page au démarrage. */
export function activerInvite(oui) { invite = !!oui; }
/** Vrai si le visiteur joue en invité. */
export function estInvite() { return invite; }
const CLE_JETON = (code) => `hg_ndc_invite:${String(code || '').toUpperCase()}`;
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
  rpc('hg_ndc_invite', { p_action: action, p_code: code, p_jeton: jetonInvite(code), p_args: args });
/** Aiguille vers l'appel membre ou l'appel invité. */
const deux = (membre, inv) => (...a) => (invite ? inv(...a) : membre(...a));

/** Message d'erreur lisible (les fonctions du jeu renvoient déjà des phrases en français). */
export function erreurTexte(e) {
  const m = e?.message || String(e || '');
  if (/permission denied|42501/i.test(m)) return 'Accès réservé.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Connexion perdue. Réessaie dans un instant.';
  return m || errMsg(e) || 'Erreur inconnue.';
}

/** Appels du jeu (noms calqués sur les fonctions serveur, voir la migration 123). */
export const ndc = {
  /** p : {nom, visibilite: 'publique'|'privee', nb_places (4-20), invites, t_espion (60|90|120), t_equipe (0|60|120 ; 0 = sans limite),
   *  validation: 'majorite'|'libre', paquet: 'classique', annonce_discord} → code. */
  async creer(p) {
    const code = await rpc('hg_ndc_creer', { p });
    if (p?.annonce_discord) notify('ndc_party', { code }).catch(() => {});
    return code;
  },
  rejoindre: (code) => rpc('hg_ndc_rejoindre', { p_code: code }),
  /** Aperçu public d'une partie (sans compte) ou null : {nom, code, statut, invites, nb_places, inscrits, hote_pseudo, t_espion, t_equipe, validation}. */
  apercu: (code) => rpc('hg_ndc_invite', { p_action: 'apercu', p_code: code }),
  /** Invité : rejoint avec un pseudo, garde le jeton dans le navigateur, renvoie le code. */
  async rejoindreInvite(code, pseudo) {
    const r = await rpc('hg_ndc_invite', { p_action: 'rejoindre', p_code: code, p_args: { pseudo } });
    if (!r?.jeton) throw new Error('Impossible de rejoindre la partie.');
    garderJeton(r.code || code, r.jeton);
    return r.code || code;
  },
  oublierInvite: (code) => oublierJeton(code),
  quitter: deux((code) => rpc('hg_ndc_quitter', { p_code: code }), async (code) => { await rpcInvite('quitter', code); oublierJeton(code); }),
  pret: deux((code, pret) => rpc('hg_ndc_pret', { p_code: code, p_pret: pret }), (code, pret) => rpcInvite('pret', code, { pret })),
  exclure: (code, user) => rpc('hg_ndc_exclure', { p_code: code, p_user: user }),
  /** Rejoindre une équipe ('jaune', 'rose' ou null = sans équipe) ; l'hôte peut placer un autre joueur (user). */
  equipe: deux((code, equipe, user = null) => rpc('hg_ndc_equipe', { p_code: code, p_equipe: equipe, p_user: user }),
    (code, equipe) => rpcInvite('equipe', code, { equipe })),
  /** Devenir l'espion de son équipe (oui) ou redevenir agent ; l'hôte peut désigner un autre joueur (user). */
  espion: deux((code, oui = true, user = null) => rpc('hg_ndc_espion', { p_code: code, p_user: user, p_oui: oui }),
    (code, oui = true) => rpcInvite('espion', code, { oui })),
  equilibrer: (code) => rpc('hg_ndc_equilibrer', { p_code: code }),
  lancer: (code) => rpc('hg_ndc_lancer', { p_code: code }),
  /** L'espion de l'équipe au tour : un seul mot et un nombre de 0 à 9 (0 : essais illimités). */
  indice: deux((code, mot, nombre) => rpc('hg_ndc_indice', { p_code: code, p_mot: mot, p_nombre: nombre }),
    (code, mot, nombre) => rpcInvite('indice', code, { mot, nombre })),
  /** Un agent pose son jeton sur une carte (pos 0-24), ou le retire (null). À la majorité, la carte est révélée. */
  proposer: deux((code, pos) => rpc('hg_ndc_proposer', { p_code: code, p_pos: pos }), (code, pos) => rpcInvite('proposer', code, { pos })),
  /** Mode « libre » : révèle tout de suite la carte → couleur ('jaune' | 'rose' | 'neutre' | 'assassin'). */
  valider: deux((code, pos) => rpc('hg_ndc_valider', { p_code: code, p_pos: pos }), (code, pos) => rpcInvite('valider', code, { pos })),
  /** « On s'arrête » : fin du tour de l'équipe (au moins un mot révélé sur l'indice). */
  arreter: deux((code) => rpc('hg_ndc_arreter', { p_code: code }), (code) => rpcInvite('arreter', code)),
  /** Chat : canal 'general' ou 'equipe' (l'espion ne peut pas écrire dans le canal de son équipe pendant la partie). */
  message: deux((code, texte, canal = 'general') => rpc('hg_ndc_message', { p_code: code, p_texte: texte, p_canal: canal }),
    (code, texte, canal = 'general') => rpcInvite('message', code, { texte, canal })),
  avancer: deux((code) => rpc('hg_ndc_avancer', { p_code: code }), (code) => rpcInvite('avancer', code)),
  etat: deux((code) => rpc('hg_ndc_etat', { p_code: code }), (code) => rpcInvite('etat', code)),
  /** Revanche : nouvelle salle (même équipe pour celui qui la lance) → code. */
  rejouer: (code) => rpc('hg_ndc_rejouer', { p_code: code }),
  publiques: () => rpc('hg_ndc_publiques'),
  mesParties: () => rpc('hg_ndc_mes_parties'),
  stats: (user = null) => rpc('hg_ndc_stats', { p_user: user }),
  adminReglages: () => rpc('hg_ndc_admin_reglages'),
  adminEnregistrer: (p) => rpc('hg_ndc_admin_enregistrer', { p }),
  adminArreter: (code) => rpc('hg_ndc_admin_arreter', { p_code: code }),
  adminMots: (paquet = 'classique') => rpc('hg_ndc_admin_mots', { p_paquet: paquet }),
  /** Ajoute / retire / active / désactive des mots → nombre de mots actifs du paquet. */
  adminEnregistrerMots: (paquet, { ajouter = [], retirer = [], activer = [], desactiver = [] } = {}) =>
    rpc('hg_ndc_admin_enregistrer_mots', { p_paquet: paquet, p_ajouter: ajouter, p_retirer: retirer, p_activer: activer, p_desactiver: desactiver }),
};

/** Messages du chat d'une partie (après l'id donné), du plus ancien au plus récent : {id, user_id, pseudo, canal: 'general'|'equipe', texte, created_at}. */
export async function messages(partieId, depuisId = 0, code = null) {
  if (invite) {
    const tous = await rpcInvite('messages', code, depuisId ? { apres: depuisId } : {});
    return (tous || []).filter((m) => m.id > depuisId).sort((a, b) => a.id - b.id);
  }
  const { data, error } = await sb.rpc('hg_ndc_messages', { p_partie: partieId, p_apres: depuisId });
  if (error) throw new Error(erreurTexte(error));
  return data || [];
}

/**
 * Suit une partie : appelle onEtat(etat) à chaque changement, onMessage(msg) à chaque nouveau message.
 * Temps réel (ligne de la partie + messages lisibles) et relecture de secours (4 s membre, 2 s invité).
 * Quand le chrono est écoulé, demande au serveur de passer le tour (il vérifie lui-même).
 * Les messages reçus en temps réel ont la colonne canal brute ('general', 'jaune', 'rose') : ils sont ramenés à 'general' | 'equipe'.
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
        const e = await ndc.etat(code);
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
      canal = sb.channel(`ndc:${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hg_ndc_parties', filter: `id=eq.${id}` }, () => rafraichir())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hg_ndc_messages', filter: `partie=eq.${id}` }, (p) => {
          const m = p.new || {};
          const pseudo = (dernier?.joueurs || []).find((j) => j.user_id === m.user_id)?.pseudo || '?';
          onMessage?.({ ...m, pseudo, canal: m.canal === 'general' ? 'general' : 'equipe' });
        })
        .subscribe();
    } catch (err) {
      console.warn('[nom-de-code] temps réel indisponible', err);
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
        ndc.avancer(code).then(rafraichir).catch(() => {});
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
    /** Secondes restantes du chrono en cours (heure du serveur), ou null (pas de chrono : équipe sans limite). */
    secondesRestantes() {
      const p = dernier?.partie;
      if (!p?.tour_fin) return null;
      return Math.max(0, Math.ceil((new Date(p.tour_fin).getTime() - (Date.now() + decalage)) / 1000));
    },
  };
}
