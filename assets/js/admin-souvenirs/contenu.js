// =====================================================================
// Admin : vue « Ce jour-là » de la section Souvenirs et photos (idée S1).
//   Ce jour-là : interrupteur de la tuile de l'accueil, aperçu d'un jour, retrait / remise d'un souvenir.
// Droit : Staff « souvenirs » (vérifié côté serveur par chaque RPC, notée au journal).
// Dépendances : core.js (sb, esc, toast, errMsg), helpers.js (dates), admin/common.js.
// RPC : hg_contenu_reglages, hg_contenu_reglages_set, hg_on_this_day, hg_on_this_day_hide (migration 088).
// Exporte : createCeJourPanel (renvoie { el, load }).
// =====================================================================
import { sb, esc, toast, errMsg } from '../core.js';
import { dayLabel, todayIso } from './helpers.js';
import { sectionError } from '../admin/common.js';

/** Réglages « contenu » (lus une fois par chargement de vue). */
async function readCfg() {
  const { data, error } = await sb.rpc('hg_contenu_reglages');
  if (error) throw error;
  return data || {};
}
/** Écrit un réglage borné, avec un message. */
async function saveCfg(patch, okMsg) {
  const { error } = await sb.rpc('hg_contenu_reglages_set', { p: patch });
  if (error) { toast(`Réglage non enregistré : ${errMsg(error)}`, 'error'); return false; }
  toast(okMsg, 'ok');
  return true;
}
const KIND = { sortie: 'Sortie', moment: 'Moment culte', secret_santa: 'Secret Santa' };

/* ---------- Ce jour-là ---------- */
export function createCeJourPanel() {
  const el = document.createElement('div');
  el.className = 'sv-panel stack';
  el.innerHTML = `<section class="card stack" aria-labelledby="cj-h">
      <h3 id="cj-h" class="card-title">Tuile « Ce jour-là » de l’accueil</h3>
      <p class="small muted">Un souvenir dont la date tombe aujourd’hui, 1 à 4 ans plus tôt (ou à 3 jours près), le même pour tout le monde. Retire ici un souvenir douloureux.</p>
      <label class="check"><input type="checkbox" id="cj-on"><span>Afficher la tuile sur l’accueil des membres</span></label>
    </section>
    <div class="sv-toolbar"><div class="field"><label for="cj-day">Aperçu du jour</label><input type="date" id="cj-day"></div></div>
    <ul class="sv-items" id="cj-list" aria-live="polite"></ul>
    <h3 class="card-title">Retirés de « Ce jour-là »</h3>
    <ul class="sv-items" id="cj-hidden" aria-live="polite"></ul>`;
  const on = el.querySelector('#cj-on'), day = el.querySelector('#cj-day');
  day.value = todayIso();
  const row = (kind, id, title, sub, hidden) => `<li class="sv-row cj-row"><div class="sv-thumb"><span class="thumb-missing" aria-hidden="true"></span></div>
    <div class="sv-main"><p class="sv-title">${esc(title)}</p><p class="small muted">${esc(sub)}</p></div>
    <div class="btn-row sv-row-actions">${kind === 'secret_santa' ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-cj="${esc(kind)}:${esc(id)}:${hidden ? '0' : '1'}">${hidden ? 'Remettre' : 'Retirer'}</button>`}</div></li>`;
  async function load() {
    const list = el.querySelector('#cj-list'), hid = el.querySelector('#cj-hidden');
    list.innerHTML = '<li class="empty">Chargement…</li>';
    try {
      const [cfg, prev, hm, he] = await Promise.all([
        readCfg(), sb.rpc('hg_on_this_day', { p_day: day.value || null }),
        sb.from('hg_moments').select('id,title,happened_on').eq('hide_on_this_day', true),
        sb.from('hg_events').select('id,title,starts_at').eq('hide_on_this_day', true),
      ]);
      on.checked = cfg.ce_jour_la !== false;
      if (prev.error) throw prev.error;
      const items = Array.isArray(prev.data) ? prev.data : [];
      list.innerHTML = items.length ? items.map((it) => row(it.kind, it.id, it.title, `${KIND[it.kind] || ''} · ${dayLabel(it.date)} · il y a ${it.years_ago} an${it.years_ago > 1 ? 's' : ''}${it.exact ? '' : ' (semaine)'}`, false)).join('')
        : `<li class="empty">${prev.data === null ? 'Tuile coupée : rien n’est montré.' : 'Rien ce jour-là : la tuile est masquée.'}</li>`;
      const hidden = [...(hm.data || []).map((m) => ['moment', m.id, m.title, `Moment culte · ${dayLabel(m.happened_on)}`]),
        ...(he.data || []).map((e) => ['sortie', e.id, e.title, `Sortie · ${dayLabel(String(e.starts_at || '').slice(0, 10))}`])];
      hid.innerHTML = hidden.length ? hidden.map(([k, id, t, s]) => row(k, id, t, s, true)).join('') : '<li class="empty">Aucun souvenir retiré.</li>';
    } catch (e) { list.innerHTML = `<li>${sectionError(e)}</li>`; }
  }
  on.addEventListener('change', async () => {
    if (!(await saveCfg({ ce_jour_la: on.checked }, on.checked ? 'Tuile « Ce jour-là » affichée.' : 'Tuile « Ce jour-là » masquée.'))) on.checked = !on.checked;
    load();
  });
  day.addEventListener('change', load);
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cj]');
    if (!b) return;
    const [kind, id, hide] = b.dataset.cj.split(':');
    b.disabled = true;
    const { error } = await sb.rpc('hg_on_this_day_hide', { p_kind: kind, p_id: id, p_hide: hide === '1' });
    if (error) { b.disabled = false; toast(errMsg(error), 'error'); return; }
    toast(hide === '1' ? 'Retiré de « Ce jour-là ».' : 'Remis dans « Ce jour-là ».', 'ok');
    load();
  });
  return { el, load };
}
