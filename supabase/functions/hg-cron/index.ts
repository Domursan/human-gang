// ===== Humane Gang — fonction edge « hg-cron » =====
// Appelée toutes les 5 minutes par pg_cron. Idempotente : chaque envoi est « réservé » en base (colonne de marquage
// passée de null à maintenant) AVANT l'envoi, puis libéré si Discord échoue.
// Sécurité : en-tête « x-cron-secret » égal au secret CRON_SECRET (sans ce secret, la fonction refuse tout : 401).
// Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis), CRON_SECRET, DISCORD_BOT_TOKEN, SITE_URL (facultatif).
//
// Tâches :
//   1. Lancement des événements dynamiques : announce = true, active = true, starts_at passé, ends_at à venir,
//      announced_start_at null → annonce « dyn_start » dans le salon d'annonces (avec l'image). Mention : bot.mentions.dyn.
//   2. Fin : announce = true, active = true, ends_at passé, announced_end_at null → annonce « dyn_end » avec le top 3.
//      Un événement terminé depuis plus de 24 h est seulement marqué (pas d'annonce tardive).
//   3. Rappels de sortie IRL (opt-in, profil.remind_irl) : MP aux membres « oui » ou « peut-etre » d'une sortie
//      qui a lieu dans moins de 24 h (rappel « 24 h », marqué hg_event_rsvps.remind_24h_at) puis dans moins de 2 h
//      (rappel « 2 h », marqué remind_2h_at). Désactivé si bot.notify.irl === false.
//   4. Rappels d'envoi de cadeau (Secret Santa) : MP au Santa qui n'a pas marqué son envoi, dans les 3 jours qui
//      précèdent hg_ss_editions.send_deadline (marqué hg_ss_participants.send_reminder_at, une seule fois).
//      Désactivé si bot.notify.gift === false.
//   Sans bot (DISCORD_BOT_TOKEN absent ou aucun salon), les annonces ne sont pas marquées et les rappels ne partent pas :
//   ils partiront quand le bot sera prêt (sauf la fin d'un événement terminé depuis plus de 24 h, marquée sans envoi).
//   Chaque passage qui a fait quelque chose (annonce, rappel, erreur) laisse une ligne dans hg_bot_log (kind « auto:cron »).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { loadTemplates, renderTemplate, embedFrom, type Templates } from '../_shared/templates.ts';
import { buildDynAnnounce, type DynEvent, type DynPhase } from '../_shared/dyn-announce.ts';
import { hasBotToken, isSnowflake, jsonResponse, sendChannel, sendDM } from '../_shared/discord.ts';
import { mentionFor, type MentionBot } from '../_shared/mentions.ts';
import { cronAuthorized } from '../_shared/cron-auth.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
const LATE_MS = 24 * 3600_000;
const H = 3600_000;
const COLOR = { irl: 0xe2c77e, ss: 0xe0909a };
const json = (b: unknown, s = 200) => jsonResponse(b, s);
const link = (page: string) => (SITE ? `${SITE}/${page}` : undefined);
const embed = (e: Record<string, unknown>) => ({ embeds: [{ footer: { text: 'Humane Gang' }, timestamp: new Date().toISOString(), ...e }] });

type Keys = Record<string, string | number>;
type Attempt = { user_id: string; pseudo: string; ok: boolean; status: 'sent' | 'failed'; reason: string | null };
type Prof = { id: string; pseudo: string; discord_id: string | null; bot_optin: boolean; remind_irl?: boolean };
type Counters = { starts: number; ends: number; marked_late: number; pending_no_bot: number; irl_reminders: number; ss_reminders: number; errors: number };

/** Réserve un envoi : la colonne passe de null à maintenant. Renvoie false si une autre exécution l'a déjà pris. */
async function claimRow(table: string, keys: Keys, col: string): Promise<boolean> {
  let q = db.from(table).update({ [col]: new Date().toISOString() });
  for (const [k, v] of Object.entries(keys)) q = q.eq(k, v);
  const { data, error } = await q.is(col, null).select();
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
/** Libère une réservation (après un échec d'envoi) pour que le prochain passage réessaie. */
async function releaseRow(table: string, keys: Keys, col: string) {
  let q = db.from(table).update({ [col]: null });
  for (const [k, v] of Object.entries(keys)) q = q.eq(k, v);
  const { error } = await q;
  if (error) console.error(`[hg-cron] libération ${table}`, error);
}

/** Date « AAAA-MM-JJ » en heure suisse, décalée de n jours. */
function zurichDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 24 * H);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const fmtZurichWhen = (d: string) => new Intl.DateTimeFormat('fr-CH', {
  timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
}).format(new Date(d));
const fmtZurichDay = (d: string) => new Intl.DateTimeFormat('fr-CH', {
  timeZone: 'Europe/Zurich', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(`${d}T12:00:00Z`));
const canDM = (p: { bot_optin: boolean; discord_id: string | null } | null | undefined) => !!p && p.bot_optin && isSnowflake(p.discord_id);

/* ---------- 1 et 2 : annonces des événements dynamiques ---------- */
async function dynAnnouncements(out: Counters, bot: { announce_channel_id?: string } & MentionBot) {
  const nowIso = new Date().toISOString();
  const [{ data: startRows, error: e1 }, { data: endRows, error: e2 }] = await Promise.all([
    db.from('hg_dyn_events').select('*').eq('announce', true).eq('active', true).is('announced_start_at', null)
      .lte('starts_at', nowIso).gt('ends_at', nowIso),
    db.from('hg_dyn_events').select('*').eq('announce', true).eq('active', true).is('announced_end_at', null)
      .lte('ends_at', nowIso),
  ]);
  if (e1 || e2) throw new Error((e1 || e2)!.message);
  const starts = (startRows ?? []) as DynEvent[];
  const ends = (endRows ?? []) as DynEvent[];
  if (!starts.length && !ends.length) return;

  const channel = bot.announce_channel_id;
  const botReady = hasBotToken() && isSnowflake(channel);
  const tpl = botReady ? await loadTemplates(db) : {};

  const run = async (ev: DynEvent, phase: DynPhase) => {
    const col = phase === 'start' ? 'announced_start_at' : 'announced_end_at';
    if (phase === 'end' && Date.now() - new Date(ev.ends_at).getTime() > LATE_MS) {
      if (await claimRow('hg_dyn_events', { id: ev.id }, col)) out.marked_late++; // trop tard pour annoncer : on marque sans envoyer
      return;
    }
    if (!botReady) { out.pending_no_bot++; return; } // rien n'est marqué sans envoi effectif
    if (!(await claimRow('hg_dyn_events', { id: ev.id }, col))) return;
    try {
      await sendChannel(channel!, await buildDynAnnounce(db, ev, phase, tpl, SITE, mentionFor(bot, 'dyn')));
      phase === 'start' ? out.starts++ : out.ends++;
    } catch (e) {
      console.error(`[hg-cron] annonce ${phase} ${ev.id}`, e);
      out.errors++;
      await releaseRow('hg_dyn_events', { id: ev.id }, col);
    }
  };
  for (const ev of starts) await run(ev, 'start');
  for (const ev of ends) await run(ev, 'end');
}

/* ---------- 3 : rappels de sortie IRL (F1) ---------- */
async function irlReminders(out: Counters, attempts: Attempt[]) {
  const now = Date.now();
  const { data: evs, error } = await db.from('hg_events').select('id, title, location, starts_at')
    .gt('starts_at', new Date(now).toISOString()).lte('starts_at', new Date(now + 24 * H).toISOString());
  if (error) throw new Error(error.message);
  if (!evs?.length) return;
  const byEvent = new Map<string, { id: string; title: string; location: string | null; starts_at: string }>(evs.map((e: any) => [e.id, e]));

  const { data: rsvps, error: e2 } = await db.from('hg_event_rsvps')
    .select('event_id, user_id, status, remind_24h_at, remind_2h_at')
    .in('event_id', [...byEvent.keys()]).in('status', ['oui', 'peut-etre']);
  if (e2) throw new Error(e2.message);
  const todo = (rsvps ?? []).filter((r: any) => {
    const ev = byEvent.get(r.event_id);
    if (!ev) return false;
    const left = new Date(ev.starts_at).getTime() - now;
    return left <= 2 * H ? r.remind_2h_at == null : r.remind_24h_at == null;
  });
  if (!todo.length) return;

  const userIds = [...new Set(todo.map((r: any) => r.user_id as string))];
  const { data: profs, error: e3 } = await db.from('hg_profiles').select('id, pseudo, discord_id, bot_optin, remind_irl').in('id', userIds);
  if (e3) throw new Error(e3.message);
  const people = new Map<string, Prof>((profs ?? []).map((p: Prof) => [p.id, p] as [string, Prof]));
  const tpl: Templates = await loadTemplates(db);

  for (const r of todo) {
    const ev = byEvent.get(r.event_id)!;
    const person = people.get(r.user_id);
    if (!person || !person.remind_irl || !canDM(person)) continue; // opt-out : pas de rappel, pas de marquage
    const left = new Date(ev.starts_at).getTime() - now;
    const col = left <= 2 * H ? 'remind_2h_at' : 'remind_24h_at';
    const keys = { event_id: r.event_id, user_id: r.user_id };
    if (!(await claimRow('hg_event_rsvps', keys, col))) continue;
    const rendered = renderTemplate('irl_reminder', {
      titre: String(ev.title).slice(0, 200),
      delai: left <= 2 * H ? 'dans moins de 2 heures' : 'dans moins de 24 heures',
      quand: fmtZurichWhen(ev.starts_at),
      lieu: String(ev.location || 'lieu à préciser').slice(0, 200),
      lien: link('irl.html') ?? '',
    }, tpl);
    try {
      await sendDM(person.discord_id!, embed({ ...embedFrom(rendered), url: link('irl.html'), color: COLOR.irl }));
      out.irl_reminders++;
      attempts.push({ user_id: r.user_id, pseudo: person.pseudo, ok: true, status: 'sent', reason: null });
    } catch (e) {
      console.error('[hg-cron] rappel sortie', r.event_id, e);
      out.errors++;
      attempts.push({ user_id: r.user_id, pseudo: person.pseudo, ok: false, status: 'failed', reason: `rappel : ${String((e as Error).message).slice(0, 160)}` });
      await releaseRow('hg_event_rsvps', keys, col);
    }
  }
}

/* ---------- 4 : rappels d'envoi de cadeau au Secret Santa (F2) ---------- */
async function ssReminders(out: Counters, attempts: Attempt[]) {
  // Fenêtre : la date limite est dans les 3 prochains jours (aujourd'hui inclus).
  const { data: eds, error } = await db.from('hg_ss_editions').select('id, year, send_deadline')
    .not('drawn_at', 'is', null).gte('send_deadline', zurichDate()).lte('send_deadline', zurichDate(3));
  if (error) throw new Error(error.message);
  if (!eds?.length) return;
  const editions = new Map<string, { id: string; year: number; send_deadline: string }>(eds.map((e: any) => [e.id, e]));
  const ids = [...editions.keys()];

  const [{ data: parts, error: e2 }, { data: asg, error: e3 }] = await Promise.all([
    db.from('hg_ss_participants').select('edition_id, user_id').in('edition_id', ids).is('sent_at', null).is('send_reminder_at', null),
    db.from('hg_ss_assignments').select('edition_id, giver_id').in('edition_id', ids),
  ]);
  if (e2 || e3) throw new Error((e2 || e3)!.message);
  const givers = new Set((asg ?? []).map((a: any) => `${a.edition_id}:${a.giver_id}`));
  const todo = (parts ?? []).filter((p: any) => givers.has(`${p.edition_id}:${p.user_id}`));
  if (!todo.length) return;

  const { data: profs, error: e4 } = await db.from('hg_profiles').select('id, pseudo, discord_id, bot_optin').in('id', [...new Set(todo.map((p: any) => p.user_id as string))]);
  if (e4) throw new Error(e4.message);
  const people = new Map<string, Prof>((profs ?? []).map((p: Prof) => [p.id, p] as [string, Prof]));
  const tpl: Templates = await loadTemplates(db);

  for (const p of todo) {
    const person = people.get(p.user_id);
    if (!person || !canDM(person)) continue; // sans Discord ou opt-out : pas de MP, pas de marquage (un MP partira si le compte se met en règle)
    const ed = editions.get(p.edition_id)!;
    const keys = { edition_id: p.edition_id, user_id: p.user_id };
    if (!(await claimRow('hg_ss_participants', keys, 'send_reminder_at'))) continue;
    const rendered = renderTemplate('ss_send_reminder', {
      pseudo: person.pseudo, annee: ed.year, date_limite: fmtZurichDay(ed.send_deadline), lien: link('secret-santa.html') ?? '',
    }, tpl);
    try {
      await sendDM(person.discord_id, embed({ ...embedFrom(rendered), url: link('secret-santa.html'), color: COLOR.ss }));
      out.ss_reminders++;
      attempts.push({ user_id: p.user_id, pseudo: person.pseudo, ok: true, status: 'sent', reason: null });
    } catch (e) {
      console.error('[hg-cron] rappel cadeau', p.edition_id, e);
      out.errors++;
      attempts.push({ user_id: p.user_id, pseudo: person.pseudo, ok: false, status: 'failed', reason: `rappel cadeau : ${String((e as Error).message).slice(0, 160)}` });
      await releaseRow('hg_ss_participants', keys, 'send_reminder_at');
    }
  }
}

Deno.serve(async (req) => {
  if (!(await cronAuthorized(req, db))) return json({ error: 'Non autorisé' }, 401);

  const out: Counters = { starts: 0, ends: 0, marked_late: 0, pending_no_bot: 0, irl_reminders: 0, ss_reminders: 0, errors: 0 };
  const attempts: Attempt[] = [];
  try {
    const { data: s } = await db.from('hg_settings').select('value').eq('key', 'bot').maybeSingle();
    const bot = (s?.value ?? {}) as { announce_channel_id?: string; notify?: Record<string, boolean> } & MentionBot;
    const canSend = hasBotToken();

    try { await dynAnnouncements(out, bot); }
    catch (e) { console.error('[hg-cron] annonces', e); out.errors++; }
    if (canSend && bot.notify?.irl !== false) {
      try { await irlReminders(out, attempts); }
      catch (e) { console.error('[hg-cron] rappels sortie', e); out.errors++; }
    }
    if (canSend && bot.notify?.gift !== false) {
      try { await ssReminders(out, attempts); }
      catch (e) { console.error('[hg-cron] rappels cadeau', e); out.errors++; }
    }

    // Trace pour l'administrateur (historique du bot) : seulement quand il s'est passé quelque chose
    const acted = out.starts + out.ends + out.marked_late + out.irl_reminders + out.ss_reminders + out.errors;
    if (acted || attempts.length) {
      const { error: logErr } = await db.from('hg_bot_log').insert({
        kind: 'auto:cron',
        title: `Automatisations : ${out.starts} début(s), ${out.ends} fin(s), ${out.irl_reminders} rappel(s) de sortie, ${out.ss_reminders} rappel(s) de cadeau`,
        body: out.errors ? `${out.errors} échec(s) : voir les journaux de la fonction hg-cron. Les envois en échec sont retentés au prochain passage.` : 'Passage automatique.',
        recipients: attempts,
        channel: out.starts + out.ends > 0,
      });
      if (logErr) console.error('[hg-cron] journal', logErr);
    }
    return json({ ok: true, ...out });
  } catch (e) {
    console.error('[hg-cron]', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e), ...out }, 500);
  }
});
