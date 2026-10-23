// ===== Humane Gang — Mur des citations (citations.html), idée S13 =====
/*
 * Rôle : mur de post-it des citations validées (filtre par année, personne, contexte), réactions, proposition
 * d'une citation, bandeau « On t'a cité » (la personne citée refuse ou accepte, et dit si la citation peut servir
 * au jeu « Qui a dit ça ? »), liste de mes propositions et des citations qui me concernent.
 * Page : citations.html (membres).
 * Dépendances : core.js, reactions.js (barre de réactions, cible « quote »), contenus-ui.js.
 * Données : table hg_quotes (lecture, filtrée par la base : validées, mes propositions, celles qui me citent) ;
 *   RPC hg_quote_propose, hg_quote_author_decide, hg_members ; hg_toggle_reaction via reactions.js.
 * Tout texte venant de la base passe par esc(). Le fichier n'exporte rien.
 */
import { sb, initPage, esc, $, toast, errMsg } from './core.js';
import { loadReactions, reactionBarHtml, REACTION_LABEL } from './reactions.js';
import { loadPeople, pseudoOf, formDialog, chipsHtml, setPressed, fmtJour } from './contenus-ui.js';

const me = await initPage();

/* ---------- État ---------- */
const S = { rows: [], people: new Map(), year: 'tous', person: '', context: '', open: new Set(), busy: false };
/** Couleurs des post-it (couleurs de section du site), en boucle. */
const COLORS = ['var(--sand)', 'var(--slate)', 'var(--sage)', 'var(--rose)', 'var(--plum)', '#D8A75E'];
/** Légère inclinaison des post-it (fixe, pas d'animation). */
const TILT = [-1, 1, -0.5, 1.2, -1, 0.6];
const STATUS = { propose: ['En attente du Staff', 'ct-status-wait'], valide: ['Sur le mur', 'ct-status-ok'], refuse: ['Refusée', 'ct-status-ko'], retire: ['Retirée', 'ct-status-ko'] };

/** Année d'une citation : date où elle a été dite, sinon date de validation. */
const yearOf = (q) => String(q.said_on || q.validated_at || q.created_at || '').slice(0, 4);
/** Auteur affiché : pseudo du membre cité, ou auteur collectif (« Tout le gang »). */
const authorOf = (q) => (q.author_id ? pseudoOf(S.people, q.author_id) : q.author_label || '');
/** Citations visibles sur le mur. */
const wall = () => S.rows.filter((q) => q.status === 'valide');

/* ---------- Dessin ---------- */

/** Résumé compact des réactions d'un post-it (émojis ayant au moins une réaction), lu dans la barre cachée. */
function summaryHtml(id) {
  const tmp = document.createElement('div');
  tmp.innerHTML = reactionBarHtml('quote', id);
  const parts = [...tmp.querySelectorAll('[data-emoji]')].map((b) => [b.dataset.emoji, Number(b.querySelector('.react-count')?.textContent) || 0])
    .filter(([, n]) => n > 0);
  if (!parts.length) return '<span class="qt-rx-none">Pas encore de réaction</span>';
  return parts.map(([e, n]) => `<span class="qt-rx-i"><span aria-hidden="true">${e}</span><span class="visually-hidden">${REACTION_LABEL[e]} :</span> ${n}</span>`).join('');
}

/** Un post-it du mur. */
function postit(q, i) {
  const open = S.open.has(q.id);
  const meta = [q.context, q.said_on ? yearOf(q) : ''].filter(Boolean).map(esc).join(', ');
  return `<li class="qt-note" style="--qc:${COLORS[i % COLORS.length]};--qt:${TILT[i % TILT.length]}deg">
    <blockquote class="qt-text">« ${esc(q.text)} »</blockquote>
    <p class="qt-meta"><strong>${esc(authorOf(q))}</strong>${meta ? ` · ${meta}` : ''}</p>
    <div class="qt-rx">${summaryHtml(q.id)}</div>
    <button type="button" class="qt-react-toggle" data-react-open="${esc(q.id)}" aria-expanded="${open}">${open ? 'Fermer' : 'Réagir'}</button>
    <div class="qt-bar" ${open ? '' : 'hidden'}>${reactionBarHtml('quote', q.id)}</div>
  </li>`;
}

/** Filtres : années présentes, personne citée, contexte. */
function drawFilters() {
  const list = wall();
  const years = [...new Set(list.map(yearOf).filter(Boolean))].sort().reverse();
  const persons = [...new Map(list.map((q) => [q.author_id || `l:${q.author_label}`, authorOf(q)])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  const contexts = [...new Set(list.map((q) => q.context).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  $('#qt-filters').innerHTML = chipsHtml([['tous', `Toutes · ${list.length}`], ...years.map((y) => [y, y])], S.year, 'year')
    + `<label class="visually-hidden" for="qt-person">Personne citée</label>
      <select class="ct-select" id="qt-person"><option value="">Par membre</option>${persons.map(([k, l]) => `<option value="${esc(k)}"${k === S.person ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <label class="visually-hidden" for="qt-context">Contexte</label>
      <select class="ct-select" id="qt-context"><option value="">Tous les contextes</option>${contexts.map((c) => `<option${c === S.context ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
}

/** Mur filtré. */
function drawWall() {
  const list = wall().filter((q) => (S.year === 'tous' || yearOf(q) === S.year)
    && (!S.person || (q.author_id || `l:${q.author_label}`) === S.person)
    && (!S.context || q.context === S.context));
  $('#qt-wall').innerHTML = list.length ? list.map(postit).join('')
    : `<li class="ct-empty">${wall().length ? 'Aucune citation pour ce filtre.' : 'Le mur est encore vide. Propose la première citation culte du gang !'}</li>`;
}

/** Bandeau « On t'a cité » : citations qui me citent, pas encore vues. */
function drawCited() {
  const box = $('#qt-cited');
  const todo = S.rows.filter((q) => q.author_id === me.id && !q.author_seen_at && ['propose', 'valide'].includes(q.status));
  box.hidden = !todo.length;
  box.innerHTML = todo.map((q) => `<article class="card qt-cited-card" aria-labelledby="qc-${esc(q.id)}">
      <p id="qc-${esc(q.id)}"><strong>Tu as été cité${q.proposed_by && q.proposed_by !== me.id ? ` par ${esc(pseudoOf(S.people, q.proposed_by))}` : ''}</strong>
        · ${q.status === 'propose' ? 'en attente du Staff' : 'déjà sur le mur'}</p>
      <blockquote class="qt-cited-text">« ${esc(q.text)} »</blockquote>
      <p class="small muted">Tu as le dernier mot : tu peux refuser, maintenant ou plus tard, sans te justifier.</p>
      <div class="btn-row">
        <button type="button" class="btn btn-ghost" data-decide="retirer" data-id="${esc(q.id)}">Je refuse</button>
        <button type="button" class="btn btn-ghost" data-decide="jeu_non" data-id="${esc(q.id)}">OK, mais pas pour le quiz</button>
        <button type="button" class="btn btn-sand" data-decide="jeu_oui" data-id="${esc(q.id)}">OK, et pour le quiz</button>
      </div>
    </article>`).join('');
}

/** Liste « Mes propositions et les citations qui me concernent ». */
function drawMine() {
  const mine = S.rows.filter((q) => q.proposed_by === me.id || q.author_id === me.id);
  $('#qt-mine-count').textContent = `(${mine.length})`;
  $('#qt-mine').innerHTML = mine.length ? mine.map((q) => {
    const [label, cls] = STATUS[q.status] || [q.status, ''];
    const aboutMe = q.author_id === me.id && ['propose', 'valide'].includes(q.status);
    return `<li class="qt-mine-row">
      <div class="qt-mine-txt"><p>« ${esc(q.text)} »</p>
        <p class="small muted">${esc(authorOf(q))}${q.said_on ? ` · ${esc(fmtJour(q.said_on))}` : ''}${q.proposed_by === me.id ? ' · proposée par toi' : ''}</p></div>
      <span class="ct-status ${cls}">${esc(label)}</span>
      ${aboutMe ? `<div class="btn-row qt-mine-actions">
          <button type="button" class="btn btn-ghost" data-decide="${q.author_ok_game ? 'jeu_non' : 'jeu_oui'}" data-id="${esc(q.id)}" aria-pressed="${!!q.author_ok_game}">Utilisable dans le quiz : ${q.author_ok_game ? 'oui' : 'non'}</button>
          <button type="button" class="btn btn-danger" data-decide="retirer" data-id="${esc(q.id)}">Retirer</button></div>` : ''}
    </li>`;
  }).join('') : '<li class="muted small">Aucune proposition pour le moment.</li>';
}

/** Redessine toute la page. */
function draw() { drawCited(); drawFilters(); drawWall(); drawMine(); }

/* ---------- Données ---------- */

/** Lit les citations (la base filtre ce que je peux voir), l'annuaire et les réactions du mur. */
async function load() {
  try {
    const [people, res] = await Promise.all([loadPeople(), sb.from('hg_quotes').select('*').order('validated_at', { ascending: false })]);
    if (res.error) throw res.error;
    S.people = people;
    S.rows = (res.data || []).slice().sort((a, b) => String(b.validated_at || b.created_at).localeCompare(String(a.validated_at || a.created_at)));
    await loadReactions('quote', wall().map((q) => q.id), me.id);
    draw();
  } catch (e) {
    console.warn('[citations]', e);
    $('#qt-wall').innerHTML = '<li class="ct-empty">Citations indisponibles pour le moment. Recharge la page dans un instant.</li>';
  }
  $('#app').setAttribute('aria-busy', 'false');
}

/* ---------- Actions ---------- */

/** Boîte « Proposer une citation ». */
function openPropose() {
  const opts = [...S.people.values()].sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'))
    .map((p) => `<option value="${esc(p.id)}">${esc(p.pseudo)}</option>`).join('');
  formDialog({
    title: 'Proposer une citation',
    submit: 'Proposer',
    body: `<div class="field"><label for="qp-text">La citation</label>
        <textarea id="qp-text" name="text" maxlength="280" required rows="3" placeholder="Le livre est mieux."></textarea></div>
      <div class="field"><label for="qp-author">Qui l’a dit ?</label>
        <select id="qp-author" name="author"><option value="">Choisis…</option>${opts}<option value="__label">Plusieurs personnes / tout le gang</option></select></div>
      <div class="field" id="qp-label-f" hidden><label for="qp-label">Auteur collectif</label>
        <input id="qp-label" name="label" maxlength="40" placeholder="Tout le gang"></div>
      <div class="field"><label for="qp-context">Contexte (facultatif)</label>
        <input id="qp-context" name="context" maxlength="80" placeholder="vocal Codenames, RDV de Lyon 2026…"></div>
      <div class="field"><label for="qp-date">Date (facultatif)</label><input id="qp-date" name="said_on" type="date"></div>
      <p class="small muted">Rien de blessant, de gênant ou d’intime : le Staff refuse en cas de doute, et la personne citée peut retirer la citation à tout moment.</p>`,
    onSubmit: async (f) => {
      const text = f.text.value.trim();
      if (text.length < 2) throw new Error('Écris la citation.');
      const a = f.author.value;
      if (!a) throw new Error('Choisis qui l’a dit.');
      const label = a === '__label' ? f.label.value.trim() : null;
      if (a === '__label' && label.length < 2) throw new Error('Écris l’auteur collectif, par exemple « Tout le gang ».');
      const { error } = await sb.rpc('hg_quote_propose', {
        p_text: text, p_author: a === '__label' ? null : a, p_author_label: label,
        p_said_on: f.said_on.value || null, p_context: f.context.value.trim() || null,
      });
      if (error) throw error;
      toast('Citation proposée ! Elle apparaîtra sur le mur une fois validée par le Staff.', 'success');
      await // reactions.js redessine les barres après un clic : le résumé du post-it suit.
new MutationObserver((muts) => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (!(n instanceof HTMLElement) || !n.matches('[data-react-bar]')) continue;
    const li = n.closest('.qt-note');
    const id = li?.querySelector('[data-react-open]')?.dataset.reactOpen;
    if (id) li.querySelector('.qt-rx').innerHTML = summaryHtml(id);
  }
}).observe($('#qt-wall'), { childList: true, subtree: true });

load();
    },
  });
  const sel = $('#qp-author');
  sel.addEventListener('change', () => { $('#qp-label-f').hidden = sel.value !== '__label'; });
}

/**
 * Décision de la personne citée (retirer, jeu_oui, jeu_non).
 * @param {string} id Citation.
 * @param {string} action Action envoyée à hg_quote_author_decide.
 */
async function decide(id, action) {
  if (S.busy) return;
  S.busy = true;
  try {
    const { error } = await sb.rpc('hg_quote_author_decide', { p_id: id, p_action: action });
    if (error) throw error;
    toast(action === 'retirer' ? 'C’est noté : la citation est retirée.' : 'C’est noté, merci !', 'success');
    await // reactions.js redessine les barres après un clic : le résumé du post-it suit.
new MutationObserver((muts) => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (!(n instanceof HTMLElement) || !n.matches('[data-react-bar]')) continue;
    const li = n.closest('.qt-note');
    const id = li?.querySelector('[data-react-open]')?.dataset.reactOpen;
    if (id) li.querySelector('.qt-rx').innerHTML = summaryHtml(id);
  }
}).observe($('#qt-wall'), { childList: true, subtree: true });

load();
  } catch (e) {
    toast(errMsg(e), 'error');
  } finally {
    S.busy = false;
  }
}

/* ---------- Écouteurs ---------- */
$('#qt-propose').addEventListener('click', openPropose);
$('#app').addEventListener('click', (e) => {
  const y = e.target.closest('[data-year]');
  if (y) { S.year = y.dataset.year; setPressed($('#qt-filters'), 'year', S.year); drawWall(); return; }
  const d = e.target.closest('[data-decide]');
  if (d) { decide(d.dataset.id, d.dataset.decide); return; }
  const r = e.target.closest('[data-react-open]');
  if (r) {
    const id = r.dataset.reactOpen;
    const bar = r.nextElementSibling;
    if (S.open.has(id)) S.open.delete(id); else S.open.add(id);
    const open = S.open.has(id);
    bar.hidden = !open;
    r.setAttribute('aria-expanded', String(open));
    r.textContent = open ? 'Fermer' : 'Réagir';
    if (open) bar.querySelector('button')?.focus();
  }
});
$('#app').addEventListener('change', (e) => {
  if (e.target.id === 'qt-person') { S.person = e.target.value; drawWall(); }
  if (e.target.id === 'qt-context') { S.context = e.target.value; drawWall(); }
});

// reactions.js redessine les barres après un clic : le résumé du post-it suit.
new MutationObserver((muts) => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (!(n instanceof HTMLElement) || !n.matches('[data-react-bar]')) continue;
    const li = n.closest('.qt-note');
    const id = li?.querySelector('[data-react-open]')?.dataset.reactOpen;
    if (id) li.querySelector('.qt-rx').innerHTML = summaryHtml(id);
  }
}).observe($('#qt-wall'), { childList: true, subtree: true });

load();
