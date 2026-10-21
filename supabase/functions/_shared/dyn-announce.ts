// ===== Humane Gang — annonces Discord des événements dynamiques (partagé par hg-notify et hg-cron) =====
// Construit le message (embed) de lancement ou de fin d'un événement de hg_dyn_events, à partir des modèles
// « dyn_start » / « dyn_end » (hg_settings.bot_templates, défauts dans ./bot-templates.json).
import { renderTemplate, embedFrom, type Templates } from './templates.ts';
import type { MentionPart } from './mentions.ts';

export type DynEvent = {
  id: string; name: string; description: string | null; image_url: string | null; emoji: string | null;
  starts_at: string; ends_at: string; announce: boolean; active: boolean;
  announced_start_at: string | null; announced_end_at: string | null;
};
export type DynPhase = 'start' | 'end';
export const DYN_COLOR = 0xe2c77e;

export const fmtZurich = (d: string | null | undefined) => d
  ? new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(d))
  : '';

/** Top n des chasseurs d'un événement (service role). En cas d'égalité : le premier à avoir atteint son score. */
// deno-lint-ignore no-explicit-any
export async function dynTop(db: any, eventId: string, n = 3): Promise<{ pseudo: string; captures: number }[]> {
  const { data, error } = await db.from('hg_dyn_captures').select('user_id, captured_at').eq('event_id', eventId).order('captured_at', { ascending: true });
  if (error) throw new Error(error.message);
  const by = new Map<string, { n: number; last: number }>();
  for (const c of (data ?? []) as { user_id: string; captured_at: string }[]) {
    const cur = by.get(c.user_id) ?? { n: 0, last: 0 };
    by.set(c.user_id, { n: cur.n + 1, last: new Date(c.captured_at).getTime() });
  }
  const top = [...by.entries()].sort((a, b) => b[1].n - a[1].n || a[1].last - b[1].last).slice(0, n);
  if (!top.length) return [];
  const { data: profs } = await db.from('hg_profiles').select('id, pseudo').in('id', top.map(([id]) => id));
  const names = new Map(((profs ?? []) as { id: string; pseudo: string }[]).map((p) => [p.id, p.pseudo]));
  return top.map(([id, v]) => ({ pseudo: names.get(id) ?? 'Ancien membre', captures: v.n }));
}
export function classementText(rows: { pseudo: string; captures: number }[]) {
  if (!rows.length) return 'Personne n\'a attrapé d\'image cette fois-ci.';
  const medal = ['1.', '2.', '3.'];
  return rows.map((r, i) => `${medal[i] ?? `${i + 1}.`} ${r.pseudo} : ${r.captures} image${r.captures > 1 ? 's' : ''}`).join('\n');
}

/** Message Discord (corps de POST /channels/:id/messages) pour l'annonce d'un événement. `mention` : réglage bot.mentions.dyn. */
// deno-lint-ignore no-explicit-any
export async function buildDynAnnounce(db: any, ev: DynEvent, phase: DynPhase, tpl: Templates, site: string,
  mention: MentionPart = { allowed_mentions: { parse: [] } }, topN = 3) {
  const lien = site ? `${site}/evenements.html` : '';
  const vars: Record<string, string> = {
    nom: ev.name, description: ev.description ?? '', fin: fmtZurich(ev.ends_at), lien,
  };
  if (phase === 'end') vars.classement = classementText(await dynTop(db, ev.id, topN));
  const r = renderTemplate(phase === 'start' ? 'dyn_start' : 'dyn_end', vars, tpl);
  const title = !ev.image_url && ev.emoji && r.title ? `${ev.emoji} ${r.title}`.slice(0, 256) : r.title;
  const img = ev.image_url && /^https:\/\//.test(ev.image_url) ? ev.image_url : null;
  return {
    ...mention,
    embeds: [{
      ...embedFrom({ title, description: r.description }),
      color: DYN_COLOR,
      ...(lien ? { url: lien } : {}),
      ...(img ? (phase === 'start' ? { image: { url: img } } : { thumbnail: { url: img } }) : {}),
      footer: { text: 'Humane Gang · événements' },
      timestamp: new Date().toISOString(),
    }],
  };
}
