// ===== Cartes : générations des membres (idée C8, migration 081) =====
// Charge une fois les générations (RPC hg_card_generations : « og » ou « gen2 » par membre qui l'affiche) et les donne
// au rendu des cartes (cartes-ui.js, setGenerations). Sans la fonction (migration pas encore déployée) : rien ne change.
// Exporte : loadGenerations() (promesse de la Map user_id -> génération, jamais d'erreur).
import { sb } from './core.js';
import { setGenerations } from './cartes-ui.js';

let pending = null;
/**
 * Charge les générations (une seule requête par page) et les enregistre pour cardHtml.
 * @returns {Promise<Map<string, string>>} membre -> « og » | « gen2 » (vide en cas d'échec)
 */
export function loadGenerations() {
  if (pending) return pending;
  pending = (async () => {
    try {
      const { data, error } = await sb.rpc('hg_card_generations');
      if (error) throw error;
      const list = Array.isArray(data) ? data : [];
      setGenerations(list);
      return new Map(list.map((g) => [g.user_id, g.gen]));
    } catch (e) {
      console.warn('[générations]', e?.message || e);
      return new Map();
    }
  })();
  return pending;
}
