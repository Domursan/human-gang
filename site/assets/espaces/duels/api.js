// ===== Humane Gang — Duels : accès aux données (fonctions serveur hg_duel_*, temps réel) =====
/*
 * Rôle : seul point de contact avec Supabase pour les duels. Les écrans n'appellent jamais sb directement.
 * Toute la logique de jeu est côté serveur (migration 122) : ici on envoie des intentions et on relit l'état.
 * Le salon (créer, rejoindre, temps réel, mode invité) vient de commun/jeux-salon.js.
 * Défi à un membre (création ou revanche) : le bot lui envoie un MP (hg-notify, duel_defi), sans bloquer l'écran.
 * Dépendances : core.js (notify), commun/jeux-salon.js, profil et accès aux pages.
 * Exporte : duel (appels), suivrePartie, messages, erreurTexte, activerInvite, estInvite, jetonInvite,
 *   JEUX (noms et réglages des jeux), jeuxVisibles, peutVoirJeuxDev, COULEURS_MM (couleurs du Mastermind).
 */
import { notify } from '../../commun/core.js';
import { getCachedProfile } from '../../commun/core/profile.js';
import { viewAsActive } from '../../commun/core/view-as.js';
import { canAccess, pageLabel, pageMode } from '../../commun/core/pages-access.js';
import { creerSalon } from '../../commun/jeux-salon.js';

/* ---------- Jeux et réglages (textes affichés) ---------- */
/** Jeux, variantes et temps proposés. Images : assets/img/jeux/<image>.webp. */
export const JEUX = {
  p4: { nom: 'Puissance 4', image: 'p4', texte: 'Aligne 4 jetons avant l’autre.',
    variantes: [['classique', 'Classique 7 × 6', 'La grille de base, 4 jetons pour gagner.'],
      ['grande', 'Grande grille 9 × 7', 'Plus de place, des parties plus longues.'],
      ['popout', 'Pop Out', 'Tu peux aussi retirer un de tes jetons du bas d’une colonne.']],
    temps: [15, 30, 60], tempsDefaut: 30 },
  morpion: { nom: 'Morpion', image: 'morpion', texte: 'Classique, Ultime ou Gomoku.',
    variantes: [['classique', 'Classique 3 × 3', 'Trois alignés. Au meilleur des 5 conseillé.'],
      ['ultime', 'Ultime', 'Neuf grilles en une : ta case envoie l’autre dans la grille correspondante.'],
      ['gomoku', 'Gomoku 15 × 15', 'Exactement 5 alignés pour gagner.']],
    temps: [15, 30, 60], tempsDefaut: 30 },
  mastermind: { nom: 'Mastermind', image: 'mastermind', texte: 'Perce le code de l’autre avant lui.',
    variantes: [['duel', 'Chacun son code', 'Vous percez le code de l’autre en même temps. Le moins d’essais gagne.']],
    temps: [60, 90, 120], tempsDefaut: 90 },
  bataille: { nom: 'Bataille navale', image: 'bataille-navale', texte: 'Coule la flotte de l’autre avant la tienne.',
    variantes: [['classique', 'Classique', 'Un tir par tour ; un tir réussi permet de rejouer (réglable).'],
      ['salve', 'Salve', 'Autant de tirs par tour que de navires encore à flot.']],
    temps: [15, 30, 60], tempsDefaut: 30 },
  quiestce: { nom: 'Qui est-ce ?', image: 'qui-est-ce', texte: 'Devine le personnage secret de l’autre.',
    variantes: [['quartier', 'Les habitants du quartier', '24 personnages, des questions toutes prêtes ou libres.']],
    temps: [60, 90, 120], tempsDefaut: 90 },
  /* Nouveaux jeux (page) : accès réglé dans « Accès aux pages » du panel (hg_pages, migration 150), voir jeuxVisibles(). */
  dames: { nom: 'Dames', image: 'dames', texte: 'Prises obligatoires, rafles et dames volantes.', page: 'duel-dames',
    variantes: [['internationales', 'Internationales 10 × 10', 'Damier 10 × 10 : la prise est obligatoire, et la plus longue l’emporte.']],
    temps: [30, 60, 90, 120], tempsDefaut: 90 },
  echecs: { nom: 'Échecs', image: 'echecs', texte: 'Le grand classique, contre un membre ou le robot.', page: 'duel-echecs',
    variantes: [['classique', 'Classique', 'Roques, prise en passant et promotion, comme aux échecs.']],
    temps: [30, 60, 90, 120], tempsDefaut: 90 },
  othello: { nom: 'Othello', image: 'othello', texte: 'Encadre et retourne les pions adverses.', page: 'duel-othello',
    variantes: [['classique', 'Classique 8 × 8', 'Encadre des pions adverses pour les retourner. Le plus de pions à la fin gagne.']],
    temps: [15, 30, 60], tempsDefaut: 30 },
  pfc: { nom: 'Pierre-feuille-ciseaux', image: 'pfc', texte: 'Un geste caché, révélé en même temps.', page: 'duel-pfc',
    variantes: [['classique', 'Classique', 'La pierre bat les ciseaux, les ciseaux battent la feuille, la feuille bat la pierre. Égalité : on relance.']],
    temps: [15, 30, 60], tempsDefaut: 30 },
};
/** Vrai si le membre voit les jeux en développement : admin, et pas en mode « voir comme ». */
export const peutVoirJeuxDev = () => !!getCachedProfile()?.is_admin && !viewAsActive();
/**
 * Jeux proposés à ce membre : un jeu avec une page d'accès (j.page) n'apparaît que si cette page lui est ouverte.
 * j.dev = vrai tant que la page est en mode « admin » (pastille « En développement »).
 */
export function jeuxVisibles() {
  return Object.fromEntries(Object.entries(JEUX)
    .filter(([, j]) => !j.page || (canAccess(j.page) && !!pageLabel(j.page)))
    .map(([k, j]) => [k, j.page ? { ...j, dev: pageMode(j.page) === 'admin' } : j]));
}
/** Flotte de la Bataille navale (le serveur la renvoie aussi dans etat.bataille.flotte). */
export const FLOTTE = [
  { type: 'porte_avions', nom: 'Porte-avions', longueur: 5 },
  { type: 'cuirasse', nom: 'Cuirassé', longueur: 4 },
  { type: 'croiseur', nom: 'Croiseur', longueur: 3 },
  { type: 'sous_marin', nom: 'Sous-marin', longueur: 3 },
  { type: 'torpilleur', nom: 'Torpilleur', longueur: 2 },
];
/** Nom d'une case de la Bataille navale (0 → A1, 99 → J10). */
export const nomCase = (c) => `${String.fromCharCode(65 + (c % 10))}${Math.floor(c / 10) + 1}`;
/** Couleurs du Mastermind (lettre du serveur → nom, couleur désaturée, lettre du mode daltonien). */
export const COULEURS_MM = [
  { c: 'r', nom: 'Rouge', hex: '#C4574B', lettre: 'R' },
  { c: 'o', nom: 'Orange', hex: '#D08A3E', lettre: 'O' },
  { c: 'y', nom: 'Jaune', hex: '#D4B54A', lettre: 'J' },
  { c: 'g', nom: 'Vert', hex: '#4F9A6A', lettre: 'V' },
  { c: 'b', nom: 'Bleu', hex: '#4E73C4', lettre: 'B' },
  { c: 'p', nom: 'Violet', hex: '#8466B8', lettre: 'P' },
];
/** Niveaux du robot. */
export const ROBOTS = [[1, 'Facile'], [2, 'Moyen'], [3, 'Difficile']];

const salon = creerSalon({
  prefixe: 'hg_duel', canal: 'duel', etiquette: '[duels]', libelle: 'le duel',
  secours: { membre: 3000, invite: 2000 },
  // Échéance à faire respecter : le tour (grille), ou l'échéance personnelle la plus proche (Mastermind), seulement si je joue.
  echeance: (dernier) => {
    if (!dernier?.moi?.joue) return null;
    const p = dernier.partie;
    if (!p || p.statut !== 'en_cours') return null;
    const fin = p.tour_fin || (dernier.joueurs || []).map((j) => j.fin).filter(Boolean).sort()[0] || null;
    return fin ? { fin, cle: `${p.version}` } : null;
  },
});
const { rpc, rpcInvite, deux, commun } = salon;

/** Appels des duels (noms calqués sur les fonctions serveur, voir la migration 122). */
export const duel = Object.assign(commun, {
  /** p : {jeu, variante, adversaire: 'membre'|'code'|'robot', membre, robot (1-3), commence: 'moi'|'lui'|'hasard',
   *  format (1|3|5), t_coup, visibilite: 'publique'|'privee', invites, codes: 'choisis'|'hasard'} → code. */
  async creer(p) {
    const code = await rpc('hg_duel_creer', { p });
    if (p?.adversaire === 'membre') notify('duel_defi', { code }).catch(() => {});
    return code;
  },
  /** Refuse un défi reçu (en attente). */
  refuser: (code) => rpc('hg_duel_refuser', { p_code: code }),
  /** Coups jouables pour le membre connecté, quand c'est son tour (Othello : [cases] ; Dames : [chemins] ; Échecs : [{de, a, promo}]). */
  possibles: deux((code) => rpc('hg_duel_possibles', { p_code: code }), async () => []),
  /** coup : colonne (Puissance 4) ou case (Morpion ; Ultime 0 à 80) ; action : 'pose' ou 'retire' (Pop Out). */
  jouer: deux((code, coup, action = 'pose') => rpc('hg_duel_jouer', { p_code: code, p_coup: coup, p_action: action }),
    (code, coup, action = 'pose') => rpcInvite('jouer', code, { coup, action })),
  /** Mastermind : le code que l'adversaire devra percer (4 lettres parmi r o y g b p). */
  codeSecret: deux((code, secret) => rpc('hg_duel_code_secret', { p_code: code, p_secret: secret }), (code, secret) => rpcInvite('code', code, { secret })),
  /** Mastermind : un essai (4 lettres parmi r o y g b p). */
  essayer: deux((code, essai) => rpc('hg_duel_essayer', { p_code: code, p_essai: essai }), (code, essai) => rpcInvite('essayer', code, { essai })),
  /* Bataille navale */
  /** Pose ma flotte : [{type, cases:[0..99]}] (phase 'placement'). */
  placer: deux((code, navires) => rpc('hg_duel_placer', { p_code: code, p_navires: navires }), (code, navires) => rpcInvite('placer', code, { navires })),
  /** Proposition de flotte au hasard (non enregistrée) : [{type, cases}]. */
  flotteHasard: deux((code) => rpc('hg_duel_flotte_hasard', { p_code: code }), (code) => rpcInvite('flotte_hasard', code)),
  /** Un tir → 'eau' | 'touche' | 'coule'. */
  tirer: deux((code, c) => rpc('hg_duel_tirer', { p_code: code, p_case: c }), (code, c) => rpcInvite('tirer', code, { case: c })),
  /** Radar (une fois par manche, remplace le tir du tour) → nombre de cases de navire dans le carré 3 × 3. */
  radar: deux((code, c) => rpc('hg_duel_radar', { p_code: code, p_case: c }), (code, c) => rpcInvite('radar', code, { case: c })),
  /* Qui est-ce ? */
  /** Question toute prête → true (oui) ou false (non), réponse immédiate ; le tour passe. */
  question: deux((code, cle, valeur) => rpc('hg_duel_question', { p_code: code, p_cle: cle, p_valeur: valeur }),
    (code, cle, valeur) => rpcInvite('question', code, { cle, valeur })),
  /** Question libre (4-140 caractères) : l'adversaire répond oui ou non. */
  questionLibre: deux((code, texte) => rpc('hg_duel_question_libre', { p_code: code, p_texte: texte }), (code, texte) => rpcInvite('question_libre', code, { texte })),
  /** Réponse à la question libre qui m'attend. */
  repondre: deux((code, oui) => rpc('hg_duel_repondre', { p_code: code, p_oui: !!oui }), (code, oui) => rpcInvite('repondre', code, { oui: !!oui })),
  /** « Je pense que c'est… » → true (manche gagnée) ou false (manche perdue). */
  deviner: deux((code, perso) => rpc('hg_duel_deviner', { p_code: code, p_perso: perso }), (code, perso) => rpcInvite('deviner', code, { perso })),
  /** Mes personnages baissés (aide-mémoire gardé côté serveur). */
  baisser: deux((code, persos) => rpc('hg_duel_baisser', { p_code: code, p_persos: persos }), (code, persos) => rpcInvite('baisser', code, { persos })),
  /** Personnages du plateau et questions toutes prêtes : {persos:[{id, prenom, attributs}], questions:[{cle, valeur, texte}]}. */
  plateau: deux((code, plateau = 'quartier') => rpc('hg_duel_plateau', { p_plateau: plateau }), (code) => rpcInvite('plateau', code)),
  message: deux((code, texte) => rpc('hg_duel_message', { p_code: code, p_texte: texte }), (code, texte) => rpcInvite('message', code, { texte })),
  /** Revanche ; contre un membre, c'est un nouveau défi (MP du bot). */
  async rejouer(code) {
    const suite = await rpc('hg_duel_rejouer', { p_code: code });
    notify('duel_defi', { code: suite }).catch(() => {});
    return suite;
  },
  accueil: () => rpc('hg_duel_accueil'),
  membres: () => rpc('hg_duel_membres'),
  stats: (user = null, jeu = null) => rpc('hg_duel_stats', { p_user: user, p_jeu: jeu }),
  jour: () => rpc('hg_duel_jour'),
  jourEssayer: (essai) => rpc('hg_duel_jour_essayer', { p_essai: essai }),
});

export const { erreurTexte, activerInvite, estInvite, jetonInvite, messages, suivrePartie } = salon;
