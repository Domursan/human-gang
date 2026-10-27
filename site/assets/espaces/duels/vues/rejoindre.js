// ===== Humane Gang — Duels : rejoindre un duel (#rejoindre/CODE) =====
/*
 * Rôle : quatre parcours selon le visiteur et l'état du duel.
 *   Membre déjà joueur (y compris un défi déjà accepté) : ouvre directement #partie/CODE.
 *   Membre défié (duel.etat → moi.defie), défi encore ouvert (statut « attente ») : carte du défi avec l'hôte, les réglages
 *     et le décompte (duel.etat → defi_expire), « Accepter le duel » (duel.rejoindre) ou « Refuser » (duel.refuser).
 *     Tant que la carte est ouverte, l'état est suivi (suivrePartie : temps réel + relecture) : si l'hôte annule ou si le défi
 *     expire, la carte est remplacée par « Ce défi n'est plus ouvert ».
 *   Membre défié, défi annulé, expiré ou déjà joué sans lui : carte « Ce défi n'est plus ouvert » (pas de bouton Accepter :
 *     hg_duel_etat renvoie moi.defie même pour un défi annulé, et l'ancien écran proposait d'accepter un défi mort).
 *   Autre membre : rejoint (duel.rejoindre) puis #partie/CODE. Erreur lisible dans une carte.
 *   Invité (estInvite) : si un jeton existe pour ce duel, #partie/CODE ; sinon l'invitation (duel.apercu),
 *     champ « Ton pseudo » et duel.rejoindreInvite. Pas de lien vers l'accueil.
 * Dépendances : core.js (esc, toast), duels/api.js (duel, erreurTexte, estInvite, jetonInvite, suivrePartie, JEUX), vues/commun.js (avatarHtml, nomJoueur).
 * Exporte : afficher.
 */
import { esc, toast } from '../../../commun/core.js';
import { duel, erreurTexte, estInvite, jetonInvite, suivrePartie, JEUX } from '../api.js';
import { avatarHtml, nomJoueur } from './commun.js';

const FORMATS = { 1: '1 manche', 3: 'Au meilleur des 3', 5: 'Au meilleur des 5' };
const LIEN_ACCUEIL = '<p><a class="btn btn-ghost" href="/pages/jeux/duels.html">Retour aux duels</a></p>';

/** Nom lisible d'une variante (ou la clé brute si inconnue). */
const nomVariante = (jeu, variante) => JEUX[jeu]?.variantes.find(([id]) => id === variante)?.[1] || variante || '';

/** Carte d'erreur : le message reste lisible, le retour n'est proposé qu'à un membre. */
function carteErreur(root, msg, invite) {
  root.innerHTML = `<section class="card duels-erreur" aria-labelledby="rejoindre-titre">
    <h1 id="rejoindre-titre" class="duels-titre">Impossible de rejoindre</h1>
    <p class="duels-erreur-texte" role="alert">${esc(msg)}</p>
    ${invite ? '' : LIEN_ACCUEIL}
  </section>`;
}

/** Réglages du duel sous forme de pastilles (format, temps, variante). */
function reglages(p) {
  const items = [FORMATS[p.format] || `${p.format} manches`, `${p.t_coup} s par coup`, nomVariante(p.jeu, p.variante)];
  return `<ul class="duels-reglages-pastilles" aria-label="Réglages du duel">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

/** Hôte du défi (joueur de l'état), ou un nom générique. */
const hoteDe = (e) => (e.joueurs || []).find((j) => j.user_id === e.partie?.hote) || { pseudo: 'Un membre' };

/** Vrai si le défi reçu est encore ouvert : en attente et pas expiré (heure du serveur). */
function defiOuvert(e) {
  const p = e?.partie;
  if (!p || p.statut !== 'attente') return false;
  if (!p.defi_expire) return true;
  const maintenant = e.maintenant ? new Date(e.maintenant).getTime() : Date.now();
  return new Date(p.defi_expire).getTime() > maintenant;
}

/**
 * Défi qui n'est plus ouvert (annulé par l'hôte, refusé, expiré, ou déjà commencé sans moi) : explication, puis
 * « Le défier à ton tour » (nouveau défi vers l'hôte) et le retour aux duels.
 */
function defiFerme(root, e) {
  const p = e.partie || {};
  const hote = hoteDe(e);
  const nom = esc(hote.pseudo || 'Un membre');
  let texte;
  if (p.statut === 'attente') texte = `Le défi de ${nom} a expiré.`;
  else if (p.statut === 'annulee') texte = `Le défi de ${nom} n'est plus ouvert : il a été annulé ou le délai de réponse est passé.`;
  else if (p.statut === 'en_cours') texte = 'Ce duel a déjà commencé.';
  else texte = 'Ce duel est terminé.';
  const revanche = p.hote
    ? `<a class="btn btn-primary duels-pleine" href="#creer/membre/${encodeURIComponent(p.hote)}">Le défier à ton tour</a>` : '';
  root.innerHTML = `<section class="card duels-rejoindre duels-defi duels-defi-ferme" aria-labelledby="defi-titre">
    <div class="duels-defi-tete">${avatarHtml(hote, { taille: 72 })}</div>
    <h1 id="defi-titre" class="duels-defi-titre">Ce défi n'est plus ouvert</h1>
    <p class="duels-invitation" role="status">${texte}</p>
    ${revanche}
    <a class="btn btn-ghost duels-pleine" href="/pages/jeux/duels.html">Retour aux duels</a>
  </section>`;
}

/**
 * Membre défié : affiche le défi, décompte l'expiration, accepte ou refuse. Suit l'état du duel tant que la carte
 * est ouverte (annulation par l'hôte, expiration côté serveur).
 * @returns {Function} nettoyage (arrête le décompte et le suivi).
 */
function defi(root, code, e, naviguer) {
  const p = e.partie;
  const hote = hoteDe(e);
  const decalage = new Date(e.maintenant).getTime() - Date.now();
  const fin = p.defi_expire ? new Date(p.defi_expire).getTime() : null;
  let occupe = false;
  let expire = false;
  let ferme = false;

  root.innerHTML = `<section class="card duels-rejoindre duels-defi" aria-labelledby="defi-titre">
    <div class="duels-defi-tete">${avatarHtml(hote, { taille: 72 })}</div>
    <h1 id="defi-titre" class="duels-defi-titre">${nomJoueur(hote)} te défie au ${esc(p.nom)}</h1>
    ${reglages(p)}
    <p class="duels-decompte" data-decompte></p>
    <p class="visually-hidden" role="status" data-expire></p>
    <button type="button" class="btn btn-primary duels-pleine" data-accepter>Accepter le duel</button>
    <button type="button" class="btn btn-ghost duels-pleine" data-refuser>Refuser</button>
  </section>`;

  const decompte = root.querySelector('[data-decompte]');
  const accepter = root.querySelector('[data-accepter]');
  const refuser = root.querySelector('[data-refuser]');
  const annonce = root.querySelector('[data-expire]');

  /** Active ou désactive les boutons (pendant un envoi, ou une fois le défi expiré). */
  const boutons = () => { accepter.disabled = occupe || expire; refuser.disabled = occupe; };

  /** Met à jour le décompte. Le temps vient de l'horloge du serveur (décalage calculé à l'arrivée). */
  const maj = () => {
    if (fin === null) { decompte.textContent = ''; return; }
    const reste = Math.max(0, Math.ceil((fin - (Date.now() + decalage)) / 1000));
    if (reste <= 0 && !expire) {
      expire = true;
      decompte.textContent = 'Le défi a expiré.';
      annonce.textContent = 'Le défi a expiré.';
      boutons();
      return;
    }
    if (!expire) decompte.textContent = `Le défi expire dans ${Math.floor(reste / 60)}:${String(reste % 60).padStart(2, '0')}`;
  };
  maj();
  const tic = setInterval(maj, 1000);

  let suivi = null;
  /** Le défi n'est plus ouvert : la carte est remplacée (une seule fois), le suivi s'arrête. */
  const fermer = (etat) => {
    if (ferme) return;
    ferme = true;
    clearInterval(tic);
    suivi?.arreter();
    defiFerme(root, etat);
  };
  /** Suivi de l'état (temps réel + relecture) : l'hôte peut annuler pendant que la carte est affichée. */
  suivi = suivrePartie(code, {
    onEtat: (etat) => {
      if (ferme || occupe || !etat?.partie) return;
      if (etat.moi?.joue) { naviguer(`#partie/${encodeURIComponent(code)}`); return; }
      if (etat.partie.statut !== 'attente') fermer(etat);
    },
  });

  accepter.addEventListener('click', async () => {
    if (occupe || expire || ferme) return;
    occupe = true;
    accepter.textContent = 'Connexion…';
    boutons();
    try {
      await duel.rejoindre(code);
      naviguer(`#partie/${encodeURIComponent(code)}`);
    } catch (err) {
      // Défi fermé entre-temps (annulé, expiré) : le serveur répond « Ce duel a déjà commencé. », ce qui est trompeur.
      // On relit l'état pour afficher la vraie raison.
      let etat = null;
      try { etat = await duel.etat(code); } catch { etat = null; }
      occupe = false;
      if (etat?.moi?.joue) { naviguer(`#partie/${encodeURIComponent(code)}`); return; }
      if (etat?.partie && !defiOuvert(etat)) { fermer(etat); return; }
      accepter.textContent = 'Accepter le duel';
      boutons();
      toast(erreurTexte(err), 'error');
    }
  });
  refuser.addEventListener('click', async () => {
    if (occupe) return;
    occupe = true;
    boutons();
    try {
      await duel.refuser(code);
      naviguer('');
    } catch (err) {
      let etat = null;
      try { etat = await duel.etat(code); } catch { etat = null; }
      occupe = false;
      if (etat?.partie && !defiOuvert(etat)) { fermer(etat); return; }
      boutons();
      toast(erreurTexte(err), 'error');
    }
  });

  return () => { clearInterval(tic); suivi.arreter(); };
}

/** Membre (pas défié) : rejoint le duel puis ouvre sa page. */
async function membre(root, code, naviguer) {
  let e = null;
  try { e = await duel.etat(code); } catch { e = null; } // pas encore joueur : l'état peut être refusé
  // Déjà joueur d'abord : un défi accepté garde moi.defie (le lien de la notification mène alors à la partie).
  if (e?.moi?.joue) { naviguer(`#partie/${encodeURIComponent(code)}`); return undefined; }
  if (e?.moi?.defie) {
    if (defiOuvert(e)) return defi(root, code, e, naviguer);
    defiFerme(root, e);
    return undefined;
  }

  try {
    await duel.rejoindre(code);
  } catch (err) {
    carteErreur(root, erreurTexte(err), false);
    return undefined;
  }
  naviguer(`#partie/${encodeURIComponent(code)}`);
  return undefined;
}

/** Invité sans compte : jeton déjà gardé → partie ; sinon l'invitation et le pseudo. */
async function invitation(root, code, naviguer) {
  if (jetonInvite(code)) { naviguer(`#partie/${encodeURIComponent(code)}`); return undefined; }

  let a;
  try {
    a = await duel.apercu(code);
  } catch (err) {
    carteErreur(root, erreurTexte(err), true);
    return undefined;
  }
  if (!a) { carteErreur(root, 'Ce duel n\'existe pas ou n\'est plus disponible.', true); return undefined; }
  if (a.complet) { carteErreur(root, 'Ce duel est complet : les deux places sont prises.', true); return undefined; }
  if (a.statut !== 'attente') {
    carteErreur(root, a.statut === 'en_cours' ? 'Ce duel a déjà commencé.' : 'Ce duel est terminé.', true);
    return undefined;
  }
  if (!a.invites) { carteErreur(root, 'Ce duel n\'accepte pas les invités. Connecte-toi si tu es membre du gang.', true); return undefined; }

  const p = { jeu: a.jeu, variante: a.variante, format: a.format, t_coup: a.t_coup };
  root.innerHTML = `<section class="card duels-rejoindre" aria-labelledby="invite-titre">
    <h1 id="invite-titre" class="duels-titre">Tu es invité</h1>
    <p class="duels-invitation">Tu es invité à un duel de <strong>${esc(a.nom)}</strong> par <strong>${esc(a.hote_pseudo || 'un membre')}</strong>.</p>
    ${reglages(p)}
    <form class="duels-invite-form" novalidate data-form>
      <div class="field">
        <label for="invite-pseudo">Ton pseudo</label>
        <input id="invite-pseudo" class="input" type="text" maxlength="20" autocomplete="nickname" required data-pseudo>
      </div>
      <p class="duels-erreur-texte" role="alert" data-erreur hidden></p>
      <button type="submit" class="btn btn-primary duels-pleine" data-envoyer>Rejoindre le duel</button>
    </form>
    <p class="muted small">Pas besoin de compte. Tu joues en invité : pas de Paillettes ni de statistiques.</p>
    <p class="small"><a href="/pages/compte/compte.html?next=${encodeURIComponent(`/pages/jeux/duels.html#rejoindre/${code}`)}">J'ai un compte, me connecter</a></p>
  </section>`;

  const form = root.querySelector('[data-form]');
  const champ = root.querySelector('[data-pseudo]');
  const erreurEl = root.querySelector('[data-erreur]');
  const bouton = root.querySelector('[data-envoyer]');
  let occupe = false;

  /** Affiche ou efface l'erreur du formulaire. */
  const erreur = (msg) => { erreurEl.textContent = msg; erreurEl.hidden = !msg; };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (occupe) return;
    const pseudo = champ.value.trim();
    if (!pseudo) { erreur('Choisis un pseudo pour rejoindre.'); champ.focus(); return; }
    erreur('');
    occupe = true;
    bouton.disabled = true;
    bouton.textContent = 'Connexion…';
    try {
      const c = await duel.rejoindreInvite(code, pseudo);
      naviguer(`#partie/${encodeURIComponent(c)}`);
    } catch (err) {
      occupe = false;
      bouton.disabled = false;
      bouton.textContent = 'Rejoindre le duel';
      erreur(erreurTexte(err));
    }
  });
  champ.focus();
  return undefined;
}

/**
 * Affiche l'écran « rejoindre » pour le code donné.
 * @param {HTMLElement} root zone d'affichage (#app).
 * @param {{ code: string|null, naviguer: Function }} ctx code = CODE de l'adresse #rejoindre/CODE.
 * @returns {Promise<Function|undefined>} nettoyage (décompte du défi) ou rien.
 */
export async function afficher(root, { code, naviguer }) {
  if (!code) { naviguer(''); return undefined; }
  const invite = estInvite();
  root.innerHTML = `<p class="duels-chargement" role="status">${invite ? 'Ouverture de l\'invitation…' : `Connexion au duel ${esc(code)}…`}</p>`;
  try {
    return invite ? await invitation(root, code, naviguer) : await membre(root, code, naviguer);
  } catch (err) {
    console.error('[duels] rejoindre', err);
    carteErreur(root, erreurTexte(err), invite);
    return undefined;
  }
}
