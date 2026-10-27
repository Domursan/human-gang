// Utilitaires purs du socle (aucune dépendance) : échappement, dates, avatar, mouvement réduit.
/*
 * Rôle : petites fonctions réutilisées partout : échapper du texte avant de l'insérer en HTML,
 * sélectionner des éléments, formater des dates en français, afficher un avatar, lire le message d'erreur.
 * Page : toutes les pages.
 * Dépendances : aucune (ce fichier n'importe rien).
 * Exporte : esc, $, $$, fmtDate, fmtDateTime, daysUntil, initials, avatarHtml, errMsg, reducedMotion.
 */

/* ---------- Texte et sélection ---------- */

/**
 * Échappe les caractères spéciaux HTML : à utiliser sur tout texte venant de la base ou de l'utilisateur
 * avant de le placer dans un innerHTML. Évite l'injection de code.
 * @param {*} s Valeur à échapper (null et undefined donnent '').
 * @returns {string}
 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/**
 * Premier élément qui correspond au sélecteur (raccourci de querySelector).
 * @param {string} sel Sélecteur CSS.
 * @param {ParentNode} [root=document] Où chercher.
 * @returns {Element|null}
 */
export function $(sel, root = document) { return root.querySelector(sel); }
/**
 * Tous les éléments qui correspondent au sélecteur, dans un vrai tableau.
 * @param {string} sel Sélecteur CSS.
 * @param {ParentNode} [root=document] Où chercher.
 * @returns {Element[]}
 */
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

/* ---------- Dates ---------- */

// Formats en français (Suisse) : « 24 décembre 2025 » et « mer. 24 déc. 18:30 »
const dateFmt = new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
/**
 * Date lisible (« 24 décembre 2025 »).
 * @param {string|Date|null} d Date ISO ou objet Date ; '' si absente.
 * @returns {string}
 */
export const fmtDate = (d) => (d ? dateFmt.format(new Date(d)) : '');
/**
 * Date et heure lisibles (« mer. 24 décembre 18:30 »).
 * @param {string|Date|null} d Date ISO ou objet Date ; '' si absente.
 * @returns {string}
 */
export const fmtDateTime = (d) => (d ? dateTimeFmt.format(new Date(d)) : '');
/**
 * Nombre de jours entiers entre aujourd'hui et la date donnée (négatif si elle est passée).
 * Les deux dates sont ramenées à minuit, pour ne compter que les jours calendaires.
 * @param {string|Date|null} d Date à comparer.
 * @returns {number|null} null si la date est absente.
 */
export function daysUntil(d) {
  if (!d) return null;
  const ms = new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

/* ---------- Avatar et initiales ---------- */

/**
 * Deux premières lettres du nom, en majuscules (« ? » si le nom est vide).
 * @param {string|null|undefined} name Nom ou pseudo.
 * @returns {string}
 */
export function initials(name) { return String(name || '?').trim().slice(0, 2).toUpperCase(); }
/**
 * Texte noir ou blanc qui contraste le mieux sur un fond hexadécimal (#rrggbb). Seuil de luminance relative 0,179
 * (point où le contraste avec le noir et avec le blanc est égal).
 * @param {string} hex Couleur de fond (#rrggbb).
 * @returns {string} '#121212' ou '#FFFFFF'.
 */
export function texteSur(hex) {
  const lin = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return L > 0.179 ? '#121212' : '#FFFFFF';
}
/**
 * Avatar d'un membre : son image si elle vient du bucket autorisé, sinon ses initiales sur sa couleur.
 * @param {object} p Profil (pseudo, color, avatar_url).
 * @param {number} [size=40] Taille en pixels (largeur et hauteur).
 * @returns {string} HTML de l'avatar.
 */
export function avatarHtml(p, size = 40) {
  // Vérification à l'affichage (la base impose déjà ces formats, migration 021) :
  // seule une couleur hexadécimale et une image du bucket hg-avatars sont acceptées.
  const hex = /^#[0-9a-f]{6}$/i.test(p?.color || '');
  const color = hex ? p.color : 'var(--surface-2)';
  const avatarOk = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/hg-avatars\/[^\s"'<>]+$/i.test(p?.avatar_url || '');
  // Initiales : texte clair ou foncé selon le fond choisi par le membre (contraste WCAG AA, quel que soit le thème).
  const style = `width:${size}px;height:${size}px;background:${esc(color)}${hex ? `;color:${texteSur(p.color)}` : ''}`;
  return avatarOk
    ? `<img class="avatar" src="${esc(p.avatar_url)}" alt="" style="${style}" loading="lazy" decoding="async">`
    : `<span class="avatar" aria-hidden="true" style="${style}">${esc(initials(p?.pseudo))}</span>`;
}

/* ---------- Erreurs et préférences système ---------- */

/**
 * Message lisible d'une erreur (son message, ou son texte brut).
 * @param {*} e Erreur attrapée.
 * @returns {string}
 */
export function errMsg(e) { return e?.message || String(e); }

/** L'appareil demande-t-il de réduire les animations ? (false si la information n'est pas disponible) */
export function reducedMotion() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }
