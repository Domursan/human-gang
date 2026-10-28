// ===== Humane Gang — Nom de code : accès aux données (fonctions serveur hg_ndc_*, temps réel) =====
/*
 * Rôle : seul point de contact avec Supabase pour Nom de code. Les écrans n'appellent jamais sb directement.
 * Toute la logique de jeu est côté serveur (migration 123) : ici on envoie des intentions et on relit l'état.
 * Les couleurs secrètes des cartes ne sont renvoyées qu'aux espions (ou une fois la carte révélée).
 * Le salon (créer, rejoindre, temps réel, mode invité) vient de commun/jeux-salon.js.
 * Dépendances : core.js (notify), commun/jeux-salon.js.
 * Exporte : ndc (appels), suivrePartie, messages, erreurTexte, activerInvite, estInvite, jetonInvite, EQUIPES.
 */
import { notify } from '../../commun/core.js';
import { creerSalon } from '../../commun/jeux-salon.js';

/** Les deux équipes : nom affiché, couleur de fond, couleur du texte posé dessus. */
export const EQUIPES = {
  jaune: { nom: 'Jaune', fond: '#F2B71F', texte: '#2A1C00', fonce: '#7A5200', clair: '#FFD970' },
  rose: { nom: 'Rose', fond: '#E8559A', texte: '#FFFFFF', fonce: '#8C1F55', clair: '#FF9CCB' },
};

/** Le chat reçu en temps réel porte la colonne canal brute ('general', 'jaune', 'rose') : ramenée à 'general' | 'equipe'. */
const salon = creerSalon({
  prefixe: 'hg_ndc', canal: 'ndc', etiquette: '[nom-de-code]',
  transformerMessage: (m, dernier) => {
    const pseudo = (dernier?.joueurs || []).find((j) => j.user_id === m.user_id)?.pseudo || '?';
    return { ...m, pseudo, canal: m.canal === 'general' ? 'general' : 'equipe' };
  },
});
const { rpc, rpcInvite, deux, commun } = salon;

/** Appels du jeu (noms calqués sur les fonctions serveur, voir la migration 123). */
export const ndc = Object.assign(commun, {
  /** p : {nom, visibilite: 'publique'|'privee', nb_places (4-20), invites, t_espion (60|90|120), t_equipe (0|60|120 ; 0 = sans limite),
   *  validation: 'majorite'|'libre', paquet: 'classique', annonce_discord} → code. */
  async creer(p) {
    const code = await rpc('hg_ndc_creer', { p });
    if (p?.annonce_discord) notify('ndc_party', { code }).catch(() => {});
    return code;
  },
  /** Rejoindre une équipe ('jaune', 'rose' ou null = sans équipe) ; l'hôte peut placer un autre joueur (user). */
  equipe: deux((code, equipe, user = null) => rpc('hg_ndc_equipe', { p_code: code, p_equipe: equipe, p_user: user }),
    (code, equipe) => rpcInvite('equipe', code, { equipe })),
  /** Devenir l'espion de son équipe (oui) ou redevenir agent ; l'hôte peut désigner un autre joueur (user). */
  espion: deux((code, oui = true, user = null) => rpc('hg_ndc_espion', { p_code: code, p_user: user, p_oui: oui }),
    (code, oui = true) => rpcInvite('espion', code, { oui })),
  equilibrer: (code) => rpc('hg_ndc_equilibrer', { p_code: code }),
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
  adminMots: (paquet = 'classique') => rpc('hg_ndc_admin_mots', { p_paquet: paquet }),
  /** Ajoute / retire / active / désactive des mots → nombre de mots actifs du paquet. */
  adminEnregistrerMots: (paquet, { ajouter = [], retirer = [], activer = [], desactiver = [] } = {}) =>
    rpc('hg_ndc_admin_enregistrer_mots', { p_paquet: paquet, p_ajouter: ajouter, p_retirer: retirer, p_activer: activer, p_desactiver: desactiver }),
});

export const { erreurTexte, activerInvite, estInvite, jetonInvite, messages, suivrePartie } = salon;
