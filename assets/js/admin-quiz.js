// ===== Humane Gang — administration : Questions du gang (route cartes/questions) =====
// Rôle : l'admin (ou le Staff « quiz ») crée les questions que les membres peuvent ensuite régler pour gagner des
// Paillettes. Deux onglets : « Questions » (ce module) et « Réponses et statistiques » (admin-quiz-stats.js).
// Lecture : table hg_quiz_questions (RLS : permission quiz). Écritures : RPC hg_quiz_save, hg_quiz_key, hg_quiz_remove
// (migration 061) et hg_quiz_set_secret, pour la case « Question bonus secrète » (migration 062). La clé de réponse n'est jamais lue directement : elle passe par hg_quiz_key, à l'ouverture d'une question.
// Récompenses par défaut par difficulté : hg_settings, clé « quiz », value.recompenses (lecture et écriture directes).
// Dépendances : core.js (client Supabase, toast, échappement), admin-events.js (heure suisse), ui-confirm.js (confirmation),
// admin/ui/drawer.js (tiroir du formulaire), admin-quiz-stats.js (onglet statistiques).
// Exporte : mountQuizSection(container), qui monte la section dans son conteneur.
import { sb, toast, errMsg, esc } from './core.js';
import { toZurichInput, fromZurichInput } from './admin-events.js';
import { confirmBox } from './ui-confirm.js';
import { openDrawer } from './admin/ui/drawer.js';
import { mountQuizStats } from './admin-quiz-stats.js';

/* ---------- Constantes ---------- */
// Types de réponse : [valeur en base, libellé].
const TYPES = [['choix_unique', 'Choix unique'], ['choix_multiple', 'Choix multiple'], ['vrai_faux', 'Vrai ou faux'], ['texte', 'Réponse écrite'], ['nombre', 'Nombre']];
const TYPE_LABEL = Object.fromEntries(TYPES);
// Difficultés : [valeur en base, libellé].
const DIFFS = [['facile', 'Facile'], ['moyen', 'Moyen'], ['difficile', 'Difficile'], ['expert', 'Expert']];
const DIFF_LABEL = Object.fromEntries(DIFFS);
// Récompenses par défaut, utilisées tant que hg_settings « quiz » n'est pas lu (même valeurs que la migration 061).
const DEFAULT_REWARDS = { facile: 50, moyen: 100, difficile: 250, expert: 500 };
// Plafond d'une récompense, en Paillettes (même valeur que la base).
const REWARD_MAX = 100000;
// Identifiants de choix générés, dans l'ordre (a, b, c…) ; dix choix au plus.
const CHOICE_IDS = 'abcdefghij';
// Format des dates affichées : toujours heure suisse.
const dateFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Exemples prêts à l'emploi, un par type. q = question (sans récompense ni période), key = clé de réponse.
const EXEMPLES = [
  { label: 'Choix unique', q: { prompt: 'Quelle est la capitale de la Suisse ?', qtype: 'choix_unique', difficulty: 'facile', category: 'Géographie',
      options: [{ id: 'a', text: 'Zurich' }, { id: 'b', text: 'Berne' }, { id: 'c', text: 'Genève' }, { id: 'd', text: 'Lausanne' }],
      explanation: 'Berne est la capitale fédérale ; Zurich est la plus grande ville du pays.' }, key: { correct: ['b'] } },
  { label: 'Choix multiple', q: { prompt: 'Lesquels de ces fleuves prennent leur source en Suisse ?', qtype: 'choix_multiple', difficulty: 'moyen', category: 'Géographie',
      options: [{ id: 'a', text: 'Le Rhône' }, { id: 'b', text: 'Le Rhin' }, { id: 'c', text: 'Le Danube' }, { id: 'd', text: 'Le Tibre' }],
      explanation: 'Le Rhône et le Rhin naissent en Suisse. Le Danube et le Tibre n\'y passent pas.' }, key: { correct: ['a', 'b'] } },
  { label: 'Vrai ou faux', q: { prompt: 'Le mont Everest est le plus haut sommet de la Terre mesuré au-dessus du niveau de la mer.', qtype: 'vrai_faux', difficulty: 'facile', category: 'Géographie',
      explanation: 'Avec 8 848 mètres, l\'Everest culmine plus haut que tous les autres sommets, mesurés au-dessus de la mer.' }, key: { correct: ['vrai'] } },
  { label: 'Réponse écrite', q: { prompt: 'Quelle est la capitale de l\'Australie ?', qtype: 'texte', difficulty: 'moyen', category: 'Géographie',
      explanation: 'Ce n\'est pas Sydney : Canberra a été choisie en 1908 pour être la capitale.' }, key: { accepted: ['Canberra'], manual: false } },
  { label: 'Nombre', q: { prompt: 'Combien de cantons compte la Suisse ?', qtype: 'nombre', difficulty: 'facile', category: 'Géographie',
      explanation: 'La Suisse compte 26 cantons ; trois d\'entre eux sont coupés en deux demi-cantons.' }, key: { value: 26, tolerance: 0 } },
];

/* ---------- État de la section ---------- */
// root : conteneur ; rows : questions chargées ; rewards : récompenses par défaut ; settingsValue : valeur lue de hg_settings ;
// diff / statut : filtres ; statsMounted : onglet statistiques déjà monté.
const Q = { root: null, rows: [], rewards: { ...DEFAULT_REWARDS }, settingsValue: null, diff: '', statut: '', statsMounted: false };

/* ---------- Outils ---------- */
/** Bouton en cours : désactivé avec indicateur (pas de second envoi). */
function setBusy(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('is-busy', on);
  if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
}

/**
 * Statut d'une question d'après sa période : ouverte, programmée ou terminée.
 * @param {object} q Ligne hg_quiz_questions (starts_at, ends_at).
 * @param {number} [now] Instant de référence en millisecondes.
 * @returns {'ouverte'|'programmee'|'terminee'}
 */
function statusOf(q, now = Date.now()) {
  if (new Date(q.starts_at) > now) return 'programmee';
  if (q.ends_at && new Date(q.ends_at) <= now) return 'terminee';
  return 'ouverte';
}

/** Libellé et classe CSS de la pastille de statut. */
const STATUS_PILL = {
  ouverte: ['Ouverte', 'pill-ok'],
  programmee: ['Programmée', 'pill-current'],
  terminee: ['Terminée', 'pill'],
};

/**
 * Libellé de la période d'une question (heure suisse).
 * @param {object} q Ligne hg_quiz_questions.
 * @returns {string}
 */
function periodOf(q) {
  const debut = dateFmt.format(new Date(q.starts_at));
  return q.ends_at ? `Du ${debut} au ${dateFmt.format(new Date(q.ends_at))}` : `À partir du ${debut}, sans fin`;
}

/**
 * Lit les récompenses par défaut dans hg_settings (clé « quiz »). En cas d'échec, les valeurs de la migration restent.
 */
async function loadRewards() {
  try {
    const { data, error } = await sb.from('hg_settings').select('value').eq('key', 'quiz').maybeSingle();
    if (error) throw error;
    Q.settingsValue = data?.value ?? null;
    const rec = data?.value?.recompenses ?? {};
    for (const [d] of DIFFS) if (Number.isInteger(rec[d]) && rec[d] >= 0) Q.rewards[d] = rec[d];
  } catch (e) {
    toast(`Récompenses par défaut : ${errMsg(e)}`, 'error');
  }
  paintRewards();
}

/** Remplit les quatre champs des récompenses par défaut avec les valeurs courantes. */
function paintRewards() {
  if (!Q.root) return;
  for (const [d] of DIFFS) {
    const input = Q.root.querySelector(`#adq-rw-${d}`);
    if (input) input.value = String(Q.rewards[d]);
  }
}

/** Enregistre les récompenses par défaut saisies (quatre entiers entre 0 et REWARD_MAX). */
async function saveRewards(btn) {
  const next = {};
  for (const [d, label] of DIFFS) {
    const raw = Q.root.querySelector(`#adq-rw-${d}`).value.trim();
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < 0 || n > REWARD_MAX) {
      toast(`La récompense « ${label} » doit être un nombre entier entre 0 et ${REWARD_MAX}.`, 'error');
      return;
    }
    next[d] = n;
  }
  setBusy(btn, true);
  try {
    const value = { ...(Q.settingsValue && typeof Q.settingsValue === 'object' ? Q.settingsValue : {}), recompenses: next };
    const { error } = await sb.from('hg_settings').upsert({ key: 'quiz', value }, { onConflict: 'key' });
    if (error) throw error;
    Q.settingsValue = value;
    Q.rewards = { ...next };
    toast('Récompenses par défaut enregistrées.', 'ok');
  } catch (e) {
    toast(`Enregistrement impossible : ${errMsg(e)}`, 'error');
  } finally {
    setBusy(btn, false);
  }
}

/* ---------- Montage et chargement ---------- */
/**
 * Affiche la section (deux onglets), branche les clics et les filtres, puis charge les récompenses et les questions.
 * L'onglet statistiques n'est monté qu'à sa première ouverture.
 * @param {HTMLElement} container Élément qui recevra la section.
 */
export async function mountQuizSection(container) {
  if (!container) return;
  Q.root = container;
  Q.statsMounted = false; // une nouvelle entrée dans la section repart d'un onglet statistiques vide
  container.innerHTML = `<div class="adq">
    <div class="adq-tabs" role="tablist" aria-label="Questions du gang">
      <button class="adq-tab" type="button" role="tab" id="adq-tab-q" aria-controls="adq-pan-q" aria-selected="true" data-adq="tab" data-tab="questions">Questions</button>
      <button class="adq-tab" type="button" role="tab" id="adq-tab-s" aria-controls="adq-pan-s" aria-selected="false" tabindex="-1" data-adq="tab" data-tab="stats">Réponses et statistiques</button>
    </div>
    <div class="adq-panel" id="adq-pan-q" role="tabpanel" aria-labelledby="adq-tab-q">
      <section class="card adq-rewards" aria-labelledby="adq-rw-title">
        <h3 class="card-title" id="adq-rw-title">Récompenses par défaut</h3>
        <p class="small muted">Proposées à chaque nouvelle question selon sa difficulté. Tu peux changer le montant de chaque question.</p>
        <div class="adq-rw-grid">
          ${DIFFS.map(([d, label]) => `<div class="field">
            <label for="adq-rw-${d}">${esc(label)} (Paillettes)</label>
            <input id="adq-rw-${d}" type="number" min="0" max="${REWARD_MAX}" step="1" inputmode="numeric" value="${DEFAULT_REWARDS[d]}">
          </div>`).join('')}
        </div>
        <div class="btn-row"><button class="btn btn-ghost" type="button" data-adq="save-rewards">Enregistrer les récompenses</button></div>
      </section>
      <div class="adq-head">
        <p class="small muted">Les membres répondent à ces questions ; une bonne réponse rapporte les Paillettes de la question, versées tout de suite.</p>
        <div class="btn-row">
          <button class="btn btn-ghost" type="button" data-adq="examples">Exemples</button>
          <button class="btn btn-primary" type="button" data-adq="new">+ Nouvelle question</button>
        </div>
      </div>
      <div class="adq-filters">
        <div class="field">
          <label for="adq-f-diff">Difficulté</label>
          <select id="adq-f-diff">
            <option value="">Toutes</option>
            ${DIFFS.map(([d, label]) => `<option value="${d}">${esc(label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="adq-f-statut">Statut</label>
          <select id="adq-f-statut">
            <option value="">Tous</option>
            <option value="ouverte">Ouvertes</option>
            <option value="programmee">Programmées</option>
            <option value="terminee">Terminées</option>
            <option value="inactive">Inactives</option>
          </select>
        </div>
        <p class="small muted adq-count" id="adq-count" aria-live="polite"></p>
      </div>
      <div id="adq-list" class="adq-list" aria-live="polite"><div class="empty">Chargement des questions…</div></div>
    </div>
    <div class="adq-panel" id="adq-pan-s" role="tabpanel" aria-labelledby="adq-tab-s" hidden>
      <div id="adq-stats-root"></div>
    </div>
  </div>`;
  // Les écouteurs ne sont posés qu'une fois : le conteneur reste dans la page entre deux entrées dans la section.
  if (!container.dataset.adqBound) {
    container.addEventListener('click', onClick);
    container.addEventListener('change', onFilter);
    container.dataset.adqBound = '1';
  }
  await Promise.all([loadRewards(), reload()]);
}

/**
 * Charge toutes les questions (de la plus récente à la plus ancienne) puis redessine la liste.
 * En cas d'erreur, le message remplace la liste.
 */
async function reload() {
  const list = Q.root.querySelector('#adq-list');
  try {
    const { data, error } = await sb.from('hg_quiz_questions').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    Q.rows = data || [];
    renderList();
  } catch (e) {
    list.innerHTML = `<div class="empty">Impossible de charger les questions : ${esc(errMsg(e))}</div>`;
  }
}

/* ---------- Affichage de la liste ---------- */
/**
 * Lignes affichées selon les filtres (difficulté, statut) en cours.
 * @returns {object[]}
 */
function filtered() {
  const now = Date.now();
  return Q.rows.filter((q) => {
    if (Q.diff && q.difficulty !== Q.diff) return false;
    if (Q.statut === 'inactive') return !q.active;
    if (Q.statut && statusOf(q, now) !== Q.statut) return false;
    return true;
  });
}

/** Redessine la liste et le compteur, selon les filtres. */
function renderList() {
  const list = Q.root.querySelector('#adq-list');
  const count = Q.root.querySelector('#adq-count');
  if (!Q.rows.length) {
    list.innerHTML = '<div class="empty">Aucune question pour le moment. Crée la première avec « Nouvelle question », ou pars d\'un exemple.</div>';
    count.textContent = '';
    return;
  }
  const rows = filtered();
  count.textContent = rows.length === Q.rows.length ? `${rows.length} question${rows.length > 1 ? 's' : ''}` : `${rows.length} sur ${Q.rows.length}`;
  if (!rows.length) { list.innerHTML = '<div class="empty">Aucune question ne correspond aux filtres.</div>'; return; }
  const now = Date.now();
  list.innerHTML = rows.map((q) => {
    const [label, cls] = STATUS_PILL[statusOf(q, now)];
    return `<article class="card adq-row" aria-labelledby="adq-r-${esc(q.id)}">
      <div class="adq-row-head">
        <h3 class="adq-row-title" id="adq-r-${esc(q.id)}">${esc(q.prompt)}</h3>
        <span class="btn-row adq-pills">
          <span class="pill ${cls}">${esc(label)}</span>
          ${q.secret ? '<span class="pill adq-secret">Secrète</span>' : ''}
          ${q.active ? '' : '<span class="pill adq-off">Inactive</span>'}
        </span>
      </div>
      <p class="small muted adq-meta">
        <span class="adq-diff adq-diff-${esc(q.difficulty)}">${esc(DIFF_LABEL[q.difficulty] || q.difficulty)}</span>
        ${esc(TYPE_LABEL[q.qtype] || q.qtype)} · ${esc(String(q.reward))} Paillettes${q.category ? ` · ${esc(q.category)}` : ''}
      </p>
      <p class="small muted">${esc(periodOf(q))}</p>
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" type="button" data-adq="edit" data-id="${esc(q.id)}">Modifier</button>
        <button class="btn btn-ghost btn-sm" type="button" data-adq="toggle" data-id="${esc(q.id)}">${q.active ? 'Désactiver' : 'Activer'}</button>
        <button class="btn btn-ghost btn-sm" type="button" data-adq="dup" data-id="${esc(q.id)}">Dupliquer</button>
        <button class="btn btn-danger btn-sm" type="button" data-adq="del" data-id="${esc(q.id)}">Supprimer</button>
      </div>
    </article>`;
  }).join('');
}

/** Filtres de la liste (difficulté, statut) : redessine à chaque changement. */
function onFilter(e) {
  if (e.target.id === 'adq-f-diff') Q.diff = e.target.value;
  else if (e.target.id === 'adq-f-statut') Q.statut = e.target.value;
  else return;
  renderList();
}

/* ---------- Clics ---------- */
/**
 * Gère les boutons de la section : onglets, nouvelle question, exemples, modifier, activer ou désactiver,
 * dupliquer, supprimer et enregistrement des récompenses par défaut.
 * @param {Event} e Événement de clic.
 */
async function onClick(e) {
  const t = e.target.closest('[data-adq]');
  if (!t || t.disabled) return;
  const act = t.dataset.adq;
  if (act === 'tab') return showTab(t.dataset.tab);
  if (act === 'new') return openQuestionForm({});
  if (act === 'examples') return openExamples();
  if (act === 'save-rewards') return saveRewards(t);
  const row = Q.rows.find((x) => x.id === t.dataset.id);
  if (!row) return;
  if (act === 'edit' || act === 'dup') {
    setBusy(t, true);
    try {
      const key = await fetchKey(row.id);
      if (act === 'edit') openQuestionForm({ row, key });
      else openQuestionForm({ row: copyOf(row), key, copy: true });
    } catch (ex) {
      toast(`Impossible d'ouvrir la question : ${errMsg(ex)}`, 'error');
    } finally {
      setBusy(t, false);
    }
    return;
  }
  if (act === 'toggle') {
    setBusy(t, true);
    try {
      const key = await fetchKey(row.id);
      await saveQuestion(questionOf(row, { active: !row.active }), key, row.id);
      toast(row.active ? 'Question désactivée.' : 'Question activée.', 'ok');
      await reload();
    } catch (ex) {
      toast(errMsg(ex), 'error');
    } finally {
      setBusy(t, false);
    }
    return;
  }
  if (act === 'del') {
    const ok = await confirmBox(
      `Supprimer la question « ${row.prompt.length > 80 ? `${row.prompt.slice(0, 80)}…` : row.prompt} » ?`,
      'La question et sa réponse disparaissent. Les réponses des membres partent avec elle ; les Paillettes déjà versées restent acquises (elles restent dans le journal). Cette action est définitive.',
      { ok: 'Supprimer la question', danger: true });
    if (!ok) return;
    setBusy(t, true);
    try {
      const { error } = await sb.rpc('hg_quiz_remove', { p_id: row.id });
      if (error) throw error;
      toast('Question supprimée.', 'ok');
      await reload();
    } catch (ex) {
      toast(errMsg(ex), 'error');
    } finally {
      setBusy(t, false);
    }
  }
}

/**
 * Affiche l'onglet demandé (questions ou statistiques). L'onglet statistiques n'est monté qu'une fois.
 * @param {'questions'|'stats'} name Onglet.
 */
async function showTab(name) {
  const stats = name === 'stats';
  for (const [tab, pan, on] of [['adq-tab-q', 'adq-pan-q', !stats], ['adq-tab-s', 'adq-pan-s', stats]]) {
    const b = Q.root.querySelector(`#${tab}`);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    b.classList.toggle('is-current', on);
    Q.root.querySelector(`#${pan}`).hidden = !on;
  }
  if (stats && !Q.statsMounted) {
    Q.statsMounted = true;
    await mountQuizStats(Q.root.querySelector('#adq-stats-root'));
  }
}

/* ---------- Passage par la base ---------- */
/**
 * Clé de réponse d'une question (RPC admin hg_quiz_key). Lève une erreur si l'appel échoue.
 * @param {string} id Identifiant de la question.
 * @returns {Promise<object>} La clé ({correct}, {accepted, manual} ou {value, tolerance}), ou {} si absente.
 */
async function fetchKey(id) {
  const { data, error } = await sb.rpc('hg_quiz_key', { p_id: id });
  if (error) throw error;
  return data && typeof data === 'object' ? data : {};
}

/**
 * Question au format attendu par hg_quiz_save, à partir d'une ligne de la base.
 * @param {object} r Ligne hg_quiz_questions.
 * @param {object} [over] Champs à remplacer (ex. { active: false }).
 * @returns {object}
 */
function questionOf(r, over = {}) {
  return {
    prompt: r.prompt, qtype: r.qtype, difficulty: r.difficulty, category: r.category ?? '',
    options: r.options ?? [], explanation: r.explanation ?? '', image_url: r.image_url ?? '',
    reward: r.reward, starts_at: r.starts_at, ends_at: r.ends_at ?? null, active: r.active, ...over,
  };
}

/**
 * Copie d'une question pour « Dupliquer » : inactive, sans fin, à partir de maintenant.
 * @param {object} r Ligne hg_quiz_questions.
 * @returns {object}
 */
function copyOf(r) {
  return { ...r, id: null, active: false, starts_at: new Date().toISOString(), ends_at: null };
}

/**
 * Enregistre une question et sa clé (RPC hg_quiz_save). Les erreurs du serveur sont relevées telles quelles.
 * @param {object} question Question au format de hg_quiz_save.
 * @param {object} key Clé de réponse.
 * @param {string|null} id Identifiant (null pour une création).
 * @returns {Promise<string>} Identifiant de la question.
 */
async function saveQuestion(question, key, id) {
  const { data, error } = await sb.rpc('hg_quiz_save', { p_id: id ?? null, p_question: question, p_key: key });
  if (error) throw error;
  return data;
}

/* ---------- Formulaire ---------- */
/**
 * État du formulaire : type de réponse courant et valeurs de chaque type (conservées quand on change de type).
 * @param {object} q Question de départ (ligne de la base, exemple ou valeurs par défaut).
 * @param {object} key Clé de réponse de la question (vide pour une nouvelle question).
 * @returns {object}
 */
function stateFrom(q, key) {
  const correct = Array.isArray(key?.correct) ? key.correct : [];
  const opts = Array.isArray(q.options) ? q.options : [];
  const choices = opts.length && q.qtype !== 'vrai_faux' ? opts.map((o) => ({ id: o.id, text: o.text, correct: correct.includes(o.id) })) : [];
  return {
    qtype: q.qtype || 'choix_unique',
    choices: choices.length ? choices : [{ id: 'a', text: '', correct: false }, { id: 'b', text: '', correct: false }],
    vf: q.qtype === 'vrai_faux' ? (correct[0] || '') : '',
    accepted: Array.isArray(key?.accepted) ? key.accepted.join('\n') : '',
    manual: !!key?.manual,
    value: key?.value != null ? String(key.value) : '',
    tolerance: key?.tolerance != null ? String(key.tolerance) : '0',
  };
}

/**
 * Premier identifiant de choix (a, b, c…) qui n'est pas encore utilisé.
 * @param {Array<{id: string}>} choices Choix courants.
 * @returns {string}
 */
function nextChoiceId(choices) {
  const used = new Set(choices.map((c) => c.id));
  return CHOICE_IDS.split('').find((x) => !used.has(x)) || '';
}

/**
 * Relit dans le DOM les valeurs du type de réponse affiché, dans st (avant tout changement de type ou enregistrement).
 * @param {HTMLElement} f Formulaire.
 * @param {object} st État du formulaire.
 */
function readZone(f, st) {
  if (st.qtype === 'choix_unique' || st.qtype === 'choix_multiple') {
    st.choices = [...f.querySelectorAll('.adq-choice')].map((r) => ({
      id: r.dataset.id,
      text: r.querySelector('.adq-choice-text').value,
      correct: r.querySelector('.adq-choice-correct').checked,
    }));
  } else if (st.qtype === 'vrai_faux') {
    st.vf = f.querySelector('input[name="adq-vf"]:checked')?.value || '';
  } else if (st.qtype === 'texte') {
    st.accepted = f.querySelector('#adq-accepted').value;
    st.manual = f.querySelector('#adq-manual').checked;
  } else if (st.qtype === 'nombre') {
    st.value = f.querySelector('#adq-value').value;
    st.tolerance = f.querySelector('#adq-tolerance').value;
  }
}

/**
 * Dessine la zone « Réponse » selon le type courant : liste de choix, vrai ou faux, réponses écrites ou valeur attendue.
 * @param {HTMLElement} f Formulaire.
 * @param {object} st État du formulaire.
 */
function paintZone(f, st) {
  const z = f.querySelector('#adq-type-zone');
  if (st.qtype === 'choix_unique' || st.qtype === 'choix_multiple') {
    const uniq = st.qtype === 'choix_unique';
    z.innerHTML = `<p class="small muted">${uniq ? 'Coche la bonne réponse : une seule.' : 'Coche toutes les bonnes réponses, et seulement celles-là.'}</p>
      <div class="adq-choices">${st.choices.map((c) => `<div class="adq-choice" data-id="${esc(c.id)}">
        <span class="adq-choice-id" aria-hidden="true">${esc(c.id)}</span>
        <input class="adq-choice-text" type="text" maxlength="200" aria-label="Texte du choix ${esc(c.id)}" placeholder="Texte du choix" value="${esc(c.text)}">
        <label class="adq-choice-ok"><input class="adq-choice-correct" type="${uniq ? 'radio' : 'checkbox'}" name="adq-correct"${c.correct ? ' checked' : ''}> Bonne réponse</label>
        <button class="btn btn-ghost btn-sm" type="button" data-adq="remove-choice" data-id="${esc(c.id)}"${st.choices.length <= 2 ? ' disabled' : ''}>Retirer</button>
      </div>`).join('')}</div>
      <button class="btn btn-ghost btn-sm" type="button" data-adq="add-choice"${st.choices.length >= 10 ? ' disabled' : ''}>+ Ajouter un choix</button>`;
  } else if (st.qtype === 'vrai_faux') {
    z.innerHTML = `<p class="small muted">Quelle est la bonne réponse ?</p>
      <div class="adq-vf" role="radiogroup" aria-label="Bonne réponse">
        <label><input type="radio" name="adq-vf" value="vrai"${st.vf === 'vrai' ? ' checked' : ''}> Vrai</label>
        <label><input type="radio" name="adq-vf" value="faux"${st.vf === 'faux' ? ' checked' : ''}> Faux</label>
      </div>`;
  } else if (st.qtype === 'texte') {
    z.innerHTML = `<div class="field">
        <label for="adq-accepted">Réponses acceptées (une par ligne)</label>
        <textarea id="adq-accepted" rows="4" placeholder="Canberra">${esc(st.accepted)}</textarea>
        <span class="small muted">Les majuscules, les accents et la ponctuation ne comptent pas.</span>
      </div>
      <label class="adq-check-line"><input id="adq-manual" type="checkbox"${st.manual ? ' checked' : ''}> Valider à la main les autres réponses (elles restent « en attente » jusqu'à ta décision, dans « Réponses et statistiques »)</label>`;
  } else if (st.qtype === 'nombre') {
    z.innerHTML = `<div class="adq-grid">
        <div class="field">
          <label for="adq-value">Valeur attendue</label>
          <input id="adq-value" type="text" inputmode="decimal" autocomplete="off" value="${esc(st.value)}">
        </div>
        <div class="field">
          <label for="adq-tolerance">Tolérance (± ; 0 = réponse exacte)</label>
          <input id="adq-tolerance" type="number" min="0" step="any" inputmode="decimal" value="${esc(st.tolerance)}">
        </div>
      </div>`;
  }
}

/**
 * Lit et valide le formulaire, puis renvoie la question et la clé au format attendu par hg_quiz_save.
 * @param {HTMLElement} f Formulaire du tiroir.
 * @param {object} st État du formulaire.
 * @returns {{question: object, key: object}|{error: string}} Les données, ou le message à afficher.
 */
function collect(f, st) {
  readZone(f, st);
  const prompt = f.querySelector('#adq-prompt').value.trim();
  const difficulty = f.querySelector('#adq-difficulty').value;
  const category = f.querySelector('#adq-category').value.trim();
  const explanation = f.querySelector('#adq-explanation').value.trim();
  const image = f.querySelector('#adq-image').value.trim();
  const rewardRaw = f.querySelector('#adq-reward').value.trim();
  const reward = Number(rewardRaw);
  const startsRaw = f.querySelector('#adq-start').value;
  const endsRaw = f.querySelector('#adq-end').value;
  const starts = startsRaw ? fromZurichInput(startsRaw) : new Date().toISOString();
  const ends = endsRaw ? fromZurichInput(endsRaw) : null;
  const active = f.querySelector('#adq-active').checked;

  if (prompt.length < 3 || prompt.length > 500) return { error: 'L\'énoncé doit faire entre 3 et 500 caractères.' };
  if (!DIFF_LABEL[difficulty]) return { error: 'Choisis une difficulté.' };
  if (category.length > 40) return { error: 'La catégorie dépasse 40 caractères.' };
  if (explanation.length > 500) return { error: 'L\'explication dépasse 500 caractères.' };
  if (image && (image.length > 500 || !/^https:\/\/\S+$/.test(image))) return { error: 'L\'image doit être une adresse https://… (500 caractères au plus).' };
  if (rewardRaw === '' || !Number.isInteger(reward) || reward < 0 || reward > REWARD_MAX) {
    return { error: `La récompense doit être un nombre entier entre 0 et ${REWARD_MAX}.` };
  }
  if (!starts) return { error: 'La date de début n\'est pas valable.' };
  if (endsRaw && !ends) return { error: 'La date de fin n\'est pas valable.' };
  if (ends && new Date(ends) <= new Date(starts)) return { error: 'La fin doit être après le début.' };

  let options = [];
  let key;
  if (st.qtype === 'choix_unique' || st.qtype === 'choix_multiple') {
    if (st.choices.length < 2 || st.choices.length > 10) return { error: 'Il faut entre 2 et 10 choix.' };
    if (st.choices.some((c) => !c.text.trim() || c.text.trim().length > 200)) return { error: 'Chaque choix a besoin d\'un texte (200 caractères au plus).' };
    const correct = st.choices.filter((c) => c.correct).map((c) => c.id);
    if (st.qtype === 'choix_unique' && correct.length !== 1) return { error: 'Coche la bonne réponse.' };
    if (st.qtype === 'choix_multiple' && correct.length < 1) return { error: 'Coche au moins une bonne réponse.' };
    options = st.choices.map((c) => ({ id: c.id, text: c.text.trim() }));
    key = { correct };
  } else if (st.qtype === 'vrai_faux') {
    if (st.vf !== 'vrai' && st.vf !== 'faux') return { error: 'Indique si l\'affirmation est vraie ou fausse.' };
    key = { correct: [st.vf] };
  } else if (st.qtype === 'texte') {
    const accepted = st.accepted.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!accepted.length && !st.manual) return { error: 'Donne au moins une réponse acceptée, ou coche la validation à la main.' };
    key = { accepted, manual: st.manual };
  } else if (st.qtype === 'nombre') {
    const v = st.value.trim().replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(v)) return { error: 'Donne la valeur attendue (un nombre).' };
    const tolerance = Number(st.tolerance === '' ? 0 : st.tolerance);
    if (!Number.isFinite(tolerance) || tolerance < 0) return { error: 'La tolérance doit être un nombre positif ou nul.' };
    key = { value: Number(v), tolerance };
  } else {
    return { error: 'Choisis un type de réponse.' };
  }

  // La case « secrète » ne va pas dans hg_quiz_save : elle passe par hg_quiz_set_secret, après l'enregistrement.
  return {
    question: { prompt, qtype: st.qtype, difficulty, category, options, explanation, image_url: image, reward,
      starts_at: starts, ends_at: ends, active },
    key,
    secret: f.querySelector('#adq-secret').checked,
  };
}

/**
 * Ouvre le formulaire d'une question dans le tiroir : création, modification, copie ou exemple.
 * @param {{row?: object, key?: object, copy?: boolean, example?: object}} opts
 *   row : question à modifier (key : sa clé) ; copy : la ligne est une copie (création) ; example : modèle prêt à l'emploi.
 */
function openQuestionForm({ row = null, key = null, copy = false, example = null } = {}) {
  const isNew = !row || copy;
  // Valeurs de départ : la question (ligne, copie ou exemple), ou une question vide.
  const base = row || (example ? { ...example.q, reward: undefined, starts_at: undefined, ends_at: null, active: true } : {});
  const baseKey = row ? key : (example ? example.key : null);
  const difficulty = base.difficulty || 'moyen';
  const reward = base.reward ?? Q.rewards[difficulty];
  const v = {
    prompt: base.prompt ?? '', difficulty, category: base.category ?? '', explanation: base.explanation ?? '', image: base.image_url ?? '',
    reward, starts: base.starts_at ?? new Date().toISOString(), ends: base.ends_at ?? null, active: base.active ?? true,
    secret: !!base.secret,
  };
  // Identifiant de la question (null avant création) et son état secret connu : partagés entre les envois du formulaire.
  const ctx = { id: row?.id ?? null, secret: !!row?.secret && !copy };
  const st = stateFrom({ qtype: base.qtype || 'choix_unique', options: base.options }, baseKey || {});
  const title = copy ? 'Dupliquer la question' : (row ? 'Modifier la question' : 'Nouvelle question');
  const subtitle = copy ? 'Copie : inactive, sans fin, à partir de maintenant. Ajuste puis active-la.' : (example ? 'Exemple prêt à l\'emploi : ajuste si besoin, puis enregistre.' : '');

  const d = openDrawer({
    title,
    subtitle,
    submitLabel: isNew ? 'Créer la question' : 'Enregistrer les modifications',
    wide: true,
    body: `<div class="adq-form">
      <div class="adq-grid">
        <div class="field adq-wide">
          <label for="adq-prompt">Énoncé</label>
          <textarea id="adq-prompt" rows="2" maxlength="500">${esc(v.prompt)}</textarea>
        </div>
        <div class="field">
          <label for="adq-qtype">Type de réponse</label>
          <select id="adq-qtype">${TYPES.map(([val, label]) => `<option value="${val}"${val === st.qtype ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label for="adq-difficulty">Difficulté</label>
          <select id="adq-difficulty">${DIFFS.map(([val, label]) => `<option value="${val}"${val === v.difficulty ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>
        </div>
        <div class="field adq-wide">
          <fieldset class="adq-zone">
            <legend>Réponse</legend>
            <div id="adq-type-zone"></div>
          </fieldset>
        </div>
        <div class="field">
          <label for="adq-reward">Récompense (Paillettes)</label>
          <input id="adq-reward" type="number" min="0" max="${REWARD_MAX}" step="1" inputmode="numeric" value="${esc(String(v.reward))}">
        </div>
        <div class="field">
          <label for="adq-category">Catégorie (facultative)</label>
          <input id="adq-category" type="text" maxlength="40" autocomplete="off" value="${esc(v.category)}">
        </div>
        <div class="field adq-wide">
          <label for="adq-explanation">Explication, affichée après la réponse (facultative)</label>
          <textarea id="adq-explanation" rows="2" maxlength="500">${esc(v.explanation)}</textarea>
        </div>
        <div class="field adq-wide">
          <label for="adq-image">Image (adresse https://, facultative)</label>
          <input id="adq-image" type="text" maxlength="500" autocomplete="off" inputmode="url" value="${esc(v.image)}">
        </div>
        <div class="field">
          <label for="adq-start">Début (heure suisse)</label>
          <input id="adq-start" type="datetime-local" value="${esc(toZurichInput(v.starts))}">
        </div>
        <div class="field">
          <label for="adq-end">Fin (heure suisse ; vide = sans fin)</label>
          <input id="adq-end" type="datetime-local" value="${esc(v.ends ? toZurichInput(v.ends) : '')}">
        </div>
        <div class="field adq-wide adq-check">
          <label><input id="adq-active" type="checkbox"${v.active ? ' checked' : ''}> Active : visible par les membres pendant sa période</label>
        </div>
        <div class="field adq-wide">
          <label class="adq-check-line"><input id="adq-secret" type="checkbox"${v.secret ? ' checked' : ''}> Question bonus secrète</label>
          <p class="small muted">Visible seulement par les membres qui ont trouvé au moins 3 secrets cachés du site.</p>
        </div>
      </div>
      <p class="form-error" id="adq-error" role="alert" hidden></p>
    </div>`,
    onSubmit: (form) => submitForm(form, st, ctx),
  });
  const f = d.form;
  paintZone(f, st);
  f.addEventListener('change', (e) => {
    if (e.target.id === 'adq-qtype') {
      readZone(f, st);
      st.qtype = e.target.value;
      paintZone(f, st);
    } else if (e.target.id === 'adq-difficulty') {
      // Le choix de difficulté remet la récompense à la valeur par défaut (toujours modifiable ensuite).
      f.querySelector('#adq-reward').value = String(Q.rewards[e.target.value]);
    }
  });
  f.addEventListener('click', (e) => {
    const b = e.target.closest('[data-adq]');
    if (!b || b.disabled) return;
    if (b.dataset.adq === 'add-choice' && st.choices.length < 10) {
      readZone(f, st);
      st.choices.push({ id: nextChoiceId(st.choices), text: '', correct: false });
      paintZone(f, st);
    } else if (b.dataset.adq === 'remove-choice' && st.choices.length > 2) {
      readZone(f, st);
      st.choices = st.choices.filter((c) => c.id !== b.dataset.id);
      paintZone(f, st);
    }
  });
}

/**
 * Valide et enregistre le formulaire, puis applique la case « Question bonus secrète » (hg_quiz_set_secret).
 * Renvoie false (tiroir ouvert, erreur affichée) en cas d'échec. Après une création réussie, ctx.id reçoit
 * l'identifiant : un nouvel envoi modifie la question au lieu d'en créer une seconde.
 * @param {HTMLElement} f Formulaire du tiroir.
 * @param {object} st État du formulaire.
 * @param {{id: string|null, secret: boolean}} ctx Identifiant (null avant création) et état secret déjà appliqué.
 * @returns {Promise<boolean|undefined>} false si le tiroir doit rester ouvert.
 */
async function submitForm(f, st, ctx) {
  const err = f.querySelector('#adq-error');
  const res = collect(f, st);
  if (res.error) { err.textContent = res.error; err.hidden = false; return false; }
  err.hidden = true;
  const creating = !ctx.id;
  try {
    ctx.id = await saveQuestion(res.question, res.key, ctx.id);
  } catch (ex) {
    err.textContent = `Enregistrement impossible : ${errMsg(ex)}`;
    err.hidden = false;
    return false;
  }
  if (res.secret || ctx.secret) {
    try {
      const { error } = await sb.rpc('hg_quiz_set_secret', { p_id: ctx.id, p_secret: res.secret });
      if (error) throw error;
      ctx.secret = res.secret;
    } catch (ex) {
      await reload();
      err.textContent = `Question enregistrée, mais la case « Question bonus secrète » n'a pas pu être appliquée : ${errMsg(ex)}`;
      err.hidden = false;
      return false;
    }
  }
  toast(creating ? 'Question créée.' : 'Question enregistrée.', 'ok');
  await reload();
}

/**
 * Ouvre le tiroir des exemples : un bouton par type. Le choix ouvre le formulaire pré-rempli (rien n'est créé).
 */
function openExamples() {
  const d = openDrawer({
    title: 'Exemples',
    subtitle: 'Un exemple par type de réponse. Le formulaire se pré-remplit ; rien n\'est créé avant « Créer la question ».',
    body: `<div class="adq-examples">${EXEMPLES.map((ex, i) => `<button class="adq-example" type="button" data-example="${i}">
      <span class="adq-model-title">${esc(ex.label)}</span>
      <span class="small muted">${esc(ex.q.prompt)}</span>
    </button>`).join('')}</div>`,
  });
  d.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-example]');
    if (!b) return;
    const ex = EXEMPLES[Number(b.dataset.example)];
    d.close();
    openQuestionForm({ example: ex });
  });
}
