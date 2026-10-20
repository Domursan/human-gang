// ===== Humane Gang — fonction edge « hg-birthdays » =====
// Appelée chaque jour par pg_cron (8h00, heure suisse). Idempotente : un anniversaire n'est fêté
// qu'une fois par an (table hg_birthday_log), donc un appel en double ne renvoie rien.
// verify_jwt = false (aucune donnée n'est renvoyée, seulement des compteurs).
// Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis), DISCORD_BOT_TOKEN, SITE_URL (facultatif).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

async function discord(path: string, body: unknown) {
  const token = Deno.env.get('DISCORD_BOT_TOKEN');
  if (!token) throw new Error('DISCORD_BOT_TOKEN absent');
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method: 'POST', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.status === 429) { const j = await res.json().catch(() => ({})); await new Promise((r) => setTimeout(r, Math.min(5000, (j.retry_after ?? 1) * 1000))); continue; }
    if (!res.ok) throw new Error(`Discord ${res.status} : ${await res.text()}`);
    return await res.json();
  }
  throw new Error('Discord : trop de requêtes');
}
const sendChannel = (id: string, m: Record<string, unknown>) => discord(`/channels/${id}/messages`, m);
async function sendDM(userId: string, m: Record<string, unknown>) {
  const ch = await discord('/users/@me/channels', { recipient_id: userId });
  return sendChannel(ch.id, { allowed_mentions: { parse: [] }, ...m });
}
const isSnowflake = (v: unknown) => typeof v === 'string' && /^\d{17,20}$/.test(v);

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
          title: `Joyeux anniversaire ${p.pseudo} !`,
          description: 'Tout le Humane Gang te souhaite une journée incroyable.',
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
          embeds: [{ title: `C'est l'anniversaire de ${p.pseudo} aujourd'hui !`, description: 'Pensez à lui souhaiter.', color: 0xe2c77e, footer: { text: 'Humane Gang' } }],
        });
        out.announces++;
      } catch (e) { console.error('[hg-birthdays] annonce', e); out.errors++; }
    }
  }
  return json({ ok: true, ...out });
});
