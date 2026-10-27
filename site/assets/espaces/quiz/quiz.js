// ===== Humane Gang — Questions du gang (quiz.html) =====
// Les membres répondent aux questions créées par l'admin ; une bonne réponse rapporte des Paillettes, créditées par le serveur.
// RPC : hg_quiz_list (questions ouvertes et répondues), hg_quiz_answer (une seule tentative par question).
// Filtre par difficulté, historique repliable, explication et bonne réponse affichées après la réponse.
// Tout texte venant de la base passe par esc(). Le fichier n'exporte rien.
/*
 * Rôle : affiche le résumé (questions ouvertes, bonnes réponses, Paillettes gagnées), les questions ouvertes
 * selon leur type (choix, cases, texte, nombre), et l'historique des réponses déjà données.
 * Page : quiz.html (session membre requise).
 * Dépendances : core.js (initPage, sb, esc, $, errMsg).
 * Données : RPC hg_quiz_list et hg_quiz_answer ; dates affichées à l'heure de Zurich.
 */
import { sb, initPage, esc, $, errMsg } from './core.js';

/* ---------- Initialisation : session membre requise ---------- */
await initPage();

/* ---------- Constantes et outils ---------- */
const app = $('#app');
const nf = new Intl.NumberFormat('fr-CH');
// Libellé et nombre d'étoiles de chaque difficulté : le texte porte l'information, la couleur ne fait que renforcer.
const DIFF = { facile: { label: 'Facile', stars: 1 }, moyen: { label: 'Moyen', stars: 2 }, difficile: { label: 'Difficile', stars: 3 }, expert: { label: 'Expert', stars: 4 } };
const FILTRES = [['tous', 'Tous'], ['facile', 'Facile'], ['moyen', 'Moyen'], ['difficile', 'Difficile'], ['expert', 'Expert']];
// Date de fin et date de réponse : toujours à l'heure de Zurich, quel que soit le fuseau de l'appareil.
const FUSEAU = 'Europe/Zurich';
const dateFin = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: FUSEAU });
const dateReponse = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: FUSEAU });
// Nombre accepté : entier ou décimal, virgule ou point.
const NOMBRE = /^-?\d+([.,]\d+)?$/;

// État de la page : questions reçues, filtre de difficulté, envoi en cours, erreur de chargement.
const S = { list: [], filtre: 'tous', busy: false, erreur: false };

/** Paillettes en texte, avec séparateurs à la suisse. */
const pts = (n) => nf.format(Number(n) || 0);
/** Récompense affichée : « +100 ✦ ». */
const plus = (n) => `+${pts(n)} ✦`;

/**
 * Pastille de difficulté : étoiles et libellé (la couleur seule ne suffit pas).
 * @param {string} d Difficulté : facile, moyen, difficile ou expert.
 * @returns {string} Fragment HTML.
 */
function diffHtml(d) {
  const k = DIFF[d] ? d : 'moyen';
  const { label, stars } = DIFF[k];
  return `<span class="quiz-diff quiz-diff-${k}"><span class="quiz-stars" aria-hidden="true">${'★'.repeat(stars)}${'☆'.repeat(4 - stars)}</span><span>${label}</span></span>`;
}

/**
 * Texte d'un choix à partir de son identifiant.
 * @param {object} q Question (options : [{id, text}]).
 * @param {string} id Identifiant du choix.
 * @returns {string} Le texte du choix, ou l'identifiant si introuvable.
 */
function texteChoix(q, id) {
  return (q.options || []).find((o) => o.id === id)?.text ?? String(id);
}

/**
 * Réponse du membre, lisible : texte du choix, liste de choix, ou texte saisi.
 * @param {object} q Question.
 * @param {*} r Réponse enregistrée (identifiant, tableau d'identifiants ou texte).
 * @returns {string} Texte à afficher.
 */
function libelleReponse(q, r) {
  if (r == null || r === '') return '—';
  if (Array.isArray(r)) return r.map((id) => texteChoix(q, id)).join(', ');
  if (q.type === 'choix_unique' || q.type === 'vrai_faux') return texteChoix(q, r);
  return String(r);
}

/**
 * Bonne réponse, lisible : textes acceptés pour un texte, valeur pour un nombre, textes des choix sinon.
 * @param {object} q Question.
 * @param {*} sol Solution renvoyée par le serveur.
 * @returns {string} Texte à afficher, ou '' si aucune solution.
 */
function solutionTexte(q, sol) {
  if (sol == null) return '';
  if (q.type === 'texte') return (Array.isArray(sol) ? sol : [sol]).join(' ou ');
  if (q.type === 'nombre') return String(sol).replace('.', ',');
  return libelleReponse(q, Array.isArray(sol) ? sol : [sol]);
}

/**
 * Résultat affiché d'une réponse corrigée : bravo (avec les Paillettes), raté, ou en attente de l'admin.
 * @param {object} q Question répondue (correct : true, false ou null).
 * @returns {string} Pastille HTML.
 */
function resultatHtml(q) {
  if (q.correct === true) return `<span class="pill pill-ok quiz-result">Bravo${q.earned ? ` · ${plus(q.earned)}` : ''}</span>`;
  if (q.correct === false) return '<span class="pill quiz-result quiz-result-ko">Raté</span>';
  return '<span class="pill pill-current quiz-result">En attente de validation par l’admin</span>';
}

/**
 * Champs de réponse selon le type de question : boutons radio, cases à cocher, champ texte ou champ nombre.
 * @param {object} q Question.
 * @returns {string} Fragment HTML.
 */
function champs(q) {
  const nom = `q-${q.id}`;
  if (q.type === 'choix_unique' || q.type === 'vrai_faux' || q.type === 'choix_multiple') {
    const multi = q.type === 'choix_multiple';
    const indice = multi ? '<p class="small muted quiz-hint">Plusieurs réponses possibles : coche toutes les bonnes.</p>' : '';
    const options = (q.options || []).map((o) => `<label class="quiz-opt"><input type="${multi ? 'checkbox' : 'radio'}" name="${nom}" value="${esc(o.id)}"><span>${esc(o.text)}</span></label>`).join('');
    return `<fieldset class="quiz-choices"><legend>Ta réponse</legend>${indice}${options}</fieldset>`;
  }
  if (q.type === 'texte') {
    return `<div class="field"><label for="${nom}">Ta réponse</label><input id="${nom}" type="text" name="${nom}" maxlength="200" autocomplete="off"></div>`;
  }
  return `<div class="field"><label for="${nom}">Ta réponse (un nombre)</label><input id="${nom}" type="text" name="${nom}" inputmode="decimal" maxlength="20" autocomplete="off"><span class="small muted">La virgule est acceptée : 3,5 ou 3.5.</span></div>`;
}

/**
 * Carte d'une question ouverte, avec son formulaire de réponse.
 * @param {object} q Question non répondue.
 * @returns {string} HTML de la carte.
 */
function carteOuverte(q) {
  const cat = q.category ? `<span class="quiz-cat">${esc(q.category)}</span>` : '';
  const img = q.image_url ? `<img class="quiz-img" src="${esc(q.image_url)}" alt="Illustration de la question" loading="lazy" data-on-error="remove">` : '';
  const fin = q.ends_at ? `<p class="small muted quiz-end">Jusqu’au ${esc(dateFin.format(new Date(q.ends_at)))}</p>` : '';
  // Question bonus secrète : libellé visible (le texte porte l'information, pas seulement le cadre doré).
  const secrete = q.secret ? '<p class="quiz-secret-tag">Question secrète <span aria-hidden="true">🔍</span></p>' : '';
  return `<article class="quiz-card${q.secret ? ' is-secret' : ''}" aria-labelledby="qz-${esc(q.id)}">
    ${secrete}
    <header class="quiz-card-head">${diffHtml(q.difficulty)}${cat}<span class="quiz-reward">${plus(q.reward)}</span></header>
    <h3 class="quiz-prompt" id="qz-${esc(q.id)}">${esc(q.prompt)}</h3>
    ${img}${fin}
    <form class="quiz-form" data-id="${esc(q.id)}" novalidate>
      ${champs(q)}
      <div class="quiz-actions">
        <button class="btn btn-primary" type="submit">Valider ma réponse</button>
        <p class="small muted">Une seule réponse possible : tu ne pourras pas la modifier.</p>
      </div>
      <p class="quiz-error" role="alert" hidden></p>
    </form>
  </article>`;
}

/**
 * Carte d'une question déjà répondue : résultat, ta réponse, bonne réponse et explication.
 * @param {object} q Question répondue.
 * @returns {string} HTML de la carte.
 */
function carteRepondue(q) {
  const cat = q.category ? `<span class="quiz-cat">${esc(q.category)}</span>` : '';
  const sol = q.solution != null ? `<p class="small quiz-sol"><span class="muted">Bonne réponse :</span> ${esc(solutionTexte(q, q.solution))}</p>` : '';
  const expl = q.explanation ? `<p class="quiz-expl">${esc(q.explanation)}</p>` : '';
  const le = q.answered_at ? `<p class="small muted">Répondu le ${esc(dateReponse.format(new Date(q.answered_at)))}</p>` : '';
  return `<article class="quiz-card is-done">
    <header class="quiz-card-head">${diffHtml(q.difficulty)}${cat}${resultatHtml(q)}</header>
    <h3 class="quiz-prompt">${esc(q.prompt)}</h3>
    <p class="small"><span class="muted">Ta réponse :</span> ${esc(libelleReponse(q, q.my_response))}</p>
    ${sol}${expl}${le}
  </article>`;
}

/* ---------- Dessin ---------- */

/** Résumé : questions ouvertes, bonnes réponses, Paillettes gagnées (sur toutes les questions, sans filtre). */
function dessineResume() {
  const ouvertes = S.list.filter((q) => !q.answered).length;
  const bonnes = S.list.filter((q) => q.answered && q.correct === true).length;
  const gagnees = S.list.reduce((s, q) => s + (Number(q.earned) || 0), 0);
  const tuile = (n, l) => `<div class="quiz-tile"><span class="quiz-tile-n">${n}</span><span class="quiz-tile-l">${l}</span></div>`;
  $('#quiz-summary').innerHTML = tuile(pts(ouvertes), ouvertes > 1 ? 'questions ouvertes' : 'question ouverte')
    + tuile(pts(bonnes), bonnes > 1 ? 'bonnes réponses' : 'bonne réponse')
    + tuile(`${pts(gagnees)} ✦`, 'Paillettes gagnées');
}

/** Boutons de filtre par difficulté ; le bouton actif porte aria-pressed. */
function dessineFiltre() {
  $('#quiz-filter').innerHTML = FILTRES.map(([k, l]) =>
    `<button type="button" class="quiz-chip" data-diff="${k}" aria-pressed="${S.filtre === k}">${l}</button>`).join('');
}

/** Listes : questions ouvertes et historique, selon le filtre. */
function dessineListes() {
  const vis = S.list.filter((q) => S.filtre === 'tous' || q.difficulty === S.filtre);
  // Les questions secrètes passent en tête des ouvertes ; le reste garde l'ordre reçu du serveur.
  const ouvertes = vis.filter((q) => !q.answered).sort((a, b) => Number(!!b.secret) - Number(!!a.secret));
  const faites = vis.filter((q) => q.answered);
  const sansFiltre = S.filtre === 'tous';
  $('#quiz-open').innerHTML = ouvertes.length
    ? ouvertes.map(carteOuverte).join('')
    : `<p class="card quiz-empty">${sansFiltre ? 'Aucune question ouverte pour le moment.' : 'Aucune question ouverte de cette difficulté.'}</p>`;
  $('#quiz-done').innerHTML = faites.length
    ? faites.map(carteRepondue).join('')
    : `<p class="muted small">Pas encore de réponse${sansFiltre ? '' : ' dans cette difficulté'}.</p>`;
  $('#quiz-done-count').textContent = `(${faites.length})`;
}

/** Redessine tout (résumé, filtre, listes) sans toucher à l'historique ouvert ou fermé. */
function dessine() {
  dessineResume();
  dessineFiltre();
  dessineListes();
}

/**
 * Bandeau de résultat juste après une réponse : bravo et Paillettes, raté, ou en attente ; bonne réponse et explication.
 * @param {object} q Question qui vient d'être répondue.
 */
function bandeau(q) {
  const box = $('#quiz-feedback');
  let titre, genre;
  if (q.correct === true) { genre = 'ok'; titre = `Bravo ! ${q.earned ? plus(q.earned) : 'Bonne réponse.'}`; }
  else if (q.correct === false) { genre = 'ko'; titre = 'Raté, ce n’est pas la bonne réponse.'; }
  else { genre = 'attente'; titre = 'Ta réponse est enregistrée. Elle sera corrigée par l’admin.'; }
  const sol = q.solution != null ? `<p class="quiz-sol"><span class="muted">Bonne réponse :</span> ${esc(solutionTexte(q, q.solution))}</p>` : '';
  const expl = q.explanation ? `<p class="quiz-expl">${esc(q.explanation)}</p>` : '';
  box.className = `quiz-feedback is-${genre}`;
  box.innerHTML = `<p class="quiz-fb-title">${esc(titre)}</p>${sol}${expl}`;
  box.hidden = false;
  box.focus();
}

/* ---------- Réponse ---------- */

/**
 * Lit la réponse saisie dans le formulaire selon le type de question.
 * @param {object} q Question.
 * @param {HTMLFormElement} form Formulaire de la question.
 * @returns {{value?: *, error?: string}} La réponse à envoyer, ou le message d'erreur à afficher.
 */
function lireReponse(q, form) {
  if (q.type === 'choix_multiple') {
    const v = [...form.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value);
    return v.length ? { value: v } : { error: 'Coche au moins une réponse.' };
  }
  if (q.type === 'choix_unique' || q.type === 'vrai_faux') {
    const r = form.querySelector('input[type="radio"]:checked');
    return r ? { value: r.value } : { error: 'Choisis une réponse.' };
  }
  const v = form.querySelector('input[type="text"]').value.trim();
  if (!v) return { error: 'Écris une réponse.' };
  if (q.type === 'nombre' && !NOMBRE.test(v)) return { error: 'Écris un nombre, par exemple 42 ou 3,5.' };
  return { value: v };
}

/**
 * Envoie la réponse (hg_quiz_answer). Une seule tentative : la question passe ensuite dans l'historique.
 * En cas d'erreur, le message du serveur s'affiche sous le formulaire.
 * @param {SubmitEvent} e Événement de soumission d'un formulaire de question.
 */
async function repond(e) {
  e.preventDefault();
  const form = e.target;
  if (S.busy) return;
  const q = S.list.find((x) => x.id === form.dataset.id);
  if (!q || q.answered) return;
  const erreur = form.querySelector('.quiz-error');
  const echec = (m) => { erreur.textContent = m; erreur.hidden = false; };
  erreur.hidden = true;
  const lu = lireReponse(q, form);
  if (lu.error) return echec(lu.error);
  S.busy = true;
  form.querySelector('button[type="submit"]').disabled = true;
  try {
    const { data, error } = await sb.rpc('hg_quiz_answer', { p_question: q.id, p_response: lu.value });
    if (error) throw error;
    Object.assign(q, {
      answered: true, my_response: lu.value, correct: data?.correct ?? null, earned: data?.reward ?? 0,
      explanation: data?.explanation ?? null, solution: data?.solution ?? null, answered_at: new Date().toISOString(),
    });
    dessine();
    bandeau(q);
    $('#quiz-history').open = true; // la question répondue apparaît tout de suite dans l'historique
  } catch (x) {
    console.warn('[quiz]', x);
    echec(errMsg(x));
    form.querySelector('button[type="submit"]').disabled = false;
  } finally {
    S.busy = false;
  }
}

/* ---------- Chargement et écouteurs ---------- */

/** Charge les questions (hg_quiz_list) puis dessine la page. En cas d'erreur, la page le dit sans bloquer le reste. */
async function charge() {
  try {
    const { data, error } = await sb.rpc('hg_quiz_list');
    if (error) throw error;
    S.list = Array.isArray(data) ? data : [];
    S.erreur = false;
  } catch (e) {
    console.warn('[quiz]', e);
    S.erreur = true;
  }
  app.setAttribute('aria-busy', 'false');
  if (S.erreur) {
    $('#quiz-summary').innerHTML = '';
    $('#quiz-open').innerHTML = '<p class="card quiz-empty">Questions indisponibles pour le moment. Recharge la page dans un instant.</p>';
    $('#quiz-done').innerHTML = '';
    return;
  }
  dessine();
}

// Filtre par difficulté : seule la liste change, le focus reste sur le bouton choisi.
$('#quiz-filter').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-diff]');
  if (!b) return;
  S.filtre = b.dataset.diff;
  dessineFiltre();
  dessineListes();
});
// Soumission d'une question (délégation : les formulaires sont recréés à chaque dessin).
app.addEventListener('submit', (e) => { if (e.target.matches('.quiz-form')) repond(e); });

charge();
