// ===== Humane Gang — Codenames : créer une partie (#creer) =====
/*
 * Rôle : formulaire de création (nom, places de 4 à 20, temps de l'espion, temps de l'équipe, révélation des mots,
 * paquet de mots, partie publique, invités sans compte, annonce Discord) avec le résumé « Ta partie » qui se met à jour
 * à chaque réglage. « Créer la partie » envoie les réglages (ndc.creer) puis ouvre la salle d'attente.
 * L'annonce Discord part dans ndc.creer (api.js) : rien à envoyer ici. Les erreurs d'envoi vont dans un toast.
 * Dépendances : core.js (esc, toast), nom-de-code/api.js (ndc, erreurTexte).
 * Exporte : afficher.
 */
import { esc, toast } from '../../core.js';
import { ndc, erreurTexte } from '../api.js';

const PAQUET = { valeur: 'classique', libelle: 'Classique' };
const T_ESPION = [
  { valeur: 60, libelle: '60 s' }, { valeur: 90, libelle: '90 s' }, { valeur: 120, libelle: '120 s' },
];
const T_EQUIPE = [
  { valeur: 60, libelle: '60 s' }, { valeur: 120, libelle: '120 s' }, { valeur: 0, libelle: 'Sans limite' },
];
const REVELATIONS = [
  { valeur: 'majorite', libelle: "À la majorité de l'équipe", aide: 'Un mot se révèle quand plus de la moitié des agents y posent leur jeton.' },
  { valeur: 'libre', libelle: 'Dès qu\'un agent valide', aide: 'Le premier agent qui valide révèle le mot tout de suite.' },
];

/** Groupe de boutons radio présentés en segments (le texte du choix est le libellé). */
function segments(nom, titre, options, valeur) {
  return `<fieldset class="ndc-cre-groupe">
    <legend>${esc(titre)}</legend>
    <div class="ndc-cre-seg">${options.map((o) => `<label class="ndc-cre-seg-choix">
      <input class="visually-hidden" type="radio" name="${nom}" value="${esc(o.valeur)}"${String(o.valeur) === String(valeur) ? ' checked' : ''}>
      <span>${esc(o.libelle)}</span></label>`).join('')}</div>
  </fieldset>`;
}

/** Révélation des mots : deux choix avec leur explication (radio visibles, sans couleur seule). */
function choixRevelation(valeur) {
  return `<fieldset class="ndc-cre-groupe ndc-cre-large">
    <legend>Révélation des mots</legend>
    <div class="ndc-cre-choix-liste">${REVELATIONS.map((r) => `<label class="ndc-cre-choix">
      <input type="radio" name="validation" value="${esc(r.valeur)}" aria-describedby="ndc-cre-val-${esc(r.valeur)}"${r.valeur === valeur ? ' checked' : ''}>
      <span class="ndc-cre-choix-texte"><strong>${esc(r.libelle)}</strong><span class="ndc-cre-aide" id="ndc-cre-val-${esc(r.valeur)}">${esc(r.aide)}</span></span>
    </label>`).join('')}</div>
  </fieldset>`;
}

/** Interrupteur (case à cocher stylée en bouton), son explication est relue avec lui. */
function interrupteur(nom, titre, aide, coche) {
  return `<label class="ndc-cre-switch">
    <span class="ndc-cre-switch-texte"><strong>${esc(titre)}</strong><span class="ndc-cre-aide" id="ndc-cre-${nom}-aide">${esc(aide)}</span></span>
    <input class="visually-hidden" type="checkbox" role="switch" name="${nom}" aria-describedby="ndc-cre-${nom}-aide"${coche ? ' checked' : ''}>
    <span class="ndc-cre-piste" aria-hidden="true"></span>
  </label>`;
}

/** Ligne du résumé « Ta partie ». */
const ligne = (cle, titre) => `<div class="ndc-cre-resume-ligne"><dt>${esc(titre)}</dt><dd data-r="${cle}"></dd></div>`;

/** Lit les réglages du formulaire. Le temps d'équipe 0 (sans limite) est gardé tel quel. */
function lire(form) {
  const fd = new FormData(form);
  return {
    nom: String(fd.get('nom') || '').trim(),
    nb_places: Number(fd.get('nb_places')) || 12,
    t_espion: Number(fd.get('t_espion')) || 90,
    t_equipe: Number(fd.get('t_equipe') ?? 120),
    validation: fd.get('validation') === 'libre' ? 'libre' : 'majorite',
    paquet: PAQUET.valeur,
    visibilite: fd.has('publique') ? 'publique' : 'privee',
    invites: fd.has('invites'),
    annonce_discord: fd.has('discord'),
  };
}

/** Écrit le résumé « Ta partie » d'après les réglages lus. */
function majResume(root, p) {
  const set = (cle, texte) => { const el = root.querySelector(`[data-r="${cle}"]`); if (el) el.textContent = texte; };
  set('nom', p.nom || 'À nommer');
  set('places', String(p.nb_places));
  set('espion', `${p.t_espion} s`);
  set('equipe', p.t_equipe ? `${p.t_equipe} s` : 'Sans limite');
  set('revelation', p.validation === 'libre' ? "Dès qu'un agent valide" : "À la majorité de l'équipe");
  set('paquet', PAQUET.libelle);
  set('visibilite', p.visibilite === 'publique' ? 'Publique' : 'Privée');
  set('invites', p.invites ? 'Acceptés' : 'Refusés');
  set('discord', p.annonce_discord ? 'Annonce prévue' : "Pas d'annonce");
}

/**
 * Affiche l'écran de création et gère l'envoi.
 * @param {HTMLElement} root Zone d'affichage (#app).
 * @param {{ naviguer: Function }} ctx Changement d'écran (hash).
 */
export async function afficher(root, { naviguer }) {
  root.innerHTML = `
    <nav class="ndc-fil" aria-label="Fil d'Ariane"><a href="jeux.html">Jeux</a> › <a href="nom-de-code.html">Codenames</a> › <span aria-current="page">Créer</span></nav>
    <h1 class="ndc-titre">Créer une partie</h1>
    <p class="ndc-cre-sous">Règle ta partie, puis invite tes joueurs avec le code.</p>

    <form id="ndc-cre-form" class="ndc-cre" novalidate>
      <div class="ndc-cre-grille">
        <div class="ndc-cre-colonne">
          <section class="card ndc-cre-bloc" aria-labelledby="ndc-cre-reglages-titre">
            <h2 id="ndc-cre-reglages-titre" class="ndc-cre-bloc-titre">Réglages</h2>
            <div class="ndc-cre-reglages">
              <div class="ndc-cre-champ ndc-cre-large">
                <label for="ndc-cre-nom">Nom de la partie</label>
                <input id="ndc-cre-nom" class="ndc-cre-input" type="text" name="nom" value="Codenames du dimanche" maxlength="60" autocomplete="off" required>
              </div>

              <div class="ndc-cre-champ ndc-cre-large">
                <div class="ndc-cre-entete">
                  <label for="ndc-cre-places">Nombre de places</label>
                  <output id="ndc-cre-places-val" for="ndc-cre-places">12</output>
                </div>
                <input id="ndc-cre-places" type="range" name="nb_places" min="4" max="20" value="12" aria-describedby="ndc-cre-echelle">
                <div id="ndc-cre-echelle" class="ndc-cre-echelle" aria-hidden="true"><span>4</span><span>20</span></div>
              </div>

              ${segments('t_espion', "Temps de l'espion", T_ESPION, 90)}
              ${segments('t_equipe', "Temps de l'équipe", T_EQUIPE, 120)}
              ${choixRevelation('majorite')}

              <div class="ndc-cre-champ ndc-cre-large ndc-cre-paquet">
                <span class="ndc-cre-label">Paquet de mots</span>
                <div class="ndc-cre-paquet-ligne">
                  <span class="ndc-cre-pastille">${esc(PAQUET.libelle)}</span>
                  <span class="ndc-cre-aide">D'autres paquets viendront.</span>
                </div>
                <input type="hidden" name="paquet" value="${esc(PAQUET.valeur)}">
              </div>
            </div>
          </section>

          <section class="card ndc-cre-bloc" aria-labelledby="ndc-cre-acces-titre">
            <h2 id="ndc-cre-acces-titre" class="ndc-cre-bloc-titre">Accès et annonce</h2>
            <div class="ndc-cre-interrupteurs">
              ${interrupteur('publique', 'Partie publique', 'Elle apparaît dans la liste. Des spectateurs peuvent la suivre sans jouer.', true)}
              ${interrupteur('invites', 'Invités sans compte', 'Des joueurs sans compte peuvent rejoindre avec le lien.', true)}
              ${interrupteur('discord', 'Annoncer sur Discord', 'Publie la partie dans le salon du gang.', false)}
            </div>
          </section>
        </div>

        <aside class="card ndc-cre-resume" aria-labelledby="ndc-cre-resume-titre">
          <h2 id="ndc-cre-resume-titre" class="ndc-cre-bloc-titre">Ta partie</h2>
          <dl class="ndc-cre-resume-liste">
            ${ligne('nom', 'Nom')}
            ${ligne('places', 'Places')}
            ${ligne('espion', "Temps de l'espion")}
            ${ligne('equipe', "Temps de l'équipe")}
            ${ligne('revelation', 'Révélation')}
            ${ligne('paquet', 'Paquet')}
            ${ligne('visibilite', 'Visibilité')}
            ${ligne('invites', 'Invités')}
            ${ligne('discord', 'Discord')}
          </dl>
          <p class="ndc-cre-erreur" data-erreur role="alert" hidden></p>
          <button type="submit" class="btn ndc-cre-bouton" data-envoyer>Créer la partie</button>
          <p class="ndc-cre-aide ndc-cre-centre">Le code de la partie s'affiche ensuite, à donner à tes joueurs.</p>
        </aside>
      </div>
    </form>`;

  const form = root.querySelector('#ndc-cre-form');
  const champNom = root.querySelector('#ndc-cre-nom');
  const curseur = root.querySelector('#ndc-cre-places');
  const sortie = root.querySelector('#ndc-cre-places-val');
  const erreurEl = root.querySelector('[data-erreur]');
  const bouton = root.querySelector('[data-envoyer]');
  let occupe = false;

  /** Affiche ou efface le message d'erreur du formulaire. */
  const erreur = (msg) => { erreurEl.textContent = msg; erreurEl.hidden = !msg; };

  const majTout = () => {
    sortie.textContent = curseur.value;
    majResume(root, lire(form));
  };
  form.addEventListener('input', majTout);
  form.addEventListener('change', majTout);

  /** Envoi : création côté serveur, puis salle d'attente. */
  async function envoyer(e) {
    e.preventDefault();
    if (occupe) return;
    const p = lire(form);
    if (!p.nom) {
      erreur('Donne un nom à la partie.');
      champNom.focus();
      return;
    }
    erreur('');
    occupe = true;
    bouton.disabled = true;
    bouton.textContent = 'Création…';
    try {
      const code = await ndc.creer({
        nom: p.nom,
        visibilite: p.visibilite,
        nb_places: p.nb_places,
        invites: p.invites,
        t_espion: p.t_espion,
        t_equipe: p.t_equipe,
        validation: p.validation,
        paquet: p.paquet,
        annonce_discord: p.annonce_discord,
      });
      if (!code) throw new Error("La partie est créée, mais son code est introuvable. Recharge la page.");
      naviguer(`#partie/${code}`);
    } catch (err) {
      occupe = false;
      bouton.disabled = false;
      bouton.textContent = 'Créer la partie';
      toast(erreurTexte(err), 'error');
    }
  }
  form.addEventListener('submit', envoyer);

  majTout();
}
