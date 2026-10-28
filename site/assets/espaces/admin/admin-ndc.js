// ===== Humane Gang — administration : Nom de code (La Fête foraine › Jeux › Nom de code) =====
/*
 * Rôle : réglages de Nom de code pour l'administrateur, en cinq blocs.
 *   - Récompenses en Paillettes : partie terminée, victoire, bonus de l'espion gagnant, plafond par jour,
 *     nombre minimum de joueurs pour être récompensé.
 *   - Badges Nom de code : les badges « ndc_* » avec leur interrupteur actif et leur nombre de membres. Les codes désactivés
 *     partent dans badges_inactifs à l'enregistrement.
 *   - Paquets de mots : liste des paquets, mots du paquet choisi (recherche, actif / inactif, retrait), ajout de mots,
 *     nouveau paquet. Un paquet doit avoir au moins 25 mots actifs pour servir à une partie.
 *   - Parties en cours : code, nom, hôte, joueurs, statut, ancienneté ; bouton « Arrêter » (confirmation) ; nombre de parties terminées.
 *   - Accès : rappel de la visibilité (administrateurs seulement tant que la page « nom-de-code » est en mode admin).
 * Droit : administrateur seulement (attribut data-admin-only). Aucune permission Staff.
 * Route : #fete/nom-de-code (à brancher dans admin.js). Section : <section id="nom-de-code">, conteneur #ndc-root.
 * Appels : via ndc (/assets/espaces/nom-de-code/api.js) : adminReglages, adminEnregistrer, adminArreter, adminMots, adminEnregistrerMots.
 *   Les écritures sont bornées côté serveur (migration 123) ; ici on vérifie la saisie pour un retour immédiat.
 * Dépendances : core.js (toast, errMsg, esc), admin/common.js (sectionError, ICON), ui-confirm.js (confirmBox), nom-de-code/api.js (ndc).
 * Exporte : mountNdcSection.
 */
import { toast, errMsg, esc } from '../../commun/core.js';
import { sectionError, ICON } from './common.js';
import { confirmBox } from '../../commun/ui-confirm.js';
import { ndc } from '../nom-de-code/api.js';
import { foldHtml, compte } from './ui/fold.js';

/* ---------- Constantes ---------- */

/** Valeurs de repli (celles de la migration 123). */
const DEFAUT = Object.freeze({ partie: 30, victoire: 80, bonus_espion: 20, plafond_jour: 800, min_joueurs: 4 });
/** Bornes : Paillettes 0 à 1000 ; plafond 0 à 100000 ; joueurs minimum 4 à 20 (comme le serveur). */
const PAILLETTES_MAX = 1000;
const PLAFOND_MAX = 100000;
const JOUEURS = Object.freeze({ min: 4, max: 20 });
/** Un paquet doit compter au moins 25 mots actifs pour servir à une partie. Un mot fait 24 caractères au plus. */
const MOTS_MIN = 25;
const MOT_MAX = 24;
/** Nom de paquet : minuscules sans accent, chiffres, tirets ; 2 à 30 caractères. */
const PAQUET_REGEX = /^[a-z0-9-]{2,30}$/;
const PAQUET_DEFAUT = 'classique';
/** Lignes du tableau des Paillettes : clé du réglage, libellé. */
const LIGNES = Object.freeze([
  ['partie', 'Partie terminée'],
  ['victoire', 'Victoire'],
  ['bonus_espion', 'Bonus de l’espion gagnant'],
]);
const STATUT_NOM = Object.freeze({ attente: 'En attente', en_cours: 'En cours' });
const EQUIPE_NOM = Object.freeze({ jaune: 'Jaune', rose: 'Rose' });

/* ---------- État ---------- */

/*
 * root : conteneur ; data : réponse de hg_ndc_admin_reglages ; paquets : Map nom -> {actifs, total} ;
 * paquet : paquet affiché ; mots : Map nom -> liste [{mot, actif}] lue sur le serveur ;
 * brouillons : modifications non enregistrées par paquet ({actif: Map, retirer: Set, ajouter: texte}) ;
 * filtre : recherche de mots.
 */
const N = { root: null, data: null, paquets: new Map(), paquet: PAQUET_DEFAUT, mots: new Map(), brouillons: {}, filtre: '' };

/* ---------- Montage ---------- */

/**
 * Monte la section Nom de code dans son conteneur et lit les réglages.
 * @param {HTMLElement} root Conteneur (#ndc-root).
 * @returns {Promise<void>}
 */
export async function mountNdcSection(root) {
  if (!root) return;
  N.root = root;
  if (!root.dataset.ndcBound) {
    root.dataset.ndcBound = '1';
    root.addEventListener('submit', onSubmit);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
  }
  root.innerHTML = '<div class="empty">Chargement de Nom de code…</div>';
  await load();
}

/**
 * Lit hg_ndc_admin_reglages puis dessine la section. En cas d'erreur, affiche le message et un bouton « Réessayer ».
 * Les modifications non enregistrées de la section sont abandonnées à chaque chargement.
 * @returns {Promise<void>}
 */
async function load() {
  N.root.setAttribute('aria-busy', 'true');
  N.mots = new Map();
  N.brouillons = {};
  try {
    N.data = (await ndc.adminReglages()) ?? {};
  } catch (err) {
    N.root.removeAttribute('aria-busy');
    N.data = null;
    N.root.innerHTML = `${sectionError(err)}<p><button class="btn btn-ghost" type="button" data-ndc="retry">Réessayer</button></p>`;
    return;
  }
  N.root.removeAttribute('aria-busy');
  N.paquets = new Map();
  for (const p of Array.isArray(N.data.paquets) ? N.data.paquets : []) {
    N.paquets.set(String(p.paquet), { actifs: Number(p.actifs) || 0, total: Number(p.total) || 0 });
  }
  if (!N.paquets.has(PAQUET_DEFAUT)) N.paquets.set(PAQUET_DEFAUT, { actifs: 0, total: 0 });
  N.root.innerHTML = squelette();
  renderParties();
  renderPaquets();
}

/* ---------- Affichage ---------- */

/** Nombre avec séparateurs français. */
const nb = (n) => Number(n ?? 0).toLocaleString('fr-CH');
/** « 1 membre », « 4 membres ». */
const membres = (n) => `${nb(n)} ${Number(n) > 1 ? 'membres' : 'membre'}`;
/** Ancienneté lisible : « à l’instant », « il y a 42 min », « il y a 1 h 05 », « il y a 2 j ». */
function ilYa(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h ${String(min % 60).padStart(2, '0')}`;
  return `il y a ${Math.floor(h / 24)} j`;
}

/**
 * Squelette de la section : formulaire des Paillettes et badges, puis conteneurs des paquets, des parties et de l'accès.
 * Les valeurs viennent des réglages lus (ou des valeurs de repli).
 * @returns {string} HTML.
 */
function squelette() {
  const d = N.data ?? {};
  const pai = d.paillettes && typeof d.paillettes === 'object' ? d.paillettes : {};
  const val = (cle) => pai[cle] ?? DEFAUT[cle];
  const plafond = d.plafond_jour ?? DEFAUT.plafond_jour;
  const minJoueurs = d.min_joueurs ?? DEFAUT.min_joueurs;
  const badges = Array.isArray(d.badges) ? d.badges : [];

  return `<form class="ndc-colonnes" id="ndc-form" novalidate>
    <section class="card ndc-card">
      ${foldHtml({ cle: 'ndc:pai', titre: 'Récompenses en Paillettes', resume: `plafond de ${nb(plafond)} par jour`, ouvert: true, corps: `
      <table class="ndc-table">
        <thead class="visually-hidden"><tr><th scope="col">Moment</th><th scope="col">Paillettes</th></tr></thead>
        <tbody>
          ${LIGNES.map(([cle, libelle]) => `<tr>
            <th scope="row"><label for="ndc-pai-${cle}">${esc(libelle)}</label></th>
            <td><input id="ndc-pai-${cle}" class="ndc-input ndc-input-num" type="number" inputmode="numeric" step="1" min="0" max="${PAILLETTES_MAX}" value="${esc(val(cle))}"></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="ndc-grille">
        <div class="ndc-champ">
          <label for="ndc-plafond">Plafond par jour</label>
          <input id="ndc-plafond" class="ndc-input ndc-input-num" type="number" inputmode="numeric" step="1" min="0" max="${PLAFOND_MAX}" value="${esc(plafond)}">
        </div>
        <div class="ndc-champ">
          <label for="ndc-min-joueurs">Joueurs minimum pour être récompensé</label>
          <input id="ndc-min-joueurs" class="ndc-input ndc-input-num" type="number" inputmode="numeric" step="1" min="${JOUEURS.min}" max="${JOUEURS.max}" value="${esc(minJoueurs)}">
          <span class="ndc-aide">Entre ${JOUEURS.min} et ${JOUEURS.max}. En dessous de ce nombre, la partie ne rapporte aucune Paillettes.</span>
        </div>
      </div>
      <div class="ndc-actions">
        <button class="btn btn-primary" type="submit">Enregistrer</button>
        <span id="ndc-statut" class="ndc-statut" role="status"></span>
      </div>` })}
    </section>

    <section class="card ndc-card">
      ${foldHtml({ cle: 'ndc:badges', titre: 'Badges Nom de code', resume: compte(badges.length, 'badge'), corps: `
      ${badges.length ? `<ul class="ndc-badges">${badges.map(badgeHtml).join('')}</ul>` : '<p class="muted small">Aucun badge Nom de code pour l’instant.</p>'}
      <p class="small muted ndc-note">Les interrupteurs se désactivent ici, puis se valident avec Enregistrer.
        Les images et textes des badges se modifient dans <a href="#place/badges">Badges</a>.</p>` })}
    </section>
  </form>

  <section class="card ndc-card">
    ${foldHtml({ cle: 'ndc:paquets', titre: 'Paquets de mots', resume: resumePaquets(), corps: '<div id="ndc-paquets-bloc"></div>' })}
  </section>

  <section class="card ndc-card">
    ${foldHtml({ cle: 'ndc:parties', titre: 'Parties en cours', resume: resumeParties(), corps: `
      <div class="ndc-entete">
        <span id="ndc-terminees" class="small muted"></span>
      </div>
      <div id="ndc-parties-bloc"></div>` })}
  </section>

  <section class="card ndc-card" aria-labelledby="ndc-h-acces">
    <h3 id="ndc-h-acces" class="ndc-titre">Accès</h3>
    <p class="small">Page visible par : les administrateurs seulement tant que la page « nom-de-code » est en mode admin
      dans Membres › Accès aux pages.</p>
    <a class="btn btn-ghost" href="#place/acces">Ouvrir Accès aux pages</a>
  </section>`;
}

/**
 * Une ligne de la liste des badges : nom, description, nombre de membres, interrupteur actif.
 * @param {{code: string, nom: string, description: string, actif: boolean, membres: number}} b
 * @returns {string} HTML.
 */
function badgeHtml(b) {
  return `<li class="ndc-badge">
    <span class="ndc-medaille" aria-hidden="true">${ICON.badge}</span>
    <div class="ndc-badge-texte">
      <strong>${esc(b.nom)}</strong>
      <span class="small muted">${esc(b.description ?? '')}</span>
      <span class="small muted">${esc(membres(b.membres))}</span>
    </div>
    <label class="switch ndc-switch">
      <input type="checkbox" data-ndc-badge="${esc(b.code)}" ${b.actif ? 'checked' : ''}>
      <span class="switch-ui" aria-hidden="true"></span>
      <span class="visually-hidden">Badge ${esc(b.nom)} actif</span>
    </label>
  </li>`;
}

/** Résumé de la section « Paquets de mots » : nombre de paquets, dont ceux qui servent à une partie. */
function resumePaquets() {
  const utilisables = [...N.paquets.values()].filter((s) => s.actifs >= MOTS_MIN).length;
  return `${compte(N.paquets.size, 'paquet')}, ${utilisables} utilisable${utilisables > 1 ? 's' : ''}`;
}

/** Résumé de la section « Parties en cours ». */
function resumeParties() {
  const n = Array.isArray(N.data?.parties) ? N.data.parties.length : 0;
  return `${compte(n, 'partie')} en cours`;
}

/** Remplace le résumé d'une section repliable (après un changement de ses données). */
function majResume(cle, texte) {
  const el = N.root?.querySelector(`[data-fold="${cle}"] .acc-fold-res`);
  if (el) el.textContent = `· ${texte}`;
}

/** Dessine le bloc des parties en cours et le nombre de parties terminées. */
function renderParties() {
  const bloc = N.root.querySelector('#ndc-parties-bloc');
  if (!bloc) return;
  const parties = Array.isArray(N.data?.parties) ? N.data.parties : [];
  majResume('ndc:parties', resumeParties());
  N.root.querySelector('#ndc-terminees').textContent = `Parties terminées : ${nb(N.data?.terminees)}`;
  bloc.innerHTML = `<div class="ndc-scroll">
    <table class="ndc-table ndc-parties">
      <thead><tr>
        <th scope="col">Code</th><th scope="col">Nom</th><th scope="col">Hôte</th><th scope="col">Joueurs</th>
        <th scope="col">Statut</th><th scope="col">Tour de</th><th scope="col">Depuis</th><th scope="col"><span class="visually-hidden">Action</span></th>
      </tr></thead>
      <tbody>${parties.length ? parties.map(partieHtml).join('') : '<tr><td colspan="8" class="muted">Aucune partie en cours.</td></tr>'}</tbody>
    </table>
  </div>`;
}

/**
 * Une ligne du tableau des parties en cours.
 * @param {{code: string, nom: string, hote_pseudo: string, joueurs: number, statut: string, tour_equipe: string|null, started_at: string}} p
 * @returns {string} HTML.
 */
function partieHtml(p) {
  return `<tr>
    <td class="ndc-code">${esc(p.code)}</td>
    <td>${esc(p.nom ?? '—')}</td>
    <td>${esc(p.hote_pseudo ?? '—')}</td>
    <td>${nb(p.joueurs)}</td>
    <td>${esc(STATUT_NOM[p.statut] ?? p.statut ?? '—')}</td>
    <td>${esc(EQUIPE_NOM[p.tour_equipe] ?? '—')}</td>
    <td class="muted">${esc(ilYa(p.started_at))}</td>
    <td class="ndc-action"><button class="btn btn-ghost ndc-arreter" type="button" data-ndc="arreter" data-code="${esc(p.code)}" data-statut="${esc(p.statut)}" aria-label="Arrêter la partie ${esc(p.code)}">Arrêter</button></td>
  </tr>`;
}

/* ---------- Paquets de mots ---------- */

/** Paquets triés : « classique » d'abord, puis par ordre alphabétique. */
const paquetsTries = () => [...N.paquets.keys()].sort((a, b) => (a === PAQUET_DEFAUT ? -1 : b === PAQUET_DEFAUT ? 1 : a.localeCompare(b, 'fr')));

/** Dessine le bloc des paquets : liste, nouveau paquet, éditeur du paquet choisi. */
function renderPaquets() {
  const bloc = N.root.querySelector('#ndc-paquets-bloc');
  if (!bloc) return;
  bloc.innerHTML = `<p class="small muted ndc-note">Seul le paquet « ${esc(PAQUET_DEFAUT)} » est proposé à la création d’une partie pour l’instant.</p>
    <ul class="ndc-paquets" id="ndc-liste-paquets" aria-label="Paquets de mots"></ul>
    <div class="ndc-paquet-nouveau">
      <div class="ndc-champ">
        <label for="ndc-nouveau-paquet">Nouveau paquet</label>
        <div class="ndc-ligne">
          <input id="ndc-nouveau-paquet" class="ndc-input" type="text" maxlength="30" autocomplete="off" placeholder="ex. animaux">
          <button class="btn btn-ghost" type="button" data-ndc="nouveau-paquet">Créer le paquet</button>
        </div>
        <span class="ndc-aide">Lettres minuscules sans accent, chiffres et tirets, 2 à 30 caractères. Le paquet existe dès qu’il a des mots.</span>
      </div>
      <span id="ndc-nouveau-statut" class="ndc-statut" role="status"></span>
    </div>
    <div class="ndc-editeur" id="ndc-editeur"></div>`;
  renderListePaquets();
  renderEditeur();
}

/** Redessine seulement la liste des paquets (actifs / total, alerte sous le seuil). */
function renderListePaquets() {
  majResume('ndc:paquets', resumePaquets());
  const ul = N.root.querySelector('#ndc-liste-paquets');
  if (!ul) return;
  ul.innerHTML = paquetsTries().map((p) => {
    const s = N.paquets.get(p) ?? { actifs: 0, total: 0 };
    return `<li class="ndc-paquet">
      <button class="ndc-paquet-bouton" type="button" data-ndc="paquet" data-paquet="${esc(p)}" aria-pressed="${p === N.paquet ? 'true' : 'false'}">
        <strong>${esc(p)}</strong> <span class="small muted">${nb(s.actifs)} actifs sur ${nb(s.total)}</span>
      </button>
      ${s.actifs < MOTS_MIN ? '<span class="ndc-alerte small">Inutilisable</span>' : ''}
    </li>`;
  }).join('');
}

/** Dessine l'éditeur du paquet choisi. Charge ses mots si besoin. */
function renderEditeur() {
  const ed = N.root.querySelector('#ndc-editeur');
  if (!ed) return;
  const p = N.paquet;
  if (!N.mots.has(p)) {
    ed.innerHTML = '<p class="muted small">Chargement des mots…</p>';
    chargerMots(p);
    return;
  }
  const b = brouillon(p);
  ed.innerHTML = `<h4 class="ndc-sous-titre">Mots du paquet « ${esc(p)} »</h4>
    <p class="small muted ndc-note">Seuls les mots cochés peuvent tomber dans une partie.</p>
    <div class="ndc-champ">
      <label for="ndc-recherche">Rechercher un mot</label>
      <input id="ndc-recherche" class="ndc-input" type="search" autocomplete="off" value="${esc(N.filtre)}">
    </div>
    <p id="ndc-compte" class="small ndc-compte"></p>
    <ul class="ndc-mots" id="ndc-mots"></ul>
    <div class="ndc-champ">
      <label for="ndc-ajouter">Ajouter des mots</label>
      <textarea id="ndc-ajouter" class="ndc-input ndc-texte" rows="4" placeholder="Un mot par ligne">${esc(b.ajouter)}</textarea>
      <span class="ndc-aide">Un mot par ligne, ${MOT_MAX} caractères au plus. Un mot déjà présent est réactivé.</span>
    </div>
    <div class="ndc-actions">
      <button class="btn btn-primary" type="button" data-ndc="mots-enregistrer">Enregistrer les mots</button>
      <span id="ndc-mots-statut" class="ndc-statut" role="status"></span>
    </div>`;
  renderMots();
}

/**
 * Lit les mots d'un paquet sur le serveur puis met à jour son compte et son éditeur (si toujours affiché).
 * @param {string} p Nom du paquet.
 * @returns {Promise<boolean>} Vrai si la lecture a réussi.
 */
async function chargerMots(p) {
  try {
    const liste = await ndc.adminMots(p);
    const mots = (Array.isArray(liste) ? liste : []).map((m) => ({ mot: String(m.mot), actif: !!m.actif }));
    N.mots.set(p, mots);
    N.paquets.set(p, { actifs: mots.filter((m) => m.actif).length, total: mots.length });
  } catch (err) {
    if (N.paquet === p) {
      const ed = N.root.querySelector('#ndc-editeur');
      if (ed) ed.innerHTML = sectionError(err);
    }
    return false;
  }
  if (N.paquet === p) {
    renderListePaquets();
    renderEditeur();
  }
  return true;
}

/** Brouillon du paquet (modifications non enregistrées), créé à la demande. */
function brouillon(p) {
  if (!N.brouillons[p]) N.brouillons[p] = { actif: new Map(), retirer: new Set(), ajouter: '' };
  return N.brouillons[p];
}

/** État voulu d'un mot : brouillon s'il a été touché, sinon état du serveur. */
const etatMot = (m, b) => (b.actif.has(m.mot) ? b.actif.get(m.mot) : m.actif);

/** Dessine la liste des mots du paquet choisi, filtrée par la recherche. Le retrait prévu est marqué. */
function renderMots() {
  const ul = N.root.querySelector('#ndc-mots');
  if (!ul) return;
  const liste = N.mots.get(N.paquet) ?? [];
  const b = brouillon(N.paquet);
  const f = N.filtre.trim().toLowerCase();
  const visibles = liste.filter((m) => !f || m.mot.toLowerCase().includes(f));
  ul.innerHTML = visibles.length
    ? visibles.map((m) => motHtml(m, b)).join('')
    : `<li class="muted small">${liste.length ? 'Aucun mot ne correspond.' : 'Aucun mot dans ce paquet.'}</li>`;
  updateCompte();
}

/**
 * Une ligne de la liste des mots : case active, mot, bouton Retirer (ou Annuler le retrait).
 * @param {{mot: string, actif: boolean}} m
 * @param {{actif: Map, retirer: Set}} b Brouillon du paquet.
 * @returns {string} HTML.
 */
function motHtml(m, b) {
  const retire = b.retirer.has(m.mot);
  const actif = !retire && etatMot(m, b);
  return `<li class="ndc-mot${retire ? ' ndc-mot-retire' : ''}">
    <label class="ndc-mot-nom">
      <input type="checkbox" data-ndc-mot="${esc(m.mot)}" ${actif ? 'checked' : ''} ${retire ? 'disabled' : ''}>
      <span>${esc(m.mot)}</span>
    </label>
    ${retire
      ? `<span class="small muted">Retrait prévu</span>
         <button class="btn btn-ghost ndc-mot-action" type="button" data-ndc="annuler-retrait" data-mot="${esc(m.mot)}" aria-label="Annuler le retrait du mot ${esc(m.mot)}">Annuler</button>`
      : `<button class="btn btn-ghost ndc-mot-action" type="button" data-ndc="retirer" data-mot="${esc(m.mot)}" aria-label="Retirer le mot ${esc(m.mot)}">Retirer</button>`}
  </li>`;
}

/** Met à jour le compte des mots actifs et l'alerte sous le seuil (sans redessiner la liste). */
function updateCompte() {
  const el = N.root.querySelector('#ndc-compte');
  if (!el) return;
  const liste = N.mots.get(N.paquet) ?? [];
  const b = brouillon(N.paquet);
  const pourVoir = liste.filter((m) => !b.retirer.has(m.mot));
  const actifs = pourVoir.filter((m) => etatMot(m, b)).length;
  el.innerHTML = `${nb(actifs)} actif${actifs > 1 ? 's' : ''} sur ${nb(pourVoir.length)}`
    + (actifs < MOTS_MIN ? ` <span class="ndc-alerte">Paquet inutilisable : il faut au moins ${MOTS_MIN} mots actifs.</span>` : '');
}

/**
 * Choisit le paquet affiché. Les modifications non enregistrées du paquet quitté sont gardées.
 * @param {string} p
 */
function choisirPaquet(p) {
  if (!p || p === N.paquet) return;
  N.paquet = p;
  N.filtre = '';
  renderPaquets();
}

/** Crée un paquet côté affichage après vérification du nom. Il existe sur le serveur dès son premier mot enregistré. */
function creerPaquet() {
  const input = N.root.querySelector('#ndc-nouveau-paquet');
  const statut = N.root.querySelector('#ndc-nouveau-statut');
  const nom = String(input?.value ?? '').trim().toLowerCase();
  input?.removeAttribute('aria-invalid');
  if (!PAQUET_REGEX.test(nom)) {
    input?.setAttribute('aria-invalid', 'true');
    statut.textContent = 'Nom de paquet invalide : 2 à 30 caractères, lettres minuscules sans accent, chiffres ou tirets.';
    statut.className = 'ndc-statut ndc-erreur';
    input?.focus();
    return;
  }
  if (!N.paquets.has(nom)) N.paquets.set(nom, { actifs: 0, total: 0 });
  N.paquet = nom;
  N.filtre = '';
  renderPaquets();
  N.root.querySelector('#ndc-ajouter')?.focus();
}

/**
 * Retire un mot (retrait prévu jusqu'à l'enregistrement) ou annule ce retrait.
 * @param {string} mot
 * @param {boolean} retirer Vrai pour retirer, faux pour annuler.
 */
function marquerRetrait(mot, retirer) {
  const b = brouillon(N.paquet);
  if (retirer) b.retirer.add(mot); else b.retirer.delete(mot);
  renderMots();
  const cible = N.root.querySelector(`#ndc-mots [data-mot="${CSS.escape(mot)}"]`);
  cible?.focus();
}

/** Forme d'un mot tapé, comme le serveur : espaces retirés, première lettre en majuscule. */
const normaliserMot = (l) => {
  const t = String(l ?? '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};

/**
 * Enregistre les mots du paquet choisi (RPC hg_ndc_admin_enregistrer_mots) : ajouts, retraits, activations et désactivations.
 * Un mot tapé qui existe déjà est réactivé (et son retrait annulé) plutôt qu'ajouté.
 * @returns {Promise<void>}
 */
async function enregistrerMots() {
  const p = N.paquet;
  const liste = N.mots.get(p);
  if (!liste) return;
  const statut = N.root.querySelector('#ndc-mots-statut');
  const btn = N.root.querySelector('[data-ndc="mots-enregistrer"]');
  const b = brouillon(p);
  const existants = new Set(liste.map((m) => m.mot));

  const lignes = [...new Set(b.ajouter.split(/\r?\n/).map(normaliserMot).filter(Boolean))];
  const trop = lignes.find((m) => m.length > MOT_MAX);
  if (trop) {
    statut.textContent = `« ${trop} » dépasse ${MOT_MAX} caractères.`;
    statut.className = 'ndc-statut ndc-erreur';
    N.root.querySelector('#ndc-ajouter')?.focus();
    return;
  }
  const ajouter = [];
  for (const mot of lignes) {
    if (existants.has(mot)) {
      b.actif.set(mot, true);
      b.retirer.delete(mot);
    } else {
      ajouter.push(mot);
    }
  }
  const retirer = [...b.retirer].filter((m) => existants.has(m));
  const activer = [];
  const desactiver = [];
  for (const m of liste) {
    if (b.retirer.has(m.mot)) continue;
    const voulu = etatMot(m, b);
    if (voulu && !m.actif) activer.push(m.mot);
    if (!voulu && m.actif) desactiver.push(m.mot);
  }
  if (!ajouter.length && !retirer.length && !activer.length && !desactiver.length) {
    statut.textContent = 'Aucun changement à enregistrer.';
    statut.className = 'ndc-statut';
    return;
  }

  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  statut.textContent = 'Enregistrement…';
  statut.className = 'ndc-statut';
  try {
    const actifs = await ndc.adminEnregistrerMots(p, { ajouter, retirer, activer, desactiver });
    delete N.brouillons[p];
    const lu = await chargerMots(p);
    const msg = N.root.querySelector('#ndc-mots-statut');
    const n = Number(actifs) || 0;
    if (msg) {
      msg.textContent = lu
        ? `Mots enregistrés. ${nb(n)} mot${n > 1 ? 's' : ''} actif${n > 1 ? 's' : ''} dans « ${p} ».`
        : 'Mots enregistrés. Relire la liste échoue : recharge la section.';
      msg.className = 'ndc-statut ndc-ok';
    }
    toast('Mots enregistrés', 'ok');
  } catch (err) {
    statut.textContent = `Enregistrement impossible : ${errMsg(err)}`;
    statut.className = 'ndc-statut ndc-erreur';
    toast(`Mots non enregistrés : ${errMsg(err)}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
}

/* ---------- Parties en cours ---------- */

/**
 * Arrête une partie après confirmation (RPC hg_ndc_admin_arreter). Une partie en attente est annulée ;
 * une partie en cours s'arrête pour tous ses joueurs.
 * @param {HTMLButtonElement} btn Bouton « Arrêter » de la ligne.
 * @returns {Promise<void>}
 */
async function arreter(btn) {
  const code = btn.dataset.code;
  const ok = await confirmBox(`Arrêter la partie ${code} ?`,
    btn.dataset.statut === 'attente' ? 'La partie est annulée.' : 'La partie s’arrête pour tous ses joueurs.',
    { ok: 'Arrêter', danger: true });
  if (!ok) return;
  btn.disabled = true;
  try {
    await ndc.adminArreter(code);
    toast(`Partie ${code} arrêtée`, 'ok');
    await rafraichirParties();
  } catch (err) {
    toast(`Arrêt impossible : ${errMsg(err)}`, 'error');
    btn.disabled = false;
  }
}

/** Relit les parties en cours et le nombre de parties terminées, puis redessine ce seul bloc. */
async function rafraichirParties() {
  try {
    const d = await ndc.adminReglages();
    N.data = { ...(N.data ?? {}), parties: d?.parties ?? [], terminees: d?.terminees ?? 0 };
  } catch (err) {
    toast(`Lecture des parties impossible : ${errMsg(err)}`, 'error');
  }
  renderParties();
}

/* ---------- Actions ---------- */

/**
 * Délégation des clics : Réessayer, paquets, retrait des mots, enregistrement des mots, arrêt d'une partie.
 * @param {MouseEvent} e
 */
function onClick(e) {
  const el = e.target.closest?.('[data-ndc]');
  if (!el) return;
  switch (el.dataset.ndc) {
    case 'retry':
      N.root.innerHTML = '<div class="empty">Chargement de Nom de code…</div>';
      load();
      break;
    case 'paquet': choisirPaquet(el.dataset.paquet); break;
    case 'nouveau-paquet': creerPaquet(); break;
    case 'retirer': marquerRetrait(el.dataset.mot, true); break;
    case 'annuler-retrait': marquerRetrait(el.dataset.mot, false); break;
    case 'mots-enregistrer': enregistrerMots(); break;
    case 'arreter': arreter(el); break;
    default: break;
  }
}

/**
 * Cases à cocher des mots : note le choix dans le brouillon du paquet et met le compte à jour.
 * @param {Event} e
 */
function onChange(e) {
  const t = e.target;
  if (t.matches?.('input[data-ndc-mot]')) {
    brouillon(N.paquet).actif.set(t.dataset.ndcMot, t.checked);
    updateCompte();
  }
}

/**
 * Recherche de mots et zone d'ajout : gardées dans l'état pour ne pas perdre la saisie.
 * @param {Event} e
 */
function onInput(e) {
  const t = e.target;
  if (t.id === 'ndc-recherche') {
    N.filtre = t.value;
    renderMots();
  } else if (t.id === 'ndc-ajouter') {
    brouillon(N.paquet).ajouter = t.value;
  }
}

/**
 * Envoi du formulaire (Paillettes, plafonds, joueurs minimum, badges).
 * @param {SubmitEvent} e
 */
function onSubmit(e) {
  if (e.target.id !== 'ndc-form') return;
  e.preventDefault();
  enregistrer(e.target);
}

/**
 * Lit et vérifie les champs. Renvoie le corps à envoyer et, en cas d'erreur, la liste des champs fautifs.
 * Les badges désactivés (interrupteur décoché) partent dans badges_inactifs.
 * @param {HTMLFormElement} form
 * @returns {{p: object|null, erreurs: {id: string, message: string}[]}}
 */
function lire(form) {
  const erreurs = [];
  const entier = (id, libelle, min, max) => {
    const el = form.querySelector(`#${id}`);
    const t = String(el?.value ?? '').trim();
    const n = Number(t);
    if (t === '' || !Number.isInteger(n) || n < min || n > max) {
      erreurs.push({ id, message: `${libelle} : un nombre entier entre ${nb(min)} et ${nb(max)}.` });
      return null;
    }
    return n;
  };
  const paillettes = {};
  for (const [cle, libelle] of LIGNES) paillettes[cle] = entier(`ndc-pai-${cle}`, libelle, 0, PAILLETTES_MAX);
  const plafond_jour = entier('ndc-plafond', 'Plafond par jour', 0, PLAFOND_MAX);
  const min_joueurs = entier('ndc-min-joueurs', 'Joueurs minimum', JOUEURS.min, JOUEURS.max);
  const badges_inactifs = [...form.querySelectorAll('input[data-ndc-badge]')]
    .filter((el) => !el.checked)
    .map((el) => el.dataset.ndcBadge);
  if (erreurs.length) return { p: null, erreurs };
  return { p: { paillettes, plafond_jour, min_joueurs, badges_inactifs }, erreurs };
}

/**
 * Enregistre les réglages (RPC hg_ndc_admin_enregistrer). Les erreurs de saisie sont signalées dans le formulaire.
 * @param {HTMLFormElement} form
 * @returns {Promise<void>}
 */
async function enregistrer(form) {
  const btn = form.querySelector('button[type="submit"]');
  const statut = form.querySelector('#ndc-statut');
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const { p, erreurs } = lire(form);
  if (!p) {
    for (const { id } of erreurs) form.querySelector(`#${id}`)?.setAttribute('aria-invalid', 'true');
    statut.textContent = erreurs[0].message;
    statut.className = 'ndc-statut ndc-erreur';
    form.querySelector(`#${erreurs[0].id}`)?.focus();
    return;
  }
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  statut.textContent = 'Enregistrement…';
  statut.className = 'ndc-statut';
  try {
    await ndc.adminEnregistrer(p);
    // Réglages gardés en mémoire pour la prochaine lecture (sans redessiner le formulaire).
    N.data = {
      ...(N.data ?? {}),
      paillettes: p.paillettes,
      plafond_jour: p.plafond_jour,
      min_joueurs: p.min_joueurs,
      badges: (N.data?.badges ?? []).map((b) => ({ ...b, actif: !p.badges_inactifs.includes(b.code) })),
    };
    statut.textContent = 'Réglages enregistrés.';
    statut.className = 'ndc-statut ndc-ok';
    toast('Réglages de Nom de code enregistrés', 'ok');
  } catch (err) {
    statut.textContent = `Enregistrement impossible : ${errMsg(err)}`;
    statut.className = 'ndc-statut ndc-erreur';
    toast(`Réglages Nom de code non enregistrés : ${errMsg(err)}`, 'error');
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}
