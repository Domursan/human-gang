// ===== Humane Gang — administration : réponses et statistiques des « Questions du gang » =====
// Rôle : l'onglet « Réponses et statistiques » de la section Questions du gang. Affiche le résumé en tuiles, les
// réponses libres à valider à la main, la réussite par difficulté, le tableau des questions (avec le détail de chacune),
// le classement des membres, des phrases de synthèse calculées et l'export CSV de toutes les réponses.
// Lecture : RPC hg_quiz_stats et hg_quiz_answers_list. Écriture : RPC hg_quiz_validate seulement.
// Droit « quiz » requis (admin ou Staff). Le module ne crée ni ne modifie de question.
// Dépendances : core.js (client Supabase, toast, échappement, erreurs, dates).
// Exporte : mountQuizStats(container), qui affiche l'onglet dans le conteneur. Rappelée, elle recharge et réaffiche.

import { sb, toast, esc, errMsg, fmtDateTime } from '../../commun/core.js';

/* ---------- Constantes ---------- */
// Réponses minimum avant de tirer des conclusions ; réponses corrigées minimum pour classer une question.
const SEUIL_SYNTHESE = 10;
const SEUIL_QUESTION = 3;
// Difficultés du plus facile au plus difficile (ordre du tri et de l'affichage).
const DIFFICULTES = ['facile', 'moyen', 'difficile', 'expert'];
const DIFF_LABEL = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile', expert: 'Expert' };
const TYPE_LABEL = { choix_unique: 'Choix unique', choix_multiple: 'Choix multiple', vrai_faux: 'Vrai ou faux', texte: 'Texte libre', nombre: 'Nombre' };
// Types dont les réponses sont des choix (ids d'options) ; les autres ont une réponse libre.
const TYPES_CHOIX = ['choix_unique', 'choix_multiple', 'vrai_faux'];
// Colonnes du CSV. Séparateur « ; » (Excel en français) et BOM UTF-8 ajouté à l'export.
const CSV_ENTETE = ['Numéro', 'Question', 'Type', 'Difficulté', 'Membre', 'Réponse', 'Résultat', 'Paillettes', 'Répondu le', 'Corrigé le'];
const nombre = new Intl.NumberFormat('fr-CH');
const ESP = ' '; // espace insécable devant « % »

/* ---------- État du module ---------- */
// root : conteneur de l'onglet ; stats : résumé et questions (hg_quiz_stats) ; pending : réponses libres en attente ;
// error / pendingError : messages d'erreur affichés ; sort : tri du tableau des questions ; open : id de la question
// dont le détail est affiché, detail : ses réponses (null = en cours de chargement) ; retour : élément à remettre au focus ;
// busy : une action (validation, export, actualisation) est en cours ; updated : heure du dernier chargement.
const Q = { root: null, stats: null, pending: [], error: '', pendingError: '', sort: { key: 'answers', dir: -1 }, open: null, detail: null, detailError: '', retour: '', busy: false, updated: null };
/* ---------- Petits outils de mise en forme ---------- */
/** Nombre à la française (« 1’250 »). */
const n = (x) => nombre.format(Number(x) || 0);
/** Pourcentage arrondi, ou null s'il n'y a rien à mesurer. */
const pct = (ok, total) => (total > 0 ? Math.round((100 * ok) / total) : null);
/** Pourcentage affiché (« 67 % »), ou un tiret s'il n'y a rien à mesurer. */
const pctTxt = (ok, total) => { const p = pct(ok, total); return p == null ? '—' : p + ESP + '%'; };
/** Nombre suivi du mot au singulier ou au pluriel (« 1 réponse », « 3 réponses »). */
const plur = (k, un, plusieurs) => `${n(k)} ${Number(k) > 1 ? plusieurs : un}`;
/** Raccourcit un énoncé trop long pour une phrase ou une cellule. */
const court = (t, max = 80) => (t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t);
/** Libellé d'un choix : son texte, ou « Vrai » / « Faux » pour les questions vrai ou faux. */
function libelleOption(q, id) {
  const o = (q?.options || []).find((x) => String(x.id) === String(id));
  if (o?.text) return o.text;
  if (id === 'vrai') return 'Vrai';
  if (id === 'faux') return 'Faux';
  return String(id);
}
/** Réponse lisible : texte tel quel, ou libellés des choix cochés. */
function reponseTxt(q, resp) {
  if (Array.isArray(resp)) return resp.map((id) => libelleOption(q, id)).join(', ');
  return resp == null ? '' : String(resp);
}
/** Résultat d'une réponse : juste, fausse, ou en attente de validation. */
const resultat = (r) => (r.is_correct === true ? 'Juste' : r.is_correct === false ? 'Fausse' : 'En attente');
/** Question du résumé d'après son id (null si absente). */
const questionDe = (id) => Q.stats?.questions?.find((x) => x.id === id) || null;
/** État d'une question : inactive, programmée, fermée ou ouverte. */
function etatQuestion(q) {
  if (!q.active) return 'inactive';
  const t = Date.now();
  if (q.starts_at && new Date(q.starts_at).getTime() > t) return 'programmée';
  if (q.ends_at && new Date(q.ends_at).getTime() <= t) return 'fermée';
  return 'ouverte';
}
/** Date pour le CSV, en heure suisse et format « AAAA-MM-JJ HH:MM:SS » (lisible par Excel). */
const dateCsv = (d) => (d ? new Date(d).toLocaleString('sv-SE', { timeZone: 'Europe/Zurich' }) : '');

/* ---------- Chargement des données ---------- */
/**
 * Charge le résumé (hg_quiz_stats) et les réponses libres en attente (hg_quiz_answers_list).
 * Les erreurs sont gardées dans l'état pour être affichées ; la fonction ne lève pas.
 * @returns {Promise<void>}
 */
async function charger() {
  let s, p;
  try {
    [s, p] = await Promise.all([
      sb.rpc('hg_quiz_stats'),
      sb.rpc('hg_quiz_answers_list', { p_question: null, p_pending_only: true }),
    ]);
  } catch (e) {
    s = { error: e }; p = { error: e };
  }
  Q.updated = new Date();
  if (s.error) { Q.error = errMsg(s.error); Q.stats = null; }
  else if (!s.data) { Q.error = 'le serveur n’a renvoyé aucune statistique.'; Q.stats = null; }
  else { Q.error = ''; Q.stats = s.data; }
  if (p.error) { Q.pendingError = 'Impossible de charger les réponses en attente : ' + errMsg(p.error); Q.pending = []; }
  else { Q.pendingError = ''; Q.pending = p.data || []; }
}

/**
 * Charge toutes les réponses d'une question (pour son détail). Ignorée si une autre question a été ouverte entre-temps.
 * @param {string} id Identifiant (uuid) de la question.
 * @returns {Promise<void>}
 */
async function chargerDetail(id) {
  let r;
  try { r = await sb.rpc('hg_quiz_answers_list', { p_question: id, p_pending_only: false }); }
  catch (e) { r = { error: e }; }
  if (Q.open !== id) return;
  if (r.error) { Q.detailError = 'Impossible de charger les réponses : ' + errMsg(r.error); Q.detail = []; }
  else { Q.detailError = ''; Q.detail = r.data || []; }
  render();
}

/* ---------- Calculs ---------- */
/**
 * Résultats par difficulté. Le taux compte les réponses corrigées ; le nombre de réponses compte aussi les réponses en attente.
 * @returns {Array<{d: string, questions: number, answers: number, corrigees: number, correct: number, p: number|null}>}
 */
function lignesDifficulte() {
  return DIFFICULTES.map((d) => {
    const qs = Q.stats.questions.filter((q) => q.difficulty === d);
    const bd = Q.stats.by_difficulty.find((x) => x.difficulty === d);
    const corrigees = qs.reduce((a, q) => a + (q.answers - q.pending), 0);
    const correct = qs.reduce((a, q) => a + q.correct, 0);
    const answers = bd ? bd.answers : qs.reduce((a, q) => a + q.answers, 0);
    return { d, questions: qs.length, answers, corrigees, correct, p: pct(correct, corrigees) };
  });
}

/**
 * Phrases de synthèse calculées à partir des données (3 à 5 lignes). Sans assez de réponses, une seule phrase d'attente.
 * @returns {Array<{texte: string, alerte?: boolean}>}
 */
function synthese() {
  const s = Q.stats.summary;
  const lignes = [];
  if (s.pending > 0) {
    lignes.push({ texte: `${s.pending > 1 ? `${n(s.pending)} réponses attendent` : '1 réponse attend'} ta validation.`, alerte: true });
  }
  if (s.answers < SEUIL_SYNTHESE) {
    lignes.push({ texte: 'Pas encore assez de réponses pour une synthèse.' });
    return lignes;
  }
  const classees = Q.stats.questions
    .map((q) => { const corrigees = q.answers - q.pending; return { q, corrigees, p: pct(q.correct, corrigees) }; })
    .filter((x) => x.corrigees >= SEUIL_QUESTION && x.p != null);
  if (classees.length) {
    const dure = classees.reduce((a, b) => (b.p < a.p ? b : a));
    lignes.push({ texte: `La question la plus difficile : « ${court(dure.q.prompt)} » (${dure.p}${ESP}% de réussite).` });
  }
  const meilleur = [...Q.stats.players].sort((a, b) => b.correct - a.correct || b.paillettes - a.paillettes)[0];
  if (meilleur && meilleur.correct > 0) {
    lignes.push({ texte: `Le meilleur joueur : ${meilleur.pseudo || 'un membre'} (${plur(meilleur.correct, 'bonne réponse', 'bonnes réponses')} sur ${n(meilleur.answers)}).` });
  }
  for (const l of lignesDifficulte()) {
    if ((l.d === 'facile' || l.d === 'difficile') && l.p != null && l.corrigees >= SEUIL_QUESTION) {
      lignes.push({ texte: `Les questions ${l.d === 'facile' ? 'faciles' : 'difficiles'} sont réussies à ${l.p}${ESP}%.` });
    }
  }
  return lignes.slice(0, 5);
}

/** Clés de tri du tableau des questions. */
const VALEURS_TRI = {
  prompt: (q) => q.prompt.toLowerCase(),
  difficulty: (q) => DIFFICULTES.indexOf(q.difficulty),
  answers: (q) => q.answers,
  pct: (q) => pct(q.correct, q.answers - q.pending) ?? -1,
  paillettes: (q) => q.paillettes,
};
/** Comparaison de deux questions selon le tri courant ; à égalité, par énoncé. */
function comparerQuestions(a, b) {
  const va = VALEURS_TRI[Q.sort.key](a), vb = VALEURS_TRI[Q.sort.key](b);
  let r = typeof va === 'string' ? va.localeCompare(vb, 'fr') : va - vb;
  if (r === 0) r = a.prompt.localeCompare(b.prompt, 'fr');
  return r * Q.sort.dir;
}

/* ---------- Affichage ---------- */
/**
 * Affiche l'état courant dans le conteneur. Garde le focus sur le contrôle activé (clavier et lecteur d'écran).
 * @returns {void}
 */
function render() {
  const root = Q.root;
  if (!root) return;
  const actif = root.contains(document.activeElement) ? selecteurDe(document.activeElement) : '';
  root.setAttribute('aria-busy', Q.busy ? 'true' : 'false');
  if (Q.stats) root.innerHTML = pageHtml();
  else if (Q.error) root.innerHTML = `<div class="qs">${headHtml()}${bannerHtml('Impossible de charger les statistiques : ' + Q.error)}</div>`;
  else root.innerHTML = '<p class="qs-empty" role="status">Chargement des statistiques…</p>';
  const cible = Q.retour || actif;
  Q.retour = '';
  if (cible) root.querySelector(cible)?.focus({ preventScroll: true });
}

/**
 * Sélecteur CSS d'un contrôle (à partir de ses data-attributs), pour lui rendre le focus après un nouvel affichage.
 * @param {HTMLElement} el Contrôle.
 * @returns {string} Sélecteur, ou '' si le contrôle n'en a pas.
 */
function selecteurDe(el) {
  const d = el.dataset;
  if (d.q) return `[data-q="${d.q}"]`;
  if (d.sort) return `[data-sort="${d.sort}"]`;
  if (d.answer) return `[data-answer="${d.answer}"][data-juste="${d.juste}"]`;
  if (d.act) return `[data-act="${d.act}"]`;
  return '';
}

/** Bandeau d'erreur annoncé tout de suite. */
const bannerHtml = (msg) => `<p class="qs-banner" role="alert">${esc(msg)}</p>`;

/** En-tête : texte d'explication, heure de mise à jour, actualiser et export. */
function headHtml() {
  return `<header class="qs-head">
    <div class="qs-head-text">
      <p class="small muted">Réponses des membres et statistiques des questions du gang.</p>
      ${Q.updated ? `<p class="small muted qs-stamp">Mis à jour à ${esc(fmtDateTime(Q.updated))}</p>` : ''}
    </div>
    <div class="qs-head-actions">
      <button class="btn" type="button" data-act="refresh" ${Q.busy ? 'disabled' : ''}>Actualiser</button>
      <button class="btn btn-primary" type="button" data-act="export" ${Q.busy ? 'disabled' : ''}>Exporter en CSV</button>
    </div>
  </header>`;
}

/** Page complète : synthèse, tuiles, à valider, difficulté, questions (et détail), classement. */
function pageHtml() {
  const s = Q.stats.summary;
  if (s.questions === 0) {
    return `<div class="qs">${headHtml()}
      <section class="qs-block" aria-labelledby="qs-h-vide"><h3 id="qs-h-vide">Aucune question pour l’instant</h3>
      <p class="muted">Les réponses et les statistiques apparaîtront ici dès que des questions du gang auront été créées.</p></section>
    </div>`;
  }
  return `<div class="qs">
    ${headHtml()}
    ${Q.error ? bannerHtml('Impossible de rafraîchir les statistiques : ' + Q.error) : ''}
    ${synthHtml()}
    ${tuilesHtml(s)}
    ${aValiderHtml()}
    ${difficulteHtml()}
    ${questionsHtml()}
    ${Q.open !== null ? detailHtml() : ''}
    ${joueursHtml()}
  </div>`;
}

/** Bloc des phrases de synthèse. */
function synthHtml() {
  return `<section class="qs-block" aria-labelledby="qs-h-synth">
    <h3 id="qs-h-synth">Synthèse</h3>
    <ul class="qs-synth">${synthese().map((l) => `<li${l.alerte ? ' class="is-alert"' : ''}>${esc(l.texte)}</li>`).join('')}</ul>
  </section>`;
}

/** Tuiles du résumé ; la tuile « En attente » est mise en avant quand il reste des réponses à valider. */
function tuilesHtml(s) {
  const ouvertes = s.open === 1 ? '1 ouverte' : `${n(s.open)} ouvertes`;
  const tuiles = [
    { id: 'questions', label: 'Questions', valeur: n(s.questions), sub: ouvertes },
    { id: 'answers', label: 'Réponses', valeur: n(s.answers), sub: `${n(s.correct)} justes · ${n(s.wrong)} fausses` },
    { id: 'rate', label: 'Taux de réussite', valeur: pctTxt(s.correct, s.correct + s.wrong), sub: 'sur les réponses corrigées' },
    { id: 'players', label: 'Joueurs', valeur: n(s.players), sub: 'ont déjà répondu' },
    { id: 'paillettes', label: 'Paillettes versées', valeur: n(s.paillettes), sub: 'pour les bonnes réponses' },
    { id: 'last7', label: '7 derniers jours', valeur: n(s.last_7_days), sub: 'réponses reçues' },
    { id: 'pending', label: 'En attente', valeur: n(s.pending), sub: s.pending > 0 ? 'à valider ci-dessous' : 'rien à valider', alerte: s.pending > 0 },
  ];
  return `<section class="qs-block" aria-label="Chiffres clés"><ul class="qs-tiles">${tuiles.map((t) => `
    <li class="qs-tile${t.alerte ? ' is-alert' : ''}" data-stat="${t.id}">
      <span class="qs-tile-label">${esc(t.label)}</span>
      <strong class="qs-tile-value">${esc(t.valeur)}</strong>
      <span class="qs-tile-sub">${esc(t.sub)}</span>
    </li>`).join('')}</ul></section>`;
}

/** Réponses libres en attente, avec « Juste » et « Faux ». */
function aValiderHtml() {
  const liste = Q.pending;
  let corps = '';
  if (liste.length) {
    corps = `<ul class="qs-pend-list">${liste.map((r) => {
      const q = questionDe(r.question_id);
      const recompense = q ? `${n(q.reward)} Paillettes à la clé` : '';
      return `<li class="qs-pend" data-answer-row="${Number(r.id)}">
        <div class="qs-pend-meta"><strong>${esc(r.pseudo || 'Membre inconnu')}</strong>
          <span class="small muted">${esc(court(r.prompt || (q && q.prompt) || 'Question', 100))}${recompense ? ' · ' + esc(recompense) : ''}</span></div>
        <p class="qs-pend-rep">« ${esc(reponseTxt(q, r.response))} »</p>
        <div class="qs-pend-acts">
          <button class="btn btn-primary" type="button" data-act="valider" data-answer="${Number(r.id)}" data-juste="1" ${Q.busy ? 'disabled' : ''}>Juste</button>
          <button class="btn" type="button" data-act="valider" data-answer="${Number(r.id)}" data-juste="0" ${Q.busy ? 'disabled' : ''}>Faux</button>
        </div>
      </li>`;
    }).join('')}</ul>`;
  } else if (!Q.pendingError) {
    corps = '<p class="qs-empty">Aucune réponse en attente.</p>';
  }
  return `<section class="qs-block" aria-labelledby="qs-h-pend">
    <h3 id="qs-h-pend">À valider <span class="qs-count">${n(liste.length)}</span></h3>
    <p class="small muted">Réponses libres à corriger à la main. « Juste » crédite la récompense tout de suite.</p>
    ${Q.pendingError ? bannerHtml(Q.pendingError) : ''}
    ${corps}
  </section>`;
}

/** Une barre horizontale : libellé, valeur écrite (sans couleur seule) et remplissage proportionnel. */
function barreHtml(libelle, valeur, p) {
  return `<li class="qs-bar">
    <div class="qs-bar-head"><span class="qs-bar-label">${esc(libelle)}</span><span class="qs-bar-val">${esc(valeur)}</span></div>
    <div class="qs-track" aria-hidden="true"><span class="qs-fill" style="width:${Math.max(0, Math.min(100, p || 0))}%"></span></div>
  </li>`;
}

/** Réussite par difficulté, en barres horizontales. */
function difficulteHtml() {
  const barres = lignesDifficulte().map((l) => {
    const reps = `${plur(l.answers, 'réponse', 'réponses')}`;
    const q = l.questions ? plur(l.questions, 'question', 'questions') : 'aucune question';
    const valeur = l.p == null ? `pas encore corrigée · ${reps}` : `${l.p}${ESP}% · ${reps}`;
    return barreHtml(`${DIFF_LABEL[l.d]} (${q})`, valeur, l.p);
  }).join('');
  return `<section class="qs-block" aria-labelledby="qs-h-diff">
    <h3 id="qs-h-diff">Par difficulté</h3>
    <p class="small muted">Taux de réussite sur les réponses corrigées ; le nombre compte aussi les réponses en attente.</p>
    <ul class="qs-bars">${barres}</ul>
  </section>`;
}

/** Tableau des questions, triable. Une ligne s'ouvre pour voir son détail. */
function questionsHtml() {
  const qs = [...Q.stats.questions].sort(comparerQuestions);
  const entete = (key, label, num) => {
    const actif = Q.sort.key === key;
    const aria = actif ? (Q.sort.dir > 0 ? 'ascending' : 'descending') : 'none';
    const fleche = actif ? `<span aria-hidden="true"> ${Q.sort.dir > 0 ? '▲' : '▼'}</span>` : '';
    return `<th scope="col"${num ? ' class="num"' : ''} aria-sort="${aria}"><button class="qs-sort" type="button" data-sort="${key}">${label}${fleche}</button></th>`;
  };
  const ligne = (q) => {
    const corrigees = q.answers - q.pending;
    const ouverte = Q.open === q.id;
    return `<tr${ouverte ? ' class="is-open"' : ''}>
      <th scope="row"><button class="qs-qbtn" type="button" data-q="${esc(q.id)}" aria-expanded="${ouverte ? 'true' : 'false'}">${esc(court(q.prompt, 90))}</button>
        <span class="qs-meta small muted">${esc(TYPE_LABEL[q.type] || q.type)} · ${esc(etatQuestion(q))}</span></th>
      <td>${esc(DIFF_LABEL[q.difficulty] || q.difficulty)}</td>
      <td class="num">${n(q.answers)}${q.pending ? `<span class="qs-meta small muted">${n(q.pending)} en attente</span>` : ''}</td>
      <td class="num">${pctTxt(q.correct, corrigees)}</td>
      <td class="num">${n(q.paillettes)}</td>
    </tr>`;
  };
  return `<section class="qs-block" aria-labelledby="qs-h-questions">
    <h3 id="qs-h-questions">Par question</h3>
    <p class="small muted">Clique sur une question pour voir la répartition de ses réponses et toutes les réponses reçues.</p>
    <div class="qs-scroll"><table class="qs-table">
      <caption class="qs-sr">Statistiques par question</caption>
      <thead><tr>${entete('prompt', 'Question')}${entete('difficulty', 'Difficulté')}${entete('answers', 'Réponses', true)}${entete('pct', '% réussite', true)}${entete('paillettes', 'Paillettes', true)}</tr></thead>
      <tbody>${qs.map(ligne).join('')}</tbody>
    </table></div>
  </section>`;
}

/** Détail d'une question : répartition des choix ou réponses libres les plus fréquentes, puis toutes les réponses. */
function detailHtml() {
  const q = questionDe(Q.open);
  if (!q) return '';
  const corrigees = q.answers - q.pending;
  let corps = '';
  if (TYPES_CHOIX.includes(q.type)) {
    const ids = (q.options || []).map((o) => String(o.id));
    const autres = Object.keys(q.choices || {}).filter((id) => !ids.includes(id));
    const tous = [...ids, ...autres];
    corps = `<h4 class="qs-h4">Répartition des choix</h4>` + (tous.length
      ? `<ul class="qs-bars">${tous.map((id) => {
          const c = Number(q.choices?.[id] || 0);
          const part = q.answers ? Math.round((100 * c) / q.answers) : 0;
          return barreHtml(libelleOption(q, id), `${n(c)} · ${part}${ESP}%`, part);
        }).join('')}</ul>`
      : '<p class="small muted">Cette question n’a pas de choix.</p>')
      + `<p class="small muted">Part calculée sur les ${plur(q.answers, 'réponse', 'réponses')} ; une réponse à choix multiples compte dans chaque choix coché.</p>`;
  } else {
    const top = q.top_texts || [];
    corps = `<h4 class="qs-h4">Réponses les plus fréquentes</h4>` + (top.length
      ? `<ol class="qs-top">${top.map((t) => `<li><span class="qs-top-txt">« ${esc(t.text)} »</span> <strong>${n(t.n)}</strong></li>`).join('')}</ol>`
      : '<p class="small muted">Aucune réponse libre pour l’instant.</p>')
      + '<p class="small muted">Les réponses identiques sans tenir compte des accents, de la casse ni de la ponctuation sont regroupées.</p>';
  }
  corps += '<h4 class="qs-h4">Toutes les réponses</h4>';
  if (Q.detailError) corps += bannerHtml(Q.detailError);
  else if (Q.detail === null) corps += '<p class="qs-empty" role="status">Chargement des réponses…</p>';
  else if (!Q.detail.length) corps += '<p class="qs-empty">Personne n’a encore répondu à cette question.</p>';
  else corps += `<div class="qs-scroll qs-scroll-tall"><table class="qs-table qs-table-sm">
      <caption class="qs-sr">Toutes les réponses à cette question</caption>
      <thead><tr><th scope="col">Membre</th><th scope="col">Réponse</th><th scope="col">Résultat</th><th scope="col">Envoyée le</th></tr></thead>
      <tbody>${Q.detail.map((r) => `<tr>
        <td>${esc(r.pseudo || 'Membre inconnu')}</td>
        <td>${esc(reponseTxt(q, r.response))}</td>
        <td>${esc(resultat(r))}</td>
        <td>${esc(fmtDateTime(r.answered_at))}</td></tr>`).join('')}</tbody>
    </table></div>`;
  return `<section class="qs-block qs-detail" id="qs-detail" aria-labelledby="qs-h-detail">
    <div class="qs-detail-head">
      <div>
        <h3 id="qs-h-detail">${esc(q.prompt)}</h3>
        <p class="small muted">${esc(TYPE_LABEL[q.type] || q.type)} · ${esc(DIFF_LABEL[q.difficulty] || q.difficulty)} · ${n(q.reward)} Paillettes · ${plur(q.answers, 'réponse', 'réponses')} · ${pctTxt(q.correct, corrigees)} de réussite</p>
      </div>
      <button class="btn" type="button" data-act="fermer">Fermer le détail</button>
    </div>
    ${corps}
  </section>`;
}

/** Classement des membres : réponses, bonnes réponses, taux et Paillettes. */
function joueursHtml() {
  const j = Q.stats.players || [];
  const corps = j.length
    ? `<div class="qs-scroll"><table class="qs-table">
        <caption class="qs-sr">Classement des membres</caption>
        <thead><tr><th scope="col" class="num">Rang</th><th scope="col">Membre</th><th scope="col" class="num">Réponses</th><th scope="col" class="num">Bonnes</th><th scope="col" class="num">Réussite</th><th scope="col" class="num">Paillettes</th></tr></thead>
        <tbody>${j.map((p, i) => `<tr>
          <td class="num">${i + 1}</td>
          <th scope="row">${esc(p.pseudo || 'Membre inconnu')}</th>
          <td class="num">${n(p.answers)}</td>
          <td class="num">${n(p.correct)}</td>
          <td class="num">${pctTxt(p.correct, p.answers)}</td>
          <td class="num">${n(p.paillettes)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="small muted">La réussite compte aussi les réponses encore en attente de validation.</p>`
    : '<p class="qs-empty">Aucun membre n’a encore répondu.</p>';
  return `<section class="qs-block" aria-labelledby="qs-h-joueurs">
    <h3 id="qs-h-joueurs">Classement des membres</h3>
    ${corps}
  </section>`;
}

/* ---------- Actions ---------- */
/**
 * Valide une réponse libre (hg_quiz_validate). La réponse sort de la liste tout de suite, puis les chiffres sont rechargés.
 * @param {number} id Identifiant de la réponse (bigint).
 * @param {boolean} juste true = juste (la récompense est versée), false = fausse.
 * @returns {Promise<void>}
 */
async function valider(id, juste) {
  if (Q.busy) return;
  Q.busy = true;
  Q.pendingError = '';
  render();
  let r;
  try { r = await sb.rpc('hg_quiz_validate', { p_answer: id, p_correct: juste }); }
  catch (e) { r = { error: e }; }
  Q.busy = false;
  if (r.error) {
    Q.pendingError = 'Impossible de valider cette réponse : ' + errMsg(r.error);
    toast(Q.pendingError, 'error');
    render();
    return;
  }
  const gain = Number(r.data?.reward) || 0;
  toast(juste ? `Réponse juste : ${n(gain)} Paillettes versées.` : 'Réponse marquée fausse.', '');
  // Mise à jour immédiate : la réponse quitte la liste et les compteurs suivent, avant le rechargement complet.
  Q.pending = Q.pending.filter((x) => Number(x.id) !== id);
  if (Q.stats) {
    const s = Q.stats.summary;
    s.pending = Math.max(0, s.pending - 1);
    if (juste) { s.correct += 1; s.paillettes += gain; } else s.wrong += 1;
  }
  render();
  await charger();
  render();
}

/**
 * Exporte toutes les réponses (500 au plus, les plus récentes) dans un fichier CSV téléchargé.
 * Le fichier commence par un BOM UTF-8 pour qu'Excel lise bien les accents.
 * @returns {Promise<void>}
 */
async function exporter() {
  if (Q.busy) return;
  Q.busy = true;
  render();
  let r;
  try { r = await sb.rpc('hg_quiz_answers_list', { p_question: null, p_pending_only: false }); }
  catch (e) { r = { error: e }; }
  Q.busy = false;
  if (r.error) { toast('Export impossible : ' + errMsg(r.error), 'error'); render(); return; }
  const lignes = (r.data || []).map((x) => {
    const q = questionDe(x.question_id);
    return [x.id, x.prompt, TYPE_LABEL[x.qtype] || x.qtype, DIFF_LABEL[x.difficulty] || x.difficulty, x.pseudo || 'Membre inconnu',
      reponseTxt(q, x.response), resultat(x), x.reward ?? 0, dateCsv(x.answered_at), dateCsv(x.reviewed_at)];
  });
  const csv = [CSV_ENTETE, ...lignes].map((l) => l.map(cellCsv).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `questions-du-gang-reponses-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`${plur(lignes.length, 'réponse exportée', 'réponses exportées')}.`, '');
  render();
}

/**
 * Met une valeur dans une cellule CSV : guillemets si besoin, et neutralise les formules (=, +, -, @) que les membres
 * pourraient glisser dans leur réponse.
 * @param {unknown} v Valeur brute.
 * @returns {string} Cellule prête à écrire.
 */
function cellCsv(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Gestion des clics dans l'onglet (délégation sur le conteneur).
 * @param {MouseEvent} e Clic.
 */
function onClick(e) {
  const el = e.target.closest('button');
  if (!el || !Q.root?.contains(el) || el.disabled) return;
  const d = el.dataset;
  if (d.act === 'refresh') { actualiser(); return; }
  if (d.act === 'export') { exporter(); return; }
  if (d.act === 'valider') { valider(Number(d.answer), d.juste === '1'); return; }
  if (d.act === 'fermer') {
    Q.retour = Q.open ? `[data-q="${Q.open}"]` : '';
    Q.open = null; Q.detail = null; Q.detailError = '';
    render();
    return;
  }
  if (d.sort) {
    const key = d.sort;
    if (Q.sort.key === key) Q.sort.dir = -Q.sort.dir;
    else Q.sort = { key, dir: key === 'prompt' || key === 'difficulty' ? 1 : -1 };
    render();
    return;
  }
  if (d.q) {
    if (Q.open === d.q) { Q.retour = `[data-q="${d.q}"]`; Q.open = null; Q.detail = null; render(); return; }
    Q.open = d.q; Q.detail = null; Q.detailError = '';
    render();
    Q.root.querySelector('#qs-detail')?.scrollIntoView({ block: 'nearest' });
    chargerDetail(d.q);
  }
}

/** Recharge le résumé et les réponses en attente (bouton « Actualiser »). */
async function actualiser() {
  if (Q.busy) return;
  Q.busy = true;
  render();
  await charger();
  Q.busy = false;
  render();
  if (Q.open) chargerDetail(Q.open);
}

/* ---------- Montage ---------- */
/**
 * Affiche l'onglet « Réponses et statistiques » dans le conteneur, puis charge les données.
 * Rappelée sur le même conteneur, elle recharge tout (les états d'affichage, comme le tri, sont gardés).
 * @param {HTMLElement} container Élément vide qui recevra l'onglet.
 * @returns {Promise<void>} Résolue une fois l'affichage fait (les erreurs sont affichées, la fonction ne lève pas).
 */
export async function mountQuizStats(container) {
  if (!container) return;
  Q.root = container;
  container.onclick = onClick;
  render();
  await charger();
  render();
}
