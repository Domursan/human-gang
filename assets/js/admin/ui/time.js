// ===== Humane Gang : formats de dates pour l'admin (français, fuseau du navigateur) =====
// relTime(date) → « à l'instant » · « 12 min » · « 1 h » · « Hier » · « 3 j » · « 14 oct. » (date courte)
// clock(date) → « 14:18 » · shortDate(date) → « 14 oct. » (+ année si ≠ année courante)
// fmtDay(date) → « 12 juin 2026 » · monthYear(date) → « mars 2025 » · seenAgo(date) → « Vu il y a 2 h »
// Utilisé par les composants ui/ (liste, fil, panneau d'infos) et par la vue d'ensemble. Aucune dépendance.

// Formateurs créés une seule fois : Intl est coûteux à instancier à chaque appel.
const LOCALE = 'fr-CH';
const fmtClock = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const fmtShort = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const fmtShortY = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDayLong = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
const fmtMonthYear = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });

/** Convertit une date (objet Date, texte ISO ou nombre) en Date valide, ou null si elle est vide ou invalide. */
export function toDate(d) {
  if (d == null || d === '') return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}

// Durées en millisecondes.
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/** Minuit local du jour de `d`, en millisecondes. Sert à compter les jours calendaires (et non les 24 h). */
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

/** Date courte : « 14 oct. » ; l'année est ajoutée si elle n'est pas l'année en cours. */
export function shortDate(date, now = new Date()) {
  const d = toDate(date);
  if (!d) return '';
  return d.getFullYear() === now.getFullYear() ? fmtShort.format(d) : fmtShortY.format(d);
}

/** Heure seule : « 14:18 » */
export function clock(date) {
  const d = toDate(date);
  return d ? fmtClock.format(d) : '';
}

/** Date longue : « 12 juin 2026 » */
export function fmtDay(date) {
  const d = toDate(date);
  return d ? fmtDayLong.format(d) : '';
}

/** Mois et année : « mars 2025 » */
export function monthYear(date) {
  const d = toDate(date);
  return d ? fmtMonthYear.format(d) : '';
}

/**
 * Horodatage relatif court, pour les listes et les bulles.
 * Moins d'une minute : « à l'instant » ; moins de 24 h : minutes ou heures ; au-delà : jours, puis date courte après 7 jours.
 */
export function relTime(date, now = new Date()) {
  const d = toDate(date);
  if (!d) return '';
  const diff = now.getTime() - d.getTime();
  if (diff < MIN) return "à l'instant";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min`;
  // Jours calendaires (et non 24 h glissantes) : « Hier » reste juste à minuit passé.
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (days === 0) return `${Math.floor(diff / HOUR)} h`;
  if (days === 1) return 'Hier';
  if (days < 7) return `${days} j`;
  return shortDate(d, now);
}

/** « Vu il y a 2 h » / « Vu à l'instant » / « Vu hier » / « Vu le 3 sept. 2026 » */
export function seenAgo(date, now = new Date()) {
  const d = toDate(date);
  if (!d) return '';
  const rel = relTime(d, now);
  if (rel === "à l'instant") return "Vu à l'instant";
  if (rel === 'Hier') return 'Vu hier';
  if (/(min|h|j)$/.test(rel)) return `Vu il y a ${rel}`;
  return `Vu le ${shortDate(d, now)}`;
}
