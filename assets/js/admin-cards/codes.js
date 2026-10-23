// =====================================================================
// Cartes admin : onglet « Codes cadeaux » (idée C9, migration 081).
// Créer un lot de codes (booster d'un type, Paillettes ou carte), les afficher une seule fois en clair, imprimer une
// planche A4 de 24 étiquettes QR ou un grand QR pour une affiche ; lister les lots (utilisations, sans les codes) et
// désactiver un lot entier. Le QR ouvre cartes.html#code=HG-XXXX-XXXX.
// QR : bibliothèque qrcode-generator chargée à la demande (même source que les liens d'invitation, déjà dans la CSP).
// RPC : hg_gift_codes_create, hg_gift_codes_batches, hg_gift_codes_batch_active (Staff « cartes », journal admin).
// Exporte : mountCodesTab(el). Autonome : lit ses propres données (types de boosters) ; les cartes viennent de C.
// =====================================================================
import { sb, toast, esc, errMsg } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { C } from './state.js';
import { act, check, fmtWhen, nf } from './helpers.js';
import { rarityLabel } from '../cartes-ui.js';

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm';
let qrLib = null;
// État : types de boosters, lots, codes du dernier lot créé (en clair, jamais rechargés), choix du formulaire.
const K = { el: null, types: [], batches: null, err: '', last: null, kind: 'booster' };

/** Adresse ouverte par un QR. */
export const codeUrl = (code) => `${new URL('cartes.html', location.href).href.split('#')[0]}#code=${encodeURIComponent(code)}`;
/** Texte d'un lot (« 3 boosters Doré », « 100 Paillettes », « Carte « X » (Rare, brillante) »). */
function lotLabel(b) {
  const l = b.lot || b;
  if (l.kind === 'booster') return `${l.amount} booster${l.amount > 1 ? 's' : ''} ${l.type_name || l.type_id || ''}`;
  if (l.kind === 'paillettes') return `${nf(l.amount)} Paillettes`;
  return `Carte « ${l.card?.name || '?'} » (${rarityLabel(l.card?.rarity)}${l.shiny ? ', brillante' : ''})`;
}

/** Formulaire de création. */
function formHtml() {
  const cards = C.cards.filter((k) => k.rarity !== 'identite').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return `<form class="card stack" id="acd-codes-form" novalidate>
      <h3 class="card-title">Nouveau lot de codes</h3>
      <p class="small muted">Chaque code donne le même lot. Les codes s’affichent une seule fois, juste après la création : imprime-les tout de suite.</p>
      <div class="acd-grid-2">
        <div class="field"><label for="cc-kind">Chaque code donne</label>
          <select id="cc-kind" name="kind">
            <option value="booster" ${K.kind === 'booster' ? 'selected' : ''}>Des boosters</option>
            <option value="paillettes" ${K.kind === 'paillettes' ? 'selected' : ''}>Des Paillettes</option>
            <option value="carte" ${K.kind === 'carte' ? 'selected' : ''}>Une carte</option>
          </select></div>
        <div class="field"><label for="cc-count">Nombre de codes</label><input id="cc-count" name="count" type="number" min="1" max="200" value="24" inputmode="numeric"></div>
        ${K.kind === 'booster' ? `<div class="field"><label for="cc-type">Type de booster</label><select id="cc-type" name="type_id">
            ${K.types.filter((t) => t.active !== false).map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="cc-amount">Boosters par code</label><input id="cc-amount" name="amount" type="number" min="1" max="10" value="1" inputmode="numeric"></div>` : ''}
        ${K.kind === 'paillettes' ? `<div class="field"><label for="cc-amount">Paillettes par code</label><input id="cc-amount" name="amount" type="number" min="1" max="${Number(C.cfgRaw?.plafonds?.code_paillettes) || 1000}" value="100" inputmode="numeric"></div>` : ''}
        ${K.kind === 'carte' ? `<div class="field"><label for="cc-card">Carte</label><select id="cc-card" name="card_id">
            ${cards.map((k) => `<option value="${esc(k.id)}">${esc(k.name)} · ${esc(rarityLabel(k.rarity))}</option>`).join('')}</select></div>
          <label class="check"><input type="checkbox" name="shiny"> <span>Version brillante</span></label>` : ''}
        <div class="field"><label for="cc-uses">Utilisations par code</label><input id="cc-uses" name="max_uses" type="number" min="1" max="500" value="1" inputmode="numeric">
          <p class="small muted">Plus de 1 : QR d’affiche, une utilisation par membre.</p></div>
        <div class="field"><label for="cc-exp">Expire le (facultatif)</label><input id="cc-exp" name="expires_at" type="date"></div>
        <div class="field"><label for="cc-note">Note (pour toi)</label><input id="cc-note" name="note" maxlength="200" placeholder="Gobelets du RDV"></div>
      </div>
      <label class="check"><input type="checkbox" name="one_per_member"> <span>Un seul code de ce lot par membre (chasse au trésor)</span></label>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row"><button class="btn btn-primary" type="submit">Créer les codes</button></div>
    </form>`;
}

/** Codes du dernier lot créé, avec les boutons d'impression. */
function lastHtml() {
  if (!K.last) return '';
  return `<section class="card stack" aria-labelledby="cc-last-h">
      <h3 class="card-title" id="cc-last-h">${nf(K.last.codes.length)} code${K.last.codes.length > 1 ? 's' : ''} créé${K.last.codes.length > 1 ? 's' : ''} · ${esc(K.last.label)}</h3>
      <p class="small muted">Ils ne seront plus jamais affichés : imprime-les ou copie-les maintenant.</p>
      <ul class="acd-codes-list">${K.last.codes.map((c) => `<li><code>${esc(c)}</code></li>`).join('')}</ul>
      <div class="btn-row">
        <button class="btn btn-primary" type="button" data-cc="print-sheet">Imprimer la planche A4 (24 étiquettes)</button>
        <button class="btn btn-ghost" type="button" data-cc="print-poster">Imprimer un grand QR (affiche)</button>
        <button class="btn btn-ghost" type="button" data-cc="copy">Copier les codes</button>
      </div>
    </section>`;
}

/** Liste des lots. */
function batchesHtml() {
  if (K.err) return `<p class="empty">${esc(K.err)}</p>`;
  if (!K.batches) return '<p class="empty">Chargement des lots…</p>';
  if (!K.batches.length) return '<p class="empty">Aucun lot pour le moment.</p>';
  return `<ul class="acd-list">${K.batches.map((b) => `<li class="acd-item${b.active ? '' : ' is-off'}">
      <div class="acd-item-main">
        <p><strong>${esc(lotLabel(b))}</strong>${b.note ? ` · ${esc(b.note)}` : ''}${b.active ? '' : ' <span class="pill">Désactivé</span>'}</p>
        <p class="small muted">${nf(b.codes)} code${b.codes > 1 ? 's' : ''} × ${nf(b.max_uses)} utilisation${b.max_uses > 1 ? 's' : ''}${b.one_per_member ? ' · un par membre' : ''}
          · ${nf(b.used)} utilisé${b.used > 1 ? 's' : ''} (${nf(b.codes_used)} code${b.codes_used > 1 ? 's' : ''})
          ${b.expires_at ? ` · expire le ${esc(fmtWhen(b.expires_at))}` : ''} · créé le ${esc(fmtWhen(b.created_at))}${b.created_by ? ` par ${esc(b.created_by)}` : ''}</p>
      </div>
      <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-cc="toggle" data-id="${esc(b.id)}" data-on="${b.active ? '0' : '1'}">${b.active ? 'Désactiver le lot' : 'Réactiver'}</button></div>
    </li>`).join('')}</ul>`;
}

/** Dessine l'onglet. */
function render() {
  if (!K.el) return;
  K.el.innerHTML = `<div class="stack">${formHtml()}${lastHtml()}<section class="stack"><h3>Lots créés</h3>${batchesHtml()}</section></div>`;
}

/** Charge les types et les lots. */
async function load() {
  try {
    const [types, batches] = await Promise.all([
      sb.from('hg_booster_types').select('id,name,active,sort').order('sort'),
      sb.rpc('hg_gift_codes_batches'),
    ]);
    K.types = types.data || [];
    if (batches.error) throw batches.error;
    K.batches = batches.data || [];
    K.err = '';
  } catch (e) { K.err = `Codes cadeaux indisponibles : ${errMsg(e)}`; K.batches = []; }
  render();
}

/** Crée un lot à partir du formulaire. */
async function create(form, btn) {
  const f = new FormData(form);
  const err = form.querySelector('.form-error');
  const p = { kind: f.get('kind'), count: Number(f.get('count')), amount: Number(f.get('amount') || 1), type_id: f.get('type_id') || null,
    card_id: f.get('card_id') || null, shiny: f.get('shiny') === 'on', max_uses: Number(f.get('max_uses') || 1),
    one_per_member: f.get('one_per_member') === 'on', note: String(f.get('note') || '').trim() || null,
    expires_at: f.get('expires_at') ? new Date(`${f.get('expires_at')}T23:59:59`).toISOString() : null };
  if (!Number.isInteger(p.count) || p.count < 1 || p.count > 200) { err.textContent = 'Nombre de codes : entre 1 et 200.'; err.hidden = false; return; }
  await act(btn, async () => {
    const data = check(await sb.rpc('hg_gift_codes_create', { p }));
    const b = { kind: p.kind, amount: p.amount, type_name: K.types.find((t) => t.id === p.type_id)?.name, card: C.cardById.get(p.card_id), shiny: p.shiny };
    K.last = { codes: data.codes || [], label: lotLabel(b) };
    toast('Codes créés', 'ok');
    await load();
    K.el.querySelector('#cc-last-h')?.scrollIntoView({ block: 'start' });
  });
}

/** Image du QR d'un code (data URL). */
async function qrSrc(code, cell = 6) {
  if (!qrLib) qrLib = (await import(QR_LIB)).default;
  const qr = qrLib(0, 'M');
  qr.addData(codeUrl(code));
  qr.make();
  return qr.createDataURL(cell, 4);
}

/** Imprime la planche A4 (3 × 8 étiquettes) ou un grand QR, dans une page d'impression dédiée. */
async function print(kind) {
  if (!K.last?.codes?.length) return;
  let srcs;
  try { srcs = await Promise.all((kind === 'poster' ? K.last.codes.slice(0, 1) : K.last.codes).map((c) => qrSrc(c, kind === 'poster' ? 16 : 6))); }
  catch (e) { toast(`QR indisponible : ${errMsg(e)}`, 'error'); return; }
  const codes = kind === 'poster' ? K.last.codes.slice(0, 1) : K.last.codes;
  let host = document.getElementById('acd-print');
  if (!host) {
    host = document.createElement('div'); host.id = 'acd-print';
    const st = document.createElement('style'); st.id = 'acd-print-style';
    st.textContent = `#acd-print{display:none}
      @media print{body>*:not(#acd-print){display:none!important}#acd-print{display:block!important;color:#000;background:#fff}
      @page{size:A4;margin:8mm}.acd-sheet{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:34.6mm;gap:0}
      .acd-lbl{display:flex;align-items:center;gap:3mm;padding:2mm;border:1px dashed #bbb;break-inside:avoid;font:9pt Inter,sans-serif}
      .acd-lbl img{width:28mm;height:28mm;image-rendering:pixelated}.acd-lbl code{font:700 10pt monospace;letter-spacing:.05em}
      .acd-poster{text-align:center;font:16pt Inter,sans-serif;padding-top:20mm}.acd-poster img{width:150mm;height:150mm;image-rendering:pixelated;margin:10mm auto}
      .acd-poster code{font:700 28pt monospace;letter-spacing:.1em}}`;
    document.head.append(st);
    document.body.append(host);
  }
  host.innerHTML = kind === 'poster'
    ? `<div class="acd-poster"><p>Humane Gang · Code cadeau</p><img src="${srcs[0]}" alt=""><p><code>${esc(codes[0])}</code></p><p>Scanne-moi, ou tape le code sur la page Cartes</p></div>`
    : `<div class="acd-sheet">${codes.map((c, i) => `<div class="acd-lbl"><img src="${srcs[i]}" alt=""><div><p>Humane Gang<br>Code cadeau</p><code>${esc(c)}</code></div></div>`).join('')}</div>`;
  window.print();
}

/**
 * Monte l'onglet « Codes cadeaux » dans el.
 * @param {HTMLElement} el conteneur
 */
export function mountCodesTab(el) {
  if (!el) return;
  K.el = el;
  render();
  el.addEventListener('change', (e) => { if (e.target.id === 'cc-kind') { K.kind = e.target.value; render(); K.el.querySelector('#cc-kind')?.focus(); } });
  el.addEventListener('submit', (e) => { if (e.target.id === 'acd-codes-form') { e.preventDefault(); create(e.target, e.submitter); } });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cc]');
    if (!b) return;
    if (b.dataset.cc === 'print-sheet') return print('sheet');
    if (b.dataset.cc === 'print-poster') return print('poster');
    if (b.dataset.cc === 'copy') { try { await navigator.clipboard.writeText(K.last.codes.join('\n')); toast('Codes copiés', 'ok'); } catch { toast('Copie impossible : sélectionne la liste', 'error'); } return; }
    if (b.dataset.cc === 'toggle') {
      const on = b.dataset.on === '1';
      if (!on && !(await confirmBox('Désactiver ce lot ?', 'Aucun de ses codes ne pourra plus être utilisé (tu pourras le réactiver).', { ok: 'Désactiver', danger: true }))) return;
      await act(b, async () => { check(await sb.rpc('hg_gift_codes_batch_active', { p_batch: b.dataset.id, p_active: on })); toast(on ? 'Lot réactivé' : 'Lot désactivé', 'ok'); await load(); });
    }
  });
  load();
}
