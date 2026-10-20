// ===== Humane Gang — administration : tirage manuel du Secret Santa =====
// Éditeur « une ligne par Santa » avec validation en direct, complétion aléatoire et envoi via rpc hg_ss_manual_draw.
import { sb, toast, errMsg, esc, $, notify } from './core.js';

const IC = {
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/></svg>',
  dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"/></svg>',
};

const M = { dlg: null, ed: null, edId: null, ids: [], pseudoOf: (x) => x, excl: new Set(), last: new Map(), pick: new Map(), onDone: async () => {} };
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function confirmBox(title, body, { ok = 'Confirmer', danger = false } = {}) {
  const dlg = $('#confirm-dlg');
  $('#confirm-title').textContent = title;
  $('#confirm-body').textContent = body;
  const okBtn = $('#confirm-ok');
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

/* ---------- Validation ---------- */
/** Analyse les choix courants : erreurs (bloquantes) et avertissements par ligne + bilan. */
export function analyse(ids, pick, excl, last, pseudoOf = (x) => x) {
  const rows = new Map(ids.map((g) => [g, { errors: [], warnings: [] }]));
  const byReceiver = new Map();
  for (const g of ids) {
    const r = pick.get(g);
    if (!r) continue;
    if (!byReceiver.has(r)) byReceiver.set(r, []);
    byReceiver.get(r).push(g);
  }
  for (const g of ids) {
    const r = pick.get(g), row = rows.get(g);
    if (!r) continue;
    if (r === g) row.errors.push('Ne peut pas s\'offrir un cadeau à soi-même');
    if (!ids.includes(r)) row.errors.push('Cible hors des participants');
    const dup = byReceiver.get(r) || [];
    if (dup.length > 1) row.errors.push(`${pseudoOf(r)} est aussi la cible de ${dup.filter((x) => x !== g).map(pseudoOf).join(', ')}`);
    if (excl.has(key(g, r))) row.warnings.push('Exclusion non respectée');
    if (last.get(g) === r) row.warnings.push('Même cible que l\'an dernier');
  }
  const filled = ids.filter((g) => pick.get(g)).length;
  const noSanta = ids.filter((r) => !byReceiver.has(r));
  const errors = [...rows.values()].filter((x) => x.errors.length).length;
  const warnings = [...rows.values()].filter((x) => x.warnings.length).length;
  return { rows, filled, noSanta, errors, warnings, complete: filled === ids.length && noSanta.length === 0, valid: filled === ids.length && noSanta.length === 0 && errors === 0 };
}

/* ---------- Complétion aléatoire ---------- */
function shuffle(a) { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; }
/**
 * Remplit les lignes vides avec les personnes encore sans Santa, sans toucher aux lignes remplies.
 * Contraintes dures : pas soi-même, chacun reçoit une fois. Contraintes souples (essayées d'abord) : exclusions, cible de l'an dernier.
 * Renvoie { pick, relaxed } ou null si impossible.
 */
export function completeRandom(ids, pick, excl, last) {
  const empty = ids.filter((g) => !pick.get(g));
  const taken = new Set(ids.map((g) => pick.get(g)).filter(Boolean));
  const free = ids.filter((r) => !taken.has(r));
  if (empty.length !== free.length) return null;
  const tryFill = (soft) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const givers = shuffle(empty);
      const out = new Map();
      const used = new Set();
      const ok = (g, r) => r !== g && !used.has(r) && (!soft || (!excl.has(key(g, r)) && last.get(g) !== r));
      // backtracking (petites tailles : quelques dizaines de personnes au plus)
      let steps = 0;
      const solve = (i) => {
        if (i === givers.length) return true;
        if (++steps > 20000) return false;
        const g = givers[i];
        for (const r of shuffle(free)) {
          if (!ok(g, r)) continue;
          out.set(g, r); used.add(r);
          if (solve(i + 1)) return true;
          out.delete(g); used.delete(r);
        }
        return false;
      };
      if (solve(0)) return out;
    }
    return null;
  };
  const strict = tryFill(true);
  const res = strict || tryFill(false);
  if (!res) return null;
  const next = new Map(pick);
  for (const [g, r] of res) next.set(g, r);
  return { pick: next, relaxed: !strict };
}

/* ---------- Rendu ---------- */
function rowHtml(g, a) {
  const st = a.rows.get(g), r = M.pick.get(g) || '';
  const opts = M.ids.filter((x) => x !== g).map((x) => ({ id: x, p: M.pseudoOf(x) })).sort((x, y) => x.p.localeCompare(y.p, 'fr'));
  const state = !r ? 'empty' : st.errors.length ? 'error' : st.warnings.length ? 'warn' : 'ok';
  const msg = [...st.errors, ...st.warnings].join(' · ');
  const icon = state === 'error' ? IC.err : state === 'warn' ? IC.warn : state === 'ok' ? IC.ok : '';
  return `
    <li class="md-row is-${state}" data-giver="${esc(g)}">
      <label class="md-giver" for="md-${esc(g)}">${esc(M.pseudoOf(g))}</label>
      <span class="md-arrow" aria-hidden="true">${IC.arrow}</span>
      <select id="md-${esc(g)}" data-md-pick aria-describedby="md-msg-${esc(g)}"${state === 'error' ? ' aria-invalid="true"' : ''}>
        <option value="">À choisir…</option>
        ${opts.map((o) => `<option value="${esc(o.id)}"${o.id === r ? ' selected' : ''}>${esc(o.p)}</option>`).join('')}
      </select>
      <span class="md-msg small" id="md-msg-${esc(g)}">${icon}<span>${state === 'empty' ? '' : state === 'ok' ? 'OK' : esc(msg)}</span></span>
    </li>`;
}
function summaryHtml(a) {
  const n = M.ids.length;
  const parts = [`<strong>${a.filled} / ${n}</strong> Santas ont une cible`];
  if (a.errors) parts.push(`<span class="md-s-err">${a.errors} erreur${a.errors > 1 ? 's' : ''} à corriger</span>`);
  if (a.filled === n && a.noSanta.length) parts.push(`<span class="md-s-err">sans Santa : ${esc(a.noSanta.map(M.pseudoOf).join(', '))}</span>`);
  if (a.warnings) parts.push(`<span class="md-s-warn">${a.warnings} avertissement${a.warnings > 1 ? 's' : ''} (non bloquant${a.warnings > 1 ? 's' : ''})</span>`);
  if (a.valid) parts.push('<span class="md-s-ok">Tirage valide</span>');
  return parts.join(' · ');
}
function render() {
  const a = analyse(M.ids, M.pick, M.excl, M.last, M.pseudoOf);
  const order = M.ids.slice().sort((x, y) => M.pseudoOf(x).localeCompare(M.pseudoOf(y), 'fr'));
  $('#md-rows', M.dlg).innerHTML = order.map((g) => rowHtml(g, a)).join('');
  $('#md-summary', M.dlg).innerHTML = summaryHtml(a);
  $('#md-submit', M.dlg).disabled = !a.valid;
  $('#md-fill', M.dlg).disabled = a.filled === M.ids.length;
  $('#md-clear', M.dlg).disabled = a.filled === 0;
  return a;
}
function shell() {
  let dlg = $('#md-dlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'md-dlg';
    dlg.className = 'hg-dialog md-dlg';
    dlg.setAttribute('aria-labelledby', 'md-title');
    document.body.append(dlg);
    dlg.addEventListener('change', (ev) => {
      const s = ev.target.closest('[data-md-pick]'); if (!s) return;
      const g = s.closest('[data-giver]').dataset.giver;
      if (s.value) M.pick.set(g, s.value); else M.pick.delete(g);
      render();
      $(`#md-${CSS.escape(g)}`, dlg)?.focus();
    });
    dlg.addEventListener('click', async (ev) => {
      const t = ev.target.closest('button'); if (!t) return;
      if (t.id === 'md-close') { dlg.close(); return; }
      if (t.id === 'md-clear') { M.pick.clear(); render(); return; }
      if (t.id === 'md-fill') {
        const a = analyse(M.ids, M.pick, M.excl, M.last, M.pseudoOf);
        if (a.errors) { toast('Corrige d\'abord les lignes en erreur (doublons).', 'error'); return; }
        const res = completeRandom(M.ids, M.pick, M.excl, M.last);
        if (!res) { toast('Impossible de compléter sans modifier les lignes déjà remplies (la seule cible restante serait la personne elle-même). Change une ligne et réessaie.', 'error'); return; }
        M.pick = res.pick;
        render();
        toast(res.relaxed ? 'Complété au hasard, mais une exclusion ou une cible de l\'an dernier n\'a pas pu être évitée.' : 'Lignes vides complétées au hasard', res.relaxed ? 'error' : 'ok');
        return;
      }
      if (t.id === 'md-submit') submit(t);
    });
  }
  dlg.innerHTML = `
    <div class="md-in">
      <div class="md-head">
        <div>
          <h2 id="md-title" class="dialog-title">Tirage manuel · ${esc(M.ed.year)}</h2>
          <p class="small muted">Choisis la cible de chaque Santa. Chacun doit recevoir exactement une fois et personne ne s'offre à soi-même. Les exclusions et la cible de l'an dernier ne sont que des avertissements.</p>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" id="md-close">Fermer</button>
      </div>
      <div class="md-cols small muted" aria-hidden="true"><span>Santa</span><span></span><span>Offre à</span><span>Vérification</span></div>
      <ul class="md-rows" id="md-rows"></ul>
      <p class="md-summary small" id="md-summary" role="status" aria-live="polite"></p>
      <div class="btn-row md-actions">
        <button class="btn btn-ghost" type="button" id="md-clear">Tout effacer</button>
        <button class="btn btn-ghost" type="button" id="md-fill">${IC.dice} Compléter au hasard</button>
        <button class="btn btn-sand" type="button" id="md-submit" disabled>Valider le tirage</button>
      </div>
    </div>`;
  M.dlg = dlg;
  return dlg;
}

async function submit(btn) {
  const a = analyse(M.ids, M.pick, M.excl, M.last, M.pseudoOf);
  if (!a.valid) return;
  const warn = a.warnings ? `\n${a.warnings} avertissement${a.warnings > 1 ? 's' : ''} (exclusion ou même cible que l'an dernier) : le tirage sera enregistré quand même.` : '';
  const ok = await confirmBox('Valider ce tirage ?', `${M.ids.length} participants.${warn}\nLe tirage est définitif : il ne pourra pas être relancé. L'édition passera en « Envoi des cadeaux » et les participants seront prévenus par le bot.`, { ok: 'Valider le tirage' });
  if (!ok) return;
  btn.disabled = true;
  try {
    const pairs = M.ids.map((g) => ({ giver: g, receiver: M.pick.get(g) }));
    const { data, error } = await sb.rpc('hg_ss_manual_draw', { p_edition: M.ed.id, p_pairs: pairs });
    if (error) throw error;
    notify('ss_draw', { edition_id: M.ed.id }); // le bot prévient (sans jamais révéler les paires)
    M.pick.clear();
    M.dlg.close();
    await M.onDone(Number(data) || M.ids.length);
  } catch (e) {
    toast(errMsg(e), 'error');
    btn.disabled = false;
  }
}

/**
 * Ouvre l'éditeur. edition = ligne hg_ss_editions ; participants = uuids ; exclusions = lignes hg_ss_exclusions ;
 * editions = toutes les éditions (pour trouver l'an dernier) ; onDone(count) après succès.
 */
export async function openManualDraw({ edition, participants, exclusions = [], editions = [], pseudoOf, onDone }) {
  M.ed = edition;
  if (M.ids.join() !== participants.slice().sort().join() || M.edId !== edition.id) M.pick = new Map(); // garde le brouillon si rien n'a changé
  M.edId = edition.id;
  M.ids = participants.slice().sort();
  M.pseudoOf = pseudoOf || M.pseudoOf;
  M.onDone = onDone || M.onDone;
  M.excl = new Set(exclusions.map((x) => key(x.user_a, x.user_b)));
  M.last = new Map();
  const prev = editions.find((e) => e.year === edition.year - 1);
  if (prev) {
    const { data, error } = await sb.from('hg_ss_assignments').select('giver_id, receiver_id').eq('edition_id', prev.id);
    if (error) console.warn('[tirage manuel] an dernier', error);
    for (const r of data ?? []) M.last.set(r.giver_id, r.receiver_id);
  }
  const dlg = shell();
  render();
  dlg.showModal();
  $('select', dlg)?.focus();
}

