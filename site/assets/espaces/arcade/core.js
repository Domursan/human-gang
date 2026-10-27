// ===== Humane Gang — secrets cachés : effets et déclencheurs (chargé par site-boot.js) =====
/*
 * Rôle : les secrets visibles de tout le site. Code Konami (clavier ; glissements puis deux tapotements sur le logo
 * sur mobile), logo cliqué sept fois, mots tapés hors champ (« humane » : mode arc-en-ciel ; « tzatzikistan » :
 * drapeau imaginaire ; « kc » : confettis et fanfare ; « serge » : couronne sur une carte ; « domu » : petite voiture
 * chargée), heure de Zurich (13 h 37 et nuit profonde à 3 h), anniversaire du gang (confettis et bannière), et énigme
 * dans la console du navigateur.
 * Chaque effet est visuel ; le serveur est prévenu par eggFound (api.js), qui ne lève jamais d'exception.
 * Les effets respectent prefers-reduced-motion (version calme) et la préférence d'effets du site, et n'interceptent
 * jamais la saisie dans les champs de formulaire. La fanfare de « kc » suit la préférence de sons (sound.js).
 * Page : toutes les pages (importé après le chargement par site-boot.js, sans ralentir le démarrage).
 * Dépendances : ../core.js (currentLogo, motionAllowed, effectsEnabled, playSound, sb, hasSession), ./api.js (eggFound).
 * Exporte : initEggs(), tryWordSecret(mot) (utilisée par la loupe de recherche, core/search.js).
 */
import { currentLogo, motionAllowed, effectsEnabled, playSound, sb, hasSession } from '../../commun/core.js';
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
const DELAI_MOT = 1500;             // ms : sans frappe pendant ce délai, le tampon des mots repart de zéro
/**
 * Mots tapés hors champ de saisie → code envoyé au serveur (hg_egg_found). « humane » : mode arc-en-ciel (voir arcBascule).
 * Les mots sont en minuscules ; « kc » est court, il ne compte que si les deux dernières touches sont k puis c.
 */
const MOTS = { humane: 'humane', tzatzikistan: 'tzatziki', kc: 'kc', serge: 'serge', domu: 'domumobile' };
/** Longueur du plus long mot : taille du tampon de frappe. */
const MOT_MAX = Math.max(...Object.keys(MOTS).map((m) => m.length));
const DUREE_DRAPEAU = 5000;         // ms : le drapeau du Tzatzikistan flotte (mouvement réduit : 2,5 s, immobile)
const DUREE_CALME = 2500;
const DUREE_KC = 3000;              // ms : confettis bleus et blancs, fanfare
const DUREE_SERGE = 3000;           // ms : la couronne sur la carte
const DUREE_DOMU = 4000;            // ms : la voiture traverse le bas de l'écran
const COULEURS_KC = ['#1F4FA3', '#2F6BC4', '#8FB4E8', '#FFFFFF'];

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
 * Charge la feuille de style des secrets (/assets/espaces/arcade/eggs.css), une seule fois.
 */
function chargeCss() {
  if (document.querySelector('link[data-eggs], link[data-eggs-css]')) return; // une seule balise (lettres.js la pose aussi)
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./eggs.css', import.meta.url).href;
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

let tampon = '';          // dernières lettres tapées hors champ (MOT_MAX au plus)
let dernierCoup = 0;      // horodatage de la dernière lettre tapée hors champ
let arcActif = false;
let arcTimer = 0;
const enCours = new Set(); // effets de mots en cours de lecture (un même effet ne se superpose pas)

/**
 * Suit les lettres tapées pour reconnaître les mots secrets (MOTS). Ignore les champs de saisie et les raccourcis.
 * Le tampon repart de zéro après une pause de 1,5 s sans frappe ; un mot est reconnu quand il finit le tampon.
 * @param {KeyboardEvent} e
 */
function gereMot(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || dansChamp()) return;
  const now = Date.now();
  if (now - dernierCoup > DELAI_MOT) tampon = '';
  dernierCoup = now;
  tampon = (tampon + e.key.toLowerCase()).slice(-MOT_MAX);
  const mot = Object.keys(MOTS).find((m) => tampon.endsWith(m));
  if (mot) {
    tampon = '';
    lanceSecret(MOTS[mot]);
  }
}

/**
 * Lance le secret d'un code : l'effet visuel, puis le signalement au serveur. Effets coupés : signalement immédiat.
 * @param {string} code code du secret (« humane », « tzatziki », « kc », « serge » ou « domumobile »)
 */
function lanceSecret(code) {
  if (code === 'humane') { arcBascule(); return; }
  const effet = EFFETS[code];
  if (!effet || enCours.has(code)) return;
  chargeCss();
  if (!effectsEnabled()) { eggFound(code); return; }
  enCours.add(code);
  const duree = effet(motionAllowed());
  setTimeout(() => {
    enCours.delete(code);
    eggFound(code);
  }, duree);
}

/**
 * Lance un mot secret tapé dans la loupe de recherche (core/search.js), sans casse ni espaces.
 * @param {string} mot le texte saisi
 * @returns {boolean} true si un effet a été lancé (la recherche n'affiche alors pas « Aucun résultat »)
 */
export function tryWordSecret(mot) {
  const m = String(mot ?? '').toLowerCase().replace(/\s+/g, '');
  if (!Object.prototype.hasOwnProperty.call(MOTS, m)) return false;
  lanceSecret(MOTS[m]);
  return true;
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

/* ---------- Mots tapés : tzatziki, kc, serge, domumobile ---------- */

/** Effets des mots (hors « humane ») : chacun ajoute son calque et renvoie sa durée en ms. */
const EFFETS = {
  tzatziki: (anime) => drapeauTzatziki(anime),
  kc: (anime) => fanfareKc(anime),
  serge: (anime) => couronneSerge(anime),
  domumobile: (anime) => voitureDomu(anime),
};

/**
 * Ajoute un calque décoratif (fixe, sans interaction, aria-hidden), retiré après `ms`.
 * @param {string} classe classes supplémentaires du calque
 * @param {number} ms durée d'affichage
 * @returns {HTMLDivElement} le calque, vide
 */
function ajouteCalque(classe, ms) {
  const c = document.createElement('div');
  c.className = `egg-calque ${classe}`;
  c.setAttribute('aria-hidden', 'true');
  document.body.append(c);
  setTimeout(() => c.remove(), ms + 300);
  return c;
}

/** Drapeau imaginaire (fond blanc, bande concombre, rondelle de concombre et gousse d'ail stylisées). */
const SVG_DRAPEAU = `<svg class="egg-drapeau-svg" viewBox="0 0 300 200" focusable="false" aria-hidden="true">
  <rect width="300" height="200" fill="#FFFFFF"/>
  <rect y="140" width="300" height="60" fill="#8DBA5A"/>
  <circle cx="92" cy="100" r="46" fill="#A8D27A" stroke="#5E8F3A" stroke-width="4"/>
  <circle cx="92" cy="100" r="34" fill="#D9EDBE"/>
  <g fill="#5E8F3A">
    <circle cx="119" cy="100" r="3.5"/><circle cx="105.5" cy="123.4" r="3.5"/><circle cx="78.5" cy="123.4" r="3.5"/>
    <circle cx="65" cy="100" r="3.5"/><circle cx="78.5" cy="76.6" r="3.5"/><circle cx="105.5" cy="76.6" r="3.5"/>
  </g>
  <path d="M190 62 C214 50 246 60 240 92 C236 118 206 124 194 108 C182 92 178 72 190 62 Z" fill="#F7F3E4" stroke="#B8AE92" stroke-width="3"/>
  <path d="M191 76 C200 90 204 104 201 118" fill="none" stroke="#B8AE92" stroke-width="2"/>
  <path d="M206 58 C208 48 218 42 226 40" fill="none" stroke="#7A9B4E" stroke-width="3" stroke-linecap="round"/>
</svg>`;

/**
 * Drapeau du Tzatzikistan : il se déroule en haut de l'écran et flotte (ondulation CSS). Mouvement réduit : immobile.
 * @param {boolean} anime mouvement autorisé
 * @returns {number} durée en ms
 */
function drapeauTzatziki(anime) {
  const ms = anime ? DUREE_DRAPEAU : DUREE_CALME;
  const c = ajouteCalque(anime ? 'egg-drapeau' : 'egg-drapeau egg-drapeau-calme', ms);
  c.innerHTML = `<div class="egg-drapeau-bloc"><div class="egg-drapeau-tissu">${SVG_DRAPEAU}</div>
    <p class="egg-legende">Bienvenue au Tzatzikistan. Population : le gang.</p></div>`;
  return ms;
}

/**
 * Kc : confettis bleus et blancs (mouvement permis seulement), fanfare de quatre notes (si les sons sont activés),
 * et le message de l'équipe.
 * @param {boolean} anime mouvement autorisé
 * @returns {number} durée en ms
 */
function fanfareKc(anime) {
  const c = ajouteCalque('egg-kc', DUREE_KC);
  c.innerHTML = '<p class="egg-kc-texte">Le gang pousse derrière son équipe !</p>';
  if (anime) confettis({ couleurs: COULEURS_KC, nombre: 90, duree: DUREE_KC, classe: 'egg-bleu' });
  playSound('fanfare');
  return DUREE_KC;
}

/** Carte de duchés stylisée et couronne (SVG simple, inline). */
const SVG_SERGE = `<svg class="egg-serge-svg" viewBox="0 0 320 200" focusable="false" aria-hidden="true">
  <path class="egg-carte-terre" d="M20 40 L110 16 L170 30 L230 14 L300 40 L292 110 L305 170 L210 186 L140 172 L62 186 L28 150 L40 96 Z"/>
  <path class="egg-carte-limite" d="M110 16 L120 90 L62 186 M170 30 L160 110 L140 172 M230 14 L222 100 L210 186 M40 96 L120 90 L160 110 L222 100 L292 110"/>
  <g class="egg-couronne">
    <path class="egg-or" d="M118 96 L128 60 L146 82 L160 50 L174 82 L192 60 L202 96 Z"/>
    <rect class="egg-or" x="118" y="96" width="84" height="12" rx="2"/>
    <circle class="egg-bijou" cx="128" cy="60" r="4"/><circle class="egg-bijou" cx="160" cy="50" r="4"/><circle class="egg-bijou" cx="192" cy="60" r="4"/>
  </g>
</svg>`;

/**
 * Serge : une couronne posée sur la carte de duchés, au centre de l'écran, avec la règle de la campagne.
 * @param {boolean} anime mouvement autorisé (la couronne tombe et la carte apparaît)
 * @returns {number} durée en ms
 */
function couronneSerge(anime) {
  const c = ajouteCalque(anime ? 'egg-serge' : 'egg-serge egg-serge-calme', DUREE_SERGE);
  c.innerHTML = `<figure class="egg-serge-carte">${SVG_SERGE}
    <figcaption>Les règles de la campagne sont non négociables.</figcaption></figure>`;
  return DUREE_SERGE;
}

/** Petite voiture pixelisée (rouge du gang), coffre et toit chargés de sacs, matelas sur le toit. */
const SVG_VOITURE = `<svg class="egg-voiture-svg" viewBox="0 0 116 56" focusable="false" aria-hidden="true" shape-rendering="crispEdges">
  <rect x="26" y="2" width="46" height="8" fill="#F2EFEA"/>
  <rect x="26" y="8" width="46" height="2" fill="#CFC9BD"/>
  <rect x="76" y="4" width="8" height="8" fill="#C9A46A"/>
  <rect x="85" y="6" width="7" height="6" fill="#8FB4E8"/>
  <rect x="22" y="12" width="56" height="12" fill="#9E3543"/>
  <rect x="26" y="15" width="18" height="6" fill="#BFD7EA"/>
  <rect x="48" y="15" width="22" height="6" fill="#BFD7EA"/>
  <rect x="6" y="22" width="108" height="20" fill="#9E3543"/>
  <rect x="92" y="14" width="10" height="8" fill="#C9A46A"/>
  <rect x="6" y="30" width="108" height="2" fill="#E2C77E"/>
  <rect x="110" y="26" width="4" height="4" fill="#E2C77E"/>
  <rect x="16" y="38" width="16" height="16" fill="#17171A"/>
  <rect x="84" y="38" width="16" height="16" fill="#17171A"/>
  <rect x="21" y="43" width="6" height="6" fill="#ABA7A0"/>
  <rect x="89" y="43" width="6" height="6" fill="#ABA7A0"/>
</svg>`;

/**
 * Domu : la petite voiture chargée traverse le bas de l'écran de gauche à droite (quatre secondes).
 * Mouvement réduit : elle reste fixe dans l'angle, avec le même délai.
 * @param {boolean} anime mouvement autorisé
 * @returns {number} durée en ms
 */
function voitureDomu(anime) {
  const c = ajouteCalque('egg-domu', DUREE_DOMU);
  c.innerHTML = `<div class="${anime ? 'egg-voiture' : 'egg-voiture egg-voiture-calme'}">${SVG_VOITURE}</div>`;
  return DUREE_DOMU;
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
 * Si aujourd'hui est l'anniversaire du gang (RPC hg_eggs_public, date de Zurich calculée par le serveur), affiche
 * une bannière qui donne la part de gâteau, et des confettis une fois par jour. Ne fait rien pour un visiteur.
 */
async function verifieAnniversaire() {
  if (!/(^|\/)(accueil|cartes)(\.html)?$/.test(location.pathname)) return;
  const z = heureZurich();
  let encart = false; // encart d’anniversaire (anniv.js) affiché
  try {
    if (!(await hasSession())) return;
    // RPC hg_eggs_public : dit seulement si c'est le jour (la date et le mot secret ne sont plus lisibles).
    const { data, error } = await sb.rpc('hg_eggs_public');
    if (error) return;
    // Fenêtre de l'anniversaire du serveur (migration 096) : encart « Le gang a N ans » à la place de la bannière.
    if (data?.anniversaire_fenetre === true && Number(data.anniversaire_age) > 0) {
      try {
        const { mountAnniv } = await import('../accueil/anniv.js');
        if (await mountAnniv({ today: data.anniversaire_aujourdhui === true })) encart = true;
      } catch { /* module indisponible : bannière d'origine */ }
    }
    if (data?.anniversaire_aujourdhui !== true) return;
  } catch { return; }
  const cle = `hg_egg_anniv_${z.ymd}`;
  if (!lectureStock(cle)) {
    ecritureStock(cle, '1');
    if (motionAllowed()) confettis();
  }
  if (!encart) banniere();
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

/** Couleurs des confettis par défaut : celles du site (arc-en-ciel et sable). */
const COULEURS_DEFAUT = ['var(--rb-1)', 'var(--rb-2)', 'var(--rb-3)', 'var(--rb-4)', 'var(--rb-5)', 'var(--rb-6)', 'var(--sand)'];

/**
 * Confettis qui tombent sur l'écran (calque décoratif). Par défaut : 70 morceaux colorés sur quatre secondes.
 * @param {{couleurs?: string[], nombre?: number, duree?: number, classe?: string}} [opts]
 *   couleurs : couleurs des morceaux ; nombre : nombre de morceaux ; duree : durée de la chute en ms ;
 *   classe : classe ajoutée au calque (ex. « egg-bleu », qui ajoute un contour aux morceaux clairs)
 */
function confettis({ couleurs = COULEURS_DEFAUT, nombre = 70, duree = 4000, classe = '' } = {}) {
  const calque = document.createElement('div');
  calque.className = `egg-calque egg-confetti ${classe}`.trim();
  calque.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < nombre; i++) {
    const s = document.createElement('span');
    s.style.left = `${rnd(0, 100).toFixed(1)}%`;
    s.style.background = couleurs[i % couleurs.length];
    // Durée de chute : entre 70 % et 100 % de la durée demandée (2,8 à 4 s par défaut)
    s.style.animationDuration = `${(rnd(0.7, 1) * duree / 1000).toFixed(2)}s`;
    s.style.animationDelay = `${rnd(0, 0.6).toFixed(2)}s`;
    s.style.setProperty('--dx', `${rnd(-80, 80).toFixed(0)}px`);
    s.style.setProperty('--r', `${rnd(-540, 540).toFixed(0)}deg`);
    calque.append(s);
  }
  document.body.append(calque);
  setTimeout(() => calque.remove(), duree + 500);
}

/* ---------- Console : énigme ---------- */

/**
 * Écrit dans la console du navigateur une courte énigme qui mène à la page secrète (/pages/jeux/secret.html).
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
