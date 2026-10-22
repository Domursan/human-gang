// État du site : bandeau d'annonce et écran de maintenance (réglages site_identite, Admin › Site › État du site).
/*
 * Rôle : lit les réglages déjà chargés (siteIdentite(), voir site-load.js) et, selon eux :
 *   - affiche un bandeau d'annonce sous l'en-tête de chaque page (fermable pour la session) ;
 *   - remplace visuellement le contenu de la page par un écran « Site en maintenance ».
 * C'est un affichage, pas une barrière de sécurité : les données restent protégées par la base (RLS),
 * pas par cet écran. L'administrateur et le Staff ne voient jamais l'écran de maintenance, et les pages
 * admin, compte, legal, offline et 404 ne sont jamais bloquées (on peut toujours se connecter et régler le site).
 * Sans les champs (site en ligne avant leur ajout) ou avec des valeurs invalides : aucun effet.
 * Page : toutes les pages qui appellent initPage (core/init.js l'appelle une fois l'en-tête et les droits prêts).
 * Dépendances : site-defaults.js (siteIdentite, fmt), util.js (esc), pages-access.js (currentPageSlug).
 * Styles : assets/css/site-etat.css, ajouté à la page seulement quand il sert (aucun <link> à poser dans les pages).
 * Stockage : sessionStorage « hg_bandeau_ferme » (empreinte du texte fermé : un nouveau texte réapparaît).
 * Exporte : applySiteEtat, MAINTENANCE_DEFAUT, PAGES_LIBRES.
 */
import { siteIdentite, fmt } from './site-defaults.js';
import { esc } from './util.js';
import { currentPageSlug } from './pages-access.js';

/* ---------- Constantes ---------- */

/** Message affiché quand le mode maintenance est actif sans texte saisi. */
export const MAINTENANCE_DEFAUT = 'Le site est en maintenance, reviens un peu plus tard.';
/** Pages jamais bloquées par la maintenance (connexion, panel, mentions légales, pages hors ligne et introuvable). */
export const PAGES_LIBRES = new Set(['admin', 'compte', 'legal', 'offline', '404']);
/** Pages sans bandeau d'annonce (le panel a sa propre mise en page ; l'état y est réglé). */
const SANS_BANDEAU = new Set(['admin']);
/** Longueurs maximales affichées (mêmes limites que le formulaire). */
const MAX_MESSAGE = 400, MAX_BANDEAU = 300;
/** Clé sessionStorage : empreinte du dernier bandeau fermé. */
const FERME_KEY = 'hg_bandeau_ferme';
/** Feuille de style, chargée à la demande (chemin relatif à ce module : fonctionne aussi sous /human-gang/). */
const CSS_URL = new URL('../../css/site-etat.css', import.meta.url).href;

/* ---------- Utilitaires ---------- */

/** Ajoute la feuille de style une seule fois. */
function ensureCss() {
  if (document.querySelector('link[data-site-etat]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = CSS_URL; l.dataset.siteEtat = '';
  document.head.appendChild(l);
}

/**
 * Empreinte courte d'un texte (pour savoir si le bandeau fermé est le même).
 * @param {string} s Texte.
 * @returns {string}
 */
function empreinte(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

/** Lit sessionStorage sans jamais lever d'erreur. */
const lire = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
/** Écrit sessionStorage sans jamais lever d'erreur (stockage bloqué : le bandeau revient à la page suivante). */
const ecrire = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* sans objet */ } };

/**
 * Valeurs utiles de l'état du site, nettoyées. Champs absents ou mal typés : désactivé.
 * @returns {{maintenance: boolean, message: string, bandeau: boolean, texte: string}}
 */
function etat() {
  const id = siteIdentite() || {};
  const txt = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    maintenance: id.maintenance_active === true,
    message: txt(id.maintenance_message, MAX_MESSAGE),
    bandeau: id.bandeau_actif === true,
    texte: txt(id.bandeau_texte, MAX_BANDEAU),
  };
}

/* ---------- Bandeau d'annonce ---------- */

/**
 * Pose le bandeau sous l'en-tête (ou en haut de la page), sauf s'il a été fermé pendant la session.
 * @param {string} texte Texte de l'annonce (non vide).
 */
function poseBandeau(texte) {
  const shown = fmt(texte);
  const sig = empreinte(shown);
  document.querySelector('.site-bandeau')?.remove();
  if (lire(FERME_KEY) === sig) return;
  ensureCss();
  const el = document.createElement('div');
  el.className = 'site-bandeau';
  el.setAttribute('role', 'status');
  el.innerHTML = `<p class="site-bandeau-texte">${esc(shown)}</p>
    <button class="site-bandeau-fermer" type="button" aria-label="Fermer l’annonce"><span aria-hidden="true">×</span></button>`;
  el.querySelector('button').addEventListener('click', () => { ecrire(FERME_KEY, sig); el.remove(); });
  const header = document.querySelector('body > .site-header');
  if (header) header.after(el); else document.body.prepend(el);
}

/* ---------- Écran de maintenance ---------- */

/**
 * Masque le contenu de la page (classe sur <body>) et affiche l'écran de maintenance avant <main>.
 * Le contenu reste dans la page (pas de suppression) : c'est un affichage, pas une protection.
 * @param {string} message Message saisi par l'admin (vide : message par défaut).
 * @param {boolean} connecte Vrai si un membre est connecté (texte du lien).
 */
function poseMaintenance(message, connecte) {
  ensureCss();
  document.getElementById('site-maint')?.remove();
  const sec = document.createElement('section');
  sec.id = 'site-maint';
  sec.className = 'site-maint container';
  sec.setAttribute('aria-labelledby', 'site-maint-titre');
  sec.innerHTML = `<h1 id="site-maint-titre" class="display">Site en maintenance</h1>
    <p class="site-maint-texte">${esc(fmt(message || MAINTENANCE_DEFAUT))}</p>
    <p class="small muted">${connecte ? 'Tu fais partie du Staff ? Connecte-toi avec ton compte Staff pour continuer.' : 'Tu fais partie du Staff ? Connecte-toi pour continuer.'}</p>
    <p><a class="btn btn-ghost" href="compte.html">${connecte ? 'Changer de compte' : 'Se connecter'}</a></p>`;
  const main = document.getElementById('app') || document.querySelector('main');
  if (main) main.before(sec); else document.body.appendChild(sec);
  document.body.classList.add('site-maint-on');
  if (main) main.setAttribute('aria-hidden', 'true');
}

/* ---------- Point d'entrée ---------- */

/**
 * Applique l'état du site à la page courante. Ne lève jamais d'erreur.
 * @param {{isStaff?: boolean, connecte?: boolean, slug?: string}} [options]
 *   isStaff : administrateur ou Staff (jamais d'écran de maintenance) ;
 *   connecte : un membre est connecté (texte du lien) ; slug : page courante (par défaut celle de l'adresse).
 * @returns {{maintenance: boolean, bandeau: boolean}} Ce qui a été affiché.
 */
export function applySiteEtat({ isStaff = false, connecte = false, slug = currentPageSlug() } = {}) {
  const out = { maintenance: false, bandeau: false };
  try {
    const e = etat();
    if (e.bandeau && e.texte && !SANS_BANDEAU.has(slug)) { poseBandeau(e.texte); out.bandeau = !!document.querySelector('.site-bandeau'); }
    if (e.maintenance && !isStaff && !PAGES_LIBRES.has(slug)) { poseMaintenance(e.message, connecte); out.maintenance = true; }
  } catch (err) {
    console.warn('[état du site]', err);
  }
  return out;
}
