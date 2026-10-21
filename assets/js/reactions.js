// ===== Humane Gang — réactions (émojis) sur les souvenirs et les photos =====
// Une requête par page pour charger les réactions (loadReactions), puis rendu local.
// Les barres sont des <div data-react-bar="kind:id"> rafraîchies par refreshBars().
import { sb, toast, errMsg, esc } from './core.js';

export const REACTIONS = ['❤️', '😂', '😮', '🔥', '👏', '🎉'];
const LABEL = { '❤️': 'Cœur', '😂': 'Rire', '😮': 'Surprise', '🔥': 'Feu', '👏': 'Bravo', '🎉': 'Fête' };
const CHUNK = 100;

const cache = new Map();   // "kind:id" -> [{ emoji, user_id }]
const pending = new Set(); // "kind:id:emoji" en cours d'envoi
let meId = null;
const key = (kind, id) => `${kind}:${id}`;

/** Charge les réactions de plusieurs éléments d'un coup (lots de 100 identifiants). Ne lève jamais d'erreur. */
export async function loadReactions(kind, ids, uid = null) {
  if (uid) meId = uid;
  const list = [...new Set(ids.filter(Boolean))];
  for (const id of list) cache.set(key(kind, id), []);
  for (let i = 0; i < list.length; i += CHUNK) {
    const { data, error } = await sb.from('hg_reactions')
      .select('target_id,emoji,user_id').eq('target_kind', kind).in('target_id', list.slice(i, i + CHUNK));
    if (error) { console.warn('[reactions]', error); continue; }
    for (const r of data || []) cache.get(key(kind, r.target_id))?.push({ emoji: r.emoji, user_id: r.user_id });
  }
}

function summary(kind, id) {
  const rows = cache.get(key(kind, id)) || [];
  return REACTIONS.map((emoji) => {
    const rs = rows.filter((r) => r.emoji === emoji);
    return { emoji, n: rs.length, mine: rs.some((r) => r.user_id === meId) };
  });
}

/** Barre de pastilles (une par émoji) : compteur et état « j'ai réagi ». */
export function reactionBarHtml(kind, id) {
  const sid = esc(id);
  const btns = summary(kind, id).map(({ emoji, n, mine }) => `<button type="button" class="react-btn${mine ? ' is-on' : ''}"
      data-react="${esc(kind)}" data-react-id="${sid}" data-emoji="${esc(emoji)}" aria-pressed="${mine}"
      aria-label="${LABEL[emoji]} : ${n} ${n > 1 ? 'réactions' : 'réaction'}${mine ? ', tu as réagi' : ''}"><span class="react-emoji" aria-hidden="true">${emoji}</span><span class="react-count" aria-hidden="true">${n}</span></button>`).join('');
  return `<div class="react-bar" role="group" aria-label="Réactions" data-react-bar="${esc(kind)}:${sid}">${btns}</div>`;
}

/** Remplace le rendu de toutes les barres présentes dans la page. */
export function refreshBars(root = document) {
  for (const bar of root.querySelectorAll('[data-react-bar]')) {
    const [kind, ...rest] = bar.dataset.reactBar.split(':');
    bar.outerHTML = reactionBarHtml(kind, rest.join(':'));
  }
}

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
    const rows = cache.get(key(kind, id)) || [];
    if (data) rows.push({ emoji, user_id: meId });
    else {
      const i = rows.findIndex((r) => r.emoji === emoji && r.user_id === meId);
      if (i >= 0) rows.splice(i, 1);
    }
    cache.set(key(kind, id), rows);
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
