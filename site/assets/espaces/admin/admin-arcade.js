// ===== Humane Gang — administration : Arcade, jeux des pages 404 (Autres jeux › Arcade) =====
/*
 * Rôle : suivre les trois mini-jeux des pages 404 (Paillettes, Raclette, Domu-mobile) semaine par semaine : pour chaque
 * jeu, parties jouées et Paillettes versées, règles anti-triche en lecture seule, et classement des dix meilleurs scores
 * avec un bouton « Effacer ce score » (confirmation dans la page, journalisée côté serveur).
 * La récompense d’une partie est le réglage « arcade » des secrets (hg_settings.eggs.recompenses.arcade) : elle est
 * affichée ici et modifiée dans Autres jeux › Secrets (lien), sans second formulaire.
 * Droit : « reglages » (administrateur ou Staff « reglages »). La section n’est montée que si ce droit est accordé.
 * Route : #fete/arcade (branchée par admin.js). Section : <section id="arcade">, conteneur #arcade-root.
 * RPC : hg_arcade_admin_board(p_week) (lecture de la semaine, lundi par défaut à Zurich), hg_arcade_admin_clear(p_user,
 *   p_game, p_week) (efface le meilleur score d’un membre pour la semaine). Aucune écriture directe dans les tables.
 * Dépendances : core.js (sb, toast, errMsg, esc), ui-confirm.js (boîte de confirmation).
 * Exporte : mountArcadeSection.
 */
import { sb, toast, errMsg, esc } from '../../commun/core.js';
import { confirmBox } from '../../commun/ui-confirm.js';

/* ---------- Constantes et dates ---------- */

const ZONE = 'Europe/Zurich';
/** Date d’un classement : heure suisse. */
const atFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: ZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** Nombre de parties et points : séparateurs français. */
const nb = (n) => Number(n ?? 0).toLocaleString('fr-CH');

/**
 * Ajoute n jours à une date AAAA-MM-JJ (calcul en UTC, sans décalage d’heure).
 * @param {string} iso Date AAAA-MM-JJ.
 * @param {number} n Nombre de jours (négatif pour reculer).
 * @returns {string} Date AAAA-MM-JJ.
 */
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Libellé d’une semaine (lundi AAAA-MM-JJ) : « Semaine du 20 octobre au 26 octobre 2026 ».
 * @param {string} lundi Date du lundi.
 * @returns {string}
 */
function libelleSemaine(lundi) {
  const fin = addDays(lundi, 6);
  const f = (iso, opts) => new Intl.DateTimeFormat('fr-CH', { timeZone: 'UTC', ...opts }).format(new Date(`${iso}T12:00:00Z`));
  return `Semaine du ${f(lundi, { day: 'numeric', month: 'long' })} au ${f(fin, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/* ---------- État ---------- */

// week : semaine choisie (null = semaine en cours) ; current : lundi de la semaine en cours (renvoyé par la base) ;
// board : réponse de hg_arcade_admin_board ; error : message de lecture.
const A = { root: null, week: null, current: null, board: null, error: null };

/* ---------- Montage ---------- */

/**
 * Monte la section Arcade dans son conteneur et lit la semaine en cours.
 * @param {HTMLElement} root Conteneur (#arcade-root).
 * @returns {Promise<void>}
 */
export async function mountArcadeSection(root) {
  if (!root) return;
  A.root = root; A.week = null; A.current = null; A.board = null; A.error = null;
  if (!root.dataset.arcBound) {
    root.dataset.arcBound = '1';
    root.addEventListener('click', onClick);
  }
  root.innerHTML = '<div class="empty">Chargement de l’arcade…</div>';
  await load();
}

/**
 * Lit la semaine choisie (ou la semaine en cours) puis redessine.
 * @param {string} [focus] Sélecteur de l’élément à reprendre au clavier après le rendu.
 * @returns {Promise<void>}
 */
async function load(focus) {
  A.root.setAttribute('aria-busy', 'true');
  const { data, error } = await sb.rpc('hg_arcade_admin_board', { p_week: A.week });
  A.root.removeAttribute('aria-busy');
  if (error) { A.board = null; A.error = errMsg(error); }
  else { A.board = data; A.error = null; if (!A.current) A.current = data.week; }
  render(focus);
}

/* ---------- Affichage ---------- */

/** Les règles anti-triche d’un jeu (lecture seule) : trois valeurs et une phrase d’explication. */
function rulesHtml(rules) {
  return `<div class="arc-rules">
    <p class="arc-sub">Règles anti-triche <span class="small muted">(fixées dans la base, lecture seule)</span></p>
    <dl>
      <div><dt>Score maximum</dt><dd>${nb(rules.max)}</dd></div>
      <div><dt>Points par seconde, au plus</dt><dd>${nb(rules.rate)}</dd></div>
      <div><dt>Durée minimale pour être payé</dt><dd>${nb(rules.min_s)} s</dd></div>
    </dl>
    <p class="small muted">Un score au-dessus du maximum, ou gagné plus vite que le rythme permis, est refusé et ne compte pas. Une partie plus courte que la durée minimale ne rapporte aucune Paillette.</p>
  </div>`;
}

/** Le classement de la semaine d’un jeu : dix lignes au plus, un bouton « Effacer ce score » par ligne. */
function topHtml(g, titre) {
  if (!g.top?.length) return '<p class="arc-empty small muted">Aucun score cette semaine.</p>';
  const rows = g.top.map((t, i) => {
    const pseudo = t.pseudo || 'Ancien membre';
    return `<li class="arc-row">
      <span class="arc-rank" aria-hidden="true">${i + 1}</span>
      <span class="arc-who"><strong>${esc(pseudo)}</strong> <span class="small muted">${nb(t.best)} points · ${esc(t.at ? atFmt.format(new Date(t.at)) : '')}</span></span>
      <button class="btn btn-ghost btn-sm arc-clear" type="button" data-arc="clear" data-user="${esc(t.user_id)}" data-game="${esc(g.game)}"
        aria-label="Effacer le score de ${esc(pseudo)} à ${esc(titre)} pour cette semaine">Effacer ce score</button>
    </li>`;
  }).join('');
  return `<ol class="arc-top" aria-label="Classement de la semaine">${rows}</ol>`;
}

/** Une carte par mini-jeu : nom, parties et Paillettes de la semaine, règles, classement. */
function gameHtml(g) {
  const titre = g.rules?.titre || g.game;
  return `<section class="arc-game card" data-game="${esc(g.game)}" aria-labelledby="arc-h-${esc(g.game)}">
    <div class="arc-game-head">
      <h3 class="card-title" id="arc-h-${esc(g.game)}" tabindex="-1">${esc(titre)}</h3>
    </div>
    <dl class="arc-stats">
      <div><dt>Parties jouées</dt><dd>${nb(g.runs)}</dd></div>
      <div><dt>Paillettes versées</dt><dd>${nb(g.paid)}</dd></div>
    </dl>
    ${rulesHtml(g.rules || {})}
    <div class="arc-board">
      <h4 class="arc-sub">Classement de la semaine</h4>
      ${topHtml(g, titre)}
    </div>
  </section>`;
}

/** Barre de semaines : précédente, suivante, retour à la semaine en cours. */
function weekNavHtml(lundi, enCours) {
  return `<div class="arc-weeknav" role="group" aria-label="Choisir la semaine">
    <button class="arc-navb" type="button" data-arc="prev" aria-label="Semaine précédente">&#8249;</button>
    <p class="arc-week" aria-live="polite"><strong>${esc(libelleSemaine(lundi))}</strong>${enCours ? ' <span class="arc-tag">Cette semaine</span>' : ''}</p>
    <button class="arc-navb" type="button" data-arc="next" aria-label="Semaine suivante"${enCours ? ' disabled' : ''}>&#8250;</button>
    ${enCours ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-arc="today">Cette semaine</button>'}
  </div>`;
}

/**
 * Dessine la section. focus : sélecteur à reprendre (ex. le bouton de semaine suivante) après un rendu.
 * @param {string} [focus]
 */
function render(focus) {
  if (A.error) {
    A.root.innerHTML = `<div class="arc"><div class="empty">Arcade indisponible : ${esc(A.error)}</div>
      <p><button class="btn btn-ghost" type="button" data-arc="retry">Réessayer</button></p></div>`;
    return;
  }
  const b = A.board;
  const enCours = A.week === null || A.week >= A.current;
  A.root.innerHTML = `<div class="arc">
    <div class="arc-top-bar">
      ${weekNavHtml(b.week, enCours)}
    </div>
    <div class="arc-reward card">
      <p><strong>Récompense d’une partie :</strong> ${nb(b.reward)} Paillettes, une fois par jour et par membre.
        Ce montant se règle dans les secrets.</p>
      <a class="btn btn-ghost" href="#fete/secrets">Modifier dans Secrets</a>
    </div>
    <p class="small muted arc-intro">Le mini-jeu du jour est le même pour tout le gang. Chaque mini-jeu a son classement de la semaine.</p>
    <div class="arc-games">${b.games.map(gameHtml).join('')}</div>
  </div>`;
  if (focus) A.root.querySelector(focus)?.focus();
}

/* ---------- Actions ---------- */

/**
 * Délégation des clics de la section : semaines, nouvel essai, effacement d’un score.
 * @param {MouseEvent} e
 */
function onClick(e) {
  const btn = e.target.closest('[data-arc]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.arc;
  if (act === 'prev') { A.week = addDays(A.week ?? A.current, -7); load('[data-arc="prev"]'); }
  else if (act === 'next') {
    const suivante = addDays(A.week ?? A.current, 7);
    A.week = suivante >= A.current ? null : suivante;
    load(A.week === null ? '[data-arc="prev"]' : '[data-arc="next"]');
  }
  else if (act === 'today') { A.week = null; load('[data-arc="prev"]'); }
  else if (act === 'retry') { A.error = null; load(); }
  else if (act === 'clear') clearScore(btn);
}

/**
 * Efface le meilleur score d’un membre pour la semaine affichée, après confirmation dans la page.
 * @param {HTMLButtonElement} btn Bouton « Effacer ce score » de la ligne.
 */
async function clearScore(btn) {
  const { user: userId, game } = btn.dataset;
  const g = A.board.games.find((x) => x.game === game);
  const row = g?.top.find((t) => t.user_id === userId);
  const titre = g?.rules?.titre || game;
  const pseudo = row?.pseudo || 'Ancien membre';
  const ok = await confirmBox('Effacer ce score ?',
    `Le meilleur score de ${pseudo} à ${titre} (${nb(row?.best)} points) sera retiré du classement de la ${libelleSemaine(A.board.week).toLowerCase()}. L’action est journalisée.`,
    { ok: 'Effacer ce score', danger: true });
  if (!ok) { btn.focus(); return; }
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  const { error } = await sb.rpc('hg_arcade_admin_clear', { p_user: userId, p_game: game, p_week: A.board.week });
  if (error) {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    toast(`Score non effacé : ${errMsg(error)}`, 'error');
    btn.focus();
    return;
  }
  toast(`Score de ${pseudo} effacé.`, 'ok');
  // Reprise du focus sur le titre du jeu : la ligne effacée n’existe plus.
  await load(`#arc-h-${CSS.escape(game)}`);
}
