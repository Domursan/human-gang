// ===== Humane Gang — administration : Jeux de plateau (La Fête foraine › Jeux › Jeux de plateau) =====
/*
 * Rôle : réglages des cinq jeux de plateau (Cluedo, Shadow Hunters, Destins, Monopoly, Risk), un onglet par jeu.
 * Pour le jeu choisi :
 *   - Accès : rappel de la visibilité (administrateurs seulement tant que la page du jeu est en mode admin).
 *   - Récompenses en Paillettes : partie jouée, victoire, plafond par jour (commun aux cinq jeux).
 *   - Noms et textes : une carte repliable par contenu. Un texte se modifie dans un champ ; une liste (cases, territoires…)
 *     se modifie dans un tableau. Seuls les textes affichés changent ; nombres et règles restent ceux d'origine.
 *     « Rétablir l’origine » remet le contenu par défaut (confirmation).
 *   - Badges du jeu : interrupteur actif / inactif et nombre de membres. Les codes désactivés partent dans badges_inactifs.
 *   - Parties en cours : code, nom, hôte, joueurs, statut, tour de, début ; bouton « Arrêter » (confirmation) ; parties terminées.
 * Droit : administrateur seulement (attribut data-admin-only). Aucune permission Staff.
 * Section : <section id="plateaux">, conteneur #plateaux-root (monté par admin.js).
 * Onglet choisi : paramètre ?jeu= de l'adresse (remplacé sans recharger la page), sinon localStorage.
 * Appels : via plat (/assets/espaces/plateaux/api.js) : adminReglages, adminEnregistrer, adminContenu, adminArreter.
 *   Les écritures sont bornées côté serveur (migration 125) ; ici on vérifie la saisie pour un retour immédiat.
 * Dépendances : core.js (toast, errMsg, esc), admin/common.js (sectionError, ICON), ui-confirm.js (confirmBox),
 *   plateaux/api.js (plat, JEUX).
 * Exporte : mountPlateauxSection.
 */
import { toast, errMsg, esc } from '../../commun/core.js';
import { sectionError, ICON } from './common.js';
import { confirmBox } from '../../commun/ui-confirm.js';
import { plat, JEUX } from '../plateaux/api.js';

/* ---------- Constantes ---------- */

/** Valeurs de repli (celles de la migration 125). */
const DEFAUT_PAI = Object.freeze({ partie: 30, victoire: 80 });
const DEFAUT_PLAFOND = 800;
/** Bornes : Paillettes 0 à 1000 ; plafond 0 à 100000 (comme le serveur). */
const PAILLETTES_MAX = 1000;
const PLAFOND_MAX = 100000;
/** Champs texte modifiables d'un contenu en liste (les autres clés restent en lecture seule). Un texte fait 300 caractères au plus. */
const TEXTE_KEYS = Object.freeze(['nom', 'texte', 'description', 'couleur', 'victoire', 'pouvoir', 'libelle', 'court']);
const TEXTE_MAX = 300;
const LIBELLE_COL = Object.freeze({
  nom: 'Nom', texte: 'Texte', description: 'Description', couleur: 'Couleur',
  victoire: 'Victoire', pouvoir: 'Pouvoir', libelle: 'Libellé', court: 'Court',
});
/** Au-delà de ce nombre de lignes, une liste reçoit un champ de recherche. */
const FILTRE_SEUIL = 12;
const HEX = /^#[0-9a-f]{6}$/i;
const STATUT_NOM = Object.freeze({ attente: 'En attente', en_cours: 'En cours' });
const CLE_JEU = 'hg_plateaux_admin_jeu';

/* ---------- État ---------- */

/*
 * root : conteneur ; jeu : onglet affiché ; data : réponse de hg_plat_admin_reglages pour ce jeu ;
 * demande : numéro de la dernière lecture (ignore les réponses périmées) ;
 * brouillons : modifications non enregistrées par contenu (clé « jeu/cle ») ;
 * filtres : recherche dans les listes (même clé).
 */
const P = { root: null, jeu: 'cluedo', data: null, demande: 0, brouillons: {}, filtres: {} };

let seq = 0;
/** Identifiant unique pour relier un libellé à son champ. */
const uid = (prefixe) => `${prefixe}-${++seq}`;
/** Clé d'un contenu dans les brouillons et les filtres (un contenu par jeu). */
const clef = (cle) => `${P.jeu}/${cle}`;

/* ---------- Montage ---------- */

/**
 * Monte la section Jeux de plateau dans son conteneur et lit les réglages du jeu choisi.
 * @param {HTMLElement} root Conteneur (#plateaux-root).
 * @returns {Promise<void>}
 */
export async function mountPlateauxSection(root) {
  if (!root) return;
  P.root = root;
  if (!root.dataset.platBound) {
    root.dataset.platBound = '1';
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('keydown', onKeydown);
  }
  P.jeu = jeuInitial();
  root.innerHTML = `${onglets()}<div id="plateaux-corps" class="jp-corps" role="tabpanel" aria-labelledby="jp-tab-${P.jeu}"></div>`;
  await charger();
}

/* ---------- Onglets et adresse ---------- */

/** Jeu de départ : paramètre ?jeu= de l'adresse, sinon le dernier choisi, sinon Cluedo. */
function jeuInitial() {
  let id = null;
  try { id = new URL(location.href).searchParams.get('jeu'); } catch { /* adresse illisible */ }
  if (!id || !Object.hasOwn(JEUX, id)) {
    try { id = localStorage.getItem(CLE_JEU); } catch { id = null; }
  }
  return id && Object.hasOwn(JEUX, id) ? id : 'cluedo';
}

/** Mémorise le jeu choisi (adresse et localStorage). Sans effet si le navigateur refuse. */
function memoriser(id) {
  try { localStorage.setItem(CLE_JEU, id); } catch { /* navigation privée stricte */ }
  try {
    const u = new URL(location.href);
    u.searchParams.set('jeu', id);
    history.replaceState(history.state, '', u);
  } catch { /* adresse non modifiable */ }
}

/** Barre des onglets (un bouton par jeu). */
function onglets() {
  return `<div class="jp-onglets" role="tablist" aria-label="Jeux de plateau">${Object.values(JEUX).map((j) => `
    <button class="jp-onglet" type="button" role="tab" id="jp-tab-${j.id}" aria-controls="plateaux-corps"
      aria-selected="${j.id === P.jeu}" tabindex="${j.id === P.jeu ? 0 : -1}" data-plat="jeu" data-jeu="${j.id}">${esc(j.nom)}</button>`).join('')}
  </div>`;
}

/** Change d'onglet : relit les réglages du jeu choisi. */
function choisirOnglet(id) {
  if (!Object.hasOwn(JEUX, id) || id === P.jeu) return;
  P.jeu = id;
  memoriser(id);
  P.root.querySelectorAll('[role="tab"]').forEach((t) => {
    const on = t.dataset.jeu === id;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  });
  const corps = corpsEl();
  if (corps) corps.setAttribute('aria-labelledby', `jp-tab-${id}`);
  charger();
}

/** Flèches, Début et Fin pour passer d'un onglet à l'autre (motif des onglets ARIA). */
function onKeydown(e) {
  const tab = e.target.closest?.('[role="tab"]');
  if (!tab) return;
  const ids = Object.keys(JEUX);
  const i = ids.indexOf(tab.dataset.jeu);
  let n = null;
  if (e.key === 'ArrowRight') n = (i + 1) % ids.length;
  else if (e.key === 'ArrowLeft') n = (i - 1 + ids.length) % ids.length;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = ids.length - 1;
  if (n === null) return;
  e.preventDefault();
  P.root.querySelector(`#jp-tab-${ids[n]}`)?.focus();
  choisirOnglet(ids[n]);
}

const corpsEl = () => P.root?.querySelector('#plateaux-corps');

/* ---------- Chargement ---------- */

/**
 * Lit hg_plat_admin_reglages pour le jeu choisi puis dessine la section. En cas d'erreur, affiche le message et un bouton « Réessayer ».
 * Les réponses qui arrivent après un changement d'onglet sont ignorées.
 * @returns {Promise<void>}
 */
async function charger() {
  const jeu = P.jeu;
  const demande = ++P.demande;
  const corps = corpsEl();
  if (!corps) return;
  corps.innerHTML = `<div class="empty">Chargement de ${esc(JEUX[jeu].nom)}…</div>`;
  corps.setAttribute('aria-busy', 'true');
  let data;
  try {
    data = (await plat.adminReglages(jeu)) ?? {};
  } catch (err) {
    if (demande !== P.demande) return;
    corps.removeAttribute('aria-busy');
    corps.innerHTML = `${sectionError(err)}<p><button class="btn btn-ghost" type="button" data-plat="retry">Réessayer</button></p>`;
    return;
  }
  if (demande !== P.demande) return;
  P.data = data;
  corps.removeAttribute('aria-busy');
  corps.innerHTML = squelette();
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
/** Valeur d'une clé de contenu, en texte lisible. */
const fmt = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));

/**
 * Squelette de la section pour le jeu choisi : accès et Paillettes, contenus, badges, parties.
 * @returns {string} HTML.
 */
function squelette() {
  const j = JEUX[P.jeu];
  const d = P.data ?? {};
  const pai = { ...DEFAUT_PAI, ...(d.paillettes && typeof d.paillettes === 'object' ? d.paillettes : {}) };
  const plafond = d.plafond_jour ?? DEFAUT_PLAFOND;
  const contenus = Array.isArray(d.contenus) ? d.contenus : [];
  const badges = Array.isArray(d.badges) ? d.badges : [];

  return `<div class="jp-grille">
    <section class="card jp-card" aria-labelledby="jp-h-acces">
      <h3 id="jp-h-acces" class="jp-titre">Accès</h3>
      <p class="small">Page visible par les administrateurs seulement tant que la page « ${esc(j.slug)} » est en mode admin
        dans Membres › Accès aux pages.</p>
      <a class="btn btn-ghost" href="#place/acces">Ouvrir Accès aux pages</a>
      <a class="btn btn-ghost" href="${esc(j.page)}">Ouvrir la page ${esc(j.nom)}</a>
    </section>

    <form class="card jp-card" id="jp-reglages" aria-labelledby="jp-h-pai" novalidate>
      <h3 id="jp-h-pai" class="jp-titre">Récompenses en Paillettes</h3>
      <table class="jp-table">
        <thead class="visually-hidden"><tr><th scope="col">Moment</th><th scope="col">Paillettes</th></tr></thead>
        <tbody>
          <tr>
            <th scope="row"><label for="jp-pai-partie">Partie jouée</label></th>
            <td><input id="jp-pai-partie" class="jp-input jp-input-num" type="number" inputmode="numeric" step="1" min="0" max="${PAILLETTES_MAX}" value="${esc(pai.partie)}"></td>
          </tr>
          <tr>
            <th scope="row"><label for="jp-pai-victoire">Victoire</label></th>
            <td><input id="jp-pai-victoire" class="jp-input jp-input-num" type="number" inputmode="numeric" step="1" min="0" max="${PAILLETTES_MAX}" value="${esc(pai.victoire)}"></td>
          </tr>
        </tbody>
      </table>
      <div class="jp-champ">
        <label for="jp-plafond">Plafond par jour</label>
        <input id="jp-plafond" class="jp-input jp-input-num" type="number" inputmode="numeric" step="1" min="0" max="${PLAFOND_MAX}" value="${esc(plafond)}">
        <span class="jp-aide">Commun aux cinq jeux.</span>
      </div>
      <div class="jp-actions">
        <button class="btn btn-primary" type="submit">Enregistrer</button>
        <span class="jp-statut" data-plat-statut="reglages" role="status"></span>
      </div>
    </form>
  </div>

  <section class="jp-bloc" aria-labelledby="jp-h-contenus">
    <h3 id="jp-h-contenus" class="jp-titre">Noms et textes</h3>
    <p class="small muted jp-note">Un contenu modifié porte la pastille « modifié ». « Rétablir l’origine » reprend le texte d’origine.</p>
    <div class="jp-contenus">${contenus.length ? contenus.map((c) => carteContenu(c)).join('') : '<p class="muted small">Aucun nom ni texte pour ce jeu.</p>'}</div>
  </section>

  <section class="card jp-card" aria-labelledby="jp-h-badges">
    <h3 id="jp-h-badges" class="jp-titre">Badges du jeu</h3>
    ${badges.length ? `<ul class="jp-badges">${badges.map(badgeHtml).join('')}</ul>` : '<p class="muted small">Aucun badge pour ce jeu pour l’instant.</p>'}
    <p class="small muted jp-note">Les interrupteurs se valident avec Enregistrer. Les images et textes des badges se modifient dans <a href="#place/badges">Badges</a>.</p>
    <div class="jp-actions">
      <button class="btn btn-primary" type="button" data-plat="enregistrer">Enregistrer</button>
      <span class="jp-statut" data-plat-statut="reglages" role="status"></span>
    </div>
  </section>

  <section class="card jp-card" aria-labelledby="jp-h-parties">
    <div class="jp-entete">
      <h3 id="jp-h-parties" class="jp-titre">Parties en cours</h3>
      <span id="jp-terminees" class="small muted">Parties terminées : ${nb(d.terminees)}</span>
    </div>
    <div id="jp-parties-bloc">${partiesHtml()}</div>
  </section>`;
}

/**
 * Une ligne de la liste des badges : nom, description, nombre de membres, interrupteur actif.
 * @param {{code: string, nom: string, description: string, actif: boolean, membres: number}} b
 * @returns {string} HTML.
 */
function badgeHtml(b) {
  return `<li class="jp-badge">
    <span class="jp-medaille" aria-hidden="true">${ICON.badge}</span>
    <div class="jp-badge-texte">
      <strong>${esc(b.nom)}</strong>
      <span class="small muted">${esc(b.description ?? '')}</span>
      <span class="small muted">${esc(membres(b.membres))}</span>
    </div>
    <label class="switch jp-switch">
      <input type="checkbox" data-plat-badge="${esc(b.code)}" ${b.actif ? 'checked' : ''}>
      <span class="switch-ui" aria-hidden="true"></span>
      <span class="visually-hidden">Badge ${esc(b.nom)} actif</span>
    </label>
  </li>`;
}

/** Tableau des parties en cours (sans le titre). */
function partiesHtml() {
  const parties = Array.isArray(P.data?.parties) ? P.data.parties : [];
  return `<div class="jp-scroll">
    <table class="jp-table jp-parties">
      <thead><tr>
        <th scope="col">Code</th><th scope="col">Nom</th><th scope="col">Hôte</th><th scope="col">Joueurs</th>
        <th scope="col">Statut</th><th scope="col">Tour de</th><th scope="col">Début</th><th scope="col"><span class="visually-hidden">Action</span></th>
      </tr></thead>
      <tbody>${parties.length ? parties.map(partieHtml).join('') : '<tr><td colspan="8" class="muted">Aucune partie en cours.</td></tr>'}</tbody>
    </table>
  </div>`;
}

/** Une ligne du tableau des parties en cours. */
function partieHtml(p) {
  return `<tr>
    <td class="jp-code">${esc(p.code)}</td>
    <td>${esc(p.nom ?? '—')}</td>
    <td>${esc(p.hote_pseudo ?? '—')}</td>
    <td>${nb(p.joueurs)}</td>
    <td>${esc(STATUT_NOM[p.statut] ?? p.statut ?? '—')}</td>
    <td>${esc(p.tour_pseudo ?? '—')}</td>
    <td class="muted">${esc(ilYa(p.started_at))}</td>
    <td class="jp-action"><button class="btn btn-ghost jp-arreter" type="button" data-plat="arreter" data-code="${esc(p.code)}" data-statut="${esc(p.statut)}" aria-label="Arrêter la partie ${esc(p.code)}">Arrêter</button></td>
  </tr>`;
}

/** Redessine seulement le bloc des parties et le nombre de parties terminées. */
function renderParties() {
  const bloc = P.root.querySelector('#jp-parties-bloc');
  if (!bloc) return;
  const t = P.root.querySelector('#jp-terminees');
  if (t) t.textContent = `Parties terminées : ${nb(P.data?.terminees)}`;
  bloc.innerHTML = partiesHtml();
}

/* ---------- Contenus ---------- */

/** Contenu de la liste reçue, par identifiant de clé. */
const contenuDe = (cle) => (Array.isArray(P.data?.contenus) ? P.data.contenus.find((c) => c.cle === cle) : null);

/** Brouillon d'un contenu (modifications non enregistrées), créé à la demande. */
function brouillon(cle) {
  const k = clef(cle);
  if (!P.brouillons[k]) P.brouillons[k] = { texte: undefined, lignes: {} };
  return P.brouillons[k];
}

/** Colonnes d'une liste : clés texte modifiables présentes, puis clés en lecture seule. */
function colonnes(c) {
  const items = c.valeur;
  const edit = TEXTE_KEYS.filter((k) => items.some((it) => typeof it[k] === 'string'));
  const autres = [...new Set(items.flatMap((it) => Object.keys(it)))].filter((k) => k !== 'id' && !edit.includes(k));
  return { edit, autres };
}

/** Valeur d'une cellule : celle du brouillon si elle a été touchée, sinon celle d'origine. */
function valeurCellule(it, k, b) {
  const v = b.lignes[it.id]?.[k];
  return v !== undefined ? v : (it[k] ?? '');
}

/** Lignes visibles d'une liste, selon la recherche (identifiant et textes affichés). */
function filtrer(c, b, f, edit) {
  const q = String(f ?? '').trim().toLowerCase();
  return c.valeur.filter((it) => !q || [it.id, ...edit.map((k) => valeurCellule(it, k, b))].join(' ').toLowerCase().includes(q));
}

/** Une carte repliable par contenu : titre, pastille « modifié », champ (texte) ou tableau (liste), actions. */
function carteContenu(c, ouvert = false) {
  const b = brouillon(c.cle);
  const pastille = c.modifie ? '<span class="jp-pastille">modifié</span>' : '';
  let corps;
  if (typeof c.valeur === 'string') {
    const id = uid('jp-texte');
    const v = b.texte ?? c.valeur;
    corps = `<div class="jp-champ">
      <label for="${id}">Texte</label>
      <input id="${id}" class="jp-input" type="text" maxlength="${TEXTE_MAX}" value="${esc(v)}" data-plat-texte="${esc(c.cle)}">
      <span class="jp-aide">Origine : ${esc(c.defaut)}</span>
    </div>`;
  } else if (Array.isArray(c.valeur) && c.valeur.length) {
    corps = tableauHtml(c, b);
  } else {
    corps = '<p class="muted small">Ce contenu ne se modifie pas ici.</p>';
  }
  return `<details class="card jp-carte"${ouvert ? ' open' : ''} data-plat-contenu="${esc(c.cle)}">
    <summary class="jp-resume"><span>${esc(c.libelle)}</span>${pastille}</summary>
    <div class="jp-contenu-corps">
      ${corps}
      <div class="jp-actions">
        <button class="btn btn-primary" type="button" data-plat="contenu-enregistrer" data-cle="${esc(c.cle)}">Enregistrer</button>
        <button class="btn btn-ghost" type="button" data-plat="contenu-retablir" data-cle="${esc(c.cle)}">Rétablir l’origine</button>
        <span class="jp-statut" role="status"></span>
      </div>
    </div>
  </details>`;
}

/** Tableau d'une liste (avec recherche si elle est longue). */
function tableauHtml(c, b) {
  const { edit, autres } = colonnes(c);
  const f = P.filtres[clef(c.cle)] ?? '';
  const id = uid('jp-filtre');
  const lignes = filtrer(c, b, f, edit);
  const filtre = c.valeur.length > FILTRE_SEUIL
    ? `<div class="jp-champ">
        <label for="${id}">Rechercher dans la liste</label>
        <input id="${id}" class="jp-input" type="search" autocomplete="off" value="${esc(f)}" data-plat-filtre="${esc(c.cle)}">
        <span class="jp-aide" data-plat-compte="${esc(c.cle)}">${nb(lignes.length)} sur ${nb(c.valeur.length)}</span>
      </div>`
    : '';
  return `${filtre}
    <div class="jp-scroll">
      <table class="jp-table jp-liste">
        <thead><tr>
          <th scope="col">Id</th>${edit.map((k) => `<th scope="col">${esc(LIBELLE_COL[k] ?? k)}</th>`).join('')}<th scope="col">Autres champs</th>
        </tr></thead>
        <tbody data-plat-tbody="${esc(c.cle)}">${lignesHtml(c, lignes, edit, autres, b)}</tbody>
      </table>
    </div>`;
}

/** Lignes du tableau d'une liste (ou le message « aucun élément »). */
function lignesHtml(c, lignes, edit, autres, b) {
  if (!lignes.length) return `<tr><td colspan="${edit.length + 2}" class="muted">Aucun élément ne correspond.</td></tr>`;
  return lignes.map((it) => {
    const cellules = edit.map((k) => (typeof it[k] === 'string' ? cellule(c.cle, it, k, b) : '<td class="muted">—</td>')).join('');
    const reste = autres.filter((k) => k in it).map((k) => `<span class="jp-autre">${esc(k)} : ${esc(fmt(it[k]))}</span>`).join('');
    return `<tr><th scope="row" class="jp-id">${esc(it.id)}</th>${cellules}<td class="jp-autres">${reste}</td></tr>`;
  }).join('');
}

/** Une cellule modifiable : champ texte, ou couleur (sélecteur et code hexadécimal liés). */
function cellule(cle, it, k, b) {
  const v = String(valeurCellule(it, k, b));
  const attrs = `data-cle="${esc(cle)}" data-id="${esc(it.id)}" data-k="${k}"`;
  if (k === 'couleur') {
    const hex = HEX.test(v) ? v.toLowerCase() : '#000000';
    return `<td class="jp-couleur"><div class="jp-ligne-couleur">
      <input type="color" value="${esc(hex)}" aria-label="Couleur de ${esc(it.id)}" data-plat-couleur ${attrs}>
      <input class="jp-input jp-hex" type="text" maxlength="7" value="${esc(v)}" aria-label="Code hexadécimal de ${esc(it.id)}" data-plat-hex ${attrs}>
    </div></td>`;
  }
  return `<td><input class="jp-input" type="text" maxlength="${TEXTE_MAX}" value="${esc(v)}" aria-label="${esc(LIBELLE_COL[k] ?? k)} de ${esc(it.id)}" data-plat-cellule ${attrs}></td>`;
}

/** Redessine seulement les lignes d'une liste (recherche) et son compte. */
function rendreLignes(cle) {
  const c = contenuDe(cle);
  const tb = P.root.querySelector(`[data-plat-tbody="${CSS.escape(cle)}"]`);
  if (!c || !tb) return;
  const b = brouillon(cle);
  const { edit, autres } = colonnes(c);
  const lignes = filtrer(c, b, P.filtres[clef(cle)] ?? '', edit);
  tb.innerHTML = lignesHtml(c, lignes, edit, autres, b);
  const compte = P.root.querySelector(`[data-plat-compte="${CSS.escape(cle)}"]`);
  if (compte) compte.textContent = `${nb(lignes.length)} sur ${nb(c.valeur.length)}`;
}

/** Redessine la carte d'un contenu (après enregistrement ou rétablissement), en gardant son état ouvert. */
function renderContenu(cle) {
  const el = P.root.querySelector(`[data-plat-contenu="${CSS.escape(cle)}"]`);
  const c = contenuDe(cle);
  if (!el || !c) return;
  el.outerHTML = carteContenu(c, el.open);
}

/** Message dans la carte d'un contenu. */
function statutCarte(cle, msg, cls = '') {
  const el = P.root.querySelector(`[data-plat-contenu="${CSS.escape(cle)}"] .jp-statut`);
  if (!el) return;
  el.textContent = msg;
  el.className = `jp-statut${cls ? ` ${cls}` : ''}`;
}

/** Marque un champ de liste comme invalide (le sélecteur de couleur renvoie vers le code hexadécimal). */
function marquerChamp(cle, id, k, invalide) {
  const el = [...P.root.querySelectorAll('[data-id][data-k]')]
    .find((x) => x.dataset.cle === cle && x.dataset.id === id && x.dataset.k === k && (k !== 'couleur' || x.hasAttribute('data-plat-hex')));
  if (!el) return;
  if (invalide) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  return el;
}

/** Y a-t-il une modification à enregistrer dans une liste ? */
function aDesChangements(c, b) {
  return Object.entries(b.lignes).some(([id, kv]) => {
    const it = c.valeur.find((x) => x.id === id);
    return !!it && Object.entries(kv).some(([k, v]) => it[k] !== v);
  });
}

/**
 * Construit la liste complète à envoyer (mêmes id, même ordre). Seuls les textes affichés changent.
 * @returns {{liste: object[]}|{erreur: {id: string, k: string, message: string}}}
 */
function construireListe(c, b) {
  let erreur = null;
  const liste = c.valeur.map((it) => {
    const copie = { ...it };
    const ligne = b.lignes[it.id] ?? {};
    for (const k of TEXTE_KEYS) {
      if (ligne[k] === undefined || typeof it[k] !== 'string') continue;
      const v = String(ligne[k]).trim();
      if (!erreur) {
        if (k === 'couleur' && !HEX.test(v)) erreur = { id: it.id, k, message: `Couleur invalide pour ${it.id} : #rrggbb attendu.` };
        else if (k !== 'couleur' && (!v || v.length > TEXTE_MAX)) erreur = { id: it.id, k, message: `Texte vide ou trop long pour ${it.id} (${TEXTE_MAX} caractères au plus).` };
      }
      copie[k] = v;
    }
    return copie;
  });
  return erreur ? { erreur } : { liste };
}

/** Met à jour le contenu gardé en mémoire après enregistrement ou rétablissement. */
function majContenu(cle, v) {
  const c = contenuDe(cle);
  if (!c) return;
  c.valeur = v;
  c.modifie = JSON.stringify(v) !== JSON.stringify(c.defaut);
}

/**
 * Enregistre un contenu (RPC hg_plat_admin_contenu) : un texte, ou la liste complète.
 * @param {string} cle Clé du contenu.
 * @param {HTMLButtonElement} btn Bouton « Enregistrer » de la carte.
 * @returns {Promise<void>}
 */
async function enregistrerContenu(cle, btn) {
  const jeu = P.jeu;
  const c = contenuDe(cle);
  if (!c) return;
  const b = brouillon(cle);
  const carte = P.root.querySelector(`[data-plat-contenu="${CSS.escape(cle)}"]`);
  carte?.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));

  let valeur;
  if (typeof c.valeur === 'string') {
    if (b.texte === undefined || b.texte === c.valeur) return statutCarte(cle, 'Aucun changement à enregistrer.');
    const v = b.texte.trim();
    if (!v || v.length > TEXTE_MAX) {
      const champ = carte?.querySelector('[data-plat-texte]');
      champ?.setAttribute('aria-invalid', 'true');
      champ?.focus();
      return statutCarte(cle, `Texte vide ou trop long (${TEXTE_MAX} caractères au plus).`, 'jp-erreur');
    }
    valeur = v;
  } else if (Array.isArray(c.valeur)) {
    if (!aDesChangements(c, b)) return statutCarte(cle, 'Aucun changement à enregistrer.');
    const r = construireListe(c, b);
    if (r.erreur) {
      const champ = marquerChamp(cle, r.erreur.id, r.erreur.k, true);
      champ?.focus();
      return statutCarte(cle, r.erreur.message, 'jp-erreur');
    }
    valeur = r.liste;
  } else {
    return;
  }

  btn.disabled = true;
  statutCarte(cle, 'Enregistrement…');
  try {
    const nouvelle = await plat.adminContenu(jeu, cle, valeur);
    if (jeu === P.jeu) {
      majContenu(cle, nouvelle ?? c.defaut);
      delete P.brouillons[clef(cle)];
      renderContenu(cle);
    }
    toast(`${c.libelle} enregistré`, 'ok');
  } catch (err) {
    statutCarte(cle, `Enregistrement impossible : ${errMsg(err)}`, 'jp-erreur');
    toast(`Contenu non enregistré : ${errMsg(err)}`, 'error');
    btn.disabled = false;
  }
}

/**
 * Rétablit l'origine d'un contenu après confirmation (RPC hg_plat_admin_contenu avec valeur null).
 * @param {string} cle
 * @param {HTMLButtonElement} btn
 * @returns {Promise<void>}
 */
async function retablirContenu(cle, btn) {
  const jeu = P.jeu;
  const c = contenuDe(cle);
  if (!c) return;
  const ok = await confirmBox(`Rétablir l’origine de « ${c.libelle} » ?`,
    'Les modifications de ce contenu sont perdues et reprennent les textes d’origine.',
    { ok: 'Rétablir', danger: true });
  if (!ok) return;
  btn.disabled = true;
  try {
    const v = await plat.adminContenu(jeu, cle, null);
    if (jeu === P.jeu) {
      majContenu(cle, v ?? c.defaut);
      delete P.brouillons[clef(cle)];
      renderContenu(cle);
    }
    toast(`${c.libelle} rétabli`, 'ok');
  } catch (err) {
    toast(`Rétablissement impossible : ${errMsg(err)}`, 'error');
    btn.disabled = false;
  }
}

/* ---------- Réglages : Paillettes, plafond, badges ---------- */

/** Message sous les deux boutons Enregistrer (Paillettes et badges). */
function statutReglages(msg, cls = '') {
  P.root.querySelectorAll('[data-plat-statut="reglages"]').forEach((el) => {
    el.textContent = msg;
    el.className = `jp-statut${cls ? ` ${cls}` : ''}`;
  });
}

/**
 * Lit et vérifie les champs des Paillettes, du plafond et des badges.
 * @returns {{p: object|null, erreurs: {id: string, message: string}[]}}
 */
function lireReglages() {
  const erreurs = [];
  const entier = (id, libelle, min, max) => {
    const el = P.root.querySelector(`#${id}`);
    const t = String(el?.value ?? '').trim();
    const n = Number(t);
    if (t === '' || !Number.isInteger(n) || n < min || n > max) {
      erreurs.push({ id, message: `${libelle} : un nombre entier entre ${nb(min)} et ${nb(max)}.` });
      return null;
    }
    return n;
  };
  const paillettes = {
    partie: entier('jp-pai-partie', 'Partie jouée', 0, PAILLETTES_MAX),
    victoire: entier('jp-pai-victoire', 'Victoire', 0, PAILLETTES_MAX),
  };
  const plafond_jour = entier('jp-plafond', 'Plafond par jour', 0, PLAFOND_MAX);
  const badges_inactifs = [...P.root.querySelectorAll('input[data-plat-badge]')]
    .filter((el) => !el.checked)
    .map((el) => el.dataset.platBadge);
  if (erreurs.length) return { p: null, erreurs };
  return { p: { paillettes, plafond_jour, badges_inactifs }, erreurs };
}

/**
 * Enregistre les Paillettes, le plafond et les badges du jeu (RPC hg_plat_admin_enregistrer).
 * @param {HTMLButtonElement} btn Bouton Enregistrer cliqué.
 * @returns {Promise<void>}
 */
async function enregistrerReglages(btn) {
  const jeu = P.jeu;
  P.root.querySelectorAll('#jp-reglages [aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const { p, erreurs } = lireReglages();
  if (!p) {
    for (const { id } of erreurs) P.root.querySelector(`#${id}`)?.setAttribute('aria-invalid', 'true');
    statutReglages(erreurs[0].message, 'jp-erreur');
    P.root.querySelector(`#${erreurs[0].id}`)?.focus();
    return;
  }
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  statutReglages('Enregistrement…');
  try {
    await plat.adminEnregistrer(jeu, p);
    if (jeu === P.jeu) {
      P.data = {
        ...(P.data ?? {}),
        paillettes: p.paillettes,
        plafond_jour: p.plafond_jour,
        badges: (P.data?.badges ?? []).map((b) => ({ ...b, actif: !p.badges_inactifs.includes(b.code) })),
      };
    }
    statutReglages('Réglages enregistrés.', 'jp-ok');
    toast('Réglages des jeux de plateau enregistrés', 'ok');
  } catch (err) {
    statutReglages(`Enregistrement impossible : ${errMsg(err)}`, 'jp-erreur');
    toast(`Réglages non enregistrés : ${errMsg(err)}`, 'error');
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

/* ---------- Parties en cours ---------- */

/**
 * Arrête une partie après confirmation (RPC hg_plat_admin_arreter). Une partie en attente est annulée ;
 * une partie en cours s'arrête pour tous ses joueurs.
 * @param {HTMLButtonElement} btn Bouton « Arrêter » de la ligne.
 * @returns {Promise<void>}
 */
async function arreter(btn) {
  const jeu = P.jeu;
  const code = btn.dataset.code;
  const ok = await confirmBox(`Arrêter la partie ${code} ?`,
    btn.dataset.statut === 'attente' ? 'La partie est annulée.' : 'La partie s’arrête pour tous ses joueurs.',
    { ok: 'Arrêter', danger: true });
  if (!ok) return;
  btn.disabled = true;
  try {
    await plat.adminArreter(code);
    toast(`Partie ${code} arrêtée`, 'ok');
    await rafraichirParties(jeu);
  } catch (err) {
    toast(`Arrêt impossible : ${errMsg(err)}`, 'error');
    btn.disabled = false;
  }
}

/** Relit les parties en cours et le nombre de parties terminées du jeu, puis redessine ce seul bloc. */
async function rafraichirParties(jeu) {
  try {
    const d = await plat.adminReglages(jeu);
    if (jeu !== P.jeu) return;
    P.data = { ...(P.data ?? {}), parties: d?.parties ?? [], terminees: d?.terminees ?? 0 };
  } catch (err) {
    toast(`Lecture des parties impossible : ${errMsg(err)}`, 'error');
  }
  if (jeu === P.jeu) renderParties();
}

/* ---------- Actions ---------- */

/**
 * Délégation des clics : onglets, Réessayer, enregistrement des Paillettes et badges, contenus, arrêt d'une partie.
 * @param {MouseEvent} e
 */
function onClick(e) {
  const el = e.target.closest?.('[data-plat]');
  if (!el) return;
  switch (el.dataset.plat) {
    case 'jeu': choisirOnglet(el.dataset.jeu); break;
    case 'retry': charger(); break;
    case 'enregistrer': enregistrerReglages(el); break;
    case 'contenu-enregistrer': enregistrerContenu(el.dataset.cle, el); break;
    case 'contenu-retablir': retablirContenu(el.dataset.cle, el); break;
    case 'arreter': arreter(el); break;
    default: break;
  }
}

/**
 * Saisie : recherche dans une liste, textes, cellules et couleurs. Les valeurs vont dans le brouillon du contenu.
 * @param {Event} e
 */
function onInput(e) {
  const t = e.target;
  if (t.matches?.('[data-plat-filtre]')) {
    const cle = t.dataset.platFiltre;
    P.filtres[clef(cle)] = t.value;
    rendreLignes(cle);
  } else if (t.matches?.('[data-plat-texte]')) {
    brouillon(t.dataset.platTexte).texte = t.value;
  } else if (t.matches?.('[data-plat-cellule]')) {
    setLigne(t, t.value);
    t.removeAttribute('aria-invalid');
  } else if (t.matches?.('[data-plat-couleur]')) {
    const hex = t.parentElement.querySelector('[data-plat-hex]');
    if (hex) { hex.value = t.value; hex.removeAttribute('aria-invalid'); }
    setLigne(t, t.value);
  } else if (t.matches?.('[data-plat-hex]')) {
    const ok = HEX.test(t.value);
    if (ok) {
      const picker = t.parentElement.querySelector('[data-plat-couleur]');
      if (picker) picker.value = t.value.toLowerCase();
      t.removeAttribute('aria-invalid');
    } else {
      t.setAttribute('aria-invalid', 'true');
    }
    setLigne(t, t.value);
  }
}

/** Note la valeur d'une cellule de liste dans le brouillon de son contenu. */
function setLigne(t, v) {
  const b = brouillon(t.dataset.cle);
  if (!b.lignes[t.dataset.id]) b.lignes[t.dataset.id] = {};
  b.lignes[t.dataset.id][t.dataset.k] = v;
}

/**
 * Envoi du formulaire des Paillettes (Entrée dans un champ).
 * @param {SubmitEvent} e
 */
function onSubmit(e) {
  if (e.target.id !== 'jp-reglages') return;
  e.preventDefault();
  enregistrerReglages(e.target.querySelector('button[type="submit"]'));
}
