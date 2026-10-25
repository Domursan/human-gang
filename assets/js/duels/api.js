// ===== Humane Gang — Duels : accès aux données (fonctions serveur hg_duel_*, temps réel) =====
/*
 * Rôle : seul point de contact avec Supabase pour les duels. Les écrans n'appellent jamais sb directement.
 * Toute la logique de jeu est côté serveur (migration 122) : ici on envoie des intentions et on relit l'état.
 * Mode invité : un visiteur sans compte joue avec un jeton secret gardé dans son navigateur ;
 *   tous ses appels passent par hg_duel_invite (pas de temps réel : relecture toutes les 2 s).
 * Défi à un membre (création ou revanche) : le bot lui envoie un MP (hg-notify, duel_defi), sans bloquer l'écran.
 * Dépendances : core.js (sb, errMsg, notify).
 * Exporte : duel (appels), suivrePartie, messages, erreurTexte, activerInvite, estInvite, jetonInvite,
 *   JEUX (noms et réglages des jeux), COULEURS_MM (couleurs du Mastermind).
 */
import { sb, errMsg, notify } from '../core.js';

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
    variantes: [['paleto', 'Les habitants de Paleto', '24 personnages, des questions toutes prêtes ou libres.']],
    temps: [60, 90, 120], tempsDefaut: 90 },
};
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

/* ---------- Mode invité ---------- */
let invite = false;
/** Active le mode invité (visiteur sans compte), appelé par la page au démarrage. */
export function activerInvite(oui) { invite = !!oui; }
/** Vrai si le visiteur joue en invité. */
export function estInvite() { return invite; }
const CLE_JETON = (code) => `hg_duel_invite:${String(code || '').toUpperCase()}`;
/** Jeton d'invité pour un duel (null si absent ou stockage indisponible). */
export function jetonInvite(code) { try { return localStorage.getItem(CLE_JETON(code)); } catch { return null; } }
function garderJeton(code, jeton) { try { localStorage.setItem(CLE_JETON(code), jeton); } catch { /* navigation privée stricte */ } }
function oublierJeton(code) { try { localStorage.removeItem(CLE_JETON(code)); } catch { /* sans effet */ } }

/** Appel d'une fonction serveur ; lève une Error avec un message lisible. */
async function rpc(nom, args = {}) {
  const { data, error } = await sb.rpc(nom, args);
  if (error) throw new Error(erreurTexte(error));
  return data;
}
/** Appel invité : action de jeu au nom du jeton de ce duel. */
const rpcInvite = (action, code, args = {}) =>
  rpc('hg_duel_invite', { p_action: action, p_code: code, p_jeton: jetonInvite(code), p_args: args });
/** Aiguille vers l'appel membre ou l'appel invité. */
const deux = (membre, inv) => (...a) => (invite ? inv(...a) : membre(...a));

/** Message d'erreur lisible (les fonctions du jeu renvoient déjà des phrases en français). */
export function erreurTexte(e) {
  const m = e?.message || String(e || '');
  if (/permission denied|42501/i.test(m)) return 'Accès réservé.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Connexion perdue. Réessaie dans un instant.';
  return m || errMsg(e) || 'Erreur inconnue.';
}

/** Appels des duels (noms calqués sur les fonctions serveur, voir la migration 122). */
export const duel = {
  /** p : {jeu, variante, adversaire: 'membre'|'code'|'robot', membre, robot (1-3), commence: 'moi'|'lui'|'hasard',
   *  format (1|3|5), t_coup, visibilite: 'publique'|'privee', invites, codes: 'choisis'|'hasard'} → code. */
  async creer(p) {
    const code = await rpc('hg_duel_creer', { p });
    if (p?.adversaire === 'membre') notify('duel_defi', { code }).catch(() => {});
    return code;
  },
  rejoindre: (code) => rpc('hg_duel_rejoindre', { p_code: code }),
  refuser: (code) => rpc('hg_duel_refuser', { p_code: code }),
  /** Aperçu public d'un duel (sans compte) ou null. */
  apercu: (code) => rpc('hg_duel_invite', { p_action: 'apercu', p_code: code }),
  /** Invité : rejoint avec un pseudo, garde le jeton dans le navigateur, renvoie le code. */
  async rejoindreInvite(code, pseudo) {
    const r = await rpc('hg_duel_invite', { p_action: 'rejoindre', p_code: code, p_args: { pseudo } });
    if (!r?.jeton) throw new Error('Impossible de rejoindre le duel.');
    garderJeton(r.code || code, r.jeton);
    return r.code || code;
  },
  oublierInvite: (code) => oublierJeton(code),
  /** En attente : annule ; en cours : abandon (l'adversaire gagne). */
  quitter: deux((code) => rpc('hg_duel_quitter', { p_code: code }), async (code) => { await rpcInvite('quitter', code); oublierJeton(code); }),
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
  plateau: deux((code, plateau = 'paleto') => rpc('hg_duel_plateau', { p_plateau: plateau }), (code) => rpcInvite('plateau', code)),
  message: deux((code, texte) => rpc('hg_duel_message', { p_code: code, p_texte: texte }), (code, texte) => rpcInvite('message', code, { texte })),
  avancer: deux((code) => rpc('hg_duel_avancer', { p_code: code }), (code) => rpcInvite('avancer', code)),
  etat: deux((code) => rpc('hg_duel_etat', { p_code: code }), (code) => rpcInvite('etat', code)),
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
  adminReglages: () => rpc('hg_duel_admin_reglages'),
  adminEnregistrer: (p) => rpc('hg_duel_admin_enregistrer', { p }),
  adminArreter: (code) => rpc('hg_duel_admin_arreter', { p_code: code }),
};

/** Messages du chat d'un duel (après l'id donné), triés du plus ancien au plus récent. */
export async function messages(partieId, depuisId = 0, code = null) {
  if (invite) {
    const tous = await rpcInvite('messages', code, depuisId ? { apres: depuisId } : {});
    return (tous || []).filter((m) => m.id > depuisId).sort((a, b) => a.id - b.id);
  }
  const { data, error } = await sb.rpc('hg_duel_messages', { p_partie: partieId, p_apres: depuisId });
  if (error) throw new Error(erreurTexte(error));
  return data || [];
}

/**
 * Suit un duel : appelle onEtat(etat) à chaque changement, onMessage(msg) à chaque nouveau message.
 * Temps réel (ligne du duel + messages) et relecture de secours (3 s membre, 2 s invité).
 * Quand une échéance est dépassée (tour, ou échéance personnelle au Mastermind), demande au serveur de jouer pour l'absent.
 * @returns {{ arreter: Function, rafraichir: Function, etat: Function, secondesRestantes: Function, decalage: Function }}
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
        const e = await duel.etat(code);
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
      canal = sb.channel(`duel:${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hg_duel_parties', filter: `id=eq.${id}` }, () => rafraichir())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hg_duel_messages', filter: `partie=eq.${id}` }, (p) => onMessage?.(p.new))
        .subscribe();
    } catch (err) {
      console.warn('[duels] temps réel indisponible', err);
    }
  };

  /** Prochaine échéance connue : tour (duels à grille) ou plus proche échéance d'un joueur (Mastermind). */
  const echeance = () => {
    const p = dernier?.partie;
    if (!p || p.statut !== 'en_cours') return null;
    if (p.tour_fin) return p.tour_fin;
    const fins = (dernier.joueurs || []).map((j) => j.fin).filter(Boolean).sort();
    return fins[0] || null;
  };

  const minuteur = setInterval(() => {
    if (!actif || document.hidden || !dernier?.moi?.joue) return;
    const fin = echeance();
    if (!fin) return;
    const reste = new Date(fin).getTime() - (Date.now() + decalage);
    const cle = `${dernier.partie.version}`;
    if (reste <= -500 && avanceDemandee !== cle) {
      avanceDemandee = cle;
      duel.avancer(code).then(rafraichir).catch(() => {});
    }
  }, 1000);
  const secours = setInterval(() => { if (actif && !document.hidden) rafraichir(); }, invite ? 2000 : 3000);
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
    /**
     * Secondes restantes avant une échéance (heure du serveur), ou null.
     * @param {string} [fin] échéance ISO ; par défaut celle du tour (partie.tour_fin).
     */
    secondesRestantes(fin) {
      const f = fin || dernier?.partie?.tour_fin;
      if (!f) return null;
      return Math.max(0, Math.ceil((new Date(f).getTime() - (Date.now() + decalage)) / 1000));
    },
    /** Décalage horloge serveur - horloge locale (ms). */
    decalage: () => decalage,
  };
}
