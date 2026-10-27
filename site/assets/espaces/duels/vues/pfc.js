// ===== Humane Gang — Duels : table Pierre-feuille-ciseaux (#partie/CODE, jeu pfc) =====
/*
 * Rôle : coups simultanés. Je choisis Pierre, Feuille ou Ciseaux ; mon choix reste secret tant que l'autre n'a pas joué.
 *   Le statut indique « X a choisi » dès que etat.pfc.a_choisi contient son id, sans dire quoi. Quand les deux ont choisi,
 *   le serveur ajoute le lancer à etat.pfc.lancers : la zone du dernier lancer le révèle (courte animation, coupée si
 *   prefers-reduced-motion). Égalité : le serveur relance. L'historique garde chaque lancer, du plus récent au plus ancien.
 *   Échéance personnelle (joueurs[].fin) : compte à rebours sous les gestes ; la barre du duel (vues/commun.js) affiche le même chrono.
 *   Dessins : SVG à trait (pas d'emoji). Score des manches : « Manche 4 sur 5 », « 2 – 1 ».
 * Contrat (vues/partie.js) : export function creer(root, ctx) → { maj(etat), message(msg), detruire() }, ctx = { code, naviguer, moi, suivi }.
 * Dépendances : core.js (esc, toast), ../api.js (duel, erreurTexte), ./commun.js (creerCadre).
 * Exporte : creer.
 */
import { esc, toast } from '../../../commun/core.js';
import { duel, erreurTexte } from '../api.js';
import { creerCadre } from './commun.js';

/** Durée pendant laquelle on attend l'état après un envoi réussi (ms), au cas où le temps réel tarde. */
const DUREE_ATTENTE = 5000;
/** Délai avant la révélation d'un lancer, pour laisser le temps de lire « ? » (ms, supprimé si mouvement réduit). */
const DELAI_REVELATION = 700;
/** Attributs communs des dessins (trait, pas de remplissage). */
const TRAIT = 'fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"';
/** Les trois gestes : clé envoyée au serveur, nom affiché, dessin. */
const GESTES = [
  { cle: 'pierre', nom: 'Pierre', trait: '<path d="M22 62L18 42L34 24L58 18L78 32L80 56L66 76L38 80Z"/><path d="M34 24L44 46L18 42M44 46L66 76M44 46L80 56"/>' },
  { cle: 'feuille', nom: 'Feuille', trait: '<path d="M26 12h32l14 14v58H26z"/><path d="M58 12v14h14"/><path d="M36 42h30M36 52h30M36 62h22"/>' },
  { cle: 'ciseaux', nom: 'Ciseaux', trait: '<circle cx="32" cy="68" r="11"/><circle cx="64" cy="68" r="11"/><path d="M40 60L72 12M56 60L24 12"/>' },
];
const NOM_GESTE = Object.fromEntries(GESTES.map((g) => [g.cle, g.nom]));

/** Dessin SVG à trait d'un geste (taille fixée par la feuille de style). */
const dessin = (cle) => {
  const g = GESTES.find((x) => x.cle === cle);
  return g ? `<svg class="duels-pfc-svg" viewBox="0 0 96 96" aria-hidden="true" focusable="false" ${TRAIT}>${g.trait}</svg>` : '';
};

/**
 * Monte la table Pierre-feuille-ciseaux dans root.
 * @param {HTMLElement} root conteneur de la vue (vidé par le cadre commun).
 * @param {{code: string, naviguer: Function, moi: object|null, suivi: object}} ctx contexte de vues/partie.js.
 * @returns {{maj: Function, message: Function, detruire: Function}}
 */
export function creer(root, ctx) {
  const cadre = creerCadre(root, ctx, { classe: 'duels-pfc' });
  cadre.plateau.innerHTML = `
    <div class="duels-pfc-zone">
      <div class="duels-pfc-entete">
        <p class="duels-pfc-manche" data-manche></p>
        <p class="duels-pfc-score" data-score></p>
      </div>
      <section class="duels-pfc-arene" data-arene aria-label="Dernier lancer"></section>
      <p class="duels-pfc-compte" data-compte hidden></p>
      <div class="duels-pfc-gestes" role="group" aria-label="Ton geste" data-gestes>
        ${GESTES.map((g) => `<button type="button" class="duels-pfc-geste" data-geste="${g.cle}" aria-pressed="false">
          <span class="duels-pfc-dessin" aria-hidden="true">${dessin(g.cle)}</span>
          <span class="duels-pfc-nom">${g.nom}</span></button>`).join('')}
      </div>
    </div>`;
  const q = (s) => cadre.plateau.querySelector(s);
  const el = { manche: q('[data-manche]'), score: q('[data-score]'), arene: q('[data-arene]'), compte: q('[data-compte]'), gestes: q('[data-gestes]') };

  const st = { etat: null, envoi: false, attente: false, nb: null, fin: null, timers: [] };
  const motionOk = () => typeof matchMedia !== 'function' || !matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Nom affiché d'un membre pour moi : « Toi », « Le robot » ou son pseudo. */
  const nomPour = (uid) => {
    const e = st.etat;
    if (!uid) return '';
    if (e?.moi?.user_id === uid) return 'Toi';
    const j = (e?.joueurs || []).find((x) => x.user_id === uid);
    return j?.robot ? 'Le robot' : (j?.pseudo || '?');
  };
  /** Les deux joueurs dans l'ordre de gauche à droite : moi d'abord (spectateur : place 1 puis place 2). */
  const duo = (e) => {
    const js = e.joueurs || [];
    if (e.moi?.joue) {
      const moiJ = cadre.joueurMoi(e);
      const adv = cadre.adversaire(e);
      return [moiJ, adv].filter(Boolean);
    }
    return [js.find((j) => j.place === 1), js.find((j) => j.place === 2)].filter(Boolean);
  };

  /** Envoie mon geste ; le serveur résout le lancer dès que les deux ont joué. */
  async function jouer(cle) {
    const e = st.etat;
    if (!e || st.envoi || st.attente || !e.moi?.joue || e.partie.statut !== 'en_cours' || e.pfc?.mon_choix) return;
    st.envoi = true; peindre();
    try {
      await duel.jouer(ctx.code, 0, cle);
      st.attente = true;
      st.timers.push(setTimeout(() => { st.attente = false; peindre(); }, DUREE_ATTENTE));
    } catch (err) {
      toast(erreurTexte(err), 'error');
    } finally {
      st.envoi = false;
      ctx.suivi?.rafraichir();
      peindre();
    }
  }

  /** Affiche le dernier lancer. montre = false : faces cachées (« ? ») pendant le suspense. */
  function rendreArene(l, montre) {
    const e = st.etat;
    if (!e) return;
    if (!l) {
      el.arene.innerHTML = '<p class="duels-pfc-vide">Pas encore de lancer : chacun choisit son geste.</p>';
      return;
    }
    const [gauche, droite] = duo(e);
    const face = (j, cote) => {
      const uid = j?.user_id;
      const cle = montre ? l[uid] : null;
      const titre = uid === e.moi?.user_id ? 'Toi' : (j?.robot ? 'Le robot' : esc(j?.pseudo || '?'));
      return `<div class="duels-pfc-face is-${cote}${montre ? '' : ' is-cache'}">
        <span class="duels-pfc-face-titre">${titre}</span>
        <span class="duels-pfc-face-dessin">${montre ? (dessin(cle) || '') : '<span class="duels-pfc-inconnu" aria-hidden="true">?</span>'}</span>
        <span class="duels-pfc-face-nom">${montre ? esc(NOM_GESTE[cle] || '—') : ''}</span>
      </div>`;
    };
    let resultat = '';
    if (montre) {
      if (!l.gagnant) resultat = 'Égalité : on relance.';
      else resultat = l.gagnant === e.moi?.user_id ? 'Tu gagnes ce lancer.' : `${esc(nomPour(l.gagnant))} gagne ce lancer.`;
    }
    el.arene.innerHTML = `<p class="duels-pfc-arene-titre">Manche ${esc(l.manche)} · dernier lancer</p>
      <div class="duels-pfc-cartes${montre ? ' is-revele' : ''}">
        ${face(gauche, 'gauche')}
        <span class="duels-pfc-vs" aria-hidden="true">contre</span>
        ${face(droite, 'droite')}
      </div>
      <p class="duels-pfc-resultat" aria-live="polite">${resultat}</p>`;
  }

  /** Révèle un lancer qui vient d'arriver : faces cachées un instant, puis révélées (sans délai si mouvement réduit). */
  function reveler(l) {
    if (!motionOk()) { rendreArene(l, true); return; }
    rendreArene(l, false);
    st.timers.push(setTimeout(() => { if (st.etat) rendreArene(l, true); }, DELAI_REVELATION));
  }

  /** Historique des lancers, du plus récent au plus ancien (dans la colonne latérale). */
  function rendreHistorique(lancers) {
    const ol = cadre.cote.querySelector('[data-historique]');
    if (!ol) return;
    const e = st.etat;
    const js = e.joueurs || [];
    const [j1, j2] = [js.find((j) => j.place === 1), js.find((j) => j.place === 2)];
    ol.innerHTML = lancers.length ? [...lancers].reverse().map((l) => {
      const res = l.gagnant ? `Gagnant : ${esc(nomPour(l.gagnant))}` : 'Égalité, on relance';
      return `<li><span class="duels-pfc-h-manche">Manche ${esc(l.manche)}</span>
        <span class="duels-pfc-h-duel">${esc(nomPour(j1?.user_id))} : ${esc(NOM_GESTE[l[j1?.user_id]] || '—')} · ${esc(nomPour(j2?.user_id))} : ${esc(NOM_GESTE[l[j2?.user_id]] || '—')}</span>
        <span class="duels-pfc-h-res">${res}</span></li>`;
    }).join('') : '<li class="duels-pfc-vide">Aucun lancer pour l’instant.</li>';
  }

  /** Compte à rebours de mon échéance personnelle (sous les gestes). */
  function majCompte() {
    if (!st.fin || el.compte.hidden) return;
    const reste = ctx.suivi?.secondesRestantes(st.fin);
    if (reste === null || reste === undefined) return;
    el.compte.textContent = reste <= 0
      ? 'Temps écoulé : le jeu choisit à ta place.'
      : `Il te reste ${Math.floor(reste / 60)}:${String(reste % 60).padStart(2, '0')} pour choisir.`;
  }

  /** Score des manches, manche en cours, gestes (désactivés après mon choix), statut et compte à rebours. */
  function peindre() {
    const e = st.etat;
    if (!e) return;
    const p = e.partie;
    const joue = !!e.moi?.joue;
    const enCours = p.statut === 'en_cours';
    const monChoix = e.pfc?.mon_choix ?? null;
    const adv = cadre.adversaire(e);
    const moiJ = cadre.joueurMoi(e);
    const advA = !!adv && !!e.pfc?.a_choisi?.[adv.user_id];
    const advTitre = adv?.robot ? 'Le robot' : (adv?.pseudo || 'Ton adversaire');

    el.manche.textContent = p.format > 1 ? `Manche ${p.manche} sur ${p.format}` : 'Manche unique';
    if (joue && adv) {
      const mien = moiJ?.manches ?? 0;
      const sien = adv.manches ?? 0;
      el.score.setAttribute('aria-label', `Score : ${mien} à ${sien}`);
      el.score.innerHTML = `<span class="duels-pfc-score-nom">Toi</span>
        <strong class="duels-pfc-score-n">${mien}</strong><span class="duels-pfc-score-tiret" aria-hidden="true">–</span><strong class="duels-pfc-score-n">${sien}</strong>
        <span class="duels-pfc-score-nom">${esc(advTitre)}</span>`;
    } else {
      el.score.removeAttribute('aria-label');
      el.score.innerHTML = '';
    }

    const peut = joue && enCours && !monChoix && !st.envoi && !st.attente;
    el.gestes.hidden = !joue;
    el.gestes.querySelectorAll('[data-geste]').forEach((b) => {
      const cle = b.dataset.geste;
      b.disabled = !peut;
      b.setAttribute('aria-pressed', String(monChoix === cle));
      b.classList.toggle('is-choisi', monChoix === cle);
    });

    st.fin = joue && enCours && !monChoix ? (moiJ?.fin || null) : null;
    el.compte.hidden = !st.fin;
    majCompte();

    let texte = '';
    if (!joue) texte = 'Tu regardes ce duel en spectateur.';
    else if (!enCours) texte = '';
    else if (monChoix) texte = advA ? '' : `Ton choix est gardé secret. En attente de ${advTitre}…`;
    else if (advA) texte = `${advTitre} a choisi. À toi de choisir.`;
    else texte = 'Choisis ton geste. Il reste caché jusqu’à celui de l’autre.';
    cadre.statut(texte);
  }

  // Clics délégués : un geste envoie le choix.
  cadre.plateau.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-geste]');
    if (b && !b.disabled) jouer(b.dataset.geste);
  });
  const tic = setInterval(majCompte, 500);

  return {
    /** Met à jour la table : cadre commun, score, lancer révélé si un nouveau est arrivé, historique, gestes. */
    maj(e) {
      st.etat = e;
      st.attente = false;
      cadre.maj(e);

      if (!cadre.cote.querySelector('[data-historique]')) {
        cadre.cote.innerHTML = `<h2 class="duels-h3">Lancers</h2>
          <ol class="duels-pfc-historique" data-historique aria-label="Historique des lancers"></ol>
          <h2 class="duels-h3">Règles</h2>
          <p class="duels-pfc-regle">Pierre bat ciseaux, ciseaux battent feuille, feuille bat pierre. Égalité : on relance.</p>
          <p class="duels-pfc-regle">Chacun choisit en même temps. Le choix de l'autre reste caché jusqu'à ce qu'il ait joué.</p>`;
      }

      const lancers = e.pfc?.lancers || [];
      if (st.nb === null) {
        st.nb = lancers.length;
        rendreArene(lancers[lancers.length - 1] || null, true);
      } else if (lancers.length > st.nb) {
        st.nb = lancers.length;
        reveler(lancers[lancers.length - 1]);
      } else if (lancers.length !== st.nb) {
        st.nb = lancers.length;
        rendreArene(lancers[lancers.length - 1] || null, true);
      }
      rendreHistorique(lancers);
      peindre();
    },
    message(m) { cadre.message(m); },
    detruire() {
      clearInterval(tic);
      st.timers.forEach((t) => clearTimeout(t));
      cadre.detruire();
    },
  };
}
