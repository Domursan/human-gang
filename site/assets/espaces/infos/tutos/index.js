// Tous les groupes de tutos (/assets/espaces/infos/tutos/<groupe>.js). Chaque groupe est un module de données.
// L'import est tolérant : un groupe absent ou en erreur est ignoré, la page d'aide reste utilisable.

export const GROUP_IDS = ['premiers-pas', 'secret-santa', 'irl-historique', 'cartes-base', 'cartes-avance', 'communaute'];
/** Groupes visibles sans compte (les autres demandent d'être connecté). */
export const PUBLIC_GROUP_IDS = ['premiers-pas'];

/** Charge les groupes qui se laissent importer, dans l'ordre de GROUP_IDS. Ne jette jamais. */
export async function loadTutoGroups() {
  const results = await Promise.allSettled(GROUP_IDS.map((id) => import(`./${id}.js`)));
  const groups = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.default) groups.push({ ...r.value.default, id: r.value.default.id || GROUP_IDS[i] });
    else console.warn('[tutos] groupe indisponible :', GROUP_IDS[i]);
  });
  return groups;
}
