// =====================================================================
// Admin : section « Réglages du site ». Liste des clés de hg_settings ; modification et ajout dans un tiroir (typé et validé).
// Les clés gérées dans une autre section sont en lecture seule (lien vers cette section).
// Les clés sensibles ne sont modifiables que par l'administrateur (getCachedProfile()?.is_admin).
// Remarque : la politique RLS de hg_settings accepte aussi les Staff « reglages » pour toutes les clés ;
// la restriction des clés sensibles est donc faite ici, côté interface, et doit aussi être posée en base.
// Dépendances : core.js, core/profile.js (profil en cache), ui-confirm.js, admin/ui/drawer.js, admin/shell.js,
// keys.js (registre et validation des valeurs), identite.js (formulaire « Identité et textes »).
// Exporte : mountReglagesSection (monte la section), reglagesActions (boutons de l'en-tête),
// showReglagesPart (partie affichée : identite | textes | menu | etat = formulaire, cles = liste des clés avancées).
// =====================================================================
import { sb, toast, errMsg, esc, $, fmtDateTime } from '../core.js';
import { getCachedProfile } from '../core/profile.js';
import { confirmBox } from '../ui-confirm.js';
import { openDrawer } from '../admin/ui/drawer.js';
import { KEYS, KIND_LABEL, KEY_RE, isSensitive, managedOf, kindOf, parseValue, displayValue } from './keys.js';
import { mountIdentite, showIdentitePart } from './identite.js';
import { PARTS_LOT1 } from './keys-lot1.js';

/* part : partie affichée (null = formulaire et liste, comportement d'origine). */
const R = { root: null, rows: [], loaded: false, error: null, isAdmin: false, part: null };

/**
 * Partie de la section à afficher. identite | textes | menu | etat : le formulaire « Identité et textes »
 * réduit à cette partie, la liste des clés masquée ; cles : la liste des clés avancées seule ; null : tout.
 * Peut être appelée avant le montage : le choix est mémorisé. À appeler avant reglagesActions().
 * @param {string|null} part partie à afficher.
 */
export function showReglagesPart(part) {
  R.part = part === 'cles' || PARTS_LOT1[part] ? part : null;
  showIdentitePart(R.part === 'cles' ? null : R.part);
  const idRoot = document.getElementById('identite-root');
  const keysRoot = R.root || document.getElementById('reglages-root');
  if (idRoot) idRoot.hidden = R.part === 'cles';
  if (keysRoot) keysRoot.hidden = !!R.part && R.part !== 'cles';
}

/* Vrai si la clé peut être modifiée ici : pas gérée ailleurs, et seul l'admin touche aux clés sensibles. */
const canEdit = (key) => !managedOf(key) && (!isSensitive(key) || R.isAdmin);
/* Date actuelle au format ISO, pour le champ updated_at. */
const nowIso = () => new Date().toISOString();

/** Point d'entrée (admin.js). */
export async function mountReglagesSection(root) {
  if (!root) return;
  R.root = root;
  R.isAdmin = !!getCachedProfile()?.is_admin;
  root.addEventListener('click', onClick);
  render();
  mountIdentite(document.getElementById('identite-root')); // formulaire « Identité et textes » (lot 1), au-dessus de la liste
  showReglagesPart(R.part); // partie choisie avant le montage, s'il y en a une
  await load();
}

/** Boutons de l'en-tête de zone (admin.js, à chaque visite) : « + Nouvelle clé » pour l'administrateur. */
export function reglagesActions() {
  if (!R.isAdmin || (R.part && R.part !== 'cles')) return [];
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn btn-primary btn-sm'; b.textContent = '+ Nouvelle clé'; b.dataset.rgAdd = '';
  b.addEventListener('click', () => openAddDrawer(b));
  return [b];
}

/** Relit toutes les clés de hg_settings puis redessine la liste. Une erreur est affichée dans la section. */
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

/** Clés listées ici : celles qui ont un formulaire dédié (site_identite, site_textes) sont exclues. */
const listRows = () => R.rows.filter((r) => !KEYS[r.key]?.formulaire);

/** Dessine la liste des réglages (ou un message de chargement, d'erreur ou d'absence de réglage). */
function render() {
  if (!R.root) return;
  R.root.innerHTML = `
    <h3 class="rgi-title rg-keys-title">Clés avancées</h3>
    <p class="small muted">Réglages techniques du site : chaque clé porte une valeur (texte, nombre, oui / non ou JSON). Le code du site décide de l'effet d'une clé. Une clé gérée dans une autre section se modifie là-bas.</p>
    ${R.error ? `<div class="empty">Impossible de charger les réglages : ${esc(R.error)} <button class="btn btn-ghost btn-sm" type="button" data-rg="retry">Réessayer</button></div>` : ''}
    ${!R.loaded && !R.error ? '<div class="empty">Chargement des réglages…</div>' : ''}
    ${R.loaded && !listRows().length ? '<div class="empty">Aucun réglage enregistré.</div>' : ''}
    ${R.loaded && listRows().length ? `<ul class="rg-list">${listRows().map((r, i) => itemHtml(r, i)).join('')}</ul>` : ''}`;
}

/** Une ligne de la liste : nom, clé, badges, résumé de la valeur et bouton Modifier ou Voir. */
function itemHtml(r) {
  const meta = KEYS[r.key] || {};
  const label = meta.label || r.key;
  const managed = managedOf(r.key);
  const kind = kindOf(r.value);
  const badges = [
    managed ? `<span class="pill">Géré dans « ${esc(managed.managedLabel)} »</span>` : '',
    isSensitive(r.key) ? '<span class="pill pill-todo">Sensible : admin seulement</span>' : '',
    meta.label ? '' : '<span class="pill pill-muted">Clé non documentée</span>',
  ].join('');
  const summary = displayValue(r.value).replace(/\s+/g, ' ').trim();
  const action = canEdit(r.key)
    ? `<button class="btn btn-ghost btn-sm" type="button" data-rg-edit="${esc(r.key)}" aria-label="Modifier « ${esc(label)} »">Modifier</button>`
    : `<button class="btn btn-ghost btn-sm" type="button" data-rg-edit="${esc(r.key)}" aria-label="Voir « ${esc(label)} » (lecture seule)">Voir</button>`;
  return `<li class="rg-row" data-key-item="${esc(r.key)}">
    <div class="rg-main">
      <div class="rg-head"><h3 class="rg-title">${esc(label)}</h3><code class="acd-code">${esc(r.key)}</code>${badges}</div>
      <p class="rg-sum">${esc(summary.length > 110 ? `${summary.slice(0, 109)}…` : summary)}</p>
      <p class="small muted rg-meta">${esc(KIND_LABEL[kind])}${r.updated_at ? ` · mis à jour le ${esc(fmtDateTime(r.updated_at))}` : ''}</p>
    </div>
    <div class="rg-act">${action}</div>
  </li>`;
}

/** Corps d'édition d'une clé (formulaire typé). L'élément de valeur s'appelle toujours « v ». */
function editBody(r) {
  const kind = kindOf(r.value);
  const meta = KEYS[r.key] || {};
  const help = meta.help || 'Aucune description pour cette clé : vérifie à quoi elle sert avant de la modifier.';
  const managed = managedOf(r.key);
  const div = document.createElement('div');
  div.className = 'rg-form';
  div.dataset.key = r.key;
  div.dataset.kind = kind;
  div.innerHTML = canEdit(r.key)
    ? `<p class="small muted">${esc(help)}</p>
       ${controlHtml(`rg-v-${esc(r.key)}`, kind, r.value)}
       <p class="form-error" role="alert" hidden></p>`
    : `<p class="small muted">${esc(help)}</p>
       ${managed ? `<p class="small"><a href="${esc(managed.managed)}">Ouvrir la section « ${esc(managed.managedLabel)} »</a></p>` : ''}
       <pre class="rg-pre">${esc(displayValue(r.value))}</pre>`;
  return div;
}

/** Ouvre le tiroir d'une clé : modification si permise, sinon lecture seule. */
function openEdit(key) {
  const r = R.rows.find((x) => x.key === key);
  if (!r) return;
  const label = KEYS[key]?.label || key;
  const body = editBody(r);
  if (!canEdit(key)) {
    openDrawer({ title: label, subtitle: key, body, submitLabel: 'Fermer', cancelLabel: 'Retour', wide: false });
    return;
  }
  openDrawer({
    title: label, subtitle: key, body, submitLabel: 'Enregistrer', wide: false,
    onSubmit: () => saveRow(body),
  });
}

/** Champ de saisie selon le type. */
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

/** Tiroir « Ajouter une clé » (administrateur). */
function openAddDrawer() {
  const body = document.createElement('div');
  body.className = 'rg-add';
  body.id = 'rg-add';
  body.innerHTML = `
    <p class="small muted">Une clé n'a d'effet que si le code du site la lit : vérifie le nom avant de l'enregistrer.</p>
    <div class="field"><label for="rg-new-key">Nom de la clé</label>
      <input id="rg-new-key" name="key" maxlength="41" autocomplete="off" placeholder="ex. message_accueil" required aria-describedby="rg-new-key-h">
      <span class="small muted" id="rg-new-key-h">Lettres minuscules, chiffres et tiret bas, à partir d'une lettre (2 à 41 caractères).</span></div>
    <div class="field"><label for="rg-new-kind">Type</label>
      <select id="rg-new-kind" name="kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
    <div id="rg-new-value">${controlHtml('rg-new-v', 'text', '')}</div>
    <p class="form-error" role="alert" hidden></p>`;
  body.addEventListener('change', (e) => {
    if (e.target.id !== 'rg-new-kind') return;
    const kind = e.target.value;
    $('#rg-new-value', body).innerHTML = controlHtml('rg-new-v', kind, kind === 'bool' ? false : '');
  });
  openDrawer({
    title: 'Ajouter une clé', subtitle: 'Réservé à l’administrateur', body, submitLabel: 'Ajouter la clé', wide: false,
    onSubmit: () => addKey(body),
  });
}

/** Valeur brute du champ « v » d'un formulaire : case cochée ou texte saisi. */
function readControl(scope, kind) {
  const el = scope.querySelector('[name="v"]');
  return kind === 'bool' ? el.checked : el.value;
}

/** Enregistre la valeur d'une clé. Renvoie false si le tiroir doit rester ouvert. */
async function saveRow(form) {
  const key = form.dataset.key, kind = form.dataset.kind;
  const err = form.querySelector('.form-error');
  /* Affiche le message d'erreur dans le formulaire et renvoie false pour arrêter l'envoi. */
  const fail = (m) => { err.textContent = m; err.hidden = false; return false; };
  err.hidden = true;
  if (!canEdit(key)) return fail('Cette clé est en lecture seule ici.');
  const res = parseValue(kind, readControl(form, kind));
  if (res.error) return fail(res.error);
  if (isSensitive(key)) {
    const ok = await confirmBox(`Modifier la clé « ${key} » ?`,
      'C\'est une clé technique sensible : une valeur incorrecte peut casser une fonction du site.',
      { ok: 'Modifier la clé', danger: true });
    if (!ok) return false;
  }
  try {
    const { data, error } = await sb.from('hg_settings').update({ value: res.value, updated_at: nowIso() }).eq('key', key).select('key');
    if (error) throw error;
    if (!data?.length) throw new Error('aucune ligne modifiée (droits insuffisants ?)');
    toast(`« ${KEYS[key]?.label || key} » enregistré.`, 'ok');
    await load();
    return true;
  } catch (ex) {
    return fail(`Enregistrement impossible : ${errMsg(ex)}`);
  }
}

/**
 * Valide le nom et la valeur d'une nouvelle clé, puis l'insère dans hg_settings.
 * Une clé déjà existante, ou gérée ailleurs, est refusée.
 * @param {HTMLElement} scope tiroir d'ajout.
 * @returns {Promise<boolean>} true si la clé est ajoutée, false si le tiroir doit rester ouvert.
 */
async function addKey(scope) {
  const err = scope.querySelector('.form-error');
  /* Affiche le message d'erreur dans le formulaire et renvoie false pour arrêter l'envoi. */
  const fail = (m) => { err.textContent = m; err.hidden = false; return false; };
  err.hidden = true;
  const key = scope.querySelector('#rg-new-key').value.trim();
  const kind = scope.querySelector('#rg-new-kind').value;
  if (!KEY_RE.test(key)) return fail('Le nom doit faire 2 à 41 caractères : lettres minuscules, chiffres ou tiret bas, à partir d\'une lettre.');
  if (R.rows.some((r) => r.key === key)) return fail('Cette clé existe déjà : modifie-la dans la liste.');
  if (managedOf(key)) return fail(`Cette clé se règle dans la section « ${managedOf(key).managedLabel} ».`);
  const res = parseValue(kind, readControl(scope, kind));
  if (res.error) return fail(res.error);
  try {
    const { error } = await sb.from('hg_settings').insert({ key, value: res.value, updated_at: nowIso() });
    if (error) throw error;
    toast(`Clé « ${key} » ajoutée.`, 'ok');
    await load();
    return true;
  } catch (ex) {
    return fail(ex?.code === '23505' ? 'Cette clé existe déjà.' : `Ajout impossible : ${errMsg(ex)}`);
  }
}

/** Délégation des clics : Réessayer, ou ouvrir l'édition d'une clé. */
function onClick(e) {
  const b = e.target.closest('[data-rg], [data-rg-edit]');
  if (!b) return;
  if (b.dataset.rg === 'retry') { R.error = null; render(); load(); return; }
  if (b.dataset.rgEdit) openEdit(b.dataset.rgEdit);
}
