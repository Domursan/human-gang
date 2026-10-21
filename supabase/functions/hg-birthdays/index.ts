// ===== Humane Gang — fonction edge « hg-birthdays » =====
// Appelée chaque jour par pg_cron (8h00, heure suisse).
// Suivi par canal dans hg_birthday_log (une ligne par membre et par année, dm_sent_at / announce_sent_at) :
//   - un canal n'est marqué qu'une fois envoyé (ou quand il ne s'applique pas : pas d'ID Discord, annonce non partagée) ;
//   - s'il échoue, il est retenté aux passages suivants, pendant WINDOW_DAYS jours (rattrapage si le bot était coupé) ;
//   - si le bot est coupé (DISCORD_BOT_TOKEN absent ou notify.birthday désactivé), rien n'est consommé.
// Un appel en double ne fête donc pas deux fois : chaque canal déjà marqué est ignoré.
// Sécurité : en-tête « x-cron-secret » égal au secret CRON_SECRET (sans ce secret, la fonction refuse tout : 401).
// Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis), CRON_SECRET, DISCORD_BOT_TOKEN, SITE_URL (facultatif).
// Textes : modèles « birthday_dm » et « birthday_announce » (hg_settings.bot_templates, défauts dans ../_shared/bot-templates.json).
// Journal : une ligne hg_bot_log (kind « auto:anniversaire ») quand il y a eu un envoi, une tentative ou un échec.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { loadTemplates, renderTemplate, embedFrom } from '../_shared/templates.ts';
import { hasBotToken, isSnowflake, jsonResponse, sendChannel, sendDM } from '../_shared/discord.ts';
import { cronAuthorized } from '../_shared/cron-auth.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
const json = (b: unknown, s = 200) => jsonResponse(b, s);
const WINDOW_DAYS = 3; // jours (dont aujourd'hui) pendant lesquels un envoi en attente est retenté

type Person = { id: string; pseudo: string; birthday: string; share_birthday: boolean; discord_id: string | null; bot_optin: boolean };
type Attempt = { user_id: string; pseudo: string; ok: boolean; status: 'sent' | 'failed'; reason: string | null };

const pad = (n: number) => String(n).padStart(2, '0');
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Les WINDOW_DAYS derniers jours, en heure suisse, du plus récent au plus ancien. */
function recentDays(): { year: number; mmdd: string; leap: boolean }[] {
  const z = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  const base = Date.UTC(Number(z.year), Number(z.month) - 1, Number(z.day));
  return Array.from({ length: WINDOW_DAYS }, (_, k) => {
    const d = new Date(base - k * 86_400_000);
    const year = d.getUTCFullYear();
    return { year, mmdd: `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, leap: isLeap(year) };
  });
}
/** L'anniversaire (AAAA-MM-JJ) tombe-t-il ce jour ? Le 29 février est fêté le 28 les années non bissextiles. */
function matches(birthday: string, day: { mmdd: string; leap: boolean }): boolean {
  const bd = birthday.slice(5, 10);
  return bd === day.mmdd || (!day.leap && day.mmdd === '02-28' && bd === '02-29');
}

Deno.serve(async (req) => {
  if (!(await cronAuthorized(req, db))) return json({ error: 'Non autorisé' }, 401);

  const { data: people, error } = await db.from('hg_profiles')
    .select('id, pseudo, birthday, share_birthday, discord_id, bot_optin').not('birthday', 'is', null);
  if (error) return json({ error: error.message }, 500);

  // Anniversaire du jour ou des jours précédents de la fenêtre (le plus récent gagne)
  const days = recentDays();
  const candidates: { p: Person; year: number }[] = [];
  for (const p of (people ?? []) as Person[]) {
    const day = days.find((d) => matches(String(p.birthday), d));
    if (day) candidates.push({ p, year: day.year });
  }

  const { data: s } = await db.from('hg_settings').select('value').eq('key', 'bot').maybeSingle();
  const bot = (s?.value ?? {}) as { announce_channel_id?: string; notify?: Record<string, boolean> };
  const botOn = bot.notify?.birthday !== false && hasBotToken();

  const out = { today: candidates.length, celebrated: 0, dms: 0, announces: 0, errors: 0 };
  if (!candidates.length) return json({ ok: true, ...out });
  if (!botOn) return json({ ok: true, ...out, skipped: 'bot désactivé : anniversaires non consommés' });

  const tpl = await loadTemplates(db);
  const home = SITE ? `${SITE}/accueil.html` : '';
  const attempts: Attempt[] = [];
  const mark = async (userId: string, year: number, col: 'dm_sent_at' | 'announce_sent_at') => {
    const { error: e } = await db.from('hg_birthday_log').update({ [col]: new Date().toISOString() }).eq('year', year).eq('user_id', userId);
    if (e) { console.error('[hg-birthdays] marquage', col, e); out.errors++; }
  };

  for (const { p, year } of candidates) {
    // 1. Ligne de suivi : créée une fois par membre et par année (clé primaire = protection contre un double appel)
    const { data: found, error: selErr } = await db.from('hg_birthday_log').select('dm_sent_at, announce_sent_at')
      .eq('year', year).eq('user_id', p.id).maybeSingle();
    if (selErr) { out.errors++; console.error('[hg-birthdays] lecture', selErr); continue; }
    let row: { dm_sent_at: string | null; announce_sent_at: string | null } = found ?? { dm_sent_at: null, announce_sent_at: null };
    if (!found) {
      const { error: insErr } = await db.from('hg_birthday_log').insert({ user_id: p.id, year });
      if (insErr) {
        // Doublon : une autre exécution traite déjà ce membre. Autre erreur : rien n'est marqué, on réessaiera.
        if (!/duplicate key|23505/i.test(insErr.message)) { out.errors++; console.error('[hg-birthdays] verrou', insErr); }
        continue;
      }
      out.celebrated++;
      if (p.share_birthday) {
        const { error: actErr } = await db.from('hg_activity').insert({ user_id: p.id, kind: 'birthday', text: `Joyeux anniversaire ${p.pseudo} !` });
        if (actErr) console.error('[hg-birthdays] fil d\'activité', actErr);
      }
    }

    // 2. Canaux : un canal sans objet est marqué d'emblée ; un canal qui échoue reste en attente.
    if (row.dm_sent_at == null) {
      if (!(p.bot_optin && isSnowflake(p.discord_id))) {
        await mark(p.id, year, 'dm_sent_at');
      } else {
        try {
          await sendDM(p.discord_id!, { embeds: [{
            ...embedFrom(renderTemplate('birthday_dm', { pseudo: p.pseudo, lien: home }, tpl)),
            color: 0xe0909a, url: home || undefined, footer: { text: 'Humane Gang' },
          }] });
          out.dms++;
          attempts.push({ user_id: p.id, pseudo: p.pseudo, ok: true, status: 'sent', reason: null });
          await mark(p.id, year, 'dm_sent_at');
        } catch (e) {
          console.error('[hg-birthdays] MP', e); out.errors++;
          attempts.push({ user_id: p.id, pseudo: p.pseudo, ok: false, status: 'failed', reason: `MP : ${String((e as Error).message).slice(0, 160)}` });
        }
      }
    }
    if (row.announce_sent_at == null) {
      if (!(p.share_birthday && isSnowflake(bot.announce_channel_id))) {
        await mark(p.id, year, 'announce_sent_at');
      } else {
        try {
          const mention = isSnowflake(p.discord_id) ? `<@${p.discord_id}>` : p.pseudo;
          await sendChannel(bot.announce_channel_id!, {
            content: `Joyeux anniversaire ${mention} !`,
            allowed_mentions: { users: isSnowflake(p.discord_id) ? [p.discord_id] : [] },
            embeds: [{ ...embedFrom(renderTemplate('birthday_announce', { pseudo: p.pseudo, lien: home }, tpl)), color: 0xe2c77e, footer: { text: 'Humane Gang' } }],
          });
          out.announces++;
          attempts.push({ user_id: p.id, pseudo: p.pseudo, ok: true, status: 'sent', reason: null });
          await mark(p.id, year, 'announce_sent_at');
        } catch (e) {
          console.error('[hg-birthdays] annonce', e); out.errors++;
          attempts.push({ user_id: p.id, pseudo: p.pseudo, ok: false, status: 'failed', reason: `annonce : ${String((e as Error).message).slice(0, 160)}` });
        }
      }
    }
  }

  // 3. Trace pour l'administrateur (historique du bot) : seulement s'il s'est passé quelque chose
  if (out.celebrated || attempts.length || out.errors) {
    const { error: logErr } = await db.from('hg_bot_log').insert({
      kind: 'auto:anniversaire',
      title: `Anniversaires : ${out.celebrated} nouveau(x), ${out.dms} MP, ${out.announces} annonce(s)`,
      body: out.errors
        ? `${out.errors} échec(s) : nouvelle tentative au prochain passage (fenêtre de ${WINDOW_DAYS} jours).`
        : 'Passage automatique des anniversaires.',
      recipients: attempts,
      channel: out.announces > 0,
    });
    if (logErr) console.error('[hg-birthdays] journal', logErr);
  }
  return json({ ok: true, ...out });
});
