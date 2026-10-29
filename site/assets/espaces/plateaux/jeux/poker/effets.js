// ===== Humane Gang — Poker : effets visuels et sons des changements de partie (plateaux/jeux/poker/effets.js) =====
/*
 * Rôle : compare l'état précédent et le nouveau, et joue les effets de la maquette validée sur les VRAIS changements :
 *   - « à toi de parler » : mon siège pulse avec la pastille « À toi », le panneau d'action s'éclaire
 *     (le son et le titre d'onglet viennent de commun/tour-signal.js, non dupliqués ici) ;
 *   - flop, turn, river : les cartes communes nouvelles se retournent une à une (son « carte posée ») ;
 *   - changement de tour de mise : les mises glissent vers le pot (son « jetons »), le pot pulse ;
 *   - fin de main : le pot pulse et va au(x) gagnant(s) (son « pot gagné ») ;
 *   - un joueur passe la parole (son « parole ») ou joue tapis (son « tapis »).
 *   table.js reconstruit le tapis à chaque changement : les classes d'effet sont donc reposées sur le DOM neuf, avec le
 *   temps déjà écoulé (délai négatif), pour que l'animation continue sans repartir. Les jetons volent dans un calque
 *   à part, qui n'est pas reconstruit. Rien ne se joue au premier état reçu. Avec les animations coupées (préférence ou
 *   mouvement réduit), seuls les sons restent. Tout est nettoyé (minuteurs, calque) à la sortie.
 * Dépendances : commun/core.js (motionAllowed), commun/sons-jeux.js (jouerSonJeu, jeu « poker »).
 * Exporte : creerEffets(racine, { monTour }) -> { maj(avant, apres), detruire() }.
 *   racine : l'élément <section class="pk-table">. monTour(etat) : c'est mon tour dans cet état ?
 *   avant : état précédent (null au premier état) ; apres : nouvel état (même forme que plat.etat).
 */
import { motionAllowed } from '../../../../commun/core.js';
import { jouerSonJeu } from '../../../../commun/sons-jeux.js';

const JEU = 'poker';
/** Numéros des sons (voir commun/sons-jeux.js, jeu « poker »). */
const SON = { carte: 1, jetons: 2, parole: 3, gagne: 4, tapis: 5 };
const DELAI_CARTE = 350;   // ms entre deux cartes communes qui se retournent
const DUREE_CARTE = 700;   // ms pour retourner une carte
const DUREE_TOUR = 4800;   // pulsation du siège (4 allers-retours de 1,2 s)
const DUREE_PANNEAU = 4000;
const DUREE_POT = 2800;    // pulsation du pot (2 × 1,4 s)
const DELAI_POT = 1400;    // le pot pulse une fois les mises arrivées
const DUREE_JETON = 900;   // trajet d'un jeton (ms)
const MOITIE_JETON = 10;   // px : moitié de la taille d'un jeton (voir poker.css, .pk-jeton-vol)

/**
 * @param {HTMLElement} racine élément <section class="pk-table"> (les effets y sont posés).
 * @param {{ monTour: (etat: object) => boolean }} ctx
 * @returns {{ maj: (avant: object|null, apres: object) => void, detruire: () => void }}
 */
export function creerEffets(racine, { monTour }) {
  /** Effets en cours : { sel, classe, debut, delai, duree, puce }. */
  const actifs = new Set();
  /** Minuteurs en attente, annulés à la sortie. */
  const minuteurs = new Set();

  const calque = document.createElement('div');
  calque.className = 'pk-calque';
  calque.setAttribute('aria-hidden', 'true');
  racine.append(calque);

  /** Programme une action dans delai ms (suivie, pour l'annuler à la sortie). */
  function plus(action, delai) {
    const id = setTimeout(() => { minuteurs.delete(id); action(); }, Math.max(0, delai));
    minuteurs.add(id);
  }

  /** Joue un son de la maquette (les sons ne dépendent pas de l'animation). */
  const son = (n) => jouerSonJeu(JEU, n);

  /** Siège d'un joueur, par son identifiant (attribut data-uid posé par plateau.js). */
  const siege = (uid) => racine.querySelector(`.pk-siege[data-uid="${CSS.escape(String(uid))}"]`);
  const pot = () => racine.querySelector('.pk-pot');

  /** Centre d'un élément, dans le repère du calque. */
  function centre(n) {
    const cal = calque.getBoundingClientRect();
    const r = n.getBoundingClientRect();
    return { x: r.left - cal.left + r.width / 2 - MOITIE_JETON, y: r.top - cal.top + r.height / 2 - MOITIE_JETON };
  }

  /**
   * Pose la classe de l'effet sur les éléments visés, avec le temps déjà écoulé :
   * avant son délai, l'animation attend ; ensuite elle reprend au point où elle en est.
   */
  function appliquer(e) {
    const t = performance.now() - e.debut;
    if (t >= e.delai + e.duree) return;
    e.sel(racine).forEach((n) => {
      n.classList.add(e.classe);
      n.style.animationDelay = `${t < e.delai ? e.delai - t : -(t - e.delai)}ms`;
      if (e.puce && !n.querySelector(':scope > .pk-puce')) {
        const p = document.createElement('span');
        p.className = 'pk-puce';
        p.textContent = e.puce;
        n.append(p);
      }
    });
  }

  /** Retire l'effet : classes, délai inline et bulle. */
  function retirer(e) {
    actifs.delete(e);
    e.sel(racine).forEach((n) => {
      n.classList.remove(e.classe);
      n.style.animationDelay = '';
      n.querySelector(':scope > .pk-puce')?.remove();
    });
  }

  /** Lance un effet (sauf si les animations sont coupées). */
  function lancer({ sel, classe, delai = 0, duree, puce = null }) {
    if (!motionAllowed()) return;
    const e = { sel, classe, delai, duree, puce, debut: performance.now() };
    actifs.add(e);
    appliquer(e);
    plus(() => retirer(e), delai + duree);
  }

  /** Un jeton qui part de `de()` et va à `vers()`, après `delai` ms (les éléments sont lus au départ). */
  function jeton(de, vers, delai) {
    if (!motionAllowed()) return;
    plus(() => {
      const a0 = de(), b0 = vers();
      if (!a0 || !b0) return;
      const a = centre(a0), b = centre(b0);
      const j = document.createElement('span');
      j.className = 'pk-jeton-vol';
      j.style.left = `${a.x}px`;
      j.style.top = `${a.y}px`;
      calque.append(j);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        j.style.transform = `translate(${b.x - a.x}px, ${b.y - a.y}px) scale(.8)`;
        j.style.opacity = '.2';
      }));
      plus(() => j.remove(), DUREE_JETON + 50);
    }, delai);
  }

  /** Repose tous les effets en cours sur le DOM courant (après chaque reconstruction du tapis). */
  function appliquerTout() {
    actifs.forEach((e) => appliquer(e));
  }

  /** « À toi de parler » : mon siège pulse avec sa pastille, le panneau s'éclaire. */
  function tour(avant, apres) {
    if (!monTour(apres) || monTour(avant) || apres.partie?.statut !== 'en_cours') return;
    lancer({ sel: (r) => [...r.querySelectorAll('.pk-siege.is-moi')], classe: 'pk-joue', duree: DUREE_TOUR, puce: 'À toi' });
    lancer({ sel: (r) => [r.querySelector('.pk-panneau')].filter(Boolean), classe: 'pk-joue', duree: DUREE_PANNEAU });
  }

  /** Cartes communes nouvelles (flop, turn, river) : elles se retournent une à une, son « carte posée ». */
  function cartes(a, b) {
    const la = (a.jeu?.board || []).length;
    const lb = (b.jeu?.board || []).length;
    for (let i = la; i < lb; i++) {
      const delai = (i - la) * DELAI_CARTE;
      lancer({ sel: (r) => [...r.querySelectorAll('.pk-board > *')].slice(i, i + 1), classe: 'pk-tourne', delai, duree: DUREE_CARTE });
      plus(() => son(SON.carte), delai);
    }
  }

  /** Changement de tour de mise : les mises posées glissent vers le pot, le pot pulse. */
  function mises(a, b) {
    const posees = (a.joueurs || []).filter((j) => !j.parti && Number(j.etat?.mise) > 0);
    if (!posees.length) return;
    plus(() => son(SON.jetons), 200);
    posees.slice(0, 6).forEach((j, k) => jeton(() => siege(j.user_id), pot, 200 + k * 220));
    lancer({ sel: (r) => [r.querySelector('.pk-pot')].filter(Boolean), classe: 'pk-pot-pulse', delai: DELAI_POT, duree: DUREE_POT });
  }

  /**
   * Fin de main (le numéro de main a changé) : le pot part vers les gagnants, qui ont gagné des jetons
   * (jetons + mise, pour ne pas compter les blindes postées à la main suivante).
   */
  function gain(a, b) {
    const pot0 = Number(a.jeu?.pot) || 0;
    if (pot0 <= 0) return;
    const avant = new Map((a.joueurs || []).map((j) => [j.user_id, (Number(j.etat?.jetons) || 0) + (Number(j.etat?.mise) || 0)]));
    const gagnants = (b.joueurs || []).filter((j) => avant.has(j.user_id)
      && (Number(j.etat?.jetons) || 0) + (Number(j.etat?.mise) || 0) > avant.get(j.user_id)).map((j) => j.user_id);
    if (!gagnants.length) return;
    son(SON.gagne);
    lancer({ sel: (r) => [r.querySelector('.pk-pot')].filter(Boolean), classe: 'pk-pot-pulse', duree: DUREE_POT });
    gagnants.slice(0, 4).forEach((uid, k) => jeton(pot, () => siege(uid), 200 + k * 200));
  }

  /** Parole (check) et tapis (all-in) : un son par joueur qui passe à l'action. */
  function actions(a, b) {
    (b.joueurs || []).forEach((j) => {
      const av = (a.joueurs || []).find((x) => x.user_id === j.user_id)?.etat || {};
      const ap = j.etat || {};
      if (ap.action === 'parole' && av.action !== 'parole') son(SON.parole);
      if (ap.tapis && !av.tapis) son(SON.tapis);
    });
  }

  return {
    /**
     * Détecte les changements entre avant et apres, lance les effets et les sons, puis repose les effets en cours
     * sur le tapis reconstruit. À appeler après le rendu, à chaque nouvel état.
     */
    maj(avant, apres) {
      if (avant && apres?.partie) {
        const ja = avant.jeu || {};
        const jb = apres.jeu || {};
        if (ja.main === jb.main) {
          cartes(avant, apres);
          if (ja.phase !== jb.phase) mises(avant, apres);
        } else {
          gain(avant, apres);
        }
        tour(avant, apres);
        actions(avant, apres);
      }
      appliquerTout();
    },
    /** Annule les minuteurs et retire le calque (sortie de la table). */
    detruire() {
      minuteurs.forEach((id) => clearTimeout(id));
      minuteurs.clear();
      actifs.clear();
      calque.remove();
    },
  };
}
