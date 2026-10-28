// ===== Humane Gang — administration : bot Discord, onglet « Connexion » (admin-bot.js) =====
// Réglages généraux du bot (salon d’annonces, ID admin, rôle, notifications), test, et enregistrement du formulaire #bot-form (aussi pour Salons et Mentions).
// Exporte : montageConnexion(c). Contexte c : voir admin-bot.js.

import { sb, toast, $, callFn } from '../../commun/core.js';
import { pluralCount } from '../../commun/utils.js';
import { CHAN_MAX, DISCORD_ID, MENTION_TYPES, NOTIFY_KEYS, check } from './admin-bot-commun.js';

export function montageConnexion(c) {
  const { S, api, assertLoaded, busy, chanOf, container, form, mentionOf } = c;
  /** Remplit le formulaire des réglages généraux avec les valeurs enregistrées, puis recale les salons et les mentions. */
  function renderSettings() {
    form.announce_channel_id.value = S.bot.announce_channel_id ?? '';
    form.admin_discord_id.value = S.bot.admin_discord_id ?? '';
    form.mention_role_id.value = S.bot.mention_role_id ?? '';
    for (const [k] of MENTION_TYPES) form.elements[`mention_${k}`].value = mentionOf(k);
    for (const k of NOTIFY_KEYS) form.elements[k].checked = S.bot.notify[k] !== false;
    api.resetDraft();
  }

  // Enregistrement des réglages généraux, des salons et des mentions : contrôle des identifiants Discord et du rôle exigé
  // par une mention, puis écriture de hg_settings.bot. Salons connus et salons par type viennent du brouillon.
  // Les autres réglages du bot sont conservés (...S.bot).
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter ?? ev.currentTarget, async () => {
      assertLoaded();
      const channel = form.announce_channel_id.value.trim(), admin = form.admin_discord_id.value.trim();
      const role = form.mention_role_id.value.trim();
      if (channel && !DISCORD_ID.test(channel)) throw new Error('L\'ID du salon doit être un nombre de 17 à 20 chiffres.');
      if (admin && !DISCORD_ID.test(admin)) throw new Error('Ton ID Discord doit être un nombre de 17 à 20 chiffres.');
      if (role && !DISCORD_ID.test(role)) throw new Error('L\'ID du rôle doit être un nombre de 17 à 20 chiffres.');
      const mentions = Object.fromEntries(MENTION_TYPES.map(([k]) => [k, form.elements[`mention_${k}`].value]));
      if (Object.values(mentions).includes('role') && !role) throw new Error('Pour mentionner un rôle, renseigne son ID.');
      const salons = S.salonDraft.salons.map((s) => ({ id: s.id, nom: s.nom }));
      // Salons par type : 5 au plus, seulement des salons connus. Vide = rien n'est stocké (repli sur le salon d'annonces).
      const channels = {};
      for (const [k] of MENTION_TYPES) {
        const list = chanOf(k).filter((id) => salons.some((s) => s.id === id)).slice(0, CHAN_MAX);
        if (list.length) channels[k] = list;
      }
      const value = {
        ...S.bot, announce_channel_id: channel || null, birthday_channel_id: channels.birthday?.[0] ?? null, channels, salons,
        admin_discord_id: admin || null, mention_role_id: role || null, mentions: { ...(S.bot.mentions || {}), ...mentions },
        notify: { ...(S.bot.notify || {}), ...Object.fromEntries(NOTIFY_KEYS.map((k) => [k, form.elements[k].checked])) },
      };
      check(await sb.from('hg_settings').upsert({ key: 'bot', value, updated_at: new Date().toISOString() }));
      S.bot = value;
      api.resetDraft();
      api.syncChannelOption();
      api.renderAnnChannels();
      toast('Réglages du bot enregistrés', 'ok');
    });
  });
  // Test : le bot envoie un message de test au salon et en MP ; le résultat de chaque voie est affiché.
  $('#bot-test', container).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    const type = $('#bot-test-type', container).value;
    const res = await callFn('hg-notify', type ? { event: 'bot_test', type } : { event: 'bot_test' });
    const parts = [];
    let bad = false;
    if (Array.isArray(res?.channels) && res.channels.length) {
      const fails = res.channels.filter((c) => !c.ok);
      bad = bad || fails.length > 0;
      parts.push(`${pluralCount(res.channels.length - fails.length, 'salon OK', 'salons OK')}${fails.length ? `, ${pluralCount(fails.length, 'en échec', 'en échec')} : ${fails[0].error ?? 'erreur inconnue'}` : ''}`);
    } else if (res?.channel !== undefined) {
      bad = bad || res.channel === false;
      parts.push(`salon : ${res.channel ? 'OK' : 'échec'}`);
    }
    if (res?.dm !== undefined) { bad = bad || res.dm === false; parts.push(`MP : ${res.dm ? 'OK' : 'échec'}`); }
    if (res?.error) throw new Error(res.error);
    toast(parts.length ? `Test envoyé (${parts.join(', ')})` : 'Test envoyé', bad ? 'error' : 'ok');
  }));



  Object.assign(api, { renderSettings });
}
