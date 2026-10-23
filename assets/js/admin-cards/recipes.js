// =====================================================================
// Cartes admin : onglet « Atelier » — recettes de fabrication thématiques (idée C10, migration 081).
// Liste des recettes (carte obtenue, ingrédients, fabrications) et éditeur : ingrédients par carte précise ou par tag
// (groupes de C7), Paillettes, période, nombre total, une fois par membre, active. Le serveur refuse une carte obtenue
// fabricable contre des Paillettes et une recette qui rapporterait plus au recyclage que ses ingrédients.
// RPC : hg_card_recipes_admin, hg_card_recipe_save (Staff « cartes », journal admin).
// Exporte : mountRecipesTab(el). Les cartes et les tags viennent de C (state.js).
// =====================================================================
import { sb, toast, esc, errMsg } from '../core.js';
import { C } from './state.js';
import { act, check, fmtWhen, nf } from './helpers.js';
import { rarityLabel } from '../cartes-ui.js';
import { tagLabel } from '../cartes-jeux.js';

const R = { el: null, list: null, err: '', edit: null };
const blank = () => ({ id: null, name: '', description: '', output_card: '', output_shiny: false, inputs: [{ mode: 'tag', tag: '', card: '', qty: 1 }], paillettes: 0,
  starts_at: null, ends_at: null, max_total: null, once_per_user: false, active: true, sort: 0 });
/** Valeur d'un champ datetime-local à partir d'une date ISO (heure locale). */
const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const tags = () => [...new Set(C.cards.map((k) => k.tag).filter(Boolean))].sort();
const cardName = (id) => C.cardById.get(id)?.name || 'carte';

/** Texte des ingrédients d'une recette. */
const inputsText = (r) => (r.inputs || []).map((i) => (i.card ? `${i.qty} × ${cardName(i.card)}` : `${i.qty} × ${tagLabel(i.tag)} au choix`)).join(' + ')
  + (r.paillettes ? ` + ${nf(r.paillettes)} ✦` : '');

/** Une ligne d'ingrédient de l'éditeur. */
function inputRow(inp, i) {
  const mode = inp.mode || (inp.tag ? 'tag' : 'card');
  const cards = C.cards.filter((k) => k.rarity !== 'identite' && k.rarity !== 'unique').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return `<fieldset class="acd-fs acd-rec-in" data-i="${i}"><legend>Ingrédient ${i + 1}</legend>
      <div class="acd-grid-2">
        <div class="field"><label for="ri-mode-${i}">Type</label><select id="ri-mode-${i}" data-ri="mode"><option value="card" ${mode === 'card' ? 'selected' : ''}>Une carte précise</option><option value="tag" ${mode === 'tag' ? 'selected' : ''}>Des cartes d’un jeu (tag)</option></select></div>
        ${mode === 'card'
          ? `<div class="field"><label for="ri-card-${i}">Carte</label><select id="ri-card-${i}" data-ri="card"><option value="">Choisir…</option>${cards.map((k) => `<option value="${esc(k.id)}" ${inp.card === k.id ? 'selected' : ''}>${esc(k.name)} · ${esc(rarityLabel(k.rarity))}</option>`).join('')}</select></div>`
          : `<div class="field"><label for="ri-tag-${i}">Tag</label><select id="ri-tag-${i}" data-ri="tag"><option value="">Choisir…</option>${tags().map((t) => `<option value="${esc(t)}" ${inp.tag === t ? 'selected' : ''}>${esc(tagLabel(t))}</option>`).join('')}</select></div>`}
        <div class="field"><label for="ri-qty-${i}">Quantité</label><input id="ri-qty-${i}" data-ri="qty" type="number" min="1" max="5" value="${Number(inp.qty) || 1}" inputmode="numeric"></div>
      </div>
      ${R.edit.inputs.length > 1 ? `<div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-rc="in-del" data-i="${i}">Retirer l’ingrédient</button></div>` : ''}
    </fieldset>`;
}

/** Éditeur (création ou modification). */
function editorHtml() {
  const r = R.edit;
  const outs = C.cards.filter((k) => k.rarity !== 'identite').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return `<form class="card stack" id="acd-rec-form" novalidate>
      <h3 class="card-title">${r.id ? 'Modifier la recette' : 'Nouvelle recette'}</h3>
      <div class="acd-grid-2">
        <div class="field"><label for="rc-name">Nom</label><input id="rc-name" name="name" maxlength="80" required value="${esc(r.name)}"></div>
        <div class="field"><label for="rc-out">Carte obtenue</label><select id="rc-out" name="output_card"><option value="">Choisir…</option>
          ${outs.map((k) => `<option value="${esc(k.id)}" ${r.output_card === k.id ? 'selected' : ''}>${esc(k.name)} · ${esc(rarityLabel(k.rarity))}${k.craftable && k.rarity !== 'unique' ? ' (fabricable : à décocher)' : ''}</option>`).join('')}</select>
          <p class="small muted">Une carte « qui ne se trouve nulle part ailleurs » : décoche « Fabricable » dans sa fiche et garde-la hors des boosters.</p></div>
        <div class="field"><label for="rc-desc">Description (facultatif)</label><input id="rc-desc" name="description" maxlength="200" value="${esc(r.description || '')}"></div>
        <div class="field"><label for="rc-p">Paillettes demandées</label><input id="rc-p" name="paillettes" type="number" min="0" max="100000" value="${Number(r.paillettes) || 0}" inputmode="numeric"></div>
        <div class="field"><label for="rc-start">Début (facultatif)</label><input id="rc-start" name="starts_at" type="datetime-local" value="${esc(toLocal(r.starts_at))}"></div>
        <div class="field"><label for="rc-end">Fin (facultatif)</label><input id="rc-end" name="ends_at" type="datetime-local" value="${esc(toLocal(r.ends_at))}"></div>
        <div class="field"><label for="rc-max">Nombre total de fabrications (facultatif)</label><input id="rc-max" name="max_total" type="number" min="1" max="10000" value="${r.max_total ?? ''}" inputmode="numeric"></div>
        <div class="field"><label for="rc-sort">Ordre</label><input id="rc-sort" name="sort" type="number" value="${Number(r.sort) || 0}" inputmode="numeric"></div>
      </div>
      <label class="check"><input type="checkbox" name="output_shiny" ${r.output_shiny ? 'checked' : ''}> <span>Carte obtenue brillante</span></label>
      <label class="check"><input type="checkbox" name="once_per_user" ${r.once_per_user ? 'checked' : ''}> <span>Une fois par membre</span></label>
      <label class="check"><input type="checkbox" name="active" ${r.active ? 'checked' : ''}> <span>Active</span></label>
      <div class="stack" id="rc-inputs">${r.inputs.map(inputRow).join('')}</div>
      ${r.inputs.length < 6 ? '<div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-rc="in-add">Ajouter un ingrédient</button></div>' : ''}
      <p class="small muted">Conseil : des ingrédients communs ou peu communs, pour ne pas vider une série que d’autres veulent compléter.</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer</button><button class="btn btn-ghost" type="button" data-rc="cancel">Annuler</button></div>
    </form>`;
}

/** Liste des recettes. */
function listHtml() {
  if (R.err) return `<p class="empty">${esc(R.err)}</p>`;
  if (!R.list) return '<p class="empty">Chargement…</p>';
  if (!R.list.length) return '<p class="empty">Aucune recette pour le moment.</p>';
  return `<ul class="acd-list">${R.list.map((r) => `<li class="acd-item${r.active ? '' : ' is-off'}">
      <div class="acd-item-main">
        <p><strong>${esc(r.name)}</strong> → ${esc(r.output_name || cardName(r.output_card))}${r.output_shiny ? ' (brillante)' : ''}${r.active ? '' : ' <span class="pill">Inactive</span>'}</p>
        <p class="small muted">${esc(inputsText(r))}</p>
        <p class="small muted">${nf(r.uses)} fabrication${r.uses > 1 ? 's' : ''}${r.max_total ? ` sur ${nf(r.max_total)}` : ''}${r.once_per_user ? ' · une fois par membre' : ''}${r.ends_at ? ` · jusqu’au ${esc(fmtWhen(r.ends_at))}` : ''}</p>
      </div>
      <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-rc="edit" data-id="${esc(r.id)}">Modifier</button></div>
    </li>`).join('')}</ul>`;
}

function render(focus = null) {
  if (!R.el) return;
  R.el.innerHTML = `<div class="stack">
      <p class="small muted">Les recettes apparaissent dans le panneau « Atelier » de l’onglet « Mes cartes ». Les cartes utilisées sont retirées du jeu.</p>
      ${R.edit ? editorHtml() : '<div class="btn-row"><button class="btn btn-primary" type="button" data-rc="new">Nouvelle recette</button></div>'}
      ${listHtml()}</div>`;
  if (focus) R.el.querySelector(focus)?.focus();
}

async function load() {
  try { R.list = check(await sb.rpc('hg_card_recipes_admin')) || []; R.err = ''; }
  catch (e) { R.err = `Recettes indisponibles : ${errMsg(e)}`; R.list = []; }
  render();
}

/** Lit le formulaire dans R.edit (pour garder les saisies quand on ajoute un ingrédient). */
function readForm(form) {
  const f = new FormData(form);
  Object.assign(R.edit, { name: String(f.get('name') || '').trim(), description: String(f.get('description') || '').trim(), output_card: f.get('output_card') || '',
    paillettes: Number(f.get('paillettes') || 0), starts_at: f.get('starts_at') ? new Date(f.get('starts_at')).toISOString() : null,
    ends_at: f.get('ends_at') ? new Date(f.get('ends_at')).toISOString() : null, max_total: f.get('max_total') ? Number(f.get('max_total')) : null,
    sort: Number(f.get('sort') || 0), output_shiny: f.get('output_shiny') === 'on', once_per_user: f.get('once_per_user') === 'on', active: f.get('active') === 'on' });
  form.querySelectorAll('.acd-rec-in').forEach((fs) => {
    const i = Number(fs.dataset.i); const inp = R.edit.inputs[i];
    inp.mode = fs.querySelector('[data-ri="mode"]').value;
    inp.card = inp.mode === 'card' ? (fs.querySelector('[data-ri="card"]')?.value || '') : '';
    inp.tag = inp.mode === 'tag' ? (fs.querySelector('[data-ri="tag"]')?.value || '') : '';
    inp.qty = Number(fs.querySelector('[data-ri="qty"]').value) || 1;
  });
}

async function save(form, btn) {
  readForm(form);
  const r = R.edit;
  const err = form.querySelector('.form-error');
  const bad = r.inputs.some((i) => (i.mode === 'tag' ? !i.tag : !i.card));
  if (!r.name || !r.output_card || bad) { err.textContent = 'Indique un nom, la carte obtenue et chaque ingrédient.'; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); return; }
  const p = { ...r, inputs: r.inputs.map((i) => (i.mode === 'tag' ? { tag: i.tag, qty: i.qty } : { card: i.card, qty: i.qty })) };
  await act(btn, async () => {
    try { check(await sb.rpc('hg_card_recipe_save', { p })); }
    catch (e) { err.textContent = errMsg(e); err.hidden = false; throw e; }
    toast('Recette enregistrée', 'ok');
    R.edit = null;
    await load();
  });
}

/**
 * Monte l'onglet « Atelier » dans el.
 * @param {HTMLElement} el conteneur
 */
export function mountRecipesTab(el) {
  if (!el) return;
  R.el = el;
  render();
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rc]');
    if (!b) return;
    const form = el.querySelector('#acd-rec-form');
    if (b.dataset.rc === 'new') { R.edit = blank(); render('#rc-name'); }
    if (b.dataset.rc === 'cancel') { R.edit = null; render('[data-rc="new"]'); }
    if (b.dataset.rc === 'edit') {
      const r = R.list.find((x) => x.id === b.dataset.id);
      if (r) { R.edit = { ...r, inputs: (r.inputs || []).map((i) => ({ ...i, mode: i.card ? 'card' : 'tag' })) }; render('#rc-name'); }
    }
    if (b.dataset.rc === 'in-add' && form) { readForm(form); R.edit.inputs.push({ mode: 'tag', tag: '', card: '', qty: 1 }); render(`#ri-mode-${R.edit.inputs.length - 1}`); }
    if (b.dataset.rc === 'in-del' && form) { readForm(form); R.edit.inputs.splice(Number(b.dataset.i), 1); render('#rc-name'); }
  });
  el.addEventListener('change', (e) => {
    if (e.target.dataset?.ri !== 'mode') return;
    const form = el.querySelector('#acd-rec-form');
    readForm(form);
    render(`#${e.target.id}`);
  });
  el.addEventListener('submit', (e) => { if (e.target.id === 'acd-rec-form') { e.preventDefault(); save(e.target, e.submitter); } });
  load();
}
