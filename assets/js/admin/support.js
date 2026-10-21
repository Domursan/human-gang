// Admin : demandes d'assistance (filtres, statut, badge « chasseur de bugs »).
import { sb, toast, esc, fmtDateTime, $, $$ } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { S, pseudoOf, SUBJECT_BUG } from './state.js';
import { ICON, busy, check, copyText } from './common.js';
import { loadSupport } from './loaders.js';
import { renderStats } from './overview.js';
import { hasBadge, awardBadge, badgeName } from './badges.js';

/* =========================================================
   Assistance
   ========================================================= */
export function renderSupport() {
  const list = S.support.filter((s) => s.status === S.supportFilter);
  $$('#support-filters .chip').forEach((c) => {
    c.setAttribute('aria-pressed', String(c.dataset.filter === S.supportFilter));
    const n = S.support.filter((s) => s.status === c.dataset.filter).length;
    c.textContent = `${c.dataset.filter === 'ouverte' ? 'Ouvertes' : 'Traitées'} (${n})`;
  });
  $('#support-list').innerHTML = list.length ? list.map((s) => `
    <article class="item">
      <div class="item-meta"><strong>${esc(s.pseudo)}</strong>
        <span class="pill ${s.user_id ? 'pill-ok' : 'pill-warn'}"${s.user_id ? '' : ' title="Demande envoyée sans compte : le pseudo n\'est pas vérifié"'}>${s.user_id ? 'Membre connecté' : 'Non connecté · pseudo non vérifié'}</span>
        <span>${esc(fmtDateTime(s.created_at))}</span>
        <span class="pill ${s.discord_sent ? 'pill-ok' : 'pill-warn'}" title="${s.discord_sent ? 'Le bot t\'a envoyé cette demande en MP' : 'Le MP Discord n\'a pas été envoyé (bot non configuré ou erreur)'}">${s.discord_sent ? 'MP Discord envoyé' : 'MP Discord non envoyé'}</span></div>
      <div class="item-subject">${esc(s.subject)}</div>
      <p class="item-body">${esc(s.message)}</p>
      <div class="small muted">Contact pour la réponse : ${s.contact ? `<strong class="text">${esc(s.contact)}</strong>` : 'non précisé'}</div>
      <div class="btn-row">
        ${s.status === 'ouverte'
          ? `<button class="btn btn-primary btn-sm" type="button" data-support="${esc(s.id)}" data-status="traitee">${ICON.check} Marquer traitée</button>`
          : `<button class="btn btn-ghost btn-sm" type="button" data-support="${esc(s.id)}" data-status="ouverte">Rouvrir</button>`}
        ${s.contact ? `<button class="btn btn-ghost btn-sm" type="button" data-copy="${esc(s.contact)}">${ICON.copy} Copier le contact</button>` : ''}
        ${s.subject === SUBJECT_BUG && s.user_id && S.byId.has(s.user_id) && !hasBadge(s.user_id, 'chasseur_bugs')
          ? `<button class="btn btn-sand btn-sm" type="button" data-bug-badge="${esc(s.user_id)}">${ICON.badge} Badge ${esc(badgeName('chasseur_bugs'))}</button>` : ''}
      </div>
    </article>`).join('') : `<div class="empty">${S.supportFilter === 'ouverte' ? 'Aucune demande en attente.' : 'Aucune demande traitée.'}</div>`;
}

export function bindSupport() {
  $('#assistance').addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.filter) { S.supportFilter = t.dataset.filter; renderSupport(); return; }
    if (t.dataset.copy) return copyText(t.dataset.copy);
    if (t.dataset.bugBadge) {
      const uid = t.dataset.bugBadge;
      if (!(await confirmBox('Attribuer le badge ?', `Attribuer « ${badgeName('chasseur_bugs')} » à ${pseudoOf(uid)} ?`, { ok: 'Attribuer' }))) return;
      await busy(t, async () => { await awardBadge(uid, 'chasseur_bugs'); renderSupport(); toast('Badge attribué', 'ok'); });
    }
    if (t.dataset.support) {
      await busy(t, async () => {
        check(await sb.from('hg_support').update({ status: t.dataset.status }).eq('id', t.dataset.support));
        await loadSupport(); renderSupport(); renderStats();
        toast(t.dataset.status === 'traitee' ? 'Demande marquée comme traitée' : 'Demande rouverte', 'ok');
      });
    }
  });
}
