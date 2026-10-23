// ===== Humane Gang — fonction edge « hg-cron » =====
// Rôle : faire tourner les automatismes du Discord du site (annonces d'événements, rappels de sorties et de cadeaux).
// Appelée toutes les 5 minutes par pg_cron. Idempotente : chaque envoi est « réservé » en base (colonne de marquage
// passée de null à maintenant) AVANT l'envoi, puis libéré si Discord échoue.
// Sécurité : en-tête « x-cron-secret » égal au secret CRON_SECRET (sans ce secret, la fonction refuse tout : 401).
// Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis), CRON_SECRET, DISCORD_BOT_TOKEN, SITE_URL (facultatif).
//
// Tâches :
//   1. Lancement des événements dynamiques : announce = true, active = true, starts_at passé, ends_at à venir,
//      announced_start_at null → annonce « dyn_start » dans le salon (avec l'image). Salons : bot.channels.dyn (liste), sinon le
//      salon d'annonces (voir ../_shared/channels.ts) ; le même message part dans chaque salon. Mention : bot.mentions.dyn.
//      La réservation n'est libérée que si aucun salon n'a reçu l'annonce (un salon en échec alors qu'un autre l'a reçue n'est pas
//      réessayé). Le détail par salon va dans hg_bot_log.channels (migration 070 ; sans la colonne, la ligne est écrite sans lui).
//   2. Fin : announce = true, active = true, ends_at passé, announced_end_at null → annonce « dyn_end » avec le top 3.
//      Un événement terminé depuis plus de 24 h est seulement marqué (pas d'annonce tardive).
//   3. Rappels de sortie IRL (opt-in, profil.remind_irl) : MP aux membres « oui » ou « peut-etre » d'une sortie
//      qui a lieu dans moins de bot.rappels.irl_heures[0] h (défaut 24, marqué hg_event_rsvps.remind_24h_at) puis
//      dans moins de irl_heures[1] h (défaut 2, marqué remind_2h_at). Désactivé si bot.notify.irl === false.
//   4. Rappels d'envoi de cadeau (Secret Santa) : MP au Santa qui n'a pas marqué son envoi, dans les N jours qui
//      précèdent hg_ss_editions.send_deadline (N = bot.rappels.ss_jours_avant, défaut 3 ; marqué hg_ss_participants.send_reminder_at, une seule fois).
//      Désactivé si bot.notify.gift === false.
//   5. Question du jour (D2, migration 084) : une fois par jour, à l'heure planning.quiz_jour_heure_locale (défaut 9 h,
//      porte hg_cron_gate('quiz_jour', 9)), message dans les salons du type « quiz » (bot.channels.quiz, repli : salon
//      d'annonces) avec un bouton « Répondre sur le site » (jeux.html#jour) : question, catégorie, difficulté, récompense,
//      rappel de la veille (score du gang et réponse) ; le vendredi, les trois plus longues séries (3 jours au moins).
//      Jamais la bonne réponse du jour. Réservation dans hg_bot_runs ('quiz_daily', jour) AVANT l'envoi, retirée si tous
//      les salons échouent. Pas de question = rien ne part. Pause : bot.notify.quiz_daily === false (vacances).
//   6. Annonces programmées (idées A2 et A3, migration 092) : hg_bot_scheduled non annulées, non parties, send_at passé →
//      réservation (sent_at de null à maintenant), envoi dans chaque salon de la ligne qui est un salon connu du bot
//      (isKnownChannel), puis error = détail si un salon a échoué. Aucun salon atteint : réservation libérée (nouvel essai au
//      passage suivant). Plus de 6 h de retard : marquée sans envoi (error « trop tard »). Une ligne hg_bot_log
//      (kind « auto:programme ») par annonce envoyée.
//   7. Ciné-club (migration 087, ../_shared/cine-announce.ts) : hg_cine_tick puis annonces du vote, du film choisi, du report
//      et rappel une heure avant (salon bot.channels.cine, sinon salon d'annonces). Désactivé si bot.notify.cine === false.
//   8. Annonces saisonnières (migration 096, ../_shared/saisons-cron.ts) : case du jour du calendrier de l'Avent, bonus
//      collectif, soirée déballage (tout reçu, rappel 1 h avant, tour de passage si bot.notify.unwrap), anniversaire du gang.
/   Sans bot (DISCORD_BOT_TOKEN absent ou aucun salon), les annonces ne sont pas marquées et les rappels ne partent pas :
//   ils partiront quand le bot sera prêt (sauf la fin d'un événement terminé depuis plus de 24 h, marquée sans envoi).
//   Chaque passage qui a fait quelque chose (annonce, rappel, erreur) laisse une ligne dans hg_bot_log (kind « auto:cron ») ;
//   colonne channels = détail par salon des annonces [{ id, ok, error?, ref }] (ref = « début : <nom> » ou « fin : <nom> »).
// Dépendances : ../_shared/templates.ts, dyn-announce.ts, discord.ts, mentions.ts, channels.ts, cron-auth.ts, reglages.ts ;
//   tables hg_settings, hg_dyn_events, hg_events, hg_event_rsvps, hg_profiles, hg_ss_editions, hg_ss_participants,
//   hg_ss_assignments, hg_bot_log.
// Exporte : rien (point d'entrée Deno.serve).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { loadTemplates, renderTemplate, embedFrom, type Templates } from '../_shared/templates.ts';
import { buildDynAnnounce, type DynEvent, type DynPhase } from '../_shared/dyn-announce.ts';
import { hasBotToken, isSnowflake, jsonResponse, sendChannel, sendDM } from '../_shared/discord.ts';
import { mentionFor, type MentionBot } from '../_shared/mentions.ts';
import { channelLog, channelsFor, insertWithChannels, isKnownChannel, sendToChannels, type ChannelBot, type ChannelLogEntry } from '../_shared/channels.ts';
import { cronAuthorized } from '../_shared/cron-auth.ts';
import { botRules, type BotRules } from '../_shared/reglages.ts';
import { cineAnnouncements } from '../_shared/cine-announce.ts';
import { seasonAnnouncements } from '../_shared/saisons-cron.ts';
import { loadNotifPrefs, notifAllowed } from '../_shared/notif-prefs.ts';

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
type Counters = { starts: number; ends: number; marked_late: number; pending_no_bot: number; irl_reminders: number; ss_reminders: number; quiz_daily: number; scheduled: number; season: number; errors: number };
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
 * @param {ChannelLogEntry[]} chanLog Détail par salon des annonces, pour le journal (modifié).
 * @returns {Promise<void>}
 * @throws {Error} Si la lecture des événements échoue.
 */
async function dynAnnouncements(out: Counters, bot: ChannelBot & MentionBot, rules: BotRules, chanLog: ChannelLogEntry[]) {
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

  const channels = channelsFor(bot, 'dyn');
  const botReady = hasBotToken() && channels.length > 0;
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
      const message = await buildDynAnnounce(db, ev, phase, tpl, SITE, mentionFor(bot, 'dyn'), rules.top_n);
      const results = await sendToChannels(channels, (id) => sendChannel(id, message), `annonce ${phase} ${ev.id}`);
      chanLog.push(...channelLog(results, `${phase === 'start' ? 'début' : 'fin'} : ${String(ev.name || ev.id).slice(0, 80)}`));
      // Au moins un salon a reçu l'annonce : elle est faite. Sinon, erreur (ci-dessous) et réservation libérée.
      if (!results.some((r) => r.ok)) throw new Error(results.map((r) => `salon ${r.id} : ${r.error}`).join(' ; '));
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

/* ---------- 5 : annonces programmées (A2, A3) ---------- */

/** Ligne de hg_bot_scheduled lue par la tâche. */
type Scheduled = { id: string; title: string | null; body: string; channels: string[]; send_at: string; game_slug: string | null; created_by: string | null };

/**
 * Annonces programmées (tâche 5) : réservation, envoi dans les salons connus, trace dans hg_bot_log.
 * @param {Counters} out Compteurs du passage (modifiés).
 * @param {ChannelBot} bot Réglages du bot (salons connus).
 * @param {ChannelLogEntry[]} chanLog Détail par salon, pour le journal du passage (modifié).
 * @returns {Promise<void>}
 * @throws {Error} Si la lecture échoue.
 */
async function scheduledAnnouncements(out: Counters, bot: ChannelBot, chanLog: ChannelLogEntry[]) {
  const LATE_MS = 6 * H;
  const { data, error } = await db.from('hg_bot_scheduled').select('id, title, body, channels, send_at, game_slug, created_by')
    .is('sent_at', null).is('cancelled_at', null).lte('send_at', new Date().toISOString()).order('send_at').limit(20);
  if (error) {
    if (/hg_bot_scheduled/.test(error.message)) return; // migration 092 pas encore appliquée
    throw new Error(error.message);
  }
  for (const row of (data ?? []) as Scheduled[]) {
    if (Date.now() - new Date(row.send_at).getTime() > LATE_MS) {
      if (await claimRow('hg_bot_scheduled', { id: row.id }, 'sent_at')) {
        await db.from('hg_bot_scheduled').update({ error: 'Trop tard : pas envoyée (plus de 6 h de retard).' }).eq('id', row.id);
        out.marked_late++;
      }
      continue;
    }
    if (!hasBotToken()) { out.pending_no_bot++; continue; }
    const ids = (row.channels ?? []).filter((id) => isKnownChannel(bot, id));
    if (!ids.length) { out.errors++; continue; } // salon retiré des réglages : la ligne attend (et sera marquée « trop tard »)
    if (!(await claimRow('hg_bot_scheduled', { id: row.id }, 'sent_at'))) continue;
    try {
      const message = row.title ? embed({ title: row.title.slice(0, 256), description: row.body }) : { content: row.body, allowed_mentions: { parse: [] } };
      const results = await sendToChannels(ids, (id) => sendChannel(id, message), `annonce programmée ${row.id}`);
      chanLog.push(...channelLog(results, `programmée : ${String(row.title || row.body).slice(0, 80)}`));
      if (!results.some((r) => r.ok)) throw new Error(results.map((r) => `salon ${r.id} : ${r.error}`).join(' ; '));
      const failed = results.filter((r) => !r.ok);
      if (failed.length) await db.from('hg_bot_scheduled').update({ error: failed.map((r) => `salon ${r.id} : ${r.error}`).join(' ; ').slice(0, 500) }).eq('id', row.id);
      const { error: logErr } = await insertWithChannels((r) => db.from('hg_bot_log').insert(r), {
        kind: 'auto:programme', sent_by: row.created_by, title: String(row.title || (row.game_slug ? 'Annonce de session' : 'Annonce programmée')).slice(0, 120),
        body: row.body, recipients: [], channel: true,
      }, channelLog(results));
      if (logErr) console.error('[hg-cron] journal annonce programmée', logErr);
      out.scheduled++;
    } catch (e) {
      console.error(`[hg-cron] annonce programmée ${row.id}`, e);
      out.errors++;
      await releaseRow('hg_bot_scheduled', { id: row.id }, 'sent_at');
    }
  }
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
  const irlPrefs = await loadNotifPrefs(db, userIds); // catégorie « Sorties IRL » (idée Q6, migration 095)

  for (const r of todo) {
    const ev = byEvent.get(r.event_id)!;
    const person = people.get(r.user_id);
    if (!person || !person.remind_irl || !canDM(person)) continue; // opt-out : pas de rappel, pas de marquage
    if (!notifAllowed(irlPrefs.get(r.user_id), 'sorties', 'discord')) continue; // catégorie coupée : pas de rappel, pas de marquage
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
  const ssPrefs = await loadNotifPrefs(db, [...people.keys()]); // catégorie « Secret Santa » (idée Q6, migration 095)

  for (const p of todo) {
    const person = people.get(p.user_id);
    if (!person || !canDM(person)) continue; // sans Discord ou opt-out : pas de MP, pas de marquage (un MP partira si le compte se met en règle)
    if (!notifAllowed(ssPrefs.get(p.user_id), 'santa', 'discord')) continue; // catégorie coupée : pas de MP, pas de marquage
    const ed = editions.get(p.edition_id)!;
    const keys = { edition_id: p.edition_id, user_id: p.user_id };
    if (!(await claimRow('hg_ss_participants', keys, 'send_reminder_at'))) continue;
    const rendered = renderTemplate('ss_send_reminder', {
      pseudo: person.pseudo, annee: ed.year, date_limite: fmtZurichDay(ed.send_deadline), lien: link('secret-santa.html') ?? '',
    }, tpl);
    try {
      await sendDM(person.discord_id!, embed({ ...embedFrom(rendered), url: link('secret-santa.html'), color: COLOR.ss }));
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

/* ---------- 5 : question du jour (D2) ---------- */

/** Données renvoyées par hg_quiz_daily_bot (migration 084). */
type QuizBot = {
  day: string;
  question: { id: string; prompt: string; category: string | null; difficulty: string; reward: number } | null;
  bonus?: number;
  yesterday?: { answered: number; correct: number; solution: string | null } | null;
  top_streaks?: { pseudo: string; days: number }[];
};
const DIFF_FR: Record<string, string> = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile', expert: 'Expert' };

/**
 * Publie la question du jour (tâche 5) : une seule fois par jour, à l'heure du planning.
 * @param {Counters} out Compteurs du passage (modifiés).
 * @param {ChannelBot & MentionBot} bot Réglages du bot.
 * @param {ChannelLogEntry[]} chanLog Détail par salon, pour le journal (modifié).
 * @returns {Promise<void>}
 * @throws {Error} Si la lecture de la question échoue.
 */
async function quizDaily(out: Counters, bot: ChannelBot & MentionBot, chanLog: ChannelLogEntry[]) {
  const { data: gate, error: gateErr } = await db.rpc('hg_cron_gate', { p_tache: 'quiz_jour', p_heure_defaut: 9 });
  if (gateErr) throw new Error(gateErr.message);
  if (!gate) return;
  const channels = channelsFor(bot, 'quiz');
  if (!channels.length) return; // sans salon : rien n'est réservé, la publication partira quand un salon sera choisi
  const { data, error } = await db.rpc('hg_quiz_daily_bot');
  if (error) throw new Error(error.message);
  const q = data as QuizBot;
  if (!q?.question) return; // pas de question aujourd'hui : rien ne part
  // Réservation : une seule publication par jour, même si deux passages se chevauchent.
  const { data: claimed, error: e2 } = await db.from('hg_bot_runs').upsert({ task: 'quiz_daily', period: q.day }, { onConflict: 'task,period', ignoreDuplicates: true }).select();
  if (e2) throw new Error(e2.message);
  if (!claimed?.length) return;
  const tpl = await loadTemplates(db);
  const y = q.yesterday;
  const rappel = y && y.answered ? `Hier : ${y.correct} bonne${y.correct > 1 ? 's' : ''} réponse${y.correct > 1 ? 's' : ''} sur ${y.answered}${y.solution ? ` · Réponse : « ${String(y.solution).slice(0, 200)} »` : ''}` : '';
  const vendredi = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', weekday: 'short' }).format(new Date()) === 'Fri';
  const top = vendredi ? (q.top_streaks ?? []).filter((t) => t.days >= 3).slice(0, 3) : [];
  const series = top.length ? `Plus longues séries en cours : ${top.map((t) => `${t.pseudo} ${t.days} j`).join(' · ')}` : '';
  const recompense = `${q.bonus ?? 10} Paillettes pour ta série${q.question.reward ? ` (${q.question.reward} de plus si juste, si tu n'y as jamais répondu)` : ''}`;
  const lien = link('jeux.html#jour');
  const rendered = renderTemplate('quiz_daily', {
    categorie: [q.question.category, DIFF_FR[q.question.difficulty] ?? q.question.difficulty].filter(Boolean).join(' · '),
    question: String(q.question.prompt).slice(0, 500), recompense, ferme: 'demain à 6 h', rappel, series, lien: lien ?? '',
  }, tpl);
  const message = {
    ...mentionFor(bot, 'quiz'),
    embeds: [{ ...embedFrom(rendered), color: 0x9a88c4, url: lien,
      fields: [{ name: 'Récompense', value: recompense.slice(0, 1024), inline: true }, { name: 'Ferme', value: 'demain à 6 h', inline: true }],
      footer: { text: 'Humane Gang · réponds sur le site' }, timestamp: new Date().toISOString() }],
    ...(lien ? { components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Répondre sur le site', url: lien }] }] } : {}),
  };
  const results = await sendToChannels(channels, (id) => sendChannel(id, message), `question du jour ${q.day}`);
  chanLog.push(...channelLog(results, `question du jour : ${q.day}`));
  if (!results.some((r) => r.ok)) {
    // Tous les salons ont échoué : la réservation est retirée pour que le passage suivant (dans l'heure) réessaie.
    const { error: e3 } = await db.from('hg_bot_runs').delete().eq('task', 'quiz_daily').eq('period', q.day);
    if (e3) console.error('[hg-cron] libération question du jour', e3);
    throw new Error(results.map((r) => `salon ${r.id} : ${r.error}`).join(' ; '));
  }
  await db.from('hg_bot_runs').update({ message_ids: results.filter((r) => r.ok).map((r) => r.id) }).eq('task', 'quiz_daily').eq('period', q.day);
  out.quiz_daily++;
}

/* ---------- Point d'entrée ---------- */

/**
 * Point d'entrée : lance les cinq tâches, chacune dans son propre try (une panne n'arrête pas les autres).
 * Les rappels IRL et cadeaux ne tournent que si le bot a un jeton et si l'option n'est pas désactivée.
 * @param {Request} req Requête POST de pg_cron avec l'en-tête x-cron-secret.
 * @returns {Promise<Response>} Compteurs du passage ; code 500 seulement si une erreur inattendue remonte.
 */
Deno.serve(async (req) => {
  if (!(await cronAuthorized(req, db))) return json({ error: 'Non autorisé' }, 401);

  const out: Counters = { starts: 0, ends: 0, marked_late: 0, pending_no_bot: 0, irl_reminders: 0, ss_reminders: 0, quiz_daily: 0, scheduled: 0, season: 0, errors: 0 };
 const attempts: Attempt[] = [];
  const chanLog: ChannelLogEntry[] = [];
  let polls = 0; // sondages clôturés à ce passage
  try {
    const { data: s } = await db.from('hg_settings').select('value').eq('key', 'bot').maybeSingle();
    const bot = (s?.value ?? {}) as ChannelBot & { notify?: Record<string, boolean> } & MentionBot;
    const rules = botRules(bot as Record<string, unknown>);
    const canSend = hasBotToken();

    try { await dynAnnouncements(out, bot, rules, chanLog); }
    catch (e) { console.error('[hg-cron] annonces', e); out.errors++; }
    try { await scheduledAnnouncements(out, bot, chanLog); }
    catch (e) { console.error('[hg-cron] annonces programmées', e); out.errors++; }
    if (canSend && bot.notify?.irl !== false) {
      try { await irlReminders(out, attempts, rules); }
      catch (e) { console.error('[hg-cron] rappels sortie', e); out.errors++; }
    }
    if (canSend && bot.notify?.gift !== false) {
      try { await ssReminders(out, attempts, rules); }
      catch (e) { console.error('[hg-cron] rappels cadeau', e); out.errors++; }
    }
    // Sondages libres échus (migration 090) : clôture et ligne de résultat dans le fil, une seule fois (result_posted).
    try {
      const { data: n, error } = await db.rpc('hg_poll_finalize_due');
      if (error) throw error;
      polls = Number(n) || 0;
    } catch (e) { console.error('[hg-cron] sondages', e); out.errors++; }

    if (canSend && (bot as { notify?: Record<string, boolean> }).notify?.quiz_daily !== false) {
      try { await quizDaily(out, bot, chanLog); }
      catch (e) { console.error('[hg-cron] question du jour', e); out.errors++; }
    }

    // Ciné-club (idée V9, migration 087) : clôture des votes, reports, annonces et rappel ; sans effet tant que la migration manque.
    let cine = { cine_ticks: 0, cine_posts: 0, cine_errors: 0 };
    try { cine = await cineAnnouncements(db, bot, canSend, SITE); }
    catch (e) { console.error('[hg-cron] ciné-club', e); cine.cine_errors++; }

    // 8. Annonces saisonnières (migration 096) : calendrier de l'Avent, soirée déballage, anniversaire du gang.
    if (canSend) {
      try { const r = await seasonAnnouncements(db, bot, SITE); out.season += r.sent; out.errors += r.errors; chanLog.push(...r.log); }
      catch (e) { console.error('[hg-cron] saisons', e); out.errors++; }
    }

    // Trace pour l'administrateur (historique du bot) : seulement quand il s'est passé quelque chose
    const acted = out.starts + out.ends + out.marked_late + out.irl_reminders + out.ss_reminders + out.quiz_daily + out.scheduled + out.season + out.errors + cine.cine_posts;
    if (acted || attempts.length) {
      const { error: logErr } = await insertWithChannels((row) => db.from('hg_bot_log').insert(row), {
        kind: 'auto:cron',
        title: `Automatisations : ${out.starts} début(s), ${out.ends} fin(s), ${out.irl_reminders} rappel(s) de sortie, ${out.ss_reminders} rappel(s) de cadeau${out.quiz_daily ? ', question du jour publiée' : ''}${cine.cine_posts ? `, ${cine.cine_posts} annonce(s) du ciné-club` : ''}${out.season ? `, ${out.season} annonce(s) de saison` : ''}`,
        body: out.errors ? `${out.errors} échec(s) : voir les journaux de la fonction hg-cron. Les envois en échec sont retentés au prochain passage.` : 'Passage automatique.',
        recipients: attempts,
        channel: out.starts + out.ends + out.quiz_daily + out.season > 0,
     }, chanLog);
      if (logErr) console.error('[hg-cron] journal', logErr);
    }
    return json({ ok: true, ...out, ...cine, polls_closed: polls });
  } catch (e) {
    console.error('[hg-cron]', e);
    return json({ ok: false, error: 'Erreur interne (voir les journaux de hg-cron)', ...out }, 500); // détail seulement dans console.error (m16)
  }
});
