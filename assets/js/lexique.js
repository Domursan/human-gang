// ===== Humane Gang — Lexique du gang (lexique.html) =====
/*
 * Rôle : les blagues internes du gang, classées de A à Z, avec recherche (sans accents) et filtre par époque.
 *   Chaque fiche se déplie : définition, origine, exemple, liens vers un moment culte ou une sortie, réactions,
 *   « Demander le retrait » (assistance) et, pour le Staff « quiz », « En faire une question du quiz ».
 *   Tout membre peut proposer un mot (5 par jour) : il reste invisible des autres tant que le Staff ne l'a pas validé.
 * Page : lexique.html (session membre requise). Adresse lexique.html#<slug> : ouvre la fiche.
 * Dépendances : core.js (sb, initPage, esc, $, errMsg, toast, hasPerm, loadMyPerms), reactions.js, foldText (core/search.js).
 * Données : table hg_lexicon (lecture filtrée par la RLS), hg_moments et hg_events (titres des liens),
 *   RPC hg_lexicon_propose (migration 088).
 */
import { sb, initPage, esc, $, errMsg, toast, hasPerm, loadMyPerms } from './core.js';
import { loadReactions, reactionBarHtml } from './reactions.js';
import { foldText } from './core/search.js';

/* ---------- Initialisation : session membre requise ---------- */
const me = await initPage();
await loadMyPerms().catch(() => null);

/* ---------- État ---------- */
const S = { rows: [], era: 'tous', q: '', open: new Set(), links: new Map(), error: null };
/** Date d'origine « 14 mars 2022 » (date SQL lue sans décalage). */
const dayFmt = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtDay = (d) => dayFmt.format(new Date(`${String(d).slice(0, 10)}T12:00:00Z`));
/** Époque d'un mot : l'année de son origine, sinon rien. */
const eraOf = (r) => (r.origin_on ? String(r.origin_on).slice(0, 4) : null);
/** Lettre de classement : première lettre sans accent, « # » pour le reste. */
const letterOf = (r) => { const c = foldText(r.term).trim().charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
const STATUS = { propose: ['En attente du Staff', 'pill-current'], refuse: ['Refusé', 'pill-todo'], valide: ['Validé', 'pill-ok'] };

/* ---------- Données ---------- */
/** Charge les mots lisibles (validés + mes propositions), les titres des liens et les réactions. */
async function load() {
  try {
    const { data, error } = await sb.from('hg_lexicon')
      .select('id,term,slug,definition,origin_on,origin_label,example,moment_id,event_id,status,refusal_reason,proposed_by,created_at')
      .order('term', { ascending: true });
    if (error) throw error;
    S.rows = data || [];
    const valid = S.rows.filter((r) => r.status === 'valide');
    const mIds = [...new Set(valid.map((r) => r.moment_id).filter(Boolean))];
    const eIds = [...new Set(valid.map((r) => r.event_id).filter(Boolean))];
    const [m, e] = await Promise.all([
      mIds.length ? sb.from('hg_moments').select('id,title').in('id', mIds) : { data: [] },
      eIds.length ? sb.from('hg_events').select('id,title').in('id', eIds) : { data: [] },
      loadReactions('lexique', valid.map((r) => r.id), me.id),
    ]);
    for (const x of m.data || []) S.links.set(`m:${x.id}`, x.title);
    for (const x of e.data || []) S.links.set(`e:${x.id}`, x.title);
    S.error = null;
  } catch (err) { S.error = err; }
}

/* ---------- Rendu ---------- */
/** Mots validés qui passent le filtre d'époque et la recherche. */
function visible() {
  const terms = foldText(S.q).trim().split(/\s+/).filter(Boolean);
  return S.rows.filter((r) => r.status === 'valide')
    .filter((r) => S.era === 'tous' || eraOf(r) === S.era)
    .filter((r) => !terms.length || terms.every((t) => foldText(`${r.term}\n${r.definition}\n${r.origin_label || ''}\n${r.example || ''}`).includes(t)))
    .sort((a, b) => foldText(a.term).localeCompare(foldText(b.term), 'fr'));
}

/** Boutons du filtre d'époque : « Tout · N » puis chaque année présente. */
function paintFilter() {
  const valid = S.rows.filter((r) => r.status === 'valide');
  const eras = [...new Set(valid.map(eraOf).filter(Boolean))].sort();
  const opts = [['tous', `Tout · ${valid.length}`], ...eras.map((y) => [y, y])];
  if (!opts.some(([k]) => k === S.era)) S.era = 'tous';
  $('#lex-filter').innerHTML = opts.map(([k, label]) => `<button type="button" class="lex-chip" data-era="${esc(k)}" aria-pressed="${k === S.era}">${esc(label)}</button>`).join('');
}

/** Fiche d'un mot : en-tête cliquable (aria-expanded) et détail. */
function entryHtml(r) {
  const open = S.open.has(r.id);
  const era = eraOf(r);
  const origin = [r.origin_on ? fmtDay(r.origin_on) : '', r.origin_label || ''].filter(Boolean).join(', ');
  const links = [
    r.moment_id && S.links.has(`m:${r.moment_id}`) ? `<a href="historique.html">Moment culte : ${esc(S.links.get(`m:${r.moment_id}`))}</a>` : '',
    r.event_id && S.links.has(`e:${r.event_id}`) ? `<a href="irl.html#event-${encodeURIComponent(r.event_id)}">Sortie : ${esc(S.links.get(`e:${r.event_id}`))}</a>` : '',
  ].filter(Boolean);
  const retrait = `assistance.html?sujet=${encodeURIComponent('Autre')}&message=${encodeURIComponent(`Je demande le retrait du mot « ${r.term} » du lexique.`)}`;
  return `<article class="lex-entry${open ? ' is-open' : ''}" id="${esc(r.slug)}" data-id="${esc(r.id)}">
    <h3 class="lex-entry-h">
      <button type="button" class="lex-toggle" aria-expanded="${open}" aria-controls="lex-d-${esc(r.id)}" data-toggle="${esc(r.id)}">
        <span class="lex-term">${esc(r.term)}</span>
        ${era ? `<span class="lex-era">${esc(era)}</span>` : ''}
      </button>
    </h3>
    ${open ? '' : `<p class="small muted lex-short">${esc(r.definition)}</p>`}
    <div class="lex-detail" id="lex-d-${esc(r.id)}" ${open ? '' : 'hidden'}>
      <p class="lex-def">${esc(r.definition)}</p>
      ${origin ? `<p class="small muted lex-origin">Origine : ${esc(origin)}</p>` : ''}
      ${r.example ? `<p class="lex-ex">${esc(r.example)}</p>` : ''}
      ${links.length ? `<p class="small lex-links">${links.join(' · ')}</p>` : ''}
      ${reactionBarHtml('lexique', r.id)}
      <p class="small lex-tools">
        <a href="${esc(retrait)}">Demander le retrait</a>
        ${hasPerm('quiz') ? `<button type="button" class="btn btn-ghost btn-sm" data-quiz="${esc(r.id)}">En faire une question du quiz</button>` : ''}
      </p>
    </div>
  </article>`;
}

/** Liste groupée par lettre, ou message vide / erreur. */
function paintList() {
  const box = $('#lex-list');
  if (S.error) { box.innerHTML = `<p class="card lex-empty">Impossible de charger le lexique (${esc(errMsg(S.error))}).</p>`; return; }
  const list = visible();
  $('#lex-status').textContent = `${list.length} mot${list.length > 1 ? 's' : ''}`;
  if (!list.length) {
    box.innerHTML = `<p class="card lex-empty">${S.rows.some((r) => r.status === 'valide') ? 'Aucun mot ne correspond.' : 'Le lexique est encore vide : propose le premier mot !'}</p>`;
    return;
  }
  const groups = new Map();
  for (const r of list) { const l = letterOf(r); if (!groups.has(l)) groups.set(l, []); groups.get(l).push(r); }
  box.innerHTML = [...groups].map(([l, rows]) => `<section class="lex-group" aria-label="Lettre ${esc(l)}">
      <p class="lex-letter" aria-hidden="true">${esc(l)}</p>
      ${rows.map(entryHtml).join('')}
    </section>`).join('');
}

/** Mes propositions en attente ou refusées (avec le motif). */
function paintMine() {
  const mine = S.rows.filter((r) => r.proposed_by === me.id && r.status !== 'valide');
  $('#lex-mine').hidden = !mine.length;
  $('#lex-mine-list').innerHTML = mine.map((r) => {
    const [label, cls] = STATUS[r.status] || STATUS.propose;
    return `<li class="lex-mine-item"><span class="lex-term">${esc(r.term)}</span> <span class="pill ${cls}">${esc(label)}</span>
      ${r.status === 'refuse' && r.refusal_reason ? `<p class="small muted">Motif : ${esc(r.refusal_reason)}</p>` : ''}</li>`;
  }).join('');
}

function paint() { paintFilter(); paintList(); paintMine(); }

/* ---------- Proposer un mot ---------- */
/** Fenêtre « Proposer un mot » : envoi par hg_lexicon_propose, plafonné côté serveur. */
function openPropose() {
  const d = document.createElement('dialog');
  d.className = 'hg-dialog lex-dialog';
  d.setAttribute('aria-labelledby', 'lex-p-title');
  d.innerHTML = `<form class="stack" novalidate>
    <div class="dlg-head"><h2 class="dlg-title" id="lex-p-title">Proposer un mot</h2>
      <button class="btn btn-ghost dlg-x" type="button" data-close aria-label="Fermer">✕</button></div>
    <p class="small muted">Le Staff relit chaque mot avant de le publier. La blague doit rester bienveillante ; si elle vise quelqu’un, cette personne doit être d’accord.</p>
    <div class="field"><label for="lex-p-term">Le mot ou l’expression</label><input id="lex-p-term" name="term" maxlength="60" required autocomplete="off"></div>
    <div class="field"><label for="lex-p-def">Définition (2 ou 3 phrases)</label><textarea id="lex-p-def" name="definition" maxlength="600" rows="3" required></textarea></div>
    <div class="lex-p-row">
      <div class="field"><label for="lex-p-date">Date d’origine (facultatif)</label><input id="lex-p-date" name="origin_on" type="date"></div>
      <div class="field"><label for="lex-p-label">Contexte d’origine (facultatif)</label><input id="lex-p-label" name="origin_label" maxlength="120" placeholder="Worldle du matin, sortie à Lyon…"></div>
    </div>
    <div class="field"><label for="lex-p-ex">Exemple d’usage (facultatif)</label><input id="lex-p-ex" name="example" maxlength="280"></div>
    <p class="form-error" role="alert" hidden></p>
    <div class="btn-row dlg-foot"><button type="button" class="btn btn-ghost" data-close>Annuler</button><button type="submit" class="btn btn-sand">Envoyer au Staff</button></div>
  </form>`;
  document.body.append(d);
  const f = d.querySelector('form'), err = d.querySelector('.form-error');
  d.addEventListener('close', () => { d.remove(); $('#lex-propose').focus(); }, { once: true });
  for (const b of d.querySelectorAll('[data-close]')) b.addEventListener('click', () => d.close());
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const show = (m) => { err.textContent = m; err.hidden = !m; };
    if (!v.term.trim()) { show('Écris le mot.'); f.term.focus(); return; }
    if (v.definition.trim().length < 10) { show('La définition fait au moins 10 caractères.'); f.definition.focus(); return; }
    const btn = f.querySelector('[type=submit]'); btn.disabled = true; show('');
    const { error } = await sb.rpc('hg_lexicon_propose', {
      p_term: v.term.trim(), p_definition: v.definition.trim(), p_origin_on: v.origin_on || null,
      p_origin_label: v.origin_label.trim() || null, p_example: v.example.trim() || null,
    });
    btn.disabled = false;
    if (error) { show(`Envoi impossible : ${errMsg(error)}`); return; }
    d.close();
    toast('Merci ! Ton mot est envoyé au Staff, il apparaîtra une fois validé.', 'ok');
    await load(); paint();
  });
  d.showModal();
  f.term.focus();
}

/* ---------- Question du quiz (Staff « quiz ») ---------- */
/** Prépare une question du quiz à partir d'un mot et ouvre l'admin (le formulaire se pré-remplit, rien n'est créé). */
function toQuiz(r) {
  const draft = { prompt: `Dans le lexique du gang, que veut dire « ${r.term} » ?`.slice(0, 500), category: 'Lexique', explanation: r.definition.slice(0, 500) };
  try { sessionStorage.setItem('hg_quiz_draft', JSON.stringify(draft)); } catch { /* stockage bloqué */ }
  location.href = 'admin.html#cartes/questions';
}

/* ---------- Événements ---------- */
const app = $('#app');
app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-toggle]');
  if (t) {
    const id = t.dataset.toggle;
    if (S.open.has(id)) S.open.delete(id); else S.open.add(id);
    paintList();
    app.querySelector(`[data-toggle="${CSS.escape(id)}"]`)?.focus();
    return;
  }
  const c = e.target.closest('[data-era]');
  if (c) { S.era = c.dataset.era; paintFilter(); paintList(); return; }
  const q = e.target.closest('[data-quiz]');
  if (q) { const r = S.rows.find((x) => x.id === q.dataset.quiz); if (r) toQuiz(r); }
});
$('#lex-q').addEventListener('input', (e) => { S.q = e.target.value; paintList(); });
$('#lex-propose').addEventListener('click', openPropose);
$('#lex-propose').hidden = false;

/* ---------- Lancement ---------- */
await load();
// Lien direct lexique.html#<slug> : la fiche est ouverte et amenée à l'écran
const hashSlug = decodeURIComponent(location.hash.slice(1));
const target = hashSlug && S.rows.find((r) => r.slug === hashSlug && r.status === 'valide');
if (target) S.open.add(target.id);
paint();
if (target) requestAnimationFrame(() => document.getElementById(target.slug)?.scrollIntoView({ block: 'start' }));
app.removeAttribute('aria-busy');
