// ===== Humane Gang — Uno : rejoindre une partie (#rejoindre/CODE) =====
/*
 * Rôle : deux parcours selon le visiteur.
 *   Membre : rejoint la partie (uno.rejoindre) puis ouvre la salle. Erreur affichée dans la carte.
 *   Invité (sans compte) : si un jeton existe déjà pour cette partie, ouvre la salle. Sinon montre l'invitation
 *     (uno.apercu) avec le champ « Ton pseudo » et rejoint avec uno.rejoindreInvite.
 * Dépendances : core.js (esc), uno/api.js (uno, erreurTexte, estInvite, jetonInvite).
 * Exporte : afficher.
 */
import { esc } from '../../core.js';
import { uno, erreurTexte, estInvite, jetonInvite } from '../api.js';

const VARIANTES_NOMS = {
  cumul: 'Cumul des +2 et +4',
  pioche_jusqu: 'Pioche jusqu\'à jouer',
  sept_zero: 'Sept-zéro',
  interception: 'Interception',
};
const MODES_NOMS = { manche: 'Manche simple', points: 'Partie en 500 points' };
const LIEN_UNO = '<a class="btn btn-ghost uno-retour" href="uno.html">Retour au Uno</a>';

/** Carte d'erreur (la page reste utilisable : retour au Uno). */
function carteErreur(msg) {
  return `<section class="card uno-rejoindre-carte uno-erreur-carte" data-rejoindre>
    <h1 class="uno-titre">Rejoindre</h1>
    <p class="uno-rejoindre-erreur" role="alert">${esc(msg)}</p>
    <p>${LIEN_UNO}</p>
  </section>`;
}

/** Affiche une erreur à la place du contenu courant. */
function montrerErreur(root, msg) {
  root.innerHTML = carteErreur(msg);
}

/** Membre : rejoint la partie puis ouvre la salle d'attente. */
async function rejoindreMembre(root, code, naviguer) {
  root.innerHTML = `<section class="card uno-rejoindre-carte" data-rejoindre>
    <p class="uno-fil">Jeux › <a href="uno.html">Uno</a> › Rejoindre</p>
    <p class="uno-rejoindre-statut" role="status">Connexion à la partie <span class="uno-code">${esc(code)}</span>…</p>
  </section>`;
  try {
    const rejoint = await uno.rejoindre(code);
    if (!root.querySelector('[data-rejoindre]')) return; // l'utilisateur a changé d'écran entre-temps
    naviguer(`#partie/${typeof rejoint === 'string' && rejoint ? rejoint : code}`);
  } catch (e) {
    if (!root.querySelector('[data-rejoindre]')) return;
    montrerErreur(root, erreurTexte(e));
  }
}

/** Carte d'invitation : nom, hôte, places, variantes et champ « Ton pseudo ». */
function vueInvitation(p, code) {
  const variantes = Object.entries(p.variantes || {})
    .filter(([, actif]) => actif)
    .map(([id]) => VARIANTES_NOMS[id])
    .filter(Boolean);
  const chips = [`Tours de ${p.t_tour} s`, MODES_NOMS[p.mode], ...variantes].filter(Boolean);
  const inscrits = Number(p.inscrits) || 0;
  const places = Number(p.nb_places) || 0;
  return `<section class="card uno-rejoindre-carte" aria-labelledby="uno-invit-titre" data-rejoindre>
    <h1 id="uno-invit-titre" class="uno-rejoindre-surtitre">Tu es invité à une partie de Uno</h1>
    <div class="uno-rejoindre-entete">
      <p class="uno-rejoindre-nom">${esc(p.nom)}</p>
      <p class="uno-rejoindre-hote">Hôte : <strong class="uno-hote">${esc(p.hote_pseudo)}</strong></p>
    </div>
    <div class="uno-places">
      <div class="uno-places-ligne"><span>Places</span><span class="uno-places-val">${inscrits} / ${places}</span></div>
      <div class="uno-places-barre" aria-hidden="true"><span data-barre></span></div>
    </div>
    <div class="uno-chips-bloc">
      <span class="uno-aide">Règles</span>
      <ul class="uno-chips">${chips.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    </div>
    <form class="uno-rejoindre-form" data-form novalidate>
      <label for="uno-pseudo">Ton pseudo</label>
      <input id="uno-pseudo" class="uno-input" type="text" name="pseudo" placeholder="Ex. Mélo"
        autocomplete="nickname" maxlength="24" required aria-describedby="uno-pseudo-aide">
      <p id="uno-pseudo-aide" class="uno-aide">Entre 2 et 24 caractères.</p>
      <p class="uno-rejoindre-erreur" data-erreur role="alert" hidden></p>
      <button type="submit" class="btn btn-primary uno-rejoindre-bouton" data-envoyer>Rejoindre la partie</button>
    </form>
    <p class="uno-aide uno-centre">Pas besoin de compte. Tu joues en invité : pas de Paillettes ni de statistiques.</p>
    <a class="uno-lien-compte" href="compte.html?next=${encodeURIComponent(`uno.html?code=${code}`)}">J'ai un compte, me connecter</a>
  </section>`;
}

/** Invité : charge l'invitation et gère l'envoi du pseudo. */
async function rejoindreInvite(root, code, naviguer) {
  root.innerHTML = `<section class="card uno-rejoindre-carte" data-rejoindre>
    <p class="uno-rejoindre-statut" role="status">Chargement de l'invitation…</p>
  </section>`;
  let p;
  try {
    p = await uno.apercu(code);
  } catch (e) {
    if (!root.querySelector('[data-rejoindre]')) return;
    return montrerErreur(root, erreurTexte(e));
  }
  if (!root.querySelector('[data-rejoindre]')) return;
  if (!p) return montrerErreur(root, 'Partie introuvable.');
  if (p.statut !== 'attente') return montrerErreur(root, 'La partie a déjà commencé.');
  if (!p.invites) {
    return montrerErreur(root, 'Cette partie n\'accepte pas les invités. Connecte-toi pour la rejoindre.');
  }

  root.innerHTML = vueInvitation(p, code);
  const barre = root.querySelector('[data-barre]');
  const pct = p.nb_places ? Math.min(100, (Number(p.inscrits) / Number(p.nb_places)) * 100) : 0;
  barre.style.width = `${pct}%`;

  const form = root.querySelector('[data-form]');
  const champ = root.querySelector('#uno-pseudo');
  const bouton = root.querySelector('[data-envoyer]');
  const erreurEl = root.querySelector('[data-erreur]');
  const erreur = (msg) => { erreurEl.textContent = msg; erreurEl.hidden = !msg; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (bouton.disabled) return;
    const pseudo = champ.value.trim();
    if (pseudo.length < 2 || pseudo.length > 24) {
      erreur('Ton pseudo fait entre 2 et 24 caractères.');
      champ.focus();
      return;
    }
    erreur('');
    bouton.disabled = true;
    bouton.textContent = 'Connexion…';
    try {
      const partie = await uno.rejoindreInvite(code, pseudo);
      naviguer(`#partie/${partie || code}`);
    } catch (err) {
      bouton.disabled = false;
      bouton.textContent = 'Rejoindre la partie';
      erreur(erreurTexte(err));
    }
  });
  champ.focus();
}

/**
 * Affiche l'écran de rejoindre pour le code de l'adresse (#rejoindre/CODE).
 * @param {HTMLElement} root Zone d'affichage (#app).
 * @param {{ code: string|null, naviguer: Function }} ctx Code de partie et changement d'écran.
 */
export async function afficher(root, { code, naviguer }) {
  if (!code) return montrerErreur(root, 'Il manque le code de la partie.');
  if (!estInvite()) return rejoindreMembre(root, code, naviguer);
  // Invité déjà inscrit à cette partie : on ouvre directement la salle.
  if (jetonInvite(code)) return naviguer(`#partie/${code}`);
  return rejoindreInvite(root, code, naviguer);
}
