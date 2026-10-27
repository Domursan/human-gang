// ===== Humane Gang — période de l'Avent (date seule, sans le calendrier) =====
/*
 * Rôle : dire si l'on est dans la période du calendrier de l'Avent. Ce petit module est importé par saisons.js et
 * avent.js ; le calendrier lui-même (avent.js, cases, cartes, photos) n'est chargé qu'en décembre.
 * Dépendances : aucune.
 * Exporte : adventSeason().
 */

/** Vrai entre le 30 novembre et le 1er janvier (heure locale) : on ne demande le calendrier au serveur qu'à ce moment-là. */
export function adventSeason(d = new Date()) {
  const m = d.getMonth(), j = d.getDate();
  return m === 11 || (m === 10 && j === 30) || (m === 0 && j === 1);
}
