// Cartes admin : quêtes de la semaine (table hg_card_quests_templates). Liste, création, modification, activation.
// Pas de suppression : une quête inactive ne sort plus, et son identifiant garde la trace des récompenses déjà versées.
import { sb, toast, esc, $ } from '../core.js';
import { ICON } from './constants.js';
import { H } from './state.js';
import { check, act, friendly, nf } from './helpers.js';
import { openDrawer } from '../admin/ui/drawer.js';

export const QUEST_METRICS = [
  ['boosters_ouverts', 'Boosters ouverts', 'Nombre de boosters ouverts pendant la semaine.'],
  ['echanges_conclus', 'Échanges conclus', 'Échanges de cartes acceptés par les deux personnes.'],
  ['photos_ajoutees', 'Photos ajoutées', 'Photos publiées dans la galerie.'],
  ['cartes_recyclees', 'Cartes recyclées', 'Exemplaires recyclés contre des Paillettes.'],
  ['passages_du_jour', 'Passages du jour', 'Passages au « passage du jour » (récompense quotidienne).'],
];
const METRIC_LABEL = Object.fromEntries(QUEST_METRICS.map(([v, l]) => [v, l]));
const METRIC_HELP = Object.fromEntries(QUEST_METRICS.map(([v, , h]) => [v, h]));
const CODE_RE = /^[a-z0-9_]{2,40}$/;

/** État de la liste (chargée à l'ouverture de l'onglet). */
export const Q = { rows: [], loaded: false, loading: null, error: null };

/** Charge les modèles de quêtes puis redessine l'onglet. */
export function loadQuests(force = false) {
  if (Q.loading) return Q.loading;
  if (Q.loaded && !force) return Promise.resolve();
  Q.loading = (async () => {
    try {
      Q.rows = check(await sb.from('hg_card_quests_templates').select('*').order('sort').order('code')) ?? [];
      Q.loaded = true;
      Q.error = null;
    } catch (e) {
      Q.error = friendly(e);
    } finally {
      Q.loading = null;
      H.render();
    }
  })();
  return Q.loading;
}

export function questsPanel() {
  if (Q.error) return `<div class="empty">Impossible de charger les quêtes : ${esc(Q.error)} <button class="btn btn-ghost btn-sm" type="button" data-act="quest-retry">Réessayer</button></div>`;
  if (!Q.loaded) return '<div class="empty">Chargement des quêtes…</div>';
  const active = Q.rows.filter((q) => q.active).length;
  const warn = active === 0
    ? 'Aucune quête active : les membres n\'en verront aucune cette semaine.'
    : active < 3 ? `Seulement ${active} quête${active > 1 ? 's' : ''} active${active > 1 ? 's' : ''} : chaque semaine, les membres n'en auront que ${active}.` : '';
  return `<div class="acd-head">
      <p class="small muted">Chaque semaine (du lundi au dimanche, heure suisse), 3 quêtes sont tirées au sort parmi les modèles <strong>actifs</strong> ; le tirage est le même pour tout le monde. Un membre touche les Paillettes une fois par quête et par semaine, en réclamant la quête une fois atteinte.</p>
      <button class="btn btn-primary" type="button" data-act="quest-new">${ICON.plus} Nouvelle quête</button>
    </div>
    ${warn ? `<p class="acd-note" role="note">${esc(warn)}</p>` : ''}
    ${Q.rows.length ? `<ul class="acd-list">${Q.rows.map((q) => `<li class="acd-item">
        <div class="acd-item-main">
          <p><strong>${esc(q.label)}</strong> <code class="acd-code">${esc(q.code)}</code> <span class="pill ${q.active ? 'pill-ok' : 'pill-todo'}">${q.active ? 'Active' : 'Inactive'}</span></p>
          <p class="small muted">${esc(METRIC_LABEL[q.metric] || q.metric)} · objectif ${esc(nf(q.target))} · ${esc(nf(q.reward))} ✦ · ordre ${esc(q.sort)}</p>
        </div>
        <div class="btn-row acd-set-actions">
          <button class="btn ${q.active ? 'btn-ghost' : 'btn-primary'} acd-set-toggle" type="button" data-act="quest-toggle" data-id="${esc(q.code)}" aria-pressed="${q.active ? 'true' : 'false'}">${q.active ? `${ICON.off} Désactiver` : `${ICON.on} Activer`}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-act="quest-edit" data-id="${esc(q.code)}">${ICON.edit} Modifier</button>
        </div>
      </li>`).join('')}</ul>` : '<div class="empty">Aucun modèle de quête. Crée-en une pour alimenter le tirage de la semaine.</div>'}`;
}

function formHtml(q, isNew) {
  const v = q || {};
  const metricOpts = QUEST_METRICS.map(([val, l]) => `<option value="${val}"${v.metric === val ? ' selected' : ''}>${esc(l)}</option>`).join('');
  return `<div class="stack acd-form" id="acd-quest-form">
    <p class="form-error" role="alert" hidden></p>
    <div class="field"><label for="aq-code">Identifiant technique</label>
      <input id="aq-code" name="code" maxlength="40" autocomplete="off" placeholder="ex. boosters_10" value="${esc(v.code ?? '')}"${isNew ? ' required' : ' readonly'} aria-describedby="aq-code-h">
      <span class="small muted" id="aq-code-h">${isNew
        ? 'Lettres minuscules, chiffres et tiret bas (2 à 40). Il ne peut plus être changé ensuite : il sert à savoir quelles récompenses ont déjà été versées.'
        : 'Ne peut pas être modifié : il sert à savoir quelles récompenses ont déjà été versées.'}</span></div>
    <div class="field"><label for="aq-label">Libellé affiché aux membres</label>
      <input id="aq-label" name="label" required maxlength="120" autocomplete="off" value="${esc(v.label ?? '')}" aria-describedby="aq-label-h">
      <span class="small muted" id="aq-label-h">Le texte de la quête dans la liste de la semaine (120 caractères au maximum).</span></div>
    <div class="field"><label for="aq-metric">Action à compter</label>
      <select id="aq-metric" name="metric" aria-describedby="aq-metric-h">${metricOpts}</select>
      <span class="small" id="aq-metric-h">${esc(METRIC_HELP[v.metric] || METRIC_HELP.boosters_ouverts)}</span></div>
    <div class="acd-grid-2">
      <div class="field"><label for="aq-target">Objectif</label>
        <input id="aq-target" name="target" type="number" min="1" max="1000000" step="1" inputmode="numeric" required value="${esc(v.target ?? 1)}" aria-describedby="aq-target-h">
        <span class="small muted" id="aq-target-h">Nombre d'actions à faire dans la semaine pour terminer la quête.</span></div>
      <div class="field"><label for="aq-reward">Récompense (Paillettes)</label>
        <input id="aq-reward" name="reward" type="number" min="1" max="10000" step="1" inputmode="numeric" required value="${esc(v.reward ?? 10)}" aria-describedby="aq-reward-h">
        <span class="small muted" id="aq-reward-h">Versée une fois par membre et par semaine, quand il réclame la quête (1 à 10 000).</span></div>
    </div>
    <div class="acd-grid-2">
      <div class="field"><label for="aq-sort">Ordre d'affichage</label>
        <input id="aq-sort" name="sort" type="number" step="1" value="${esc(v.sort ?? (Q.rows.reduce((m, r) => Math.max(m, r.sort), 0) + 1))}" aria-describedby="aq-sort-h">
        <span class="small muted" id="aq-sort-h">Plus petit = affichée en premier. N'influence pas le tirage au sort.</span></div>
      <label class="switch"><input type="checkbox" name="active"${(v.active ?? true) ? ' checked' : ''} aria-describedby="aq-active-h"><span class="switch-ui" aria-hidden="true"></span><span>Quête active</span></label>
    </div>
    <p class="small muted" id="aq-active-h">Une quête inactive n'est jamais tirée. Les quêtes actives sont tirées au sort, 3 par semaine.</p>
  </div>`;
}

/** Quête : formulaire dans le tiroir. */
export function openQuestDialog(q = null) {
  const isNew = !q;
  const dr = openDrawer({
    title: isNew ? 'Nouvelle quête' : `Modifier « ${q.label} »`,
    submitLabel: isNew ? 'Créer la quête' : 'Enregistrer',
    body: formHtml(q, isNew),
    onSubmit: (form) => saveQuest(form, q),
  });
  const E = dr.form.elements;
  // L'aide de l'action change avec le choix
  E.metric.addEventListener('change', () => { $('#aq-metric-h', dr.body).textContent = METRIC_HELP[E.metric.value] || ''; });
  (isNew ? E.code : E.label).focus();
}

/** Enregistre la quête saisie ; renvoie false (tiroir ouvert, erreur affichée) en cas d'échec. */
async function saveQuest(form, q) {
  const isNew = !q;
  const E = form.elements;
  const err = $('.form-error', form);
  const fail = (m) => { err.textContent = m; err.hidden = false; return false; };
  err.hidden = true;
  const code = E.code.value.trim().toLowerCase();
  const label = E.label.value.trim();
  const target = Number(E.target.value);
  const reward = Number(E.reward.value);
  const sort = Number(E.sort.value);
  if (isNew && !CODE_RE.test(code)) return fail('L\'identifiant doit faire 2 à 40 caractères : lettres minuscules, chiffres ou tiret bas.');
  if (isNew && Q.rows.some((r) => r.code === code)) return fail('Cet identifiant existe déjà. Choisis-en un autre.');
  if (!label || label.length > 120) return fail('Donne un libellé (120 caractères au maximum).');
  if (!METRIC_LABEL[E.metric.value]) return fail('Choisis une action dans la liste.');
  if (!Number.isInteger(target) || target < 1 || target > 1000000) return fail('L\'objectif doit être un nombre entier positif.');
  if (!Number.isInteger(reward) || reward < 1 || reward > 10000) return fail('La récompense doit être un nombre entier entre 1 et 10 000 Paillettes.');
  if (!Number.isInteger(sort)) return fail('L\'ordre d\'affichage doit être un nombre entier.');
  const row = { label, metric: E.metric.value, target, reward, sort, active: E.active.checked };
  try {
    if (isNew) {
      check(await sb.from('hg_card_quests_templates').insert({ code, ...row }));
      toast('Quête créée.', 'ok');
    } else {
      check(await sb.from('hg_card_quests_templates').update(row).eq('code', q.code));
      toast('Quête enregistrée.', 'ok');
    }
    await loadQuests(true);
  } catch (ex) {
    return fail(`Enregistrement impossible : ${friendly(ex)}`);
  }
}

export const questActions = {
  'quest-new': () => openQuestDialog(null),
  'quest-edit': (t, id) => {
    const q = Q.rows.find((r) => r.code === id);
    if (q) openQuestDialog(q);
  },
  'quest-toggle': (t, id) => act(t, async () => {
    const q = Q.rows.find((r) => r.code === id);
    if (!q) return;
    check(await sb.from('hg_card_quests_templates').update({ active: !q.active }).eq('code', id));
    toast(q.active ? 'Quête désactivée.' : 'Quête activée.', 'ok');
    await loadQuests(true);
  }),
  'quest-retry': () => loadQuests(true),
};
