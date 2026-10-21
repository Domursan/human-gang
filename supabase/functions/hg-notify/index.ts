// ===== Humane Gang — fonction edge « hg-notify » =====
// Construit et envoie les messages du bot Discord (MP et annonces) à partir d'événements du site.
// verify_jwt = true : seul un utilisateur connecté peut l'appeler ; on vérifie ensuite ses droits événement par événement.
// Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis), DISCORD_BOT_TOKEN, SITE_URL (facultatif).
//
// Événements :
//   ss_draw          { edition_id }  admin  → annonce + MP aux participants (opt-in)
//   ss_gift_sent     { edition_id }  Santa  → MP à sa cible « Ton Santa a envoyé ton cadeau ! » (sans le nommer)
//   ss_gift_received { edition_id }  cible  → MP à son Santa « Ta cible a reçu son cadeau »
//   irl_new          { event_id }    créateur de la sortie (ou admin) → annonce dans le salon
//   bot_test         {}              admin  → message de test (salon + MP admin)
//   message_new      { conversation_id } membre de la conversation → MP aux autres membres (opt-in), sauf discussion
//                    en cours (message précédent < 10 min). Le Santa d'une conversation santa n'est jamais nommé.
//   admin_dm         { user_ids: uuid[] (≤ 100, peut être vide si channel), title?, body (≤ 2000), channel?: bool }  admin
//                    → MP à chaque destinataire opt-in avec ID Discord ({pseudo} personnalisé), annonce facultative,
//                    trace dans hg_bot_log, détail par destinataire renvoyé.
//   dyn_announce     { event_id, phase: 'start' | 'end' }  admin → annonce d'un événement dynamique dans le salon
//                    (image de l'événement, top 3 pour la fin) ; met à jour announced_start_at / announced_end_at.
//                    Les annonces automatiques sont faites par la fonction hg-cron.
//   card_pull        { card: uuid (hg_cards.id), rarity?, shiny?, serial? } membre → annonce « belle carte » dans le salon
//                    si la carte est légendaire, mythique ou identité ET qu'un exemplaire obtenu il y a moins de 10 min
//                    appartient à l'appelant (rarity/shiny/serial du client ignorés : lus en base). Désactivable (bot.notify.card_pull).
//   card_trade       { trade_id: uuid } destinataire de l'offre (celui qui accepte) → annonce « échange conclu » dans le salon.
//                    Facultative : seulement si bot.notify.card_trade === true (désactivée par défaut).
//   card_wish        { cards: uuid[] (≤ 10) } membre, après l'ouverture d'un booster → MP aux membres qui ont la carte dans
//                    leur liste de souhaits et qui ont activé l'alerte (profil.notify_card_wish). Une fois par exemplaire
//                    (wish_notified_at). Le membre qui a obtenu la carte n'est pas nommé. Désactivable (bot.notify.card_wish).
// Textes : modèles personnalisables (hg_settings.bot_templates, défauts dans ../_shared/bot-templates.json).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { loadTemplates, renderTemplate, embedFrom, truncate, type Templates } from '../_shared/templates.ts';
import { buildDynAnnounce, type DynEvent } from '../_shared/dyn-announce.ts';
import { CORS, hasBotToken, jsonResponse, sendChannel, sendDM } from '../_shared/discord.ts';

const json = (body: unknown, status = 200) => jsonResponse(body, status);

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
const link = (page: string) => (SITE ? `${SITE}/${page}` : undefined);
const COLOR = { ss: 0xe0909a, irl: 0xe2c77e, info: 0x7e93c9, accent: 0x9e3543, card: 0xe0a93b };
const FRESH_MS = 15 * 60_000; // un envoi/réception doit être récent (anti-répétition)

type Bot = {
  announce_channel_id?: string | null;
  admin_discord_id?: string | null;
  notify?: Partial<Record<'draw' | 'gift' | 'irl' | 'birthday' | 'support' | 'messages' | 'card_pull' | 'card_trade' | 'card_wish', boolean>>;
};
type Profile = { id: string; pseudo: string; is_admin: boolean; discord_id: string | null; bot_optin: boolean };

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/* ---------- Discord : client partagé (_shared/discord.ts : 429, MP, salon) ---------- */
const hasToken = hasBotToken;
async function trySend(fn: () => Promise<unknown>, label: string): Promise<boolean> {
  try { await fn(); return true; } catch (e) { console.error(`[hg-notify] ${label}`, e); return false; }
}
const embed = (e: Record<string, unknown>) => ({ embeds: [{ footer: { text: 'Humane Gang' }, timestamp: new Date().toISOString(), ...e }] });
const canDM = (p: Profile | null | undefined): p is Profile => !!p && p.bot_optin && !!p.discord_id && /^\d{17,20}$/.test(p.discord_id);

/* ---------- Données ---------- */
async function getBot(): Promise<Bot> {
  const { data } = await db.from('hg_settings').select('value').eq('key', 'bot').maybeSingle();
  return (data?.value ?? {}) as Bot;
}
async function getProfile(id: string): Promise<Profile | null> {
  const { data } = await db.from('hg_profiles').select('id, pseudo, is_admin, discord_id, bot_optin').eq('id', id).maybeSingle();
  return data as Profile | null;
}
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
const fmtDate = (d: string | null | undefined, withTime = false) => d
  ? new Intl.DateTimeFormat('fr-CH', {
      timeZone: 'Europe/Zurich', weekday: withTime ? 'long' : undefined, day: 'numeric', month: 'long', year: withTime ? undefined : 'numeric',
      hour: withTime ? '2-digit' : undefined, minute: withTime ? '2-digit' : undefined,
    }).format(new Date(d))
  : null;
const recent = (ts: string | null | undefined) => !!ts && Date.now() - new Date(ts).getTime() < FRESH_MS;

/* ---------- Événements ---------- */
async function onDraw(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!me.is_admin) throw new HttpError(403, 'Réservé à l\'admin');
  if (!isUuid(p.edition_id)) throw new HttpError(400, 'edition_id manquant');
  if (bot.notify?.draw === false) return { skipped: 'désactivé' };
  const { data: ed } = await db.from('hg_ss_editions').select('id, year, budget, send_deadline, exchange_date, drawn_at').eq('id', p.edition_id).maybeSingle();
  if (!ed) throw new HttpError(404, 'Édition introuvable');
  if (!ed.drawn_at) throw new HttpError(409, 'Le tirage n\'a pas encore été fait');

  const { data: parts } = await db.from('hg_ss_participants')
    .select('user_id, hg_profiles(id, pseudo, is_admin, discord_id, bot_optin)').eq('edition_id', ed.id);
  const people = (parts ?? []).map((r: any) => r.hg_profiles as Profile).filter(Boolean);

  const fields = [
    ...(ed.budget ? [{ name: 'Budget', value: String(ed.budget), inline: true }] : []),
    ...(ed.send_deadline ? [{ name: 'Envoi avant le', value: fmtDate(ed.send_deadline)!, inline: true }] : []),
  ];
  const vars = {
    annee: ed.year, participants: people.length, budget: ed.budget ?? '', date_limite: fmtDate(ed.send_deadline) ?? '',
    date_echange: fmtDate(ed.exchange_date) ?? '', lien: link('secret-santa.html') ?? '',
  };
  let announced = false;
  if (bot.announce_channel_id) {
    announced = await trySend(() => sendChannel(bot.announce_channel_id!, embed({
      ...embedFrom(renderTemplate('ss_draw_announce', vars, tpl)),
      url: link('secret-santa.html'), color: COLOR.ss, fields,
    })), 'annonce tirage');
  }
  let dms = 0, failed = 0;
  for (const person of people.filter(canDM)) {
    const ok = await trySend(() => sendDM(person.discord_id!, embed({
      ...embedFrom(renderTemplate('ss_draw_dm', { ...vars, pseudo: person.pseudo }, tpl)),
      url: link('secret-santa.html'), color: COLOR.ss, fields,
    })), `MP tirage ${person.id}`);
    ok ? dms++ : failed++;
    await new Promise((r) => setTimeout(r, 300)); // reste sous les limites de Discord
  }
  return { announced, dms_sent: dms, dms_failed: failed };
}

async function onGift(me: Profile, bot: Bot, p: Record<string, unknown>, kind: 'sent' | 'received', tpl: Templates) {
  if (!isUuid(p.edition_id)) throw new HttpError(400, 'edition_id manquant');
  if (bot.notify?.gift === false) return { skipped: 'désactivé' };
  const { data: part } = await db.from('hg_ss_participants').select('sent_at, received_at')
    .eq('edition_id', p.edition_id).eq('user_id', me.id).maybeSingle();
  if (!part) throw new HttpError(403, 'Tu ne participes pas à cette édition');
  const ts = kind === 'sent' ? part.sent_at : part.received_at;
  if (!ts) throw new HttpError(409, kind === 'sent' ? 'Envoi non enregistré' : 'Réception non enregistrée');
  if (!recent(ts)) return { skipped: 'déjà notifié' };

  // Service role : on lit l'attribution côté serveur, sans jamais la renvoyer au client.
  const col = kind === 'sent' ? 'giver_id' : 'receiver_id';
  const { data: a } = await db.from('hg_ss_assignments').select('giver_id, receiver_id')
    .eq('edition_id', p.edition_id).eq(col, me.id).maybeSingle();
  if (!a) return { skipped: 'pas d\'attribution' };
  const { data: ed } = await db.from('hg_ss_editions').select('year, exchange_date').eq('id', p.edition_id).maybeSingle();
  const other = await getProfile(kind === 'sent' ? a.receiver_id : a.giver_id);
  if (!canDM(other)) return { dm: false, reason: 'destinataire sans Discord ou opt-out' };

  // ss_gift_sent part chez la cible : aucune variable ne désigne le Santa. ss_gift_received part chez le Santa : {cible} = me.
  const base = { pseudo: other.pseudo, annee: ed?.year ?? '', date_echange: fmtDate(ed?.exchange_date) ?? '', lien: link('secret-santa.html') ?? '' };
  const rendered = kind === 'sent'
    ? renderTemplate('ss_gift_sent', base, tpl)
    : renderTemplate('ss_gift_received', { ...base, cible: me.pseudo }, tpl);
  const message = embed({ ...embedFrom(rendered), url: link('secret-santa.html'), color: COLOR.ss });
  return { dm: await trySend(() => sendDM(other.discord_id!, message), `MP cadeau ${kind}`) };
}

async function onIrl(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!isUuid(p.event_id)) throw new HttpError(400, 'event_id manquant');
  if (bot.notify?.irl === false) return { skipped: 'désactivé' };
  if (!bot.announce_channel_id) return { skipped: 'aucun salon configuré' };
  const { data: ev } = await db.from('hg_events').select('id, title, description, location, starts_at, created_by, created_at')
    .eq('id', p.event_id).maybeSingle();
  if (!ev) throw new HttpError(404, 'Sortie introuvable');
  if (ev.created_by !== me.id && !me.is_admin) throw new HttpError(403, 'Seul l\'organisateur peut annoncer cette sortie');
  if (Date.now() - new Date(ev.created_at).getTime() > 60 * 60_000) return { skipped: 'sortie déjà ancienne' };

  const when = fmtDate(ev.starts_at, true) ?? 'Date à choisir (sondage sur le site)';
  const where = String(ev.location || 'À préciser').slice(0, 200);
  const fields = [
    { name: 'Quand', value: when, inline: true },
    { name: 'Où', value: where, inline: true },
    { name: 'Proposée par', value: me.pseudo, inline: true },
  ];
  const rendered = renderTemplate('irl_new', {
    titre: String(ev.title).slice(0, 200),
    description: ev.description ? String(ev.description).slice(0, 600) : 'Dis si tu viens sur le site.',
    lieu: where, date: when, organisateur: me.pseudo, lien: link('irl.html') ?? '',
  }, tpl);
  const channel = await trySend(() => sendChannel(bot.announce_channel_id!, embed({
    ...embedFrom(rendered), url: link('irl.html'), color: COLOR.irl, fields,
  })), 'annonce IRL');
  return { channel };
}

const MSG_FRESH_MS = 2 * 60_000;   // le message déclencheur doit avoir moins de 2 min
const MSG_QUIET_MS = 10 * 60_000;  // pas de MP si le message précédent de la conversation a moins de 10 min
async function onMessage(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!isUuid(p.conversation_id)) throw new HttpError(400, 'conversation_id manquant');
  if (bot.notify?.messages === false) return { skipped: 'désactivé' };
  const convId = p.conversation_id;
  const { data: conv } = await db.from('hg_conversations').select('id, kind, santa_id, target_id').eq('id', convId).maybeSingle();
  if (!conv) throw new HttpError(404, 'Conversation introuvable');
  const { data: members } = await db.from('hg_conversation_members').select('user_id').eq('conversation_id', convId);
  const ids: string[] = (members ?? []).map((m: { user_id: string }) => m.user_id);
  if (!ids.includes(me.id)) throw new HttpError(403, 'Tu ne fais pas partie de cette conversation');

  // Deux derniers messages : le dernier doit être le mien et récent ; le précédent doit être assez ancien.
  const { data: last } = await db.from('hg_messages').select('id, sender_id, body, created_at')
    .eq('conversation_id', convId).order('id', { ascending: false }).limit(2);
  const [latest, previous] = last ?? [];
  if (!latest || latest.sender_id !== me.id) return { skipped: 'pas de message récent de ta part' };
  const latestAt = new Date(latest.created_at).getTime();
  if (Date.now() - latestAt > MSG_FRESH_MS) return { skipped: 'message trop ancien' };
  if (previous && latestAt - new Date(previous.created_at).getTime() < MSG_QUIET_MS) return { skipped: 'discussion en cours' };

  const anonymous = conv.kind === 'santa' && conv.santa_id === me.id; // ne JAMAIS révéler le Santa
  const raw = String(latest.body ?? '').replace(/\s+/g, ' ').trim();
  const excerpt = raw.length > 200 ? `${raw.slice(0, 199)}…` : raw;
  const url = link(`messages.html?c=${encodeURIComponent(convId)}`);

  let dms = 0, failed = 0, skipped = 0;
  for (const uid of ids.filter((id) => id !== me.id)) {
    const other = await getProfile(uid);
    if (!canDM(other)) { skipped++; continue; }
    // message_new_santa : l'expéditeur (le Santa) n'est JAMAIS passé dans les variables.
    const rendered = anonymous
      ? renderTemplate('message_new_santa', { pseudo: other.pseudo, extrait: excerpt || '(message vide)', lien: url ?? '' }, tpl)
      : renderTemplate('message_new', { pseudo: other.pseudo, expediteur: me.pseudo, extrait: excerpt || '(message vide)', lien: url ?? '' }, tpl);
    const ok = await trySend(() => sendDM(other.discord_id!, embed({
      ...embedFrom(rendered), url,
      color: conv.kind === 'santa' ? COLOR.ss : COLOR.info,
      ...(url ? { fields: [{ name: '\u200b', value: `[Répondre sur le site](${url})` }] } : {}),
    })), `MP message ${uid}`);
    ok ? dms++ : failed++;
  }
  return { dms_sent: dms, dms_failed: failed, recipients_skipped: skipped };
}

async function onTest(me: Profile, bot: Bot, tpl: Templates) {
  if (!me.is_admin) throw new HttpError(403, 'Réservé à l\'admin');
  const out: Record<string, unknown> = {};
  if (!bot.announce_channel_id && !bot.admin_discord_id) return { error: 'Renseigne d\'abord l\'ID du salon ou ton ID Discord, puis enregistre.' };
  if (bot.announce_channel_id) {
    out.channel = await trySend(() => sendChannel(bot.announce_channel_id!, embed({
      ...embedFrom(renderTemplate('bot_test', { canal: 'les annonces', pseudo: me.pseudo, lien: link('accueil.html') ?? '' }, tpl)),
      color: COLOR.info, url: link('accueil.html'),
    })), 'test salon');
  }
  if (bot.admin_discord_id) {
    out.dm = await trySend(() => sendDM(bot.admin_discord_id!, embed({
      ...embedFrom(renderTemplate('bot_test', { canal: 'les messages privés', pseudo: me.pseudo, lien: link('accueil.html') ?? '' }, tpl)),
      color: COLOR.info,
    })), 'test MP');
  }
  return out;
}

/* ---------- Message manuel de l'admin ---------- */
const ADMIN_DM_MAX_USERS = 100;
const ADMIN_DM_MAX_BODY = 2000;
type Recipient = { user_id: string; pseudo: string | null; ok: boolean; status: 'sent' | 'failed' | 'skipped'; reason: string | null };
const friendlyDiscordError = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  if (/Discord 403/.test(m) || /50007/.test(m)) return 'MP refusés par Discord (serveur non partagé ou MP fermés)';
  if (/Discord 400/.test(m) && /recipient/i.test(m)) return 'ID Discord invalide';
  if (/Discord 404/.test(m)) return 'Utilisateur Discord introuvable';
  if (/trop de requêtes/.test(m)) return 'Discord : trop de requêtes';
  return truncate(m, 160);
};
/** {pseudo} est la seule variable d'un message manuel ; le reste du texte est laissé tel quel. */
const withPseudo = (text: string, pseudo: string) => text.replace(/\{pseudo\}/g, pseudo);

async function onAdminDm(me: Profile, bot: Bot, p: Record<string, unknown>) {
  if (!me.is_admin) throw new HttpError(403, 'Réservé à l\'admin');
  const raw: unknown[] = Array.isArray(p.user_ids) ? p.user_ids : [];
  const ids = [...new Set(raw.filter(isUuid).map((s) => s.toLowerCase()))];
  if (ids.length !== raw.length && !ids.length) throw new HttpError(400, 'Destinataires invalides');
  if (!ids.length && p.channel !== true) throw new HttpError(400, 'Choisis au moins un destinataire (ou publie dans le salon)');
  if (raw.length > ADMIN_DM_MAX_USERS * 2 || ids.length > ADMIN_DM_MAX_USERS) throw new HttpError(400, `${ADMIN_DM_MAX_USERS} destinataires maximum par envoi`);
  const title = typeof p.title === 'string' ? p.title.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const body = typeof p.body === 'string' ? p.body.replace(/\u0000/g, '').trim() : '';
  if (!body) throw new HttpError(400, 'Le message est vide');
  if (body.length > ADMIN_DM_MAX_BODY) throw new HttpError(400, `Message trop long (${ADMIN_DM_MAX_BODY} caractères maximum)`);
  const wantChannel = p.channel === true;
  if (wantChannel && !bot.announce_channel_id) throw new HttpError(400, 'Aucun salon d\'annonces n\'est configuré');

  const { data: rows, error } = ids.length
    ? await db.from('hg_profiles').select('id, pseudo, is_admin, discord_id, bot_optin').in('id', ids)
    : { data: [], error: null };
  if (error) throw new Error(error.message);
  const byId = new Map<string, Profile>((rows ?? []).map((r: Profile) => [r.id, r]));

  const build = (pseudo: string) => {
    const t = truncate(withPseudo(title, pseudo).trim(), 256);
    const d = truncate(withPseudo(body, pseudo).trim(), 4096);
    return embed({ ...(t ? { title: t } : {}), description: d || '\u200b', color: COLOR.accent });
  };

  const recipients: Recipient[] = [];
  let first = true;
  for (const id of ids) {
    const prof = byId.get(id);
    if (!prof) { recipients.push({ user_id: id, pseudo: null, ok: false, status: 'skipped', reason: 'Compte sans profil' }); continue; }
    if (!prof.discord_id || !/^\d{17,20}$/.test(prof.discord_id)) {
      recipients.push({ user_id: id, pseudo: prof.pseudo, ok: false, status: 'skipped', reason: 'Pas d\'ID Discord' }); continue;
    }
    if (!prof.bot_optin) { recipients.push({ user_id: id, pseudo: prof.pseudo, ok: false, status: 'skipped', reason: 'A refusé les MP du bot' }); continue; }
    if (!first) await new Promise((r) => setTimeout(r, 300)); // reste sous les limites de Discord
    first = false;
    try {
      await sendDM(prof.discord_id, build(prof.pseudo));
      recipients.push({ user_id: id, pseudo: prof.pseudo, ok: true, status: 'sent', reason: null });
    } catch (e) {
      console.error(`[hg-notify] MP manuel ${id}`, e);
      recipients.push({ user_id: id, pseudo: prof.pseudo, ok: false, status: 'failed', reason: friendlyDiscordError(e) });
    }
  }

  let channelOk: boolean | null = null;
  let channelError: string | null = null;
  if (wantChannel) {
    try { await sendChannel(bot.announce_channel_id!, build('tout le monde')); channelOk = true; }
    catch (e) { console.error('[hg-notify] annonce manuelle', e); channelOk = false; channelError = friendlyDiscordError(e); }
  }

  const { data: log, error: logErr } = await db.from('hg_bot_log').insert({
    sent_by: me.id, kind: 'manual', title: title || null, body, recipients, channel: channelOk === true,
  }).select('id').maybeSingle();
  if (logErr) console.error('[hg-notify] hg_bot_log', logErr);

  const count = (s: Recipient['status']) => recipients.filter((r) => r.status === s).length;
  return {
    recipients, sent: count('sent'), failed: count('failed'), skipped: count('skipped'),
    channel: channelOk, channel_error: channelError, log_id: log?.id ?? null,
  };
}

/* ---------- Événements dynamiques : annonce manuelle (admin) ---------- */
async function onDynAnnounce(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!me.is_admin) throw new HttpError(403, 'Réservé à l\'admin');
  if (!isUuid(p.event_id)) throw new HttpError(400, 'event_id manquant');
  const phase = p.phase === 'start' || p.phase === 'end' ? p.phase : null;
  if (!phase) throw new HttpError(400, 'phase attendue : start ou end');
  const { data: ev } = await db.from('hg_dyn_events').select('*').eq('id', p.event_id).maybeSingle();
  if (!ev) throw new HttpError(404, 'Événement introuvable');
  if (!bot.announce_channel_id) return { sent: false, skipped: 'aucun salon d\'annonces configuré (section Bot Discord)' };
  const message = await buildDynAnnounce(db, ev as DynEvent, phase, tpl, SITE);
  try {
    await sendChannel(bot.announce_channel_id, message);
  } catch (e) {
    console.error('[hg-notify] annonce événement', e);
    return { sent: false, error: friendlyDiscordError(e) };
  }
  const col = phase === 'start' ? 'announced_start_at' : 'announced_end_at';
  const { error } = await db.from('hg_dyn_events').update({ [col]: new Date().toISOString() }).eq('id', ev.id);
  if (error) console.error('[hg-notify] announced_*_at', error);
  return { sent: true, phase };
}

/* ---------- Cartes à collectionner ---------- */
const CARD_RARITY_LABEL: Record<string, string> = { legendaire: 'Légendaire', mythique: 'Mythique', identite: 'Identité' };
const CARD_FRESH_MS = 10 * 60_000; // l'exemplaire doit venir d'être obtenu (anti-spam)

async function onCardPull(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!isUuid(p.card)) throw new HttpError(400, 'card manquant');
  if (bot.notify?.card_pull === false) return { skipped: 'désactivé' };
  if (!bot.announce_channel_id) return { skipped: 'aucun salon configuré' };
  const { data: card } = await db.from('hg_cards').select('id, name, rarity, max_copies').eq('id', p.card).maybeSingle();
  if (!card) throw new HttpError(404, 'Carte introuvable');
  const rarete = CARD_RARITY_LABEL[card.rarity];
  if (!rarete) return { skipped: 'carte pas assez rare pour être annoncée' };

  // Service role : un exemplaire récent de cette carte doit appartenir à l'appelant. Valeurs lues en base.
  // Un exemplaire déjà annoncé (announced_at) n'est jamais annoncé deux fois : rappeler card_pull ne republie rien.
  let q = db.from('hg_card_copies').select('id, shiny, serial, obtained_at')
    .eq('card_id', card.id).eq('owner_id', me.id).is('recycled_at', null).is('announced_at', null)
    .gte('obtained_at', new Date(Date.now() - CARD_FRESH_MS).toISOString())
    .order('obtained_at', { ascending: false }).limit(1);
  if (Number.isInteger(p.serial)) q = q.eq('serial', p.serial as number);
  const { data: copy } = await q.maybeSingle();
  if (!copy) return { skipped: 'aucun exemplaire récent de cette carte' };
  const { data: claimed } = await db.from('hg_card_copies').update({ announced_at: new Date().toISOString() })
    .eq('id', copy.id).is('announced_at', null).select('id');
  if (!claimed?.length) return { skipped: 'déjà annoncé' };

  const carte = `${card.name}${copy.shiny ? ' (brillante)' : ''}${copy.serial ? ` N° ${copy.serial}${card.max_copies ? `/${card.max_copies}` : ''}` : ''}`;
  const rendered = renderTemplate('card_pull_announce', { pseudo: me.pseudo, carte, rarete, lien: link('cartes.html') ?? '' }, tpl);
  const channel = await trySend(() => sendChannel(bot.announce_channel_id!, embed({
    ...embedFrom(rendered), url: link('cartes.html'), color: COLOR.card,
    fields: [{ name: 'Rareté', value: rarete, inline: true }],
  })), 'annonce carte');
  if (!channel) await db.from('hg_card_copies').update({ announced_at: null }).eq('id', copy.id); // échec : la prochaine ouverture pourra réessayer
  return { channel };
}

async function onCardTrade(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!isUuid(p.trade_id)) throw new HttpError(400, 'trade_id manquant');
  if (bot.notify?.card_trade !== true) return { skipped: 'désactivé' };
  if (!bot.announce_channel_id) return { skipped: 'aucun salon configuré' };
  const { data: t } = await db.from('hg_card_trades').select('id, from_user, to_user, status, resolved_at').eq('id', p.trade_id).maybeSingle();
  if (!t) throw new HttpError(404, 'Échange introuvable');
  // Seul le destinataire (celui qui accepte l'offre) annonce : une seule annonce par échange.
  if (t.to_user !== me.id) throw new HttpError(403, 'Seul le destinataire de l\'offre peut annoncer l\'échange');
  if (t.status !== 'acceptee') return { skipped: 'échange non conclu' };
  if (!recent(t.resolved_at)) return { skipped: 'échange déjà ancien' };
  const other = await getProfile(t.from_user);
  const rendered = renderTemplate('card_trade_announce', { pseudo: me.pseudo, partenaire: other?.pseudo ?? '', lien: link('cartes.html') ?? '' }, tpl);
  const channel = await trySend(() => sendChannel(bot.announce_channel_id!, embed({
    ...embedFrom(rendered), url: link('cartes.html'), color: COLOR.card,
  })), 'annonce échange');
  return { channel };
}

/* F12 : un membre obtient une carte que d'autres souhaitent → MP aux souhaitants qui ont activé l'alerte */
const WISH_MAX_CARDS = 10; // cartes distinctes par appel (une ouverture de booster)
const WISH_MAX_DMS = 50;   // MP maximum par appel
async function onCardWish(me: Profile, bot: Bot, p: Record<string, unknown>, tpl: Templates) {
  if (!Array.isArray(p.cards)) throw new HttpError(400, 'cards manquant');
  const ids = [...new Set((p.cards as unknown[]).filter(isUuid).map((s) => s.toLowerCase()))].slice(0, WISH_MAX_CARDS);
  if (!ids.length) throw new HttpError(400, 'cards manquant');
  if (bot.notify?.card_wish === false) return { skipped: 'désactivé' };

  // Exemplaires de l'appelant obtenus il y a peu, pas encore signalés (lus en base). Réservés avant l'envoi.
  const { data: fresh, error } = await db.from('hg_card_copies').select('id, card_id, shiny')
    .in('card_id', ids).eq('owner_id', me.id).is('recycled_at', null).is('wish_notified_at', null)
    .gte('obtained_at', new Date(Date.now() - CARD_FRESH_MS).toISOString());
  if (error) throw new Error(error.message);
  if (!fresh?.length) return { skipped: 'aucun exemplaire récent' };
  const { data: claimed, error: e2 } = await db.from('hg_card_copies').update({ wish_notified_at: new Date().toISOString() })
    .in('id', fresh.map((c: { id: number }) => c.id)).is('wish_notified_at', null).select('id, card_id, shiny');
  if (e2) throw new Error(e2.message);
  if (!claimed?.length) return { skipped: 'déjà signalé' };

  // Une alerte par carte distincte (le premier exemplaire réservé donne le nom et la mention « brillante »)
  const byCard = new Map<string, { shiny: boolean }>();
  for (const c of claimed as { card_id: string; shiny: boolean }[]) {
    if (!byCard.has(c.card_id)) byCard.set(c.card_id, { shiny: c.shiny });
  }
  const { data: cards } = await db.from('hg_cards').select('id, name').in('id', [...byCard.keys()]);
  const names = new Map((cards ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));

  let sent = 0, failed = 0, skipped = 0;
  for (const [cardId, info] of byCard) {
    const { data: wishes } = await db.from('hg_card_wishlist').select('user_id').eq('card_id', cardId).neq('user_id', me.id);
    const wishers = (wishes ?? []).map((w: { user_id: string }) => w.user_id);
    if (!wishers.length) continue;
    const { data: profs } = await db.from('hg_profiles').select('id, pseudo, discord_id, bot_optin, notify_card_wish').in('id', wishers);
    for (const prof of (profs ?? []) as { id: string; discord_id: string | null; bot_optin: boolean; notify_card_wish: boolean }[]) {
      const reachable = prof.notify_card_wish && prof.bot_optin && /^\d{17,20}$/.test(prof.discord_id ?? '');
      if (!reachable) { skipped++; continue; }
      if (sent + failed >= WISH_MAX_DMS) { skipped++; continue; }
      const carte = `${names.get(cardId) ?? 'Une carte'}${info.shiny ? ' (brillante)' : ''}`;
      const rendered = renderTemplate('card_wish_dm', { carte, lien: link('cartes.html') ?? '' }, tpl);
      const ok = await trySend(() => sendDM(prof.discord_id!, embed({
        ...embedFrom(rendered), url: link('cartes.html'), color: COLOR.card,
      })), `MP souhait ${prof.id}`);
      ok ? sent++ : failed++;
      await new Promise((r) => setTimeout(r, 300)); // reste sous les limites de Discord
    }
  }
  return { dms_sent: sent, dms_failed: failed, skipped };
}

/* ---------- Point d'entrée ---------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await db.auth.getUser(token);
    if (!auth?.user) throw new HttpError(401, 'Connexion requise');
    const me = await getProfile(auth.user.id);
    if (!me) throw new HttpError(403, 'Réservé aux membres');

    let payload: Record<string, unknown>;
    try { payload = await req.json(); } catch { throw new HttpError(400, 'Requête invalide'); }
    const event = String(payload.event ?? '');

    if (!hasToken()) {
      if (event === 'admin_dm') throw new HttpError(503, 'Le secret DISCORD_BOT_TOKEN n\'est pas configuré dans Supabase.');
      return json({ ok: true, skipped: 'bot non configuré (DISCORD_BOT_TOKEN absent)', ...(event === 'bot_test' ? { error: 'Le secret DISCORD_BOT_TOKEN n\'est pas configuré dans Supabase.' } : {}) });
    }
    const [bot, tpl] = await Promise.all([getBot(), event === 'admin_dm' ? Promise.resolve({}) : loadTemplates(db)]);

    let result: Record<string, unknown>;
    switch (event) {
      case 'ss_draw': result = await onDraw(me, bot, payload, tpl); break;
      case 'ss_gift_sent': result = await onGift(me, bot, payload, 'sent', tpl); break;
      case 'ss_gift_received': result = await onGift(me, bot, payload, 'received', tpl); break;
      case 'irl_new': result = await onIrl(me, bot, payload, tpl); break;
      case 'bot_test': result = await onTest(me, bot, tpl); break;
      case 'message_new': result = await onMessage(me, bot, payload, tpl); break;
      case 'admin_dm': result = await onAdminDm(me, bot, payload); break;
      case 'dyn_announce': result = await onDynAnnounce(me, bot, payload, tpl); break;
      case 'card_pull': result = await onCardPull(me, bot, payload, tpl); break;
      case 'card_trade': result = await onCardTrade(me, bot, payload, tpl); break;
      case 'card_wish': result = await onCardWish(me, bot, payload, tpl); break;
      default: throw new HttpError(400, `Événement inconnu : ${event || '(vide)'}`);
    }
    return json({ ok: true, event, ...result });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('[hg-notify]', e);
    return json({ error: 'Erreur interne' }, 500);
  }
});
