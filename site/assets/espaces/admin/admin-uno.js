// ===== Humane Gang — administration : Uno (La Fête foraine › Jeux › Uno) =====
/*
 * Rôle : réglages d'Uno pour l'administrateur, en quatre cartes.
 *   - Récompenses en Paillettes : partie terminée, victoire, bonus par adversaire au-delà de 3, plafond par jour,
 *     nombre minimum de joueurs pour gagner des Paillettes.
 *   - Badges Uno : les badges « uno_* » avec leur interrupteur actif et leur nombre de membres. Les codes désactivés
 *     partent dans badges_inactifs à l'enregistrement.
 *   - Parties en cours : code, hôte, joueurs, joueur dont c'est le tour, ancienneté ; bouton « Arrêter ».
 *   - Accès : rappel de la visibilité (administrateurs seulement tant que la page « uno » est en mode admin).
 * Droit : administrateur seulement (SECTION_PERM « admin », attribut data-admin-only). Aucune permission Staff.
 * Route : #fete/uno (branchée par admin.js). Section : <section id="uno">, conteneur #uno-root.
 * RPC : hg_uno_admin_reglages() (lecture), hg_uno_admin_enregistrer({p}) (écriture bornée côté serveur),
 *       hg_uno_admin_arreter({p_code}) (arrêt d'une partie en cours).
 * Dépendances : core.js (sb, toast, errMsg, esc), admin/common.js (sectionError, ICON), ui-confirm.js (confirmBox).
 * Exporte : mountUnoSection.
 */
import { sb, toast, errMsg, esc } from '../../commun/core.js';
import { sectionError, ICON } from './common.js';
import { confirmBox } from '../../commun/ui-confirm.js';

/* ---------- Constantes ---------- */

/** Valeurs de repli (celles du contrat Uno, migration 121). */
const DEFAUT = Object.freeze({
  paillettes: Object.freeze({ partie: 50, victoire: 150, bonus_adversaire: 10 }),
  plafond_jour: 1000,
  min_joueurs: 2,
});
/** Bornes : Paillettes 0 à 1000 ; plafond 0 à 100000 ; joueurs minimum 2 à 20. */
const PAILLETTES_MAX = 1000;
const PLAFOND_MAX = 100000;
const MIN_JOUEURS = { min: 2, max: 20 };
/** Lignes du tableau des Paillettes : clé du réglage, libellé. */
const LIGNES = Object.freeze([
  ['partie', 'Partie terminée'],
  ['victoire', 'Victoire'],
  ['bonus_adversaire', 'Bonus par adversaire au-delà de 3'],
]);

/* ---------- État ---------- */

// root : conteneur ; data : réponse de hg_uno_admin_reglages.
const U = { root: null, data: null };

/* ---------- Montage ---------- */

/**
 * Monte la section Uno dans son conteneur et lit les réglages.
 * @param {HTMLElement} root Conteneur (#uno-root).
 * @returns {Promise<void>}
 */
export async function mountUnoSection(root) {
  if (!root) return;
  U.root = root;
  if (!root.dataset.unaBound) {
    root.dataset.unaBound = '1';
    root.addEventListener('submit', onSubmit);
    root.addEventListener('click', onClick);
  }
  root.innerHTML = '<div class="empty">Chargement d’Uno…</div>';
  await load();
}

/**
 * Lit hg_uno_admin_reglages puis redessine la section. En cas d'erreur, affiche le message et un bouton « Réessayer ».
 * @returns {Promise<void>}
 */
async function load() {
  U.root.setAttribute('aria-busy', 'true');
  const { data, error } = await sb.rpc('hg_uno_admin_reglages');
  U.root.removeAttribute('aria-busy');
  if (error) {
    U.data = null;
    U.root.innerHTML = `${sectionError(error)}<p><button class="btn btn-ghost" type="button" data-una="retry">Réessayer</button></p>`;
    return;
  }
  U.data = data ?? {};
  render();
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
 * Dessine les quatre cartes. Les valeurs du formulaire viennent des réglages lus (ou des valeurs de repli).
 */
function render() {
  const d = U.data ?? {};
  const pai = { ...DEFAUT.paillettes, ...(d.paillettes && typeof d.paillettes === 'object' ? d.paillettes : {}) };
  const plafond = d.plafond_jour ?? DEFAUT.plafond_jour;
  const minJoueurs = d.min_joueurs ?? DEFAUT.min_joueurs;
  const badges = Array.isArray(d.badges) ? d.badges : [];
  const parties = Array.isArray(d.parties) ? d.parties : [];

  U.root.innerHTML = `<form class="una" id="una-form" novalidate>
    <div class="una-colonnes">
      <div class="una-pile">
        <section class="card una-card" aria-labelledby="una-h-pai">
          <h3 id="una-h-pai" class="una-titre">Récompenses en Paillettes</h3>
          <table class="una-table">
            <thead><tr><th scope="col">Action</th><th scope="col">Paillettes</th></tr></thead>
            <tbody>
              ${LIGNES.map(([cle, libelle]) => `<tr>
                <th scope="row"><label for="una-pai-${cle}">${esc(libelle)}</label></th>
                <td><input id="una-pai-${cle}" class="una-input una-input-num" type="number" inputmode="numeric" step="1" min="0" max="${PAILLETTES_MAX}" value="${esc(pai[cle])}"></td>
              </tr>`).join('')}
            </tbody>
          </table>
          <div class="una-grille">
            <div class="una-champ">
              <label for="una-plafond">Plafond par jour</label>
              <input id="una-plafond" class="una-input una-input-num" type="number" inputmode="numeric" step="1" min="0" max="${PLAFOND_MAX}" value="${esc(plafond)}">
            </div>
            <div class="una-champ">
              <label for="una-min-joueurs">Nombre minimum de joueurs pour gagner des Paillettes</label>
              <input id="una-min-joueurs" class="una-input una-input-num" type="number" inputmode="numeric" step="1" min="${MIN_JOUEURS.min}" max="${MIN_JOUEURS.max}" value="${esc(minJoueurs)}">
              <span class="una-aide">Évite les gains sur les petites parties de test.</span>
            </div>
          </div>
          <div class="una-actions">
            <button class="btn btn-primary" type="submit">Enregistrer</button>
            <span id="una-statut" class="una-statut" role="status"></span>
          </div>
        </section>

        <section class="card una-card" aria-labelledby="una-h-acces">
          <h3 id="una-h-acces" class="una-titre">Accès</h3>
          <p class="small">La page Uno est visible des admins seulement tant que la page « uno » est en mode admin
            dans Membres › Accès aux pages.</p>
          <a class="btn btn-ghost" href="#place/acces">Ouvrir Accès aux pages</a>
        </section>
      </div>

      <section class="card una-card" aria-labelledby="una-h-badges">
        <h3 id="una-h-badges" class="una-titre">Badges Uno</h3>
        ${badges.length ? `<ul class="una-badges">${badges.map(badgeHtml).join('')}</ul>` : '<p class="muted small">Aucun badge Uno pour l’instant.</p>'}
        <p class="small muted una-note">Les interrupteurs se désactivent ici, puis se valident avec Enregistrer.
          Les images et textes des badges se modifient dans <a href="#place/badges">Badges</a>.</p>
      </section>
    </div>

    <section class="card una-card" aria-labelledby="una-h-parties">
      <h3 id="una-h-parties" class="una-titre">Parties en cours</h3>
      <div class="una-scroll">
        <table class="una-table una-parties">
          <thead><tr>
            <th scope="col">Code</th><th scope="col">Hôte</th><th scope="col">Joueurs</th>
            <th scope="col">Tour de</th><th scope="col">Démarrée</th><th scope="col"><span class="visually-hidden">Action</span></th>
          </tr></thead>
          <tbody>${parties.length ? parties.map(partieHtml).join('') : '<tr><td colspan="6" class="muted">Aucune partie en cours.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  </form>`;
}

/**
 * Une ligne de la liste des badges : nom, description, nombre de membres, interrupteur actif.
 * @param {{code: string, nom: string, description: string, actif: boolean, membres: number}} b
 * @returns {string} HTML.
 */
function badgeHtml(b) {
  return `<li class="una-badge">
    <span class="una-medaille" aria-hidden="true">${ICON.badge}</span>
    <div class="una-badge-texte">
      <strong>${esc(b.nom)}</strong>
      <span class="small muted">${esc(b.description ?? '')}</span>
      <span class="small muted">${esc(membres(b.membres))}</span>
    </div>
    <label class="switch una-switch">
      <input type="checkbox" data-una-badge="${esc(b.code)}" ${b.actif ? 'checked' : ''}>
      <span class="switch-ui" aria-hidden="true"></span>
      <span class="visually-hidden">Badge ${esc(b.nom)} actif</span>
    </label>
  </li>`;
}

/**
 * Une ligne du tableau des parties en cours.
 * @param {{code: string, nom: string, hote_pseudo: string, joueurs: number, tour_pseudo: string|null, started_at: string}} p
 * @returns {string} HTML.
 */
function partieHtml(p) {
  return `<tr>
    <td class="una-code">${esc(p.code)}</td>
    <td>${esc(p.hote_pseudo ?? '—')}</td>
    <td>${nb(p.joueurs)}</td>
    <td>${esc(p.tour_pseudo ?? '—')}</td>
    <td class="muted">${esc(ilYa(p.started_at))}</td>
    <td class="una-action"><button class="btn btn-ghost una-arreter" type="button" data-una="arreter" data-code="${esc(p.code)}" aria-label="Arrêter la partie ${esc(p.code)}">Arrêter</button></td>
  </tr>`;
}

/* ---------- Actions ---------- */

/**
 * Délégation des clics : bouton « Réessayer » et bouton « Arrêter ».
 * @param {MouseEvent} e
 */
function onClick(e) {
  if (e.target.closest?.('[data-una="retry"]')) {
    U.root.innerHTML = '<div class="empty">Chargement d’Uno…</div>';
    load();
    return;
  }
  const btn = e.target.closest?.('[data-una="arreter"]');
  if (btn) arreter(btn);
}

/**
 * Arrête une partie en cours après confirmation (RPC hg_uno_admin_arreter).
 * @param {HTMLButtonElement} btn Bouton « Arrêter » de la ligne.
 * @returns {Promise<void>}
 */
async function arreter(btn) {
  const code = btn.dataset.code;
  const ok = await confirmBox(`Arrêter la partie ${code} ?`,
    'La partie s’arrête pour tous ses joueurs.',
    { ok: 'Arrêter', danger: true });
  if (!ok) return;
  btn.disabled = true;
  try {
    const { error } = await sb.rpc('hg_uno_admin_arreter', { p_code: code });
    if (error) throw error;
    toast(`Partie ${code} arrêtée`, 'ok');
    await load();
  } catch (err) {
    toast(`Arrêt impossible : ${errMsg(err)}`, 'error');
    btn.disabled = false;
  }
}

/**
 * Envoi du formulaire (Paillettes, plafond, joueurs minimum, badges).
 * @param {SubmitEvent} e
 */
function onSubmit(e) {
  if (e.target.id !== 'una-form') return;
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
  for (const [cle, libelle] of LIGNES) paillettes[cle] = entier(`una-pai-${cle}`, libelle, 0, PAILLETTES_MAX);
  const plafond_jour = entier('una-plafond', 'Plafond par jour', 0, PLAFOND_MAX);
  const min_joueurs = entier('una-min-joueurs', 'Nombre minimum de joueurs', MIN_JOUEURS.min, MIN_JOUEURS.max);
  const badges_inactifs = [...form.querySelectorAll('input[data-una-badge]')]
    .filter((el) => !el.checked)
    .map((el) => el.dataset.unaBadge);
  if (erreurs.length) return { p: null, erreurs };
  return { p: { paillettes, plafond_jour, min_joueurs, badges_inactifs }, erreurs };
}

/**
 * Enregistre les réglages (RPC hg_uno_admin_enregistrer). Les erreurs de saisie sont signalées dans le formulaire.
 * @param {HTMLFormElement} form
 * @returns {Promise<void>}
 */
async function enregistrer(form) {
  const btn = form.querySelector('button[type="submit"]');
  const statut = form.querySelector('#una-statut');
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const { p, erreurs } = lire(form);
  if (!p) {
    for (const { id } of erreurs) form.querySelector(`#${id}`)?.setAttribute('aria-invalid', 'true');
    statut.textContent = erreurs[0].message;
    statut.className = 'una-statut una-erreur';
    form.querySelector(`#${erreurs[0].id}`)?.focus();
    return;
  }
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  statut.textContent = 'Enregistrement…';
  statut.className = 'una-statut';
  try {
    const { error } = await sb.rpc('hg_uno_admin_enregistrer', { p });
    if (error) throw error;
    // Réglages gardés en mémoire pour la prochaine lecture (sans redessiner le formulaire).
    U.data = {
      ...(U.data ?? {}),
      paillettes: p.paillettes,
      plafond_jour: p.plafond_jour,
      min_joueurs: p.min_joueurs,
      badges: (U.data?.badges ?? []).map((b) => ({ ...b, actif: !p.badges_inactifs.includes(b.code) })),
    };
    statut.textContent = 'Réglages enregistrés.';
    statut.className = 'una-statut una-ok';
    toast('Réglages d’Uno enregistrés', 'ok');
  } catch (err) {
    statut.textContent = `Enregistrement impossible : ${errMsg(err)}`;
    statut.className = 'una-statut una-erreur';
    toast(`Réglages Uno non enregistrés : ${errMsg(err)}`, 'error');
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}
