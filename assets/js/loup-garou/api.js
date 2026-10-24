// ===== Humane Gang — Loup-Garou : accès aux données (fonctions serveur hg_lg_*, temps réel) =====
/*
 * Rôle : seul point de contact avec Supabase pour le jeu. Les écrans n'appellent jamais sb directement.
 * Toute la logique de jeu est côté serveur (migrations 118 et 119) : ici on envoie des intentions et on relit l'état.
 * Dépendances : core.js (sb, errMsg).
 * Exporte : lg (appels), suivrePartie (abonnement temps réel + secours périodique), messages, erreurTexte.
 */
import { sb, errMsg } from '../core.js';

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
  quitter: (code) => rpc('hg_lg_quitter', { p_code: code }),
  pret: (code, pret) => rpc('hg_lg_pret', { p_code: code, p_pret: pret }),
  exclure: (code, user) => rpc('hg_lg_exclure', { p_code: code, p_user: user }),
  lancer: (code) => rpc('hg_lg_lancer', { p_code: code }),
  vu: (code) => rpc('hg_lg_vu', { p_code: code }),
  /** Action de nuit ou réaction : type = devorer, sonder, proteger, sorciere, cupidon, voleur, chasseur, succession, passer... */
  agir: (code, type, { cible = null, cible2 = null, choix = null } = {}) =>
    rpc('hg_lg_agir', { p_code: code, p_type: type, p_cible: cible, p_cible2: cible2, p_choix: choix }),
  voter: (code, cible) => rpc('hg_lg_voter', { p_code: code, p_cible: cible }),
  message: (code, canal, texte) => rpc('hg_lg_message', { p_code: code, p_canal: canal, p_texte: texte }),
  avancer: (code, forcer = false) => rpc('hg_lg_avancer', { p_code: code, p_forcer: forcer }),
  etat: (code) => rpc('hg_lg_etat', { p_code: code }),
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
export async function messages(partieId, canal, depuisId = 0) {
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
    if (!id || canal) return;
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
