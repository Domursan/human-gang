// ===== Humane Gang — Duels : pilotage d'un duel (#partie/CODE) =====
/*
 * Rôle : suit la partie en temps réel (duels/api.js) et affiche la bonne vue selon son statut :
 *   attente → vues/salle.js · en_cours → vues/p4.js, vues/morpion.js, vues/mastermind.js,
 *   vues/bataille.js, vues/quiestce.js, vues/dames.js, vues/echecs.js, vues/othello.js ou vues/pfc.js (selon le jeu) ·
 *   terminee / annulee → vues/fin.js. Un spectateur (duel public) voit la même table, sans pouvoir jouer.
 * La vue n'est recréée que si le statut change ; sinon on appelle vue.maj(etat).
 * Les messages du chat (anciens puis nouveaux) sont passés à la vue par vue.message(msg).
 * Invité (sans temps réel) : les nouveaux messages sont relevés toutes les 4 s (releverMessages).
 * Duel en attente où je ne joue pas (défi reçu, code partagé) : renvoie vers #rejoindre/CODE.
 * Contrat des vues : export function creer(root, ctx) → { maj(etat), message(msg), detruire() },
 *   ctx = { code, naviguer, moi, suivi } (suivi : rafraichir, secondesRestantes, etat).
 * Dépendances : core.js (esc), duels/api.js (suivrePartie, messages, estInvite).
 * Exporte : afficher.
 */
import { esc } from '../../../commun/core.js';
import { suivrePartie, messages, estInvite } from '../api.js';

const VUES = {
  salle: () => import('./salle.js'),
  p4: () => import('./p4.js'),
  morpion: () => import('./morpion.js'),
  mastermind: () => import('./mastermind.js'),
  bataille: () => import('./bataille.js'),
  quiestce: () => import('./quiestce.js'),
  dames: () => import('./dames.js'),
  echecs: () => import('./echecs.js'),
  othello: () => import('./othello.js'),
  pfc: () => import('./pfc.js'),
  fin: () => import('./fin.js'),
};

/** Nom de la vue à afficher pour cet état (la table dépend du jeu). */
function vuePour(e) {
  const statut = e?.partie?.statut;
  if (statut === 'attente') return 'salle';
  if (statut === 'en_cours') return VUES[e.partie.jeu] ? e.partie.jeu : null;
  if (statut === 'terminee' || statut === 'annulee') return 'fin';
  return null;
}

/** Carte d'erreur « Partie introuvable » avec le lien de retour. */
function erreurCarte(root, code, message) {
  const invite = estInvite();
  const lien = invite
    ? `/pages/jeux/duels.html#rejoindre/${encodeURIComponent(code)}`
    : '/pages/jeux/duels.html';
  root.innerHTML = `<section class="card duels-erreur">
    <h1 class="display">Duel introuvable</h1>
    <p>${esc(message || 'Ce duel n\'existe pas ou n\'est plus disponible.')}</p>
    <p><a class="btn btn-primary" href="${lien}">${invite ? 'Rejoindre à nouveau' : 'Retour aux duels'}</a></p>
  </section>`;
}

/**
 * Affiche la partie code dans root et suit ses changements.
 * @param {HTMLElement} root conteneur de l'écran.
 * @param {{ code: string|null, naviguer: Function, moi: object }} ctx contexte fourni par duels.js.
 * @returns {Function} nettoyage (arrête le suivi, détruit la vue).
 */
export async function afficher(root, { code, naviguer, moi }) {
  if (!code) { naviguer(''); return () => {}; }
  root.innerHTML = `<p class="duels-chargement">Connexion au duel ${esc(code)}…</p>`;

  let fini = false;
  let courant = null;            // { nom, vue }
  let suivi = null;              // rempli dès le premier appel de suivrePartie
  let dernier = null;            // dernier état reçu (pour réaligner la vue après un chargement)
  let charge = null;             // chargement de vue en cours (promesse)
  let historique = null;         // chargement unique des anciens messages
  const msgs = [];               // tous les messages connus, du plus ancien au plus récent
  const vus = new Set();         // ids déjà passés (évite les doublons temps réel / historique)
  let plusRecent = 0;            // id du plus récent message reçu (point de départ de la relève invité)
  let sondage = null;            // relève périodique des messages, pour l'invité (pas de temps réel)
  let relevant = false;          // une relève est en cours

  /** Envoie un message à la vue courante (ou le garde pour la prochaine vue). */
  function ajouterMessage(m) {
    if (!m || vus.has(m.id)) return;
    vus.add(m.id);
    msgs.push(m);
    plusRecent = Math.max(plusRecent, m.id);
    if (courant && !charge) courant.vue.message?.(m);
  }

  /** Invité : pas de temps réel, on relève les nouveaux messages toutes les 4 s (même chemin que le temps réel). */
  async function releverMessages() {
    const partieId = dernier?.partie?.id;
    if (fini || relevant || !partieId || document.hidden) return;
    relevant = true;
    try {
      const liste = await messages(partieId, plusRecent, code);
      if (!fini) [...liste].sort((a, b) => a.id - b.id).forEach(ajouterMessage);
    } catch (err) {
      console.warn('[duels] relève des messages', err);
    } finally {
      relevant = false;
    }
  }
  function demarrerReleve() {
    if (sondage || fini || !estInvite()) return;
    sondage = setInterval(releverMessages, 4000);
  }

  /** Charge les anciens messages une seule fois, dès que la partie est connue. */
  function chargerHistorique(partieId) {
    if (historique || !partieId) return;
    historique = messages(partieId, 0, code)
      .then((liste) => {
        if (fini) return;
        [...liste].sort((a, b) => a.id - b.id).forEach(ajouterMessage);
      })
      .catch((err) => console.warn('[duels] messages', err));
  }

  /** Aligne la vue affichée sur le dernier état connu. */
  async function aligner() {
    if (fini || !dernier || charge) return;
    const e = dernier;
    if (!e.moi) { naviguer(`#rejoindre/${encodeURIComponent(code)}`); return; }
    if (e.partie?.statut === 'attente' && !e.moi.joue) { naviguer(`#rejoindre/${encodeURIComponent(code)}`); return; }
    const nom = vuePour(e);
    if (!nom) return;
    if (courant?.nom === nom) { courant.vue.maj(e); return; }

    charge = (async () => {
      const mod = await VUES[nom]();
      if (fini) return;
      try { courant?.vue.detruire?.(); } catch { /* sans effet */ }
      root.innerHTML = '';
      const vue = mod.creer(root, { code, naviguer, moi, suivi });
      courant = { nom, vue };
      vue.maj(dernier || e);
      msgs.forEach((m) => vue.message?.(m));
    })()
      .catch((err) => {
        console.error('[duels] vue', err);
        root.innerHTML = '<section class="card duels-erreur"><p>Cet écran n\'a pas pu s\'afficher.</p></section>';
      })
      .finally(() => { charge = null; });
    await charge;
    // Le statut a pu changer pendant le chargement : on réaligne.
    if (!fini && dernier && dernier !== e) aligner();
  }

  suivi = suivrePartie(code, {
    onEtat: (e) => {
      if (fini) return;
      dernier = e;
      chargerHistorique(e?.partie?.id);
      demarrerReleve();
      if (courant && courant.nom === vuePour(e) && e?.moi && !charge) courant.vue.maj(e);
      else aligner();
    },
    onMessage: (m) => ajouterMessage(m),
    onErreur: (err) => {
      if (!courant && !fini) erreurCarte(root, code, err?.message);
    },
  });

  return () => {
    fini = true;
    clearInterval(sondage);
    try { suivi.arreter(); } catch { /* sans effet */ }
    try { courant?.vue.detruire?.(); } catch { /* sans effet */ }
  };
}
