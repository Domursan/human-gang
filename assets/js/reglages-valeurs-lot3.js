// Lecture des réglages du lot 3 (Secret Santa, sorties IRL, souvenirs et albums) depuis hg_settings.
// Sans réglage enregistré, ou si la lecture échoue, chaque valeur reste le défaut codé jusqu'ici.
// Usage : await chargerReglagesLot3() au démarrage d'une page, puis reglage('irl.delai_passee_heures') en synchrone.
import { sb } from './core/supabase.js';
import { CHAMPS_LOT3, CLES_LOT3 } from './admin-reglages/keys-lot3.js';

const PAR_NOM = Object.fromEntries(CHAMPS_LOT3.map((c) => [`${c.cle}.${c.champ}`, c]));
let brut = {};          // { ss: {...}, irl: {...}, ... } tel que stocké
let chargement = null;  // promesse en cours ou terminée

/** Charge les clés du lot 3 (une fois par page, sauf { force: true }). Ne lève jamais d'erreur. */
export function chargerReglagesLot3({ force = false } = {}) {
  if (chargement && !force) return chargement;
  chargement = (async () => {
    try {
      const { data, error } = await sb.from('hg_settings').select('key, value').in('key', CLES_LOT3);
      if (error) throw error;
      const next = {};
      for (const r of data ?? []) if (r.value && typeof r.value === 'object' && !Array.isArray(r.value)) next[r.key] = r.value;
      brut = next;
    } catch (e) {
      console.warn('[réglages] lecture impossible, défauts appliqués :', e?.message || e);
      brut = {};
      chargement = null; // une nouvelle tentative sera faite à l'appel suivant
    }
    return brut;
  })();
  return chargement;
}

/** Valeur normalisée d'un champ, ou undefined si elle est absente ou invalide. */
function valide(c, v) {
  if (v === undefined) return undefined;
  if (c.nullable && (v === null || v === '')) return null;
  if (c.type === 'bool') return typeof v === 'boolean' ? v : undefined;
  if (c.type === 'texte') {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t.length <= c.max ? t : undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const n = c.type === 'entier' ? Math.floor(v) : v;
  return n >= c.min && n <= c.max ? n : undefined;
}

/** Valeur effective d'un réglage, « cle.champ » (ex. 'irl.delai_passee_heures'). Repli sur le défaut. */
export function reglage(nom) {
  const c = PAR_NOM[nom];
  if (!c) throw new Error(`Réglage inconnu : ${nom}`);
  const v = valide(c, brut[c.cle]?.[c.champ]);
  return v === undefined ? c.defaut : v;
}

/** Remplace en mémoire la valeur d'une clé après un enregistrement dans l'admin. */
export function majReglagesLot3(cle, valeur) {
  brut = { ...brut, [cle]: valeur };
}

/* ----- Raccourcis lus par le site ----- */
export const delaiPassee = () => reglage('irl.delai_passee_heures') * 3600 * 1000;
export const dureeDefautMs = () => reglage('irl.duree_defaut_heures') * 3600 * 1000;
export function bornesSondage() {
  const min = reglage('irl.sondage_min');
  return { min, max: Math.max(min, reglage('irl.sondage_max')) };
}
export const optionsPhoto = () => ({ max: reglage('photos.cote_max'), quality: reglage('photos.qualite') });
export const plafondsAlbum = () => ({ maxPhotos: reglage('albums.max_photos'), maxMo: reglage('albums.max_mo') });

/** Copie de l'objet stocké pour une clé (ex. 'ss'), tel qu'il est en base : utilisé par l'admin pour ne pas perdre les champs inconnus. */
export const objetLot3 = (cle) => ({ ...(brut[cle] ?? {}) });
