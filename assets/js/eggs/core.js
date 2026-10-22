// ===== Humane Gang — secrets cachés : effets et déclencheurs (chargé par site-boot.js) =====
/*
 * Rôle : les secrets visibles de tout le site. Code Konami (clavier ; glissements puis deux tapotements sur le logo
 * sur mobile), logo cliqué sept fois, mot « humane » (mode arc-en-ciel), heure de Zurich (13 h 37 et nuit profonde
 * à 3 h), anniversaire du gang (confettis et bannière), et énigme dans la console du navigateur.
 * Chaque effet est visuel ; le serveur est prévenu par eggFound (api.js), qui ne lève jamais d'exception.
 * Les effets respectent prefers-reduced-motion (version calme) et la préférence d'effets du site, et n'interceptent
 * jamais la saisie dans les champs de formulaire.
 * Page : toutes les pages (importé après le chargement par site-boot.js, sans ralentir le démarrage).
 * Dépendances : ../core.js (currentLogo, motionAllowed, effectsEnabled, sb, hasSession), ./api.js (eggFound).
 * Exporte : initEggs().
 */
import { currentLogo, motionAllowed, effectsEnabled, sb, hasSession } from '../core.js';
import { eggFound } from './api.js';

/* ---------- Constantes ---------- */

/** Suite de touches du code Konami au clavier (lettres en minuscules). */
const KONAMI_CLAVIER = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
/** Suite de glissements du code Konami sur écran tactile. */
const KONAMI_TACTILE = ['haut', 'haut', 'bas', 'bas', 'gauche', 'droite', 'gauche', 'droite'];
const SEUIL_GLISSEMENT = 40;        // px : distance minimale d'un glissement
const DELAI_GESTES = 1500;          // ms : délai maximal entre deux glissements
const FENETRE_TAPOTEMENTS = 3000;   // ms : délai pour taper deux fois le logo après les glissements
const PLUIE_MS = 4000;              // durée de la pluie de logos
const CALME_MS = 2500;              // durée de la version calme (mouvement réduit)
const ARC_MS = 30000;               // durée du mode arc-en-ciel
const CLICS_LOGO = 7;               // nombre de clics sur le logo…
const FENETRE_LOGO = 4000;          // …en moins de 4 s
const PAUSE_LOGO = 800;             // au-delà de 800 ms sans clic, la série repart à zéro
const VERIFIE_MS = 20000;           // fréquence de vérification de l'heure de Zurich
const MOT_SECRET = 'humane';

/* ---------- Outils ---------- */

/** Formateur de l'heure et de la date à Zurich (heures sur 24). */
const fmtZurich = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/**
 * Heure et date à Zurich, à l'instant donné.
 * @param {Date} [date] instant (maintenant par défaut)
 * @returns {{h: number, min: number, ymd: string, md: string}} heures, minutes, date « AAAA-MM-JJ » et « MM-JJ »
 */
function heureZurich(date = new Date()) {
  const p = Object.fromEntries(fmtZurich.formatToParts(date).map((x) => [x.type, x.value]));
  return { h: Number(p.hour), min: Number(p.minute), ymd: `${p.year}-${p.month}-${p.day}`, md: `${p.month}-${p.day}` };
}

/**
 * Vrai si le focus se trouve dans un champ de saisie : les touches tapées ne doivent alors rien déclencher.
 * @returns {boolean}
 */
function dansChamp() {
  const el = document.activeElement;
  return !!el && (el.matches('input, textarea, select') || el.isContentEditable);
}

/**
 * Lit une valeur de sessionStorage. Renvoie null si le stockage est bloqué.
 * @param {string} cle
 * @returns {string|null}
 */
function lectureStock(cle) {
  try { return sessionStorage.getItem(cle); } catch { return null; }
}

/**
 * Écrit une valeur dans sessionStorage. Sans effet si le stockage est bloqué.
 * @param {string} cle
 * @param {string} valeur
 */
function ecritureStock(cle, valeur) {
  try { sessionStorage.setItem(cle, valeur); } catch { /* stockage bloqué : sans importance */ }
}

/**
 * Nombre aléatoire entre a et b.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * Charge la feuille de style des secrets (assets/css/eggs.css), une seule fois.
 */
function chargeCss() {
  if (document.querySelector('link[data-eggs]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/eggs.css', import.meta.url).href;
  l.dataset.eggs = '';
  document.head.append(l);
}

/* ---------- Code Konami : clavier ---------- */

let posClavier = 0;

/**
 * Suit le code Konami au clavier. Ne bloque aucune touche (la navigation et le défilement restent libres).
 * @param {KeyboardEvent} e
 */
function gereClavier(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || dansChamp()) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === KONAMI_CLAVIER[posClavier]) posClavier++;
  else posClavier = k === KONAMI_CLAVIER[0] ? 1 : 0;
  if (posClavier === KONAMI_CLAVIER.length) {
    posClavier = 0;
    konami();
  }
}

/* ---------- Code Konami : tactile (glissements, puis deux tapotements sur le logo) ---------- */

let depart = null;            // point de départ du contact en cours
let posTactile = 0;
let dernierGeste = 0;
let tapotementsJusqua = 0;    // fin de la fenêtre où deux tapotements sur le logo comptent
let nbTapotements = 0;

/**
 * Début d'un contact tactile : mémorise son point de départ (un seul doigt, hors champs de saisie).
 * @param {TouchEvent} e
 */
function debutTactile(e) {
  depart = null;
  if (e.touches.length !== 1 || e.target.closest?.('input, textarea, select')) return;
  depart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}

/**
 * Fin d'un contact tactile : si c'est un glissement assez long, il compte comme un geste du code Konami.
 * @param {TouchEvent} e
 */
function finTactile(e) {
  if (!depart || !e.changedTouches.length) return;
  const dx = e.changedTouches[0].clientX - depart.x;
  const dy = e.changedTouches[0].clientY - depart.y;
  depart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SEUIL_GLISSEMENT) return;
  const dir = Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 'haut' : 'bas') : (dx < 0 ? 'gauche' : 'droite');
  geste(dir);
}

/**
 * Enregistre un glissement dans la suite Konami. Une pause de plus de 1,5 s remet la suite à zéro.
 * Une fois la suite complète, ouvre la fenêtre des deux tapotements sur le logo.
 * @param {string} dir direction : 'haut', 'bas', 'gauche' ou 'droite'
 */
function geste(dir) {
  const now = Date.now();
  if (now - dernierGeste > DELAI_GESTES) posTactile = 0;
  dernierGeste = now;
  if (dir === KONAMI_TACTILE[posTactile]) posTactile++;
  else posTactile = dir === KONAMI_TACTILE[0] ? 1 : 0;
  if (posTactile === KONAMI_TACTILE.length) {
    posTactile = 0;
    tapotementsJusqua = now + FENETRE_TAPOTEMENTS;
    nbTapotements = 0;
  }
}

/* ---------- Clics sur le logo (tapotements Konami et logo cliqué sept fois) ---------- */

let clicsLogo = [];          // horodatages des clics récents sur le logo
let dernierClicLogo = 0;
let navigation = 0;          // minuterie de la navigation vers l'accueil, annulée par une série de clics

/**
 * Gère les clics sur le logo (lien « .brand »). La navigation vers l'accueil est retardée de 800 ms,
 * le temps de voir si d'autres clics suivent : sept clics rapides déclenchent le secret, un clic isolé mène à l'accueil.
 * Les tapotements (après les glissements Konami) sont comptés à part.
 * @param {MouseEvent} e
 */
function clicLogo(e) {
  const brand = e.target instanceof Element ? e.target.closest('a.brand') : null;
  if (!brand || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  clearTimeout(navigation);
  const now = Date.now();

  // Deux tapotements sur le logo, juste après le glissement complet : code Konami tactile
  if (now < tapotementsJusqua && e.target.closest('.brand-logo')) {
    nbTapotements++;
    if (nbTapotements === 2) {
      tapotementsJusqua = 0;
      konami();
      return;
    }
  }

  // Sept clics rapides : le logo fait une pirouette et le secret est signalé
  if (now - dernierClicLogo > PAUSE_LOGO) clicsLogo = [];
  dernierClicLogo = now;
  clicsLogo = clicsLogo.filter((t) => now - t < FENETRE_LOGO);
  clicsLogo.push(now);
  if (clicsLogo.length >= CLICS_LOGO) {
    clicsLogo = [];
    pirouette(brand);
    eggFound('logo');
    return;
  }

  // Clic isolé : on mène à l'accueil, après la pause de la série
  navigation = setTimeout(() => { location.href = brand.href; }, PAUSE_LOGO);
}

/**
 * Fait tourner le logo une fois (pirouette). Sans effet visible si le mouvement est réduit (animation coupée).
 * @param {Element} brand lien du logo
 */
function pirouette(brand) {
  const img = brand.querySelector('.brand-logo');
  if (!img) return;
  img.classList.remove('egg-pirouette');
  void img.offsetWidth; // relance l'animation si elle était déjà jouée
  img.classList.add('egg-pirouette');
  setTimeout(() => img.classList.remove('egg-pirouette'), 1000);
}

/* ---------- Code Konami : effet ---------- */

let konamiEnCours = false;

/**
 * Effet du code Konami : pluie de logos pendant quatre secondes, puis signalement au serveur.
 * Mouvement réduit : un logo fixe pendant deux secondes et demie. Effets coupés : signalement immédiat.
 */
function konami() {
  if (konamiEnCours) return;
  if (!effectsEnabled()) { eggFound('konami'); return; }
  konamiEnCours = true;
  const anime = motionAllowed();
  if (anime) pluieLogos();
  else calmeLogo();
  setTimeout(() => {
    konamiEnCours = false;
    eggFound('konami');
  }, anime ? PLUIE_MS : CALME_MS);
}

/**
 * Pluie de logos du site qui tombent sur l'écran (calque décoratif, sans interaction).
 */
function pluieLogos() {
  const calque = document.createElement('div');
  calque.className = 'egg-calque egg-pluie';
  calque.setAttribute('aria-hidden', 'true');
  const logo = currentLogo();
  const n = innerWidth < 600 ? 14 : 26;
  for (let i = 0; i < n; i++) {
    const img = document.createElement('img');
    img.src = logo;
    img.alt = '';
    img.style.left = `${rnd(0, 94).toFixed(1)}%`;
    img.style.width = img.style.height = `${rnd(28, 56).toFixed(0)}px`;
    img.style.animationDuration = `${rnd(2.2, 3.2).toFixed(2)}s`;
    img.style.animationDelay = `${rnd(0, 0.8).toFixed(2)}s`;
    img.style.setProperty('--dx', `${rnd(-60, 60).toFixed(0)}px`);
    img.style.setProperty('--r', `${rnd(-200, 200).toFixed(0)}deg`);
    calque.append(img);
  }
  document.body.append(calque);
  setTimeout(() => calque.remove(), PLUIE_MS + 300);
}

/**
 * Version calme du code Konami (mouvement réduit) : le logo reste immobile au centre de l'écran.
 */
function calmeLogo() {
  const calque = document.createElement('div');
  calque.className = 'egg-calque egg-calme';
  calque.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');
  img.src = currentLogo();
  img.alt = '';
  calque.append(img);
  document.body.append(calque);
  setTimeout(() => calque.remove(), CALME_MS + 300);
}

/* ---------- Mot « humane » : mode arc-en-ciel ---------- */

let tampon = '';          // dernières lettres tapées (6 au plus)
let arcActif = false;
let arcTimer = 0;

/**
 * Suit les lettres tapées pour reconnaître le mot « humane ». Ignore les champs de saisie et les raccourcis.
 * @param {KeyboardEvent} e
 */
function gereMot(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || dansChamp()) return;
  tampon = (tampon + e.key.toLowerCase()).slice(-MOT_SECRET.length);
  if (tampon === MOT_SECRET) {
    tampon = '';
    arcBascule();
  }
}

/**
 * Active ou désactive le mode arc-en-ciel : retaper le mot pendant le mode l'arrête plus tôt.
 */
function arcBascule() {
  if (arcActif) { arcArrete(); return; }
  arcActif = true;
  if (effectsEnabled()) document.documentElement.classList.add('egg-arc');
  arcTimer = setTimeout(arcArrete, ARC_MS);
}

/**
 * Arrête le mode arc-en-ciel (fin de la durée ou mot retapé) et signale le secret au serveur.
 */
function arcArrete() {
  clearTimeout(arcTimer);
  arcActif = false;
  document.documentElement.classList.remove('egg-arc');
  eggFound('humane');
}

/* ---------- Heure du gang (13 h 37) et nuit profonde (3 h) à Zurich ---------- */

let heureVue = false;

/**
 * Affiche « 13 h 37 · l'heure du gang » dans le pied de page quand il est 13 h 37 à Zurich.
 * Le pied peut arriver après la page : on réessaie à chaque vérification tant qu'il n'est pas là.
 */
function verifieHeure() {
  if (heureVue) return;
  const z = heureZurich();
  if (z.h !== 13 || z.min !== 37) return;
  const pied = document.querySelector('.site-footer > .container') || document.querySelector('.site-footer');
  if (!pied) return;
  heureVue = true;
  const p = document.createElement('p');
  p.className = 'egg-gang egg-gang-anim';
  p.setAttribute('role', 'status');
  p.textContent = '13 h 37 · l\'heure du gang';
  pied.append(p);
  eggFound('heure_gang', {}, { silencieux: true });
}

/**
 * Fait traverser le bas de l'écran à une petite chouette, une fois par nuit, entre 3 h et 3 h 59 à Zurich.
 * Mouvement réduit : la chouette reste fixe dans l'angle, avec sa bulle, pendant six secondes.
 */
function verifieNuit() {
  const z = heureZurich();
  if (z.h !== 3) return;
  const cle = `hg_egg_nuit_${z.ymd}`;
  if (lectureStock(cle)) return;
  ecritureStock(cle, '1');
  eggFound('nuit', {}, { silencieux: true });
  if (effectsEnabled()) chouette();
}

/**
 * Affiche la chouette et sa bulle « Toi aussi tu ne dors pas ? », qui traverse le bas de l'écran (ou reste fixe en mouvement réduit).
 */
function chouette() {
  const anime = motionAllowed();
  const calque = document.createElement('div');
  calque.className = 'egg-calque egg-nuit';
  calque.setAttribute('aria-hidden', 'true');
  const wrap = document.createElement('div');
  wrap.className = anime ? 'egg-chouette' : 'egg-chouette egg-chouette-calme';
  const bulle = document.createElement('span');
  bulle.className = 'egg-bulle';
  bulle.textContent = 'Toi aussi tu ne dors pas ?';
  const oiseau = document.createElement('span');
  oiseau.className = 'egg-oiseau';
  oiseau.textContent = '🦉';
  wrap.append(bulle, oiseau);
  calque.append(wrap);
  document.body.append(calque);
  setTimeout(() => calque.remove(), anime ? 9500 : 6000);
}

/* ---------- Anniversaire du gang (membres connectés, accueil et cartes) ---------- */

/**
 * Si aujourd'hui est l'anniversaire du gang (réglage hg_settings.eggs.anniversaire_gang, date de Zurich), affiche
 * une bannière qui donne la part de gâteau, et des confettis une fois par jour. Ne fait rien pour un visiteur.
 */
async function verifieAnniversaire() {
  if (!/(^|\/)(accueil|cartes)(\.html)?$/.test(location.pathname)) return;
  const z = heureZurich();
  try {
    if (!(await hasSession())) return;
    const { data, error } = await sb.from('hg_settings').select('value').eq('key', 'eggs').maybeSingle();
    if (error || data?.value?.anniversaire_gang !== z.md) return;
  } catch { return; }
  const cle = `hg_egg_anniv_${z.ymd}`;
  if (!lectureStock(cle)) {
    ecritureStock(cle, '1');
    if (motionAllowed()) confettis();
  }
  banniere();
}

/**
 * Bannière « Joyeux anniversaire au gang ! » en haut de la page. Un clic donne la part de gâteau (secret « anniversaire »).
 */
function banniere() {
  const cible = document.querySelector('#app') || document.querySelector('main');
  if (!cible) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'egg-anniv';
  b.textContent = 'Joyeux anniversaire au gang ! Clique pour ta part de gâteau';
  b.addEventListener('click', async () => {
    b.disabled = true;
    await eggFound('anniversaire');
    b.remove();
  }, { once: true });
  cible.prepend(b);
}

/**
 * Confettis qui tombent sur l'écran pendant quatre secondes (calque décoratif).
 */
function confettis() {
  const calque = document.createElement('div');
  calque.className = 'egg-calque egg-confetti';
  calque.setAttribute('aria-hidden', 'true');
  const couleurs = ['var(--rb-1)', 'var(--rb-2)', 'var(--rb-3)', 'var(--rb-4)', 'var(--rb-5)', 'var(--rb-6)', 'var(--sand)'];
  for (let i = 0; i < 70; i++) {
    const s = document.createElement('span');
    s.style.left = `${rnd(0, 100).toFixed(1)}%`;
    s.style.background = couleurs[i % couleurs.length];
    s.style.animationDuration = `${rnd(2.8, 4).toFixed(2)}s`;
    s.style.animationDelay = `${rnd(0, 0.6).toFixed(2)}s`;
    s.style.setProperty('--dx', `${rnd(-80, 80).toFixed(0)}px`);
    s.style.setProperty('--r', `${rnd(-540, 540).toFixed(0)}deg`);
    calque.append(s);
  }
  document.body.append(calque);
  setTimeout(() => calque.remove(), 4500);
}

/* ---------- Console : énigme ---------- */

/**
 * Écrit dans la console du navigateur une courte énigme qui mène à la page secrète (secret.html).
 */
function enigmeConsole() {
  console.log('%cHumane Gang', 'font: 900 30px system-ui, sans-serif; color: #9E3543; text-shadow: 2px 2px 0 #E2C77E;');
  console.log('%c Il y a des choses cachées ici. Voici la première : ', 'font: 15px system-ui, sans-serif; color: #F2EFEA; background: #17171A; padding: 4px 8px;');
  console.log('%cJe suis caché, mais tout le monde peut me trouver. Mon nom est le contraire de « public ». Ajoute-le à l\'adresse du site, en .html.', 'font: 14px system-ui, sans-serif; color: #E2C77E;');
  console.log('%cLes anciens joueurs connaissent un code : ↑↑↓↓←→←→BA', 'font: 13px monospace; color: #ABA7A0;');
}

/* ---------- Initialisation ---------- */

let initialise = false;

/**
 * Met en place les secrets de la page : écouteurs (clavier, tactile, clics sur le logo), calque arc-en-ciel,
 * énigme de la console, vérifications de l'heure (toutes les 20 s) et de l'anniversaire. Ne s'exécute qu'une fois.
 */
export function initEggs() {
  if (initialise) return;
  initialise = true;
  chargeCss();

  // Voile arc-en-ciel : affiché seulement quand <html> porte la classe egg-arc (voir eggs.css)
  const voile = document.createElement('div');
  voile.className = 'egg-arc-calque';
  voile.setAttribute('aria-hidden', 'true');
  document.body.append(voile);

  document.addEventListener('keydown', (e) => { gereClavier(e); gereMot(e); });
  document.addEventListener('touchstart', debutTactile, { passive: true });
  document.addEventListener('touchend', finTactile, { passive: true });
  document.addEventListener('click', clicLogo);

  enigmeConsole();
  verifieHeure();
  verifieNuit();
  setInterval(() => { verifieHeure(); verifieNuit(); }, VERIFIE_MS);
  verifieAnniversaire();
}
