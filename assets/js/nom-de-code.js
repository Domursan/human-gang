// ===== Humane Gang — Codenames (nom-de-code.html) : démarrage et navigation entre les écrans =====
/*
 * Rôle : initialise la page (session membre, accès à la page « nom-de-code » : admins seulement au lancement),
 * puis affiche l'écran demandé par l'adresse :
 *   (vide) accueil · #creer création · #rejoindre/CODE rejoindre · #partie/CODE partie (salle d'attente, table, fin) · #stats.
 *   nom-de-code.html?code=HGNDC-1234 (lien d'invitation) mène à #rejoindre/HGNDC-1234.
 * Visiteur sans compte (lien d'invitation) : mode invité, seuls #rejoindre et #partie sont ouverts.
 * Chaque écran est un module de assets/js/nom-de-code/vues/ qui exporte afficher(root, ctx) et peut renvoyer une fonction de nettoyage.
 * Dépendances : core.js (initPage, $, motionAllowed, loadMyPages, pageLabel), nom-de-code/api.js.
 * Exporte : naviguer.
 */
import { initPage, $, motionAllowed, loadMyPages, pageLabel } from './core.js';
import { activerInvite } from './nom-de-code/api.js';

const moi = await initPage({ auth: 'optional' });
const INVITE = !moi;
activerInvite(INVITE);
// Garde-fou : tant que la page n'est pas déclarée dans hg_pages (migration pas encore appliquée), seul l'admin entre.
if (!INVITE) await loadMyPages();
if (!INVITE && !pageLabel('nom-de-code') && !moi?.is_admin) {
  location.replace('jeux.html');
  await new Promise(() => {});
}
document.body.classList.toggle('ndc-calme', !motionAllowed());

const app = $('#app');
let nettoyer = null;
let jeton = 0;

/** Route courante d'après l'adresse. */
function route() {
  const q = new URLSearchParams(location.search).get('code');
  if (q && !location.hash) history.replaceState(null, '', `nom-de-code.html#rejoindre/${encodeURIComponent(q.toUpperCase())}`);
  const [nom, arg] = location.hash.replace(/^#/, '').split('/');
  return { nom: nom || 'accueil', arg: arg ? decodeURIComponent(arg).toUpperCase() : null };
}

/** Change d'écran (met à jour l'adresse). */
export function naviguer(hash) {
  if (location.hash === hash) afficher(); else location.hash = hash;
}

const ECRANS = {
  accueil: () => import('./nom-de-code/vues/accueil.js'),
  creer: () => import('./nom-de-code/vues/creer.js'),
  rejoindre: () => import('./nom-de-code/vues/rejoindre.js'),
  partie: () => import('./nom-de-code/vues/partie.js'),
  stats: () => import('./nom-de-code/vues/stats.js'),
};

async function afficher() {
  const mon = ++jeton;
  try { nettoyer?.(); } catch { /* sans effet */ }
  nettoyer = null;
  const r = route();
  if (INVITE && !(['rejoindre', 'partie'].includes(r.nom) && r.arg)) {
    app.innerHTML = `<section class="card ndc-erreur"><h1 class="display">Codenames</h1>
      <p>Codenames se joue sur invitation. Ouvre le lien de partie qu'on t'a envoyé, ou connecte-toi si tu es membre du gang.</p>
      <p><a class="btn btn-primary" href="compte.html?next=${encodeURIComponent('nom-de-code.html')}">Me connecter</a></p></section>`;
    app.setAttribute('aria-busy', 'false');
    return;
  }
  const charger = ECRANS[r.nom] || ECRANS.accueil;
  app.setAttribute('aria-busy', 'true');
  try {
    const mod = await charger();
    if (mon !== jeton) return;
    app.innerHTML = '';
    document.body.dataset.ndcEcran = r.nom;
    const res = await mod.afficher(app, { code: r.arg, naviguer, moi });
    if (mon !== jeton) { if (typeof res === 'function') res(); return; }
    nettoyer = typeof res === 'function' ? res : null;
  } catch (e) {
    console.error('[nom-de-code]', e);
    app.innerHTML = '<section class="card ndc-erreur"><h1 class="display">Oups</h1><p>Cet écran n\'a pas pu s\'afficher.</p><p><a class="btn btn-primary" href="nom-de-code.html">Retour à Codenames</a></p></section>';
  } finally {
    app.setAttribute('aria-busy', 'false');
    window.scrollTo({ top: 0 });
  }
}

window.addEventListener('hashchange', afficher);
afficher();
