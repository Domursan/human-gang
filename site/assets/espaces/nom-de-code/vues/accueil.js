// ===== Humane Gang — Codenames : accueil (#, sans adresse de partie) =====
/*
 * Rôle : écran d'accueil de Codenames. En-tête (fil, titre, phrase d'intro, image), bouton « Créer une partie »,
 * rejoindre avec un code (HGNDC-1234 ; « hgndc 1234 » est accepté), « Mes parties » (équipe, « À toi » si c'est mon tour),
 * « Parties publiques » (rafraîchies toutes les 15 s), règles en 4 points et lien vers « Mes statistiques ».
 * Chaque bloc charge ses données à part : une erreur n'empêche pas les autres.
 * Dépendances : core.js (esc, initials), nom-de-code/api.js (ndc, erreurTexte, estInvite, EQUIPES).
 * Exporte : afficher.
 */
import { esc, initials } from '../../../commun/core.js';
import { brancherRejoindre, chargerBloc, suivrePubliques } from '../../../commun/jeux-accueil.js';
import { ndc, erreurTexte, estInvite, EQUIPES } from '../api.js';

/** Intervalle de rafraîchissement des parties publiques (ms). */
const INTERVALLE_PUBLIQUES = 15000;

/** Les quatre règles, en bref. */
const REGLES = [
  'Deux équipes, Jaune et Rose. Chacune a un espion, qui voit la carte secrète, et des agents.',
  "L'espion donne un seul mot et un nombre : le nombre de mots de la carte qu'il vise.",
  "Les agents posent leur jeton sur les mots. Un mot d'une autre couleur, ou un passant, finit le tour.",
  "Trouve tous les mots de ton équipe avant les autres. Attention à l'assassin : qui le révèle perd aussitôt.",
];

const nombre = (n) => Number(n || 0).toLocaleString('fr-CH');
const urlPartie = (code) => `#partie/${encodeURIComponent(code)}`;
const urlRejoindre = (code) => `#rejoindre/${encodeURIComponent(code)}`;
const COULEUR_OK = /^#[0-9a-f]{6}$/i;

/** « 4821 », « hgndc 1234 » ou « HGNDC-1234 » donnent « HGNDC-1234 ». Renvoie null si le format ne colle pas. */
function normaliserCode(saisie) {
  const m = String(saisie || '').toUpperCase().replace(/\s+/g, '').match(/^(?:HGNDC-?)?(\d{4})$/);
  return m ? `HGNDC-${m[1]}` : null;
}

/** Pseudo du membre dans sa couleur de profil (couleur refusée si ce n'est pas un hexadécimal à six chiffres). */
function pseudoHtml(nom, couleur) {
  const c = COULEUR_OK.test(couleur || '') ? couleur : '#F2EFEA';
  return `<span class="ndc-acc-pseudo" style="color:${c}">${esc(nom || '?')}</span>`;
}

/** Pastille d'initiales sur la couleur du membre (le texte porte le nom, la couleur n'est qu'un fond). */
function avatarHtml(pseudo, couleur) {
  const fond = COULEUR_OK.test(couleur || '') ? couleur : '#6B6B73';
  return `<span class="ndc-av" style="--ndc-av:${fond}" aria-hidden="true">${esc(initials(pseudo))}</span>`;
}

/** Pastille d'équipe (texte « Jaune » ou « Rose ») ; sans équipe, une étiquette grise. */
function equipeHtml(equipe) {
  const e = EQUIPES[equipe] || null;
  return e ? `<span class="ndc-eq is-${equipe}">${esc(e.nom)}</span>` : '<span class="ndc-acc-tag">Sans équipe</span>';
}

/** Réglages de temps et de révélation d'une partie publique, en une ligne. */
function resumePublique(p) {
  const espion = `espion ${nombre(p.t_espion)} s`;
  const equipe = Number(p.t_equipe) ? `équipe ${nombre(p.t_equipe)} s` : 'équipe sans limite';
  const revelation = p.validation === 'libre' ? 'révélation libre' : 'révélation à la majorité';
  return [espion, equipe, revelation].join(' · ');
}

/* ---------- Blocs ---------- */

function htmlHero() {
  return `<section class="ndc-acc-hero" aria-labelledby="ndc-acc-titre">
    <div class="ndc-acc-hero-texte">
      <span class="ndc-acc-tag ndc-acc-tag-rose">Jeu d'équipes à mots</span>
      <h1 id="ndc-acc-titre" class="ndc-titre ndc-acc-hero-titre">Codenames</h1>
      <p class="ndc-acc-intro">Deux équipes, deux espions, 25 mots. Donne le bon indice à ton équipe et évite l'assassin.</p>
      <div class="ndc-acc-actions">
        <a class="btn ndc-acc-cta ndc-acc-grand" href="#creer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          <span>Créer une partie</span>
        </a>
      </div>
    </div>
    <img class="ndc-acc-image" src="/assets/images/jeux/nom-de-code.webp" alt="" loading="eager" decoding="async">
  </section>`;
}

function htmlRejoindre() {
  return `<section class="card ndc-acc-carte" aria-labelledby="ndc-acc-rejoindre-titre">
    <h2 id="ndc-acc-rejoindre-titre" class="ndc-acc-titre">Rejoindre avec un code</h2>
    <form class="ndc-acc-rejoindre" id="ndc-acc-form" novalidate>
      <label for="ndc-acc-code" class="visually-hidden">Code de partie</label>
      <input id="ndc-acc-code" class="ndc-acc-code" type="text" name="code" placeholder="HGNDC-1234" autocomplete="off"
        autocapitalize="characters" spellcheck="false" aria-describedby="ndc-acc-aide ndc-acc-erreur">
      <button type="submit" class="btn ndc-acc-cta ndc-acc-grand">Rejoindre</button>
    </form>
    <p id="ndc-acc-erreur" class="ndc-acc-erreur" role="alert" hidden></p>
    <p id="ndc-acc-aide" class="ndc-acc-aide">Le code est donné par l'hôte de la partie. Un lien d'invitation fonctionne aussi.</p>
  </section>`;
}

function ligneMaPartie(p) {
  const infos = [
    p.statut === 'attente' ? "Salle d'attente" : 'En cours',
    `${nombre(p.inscrits)} joueur${Number(p.inscrits) > 1 ? 's' : ''}`,
  ];
  if (p.statut === 'en_cours' && !p.a_moi && EQUIPES[p.tour_equipe]) {
    infos.push(`tour de l'équipe ${EQUIPES[p.tour_equipe].nom}`);
  }
  return `<li class="ndc-acc-ligne">
    <div class="ndc-acc-ligne-texte">
      <strong>${esc(p.nom)}</strong>
      <span class="ndc-acc-sous">${esc(infos.join(' · '))}</span>
    </div>
    <span class="ndc-acc-badges">${equipeHtml(p.equipe)}${p.espion ? '<span class="ndc-acc-tag">Espion</span>' : ''}</span>
    ${p.a_moi ? '<span class="ndc-acc-etiquette">À toi</span>' : ''}
    <a class="btn btn-ghost ndc-acc-bouton" href="${esc(urlPartie(p.code))}">Reprendre<span class="visually-hidden"> ${esc(p.nom)}</span></a>
  </li>`;
}

function htmlMesParties(parties) {
  if (!parties.length) return '<p class="ndc-acc-aide">Aucune partie en cours. Crée la tienne ou rejoins une partie avec son code.</p>';
  return `<ul class="ndc-acc-liste">${parties.map(ligneMaPartie).join('')}</ul>`;
}

function lignePublique(p) {
  return `<li class="ndc-acc-ligne">
    ${avatarHtml(p.hote_pseudo, p.hote_couleur)}
    <div class="ndc-acc-ligne-texte">
      <strong>${esc(p.nom)}</strong>
      <span class="ndc-acc-sous">Par ${pseudoHtml(p.hote_pseudo, p.hote_couleur)} · ${esc(resumePublique(p))}</span>
    </div>
    <span class="ndc-acc-nb">${nombre(p.inscrits)}/${nombre(p.nb_places)}<span class="visually-hidden"> joueurs</span></span>
    <a class="btn btn-ghost ndc-acc-bouton" href="${esc(urlRejoindre(p.code))}">Rejoindre<span class="visually-hidden"> ${esc(p.nom)}</span></a>
  </li>`;
}

function htmlPubliques(liste) {
  if (!liste.length) {
    return `<div class="ndc-acc-vide">
      <p>Aucune partie publique pour l'instant.</p>
      <p class="ndc-acc-aide">Lance la tienne : elle apparaîtra ici en direct.</p>
      <a class="btn btn-ghost ndc-acc-bouton" href="#creer">Créer une partie</a>
    </div>`;
  }
  return `<ul class="ndc-acc-liste">${liste.map(lignePublique).join('')}</ul>`;
}

function htmlStats() {
  return `<section class="card ndc-acc-carte" aria-labelledby="ndc-acc-stats-titre">
    <h2 id="ndc-acc-stats-titre" class="ndc-acc-titre">Mes statistiques</h2>
    <p class="ndc-acc-aide">Tes parties, tes victoires, tes meilleurs indices et tes badges.</p>
    <a class="btn btn-ghost ndc-acc-bouton ndc-acc-stats-lien" href="#stats">Voir mes statistiques</a>
  </section>`;
}

function htmlRegles() {
  return `<section class="card ndc-acc-carte ndc-acc-regles" aria-labelledby="ndc-acc-regles-titre">
    <h2 id="ndc-acc-regles-titre" class="ndc-acc-titre">Les règles en bref</h2>
    <ol class="ndc-acc-regles-liste">
      ${REGLES.map((r, i) => `<li><span class="ndc-acc-num" aria-hidden="true">${i + 1}</span><span>${esc(r)}</span></li>`).join('')}
    </ol>
  </section>`;
}

/* ---------- Écran ---------- */

/**
 * Affiche l'accueil de Codenames dans root. Renvoie la fonction de nettoyage (arrêt du rafraîchissement).
 * @param {HTMLElement} root Zone d'affichage (#app).
 * @param {{ naviguer: (hash: string) => void }} ctx Changement d'écran (hash).
 */
export async function afficher(root, { naviguer }) {
  let actif = true;
  const invite = estInvite();

  root.innerHTML = `<div class="ndc-acc">
    <nav class="ndc-fil" aria-label="Fil d'Ariane"><a href="/pages/jeux/jeux.html">Jeux</a> › <span aria-current="page">Codenames</span></nav>
    ${htmlHero()}
    <div class="ndc-acc-grille">
      <div class="ndc-acc-colonne">
        ${htmlRejoindre()}
        <section class="card ndc-acc-carte" aria-labelledby="ndc-acc-encours-titre">
          <h2 id="ndc-acc-encours-titre" class="ndc-acc-titre">Mes parties</h2>
          <div id="ndc-acc-encours" aria-live="polite"><p class="ndc-acc-aide">Chargement…</p></div>
        </section>
      </div>
      <div class="ndc-acc-colonne">
        <section class="card ndc-acc-carte" aria-labelledby="ndc-acc-publiques-titre">
          <div class="ndc-acc-carte-tete">
            <h2 id="ndc-acc-publiques-titre" class="ndc-acc-titre">Parties publiques</h2>
            <span class="ndc-acc-sous" aria-hidden="true">En direct</span>
          </div>
          <div id="ndc-acc-publiques" aria-live="polite"><p class="ndc-acc-aide">Chargement…</p></div>
        </section>
        ${invite ? '' : htmlStats()}
      </div>
    </div>
    ${htmlRegles()}
  </div>`;

  const zoneEnCours = root.querySelector('#ndc-acc-encours');
  const zonePubliques = root.querySelector('#ndc-acc-publiques');
  const formulaire = root.querySelector('#ndc-acc-form');
  const champ = root.querySelector('#ndc-acc-code');
  const erreur = root.querySelector('#ndc-acc-erreur');

  // Rejoindre avec un code : normalisation puis navigation vers l'écran de rejoindre.
  brancherRejoindre({ formulaire, champ, erreur, normaliser: normaliserCode, naviguer, url: urlRejoindre,
    messageErreur: 'Le code ressemble à HGNDC-1234 : quatre chiffres, avec ou sans « HGNDC ».' });

  // Chaque bloc charge ses données à part ; une erreur ne bloque pas les autres.
  chargerBloc({ zone: zoneEnCours, charger: () => ndc.mesParties(), rendre: (p) => htmlMesParties(Array.isArray(p) ? p : []),
    messageErreur: (m) => `<p class="ndc-acc-aide">Tes parties ne sont pas disponibles pour l'instant. ${esc(m)}</p>`,
    erreurTexte, actif: () => actif });
  const arretPubliques = suivrePubliques({ zone: zonePubliques, charger: () => ndc.publiques(),
    rendre: (l) => htmlPubliques(Array.isArray(l) ? l : []), intervalle: INTERVALLE_PUBLIQUES,
    messageErreur: (m) => `<p class="ndc-acc-aide">Liste indisponible pour l'instant. ${esc(m)}</p>`,
    erreurTexte, actif: () => actif });

  return () => {
    actif = false;
    arretPubliques();
  };
}
