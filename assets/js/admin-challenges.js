// ===== Humane Gang — administration : défis collectifs du gang =====
// Table hg_challenges, écrite directement par l'admin (RLS hg_is_admin). La progression est calculée côté base
// (hg_challenge_value, hg_challenges_active) et le crédit des Paillettes par hg_challenges_award (pg_cron).
import { sb, toast, errMsg, esc, $ } from './core.js';
import { toZurichInput, fromZurichInput } from './admin-events.js';
import { confirmBox } from './ui-confirm.js';
import { matches, searchHtml, bindSearch, setCount, emptyHtml, SEARCH_DELAY } from './admin/list-tools.js';
import { openDrawer } from './admin/ui/drawer.js';

/** Bouton en cours : désactivé avec indicateur (pas de second envoi). */
function setBusy(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('is-busy', on);
  if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
}

const METRICS = [
  ['sorties_tenues', 'Sorties IRL tenues'],
  ['participations', 'Participations aux sorties (réponses « oui »)'],
  ['photos_ajoutees', 'Photos ajoutées'],
  ['souvenirs_publies', 'Souvenirs publiés'],
  ['boosters_ouverts', 'Boosters ouverts'],
  ['cartes_recyclees', 'Cartes recyclées'],
  ['echanges_conclus', 'Échanges de cartes conclus'],
];
const METRIC_LABEL = Object.fromEntries(METRICS);
const REWARD_MAX = 100000;
const dateFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const C = { root: null, rows: [], query: '' };

export async function mountChallengesSection(container) {
  if (!container) return;
  C.root = container;
  container.innerHTML = `<div class="adc">
    <div class="adc-head">
      <p class="small muted">Un objectif pour tout le gang. La récompense est versée à chaque membre une fois l'objectif atteint.</p>
      <button class="btn btn-primary" type="button" data-action="adc-new">+ Nouveau défi</button>
    </div>
    <div id="adc-list" class="adc-list" aria-live="polite"><div class="empty">Chargement des défis…</div></div>
  </div>`;
  $('#adc-list', container).insertAdjacentHTML('beforebegin', searchHtml({ id: 'adc-search', label: 'Rechercher un défi', placeholder: 'Titre, description ou objectif…' }));
  bindSearch(container.querySelector('#adc-search'), (q) => { C.query = q; renderList(); }, SEARCH_DELAY);
  container.addEventListener('click', onClick);
  await reload();
}

async function reload() {
  const list = $('#adc-list', C.root);
  try {
    const { data, error } = await sb.from('hg_challenges').select('*').order('ends_at', { ascending: false });
    if (error) throw error;
    C.rows = data || [];
    renderList();
  } catch (e) {
    list.innerHTML = `<div class="empty">Impossible de charger les défis : ${esc(errMsg(e))}</div>`;
  }
}

function stateOf(r, now = Date.now()) {
  if (!r.active) return ['Inactif', 'pill'];
  if (new Date(r.starts_at) > now) return ['À venir', 'pill-current'];
  if (new Date(r.ends_at) <= now) return ['Terminé', 'pill'];
  return ['En cours', 'pill-ok'];
}

function renderList() {
  const list = $('#adc-list', C.root);
  if (!C.rows.length) { list.innerHTML = '<div class="empty">Aucun défi pour le moment. Crée le premier avec « Nouveau défi ».</div>'; setCount($('#adc-search-count', C.root), 0, 0, '', ['défi', 'défis']); return; }
  const rows = C.rows.filter((r) => matches(C.query, r.title, r.description, METRIC_LABEL[r.metric] || r.metric));
  setCount($('#adc-search-count', C.root), rows.length, C.rows.length, C.query, ['défi', 'défis']);
  if (!rows.length) { list.innerHTML = emptyHtml(C.query, 'Aucun défi.'); return; }
  list.innerHTML = rows.map((r) => {
    const [label, cls] = stateOf(r);
    return `<article class="card adc-row" aria-labelledby="adc-r-${esc(r.id)}">
      <div class="adc-row-head">
        <h3 class="adc-row-title" id="adc-r-${esc(r.id)}">${esc(r.title)}</h3>
        <span class="pill ${cls}">${esc(label)}</span>
      </div>
      <p class="small muted">${esc(METRIC_LABEL[r.metric] || r.metric)} · cible ${esc(String(r.target))} · ${esc(String(r.reward))} Paillettes par membre</p>
      <p class="small muted">Du ${esc(dateFmt.format(new Date(r.starts_at)))} au ${esc(dateFmt.format(new Date(r.ends_at)))}</p>
      <div class="btn-row">
        <button class="btn btn-ghost" type="button" data-action="adc-edit" data-id="${esc(r.id)}">Modifier</button>
        <button class="btn btn-ghost" type="button" data-action="adc-toggle" data-id="${esc(r.id)}" aria-pressed="${r.active}">${r.active ? 'Désactiver' : 'Activer'}</button>
        <button class="btn btn-danger btn-sm" type="button" data-action="adc-del" data-id="${esc(r.id)}">Supprimer</button>
      </div>
    </article>`;
  }).join('');
}

function readForm(f) {
  const title = f.querySelector('#adc-title').value.trim();
  const description = f.querySelector('#adc-desc').value.trim();
  const metric = f.querySelector('#adc-metric').value;
  const target = Number(f.querySelector('#adc-target').value);
  const reward = Number(f.querySelector('#adc-reward').value);
  const starts = fromZurichInput(f.querySelector('#adc-start').value);
  const ends = fromZurichInput(f.querySelector('#adc-end').value);
  if (!title || title.length > 120) return { error: 'Donne un titre (120 caractères au maximum).' };
  if (description.length > 500) return { error: 'La description dépasse 500 caractères.' };
  if (!METRIC_LABEL[metric]) return { error: 'Choisis un objectif mesuré dans la liste.' };
  if (!Number.isInteger(target) || target < 1 || target > 1000000) return { error: 'La cible doit être un nombre entier positif.' };
  if (!Number.isInteger(reward) || reward < 1 || reward > REWARD_MAX) return { error: `La récompense doit être un nombre entier entre 1 et ${REWARD_MAX.toLocaleString('fr-CH')}.` };
  if (!starts || !ends) return { error: 'Indique le début et la fin du défi.' };
  if (new Date(ends) <= new Date(starts)) return { error: 'La fin doit être après le début.' };
  return { row: { title, description: description || null, metric, target, reward, starts_at: starts, ends_at: ends, active: f.querySelector('#adc-active').checked } };
}

/** Formulaire d'un défi (création si r est absent) dans le tiroir. */
function openChallengeForm(r = null) {
  const now = new Date();
  const v = r || {};
  const isNew = !r;
  const sel = (val) => (val === v.metric ? ' selected' : '');
  openDrawer({
    title: isNew ? 'Nouveau défi' : 'Modifier le défi',
    subtitle: isNew ? '' : v.title,
    submitLabel: isNew ? 'Créer le défi' : 'Enregistrer les modifications',
    wide: true,
    body: `<div class="adc-form" id="adc-form">
      <div class="adc-grid">
        <div class="field adc-wide">
          <label for="adc-title">Titre</label>
          <input id="adc-title" type="text" maxlength="120" required autocomplete="off" value="${esc(v.title ?? '')}">
        </div>
        <div class="field adc-wide">
          <label for="adc-desc">Description (facultative)</label>
          <textarea id="adc-desc" rows="2" maxlength="500">${esc(v.description ?? '')}</textarea>
        </div>
        <div class="field">
          <label for="adc-metric">Objectif mesuré</label>
          <select id="adc-metric">${METRICS.map(([m, l]) => `<option value="${m}"${sel(m)}>${esc(l)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label for="adc-target">Cible (pour tout le gang)</label>
          <input id="adc-target" type="number" min="1" max="1000000" step="1" inputmode="numeric" required value="${esc(v.target ?? '')}">
        </div>
        <div class="field">
          <label for="adc-reward">Récompense par membre (Paillettes)</label>
          <input id="adc-reward" type="number" min="1" max="${REWARD_MAX}" step="1" inputmode="numeric" required value="${esc(v.reward ?? '')}">
        </div>
        <div class="field">
          <label for="adc-start">Début (heure suisse)</label>
          <input id="adc-start" type="datetime-local" value="${toZurichInput(isNew ? now.toISOString() : v.starts_at)}" required>
        </div>
        <div class="field">
          <label for="adc-end">Fin (heure suisse)</label>
          <input id="adc-end" type="datetime-local" value="${toZurichInput(isNew ? new Date(now.getTime() + 14 * 86400000).toISOString() : v.ends_at)}" required>
        </div>
        <div class="field adc-check">
          <label><input id="adc-active" type="checkbox"${v.active ? ' checked' : ''}> Actif : visible par les membres sur l'accueil</label>
        </div>
      </div>
      <p class="form-error" id="adc-error" role="alert" hidden></p>
    </div>`,
    onSubmit: (form) => saveChallenge(form, r?.id ?? null),
  });
}

/** Enregistre le défi saisi ; renvoie false (tiroir ouvert, erreur affichée) en cas d'échec. */
async function saveChallenge(f, id) {
  const err = f.querySelector('#adc-error');
  const res = readForm(f);
  if (res.error) { err.textContent = res.error; err.hidden = false; return false; }
  err.hidden = true;
  try {
    const q = id
      ? sb.from('hg_challenges').update(res.row).eq('id', id)
      : sb.from('hg_challenges').insert(res.row);
    const { error } = await q;
    if (error) throw error;
    toast(id ? 'Défi mis à jour.' : 'Défi créé.', 'ok');
    await reload();
  } catch (ex) {
    err.textContent = `Enregistrement impossible : ${errMsg(ex)}`;
    err.hidden = false;
    return false;
  }
}

async function onClick(e) {
  const t = e.target.closest('[data-action]');
  if (!t || t.disabled) return;
  const id = t.dataset.id;
  if (t.dataset.action === 'adc-new') return openChallengeForm(null);
  if (t.dataset.action === 'adc-edit') {
    const r = C.rows.find((x) => x.id === id);
    if (r) openChallengeForm(r);
    return;
  }
  if (t.dataset.action === 'adc-del') {
    const r = C.rows.find((x) => x.id === id);
    if (!r) return;
    const ok = await confirmBox(
      `Supprimer le défi « ${r.title} » ?`,
      'Le défi disparaît pour tous les membres et sa progression n\'est plus calculée. Les Paillettes déjà versées restent acquises (elles restent dans le journal). Cette action est définitive.',
      { ok: 'Supprimer le défi', danger: true });
    if (!ok) return;
    setBusy(t, true);
    const { error } = await sb.from('hg_challenges').delete().eq('id', id);
    if (error) { toast(errMsg(error), 'error'); setBusy(t, false); return; }
    toast('Défi supprimé.', 'ok');
    await reload();
    return;
  }
  if (t.dataset.action === 'adc-toggle') {
    const r = C.rows.find((x) => x.id === id);
    if (!r) return;
    setBusy(t, true);
    const { error } = await sb.from('hg_challenges').update({ active: !r.active }).eq('id', id);
    if (error) { toast(errMsg(error), 'error'); setBusy(t, false); return; }
    toast(r.active ? 'Défi désactivé.' : 'Défi activé.', 'ok');
    await reload();
  }
}
