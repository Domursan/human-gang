// =====================================================================
// Admin : réactions aux souvenirs et aux photos (vue « Réactions » de la section).
// Liste des réactions actives (hg_reactions.active = true), la plus récente d'abord, 30 par page.
// Masquer = active à false (la ligne reste en base ; le membre peut toujours la rétablir en cliquant à nouveau).
// Droit : politique hg_reactions_moderation (permission « souvenirs »).
// Dépendances : core.js (sb, esc, toast, errMsg), reactions.js (libellés des réactions), photos.js (miniatures signées),
// icons.js (svg), admin/common.js (sectionError), helpers.js (pagination, dates, annuaire).
// Exporte : createReactionsPanel (fabrique la vue : élément HTML et fonction de rechargement).
// =====================================================================
import { sb, esc, toast, errMsg } from '../core.js';
import { REACTION_LABEL } from '../reactions.js';
import { signedUrls, thumbHtml } from '../photos.js';
import { svg } from '../icons.js';
import { sectionError } from '../admin/common.js';
import { pageRange, pageOf, pagerHtml, stampLabel, peopleOptions } from './helpers.js';

/* Cibles des idées S8, S13 (le détail se consulte dans la vue « Contenus proposés »). */
const OTHER_KIND = { quote: 'Une citation du mur', track: 'Un morceau de la playlist' };
/* Icône du bouton « Masquer ». */
const ICON = { hide: svg('eye', { size: 16, stroke: 1.8 }) };

/** Fabrique la vue Réactions. ctx.people() donne l'annuaire. Renvoie { el, load } : l'élément à afficher et la fonction de rechargement. */
export function createReactionsPanel(ctx) {
  const el = document.createElement('div');
  el.className = 'sv-panel stack';
  el.innerHTML = `
    <div class="sv-toolbar sv-filters">
      <div class="field">
        <label for="sv-re-member">Membre</label>
        <select id="sv-re-member"></select>
      </div>
    </div>
    <ul class="sv-items" id="sv-re-list" aria-live="polite"></ul>
    <div id="sv-re-pager"></div>`;
  const list = el.querySelector('#sv-re-list');
  const pager = el.querySelector('#sv-re-pager');
  const memberSel = el.querySelector('#sv-re-member');
  const S = { member: '', page: 0, rows: [], people: new Map(), targets: new Map(), urls: new Map(), seqNo: 0, filled: false };

  /** Charge la page de réactions demandée (et l'annuaire au premier passage), puis affiche la liste. Ignore une réponse périmée. */
  async function load() {
    const my = ++S.seqNo;
    list.innerHTML = '<li class="empty">Chargement des réactions…</li>';
    pager.innerHTML = '';
    try {
      if (!S.filled) {
        S.people = await ctx.people();
        memberSel.innerHTML = peopleOptions(S.people, '', 'Tous les membres');
        S.filled = true;
      }
      let q = sb.from('hg_reactions').select('id,target_kind,target_id,user_id,emoji,created_at')
        .eq('active', true).order('created_at', { ascending: false });
      if (S.member) q = q.eq('user_id', S.member);
      const { data, error } = await q.range(...pageRange(S.page));
      if (error) throw error;
      const { rows, hasNext } = pageOf(data);
      const targets = await loadTargets(rows);
      const urls = await signedUrls([...targets.values()].map((t) => t.path));
      if (my !== S.seqNo) return;
      S.rows = rows; S.targets = targets; S.urls = urls;
      render(hasNext);
    } catch (e) {
      if (my !== S.seqNo) return;
      list.innerHTML = `<li>${sectionError(e)}</li>`;
    }
  }

  /** Titres (souvenirs) et sorties (photos) visés par les réactions de la page, en deux requêtes. */
  async function loadTargets(rows) {
    const out = new Map();
    /* Identifiants distincts des cibles d'un type donné (souvenir ou photo). */
    const ids = (kind) => [...new Set(rows.filter((r) => r.target_kind === kind).map((r) => r.target_id))];
    const mIds = ids('moment');
    const pIds = ids('photo');
    const [m, p] = await Promise.all([
      mIds.length ? sb.from('hg_moments').select('id,title,image_path').in('id', mIds) : { data: [] },
      pIds.length ? sb.from('hg_photos').select('id,event_id,path').in('id', pIds) : { data: [] },
    ]);
    if (m.error) throw m.error;
    if (p.error) throw p.error;
    const evIds = [...new Set((p.data || []).map((x) => x.event_id).filter(Boolean))];
    const ev = evIds.length ? await sb.from('hg_events').select('id,title').in('id', evIds) : { data: [] };
    if (ev.error) throw ev.error;
    const evTitle = new Map((ev.data || []).map((e) => [e.id, e.title]));
    for (const x of m.data || []) out.set(`moment:${x.id}`, { label: `Souvenir « ${x.title} »`, path: x.image_path });
    for (const x of p.data || []) out.set(`photo:${x.id}`, { label: `Photo de la sortie « ${evTitle.get(x.event_id) ?? 'sortie supprimée'} »`, path: x.path });
    return out;
  }

  /** Affiche les lignes de la page, ou un message si la liste est vide, puis les boutons de page. */
  function render(hasNext) {
    if (!S.rows.length) {
      list.innerHTML = `<li class="empty">${S.member ? 'Aucune réaction active de ce membre.' : 'Aucune réaction active.'}</li>`;
    } else {
      list.innerHTML = S.rows.map(row).join('');
    }
    pager.innerHTML = pagerHtml(S.page, hasNext);
  }

  /** HTML d'une réaction : qui a réagi, à quoi, quand, et le bouton « Masquer ». */
  function row(r) {
    const t = S.targets.get(`${r.target_kind}:${r.target_id}`);
    const who = S.people.get(r.user_id)?.pseudo ?? 'Ancien membre';
    const url = t?.path ? S.urls.get(t.path) : null;
    const emoji = r.emoji;
    const label = REACTION_LABEL[emoji] ?? 'Réaction';
    return `<li class="sv-row sv-reaction" data-id="${esc(r.id)}">
      <div class="sv-thumb">${url ? thumbHtml(url) : '<span class="sv-emoji" aria-hidden="true">' + esc(emoji) + '</span>'}</div>
      <div class="sv-main">
        <p><span class="sv-emoji" aria-hidden="true">${esc(emoji)}</span> <strong>${esc(who)}</strong> a réagi (${esc(label.toLowerCase())}) à</p>
        <p class="sv-title">${t ? esc(t.label) : (OTHER_KIND[r.target_kind] || (r.target_kind === 'moment' ? 'Souvenir supprimé' : 'Photo supprimée'))}</p>
        <p class="small muted">${esc(stampLabel(r.created_at))}</p>
      </div>
      <div class="btn-row sv-row-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-sv-hide="${esc(r.id)}" aria-label="Masquer la réaction de ${esc(who)}">${ICON.hide}<span>Masquer</span></button>
      </div>
    </li>`;
  }

  /** Masque une réaction (active = false), puis recharge la liste. */
  async function hide(id, btn) {
    btn.disabled = true;
    try {
      const { error } = await sb.from('hg_reactions').update({ active: false }).eq('id', id);
      if (error) throw error;
      toast('Réaction masquée.', 'ok');
      await load();
    } catch (e) {
      toast(`Réaction non masquée : ${errMsg(e)}`, 'error');
      btn.disabled = false;
    }
  }

  memberSel.addEventListener('change', () => { S.member = memberSel.value; S.page = 0; load(); });
  el.addEventListener('click', (e) => {
    const pageBtn = e.target.closest('[data-sv-page]');
    if (pageBtn && !pageBtn.disabled) { S.page = Number(pageBtn.dataset.svPage); load(); return; }
    const b = e.target.closest('[data-sv-hide]');
    if (b) hide(b.dataset.svHide, b);
  });

  return { el, load };
}
