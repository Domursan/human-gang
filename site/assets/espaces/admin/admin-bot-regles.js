// ===== Humane Gang — administration : bot Discord, onglet « Règles » (admin-bot.js) =====
// Trois parties : Rappels et envois, Assistance (sujets et signalements), Planning. Réglages dans hg_settings (bot, support, planning).
// Exporte : montageRegles(c), rulesCardHtml, supportCardHtml, planningCardHtml, RULE_SUBS. Contexte c : voir admin-bot.js.

import { sb, toast, esc, $ } from '../../commun/core.js';
import { check } from './admin-bot-commun.js';

// Parties de l'onglet Règles (un seul bloc affiché à la fois) : [identifiant, libellé]. Choix mémorisé sous RSUB_KEY.
export const RULE_SUBS = [['rappels', 'Rappels et envois'], ['assistance', 'Assistance'], ['planning', 'Planning']];
const RSUB_KEY = 'hg-admin-bot-regles';

/* ---------- Réglages lot 5 : rappels, envois, assistance, planning ---------- */
// Défauts = comportement d'avant les réglages (supabase/functions/_shared/reglages.ts). Bornes = celles que le serveur accepte.
const RULE_DEF = { irl_long: 24, irl_short: 2, ss_jours: 3, dyn_retard: 24, top_n: 3, pieces_max: 4, piece_max_mo: 10, destinataires_max: 100, corps_max: 2000, annonces_heure: 20 };
const RULE_MIN_MAX = { irl_long: [1, 168], irl_short: [1, 167], ss_jours: [1, 30], dyn_retard: [1, 168], top_n: [1, 10], pieces_max: [1, 10], piece_max_mo: [1, 25], destinataires_max: [1, 100], corps_max: [1, 4000], annonces_heure: [1, 500] };
const RULE_GROUPS = {
  rappels: { title: 'Rappels', keys: ['irl_long', 'irl_short', 'ss_jours'] },
  dyn: { title: 'Événements dynamiques', keys: ['dyn_retard', 'top_n'] },
  envoi: { title: 'Message manuel (MP et pièces jointes)', keys: ['pieces_max', 'piece_max_mo', 'destinataires_max', 'corps_max'] },
  limites: { title: 'Anti-abus des membres', keys: ['annonces_heure'] },
};
const RULE_TXT = {
  irl_long: ['Rappel de sortie : délai (heures avant)', 'MP aux membres « oui » ou « peut-être » quand la sortie est dans moins de ce délai. Défaut : 24.'],
  irl_short: ['Second rappel de sortie (heures avant)', 'Doit être plus court que le premier. Défaut : 2.'],
  ss_jours: ['Rappel de cadeau Secret Santa (jours avant la date limite)', 'MP au Santa qui n\'a pas encore marqué son envoi. Défaut : 3.'],
  dyn_retard: ['Délai de grâce après la fin d\'un événement (heures)', 'Au-delà, la fin n\'est plus annoncée dans le salon. Défaut : 24.'],
  top_n: ['Nombre de chasseurs au classement de fin', 'Taille du classement annoncé à la fin d\'un événement. Défaut : 3.'],
  pieces_max: ['Pièces jointes par envoi', 'Maximum 10. Défaut : 4.'],
  piece_max_mo: ['Taille maximale d\'une pièce (Mo)', 'Maximum 25 Mo (limite de Discord pour un bot). Défaut : 10.'],
  destinataires_max: ['Destinataires par envoi', 'Maximum 100. Défaut : 100.'],
  corps_max: ['Longueur du message manuel (caractères)', 'Maximum 4000 (limite d\'un message Discord). Défaut : 2000.'],
  annonces_heure: ['Annonces et MP déclenchés par un membre, par heure', 'Nouvelle sortie, message, carte, échange, etc. : au-delà de ce nombre sur une heure glissante, les envois de ce membre sont refusés jusqu’à la fin de l’heure (les administrateurs ne sont pas limités). Défaut : 20.'],
};
const BUG_SUBJECT = 'Bug sur le site'; // le badge « Chasseur de bugs » s'appuie sur ce sujet (migration 041)
const SUPPORT_DEF = {
  sujets: ['Problème de compte / connexion', 'Secret Santa', 'Sortie IRL', BUG_SUBJECT, 'Mes données personnelles', 'Autre'],
  max_par_heure: 5, visiteur_max_par_heure: 5, visiteurs_total_par_heure: 200, message_min: 10, message_max: 4000, mp_max: 1500, delai_reponse_jours: 30,
};
const SUPPORT_MIN_MAX = {
  max_par_heure: [1, 100], visiteur_max_par_heure: [1, 100], visiteurs_total_par_heure: [1, 10000], message_min: [1, 1000],
  message_max: [1, 4000], mp_max: [100, 4000], delai_reponse_jours: [1, 365],
};
// Signalements de contenus (support.signalements, lus par hg_report_rules) : clés imbriquées, bornes comme la base.
const SIG_DEF = { seuil_masquage: 3, plafond_jour: 10 };
const SIG_MIN_MAX = { seuil_masquage: [2, 10], plafond_jour: [1, 50] };
const SIG_KEYS = Object.keys(SIG_MIN_MAX);
const SUPPORT_GROUPS = {
  sujets: { title: 'Sujets proposés', keys: ['sujets'] },
  limites: { title: 'Limites anti-abus (par heure)', keys: ['max_par_heure', 'visiteur_max_par_heure', 'visiteurs_total_par_heure'] },
  messages: { title: 'Longueur des messages', keys: ['message_min', 'message_max', 'mp_max'] },
  reponse: { title: 'Délai de réponse', keys: ['delai_reponse_jours'] },
  signalements: { title: 'Signalements de contenus', keys: SIG_KEYS },
};
const SUPPORT_TXT = {
  max_par_heure: ['Par compte connecté', 'Demandes maximum par heure pour un membre connecté. Défaut : 5.'],
  visiteur_max_par_heure: ['Par visiteur (même contact ou même connexion)', 'Défaut : 5.'],
  visiteurs_total_par_heure: ['Total des visiteurs', 'Garde-fou global contre une attaque répartie : au-delà, les demandes des visiteurs sont enregistrées sans MP à l’admin ; refus seulement au-delà de 5 fois ce nombre. Défaut : 200.'],
  message_min: ['Message : minimum (caractères)', 'Défaut : 10.'],
  message_max: ['Message : maximum (caractères)', 'Défaut : 4000.'],
  mp_max: ['Longueur du message dans le MP à l\'admin', 'Au-delà, le MP est tronqué ; la demande reste complète dans la liste. Défaut : 1500.'],
  delai_reponse_jours: ['Délai de réponse annoncé (jours)', 'Affiché au visiteur après l\'envoi. Défaut : 30.'],
};
const SIG_TXT = {
  seuil_masquage: ['Masquage automatique (nombre de membres)', 'Un contenu signalé par ce nombre de membres différents est masqué tout de suite ; le Staff le voit dans la file. Entre 2 et 10. Défaut : 3.'],
  plafond_jour: ['Signalements par membre (sur 24 h)', 'Au-delà, le membre ne peut plus signaler pendant 24 h. Entre 1 et 50. Défaut : 10.'],
};
// Libellés et bornes de tous les réglages numériques de l'assistance (plats et signalements).
const NUM_TXT = { ...SUPPORT_TXT, ...SIG_TXT }, NUM_MIN_MAX = { ...SUPPORT_MIN_MAX, ...SIG_MIN_MAX };
// Valeur par défaut du planning : envoi des anniversaires à 8 h (heure suisse).
const PLANNING_DEF = { anniversaires_heure_locale: 8, quiz_jour_heure_locale: 9 };

/**
 * HTML d'un champ numérique de réglage : libellé, aide, et bornes min et max acceptées.
 * @param {string} form Préfixe de l'identifiant (rules, support, planning).
 * @param {string} k Nom du réglage.
 * @param {string[]} libelleAide Libellé puis aide du réglage.
 * @param {number[]} bornes Minimum puis maximum acceptés.
 * @returns {string}
 */
const numField = (form, k, [label, help], [min, max]) => `<div class="field">
  <label for="${form}-${k}">${esc(label)}</label>
  <input id="${form}-${k}" name="${k}" type="number" min="${min}" max="${max}" step="1" inputmode="numeric" aria-describedby="${form}-${k}-h">
  <p class="small muted" id="${form}-${k}-h">${esc(help)}</p></div>`;
/** Bouton « Rétablir les valeurs par défaut » d'un groupe de réglages. */
const resetBtn = (form, group) => `<button class="btn btn-ghost btn-sm" type="button" data-form="${form}" data-reset-group="${group}">Rétablir les valeurs par défaut</button>`;
/**
 * En-tête d'un groupe de réglages : titre à gauche, bouton « Rétablir » aligné à droite sur la même ligne.
 * @param {string} form Préfixe du formulaire (rules, support, planning).
 * @param {string} g Nom du groupe.
 * @param {string} title Titre affiché.
 * @returns {string}
 */
const grpHead = (form, g, title) => `<div class="bot-grp-head">
        <h4 class="bot-grp-title" id="${form}-grp-${g}">${esc(title)}</h4>
        ${resetBtn(form, g)}
      </div>`;
/** Ouverture d'un groupe de réglages (libellé relié à son titre). */
const grpOpen = (form, g) =>`<div class="bot-grp bot-grp-${g}" role="group" aria-labelledby="${form}-grp-${g}">`;

/**
 * HTML de la carte « Rappels, annonces et envois » : trois groupes de champs numériques, chacun avec son bouton de retour aux défauts.
 * @returns {string}
 */
export function rulesCardHtml() {
  const groups = `<div class="bot-groups is-pair">${Object.entries(RULE_GROUPS).map(([g, def]) => `
    ${grpOpen('rules', g)}
      ${grpHead('rules', g, def.title)}
      <div class="bot-grp-grid is-${def.keys.length}">${def.keys.map((k) => numField('rules', k, RULE_TXT[k], RULE_MIN_MAX[k])).join('')}</div>
    </div>`).join('')}</div>`;
  return `<form class="card stack" id="rules-form" novalidate>
      <div>
        <h3 class="card-title">Rappels, annonces et envois</h3>
        <p class="muted small">Délais et limites du bot. « Enregistrer » sauve tous les champs ; « Rétablir » remet un groupe à ses valeurs d'origine.</p>
      </div>
      ${groups}
      <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer les rappels et limites</button></div>
    </form>`;
}

/**
 * HTML de la carte « Assistance » : sujets proposés (une ligne par sujet), puis les limites anti-abus et les longueurs.
 * @returns {string}
 */
export function supportCardHtml() {
  const sujets = `<div class="field">
      <label for="support-sujets">Sujets proposés dans le formulaire</label>
      <textarea id="support-sujets" name="sujets" rows="5" aria-describedby="support-sujets-h"></textarea>
      <p class="small muted" id="support-sujets-h">Un sujet par ligne (20 maximum, 80 caractères chacun). « ${esc(BUG_SUBJECT)} » doit rester : le badge Chasseur de bugs s'appuie dessus.</p></div>`;
  const groups = `<div class="bot-groups is-pair">${Object.entries(SUPPORT_GROUPS).map(([g, def]) => `
    ${grpOpen('support', g)}
      ${grpHead('support', g, def.title)}
      ${g === 'sujets' ? sujets : `<div class="bot-grp-grid is-${def.keys.length}">${def.keys.map((k) => numField('support', k, NUM_TXT[k], NUM_MIN_MAX[k])).join('')}</div>`}
    </div>`).join('')}</div>`;
  return `<form class="card stack" id="support-cfg-form" novalidate>
      <div>
        <h3 class="card-title">Assistance</h3>
        <p class="muted small">Ce que voient les visiteurs et les membres sur le formulaire d'assistance, et les limites appliquées côté serveur.</p>
      </div>
      ${groups}
      <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer l'assistance</button></div>
    </form>`;
}

/**
 * HTML de la carte « Planning » : heure d'envoi des anniversaires (0 à 23 h, heure suisse).
 * @returns {string}
 */
export function planningCardHtml() {
  const opts = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, '0')} h</option>`).join('');
  return `<form class="card stack" id="planning-form" novalidate>
      <div>
        <h3 class="card-title">Planning des tâches automatiques</h3>
        <p class="muted small">Les tâches automatiques tournent à fréquence fixe ; ce réglage décide quand elles agissent.</p>
      </div>
      ${grpOpen('planning', 'anniversaires')}
        ${grpHead('planning', 'anniversaires', 'Anniversaires')}
        <div class="bot-grp-grid is-1">
          <div class="field">
            <label for="planning-birthday">Heure d'envoi (heure suisse)</label>
            <select id="planning-birthday" name="anniversaires_heure_locale" aria-describedby="planning-birthday-h">${opts}</select>
            <p class="small muted" id="planning-birthday-h">Fixe toute l'année : les anniversaires partent à cette heure (HH h 05), heure suisse, en été comme en hiver. Défaut : 8 h.</p>
          </div>
        </div>
      </div>
      ${grpOpen('planning', 'quiz')}
        ${grpHead('planning', 'quiz', 'Question du jour')}
        <div class="bot-grp-grid is-1">
          <div class="field">
            <label for="planning-quiz">Heure de publication (heure suisse)</label>
            <select id="planning-quiz" name="quiz_jour_heure_locale" aria-describedby="planning-quiz-h">${opts}</select>
            <p class="small muted" id="planning-quiz-h">La question du jour change à 6 h ; le bot la publie à cette heure, une fois par jour. Défaut : 9 h.</p>
          </div>
        </div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer le planning</button></div>
    </form>`;
}

export function montageRegles(c) {
  const { S, api, assertLoaded, busy, container } = c;
  /* ======================= Règles : rappels, assistance ou planning (un bloc à la fois) ======================= */
  /**
   * Affiche un bloc de l'onglet Règles et marque le bouton choisi (aria-pressed). Le choix est mémorisé dans ce navigateur.
   * @param {string} id Identifiant du bloc (voir RULE_SUBS).
   */
  function showRsub(id) {
    const r = RULE_SUBS.some(([t]) => t === id) ? id : 'rappels';
    for (const [t] of RULE_SUBS) {
      $(`[data-rsub="${t}"]`, container).setAttribute('aria-pressed', String(t === r));
      $(`#bot-r-${t}`, container).hidden = t !== r;
    }
    try { localStorage.setItem(RSUB_KEY, r); } catch { /* stockage bloqué : le choix n'est pas gardé */ }
  }
  $('#bot-rsub', container).addEventListener('click', (ev) => { const b = ev.target.closest('[data-rsub]'); if (b) showRsub(b.dataset.rsub); });
  let rememberedRsub = null;
  try { rememberedRsub = localStorage.getItem(RSUB_KEY); } catch { /* stockage bloqué */ }
  showRsub(rememberedRsub || 'rappels');

  /* ======================= Rappels, envois, assistance, planning ======================= */
  // Formulaires des rappels et limites, de l'assistance et du planning.
  const rulesForm = $('#rules-form', container), supportForm = $('#support-cfg-form', container), planForm = $('#planning-form', container);
  // Clés des réglages de rappels et limites, et clés numériques de l'assistance.
  const RULE_ALL = Object.keys(RULE_DEF), SUPPORT_NUM = Object.keys(SUPPORT_MIN_MAX);
  /** Entier lu dans un champ, borné ; lève une erreur lisible. */
  const readInts = (form, keys, limits, labelOf) => {
    const out = {};
    for (const k of keys) {
      const [min, max] = limits[k];
      const s = String(form[k].value ?? '').trim(), n = Number(s);
      if (s === '' || !Number.isInteger(n) || n < min || n > max) throw new Error(`${labelOf(k)} : un nombre entier de ${min} à ${max}.`);
      out[k] = n;
    }
    return out;
  };
  // Libellés des réglages, utilisés dans les messages d'erreur.
  const labelRule = (k) => RULE_TXT[k][0], labelSupport = (k) => NUM_TXT[k][0];
  /** Valeur stockée d'un réglage bot (repli sur le défaut si absente ou hors bornes, comme le serveur). */
  const storedRule = (k) => {
    const r = S.bot.rappels || {}, d = S.bot.dyn || {}, e = S.bot.envoi || {}, l = S.bot.limites || {};
    const heures = Array.isArray(r.irl_heures) ? r.irl_heures : [];
    const raw = { irl_long: heures[0], irl_short: heures[1], ss_jours: r.ss_jours_avant, dyn_retard: d.delai_retard_heures, top_n: d.top_n,
      pieces_max: e.pieces_max, piece_max_mo: e.piece_max_mo, destinataires_max: e.destinataires_max, corps_max: e.corps_max, annonces_heure: l.annonces_par_heure }[k];
    const [min, max] = RULE_MIN_MAX[k];
    return Number.isInteger(raw) && raw >= min && raw <= max ? raw : RULE_DEF[k];
  };
  /** Tous les réglages de rappels et limites, tels qu'ils sont en vigueur. */
  const currentRules = () => Object.fromEntries(RULE_ALL.map((k) => [k, storedRule(k)]));
  /** Objet hg_settings.bot avec les réglages de ce bloc (le reste est conservé, y compris les autres sous-clés de limites). */
  // Forme de hg_settings.bot pour les rappels, les événements dynamiques, les envois et les limites (sous des clés imbriquées).
  const botWith = (v) => ({
    ...S.bot,
    rappels: { irl_heures: [v.irl_long, v.irl_short], ss_jours_avant: v.ss_jours },
    dyn: { delai_retard_heures: v.dyn_retard, top_n: v.top_n },
    envoi: { pieces_max: v.pieces_max, piece_max_mo: v.piece_max_mo, destinataires_max: v.destinataires_max, corps_max: v.corps_max },
    limites: { ...(S.bot.limites || {}), annonces_par_heure: v.annonces_heure },
  });
  /** Remplit le formulaire des rappels et limites avec les valeurs en vigueur. */
  const fillRules = () => { for (const k of RULE_ALL) rulesForm[k].value = storedRule(k); };
  /**
   * Enregistre hg_settings.bot avec les nouvelles valeurs, puis recale le formulaire.
   * @param {object} next Réglages complets du bot.
   */
  async function saveBot(next) {
    assertLoaded();
    check(await sb.from('hg_settings').upsert({ key: 'bot', value: next, updated_at: new Date().toISOString() }));
    S.bot = next;
    fillRules();
  }
  // Enregistrement des rappels et limites : chaque nombre doit être dans ses bornes, et le second rappel doit être plus court que le premier.
  rulesForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter ?? ev.currentTarget, async () => {
      const v = readInts(rulesForm, RULE_ALL, RULE_MIN_MAX, labelRule);
      if (v.irl_short >= v.irl_long) throw new Error('Le second rappel de sortie doit être plus court que le premier.');
      await saveBot(botWith(v));
      toast('Rappels et limites enregistrés', 'ok');
    });
  });

  // Sujet « Bug sur le site » : il doit toujours rester dans la liste (le badge Chasseur de bugs s'appuie dessus).
  const BUG = BUG_SUBJECT;
  /** Liste de sujets valide (même règle que le serveur), sinon null. */
  const cleanSujets = (list) => {
    const clean = [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
    return clean.length && clean.length <= 20 && clean.every((x) => x.length <= 80) && clean.includes(BUG) ? clean : null;
  };
  /** Valeur stockée d'un réglage d'assistance, ou le défaut si elle est absente ou hors bornes. */
  const storedSupport = (k) => {
    const v = S.support?.[k], [min, max] = SUPPORT_MIN_MAX[k];
    return Number.isInteger(v) && v >= min && v <= max ? v : SUPPORT_DEF[k];
  };
  // Sujets en vigueur : la liste enregistrée si elle est valide, sinon la liste par défaut.
  const storedSujets = () => (Array.isArray(S.support?.sujets) && cleanSujets(S.support.sujets.filter((x) => typeof x === 'string')) ) || SUPPORT_DEF.sujets;
  /** Seuil ou plafond des signalements en vigueur (défaut si absent ou hors bornes). */
  const storedSig = (k) => {
    const v = S.support?.signalements?.[k], [min, max] = SIG_MIN_MAX[k];
    return Number.isInteger(v) && v >= min && v <= max ? v : SIG_DEF[k];
  };
  /** Tous les réglages d'assistance, tels qu'ils sont en vigueur (sujets et signalements compris). Les autres clés de support sont conservées. */
  const currentSupport = () => ({
    ...S.support,
    sujets: storedSujets(),
    ...Object.fromEntries(SUPPORT_NUM.map((k) => [k, storedSupport(k)])),
    signalements: { ...(S.support?.signalements || {}), ...Object.fromEntries(SIG_KEYS.map((k) => [k, storedSig(k)])) },
  });
  /** Remplit le formulaire de l'assistance (sujets, limites et signalements) avec les valeurs en vigueur. */
  const fillSupport = () => {
    supportForm.sujets.value = storedSujets().join('\n');
    for (const k of SUPPORT_NUM) supportForm[k].value = storedSupport(k);
    for (const k of SIG_KEYS) supportForm[k].value = storedSig(k);
  };
  /**
   * Enregistre hg_settings.support avec les nouvelles valeurs, puis recale le formulaire.
   * @param {object} next Réglages complets de l'assistance (sujets et limites).
   */
  async function saveSupport(next) {
    assertLoaded();
    check(await sb.from('hg_settings').upsert({ key: 'support', value: next, updated_at: new Date().toISOString() }));
    S.support = next;
    fillSupport();
  }
  // Enregistrement de l'assistance : mêmes règles que le serveur (1 à 20 sujets de 80 caractères au plus, sujet « Bug » obligatoire,
  // maximum du message supérieur au minimum).
  supportForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter ?? ev.currentTarget, async () => {
      const list = supportForm.sujets.value.split('\n').map((x) => x.trim()).filter(Boolean);
      if (!list.length) throw new Error('Ajoute au moins un sujet.');
      if (list.length > 20) throw new Error('20 sujets maximum.');
      if (list.some((x) => x.length > 80)) throw new Error('Un sujet dépasse 80 caractères.');
      const sujets = [...new Set(list)];
      if (!sujets.includes(BUG)) throw new Error(`Le sujet « ${BUG} » doit rester dans la liste : le badge Chasseur de bugs s'appuie dessus.`);
      const v = readInts(supportForm, SUPPORT_NUM, SUPPORT_MIN_MAX, labelSupport);
      if (v.message_max <= v.message_min) throw new Error('Le maximum du message doit être plus grand que le minimum.');
      const sig = readInts(supportForm, SIG_KEYS, SIG_MIN_MAX, labelSupport);
      await saveSupport({ ...S.support, sujets, ...v, signalements: { ...(S.support?.signalements || {}), ...sig } });
      toast('Assistance enregistrée', 'ok');
    });
  });

  /** Heure en vigueur d'une tâche (0 à 23), ou le défaut si la valeur enregistrée est invalide. */
  const storedHeure = (k = 'anniversaires_heure_locale') => {
    const h = S.planning?.[k];
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : PLANNING_DEF[k];
  };
  /** Remplit le formulaire du planning avec les heures en vigueur. */
  const fillPlanning = () => {
    planForm.anniversaires_heure_locale.value = String(storedHeure());
    planForm.quiz_jour_heure_locale.value = String(storedHeure('quiz_jour_heure_locale'));
  };
  /**
   * Enregistre hg_settings.planning (heures des anniversaires et de la question du jour), puis recale le formulaire.
   * Les autres clés du planning sont conservées.
   * @param {number} h Heure des anniversaires, de 0 à 23.
   * @param {number} [q] Heure de la question du jour, de 0 à 23 (défaut : valeur en vigueur).
   */
  async function savePlanning(h, q = storedHeure('quiz_jour_heure_locale')) {
    assertLoaded();
    const next = { ...(S.planning || {}), anniversaires_heure_locale: h, quiz_jour_heure_locale: q };
    check(await sb.from('hg_settings').upsert({ key: 'planning', value: next, updated_at: new Date().toISOString() }));
    S.planning = next;
    fillPlanning();
  }
  // Enregistrement du planning.
  planForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter ?? ev.currentTarget, async () => {
      await savePlanning(Number(planForm.anniversaires_heure_locale.value), Number(planForm.quiz_jour_heure_locale.value));
      toast('Planning enregistré', 'ok');
    });
  });

  /** Rétablir un groupe : ses valeurs reviennent aux défauts et sont enregistrées tout de suite. */
  container.addEventListener('click', (ev) => {
    const b = ev.target.closest?.('[data-reset-group]');
    if (!b) return;
    busy(b, async () => {
      const g = b.dataset.resetGroup;
      if (b.dataset.form === 'rules') {
        const v = currentRules();
        for (const k of RULE_GROUPS[g].keys) v[k] = RULE_DEF[k];
        await saveBot(botWith(v));
      } else if (b.dataset.form === 'support') {
        const v = currentSupport();
        for (const k of SUPPORT_GROUPS[g].keys) {
          if (SIG_KEYS.includes(k)) v.signalements = { ...v.signalements, [k]: SIG_DEF[k] };
          else v[k] = SUPPORT_DEF[k];
        }
        await saveSupport(v);
      } else {
        if (g === 'quiz') await savePlanning(storedHeure(), PLANNING_DEF.quiz_jour_heure_locale);
        else await savePlanning(PLANNING_DEF.anniversaires_heure_locale);
      }
      toast('Valeurs par défaut rétablies', 'ok');
    });
  });


  Object.assign(api, { fillRules, fillSupport, fillPlanning });
}
