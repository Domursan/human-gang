// Admin › Vie › Badges : critères des badges automatiques et affichage sur la carte (hg_settings.badges).
// Valeurs de repli = valeurs actuelles du code (migration 053 les reprend côté SQL) : sans clé, rien ne change.
// Monté par badges.js, au-dessus de la grille des badges. Dépend de core.js (Supabase, toast, esc, $) et common.js (busy).
import { sb, toast, errMsg, esc, $ } from '../core.js';
import { busy } from './common.js';

// Valeurs par défaut (comme le code les utilise) : « Rétablir les valeurs par défaut » les remet dans le formulaire.
const DEFAULTS = {
  criteres: { toujours_la_sorties: 5, paparazzi_photos: 50, fidele_annees: 3, veteran_editions: 5, globe_trotter_lieux: 3, saisonnier_themes: 7, bug_sujet: 'Bug sur le site' },
  max_carte: 8,
};
// Groupes du formulaire : chaque champ a une clé en chemin pointé (ex. « criteres.paparazzi_photos »),
// des bornes (min, max), un libellé et une aide. text: true pour un champ texte au lieu d'un nombre.
const GROUPS = [
  { g: 'Critères des badges automatiques', hint: 'Seuils au-delà desquels un badge est attribué automatiquement (calcul toutes les heures). Modifier un seuil n\'enlève pas les badges déjà attribués.', fields: [
    { k: 'criteres.toujours_la_sorties', l: 'Toujours là : sorties passées auxquelles le membre a répondu « oui »', min: 1, max: 999, help: 'Badge « Toujours là ». Défaut : 5.' },
    { k: 'criteres.paparazzi_photos', l: 'Paparazzi : photos publiées', min: 1, max: 9999, help: 'Badge « Paparazzi ». Défaut : 50.' },
    { k: 'criteres.fidele_annees', l: 'Fidèle : années dans le gang', min: 1, max: 50, help: 'Compté depuis la date d\'arrivée. Défaut : 3.' },
    { k: 'criteres.veteran_editions', l: 'Vétéran : éditions de Secret Santa terminées', min: 1, max: 99, help: 'Badge « Vétéran ». Défaut : 5.' },
    { k: 'criteres.globe_trotter_lieux', l: 'Globe-trotter : lieux différents', min: 1, max: 99, help: 'Lieux des sorties passées auxquelles le membre a participé. Défaut : 3.' },
    { k: 'criteres.saisonnier_themes', l: 'Saisonnier : thèmes du site vus', min: 1, max: 99, help: 'Thèmes différents affichés au membre. Défaut : 7.' },
    { k: 'criteres.bug_sujet', l: 'Chasseur de bugs : sujet d\'assistance', text: true, max: 100, help: 'Doit correspondre exactement au libellé du sujet « bug » dans le formulaire d\'assistance. Défaut : Bug sur le site.' },
  ] },
  { g: 'Affichage sur la carte', fields: [
    { k: 'max_carte', l: 'Badges affichés sur la carte d\'un membre', min: 1, max: 20, help: 'Au-delà, la carte affiche une pastille « +n ». Défaut : 8.' },
  ] },
];

// État du formulaire : racine, réglages enregistrés (ou null), erreur de chargement, grille au-dessus de laquelle il s'affiche.
const H = { host: null, stored: null, error: null, grid: null };
/** Découpe un chemin pointé (« criteres.max ») en tableau de clés. */
const pathOf = (k) => k.split('.');
/** Lit la valeur au chemin pointé ; null si absente. */
const getPath = (obj, k) => pathOf(k).reduce((o, p) => o?.[p], obj) ?? null;
/** Écrit `v` au chemin donné, en créant les objets intermédiaires si besoin. */
const setPath = (obj, path, v) => {
  let o = obj;
  for (const p of path.slice(0, -1)) { if (typeof o[p] !== 'object' || o[p] === null) o[p] = {}; o = o[p]; }
  o[path[path.length - 1]] = v;
};
/** Valeur à afficher pour un champ : celle enregistrée, sinon la valeur par défaut. */
const shown = (f) => { const s = getPath(H.stored, f.k); return s != null ? s : getPath(DEFAULTS, f.k); };
/** Identifiant HTML d'un champ (« bc-criteres_paparazzi_photos »). */
const idOf = (f) => `bc-${f.k.replaceAll('.', '_')}`;

/** Monte le formulaire au-dessus de la grille des badges (une seule fois), puis charge les réglages enregistrés. */
export async function mountBadgesCriteres(grid) {
  if (H.host || !grid) return;
  H.grid = grid;
  H.host = document.createElement('div');
  H.host.id = 'badge-criteres';
  grid.before(H.host);
  H.host.addEventListener('click', onClick);
  H.host.addEventListener('submit', onSubmit);
  render(); // affiche d'abord les valeurs par défaut, puis les valeurs enregistrées
  await load();
  render();
}

/** Lit les réglages « badges » dans hg_settings. Une erreur est gardée pour être affichée, sans bloquer le formulaire. */
async function load() {
  try {
    const { data, error } = await sb.from('hg_settings').select('value').eq('key', 'badges').maybeSingle();
    if (error) throw error;
    H.stored = data?.value ?? null;
    H.error = null;
  } catch (e) {
    H.error = errMsg(e);
  }
}

/** Dessine le formulaire complet (les valeurs viennent de shown). */
function render() {
  if (!H.host) return;
  H.host.innerHTML = `<section class="card bc-card" aria-labelledby="bc-h">
    <h3 class="card-title" id="bc-h">Réglages des badges</h3>
    ${H.error ? `<div class="empty">Impossible de charger les réglages : ${esc(H.error)}</div>` : ''}
    <form class="stack" id="bc-form" novalidate>
      <p class="form-error" role="alert" hidden></p>
      ${GROUPS.map((g, gi) => `<fieldset class="acd-fs"><legend>${esc(g.g)}</legend>
        ${g.hint ? `<p class="small muted">${esc(g.hint)}</p>` : ''}
        <div class="acd-grid-2">${g.fields.map((f) => `<div class="field">
          <label for="${idOf(f)}">${esc(f.l)}</label>
          <input id="${idOf(f)}" name="${idOf(f).replace('bc-', '')}" type="${f.text ? 'text' : 'number'}" ${f.text ? `maxlength="${f.max}"` : `inputmode="numeric" step="1" min="${f.min}" max="${f.max}"`}
            value="${esc(shown(f) ?? '')}" aria-describedby="${idOf(f)}-h" required>
          <p class="small muted" id="${idOf(f)}-h">${esc(f.help)}</p></div>`).join('')}</div>
        <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-bc-default="${gi}">Rétablir les valeurs par défaut de ce groupe</button></div>
      </fieldset>`).join('')}
      <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer les réglages des badges</button></div>
    </form>
  </section>`;
}

/** « Rétablir les valeurs par défaut » d'un groupe : remplit le formulaire, sans enregistrer. */
function onClick(e) {
  const t = e.target.closest('[data-bc-default]');
  if (!t) return;
  const g = GROUPS[Number(t.dataset.bcDefault)];
  const form = $('#bc-form', H.host);
  for (const f of g.fields) {
    const el = form.elements[idOf(f).replace('bc-', '')];
    if (el) el.value = String(getPath(DEFAULTS, f.k));
  }
  toast('Valeurs par défaut remplies : enregistre pour les appliquer', 'ok');
}

/**
 * Lit et valide le formulaire. Renvoie la valeur complète à enregistrer ou lève une erreur en français.
 * Part de la copie des réglages enregistrés : les clés non présentes dans le formulaire sont conservées.
 */
function readForm(form) {
  const next = structuredClone(H.stored || {});
  for (const g of GROUPS) for (const f of g.fields) {
    const raw = String(form.elements[idOf(f).replace('bc-', '')].value).trim();
    if (f.text) {
      if (!raw) throw new Error(`« ${f.l} » : indique un libellé.`);
      if (raw.length > f.max) throw new Error(`« ${f.l} » : ${f.max} caractères maximum.`);
      setPath(next, pathOf(f.k), raw);
      continue;
    }
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n)) throw new Error(`« ${f.l} » : indique un nombre entier.`);
    if (n < f.min || n > f.max) throw new Error(`« ${f.l} » : valeur entre ${f.min} et ${f.max}.`);
    setPath(next, pathOf(f.k), n);
  }
  return next;
}

/** Enregistre le formulaire (upsert dans hg_settings). Une erreur de saisie s'affiche sous le formulaire. */
async function onSubmit(e) {
  if (e.target.id !== 'bc-form') return;
  e.preventDefault();
  const form = e.target;
  const err = $('.form-error', form);
  // Affiche le message d'erreur sous le formulaire (vide = masqué), et le fait voir.
  const showErr = (m) => { err.textContent = m; err.hidden = !m; if (m) err.scrollIntoView({ block: 'nearest' }); };
  showErr('');
  let next;
  try { next = readForm(form); } catch (ex) { return showErr(errMsg(ex)); }
  await busy(e.submitter, async () => {
    const { error } = await sb.from('hg_settings').upsert({ key: 'badges', value: next, updated_at: new Date().toISOString() });
    if (error) throw error;
    H.stored = next;
    toast('Réglages des badges enregistrés', 'ok');
    render();
  });
}
