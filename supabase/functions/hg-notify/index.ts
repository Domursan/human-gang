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
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
const link = (page: string) => (SITE ? `${SITE}/${page}` : undefined);
const COLOR = { ss: 0xe0909a, irl: 0xe2c77e, info: 0x7e93c9, accent: 0x9e3543 };
const FRESH_MS = 15 * 60_000; // un envoi/réception doit être récent (anti-répétition)

type Bot = {
  announce_channel_id?: string | null;
  admin_discord_id?: string | null;
  notify?: Partial<Record<'draw' | 'gift' | 'irl' | 'birthday' | 'support' | 'messages', boolean>>;
};
type Profile = { id: string; pseudo: string; is_admin: boolean; discord_id: string | null; bot_optin: boolean };

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/* ---------- Discord ---------- */
function hasToken() { return !!Deno.env.get('DISCORD_BOT_TOKEN'); }
async function discord(path: string, body: unknown): Promise<any> {
  const token = Deno.env.get('DISCORD_BOT_TOKEN');
  if (!token) throw new Error('DISCORD_BOT_TOKEN absent');
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const info = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, Math.min(5000, Math.ceil((info.retry_after ?? 1) * 1000))));
      continue;
    }
    if (!res.ok) throw new Error(`Discord ${res.status} : ${await res.text()}`);
    return await res.json();
  }
  throw new Error('Discord : trop de requêtes');
}
/** Message dans un salon. Les mentions sont désactivées (pas de @everyone involontaire). */
async function sendChannel(channelId: string, message: Record<string, unknown>) {
  return await discord(`/channels/${channelId}/messages`, { allowed_mentions: { parse: [] }, ...message });
}
/** Message privé (ouvre le salon MP puis envoie). Le membre doit partager un serveur avec le bot et accepter les MP. */
async function sendDM(userId: string, message: Record<string, unknown>) {
  const ch = await discord('/users/@me/channels', { recipient_id: userId });
  return await sendChannel(ch.id, message);
}
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
async function onDraw(me: Profile, bot: Bot, p: Record<string, unknown>) {
  if (!me.is_admin) throw new HttpError(403, 'Réservé à l\'admin');
  if (!isUuid(p.edition_id)) throw new HttpError(400, 'edition_id manquant');
  if (bot.notify?.draw === false) return { skipped: 'désactivé' };
  const { data: ed } = await db.from('hg_ss_editions').select('id, year, budget, send_deadline, drawn_at').eq('id', p.edition_id).maybeSingle();
  if (!ed) throw new HttpError(404, 'Édition introuvable');
  if (!ed.drawn_at) throw new HttpError(409, 'Le tirage n\'a pas encore été fait');

  const { data: parts } = await db.from('hg_ss_participants')
    .select('user_id, hg_profiles(id, pseudo, is_admin, discord_id, bot_optin)').eq('edition_id', ed.id);
  const people = (parts ?? []).map((r: any) => r.hg_profiles as Profile).filter(Boolean);

  const fields = [
    ...(ed.budget ? [{ name: 'Budget', value: String(ed.budget), inline: true }] : []),
    ...(ed.send_deadline ? [{ name: 'Envoi avant le', value: fmtDate(ed.send_deadline)!, inline: true }] : []),
  ];
  let announced = false;
  if (bot.announce_channel_id) {
    announced = await trySend(() => sendChannel(bot.announce_channel_id!, embed({
      title: `Le tirage du Secret Santa ${ed.year} est fait !`,
      description: `${people.length} participants ont chacun reçu leur cible. Va voir ta carte sur le site.`,
      url: link('secret-santa.html'), color: COLOR.ss, fields,
    })), 'annonce tirage');
  }
  let dms = 0, failed = 0;
  for (const person of people.filter(canDM)) {
    const ok = await trySend(() => sendDM(person.discord_id!, embed({
      title: `Secret Santa ${ed.year}`,
      description: `Salut ${person.pseudo} ! Le tirage est fait, va voir ta carte pour découvrir à qui tu offres.`,
      url: link('secret-santa.html'), color: COLOR.ss, fields,
    })), `MP tirage ${person.id}`);
    ok ? dms++ : failed++;
    await new Promise((r) => setTimeout(r, 300)); // reste sous les limites de Discord
  }
  return { announced, dms_sent: dms, dms_failed: failed };
}

async function onGift(me: Profile, bot: Bot, p: Record<string, unknown>, kind: 'sent' | 'received') {
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

  const message = kind === 'sent'
    ? embed({
        title: 'Ton Santa a envoyé ton cadeau !',
        description: `Un paquet est en route pour toi (Secret Santa ${ed?.year ?? ''}). Pense à cliquer sur « J'ai reçu le mien » sur le site quand il arrive.`,
        url: link('secret-santa.html'), color: COLOR.ss,
      })
    : embed({
        title: 'Ta cible a reçu son cadeau',
        description: `Mission accomplie pour le Secret Santa ${ed?.year ?? ''} : ton cadeau est bien arrivé.`,
        url: link('secret-santa.html'), color: COLOR.ss,
      });
  return { dm: await trySend(() => sendDM(other.discord_id!, message), `MP cadeau ${kind}`) };
}

async function onIrl(me: Profile, bot: Bot, p: Record<string, unknown>) {
  if (!isUuid(p.event_id)) throw new HttpError(400, 'event_id manquant');
  if (bot.notify?.irl === false) return { skipped: 'désactivé' };
  if (!bot.announce_channel_id) return { skipped: 'aucun salon configuré' };
  const { data: ev } = await db.from('hg_events').select('id, title, description, location, starts_at, created_by, created_at')
    .eq('id', p.event_id).maybeSingle();
  if (!ev) throw new HttpError(404, 'Sortie introuvable');
  if (ev.created_by !== me.id && !me.is_admin) throw new HttpError(403, 'Seul l\'organisateur peut annoncer cette sortie');
  if (Date.now() - new Date(ev.created_at).getTime() > 60 * 60_000) return { skipped: 'sortie déjà ancienne' };

  const fields = [
    { name: 'Quand', value: fmtDate(ev.starts_at, true) ?? 'Date à choisir (sondage sur le site)', inline: true },
    { name: 'Où', value: String(ev.location || 'À préciser').slice(0, 200), inline: true },
    { name: 'Proposée par', value: me.pseudo, inline: true },
  ];
  const channel = await trySend(() => sendChannel(bot.announce_channel_id!, embed({
    title: `Nouvelle sortie : ${String(ev.title).slice(0, 200)}`,
    description: ev.description ? String(ev.description).slice(0, 600) : 'Dis si tu viens sur le site.',
    url: link('irl.html'), color: COLOR.irl, fields,
  })), 'annonce IRL');
  return { channel };
}

const MSG_FRESH_MS = 2 * 60_000;   // le message déclencheur doit avoir moins de 2 min
const MSG_QUIET_MS = 10 * 60_000;  // pas de MP si le message précédent de la conversation a moins de 10 min
async function onMessage(me: Profile, bot: Bot, p: Record<string, unknown>) {
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
  const title = anonymous ? 'Nouveau message de ton Santa' : `Nouveau message de ${me.pseudo}`;
  const raw = String(latest.body ?? '').replace(/\s+/g, ' ').trim();
  const excerpt = raw.length > 200 ? `${raw.slice(0, 199)}…` : raw;
  const url = link(`messages.html?c=${encodeURIComponent(convId)}`);

  let dms = 0, failed = 0, skipped = 0;
  for (const uid of ids.filter((id) => id !== me.id)) {
    const other = await getProfile(uid);
    if (!canDM(other)) { skipped++; continue; }
    const ok = await trySend(() => sendDM(other.discord_id!, embed({
      title, description: excerpt || '(message vide)', url,
      color: conv.kind === 'santa' ? COLOR.ss : COLOR.info,
      ...(url ? { fields: [{ name: '\u200b', value: `[Répondre sur le site](${url})` }] } : {}),
    })), `MP message ${uid}`);
    ok ? dms++ : failed++;
  }
  return { dms_sent: dms, dms_failed: failed, recipients_skipped: skipped };
}

async function onTest(me: Profile, bot: Bot) {
  if (!me.is_admin) throw new HttpError(403, 'Réservé à l\'admin');
  const out: Record<string, unknown> = {};
  if (!bot.announce_channel_id && !bot.admin_discord_id) return { error: 'Renseigne d\'abord l\'ID du salon ou ton ID Discord, puis enregistre.' };
  if (bot.announce_channel_id) {
    out.channel = await trySend(() => sendChannel(bot.announce_channel_id!, embed({
      title: 'Test du bot Humane Gang', description: 'Si tu lis ceci, les annonces fonctionnent.', color: COLOR.info, url: link('accueil.html'),
    })), 'test salon');
  }
  if (bot.admin_discord_id) {
    out.dm = await trySend(() => sendDM(bot.admin_discord_id!, embed({
      title: 'Test du bot Humane Gang', description: 'Les messages privés fonctionnent : tu recevras ici les demandes d\'assistance.', color: COLOR.info,
    })), 'test MP');
  }
  return out;
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

    if (!hasToken()) return json({ ok: true, skipped: 'bot non configuré (DISCORD_BOT_TOKEN absent)', ...(event === 'bot_test' ? { error: 'Le secret DISCORD_BOT_TOKEN n\'est pas configuré dans Supabase.' } : {}) });
    const bot = await getBot();

    let result: Record<string, unknown>;
    switch (event) {
      case 'ss_draw': result = await onDraw(me, bot, payload); break;
      case 'ss_gift_sent': result = await onGift(me, bot, payload, 'sent'); break;
      case 'ss_gift_received': result = await onGift(me, bot, payload, 'received'); break;
      case 'irl_new': result = await onIrl(me, bot, payload); break;
      case 'bot_test': result = await onTest(me, bot); break;
      case 'message_new': result = await onMessage(me, bot, payload); break;
      default: throw new HttpError(400, `Événement inconnu : ${event || '(vide)'}`);
    }
    return json({ ok: true, event, ...result });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('[hg-notify]', e);
    return json({ error: 'Erreur interne' }, 500);
  }
});
