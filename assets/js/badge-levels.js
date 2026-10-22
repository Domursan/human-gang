// ===== Humane Gang — badges à niveaux : outils partagés (aucune dépendance) =====
// hg_badges : levels_enabled, metric, levels [{ level, threshold, name?, image_url? }], event_id
// hg_user_badges.level (1 par défaut). Le calcul des niveaux se fait côté base (hg_award_level_badges).
/*
 * Rôle : fonctions de lecture des badges à niveaux (nom des niveaux, chiffres romains, pastilles, libellés de métriques).
 * Aucun appel réseau : tout est calculé à partir de la définition du badge reçue.
 * Pages : compte.html, membre.html, evenements.html, la célébration de badges (core/badges.js) et l'administration
 *   des badges (admin/badges.js, admin-badges-edit.js, admin-events.js).
 * Dépendances : aucune.
 * Exporte : METRICS, METRIC_LABEL, metricCount, roman, sortedLevels, hasLevels, levelDef, nextLevelDef,
 *   levelImage, levelLabel, levelPipsHtml.
 */

/* ---------- Métriques ---------- */

/**
 * Métriques connues par la base (hg_metric_value).
 * Chaque ligne : [code, libellé, forme au singulier, forme au pluriel].
 */
export const METRICS = [
  ['anciennete_annees', 'Années dans le gang', 'an', 'ans'],
  ['secret_santa', 'Secret Santa terminés', 'Secret Santa', 'Secret Santa'],
  ['sorties', 'Sorties IRL', 'sortie', 'sorties'],
  ['sorties_organisees', 'Sorties organisées', 'sortie organisée', 'sorties organisées'],
  ['photos', 'Photos postées', 'photo', 'photos'],
  ['moments', 'Moments cultes ajoutés', 'moment', 'moments'],
  ['messages', 'Messages envoyés', 'message', 'messages'],
  ['idees_retenues', 'Idées retenues', 'idée retenue', 'idées retenues'],
  ['event_captures', 'Images attrapées', 'image attrapée', 'images attrapées'],
  ['events_dynamiques', 'Événements auxquels on a participé', 'événement', 'événements'],
];
export const METRIC_LABEL = Object.fromEntries(METRICS.map(([k, l]) => [k, l]));
/** « 3 sorties », « 1 an »… */
export function metricCount(metric, n) {
  const m = METRICS.find(([k]) => k === metric);
  const v = Number(n) || 0;
  return m ? `${v} ${v > 1 ? m[3] : m[2]}` : String(v);
}

const ROMAN = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
/** 1 → I, 4 → IV, 12 → XII (au-delà de 39 : chiffres arabes). */
export function roman(n) {
  let v = Math.floor(Number(n) || 0);
  if (v <= 0) return '';
  if (v >= 40) return String(v);
  let out = '';
  for (const [k, s] of ROMAN) while (v >= k) { out += s; v -= k; }
  return out;
}

/** Niveaux triés et renumérotés 1..n (on se fie à l'ordre des seuils). */
export function sortedLevels(badge) {
  const raw = Array.isArray(badge?.levels) ? badge.levels : [];
  return raw
    .filter((l) => l && Number.isFinite(Number(l.threshold)))
    .map((l) => ({ ...l, level: Number(l.level) || 0, threshold: Number(l.threshold) }))
    .sort((a, b) => a.level - b.level || a.threshold - b.threshold);
}
/** Le badge est-il un badge à niveaux exploitable ? */
export const hasLevels = (badge) => !!badge?.levels_enabled && sortedLevels(badge).length > 0;

/** Définition du niveau n (ou null). */
export function levelDef(badge, n) {
  return sortedLevels(badge).find((l) => l.level === Number(n)) ?? null;
}
/** Niveau suivant (ou null si niveau max). */
export function nextLevelDef(badge, n) {
  return sortedLevels(badge).find((l) => l.level > (Number(n) || 0)) ?? null;
}
/** Image à afficher : celle du niveau si elle existe, sinon celle du badge. */
export function levelImage(badge, n) {
  return (hasLevels(badge) && levelDef(badge, n)?.image_url) || badge?.image_url || null;
}
/** « Niveau II · Argent » (ou « Niveau II »). */
export function levelLabel(badge, n) {
  const d = levelDef(badge, n);
  return `Niveau ${roman(n)}${d?.name ? ` · ${d.name}` : ''}`;
}

/**
 * Pastilles de niveau : I II III… (atteints remplis, suivants en creux). Texte déjà échappé (chiffres romains).
 * opts.max : nombre max de pastilles affichées (au-delà : « +n »).
 */
export function levelPipsHtml(badge, current, { max = 6 } = {}) {
  const lv = sortedLevels(badge);
  if (!lv.length) return '';
  const cur = Number(current) || 0;
  const shown = lv.slice(0, max);
  const rest = lv.length - shown.length;
  return `<span class="lvl-pips" role="img" aria-label="Niveau ${cur} sur ${lv.length}">${shown.map((l) =>
    `<span class="lvl-pip${l.level <= cur ? ' is-on' : ''}${l.level === cur ? ' is-cur' : ''}" aria-hidden="true">${roman(l.level)}</span>`).join('')}${rest > 0 ? `<span class="lvl-pip lvl-more" aria-hidden="true">+${rest}</span>` : ''}</span>`;
}
