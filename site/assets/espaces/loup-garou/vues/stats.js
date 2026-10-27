// ===== Humane Gang — Loup-Garou : mes statistiques (#stats) =====
/*
 * Rôle : statistiques du membre connecté : en-tête du profil, tuiles (parties, victoires, survie moyenne, Paillettes),
 * victoires par camp, rôles joués, badges Loup-Garou (obtenus ou verrouillés) et dernières parties.
 * Les états vides (nouveau joueur) ont leur propre message. La survie moyenne est exprimée en jours (une manche = une nuit et un jour).
 * Dépendances : core.js (esc, getProfile), loup-garou/api.js (lg, erreurTexte), loup-garou/roles.js (CAMPS, ROLES, roleById),
 *   loup-garou/ui.js (icone, filAriane, avatar, pseudo, vignetteRole).
 * Exporte : afficher.
 */
import { esc, getProfile } from '../../../commun/core.js';
import { lg, erreurTexte } from '../api.js';
import { CAMPS, ROLES, roleById } from '../roles.js';
import { icone, filAriane, avatar, pseudo, vignetteRole } from '../ui.js';

/** Camps dans l'ordre d'affichage : clé, icône, libellé. */
const CAMPS_STATS = [
  { cle: 'village', icone: 'maison', titre: 'Village' },
  { cle: 'loups', icone: 'patte', titre: 'Loups-garous' },
  { cle: 'solo', icone: 'etoile', titre: 'Solitaires' },
];

const nombre = (n) => Number(n || 0).toLocaleString('fr-CH');
const pourcent = (part, total) => (total ? Math.round((Number(part) / Number(total)) * 100) : 0);

/** Date lisible en français suisse ; chaîne vide si la date n'est pas valable. */
function date(valeur, options) {
  const t = new Date(valeur);
  return isNaN(t) ? '' : t.toLocaleDateString('fr-CH', options);
}

/* ---------- Blocs ---------- */

function htmlProfil(profil) {
  const nom = profil?.pseudo || 'Joueur';
  const debut = new Date(profil?.joined_on || profil?.created_at || '');
  return `<section class="lg-st-profil" aria-labelledby="lg-st-profil-titre">
    ${avatar({ pseudo: nom, couleur: profil?.color, avatar_url: profil?.avatar_url }, 96)}
    <div class="lg-st-profil-texte">
      <span class="lg-st-eyebrow">Mes statistiques Loup-Garou</span>
      <h1 id="lg-st-profil-titre" class="lg-st-pseudo display">${pseudo({ pseudo: nom, couleur: profil?.color })}</h1>
      ${isNaN(debut) ? '' : `<p class="lg-st-aide">Membre depuis ${debut.getFullYear()}</p>`}
    </div>
  </section>`;
}

function htmlTuiles(s) {
  const parties = Number(s.parties) || 0;
  const victoires = Number(s.victoires) || 0;
  const survie = Number(s.survie_moyenne) || 0;
  const tuiles = [
    { nom: 'Parties', valeur: nombre(parties), sous: 'au total' },
    { nom: 'Victoires', valeur: nombre(victoires), sous: `${pourcent(victoires, parties)} % des parties`, cls: 'vert' },
    {
      nom: 'Survie moyenne',
      valeur: parties ? `${survie.toLocaleString('fr-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} <span class="lg-st-unite">jours</span>` : '–',
      sous: parties ? 'par partie' : 'pas encore de partie',
    },
    { nom: 'Paillettes gagnées', valeur: nombre(s.paillettes), sous: 'monnaie du site', cls: 'or' },
  ];
  return `<div class="lg-st-tuiles">${tuiles.map((t) => `<div class="lg-st-tuile${t.cls ? ` ${t.cls}` : ''}">
      <span class="lg-st-tuile-nom">${esc(t.nom)}</span>
      <strong class="lg-st-grand">${t.valeur}</strong>
      <span class="lg-st-sous">${esc(t.sous)}</span>
    </div>`).join('')}</div>`;
}

function htmlCamps(s) {
  const lignes = CAMPS_STATS
    .map((c) => ({ ...c, ...(s.par_camp?.[c.cle] || {}) }))
    .filter((c) => Number(c.parties) > 0);
  if (!lignes.length) return '<p class="lg-st-aide">Pas encore de partie : les victoires par camp apparaîtront ici.</p>';
  return `<div class="lg-st-camps">${lignes.map((c) => {
    const p = pourcent(c.victoires, c.parties);
    const couleur = CAMPS[c.cle];
    return `<div class="lg-st-camp">
      <div class="lg-st-camp-tete">
        <span class="lg-st-ico" aria-hidden="true" style="background:${couleur.fond};color:${couleur.texte}">${icone(c.icone, 16)}</span>
        <strong class="lg-st-camp-nom">${esc(c.titre)}</strong>
        <span>${nombre(c.victoires)}/${nombre(c.parties)} <span class="lg-st-aide">· ${p} %</span></span>
      </div>
      <div class="lg-st-barre" role="img" aria-label="${esc(c.titre)} : ${p} % de victoires"><span style="width:${p}%;background:${couleur.texte}"></span></div>
    </div>`;
  }).join('')}</div>`;
}

function htmlRoles(s) {
  const liste = s.par_role || [];
  if (!liste.length) return '<p class="lg-st-aide">Joue une partie pour voir les rôles que tu préfères.</p>';
  return `<ul class="lg-st-roles">${liste.map((r) => {
    const p = pourcent(r.victoires, r.parties);
    return `<li class="lg-st-role">
      ${vignetteRole(r.role, 44)}
      <div class="lg-st-role-texte"><strong>${esc(roleById(r.role).nom)}</strong><span class="lg-st-aide">${nombre(r.parties)} ${Number(r.parties) > 1 ? 'parties' : 'partie'}</span></div>
      <span class="lg-st-pilule">${p} % de victoires</span>
    </li>`;
  }).join('')}</ul>`;
}

function htmlBadges(badges) {
  if (!badges?.length) return '<p class="lg-st-aide">Aucun badge pour le moment.</p>';
  return `<ul class="lg-st-badges">${badges.map((b) => {
    const obtenu = !!b.obtenu;
    const medaille = obtenu
      ? (b.image_url
        ? `<img src="${esc(b.image_url)}" alt="" width="72" height="72" loading="lazy" data-on-error="remove">`
        : icone('trophee', 30))
      : icone('cadenas', 26);
    const etat = obtenu ? `Obtenu le ${esc(date(b.obtenu, { day: 'numeric', month: 'long', year: 'numeric' }))}` : 'Verrouillé';
    return `<li class="lg-st-badge ${obtenu ? 'obtenu' : 'verrouille'}">
      <span class="lg-st-medaille">${medaille}</span>
      <strong class="lg-st-badge-nom">${esc(b.nom)}</strong>
      <span class="lg-st-badge-desc">${esc(b.description)}</span>
      <span class="lg-st-badge-etat">${etat}</span>
    </li>`;
  }).join('')}</ul>`;
}

function htmlDernieres(liste) {
  if (!liste?.length) return '<p class="lg-st-aide">Tes parties terminées apparaîtront ici.</p>';
  return `<ul class="lg-st-liste">${liste.map((p) => {
    const gagne = !!p.gagne;
    return `<li class="lg-st-partie">
      <time class="lg-st-date" datetime="${esc(String(p.date || '').slice(0, 10))}">${esc(date(p.date, { day: 'numeric', month: 'short' }))}</time>
      <div class="lg-st-partie-texte"><strong>${esc(p.nom)}</strong><span class="lg-st-aide">Rôle joué : ${esc(roleById(p.role).nom)}</span></div>
      <span class="lg-st-resultat ${gagne ? 'ok' : 'ko'}">${icone(gagne ? 'coche' : 'croix', 14)}${gagne ? 'Victoire' : 'Défaite'}</span>
    </li>`;
  }).join('')}</ul>`;
}

/** Carte à titre : id sert au lien aria-labelledby. */
function carte(id, titre, contenu, lien = '') {
  return `<section class="lg-st-carte" aria-labelledby="${id}">
    <div class="lg-st-tete"><h2 id="${id}" class="lg-st-titre">${esc(titre)}</h2>${lien}</div>
    ${contenu}
  </section>`;
}

function htmlCorps(s) {
  return `${htmlTuiles(s)}
    <div class="lg-st-colonnes">
      <div class="lg-st-colonne">
        ${carte('lg-st-camps-titre', 'Victoires par camp', htmlCamps(s))}
        ${carte('lg-st-roles-titre', 'Rôles joués', htmlRoles(s), `<a class="lg-st-lien" href="#roles">Voir les ${ROLES.length} rôles</a>`)}
      </div>
      <div class="lg-st-colonne">
        ${carte('lg-st-badges-titre', 'Badges Loup-Garou', htmlBadges(s.badges))}
        ${carte('lg-st-dernieres-titre', 'Dernières parties', htmlDernieres(s.dernieres))}
      </div>
    </div>`;
}

/* ---------- Écran ---------- */

/**
 * Affiche les statistiques du membre connecté dans root.
 * @param {HTMLElement} root
 */
export async function afficher(root) {
  root.innerHTML = `${filAriane('Mes statistiques')}<p class="lg-chargement">Chargement de tes statistiques…</p>`;

  const [profil, resultat] = await Promise.all([
    getProfile().catch(() => null),
    lg.stats().then((s) => ({ s, erreur: null }), (erreur) => ({ s: null, erreur })),
  ]);
  const { s, erreur } = resultat;

  let corps;
  if (erreur) {
    corps = `<section class="lg-st-carte"><p>Statistiques indisponibles pour l'instant. ${esc(erreurTexte(erreur))}</p></section>`;
  } else if (!s) {
    corps = '<section class="lg-st-carte"><p>Tes statistiques ne sont pas disponibles pour ton compte.</p></section>';
  } else {
    corps = htmlCorps(s);
  }

  root.innerHTML = `${filAriane('Mes statistiques')}
    <div class="lg-st">
      ${htmlProfil(profil)}
      ${corps}
    </div>`;
}
