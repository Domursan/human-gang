// ===== Humane Gang — fonction edge « hg-cron » =====
// Rôle : faire tourner les automatismes du Discord du site (annonces d'événements, rappels de sorties et de cadeaux).
// Appelée toutes les 5 minutes par pg_cron. Idempotente : chaque envoi est « réservé » en base (colonne de marquage
// passée de null à maintenant) AVANT l'envoi, puis libéré si Discord échoue.
// Sécurité : en-tête « x-cron-secret » égal au secret CRON_SECRET (sans ce secret, la fonction refuse tout : 401).
// Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis), CRON_SECRET, DISCORD_BOT_TOKEN, SITE_URL (facultatif).
//
// Tâches :
//   1. Lancement des événements dynamiques : announce = true, active = true, starts_at passé, ends_at à venir,
//      announced_start_at null → annonce « dyn_start » dans le salon (avec l'image). Salon : bot.channels.dyn, sinon le
//      salon d'annonces (voir ../_shared/channels.ts). Mention : bot.mentions.dyn.
//   2. Fin : announce = true, active = true, ends_at passé, announced_end_at null → annonce « dyn_end » avec le top 3.
//      Un événement terminé depuis plus de 24 h est seulement marqué (pas d'annonce tardive).
//   3. Rappels de sortie IRL (opt-in, profil.remind_irl) : MP aux membres « oui » ou « peut-etre » d'une sortie
//      qui a lieu dans moins de bot.rappels.irl_heures[0] h (défaut 24, marqué hg_event_rsvps.remind_24h_at) puis
//      dans moins de irl_heures[1] h (défaut 2, marqué remind_2h_at). Désactivé si bot.notify.irl === false.
//   4. Rappels d'envoi de cadeau (Secret Santa) : MP au Santa qui n'a pas marqué son envoi, dans les N jours qui
//      précèdent hg_ss_editions.send_deadline (N = bot.rappels.ss_jours_avant, défaut 3 ; marqué hg_ss_participants.send_reminder_at, une seule fois).
//      Désactivé si bot.notify.gift === false.
//   Sans bot (DISCORD_BOT_TOKEN absent ou aucun salon), les annonces ne sont pas marquées et les rappels ne partent pas :
//   ils partiront quand le bot sera prêt (sauf la fin d'un événement terminé depuis plus de 24 h, marquée sans envoi).
//   Chaque passage qui a fait quelque chose (annonce, rappel, erreur) laisse une ligne dans hg_bot_log (kind « auto:cron »).
// Dépendances : ../_shared/templates.ts, dyn-announce.ts, discord.ts, mentions.ts, channels.ts, cron-auth.ts, reglages.ts ;
//   tables hg_settings, hg_dyn_events, hg_events, hg_event_rsvps, hg_profiles, hg_ss_editions, hg_ss_participants,
//   hg_ss_assignments, hg_bot_log.
// Exporte : rien (point d'entrée Deno.serve).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { loadTemplates, renderTemplate, embedFrom, type Templates } from '../_shared/templates.ts';
import { buildDynAnnounce, type DynEvent, type DynPhase } from '../_shared/dyn-announce.ts';
import { hasBotToken, isSnowflake, jsonResponse, sendChannel, sendDM } from '../_shared/discord.ts';
import { mentionFor, type MentionBot } from '../_shared/mentions.ts';
import { channelFor, type ChannelBot } from '../_shared/channels.ts';
import { cronAuthorized } from '../_shared/cron-auth.ts';
import { botRules, type BotRules } from '../_shared/reglages.ts';

/* ---------- Constantes et clients ---------- */

// Client avec la clé service role : la fonction lit et écrit dans toutes les tables des automatismes.
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
/** Adresse du site sans « / » final ; sert à construire les liens des messages. */
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
/** Une heure en millisecondes. */
const H = 3600_000;
/** Couleurs des embeds : doré pour les sorties, rose pour le Secret Santa. */
const COLOR = { irl: 0xe2c77e, ss: 0xe0909a };
/** Réponse JSON (raccourci vers jsonResponse). */
const json = (b: unknown, s = 200) => jsonResponse(b, s);
/** Lien vers une page du site, ou undefined si SITE_URL n'est pas configurée. */
const link = (page: string) => (SITE ? `${SITE}/${page}` : undefined);
/** Ajoute le pied de page et l'horodatage au contenu d'un embed. */
const embed = (e: Record<string, unknown>) => ({ embeds: [{ footer: { text: 'Humane Gang' }, timestamp: new Date().toISOString(), ...e }] });

/** Clés d'une ligne de table (ex. { event_id, user_id }). */
type Keys = Record<string, string | number>;
/** Une tentative d'envoi, gardée pour le journal de l'admin. */
type Attempt = { user_id: string; pseudo: string; ok: boolean; status: 'sent' | 'failed'; reason: string | null };
/** Profil lu par la fonction. remind_irl est facultatif (absent pour les rappels de cadeau). */
type Prof = { id: string; pseudo: string; discord_id: string | null; bot_optin: boolean; remind_irl?: boolean };
/** Compteurs d'un passage, renvoyés dans la réponse et résumés dans le journal. */
type Counters = { starts: number; ends: number; marked_late: number; pending_no_bot: number; irl_reminders: number; ss_reminders: number; errors: number };

/* ---------- Réservation des envois (idempotence) ---------- */

/**
 * Réserve un envoi : la colonne passe de null à maintenant. Renvoie false si une autre exécution l'a déjà pris.
 * C'est la seule protection contre un double envoi si deux passages se chevauchent.
 * @param {string} table Nom de la table.
 * @param {Keys} keys Clés de la ligne à réserver.
 * @param {string} col Colonne de marquage (doit être null avant la réservation).
 * @returns {Promise<boolean>} true si la réservation est réussie, false si la ligne était déjà prise.
 * @throws {Error} Si la mise à jour échoue.
 */
async function claimRow(table: string, keys: Keys, col: string): Promise<boolean> {
  let q = db.from(table).update({ [col]: new Date().toISOString() });
  for (const [k, v] of Object.entries(keys)) q = q.eq(k, v);
  const { data, error } = await q.is(col, null).select();
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Libère une réservation (après un échec d'envoi) pour que le prochain passage réessaie.
 * @param {string} table Nom de la table.
 * @param {Keys} keys Clés de la ligne.
 * @param {string} col Colonne de marquage à remettre à null.
 * @returns {Promise<void>}
 */
async function releaseRow(table: string, keys: Keys, col: string) {
  let q = db.from(table).update({ [col]: null });
  for (const [k, v] of Object.entries(keys)) q = q.eq(k, v);
  const { error } = await q;
  if (error) console.error(`[hg-cron] libération ${table}`, error);
}

/* ---------- Dates et texte ---------- */

/**
 * Date « AAAA-MM-JJ » en heure suisse, décalée de n jours.
 * @param {number} [offsetDays] Décalage en jours (0 pour aujourd'hui).
 * @returns {string} Date au format AAAA-MM-JJ.
 */
function zurichDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 24 * H);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
/** Date et heure en français, heure suisse (ex. « lundi 3 mars à 14:00 »). */
const fmtZurichWhen = (d: string) => new Intl.DateTimeFormat('fr-CH', {
  timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
}).format(new Date(d));
/** Date seule en français, heure suisse (midi UTC pour éviter tout décalage de jour). */
const fmtZurichDay = (d: string) => new Intl.DateTimeFormat('fr-CH', {
  timeZone: 'Europe/Zurich', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(`${d}T12:00:00Z`));
/**
 * Vrai si on peut envoyer un MP à ce profil : il a accepté le bot et a un identifiant Discord valide.
 * @param {{bot_optin: boolean, discord_id: string | null} | null | undefined} p Profil.
 * @returns {boolean}
 */
const canDM = (p: { bot_optin: boolean; discord_id: string | null } | null | undefined) => !!p && p.bot_optin && isSnowflake(p.discord_id);

/* ---------- 1 et 2 : annonces des événements dynamiques ---------- */

/**
 * Annonces de lancement et de fin des événements dynamiques (tâches 1 et 2).
 * Une fin trop ancienne (plus de dyn_retard_h heures) est seulement marquée, sans envoi.
 * @param {Counters} out Compteurs du passage (modifiés).
 * @param {ChannelBot & MentionBot} bot Réglages du bot.
 * @param {BotRules} rules Règles du bot.
 * @returns {Promise<void>}
 * @throws {Error} Si la lecture des événements échoue.
 */
async function dynAnnouncements(out: Counters, bot: ChannelBot & MentionBot, rules: BotRules) {
  const LATE_MS = rules.dyn_retard_h * H;
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

  const channel = channelFor(bot, 'dyn');
  const botReady = hasBotToken() && !!channel;
  const tpl = botReady ? await loadTemplates(db) : {};

  /**
   * Traite une annonce (début ou fin) d'un événement.
   * @param {DynEvent} ev L'événement.
   * @param {DynPhase} phase 'start' ou 'end'.
   * @returns {Promise<void>}
   */
  const run = async (ev: DynEvent, phase: DynPhase) => {
    const col = phase === 'start' ? 'announced_start_at' : 'announced_end_at';
    if (phase === 'end' && Date.now() - new Date(ev.ends_at).getTime() > LATE_MS) {
      if (await claimRow('hg_dyn_events', { id: ev.id }, col)) out.marked_late++; // trop tard pour annoncer : on marque sans envoyer
      return;
    }
    if (!botReady) { out.pending_no_bot++; return; } // rien n'est marqué sans envoi effectif
    if (!(await claimRow('hg_dyn_events', { id: ev.id }, col))) return;
    try {
      await sendChannel(channel!, await buildDynAnnounce(db, ev, phase, tpl, SITE, mentionFor(bot, 'dyn'), rules.top_n));
      phase === 'start' ? out.starts++ : out.ends++;
    } catch (e) {
      // Échec : on libère la réservation pour que le prochain passage réessaie.
      console.error(`[hg-cron] annonce ${phase} ${ev.id}`, e);
      out.errors++;
      await releaseRow('hg_dyn_events', { id: ev.id }, col);
    }
  };
  for (const ev of starts) await run(ev, 'start');
  for (const ev of ends) await run(ev, 'end');
}

/* ---------- 3 : rappels de sortie IRL (F1) ---------- */

/**
 * Rappels de sortie IRL (tâche 3) : deux rappels par membre inscrit, à 24 h puis à 2 h.
 * Un membre sans opt-in ou sans Discord n'est pas marqué, pour qu'un rappel parte s'il se met en règle plus tard.
 * @param {Counters} out Compteurs du passage (modifiés).
 * @param {Attempt[]} attempts Tentatives à journaliser (modifié).
 * @param {BotRules} rules Règles du bot (délais en heures).
 * @returns {Promise<void>}
 * @throws {Error} Si une lecture échoue.
 */
async function irlReminders(out: Counters, attempts: Attempt[], rules: BotRules) {
  const now = Date.now();
  const LONG = rules.irl_long * H, SHORT = rules.irl_short * H;
  // Sorties qui commencent dans la fenêtre la plus large (le délai long).
  const { data: evs, error } = await db.from('hg_events').select('id, title, location, starts_at')
    .gt('starts_at', new Date(now).toISOString()).lte('starts_at', new Date(now + LONG).toISOString());
  if (error) throw new Error(error.message);
  if (!evs?.length) return;
  const byEvent = new Map<string, { id: string; title: string; location: string | null; starts_at: string }>(evs.map((e: any) => [e.id, e]));

  // Seules les personnes « oui » ou « peut-être » reçoivent un rappel.
  const { data: rsvps, error: e2 } = await db.from('hg_event_rsvps')
    .select('event_id, user_id, status, remind_24h_at, remind_2h_at')
    .in('event_id', [...byEvent.keys()]).in('status', ['oui', 'peut-etre']);
  if (e2) throw new Error(e2.message);
  // Pour chaque inscription : rappel court si la sortie est dans la fenêtre courte, sinon rappel long, s'il n'a pas déjà été envoyé.
  const todo = (rsvps ?? []).filter((r: any) => {
    const ev = byEvent.get(r.event_id);
    if (!ev) return false;
    const left = new Date(ev.starts_at).getTime() - now;
    return left <= SHORT ? r.remind_2h_at == null : r.remind_24h_at == null;
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
    const col = left <= SHORT ? 'remind_2h_at' : 'remind_24h_at';
    const keys = { event_id: r.event_id, user_id: r.user_id };
    if (!(await claimRow('hg_event_rsvps', keys, col))) continue;
    const rendered = renderTemplate('irl_reminder', {
      titre: String(ev.title).slice(0, 200),
      delai: left <= SHORT ? `dans moins de ${rules.irl_short} heure${rules.irl_short > 1 ? 's' : ''}` : `dans moins de ${rules.irl_long} heures`,
      quand: fmtZurichWhen(ev.starts_at),
      lieu: String(ev.location || 'lieu à préciser').slice(0, 200),
      lien: link('irl.html') ?? '',
    }, tpl);
    try {
      await sendDM(person.discord_id!, embed({ ...embedFrom(rendered), url: link('irl.html'), color: COLOR.irl }));
      out.irl_reminders++;
      attempts.push({ user_id: r.user_id, pseudo: person.pseudo, ok: true, status: 'sent', reason: null });
    } catch (e) {
      // Échec : on libère la réservation pour que le prochain passage réessaie.
      console.error('[hg-cron] rappel sortie', r.event_id, e);
      out.errors++;
      attempts.push({ user_id: r.user_id, pseudo: person.pseudo, ok: false, status: 'failed', reason: `rappel : ${String((e as Error).message).slice(0, 160)}` });
      await releaseRow('hg_event_rsvps', keys, col);
    }
  }
}

/* ---------- 4 : rappels d'envoi de cadeau au Secret Santa (F2) ---------- */

/**
 * Rappels d'envoi de cadeau (tâche 4) : MP aux Santa qui n'ont pas encore marqué leur envoi,
 * pendant les N jours avant la date limite. Un seul rappel par participant.
 * @param {Counters} out Compteurs du passage (modifiés).
 * @param {Attempt[]} attempts Tentatives à journaliser (modifié).
 * @param {BotRules} rules Règles du bot (ss_jours).
 * @returns {Promise<void>}
 * @throws {Error} Si une lecture échoue.
 */
async function ssReminders(out: Counters, attempts: Attempt[], rules: BotRules) {
  // Fenêtre : la date limite est dans les N prochains jours (aujourd'hui inclus, N = bot.rappels.ss_jours_avant).
  const { data: eds, error } = await db.from('hg_ss_editions').select('id, year, send_deadline')
    .not('drawn_at', 'is', null).gte('send_deadline', zurichDate()).lte('send_deadline', zurichDate(rules.ss_jours));
  if (error) throw new Error(error.message);
  if (!eds?.length) return;
  const editions = new Map<string, { id: string; year: number; send_deadline: string }>(eds.map((e: any) => [e.id, e]));
  const ids = [...editions.keys()];

  // Participants pas encore « envoyés » et pas encore relancés ; on ne garde que ceux qui ont un cadeau à offrir (un Santa).
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
      // Échec : on libère la réservation pour que le prochain passage réessaie.
      console.error('[hg-cron] rappel cadeau', p.edition_id, e);
      out.errors++;
      attempts.push({ user_id: p.user_id, pseudo: person.pseudo, ok: false, status: 'failed', reason: `rappel cadeau : ${String((e as Error).message).slice(0, 160)}` });
      await releaseRow('hg_ss_participants', keys, 'send_reminder_at');
    }
  }
}

/* ---------- Point d'entrée ---------- */

/**
 * Point d'entrée : lance les quatre tâches, chacune dans son propre try (une panne n'arrête pas les autres).
 * Les rappels IRL et cadeaux ne tournent que si le bot a un jeton et si l'option n'est pas désactivée.
 * @param {Request} req Requête POST de pg_cron avec l'en-tête x-cron-secret.
 * @returns {Promise<Response>} Compteurs du passage ; code 500 seulement si une erreur inattendue remonte.
 */
Deno.serve(async (req) => {
  if (!(await cronAuthorized(req, db))) return json({ error: 'Non autorisé' }, 401);

  const out: Counters = { starts: 0, ends: 0, marked_late: 0, pending_no_bot: 0, irl_reminders: 0, ss_reminders: 0, errors: 0 };
  const attempts: Attempt[] = [];
  try {
    const { data: s } = await db.from('hg_settings').select('value').eq('key', 'bot').maybeSingle();
    const bot = (s?.value ?? {}) as ChannelBot & { notify?: Record<string, boolean> } & MentionBot;
    const rules = botRules(bot as Record<string, unknown>);
    const canSend = hasBotToken();

    try { await dynAnnouncements(out, bot, rules); }
    catch (e) { console.error('[hg-cron] annonces', e); out.errors++; }
    if (canSend && bot.notify?.irl !== false) {
      try { await irlReminders(out, attempts, rules); }
      catch (e) { console.error('[hg-cron] rappels sortie', e); out.errors++; }
    }
    if (canSend && bot.notify?.gift !== false) {
      try { await ssReminders(out, attempts, rules); }
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
