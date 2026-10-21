// ===== Humane Gang : petits utilitaires partagés =====
// Sans dépendance (ni core.js ni Supabase) : utilisable aussi par les pages légères (intro).
// Remplace les copies locales de plural, fmtDay, safeUrl, pad et rnd.

/** Mot accordé : singulier pour 0 et 1, pluriel au-delà. Ne renvoie pas le nombre. */
export const pluralWord = (n, one, many) => (n > 1 ? many : one);

/** « 3 cartes » : le nombre (formaté par format, String par défaut) suivi du mot accordé. */
export const pluralCount = (n, one, many, format = String) => `${format(n)} ${pluralWord(n, one, many)}`;

const DAY_FMT = new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: 'long', year: 'numeric' });

/** Date seule ISO (« 2025-12-24 ») -> « 24 décembre 2025 » ; '' si absente. Même rendu que fmtDate de core.js. */
export const fmtDay = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? DAY_FMT.format(new Date(+m[1], m[2] - 1, +m[3])) : '';
};

/** Horodatage ISO -> jour et mois en toute lettre, dans le fuseau donné (ex. « 3 mai 2026 »). */
export const fmtDayInZone = (iso, timeZone) =>
  new Intl.DateTimeFormat('fr-CH', { timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

/** Ne garde que les URL http(s) ; ajoute https:// si l'utilisateur a oublié le protocole. Sinon null. */
export function safeUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const tryParse = (v) => { try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && u.hostname.includes('.') ? u.href : null; } catch { return null; } };
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? tryParse(s) : tryParse(`https://${s}`);
}

/** Deux chiffres : 3 -> « 03 ». */
export const pad = (n) => String(n).padStart(2, '0');

/** Nombre aléatoire entre a et b (bornes incluses au départ, exclues à l'arrivée). */
export const rnd = (a, b) => a + Math.random() * (b - a);
