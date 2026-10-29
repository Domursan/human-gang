// ===== Humane Gang — Shadow Hunters : effets visuels et sons (plateaux/jeux/shadow/effets.js) =====
/*
 * Rôle : ajoute à la table de Shadow Hunters les effets de la maquette « vrais écrans », déclenchés par les vrais changements
 * entre deux états (jamais à l'ouverture de la page, ni en rechargeant un état déjà vu) :
 *   - « à toi » : mon médaillon pulse, le panneau « Ton tour » et ses boutons d'action se mettent en valeur (le son « Pièce
 *     arcade » et le titre d'onglet viennent déjà de commun/tour-signal.js : ils ne sont pas repris ici) ;
 *   - dés : le son des dés ; le total pulse et le cadre du jet se met en valeur (les faces qui roulent sont déjà animées par table.js) ;
 *   - blessure (PV qui baissent) : le joueur touché secoue et « −N PV » (N = blessures reçues) s'affiche au-dessus de son médaillon ;
 *   - attaque ratée (ligne « Raté ! » du journal, migration 127) : tampon « RATÉ » sur l'attaquant, son seul ;
 *   - carte Vision reçue : l'œil se retourne et le bouton « Appliquer » pulse ;
 *   - victoire : bandeau « Victoire ! » et confettis, sur l'écran de fin (voir jouerVictoire, appelé par fin.js). La victoire
 *     ne se joue que si cette page a suivi la partie en cours : un écran de fin ouvert plus tard reste silencieux.
 * Mouvement réduit (body.plat-calme ou prefers-reduced-motion) : pas d'animation, les sons restent. Chaque animation dure moins
 * de 3 s ; les éléments ajoutés au body ne captent aucun clic et sont retirés ; les minuteries sont annulées à detruire().
 * Dépendances : commun/sons-jeux.js (jouerSonJeu, sons 'shadow-hunters' 1 à 5) ; styles : ../../shadow.css (classes sh-anim-*).
 *   table.js appelle maj() après chaque rendu ; fin.js appelle jouerVictoire() à chaque rendu de son encart.
 * Exporte : creerEffets(table) -> { maj(etat, monId), detruire() } ; jouerVictoire(etat).
 */
import { jouerSonJeu } from '../../../../commun/sons-jeux.js';

const JEU = 'shadow-hunters';
/** Numéros des sons sur la maquette (sons-jeux.js). */
const SON = { des: 1, vision: 2, blessure: 3, rate: 4, victoire: 5 };
const DUREE_TOUR = 2400;          // ms : pulsation « à toi » (2 × 1,2 s)
const DUREE_SURLIGNE = 2600;      // ms : panneau et cadre du jet (2 × 1,3 s)
const DUREE_SECOUE = 1200;        // ms : secousse du joueur touché (2 × 0,6 s)
const DUREE_OEIL = 1000;          // ms : œil de la carte Vision
const DUREE_SANG = 1600;          // ms : « −N PV » qui monte
const DUREE_RATE = 2200;          // ms : tampon « RATÉ »
const DUREE_BANC = 2600;          // ms : bandeau de victoire
const DELAI_SANG = 350;           // ms : le « −N PV » sort après la secousse
const DELAI_TOTAL = 1000;         // ms : le total pulse quand les dés s'arrêtent (table.js : 1 s)
const CONFETTIS = 60;
const COULEURS = ['#FE3104', '#FCA301', '#FBD32D', '#159946', '#2B5AE2', '#4E2398', '#E2C77E'];
/** Ligne du journal d'une attaque sans blessure (« Raté ! », migration 127). */
const RE_RATE = /^Raté/;

/** Mouvement réduit : préférence du membre (body.plat-calme) ou réglage du système. */
const mouvementOk = () => !document.body.classList.contains('plat-calme')
  && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Parties vues en cours sur cette page : seule leur fin peut jouer la victoire. */
const vuesEnCours = new Set();
/** Parties dont la victoire a déjà été jouée sur cette page. */
const victoiresJouees = new Set();

/** Ce que les effets comparent d'un état à l'autre. */
function photo(e, monId) {
  const j = e.jeu || {};
  return {
    degats: new Map((e.joueurs || []).map((x) => [x.user_id, x.etat?.degats ?? 0])),
    des: JSON.stringify(j.des ?? null),
    moiTour: !!monId && e.partie?.tour === monId && e.partie?.statut === 'en_cours',
    vision: monId && j.phase === 'vision' && j.vision?.pour === monId ? `${j.vision.de}|${j.vision.carte}` : null,
  };
}

/**
 * Effets de la table de Shadow Hunters.
 * @param {HTMLElement} table élément racine de la table (.sh-table) : ses médaillons, son panneau et son jet sont relus à chaque appel.
 * @returns {{ maj: (etat: object, monId: string|null) => void, detruire: () => void }}
 */
export function creerEffets(table) {
  const minuteries = new Set();
  const ajouts = new Set();          // éléments ajoutés au body (-PV, RATÉ), retirés à detruire()
  const journalVu = new Set();
  let prime = false;                 // premier état reçu
  let avant = null;                  // ce que montrait l'état précédent

  /** Lance fn après ms, en gardant la minuterie pour l'annuler au detruire(). */
  function differer(ms, fn) {
    const t = setTimeout(() => { minuteries.delete(t); fn(); }, ms);
    minuteries.add(t);
  }

  /** Pose une classe d'animation, puis la retire à la fin. */
  function animer(el, classe, ms) {
    el.classList.add(classe);
    differer(ms, () => el.classList.remove(classe));
  }

  /** Élément d'affichage ponctuel au body, à la position (x, y) de la fenêtre. */
  function flottant(classe, html, ms, x, y) {
    const d = document.createElement('div');
    d.className = classe;
    d.setAttribute('aria-hidden', 'true');
    d.innerHTML = html;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    document.body.append(d);
    ajouts.add(d);
    differer(ms, () => { d.remove(); ajouts.delete(d); });
  }

  /** Médaillon d'un joueur (sélecteur d'après son identifiant). */
  const medaillon = (uid) => (uid ? table.querySelector(`.sh-med[data-uid="${CSS.escape(String(uid))}"]`) : null);

  /** Tour à moi : mon médaillon pulse, le panneau se surligne, ses boutons d'action pulsent. */
  function aToi(uid) {
    const cadre = medaillon(uid)?.querySelector('.sh-med-cadre');
    if (cadre) animer(cadre, 'sh-anim-joue', DUREE_TOUR);
    const panneau = table.querySelector('.sh-panneau');
    if (panneau) animer(panneau, 'sh-anim-surligne', DUREE_SURLIGNE);
    table.querySelectorAll('.sh-panneau .sh-btn-primary:not(:disabled), .sh-panneau .sh-btn-outline:not(:disabled)')
      .forEach((b) => animer(b, 'sh-anim-joue', DUREE_TOUR));
  }

  /** Dés : le total pulse et le cadre du jet se met en valeur, une fois les dés arrêtés. */
  function jetRoule() {
    const jet = table.querySelector('.sh-rond-jet');
    if (jet) animer(jet, 'sh-anim-surligne', DUREE_SURLIGNE);
    differer(DELAI_TOTAL, () => {
      const total = table.querySelector('.sh-jet [data-total]');
      if (total) animer(total, 'sh-anim-total', 500);
    });
  }

  /** Blessure : le joueur touché secoue et « −N PV » monte au-dessus de son médaillon. */
  function secouer(uid, n) {
    const med = medaillon(uid);
    if (!med) return;
    const cadre = med.querySelector('.sh-med-cadre');
    if (cadre) animer(cadre, 'sh-anim-secoue', DUREE_SECOUE);
    differer(DELAI_SANG, () => {
      const r = med.getBoundingClientRect();
      flottant('sh-anim-sang', `−${n} PV`, DUREE_SANG, r.left + r.width / 2, r.top);
    });
  }

  /** Attaque ratée : tampon « RATÉ » sur l'attaquant (ou sur le joueur dont c'est le tour). */
  function rater(uid) {
    const med = medaillon(uid) || table.querySelector('.sh-med.is-tour');
    if (!med) return;
    const r = med.getBoundingClientRect();
    flottant('sh-anim-rate', 'RATÉ', DUREE_RATE, r.left + r.width / 2, r.top + r.height / 2);
  }

  /** Carte Vision reçue : l'œil se retourne, « Appliquer » pulse. */
  function visionRecue() {
    const oeil = table.querySelector('.sh-vision-oeil');
    if (oeil) animer(oeil, 'sh-anim-oeil', DUREE_OEIL);
    const appliquer = table.querySelector('.sh-modale-boite [data-act="repondre"][data-mentir="false"]');
    if (appliquer) animer(appliquer, 'sh-anim-joue', DUREE_TOUR);
  }

  return {
    /**
     * Compare l'état à l'état précédent et lance les effets des vrais changements.
     * @param {object} etat état de la partie (plat.etat).
     * @param {string|null} monId identifiant de mon joueur (null pour un spectateur).
     */
    maj(etat, monId) {
      if (!etat?.partie) return;
      if (etat.partie.statut === 'en_cours' && etat.partie.id) vuesEnCours.add(etat.partie.id);
      const maint = photo(etat, monId);

      if (!prime) {
        prime = true;
        avant = maint;
        (etat.journal || []).forEach((l) => journalVu.add(l.id));
        return;
      }

      const anime = mouvementOk();

      /* Mon tour (nouveau tour seulement). */
      if (anime && maint.moiTour && !avant.moiTour) aToi(monId);

      /* Dés : le son à chaque nouveau jet. */
      if (maint.des !== avant.des && etat.jeu?.des) {
        jouerSonJeu(JEU, SON.des);
        if (anime) jetRoule();
      }

      /* Blessures : PV qui baissent. */
      const blesses = [];
      for (const j of etat.joueurs || []) {
        if (!avant.degats.has(j.user_id)) continue;
        const n = (j.etat?.degats ?? 0) - avant.degats.get(j.user_id);
        if (n > 0) blesses.push({ uid: j.user_id, n });
      }
      if (blesses.length) {
        jouerSonJeu(JEU, SON.blessure);
        if (anime) blesses.forEach(({ uid, n }) => secouer(uid, n));
      }

      /* Journal : attaque ratée (lignes jamais lues seulement). */
      const nouvelles = (etat.journal || []).filter((l) => !journalVu.has(l.id));
      nouvelles.forEach((l) => journalVu.add(l.id));
      const rate = nouvelles.find((l) => RE_RATE.test(l.texte || ''));
      if (rate) {
        jouerSonJeu(JEU, SON.rate);
        if (anime) rater(rate.user_id);
      }

      /* Carte Vision pour moi : nouvelle carte seulement. */
      if (maint.vision && maint.vision !== avant.vision) {
        jouerSonJeu(JEU, SON.vision);
        if (anime) visionRecue();
      }

      avant = maint;
    },

    /** Annule les minuteries et retire les éléments ajoutés (la table est quittée). */
    detruire() {
      minuteries.forEach((t) => clearTimeout(t));
      minuteries.clear();
      ajouts.forEach((d) => d.remove());
      ajouts.clear();
    },
  };
}

/**
 * Victoire : bandeau « Victoire ! » et confettis, joués une seule fois par partie, et seulement si la page a vu la partie
 * en cours. Appelé à chaque rendu de l'encart de fin (fin.js) : sans effet si la partie n'est pas terminée.
 * @param {object} etat état de la partie.
 */
export function jouerVictoire(etat) {
  const p = etat?.partie;
  if (!p?.id || p.statut !== 'terminee') return;
  if (!vuesEnCours.has(p.id) || victoiresJouees.has(p.id)) return;
  victoiresJouees.add(p.id);
  jouerSonJeu(JEU, SON.victoire);
  if (!mouvementOk()) return;

  const banc = document.createElement('div');
  banc.className = 'sh-anim-banc';
  banc.setAttribute('aria-hidden', 'true');
  banc.innerHTML = 'Victoire !<small>Les Shadows, ou les Hunters, l’emportent</small>';
  document.body.append(banc);
  setTimeout(() => banc.remove(), DUREE_BANC + 100);

  for (let i = 0; i < CONFETTIS; i++) {
    const c = document.createElement('i');
    c.className = 'sh-anim-conf';
    c.setAttribute('aria-hidden', 'true');
    c.style.left = `${(Math.random() * 100).toFixed(1)}vw`;
    c.style.background = COULEURS[i % COULEURS.length];
    c.style.animationDuration = `${(1.2 + Math.random()).toFixed(2)}s`;
    c.style.animationDelay = `${(Math.random() * 0.4).toFixed(2)}s`;
    document.body.append(c);
    setTimeout(() => c.remove(), 2800);
  }
}
