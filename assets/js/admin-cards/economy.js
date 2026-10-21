// Cartes admin : onglet « Économie » (Paillettes, boosters, recyclage, fabrication, récompenses).
import { sb, toast, errMsg, esc, $ } from '../core.js';
import { C } from './state.js';
import { ECON, CFG_DEFAULT, RARITY_IDS } from './constants.js';
import { check, act, nf } from './helpers.js';
import { refresh } from './data.js';

/* =========================================================
   Économie
   ========================================================= */
function getPath(obj, k) {
  const [a, b] = k.split('.');
  const v = b ? obj?.[a]?.[b] : obj?.[a];
  return v ?? null;
}
const cfgSource = () => (Object.keys(C.cfgRaw || {}).length ? C.cfgRaw : CFG_DEFAULT);
function econField(f) {
  const name = f.k.replace('.', '_');
  const val = getPath(cfgSource(), f.k);
  return `<div class="field"><label for="acd-e-${name}">${esc(f.l)}${f.u ? ` <span class="muted small">(${esc(f.u)})</span>` : ''}</label>
    <input id="acd-e-${name}" name="${name}" type="number" inputmode="decimal" step="${f.step ?? 1}" min="${f.min ?? 0}"${f.max != null ? ` max="${f.max}"` : ''}
      value="${val == null ? '' : esc(val)}"${f.optional ? ' placeholder="vide = non fabricable"' : ''}></div>`;
}
export function econPanel() {
  return `<section class="card acd-bulk-intro" aria-labelledby="acd-bulk-h">
      <h3 class="card-title" id="acd-bulk-h">Dons</h3>
      <p class="small muted">Donner des Paillettes, des boosters offerts ou une carte à plusieurs membres d'un coup, ou à tout le gang.</p>
      <div class="btn-row"><button class="btn btn-primary" type="button" data-act="bulk-open">Don groupé…</button></div>
    </section>
    <p class="small muted">Ces réglages s'appliquent aux prochains boosters, recyclages, fabrications et récompenses.</p>
    <form class="stack acd-econ" id="acd-econ-form" novalidate>
      <p class="form-error" role="alert" hidden></p>
      ${ECON.map((g) => `<fieldset class="acd-fs"><legend>${esc(g.g)}</legend>
        ${g.hint ? `<p class="small muted">${esc(g.hint)}</p>` : ''}
        <div class="acd-grid-2">${g.fields.map(econField).join('')}</div>
        ${g.rates ? '<p class="acd-sum" id="acd-rate-sum" aria-live="polite"></p>' : ''}
      </fieldset>`).join('')}
      <div class="btn-row">
        <button class="btn btn-primary" type="submit">Enregistrer les réglages</button>
        <button class="btn btn-ghost" type="button" data-act="econ-reset">Annuler les modifications</button>
      </div>
    </form>`;
}
export function updateSum() {
  const form = $('#acd-econ-form', C.panel);
  const out = $('#acd-rate-sum', C.panel);
  if (!form || !out) return;
  const total = RARITY_IDS.reduce((s, r) => s + (Number(form.elements[`rates_${r}`]?.value) || 0), 0);
  const ok = Math.abs(total - 100) < 0.001;
  out.textContent = `Total des taux : ${nf(Math.round(total * 100) / 100)} %${ok ? '' : ' · le total devrait faire 100 %'}`;
  out.classList.toggle('is-warn', !ok);
}
/** Relit le formulaire et renvoie la configuration complète (les clés inconnues sont conservées). */
function readEcon(form) {
  const out = structuredClone(C.cfgRaw || {});
  for (const g of ECON) for (const f of g.fields) {
    const name = f.k.replace('.', '_');
    const [a, b] = f.k.split('.');
    const raw = String(form.elements[name].value).trim();
    if (f.optional && raw === '') { if (b && out[a]) delete out[a][b]; continue; }
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) throw new Error(`« ${f.l} » : indique un nombre.`);
    if (n < (f.min ?? 0) || (f.max != null && n > f.max)) throw new Error(`« ${f.l} » : valeur entre ${f.min ?? 0} et ${f.max ?? 'sans limite'}.`);
    if (f.int && !Number.isInteger(n)) throw new Error(`« ${f.l} » : nombre entier attendu.`);
    if (b) out[a] = { ...(out[a] || {}), [b]: n };
    else out[a] = n;
  }
  return out;
}
export async function saveEcon(form, btn) {
  const err = $('.form-error', form);
  const showErr = (m) => { err.textContent = m; err.hidden = !m; if (m) err.scrollIntoView({ block: 'nearest' }); };
  showErr('');
  let next;
  try { next = readEcon(form); } catch (e) { return showErr(errMsg(e)); }
  await act(btn, async () => {
    check(await sb.from('hg_settings').upsert({ key: 'cards', value: next, updated_at: new Date().toISOString() }));
    toast('Réglages enregistrés', 'ok');
    await refresh();
  });
}
