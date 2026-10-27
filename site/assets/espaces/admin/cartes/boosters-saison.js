// =====================================================================
// Cartes admin : réglages « Saison et horaires » d'un type de booster (migration 080, idées C1, C2 et C3).
// Utilisé par boosters.js : sous-section de l'éditeur, lecture, validation et champs de hg_booster_type_save.
//   - available_from / available_until : fenêtre de vente (heure de Zurich ; vide = sans limite) ;
//   - only_set : seule série tirée (code ; vide = toutes les séries permises) ;
//   - schedule {days, from, to} + per_window_limit : plage horaire de vente et limite d'achats par soirée ;
//   - shiny_style : style des brillantes ('fondue' ou rien).
// Exporte : SAISON_STYLES, saisonDefaults, saisonSectionHtml, readSaison, validateSaison, saisonPayload.
// =====================================================================
import { esc } from '../../../commun/core.js';

/** Styles de cartouche ajoutés par la migration 080 (classe, libellé). */
export const SAISON_STYLES = [['cart--esport', 'Saison esport'], ['cart--pate', 'Pâté-saucisses'], ['cart--raclette', 'Raclette']];
const DAYS = [[1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [7, 'Dimanche']];
const TZ = 'Europe/Zurich';
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Parties d'une date en heure de Zurich. */
const zParts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  .formatToParts(d).map((x) => [x.type, x.value]));
/** ISO → « 2026-12-01T00:00 » (heure de Zurich), pour un champ datetime-local. */
export function toZurich(iso) {
  if (!iso) return '';
  const p = zParts(new Date(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** « 2026-12-01T00:00 » (heure de Zurich) → ISO UTC (changements d'heure gérés). */
export function fromZurich(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(v || ''));
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const off = (t) => { const p = zParts(new Date(t)); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t; };
  let t = wall - off(wall);
  t = wall - off(t);
  return new Date(t).toISOString();
}

/** Valeurs par défaut d'un nouveau type (aucune saison, aucune plage). */
export const saisonDefaults = () => ({ available_from: null, available_until: null, only_set: null, schedule: null, per_window_limit: null, shiny_style: null });

/**
 * HTML de la sous-section « Saison et horaires ».
 * @param {object} t type
 * @param {Array<{code: string, name: string}>} sets séries
 */
export function saisonSectionHtml(t, sets) {
  const sc = t.schedule || null;
  const days = sc?.days || [5, 6];
  return `
    <p class="small muted">Heure de Zurich. Vide = pas de limite. Après la fin de la vente, les boosters déjà achetés restent ouvrables.</p>
    <div class="acd-grid-2">
      <div class="field"><label for="abt-from">Début de la vente</label><input id="abt-from" name="available_from" type="datetime-local" value="${esc(toZurich(t.available_from))}"></div>
      <div class="field"><label for="abt-until">Fin de la vente</label><input id="abt-until" name="available_until" type="datetime-local" value="${esc(toZurich(t.available_until))}"></div>
    </div>
    <div class="field"><label for="abt-only">Série unique</label>
      <select id="abt-only" name="only_set" aria-describedby="abt-only-h"><option value="">Toutes les séries permises</option>
        ${sets.map((s) => `<option value="${esc(s.code)}"${t.only_set === s.code ? ' selected' : ''}>${esc(s.name)} (${esc(s.code)})</option>`).join('')}</select>
      <span class="small muted" id="abt-only-h">Le booster ne tire que dans cette série (pas avec « Une série au choix »).</span></div>
    <fieldset class="abt-fs"><legend>Plage horaire de vente</legend>
      <label class="switch"><input type="checkbox" name="sched_on"${sc ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>En vente seulement certains soirs</span></label>
      <div class="abt-checks">${DAYS.map(([d, l]) => `<label class="abt-check"><input type="checkbox" name="sched_day" value="${d}"${days.includes(d) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <div class="acd-grid-2">
        <div class="field"><label for="abt-sfrom">De</label><input id="abt-sfrom" name="sched_from" type="time" value="${esc(sc?.from || '20:00')}"></div>
        <div class="field"><label for="abt-sto">À <span class="muted small">(le lendemain si plus tôt)</span></label><input id="abt-sto" name="sched_to" type="time" value="${esc(sc?.to || '02:00')}"></div>
      </div>
      <div class="field"><label for="abt-pwl">Limite par soirée</label>
        <input id="abt-pwl" name="per_window_limit" type="number" inputmode="numeric" min="1" max="100" step="1" placeholder="sans limite" value="${t.per_window_limit == null ? '' : esc(t.per_window_limit)}"></div>
    </fieldset>
    <div class="field"><label for="abt-sstyle">Style des brillantes</label>
      <select id="abt-sstyle" name="shiny_style"><option value="">Holographique (habituel)</option><option value="fondue"${t.shiny_style === 'fondue' ? ' selected' : ''}>Fondue (fromage qui coule)</option></select></div>`;
}

/** Lit les champs de la sous-section (valeurs brutes). */
export function readSaison(form) {
  const E = form.elements;
  const val = (n) => String(E[n]?.value ?? '').trim();
  return {
    available_from: val('available_from'), available_until: val('available_until'), only_set: val('only_set'),
    sched_on: !!E.sched_on?.checked, sched_days: [...form.querySelectorAll('input[name="sched_day"]:checked')].map((i) => Number(i.value)),
    sched_from: val('sched_from'), sched_to: val('sched_to'), per_window_limit: val('per_window_limit'), shiny_style: val('shiny_style'),
  };
}

/**
 * Valide la sous-section ; renvoie les champs prêts à enregistrer, ou lève une erreur au message clair.
 * @param {object} v valeurs brutes (readSaison)
 * @param {string} pool contenu choisi (tous, serie, manquantes)
 */
export function validateSaison(v, pool) {
  const fail = (m) => { throw new Error(m); };
  const from = v.available_from ? fromZurich(v.available_from) : null;
  const until = v.available_until ? fromZurich(v.available_until) : null;
  if (v.available_from && !from) fail('Date de début de la vente invalide.');
  if (v.available_until && !until) fail('Date de fin de la vente invalide.');
  if (from && until && new Date(until) <= new Date(from)) fail('La fin de la vente doit être après son début.');
  if (v.only_set && pool === 'serie') fail('Un booster « Une série au choix » ne peut pas viser une seule série.');
  let schedule = null;
  if (v.sched_on) {
    if (!v.sched_days.length) fail('Coche au moins un jour pour la plage horaire.');
    if (!HM.test(v.sched_from) || !HM.test(v.sched_to)) fail('Heures de la plage au format HH:MM.');
    if (v.sched_from === v.sched_to) fail('La plage horaire doit avoir un début différent de la fin.');
    schedule = { days: [...new Set(v.sched_days)].sort(), from: v.sched_from, to: v.sched_to };
  }
  const pwl = v.per_window_limit;
  if (pwl !== '' && (!Number.isInteger(Number(pwl)) || Number(pwl) < 1 || Number(pwl) > 100)) fail('La limite par soirée est vide ou un entier de 1 à 100.');
  return {
    available_from: from, available_until: until, only_set: v.only_set || null, schedule,
    per_window_limit: pwl === '' || !schedule ? null : Number(pwl), shiny_style: v.shiny_style || null,
  };
}

/** Champs de la charge utile de hg_booster_type_save (normalisés pour la comparaison). */
export const saisonPayload = (t) => ({
  available_from: t.available_from ? new Date(t.available_from).toISOString() : null,
  available_until: t.available_until ? new Date(t.available_until).toISOString() : null,
  only_set: t.only_set || null,
  schedule: t.schedule ? { days: [...t.schedule.days].map(Number).sort(), from: t.schedule.from, to: t.schedule.to } : null,
  per_window_limit: t.per_window_limit == null || t.per_window_limit === '' ? null : Number(t.per_window_limit),
  shiny_style: t.shiny_style || null,
});
