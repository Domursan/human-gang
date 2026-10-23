// =====================================================================
// Admin : vues « Ce jour-là », « Lexique » et « Gartic » de la section Souvenirs et photos (idées S1, S2, S6).
//   Ce jour-là : interrupteur de la tuile de l'accueil, aperçu d'un jour, retrait / remise d'un souvenir.
//   Lexique : file des propositions (valider avec la case « La personne concernée est OK », corriger, refuser avec un
//     motif), mots validés et refusés ; gain d'un mot validé (borné 0 à 200).
//   Gartic : ouverture du vote « Dessin de l'année » (auto en décembre, ouvert, fermé), totaux, masquer une chaîne.
// Droit : Staff « souvenirs » (vérifié côté serveur par chaque RPC, notée au journal).
// Dépendances : core.js (sb, esc, toast, errMsg), photos.js (miniatures), helpers.js (dates, annuaire), admin/common.js.
// RPC : hg_contenu_reglages, hg_contenu_reglages_set, hg_on_this_day, hg_on_this_day_hide, hg_lexicon_review,
//   hg_gartic_state, hg_gartic_hide (migration 088).
// Exporte : createCeJourPanel, createLexiquePanel, createGarticPanel (chacune renvoie { el, load }).
// =====================================================================
import { sb, esc, toast, errMsg } from '../core.js';
import { signedUrls, thumbHtml } from '../photos.js';
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

/* ---------- Lexique ---------- */
const LEX_TABS = [['propose', 'Propositions'], ['valide', 'Validés'], ['refuse', 'Refusés']];
export function createLexiquePanel(ctx) {
  const el = document.createElement('div');
  el.className = 'sv-panel stack';
  el.innerHTML = `<div class="sv-toolbar lx-tools">
      <nav class="sv-views" aria-label="Statut des mots">${LEX_TABS.map(([k, l]) => `<button type="button" class="chip" data-lx-tab="${k}">${l}</button>`).join('')}</nav>
      <div class="field lx-gain"><label for="lx-gain">Gain d’un mot validé (Paillettes, 0 à 200)</label>
        <div class="btn-row"><input type="number" id="lx-gain" min="0" max="200" step="1" inputmode="numeric"><button type="button" class="btn btn-ghost btn-sm" id="lx-gain-save">Enregistrer</button></div></div>
    </div>
    <p class="small muted">Critère : la blague est bienveillante ; si elle vise une personne, celle-ci doit être d’accord. Rien du salon politique. Un mot validé rapporte des Paillettes à son auteur une seule fois (3 par semaine au plus).</p>
    <ul class="sv-items" id="lx-list" aria-live="polite"></ul>`;
  const S = { tab: 'propose', rows: [], people: new Map() };
  const list = el.querySelector('#lx-list');
  const who = (id) => (id ? (S.people.get(id)?.pseudo ?? 'Ancien membre') : 'Mot de départ');
  function paint() {
    for (const b of el.querySelectorAll('[data-lx-tab]')) b.setAttribute('aria-pressed', String(b.dataset.lxTab === S.tab));
    const rows = S.rows.filter((r) => r.status === S.tab);
    list.innerHTML = rows.length ? rows.map((r) => `<li class="card lx-item" data-lx="${esc(r.id)}">
      <form class="stack" novalidate>
        <div class="sv-form-row">
          <div class="field"><label for="lx-t-${esc(r.id)}">Mot</label><input id="lx-t-${esc(r.id)}" name="term" maxlength="60" value="${esc(r.term)}"></div>
          <div class="field"><label for="lx-o-${esc(r.id)}">Origine</label><input id="lx-o-${esc(r.id)}" name="origin_label" maxlength="120" value="${esc(r.origin_label || '')}"></div>
          <div class="field"><label for="lx-d-${esc(r.id)}">Date d’origine</label><input id="lx-d-${esc(r.id)}" name="origin_on" type="date" value="${esc(r.origin_on || '')}"></div>
        </div>
        <div class="field"><label for="lx-def-${esc(r.id)}">Définition</label><textarea id="lx-def-${esc(r.id)}" name="definition" maxlength="600" rows="3">${esc(r.definition)}</textarea></div>
        <div class="field"><label for="lx-ex-${esc(r.id)}">Exemple</label><input id="lx-ex-${esc(r.id)}" name="example" maxlength="280" value="${esc(r.example || '')}"></div>
        <p class="small muted">Proposé par ${esc(who(r.proposed_by))} · ${esc(dayLabel(String(r.created_at || '').slice(0, 10)))}${r.rewarded_at ? ' · gain versé' : ''}${r.refusal_reason ? ` · motif : ${esc(r.refusal_reason)}` : ''}</p>
        <label class="check"><input type="checkbox" name="consent" ${r.consent_ok ? 'checked' : ''}><span>La personne concernée est OK (obligatoire pour valider)</span></label>
        <div class="field"><label for="lx-r-${esc(r.id)}">Motif du refus (court)</label><input id="lx-r-${esc(r.id)}" name="reason" maxlength="200" value="${esc(r.refusal_reason || '')}"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary btn-sm" data-lx-do="valide">${r.status === 'valide' ? 'Enregistrer' : 'Valider'}</button>
          ${r.status !== 'refuse' ? `<button type="button" class="btn btn-ghost btn-sm" data-lx-do="refuse">${r.status === 'valide' ? 'Retirer du lexique' : 'Refuser'}</button>` : ''}
        </div>
      </form></li>`).join('') : `<li class="empty">${S.tab === 'propose' ? 'Aucune proposition en attente.' : 'Rien ici.'}</li>`;
  }
  async function load() {
    list.innerHTML = '<li class="empty">Chargement du lexique…</li>';
    try {
      const [people, res, cfg] = await Promise.all([ctx.people(), sb.from('hg_lexicon').select('*').order('created_at', { ascending: false }), readCfg()]);
      if (res.error) throw res.error;
      S.people = people; S.rows = res.data || [];
      el.querySelector('#lx-gain').value = cfg.lexique_gain ?? 20;
      paint();
    } catch (e) { list.innerHTML = `<li>${sectionError(e)}</li>`; }
  }
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-lx-tab]');
    if (t) { S.tab = t.dataset.lxTab; paint(); return; }
    if (e.target.closest('#lx-gain-save')) {
      const n = Number(el.querySelector('#lx-gain').value);
      if (!Number.isInteger(n) || n < 0 || n > 200) { toast('Gain : entier de 0 à 200.', 'error'); return; }
      await saveCfg({ lexique_gain: n }, 'Gain enregistré.'); return;
    }
    const b = e.target.closest('[data-lx-do]');
    if (!b) return;
    const li = b.closest('[data-lx]'); const f = li.querySelector('form').elements;
    const patch = { term: f.term.value.trim(), definition: f.definition.value.trim(), origin_label: f.origin_label.value.trim(), origin_on: f.origin_on.value, example: f.example.value.trim() };
    b.disabled = true;
    const { data, error } = await sb.rpc('hg_lexicon_review', { p_id: li.dataset.lx, p_status: b.dataset.lxDo, p_reason: f.reason.value.trim() || null, p_consent: f.consent.checked, p_patch: patch });
    b.disabled = false;
    if (error) { toast(errMsg(error), 'error'); return; }
    toast(b.dataset.lxDo === 'valide' ? `Mot validé${data?.paid ? ` : ${data.paid} Paillettes versées à l’auteur` : ''}.` : 'Mot refusé.', 'ok');
    load();
  });
  return { el, load };
}

/* ---------- Gartic ---------- */
export function createGarticPanel() {
  const el = document.createElement('div');
  el.className = 'sv-panel stack';
  el.innerHTML = `<section class="card stack" aria-labelledby="ga-h">
      <h3 id="ga-h" class="card-title">Vote « Dessin de l’année »</h3>
      <div class="field"><label for="ga-vote">Ouverture du vote</label>
        <select id="ga-vote"><option value="auto">Automatique : tout le mois de décembre</option><option value="ouvert">Ouvert maintenant</option><option value="ferme">Fermé</option></select></div>
      <p class="small muted" id="ga-res" aria-live="polite"></p>
    </section>
    <h3 class="card-title">Chaînes</h3>
    <ul class="sv-items" id="ga-list" aria-live="polite"></ul>`;
  const list = el.querySelector('#ga-list'), sel = el.querySelector('#ga-vote');
  async function load() {
    list.innerHTML = '<li class="empty">Chargement…</li>';
    try {
      const [cfg, st, c, p] = await Promise.all([readCfg(), sb.rpc('hg_gartic_state'),
        sb.from('hg_gartic_chains').select('id,party_id,path,thumb_path,prompt_start,prompt_end,hidden,created_at').order('created_at', { ascending: false }).limit(200),
        sb.from('hg_gartic_parties').select('id,title,played_on')]);
      if (c.error) throw c.error;
      sel.value = cfg.gartic_vote || 'auto';
      const votes = new Map(((st.data && st.data.results) || []).map((r) => [r.chain_id, r.votes]));
      el.querySelector('#ga-res').textContent = st.data ? `Année ${st.data.year} : vote ${st.data.vote_open ? 'ouvert' : 'fermé'} · ${[...votes.values()].reduce((a, b) => a + b, 0)} voix.` : '';
      const parties = new Map((p.data || []).map((x) => [x.id, x]));
      const rows = c.data || [];
      const urls = await signedUrls(rows.map((x) => x.thumb_path || x.path));
      list.innerHTML = rows.length ? rows.map((x) => `<li class="sv-row"><div class="sv-thumb">${thumbHtml(urls.get(x.thumb_path || x.path))}</div>
        <div class="sv-main"><p class="sv-title">« ${esc(x.prompt_start)} » → « ${esc(x.prompt_end)} »</p>
          <p class="small muted">${esc(parties.get(x.party_id)?.title || 'Album')} · ${votes.get(x.id) || 0} voix${x.hidden ? ' · masquée' : ''}</p></div>
        <div class="btn-row sv-row-actions"><button type="button" class="btn btn-ghost btn-sm" data-ga="${esc(x.id)}:${x.hidden ? '0' : '1'}">${x.hidden ? 'Remettre' : 'Masquer'}</button></div></li>`).join('')
        : '<li class="empty">Aucune chaîne déposée.</li>';
    } catch (e) { list.innerHTML = `<li>${sectionError(e)}</li>`; }
  }
  sel.addEventListener('change', async () => { await saveCfg({ gartic_vote: sel.value }, 'Vote mis à jour.'); load(); });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ga]');
    if (!b) return;
    const [id, h] = b.dataset.ga.split(':');
    b.disabled = true;
    const { error } = await sb.rpc('hg_gartic_hide', { p_kind: 'chain', p_id: id, p_hidden: h === '1' });
    if (error) { b.disabled = false; toast(errMsg(error), 'error'); return; }
    toast(h === '1' ? 'Chaîne masquée.' : 'Chaîne remise.', 'ok');
    load();
  });
  return { el, load };
}
