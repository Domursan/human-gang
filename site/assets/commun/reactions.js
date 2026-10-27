// ===== Humane Gang — réactions (émojis) sur les souvenirs et les photos =====
// Une requête par page pour charger les réactions (loadReactions), puis rendu local.
// Les barres sont des <div data-react-bar="kind:id"> rafraîchies par refreshBars().
/*
 * Rôle : barre de réactions (6 émojis avec compteur) sous les souvenirs et les photos. Un clic ajoute ou retire
 * sa réaction ; le compteur et l'état « j'ai réagi » se mettent à jour sans recharger la page.
 * Page : historique.html (souvenirs), irl.html (photos de sortie), la visionneuse de photos (photos.js),
 *   et les pages d'administration des souvenirs.
 * Dépendances : core.js (client Supabase, toast, errMsg, esc).
 * Tables / RPC : hg_reactions (lecture), rpc hg_toggle_reaction (ajout ou retrait).
 * Exporte : REACTIONS, REACTION_LABEL, loadReactions, reactionBarHtml, refreshBars.
 */
import { sb, toast, errMsg, esc } from './core.js';

/* ---------- Constantes ---------- */

/** Émojis proposés, dans l'ordre d'affichage. */
export const REACTIONS = ['❤️', '😂', '😮', '🔥', '👏', '🎉'];
/** Nom lisible de chaque émoji, pour les lecteurs d'écran. */
export const REACTION_LABEL = { '❤️': 'Cœur', '😂': 'Rire', '😮': 'Surprise', '🔥': 'Feu', '👏': 'Bravo', '🎉': 'Fête' };
/** Nombre maximal d'identifiants envoyés dans une même requête. */
const CHUNK = 100;

/* ---------- État ---------- */

/** Réactions déjà chargées : clé « genre:id » -> liste de { emoji, user_id }. */
const cache = new Map();   // "kind:id" -> [{ emoji, user_id }]
/** Éléments dont le chargement a échoué (clé « genre:id ») : leur compteur est « inconnu », pas 0. */
const unknown = new Set();
/** Clics en cours d'envoi, pour ignorer les doubles clics (clé « genre:id:emoji »). */
const pending = new Set(); // "kind:id:emoji" en cours d'envoi
/** Identifiant du membre connecté (renseigné par loadReactions), pour savoir si j'ai réagi. */
let meId = null;
/**
 * Clé du cache pour un élément.
 * @param {string} kind Genre de l'élément (ex. 'moment', 'photo').
 * @param {string} id Identifiant de l'élément.
 * @returns {string}
 */
const key = (kind, id) => `${kind}:${id}`;

/* ---------- Chargement ---------- */

/**
 * Charge les réactions de plusieurs éléments d'un coup (lots de 100 identifiants). Ne lève jamais d'erreur.
 * Un lot en erreur n'affiche pas de zéro : ses éléments sont marqués « inconnus » et l'erreur part dans la console ;
 * les autres lots sont quand même chargés.
 * @param {string} kind Genre des éléments.
 * @param {string[]} ids Identifiants (les vides sont ignorés).
 * @param {string|null} [uid] Identifiant du membre connecté.
 * @returns {Promise<void>}
 */
export async function loadReactions(kind, ids, uid = null) {
  if (uid) meId = uid;
  const list = [...new Set(ids.filter(Boolean))];
  for (const id of list) { cache.set(key(kind, id), []); unknown.delete(key(kind, id)); }
  for (let i = 0; i < list.length; i += CHUNK) {
    const part = list.slice(i, i + CHUNK);
    const { data, error } = await sb.from('hg_reactions')
      .select('target_id,emoji,user_id').eq('target_kind', kind).eq('active', true).in('target_id', part);
    if (error) {
      console.warn('[reactions] lot non chargé', error);
      for (const id of part) unknown.add(key(kind, id));
      continue;
    }
    for (const r of data || []) cache.get(key(kind, r.target_id))?.push({ emoji: r.emoji, user_id: r.user_id });
  }
}

/**
 * Pour un élément : pour chaque émoji, son nombre de réactions et si le membre connecté a réagi.
 * @param {string} kind Genre de l'élément.
 * @param {string} id Identifiant de l'élément.
 * @returns {Array<{emoji: string, n: number, mine: boolean}>|null} null si le chargement a échoué (compteur inconnu).
 */
function summary(kind, id) {
  if (unknown.has(key(kind, id))) return null;
  const rows = cache.get(key(kind, id)) || [];
  return REACTIONS.map((emoji) => {
    const rs = rows.filter((r) => r.emoji === emoji);
    return { emoji, n: rs.length, mine: rs.some((r) => r.user_id === meId) };
  });
}

/** Barre de pastilles (une par émoji) : compteur et état « j'ai réagi ». */
export function reactionBarHtml(kind, id) {
  const sid = esc(id);
  const sum = summary(kind, id);
  const btns = (sum || REACTIONS.map((emoji) => ({ emoji, n: null, mine: false }))).map(({ emoji, n, mine }) => `<button type="button" class="react-btn${mine ? ' is-on' : ''}"
      data-react="${esc(kind)}" data-react-id="${sid}" data-emoji="${esc(emoji)}" aria-pressed="${mine}"
      aria-label="${REACTION_LABEL[emoji]} : ${n == null ? 'nombre indisponible' : `${n} ${n > 1 ? 'réactions' : 'réaction'}`}${mine ? ', tu as réagi' : ''}"><span class="react-emoji" aria-hidden="true">${emoji}</span><span class="react-count" aria-hidden="true">${n == null ? '?' : n}</span></button>`).join('');
  return `<div class="react-bar" role="group" aria-label="Réactions" data-react-bar="${esc(kind)}:${sid}">${btns}</div>`;
}

/** Remplace le rendu de toutes les barres présentes dans la page. */
export function refreshBars(root = document) {
  for (const bar of root.querySelectorAll('[data-react-bar]')) {
    const [kind, ...rest] = bar.dataset.reactBar.split(':');
    bar.outerHTML = reactionBarHtml(kind, rest.join(':'));
  }
}

/* ---------- Clic sur une réaction ---------- */

// Délégation : un seul écouteur pour toute la page, y compris les barres ajoutées plus tard.
// Le clic appelle hg_toggle_reaction (le serveur décide : ajout ou retrait). Le cache local est mis à jour
// avec la réponse, puis toutes les barres sont redessinées. Pendant l'envoi, le bouton est désactivé.
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-react]');
  if (!b) return;
  const { react: kind, reactId: id, emoji } = b.dataset;
  const k = `${kind}:${id}:${emoji}`;
  if (pending.has(k)) return;
  pending.add(k);
  b.disabled = true;
  try {
    const { data, error } = await sb.rpc('hg_toggle_reaction', { p_kind: kind, p_id: id, p_emoji: emoji });
    if (error) throw error;
    if (unknown.has(key(kind, id))) {
      // Compteur inconnu : on recharge l'élément complet plutôt que d'ajouter une ligne à un décompte incomplet
      await loadReactions(kind, [id]);
    } else {
      const rows = cache.get(key(kind, id)) || [];
      if (data) rows.push({ emoji, user_id: meId });
      else {
        const i = rows.findIndex((r) => r.emoji === emoji && r.user_id === meId);
        if (i >= 0) rows.splice(i, 1);
      }
      cache.set(key(kind, id), rows);
    }
    refreshBars();
    // Le bouton a été remplacé : on rend le focus au nouveau bouton du même émoji
    const next = [...document.querySelectorAll('[data-react]')]
      .find((x) => x.dataset.react === kind && x.dataset.reactId === id && x.dataset.emoji === emoji);
    next?.focus();
  } catch (err) {
    b.disabled = false;
    toast(`Réaction non enregistrée : ${errMsg(err)}`, 'error');
  } finally {
    pending.delete(k);
  }
});
