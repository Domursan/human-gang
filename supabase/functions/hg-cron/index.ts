// ===== Humane Gang — fonction edge « hg-cron » =====
// Appelée toutes les 5 minutes par pg_cron. Idempotente : chaque annonce est « réservée » en base
// (announced_*_at passé de null à maintenant) AVANT l'envoi, puis libérée si Discord échoue.
// verify_jwt = false (aucune donnée n'est renvoyée, seulement des compteurs).
// Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis), DISCORD_BOT_TOKEN, SITE_URL (facultatif).
//
// Tâches :
//   1. Lancement des événements dynamiques : announce = true, active = true, starts_at passé, ends_at à venir,
//      announced_start_at null → annonce « dyn_start » dans le salon d'annonces (avec l'image).
//   2. Fin : announce = true, active = true, ends_at passé, announced_end_at null → annonce « dyn_end » avec le top 3.
//      Un événement terminé depuis plus de 24 h est seulement marqué (pas d'annonce tardive).
//   Sans bot (DISCORD_BOT_TOKEN absent ou aucun salon), rien n'est marqué : l'annonce partira quand le bot sera prêt
//   (sauf la fin d'un événement terminé depuis plus de 24 h, marquée sans envoi).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { loadTemplates } from '../_shared/templates.ts';
import { buildDynAnnounce, type DynEvent, type DynPhase } from '../_shared/dyn-announce.ts';
import { hasBotToken, isSnowflake, jsonResponse, sendChannel } from '../_shared/discord.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
const LATE_MS = 24 * 3600_000;
const json = (b: unknown, s = 200) => jsonResponse(b, s);

/** Réserve l'annonce (null → maintenant). Renvoie false si une autre exécution l'a déjà prise. */
async function claim(id: string, col: 'announced_start_at' | 'announced_end_at') {
  const { data, error } = await db.from('hg_dyn_events').update({ [col]: new Date().toISOString() }).eq('id', id).is(col, null).select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
async function release(id: string, col: 'announced_start_at' | 'announced_end_at') {
  const { error } = await db.from('hg_dyn_events').update({ [col]: null }).eq('id', id);
  if (error) console.error('[hg-cron] libération', id, error);
}

Deno.serve(async () => {
  const out = { starts: 0, ends: 0, marked_late: 0, pending_no_bot: 0, errors: 0 };
  const nowIso = new Date().toISOString();
  try {
    const [{ data: startRows, error: e1 }, { data: endRows, error: e2 }, { data: s }] = await Promise.all([
      db.from('hg_dyn_events').select('*').eq('announce', true).eq('active', true).is('announced_start_at', null)
        .lte('starts_at', nowIso).gt('ends_at', nowIso),
      db.from('hg_dyn_events').select('*').eq('announce', true).eq('active', true).is('announced_end_at', null)
        .lte('ends_at', nowIso),
      db.from('hg_settings').select('value').eq('key', 'bot').maybeSingle(),
    ]);
    if (e1 || e2) throw new Error((e1 || e2)!.message);
    const starts = (startRows ?? []) as DynEvent[];
    const ends = (endRows ?? []) as DynEvent[];
    if (!starts.length && !ends.length) return json({ ok: true, ...out });

    const channel = (s?.value as { announce_channel_id?: string } | null)?.announce_channel_id;
    const botReady = !!Deno.env.get('DISCORD_BOT_TOKEN') && isSnowflake(channel);
    const tpl = botReady ? await loadTemplates(db) : {};

    const run = async (ev: DynEvent, phase: DynPhase) => {
      const col = phase === 'start' ? 'announced_start_at' : 'announced_end_at';
      if (phase === 'end' && Date.now() - new Date(ev.ends_at).getTime() > LATE_MS) {
        if (await claim(ev.id, col)) out.marked_late++; // trop tard pour annoncer : on marque sans envoyer
        return;
      }
      if (!botReady) { out.pending_no_bot++; return; } // rien n'est marqué sans envoi effectif
      if (!(await claim(ev.id, col))) return;
      try {
        await sendChannel(channel!, await buildDynAnnounce(db, ev, phase, tpl, SITE));
        phase === 'start' ? out.starts++ : out.ends++;
      } catch (e) {
        console.error(`[hg-cron] annonce ${phase} ${ev.id}`, e);
        out.errors++;
        await release(ev.id, col);
      }
    };
    for (const ev of starts) await run(ev, 'start');
    for (const ev of ends) await run(ev, 'end');
    return json({ ok: true, ...out });
  } catch (e) {
    console.error('[hg-cron]', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e), ...out }, 500);
  }
});
