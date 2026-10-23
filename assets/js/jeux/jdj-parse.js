// ===== Humane Gang — Jeux du jour : lecture des textes de partage (aperçu) =====
/*
 * Rôle : reconnaît le jeu, le numéro de grille et le score d'un texte de partage collé par le membre, pour l'aperçu
 * avant l'envoi. Mêmes règles que la fonction SQL hg_daily_parse (migration 083) : c'est le serveur qui décide.
 * Dépendances : aucune (module pur, testable seul).
 * Exporte : JEUX, parse, points, scoreTexte.
 */

/** Jeux pris en charge : nom affiché et type de score (essais sur 6, nombre de coups, essais sans maximum). */
export const JEUX = {
  worldle: { nom: 'Worldle', type: 'essais6' },
  sutom: { nom: 'Sutom', type: 'essais6' },
  framed: { nom: 'Framed', type: 'essais6' },
  cemantix: { nom: 'Cémantix', type: 'coups' },
  pedantix: { nom: 'Pédantix', type: 'coups' },
  heardle: { nom: 'Heardle', type: 'essais6' },
  loldle: { nom: 'LoLdle', type: 'essais' },
};

/** Garde seulement les cases de couleur d'une ligne de partage. */
const cases = (s) => (String(s).match(/🟥|🟩|⬛|⬜|🟨/gu) || []).join('');

/**
 * Lit un texte de partage.
 * @param {string} raw Texte collé.
 * @returns {{game: string, grid: number|null, score: number, max: number|null}|null} null si non reconnu.
 */
export function parse(raw) {
  const t = String(raw ?? '');
  if (!t.trim() || t.length > 600) return null;
  let m = t.match(/#\s*worldle\s*#\s*(\d{1,6})\s*(?:\([^)]{0,20}\)\s*)?([1-6x])\s*\/\s*6/i);
  if (m) return { game: 'worldle', grid: Number(m[1]), score: /x/i.test(m[2]) ? 0 : Number(m[2]), max: 6 };
  m = t.match(/sutom\s*#?\s*(\d{1,6})\s+([1-6x-])\s*\/\s*6/i);
  if (m) return { game: 'sutom', grid: Number(m[1]), score: /^\d$/.test(m[2]) ? Number(m[2]) : 0, max: 6 };
  m = t.match(/#?\s*c[ée]mantix\s*n?\s*[º°o]?\s*(\d{1,6})\D{0,40}?\s(\d{1,5})\s*coups?/i);
  if (m) return { game: 'cemantix', grid: Number(m[1]), score: Number(m[2]), max: null };
  m = t.match(/#?\s*p[ée]dantix\s*n?\s*[º°o]?\s*(\d{1,6})\D{0,40}?\s(\d{1,5})\s*coups?/i);
  if (m) return { game: 'pedantix', grid: Number(m[1]), score: Number(m[2]), max: null };
  m = t.match(/framed\s*#\s*(\d{1,6})([\s\S]*)$/i);
  if (m) {
    const sq = [...cases(m[2])];
    if (!sq.length) return null;
    return { game: 'framed', grid: Number(m[1]), score: sq.indexOf('🟩') + 1, max: 6 };
  }
  m = t.match(/#\s*heardle\s*#\s*(\d{1,6})([\s\S]*)$/i);
  if (m) {
    const sq = [...cases(m[2])];
    if (!sq.length) return null;
    return { game: 'heardle', grid: Number(m[1]), score: sq.indexOf('🟩') + 1, max: 6 };
  }
  m = t.match(/#\s*loldle[\s\S]*?(?:classic|classique)\s*:\s*(\d{1,3})/i);
  if (m) return { game: 'loldle', grid: null, score: Number(m[1]), max: null };
  return null;
}

/**
 * Points de la semaine (comme hg_daily_points) : 6 pour une réussite du premier coup … 1 au plus lent, 0 si ratée.
 * @param {string} game Jeu.
 * @param {number} score Essais ou coups (0 = ratée).
 * @returns {number}
 */
export function points(game, score) {
  const s = Number(score) || 0;
  if (s <= 0) return 0;
  if (game === 'cemantix' || game === 'pedantix') return s <= 10 ? 6 : s <= 25 ? 5 : s <= 50 ? 4 : s <= 100 ? 3 : s <= 200 ? 2 : 1;
  return Math.max(1, Math.min(6, 7 - s));
}

/**
 * Score lisible : « 2/6 », « X/6 », « 54 coups », « 3 essais ».
 * @param {{game: string, score: number, max: number|null}} r Résultat.
 * @returns {string}
 */
export function scoreTexte(r) {
  const s = Number(r?.score) || 0;
  if (r?.max) return `${s > 0 ? s : 'X'}/${r.max}`;
  if (JEUX[r?.game]?.type === 'coups') return `${s} coup${s > 1 ? 's' : ''}`;
  return `${s} essai${s > 1 ? 's' : ''}`;
}
