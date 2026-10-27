// ===== Humane Gang — flux d'agenda du gang (RFC 5545) : fabrication du texte, sans réseau ni base =====
// Rôle : transformer les rendez-vous de hg_calendar_feed (migration 087) en fichier .ics d'abonnement.
// Mêmes règles que site/assets/espaces/irl/ics.js (échappement TEXT, pliage à 75 octets, UID stables), portées en TypeScript, avec :
//   - heures locales en Europe/Zurich et TZID explicite (VTIMEZONE fournie) ;
//   - journées entières (anniversaires, dates du Secret Santa) en VALUE=DATE ;
//   - ni lieu, ni participants (le jeton donne seulement accès aux titres) ; un lien vers la page du site.
// Testé par tests/check-hg-calendar.mjs (Node 22). Dépendances : aucune.
// Exporte : FeedItem, icsText, foldLine, zurichLocal, buildFeed.

/** Un rendez-vous tel que renvoyé par hg_calendar_feed. */
export type FeedItem = { kind: string; ref: string; title: string; starts_at: string | null; all_day: boolean; day: string; link: string | null };

/** Durée par défaut d'un rendez-vous (minutes), selon le type. */
const DUREE: Record<string, number> = { irl: 240, cine: 150, groupe: 120, site: 60 };
/** Préfixe des titres dans l'agenda, pour reconnaître les rendez-vous du gang au milieu des autres. */
const PREFIX = 'HG · ';

/** Valeur TEXT (RFC 5545 §3.3.11) : antislash, point-virgule, virgule et retour à la ligne échappés. */
export function icsText(v: unknown): string {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Pliage à 75 octets (RFC 5545 §3.1) sans couper un caractère UTF-8. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = '', len = 0, max = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > max) { parts.push(cur); cur = ''; len = 0; max = 74; }
    cur += ch; len += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** Date-heure UTC au format AAAAMMJJTHHMMSSZ. */
const utc = (d: Date) => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;

/** Date-heure locale de Zurich au format AAAAMMJJTHHMMSS (à utiliser avec TZID=Europe/Zurich). */
export function zurichLocal(d: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

/** Jour AAAA-MM-JJ → AAAAMMJJ, et le lendemain (fin exclusive d'une journée entière). */
const dayVal = (day: string) => day.replace(/-/g, '');
const nextDay = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`;
};

/** Fuseau Europe/Zurich (heure d'été au dernier dimanche de mars, heure d'hiver au dernier dimanche d'octobre). */
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Zurich',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

/**
 * Fichier .ics complet du flux d'abonnement.
 * @param {FeedItem[]} items Rendez-vous (hg_calendar_feed).
 * @param {string} site Adresse du site sans « / » final (vide : pas de lien).
 * @param {Date} [now] Horodatage DTSTAMP (tests).
 * @returns {string} Texte CRLF.
 */
export function buildFeed(items: FeedItem[], site: string, now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Humane Gang//Calendrier du gang//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Humane Gang', 'X-WR-TIMEZONE:Europe/Zurich', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
    ...VTIMEZONE,
  ];
  for (const it of items) {
    if (!it || !it.title || !it.day || !/^\d{4}-\d{2}-\d{2}$/.test(it.day)) continue;
    const uid = `${String(it.kind).replace(/[^a-z]/g, '')}-${String(it.ref).replace(/[^0-9a-zA-Z:-]/g, '')}@humane-gang`;
    const link = String(it.link || '');
    // Page du site (chemin absolu /pages/<cat>/<nom>.html) ou lien https d'un rendez-vous récurrent (salon, partie…)
    const url = /^https:\/\/[^\s<>"]{1,290}$/.test(link) ? link
      : site && /^\/pages\/[a-z]+\/[a-z0-9-]+\.html([?#][\w=:#./-]*)?$/i.test(link) ? `${site}${link}` : '';
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utc(now)}`);
    if (it.all_day || !it.starts_at) {
      lines.push(`DTSTART;VALUE=DATE:${dayVal(it.day)}`, `DTEND;VALUE=DATE:${nextDay(it.day)}`, 'TRANSP:TRANSPARENT');
    } else {
      const start = new Date(it.starts_at);
      if (Number.isNaN(start.getTime())) { lines.pop(); lines.pop(); lines.pop(); continue; }
      const end = new Date(start.getTime() + (DUREE[it.kind] ?? 120) * 60_000);
      lines.push(`DTSTART;TZID=Europe/Zurich:${zurichLocal(start)}`, `DTEND;TZID=Europe/Zurich:${zurichLocal(end)}`);
    }
    lines.push(`SUMMARY:${icsText(PREFIX + it.title)}`);
    if (url) lines.push(`URL:${url}`, `DESCRIPTION:${icsText(`Détails sur le site : ${url}`)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
