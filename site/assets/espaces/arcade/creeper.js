// ===== Humane Gang — le drôle de bloc (secret F7) =====
/*
 * Rôle : de temps en temps, un petit bloc vert grognon (pixel art original, avec une mèche) sort du bas de l'écran,
 * dans une marge. Il clignote en blanc pendant trois secondes et siffle (si les sons sont activés). Un clic avant la
 * fin le fait se dégonfler en petit nuage et signale le secret au serveur (hg_egg_found('creeper') : message et gain
 * affichés par api.js). Raté : une bulle « BOUM » de BD, la page tremble une demi-seconde, et un petit cratère reste
 * dans le coin jusqu'au rechargement ; rien n'est perdu.
 * Fréquence : environ une visite sur quinze, au plus une apparition par jour (mémorisée dans localStorage), une au plus
 * par page vue, après un délai aléatoire de 8 à 40 s. Jamais pendant une saisie (focus dans un champ), jamais si les
 * effets sont coupés, jamais sans session de membre.
 * Mouvement réduit : pas de tremblement ni de clignotement, seulement apparition et disparition.
 * Test : ?creeper=1 force l'apparition immédiate, seulement pour un administrateur ou en local.
 * Page : toutes les pages (importé par site-boot.js) ; une page sans session ne fait rien.
 * Dépendances : ../core.js (effectsEnabled, motionAllowed, getPrefs, getProfile, hasSession), ./api.js (eggFound),
 *   feuille assets/espaces/arcade/eggs-f.css (ajoutée ici).
 * Exporte : rien (effets de bord).
 */
import { effectsEnabled, motionAllowed, getPrefs, getProfile, hasSession } from '../../commun/core.js';
import { eggFound } from './api.js';

/* ---------- Constantes ---------- */

const UNE_VISITE_SUR = 15;        // tirage à chaque page vue : une visite sur quinze
const DELAI_MIN = 8000;           // ms avant l'apparition
const DELAI_MAX = 40000;
const DUREE_CLIGNOTE = 3000;      // ms : fenêtre pour le toucher avant le « BOUM »
const CLE_JOUR = 'hg_creeper_jour';

/** Couleurs des pixels : g vert, d vert foncé, k noir, o contour, f gris, y étincelle. Autre caractère : transparent. */
const COULEURS = { g: '#5FBF4E', d: '#3F8F3A', k: '#111611', o: '#0B2A10', f: '#6B6B73', y: '#FFD54A' };

/** Le bloc grognon (8 × 9 pixels) : mèche, sourcils, mauvaise humeur. */
const MONSTRE = [
  '....ff..',
  '...fyy..',
  '.oooooo.',
  'oggggggo',
  'ogkkkkgo',
  'oggkkggo',
  'oggdggdo',
  'ogkggkgo',
  'oooooooo',
];

/** Le cratère laissé par le « BOUM » (8 × 3 pixels). */
const CRATERE = [
  '..ffff..',
  '.fkkkkf.',
  'ffkkkkff',
];

/* ---------- Outils ---------- */

/** Nombre aléatoire entre a et b. */
const rnd = (a, b) => a + Math.random() * (b - a);

/** Date locale « AAAA-M-J », pour la limite d'une apparition par jour. */
function jourLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Vrai si le bloc est déjà apparu aujourd'hui (stockage bloqué : faux, sans gravité). */
function dejaAujourdhui() {
  try { return localStorage.getItem(CLE_JOUR) === jourLocal(); } catch { return false; }
}

/** Mémorise l'apparition du jour. Sans effet si le stockage est bloqué. */
function marqueJour() {
  try { localStorage.setItem(CLE_JOUR, jourLocal()); } catch { /* stockage bloqué : sans importance */ }
}

/** Vrai si le focus se trouve dans un champ de saisie. */
function dansChamp() {
  const el = document.activeElement;
  return !!el && (el.matches('input, textarea, select') || el.isContentEditable);
}

/** Charge la feuille de style des secrets F, une seule fois. */
function chargeCss() {
  if (document.querySelector('link[data-eggs-f]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./eggs-f.css', import.meta.url).href;
  l.dataset.eggsF = '';
  document.head.append(l);
}

/**
 * Dessine une grille de pixels en SVG (un carré par pixel, sans lissage).
 * @param {string[]} grille lignes de caractères (voir COULEURS ; « . » est transparent)
 * @param {number} largeur nombre de colonnes
 * @param {number} hauteur nombre de lignes
 * @returns {string} balisage SVG
 */
function pixels(grille, largeur, hauteur) {
  const cases = [];
  grille.forEach((ligne, y) => [...ligne].forEach((c, x) => {
    if (COULEURS[c]) cases.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${COULEURS[c]}"/>`);
  }));
  return `<svg viewBox="0 0 ${largeur} ${hauteur}" width="100%" height="100%" aria-hidden="true" focusable="false" shape-rendering="crispEdges">${cases.join('')}</svg>`;
}

/**
 * Son du sifflement (WebAudio, aucun fichier). Seulement si les sons sont activés dans les préférences.
 * @param {object} etat état de l'apparition ; son contexte audio est mémorisé pour pouvoir le couper
 */
function siffle(etat) {
  if (!getPrefs().sound) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = new AC();
    const t = c.currentTime;
    const fin = DUREE_CLIGNOTE / 1000;
    const vol = Math.min(1, Math.max(0, Number(getPrefs().volume) || 0.6)) * 0.12;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(700, t + fin);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + fin);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + fin + 0.05);
    etat.son = c;
  } catch { /* son impossible : sans importance */ }
}

/** Coupe le sifflement en cours (touché, ou page quittée). */
function coupeSon(etat) {
  try { etat.son?.close?.(); } catch { /* déjà fermé */ }
  etat.son = null;
}

/* ---------- Apparition, toucher, raté ---------- */

/** Apparition en cours sur la page (une seule à la fois ; une page vue n'en donne qu'une). */
let actif = null;

/**
 * Fait sortir le bloc du bas de l'écran. Ne fait rien si un champ a le focus, si le bloc est déjà apparu
 * aujourd'hui (sauf test forcé) ou si une apparition a déjà eu lieu sur cette page.
 * @param {boolean} force vrai pour le test ?creeper=1 : pas de limite du jour, pas de mémorisation
 */
function apparait(force) {
  if (actif || !document.body || dansChamp()) return;
  if (!force && dejaAujourdhui()) return;
  const anime = motionAllowed();
  if (!force) marqueJour();
  const cote = Math.random() < 0.5 ? 'gauche' : 'droite';

  const calque = document.createElement('div');
  calque.className = 'egg-f-calque' + (anime ? '' : ' egg-f-calme');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `egg-f-monstre egg-f-${cote}`;
  b.setAttribute('aria-label', 'Un drôle de bloc ?');
  b.innerHTML = pixels(MONSTRE, 8, 9);
  calque.append(b);
  document.body.append(calque);

  const etat = { calque, b, cote, anime, fini: false, timer: null, son: null };
  actif = etat;
  if (anime) b.classList.add('egg-f-clignote');
  siffle(etat);
  etat.timer = setTimeout(() => boum(etat), DUREE_CLIGNOTE);
  b.addEventListener('click', () => touche(etat));
  // Un champ qui prend le focus pendant l'apparition : le bloc s'en va, sans rien déclencher
  document.addEventListener('focusin', function surFocus() {
    if (!dansChamp() || etat.fini) return;
    document.removeEventListener('focusin', surFocus);
    etat.fini = true;
    clearTimeout(etat.timer);
    coupeSon(etat);
    etat.calque.remove();
  });
}

/**
 * Touché avant la fin : le bloc se dégonfle en nuage et le secret part au serveur.
 * @param {object} etat apparition en cours
 */
function touche(etat) {
  if (etat.fini) return;
  etat.fini = true;
  clearTimeout(etat.timer);
  coupeSon(etat);
  etat.b.disabled = true;
  if (etat.anime) {
    etat.b.classList.add('egg-f-touche');
    const nuage = document.createElement('div');
    nuage.className = `egg-f-nuage egg-f-${etat.cote}`;
    etat.calque.append(nuage);
    setTimeout(() => etat.calque.remove(), 700);
  } else {
    etat.calque.remove();
  }
  eggFound('creeper');
}

/**
 * Raté : le bloc saute en éclatant, une bulle « BOUM » apparaît, la page tremble et un cratère reste dans le coin.
 * Rien n'est envoyé au serveur.
 * @param {object} etat apparition en cours
 */
function boum(etat) {
  if (etat.fini) return;
  etat.fini = true;
  coupeSon(etat);
  etat.b.remove();
  if (etat.anime) {
    const bulle = document.createElement('div');
    bulle.className = `egg-f-boum egg-f-${etat.cote}`;
    bulle.textContent = 'BOUM';
    etat.calque.append(bulle);
    setTimeout(() => bulle.remove(), 1400);
    secoue();
  }
  const cratere = document.createElement('div');
  cratere.className = `egg-f-cratere egg-f-${etat.cote}`;
  cratere.setAttribute('aria-hidden', 'true');
  cratere.innerHTML = pixels(CRATERE, 8, 3);
  etat.calque.append(cratere);
}

/**
 * Fait trembler la page une demi-seconde. Le tremblement porte sur le contenu principal (main), pas sur body,
 * pour ne pas casser la mise en page des éléments fixes.
 */
function secoue() {
  const cible = document.querySelector('main') || document.body;
  cible.classList.add('egg-f-tremble');
  setTimeout(() => cible.classList.remove('egg-f-tremble'), 500);
}

/* ---------- Lancement ---------- */

/**
 * Vrai si le test forcé est permis : administrateur, ou site ouvert en local.
 * @returns {Promise<boolean>}
 */
async function peutForcer() {
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return true;
  try { return !!(await getProfile())?.is_admin; } catch { return false; }
}

/**
 * Décide si le bloc sort sur cette page : tirage (une visite sur quinze), limite du jour, délai aléatoire.
 */
async function lance() {
  if (!document.body || !effectsEnabled()) return;
  if (!(await hasSession())) return;
  if (new URLSearchParams(location.search).get('creeper') === '1') {
    if (!(await peutForcer())) return;
    chargeCss();
    apparait(true);
    return;
  }
  if (Math.random() * UNE_VISITE_SUR >= 1) return;
  if (dejaAujourdhui()) return;
  chargeCss();
  setTimeout(() => apparait(false), rnd(DELAI_MIN, DELAI_MAX));
}

lance();
