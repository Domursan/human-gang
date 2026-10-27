// ===== Humane Gang — annonces Discord du ciné-club (idée V9), appelées par hg-cron =====
// Rôle : à chaque passage (toutes les 5 minutes) :
//   1. faire avancer les séances (RPC hg_cine_tick : clôture du vote, report sous le seuil, séance passée) ;
//   2. annoncer le vote ouvert (marquage announced_at), le film choisi (result_announced_at), le report d'une semaine
//      (report_announced_at), puis rappeler la séance une heure avant (remind_at).
// Idempotent : chaque annonce est réservée (colonne null → maintenant) AVANT l'envoi, puis libérée si aucun salon ne l'a reçue.
// Salons : bot.channels.cine s'il existe, sinon le salon d'annonces (channelsFor). Mention : bot.mentions.cine (aucune par défaut).
// Désactivé si bot.notify.cine === false. Sans bot prêt, rien n'est marqué (les annonces partiront plus tard).
// Une annonce en retard de plus de 12 h est seulement marquée (pas d'annonce périmée).
// Dépendances : discord.ts (sendChannel), channels.ts (channelsFor, sendToChannels), mentions.ts (mentionFor).
// Exporte : cineAnnouncements, CineCounters.
import { sendChannel } from './discord.ts';
import { channelsFor, sendToChannels, type ChannelBot } from './channels.ts';
import { mentionFor, type MentionBot, type MentionType } from './mentions.ts';

/** Compteurs renvoyés à hg-cron. */
export type CineCounters = { cine_ticks: number; cine_posts: number; cine_errors: number };

// deno-lint-ignore no-explicit-any
type Db = any;
type Session = { id: string; starts_at: string; closes_at: string; status: string; film_id: string | null; voice_link: string | null;
  postponed: number; postponed_at: string | null; announced_at: string | null; result_announced_at: string | null; report_announced_at: string | null; remind_at: string | null };

const PLUM = 0x9a88c4;
const H = 3600_000;
/** « dimanche 1er novembre à 20 h 30 » (heure de Zurich). */
function when(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long' }).format(d).replace(/ 1 /, ' 1er ');
  const [h, m] = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).split(':');
  return `${day} à ${Number(h)} h${m === '00' ? '' : ` ${m}`}`;
}

/**
 * Passage du ciné-club : avance les états puis publie les annonces dues.
 * @param {Db} db Client Supabase (clé service).
 * @param {ChannelBot & MentionBot & {notify?: Record<string, boolean>}} bot Réglages du bot.
 * @param {boolean} canSend Jeton du bot présent.
 * @param {string} site Adresse du site (vide : pas de lien).
 * @returns {Promise<CineCounters>}
 */
export async function cineAnnouncements(db: Db, bot: ChannelBot & MentionBot & { notify?: Record<string, boolean> }, canSend: boolean, site: string): Promise<CineCounters> {
  const out: CineCounters = { cine_ticks: 0, cine_posts: 0, cine_errors: 0 };
  const { data: n, error: tickErr } = await db.rpc('hg_cine_tick');
  if (tickErr) { console.error('[cine] tick', tickErr.message); out.cine_errors++; } else out.cine_ticks = Number(n) || 0;
  if (bot.notify?.cine === false) return out;
  const channels = channelsFor(bot, 'cine' as MentionType);
  if (!canSend || !channels.length) return out;

  const { data: rows, error } = await db.from('hg_cine_sessions')
    .select('id, starts_at, closes_at, status, film_id, voice_link, postponed, postponed_at, announced_at, result_announced_at, report_announced_at, remind_at')
    .in('status', ['vote', 'fixe']).order('starts_at').limit(3);
  if (error) { console.error('[cine] séances', error.message); out.cine_errors++; return out; }
  const sessions = (rows ?? []) as Session[];
  const filmIds = new Set<string>();
  for (const s of sessions) if (s.film_id) filmIds.add(s.film_id);
  const { data: inLice } = sessions.length
    ? await db.from('hg_cine_session_films').select('session_id, film_id').in('session_id', sessions.map((s) => s.id))
    : { data: [] };
  for (const r of inLice ?? []) filmIds.add(r.film_id);
  const { data: films } = filmIds.size ? await db.from('hg_cine_films').select('id, title, year').in('id', [...filmIds]) : { data: [] };
  const title = (id: string | null) => { const f = (films ?? []).find((x: { id: string }) => x.id === id); return f ? `${f.title}${f.year ? ` (${f.year})` : ''}` : 'un film'; };
  const mention = mentionFor(bot, 'cine' as MentionType);
  const url = site ? `${site}/pages/irl/cine.html` : undefined;

  /** Réserve, envoie, libère si aucun salon n'a reçu. */
  const post = async (s: Session, col: keyof Session, embed: Record<string, unknown>, stale: boolean) => {
    const { data: got, error: e } = await db.from('hg_cine_sessions').update({ [col]: new Date().toISOString() }).eq('id', s.id).is(col, null).select('id');
    if (e || !(got ?? []).length) return;
    if (stale) return; // trop tard : marqué sans envoi
    const message = { ...mention, embeds: [{ color: PLUM, footer: { text: 'Humane Gang · Ciné-club' }, timestamp: new Date().toISOString(), ...(url ? { url } : {}), ...embed }] };
    const results = await sendToChannels(channels, (id) => sendChannel(id, message), `ciné ${String(col)} ${s.id}`);
    if (results.some((r) => r.ok)) out.cine_posts++;
    else { out.cine_errors++; await db.from('hg_cine_sessions').update({ [col]: null }).eq('id', s.id); }
  };

  const now = Date.now();
  for (const s of sessions) {
    const lice = (inLice ?? []).filter((r: { session_id: string }) => r.session_id === s.id).map((r: { film_id: string }) => title(r.film_id));
    if (s.status === 'vote' && !s.announced_at) {
      await post(s, 'announced_at', { title: 'Ciné du dimanche : à vous de voter !', description: `${lice.join(' contre ')}\nSéance ${when(s.starts_at)}. Vote ouvert jusqu’au ${when(s.closes_at)}.` },
        now - Date.parse(s.closes_at) > 0);
    }
    if (s.status === 'vote' && s.postponed > 0 && s.postponed_at && !s.report_announced_at) {
      await post(s, 'report_announced_at', { title: 'Match nul par forfait', description: `Trop peu de votants : la séance est reportée au ${when(s.starts_at)}. Le vote reste ouvert, motivez les copains !` },
        now - Date.parse(s.postponed_at) > 12 * H);
    }
    if (s.status === 'fixe' && !s.result_announced_at) {
      await post(s, 'result_announced_at', { title: `Ce sera ${title(s.film_id)} !`, description: `Séance ${when(s.starts_at)}.${s.voice_link ? ` Rendez-vous dans le salon vocal : ${s.voice_link}` : ''}` },
        now > Date.parse(s.starts_at));
    }
    if (s.status === 'fixe' && !s.remind_at && Date.parse(s.starts_at) - now <= H) {
      await post(s, 'remind_at', { title: `Ça commence dans moins d’une heure : ${title(s.film_id)}`, description: 'Pop-corn prêt ? Dis « Je serai là » sur le site si ce n’est pas fait.' },
        now > Date.parse(s.starts_at) + 30 * 60_000);
    }
  }
  return out;
}
