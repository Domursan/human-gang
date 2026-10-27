// Pastilles de compteur (« 3 à faire ») sur les entrées du menu, les menus et les onglets des pages.
/*
 * Rôle : affiche un petit chiffre sur chaque élément marqué data-cpt="<source>.<clé>" (entrée de menu, onglet de page).
 *   - Les valeurs viennent de deux endroits :
 *       · une source interrogée ici (SOURCES) : une lecture par source et par rafraîchissement, et seulement si la page
 *         affiche au moins un élément de cette source ;
 *       · la page elle-même (setCompteurs) quand elle a déjà les données en mémoire (ex. jeux.js, irl.js).
 *   - Un menu (.nav-group) ou un sous-menu (.nav-sub) affiche la somme de ses entrées.
 *   - La pastille est ajoutée toute seule dès qu'un élément marqué apparaît (MutationObserver) : une page n'a rien à poser,
 *     il suffit de mettre l'attribut data-cpt sur l'onglet ou l'entrée.
 *   - Accessible : le nombre est lu (« Échanges 3 à faire ») ; « 99+ » au-delà de 99 ; le chiffre n'est pas la seule
 *     information visible d'un élément mais le contenu est lu par les lecteurs d'écran.
 *   - Visiteur ou session absente : aucune requête, aucune pastille. Une erreur réseau garde les valeurs précédentes.
 * Page : toutes les pages du membre (unread.js lance startCompteurs avec startUnread).
 * Dépendances : supabase.js (sb, hasSession, isNavCancel), profile.js (profil en cache).
 * Exporte : startCompteurs, refreshCompteurs, setCompteurs, poserCompteurs.
 */
import { sb, hasSession, isNavCancel } from './supabase.js';
import { getCachedProfile } from './profile.js';

/** Rafraîchissement automatique : une minute, quand l'onglet du navigateur est visible (comme les non-lus). */
const PERIODE_MS = 60000;
/** Valeurs connues, par clé « source.clé ». */
const VALEURS = new Map();
/** Sources lues par ce module : chacune renvoie { 'source.clé': nombre }. */
const SOURCES = { cartes: sourceCartes };
let _timer = 0;
let _surveille = false;
let _retour = false;
let _trame = 0;

/**
 * Source « cartes » : une lecture de hg_cards_me (booster gratuit, dons et stock) et un comptage des offres d'échange
 * reçues et pas encore répondues (hg_card_trades, statut « proposee », destinataire moi).
 * Ouverture = booster gratuit prêt + boosters offerts + boosters en stock (tout ce qui s'ouvre dans l'onglet).
 * @returns {Promise<Object<string, number>>} Compteurs « cartes.ouverture » et « cartes.echanges ».
 */
async function sourceCartes() {
  const uid = getCachedProfile()?.id;
  const [st, tr] = await Promise.all([
    sb.rpc('hg_cards_me'),
    uid ? sb.from('hg_card_trades').select('id', { count: 'exact', head: true }).eq('to_user', uid).eq('status', 'proposee')
      : Promise.resolve({ count: 0, error: null }),
  ]);
  if (st.error) throw st.error;
  if (tr.error) throw tr.error;
  const s = st.data || {};
  // Le booster gratuit est prêt quand son délai est passé (ou jamais pris : le serveur renvoie alors « maintenant »).
  const gratuit = s.free_booster_at && new Date(s.free_booster_at).getTime() <= Date.now() ? 1 : 0;
  const ouverture = gratuit + (Number(s.gift_boosters) || 0) + (Number(s.boosters_stock) || 0);
  return { 'cartes.ouverture': ouverture, 'cartes.echanges': tr.count || 0 };
}

/**
 * Lit les sources dont la page affiche un élément, puis met les pastilles à jour.
 * Sans session : toutes les pastilles sont effacées, sans requête. Une source en erreur garde ses valeurs précédentes.
 * @returns {Promise<void>}
 */
export async function refreshCompteurs() {
  if (!document.querySelector('[data-cpt]')) return;
  if (!(await hasSession())) { VALEURS.clear(); poserCompteurs(); return; }
  const sources = new Set([...document.querySelectorAll('[data-cpt]')].map((el) => el.dataset.cpt.split('.')[0]).filter((s) => SOURCES[s]));
  await Promise.all([...sources].map(async (s) => {
    try {
      const vals = await SOURCES[s]();
      for (const [k, n] of Object.entries(vals)) VALEURS.set(k, Math.max(0, Number(n) || 0));
    } catch (e) {
      if (!isNavCancel(e)) console.warn('[compteurs]', s, e);
    }
  }));
  poserCompteurs();
}

/**
 * Valeurs poussées par une page qui a déjà ses données. Ex. setCompteurs('irl', { sorties: 2 }) met « irl.sorties » à 2.
 * @param {string} source Nom de la source (préfixe des clés data-cpt).
 * @param {Object<string, number>} valeurs Nombre par clé (sans le préfixe).
 */
export function setCompteurs(source, valeurs = {}) {
  for (const [k, n] of Object.entries(valeurs)) VALEURS.set(`${source}.${k}`, Math.max(0, Number(n) || 0));
  poserCompteurs();
}

/**
 * Met à jour les pastilles de la page (ou d'une partie) à partir des valeurs connues. Ne touche le DOM que si une valeur change.
 * @param {ParentNode} [root=document] Zone à peindre.
 */
export function poserCompteurs(root = document) {
  for (const el of root.querySelectorAll('[data-cpt]')) majPastille(el, VALEURS.get(el.dataset.cpt) || 0, el.dataset.cptLabel || 'à faire');
  // Menus et sous-menus : la somme de leurs entrées, sur leur bouton
  for (const g of root.querySelectorAll('.nav-group, .nav-sub')) {
    const btn = g.querySelector(':scope > .nav-top, :scope > .nav-sub-btn');
    if (!btn) continue;
    const n = [...g.querySelectorAll('[data-cpt]')].reduce((t, el) => t + (VALEURS.get(el.dataset.cpt) || 0), 0);
    majPastille(btn, n, 'à faire');
  }
}

/**
 * Crée ou met à jour la pastille d'un élément. Sans valeur, la pastille reste cachée (ou n'est pas créée).
 * @param {HTMLElement} el Élément qui porte la pastille (onglet, entrée, bouton de menu).
 * @param {number} n Nombre à afficher.
 * @param {string} libelle Mot lu après le nombre (« à faire », « non lus »…).
 */
function majPastille(el, n, libelle) {
  let b = el.querySelector(':scope > .cpt-badge');
  if (!b) {
    if (!n) return;
    b = document.createElement('span');
    b.className = 'cpt-badge';
    el.append(b);
  }
  const cle = `${n}|${libelle}`;
  if (b.dataset.cle !== cle) {
    b.dataset.cle = cle;
    const txt = n > 99 ? '99+' : String(n);
    // Le nombre et le mot sont lus ensemble : le lecteur d'écran dit « Échanges 3 à faire »
    b.innerHTML = `<span class="cpt-n">${txt}</span><span class="visually-hidden"> ${libelle}</span>`;
  }
  b.hidden = !n;
}

/** Peint à nouveau quand le DOM change (menu redessiné, onglets recréés) : une seule fois par trame. */
function surveiller() {
  if (_surveille) return;
  _surveille = true;
  new MutationObserver(() => {
    if (_trame) return;
    _trame = requestAnimationFrame(() => { _trame = 0; poserCompteurs(); });
  }).observe(document.body, { childList: true, subtree: true });
}

/**
 * Démarre le suivi : une lecture tout de suite, puis chaque minute (onglet visible) et au retour sur l'onglet.
 * Relancer la fonction remet seulement le minuteur à zéro.
 */
export function startCompteurs() {
  surveiller();
  refreshCompteurs();
  clearInterval(_timer);
  _timer = setInterval(() => { if (!document.hidden) refreshCompteurs(); }, PERIODE_MS);
  if (_retour) return;
  _retour = true;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCompteurs(); });
}
