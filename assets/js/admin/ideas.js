// Admin : boîte à idées (filtres, changement de statut, attribution du badge « boîte à idées »).
import { sb, toast, esc, fmtDateTime, $, $$ } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { S, pseudoOf } from './state.js';
import { ICON, busy, check } from './common.js';
import { matches, mountSearch, bindSearch, setCount, emptyHtml } from './list-tools.js';
import { loadIdeas } from './loaders.js';
import { renderStats } from './overview.js';
import { hasBadge, awardBadge, badgeName } from './badges.js';

/* =========================================================
   Boîte à idées
   ========================================================= */
const IDEA_LABEL = { nouvelle: 'Nouvelle', retenue: 'Retenue', ecartee: 'Écartée' };
const IDEA_PILL = { nouvelle: 'pill-current', retenue: 'pill-ok', ecartee: 'pill-todo' };
const authorOf = (i) => (i.user_id ? pseudoOf(i.user_id) : 'Membre parti');
export function renderIdeas() {
  const byStatus = S.ideaFilter === 'all' ? S.ideas : S.ideas.filter((i) => i.status === S.ideaFilter);
  const list = byStatus.filter((i) => matches(S.q.idees, i.body, authorOf(i), IDEA_LABEL[i.status]));
  $$('#idea-filters .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.filter === S.ideaFilter)));
  setCount($('#idea-search-count'), list.length, byStatus.length, S.q.idees, ['idée', 'idées']);
  $('#idea-list').innerHTML = list.length ? list.map((i) => `
    <article class="item">
      <div class="item-meta"><strong>${esc(i.user_id ? pseudoOf(i.user_id) : 'Membre parti')}</strong>
        <span>${esc(fmtDateTime(i.created_at))}</span><span class="pill ${IDEA_PILL[i.status]}">${esc(IDEA_LABEL[i.status])}</span>
        ${i.status === 'retenue' && i.user_id && hasBadge(i.user_id, 'boite_a_idees') ? '<span class="pill pill-muted">badge attribué</span>' : ''}</div>
      <p class="item-body">${esc(i.body)}</p>
      <div class="btn-row">
        ${i.status !== 'retenue' ? `<button class="btn btn-ghost btn-sm" type="button" data-idea="${esc(i.id)}" data-status="retenue">${ICON.check} Retenir</button>` : ''}
        ${i.status !== 'ecartee' ? `<button class="btn btn-ghost btn-sm" type="button" data-idea="${esc(i.id)}" data-status="ecartee">Écarter</button>` : ''}
        ${i.status !== 'nouvelle' ? `<button class="btn btn-ghost btn-sm" type="button" data-idea="${esc(i.id)}" data-status="nouvelle">Remettre en nouvelle</button>` : ''}
        ${i.status === 'retenue' && i.user_id && S.byId.has(i.user_id) && !hasBadge(i.user_id, 'boite_a_idees') ? `<button class="btn btn-sand btn-sm" type="button" data-idea-badge="${esc(i.user_id)}">${ICON.badge} Attribuer le badge</button>` : ''}
      </div>
    </article>`).join('') : emptyHtml(S.q.idees, S.ideaFilter === 'nouvelle' ? 'Aucune nouvelle idée.' : 'Rien dans cette catégorie.');
}
async function offerIdeaBadge(uid) {
  if (!uid || !S.byId.has(uid) || hasBadge(uid, 'boite_a_idees')) return;
  if (await confirmBox('Attribuer le badge ?', `Attribuer le badge « ${badgeName('boite_a_idees')} » à ${pseudoOf(uid)} ?`, { ok: 'Attribuer' })) {
    await awardBadge(uid, 'boite_a_idees');
    toast(`Badge attribué à ${pseudoOf(uid)}`, 'ok');
  }
}

export function bindIdeas() {
  const search = mountSearch($('#idea-list'), { id: 'idea-search', label: 'Rechercher une idée', placeholder: 'Texte ou auteur…' });
  bindSearch(search.input, (q) => { S.q.idees = q; renderIdeas(); });
  $('#idees').addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.filter) { S.ideaFilter = t.dataset.filter; renderIdeas(); return; }
    if (t.dataset.ideaBadge) { await busy(t, () => offerIdeaBadge(t.dataset.ideaBadge)); renderIdeas(); return; }
    if (t.dataset.idea) {
      const idea = S.ideas.find((i) => i.id === t.dataset.idea);
      await busy(t, async () => {
        check(await sb.from('hg_ideas').update({ status: t.dataset.status }).eq('id', idea.id));
        await loadIdeas(); renderIdeas(); renderStats();
        toast(`Idée ${IDEA_LABEL[t.dataset.status].toLowerCase()}`, 'ok');
        if (t.dataset.status === 'retenue') await offerIdeaBadge(idea.user_id);
        renderIdeas();
      });
    }
  });
}
