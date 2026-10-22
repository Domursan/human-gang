// =====================================================================
// Admin › Site › Réglages : formulaire « Identité et textes » (clés site_identite et site_textes de hg_settings).
// Chaque champ a une aide courte, une validation, un bouton « Valeur par défaut » ; chaque groupe a « Rétablir ces valeurs ».
// Seuls les écarts aux valeurs par défaut sont enregistrés (une clé absente = valeur par défaut).
// Dépendances : core.js (sb, toast, errMsg, esc), core/site-defaults.js (valeurs par défaut, buildSite, diffFromDefaults),
// keys-lot1.js (description des champs : GROUPES_LOT1, NAV_AUTO_LABELS).
// Exporte : mountIdentite (monte le formulaire, appelé par view.js).
// =====================================================================
import { sb, toast, errMsg, esc } from '../core.js';
import { SITE_DEFAULTS, buildSite, diffFromDefaults, setSiteRaw, NAV_SLUGS } from '../core/site-defaults.js';
import { GROUPES_LOT1, NAV_AUTO_LABELS } from './keys-lot1.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https:\/\/|assets\/)\S+$/;
const BUCKET = { site_identite: 'identite', site_textes: 'textes' };
const S = { root: null, site: null, error: null };

/* Identifiant HTML d'un champ, dérivé de sa clé (les points deviennent des tirets). */
const fieldId = (k) => `rgi-${k.replace(/[^a-z0-9]/gi, '-')}`;
/* Découpe « cle.champ » en nom de groupe (identite ou textes) et nom du champ. */
const parseK = (k) => { const [cle, champ] = k.split('.'); return { bucket: BUCKET[cle], champ }; };
/* Valeur par défaut d'un champ. Les menus et les liens du pied de page ont leur propre forme. */
const defaultOf = (k) => {
  const { bucket, champ } = parseK(k);
  if (champ === 'nav_libelles') return {};
  if (champ === 'footer_liens') return SITE_DEFAULTS.textes.footer_liens.map((l) => ({ ...l }));
  return SITE_DEFAULTS[bucket][champ];
};
/* Valeur actuellement affichée pour un champ, lue dans le site reconstruit. */
const currentOf = (k) => { const { bucket, champ } = parseK(k); return S.site[bucket][champ]; };
/* Liste à plat de tous les champs du formulaire, dans l'ordre des groupes. */
const allFields = () => GROUPES_LOT1.flatMap((g) => g.champs);

/** Point d'entrée (view.js). Lit les réglages en base (pas le cache) et dessine le formulaire. */
export async function mountIdentite(root) {
  if (!root) return;
  S.root = root;
  root.innerHTML = '<div class="empty">Chargement de l\'identité et des textes…</div>';
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  await load();
}

/** Lit les deux clés dans la base et reconstruit les valeurs du site. En cas d'erreur, affiche les défauts et le message. */
async function load() {
  try {
    const { data, error } = await sb.from('hg_settings').select('key, value').in('key', ['site_identite', 'site_textes']);
    if (error) throw error;
    const raw = { identite: {}, textes: {} };
    for (const r of data ?? []) {
      if (r.key === 'site_identite') raw.identite = r.value ?? {};
      if (r.key === 'site_textes') raw.textes = r.value ?? {};
    }
    S.site = buildSite(raw);
    S.error = null;
  } catch (e) {
    S.error = errMsg(e);
    S.site = buildSite({});
  }
  render();
}

/** HTML d'un champ selon son type (case, menu, liens, texte ou zone de texte). */
function controlHtml(f) {
  const id = fieldId(f.k), v = currentOf(f.k);
  const hint = `<span class="small muted" id="${id}-h">${esc(f.aide || '')}</span>`;
  const err = `<p class="form-error" data-err="${esc(f.k)}" role="alert" hidden></p>`;
  const reset = `<button class="btn btn-ghost btn-sm rgi-reset" type="button" data-reset="${esc(f.k)}">Valeur par défaut</button>`;
  const head = `<div class="rgi-field-head"><label for="${id}">${esc(f.label)}</label>${reset}</div>`;
  if (f.kind === 'bool') {
    return `<div class="rgi-field" data-champ="${esc(f.k)}">
      <label class="switch rgi-switch"><input id="${id}" type="checkbox" data-k="${esc(f.k)}"${v ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>${esc(f.label)}</span></label>
      <div class="rgi-field-foot">${hint}${reset}</div>${err}</div>`;
  }
  if (f.kind === 'nav') {
    const rows = NAV_SLUGS.map((slug) => `<div class="rgi-row"><label for="${id}-${slug}">${esc(NAV_AUTO_LABELS[slug] || slug)}</label>
      <input id="${id}-${slug}" type="text" maxlength="40" data-nav="${slug}" value="${esc(v[slug] || '')}" placeholder="Automatique"></div>`).join('');
    return `<div class="rgi-field" data-champ="${esc(f.k)}">${head}<div class="rgi-rows" role="group" aria-label="${esc(f.label)}">${rows}</div>
      <div class="rgi-field-foot">${hint}</div>${err}</div>`;
  }
  if (f.kind === 'footer') {
    const rows = v.map((l) => `<div class="rgi-row rgi-footer-row">
      <label class="switch rgi-switch"><input type="checkbox" data-footer-vis="${esc(l.id)}"${l.visible ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span class="visually-hidden">Afficher « ${esc(l.label)} »</span></label>
      <input type="text" maxlength="40" data-footer-label="${esc(l.id)}" value="${esc(l.label)}" aria-label="Libellé du lien ${esc(l.id)}"></div>`).join('');
    return `<div class="rgi-field" data-champ="${esc(f.k)}">${head}<div class="rgi-rows" role="group" aria-label="${esc(f.label)}">${rows}</div>
      <div class="rgi-field-foot">${hint}</div>${err}</div>`;
  }
  const tag = f.kind === 'area'
    ? `<textarea id="${id}" rows="3" data-k="${esc(f.k)}" aria-describedby="${id}-h"${f.max ? ` maxlength="${f.max}"` : ''}>${esc(v)}</textarea>`
    : `<input id="${id}" type="${f.kind === 'email' ? 'email' : 'text'}" data-k="${esc(f.k)}" value="${esc(v)}" aria-describedby="${id}-h" autocomplete="off"${f.max ? ` maxlength="${f.max}"` : ''}>`;
  return `<div class="rgi-field" data-champ="${esc(f.k)}">${head}${tag}<div class="rgi-field-foot">${hint}</div>${err}</div>`;
}

/** Dessine le formulaire complet (tous les groupes) dans la zone de la page. */
function render() {
  if (!S.root) return;
  const groups = GROUPES_LOT1.map((g) => `<fieldset class="rgi-group" data-group="${g.id}">
      <legend class="rgi-legend">${esc(g.titre)}</legend>
      <p class="small muted">${esc(g.aide)}</p>
      ${g.champs.map(controlHtml).join('')}
      <div class="rgi-group-foot"><button class="btn btn-ghost btn-sm" type="button" data-reset-group="${g.id}">Rétablir ces valeurs par défaut</button></div>
    </fieldset>`).join('');
  S.root.innerHTML = `<section class="rgi" aria-labelledby="rgi-title">
      <h3 id="rgi-title" class="rgi-title">Identité et textes</h3>
      <p class="small muted">Ce qui se voit sur le site : nom, logo, éditeur, textes et menus. Une valeur vide garde le comportement d'origine, sauf l'éditeur et le contact (« à compléter »). Les modifications s'appliquent à la prochaine ouverture des pages.</p>
      ${S.error ? `<div class="empty">Impossible de charger les réglages : ${esc(S.error)}</div>` : ''}
      <form id="rgi-form" class="rgi-form" novalidate>
        ${groups}
        <div class="rgi-save">
          <p class="form-error" id="rgi-status" role="alert" hidden></p>
          <button class="btn btn-primary" type="submit" id="rgi-save">Enregistrer l'identité et les textes</button>
        </div>
      </form>
    </section>`;
}

/** Valeur saisie d'un champ (typée selon le champ). */
function readField(f) {
  const root = S.root;
  if (f.kind === 'bool') return !!root.querySelector(`input[data-k="${f.k}"]`)?.checked;
  if (f.kind === 'nav') {
    const out = {};
    root.querySelectorAll(`[data-nav]`).forEach((el) => { const t = el.value.trim(); if (t) out[el.dataset.nav] = t; });
    return out;
  }
  if (f.kind === 'footer') {
    return [...root.querySelectorAll('[data-footer-label]')].map((el) => {
      const id = el.dataset.footerLabel;
      const vis = root.querySelector(`[data-footer-vis="${id}"]`);
      return { id, label: el.value.trim(), visible: vis ? vis.checked : true };
    });
  }
  return root.querySelector(`[data-k="${f.k}"]`)?.value.trim() ?? '';
}

/** Écrit une valeur dans le formulaire (bouton « Valeur par défaut »). */
function writeField(f, v) {
  const root = S.root;
  if (f.kind === 'bool') { const el = root.querySelector(`input[data-k="${f.k}"]`); if (el) el.checked = !!v; return; }
  if (f.kind === 'nav') { root.querySelectorAll('[data-nav]').forEach((el) => { el.value = (v && v[el.dataset.nav]) || ''; }); return; }
  if (f.kind === 'footer') {
    v.forEach((l) => {
      const lab = root.querySelector(`[data-footer-label="${l.id}"]`); if (lab) lab.value = l.label;
      const vis = root.querySelector(`[data-footer-vis="${l.id}"]`); if (vis) vis.checked = l.visible;
    });
    return;
  }
  const el = root.querySelector(`[data-k="${f.k}"]`); if (el) el.value = v ?? '';
}

/** Vérifie les valeurs saisies. Renvoie { errors: { k: message } }. */
function validate() {
  const errors = {};
  for (const f of allFields()) {
    const v = readField(f);
    if (f.kind === 'bool') continue;
    if (f.kind === 'nav') continue; // longueur gérée par maxlength
    if (f.kind === 'footer') { if (v.some((l) => !l.label)) errors[f.k] = 'Chaque lien du pied de page a besoin d\'un libellé.'; continue; }
    if (!v && !f.vide) errors[f.k] = f.k === 'site_identite.nom' ? 'Le nom du site ne peut pas être vide.' : 'Ce champ ne peut pas être vide.';
    else if (f.kind === 'email' && v && !EMAIL_RE.test(v)) errors[f.k] = 'Adresse e-mail invalide (ex. contact@exemple.ch).';
    else if (f.kind === 'url' && v && !URL_RE.test(v)) errors[f.k] = 'Commence par https:// ou par assets/.';
    else if (f.max && v.length > f.max) errors[f.k] = `Maximum ${f.max} caractères.`;
  }
  return { errors };
}

/** Lecture complète du formulaire : { identite, textes } avec les valeurs saisies. */
function readAll() {
  const identite = {}, textes = {};
  for (const f of allFields()) {
    const { bucket, champ } = parseK(f.k);
    (bucket === 'identite' ? identite : textes)[champ] = readField(f);
  }
  return { identite, textes };
}

/** Affiche les messages d'erreur sous les champs concernés et masque les autres. */
function showErrors(errors) {
  S.root.querySelectorAll('[data-err]').forEach((p) => { p.hidden = true; p.textContent = ''; });
  for (const [k, msg] of Object.entries(errors)) {
    const p = S.root.querySelector(`[data-err="${k}"]`);
    if (p) { p.textContent = msg; p.hidden = false; }
  }
}

/** Gère les boutons « Valeur par défaut » (un champ ou un groupe). N'enregistre rien : il faut envoyer le formulaire. */
function onClick(e) {
  const r = e.target.closest('[data-reset], [data-reset-group]');
  if (!r) return;
  if (r.dataset.reset) {
    const f = allFields().find((x) => x.k === r.dataset.reset);
    if (f) writeField(f, defaultOf(f.k));
    return;
  }
  const g = GROUPES_LOT1.find((x) => x.id === r.dataset.resetGroup);
  if (g) {
    g.champs.forEach((f) => writeField(f, defaultOf(f.k)));
    toast(`Valeurs par défaut remises dans « ${g.titre} ». Enregistre pour les appliquer.`, 'ok');
  }
}

/**
 * Envoie le formulaire : validation, puis enregistrement des écarts aux valeurs par défaut.
 * Une erreur de saisie bloque l'envoi et place le focus sur le premier champ fautif.
 */
async function onSubmit(e) {
  if (e.target.id !== 'rgi-form') return;
  e.preventDefault();
  const status = S.root.querySelector('#rgi-status');
  status.hidden = true;
  const { errors } = validate();
  showErrors(errors);
  if (Object.keys(errors).length) {
    status.textContent = 'Corrige les champs signalés avant d\'enregistrer.';
    status.hidden = false;
    S.root.querySelector(`[data-err]:not([hidden])`)?.closest('.rgi-field')?.querySelector('input,textarea')?.focus();
    return;
  }
  const values = readAll();
  const identiteOver = diffFromDefaults(values.identite, SITE_DEFAULTS.identite);
  const textesOver = diffFromDefaults(values.textes, SITE_DEFAULTS.textes);
  const btn = S.root.querySelector('#rgi-save');
  btn.disabled = true;
  try {
    await saveKey('site_identite', identiteOver);
    await saveKey('site_textes', textesOver);
    setSiteRaw({ identite: identiteOver, textes: textesOver });
    S.site = buildSite({ identite: identiteOver, textes: textesOver });
    toast('Identité et textes enregistrés.', 'ok');
    render();
  } catch (ex) {
    status.textContent = `Enregistrement impossible : ${errMsg(ex)}`;
    status.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

/** Met à jour une clé (ou la crée si la ligne n'existe pas encore). */
async function saveKey(key, value) {
  const now = new Date().toISOString();
  const { data, error } = await sb.from('hg_settings').update({ value, updated_at: now }).eq('key', key).select('key');
  if (error) throw error;
  if (!data?.length) {
    const ins = await sb.from('hg_settings').insert({ key, value, updated_at: now });
    if (ins.error) throw ins.error;
  }
}

