// ===== Humane Gang — Loup-Garou : créer une partie (#creer) =====
/*
 * Rôle : formulaire en six cartes numérotées (nom et visibilité, joueurs, meneur, durées, rôles, Discord) avec le résumé
 * de la partie à droite (en bas de l'écran sur téléphone). Les durées et les rôles s'ouvrent dans des fenêtres : rien
 * n'est envoyé au serveur avant « Créer la partie ». La composition doit compter exactement une carte par joueur,
 * plus deux cartes au centre si le Voleur est choisi.
 * Dépendances : core.js (esc), loup-garou/api.js (lg, erreurTexte), loup-garou/ui.js (icone, vignetteRole, ouvrirFenetre,
 *   filAriane), loup-garou/roles.js (ROLES, CAMPS, EXTENSIONS, roleById).
 * Exporte : afficher.
 */
import { esc, notify } from '../../core.js';
import { lg, erreurTexte } from '../api.js';
import { icone, vignetteRole, ouvrirFenetre, filAriane } from '../ui.js';
import { ROLES, CAMPS, EXTENSIONS, roleById } from '../roles.js';

const JOUEURS = { min: 6, max: 50, defaut: 10 };
/** Bornes des curseurs de durée, en secondes : [minimum, maximum, pas]. */
const BORNES = { nuit: [30, 300, 5], jour: [30, 600, 10], vote: [15, 180, 5] };
const DUREES_DEFAUT = { nuit: 90, jour: 180, vote: 60 };
const PREREGLAGES = {
  rapide: { libelle: 'Rapide', nuit: 60, jour: 120, vote: 45 },
  normal: { libelle: 'Normal', nuit: 90, jour: 180, vote: 60 },
  long: { libelle: 'Long', nuit: 120, jour: 300, vote: 90 },
};
/** Rôles sans limite d'exemplaires (ni uniques). */
const SANS_LIMITE = { villageois: JOUEURS.max, 'loup-garou': JOUEURS.max, 'villageois-villageois': JOUEURS.max };
/** Rôles qui vont par paire ou par trio : 0 ou le nombre complet. */
const PAIRES = { 'deux-soeurs': 2, 'trois-freres': 3 };
/** Répartition automatique : nombre minimum de joueurs pour chaque rôle spécial (un exemplaire chacun). */
const SPECIAUX_AUTO = [['voyante', 6], ['sorciere', 8], ['chasseur', 10], ['cupidon', 12]];
const ROLES_ACTIFS = ROLES.filter((r) => r.actif);
const MJ_SEUL = ROLES_ACTIFS.filter((r) => r.mjSeul);
const ORDRE_CAMPS = ['loups', 'village', 'solo'];
const ICONE_CAMP = { loups: 'patte', village: 'maison', solo: 'etoile' };
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const RANG_ROLE = new Map(ROLES_ACTIFS.map((r, i) => [r.id, i]));

/* ---------- Calculs (sans affichage) ---------- */

const carte = (n) => `${n} carte${n === 1 ? '' : 's'}`;
const total = (roles) => Object.values(roles).reduce((s, n) => s + n, 0);
/** Ne garde que les rôles présents (n > 0). */
const positifs = (roles) => Object.fromEntries(Object.entries(roles).filter(([, n]) => n > 0));
const voleurPresent = (roles) => (roles.voleur || 0) > 0;
const resumeDurees = (d) => `Nuit ${d.nuit} s · Débat ${d.jour} s · Vote ${d.vote} s`;

/** Nombre maximal d'exemplaires d'un rôle. */
function maxRole(id) { return PAIRES[id] || SANS_LIMITE[id] || 1; }
/** Valeur après « + » (une paire passe directement à son nombre complet). */
function plus(id, n) { return PAIRES[id] ? PAIRES[id] : Math.min(maxRole(id), n + 1); }
/** Valeur après « − ». */
function moins(id, n) { return PAIRES[id] ? 0 : Math.max(0, n - 1); }

/** Répartition automatique : environ 1 loup pour 4 joueurs (au moins 1), les rôles spéciaux, le reste en Villageois. */
function repartitionAuto(nb) {
  const roles = { 'loup-garou': Math.max(1, Math.floor(nb / 4)) };
  let reste = nb - roles['loup-garou'];
  for (const [id, min] of SPECIAUX_AUTO) {
    if (nb >= min) { roles[id] = 1; reste -= 1; }
  }
  roles.villageois = Math.max(0, reste);
  return positifs(roles);
}

/** Compare le nombre de cartes à celui qu'il faut (un par joueur, plus deux au centre si Voleur). */
function verifier(nb, roles) {
  const t = total(roles);
  const attendu = nb + (voleurPresent(roles) ? 2 : 0);
  if (t === attendu) return { ok: true, total: t, attendu };
  const ecart = Math.abs(attendu - t);
  const message = t < attendu
    ? `Il manque ${carte(ecart)} : ajoute des rôles ou active la répartition automatique.`
    : `Il y a ${carte(ecart)} de trop : retire des rôles.`;
  return { ok: false, total: t, attendu, message };
}

/** Identifiants des rôles présents, par camp puis dans l'ordre du catalogue. */
function ordonnes(roles) {
  const rang = (id) => ORDRE_CAMPS.indexOf(roleById(id).camp);
  return Object.keys(positifs(roles)).sort((a, b) => (rang(a) - rang(b)) || ((RANG_ROLE.get(a) ?? 999) - (RANG_ROLE.get(b) ?? 999)));
}

/** Nom du préréglage qui correspond exactement aux durées, ou null. */
function presetCourant(d) {
  return Object.keys(PREREGLAGES).find((k) => Object.keys(BORNES).every((c) => PREREGLAGES[k][c] === d[c])) || null;
}

/* ---------- Morceaux de HTML ---------- */

/** Rangée de vignettes du formulaire (×n). */
function apercuRoles(roles) {
  const ids = ordonnes(roles);
  if (!ids.length) return '<li class="lg-vide small">Aucun rôle choisi pour l\'instant.</li>';
  return ids.map((id) => `<li class="lg-mini">${vignetteRole(id, 40)}<strong class="lg-mini-n">×${roles[id]}</strong>`
    + `<span class="visually-hidden">${esc(roleById(id).nom)} ×${roles[id]}</span></li>`).join('');
}

/** Liste détaillée du résumé (vignette, nom, ×n). */
function listeResume(roles) {
  const ids = ordonnes(roles);
  if (!ids.length) return '<li class="muted small">Aucun rôle choisi.</li>';
  return ids.map((id) => `<li class="lg-ligne-role">${vignetteRole(id, 32)}<span class="lg-ligne-nom">${esc(roleById(id).nom)}</span>`
    + `<strong>×${roles[id]}</strong></li>`).join('');
}

/** Pastilles des réglages dans le résumé. */
function pastillesResume(etat) {
  return [
    etat.visibilite === 'privee' ? 'Privée, avec code' : 'Publique',
    `${etat.nb} joueurs`,
    etat.invites ? 'Invités acceptés' : 'Invités refusés',
    etat.meneur === 'auto' ? 'Meneur automatique' : 'Meneur humain',
    resumeDurees(etat.duree),
    etat.discord ? 'Discord annoncé' : 'Discord non annoncé',
  ];
}

/** Bilan du résumé : vert si la composition est juste, rose avec l'explication sinon. */
function bilan(etat, v) {
  const detail = `${etat.nb} rôles${voleurPresent(etat.roles) ? ' + 2 cartes au centre' : ''}`;
  const titre = `${v.total} cartes / ${v.attendu}`;
  if (v.ok) {
    return `<div class="lg-bilan ok">${icone('coche', 22)}<div><p class="lg-bilan-titre">${titre}</p>`
      + `<p class="lg-bilan-sous">${esc(detail)}</p></div></div>`;
  }
  return `<div class="lg-bilan ko">${icone('info', 22)}<div><p class="lg-bilan-titre">${titre}</p>`
    + `<p class="lg-bilan-sous">${esc(v.message)}</p></div></div>`;
}

/** Une ligne du catalogue dans la fenêtre des rôles : case, vignette, nom, info, compteur. */
function ligneRole(r) {
  const nom = esc(r.nom);
  const info = `lg-info-${r.id}`;
  return `<div class="lg-cr-role" data-role="${r.id}" data-camp="${r.camp}" data-ext="${esc(r.extension)}">
    <div class="lg-cr-role-ligne">
      <label class="lg-cr-role-nom">
        <input type="checkbox" data-cocher>
        <span class="lg-cr-role-vignette">${vignetteRole(r.id, 36)}</span>
        <span class="lg-cr-role-texte"><strong>${nom}</strong>${r.mjSeul ? '<span class="lg-cr-role-sous">Meneur humain uniquement</span>' : ''}</span>
      </label>
      <button type="button" class="lg-btn-icone" data-info aria-expanded="false" aria-controls="${info}" aria-label="Infos sur ${nom}">${icone('info', 18)}</button>
      <div class="lg-cr-compteur">
        <button type="button" class="lg-btn-icone" data-moins aria-label="Retirer une carte : ${nom}">${icone('moins', 18)}</button>
        <span class="lg-cr-compteur-n" data-n>0</span>
        <button type="button" class="lg-btn-icone" data-plus aria-label="Ajouter une carte : ${nom}">${icone('plus', 18)}</button>
      </div>
    </div>
    <p class="lg-cr-role-info" id="${info}" hidden>${esc(r.description)}</p>
  </div>`;
}

/** Bouton de filtre (extension ou camp). */
function filtreBouton(cle, val, libelle, actif = false, icoCamp = null) {
  return `<button type="button" class="lg-chip" data-filtre="${cle}" data-val="${esc(val)}" aria-pressed="${actif}">`
    + `${icoCamp ? icone(icoCamp, 16) : ''}${esc(libelle)}</button>`;
}

/** Contenu de la fenêtre « Choisir les rôles » (mis à jour ensuite sans être redessiné). */
function contenuRoles() {
  const ext = [filtreBouton('ext', 'toutes', 'Toutes', true), ...EXTENSIONS.map((e) => filtreBouton('ext', e.id, e.label))].join('');
  const camps = [filtreBouton('camp', 'tous', 'Tous les camps', true),
    ...ORDRE_CAMPS.map((c) => filtreBouton('camp', c, CAMPS[c].label, false, ICONE_CAMP[c]))].join('');
  const groupes = ORDRE_CAMPS.map((camp) => `<section class="lg-groupe" data-groupe="${camp}" aria-labelledby="lg-g-${camp}">
      <h3 id="lg-g-${camp}" class="lg-groupe-titre">${icone(ICONE_CAMP[camp], 18)}<span>${esc(CAMPS[camp].label)}</span></h3>
      ${ROLES_ACTIFS.filter((r) => r.camp === camp).map(ligneRole).join('')}
    </section>`).join('');
  return `<div class="lg-cr-roles">
    <div class="lg-cr-roles-haut">
      <div class="lg-cr-roles-bilan"><span class="lg-cr-cartes-total" data-cartes></span><span class="muted small" data-detail></span></div>
      <label class="lg-case"><input type="checkbox" data-auto><span>Répartition automatique équilibrée</span></label>
    </div>
    <p class="lg-bandeau" data-bandeau role="note" hidden>${icone('info', 18)}<span data-bandeau-texte></span></p>
    <div class="lg-cr-filtres">
      <div class="lg-chips" role="group" aria-label="Filtrer par extension">${ext}</div>
      <div class="lg-chips" role="group" aria-label="Filtrer par camp">${camps}</div>
    </div>
    <div class="lg-liste-roles">${groupes}</div>
    <div class="lg-actions"><button type="button" class="btn btn-ghost" data-fermer>Annuler</button>
      <button type="button" class="btn btn-primary" data-valider>Valider la composition</button></div>
  </div>`;
}

/** Contenu de la fenêtre « Durées des phases ». */
function contenuDurees() {
  const champ = (c, titre) => {
    const [min, max, pas] = BORNES[c];
    return `<div class="lg-champ-duree">
      <div class="lg-champ-tete"><label for="lg-d-${c}">${titre}</label><output for="lg-d-${c}" data-sortie="${c}"></output></div>
      <input id="lg-d-${c}" class="lg-curseur" type="range" min="${min}" max="${max}" step="${pas}" data-duree="${c}">
    </div>`;
  };
  const boutons = Object.entries(PREREGLAGES).map(([k, p]) => `<button type="button" class="lg-segment-bouton" data-preset="${k}" aria-pressed="false">${esc(p.libelle)}</button>`).join('');
  return `<div class="lg-durees">
    ${champ('nuit', 'Nuit')}
    ${champ('jour', 'Débat de jour')}
    ${champ('vote', 'Vote')}
    <div class="lg-prereglages">
      <span class="lg-champ-titre" id="lg-pre-titre">Préréglage</span>
      <div class="lg-segment lg-segment-trois" role="group" aria-labelledby="lg-pre-titre">${boutons}</div>
    </div>
    <p class="lg-info">${icone('info', 18)}<span>Le meneur automatique passe à la phase suivante dès que tout le monde a joué.</span></p>
    <div class="lg-actions"><button type="button" class="btn btn-ghost" data-fermer>Annuler</button>
      <button type="button" class="btn btn-primary" data-valider>Valider</button></div>
  </div>`;
}

/** Page : six cartes à gauche, résumé à droite (en bas de l'écran sur téléphone). */
function squelette(etat) {
  const mjTexte = MJ_SEUL.map((r) => r.nom).join(', ');
  const visibilite = (val, libelle) => `<button type="button" class="lg-segment-bouton" data-visibilite="${val}" aria-pressed="${etat.visibilite === val}">${libelle}</button>`;
  return `<section class="lg-creer" aria-labelledby="lg-titre">
    ${filAriane('Créer une partie')}
    <h1 id="lg-titre" class="lg-titre display">Créer une partie</h1>
    <div class="lg-creer-grille">
      <form class="lg-creer-form" id="lg-form" aria-label="Réglages de la partie">

        <section class="card lg-cr-carte" aria-labelledby="lg-c1">
          <header class="lg-cr-carte-tete"><span class="lg-num" aria-hidden="true">1</span><h2 id="lg-c1">Nom de la partie</h2></header>
          <label class="visually-hidden" for="lg-nom">Nom de la partie</label>
          <input id="lg-nom" class="lg-champ" type="text" value="${esc(etat.nom)}" autocomplete="off">
          <div class="lg-segment" role="group" aria-label="Visibilité">
            ${visibilite('privee', 'Privée, avec code')}${visibilite('publique', 'Publique')}
          </div>
        </section>

        <section class="card lg-cr-carte" aria-labelledby="lg-c2">
          <header class="lg-cr-carte-tete"><span class="lg-num" aria-hidden="true">2</span><h2 id="lg-c2">Joueurs</h2></header>
          <div class="lg-nombre-ligne">
            <label class="visually-hidden" for="lg-curseur">Curseur du nombre de joueurs</label>
            <input id="lg-curseur" class="lg-curseur" type="range" min="${JOUEURS.min}" max="${JOUEURS.max}" step="1" value="${etat.nb}">
            <label class="visually-hidden" for="lg-nombre">Nombre de joueurs</label>
            <input id="lg-nombre" class="lg-nombre" type="number" min="${JOUEURS.min}" max="${JOUEURS.max}" step="1" value="${etat.nb}" inputmode="numeric">
          </div>
          <label class="lg-case"><input type="checkbox" id="lg-invites"${etat.invites ? ' checked' : ''}><span>Accepter les invités (amis sans compte)</span></label>
        </section>

        <section class="card lg-cr-carte" aria-labelledby="lg-c3">
          <header class="lg-cr-carte-tete"><span class="lg-num" aria-hidden="true">3</span><h2 id="lg-c3">Meneur</h2></header>
          <div class="lg-choix-grille">
            <label class="lg-choix">
              <span class="lg-choix-tete"><input type="radio" name="lg-meneur" value="auto"${etat.meneur === 'auto' ? ' checked' : ''}><strong>Meneur automatique</strong></span>
              <span class="lg-choix-texte">Le site gère les phases. ${MJ_SEUL.length} rôles indisponibles : ${esc(mjTexte)}.</span>
            </label>
            <label class="lg-choix">
              <span class="lg-choix-tete"><input type="radio" name="lg-meneur" value="humain"${etat.meneur === 'humain' ? ' checked' : ''}><strong>Meneur humain</strong></span>
              <span class="lg-choix-texte">Une personne anime sans jouer et voit tous les rôles.</span>
            </label>
          </div>
        </section>

        <section class="card lg-cr-carte" aria-labelledby="lg-c4">
          <header class="lg-cr-carte-tete lg-cr-carte-tete-action">
            <div class="lg-cr-carte-titre"><span class="lg-num" aria-hidden="true">4</span><h2 id="lg-c4">Durées</h2></div>
            <button type="button" class="btn btn-ghost lg-bouton-pilule" data-durees>${icone('horloge', 18)}Modifier les durées</button>
          </header>
          <p class="lg-resume-ligne" id="lg-duree-resume"></p>
        </section>

        <section class="card lg-cr-carte" aria-labelledby="lg-c5">
          <header class="lg-cr-carte-tete lg-cr-carte-tete-action">
            <div class="lg-cr-carte-titre"><span class="lg-num" aria-hidden="true">5</span><h2 id="lg-c5">Rôles</h2></div>
            <button type="button" class="btn btn-ghost lg-bouton-pilule" data-roles>${icone('cartes', 18)}Choisir les rôles</button>
          </header>
          <div class="lg-ligne-valide">
            <p class="lg-resume-ligne" id="lg-cr-roles-nb"></p>
            <div id="lg-cr-roles-valide"></div>
          </div>
          <ul class="lg-apercu" id="lg-cr-roles-apercu" aria-label="Rôles choisis"></ul>
        </section>

        <section class="card lg-cr-carte" aria-labelledby="lg-c6">
          <header class="lg-cr-carte-tete"><span class="lg-num" aria-hidden="true">6</span><h2 id="lg-c6">Discord</h2></header>
          <div class="lg-ligne-discord">
            <div class="lg-ligne-discord-texte">
              <strong>Annoncer la partie sur le Discord du gang</strong>
              <span class="muted small">Le bot publie le code et le lien dans le salon des jeux.</span>
            </div>
            <label class="lg-switch">
              <input type="checkbox" role="switch" id="lg-discord" aria-label="Annoncer la partie sur le Discord du gang"${etat.discord ? ' checked' : ''}>
              <span class="lg-switch-piste" aria-hidden="true"></span>
            </label>
          </div>
        </section>
      </form>

      <aside class="card lg-resume" aria-label="Résumé de la partie">
        <div class="lg-resume-tete">
          <h2 class="lg-resume-titre display">Ta partie</h2>
          <p class="muted small" id="lg-resume-nom"></p>
        </div>
        <div class="lg-resume-detail">
          <ul class="lg-pastilles" id="lg-resume-pastilles" aria-label="Réglages"></ul>
          <h3 class="lg-resume-sous">Rôles choisis</h3>
          <ul class="lg-resume-liste" id="lg-resume-liste" aria-label="Rôles choisis"></ul>
        </div>
        <div id="lg-resume-bilan" aria-live="polite"></div>
        <button type="button" class="btn btn-primary lg-creer-bouton" id="lg-creer">Créer la partie</button>
        <p class="lg-alerte" id="lg-creer-erreur" role="alert" hidden></p>
      </aside>
    </div>
  </section>`;
}

/* ---------- Écran ---------- */

export async function afficher(root, { naviguer }) {
  const etat = {
    nom: `Soirée du ${JOURS[new Date().getDay()]}`,
    visibilite: 'privee',
    nb: JOUEURS.defaut,
    invites: true,
    meneur: 'auto',
    duree: { ...DUREES_DEFAUT },
    auto: true,
    roles: repartitionAuto(JOUEURS.defaut),
    discord: false,
    occupe: false,
  };
  root.innerHTML = squelette(etat);
  const $ = (s) => root.querySelector(s);
  const el = {
    form: $('#lg-form'),
    nom: $('#lg-nom'),
    curseur: $('#lg-curseur'),
    nombre: $('#lg-nombre'),
    invites: $('#lg-invites'),
    discord: $('#lg-discord'),
    duree: $('#lg-duree-resume'),
    rolesNb: $('#lg-cr-roles-nb'),
    valide: $('#lg-cr-roles-valide'),
    apercu: $('#lg-cr-roles-apercu'),
    resumeNom: $('#lg-resume-nom'),
    pastilles: $('#lg-resume-pastilles'),
    resumeListe: $('#lg-resume-liste'),
    bilan: $('#lg-resume-bilan'),
    creer: $('#lg-creer'),
    erreur: $('#lg-creer-erreur'),
  };

  /** Met à jour tout le résumé et les états des boutons (sans toucher aux champs en cours de saisie). */
  function majTout() {
    const v = verifier(etat.nb, etat.roles);
    el.duree.textContent = resumeDurees(etat.duree);
    el.rolesNb.textContent = `${carte(v.total)} · ${etat.nb} joueurs${voleurPresent(etat.roles) ? ' + 2 au centre' : ''}`;
    el.apercu.innerHTML = apercuRoles(etat.roles);
    el.valide.innerHTML = v.ok
      ? `<span class="lg-pastille-ok">${icone('coche', 16)}<span>Composition valide</span></span>`
      : `<p class="lg-alerte" role="status">${icone('info', 16)}<span>${esc(v.message)}</span></p>`;
    el.resumeNom.textContent = etat.nom.trim() || 'Sans nom';
    el.pastilles.innerHTML = pastillesResume(etat).map((t) => `<li class="lg-pastille-info">${esc(t)}</li>`).join('');
    el.resumeListe.innerHTML = listeResume(etat.roles);
    el.bilan.innerHTML = bilan(etat, v);
    el.creer.disabled = !v.ok || etat.occupe;
  }

  function erreur(texte) {
    el.erreur.textContent = texte;
    el.erreur.hidden = !texte;
  }

  /* Nom et visibilité */
  el.nom.addEventListener('input', () => { etat.nom = el.nom.value; majTout(); });
  root.querySelectorAll('[data-visibilite]').forEach((b) => b.addEventListener('click', () => {
    etat.visibilite = b.dataset.visibilite;
    root.querySelectorAll('[data-visibilite]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    majTout();
  }));

  /* Joueurs : curseur et champ numérique synchronisés */
  function fixerNombre(n, source) {
    etat.nb = Math.min(JOUEURS.max, Math.max(JOUEURS.min, Math.round(n)));
    el.curseur.value = etat.nb;
    if (source !== 'nombre') el.nombre.value = etat.nb;
    if (etat.auto) etat.roles = repartitionAuto(etat.nb);
    majTout();
  }
  el.curseur.addEventListener('input', () => fixerNombre(Number(el.curseur.value), 'curseur'));
  el.nombre.addEventListener('input', () => {
    const v = Number(el.nombre.value);
    if (Number.isInteger(v) && v >= JOUEURS.min && v <= JOUEURS.max) fixerNombre(v, 'nombre');
  });
  el.nombre.addEventListener('change', () => fixerNombre(Number(el.nombre.value) || etat.nb, 'change'));
  el.invites.addEventListener('change', () => { etat.invites = el.invites.checked; majTout(); });

  /* Meneur : en automatique, les rôles réservés au meneur humain sont retirés */
  root.querySelectorAll('input[name="lg-meneur"]').forEach((r) => r.addEventListener('change', () => {
    etat.meneur = r.value;
    if (etat.meneur === 'auto') {
      etat.roles = Object.fromEntries(Object.entries(etat.roles).filter(([id]) => !roleById(id).mjSeul));
    }
    majTout();
  }));

  /* Discord */
  el.discord.addEventListener('change', () => { etat.discord = el.discord.checked; majTout(); });

  /* Fenêtre des durées */
  function ouvrirDurees() {
    const brouillon = { ...etat.duree };
    const d = ouvrirFenetre('Durées des phases', contenuDurees());
    const majDialogue = () => {
      for (const c of Object.keys(BORNES)) {
        d.querySelector(`[data-duree="${c}"]`).value = brouillon[c];
        d.querySelector(`[data-sortie="${c}"]`).textContent = `${brouillon[c]} s`;
      }
      const actif = presetCourant(brouillon);
      d.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === actif)));
    };
    d.querySelectorAll('[data-duree]').forEach((s) => s.addEventListener('input', () => {
      brouillon[s.dataset.duree] = Number(s.value);
      majDialogue();
    }));
    d.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const p = PREREGLAGES[b.dataset.preset];
      for (const c of Object.keys(BORNES)) brouillon[c] = p[c];
      majDialogue();
    }));
    d.querySelector('[data-valider]').addEventListener('click', () => {
      etat.duree = { ...brouillon };
      majTout();
      d.fermer();
    });
    majDialogue();
  }
  root.querySelector('[data-durees]').addEventListener('click', ouvrirDurees);

  /* Fenêtre des rôles */
  function ouvrirRoles() {
    const b = { roles: { ...etat.roles }, auto: etat.auto };
    const filtres = { ext: 'toutes', camp: 'tous' };
    const d = ouvrirFenetre('Choisir les rôles', contenuRoles(), { large: true });
    const liste = d.querySelector('.lg-liste-roles');
    const lignes = [...d.querySelectorAll('[data-role]')];

    const changer = (id, n) => { b.roles[id] = n; b.auto = false; majRoles(); };

    const majRoles = () => {
      const v = verifier(etat.nb, b.roles);
      const cpt = d.querySelector('[data-cartes]');
      cpt.className = `lg-cr-cartes-total ${v.ok ? 'ok' : 'ko'}`;
      cpt.innerHTML = `${icone(v.ok ? 'coche' : 'info', 20)}<span>${v.total} / ${v.attendu} cartes</span>`;
      d.querySelector('[data-detail]').textContent = `${etat.nb} rôles${voleurPresent(b.roles) ? ' + 2 cartes au centre' : ''}`;
      d.querySelector('[data-auto]').checked = b.auto;
      d.querySelector('[data-bandeau]').hidden = !voleurPresent(b.roles);
      d.querySelector('[data-bandeau-texte]').textContent = `Le Voleur ajoute 2 cartes au centre : il faut ${etat.nb} joueurs + 2 cartes = ${v.attendu} cartes.`;
      for (const ligne of lignes) {
        const id = ligne.dataset.role;
        const n = b.roles[id] || 0;
        const bloque = roleById(id).mjSeul && etat.meneur === 'auto';
        const coche = ligne.querySelector('[data-cocher]');
        coche.checked = n > 0;
        coche.disabled = bloque;
        ligne.querySelector('[data-n]').textContent = n;
        ligne.querySelector('[data-moins]').disabled = bloque || n === 0;
        ligne.querySelector('[data-plus]').disabled = bloque || plus(id, n) === n;
        ligne.classList.toggle('is-bloque', bloque);
      }
    };

    const appliquerFiltres = () => {
      for (const ligne of lignes) {
        const ok = (filtres.ext === 'toutes' || ligne.dataset.ext === filtres.ext)
          && (filtres.camp === 'tous' || ligne.dataset.camp === filtres.camp);
        ligne.hidden = !ok;
      }
      d.querySelectorAll('[data-groupe]').forEach((g) => { g.hidden = !g.querySelector('[data-role]:not([hidden])'); });
    };

    d.querySelector('[data-auto]').addEventListener('change', (e) => {
      b.auto = e.target.checked;
      if (b.auto) b.roles = repartitionAuto(etat.nb);
      majRoles();
    });

    liste.addEventListener('click', (e) => {
      const bouton = e.target.closest('button');
      const ligne = bouton?.closest('[data-role]');
      if (!bouton || !ligne || !liste.contains(bouton)) return;
      const id = ligne.dataset.role;
      if (bouton.hasAttribute('data-info')) {
        const texte = ligne.querySelector('.lg-cr-role-info');
        const ouvert = texte.hidden;
        texte.hidden = !ouvert;
        bouton.setAttribute('aria-expanded', String(ouvert));
        return;
      }
      const n = b.roles[id] || 0;
      if (bouton.hasAttribute('data-plus')) changer(id, plus(id, n));
      else if (bouton.hasAttribute('data-moins')) changer(id, moins(id, n));
    });

    liste.addEventListener('change', (e) => {
      if (!e.target.matches('[data-cocher]')) return;
      const id = e.target.closest('[data-role]').dataset.role;
      changer(id, e.target.checked ? (PAIRES[id] || 1) : 0);
    });

    d.querySelectorAll('[data-filtre]').forEach((btn) => btn.addEventListener('click', () => {
      const cle = btn.dataset.filtre;
      filtres[cle] = btn.dataset.val;
      d.querySelectorAll(`[data-filtre="${cle}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x === btn)));
      appliquerFiltres();
    }));

    d.querySelector('[data-valider]').addEventListener('click', () => {
      etat.roles = positifs(b.roles);
      etat.auto = b.auto;
      majTout();
      d.fermer();
    });

    majRoles();
    appliquerFiltres();
  }
  root.querySelector('[data-roles]').addEventListener('click', ouvrirRoles);

  /* Création */
  async function creer() {
    const nom = etat.nom.trim();
    if (!nom) { erreur('Donne un nom à la partie.'); return; }
    const v = verifier(etat.nb, etat.roles);
    if (!v.ok) { erreur(v.message); return; }
    erreur('');
    etat.occupe = true;
    majTout();
    el.creer.textContent = 'Création…';
    try {
      const retour = await lg.creer({
        nom,
        mode: etat.meneur === 'humain' ? 'mj' : 'auto',
        visibilite: etat.visibilite,
        nb_joueurs: etat.nb,
        invites: etat.invites,
        t_nuit: etat.duree.nuit,
        t_jour: etat.duree.jour,
        t_vote: etat.duree.vote,
        annonce_discord: etat.discord,
        composition: positifs(etat.roles),
      });
      const code = typeof retour === 'string' ? retour : retour?.code;
      if (!code) throw new Error('La partie est créée, mais son code est introuvable. Recharge la page.');
      // Annonce Discord facultative : le bot relit tout en base, un échec ne bloque pas la partie
      if (etat.discord) notify('lg_party', { code });
      naviguer(`#partie/${code}`);
    } catch (err) {
      etat.occupe = false;
      majTout();
      el.creer.textContent = 'Créer la partie';
      erreur(erreurTexte(err));
    }
  }
  el.creer.addEventListener('click', creer);
  el.form.addEventListener('submit', (e) => e.preventDefault());

  majTout();
}
