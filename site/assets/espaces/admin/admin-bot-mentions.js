// ===== Humane Gang — administration : bot Discord, onglet « Mentions » (admin-bot.js) =====
// Mention par type d’annonce (aucune, le rôle, @everyone), grisée sans salon.
// Exporte : montageMentions(c). Contexte c : voir admin-bot.js.

import { $ } from '../../commun/core.js';
import { MENTION_TYPES } from './admin-bot-commun.js';

export function montageMentions(c) {
  const { api, chanOf, container, form } = c;
  /** Les choix de mention ne servent qu'avec un salon : sans salon d'annonces ni salon par type, le bloc est grisé. */
  function syncMentionControls() {
    const on = !!form.announce_channel_id.value.trim() || MENTION_TYPES.some(([k]) => chanOf(k).length > 0);
    $('#bot-mentions', container).disabled = !on;
    $('#bot-mentions-off', container).hidden = on;
  }
  form.announce_channel_id.addEventListener('input', syncMentionControls);


  Object.assign(api, { syncMentionControls });
}
