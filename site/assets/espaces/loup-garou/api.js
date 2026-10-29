// ===== Humane Gang — Loup-Garou : accès aux données (fonctions serveur hg_lg_*, temps réel) =====
/*
 * Rôle : seul point de contact avec Supabase pour le jeu. Les écrans n'appellent jamais sb directement.
 * Toute la logique de jeu est côté serveur (migrations 118 et 119) : ici on envoie des intentions et on relit l'état.
 * Le salon (créer, rejoindre, temps réel, mode invité) vient de commun/jeux-salon.js ; le Loup-Garou lit ses messages
 *   directement dans la table (la base ne renvoie que ce que le joueur a le droit de lire).
 * Mode invité (migration 120) : un visiteur sans compte joue avec un jeton secret gardé dans son navigateur ;
 *   tous ses appels passent par hg_lg_invite (pas de temps réel : relecture toutes les 4 s).
 * Dépendances : core.js (sb), commun/jeux-salon.js.
 * Exporte : lg (appels), suivrePartie, messages, erreurTexte, activerInvite, estInvite, jetonInvite.
 */
import { sb } from '../../commun/core.js';
import { creerSalon } from '../../commun/jeux-salon.js';

const salon = creerSalon({
  prefixe: 'hg_lg', canal: 'lg', etiquette: '[loup-garou]',
  tablesSupp: ['hg_lg_joueurs'],           // les joueurs changent (rôle, vivant, vote) : relecture
  secours: { membre: 4000, invite: 4000 },
  relireMessagesInvite: false,             // le chat relit lui-même chaque salon pour l'invité (chat.js)
  restePause: true,                         // partie en pause : le temps figé est affiché
  champFin: 'phase_fin',
  delaiAvance: 0,                           // l'étape avance dès que son délai est écoulé
  maintenant: (e) => e?.partie?.maintenant,
  // Redessine quand la version, le statut ou la phase changent, et à chaque relecture sans version (état incomplet).
  changement: (dernier, e) => !dernier || dernier.partie?.version !== e?.partie?.version || dernier.partie?.statut !== e?.partie?.statut
    || dernier.partie?.phase !== e?.partie?.phase || !e?.partie?.version,
  // Échéance d'une étape (nuit, jour, révélation) : la clé suit phase, manche et version.
  echeance: (dernier) => {
    const p = dernier?.partie;
    if (!p?.phase_fin || !['revelation', 'en_cours'].includes(p.statut)) return null;
    return { fin: p.phase_fin, cle: `${p.phase}:${p.manche}:${p.version}` };
  },
});
const { rpc, rpcInvite, deux, commun } = salon;

/** Appels du jeu. Les noms suivent les fonctions serveur. */
export const lg = Object.assign(commun, {
  rejoindre: (code, pseudo = null) => rpc('hg_lg_rejoindre', { p_code: code, p_pseudo: pseudo }),
  /** Avance l'étape ; forcer : passe même si tout le monde n'a pas agi. */
  avancer: deux((code, forcer = false) => rpc('hg_lg_avancer', { p_code: code, p_forcer: forcer }), (code) => rpcInvite('avancer', code)),
  vu: deux((code) => rpc('hg_lg_vu', { p_code: code }), (code) => rpcInvite('vu', code)),
  /** Action de nuit ou réaction : type = devorer, sonder, proteger, sorciere, cupidon, voleur, chasseur, succession, passer... */
  agir: deux((code, type, { cible = null, cible2 = null, choix = null } = {}) =>
    rpc('hg_lg_agir', { p_code: code, p_type: type, p_cible: cible, p_cible2: cible2, p_choix: choix }),
  (code, type, { cible = null, cible2 = null, choix = null } = {}) => rpcInvite('agir', code, { type, cible, cible2, choix })),
  voter: deux((code, cible) => rpc('hg_lg_voter', { p_code: code, p_cible: cible }), (code, cible) => rpcInvite('voter', code, { cible })),
  message: deux((code, canal, texte) => rpc('hg_lg_message', { p_code: code, p_canal: canal, p_texte: texte }),
    (code, canal, texte) => rpcInvite('message', code, { canal, texte })),
  /** Meneur : action = eliminer, ressusciter, message, pause, reprendre, plus, arreter. */
  mj: (code, action, { cible = null, texte = null, secondes = 30 } = {}) =>
    rpc('hg_lg_mj', { p_code: code, p_action: action, p_cible: cible, p_texte: texte, p_secondes: secondes }),
});

/** Messages d'un salon (lecture directe : la base ne renvoie que ce que le joueur a le droit de lire). */
export async function messages(partieId, canal, depuisId = 0, code = null) {
  if (salon.estInvite()) {
    const tous = await rpcInvite('messages', code);
    return (tous || []).filter((m) => m.canal === canal && m.id > depuisId).sort((a, b) => a.id - b.id);
  }
  const { data, error } = await sb.from('hg_lg_messages').select('id, canal, user_id, texte, created_at')
    .eq('partie', partieId).eq('canal', canal).gt('id', depuisId).order('id', { ascending: true }).limit(200);
  if (error) throw new Error(salon.erreurTexte(error));
  return data || [];
}

export const { erreurTexte, activerInvite, estInvite, jetonInvite, suivrePartie } = salon;
