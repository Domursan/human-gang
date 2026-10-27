// Tests du flux d'agenda hg-calendar (idée V8) sans Deno : fabrication du fichier .ics (RFC 5545).
// Couvre : en-têtes et fuseau Europe/Zurich, heure locale été / hiver, journées entières, pliage à 75 octets,
// échappement, liens (page du site ou https), entrées invalides ignorées, aucune donnée de lieu.
// Lancer : node tests/unitaires/check-hg-calendar.mjs
import { buildFeed, zurichLocal, foldLine, icsText } from '../../supabase/functions/hg-calendar/feed.ts';

let pass = 0, fail = 0;
const check = (c, m) => { if (c) pass++; else fail++; console.log((c ? 'OK     ' : 'ECHEC ') + m); };

const SITE = 'https://domursan.github.io/human-gang';
const items = [
  { kind: 'irl', ref: 'eeeeeeee-0000-4000-8000-000000000001', title: 'Raclette sans raclette, à Lausanne; vraiment', starts_at: '2026-11-14T11:00:00Z', all_day: false, day: '2026-11-14', link: '/pages/irl/irl.html#event-eeeeeeee-0000-4000-8000-000000000001' },
  { kind: 'groupe', ref: 'abc:2026-07-02', title: 'Campagne CK3 Serge', starts_at: '2026-07-02T18:00:00Z', all_day: false, day: '2026-07-02', link: 'https://discord.com/channels/1/2' },
  { kind: 'anniv', ref: 'u1:2026', title: 'Anniversaire de Wae', starts_at: null, all_day: true, day: '2026-12-31', link: '/pages/compte/membre.html?id=u1' },
  { kind: 'cine', ref: 's1', title: 'Ciné : ' + 'Très long titre de film avec des accents éàü '.repeat(4), starts_at: '2026-11-01T19:30:00Z', all_day: false, day: '2026-11-01', link: 'javascript:alert(1)' },
  { kind: 'site', ref: 'bad', title: '', starts_at: null, all_day: true, day: '2026-12-01', link: null },
  { kind: 'site', ref: 'bad2', title: 'Date fausse', starts_at: 'pas une date', all_day: false, day: '2026-12-01', link: null },
];
const ics = buildFeed(items, SITE, new Date('2026-10-23T10:00:00Z'));
const lines = ics.split('\r\n');
const flat = ics.replace(/\r\n /g, ''); // lignes dépliées (RFC 5545 §3.1)

check(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n') && ics.endsWith('END:VCALENDAR\r\n'), 'enveloppe VCALENDAR et fins de ligne CRLF');
check(ics.includes('BEGIN:VTIMEZONE\r\nTZID:Europe/Zurich'), 'fuseau Europe/Zurich fourni');
check(ics.includes('X-WR-CALNAME:Humane Gang') && ics.includes('REFRESH-INTERVAL;VALUE=DURATION:PT6H'), 'nom du calendrier et rafraîchissement');
check((ics.match(/BEGIN:VEVENT/g) || []).length === 4, 'quatre rendez-vous valides (titre vide et date fausse ignorés)');
check(ics.includes('DTSTART;TZID=Europe/Zurich:20261114T120000') && ics.includes('DTEND;TZID=Europe/Zurich:20261114T160000'), 'sortie : 12 h heure d’hiver, 4 h par défaut');
check(ics.includes('DTSTART;TZID=Europe/Zurich:20260702T200000'), 'rendez-vous d’été : 20 h (UTC+2)');
check(ics.includes('DTSTART;VALUE=DATE:20261231') && ics.includes('DTEND;VALUE=DATE:20270101'), 'journée entière : passage d’année');
check(ics.includes('SUMMARY:HG · Raclette sans raclette\\, à Lausanne\\; vraiment'), 'titre préfixé et échappé');
check(flat.includes(`URL:${SITE}/pages/irl/irl.html#event-eeeeeeee-0000-4000-8000-000000000001`), 'lien vers la sortie sur le site');
check(ics.includes('URL:https://discord.com/channels/1/2'), 'lien https du rendez-vous récurrent');
check(!ics.includes('javascript:'), 'lien javascript: écarté');
check(!/LOCATION|ATTENDEE/.test(ics), 'ni lieu, ni participants');
check(lines.every((l) => new TextEncoder().encode(l).length <= 75), 'aucune ligne de plus de 75 octets');
check(ics.includes('UID:irl-eeeeeeee-0000-4000-8000-000000000001@humane-gang'), 'UID stable');
check(zurichLocal(new Date('2026-03-29T01:30:00Z')) === '20260329T033000', 'changement d’heure de mars');
check(foldLine('é'.repeat(50)).split('\r\n ').every((p) => !p.includes('�')), 'pliage sans couper un caractère');
check(icsText('a\nb') === 'a\\nb', 'retour à la ligne échappé');

console.log(`\n${pass} OK, ${fail} ECHEC(S)`);
process.exitCode = fail ? 1 : 0;
