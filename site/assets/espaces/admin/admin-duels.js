// ===== Humane Gang — administration : Duels (La Fête foraine › Jeux › Duels) =====
/*
 * Rôle : réglages des Duels (Puissance 4, Morpion, Mastermind) pour l'administrateur, en cinq blocs.
 *   - Récompenses en Paillettes : partie terminée et victoire par jeu, Paillettes du code du jour, plafond par jour,
 *     nombre de duels récompensés par jour contre le même adversaire. Pas de Paillettes contre le robot ni un invité.
 *   - Badges Duels : les badges « duel_* » avec leur interrupteur actif et leur nombre de membres. Les codes désactivés
 *     partent dans badges_inactifs à l'enregistrement.
 *   - Duels en cours : code, jeu, joueurs, statut, robot, ancienneté ; bouton « Arrêter » (confirmation).
 *   - Duels terminés : nombre de parties terminées par jeu.
 *   - Accès : rappel de la visibilité (administrateurs seulement tant que la page « duels » est en mode admin).
 * Droit : administrateur seulement (attribut data-admin-only). Aucune permission Staff.
 * Route : #fete/duels (à brancher dans admin.js). Section : <section id="duels">, conteneur #duels-root.
 * RPC : hg_duel_admin_reglages() (lecture), hg_duel_admin_enregistrer({p}) (écriture bornée côté serveur),
 *       hg_duel_admin_arreter({p_code}) (arrêt d'un duel en attente ou en cours).
 * Dépendances : core.js (sb, toast, errMsg, esc), admin/common.js (sectionError, ICON), ui-confirm.js (confirmBox).
 * Exporte : mountDuelsSection.
 */
import { sb, toast, errMsg, esc } from '../../commun/core.js';
import { sectionError, ICON } from './common.js';
import { confirmBox } from '../../commun/ui-confirm.js';
import { foldHtml, compte } from './ui/fold.js';

/* ---------- Constantes ---------- */

/** Valeurs de repli (celles de la migration 122). */
const DEFAUT = Object.freeze({
  paillettes: Object.freeze({
    p4: Object.freeze({ partie: 20, victoire: 60 }),
    morpion_classique: Object.freeze({ partie: 10, victoire: 30 }),
    morpion: Object.freeze({ partie: 20, victoire: 60 }),
    mastermind: Object.freeze({ partie: 20, victoire: 60 }),
    bataille: Object.freeze({ partie: 20, victoire: 60 }),
    quiestce: Object.freeze({ partie: 20, victoire: 60 }),
    dames: Object.freeze({ partie: 20, victoire: 60 }),
    echecs: Object.freeze({ partie: 30, victoire: 80 }),
    othello: Object.freeze({ partie: 20, victoire: 60 }),
    pfc: Object.freeze({ partie: 5, victoire: 15 }),
    code_du_jour: 30,
  }),
  plafond_jour: 500,
  max_meme_adversaire: 3,
});
/** Bornes : Paillettes 0 à 1000 ; plafond 0 à 100000 ; duels par adversaire 0 à 50. */
const PAILLETTES_MAX = 1000;
const PLAFOND_MAX = 100000;
const MAX_MEME_ADVERSAIRE = { min: 0, max: 50 };
/** Lignes du tableau des Paillettes : clé du réglage, libellé. Morpion Ultime et Gomoku partagent la clé « morpion ». */
const LIGNES = Object.freeze([
  ['p4', 'Puissance 4'],
  ['morpion_classique', 'Morpion classique'],
  ['morpion', 'Morpion Ultime et Gomoku'],
  ['mastermind', 'Mastermind'],
  ['bataille', 'Bataille navale'],
  ['quiestce', 'Qui est-ce ?'],
  ['dames', 'Dames'],
  ['echecs', 'Échecs'],
  ['othello', 'Othello'],
  ['pfc', 'Pierre-feuille-ciseaux'],
]);
/** Libellés des jeux (colonne jeu des parties) pour le bloc des duels terminés. */
const JEUX_NOM = Object.freeze({ p4: 'Puissance 4', morpion: 'Morpion', mastermind: 'Mastermind', bataille: 'Bataille navale', quiestce: 'Qui est-ce ?',
  dames: 'Dames', echecs: 'Échecs', othello: 'Othello', pfc: 'Pierre-feuille-ciseaux' });
const STATUT_NOM = Object.freeze({ attente: 'En attente', en_cours: 'En cours' });
/** Niveaux du robot (valeurs 1 à 3 de la colonne robot). */
const ROBOT_NOM = Object.freeze({ 1: 'Facile', 2: 'Moyen', 3: 'Difficile' });

/* ---------- État ---------- */

// root : conteneur ; data : réponse de hg_duel_admin_reglages.
const D = { root: null, data: null };

/* ---------- Montage ---------- */

/**
 * Monte la section Duels dans son conteneur et lit les réglages.
 * @param {HTMLElement} root Conteneur (#duels-root).
 * @returns {Promise<void>}
 */
export async function mountDuelsSection(root) {
  if (!root) return;
  D.root = root;
  if (!root.dataset.dlsBound) {
    root.dataset.dlsBound = '1';
    root.addEventListener('submit', onSubmit);
    root.addEventListener('click', onClick);
  }
  root.innerHTML = '<div class="empty">Chargement des duels…</div>';
  await load();
}

/**
 * Lit hg_duel_admin_reglages puis redessine la section. En cas d'erreur, affiche le message et un bouton « Réessayer ».
 * @returns {Promise<void>}
 */
async function load() {
  D.root.setAttribute('aria-busy', 'true');
  const { data, error } = await sb.rpc('hg_duel_admin_reglages');
  D.root.removeAttribute('aria-busy');
  if (error) {
    D.data = null;
    D.root.innerHTML = `${sectionError(error)}<p><button class="btn btn-ghost" type="button" data-dls="retry">Réessayer</button></p>`;
    return;
  }
  D.data = data ?? {};
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
 * Dessine les cinq blocs. Les valeurs du formulaire viennent des réglages lus (ou des valeurs de repli).
 */
function render() {
  const d = D.data ?? {};
  const pai = d.paillettes && typeof d.paillettes === 'object' ? d.paillettes : {};
  const ligne = (cle) => ({ ...DEFAUT.paillettes[cle], ...(pai[cle] && typeof pai[cle] === 'object' ? pai[cle] : {}) });
  const codeDuJour = pai.code_du_jour ?? DEFAUT.paillettes.code_du_jour;
  const plafond = d.plafond_jour ?? DEFAUT.plafond_jour;
  const maxMeme = d.max_meme_adversaire ?? DEFAUT.max_meme_adversaire;
  const badges = Array.isArray(d.badges) ? d.badges : [];
  const parties = Array.isArray(d.parties) ? d.parties : [];
  const terminees = d.terminees && typeof d.terminees === 'object' ? d.terminees : {};
  // Jeux connus d'abord, puis tout jeu inattendu renvoyé par le serveur.
  const clesTerminees = [...Object.keys(JEUX_NOM), ...Object.keys(terminees).filter((k) => !(k in JEUX_NOM))];
  const total = Object.values(terminees).reduce((n, v) => n + Number(v || 0), 0);

  D.root.innerHTML = `<form class="dls" id="dls-form" novalidate>
    <div class="dls-colonnes">
      <section class="card dls-card">
        ${foldHtml({ cle: 'dls:pai', titre: 'Récompenses en Paillettes', resume: `plafond de ${nb(plafond)} par jour`, corps: `
        <table class="dls-table">
          <thead><tr><th scope="col">Jeu</th><th scope="col">Partie terminée</th><th scope="col">Victoire</th></tr></thead>
          <tbody>
            ${LIGNES.map(([cle, libelle]) => {
              const l = ligne(cle);
              return `<tr>
                <th scope="row">${esc(libelle)}</th>
                <td><label class="visually-hidden" for="dls-pai-${cle}-partie">${esc(libelle)} : partie terminée</label>
                  <input id="dls-pai-${cle}-partie" class="dls-input dls-input-num" type="number" inputmode="numeric" step="1" min="0" max="${PAILLETTES_MAX}" value="${esc(l.partie)}"></td>
                <td><label class="visually-hidden" for="dls-pai-${cle}-victoire">${esc(libelle)} : victoire</label>
                  <input id="dls-pai-${cle}-victoire" class="dls-input dls-input-num" type="number" inputmode="numeric" step="1" min="0" max="${PAILLETTES_MAX}" value="${esc(l.victoire)}"></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div class="dls-grille">
          <div class="dls-champ">
            <label for="dls-code-jour">Code du jour trouvé</label>
            <input id="dls-code-jour" class="dls-input dls-input-num" type="number" inputmode="numeric" step="1" min="0" max="${PAILLETTES_MAX}" value="${esc(codeDuJour)}">
          </div>
          <div class="dls-champ">
            <label for="dls-plafond">Plafond par jour</label>
            <input id="dls-plafond" class="dls-input dls-input-num" type="number" inputmode="numeric" step="1" min="0" max="${PLAFOND_MAX}" value="${esc(plafond)}">
          </div>
          <div class="dls-champ">
            <label for="dls-meme-adversaire">Duels récompensés par jour contre le même adversaire</label>
            <input id="dls-meme-adversaire" class="dls-input dls-input-num" type="number" inputmode="numeric" step="1" min="${MAX_MEME_ADVERSAIRE.min}" max="${MAX_MEME_ADVERSAIRE.max}" value="${esc(maxMeme)}">
            <span class="dls-aide">Au-delà, les duels contre le même adversaire ne rapportent plus de Paillettes ce jour-là.</span>
          </div>
        </div>
        <p class="dls-aide">Pas de Paillettes contre le robot ni contre un invité.</p>
        <div class="dls-actions">
          <button class="btn btn-primary" type="submit">Enregistrer</button>
          <span id="dls-statut" class="dls-statut" role="status"></span>
        </div>` })}
      </section>

      <section class="card dls-card">
        ${foldHtml({ cle: 'dls:badges', titre: 'Badges Duels', resume: compte(badges.length, 'badge'), corps: `
        ${badges.length ? `<ul class="dls-badges">${badges.map(badgeHtml).join('')}</ul>` : '<p class="muted small">Aucun badge Duels pour l’instant.</p>'}
        <p class="small muted dls-note">Les interrupteurs se désactivent ici, puis se valident avec Enregistrer.
          Les images et textes des badges se modifient dans <a href="#place/badges">Badges</a>.</p>` })}
      </section>
    </div>

    <section class="card dls-card">
      ${foldHtml({ cle: 'dls:parties', titre: 'Duels en cours', resume: `${compte(parties.length, 'duel')} en cours`, corps: `
      <div class="dls-scroll">
        <table class="dls-table dls-parties">
          <thead><tr>
            <th scope="col">Code</th><th scope="col">Jeu</th><th scope="col">Joueurs</th><th scope="col">Statut</th>
            <th scope="col">Robot</th><th scope="col">Démarré</th><th scope="col"><span class="visually-hidden">Action</span></th>
          </tr></thead>
          <tbody>${parties.length ? parties.map(partieHtml).join('') : '<tr><td colspan="7" class="muted">Aucun duel en cours.</td></tr>'}</tbody>
        </table>
      </div>` })}
    </section>

    <div class="dls-colonnes">
      <section class="card dls-card">
        ${foldHtml({ cle: 'dls:terminees', titre: 'Duels terminés', resume: `${compte(total, 'partie')} terminée${total > 1 ? 's' : ''}`, corps: `
        <table class="dls-table dls-terminees">
          <thead><tr><th scope="col">Jeu</th><th scope="col">Parties terminées</th></tr></thead>
          <tbody>
            ${clesTerminees.map((cle) => `<tr>
              <th scope="row">${esc(JEUX_NOM[cle] ?? cle)}</th>
              <td>${nb(terminees[cle])}</td>
            </tr>`).join('')}
          </tbody>
        </table>` })}
      </section>

      <section class="card dls-card" aria-labelledby="dls-h-acces">
        <h3 id="dls-h-acces" class="dls-titre">Accès</h3>
        <p class="small">Page visible par : les administrateurs seulement tant que la page « duels » est en mode admin
          dans Membres › Accès aux pages.</p>
        <a class="btn btn-ghost" href="#place/acces">Ouvrir Accès aux pages</a>
      </section>
    </div>
  </form>`;
}

/**
 * Une ligne de la liste des badges : nom, description, nombre de membres, interrupteur actif.
 * @param {{code: string, nom: string, description: string, actif: boolean, membres: number}} b
 * @returns {string} HTML.
 */
function badgeHtml(b) {
  return `<li class="dls-badge">
    <span class="dls-medaille" aria-hidden="true">${ICON.badge}</span>
    <div class="dls-badge-texte">
      <strong>${esc(b.nom)}</strong>
      <span class="small muted">${esc(b.description ?? '')}</span>
      <span class="small muted">${esc(membres(b.membres))}</span>
    </div>
    <label class="switch dls-switch">
      <input type="checkbox" data-dls-badge="${esc(b.code)}" ${b.actif ? 'checked' : ''}>
      <span class="switch-ui" aria-hidden="true"></span>
      <span class="visually-hidden">Badge ${esc(b.nom)} actif</span>
    </label>
  </li>`;
}

/**
 * Une ligne du tableau des duels en cours.
 * @param {{code: string, jeu: string, nom: string, joueurs: string, statut: string, robot: number, started_at: string}} p
 * @returns {string} HTML.
 */
function partieHtml(p) {
  const robot = Number(p.robot) > 0 ? (ROBOT_NOM[p.robot] ?? `Niveau ${p.robot}`) : '—';
  return `<tr>
    <td class="dls-code">${esc(p.code)}</td>
    <td>${esc(p.nom ?? JEUX_NOM[p.jeu] ?? p.jeu ?? '—')}</td>
    <td>${esc(p.joueurs || '—')}</td>
    <td>${esc(STATUT_NOM[p.statut] ?? p.statut ?? '—')}</td>
    <td>${esc(robot)}</td>
    <td class="muted">${esc(ilYa(p.started_at))}</td>
    <td class="dls-action"><button class="btn btn-ghost dls-arreter" type="button" data-dls="arreter" data-code="${esc(p.code)}" data-statut="${esc(p.statut)}" aria-label="Arrêter le duel ${esc(p.code)}">Arrêter</button></td>
  </tr>`;
}

/* ---------- Actions ---------- */

/**
 * Délégation des clics : bouton « Réessayer » et bouton « Arrêter ».
 * @param {MouseEvent} e
 */
function onClick(e) {
  if (e.target.closest?.('[data-dls="retry"]')) {
    D.root.innerHTML = '<div class="empty">Chargement des duels…</div>';
    load();
    return;
  }
  const btn = e.target.closest?.('[data-dls="arreter"]');
  if (btn) arreter(btn);
}

/**
 * Arrête un duel après confirmation (RPC hg_duel_admin_arreter). Un défi en attente est annulé ;
 * une partie en cours s'achève sans vainqueur.
 * @param {HTMLButtonElement} btn Bouton « Arrêter » de la ligne.
 * @returns {Promise<void>}
 */
async function arreter(btn) {
  const code = btn.dataset.code;
  const ok = await confirmBox(`Arrêter le duel ${code} ?`,
    btn.dataset.statut === 'attente' ? 'Le défi est annulé.' : 'La partie s’arrête pour tous ses joueurs.',
    { ok: 'Arrêter', danger: true });
  if (!ok) return;
  btn.disabled = true;
  try {
    const { error } = await sb.rpc('hg_duel_admin_arreter', { p_code: code });
    if (error) throw error;
    toast(`Duel ${code} arrêté`, 'ok');
    await load();
  } catch (err) {
    toast(`Arrêt impossible : ${errMsg(err)}`, 'error');
    btn.disabled = false;
  }
}

/**
 * Envoi du formulaire (Paillettes, plafonds, badges).
 * @param {SubmitEvent} e
 */
function onSubmit(e) {
  if (e.target.id !== 'dls-form') return;
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
  for (const [cle, libelle] of LIGNES) {
    paillettes[cle] = {
      partie: entier(`dls-pai-${cle}-partie`, `${libelle} : partie terminée`, 0, PAILLETTES_MAX),
      victoire: entier(`dls-pai-${cle}-victoire`, `${libelle} : victoire`, 0, PAILLETTES_MAX),
    };
  }
  paillettes.code_du_jour = entier('dls-code-jour', 'Code du jour trouvé', 0, PAILLETTES_MAX);
  const plafond_jour = entier('dls-plafond', 'Plafond par jour', 0, PLAFOND_MAX);
  const max_meme_adversaire = entier('dls-meme-adversaire', 'Duels par jour contre le même adversaire', MAX_MEME_ADVERSAIRE.min, MAX_MEME_ADVERSAIRE.max);
  const badges_inactifs = [...form.querySelectorAll('input[data-dls-badge]')]
    .filter((el) => !el.checked)
    .map((el) => el.dataset.dlsBadge);
  if (erreurs.length) return { p: null, erreurs };
  return { p: { paillettes, plafond_jour, max_meme_adversaire, badges_inactifs }, erreurs };
}

/**
 * Enregistre les réglages (RPC hg_duel_admin_enregistrer). Les erreurs de saisie sont signalées dans le formulaire.
 * @param {HTMLFormElement} form
 * @returns {Promise<void>}
 */
async function enregistrer(form) {
  const btn = form.querySelector('button[type="submit"]');
  const statut = form.querySelector('#dls-statut');
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const { p, erreurs } = lire(form);
  if (!p) {
    for (const { id } of erreurs) form.querySelector(`#${id}`)?.setAttribute('aria-invalid', 'true');
    statut.textContent = erreurs[0].message;
    statut.className = 'dls-statut dls-erreur';
    form.querySelector(`#${erreurs[0].id}`)?.focus();
    return;
  }
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  statut.textContent = 'Enregistrement…';
  statut.className = 'dls-statut';
  try {
    const { error } = await sb.rpc('hg_duel_admin_enregistrer', { p });
    if (error) throw error;
    // Réglages gardés en mémoire pour la prochaine lecture (sans redessiner le formulaire).
    D.data = {
      ...(D.data ?? {}),
      paillettes: p.paillettes,
      plafond_jour: p.plafond_jour,
      max_meme_adversaire: p.max_meme_adversaire,
      badges: (D.data?.badges ?? []).map((b) => ({ ...b, actif: !p.badges_inactifs.includes(b.code) })),
    };
    statut.textContent = 'Réglages enregistrés.';
    statut.className = 'dls-statut dls-ok';
    toast('Réglages des duels enregistrés', 'ok');
  } catch (err) {
    statut.textContent = `Enregistrement impossible : ${errMsg(err)}`;
    statut.className = 'dls-statut dls-erreur';
    toast(`Réglages des duels non enregistrés : ${errMsg(err)}`, 'error');
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}
