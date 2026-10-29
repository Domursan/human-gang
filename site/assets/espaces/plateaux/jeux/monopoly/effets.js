// ===== Humane Gang — Monopoly : effets visuels et sons (plateaux/jeux/monopoly/effets.js) =====
/*
 * Rôle : ajoute au Monopoly les effets de la maquette « vrais écrans », déclenchés par les vrais changements entre deux états :
 *   - « à toi » : au début de mon tour, mon bandeau et mon étiquette pulsent, le bouton principal et le panneau du tour sont
 *     surlignés (le son « Pièce arcade » et le titre d'onglet viennent déjà de commun/tour-signal.js : ils ne sont pas repris ici) ;
 *   - dés : chaque nouveau lancer joue le son « dés qui roulent » (le roulement lui-même est dans table.js) ; le pion attend la
 *     fin du roulement, puis avance case après case : chaque case atteinte s'éclaire et fait son petit son (caseAtteinte(),
 *     appelé par table.js à chaque pas du pion) ;
 *   - achat d'un terrain par moi : les billets se soulèvent, « − prix » s'affiche au-dessus de l'argent et le montant descend ;
 *   - prison : quand un joueur y entre, la case Prison s'éclaire en rouge (son « Prison ») ; si c'est mon tour et que je suis en
 *     prison, les trois choix (Payer, carte de sortie, Lancer les dés) sont mis en valeur ;
 *   - fin de partie : bandeau et confettis sur l'écran de classement, géré par ./fin.js. La table signale seulement, à sa
 *     fermeture, qu'elle quitte une partie en cours (sortieDeTable) : une fin qui suit tout de suite est alors « en direct ».
 *   Le premier état reçu n'anime rien, et un état déjà vu ne rejoue rien. Mouvement réduit (body.plat-calme ou
 *   prefers-reduced-motion) : pas d'animation, les sons restent. Les classes sont retirées après leur durée (moins de 3 s),
 *   les minuteries et le compteur d'argent annulés à detruire().
 * Dépendances : commun/sons-jeux.js (jouerSonJeu, sons 'monopoly' 1 à 5) ; styles : ../../monopoly.css (classes mo-anim-*, mo-moins).
 *   table.js appelle maj() après chaque rendu (dans un try/catch), caseAtteinte() à chaque pas du pion, detruire() en quittant.
 * Exporte : creerEffets(table) -> { maj(etat, monId), caseAtteinte(n), detruire() } ; mouvementOk() ; sortieDeTable(id) ;
 *   finEnDirect(id) (utilisé par fin.js).
 */
import { jouerSonJeu } from '../../../../commun/sons-jeux.js';

const JEU = 'monopoly';
const REDUIT = '(prefers-reduced-motion: reduce)';
const DUREE_TOUR = 2400;             // ms : deux pulsations de 1,2 s
const DUREE_CADRE = 2400;            // ms : panneau du tour surligné
const DUREE_CASE = 500;              // ms : case atteinte par le pion
const DUREE_PRISON = 2400;           // ms : case Prison en rouge
const DUREE_BILLET = 1500;           // ms : billets soulevés (3 allers-retours)
const DUREE_MOINS = 1600;            // ms : « − prix » qui monte
const DELAI_COMPTE = 500;            // ms : le montant reste à l'ancienne valeur avant de descendre
const DUREE_COMPTE = 900;            // ms : descente du montant
const DELAI_SORTIE_MS = 5000;        // ms : au-delà, la fin n'est plus « en direct »

const euros = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} €`;

/** Mouvement réduit demandé par le membre (plat-calme) ou par le système : pas d'animation. */
export function mouvementOk() {
  return !document.body.classList.contains('plat-calme') && !window.matchMedia(REDUIT).matches;
}

/* ---------- Passage de la table à l'écran de fin ---------- */

let sortie = null;                   // { id, t } : la table vient de quitter une partie en cours

/** Appelé par la table à sa fermeture, quand la partie était encore en cours. */
export function sortieDeTable(id) {
  sortie = { id, t: Date.now() };
}

/**
 * Vrai si l'écran de fin de cette partie fait suite, en direct, à la table qui vient de se fermer.
 * Consommé : un seul écran de fin en profite.
 */
export function finEnDirect(id) {
  const ok = !!sortie && !!id && sortie.id === id && Date.now() - sortie.t < DELAI_SORTIE_MS;
  sortie = null;
  return ok;
}

/* ---------- Instantané : ce qui compte pour les effets ---------- */

/**
 * Copie de ce que les effets comparent d'un état à l'autre : partie, tour, dés, propriétaires, prisons, mon argent.
 * @param {object} etat état de la partie.
 * @param {string|null} monId identifiant de mon joueur (null pour un spectateur).
 */
function instantane(etat, monId) {
  const j = etat.jeu || {};
  const joueurs = etat.joueurs || [];
  const moi = joueurs.find((x) => x.user_id === monId) || null;
  const proprietes = {};
  Object.entries(j.proprietes || {}).forEach(([c, p]) => { proprietes[c] = p?.proprio ?? null; });
  const prisons = {};
  joueurs.forEach((x) => { prisons[x.user_id] = !!x.etat?.prison; });
  return {
    partie: etat.partie?.id ?? null,
    statut: etat.partie?.statut ?? null,
    actif: j.actif ?? null,
    des: JSON.stringify(j.des ?? null),
    proprietes,
    prisons,
    argent: moi ? Number(moi.etat?.argent) : null,
    prisonMoi: !!moi?.etat?.prison,
  };
}

/**
 * Effets du Monopoly.
 * @param {HTMLElement} table élément racine de la table (.mo-table) : toutes les zones sont relues à chaque appel.
 * @returns {{ maj: (etat: object, monId: string|null) => void, caseAtteinte: (n: number) => void, detruire: () => void }}
 */
export function creerEffets(table) {
  const minuteries = new Set();
  let prime = false;                 // premier état reçu
  let avant = null;                  // instantané de l'état précédent
  let animCompte = null;             // requête d'image du compteur d'argent

  /** Lance fn après ms, en gardant la minuterie pour l'annuler au detruire(). */
  function differer(ms, fn) {
    const t = setTimeout(() => { minuteries.delete(t); fn(); }, ms);
    minuteries.add(t);
  }

  /** Pose une classe d'animation, puis la retire à la fin. */
  function animer(el, classe, ms) {
    if (!el) return;
    el.classList.add(classe);
    differer(ms, () => el.classList.remove(classe));
  }

  /** Mon tour commence : mon bandeau et mon étiquette pulsent, le bouton principal et le panneau sont surlignés. */
  function aToi() {
    animer(table.querySelector('.plat-bandeau-joueur.is-tour'), 'mo-anim-pouls', DUREE_TOUR);
    animer(table.querySelector('.plat-bandeau-joueur.is-tour .plat-etiquette'), 'mo-anim-pouls', DUREE_TOUR);
    const panneau = table.querySelector('[data-panneau]');
    animer(panneau?.querySelector('.mo-btn-primary'), 'mo-anim-pouls', DUREE_TOUR);
    animer(panneau, 'mo-anim-cadre', DUREE_CADRE);
  }

  /** Dans la prison avec mon tour : les trois choix sont mis en valeur. */
  function choixPrison() {
    const panneau = table.querySelector('[data-panneau]');
    if (!panneau) return;
    panneau.querySelectorAll('[data-act="payer_prison"], [data-act="carte_prison"], [data-act="lancer"]')
      .forEach((b) => animer(b, 'mo-anim-pouls', DUREE_TOUR));
    animer(panneau, 'mo-anim-cadre', DUREE_CADRE);
  }

  /** Un joueur entre en prison : la case Prison s'éclaire, son. */
  function entreePrison() {
    table.querySelectorAll('.mo-type-prison').forEach((c) => animer(c, 'mo-anim-prison', DUREE_PRISON));
    jouerSonJeu(JEU, 4);
  }

  /** Mes billets se soulèvent, « − prix » s'affiche et le montant descend de l'ancienne à la nouvelle valeur. */
  function achatMoi(de, a) {
    table.querySelectorAll('.mo-billet').forEach((b) => animer(b, 'mo-anim-billet', DUREE_BILLET));
    const argent = table.querySelector('.mo-argent');
    const montant = table.querySelector('.mo-argent-montant');
    if (!argent || !montant) return;
    const cout = de - a;
    const moins = document.createElement('span');
    moins.className = 'mo-moins';
    moins.setAttribute('aria-hidden', 'true');
    moins.textContent = `−${euros(cout)}`;
    argent.append(moins);
    differer(DUREE_MOINS, () => moins.remove());
    montant.textContent = euros(de);
    differer(DELAI_COMPTE, () => {
      const t0 = performance.now();
      const pas = (t) => {
        const k = Math.min(1, (t - t0) / DUREE_COMPTE);
        montant.textContent = euros(Math.round(de - cout * k));
        animCompte = k < 1 ? requestAnimationFrame(pas) : null;
      };
      animCompte = requestAnimationFrame(pas);
    });
  }

  return {
    /**
     * Compare l'état à l'état précédent et lance les effets des vrais changements.
     * @param {object} etat état de la partie (plat.etat).
     * @param {string|null} monId identifiant de mon joueur (null pour un spectateur).
     */
    maj(etat, monId) {
      if (!etat?.partie) return;
      const ici = instantane(etat, monId);
      if (!prime) {
        prime = true;
        avant = ici;
        return;
      }
      const anime = mouvementOk();

      /* Dés : un nouveau lancer (son ; le roulement et le retard du pion sont dans table.js). */
      if (ici.des !== avant.des && etat.jeu?.des) jouerSonJeu(JEU, 1);

      /* Mon tour commence (le joueur actif devient moi). */
      const monTourDebut = !!monId && ici.actif === monId && avant.actif !== monId;
      if (anime && monTourDebut) aToi();

      /* Prison : un joueur y entre ; si c'est mon tour et que je suis en prison, les choix sont mis en valeur. */
      (etat.joueurs || []).forEach((x) => {
        if (x.etat?.prison && !avant.prisons[x.user_id]) entreePrison();
      });
      if (anime && monId && ici.actif === monId && ici.prisonMoi && (monTourDebut || !avant.prisonMoi)) choixPrison();

      /* Achat : un terrain qui change de propriétaire vers moi. */
      const achatMoiCe = !!monId && Object.entries(etat.jeu?.proprietes || {})
        .some(([c, p]) => p?.proprio === monId && avant.proprietes[c] !== monId);
      if (achatMoiCe) {
        jouerSonJeu(JEU, 3);
        if (anime && ici.argent != null && avant.argent != null && ici.argent < avant.argent) {
          achatMoi(avant.argent, ici.argent);
        } else if (anime) {
          table.querySelectorAll('.mo-billet').forEach((b) => animer(b, 'mo-anim-billet', DUREE_BILLET));
        }
      }

      avant = ici;
    },

    /** Le pion arrive sur la case n : la case s'éclaire, petit son « pion posé ». */
    caseAtteinte(n) {
      jouerSonJeu(JEU, 2);
      if (!mouvementOk()) return;
      animer(table.querySelector(`[data-case="${Number(n)}"]`), 'mo-anim-case', DUREE_CASE);
    },

    /** Annule les minuteries et le compteur ; garde la trace de la partie en cours pour l'écran de fin. */
    detruire() {
      minuteries.forEach((t) => clearTimeout(t));
      minuteries.clear();
      if (animCompte) cancelAnimationFrame(animCompte);
      animCompte = null;
      if (avant?.statut === 'en_cours' && avant.partie) sortieDeTable(avant.partie);
      table.querySelectorAll('.mo-moins').forEach((m) => m.remove());
    },
  };
}
