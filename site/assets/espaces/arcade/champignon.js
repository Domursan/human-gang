// ===== Humane Gang — la cueillette de champignons (secret F4) =====
/*
 * Rôle : chaque saison, un petit champignon Mycena est caché dans un coin du bas d'une section de la page indiquée
 * par le serveur (hg_eggs_public().champi : saison, page, anecdote du jour). Il est discret, se voit au survol et au
 * toucher. Au clic, il s'épanouit, lâche quelques spores, et une bulle donne l'anecdote. Le serveur est prévenu
 * (hg_egg_found('champi_<saison>'), qui refuse un champignon hors saison) et répond « Cueillette : N saison(s) sur 4 ».
 * Une fois cueilli dans la saison, il ne réapparaît plus (hg_eggs_me).
 * Page : toutes les pages (importé par site-boot.js) ; ne fait rien sans session de membre, ni sur une autre page
 *   que celle de la saison. Le pied ou le contenu peuvent être redessinés : un observateur le remet en place.
 * Mouvement réduit ou effets coupés : pas d'épanouissement ni de spores, la bulle reste.
 * Dépendances : ../core.js (sb, hasSession, motionAllowed), ./api.js (eggFound, eggsMe), feuille assets/css/eggs-f.css.
 * Exporte : rien (effets de bord).
 */
import { sb, hasSession, motionAllowed } from '../core.js';
import { eggFound, eggsMe } from './api.js';

/* ---------- Constantes ---------- */

const SAISONS = ['printemps', 'ete', 'automne', 'hiver'];
const ANECDOTE_PAR_DEFAUT = 'Un champignon, bien caché.';
const DUREE_BULLE = 6000;   // ms : la bulle reste lisible après la cueillette, puis le champignon disparaît
const NB_SPORES = 9;

/** Le Mycena (viewBox 32 × 32) : chapeau en cloche, lamelles, pied fin, reflet bleu. */
const MYCENA = `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <circle cx="16" cy="13" r="12" fill="#7FE0F0" opacity="0.14"/>
  <path d="M5 15 C5 6 10 3 16 3 C22 3 27 6 27 15 Z" fill="#E8F1FA" stroke="#1B2433" stroke-width="1.2"/>
  <path d="M7.5 15 Q16 17.5 24.5 15" fill="none" stroke="#9FB6CC" stroke-width="1"/>
  <circle cx="11" cy="9" r="1" fill="#7FE0F0"/>
  <circle cx="20.5" cy="8" r="0.8" fill="#7FE0F0"/>
  <path d="M14.2 15 L15 29 Q16 30.4 17 29 L17.8 15 Z" fill="#DCE7F2" stroke="#1B2433" stroke-width="1"/>
</svg>`;

/* ---------- Outils ---------- */

/** Nom de la page courante, sans chemin ni extension (« irl » pour irl.html). */
const pageCourante = () => location.pathname.split('/').pop().replace(/\.html$/, '');

/** Charge la feuille de style des secrets F, une seule fois. */
function chargeCss() {
  if (document.querySelector('link[data-eggs-f]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/eggs-f.css', import.meta.url).href;
  l.dataset.eggsF = '';
  document.head.append(l);
}

/**
 * Section où poser le champignon : la dernière section affichée du contenu principal (sinon main, si elle est
 * affichée). Une section cachée (panneau d'onglet fermé) ne convient pas : le champignon y serait invisible.
 * @returns {HTMLElement|null} null si rien n'est affiché pour l'instant
 */
function cibleSection() {
  const affichees = [...document.querySelectorAll('main section')].filter((s) => s.getClientRects().length > 0);
  if (affichees.length) return affichees[affichees.length - 1];
  const main = document.querySelector('main');
  return main && main.getClientRects().length > 0 ? main : null;
}

/* ---------- État de la page ---------- */

let saisonCourante = null;   // saison du champignon (printemps, ete, automne ou hiver)
let anecdote = ANECDOTE_PAR_DEFAUT;
let cueilli = false;         // cueilli pendant cette visite : il ne revient plus

/**
 * Pose le champignon dans un coin bas de la section (une seule fois, tant qu'il n'est pas cueilli).
 */
function pose() {
  if (cueilli || !saisonCourante || document.querySelector('.champi-f')) return;
  const sec = cibleSection();
  if (!sec) return;
  if (getComputedStyle(sec).position === 'static') sec.style.position = 'relative';
  const zone = document.createElement('div');
  zone.className = 'champi-f';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'champi-f-bouton';
  b.setAttribute('aria-label', 'Un champignon ?');
  b.innerHTML = MYCENA;
  b.addEventListener('click', () => cueille(zone, b));
  zone.append(b);
  sec.append(zone);
}

/**
 * Lance des spores : neuf petits points qui s'éloignent du champignon (CSS, puis retirés).
 * @param {HTMLElement} zone zone du champignon
 */
function spores(zone) {
  for (let i = 0; i < NB_SPORES; i++) {
    const s = document.createElement('span');
    s.className = 'champi-f-spore';
    const angle = (i / NB_SPORES) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 28 + Math.random() * 22;
    s.style.setProperty('--dx', `${(Math.cos(angle) * dist).toFixed(1)}px`);
    s.style.setProperty('--dy', `${(Math.sin(angle) * dist - 10).toFixed(1)}px`);
    s.style.animationDelay = `${(Math.random() * 0.15).toFixed(2)}s`;
    zone.append(s);
  }
  setTimeout(() => zone.querySelectorAll('.champi-f-spore').forEach((s) => s.remove()), 1400);
}

/**
 * Cueillette : épanouissement, spores, bulle avec l'anecdote, puis signalement au serveur.
 * @param {HTMLElement} zone zone du champignon
 * @param {HTMLButtonElement} b le champignon
 */
function cueille(zone, b) {
  if (cueilli) return;
  cueilli = true;
  b.disabled = true;
  if (motionAllowed()) {
    b.classList.add('champi-f-eclot');
    spores(zone);
  }
  const bulle = document.createElement('p');
  bulle.className = 'champi-f-bulle';
  bulle.setAttribute('role', 'status');
  bulle.textContent = anecdote;
  zone.append(bulle);
  eggFound(`champi_${saisonCourante}`);
  setTimeout(() => zone.remove(), DUREE_BULLE);
}

/* ---------- Lancement ---------- */

/**
 * Lit la saison et la page du champignon ; si la page courante est la bonne et que le membre ne l'a pas encore
 * cueilli cette saison, pose le champignon et surveille la page pour le reposer si elle se redessine.
 */
async function lance() {
  if (!document.body || !(await hasSession())) return;
  let champi = null;
  try {
    const { data, error } = await sb.rpc('hg_eggs_public');
    if (!error) champi = data?.champi ?? null;
  } catch { return; }
  if (!champi || !SAISONS.includes(champi.saison) || champi.page !== pageCourante()) return;

  const me = await eggsMe();
  if (me?.eggs?.some((e) => e.egg === `champi_${champi.saison}`)) return;

  saisonCourante = champi.saison;
  anecdote = champi.fact || ANECDOTE_PAR_DEFAUT;
  chargeCss();
  pose();
  // La section peut être reconstruite (rendu tardif, changement de profil) : on remet le champignon.
  let attente = false;
  // Les onglets et panneaux changent surtout de classe ou d'attribut hidden : on les surveille aussi.
  new MutationObserver(() => {
    if (attente || cueilli) return;
    attente = true;
    requestAnimationFrame(() => { attente = false; pose(); });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
}

lance();
