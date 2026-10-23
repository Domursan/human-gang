// =====================================================================
// Cartes admin : onglet « Économie » (Paillettes, boosters, recyclage, fabrication, récompenses, quêtes, drops).
// Le formulaire est généré à partir de ECON (constants.js). Les réglages sont enregistrés dans hg_settings,
// clé « cards » ; une clé inconnue déjà présente est conservée à l'enregistrement.
// Dépendances : core.js (sb, toast, errMsg, esc, $), state.js (C), constants.js (ECON, CFG_DEFAULT, RARITY_IDS),
// helpers.js (check, act, nf), data.js (refresh).
// Exporte : econPanel (HTML), updateSum (total des taux), resetEconGroup (défauts d'un groupe), saveEcon (enregistrement),
// showEconPart (n'affiche qu'une partie du formulaire : la coquille en fait des sous-sections ; le formulaire reste unique).
// =====================================================================
import { sb, toast, errMsg, esc, $ } from '../core.js';
import { C } from './state.js';
import { ECON, CFG_DEFAULT, RARITY_IDS } from './constants.js';
import { check, act, nf } from './helpers.js';
import { refresh } from './data.js';

/* =========================================================
   Économie
   ========================================================= */
/* Parties du formulaire : chaque groupe de ECON (repéré par son libellé) appartient à une partie.
   Un groupe absent de la table reste visible dans toutes les parties (ajout futur dans constants.js). */
const PART_OF = {
  'Départ': 'paillettes', 'Récompenses': 'paillettes',
  'Boosters': 'tirage', 'Taux de tirage': 'tirage', 'Brillantes et garantie': 'tirage',
  'Recyclage': 'recyclage', 'Fabrication': 'recyclage',
  'Quêtes de la semaine': 'limites', 'Cartes sauvages (drops)': 'limites', 'Échanges': 'limites',
  'Alertes économie': 'recyclage', // A7 (dans Limites, l'onglet dépassait 1 400 px)
};
/** Libellé et adresse de chaque partie (sous-sections de la coquille). */
export const ECON_PARTS = {
  paillettes: { label: 'Paillettes et dons', route: '#cartes/economie' },
  tirage: { label: 'Tirage', route: '#cartes/tirage' },
  recyclage: { label: 'Recyclage et fabrication', route: '#cartes/recyclage' },
  limites: { label: 'Limites', route: '#cartes/limites' },
};
/* Partie affichée ; null = tout le formulaire (comportement d'origine, section non découpée). */
let econPart = null;
/* Saisies en cours à reporter au prochain rendu du formulaire (changement de partie : la coquille redessine l'onglet).
   Valable seulement pour le rendu qui suit immédiatement showEconPart ; « Annuler les modifications » les efface donc bien. */
let carry = null;
/** Vrai si le groupe g doit être masqué dans la partie courante. */
const groupHidden = (g) => !!econPart && !!PART_OF[g.g] && PART_OF[g.g] !== econPart;
/**
 * N'affiche qu'une partie de l'Économie (paillettes | tirage | recyclage | limites ; null ou inconnu = tout).
 * Mémorise le choix pour les prochains rendus et l'applique tout de suite si le formulaire est déjà affiché
 * (les saisies en cours sont conservées : on masque, on ne redessine pas).
 * @param {string|null} part partie à afficher.
 */
export function showEconPart(part) {
  econPart = ECON_PARTS[part] ? part : null;
  const root = C.panel;
  const form = root && $('#acd-econ-form', root);
  if (!form) return;
  carry = Object.fromEntries(ECON.flatMap((g) => g.fields).map((f) => [fieldName(f), form.elements[fieldName(f)]?.value ?? '']));
  queueMicrotask(() => { carry = null; }); // seul le rendu synchrone qui suit (openCardsTab) reprend les saisies
  form.querySelectorAll('fieldset[data-g]').forEach((fs) => { fs.hidden = groupHidden(ECON[Number(fs.dataset.g)] || {}); });
  const bulk = $('.acd-bulk-intro', root);
  if (bulk) bulk.hidden = !!econPart && econPart !== 'paillettes';
  const head = $('#acd-econ-part', root);
  if (head) { head.textContent = econPart ? ECON_PARTS[econPart].label : ''; head.hidden = !econPart; }
}
/* Découpe un chemin « a.b.c » en liste de clés : ['a', 'b', 'c']. */
const pathOf = (k) => k.split('.');
/** Lit la valeur d'un chemin « a.b » dans un objet ; null si absente. */
function getPath(obj, k) {
  const v = pathOf(k).reduce((o, p) => o?.[p], obj);
  return v ?? null;
}
/** Écrit une valeur au chemin donné, en créant les objets intermédiaires si besoin. */
function setPath(obj, path, val) {
  let o = obj;
  for (const p of path.slice(0, -1)) { if (typeof o[p] !== 'object' || o[p] === null) o[p] = {}; o = o[p]; }
  o[path[path.length - 1]] = val;
}
/** Supprime la clé au chemin donné, s'il existe. */
function unsetPath(obj, path) {
  const parent = path.slice(0, -1).reduce((o, p) => o?.[p], obj);
  if (parent && typeof parent === 'object') delete parent[path[path.length - 1]];
}
/* Nom du champ de formulaire : le point du chemin devient un tiret bas (« rates.commune » -> « rates_commune »). */
const fieldName = (f) => f.k.replaceAll('.', '_');
// Valeur affichée : la valeur enregistrée, sinon le défaut (sauf champ facultatif : vide = non fabricable).
const cfgSource = () => (Object.keys(C.cfgRaw || {}).length ? C.cfgRaw : {});
/** Valeur à afficher dans le champ : la valeur enregistrée, sinon le défaut (vide pour un champ facultatif). */
function shownValue(f) {
  const saved = getPath(cfgSource(), f.k);
  if (saved != null) return saved;
  return f.optional ? null : getPath(CFG_DEFAULT, f.k);
}
/** HTML d'un champ de réglage : libellé, unité, valeur actuelle et aide. */
function econField(f, draft) {
  const name = fieldName(f);
  const val = draft && name in draft ? draft[name] : shownValue(f);
  return `<div class="field"><label for="acd-e-${name}">${esc(f.l)}${f.u ? ` <span class="muted small">(${esc(f.u)})</span>` : ''}</label>
    <input id="acd-e-${name}" name="${name}" type="number" inputmode="decimal" step="${f.step ?? 1}" min="${f.min ?? 0}"${f.max != null ? ` max="${f.max}"` : ''}
      value="${val == null ? '' : esc(val)}" aria-describedby="acd-e-${name}-h"${f.optional ? ' placeholder="vide = non fabricable"' : ''}>
    ${f.help ? `<p class="small muted" id="acd-e-${name}-h">${esc(f.help)}</p>` : ''}</div>`;
}
/** HTML de l'onglet Économie : bloc Dons, puis le formulaire des réglages groupés. */
export function econPanel() {
  const draft = carry;
  carry = null;
  const bulkHidden = !!econPart && econPart !== 'paillettes';
  return `<h3 class="acd-econ-part" id="acd-econ-part" data-part${econPart ? '' : ' hidden'}>${econPart ? esc(ECON_PARTS[econPart].label) : ''}</h3>
    <section class="card acd-bulk-intro" aria-labelledby="acd-bulk-h" data-part${bulkHidden ? ' hidden' : ''}>
      <h3 class="card-title" id="acd-bulk-h">Dons</h3>
      <p class="small muted">Donner des Paillettes, des boosters offerts ou une carte à plusieurs membres d'un coup, ou à tout le gang.</p>
      <div class="btn-row"><button class="btn btn-primary" type="button" data-act="bulk-open">Don groupé…</button></div>
    </section>
    <p class="small muted">Ces réglages s'appliquent aux prochains boosters, recyclages, fabrications et récompenses.</p>
    <form class="stack acd-econ" id="acd-econ-form" novalidate>
      <p class="form-error" role="alert" hidden></p>
      ${ECON.map((g, gi) => `<fieldset class="acd-fs" data-g="${gi}" data-part${groupHidden(g) ? ' hidden' : ''}><legend>${esc(g.g)}</legend>
        ${g.hint ? `<p class="small muted">${esc(g.hint)}</p>` : ''}
        <div class="acd-grid-2">${g.fields.map((f) => econField(f, draft)).join('')}</div>
        ${g.rates ? '<p class="acd-sum" id="acd-rate-sum" aria-live="polite"></p>' : ''}
        <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-act="econ-default" data-g="${gi}">Rétablir les valeurs par défaut de « ${esc(g.g)} »</button></div>
      </fieldset>`).join('')}
      <div class="btn-row">
        <button class="btn btn-primary" type="submit">Enregistrer les réglages</button>
        <button class="btn btn-ghost" type="button" data-act="econ-reset">Annuler les modifications</button>
      </div>
    </form>`;
}
/** Affiche le total des taux de tirage et avertit s'il ne fait pas 100 %. */
export function updateSum() {
  const form = $('#acd-econ-form', C.panel);
  const out = $('#acd-rate-sum', C.panel);
  if (!form || !out) return;
  const total = RARITY_IDS.reduce((s, r) => s + (Number(form.elements[`rates_${r}`]?.value) || 0), 0);
  const ok = Math.abs(total - 100) < 0.001;
  out.textContent = `Total des taux : ${nf(Math.round(total * 100) / 100)} %${ok ? '' : ' · le total devrait faire 100 %'}`;
  out.classList.toggle('is-warn', !ok);
}
/** « Rétablir les valeurs par défaut » d'un groupe : remplit les champs avec les défauts (à enregistrer ensuite). */
export function resetEconGroup(gi) {
  const form = $('#acd-econ-form', C.panel);
  const g = ECON[gi];
  if (!form || !g) return;
  for (const f of g.fields) {
    const el = form.elements[fieldName(f)];
    if (!el) continue;
    const d = getPath(CFG_DEFAULT, f.k);
    el.value = d == null ? '' : String(d);
  }
  updateSum();
  const msg = $('.form-error', form);
  if (msg) { msg.textContent = ''; msg.hidden = true; }
  toast('Valeurs par défaut remplies : enregistre pour les appliquer', 'ok');
}
/** Relit le formulaire et renvoie la configuration complète (les clés inconnues sont conservées). */
function readEcon(form) {
  const out = structuredClone(C.cfgRaw || {});
  for (const g of ECON) for (const f of g.fields) try {
    const name = fieldName(f);
    const path = pathOf(f.k);
    const raw = String(form.elements[name].value).trim();
    if (f.optional && raw === '') { unsetPath(out, path); continue; }
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) throw new Error(`« ${f.l} » : indique un nombre.`);
    if (n < (f.min ?? 0) || (f.max != null && n > f.max)) throw new Error(`« ${f.l} » : valeur entre ${f.min ?? 0} et ${f.max ?? 'sans limite'}.`);
    if (f.int && !Number.isInteger(n)) throw new Error(`« ${f.l} » : nombre entier attendu.`);
    setPath(out, path, n);
  } catch (e) { e.group = g.g; throw e; }
  if (out.drops && out.drops.duree_defaut_min > out.drops.duree_max_min) {
    const e = new Error('« Durée proposée par défaut » ne peut pas dépasser « Durée maximale d\'un drop ».');
    e.group = 'Cartes sauvages (drops)';
    throw e;
  }
  return out;
}
/**
 * Valide le formulaire puis enregistre les réglages dans hg_settings (clé « cards »).
 * En cas d'erreur de saisie, le message s'affiche dans le formulaire et rien n'est envoyé.
 * @param {HTMLFormElement} form formulaire des réglages.
 * @param {HTMLElement|null} btn bouton d'envoi (désactivé pendant l'enregistrement).
 */
export async function saveEcon(form, btn) {
  const err = $('.form-error', form);
  /* Affiche le message d'erreur dans le formulaire, ou le masque si le message est vide. */
  const showErr = (m, part = null) => {
    err.textContent = m;
    // Erreur dans une partie masquée : on nomme la partie et on donne le lien vers sa sous-section.
    if (m && part) {
      const a = document.createElement('a');
      a.href = ECON_PARTS[part].route;
      a.textContent = `À corriger dans « ${ECON_PARTS[part].label} »`;
      a.addEventListener('click', () => showEconPart(part));
      err.append(' ', a);
    }
    err.hidden = !m;
    if (m) err.scrollIntoView({ block: 'nearest' });
  };
  showErr('');
  let next;
  try { next = readEcon(form); } catch (e) {
    const part = PART_OF[e.group];
    return showErr(errMsg(e), econPart && part && part !== econPart ? part : null);
  }
  await act(btn, async () => {
    check(await sb.from('hg_settings').upsert({ key: 'cards', value: next, updated_at: new Date().toISOString() }));
    toast('Réglages enregistrés', 'ok');
    await refresh();
  });
}
