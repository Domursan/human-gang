// ===== Humane Gang — Blackjack : effets visuels et sons (plateaux/jeux/blackjack/effets.js) =====
/*
 * Rôle : ajoute à la table les effets de la maquette « vrais écrans », déclenchés par les vrais changements entre deux états :
 *   - « à toi » : mon siège pulse, une pastille « À toi » s'affiche, le panneau d'action est surligné (le son « Pièce arcade »
 *     et le titre d'onglet viennent déjà de commun/tour-signal.js : ils ne sont pas repris ici) ;
 *   - cartes nouvelles (distribuées) : elles glissent une par une, dans l'ordre des sièges puis la banque ;
 *   - carte cachée de la banque : elle se retourne quand elle est révélée. Le serveur règle la banque et lance la manche
 *     suivante dans la même opération : la carte révélée n'apparaît donc pas dans un état à part. Le retournement part de
 *     la ligne du journal « La banque retourne 7 ♠ … » (migration 151) et d'un calque de la banque tel qu'il était avant ;
 *   - règlement d'une manche (lignes « gagne N jetons » / « perd N jetons » du journal) : les jetons perdus vont vers la
 *     banque, ceux gagnés viennent de la banque, le gagnant pulse ;
 *   - banque qui saute (ligne « elle saute ») : son seul.
 *   Le premier état reçu n'anime rien, et une ligne de journal déjà lue ne rejoue jamais. Mouvement réduit (body.plat-calme) :
 *   pas d'animation, les sons restent. Les classes sont retirées après leur durée (moins de 3 s), les jetons retirés,
 *   les minuteries annulées à detruire().
 * Dépendances : commun/sons-jeux.js (jouerSonJeu, sons 'blackjack' 1 à 5) ; ../cartes.js (carteHtml) ; styles : ../../blackjack.css
 *   (classes bj-anim-*). Les sièges portent data-joueur (plateau.js) ; table.js appelle maj() après chaque rendu.
 * Exporte : creerEffets(tapis, panneau) -> { maj(etat, monId), detruire() }.
 */
import { jouerSonJeu } from '../../../../commun/sons-jeux.js';
import { carteHtml } from '../cartes.js';

const JEU = 'blackjack';
const CACHEE = '??';                  // carte cachée de la banque, telle qu'envoyée par le serveur
/** Ligne du journal qui révèle la carte cachée : « La banque retourne 7 ♠ (12), … » (migration 151). */
const RE_RETOURNE = /^La banque retourne (As|Roi|Dame|Valet|10|[2-9]) ([♠♥♦♣])/;
const VALEUR = { As: 'A', Roi: 'K', Dame: 'Q', Valet: 'J', 10: 'T' };
const COULEUR = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };
const DUREE_MOITIE = 400;             // ms : la carte se ferme, puis s'ouvre sur sa face
const DUREE_FANTOME = 1300;           // ms : le calque de la banque disparaît ensuite
const ECART = 0.22;                   // délai entre deux cartes distribuées (s)
const ECART_MAX = 2;                  // au-delà, les cartes se resserrent : le total reste sous 3 s
const DUREE_DISTRIB = 0.55;           // durée du glissement d'une carte (s)
const DUREE_RETOURNE = 800;           // durée du retournement (ms)
const DUREE_GAGNE = 2400;             // durée de la pulsation du gagnant (ms)
const DUREE_TOUR = 2400;              // durée de la pulsation « à toi » (ms)
const DUREE_PUCE = 5000;              // durée d'affichage de la pastille « À toi » (ms)
const DUREE_JETON = 1400;             // durée du trajet d'un jeton (ms)
const RE_GAGNE = /\bgagne \d+ jetons\.$/;
const RE_PERD = /\bperd \d+ jetons\.$/;
const RE_SAUTE = /^La banque .*elle saute/;

/** Sélecteur d'un siège d'après son identifiant (uuid). */
const sel = (uid) => `[data-joueur="${String(uid).replace(/"/g, '')}"]`;

/** Cartes (éléments .cd) d'une zone de cartes, dans l'ordre d'affichage. */
const enfants = (zone) => (zone ? [...zone.children].filter((c) => c.classList.contains('cd')) : []);

/** Centre d'un élément, en coordonnées de la fenêtre. */
function centre(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Copie des cartes de la banque et de chaque main (clé « uid#rang »), pour repérer ce qui change. */
function instantane(etat) {
  const mains = new Map();
  (etat.joueurs || []).forEach((j) => (j.etat?.mains || []).forEach((m, i) => {
    mains.set(`${j.user_id}#${i}`, Array.isArray(m.cartes) ? m.cartes.slice() : []);
  }));
  const banque = Array.isArray(etat.jeu?.banque) ? etat.jeu.banque.slice() : [];
  return { banque, mains };
}

/**
 * Compare les cartes d'avant et d'après pour une zone.
 * Une carte nouvelle glisse ; une carte cachée devenue visible se retourne.
 * @returns {{ distrib: HTMLElement[], retour: HTMLElement[] }}
 */
function changements(avant = [], apres = [], elements = []) {
  const distrib = [];
  const retour = [];
  apres.forEach((c, i) => {
    const el = elements[i];
    if (!el || avant[i] === c) return;
    if (avant[i] === CACHEE && c !== CACHEE) retour.push(el);
    else distrib.push(el);
  });
  return { distrib, retour };
}

/**
 * Effets de la table de blackjack.
 * @param {HTMLElement} tapis conteneur du tapis (data-tapis) : ses sièges et la banque sont relus à chaque appel.
 * @param {HTMLElement} panneau panneau d'action (son cadre est surligné au tour de jeu).
 * @returns {{ maj: (etat: object, monId: string|null) => void, detruire: () => void }}
 */
export function creerEffets(tapis, panneau) {
  const minuteries = new Set();
  const jetonsEnVol = new Set();
  const calques = new Set();         // calques de la banque (carte qui se retourne)
  const journalVu = new Set();
  let prime = false;                 // premier état reçu
  let avant = null;                  // instantané de l'état précédent
  let tourAvant = null;              // clé du tour précédent

  /** Lance fn après ms, en gardant la minuterie pour l'annuler au détruire(). */
  function differer(ms, fn) {
    const t = setTimeout(() => { minuteries.delete(t); fn(); }, ms);
    minuteries.add(t);
  }

  /** Mouvement réduit demandé par le membre (plat-calme) : pas d'animation. */
  const mouvementOk = () => !document.body.classList.contains('plat-calme');

  /** Pose une classe d'animation, puis la retire à la fin. */
  function animer(el, classe, ms) {
    el.classList.add(classe);
    differer(ms, () => el.classList.remove(classe));
  }

  /** Les cartes nouvelles glissent une par une (délai en CSS via --bj-delai). */
  function distribuer(elements) {
    const pas = Math.min(ECART, ECART_MAX / Math.max(1, elements.length));
    elements.forEach((el, k) => {
      el.style.setProperty('--bj-delai', `${(k * pas).toFixed(2)}s`);
      animer(el, 'bj-anim-distrib', (k * pas + DUREE_DISTRIB) * 1000 + 100);
    });
  }

  /** Trois jetons partent de depuis et glissent jusqu'à vers (position fixe, hors du tapis). */
  function jetons(depuis, vers) {
    const a = centre(depuis);
    const b = centre(vers);
    for (let i = 0; i < 3; i++) {
      const j = document.createElement('span');
      j.className = 'bj-anim-jeton';
      j.setAttribute('aria-hidden', 'true');
      j.style.left = `${a.x - 11 + i * 6}px`;
      j.style.top = `${a.y - 11}px`;
      document.body.append(j);
      jetonsEnVol.add(j);
      differer(150 + i * 120, () => {
        j.style.transform = `translate(${b.x - a.x + i * 6}px, ${b.y - a.y}px)`;
        j.style.opacity = '0';
      });
      differer(DUREE_JETON, () => { j.remove(); jetonsEnVol.delete(j); });
    }
  }

  /**
   * Retourne la carte cachée de la banque : un calque de la banque tel qu'il était avant le règlement (carte cachée en
   * dos), qui se ferme puis s'ouvre sur la carte révélée (code « 7S », « AH »…), puis disparaît.
   */
  function retournerBanque(banqueAvant, code) {
    const zone = tapis.querySelector('.bj-cartes-banque');
    const rang = banqueAvant.indexOf(CACHEE);
    if (!zone || rang < 0) return;
    const r = zone.getBoundingClientRect();
    const calque = zone.cloneNode(false);
    calque.classList.add('bj-anim-calque');
    calque.setAttribute('aria-hidden', 'true');
    calque.style.left = `${r.left}px`;
    calque.style.top = `${r.top}px`;
    calque.style.width = `${r.width}px`;
    calque.style.height = `${r.height}px`;
    calque.innerHTML = banqueAvant.map((c) => carteHtml(c)).join('');
    document.body.append(calque);
    calques.add(calque);
    const dos = calque.children[rang];
    if (dos) {
      dos.classList.add('bj-anim-ferme');
      differer(DUREE_MOITIE, () => {
        const modele = document.createElement('div');
        modele.innerHTML = carteHtml(code);
        const face = modele.firstElementChild;
        face.classList.add('bj-anim-ouvre');
        dos.replaceWith(face);
      });
    }
    differer(DUREE_FANTOME, () => { calque.remove(); calques.delete(calque); });
  }

  /** Tour à moi : siège qui pulse, pastille « À toi », panneau surligné. */
  function aToi(uid) {
    const siege = tapis.querySelector(sel(uid));
    if (siege) {
      siege.classList.add('bj-anim-a-toi');
      const puce = document.createElement('span');
      puce.className = 'bj-anim-puce';
      puce.setAttribute('aria-hidden', 'true');
      puce.textContent = 'À toi';
      siege.append(puce);
      animer(siege, 'bj-anim-pouls', DUREE_TOUR + 200);
      differer(DUREE_PUCE, () => { puce.remove(); siege.classList.remove('bj-anim-a-toi'); });
    }
    if (panneau) animer(panneau, 'bj-anim-panneau', DUREE_TOUR + 200);
  }

  return {
    /**
     * Compare l'état à l'état précédent et lance les effets des vrais changements.
     * @param {object} etat état de la partie (plat.etat).
     * @param {string|null} monId identifiant de mon joueur (null pour un spectateur).
     */
    maj(etat, monId) {
      if (!etat?.partie) return;
      const journal = Array.isArray(etat.journal) ? etat.journal : [];
      const tour = monId && etat.jeu?.actif === monId ? `${etat.jeu.phase}|${etat.jeu.main ?? 0}|${monId}` : null;
      const maintenant = instantane(etat);

      if (!prime) {
        prime = true;
        avant = maintenant;
        tourAvant = tour;
        journal.forEach((l) => journalVu.add(l.id));
        return;
      }

      const anime = mouvementOk();

      /* Cartes : sièges puis banque (ordre de distribution). */
      const distrib = [];
      const retour = [];
      for (const [cle, cartes] of maintenant.mains) {
        const [uid, rang] = cle.split('#');
        const main = tapis.querySelectorAll(`${sel(uid)} .bj-mains > .bj-main`)[Number(rang)];
        const c = changements(avant.mains.get(cle), cartes, enfants(main?.querySelector('.bj-cartes')));
        distrib.push(...c.distrib);
        retour.push(...c.retour);
      }
      const banque = changements(avant.banque, maintenant.banque, enfants(tapis.querySelector('.bj-cartes-banque')));
      distrib.push(...banque.distrib);
      retour.push(...banque.retour);

      if (anime) {
        distribuer(distrib);
        retour.forEach((el) => animer(el, 'bj-anim-retourne', DUREE_RETOURNE + 200));
      }
      if (distrib.length) jouerSonJeu(JEU, 1);

      /* Règlement : lignes du journal jamais lues. */
      const nouvelles = journal.filter((l) => !journalVu.has(l.id));
      nouvelles.forEach((l) => journalVu.add(l.id));
      const gagnants = nouvelles.filter((l) => RE_GAGNE.test(l.texte || '')).map((l) => l.user_id);
      const perdants = nouvelles.filter((l) => RE_PERD.test(l.texte || '')).map((l) => l.user_id);
      const banqueSaute = nouvelles.some((l) => RE_SAUTE.test(l.texte || ''));
      const revelee = nouvelles.map((l) => RE_RETOURNE.exec(l.texte || '')).find(Boolean);
      const codeRevele = revelee ? `${VALEUR[revelee[1]] || revelee[1]}${COULEUR[revelee[2]]}` : null;
      if (anime && codeRevele && !retour.length) retournerBanque(avant.banque, codeRevele);
      if (retour.length || codeRevele) jouerSonJeu(JEU, 2);
      const siegeDe = (uid) => tapis.querySelector(sel(uid));
      const laBanque = tapis.querySelector('.bj-banque');

      if (anime && laBanque) {
        perdants.forEach((uid) => { const s = siegeDe(uid); if (s) jetons(s, laBanque); });
        gagnants.forEach((uid) => { const s = siegeDe(uid); if (s) jetons(laBanque, s); });
      }
      if (gagnants.length || perdants.length) jouerSonJeu(JEU, 3);
      if (anime) {
        gagnants.forEach((uid) => { const s = siegeDe(uid); if (s) animer(s, 'bj-anim-gagne', DUREE_GAGNE + 200); });
      }
      if (gagnants.length) differer(300, () => jouerSonJeu(JEU, 4));
      if (banqueSaute) jouerSonJeu(JEU, 5);

      /* Mon tour (nouveau tour seulement). */
      if (anime && tour && tour !== tourAvant) aToi(monId);

      avant = maintenant;
      tourAvant = tour;
    },

    /** Annule les minuteries et retire les jetons en vol (la table est quittée). */
    detruire() {
      minuteries.forEach((t) => clearTimeout(t));
      minuteries.clear();
      jetonsEnVol.forEach((j) => j.remove());
      jetonsEnVol.clear();
      calques.forEach((c) => c.remove());
      calques.clear();
    },
  };
}
