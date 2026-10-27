// ===== Humane Gang — Jeux de plateau : rejoindre une partie (#rejoindre/CODE) =====
/*
 * Rôle : deux parcours selon le visiteur, avec le même aperçu de la partie (plat.apercu : nom, hôte, joueurs, réglages).
 *   Membre : bouton « Rejoindre la partie » (plat.rejoindre), puis salle d'attente. Si je suis déjà dedans,
 *     plat.rejoindre renvoie le code et l'écran va à #partie.
 *   Invité (sans compte) : si un jeton existe déjà pour cette partie, ouvre la salle. Sinon, champ « Ton pseudo »
 *     puis plat.rejoindreInvite (le jeton reste dans le navigateur).
 *   Partie déjà commencée, introuvable, d'un autre jeu ou fermée aux invités : un message clair.
 * Les erreurs d'envoi vont dans un toast. Pas de lien vers l'accueil ni les statistiques pour un invité.
 * Dépendances : core.js (esc, toast), plateaux/api.js (plat, erreurTexte, estInvite, jeu).
 * Exporte : afficher.
 */
import { esc, toast } from '../../core.js';
import { plat, erreurTexte, estInvite, jeu } from '../api.js';

/** Le jeton d'invité de cette partie est-il déjà gardé dans le navigateur ? (même clé que plateaux/api.js) */
function aDejaJeton(code) {
  try { return !!localStorage.getItem(`hg_plat_invite:${String(code || '').toUpperCase()}`); } catch { return false; }
}

/** Lien d'accueil (membre seulement). */
const lienAccueil = () => `<a class="btn btn-ghost plat-rej-retour" href="${esc(jeu().page)}">Retour à ${esc(jeu().nom)}</a>`;

/** Lien de connexion qui revient sur la même partie après le compte. */
const lienCompte = (code) => `<a class="plat-rej-lien" href="compte.html?next=${encodeURIComponent(`${jeu().page}?code=${code}`)}">J'ai un compte, me connecter</a>`;

/** Carte d'erreur ou d'information, à la place du contenu courant. */
function carteMessage(msg, { extra = '' } = {}) {
  return `<section class="card plat-rej-carte" data-rejoindre>
    <h1 class="plat-titre display">Rejoindre</h1>
    <p class="plat-rej-erreur" role="alert">${esc(msg)}</p>
    ${extra}
    ${estInvite() ? '' : `<p>${lienAccueil()}</p>`}
  </section>`;
}

/** Affiche un message à la place du contenu. */
function montrerErreur(root, msg, extra = '') {
  root.innerHTML = carteMessage(msg, { extra });
}

/** Carte de chargement de l'aperçu. */
function montrerChargement(root) {
  root.innerHTML = `<section class="card plat-rej-carte" data-rejoindre>
    <p class="plat-rej-statut" role="status">Chargement de la partie…</p>
  </section>`;
}

/** Carte de la partie : nom, hôte, joueurs, réglages, puis le bouton (ou le champ « Ton pseudo » pour un invité). */
function vuePartie(p, code, invite) {
  const inscrits = Number(p.inscrits) || 0;
  const places = Number(p.nb_places) || 0;
  const reglages = [
    `Tour : ${Number(p.t_tour) || 60} s`,
    p.invites ? 'Invités acceptés' : 'Invités refusés',
  ];
  return `<section class="card plat-rej-carte" aria-labelledby="plat-rej-nom" data-rejoindre>
    <p class="plat-rej-surtitre">${invite ? `Tu es invité à une partie de ${esc(jeu().nom)}` : 'Rejoindre une partie'}</p>
    <div class="plat-rej-entete">
      <h1 id="plat-rej-nom" class="plat-rej-nom">${esc(p.nom)}</h1>
      <p>Hôte : <strong>${esc(p.hote_pseudo || '?')}</strong> · <span class="plat-code">${esc(p.code || code)}</span></p>
    </div>
    <div class="plat-rej-places">
      <div class="plat-rej-places-ligne"><span>Joueurs</span><span>${inscrits} / ${places}</span></div>
      <div class="plat-rej-barre" aria-hidden="true"><span data-barre></span></div>
    </div>
    <ul class="plat-rej-chips" aria-label="Réglages">${reglages.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <form class="plat-rej-form" data-form novalidate>
      ${invite ? `<div class="plat-champ">
        <label for="plat-rej-pseudo">Ton pseudo</label>
        <input id="plat-rej-pseudo" class="plat-input" type="text" name="pseudo" placeholder="Ex. Mélo"
          autocomplete="nickname" maxlength="24" required aria-describedby="plat-rej-pseudo-aide">
        <p id="plat-rej-pseudo-aide" class="small muted">Entre 2 et 24 caractères.</p>
      </div>` : ''}
      <p class="plat-rej-erreur" data-erreur role="alert" hidden></p>
      <button type="submit" class="btn btn-primary plat-rej-bouton" data-envoyer>Rejoindre la partie</button>
    </form>
    ${invite
      ? `<p class="small muted plat-centre">Pas besoin de compte. Tu joues en invité : pas de Paillettes ni de statistiques.</p>
         ${lienCompte(code)}`
      : ''}
  </section>`;
}

/**
 * Branche le formulaire de la carte de partie. Un membre n'envoie que le bouton ; un invité envoie son pseudo.
 * @param {HTMLElement} root zone de l'écran.
 * @param {string} code code de la partie.
 * @param {boolean} invite vrai pour un visiteur sans compte.
 * @param {Function} naviguer changement d'écran.
 * @param {object} p aperçu de la partie.
 */
function brancher(root, code, invite, naviguer, p) {
  const barre = root.querySelector('[data-barre]');
  const pct = p.nb_places ? Math.min(100, (Number(p.inscrits) / Number(p.nb_places)) * 100) : 0;
  barre.style.width = `${pct}%`;

  const form = root.querySelector('[data-form]');
  const champ = root.querySelector('#plat-rej-pseudo');
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
      const partie = invite ? await plat.rejoindreInvite(code, pseudo) : await plat.rejoindre(code);
      naviguer(`#partie/${encodeURIComponent(partie || code)}`);
    } catch (err) {
      bouton.disabled = false;
      bouton.textContent = 'Rejoindre la partie';
      toast(erreurTexte(err), 'error');
    }
  });
  if (invite) champ.focus();
}

/** Vrai si l'aperçu est d'un autre jeu que celui de la page. */
const autreJeu = (p) => !!p.jeu && p.jeu !== jeu().id;

/** Membre : charge l'aperçu puis propose de rejoindre. */
async function rejoindreMembre(root, code, naviguer) {
  montrerChargement(root);
  let p;
  try {
    p = await plat.apercu(code);
  } catch (e) {
    if (!root.querySelector('[data-rejoindre]')) return;
    return montrerErreur(root, erreurTexte(e));
  }
  if (!root.querySelector('[data-rejoindre]')) return;
  if (!p) return montrerErreur(root, 'Partie introuvable. Vérifie le code.');
  if (autreJeu(p)) return montrerErreur(root, `Cette partie est une partie de ${p.nom_jeu || 'un autre jeu'}.`);
  if (p.statut !== 'attente') return montrerErreur(root, 'La partie a déjà commencé. Tu ne peux plus la rejoindre.');

  root.innerHTML = vuePartie(p, code, false);
  brancher(root, code, false, naviguer, p);
}

/** Invité : charge l'invitation, puis demande un pseudo et rejoint avec plat.rejoindreInvite. */
async function rejoindreInvite(root, code, naviguer) {
  montrerChargement(root);
  let p;
  try {
    p = await plat.apercu(code);
  } catch (e) {
    if (!root.querySelector('[data-rejoindre]')) return;
    return montrerErreur(root, erreurTexte(e));
  }
  if (!root.querySelector('[data-rejoindre]')) return;
  if (!p) return montrerErreur(root, "Partie introuvable. Demande un nouveau lien à l'hôte.");
  if (autreJeu(p)) return montrerErreur(root, `Cette invitation concerne une partie de ${p.nom_jeu || 'un autre jeu'}.`);
  if (p.statut !== 'attente') return montrerErreur(root, 'La partie a déjà commencé. Tu ne peux plus la rejoindre.');
  if (!p.invites) {
    return montrerErreur(root, "Cette partie n'accepte pas les invités. Connecte-toi pour la rejoindre.", `<p>${lienCompte(code)}</p>`);
  }

  root.innerHTML = vuePartie(p, code, true);
  brancher(root, code, true, naviguer, p);
}

/**
 * Affiche l'écran de rejoindre pour le code de l'adresse (#rejoindre/CODE).
 * @param {HTMLElement} root zone d'affichage (#app).
 * @param {{ code: string|null, naviguer: Function }} ctx code de partie et changement d'écran.
 */
export async function afficher(root, { code, naviguer }) {
  if (!code) return montrerErreur(root, 'Il manque le code de la partie. Demande-le à l\'hôte.');
  if (!estInvite()) return rejoindreMembre(root, code, naviguer);
  // Invité déjà inscrit à cette partie : on ouvre directement la salle.
  if (aDejaJeton(code)) return naviguer(`#partie/${encodeURIComponent(code)}`);
  return rejoindreInvite(root, code, naviguer);
}
