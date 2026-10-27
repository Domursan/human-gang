// =====================================================================
// Admin : vue « Contenus proposés » de la section Souvenirs (idées S8, S11, S13).
// Une seule vue, trois onglets : Citations (file de validation), Playlist, Récap annuel.
// Droits (côté base) : permission « souvenirs » pour les deux premiers (hg_quote_review, hg_track_moderate),
// « reglages » pour le récap (hg_recap_diapos_set).
// Chaque action Staff est notée au journal par la base (hg_admin_audit).
// Dépendances : core.js, admin/common.js (sectionError), helpers.js.
// Exporte : createContenusPanel (fabrique la vue : élément HTML et fonction de rechargement).
// =====================================================================
import { sb, esc, toast, errMsg } from '../core.js';
import { sectionError } from '../admin/common.js';
import { stampLabel, dayLabel } from './helpers.js';

/* Onglets de la vue : [identifiant, libellé]. */
const TABS = [['citations', 'Citations'], ['playlist', 'Playlist'], ['recap', 'Récap annuel']];
/* Diapos du récap que le Staff peut masquer : [clé, libellé]. */
const DIAPOS = [['membres', 'Le gang (membres)'], ['sorties', 'Sorties'], ['presents', 'Les plus présents'], ['photos', 'Photos'], ['ss', 'Secret Santa'],
  ['moments', 'Moments cultes'], ['extras', 'Messages et badges'], ['carte', 'Carte la plus rare du gang'], ['morceaux', 'Morceaux de la semaine'],
  ['citations', 'Citations'], ['ma_carte', 'Ma carte la plus rare et mes boosters']];
const STATUS = { propose: 'En attente', valide: 'Validée', refuse: 'Refusée', retire: 'Retirée' };

/** Fabrique la vue. ctx.people() donne l'annuaire. Renvoie { el, load }. */
export function createContenusPanel(ctx) {
  const el = document.createElement('div');
  el.className = 'sv-panel stack sv-contenus';
  el.innerHTML = `<div class="sv-ct-tabs" role="tablist" aria-label="Contenus proposés">
      ${TABS.map(([k, l], i) => `<button type="button" role="tab" class="chip" id="sv-ct-t-${k}" data-ct-tab="${k}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" aria-controls="sv-ct-body">${l}</button>`).join('')}
    </div>
    <div id="sv-ct-body" role="tabpanel" aria-labelledby="sv-ct-t-citations" aria-live="polite"></div>`;
  const body = el.querySelector('#sv-ct-body');
  const S = { tab: 'citations', people: new Map(), seq: 0 };
  const who = (id) => (id ? S.people.get(id)?.pseudo ?? 'Ancien membre' : '—');

  /* ---------- Rendus par onglet ---------- */

  async function citations() {
    const { data, error } = await sb.from('hg_quotes').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    const rows = data || [];
    const order = { propose: 0, valide: 1, refuse: 2, retire: 3 };
    rows.sort((a, b) => order[a.status] - order[b.status] || String(b.created_at).localeCompare(String(a.created_at)));
    const pending = rows.filter((q) => q.status === 'propose').length;
    return `<p class="small muted">${pending} ${pending > 1 ? 'citations en attente' : 'citation en attente'}. La personne citée a le dernier mot : elle peut refuser ou retirer à tout moment.
        Refuse tout ce qui peut blesser, gêner, viser quelqu’un ou sortir une phrase de son contexte.</p>
      <ul class="sv-items">${rows.map((q) => `<li class="sv-row sv-ct-row">
        <div class="sv-main">
          <p class="sv-title">« ${esc(q.text)} »</p>
          <p class="small muted">${esc(q.author_id ? who(q.author_id) : q.author_label)}${q.context ? ` · ${esc(q.context)}` : ''}${q.said_on ? ` · ${esc(dayLabel(q.said_on))}` : ''}</p>
          <p class="small muted">Proposée par ${esc(who(q.proposed_by))} le ${esc(stampLabel(q.created_at))} · <strong>${STATUS[q.status] || esc(q.status)}</strong>${q.author_ok_game ? ' · OK pour le quiz' : ''}</p>
        </div>
        <div class="btn-row sv-row-actions">
          ${q.status === 'propose' ? `<button type="button" class="btn btn-primary btn-sm" data-ct-quote="valider" data-id="${esc(q.id)}">Valider</button>
            <button type="button" class="btn btn-ghost btn-sm" data-ct-quote="refuser" data-id="${esc(q.id)}">Refuser</button>` : ''}
          ${q.status === 'valide' ? `<button type="button" class="btn btn-ghost btn-sm" data-ct-quote="retirer" data-id="${esc(q.id)}">Retirer du mur</button>` : ''}
        </div></li>`).join('') || '<li class="empty">Aucune citation proposée.</li>'}</ul>`;
  }

  async function playlist() {
    const { data, error } = await sb.from('hg_tracks').select('*').order('created_at', { ascending: false }).limit(80);
    if (error) throw error;
    return `<ul class="sv-items">${(data || []).map((t) => `<li class="sv-row sv-ct-row"><div class="sv-main">
        <p class="sv-title">${esc(t.title)}${t.artist ? ` · ${esc(t.artist)}` : ''}</p>
        <p class="small muted">${esc(who(t.added_by))} · ${esc(stampLabel(t.created_at))} · ${esc(t.platform)}${t.hidden ? ' · <strong>masqué</strong>' : ''}${t.heardle_ok ? ' · bon pour le Heardle' : ''}</p>
        <p class="small"><a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(t.url)}</a></p></div>
      <div class="btn-row sv-row-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-ct-track="${t.heardle_ok ? 'heardle_non' : 'heardle_oui'}" data-id="${esc(t.id)}" aria-pressed="${t.heardle_ok}">Heardle</button>
        <button type="button" class="btn btn-ghost btn-sm" data-ct-track="${t.hidden ? 'afficher' : 'masquer'}" data-id="${esc(t.id)}">${t.hidden ? 'Réafficher' : 'Masquer'}</button>
      </div></li>`).join('') || '<li class="empty">Aucun morceau partagé.</li>'}</ul>`;
  }

  async function recap() {
    const { data } = await sb.rpc('hg_year_recap', { p_year: new Date().getFullYear() });
    const hidden = new Set(Array.isArray(data?.masquees) ? data.masquees : []);
    return `<form class="stack" id="sv-ct-recap"><p class="small muted">Diapos du récap annuel à masquer pour tout le monde (permission « réglages »). L’intro et « Ton année » restent toujours.
        Une diapo sans données est déjà sautée automatiquement.</p>
      <fieldset class="sv-ct-diapos"><legend>Diapos masquées</legend>
        ${DIAPOS.map(([k, l]) => `<label class="check"><input type="checkbox" name="d" value="${k}"${hidden.has(k) ? ' checked' : ''}> <span>${l}</span></label>`).join('')}</fieldset>
      <div class="btn-row"><button type="submit" class="btn btn-primary btn-sm">Enregistrer</button></div></form>`;
  }

  const RENDER = { citations, playlist, recap };

  /** Recharge l'onglet affiché. */
  async function load() {
    const my = ++S.seq;
    body.innerHTML = '<p class="empty">Chargement…</p>';
    try {
      if (!S.people.size) S.people = await ctx.people();
      const html = await RENDER[S.tab]();
      if (my !== S.seq) return;
      body.innerHTML = html;
    } catch (e) {
      if (my !== S.seq) return;
      body.innerHTML = sectionError(e);
    }
  }

  /** Action Staff puis rechargement de l'onglet. */
  async function act(btn, fn, args, ok) {
    btn.disabled = true;
    try {
      const { error } = await sb.rpc(fn, args);
      if (error) throw error;
      toast(ok, 'ok');
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
      btn.disabled = false;
    }
  }

  function selectTab(k, focus = false) {
    S.tab = k;
    for (const b of el.querySelectorAll('[data-ct-tab]')) {
      const on = b.dataset.ctTab === k;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    body.setAttribute('aria-labelledby', `sv-ct-t-${k}`);
    load();
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ct-tab]');
    if (t) { selectTab(t.dataset.ctTab); return; }
    const q = e.target.closest('[data-ct-quote]');
    if (q) {
      const a = q.dataset.ctQuote;
      act(q, 'hg_quote_review', { p_id: q.dataset.id, p_action: a }, a === 'valider' ? 'Citation validée.' : a === 'refuser' ? 'Citation refusée.' : 'Citation retirée du mur.');
      return;
    }
    const tr = e.target.closest('[data-ct-track]');
    if (tr) act(tr, 'hg_track_moderate', { p_id: tr.dataset.id, p_action: tr.dataset.ctTrack }, 'Morceau mis à jour.');
  });
  el.addEventListener('keydown', (e) => {
    if (!e.target.matches('[data-ct-tab]') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const i = TABS.findIndex(([k]) => k === S.tab);
    selectTab(TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0], true);
  });
  el.addEventListener('submit', (e) => {
    if (e.target.id !== 'sv-ct-recap') return;
    e.preventDefault();
    const keys = [...e.target.querySelectorAll('input[name="d"]:checked')].map((i) => i.value);
    act(e.target.querySelector('button[type="submit"]'), 'hg_recap_diapos_set', { p_keys: keys }, 'Diapos du récap enregistrées.');
  });

  return { el, load };
}
