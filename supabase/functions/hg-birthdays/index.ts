// ===== Humane Gang — fonction edge « hg-birthdays » =====
// Appelée chaque jour par pg_cron (8h00, heure suisse). Idempotente : un anniversaire n'est fêté
// qu'une fois par an (table hg_birthday_log), donc un appel en double ne renvoie rien.
// verify_jwt = false (aucune donnée n'est renvoyée, seulement des compteurs).
// Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis), DISCORD_BOT_TOKEN, SITE_URL (facultatif).
// Textes : modèles « birthday_dm » et « birthday_announce » (hg_settings.bot_templates, défauts dans ../_shared/bot-templates.json).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { loadTemplates, renderTemplate, embedFrom } from '../_shared/templates.ts';
import { hasBotToken, isSnowflake, jsonResponse, sendChannel, sendDM } from '../_shared/discord.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
const json = (b: unknown, s = 200) => jsonResponse(b, s);

Deno.serve(async () => {
  // Date du jour en Suisse
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  const year = Number(parts.year), mm = parts.month, dd = parts.day;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const targets = [`${mm}-${dd}`];
  if (!leap && mm === '02' && dd === '28') targets.push('02-29'); // les « 29 février » fêtés le 28 les autres années

  const { data: people, error } = await db.from('hg_profiles').select('id, pseudo, birthday, share_birthday, discord_id, bot_optin').not('birthday', 'is', null);
  if (error) return json({ error: error.message }, 500);
  const today = (people ?? []).filter((p) => targets.includes(String(p.birthday).slice(5, 10)));

  const { data: s } = await db.from('hg_settings').select('value').eq('key', 'bot').maybeSingle();
  const bot = (s?.value ?? {}) as { announce_channel_id?: string; notify?: Record<string, boolean> };
  const botOn = bot.notify?.birthday !== false && !!Deno.env.get('DISCORD_BOT_TOKEN');

  const out = { today: today.length, celebrated: 0, dms: 0, announces: 0, errors: 0 };
  const tpl = botOn && today.length ? await loadTemplates(db) : {};
  const home = SITE ? `${SITE}/accueil.html` : '';
  for (const p of today) {
    // Verrou annuel : si la ligne existe déjà, l'anniversaire a déjà été fêté
    const { error: lockErr } = await db.from('hg_birthday_log').insert({ user_id: p.id, year });
    if (lockErr) continue;
    out.celebrated++;
    if (p.share_birthday) {
      await db.from('hg_activity').insert({ user_id: p.id, kind: 'birthday', text: `Joyeux anniversaire ${p.pseudo} !` });
    }
    if (!botOn) continue;
    if (p.bot_optin && isSnowflake(p.discord_id)) {
      try {
        await sendDM(p.discord_id, { embeds: [{
          ...embedFrom(renderTemplate('birthday_dm', { pseudo: p.pseudo, lien: home }, tpl)),
          color: 0xe0909a, url: SITE ? `${SITE}/accueil.html` : undefined, footer: { text: 'Humane Gang' },
        }] });
        out.dms++;
      } catch (e) { console.error('[hg-birthdays] MP', e); out.errors++; }
    }
    if (p.share_birthday && isSnowflake(bot.announce_channel_id)) {
      try {
        const mention = isSnowflake(p.discord_id) ? `<@${p.discord_id}>` : p.pseudo;
        await sendChannel(bot.announce_channel_id!, {
          content: `Joyeux anniversaire ${mention} !`,
          allowed_mentions: { users: isSnowflake(p.discord_id) ? [p.discord_id] : [] },
          embeds: [{ ...embedFrom(renderTemplate('birthday_announce', { pseudo: p.pseudo, lien: home }, tpl)), color: 0xe2c77e, footer: { text: 'Humane Gang' } }],
        });
        out.announces++;
      } catch (e) { console.error('[hg-birthdays] annonce', e); out.errors++; }
    }
  }
  return json({ ok: true, ...out });
});
