// ===== Humane Gang — Loup-Garou (loup-garou.html) : démarrage et navigation entre les écrans =====
/*
 * Rôle : initialise la page (session membre, accès à la page « loup-garou » : admins seulement au lancement),
 * puis affiche l'écran demandé par l'adresse :
 *   (vide) accueil · #roles catalogue · #creer création · #rejoindre/CODE rejoindre · #partie/CODE partie · #stats statistiques.
 *   loup-garou.html?code=HGLG-1234 (lien d'invitation) mène à #rejoindre/HGLG-1234.
 * Chaque écran est un module de assets/js/loup-garou/vues/ qui exporte afficher(root, ctx) et peut renvoyer une
 * fonction de nettoyage. La partie elle-même est pilotée par loup-garou/partie.js.
 * Dépendances : core.js (initPage, $), loup-garou/*.
 * Exporte : rien.
 */
import { initPage, $, motionAllowed, loadMyPages, pageLabel } from './core.js';

const moi = await initPage();
// Garde-fou : tant que la page n'est pas déclarée dans hg_pages (migrations pas encore appliquées), seul l'admin entre.
// Une fois déclarée (mode « admin »), initPage applique déjà la règle d'accès normale.
await loadMyPages();
if (!pageLabel('loup-garou') && !moi?.is_admin) {
  location.replace('jeux.html');
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
    history.replaceState(null, '', `loup-garou.html#rejoindre/${encodeURIComponent(q.toUpperCase())}`);
  }
  const [nom, arg] = location.hash.replace(/^#/, '').split('/');
  return { nom: nom || 'accueil', arg: arg ? decodeURIComponent(arg).toUpperCase() : null };
}

/** Change d'écran (met à jour l'adresse). */
export function naviguer(hash) {
  if (location.hash === hash) afficher(); else location.hash = hash;
}

const ECRANS = {
  accueil: () => import('./loup-garou/vues/accueil.js'),
  roles: () => import('./loup-garou/vues/catalogue.js'),
  creer: () => import('./loup-garou/vues/creer.js'),
  rejoindre: () => import('./loup-garou/vues/rejoindre.js'),
  partie: () => import('./loup-garou/partie.js'),
  stats: () => import('./loup-garou/vues/stats.js'),
};

async function afficher() {
  const mon = ++jeton;
  try { nettoyer?.(); } catch { /* sans effet */ }
  nettoyer = null;
  const r = route();
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
    app.innerHTML = '<section class="card lg-erreur"><h1 class="display">Oups</h1><p>Cet écran n\'a pas pu s\'afficher.</p><p><a class="btn btn-primary" href="loup-garou.html">Retour au Loup-Garou</a></p></section>';
  } finally {
    app.setAttribute('aria-busy', 'false');
    window.scrollTo({ top: 0 });
  }
}

window.addEventListener('hashchange', afficher);
afficher();
