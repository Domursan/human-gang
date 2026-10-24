// ===== Humane Gang — administration : Loup-Garou (La Fête foraine › Jeux › Loup-Garou) =====
/*
 * Rôle : réglages du Loup-Garou pour l'administrateur, en quatre cartes.
 *   - Récompenses en Paillettes : gain par participation, victoire, survie, MVP et bonus par loup découvert ;
 *     plafond par jour ; nombre minimum de joueurs pour gagner des Paillettes (clé hg_settings.loup_garou).
 *   - Badges Loup-Garou : les badges « lg_* » avec leur nombre de membres. Images et textes se modifient dans Badges.
 *   - Parties : nombre de parties en cours et terminées, lien vers la page du jeu.
 *   - Accès : rappel de la visibilité (administrateurs seulement tant que la page est en mode admin).
 * Droit : administrateur seulement (SECTION_PERM « admin », attribut data-admin-only). Aucune permission Staff.
 * Route : #fete/loup-garou (branchée par admin.js). Section : <section id="loup-garou">, conteneur #loup-garou-root.
 * RPC : hg_lg_admin_reglages() (lecture), hg_lg_admin_enregistrer(p) (écriture serveur, bornée et journalisée).
 * Dépendances : core.js (sb, toast, errMsg, esc), admin/common.js (sectionError, ICON).
 * Exporte : mountLoupGarouSection.
 */
import { sb, toast, errMsg, esc } from './core.js';
import { sectionError, ICON } from './admin/common.js';

/* ---------- Constantes ---------- */

/** Valeurs de repli (celles de la migration 119 : hg_lg__terminer et hg_lg_admin_enregistrer). */
const DEFAUT = Object.freeze({
  paillettes: Object.freeze({ participation: 10, victoire: 30, survie: 10, mvp: 20, loup_decouvert: 5 }),
  plafond_jour: 200,
  min_joueurs_paillettes: 6,
});
/** Bornes serveur : Paillettes 0 à 1000 ; plafond 0 à 100000 ; joueurs minimum 4 à 50. */
const PAILLETTES_MAX = 1000;
const PLAFOND_MAX = 100000;
const MIN_JOUEURS = { min: 4, max: 50 };
/** Lignes du tableau des Paillettes : clé du réglage, libellé. */
const LIGNES = Object.freeze([
  ['participation', 'Participation à une partie terminée'],
  ['victoire', 'Victoire'],
  ['survie', 'Survivre jusqu’à la fin'],
  ['mvp', 'MVP de la partie'],
  ['loup_decouvert', 'Bonus par loup découvert (Voyante)'],
]);

/* ---------- État ---------- */

// root : conteneur ; data : réponse de hg_lg_admin_reglages ; error : message de lecture.
const L = { root: null, data: null };

/* ---------- Montage ---------- */

/**
 * Monte la section Loup-Garou dans son conteneur et lit les réglages.
 * @param {HTMLElement} root Conteneur (#loup-garou-root).
 * @returns {Promise<void>}
 */
export async function mountLoupGarouSection(root) {
  if (!root) return;
  L.root = root;
  if (!root.dataset.lgaBound) {
    root.dataset.lgaBound = '1';
    root.addEventListener('submit', onSubmit);
    root.addEventListener('click', onClick);
  }
  root.innerHTML = '<div class="empty">Chargement du Loup-Garou…</div>';
  await load();
}

/**
 * Lit hg_lg_admin_reglages puis redessine la section. En cas d'erreur, affiche le message et un bouton « Réessayer ».
 * @returns {Promise<void>}
 */
async function load() {
  L.root.setAttribute('aria-busy', 'true');
  const { data, error } = await sb.rpc('hg_lg_admin_reglages');
  L.root.removeAttribute('aria-busy');
  if (error) {
    L.data = null;
    L.root.innerHTML = `${sectionError(error)}<p><button class="btn btn-ghost" type="button" data-lga="retry">Réessayer</button></p>`;
    return;
  }
  L.data = data ?? {};
  render();
}

/* ---------- Affichage ---------- */

/** Nombre avec séparateurs français. */
const nb = (n) => Number(n ?? 0).toLocaleString('fr-CH');
/** « 1 membre », « 4 membres ». */
const membres = (n) => `${nb(n)} ${Number(n) > 1 ? 'membres' : 'membre'}`;

/**
 * Dessine les quatre cartes. Les valeurs du formulaire viennent des réglages lus (ou des valeurs de repli).
 */
function render() {
  const r = L.data?.reglages ?? {};
  const pai = { ...DEFAUT.paillettes, ...(r.paillettes && typeof r.paillettes === 'object' ? r.paillettes : {}) };
  const plafond = r.plafond_jour ?? DEFAUT.plafond_jour;
  const minJoueurs = r.min_joueurs_paillettes ?? DEFAUT.min_joueurs_paillettes;
  const badges = Array.isArray(L.data?.badges) ? L.data.badges : [];
  const parties = L.data?.parties ?? {};

  L.root.innerHTML = `<div class="lga">
    <section class="card lga-card lga-pleine" aria-labelledby="lga-h-pai">
      <h3 id="lga-h-pai" class="lga-titre">Récompenses en Paillettes</h3>
      <form class="lga-form" id="lga-form" novalidate>
        <table class="lga-table">
          <thead><tr><th scope="col">Action</th><th scope="col">Paillettes</th></tr></thead>
          <tbody>
            ${LIGNES.map(([cle, libelle]) => `<tr>
              <th scope="row"><label for="lga-pai-${cle}">${esc(libelle)}</label></th>
              <td><input id="lga-pai-${cle}" class="lga-input lga-input-num" type="number" inputmode="numeric" step="1" min="0" max="${PAILLETTES_MAX}" value="${esc(pai[cle])}"></td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="lga-grille">
          <div class="lga-champ">
            <label for="lga-plafond">Plafond par jour</label>
            <input id="lga-plafond" class="lga-input lga-input-num" type="number" inputmode="numeric" step="1" min="0" max="${PLAFOND_MAX}" value="${esc(plafond)}">
          </div>
          <div class="lga-champ">
            <label for="lga-min-joueurs">Nombre minimum de joueurs pour gagner des Paillettes</label>
            <input id="lga-min-joueurs" class="lga-input lga-input-num" type="number" inputmode="numeric" step="1" min="${MIN_JOUEURS.min}" max="${MIN_JOUEURS.max}" value="${esc(minJoueurs)}">
            <span class="lga-aide">Évite les gains sur les petites parties de test.</span>
          </div>
        </div>
        <p class="lga-note">Les invités ne gagnent rien : pas de Paillettes ni de statistiques.</p>
        <div class="lga-actions">
          <button class="btn btn-primary" type="submit">Enregistrer</button>
          <span id="lga-statut" class="lga-statut" role="status"></span>
        </div>
      </form>
    </section>

    <div class="lga-colonnes">
      <section class="card lga-card" aria-labelledby="lga-h-badges">
        <h3 id="lga-h-badges" class="lga-titre">Badges Loup-Garou</h3>
        ${badges.length ? `<ul class="lga-badges">${badges.map(badgeHtml).join('')}</ul>` : '<p class="muted small">Aucun badge Loup-Garou pour l’instant.</p>'}
        <p class="small muted lga-note">Les images et textes des badges se modifient dans
          <a href="#place/badges">Badges</a>.</p>
      </section>

      <div class="lga-pile">
        <section class="card lga-card" aria-labelledby="lga-h-parties">
          <h3 id="lga-h-parties" class="lga-titre">Parties</h3>
          <dl class="lga-chiffres">
            <div><dt>En cours</dt><dd>${nb(parties.en_cours)}</dd></div>
            <div><dt>Terminées</dt><dd>${nb(parties.terminees)}</dd></div>
          </dl>
          <a class="btn btn-ghost" href="loup-garou.html" target="_blank" rel="noopener">Ouvrir le Loup-Garou<span class="visually-hidden"> (nouvel onglet)</span></a>
        </section>

        <section class="card lga-card" aria-labelledby="lga-h-acces">
          <h3 id="lga-h-acces" class="lga-titre">Accès</h3>
          <p class="small">Le jeu est visible des admins seulement tant que la page « Loup-Garou » est en mode admin
            dans Membres › Accès aux pages.</p>
          <a class="btn btn-ghost" href="#place/acces">Ouvrir Accès aux pages</a>
        </section>
      </div>
    </div>
  </div>`;
}

/**
 * Une ligne de la liste des badges : image (ou médaille), nom, description, nombre de membres.
 * @param {{code: string, nom: string, description: string, image_url: string|null, membres: number}} b
 * @returns {string} HTML.
 */
function badgeHtml(b) {
  const image = b.image_url
    ? `<img src="${esc(b.image_url)}" alt="" width="44" height="44" data-on-error="remove">`
    : '';
  return `<li class="lga-badge">
    <span class="lga-medaille" aria-hidden="true">${image}${ICON.badge}</span>
    <div class="lga-badge-texte">
      <strong>${esc(b.nom)}</strong>
      <span class="small muted">${esc(b.description ?? '')}</span>
    </div>
    <span class="small lga-badge-nb">${esc(membres(b.membres))}</span>
  </li>`;
}

/* ---------- Actions ---------- */

/**
 * Délégation des clics : bouton « Réessayer ».
 * @param {MouseEvent} e
 */
function onClick(e) {
  if (!e.target.closest?.('[data-lga="retry"]')) return;
  L.root.innerHTML = '<div class="empty">Chargement du Loup-Garou…</div>';
  load();
}

/**
 * Envoi du formulaire des Paillettes.
 * @param {SubmitEvent} e
 */
function onSubmit(e) {
  if (e.target.id !== 'lga-form') return;
  e.preventDefault();
  enregistrer(e.target);
}

/**
 * Lit et vérifie les champs. Renvoie le corps à envoyer et, en cas d'erreur, la liste des champs fautifs.
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
  for (const [cle, libelle] of LIGNES) paillettes[cle] = entier(`lga-pai-${cle}`, libelle, 0, PAILLETTES_MAX);
  const plafond_jour = entier('lga-plafond', 'Plafond par jour', 0, PLAFOND_MAX);
  const min_joueurs_paillettes = entier('lga-min-joueurs', 'Nombre minimum de joueurs', MIN_JOUEURS.min, MIN_JOUEURS.max);
  if (erreurs.length) return { p: null, erreurs };
  return { p: { paillettes, plafond_jour, min_joueurs_paillettes }, erreurs };
}

/**
 * Enregistre les Paillettes (RPC hg_lg_admin_enregistrer). Les erreurs de saisie sont signalées dans le formulaire.
 * @param {HTMLFormElement} form
 * @returns {Promise<void>}
 */
async function enregistrer(form) {
  const btn = form.querySelector('button[type="submit"]');
  const statut = form.querySelector('#lga-statut');
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const { p, erreurs } = lire(form);
  if (!p) {
    for (const { id } of erreurs) form.querySelector(`#${id}`)?.setAttribute('aria-invalid', 'true');
    statut.textContent = erreurs[0].message;
    statut.className = 'lga-statut lga-erreur';
    form.querySelector(`#${erreurs[0].id}`)?.focus();
    return;
  }
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  statut.textContent = 'Enregistrement…';
  statut.className = 'lga-statut';
  try {
    const { error } = await sb.rpc('hg_lg_admin_enregistrer', { p });
    if (error) throw error;
    // Réglages gardés en mémoire pour la prochaine lecture de la section (sans redessiner le formulaire).
    L.data = { ...(L.data ?? {}), reglages: { ...(L.data?.reglages ?? {}), ...p } };
    statut.textContent = 'Récompenses enregistrées.';
    statut.className = 'lga-statut lga-ok';
    toast('Récompenses enregistrées', 'ok');
  } catch (err) {
    statut.textContent = `Enregistrement impossible : ${errMsg(err)}`;
    statut.className = 'lga-statut lga-erreur';
    toast(`Paillettes non enregistrées : ${errMsg(err)}`, 'error');
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}
