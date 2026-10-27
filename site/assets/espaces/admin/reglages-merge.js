// =====================================================================
// Admin : écriture d'une clé de hg_settings sans effacer ses autres sous-clés.
// Relit la valeur courante de la clé (pas le cache de la page), applique la modification à une copie, puis enregistre
// l'objet complet. Les sous-clés que le formulaire ne montre pas restent donc en place.
// Dépendances : core.js (sb).
// Exporte : lireReglage (valeur d'une clé, objet vide si absente), ecrireReglage (modification puis enregistrement).
// =====================================================================
import { sb } from '../../commun/core.js';

/**
 * Valeur d'une clé de hg_settings, relue en base. Renvoie un objet vide si la clé est absente ou n'est pas un objet.
 * @param {string} key clé (ex. « saisons »).
 * @returns {Promise<object>} copie de la valeur.
 * @throws {Error} si la lecture échoue.
 */
export async function lireReglage(key) {
  const { data, error } = await sb.from('hg_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  const v = data?.value;
  return v && typeof v === 'object' && !Array.isArray(v) ? structuredClone(v) : {};
}

/**
 * Modifie une clé de hg_settings : relit la valeur, la passe à fn (qui la modifie sur place), puis enregistre l'objet
 * complet. Une erreur de la base est relancée pour que l'appelant l'affiche.
 * @param {string} key clé à modifier.
 * @param {(v: object) => void} fn modification de la copie (sans retour, ou un objet de remplacement).
 * @returns {Promise<object>} valeur enregistrée.
 */
export async function ecrireReglage(key, fn) {
  const cur = await lireReglage(key);
  const next = fn(cur) ?? cur;
  const { error } = await sb.from('hg_settings').upsert({ key, value: next, updated_at: new Date().toISOString() });
  if (error) throw error;
  return next;
}
