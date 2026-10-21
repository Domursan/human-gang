// Admin : section « Réglages du site ». Éditeur des clés de hg_settings, typé et validé.
// Les clés gérées dans une autre section sont en lecture seule (lien vers cette section).
// Les clés sensibles ne sont modifiables que par l'administrateur (getCachedProfile()?.is_admin).
// Remarque : la politique RLS de hg_settings accepte aussi les Staff « reglages » pour toutes les clés ;
// la restriction des clés sensibles est donc faite ici, côté interface, et doit aussi être posée en base.
import { sb, toast, errMsg, esc, $, fmtDateTime } from '../core.js';
import { getCachedProfile } from '../core/profile.js';
import { confirmBox } from '../ui-confirm.js';
import { KEYS, KIND_LABEL, KEY_RE, isSensitive, managedOf, kindOf, parseValue, displayValue } from './keys.js';

const R = { root: null, rows: [], loaded: false, error: null, isAdmin: false };

const canEdit = (key) => !managedOf(key) && (!isSensitive(key) || R.isAdmin);
const nowIso = () => new Date().toISOString();

/** Point d'entrée (admin.js). */
export async function mountReglagesSection(root) {
  if (!root) return;
  R.root = root;
  R.isAdmin = !!getCachedProfile()?.is_admin;
  root.addEventListener('submit', onSubmit);
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  render();
  await load();
}

async function load() {
  try {
    const { data, error } = await sb.from('hg_settings').select('key, value, updated_at').order('key');
    if (error) throw error;
    R.rows = data ?? [];
    R.loaded = true;
    R.error = null;
  } catch (e) {
    R.error = errMsg(e);
  }
  render();
}

function render() {
  if (!R.root) return;
  const list = R.rows.map((r, i) => itemHtml(r, i)).join('');
  R.root.innerHTML = `
    <p class="small muted">Réglages techniques du site : chaque clé porte une valeur (texte, nombre, oui / non ou JSON). Le code du site décide de l'effet d'une clé. Une clé gérée dans une autre section se modifie là-bas.</p>
    ${R.error ? `<div class="empty">Impossible de charger les réglages : ${esc(R.error)} <button class="btn btn-ghost btn-sm" type="button" data-rg="retry">Réessayer</button></div>` : ''}
    ${!R.loaded && !R.error ? '<div class="empty">Chargement des réglages…</div>' : ''}
    ${R.loaded && !R.rows.length ? '<div class="empty">Aucun réglage enregistré.</div>' : ''}
    ${R.loaded && R.rows.length ? `<ul class="rg-list">${list}</ul>` : ''}
    ${R.loaded && R.isAdmin ? addFormHtml() : ''}`;
}

function itemHtml(r, i) {
  const meta = KEYS[r.key] || {};
  const label = meta.label || r.key;
  const managed = managedOf(r.key);
  const kind = kindOf(r.value);
  const badges = [
    managed ? `<span class="pill">Géré dans « ${esc(managed.managedLabel)} »</span>` : '',
    isSensitive(r.key) ? '<span class="pill pill-todo">Sensible : admin seulement</span>' : '',
    meta.label ? '' : '<span class="pill pill-muted">Clé non documentée</span>',
  ].join('');
  const help = meta.help || 'Aucune description pour cette clé : vérifie à quoi elle sert avant de la modifier.';
  const body = canEdit(r.key)
    ? `<form class="rg-form" data-key="${esc(r.key)}" data-kind="${kind}" novalidate>
        ${controlHtml(`rg-v-${i}`, kind, r.value)}
        <p class="form-error" role="alert" hidden></p>
        <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
      </form>`
    : `<details class="rg-ro"><summary>Voir la valeur (lecture seule)</summary><pre class="rg-pre">${esc(displayValue(r.value))}</pre></details>`;
  return `<li class="card rg-item" data-key-item="${esc(r.key)}">
    <div class="rg-head"><h3 class="rg-title">${esc(label)}</h3><code class="acd-code">${esc(r.key)}</code>${badges}</div>
    <p class="small muted">${esc(help)}</p>
    ${managed ? `<p class="small"><a href="${esc(managed.managed)}">Ouvrir la section « ${esc(managed.managedLabel)} »</a></p>` : ''}
    ${body}
    <p class="small muted rg-meta">Type : ${esc(KIND_LABEL[kind])}${r.updated_at ? ` · mis à jour le ${esc(fmtDateTime(r.updated_at))}` : ''}</p>
  </li>`;
}

/** Champ de saisie selon le type. L'élément de valeur s'appelle toujours « v ». */
function controlHtml(id, kind, value) {
  if (kind === 'bool') {
    return `<label class="switch rg-switch"><input id="${id}" name="v" type="checkbox"${value ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Activé</span></label>`;
  }
  if (kind === 'number') {
    return `<div class="field"><label for="${id}">Valeur (nombre)</label><input id="${id}" name="v" type="number" step="any" inputmode="decimal" value="${esc(value ?? '')}"></div>`;
  }
  if (kind === 'json') {
    const text = value === undefined || value === null || value === '' ? '{}' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return `<div class="field"><label for="${id}">Valeur (JSON)</label>
      <textarea id="${id}" name="v" class="rg-json" rows="7" spellcheck="false" aria-describedby="${id}-h">${esc(text)}</textarea>
      <span class="small muted" id="${id}-h">Un objet { … } ou une liste [ … ]. Le JSON est vérifié avant l'enregistrement.</span></div>`;
  }
  return `<div class="field"><label for="${id}">Valeur (texte)</label><input id="${id}" name="v" type="text" maxlength="2000" value="${esc(value ?? '')}"></div>`;
}

function addFormHtml() {
  return `<section class="card rg-add" aria-labelledby="rg-add-title">
    <h3 class="card-title" id="rg-add-title">Ajouter une clé</h3>
    <p class="small muted">Réservé à l'administrateur. Une clé n'a d'effet que si le code du site la lit : vérifie le nom avant de l'enregistrer.</p>
    <form id="rg-add" novalidate>
      <div class="grid-2">
        <div class="field"><label for="rg-new-key">Nom de la clé</label>
          <input id="rg-new-key" name="key" maxlength="41" autocomplete="off" placeholder="ex. message_accueil" required aria-describedby="rg-new-key-h">
          <span class="small muted" id="rg-new-key-h">Lettres minuscules, chiffres et tiret bas, à partir d'une lettre (2 à 41 caractères).</span></div>
        <div class="field"><label for="rg-new-kind">Type</label>
          <select id="rg-new-kind" name="kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
      </div>
      <div id="rg-new-value">${controlHtml('rg-new-v', 'text', '')}</div>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row"><button class="btn btn-primary" type="submit">Ajouter la clé</button></div>
    </form>
  </section>`;
}

function readControl(scope, kind) {
  const el = scope.querySelector('[name="v"]');
  return kind === 'bool' ? el.checked : el.value;
}

async function onSubmit(e) {
  const form = e.target;
  if (form.matches('.rg-form')) { e.preventDefault(); return saveRow(form, e.submitter); }
  if (form.id === 'rg-add') { e.preventDefault(); return addKey(form, e.submitter); }
}

async function saveRow(form, btn) {
  const key = form.dataset.key, kind = form.dataset.kind;
  const err = form.querySelector('.form-error');
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  err.hidden = true;
  if (!canEdit(key)) return fail('Cette clé est en lecture seule ici.');
  const res = parseValue(kind, readControl(form, kind));
  if (res.error) return fail(res.error);
  if (isSensitive(key)) {
    const ok = await confirmBox(`Modifier la clé « ${key} » ?`,
      'C\'est une clé technique sensible : une valeur incorrecte peut casser une fonction du site.',
      { ok: 'Modifier la clé', danger: true });
    if (!ok) return;
  }
  if (btn) btn.disabled = true;
  try {
    const { data, error } = await sb.from('hg_settings').update({ value: res.value, updated_at: nowIso() }).eq('key', key).select('key');
    if (error) throw error;
    if (!data?.length) throw new Error('aucune ligne modifiée (droits insuffisants ?)');
    toast(`« ${KEYS[key]?.label || key} » enregistré.`, 'ok');
    await load();
  } catch (ex) {
    fail(`Enregistrement impossible : ${errMsg(ex)}`);
  } finally {
    if (btn?.isConnected) btn.disabled = false;
  }
}

async function addKey(form, btn) {
  const err = form.querySelector('.form-error');
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  err.hidden = true;
  const key = form.elements.key.value.trim();
  const kind = form.elements.kind.value;
  if (!KEY_RE.test(key)) return fail('Le nom doit faire 2 à 41 caractères : lettres minuscules, chiffres ou tiret bas, à partir d\'une lettre.');
  if (R.rows.some((r) => r.key === key)) return fail('Cette clé existe déjà : modifie-la dans la liste.');
  if (managedOf(key)) return fail(`Cette clé se règle dans la section « ${managedOf(key).managedLabel} ».`);
  const res = parseValue(kind, readControl(form, kind));
  if (res.error) return fail(res.error);
  if (btn) btn.disabled = true;
  try {
    const { error } = await sb.from('hg_settings').insert({ key, value: res.value, updated_at: nowIso() });
    if (error) throw error;
    toast(`Clé « ${key} » ajoutée.`, 'ok');
    await load();
  } catch (ex) {
    fail(ex?.code === '23505' ? 'Cette clé existe déjà.' : `Ajout impossible : ${errMsg(ex)}`);
  } finally {
    if (btn?.isConnected) btn.disabled = false;
  }
}

function onClick(e) {
  const b = e.target.closest('[data-rg]');
  if (b?.dataset.rg === 'retry') { R.error = null; render(); load(); }
}

function onChange(e) {
  const sel = e.target;
  if (sel.id !== 'rg-new-kind') return;
  const kind = sel.value;
  const box = $('#rg-new-value', R.root);
  if (box) box.innerHTML = controlHtml('rg-new-v', kind, kind === 'bool' ? false : '');
}
