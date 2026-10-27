// ===== Humane Gang — Loup-Garou (/pages/jeux/loup-garou.html) : démarrage et navigation entre les écrans =====
/*
 * Rôle : initialise la page (session membre, accès à la page « loup-garou » : admins seulement au lancement),
 * puis affiche l'écran demandé par l'adresse :
 *   (vide) accueil · #roles catalogue · #creer création · #rejoindre/CODE rejoindre · #partie/CODE partie · #stats statistiques.
 *   /pages/jeux/loup-garou.html?code=HGLG-1234 (lien d'invitation) mène à #rejoindre/HGLG-1234.
 * Visiteur sans compte (lien d'invitation) : mode invité (migration 120), seuls #rejoindre et #partie sont ouverts.
 * Chaque écran est un module de assets/js/loup-garou/vues/ qui exporte afficher(root, ctx) et peut renvoyer une
 * fonction de nettoyage. La partie elle-même est pilotée par loup-garou/partie.js.
 * Dépendances : core.js (initPage, $), loup-garou/*.
 * Exporte : rien.
 */
import { initPage, $, motionAllowed, loadMyPages, pageLabel } from '../../commun/core.js';
import { activerInvite } from './api.js';

const moi = await initPage({ auth: 'optional' });
// Visiteur sans compte : il joue en invité (lien d'invitation) ; le reste du jeu lui est fermé.
const INVITE = !moi;
activerInvite(INVITE);
// Garde-fou membre : tant que la page n'est pas déclarée dans hg_pages (migrations pas encore appliquées), seul l'admin entre.
// Une fois déclarée, initPage applique la règle d'accès normale (et renvoie à l'accueil un membre sans accès).
if (!INVITE) await loadMyPages();
if (!INVITE && !pageLabel('loup-garou') && !moi?.is_admin) {
  location.replace('/pages/jeux/jeux.html');
  await new Promise(() => {});
}
// Animations (éclipse, feu, lueurs) coupées si le membre les a désactivées : classe lg-calme sur <body>.
document.body.classList.toggle('lg-calme', !motionAllowed());

const app = $('#app');
let nettoyer = null;
let jeton = 0;

/** Route courante d'après l'adresse. */
function route() {
  const q = new URLSearchParams(location.search).get('code');
  if (q && !location.hash) {
    history.replaceState(null, '', `/pages/jeux/loup-garou.html#rejoindre/${encodeURIComponent(q.toUpperCase())}`);
  }
  const [nom, arg] = location.hash.replace(/^#/, '').split('/');
  return { nom: nom || 'accueil', arg: arg ? decodeURIComponent(arg).toUpperCase() : null };
}

/** Change d'écran (met à jour l'adresse). */
export function naviguer(hash) {
  if (location.hash === hash) afficher(); else location.hash = hash;
}

const ECRANS = {
  accueil: () => import('./vues/accueil.js'),
  roles: () => import('./vues/catalogue.js'),
  creer: () => import('./vues/creer.js'),
  rejoindre: () => import('./vues/rejoindre.js'),
  partie: () => import('./partie.js'),
  stats: () => import('./vues/stats.js'),
};

async function afficher() {
  const mon = ++jeton;
  try { nettoyer?.(); } catch { /* sans effet */ }
  nettoyer = null;
  const r = route();
  if (INVITE && !(['rejoindre', 'partie'].includes(r.nom) && r.arg)) {
    // Invité sans lien de partie : rien à afficher ici
    app.innerHTML = `<section class="card lg-erreur"><h1 class="display">Loup-Garou</h1>
      <p>Le Loup-Garou se joue sur invitation. Ouvre le lien de partie qu'on t'a envoyé, ou connecte-toi si tu es membre du gang.</p>
      <p><a class="btn btn-primary" href="/pages/compte/compte.html?next=${encodeURIComponent('/pages/jeux/loup-garou.html')}">Me connecter</a></p></section>`;
    app.setAttribute('aria-busy', 'false');
    return;
  }
  const charger = ECRANS[r.nom] || ECRANS.accueil;
  app.setAttribute('aria-busy', 'true');
  try {
    const mod = await charger();
    if (mon !== jeton) return;
    app.innerHTML = '';
    document.body.dataset.lgEcran = r.nom;
    const res = await mod.afficher(app, { code: r.arg, naviguer });
    if (mon !== jeton) { if (typeof res === 'function') res(); return; }
    nettoyer = typeof res === 'function' ? res : null;
  } catch (e) {
    console.error('[loup-garou]', e);
    app.innerHTML = '<section class="card lg-erreur"><h1 class="display">Oups</h1><p>Cet écran n\'a pas pu s\'afficher.</p><p><a class="btn btn-primary" href="/pages/jeux/loup-garou.html">Retour au Loup-Garou</a></p></section>';
  } finally {
    app.setAttribute('aria-busy', 'false');
    window.scrollTo({ top: 0 });
  }
}

window.addEventListener('hashchange', afficher);
afficher();
