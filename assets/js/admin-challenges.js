// ===== Humane Gang — administration : défis collectifs du gang =====
// Table hg_challenges, écrite directement par l'admin (RLS hg_is_admin). La progression est calculée côté base
// (hg_challenge_value, hg_challenges_active) et le crédit des Paillettes par hg_challenges_award (pg_cron).
import { sb, toast, errMsg, esc, $ } from './core.js';
import { toZurichInput, fromZurichInput } from './admin-events.js';

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

const C = { root: null, rows: [], editId: null };

export async function mountChallengesSection(container) {
  if (!container) return;
  C.root = container;
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 86400000);
  container.innerHTML = `<div class="adc">
    <form class="adc-form card" id="adc-form" novalidate aria-labelledby="adc-form-title">
      <h3 class="adc-h" id="adc-form-title">Nouveau défi</h3>
      <div class="adc-grid">
        <div class="field adc-wide">
          <label for="adc-title">Titre</label>
          <input id="adc-title" type="text" maxlength="120" required autocomplete="off">
        </div>
        <div class="field adc-wide">
          <label for="adc-desc">Description (facultative)</label>
          <textarea id="adc-desc" rows="2" maxlength="500"></textarea>
        </div>
        <div class="field">
          <label for="adc-metric">Objectif mesuré</label>
          <select id="adc-metric">${METRICS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label for="adc-target">Cible (pour tout le gang)</label>
          <input id="adc-target" type="number" min="1" max="1000000" step="1" inputmode="numeric" required>
        </div>
        <div class="field">
          <label for="adc-reward">Récompense par membre (Paillettes)</label>
          <input id="adc-reward" type="number" min="1" max="${REWARD_MAX}" step="1" inputmode="numeric" required>
        </div>
        <div class="field">
          <label for="adc-start">Début (heure suisse)</label>
          <input id="adc-start" type="datetime-local" value="${toZurichInput(now.toISOString())}" required>
        </div>
        <div class="field">
          <label for="adc-end">Fin (heure suisse)</label>
          <input id="adc-end" type="datetime-local" value="${toZurichInput(in14.toISOString())}" required>
        </div>
        <div class="field adc-check">
          <label><input id="adc-active" type="checkbox"> Actif : visible par les membres sur l'accueil</label>
        </div>
      </div>
      <p class="form-error" id="adc-error" role="alert" hidden></p>
      <div class="btn-row">
        <button class="btn btn-primary" type="submit" id="adc-save">Créer le défi</button>
        <button class="btn btn-ghost" type="button" data-action="adc-reset" hidden id="adc-cancel">Annuler la modification</button>
      </div>
    </form>
    <div id="adc-list" class="adc-list" aria-live="polite"><div class="empty">Chargement des défis…</div></div>
  </div>`;
  container.addEventListener('click', onClick);
  container.addEventListener('submit', onSubmit);
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
  if (!C.rows.length) { list.innerHTML = '<div class="empty">Aucun défi pour le moment. Crée le premier ci-dessus.</div>'; return; }
  list.innerHTML = C.rows.map((r) => {
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

function fillForm(r) {
  const f = $('#adc-form', C.root);
  f.querySelector('#adc-title').value = r.title;
  f.querySelector('#adc-desc').value = r.description || '';
  f.querySelector('#adc-metric').value = r.metric;
  f.querySelector('#adc-target').value = r.target;
  f.querySelector('#adc-reward').value = r.reward;
  f.querySelector('#adc-start').value = toZurichInput(r.starts_at);
  f.querySelector('#adc-end').value = toZurichInput(r.ends_at);
  f.querySelector('#adc-active').checked = !!r.active;
  f.querySelector('#adc-form-title').textContent = 'Modifier le défi';
  f.querySelector('#adc-save').textContent = 'Enregistrer les modifications';
  $('#adc-cancel', C.root).hidden = false;
  C.editId = r.id;
  f.querySelector('#adc-title').focus();
  f.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function resetForm() {
  const f = $('#adc-form', C.root);
  f.reset();
  const now = new Date();
  f.querySelector('#adc-start').value = toZurichInput(now.toISOString());
  f.querySelector('#adc-end').value = toZurichInput(new Date(now.getTime() + 14 * 86400000).toISOString());
  f.querySelector('#adc-form-title').textContent = 'Nouveau défi';
  f.querySelector('#adc-save').textContent = 'Créer le défi';
  $('#adc-cancel', C.root).hidden = true;
  $('#adc-error', C.root).hidden = true;
  C.editId = null;
}

async function onSubmit(e) {
  if (e.target.id !== 'adc-form') return;
  e.preventDefault();
  const f = e.target;
  const err = $('#adc-error', C.root);
  const res = readForm(f);
  if (res.error) { err.textContent = res.error; err.hidden = false; return; }
  err.hidden = true;
  const btn = $('#adc-save', C.root);
  btn.disabled = true;
  try {
    const q = C.editId
      ? sb.from('hg_challenges').update(res.row).eq('id', C.editId)
      : sb.from('hg_challenges').insert(res.row);
    const { error } = await q;
    if (error) throw error;
    toast(C.editId ? 'Défi mis à jour.' : 'Défi créé.', 'ok');
    resetForm();
    await reload();
  } catch (ex) {
    err.textContent = `Enregistrement impossible : ${errMsg(ex)}`;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function onClick(e) {
  const t = e.target.closest('[data-action]');
  if (!t || t.disabled) return;
  const id = t.dataset.id;
  if (t.dataset.action === 'adc-reset') return resetForm();
  if (t.dataset.action === 'adc-edit') {
    const r = C.rows.find((x) => x.id === id);
    if (r) fillForm(r);
    return;
  }
  if (t.dataset.action === 'adc-toggle') {
    const r = C.rows.find((x) => x.id === id);
    if (!r) return;
    t.disabled = true;
    const { error } = await sb.from('hg_challenges').update({ active: !r.active }).eq('id', id);
    if (error) { toast(errMsg(error), 'error'); t.disabled = false; return; }
    toast(r.active ? 'Défi désactivé.' : 'Défi activé.', 'ok');
    await reload();
  }
}
