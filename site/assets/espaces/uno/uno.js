// ===== Humane Gang — Uno (uno.html) : démarrage et navigation entre les écrans =====
/*
 * Rôle : initialise la page (session membre, accès à la page « uno » : admins seulement au lancement),
 * puis affiche l'écran demandé par l'adresse :
 *   (vide) accueil · #creer création · #rejoindre/CODE rejoindre · #partie/CODE partie (salle d'attente, table, fin) · #stats.
 *   uno.html?code=HGUNO-1234 (lien d'invitation) mène à #rejoindre/HGUNO-1234.
 * Visiteur sans compte (lien d'invitation) : mode invité, seuls #rejoindre et #partie sont ouverts.
 * Chaque écran est un module de assets/js/uno/vues/ qui exporte afficher(root, ctx) et peut renvoyer une fonction de nettoyage.
 * Dépendances : core.js (initPage, $, motionAllowed, loadMyPages, pageLabel), uno/api.js.
 * Exporte : naviguer.
 */
import { initPage, $, motionAllowed, loadMyPages, pageLabel } from './core.js';
import { activerInvite } from './uno/api.js';

const moi = await initPage({ auth: 'optional' });
const INVITE = !moi;
activerInvite(INVITE);
// Garde-fou : tant que la page n'est pas déclarée dans hg_pages (migration pas encore appliquée), seul l'admin entre.
if (!INVITE) await loadMyPages();
if (!INVITE && !pageLabel('uno') && !moi?.is_admin) {
  location.replace('jeux.html');
  await new Promise(() => {});
}
document.body.classList.toggle('uno-calme', !motionAllowed());

const app = $('#app');
let nettoyer = null;
let jeton = 0;

/** Route courante d'après l'adresse. */
function route() {
  const q = new URLSearchParams(location.search).get('code');
  if (q && !location.hash) history.replaceState(null, '', `uno.html#rejoindre/${encodeURIComponent(q.toUpperCase())}`);
  const [nom, arg] = location.hash.replace(/^#/, '').split('/');
  return { nom: nom || 'accueil', arg: arg ? decodeURIComponent(arg).toUpperCase() : null };
}

/** Change d'écran (met à jour l'adresse). */
export function naviguer(hash) {
  if (location.hash === hash) afficher(); else location.hash = hash;
}

const ECRANS = {
  accueil: () => import('./uno/vues/accueil.js'),
  creer: () => import('./uno/vues/creer.js'),
  rejoindre: () => import('./uno/vues/rejoindre.js'),
  partie: () => import('./uno/vues/partie.js'),
  stats: () => import('./uno/vues/stats.js'),
};

async function afficher() {
  const mon = ++jeton;
  try { nettoyer?.(); } catch { /* sans effet */ }
  nettoyer = null;
  const r = route();
  if (INVITE && !(['rejoindre', 'partie'].includes(r.nom) && r.arg)) {
    app.innerHTML = `<section class="card uno-erreur"><h1 class="display">Uno</h1>
      <p>Le Uno se joue sur invitation. Ouvre le lien de partie qu'on t'a envoyé, ou connecte-toi si tu es membre du gang.</p>
      <p><a class="btn btn-primary" href="compte.html?next=${encodeURIComponent('uno.html')}">Me connecter</a></p></section>`;
    app.setAttribute('aria-busy', 'false');
    return;
  }
  const charger = ECRANS[r.nom] || ECRANS.accueil;
  app.setAttribute('aria-busy', 'true');
  try {
    const mod = await charger();
    if (mon !== jeton) return;
    app.innerHTML = '';
    document.body.dataset.unoEcran = r.nom;
    const res = await mod.afficher(app, { code: r.arg, naviguer, moi });
    if (mon !== jeton) { if (typeof res === 'function') res(); return; }
    nettoyer = typeof res === 'function' ? res : null;
  } catch (e) {
    console.error('[uno]', e);
    app.innerHTML = '<section class="card uno-erreur"><h1 class="display">Oups</h1><p>Cet écran n\'a pas pu s\'afficher.</p><p><a class="btn btn-primary" href="uno.html">Retour au Uno</a></p></section>';
  } finally {
    app.setAttribute('aria-busy', 'false');
    window.scrollTo({ top: 0 });
  }
}

window.addEventListener('hashchange', afficher);
afficher();
