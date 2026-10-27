// ===== Humane Gang — plafonds de Paillettes (photos, souvenirs, sorties) côté client =====
// Le serveur ne paie que 5 photos et 5 souvenirs par jour, et 1 sortie par semaine (migration 072). Ce module lit
// où en est le membre avant un ajout, pour que le message de confirmation dise clairement si l'ajout rapporte.
/*
 * Rôle : lireQuota() appelle la RPC hg_eco_quota ; restants(q, cle) donne les gains encore possibles ;
 * messagePhotos / messageSouvenir / messageSortie / notePhotos construisent le texte de confirmation.
 * N'émet jamais d'exception : sans réponse du serveur, le message habituel est gardé.
 * Pages : irl.js (photos, sorties), irl-history.js (photos d'une rencontre passée), historique.js (souvenirs).
 * Dépendances : core/supabase.js (client sb), utils.js (pluralCount).
 * Exporte : lireQuota, restants, messagePhotos, messageSouvenir, messageSortie, notePhotos.
 */
import { sb } from './core/supabase.js';
import { pluralCount } from './utils.js';

/**
 * Lit les gains déjà obtenus aujourd'hui (photos, souvenirs) et cette semaine (sortie).
 * @returns {Promise<object|null>} { photos: {payees, plafond}, souvenirs: {payes, plafond}, sortie: {payees, plafond} } ou null
 */
export async function lireQuota() {
  try {
    const { data, error } = await sb.rpc('hg_eco_quota');
    if (error || !data || typeof data !== 'object') return null;
    return data;
  } catch { return null; }
}

/**
 * Nombre d'ajouts qui rapportent encore des Paillettes.
 * @param {object|null} q réponse de lireQuota
 * @param {'photos'|'souvenirs'|'sortie'} cle type d'ajout
 * @returns {number|null} 0 ou plus ; null si inconnu
 */
export function restants(q, cle) {
  const x = q?.[cle];
  if (!x) return null;
  const payes = Number(x.payees ?? x.payes), plafond = Number(x.plafond);
  if (!Number.isFinite(payes) || !Number.isFinite(plafond)) return null;
  return Math.max(0, plafond - payes);
}

/**
 * Message après l'ajout de photos.
 * @param {number} n photos ajoutées
 * @param {number|null} reste photos qui rapportaient encore avant l'ajout (null : inconnu)
 * @param {string} base message habituel
 * @returns {string} le message à afficher
 */
export function messagePhotos(n, reste, base) {
  if (reste === null || n <= reste) return base;
  if (reste === 0) {
    return `${n > 1 ? pluralCount(n, 'photo ajoutée', 'photos ajoutées') : 'Photo ajoutée'}, mais tu as déjà gagné tes Paillettes photo du jour.`;
  }
  return `${pluralCount(n, 'photo ajoutée', 'photos ajoutées')}. ${reste > 1 ? `Les ${reste} premières rapportent` : 'La première rapporte'} des Paillettes : tu as atteint le plafond photo du jour.`;
}

/**
 * Message après l'ajout d'un souvenir.
 * @param {number|null} reste souvenirs qui rapportaient encore avant l'ajout (null : inconnu)
 * @param {string} base message habituel
 * @returns {string} le message à afficher
 */
export function messageSouvenir(reste, base) {
  return reste === 0 ? `${base.replace(/\.$/, '')}, mais tu as déjà gagné tes Paillettes souvenir du jour.` : base;
}

/**
 * Phrase à ajouter à un message quand des photos ajoutées ne rapportent pas (rencontre passée avec photos).
 * @param {number} n photos ajoutées
 * @param {number|null} reste photos qui rapportaient encore avant l'ajout (null : inconnu)
 * @returns {string} la phrase, ou une chaîne vide si toutes les photos rapportent
 */
export function notePhotos(n, reste) {
  if (reste === null || n <= reste) return '';
  if (reste === 0) return 'Tu as déjà gagné tes Paillettes photo du jour.';
  return `${reste > 1 ? `Seules les ${reste} premières photos rapportent` : 'Seule la première photo rapporte'} des Paillettes : plafond du jour atteint.`;
}

/**
 * Message après la création d'une sortie (date à venir ou à caler).
 * @param {number|null} reste sorties qui rapportaient encore cette semaine avant la création (null : inconnu)
 * @param {string} base message habituel
 * @returns {string} le message à afficher
 */
export function messageSortie(reste, base) {
  return reste === 0 ? `${base} Tu as déjà gagné tes Paillettes de sortie cette semaine : celle-ci n’en rapporte pas.` : base;
}
