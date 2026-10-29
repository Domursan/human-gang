// ===== Humane Gang — Jeux à salon : accès commun aux données (créer, rejoindre, temps réel, mode invité) =====
/*
 * Rôle : la partie commune de l'api.js de chaque jeu multijoueur (Uno, Loup-Garou, Codenames, Duels, Jeux de plateau).
 * Chaque jeu appelle creerSalon() avec son préfixe de fonctions serveur (hg_uno, hg_lg, hg_ndc, hg_duel, hg_plat) et
 * garde ses propres appels de jeu. Les écrans n'appellent jamais sb directement.
 * Mode invité : un visiteur sans compte joue avec un jeton secret gardé dans son navigateur ;
 *   tous ses appels passent par la fonction serveur <préfixe>_invite (pas de temps réel : relecture régulière).
 * Dépendances : core.js (sb, errMsg).
 * Exporte : creerSalon, erreurTexte.
 */
import { sb, errMsg } from './core.js';

/** Message d'erreur lisible (les fonctions du jeu renvoient déjà des phrases en français). */
export function erreurTexte(e) {
  const m = e?.message || String(e || '');
  if (/permission denied|42501/i.test(m)) return 'Accès réservé.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Connexion perdue. Réessaie dans un instant.';
  return m || errMsg(e) || 'Erreur inconnue.';
}

/**
 * Crée l'accès commun à un jeu à salon.
 * @param {object} c configuration du jeu :
 *   prefixe        'hg_uno' : préfixe des fonctions serveur (<prefixe>_creer…) et des tables (<prefixe>_parties, <prefixe>_messages)
 *   canal          'uno' : nom du canal temps réel (uno:<id de la partie>)
 *   etiquette      '[uno]' : préfixe des avertissements dans la console
 *   libelle        « la partie » (ou « le duel ») : fin du message « Impossible de rejoindre … »
 *   tablesSupp     tables écoutées en plus (lignes des joueurs, pour le Loup-Garou)
 *   secours        délai de relecture de secours en ms : { membre, invite, abonne } ; « abonne » sert quand le temps
 *                  réel est branché (la relecture ne sert alors qu'en filet de sécurité : moins de charge serveur)
 *   delaiAvance    retard (ms, négatif = avant) avant de demander au serveur l'avance d'une échéance
 *   champFin       champ de la partie qui porte l'échéance du tour (tour_fin, ou phase_fin)
 *   restePause     vrai si la partie peut afficher un temps figé (pause_reste)
 *   maintenant     (etat) => date ISO de l'horloge serveur
 *   changement     (dernier, etat) => vrai si l'écran doit être redessiné
 *   echeance       (dernier) => { fin, cle } de la prochaine échéance à faire respecter, ou null
 *   transformerMessage (msg, dernier) => message tel qu'il est transmis à l'écran
 *   messages       (partieId, depuisId, code) => messages ; par défaut la fonction serveur <prefixe>_messages
 * @returns {object} accès du jeu : commun (appels communs, à compléter par le jeu), rpc, rpcInvite, deux, messages,
 *   suivrePartie, activerInvite, estInvite, jetonInvite, erreurTexte.
 */
export function creerSalon({
  prefixe, canal, etiquette, libelle = 'la partie', tablesSupp = [],
  secours = { membre: 4000, invite: 2000, abonne: 15000 }, delaiAvance = -500, champFin = 'tour_fin', restePause = false,
  maintenant = (e) => e?.maintenant,
  changement = (dernier, e) => !dernier || dernier.partie?.version !== e?.partie?.version || dernier.partie?.statut !== e?.partie?.statut,
  echeance = (dernier) => {
    const p = dernier?.partie;
    if (!p?.[champFin] || p.statut !== 'en_cours') return null;
    return { fin: p[champFin], cle: `${p.version}` };
  },
  transformerMessage = (m) => m,
} = {}) {
  let invite = false;
  /** Active le mode invité (visiteur sans compte), appelé par la page au démarrage. */
  const activerInvite = (oui) => { invite = !!oui; };
  /** Vrai si le visiteur joue en invité. */
  const estInvite = () => invite;

  const CLE_JETON = (code) => `${prefixe}_invite:${String(code || '').toUpperCase()}`;
  /** Jeton d'invité pour une partie (null si absent ou stockage indisponible). */
  const jetonInvite = (code) => { try { return localStorage.getItem(CLE_JETON(code)); } catch { return null; } };
  const garderJeton = (code, jeton) => { try { localStorage.setItem(CLE_JETON(code), jeton); } catch { /* navigation privée stricte */ } };
  const oublierJeton = (code) => { try { localStorage.removeItem(CLE_JETON(code)); } catch { /* sans effet */ } };

  /** Appel d'une fonction serveur ; lève une Error avec un message lisible. */
  async function rpc(nom, args = {}) {
    const { data, error } = await sb.rpc(nom, args);
    if (error) throw new Error(erreurTexte(error));
    return data;
  }
  /** Appel invité : action de jeu au nom du jeton de cette partie. */
  const rpcInvite = (action, code, args = {}) =>
    rpc(`${prefixe}_invite`, { p_action: action, p_code: code, p_jeton: jetonInvite(code), p_args: args });
  /** Aiguille vers l'appel membre ou l'appel invité. */
  const deux = (membre, inv) => (...a) => (invite ? inv(...a) : membre(...a));

  /**
   * Appels communs. Le jeu les complète ou les remplace (Object.assign sur commun) ;
   * suivrePartie passe toujours par commun.etat et commun.avancer.
   */
  const commun = {
    creer: (p) => rpc(`${prefixe}_creer`, { p }),
    rejoindre: (code) => rpc(`${prefixe}_rejoindre`, { p_code: code }),
    /** Aperçu public d'une partie (sans compte) ou null. */
    apercu: (code) => rpc(`${prefixe}_invite`, { p_action: 'apercu', p_code: code }),
    /** Invité : rejoint avec un pseudo, garde le jeton dans le navigateur, renvoie le code. */
    async rejoindreInvite(code, pseudo) {
      const r = await rpc(`${prefixe}_invite`, { p_action: 'rejoindre', p_code: code, p_args: { pseudo } });
      if (!r?.jeton) throw new Error(`Impossible de rejoindre ${libelle}.`);
      garderJeton(r.code || code, r.jeton);
      return r.code || code;
    },
    oublierInvite: (code) => oublierJeton(code),
    quitter: deux((code) => rpc(`${prefixe}_quitter`, { p_code: code }),
      async (code) => { await rpcInvite('quitter', code); oublierJeton(code); }),
    pret: deux((code, pret) => rpc(`${prefixe}_pret`, { p_code: code, p_pret: pret }),
      (code, pret) => rpcInvite('pret', code, { pret })),
    exclure: (code, user) => rpc(`${prefixe}_exclure`, { p_code: code, p_user: user }),
    lancer: (code) => rpc(`${prefixe}_lancer`, { p_code: code }),
    etat: deux((code) => rpc(`${prefixe}_etat`, { p_code: code }), (code) => rpcInvite('etat', code)),
    avancer: deux((code) => rpc(`${prefixe}_avancer`, { p_code: code }), (code) => rpcInvite('avancer', code)),
    /** Revanche : nouvelle partie → code. */
    rejouer: (code) => rpc(`${prefixe}_rejouer`, { p_code: code }),
    publiques: () => rpc(`${prefixe}_publiques`),
    mesParties: () => rpc(`${prefixe}_mes_parties`),
    stats: (user = null) => rpc(`${prefixe}_stats`, { p_user: user }),
    adminReglages: () => rpc(`${prefixe}_admin_reglages`),
    adminEnregistrer: (p) => rpc(`${prefixe}_admin_enregistrer`, { p }),
    adminArreter: (code) => rpc(`${prefixe}_admin_arreter`, { p_code: code }),
  };

  /** Messages du chat d'une partie (après l'id donné), du plus ancien au plus récent. */
  async function messages(partieId, depuisId = 0, code = null) {
    if (invite) {
      const tous = await rpcInvite('messages', code, depuisId ? { apres: depuisId } : {});
      return (tous || []).filter((m) => m.id > depuisId).sort((a, b) => a.id - b.id);
    }
    return (await rpc(`${prefixe}_messages`, { p_partie: partieId, p_apres: depuisId })) || [];
  }

  /**
   * Suit une partie : appelle onEtat(etat) à chaque changement, onMessage(msg) à chaque nouveau message.
   * Temps réel (ligne de la partie, lignes des joueurs, messages) et relecture de secours régulière
 * (toutes les 4 s sans temps réel, toutes les 15 s quand le canal est branché).
   * Quand une échéance est dépassée, demande au serveur d'avancer (il vérifie lui-même).
   * @returns {{ arreter: Function, rafraichir: Function, etat: Function, secondesRestantes: Function, decalage: Function }}
   */
  function suivrePartie(code, { onEtat, onMessage, onErreur } = {}) {
    let actif = true;
    let dernier = null;           // dernier état reçu
    let enCours = null;           // relecture en cours
    let relire = false;           // une relecture a été demandée pendant la précédente
    let canalTr = null;           // canal temps réel
    let decalage = 0;             // horloge serveur - horloge locale (ms)
    let avanceDemandee = '';      // évite de demander deux fois l'avance pour la même échéance
    let abonne = false;           // canal temps réel branché (SUBSCRIBED)
    let derniereLecture = 0;      // instant (Date.now) de la dernière relecture lancée
    let attente = null;           // regroupe les signaux temps réel rapprochés en une seule relecture

    let suivante = null;          // relecture demandée pendant une autre : promesse résolue quand elle est faite
    const rafraichir = async () => {
      if (!actif) return;
      // Une lecture lancée avant la demande peut être périmée : on attend la relecture qui suit.
      if (enCours) {
        relire = true;
        if (!suivante) {
          suivante = enCours.then(() => new Promise((ok) => { setTimeout(() => ok(enCours || null), 0); })).then((p) => p);
        }
        return suivante;
      }
      derniereLecture = Date.now();
      enCours = (async () => {
        try {
          const e = await commun.etat(code);
          if (!actif) return;
          const m = maintenant(e);
          if (m) decalage = new Date(m).getTime() - Date.now();
          const change = changement(dernier, e);
          dernier = e;
          if (change) onEtat?.(e);
          abonner(e);
        } catch (err) {
          onErreur?.(err);
        } finally {
          enCours = null;
          suivante = null;
          if (relire && actif) { relire = false; rafraichir(); }
        }
      })();
      return enCours;
    };

    /** Signal temps réel : plusieurs lignes changent souvent ensemble (partie + joueurs) : une seule relecture. */
    const signal = () => {
      if (attente) return;
      attente = setTimeout(() => { attente = null; rafraichir(); }, 120);
    };

    const abonner = (e) => {
      const id = e?.partie?.id;
      if (!id || canalTr || invite) return;   // invité : pas de temps réel, la relecture suffit
      try {
        let c = sb.channel(`${canal}:${id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: `${prefixe}_parties`, filter: `id=eq.${id}` }, signal);
        for (const table of tablesSupp) {
          c = c.on('postgres_changes', { event: '*', schema: 'public', table, filter: `partie=eq.${id}` }, signal);
        }
        c = c.on('postgres_changes', { event: 'INSERT', schema: 'public', table: `${prefixe}_messages`, filter: `partie=eq.${id}` },
          (p) => onMessage?.(transformerMessage(p.new, dernier)));
        canalTr = c.subscribe((statut) => {
          const avant = abonne;
          abonne = statut === 'SUBSCRIBED';
          if (abonne && !avant) rafraichir();   // rien manqué pendant le branchement
        });
      } catch (err) {
        console.warn(`${etiquette} temps réel indisponible`, err);
      }
    };

    // Échéance dépassée : demande l'avance au serveur, une seule fois par échéance.
    const minuteur = setInterval(() => {
      if (!actif || document.hidden) return;
      const ech = echeance(dernier);
      if (!ech) return;
      const reste = new Date(ech.fin).getTime() - (Date.now() + decalage);
      if (reste <= delaiAvance && avanceDemandee !== ech.cle) {
        avanceDemandee = ech.cle;
        commun.avancer(code).then(rafraichir).catch(() => {});
      }
    }, 1000);
    const delai = invite ? secours.invite : secours.membre;
    // Relecture de secours : rapide sans temps réel (invité, canal coupé), espacée quand le canal est branché.
    const relecture = setInterval(() => {
      if (!actif || document.hidden) return;
      if (abonne && Date.now() - derniereLecture < (secours.abonne ?? 15000)) return;
      rafraichir();
    }, delai);
    const visible = () => { if (!document.hidden) rafraichir(); };
    document.addEventListener('visibilitychange', visible);

    rafraichir();
    return {
      arreter() {
        actif = false;
        clearInterval(minuteur); clearInterval(relecture); clearTimeout(attente);
        document.removeEventListener('visibilitychange', visible);
        if (canalTr) { try { sb.removeChannel(canalTr); } catch { /* sans effet */ } }
      },
      rafraichir,
      etat: () => dernier,
      /** Secondes restantes avant l'échéance (heure du serveur), ou null. Temps figé si la partie est en pause. */
      secondesRestantes(fin) {
        const p = dernier?.partie;
        if (restePause && p?.pause_reste != null) return p.pause_reste;
        const f = fin || p?.[champFin];
        if (!f) return null;
        return Math.max(0, Math.ceil((new Date(f).getTime() - (Date.now() + decalage)) / 1000));
      },
      /** Décalage horloge serveur - horloge locale (ms). */
      decalage: () => decalage,
    };
  }

  return { commun, rpc, rpcInvite, deux, messages, suivrePartie, activerInvite, estInvite, jetonInvite, erreurTexte };
}
