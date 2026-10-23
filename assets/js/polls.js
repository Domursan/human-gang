// ===== Humane Gang — sondages libres du fil d'activité (idée P5, migration 090) =====
/*
 * Rôle : bouton « Créer un sondage » (question, 2 à 6 réponses, durée 1 h à 7 jours, plusieurs réponses, votes anonymes),
 * cartes de sondage dans le fil de l'accueil (vote d'un tap, barres, avatars des votants sauf anonymat, temps restant,
 * résultat à la clôture), liste « Tous les sondages ». Les sondages de dates des sorties restent sur la page IRL.
 * Affichage : les N sondages ouverts les plus récents (réglage social.plafonds.sondages_accueil, 5) sont en carte ;
 * les autres lignes du fil gardent un bouton « Voir le sondage ».
 * L'anonymat est garanti par le serveur (hg_polls_get ne renvoie jamais les votants d'un sondage anonyme).
 * Dépendances : core.js, social.js (réglages, boîte de dialogue), icons.js.
 * RPC : hg_polls_get, hg_poll_create, hg_poll_vote, hg_poll_close, hg_poll_remove.
 * Exporte : mountPolls, pollCardHtml (tests).
 */
import { sb, esc, toast, errMsg, avatarHtml, fmtDateTime } from './core.js';
import { socialSettings, openDialog } from './social.js';
import { confirmBox } from './ui-confirm.js';
import { svg } from './icons.js';

const I = {
  poll: svg('pulse', { size: 16, stroke: 2 }),
  plus: svg('plus', { size: 16, stroke: 2 }),
  check: svg('check', { size: 14, stroke: 3 }),
  list: svg('chat', { size: 16, stroke: 2 }),
  trash: svg('trash', { size: 16, stroke: 2 }),
  close: svg('close', { size: 16, stroke: 2 }),
};
/** Durées proposées à la création, en heures. */
const DURATIONS = [[1, '1 h'], [3, '3 h'], [6, '6 h'], [12, '12 h'], [24, '24 h'], [48, '2 jours'], [72, '3 jours'], [168, '7 jours']];
const BAR_COLORS = ['var(--slate)', 'var(--rust)', 'var(--sage)', 'var(--plum)', 'var(--rose)', 'var(--amber)'];

/** État du module : sondages connus (id → sondage), membres (id → membre), rechargement du fil. */
const P = { polls: new Map(), members: new Map(), reload: null, feed: null };

/** « dans 3 h », « dans 2 j », « dans 12 min ». */
function left(ts) {
  const ms = new Date(ts) - Date.now();
  if (ms <= 0) return 'terminé';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} jours`;
}
/** « il y a 2 h », « à l’instant ». */
function ago(ts) {
  const min = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `il y a ${h} h` : `il y a ${Math.floor(h / 24)} j`;
}
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/**
 * HTML d'une carte de sondage.
 * @param {object} p sondage (hg_polls_get)
 * @param {Map<string, object>} members membres (id → {pseudo, avatar_url, color})
 * @returns {string}
 */
export function pollCardHtml(p, members = P.members) {
  const author = members.get(p.created_by) || { pseudo: 'Ancien membre' };
  const total = Number(p.total) || 0;
  const counts = Array.isArray(p.counts) ? p.counts.map(Number) : [];
  const mine = new Set((p.mine || []).map(Number));
  const max = Math.max(0, ...counts);
  const winners = p.closed && total ? counts.map((c, i) => (c === max ? p.options[i] : null)).filter(Boolean) : [];
  const opts = (p.options || []).map((o, i) => {
    const c = counts[i] || 0, pct = total ? Math.round((c / total) * 100) : 0, on = mine.has(i);
    const voters = Array.isArray(p.voters?.[i]) ? p.voters[i] : [];
    const avs = !p.anonymous && voters.length
      ? `<span class="poll-avs" aria-label="${esc(voters.map((v) => members.get(v)?.pseudo || 'Ancien membre').join(', '))}">${voters.slice(0, 8).map((v) => avatarHtml(members.get(v) || { id: v, pseudo: '?' }, 20)).join('')}${voters.length > 8 ? `<span class="poll-more">+${voters.length - 8}</span>` : ''}</span>` : '';
    return `<li><button type="button" class="poll-opt${on ? ' is-mine' : ''}${p.closed && winners.includes(o) ? ' is-win' : ''}" data-poll="${esc(p.id)}" data-opt="${i}"
        aria-pressed="${on}"${p.closed ? ' disabled' : ''}>
      <span class="poll-opt-top"><span class="poll-chk${p.multi ? ' is-multi' : ''}" aria-hidden="true">${on ? I.check : ''}</span><strong class="poll-opt-label">${esc(o)}</strong>
        <span class="poll-opt-n small"><strong>${pct} %</strong> <span class="muted">· ${c}</span></span></span>
      <span class="poll-bar" aria-hidden="true"><span style="width:${pct}%;background:${on ? 'var(--sand)' : BAR_COLORS[i % BAR_COLORS.length]}"></span></span>
      ${avs}
    </button></li>`;
  }).join('');
  const mode = `${p.multi ? 'plusieurs réponses' : 'une seule réponse'}${p.anonymous ? ' · votes anonymes' : ''}`;
  const result = p.closed
    ? `<p class="poll-result">${total ? `Résultat : <strong>${esc(winners.join(' / '))}</strong> (${plural(max, 'voix', 'voix')} sur ${total})` : 'Sondage clos sans vote.'}</p>` : '';
  const actions = [p.can_close ? `<button type="button" class="btn btn-ghost btn-sm" data-poll-close="${esc(p.id)}">${I.close}<span>Clôturer</span></button>` : '',
    p.can_remove ? `<button type="button" class="btn btn-danger btn-sm" data-poll-remove="${esc(p.id)}">${I.trash}<span>Retirer</span></button>` : ''].join('');
  return `<article class="poll-card${p.closed ? ' is-closed' : ''}" id="poll-${esc(p.id)}" aria-labelledby="poll-q-${esc(p.id)}">
    <header class="poll-by">${avatarHtml(author, 32)}<span><span class="poll-by-txt"><strong>${esc(author.pseudo)}</strong> a lancé un sondage</span>
      <span class="small muted">${esc(ago(p.created_at))} · ${p.closed ? `clos le ${esc(fmtDateTime(p.closed_at || p.closes_at))}` : `se termine dans ${esc(left(p.closes_at))}`}</span></span></header>
    <h3 class="poll-q" id="poll-q-${esc(p.id)}">${esc(p.question)}</h3>
    ${result}
    <ul class="poll-opts" role="list">${opts}</ul>
    <p class="poll-foot small muted"><span>${plural(total, 'votant', 'votants')} · ${esc(mode)}</span>${p.closed ? '' : `<span>${mine.size ? 'Tu peux changer ton vote' : 'Vote d’un tap'}</span>`}</p>
    ${actions ? `<div class="btn-row poll-actions">${actions}</div>` : ''}
  </article>`;
}

/** Recharge des sondages par identifiant et les garde en mémoire. */
async function fetchPolls(ids = null, limit = 20) {
  const { data, error } = await sb.rpc('hg_polls_get', { p_ids: ids, p_limit: limit });
  if (error) throw error;
  for (const p of data || []) P.polls.set(p.id, p);
  return data || [];
}

/** Redessine toutes les cartes affichées d'un sondage (fil, dialogue). */
function repaint(id) {
  const p = P.polls.get(id);
  document.querySelectorAll(`[data-poll-slot="${CSS.escape(id)}"]`).forEach((slot) => { slot.innerHTML = p ? pollCardHtml(p) : ''; });
}

/** Vote (ou retrait) sur une réponse ; un sondage simple remplace la réponse, un sondage multiple ajoute ou retire. */
async function vote(id, idx, btn) {
  const p = P.polls.get(id);
  if (!p || p.closed) return;
  const mine = new Set((p.mine || []).map(Number));
  let next;
  if (p.multi) { if (mine.has(idx)) mine.delete(idx); else mine.add(idx); next = [...mine]; }
  else next = mine.has(idx) && mine.size === 1 ? [] : [idx];
  btn.disabled = true;
  try {
    const { error } = await sb.rpc('hg_poll_vote', { p_poll: id, p_options: next });
    if (error) throw error;
    await fetchPolls([id]);
    repaint(id);
    document.querySelector(`[data-poll-slot="${CSS.escape(id)}"] [data-opt="${idx}"]`)?.focus();
  } catch (e) { toast(`Vote impossible : ${errMsg(e)}`, 'error'); btn.disabled = false; }
}

/** Clic délégué : vote, clôture, retrait, « Voir le sondage ». */
async function onClick(e) {
  const opt = e.target.closest('[data-opt]');
  if (opt) { vote(opt.dataset.poll, Number(opt.dataset.opt), opt); return; }
  const close = e.target.closest('[data-poll-close]');
  if (close) {
    if (!(await confirmBox('Clôturer ce sondage ?', 'Plus personne ne pourra voter ; le résultat est posté dans le fil.', { ok: 'Clôturer' }))) return;
    try {
      const { error } = await sb.rpc('hg_poll_close', { p_poll: close.dataset.pollClose });
      if (error) throw error;
      toast('Sondage clôturé.', 'ok');
      P.reload?.();
    } catch (err) { toast(errMsg(err), 'error'); }
    return;
  }
  const rm = e.target.closest('[data-poll-remove]');
  if (rm) {
    if (!(await confirmBox('Retirer ce sondage ?', 'Il disparaît du fil pour tout le monde.', { ok: 'Retirer', danger: true }))) return;
    try {
      const { error } = await sb.rpc('hg_poll_remove', { p_poll: rm.dataset.pollRemove });
      if (error) throw error;
      toast('Sondage retiré.', 'ok');
      document.getElementById('poll-dlg')?.close();
      P.reload?.();
    } catch (err) { toast(errMsg(err), 'error'); }
    return;
  }
  const see = e.target.closest('[data-poll-see]');
  if (see) openPoll(see.dataset.pollSee);
}

/** Ouvre un sondage dans une boîte de dialogue (sondage ancien ou hors des cartes de l'accueil). */
async function openPoll(id) {
  try { if (!P.polls.has(id)) await fetchPolls([id]); } catch (e) { toast(errMsg(e), 'error'); return; }
  const p = P.polls.get(id);
  if (!p) { toast('Ce sondage n’existe plus.', 'error'); return; }
  const dlg = openDialog({ id: 'poll-dlg', title: 'Sondage', body: `<div data-poll-slot="${esc(id)}">${pollCardHtml(p)}</div>` });
  dlg.addEventListener('click', onClick);
}

/** Liste « Tous les sondages » : les 20 plus récents, ouverts ou clos. */
async function openAll() {
  let list = [];
  try { list = await fetchPolls(null, 20); } catch (e) { toast(errMsg(e), 'error'); return; }
  const dlg = openDialog({ id: 'poll-dlg', title: 'Sondages', wide: true,
    body: list.length ? `<div class="poll-all">${list.map((p) => `<div data-poll-slot="${esc(p.id)}">${pollCardHtml(p)}</div>`).join('')}</div>`
      : '<p class="empty">Aucun sondage pour l’instant. Lance le premier !</p>' });
  dlg.addEventListener('click', onClick);
}

/** Boîte de création d'un sondage. */
async function openCreate() {
  const cfg = await socialSettings();
  const dlg = openDialog({ id: 'poll-new-dlg', title: 'Nouveau sondage', body: `<form class="stack poll-form" id="poll-form" novalidate>
    <div class="field"><label for="poll-q">Ta question</label>
      <input id="poll-q" maxlength="140" required placeholder="Pizza ou raclette pour samedi ?"></div>
    <fieldset class="poll-answers"><legend>Réponses (2 à 6)</legend>
      <ol class="poll-answer-list" id="poll-answers"></ol>
      <button type="button" class="btn btn-ghost btn-sm" id="poll-add">${I.plus}<span>Ajouter une réponse</span></button>
    </fieldset>
    <div class="field"><label for="poll-h">Durée</label>
      <select id="poll-h">${DURATIONS.map(([h, l]) => `<option value="${h}"${h === 24 ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <label class="check"><input type="checkbox" id="poll-multi"> <span>Plusieurs réponses possibles</span></label>
    <label class="check"><input type="checkbox" id="poll-anon"> <span>Votes anonymes (personne ne voit qui a voté quoi, même pas toi)</span></label>
    <p class="small muted">${cfg.plafonds.sondages_jour} sondages par jour au plus. Pas de sondage qui vise quelqu’un, et rien de politique.</p>
    <p class="form-error" id="poll-err" role="alert" hidden></p>
    <div class="btn-row"><button class="btn btn-sand" type="submit">Lancer le sondage</button></div>
  </form>` });
  const ol = dlg.querySelector('#poll-answers');
  /** Ajoute un champ de réponse (6 au plus). */
  const add = (v = '') => {
    const n = ol.children.length;
    if (n >= 6) return;
    const li = document.createElement('li');
    li.className = 'poll-answer';
    li.innerHTML = `<label class="visually-hidden" for="poll-a${n}">Réponse ${n + 1}</label><input id="poll-a${n}" maxlength="60" value="${esc(v)}" placeholder="Réponse ${n + 1}">
      <button type="button" class="btn btn-ghost soc-icon-btn" data-rm aria-label="Retirer la réponse ${n + 1}">${I.close}</button>`;
    ol.append(li);
    sync();
  };
  /** Boutons « retirer » (2 réponses au moins) et « ajouter » (6 au plus). */
  const sync = () => {
    const rows = [...ol.children];
    rows.forEach((li) => { li.querySelector('[data-rm]').disabled = rows.length <= 2; });
    dlg.querySelector('#poll-add').disabled = rows.length >= 6;
  };
  ol.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b && ol.children.length > 2) { b.closest('li').remove(); sync(); } });
  dlg.querySelector('#poll-add').addEventListener('click', () => { add(); ol.lastElementChild?.querySelector('input')?.focus(); });
  add(); add();
  dlg.querySelector('#poll-q').focus();
  dlg.querySelector('#poll-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = dlg.querySelector('#poll-err'), btn = e.target.querySelector('[type=submit]');
    const q = dlg.querySelector('#poll-q').value.trim();
    const answers = [...ol.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (!q) return fail('Écris ta question.');
    if (answers.length < 2) return fail('Donne au moins deux réponses.');
    if (new Set(answers.map((a) => a.toLowerCase())).size !== answers.length) return fail('Deux réponses sont identiques.');
    err.hidden = true; btn.disabled = true;
    try {
      const { error } = await sb.rpc('hg_poll_create', { p_question: q, p_options: answers, p_hours: Number(dlg.querySelector('#poll-h').value),
        p_multi: dlg.querySelector('#poll-multi').checked, p_anonymous: dlg.querySelector('#poll-anon').checked });
      if (error) throw error;
      dlg.close();
      toast('Sondage lancé !', 'ok');
      P.reload?.();
    } catch (ex) { fail(errMsg(ex)); btn.disabled = false; }
  });
}

/**
 * Branche les sondages sur le fil de l'accueil : boutons d'en-tête, cartes à la place des lignes « sondage ».
 * @param {{feed: HTMLElement, head: HTMLElement|null, rows: Array<object>, members: Map<string, object>, reload: Function}} o
 *   feed : la liste du fil ; head : zone des boutons ; rows : lignes affichées (hg_activity, avec ref) ; reload : recharge le fil
 */
export async function mountPolls({ feed, head, rows = [], members = new Map(), reload = null }) {
  P.members = members; P.reload = reload; P.feed = feed;
  if (head && !head.dataset.ready) {
    head.dataset.ready = '1';
    head.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" id="poll-all">${I.list}<span>Sondages</span></button>
      <button type="button" class="btn btn-sand btn-sm" id="poll-new">${I.plus}<span>Créer un sondage</span></button>`;
    head.querySelector('#poll-new').addEventListener('click', openCreate);
    head.querySelector('#poll-all').addEventListener('click', openAll);
  }
  if (!feed) return;
  if (!feed.dataset.pollClick) { feed.dataset.pollClick = '1'; feed.addEventListener('click', onClick); }
  const ids = [...new Set(rows.filter((r) => /^poll:[0-9a-f-]{36}$/i.test(r.ref || '')).map((r) => r.ref.slice(5)))];
  if (!ids.length) return;
  const cfg = await socialSettings();
  let list = [];
  try { list = await fetchPolls(ids); } catch (e) { console.warn('[sondages]', e?.message || e); return; }
  // Cartes : les sondages ouverts les plus récents (réglage), une seule fois chacun (sur leur ligne « sondage »).
  const open = list.filter((p) => !p.closed).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, cfg.plafonds.sondages_accueil || 5).map((p) => p.id);
  const done = new Set();
  feed.querySelectorAll('li[data-ref^="poll:"]').forEach((li) => {
    const id = li.dataset.ref.slice(5), p = P.polls.get(id);
    if (!p) return;
    if (li.dataset.kind === 'sondage' && open.includes(id) && !done.has(id)) {
      done.add(id);
      li.classList.add('feed-poll');
      li.innerHTML = `<div class="feed-poll-slot" data-poll-slot="${esc(id)}">${pollCardHtml(p)}</div>`;
    } else if (!li.querySelector('[data-poll-see]')) {
      li.querySelector('.feed-text')?.insertAdjacentHTML('beforeend', `<button type="button" class="btn btn-ghost btn-sm feed-poll-see" data-poll-see="${esc(id)}">Voir le sondage</button>`);
    }
  });
}
