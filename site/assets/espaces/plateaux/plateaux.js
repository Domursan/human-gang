// ===== Humane Gang — Jeux de plateau (cluedo, shadow-hunters, destins, monopoly, risk) : démarrage et navigation =====
/*
 * Rôle : initialise la page (jeu fixé par <body data-jeu>, session membre, accès à la page du jeu : admins seulement
 * tant que la page n'est pas déclarée), puis affiche l'écran demandé par l'adresse :
 *   (vide) accueil · #creer création · #rejoindre/CODE rejoindre · #partie/CODE partie · #stats.
 *   <page>?code=PREFIXE-1234 (lien d'invitation) mène à #rejoindre/PREFIXE-1234.
 * Visiteur sans compte (lien d'invitation) : mode invité, seuls #rejoindre et #partie sont ouverts.
 * Chaque écran est un module de assets/js/plateaux/vues/ qui exporte afficher(root, ctx) (accueil, creer,
 * rejoindre, stats) ou creer(root, ctx) (partie, qui charge salle / table / fin).
 * Dépendances : core.js (initPage, $, motionAllowed, loadMyPages, pageLabel), plateaux/api.js (choisirJeu, JEUX, activerInvite).
 * Exporte : naviguer.
 */
import { initPage, $, motionAllowed, loadMyPages, pageLabel, esc } from './core.js';
import { choisirJeu, jeu, activerInvite } from './plateaux/api.js';

const id = document.body.dataset.jeu || '';
const JEU = choisirJeu(id);
const app = $('#app');

/** Affiche une carte d'erreur simple dans #app. */
function carteErreur(titre, texte, lien = { href: 'jeux.html', nom: 'Retour aux jeux' }) {
  app.innerHTML = `<section class="card plat-erreur"><h1 class="display">${esc(titre)}</h1>
    <p>${esc(texte)}</p>
    <p><a class="btn btn-primary" href="${esc(lien.href)}">${esc(lien.nom)}</a></p></section>`;
  app.setAttribute('aria-busy', 'false');
}

if (!JEU) {
  carteErreur('Jeu inconnu', 'Cette page ne correspond à aucun jeu de plateau.');
  await new Promise(() => {});
}

const moi = await initPage({ auth: 'optional' });
const INVITE = !moi;
activerInvite(INVITE);
// Garde-fou : tant que la page du jeu n'est pas déclarée (migration pas encore appliquée), seul l'admin entre.
if (!INVITE) await loadMyPages();
if (!INVITE && !pageLabel(JEU.slug) && !moi?.is_admin) {
  location.replace('jeux.html');
  await new Promise(() => {});
}
document.body.classList.toggle('plat-calme', !motionAllowed());

let nettoyer = null;
let jeton = 0;

/** Route courante d'après l'adresse. */
function route() {
  const q = new URLSearchParams(location.search).get('code');
  if (q && !location.hash) {
    history.replaceState(null, '', `${location.pathname}#rejoindre/${encodeURIComponent(q.toUpperCase())}`);
  }
  const [nom, arg] = location.hash.replace(/^#/, '').split('/');
  return { nom: nom || 'accueil', arg: arg ? decodeURIComponent(arg).toUpperCase() : null };
}

/** Change d'écran (met à jour l'adresse). */
export function naviguer(hash) {
  if (location.hash === hash) afficher(); else location.hash = hash;
}

const ECRANS = {
  accueil: () => import('./plateaux/vues/accueil.js'),
  creer: () => import('./plateaux/vues/creer.js'),
  rejoindre: () => import('./plateaux/vues/rejoindre.js'),
  partie: () => import('./plateaux/vues/partie.js'),
  stats: () => import('./plateaux/vues/stats.js'),
};

async function afficher() {
  const mon = ++jeton;
  try { nettoyer?.(); } catch { /* sans effet */ }
  nettoyer = null;
  const r = route();
  if (INVITE && !(['rejoindre', 'partie'].includes(r.nom) && r.arg)) {
    app.innerHTML = `<section class="card plat-erreur"><h1 class="display">${esc(JEU.nom)}</h1>
      <p>${esc(JEU.nom)} se joue sur invitation. Ouvre le lien de partie qu'on t'a envoyé, ou connecte-toi si tu es membre du gang.</p>
      <p><a class="btn btn-primary" href="compte.html?next=${encodeURIComponent(JEU.page)}">Me connecter</a></p></section>`;
    app.setAttribute('aria-busy', 'false');
    return;
  }
  const charger = ECRANS[r.nom] || ECRANS.accueil;
  app.setAttribute('aria-busy', 'true');
  try {
    const mod = await charger();
    if (mon !== jeton) return;
    app.innerHTML = '';
    document.body.dataset.plateauEcran = r.nom;
    const res = await mod.afficher(app, { code: r.arg, naviguer, moi });
    if (mon !== jeton) { if (typeof res === 'function') res(); return; }
    nettoyer = typeof res === 'function' ? res : null;
  } catch (e) {
    console.error('[plateaux]', e);
    app.innerHTML = `<section class="card plat-erreur"><h1 class="display">Oups</h1><p>Cet écran n'a pas pu s'afficher.</p>
      <p><a class="btn btn-primary" href="${esc(JEU.page)}">Retour à ${esc(JEU.nom)}</a></p></section>`;
  } finally {
    app.setAttribute('aria-busy', 'false');
    window.scrollTo({ top: 0 });
  }
}

window.addEventListener('hashchange', afficher);
afficher();
