// ===== Humane Gang — réglages lot 5 (bot, rappels, limites, assistance, planning) =====
// Lecture des clés de hg_settings avec repli : une clé absente ou invalide donne la valeur par défaut,
// qui est exactement le comportement d'avant les réglages. Les mêmes défauts sont dans admin-bot.js (affichage).
//   bot.rappels   { irl_heures: [long, court], ss_jours_avant }
//   bot.dyn       { delai_retard_heures, top_n }
//   bot.envoi     { pieces_max, piece_max_mo, destinataires_max, corps_max }
//   support       { sujets[], max_par_heure, visiteur_max_par_heure, visiteurs_total_par_heure,
//                   message_min, message_max, mp_max, delai_reponse_jours }
//   planning      { anniversaires_heure_locale }

export const BUG_SUBJECT = 'Bug sur le site'; // le badge « Chasseur de bugs » (migration 041) compte ce sujet

export const SUPPORT_DEFAUT = {
  sujets: ['Problème de compte / connexion', 'Secret Santa', 'Sortie IRL', BUG_SUBJECT, 'Mes données personnelles', 'Autre'],
  max_par_heure: 5,
  visiteur_max_par_heure: 5,
  visiteurs_total_par_heure: 200,
  message_min: 10,
  message_max: 4000,
  mp_max: 1500,
  delai_reponse_jours: 30,
};

export const PLANNING_DEFAUT = { anniversaires_heure_locale: 8 };

const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const intOr = (v: unknown, def: number, min: number, max: number) => (isInt(v, min, max) ? v : def);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

export type BotRules = {
  irl_long: number; irl_short: number; ss_jours: number;
  dyn_retard_h: number; top_n: number;
  pieces_max: number; piece_max_mo: number; destinataires_max: number; corps_max: number;
};

/** Règles du bot à partir de hg_settings.bot (objet déjà lu par la fonction). */
export function botRules(bot: Record<string, unknown> | null | undefined): BotRules {
  const b = obj(bot);
  const r = obj(b.rappels), d = obj(b.dyn), e = obj(b.envoi);
  const heures = Array.isArray(r.irl_heures) ? r.irl_heures : [];
  let irl_long = intOr(heures[0], 24, 1, 168);
  let irl_short = intOr(heures[1], 2, 1, 167);
  if (irl_short >= irl_long) { irl_long = 24; irl_short = 2; } // couple invalide : défaut
  return {
    irl_long, irl_short,
    ss_jours: intOr(r.ss_jours_avant, 3, 1, 30),
    dyn_retard_h: intOr(d.delai_retard_heures, 24, 1, 168),
    top_n: intOr(d.top_n, 3, 1, 10),
    pieces_max: intOr(e.pieces_max, 4, 1, 10),
    piece_max_mo: intOr(e.piece_max_mo, 10, 1, 25),
    destinataires_max: intOr(e.destinataires_max, 100, 1, 100),
    corps_max: intOr(e.corps_max, 2000, 1, 4000),
  };
}

export type SupportRules = typeof SUPPORT_DEFAUT;

/** Règles de l'assistance à partir de hg_settings.support. Les sujets doivent garder le sujet « bug » (badge). */
export function supportRules(raw: unknown): SupportRules {
  const s = obj(raw);
  let sujets = SUPPORT_DEFAUT.sujets;
  if (Array.isArray(s.sujets)) {
    const clean = [...new Set(s.sujets.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x && x.length <= 80))];
    if (clean.length && clean.length <= 20 && clean.includes(BUG_SUBJECT)) sujets = clean;
  }
  const message_min = intOr(s.message_min, SUPPORT_DEFAUT.message_min, 1, 1000);
  const message_max = intOr(s.message_max, SUPPORT_DEFAUT.message_max, message_min + 1, 4000);
  return {
    sujets,
    max_par_heure: intOr(s.max_par_heure, SUPPORT_DEFAUT.max_par_heure, 1, 100),
    visiteur_max_par_heure: intOr(s.visiteur_max_par_heure, SUPPORT_DEFAUT.visiteur_max_par_heure, 1, 100),
    visiteurs_total_par_heure: intOr(s.visiteurs_total_par_heure, SUPPORT_DEFAUT.visiteurs_total_par_heure, 1, 10000),
    message_min, message_max,
    mp_max: intOr(s.mp_max, SUPPORT_DEFAUT.mp_max, 100, 4000),
    delai_reponse_jours: intOr(s.delai_reponse_jours, SUPPORT_DEFAUT.delai_reponse_jours, 1, 365),
  };
}

