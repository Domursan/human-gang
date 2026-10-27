// ===== Humane Gang — Duels : rejoindre un duel (#rejoindre/CODE) =====
/*
 * Rôle : quatre parcours selon le visiteur et l'état du duel.
 *   Membre défié (duel.etat → moi.defie) : carte du défi avec l'hôte, les réglages et le décompte (duel.etat → defi_expire),
 *     « Accepter le duel » (duel.rejoindre) ou « Refuser » (duel.refuser).
 *   Membre déjà joueur : ouvre directement #partie/CODE.
 *   Autre membre : rejoint (duel.rejoindre) puis #partie/CODE. Erreur lisible dans une carte.
 *   Invité (estInvite) : si un jeton existe pour ce duel, #partie/CODE ; sinon l'invitation (duel.apercu),
 *     champ « Ton pseudo » et duel.rejoindreInvite. Pas de lien vers l'accueil.
 * Dépendances : core.js (esc, toast), duels/api.js (duel, erreurTexte, estInvite, jetonInvite, JEUX), vues/commun.js (avatarHtml, nomJoueur).
 * Exporte : afficher.
 */
import { esc, toast } from '../../core.js';
import { duel, erreurTexte, estInvite, jetonInvite, JEUX } from '../api.js';
import { avatarHtml, nomJoueur } from './commun.js';

const FORMATS = { 1: '1 manche', 3: 'Au meilleur des 3', 5: 'Au meilleur des 5' };
const LIEN_ACCUEIL = '<p><a class="btn btn-ghost" href="duels.html">Retour aux duels</a></p>';

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

/**
 * Membre défié : affiche le défi, décompte l'expiration, accepte ou refuse.
 * @returns {Function} nettoyage (arrête le décompte).
 */
function defi(root, code, e, naviguer) {
  const p = e.partie;
  const hote = (e.joueurs || []).find((j) => j.user_id === p.hote) || { pseudo: 'Un membre' };
  const decalage = new Date(e.maintenant).getTime() - Date.now();
  const fin = p.defi_expire ? new Date(p.defi_expire).getTime() : null;
  let occupe = false;
  let expire = false;

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

  accepter.addEventListener('click', async () => {
    if (occupe || expire) return;
    occupe = true;
    accepter.textContent = 'Connexion…';
    boutons();
    try {
      await duel.rejoindre(code);
      naviguer(`#partie/${encodeURIComponent(code)}`);
    } catch (err) {
      occupe = false;
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
      occupe = false;
      boutons();
      toast(erreurTexte(err), 'error');
    }
  });

  return () => clearInterval(tic);
}

/** Membre (pas défié) : rejoint le duel puis ouvre sa page. */
async function membre(root, code, naviguer) {
  let e = null;
  try { e = await duel.etat(code); } catch { e = null; } // pas encore joueur : l'état peut être refusé
  if (e?.moi?.defie) return defi(root, code, e, naviguer);
  if (e?.moi?.joue) { naviguer(`#partie/${encodeURIComponent(code)}`); return undefined; }

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
    <p class="small"><a href="compte.html?next=${encodeURIComponent(`duels.html#rejoindre/${code}`)}">J'ai un compte, me connecter</a></p>
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
