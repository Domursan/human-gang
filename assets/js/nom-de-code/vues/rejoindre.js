// ===== Humane Gang — Nom de code : rejoindre une partie (#rejoindre/CODE) =====
/*
 * Rôle : deux parcours selon le visiteur, avec le même aperçu de la partie (ndc.apercu : nom, hôte, joueurs, réglages).
 *   Membre : bouton « Rejoindre la partie » (ndc.rejoindre), puis salle d'attente. Si je suis déjà dans la partie,
 *     ndc.rejoindre renvoie le code et l'écran va à #partie.
 *   Invité (sans compte) : si un jeton existe déjà pour cette partie, ouvre la salle. Sinon, champ « Ton pseudo »
 *     puis ndc.rejoindreInvite (le jeton reste dans le navigateur).
 *   Partie déjà commencée, introuvable ou fermée aux invités : un message clair, sans bouton trompeur.
 * Les erreurs d'envoi vont dans un toast. Pas de lien vers l'accueil ni les statistiques pour un invité.
 * Dépendances : core.js (esc, toast), nom-de-code/api.js (ndc, erreurTexte, estInvite, jetonInvite).
 * Exporte : afficher.
 */
import { esc, toast } from '../../core.js';
import { ndc, erreurTexte, estInvite, jetonInvite } from '../api.js';

const LIEN_ACCUEIL = '<a class="btn btn-ghost ndc-rej-retour" href="nom-de-code.html">Retour à Nom de code</a>';

/** Lien de connexion qui revient sur la même partie après le compte. */
const lienCompte = (code) => `<a class="ndc-rej-lien" href="compte.html?next=${encodeURIComponent(`nom-de-code.html?code=${code}`)}">J'ai un compte, me connecter</a>`;

/** Réglages de la partie en étiquettes (texte, jamais la couleur seule). */
function reglesChips(p) {
  return [
    `Espion : ${p.t_espion} s`,
    Number(p.t_equipe) ? `Équipe : ${p.t_equipe} s` : 'Équipe : sans limite',
    p.validation === 'libre' ? 'Révélation libre' : 'Révélation à la majorité',
  ];
}

/** Carte d'erreur ou d'information, à la place du contenu courant. Un membre a toujours le retour à l'accueil. */
function carteMessage(msg, { extra = '' } = {}) {
  return `<section class="card ndc-rej-carte" data-rejoindre>
    <h1 class="ndc-titre ndc-rej-titre">Rejoindre</h1>
    <p class="ndc-rej-erreur" role="alert">${esc(msg)}</p>
    ${extra}
    ${estInvite() ? '' : `<p>${LIEN_ACCUEIL}</p>`}
  </section>`;
}

/** Affiche un message à la place du contenu. */
function montrerErreur(root, msg, extra = '') {
  root.innerHTML = carteMessage(msg, { extra });
}

/** Carte de chargement de l'aperçu. */
function montrerChargement(root) {
  root.innerHTML = `<section class="card ndc-rej-carte" data-rejoindre>
    <p class="ndc-rej-statut" role="status">Chargement de la partie…</p>
  </section>`;
}

/** Carte de la partie : nom, hôte, joueurs, réglages, puis le bouton (ou le champ « Ton pseudo » pour un invité). */
function vuePartie(p, code, invite) {
  const inscrits = Number(p.inscrits) || 0;
  const places = Number(p.nb_places) || 0;
  return `<section class="card ndc-rej-carte" aria-labelledby="ndc-rej-nom" data-rejoindre>
    <p class="ndc-rej-surtitre">${invite ? 'Tu es invité à une partie de Nom de code' : 'Rejoindre une partie'}</p>
    <div class="ndc-rej-entete">
      <h1 id="ndc-rej-nom" class="ndc-rej-nom">${esc(p.nom)}</h1>
      <p class="ndc-rej-hote">Hôte : <strong class="ndc-rej-hote-nom">${esc(p.hote_pseudo || '?')}</strong>
        · <span class="ndc-code">${esc(p.code || code)}</span></p>
    </div>
    <div class="ndc-rej-places">
      <div class="ndc-rej-places-ligne"><span>Joueurs</span><span class="ndc-rej-places-val">${inscrits} / ${places}</span></div>
      <div class="ndc-rej-barre" aria-hidden="true"><span data-barre></span></div>
    </div>
    <div class="ndc-rej-reglages">
      <span class="ndc-rej-label">Réglages</span>
      <ul class="ndc-rej-chips">${reglesChips(p).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    </div>
    <form class="ndc-rej-form" data-form novalidate>
      ${invite ? `<div class="ndc-rej-champ">
        <label for="ndc-rej-pseudo">Ton pseudo</label>
        <input id="ndc-rej-pseudo" class="ndc-rej-input" type="text" name="pseudo" placeholder="Ex. Mélo"
          autocomplete="nickname" maxlength="24" required aria-describedby="ndc-rej-pseudo-aide">
        <p id="ndc-rej-pseudo-aide" class="ndc-rej-aide">Entre 2 et 24 caractères.</p>
      </div>` : ''}
      <p class="ndc-rej-erreur" data-erreur role="alert" hidden></p>
      <button type="submit" class="btn ndc-rej-bouton" data-envoyer>Rejoindre la partie</button>
    </form>
    ${invite
      ? `<p class="ndc-rej-aide ndc-rej-centre">Pas besoin de compte. Tu joues en invité : pas de Paillettes ni de statistiques.</p>
         ${lienCompte(code)}`
      : ''}
  </section>`;
}

/**
 * Branche le formulaire de la carte de partie. Un membre n'envoie que le bouton ; un invité envoie son pseudo.
 * @param {boolean} invite
 */
function brancher(root, code, invite, naviguer, p) {
  const barre = root.querySelector('[data-barre]');
  const pct = p.nb_places ? Math.min(100, (Number(p.inscrits) / Number(p.nb_places)) * 100) : 0;
  barre.style.width = `${pct}%`;

  const form = root.querySelector('[data-form]');
  const champ = root.querySelector('#ndc-rej-pseudo');
  const bouton = root.querySelector('[data-envoyer]');
  const erreurEl = root.querySelector('[data-erreur]');
  const erreur = (msg) => { erreurEl.textContent = msg; erreurEl.hidden = !msg; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (bouton.disabled) return;
    let pseudo = null;
    if (invite) {
      pseudo = champ.value.trim();
      if (pseudo.length < 2 || pseudo.length > 24) {
        erreur('Ton pseudo fait entre 2 et 24 caractères.');
        champ.focus();
        return;
      }
    }
    erreur('');
    bouton.disabled = true;
    bouton.textContent = 'Connexion…';
    try {
      const partie = invite ? await ndc.rejoindreInvite(code, pseudo) : await ndc.rejoindre(code);
      naviguer(`#partie/${partie || code}`);
    } catch (err) {
      bouton.disabled = false;
      bouton.textContent = 'Rejoindre la partie';
      toast(erreurTexte(err), 'error');
    }
  });
  if (invite) champ.focus();
}

/** Membre : charge l'aperçu puis propose de rejoindre. */
async function rejoindreMembre(root, code, naviguer) {
  montrerChargement(root);
  let p;
  try {
    p = await ndc.apercu(code);
  } catch (e) {
    if (!root.querySelector('[data-rejoindre]')) return;
    return montrerErreur(root, erreurTexte(e));
  }
  if (!root.querySelector('[data-rejoindre]')) return;
  if (!p) return montrerErreur(root, 'Partie introuvable. Vérifie le code.');
  if (p.statut !== 'attente') return montrerErreur(root, 'La partie a déjà commencé. Tu ne peux plus la rejoindre.');

  root.innerHTML = vuePartie(p, code, false);
  brancher(root, code, false, naviguer, p);
}

/** Invité : charge l'invitation, puis demande un pseudo et rejoint avec ndc.rejoindreInvite. */
async function rejoindreInvite(root, code, naviguer) {
  montrerChargement(root);
  let p;
  try {
    p = await ndc.apercu(code);
  } catch (e) {
    if (!root.querySelector('[data-rejoindre]')) return;
    return montrerErreur(root, erreurTexte(e));
  }
  if (!root.querySelector('[data-rejoindre]')) return;
  if (!p) return montrerErreur(root, "Partie introuvable. Demande un nouveau lien à l'hôte.");
  if (p.statut !== 'attente') return montrerErreur(root, 'La partie a déjà commencé. Tu ne peux plus la rejoindre.');
  if (!p.invites) {
    return montrerErreur(root, "Cette partie n'accepte pas les invités. Connecte-toi pour la rejoindre.", { extra: `<p>${lienCompte(code)}</p>` });
  }

  root.innerHTML = vuePartie(p, code, true);
  brancher(root, code, true, naviguer, p);
}

/**
 * Affiche l'écran de rejoindre pour le code de l'adresse (#rejoindre/CODE).
 * @param {HTMLElement} root Zone d'affichage (#app).
 * @param {{ code: string|null, naviguer: Function }} ctx Code de partie et changement d'écran.
 */
export async function afficher(root, { code, naviguer }) {
  if (!code) return montrerErreur(root, 'Il manque le code de la partie. Demande-le à l\'hôte.');
  if (!estInvite()) return rejoindreMembre(root, code, naviguer);
  // Invité déjà inscrit à cette partie : on ouvre directement la salle.
  if (jetonInvite(code)) return naviguer(`#partie/${code}`);
  return rejoindreInvite(root, code, naviguer);
}
