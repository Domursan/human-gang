// Raccourcis clavier du site (idée Q8) : « g » puis une lettre pour changer de page, « / » pour la recherche, « ? » pour l'aide-mémoire.
/*
 * Rôle : installe les raccourcis d'une seule touche pour un membre connecté, et l'aide-mémoire (<dialog>).
 * Page : toutes les pages avec en-tête, sauf /pages/admin/admin.html (l'admin garde sa propre palette « Aller à… »).
 * Règles : ignorés dans un champ de saisie, quand un dialogue est ouvert, avec Ctrl, Alt ou Cmd, et dans une zone
 * marquée data-shortcuts="off" (jeux du site) ; une page masquée par l'admin n'a pas de raccourci (canAccess).
 * Coupables dans les Préférences d'affichage (clé « shortcuts », WCAG 2.1.4). La touche lue est event.key (claviers AZERTY).
 * Dépendances : prefs-state.js, prefs.js, search.js, pages-access.js, util.js, icons.js.
 * Exporte : bindShortcuts, SHORTCUT_PAGES.
 */
import { getPrefs } from './prefs-state.js';
import { setPrefs } from './prefs.js';
import { ouvreRecherche } from './recherche-lien.js';
import { canAccess, pageHref } from './pages-access.js';
import { esc } from './util.js';
import { ICON_CLOSE } from './icons.js';

/** Pages atteignables par « g » puis une lettre : [lettre, slug, libellé]. */
export const SHORTCUT_PAGES = [
  ['a', 'accueil', 'Accueil'],
  ['c', 'cartes', 'Cartes'],
  ['i', 'irl', 'Sorties IRL'],
  ['h', 'historique', 'Historique'],
  ['m', 'messages', 'Messages'],
  ['s', 'secret-santa', 'Secret Santa'],
  ['q', 'quiz', 'Quiz'],
  ['p', 'compte', 'Mon compte'],
  ['t', 'aide', 'Aide et tutos'],
];
/** Délai (ms) pour taper la seconde touche après « g ». */
const G_DELAY = 1500;
/** Raccourcis propres à certaines pages, listés dans l'aide-mémoire : slug → { titre, lignes [libellé, touches] }. */
const PAGE_KEYS = {
  cartes: { title: 'Sur la page Cartes', rows: [['Carte précédente ou suivante (zoom)', ['←', '→']], ['Fermer le zoom', ['Échap']]] },
};

/** true une fois les raccourcis branchés : on ne les ajoute pas deux fois. */
let bound = false;
/** Minuterie de l'attente après « g » (null = pas d'attente). */
let gTimer = null;
/** Aide-mémoire, créé à la première ouverture. */
let dlg = null;
/** Élément qui avait le focus avant l'aide-mémoire. */
let opener = null;

/**
 * Vrai si le focus est dans un champ de saisie (même règle que les secrets du site, eggs/core.js).
 * @returns {boolean}
 */
function inField() {
  const el = document.activeElement;
  return !!el && (el.matches('input, textarea, select') || el.isContentEditable);
}

/**
 * Slug de la page courante (« cartes » pour /pages/cartes/cartes.html).
 * @returns {string}
 */
const currentSlug = () => (location.pathname.split('/').pop() || '/index.html').replace(/\.html$/, '');

/**
 * Affiche ou masque l'étiquette « g… » en bas de l'écran.
 * @param {boolean} on
 */
function showHint(on) {
  let el = document.getElementById('kbd-hint');
  if (!on) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'kbd-hint';
    el.className = 'kbd-hint';
    el.setAttribute('role', 'status');
    el.innerHTML = '<kbd>g</kbd><span>… attend la seconde touche</span>';
    document.body.append(el);
  }
}

/** Met fin à l'attente de la seconde touche. */
function stopWaiting() {
  if (gTimer) clearTimeout(gTimer);
  gTimer = null;
  showHint(false);
}

/**
 * Touches d'un raccourci en HTML (<kbd>), avec « puis » ou « ou » entre les groupes.
 * @param {string[]} keys touches
 * @param {string} [sep=''] mot entre la première touche et la suite (« puis », « ou »), vide pour des touches côte à côte
 * @returns {string}
 */
function kbdHtml(keys, sep = '') {
  const k = keys.map((x) => `<kbd>${esc(x)}</kbd>`);
  return `<span class="kbd-keys">${sep ? `${k[0]}<span class="kbd-then">${esc(sep)}</span>${k.slice(1).join('')}` : k.join('')}</span>`;
}

/**
 * Une ligne de l'aide-mémoire.
 * @param {string} label
 * @param {string} keys HTML des touches
 * @returns {string}
 */
const row = (label, keys) => `<li class="kbd-row"><span>${esc(label)}</span>${keys}</li>`;

/**
 * Construit l'aide-mémoire : pages accessibles, raccourcis généraux, raccourcis de la page ouverte.
 * @returns {HTMLDialogElement}
 */
function buildDialog() {
  const d = document.createElement('dialog');
  d.className = 'prefs-dialog kbd-dialog';
  d.setAttribute('aria-labelledby', 'kbd-title');
  document.body.append(d);
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
    const b = e.target.closest('[data-kbd]');
    if (!b) return;
    if (b.dataset.kbd === 'off') setPrefs({ shortcuts: false });
    d.close();
  });
  d.addEventListener('close', () => { opener?.focus?.(); opener = null; });
  return d;
}

/** Remplit l'aide-mémoire selon les pages accessibles et la page ouverte. */
function fillDialog() {
  const pages = SHORTCUT_PAGES.filter(([k, slug]) => slug !== 'aide' && canAccess(slug));
  const page = PAGE_KEYS[currentSlug()];
  const help = canAccess('aide') ? row('Aide et tutos', kbdHtml(['g', 't'], 'puis')) : '';
  dlg.innerHTML = `<div class="prefs-form kbd-form">
      <div class="prefs-head">
        <h2 id="kbd-title" class="display">Raccourcis clavier</h2>
        <button class="prefs-close" type="button" data-kbd="close" aria-label="Fermer l’aide-mémoire">${ICON_CLOSE}</button>
      </div>
      <div class="kbd-cols">
        <section class="kbd-grp" aria-labelledby="kbd-go">
          <h3 id="kbd-go">Aller à</h3>
          <ul>${pages.map(([k, , label]) => row(label, kbdHtml(['g', k], 'puis'))).join('')}</ul>
        </section>
        <section class="kbd-grp" aria-labelledby="kbd-all">
          <h3 id="kbd-all">Partout</h3>
          <ul>
            ${row('Rechercher', kbdHtml(['/', 'Ctrl', 'K'], 'ou'))}
            ${row('Cet aide-mémoire', kbdHtml(['?']))}
            ${help}
          </ul>
          ${page ? `<h3 id="kbd-page">${esc(page.title)}</h3>
          <ul aria-labelledby="kbd-page">${page.rows.map(([l, keys]) => row(l, kbdHtml(keys))).join('')}</ul>` : ''}
        </section>
      </div>
      <div class="kbd-foot">
        <p class="small muted">Les raccourcis ne réagissent pas quand tu écris dans un champ.</p>
        <div class="btn-row">
          <button class="btn btn-ghost" type="button" data-kbd="off">Désactiver les raccourcis</button>
          <button class="btn btn-primary" type="button" data-kbd="close">Compris</button>
        </div>
      </div>
    </div>`;
}

/** Ouvre l'aide-mémoire (le focus va sur « Compris » ; Échap le ferme, le dialogue modal garde le focus dedans). */
export function openShortcutsHelp() {
  dlg ||= buildDialog();
  if (dlg.open) return;
  fillDialog();
  opener = document.activeElement;
  dlg.showModal();
  dlg.querySelector('.btn-primary')?.focus();
}

/**
 * Gestion d'une touche : ignore les champs, les dialogues ouverts, les modificateurs et les zones de jeu.
 * @param {KeyboardEvent} e
 */
function onKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (!getPrefs().shortcuts) { stopWaiting(); return; }
  if (inField() || document.querySelector('dialog[open]')) { stopWaiting(); return; }
  if (document.activeElement?.closest?.('[data-shortcuts="off"]')) return;
  const k = e.key;
  if (gTimer) {
    stopWaiting();
    const hit = SHORTCUT_PAGES.find(([key]) => key === String(k).toLowerCase());
    if (!hit || !canAccess(hit[1])) return;
    e.preventDefault();
    if (currentSlug() !== hit[1]) location.href = pageHref(hit[1]);
    return;
  }
  if (k === 'g' || k === 'G') {
    e.preventDefault();
    showHint(true);
    gTimer = setTimeout(stopWaiting, G_DELAY);
  } else if (k === '/') {
    if (!document.querySelector('.site-header .nav-search-open')) return;
    e.preventDefault();
    ouvreRecherche();
  } else if (k === '?') {
    e.preventDefault();
    openShortcutsHelp();
  }
}

/**
 * Branche les raccourcis pour un membre connecté (une seule fois par page). Rien sur /pages/admin/admin.html.
 * @param {object|null} profile profil du membre connecté
 */
export function bindShortcuts(profile) {
  if (bound || !profile || currentSlug() === 'admin') return;
  bound = true;
  document.addEventListener('keydown', onKey);
}
