// ===== Humane Gang — outils communs aux onglets de la page « Jeux » =====
/*
 * Rôle : petites briques partagées par les modules de jeux : feuille de style chargée une fois, nombres à la suisse,
 * icône de Paillette, liste de classement (rang, avatar, pseudo, valeur), dates à l'heure de Zurich.
 * Dépendances : core.js (esc, avatarHtml).
 * Exporte : chargerCss, nf, km, PAILLETTE, gainHtml, classementHtml, jourLong, zurichIso.
 */
import { esc, avatarHtml } from '../core.js';

/**
 * Ajoute une seule fois la feuille de style d'un jeu (assets/css/jeux-<nom>.css).
 * @param {string} nom Par exemple 'geo'.
 */
export function chargerCss(nom) {
  if (document.querySelector(`link[data-jeux-css="${nom}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL(`../../css/jeux-${nom}.css`, import.meta.url).href;
  l.dataset.jeuxCss = nom;
  document.head.append(l);
}

/** Nombre avec séparateurs suisses (espace fine). */
const fmt = new Intl.NumberFormat('fr-CH');
export const nf = (n) => fmt.format(Number(n) || 0);

/**
 * Distance lisible : « 120 m », « 3,4 km », « 68 km ».
 * @param {number} m Distance en mètres.
 * @returns {string}
 */
export function km(m) {
  const v = Number(m) || 0;
  if (v < 1000) return `${Math.round(v)} m`;
  if (v < 10000) return `${(v / 1000).toFixed(1).replace('.', ',')} km`;
  return `${nf(Math.round(v / 1000))} km`;
}

/** Icône de Paillette (étoile à quatre branches, décorative). */
export const PAILLETTE = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" fill="currentColor"/></svg>';

/**
 * Pastille de gain : « +42 Paillettes ».
 * @param {number} n Paillettes gagnées.
 * @returns {string} HTML.
 */
export function gainHtml(n) {
  return `<span class="pill jg-gain">${PAILLETTE}+${nf(n)} Paillette${Number(n) > 1 ? 's' : ''}</span>`;
}

/**
 * Liste de classement : une ligne par membre, la sienne mise en avant.
 * @param {Array<object>} rows Lignes { user_id, pseudo, color, avatar_url, rank? }.
 * @param {{me?: string, droite?: (r: object) => string, vide?: string, label?: string}} opts
 *   me : mon identifiant ; droite : HTML de fin de ligne (déjà échappé) ; vide : texte sans ligne ; label : nom de la liste.
 * @returns {string} HTML.
 */
export function classementHtml(rows, { me = null, droite = () => '', vide = 'Personne pour l’instant.', label = 'Classement' } = {}) {
  if (!rows?.length) return `<p class="jg-empty-row">${esc(vide)}</p>`;
  return `<ol class="jg-board" aria-label="${esc(label)}">${rows.map((r, i) => {
    const mine = me && r.user_id === me;
    const rang = r.rank ?? i + 1;
    return `<li${mine ? ' class="is-me" aria-current="true"' : ''}><span class="jg-rank">${esc(rang)}</span>${avatarHtml(r, 28)}<span class="jg-name">${esc(r.pseudo || '—')}${mine ? '<span class="visually-hidden"> (toi)</span>' : ''}</span>${droite(r)}</li>`;
  }).join('')}</ol>`;
}

/** Date longue à l'heure de Zurich : « jeudi 23 octobre ». */
const jourFmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Zurich' });
/**
 * Date longue d'un jour « AAAA-MM-JJ » (midi UTC, pour ne jamais changer de jour).
 * @param {string} iso Jour au format AAAA-MM-JJ.
 * @returns {string}
 */
export function jourLong(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : jourFmt.format(d);
}

/**
 * Jour courant à Zurich, au format AAAA-MM-JJ.
 * @returns {string}
 */
export function zurichIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
