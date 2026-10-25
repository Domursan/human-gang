// ===== Humane Gang — Duels (duels.html) : démarrage et navigation entre les écrans =====
/*
 * Rôle : initialise la page (session membre, accès à la page « duels » : admins seulement au lancement),
 * puis affiche l'écran demandé par l'adresse :
 *   (vide) accueil · #creer (ou #creer/p4, #creer/morpion, #creer/mastermind, #creer/membre/<uuid>) création ·
 *   #rejoindre/CODE rejoindre (membre, invité ou défi reçu) · #partie/CODE duel (attente, table, fin) ·
 *   #stats statistiques · #jour code du jour (Mastermind solo).
 *   duels.html?code=HGP4-1234 (lien d'invitation) mène à #rejoindre/HGP4-1234.
 * Visiteur sans compte (lien d'invitation) : mode invité, seuls #rejoindre et #partie sont ouverts.
 * Chaque écran est un module de assets/js/duels/vues/ qui exporte afficher(root, ctx) et peut renvoyer une fonction de nettoyage.
 * Dépendances : core.js (initPage, $, motionAllowed, loadMyPages, pageLabel), duels/api.js.
 * Exporte : naviguer.
 */
import { initPage, $, motionAllowed, loadMyPages, pageLabel } from './core.js';
import { activerInvite } from './duels/api.js';

const moi = await initPage({ auth: 'optional' });
const INVITE = !moi;
activerInvite(INVITE);
// Garde-fou : tant que la page n'est pas déclarée dans hg_pages (migration pas encore appliquée), seul l'admin entre.
if (!INVITE) await loadMyPages();
if (!INVITE && !pageLabel('duels') && !moi?.is_admin) {
  location.replace('jeux.html');
  await new Promise(() => {});
}
document.body.classList.toggle('duels-calme', !motionAllowed());

const app = $('#app');
let nettoyer = null;
let jeton = 0;

/** Route courante d'après l'adresse : { nom, arg, arg2 }. */
function route() {
  const q = new URLSearchParams(location.search).get('code');
  if (q && !location.hash) history.replaceState(null, '', `duels.html#rejoindre/${encodeURIComponent(q.toUpperCase())}`);
  const [nom, arg, arg2] = location.hash.replace(/^#/, '').split('/');
  const code = (n) => (['rejoindre', 'partie'].includes(n) && arg ? decodeURIComponent(arg).toUpperCase() : (arg ? decodeURIComponent(arg) : null));
  return { nom: nom || 'accueil', arg: code(nom), arg2: arg2 ? decodeURIComponent(arg2) : null };
}

/** Change d'écran (met à jour l'adresse). */
export function naviguer(hash) {
  if (location.hash === hash || (!hash && !location.hash)) afficher(); else location.hash = hash;
}

const ECRANS = {
  accueil: () => import('./duels/vues/accueil.js'),
  creer: () => import('./duels/vues/creer.js'),
  rejoindre: () => import('./duels/vues/rejoindre.js'),
  partie: () => import('./duels/vues/partie.js'),
  stats: () => import('./duels/vues/stats.js'),
  jour: () => import('./duels/vues/jour.js'),
};

async function afficher() {
  const mon = ++jeton;
  try { nettoyer?.(); } catch { /* sans effet */ }
  nettoyer = null;
  const r = route();
  if (INVITE && !(['rejoindre', 'partie'].includes(r.nom) && r.arg)) {
    app.innerHTML = `<section class="card duels-erreur"><h1 class="display">Duels</h1>
      <p>Les duels se jouent sur invitation. Ouvre le lien qu'on t'a envoyé, ou connecte-toi si tu es membre du gang.</p>
      <p><a class="btn btn-primary" href="compte.html?next=${encodeURIComponent('duels.html')}">Me connecter</a></p></section>`;
    app.setAttribute('aria-busy', 'false');
    return;
  }
  const charger = ECRANS[r.nom] || ECRANS.accueil;
  app.setAttribute('aria-busy', 'true');
  try {
    const mod = await charger();
    if (mon !== jeton) return;
    app.innerHTML = '';
    document.body.dataset.duelsEcran = r.nom;
    const res = await mod.afficher(app, { code: r.arg, arg: r.arg, arg2: r.arg2, naviguer, moi });
    if (mon !== jeton) { if (typeof res === 'function') res(); return; }
    nettoyer = typeof res === 'function' ? res : null;
  } catch (e) {
    console.error('[duels]', e);
    app.innerHTML = '<section class="card duels-erreur"><h1 class="display">Oups</h1><p>Cet écran n\'a pas pu s\'afficher.</p><p><a class="btn btn-primary" href="duels.html">Retour aux duels</a></p></section>';
  } finally {
    app.setAttribute('aria-busy', 'false');
    window.scrollTo({ top: 0 });
  }
}

window.addEventListener('hashchange', afficher);
afficher();
