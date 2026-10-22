// ===== Humane Gang — administration : champs du profil (« Mes informations ») =====
/*
 * Rôle : Membres › Champs du profil. Éditeur structuré du réglage hg_settings.profile_fields
 * ({ groups: [ { id, label, fields: [ { id, label, type: 'text' | 'textarea', placeholder? } ] } ] }) :
 * groupes et champs (libellé, type, exemple), ordre ↑ ↓, ajout et retrait.
 * Les identifiants déjà enregistrés sont figés : les réponses des membres (hg_profile_info.data) et les champs
 * transmis au Santa (hg_ss_editions.shared_fields) en dépendent. Un nouvel identifiant se déduit du libellé
 * et reste modifiable jusqu'au premier enregistrement.
 * Mêmes règles que le site (validateInfoGroups de profile-fields.js) : 1 à 12 groupes, 1 à 60 champs par groupe,
 * identifiants uniques. Le JSON brut reste modifiable dans Site › Clés avancées.
 * Écriture : admin et Staff « reglages » (RLS hg_settings_admin, hg_settings_perm('profile_fields') = 'reglages').
 * Route : #membres/champs (branchée par admin.js). Section : <section id="champs">, conteneur #champs-root.
 * Dépendances : core.js (sb, toast, errMsg, esc, hasPerm), profile-fields.js (liste en cours, validation, liste d'origine
 * si elle est exportée), ui-confirm.js (confirmations).
 * Exporte : mountChampsSection, slugId.
 */
import { sb, toast, errMsg, esc, hasPerm } from './core.js';
import * as PF from './profile-fields.js';
import { confirmBox } from './ui-confirm.js';

/* ---------- Constantes ---------- */

/** Forme d'un identifiant (même règle que profile-fields.js). */
const ID_RE = /^[a-z][a-z0-9_]{1,40}$/;
/** Limites (mêmes que validateInfoGroups). */
const MAX_GROUPS = 12, MAX_FIELDS = 60, MAX_LABEL = 160, MAX_PLACEHOLDER = 80;
/** Types de champ proposés. */
const TYPES = [['text', 'Une ligne'], ['textarea', 'Plusieurs lignes']];

/* ---------- État de la section ---------- */
// groups : modèle édité ; raw : valeur lue en base (clés inconnues conservées) ; open : groupes dépliés (par clé interne).
const C = { root: null, raw: null, groups: [], open: new Set(), seq: 0, error: null, busy: false, dirty: false };

/* ---------- Outils ---------- */

/**
 * Identifiant tiré d'un libellé : minuscules sans accents, « _ » entre les mots, commence par une lettre, 41 caractères au plus.
 * @param {string} label Libellé.
 * @returns {string} Identifiant (peut être vide si le libellé ne contient aucune lettre ni chiffre).
 */
export function slugId(label) {
  let s = String(label ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (s && !/^[a-z]/.test(s)) s = `c_${s}`;
  return s.slice(0, 41).replace(/_+$/, '');
}

/** Clé interne unique (pour les éléments de la page, indépendante de l'identifiant). */
const key = () => `k${++C.seq}`;
/** Tous les identifiants utilisés (groupes et champs séparés), sauf l'élément exclu. */
const usedIds = (kind, except) => new Set((kind === 'group' ? C.groups : C.groups.flatMap((g) => g.fields)).filter((x) => x !== except).map((x) => x.id));
/**
 * Identifiant libre dérivé d'un libellé (suffixe _2, _3… si déjà pris).
 * @param {string} label
 * @param {'group'|'field'} kind
 * @param {object} self Élément concerné (exclu de la recherche de doublons).
 * @returns {string}
 */
function freeId(label, kind, self) {
  const base = slugId(label) || (kind === 'group' ? 'groupe' : 'champ');
  const used = usedIds(kind, self);
  if (!used.has(base) && ID_RE.test(base)) return base;
  for (let i = 2; i < 1000; i++) { const id = `${base.slice(0, 37)}_${i}`; if (!used.has(id)) return id; }
  return `${base.slice(0, 30)}_${Date.now().toString(36)}`;
}

/**
 * Modèle d'édition à partir d'une liste de groupes (identifiants considérés comme enregistrés : figés).
 * @param {Array<object>} groups
 * @param {boolean} saved Vrai si les identifiants sont déjà en base (ou dans la liste d'origine utilisée par le site).
 */
function toModel(groups, saved = true) {
  return groups.map((g) => ({ k: key(), id: g.id, label: g.label, saved,
    fields: g.fields.map((f) => ({ k: key(), id: f.id, label: f.label, type: f.type, placeholder: f.placeholder || '', saved })) }));
}

/** Liste d'origine du site, si profile-fields.js l'exporte (sinon null). */
const defaultGroups = () => (Array.isArray(PF.DEFAULT_INFO_GROUPS) ? PF.DEFAULT_INFO_GROUPS : null);
/** Vrai si l'utilisateur peut enregistrer. */
const canWrite = () => hasPerm('reglages');

/* ---------- Montage et chargement ---------- */

/**
 * Monte l'éditeur dans son conteneur : lit le réglage en base (pas le cache de la page).
 * @param {HTMLElement} root Conteneur (#champs-root).
 * @returns {Promise<void>}
 */
export async function mountChampsSection(root) {
  if (!root) return;
  C.root = root;
  root.innerHTML = '<div class="empty">Chargement des champs du profil…</div>';
  if (!root.dataset.achBound) {
    root.dataset.achBound = '1';
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('toggle', onToggle, true);
  }
  await load();
}

/** Lit la clé profile_fields ; sans elle (ou invalide), part de la liste utilisée par le site. */
async function load() {
  try {
    const { data, error } = await sb.from('hg_settings').select('key, value').eq('key', 'profile_fields').maybeSingle();
    if (error) throw error;
    C.raw = data?.value && typeof data.value === 'object' && !Array.isArray(data.value) ? data.value : null;
    const saved = C.raw ? PF.validateInfoGroups(C.raw.groups) : null;
    C.groups = toModel(saved || defaultGroups() || PF.INFO_GROUPS);
    C.error = C.raw && !saved ? 'Le réglage enregistré est invalide : le site utilise la liste d’origine. Enregistre pour le remplacer.' : null;
  } catch (e) {
    C.raw = null;
    C.groups = toModel(PF.INFO_GROUPS);
    C.error = `Impossible de lire le réglage : ${errMsg(e)}. Liste actuelle du site affichée.`;
  }
  C.open = new Set(C.groups.slice(0, 1).map((g) => g.k));
  C.dirty = false;
  render();
}

/* ---------- Affichage ---------- */

/**
 * Boutons d'ordre et de retrait d'une ligne (groupe ou champ).
 * @param {string} scope 'g' ou 'f'.
 * @param {string} k Clé interne.
 * @param {number} i Position.
 * @param {number} n Nombre d'éléments.
 * @param {string} nom Nom lisible (pour les libellés accessibles).
 * @param {boolean} ro Lecture seule.
 * @returns {string} HTML
 */
function moveHtml(scope, k, i, n, nom, ro) {
  if (ro) return '';
  const quoi = scope === 'g' ? 'le groupe' : 'le champ';
  return `<div class="ach-moves">
    <button class="ach-icon" type="button" data-ach="up" data-scope="${scope}" data-k="${k}" aria-label="Monter ${quoi} « ${esc(nom)} »"${i === 0 ? ' disabled' : ''}>↑</button>
    <button class="ach-icon" type="button" data-ach="down" data-scope="${scope}" data-k="${k}" aria-label="Descendre ${quoi} « ${esc(nom)} »"${i === n - 1 ? ' disabled' : ''}>↓</button>
    <button class="ach-icon ach-remove" type="button" data-ach="remove" data-scope="${scope}" data-k="${k}" aria-label="Retirer ${quoi} « ${esc(nom)} »">×</button>
  </div>`;
}

/**
 * Champ « identifiant » : texte figé si enregistré, sinon modifiable.
 * @param {object} x Groupe ou champ du modèle.
 * @param {string} scope 'g' ou 'f'.
 * @param {boolean} ro
 * @returns {string} HTML
 */
function idHtml(x, scope, ro) {
  const id = `ach-${x.k}-id`;
  if (x.saved || ro) return `<p class="ach-id small muted">Identifiant : <code>${esc(x.id)}</code>${x.saved ? ' <span class="ach-lock">(figé)</span>' : ''}</p>`;
  return `<div class="field ach-id-edit"><label for="${id}">Identifiant (modifiable jusqu’à l’enregistrement)</label>
    <input id="${id}" type="text" data-k="${x.k}" data-prop="id" value="${esc(x.id)}" maxlength="41" spellcheck="false" autocomplete="off" pattern="[a-z][a-z0-9_]{1,40}"></div>`;
}

/**
 * Une ligne de champ.
 * @param {object} f Champ du modèle.
 * @param {number} i Position dans le groupe.
 * @param {number} n Nombre de champs du groupe.
 * @param {boolean} ro
 * @returns {string} HTML
 */
function fieldHtml(f, i, n, ro) {
  const p = `ach-${f.k}`;
  return `<li class="ach-field" data-k="${f.k}">
    <div class="ach-field-main">
      <div class="field ach-label"><label for="${p}-l">Libellé</label>
        <input id="${p}-l" type="text" data-k="${f.k}" data-prop="label" value="${esc(f.label)}" maxlength="${MAX_LABEL}" required${ro ? ' disabled' : ''}></div>
      <div class="field ach-type"><label for="${p}-t">Type</label>
        <select id="${p}-t" data-k="${f.k}" data-prop="type"${ro ? ' disabled' : ''}>${TYPES.map(([v, l]) => `<option value="${v}"${f.type === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field ach-ph"><label for="${p}-p">Exemple (facultatif)</label>
        <input id="${p}-p" type="text" data-k="${f.k}" data-prop="placeholder" value="${esc(f.placeholder)}" maxlength="${MAX_PLACEHOLDER}"${ro ? ' disabled' : ''}></div>
    </div>
    ${moveHtml('f', f.k, i, n, f.label || f.id, ro)}
    <div class="ach-field-foot">${idHtml(f, 'f', ro)}</div>
  </li>`;
}

/** Dessine l'éditeur complet. */
function render() {
  const ro = !canWrite();
  const n = C.groups.length;
  const total = C.groups.reduce((s, g) => s + g.fields.length, 0);
  C.root.innerHTML = `<div class="ach">
    <p class="small muted ach-intro">Les champs du formulaire « Mes informations » (page Compte), transmis au Santa selon les réglages de chaque édition. ${n} groupe${n > 1 ? 's' : ''}, ${total} champ${total > 1 ? 's' : ''}. Un identifiant enregistré ne change plus : les réponses des membres y sont rattachées.</p>
    ${C.error ? `<p class="ach-warn" role="note">${esc(C.error)}</p>` : ''}
    ${ro ? '<p class="ach-warn" role="note">Lecture seule : il faut le droit « Réglages du site » pour modifier les champs.</p>' : ''}
    <form id="ach-form" class="ach-form" novalidate>
      <ol class="ach-groups">${C.groups.map((g, gi) => `<li class="ach-group" data-k="${g.k}">
        <details${C.open.has(g.k) ? ' open' : ''} data-k="${g.k}">
          <summary class="ach-summary"><span class="ach-summary-title">${esc(g.label || 'Groupe sans nom')}</span>
            <span class="small muted">${g.fields.length} champ${g.fields.length > 1 ? 's' : ''}</span></summary>
          <div class="ach-group-body">
            <div class="ach-group-head">
              <div class="field ach-label"><label for="ach-${g.k}-l">Nom du groupe</label>
                <input id="ach-${g.k}-l" type="text" data-k="${g.k}" data-prop="label" value="${esc(g.label)}" maxlength="${MAX_LABEL}" required${ro ? ' disabled' : ''}></div>
              <div class="ach-field-foot">${idHtml(g, 'g', ro)}${moveHtml('g', g.k, gi, n, g.label || g.id, ro)}</div>
            </div>
            <ol class="ach-fields">${g.fields.map((f, fi) => fieldHtml(f, fi, g.fields.length, ro)).join('')}</ol>
            ${ro ? '' : `<button class="btn btn-ghost btn-sm ach-add" type="button" data-ach="add-field" data-k="${g.k}"${g.fields.length >= MAX_FIELDS ? ' disabled' : ''}>+ Ajouter un champ à « ${esc(g.label || 'ce groupe')} »</button>`}
          </div>
        </details>
      </li>`).join('')}</ol>
      ${ro ? '' : `<div class="ach-actions">
        <button class="btn btn-ghost" type="button" data-ach="add-group"${n >= MAX_GROUPS ? ' disabled' : ''}>+ Ajouter un groupe</button>
        <button class="btn btn-ghost" type="button" data-ach="defaults">Rétablir la liste d’origine</button>
        <span class="ach-spacer"></span>
        <button class="btn btn-primary" type="submit" id="ach-save">Enregistrer les champs</button>
      </div>`}
      <div class="ach-status" id="ach-status" role="alert" aria-live="assertive"></div>
    </form>
  </div>`;
}

/* ---------- Modèle ---------- */

/** Retrouve un groupe ou un champ par sa clé interne : { item, list, group }. */
function find(k) {
  for (const g of C.groups) {
    if (g.k === k) return { item: g, list: C.groups, group: g };
    const f = g.fields.find((x) => x.k === k);
    if (f) return { item: f, list: g.fields, group: g };
  }
  return null;
}

/**
 * Erreurs du modèle (messages lisibles), dans l'ordre d'affichage.
 * @returns {Array<{k: string, prop: string, msg: string}>}
 */
function validate() {
  const errs = [];
  if (!C.groups.length) errs.push({ k: '', prop: '', msg: 'Il faut au moins un groupe.' });
  if (C.groups.length > MAX_GROUPS) errs.push({ k: '', prop: '', msg: `${MAX_GROUPS} groupes au maximum.` });
  const gIds = new Set(), fIds = new Set();
  for (const g of C.groups) {
    const gn = `Groupe « ${g.label || g.id || 'sans nom'} »`;
    if (!g.label.trim()) errs.push({ k: g.k, prop: 'label', msg: `${gn} : le nom est obligatoire.` });
    if (!ID_RE.test(g.id)) errs.push({ k: g.k, prop: 'id', msg: `${gn} : identifiant invalide (minuscules, chiffres et « _ », commence par une lettre, 2 à 41 caractères).` });
    else if (gIds.has(g.id)) errs.push({ k: g.k, prop: 'id', msg: `${gn} : identifiant « ${g.id} » déjà utilisé par un autre groupe.` });
    gIds.add(g.id);
    if (!g.fields.length) errs.push({ k: g.k, prop: '', msg: `${gn} : il faut au moins un champ (ou retire le groupe).` });
    if (g.fields.length > MAX_FIELDS) errs.push({ k: g.k, prop: '', msg: `${gn} : ${MAX_FIELDS} champs au maximum.` });
    for (const f of g.fields) {
      const fn = `Champ « ${f.label || f.id || 'sans nom'} » (${g.label || g.id})`;
      if (!f.label.trim()) errs.push({ k: f.k, prop: 'label', msg: `${fn} : le libellé est obligatoire.` });
      if (!ID_RE.test(f.id)) errs.push({ k: f.k, prop: 'id', msg: `${fn} : identifiant invalide (minuscules, chiffres et « _ », commence par une lettre, 2 à 41 caractères).` });
      else if (fIds.has(f.id)) errs.push({ k: f.k, prop: 'id', msg: `${fn} : identifiant « ${f.id} » déjà utilisé par un autre champ.` });
      fIds.add(f.id);
    }
  }
  return errs;
}

/** Liste prête à enregistrer (même forme que le site). */
const toValue = () => C.groups.map((g) => ({ id: g.id, label: g.label.trim(),
  fields: g.fields.map((f) => ({ id: f.id, label: f.label.trim(), type: f.type, ...(f.placeholder.trim() ? { placeholder: f.placeholder.trim() } : {}) })) }));

/** Message d'état (liste d'erreurs ou texte). */
function status(html, tone = '') {
  const el = C.root.querySelector('#ach-status');
  if (!el) return;
  el.innerHTML = html;
  el.dataset.tone = tone;
}

/* ---------- Événements ---------- */

/** Saisie : met le modèle à jour (sans redessiner) ; l'identifiant d'un nouvel élément suit son libellé. */
function onInput(ev) {
  const t = ev.target, k = t?.dataset?.k, prop = t?.dataset?.prop;
  if (!k || !prop) return;
  const hit = find(k);
  if (!hit) return;
  const x = hit.item;
  C.dirty = true;
  t.removeAttribute('aria-invalid');
  if (prop === 'id') { x.id = t.value.trim(); x.idTouched = true; return; }
  x[prop] = t.value;
  if (prop === 'label' && !x.saved && !x.idTouched) {
    x.id = freeId(t.value, hit.list === C.groups ? 'group' : 'field', x);
    const idInput = C.root.querySelector(`#ach-${x.k}-id`);
    if (idInput) idInput.value = x.id;
  }
  if (prop === 'label' && hit.list === C.groups) {
    const s = C.root.querySelector(`details[data-k="${x.k}"] .ach-summary-title`);
    if (s) s.textContent = t.value || 'Groupe sans nom';
  }
}

/** Mémorise les groupes dépliés (gardés après un nouveau rendu). */
function onToggle(ev) {
  const d = ev.target;
  if (d.tagName !== 'DETAILS' || !d.dataset.k) return;
  if (d.open) C.open.add(d.dataset.k); else C.open.delete(d.dataset.k);
}

/**
 * Redessine puis remet le focus sur l'élément désigné (s'il existe encore).
 * @param {string} [sel] Sélecteur à focaliser.
 */
function rerender(sel) {
  render();
  if (sel) C.root.querySelector(sel)?.focus();
}

/** Boutons : ordre, retrait, ajout, liste d'origine. */
async function onClick(ev) {
  const b = ev.target.closest('[data-ach]');
  if (!b || !C.root.contains(b) || C.busy) return;
  const act = b.dataset.ach, k = b.dataset.k;
  if (act === 'up' || act === 'down') {
    const hit = find(k);
    if (!hit) return;
    const i = hit.list.indexOf(hit.item), j = act === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= hit.list.length) return;
    [hit.list[i], hit.list[j]] = [hit.list[j], hit.list[i]];
    C.dirty = true;
    render();
    // Le focus reste sur le même bouton ; au bord de la liste (bouton désactivé), il passe au sens inverse
    const same = C.root.querySelector(`[data-ach="${act}"][data-k="${k}"]`);
    (same && !same.disabled ? same : C.root.querySelector(`[data-ach="${act === 'up' ? 'down' : 'up'}"][data-k="${k}"]`))?.focus();
    return;
  }
  if (act === 'remove') {
    const hit = find(k);
    if (!hit) return;
    const isGroup = hit.list === C.groups;
    const nom = hit.item.label || hit.item.id;
    if (hit.item.saved) {
      const ok = await confirmBox(isGroup ? `Retirer le groupe « ${nom} » ?` : `Retirer le champ « ${nom} » ?`,
        isGroup ? 'Ses champs disparaissent du formulaire. Les réponses déjà saisies restent en base, invisibles ; un champ recréé avec le même identifiant les retrouve.'
          : 'Il disparaît du formulaire. Les réponses déjà saisies restent en base, invisibles ; un champ recréé avec le même identifiant les retrouve.',
        { ok: 'Retirer', danger: true });
      if (!ok) { b.focus(); return; }
    }
    hit.list.splice(hit.list.indexOf(hit.item), 1);
    C.dirty = true;
    rerender(isGroup ? '[data-ach="add-group"]' : `[data-ach="add-field"][data-k="${hit.group.k}"]`);
    return;
  }
  if (act === 'add-field') {
    const g = find(k)?.item;
    if (!g || g.fields.length >= MAX_FIELDS) return;
    const f = { k: key(), id: '', label: '', type: 'text', placeholder: '', saved: false };
    g.fields.push(f);
    f.id = freeId('', 'field', f);
    C.open.add(g.k);
    C.dirty = true;
    rerender(`#ach-${f.k}-l`);
    return;
  }
  if (act === 'add-group') {
    if (C.groups.length >= MAX_GROUPS) return;
    const g = { k: key(), id: '', label: '', saved: false, fields: [] };
    C.groups.push(g);
    g.id = freeId('', 'group', g);
    const f = { k: key(), id: '', label: '', type: 'text', placeholder: '', saved: false };
    g.fields.push(f);
    f.id = freeId('', 'field', f);
    C.open.add(g.k);
    C.dirty = true;
    rerender(`#ach-${g.k}-l`);
    return;
  }
  if (act === 'defaults') await resetDefaults(b);
}

/**
 * « Rétablir la liste d'origine » : remet la liste d'origine dans l'éditeur (à enregistrer) si elle est connue ;
 * sinon, après confirmation, retire la clé profile_fields (le site reprend alors sa liste d'origine).
 * @param {HTMLButtonElement} b Bouton cliqué.
 */
async function resetDefaults(b) {
  const def = defaultGroups();
  if (def) {
    C.groups = toModel(def);
    C.open = new Set(C.groups.slice(0, 1).map((g) => g.k));
    C.dirty = true;
    rerender('[data-ach="defaults"]');
    status('Liste d’origine remise dans l’éditeur : enregistre pour l’appliquer.');
    return;
  }
  const ok = await confirmBox('Rétablir la liste d’origine ?',
    'Le réglage est retiré : le site reprend la liste de champs d’origine. Les réponses aux champs retirés restent en base, invisibles.',
    { ok: 'Rétablir', danger: true });
  if (!ok) { b.focus(); return; }
  C.busy = true;
  try {
    const { error } = await sb.from('hg_settings').delete().eq('key', 'profile_fields');
    if (error) throw error;
    toast('Liste d’origine rétablie');
    C.raw = null;
    C.error = 'Liste d’origine rétablie. Recharge la page pour la voir ici.';
    render();
  } catch (e) {
    status(`Impossible de rétablir la liste : ${esc(errMsg(e))}`, 'error');
  } finally {
    C.busy = false;
  }
}

/** Enregistrement : vérifie, puis upsert de profile_fields (clés inconnues de la valeur conservées). */
async function onSubmit(ev) {
  if (ev.target?.id !== 'ach-form') return;
  ev.preventDefault();
  if (C.busy || !canWrite()) return;
  const errs = validate();
  C.root.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  if (errs.length) {
    for (const e of errs) {
      if (!e.k) continue;
      const el = C.root.querySelector(`[data-k="${e.k}"][data-prop="${e.prop || 'label'}"]`);
      if (el) el.setAttribute('aria-invalid', 'true');
      const d = el?.closest('details');
      if (d && !d.open) { d.open = true; C.open.add(d.dataset.k); }
    }
    status(`<p>${errs.length} point${errs.length > 1 ? 's' : ''} à corriger :</p><ul>${errs.slice(0, 12).map((e) => `<li>${esc(e.msg)}</li>`).join('')}</ul>`, 'error');
    C.root.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  const groups = toValue();
  if (!PF.validateInfoGroups(groups)) { status('La liste n’est pas acceptée par le site (vérifie les libellés et les identifiants).', 'error'); return; }
  const btn = C.root.querySelector('#ach-save');
  C.busy = true;
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  status('Enregistrement…');
  try {
    const value = { ...(C.raw || {}), groups };
    const { error } = await sb.from('hg_settings').upsert({ key: 'profile_fields', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    C.raw = value;
    // Les identifiants sont maintenant enregistrés : figés
    for (const g of C.groups) { g.saved = true; g.idTouched = false; for (const f of g.fields) { f.saved = true; f.idTouched = false; } }
    C.dirty = false;
    C.error = null;
    render();
    status('Champs enregistrés. Ils s’appliquent à la prochaine ouverture des pages.', 'ok');
    toast('Champs du profil enregistrés');
  } catch (e) {
    status(`Enregistrement impossible : ${esc(errMsg(e))}`, 'error');
  } finally {
    C.busy = false;
    const b2 = C.root.querySelector('#ach-save');
    if (b2) { b2.disabled = false; b2.removeAttribute('aria-busy'); }
  }
}
