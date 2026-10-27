// ===== Humane Gang — administration : défis collectifs du gang =====
// Rôle : liste, création, modification, activation et suppression des défis collectifs (route cartes/defis),
// avec des modèles prêts à l'emploi qui pré-remplissent le formulaire de création.
// Table hg_challenges, écrite directement par l'admin (RLS hg_is_admin). La progression est calculée côté base
// (hg_challenge_value, hg_challenges_active) et le crédit des Paillettes par hg_challenges_award (pg_cron).
// Dépendances : core.js (client Supabase, toast, échappement), admin-events.js (conversion heure suisse),
// ui-confirm.js (confirmation), admin/list-tools.js (recherche), admin/ui/drawer.js (tiroir du formulaire).
// Exporte : mountChallengesSection(container), qui monte la section dans son conteneur.
import { sb, toast, errMsg, esc, $ } from '../../commun/core.js';
import { toZurichInput, fromZurichInput } from './admin-events.js';
import { confirmBox } from '../../commun/ui-confirm.js';
import { matches, searchHtml, bindSearch, setCount, emptyHtml, SEARCH_DELAY } from './list-tools.js';
import { openDrawer } from './ui/drawer.js';

/** Bouton en cours : désactivé avec indicateur (pas de second envoi). */
function setBusy(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('is-busy', on);
  if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
}

/* ---------- Constantes ---------- */
// Objectifs qu'un admin peut choisir : [clé de la métrique côté base, libellé affiché].
const METRICS = [
  ['sorties_tenues', 'Sorties IRL tenues'],
  ['participations', 'Participations aux sorties (réponses « oui »)'],
  ['photos_ajoutees', 'Photos ajoutées'],
  ['souvenirs_publies', 'Souvenirs publiés'],
  ['boosters_ouverts', 'Boosters ouverts'],
  ['cartes_recyclees', 'Cartes recyclées'],
  ['echanges_conclus', 'Échanges de cartes conclus'],
];
// Libellé d'une métrique à partir de sa clé (sert à l'affichage et à la recherche).
const METRIC_LABEL = Object.fromEntries(METRICS);
// Plafond de la récompense par membre, en Paillettes.
const REWARD_MAX = 100000;
// Modèles prêts à l'emploi : pré-remplissent le formulaire de création. Rien n'est créé sans le clic sur « Créer ».
// Cibles calibrées sur le rythme réel de la base (relevé le 22 octobre) : environ 570 boosters par semaine,
// 1 300 cartes recyclées sur 30 jours, 53 souvenirs sur 30 jours, 5 échanges sur 30 jours.
// days : durée du défi à partir de maintenant (7 ou 30 jours). Ne servent qu'aux métriques de METRICS.
const MODELES = [
  { id: 'boosters-semaine', title: 'Ouvrez 800 boosters cette semaine', description: 'Chaque booster ouvert rapproche le gang de l\'objectif. Tout le monde y gagne.', metric: 'boosters_ouverts', target: 800, reward: 50, days: 7 },
  { id: 'recyclage-semaine', title: 'Recyclez 400 cartes cette semaine', description: 'Les doublons recyclés servent à tout le gang : on fait le tri ensemble.', metric: 'cartes_recyclees', target: 400, reward: 40, days: 7 },
  { id: 'souvenirs-semaine', title: 'Publiez 15 souvenirs cette semaine', description: 'Une soirée, une photo, une anecdote : chaque souvenir publié compte.', metric: 'souvenirs_publies', target: 15, reward: 30, days: 7 },
  { id: 'echanges-mois', title: 'Concluez 8 échanges ce mois-ci', description: 'Des échanges de cartes entre membres : chaque échange conclu compte pour le gang.', metric: 'echanges_conclus', target: 8, reward: 60, days: 30 },
];
// Format des dates affichées : toujours heure suisse, quel que soit le fuseau du navigateur.
const dateFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ---------- État de la section ---------- */
// root : conteneur de la section ; rows : défis chargés ; query : texte de recherche en cours.
const C = { root: null, rows: [], query: '' };

/* ---------- Montage et chargement ---------- */
/**
 * Affiche la section dans le conteneur, branche la recherche et les clics, puis charge les défis.
 * @param {HTMLElement} container Élément qui recevra la section.
 */
export async function mountChallengesSection(container) {
  if (!container) return;
  C.root = container;
  container.innerHTML = `<div class="adc">
    <div class="adc-head">
      <p class="small muted">Un objectif pour tout le gang. La récompense est versée à chaque membre une fois l'objectif atteint.</p>
      <button class="btn btn-primary" type="button" data-action="adc-new">+ Nouveau défi</button>
    </div>
    <section class="adc-models" aria-labelledby="adc-models-title">
      <h3 class="adc-models-title" id="adc-models-title">Modèles prêts à l'emploi</h3>
      <p class="small muted">Choisis un modèle : le formulaire se pré-remplit, tu ajustes si besoin, puis tu crées le défi.</p>
      <div class="adc-models-grid">${MODELES.map(modeleHtml).join('')}</div>
    </section>
    <div id="adc-list" class="adc-list" aria-live="polite"><div class="empty">Chargement des défis…</div></div>
  </div>`;
  $('#adc-list', container).insertAdjacentHTML('beforebegin', searchHtml({ id: 'adc-search', label: 'Rechercher un défi', placeholder: 'Titre, description ou objectif…' }));
  bindSearch(container.querySelector('#adc-search'), (q) => { C.query = q; renderList(); }, SEARCH_DELAY);
  container.addEventListener('click', onClick);
  await reload();
}

/**
 * Recharge tous les défis depuis la base (du plus récent au plus ancien) puis redessine la liste.
 * En cas d'erreur, affiche le message à la place de la liste.
 */
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

/* ---------- Modèles ---------- */
/**
 * Bouton d'un modèle prêt à l'emploi : titre, objectif, cible, récompense et durée.
 * @param {object} m Entrée de MODELES.
 * @returns {string} HTML
 */
function modeleHtml(m) {
  return `<button class="adc-model" type="button" data-action="adc-model" data-model="${esc(m.id)}">
    <span class="adc-model-title">${esc(m.title)}</span>
    <span class="small muted">${esc(METRIC_LABEL[m.metric])} · cible ${esc(String(m.target))} · ${esc(String(m.reward))} Paillettes par membre · ${esc(String(m.days))} jours</span>
  </button>`;
}

/* ---------- Affichage ---------- */
/**
 * Donne l'état d'un défi : Inactif, À venir, Terminé ou En cours.
 * @param {object} r Ligne hg_challenges (active, starts_at, ends_at).
 * @param {number} [now] Instant de référence en millisecondes (par défaut maintenant).
 * @returns {[string, string]} Libellé et classe CSS de la pastille.
 */
function stateOf(r, now = Date.now()) {
  if (!r.active) return ['Inactif', 'pill'];
  if (new Date(r.starts_at) > now) return ['À venir', 'pill-current'];
  if (new Date(r.ends_at) <= now) return ['Terminé', 'pill'];
  return ['En cours', 'pill-ok'];
}

/**
 * Redessine la liste des défis selon la recherche en cours et met à jour le compteur.
 */
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

/* ---------- Formulaire ---------- */
/**
 * Lit et valide les champs du formulaire de défi.
 * @param {HTMLFormElement|HTMLElement} f Formulaire du tiroir.
 * @returns {{row: object}|{error: string}} La ligne à enregistrer, ou le message d'erreur à afficher.
 */
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

/**
 * Formulaire d'un défi dans le tiroir : modification si r est fourni, sinon création.
 * Avec un modèle, la création est pré-remplie (début maintenant, fin dans la durée du modèle) et le défi
 * est coché « Actif » : l'admin ajuste si besoin, puis clique sur « Créer le défi ».
 * @param {object|null} r Défi existant à modifier, ou null.
 * @param {object|null} [model] Entrée de MODELES pour une création pré-remplie.
 */
function openChallengeForm(r = null, model = null) {
  const now = new Date();
  const isNew = !r;
  const v = r || (model ? { title: model.title, description: model.description, metric: model.metric, target: model.target, reward: model.reward, active: true } : {});
  const days = model?.days ?? 14;
  /** Attribut « selected » de l'option de métrique, si elle correspond au défi en cours. */
  const sel = (val) => (val === v.metric ? ' selected' : '');
  openDrawer({
    title: isNew ? 'Nouveau défi' : 'Modifier le défi',
    subtitle: isNew ? (model ? 'Modèle prêt à l\'emploi : ajuste si besoin, puis crée le défi.' : '') : v.title,
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
          <input id="adc-end" type="datetime-local" value="${toZurichInput(isNew ? new Date(now.getTime() + days * 86400000).toISOString() : v.ends_at)}" required>
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
    // Début dans le futur : le compteur restera à 0 jusque-là, on le dit clairement à l'admin.
    const later = new Date(res.row.starts_at) > new Date(Date.now() + 60_000);
    const debut = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(res.row.starts_at));
    toast(`${id ? 'Défi mis à jour.' : 'Défi créé.'}${later ? ` Il commence le ${debut} : rien n'est compté avant.` : ''}`, 'ok');
    await reload();
  } catch (ex) {
    err.textContent = `Enregistrement impossible : ${errMsg(ex)}`;
    err.hidden = false;
    return false;
  }
}

/* ---------- Événements ---------- */
/**
 * Gère les clics sur les boutons de la section (nouveau, modifier, supprimer, activer ou désactiver).
 * Une suppression demande une confirmation. Le bouton est désactivé pendant l'envoi pour éviter un second clic.
 * @param {Event} e Événement de clic.
 */
async function onClick(e) {
  const t = e.target.closest('[data-action]');
  if (!t || t.disabled) return;
  const id = t.dataset.id;
  if (t.dataset.action === 'adc-new') return openChallengeForm(null);
  if (t.dataset.action === 'adc-model') {
    const m = MODELES.find((x) => x.id === t.dataset.model);
    if (m) openChallengeForm(null, m);
    return;
  }
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
