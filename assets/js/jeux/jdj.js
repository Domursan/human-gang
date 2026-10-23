// ===== Humane Gang — Jeux › Classement des jeux du jour (idée J2) =====
/*
 * Rôle : le membre colle le texte de partage de son jeu du matin (Worldle, Sutom, Framed, Cémantix, Pédantix,
 * Heardle, LoLdle). Aperçu immédiat (jeu, grille, score), puis enregistrement : le serveur relit le texte et paie
 * quelques Paillettes (3 jeux par jour au plus). Classement du jour par jeu, série de jours et classement de la semaine.
 * La solution du jour n'est jamais affichée : seulement le score et une rangée de cases neutres.
 * Onglet : jeux.html#jdj. Contrat : mount(panel, ctx).
 * Dépendances : jeux/jdj-parse.js (aperçu), jeux/commun.js, core.js (errMsg).
 * Données : RPC hg_daily_submit, hg_daily_board, hg_daily_week (migration 083).
 */
import { errMsg } from '../core.js';
import { JEUX, parse, scoreTexte } from './jdj-parse.js';
import { chargerCss, nf, classementHtml, jourLong } from './commun.js';

/* ---------- État ---------- */
// panel, ctx ; board : réponse de hg_daily_board ; week : lignes de hg_daily_week ; jeu : jeu affiché au classement
// du jour ; busy : envoi en cours.
let J = null;
const q = (sel) => J.panel.querySelector(sel);

/** Liste lisible des jeux pris en charge. */
const LISTE_JEUX = Object.values(JEUX).map((j) => j.nom).join(', ');
/** Icône de flamme (série). */
const FLAMME = '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 0 2 1 3 2 3 0-3 1-6 1-8z" fill="currentColor"/></svg>';
/** Coche (jeu reconnu). */
const COCHE = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" stroke="currentColor" stroke-width="3" fill="none"/></svg>';

/* ---------- Montage ---------- */
/**
 * Monte l'onglet « Jeux du jour ».
 * @param {HTMLElement} panel Panneau vide de l'onglet.
 * @param {{sb: object, me: object, toast: Function, esc: Function}} ctx Contexte de la page.
 */
export async function mount(panel, ctx) {
  chargerCss('jdj');
  J = { panel, ctx, board: null, week: [], jeu: null, busy: false };
  panel.innerHTML = `<div class="jg jdj">
    <header>
      <h2 class="jg-title">Jeux du jour</h2>
      <p class="small muted jg-sub">Colle le texte de partage de ton jeu du matin : le site s’occupe du classement.</p>
    </header>
    <div class="jg-grid2">
      <div class="jg-col">
        <section class="jg-card jdj-paste" aria-labelledby="jdj-raw-l">
          <label class="jdj-label" id="jdj-raw-l" for="jdj-raw">Coller mon résultat</label>
          <textarea id="jdj-raw" class="jdj-raw" rows="5" maxlength="600" spellcheck="false" autocomplete="off"
            aria-describedby="jdj-preview" placeholder="#Worldle #1312 2/6 (100%)"></textarea>
          <div class="jdj-preview" id="jdj-preview" role="status" aria-live="polite"></div>
          <button class="btn btn-primary jdj-save" type="button" id="jdj-save" disabled>Enregistrer</button>
        </section>
        <section class="jg-card jdj-day" aria-labelledby="jdj-day-h">
          <div class="jg-between">
            <h3 class="jg-h3" id="jdj-day-h">Classement du jour</h3>
            <span class="small muted" id="jdj-day-date"></span>
          </div>
          <div class="jg-chips jdj-chips" id="jdj-chips" role="group" aria-label="Jeu du classement"></div>
          <div id="jdj-day-list" aria-live="polite"><p class="jg-empty-row">Chargement…</p></div>
        </section>
      </div>
      <div class="jg-col">
        <section class="jg-card jdj-streak" aria-label="Ta série et ton rang">
          <div class="jg-row"><span class="jdj-flame">${FLAMME}</span>
            <div><div class="jg-display jdj-big" id="jdj-streak">—</div><div class="small muted">ta série de jeux du matin</div></div></div>
          <div class="jdj-rank"><div class="jg-display jdj-big" id="jdj-rank">—</div><div class="small muted">de la semaine</div></div>
        </section>
        <section class="jg-card" aria-labelledby="jdj-week-h">
          <h3 class="jg-h3" id="jdj-week-h">Classement de la semaine</h3>
          <div id="jdj-week" aria-live="polite"><p class="jg-empty-row">Chargement…</p></div>
        </section>
        <p class="small muted jdj-rules" id="jdj-rules">Jeux pris en charge : ${LISTE_JEUX}. Un résultat par jeu et par jour, déclaré sur l’honneur ; la grille d’hier est acceptée jusqu’à midi. Points de la semaine : 6 pour une réussite du premier coup, puis 5, 4… et 0 pour une grille ratée.</p>
      </div>
    </div>
  </div>`;
  const raw = q('#jdj-raw');
  raw.addEventListener('input', apercu);
  raw.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); envoyer(); } });
  q('#jdj-save').addEventListener('click', envoyer);
  q('#jdj-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jeu]');
    if (!b) return;
    J.jeu = b.dataset.jeu;
    rendreJour();
  });
  await charger();
}

/* ---------- Chargement ---------- */
/** Lit le classement du jour et celui de la semaine. */
async function charger() {
  const { sb, toast, esc } = J.ctx;
  const [b, w] = await Promise.all([sb.rpc('hg_daily_board'), sb.rpc('hg_daily_week')]);
  if (!J) return;
  if (b.error) {
    q('#jdj-day-list').innerHTML = `<p class="jg-empty-row">Classement indisponible : ${esc(errMsg(b.error))}</p>`;
    toast(`Jeux du jour : ${errMsg(b.error)}`, 'error');
  } else J.board = b.data || {};
  J.week = w.error ? [] : (w.data?.rows || []);
  if (w.error) q('#jdj-week').innerHTML = `<p class="jg-empty-row">Classement indisponible : ${esc(errMsg(w.error))}</p>`;
  rendreJour();
  if (!w.error) rendreSemaine();
  rendreSerie();
  apercu();
}

/* ---------- Aperçu du texte collé ---------- */
/** Met à jour l'aperçu (jeu reconnu, score, gain prévu) et l'état du bouton. */
function apercu() {
  if (!J) return;
  const { esc } = J.ctx;
  const t = q('#jdj-raw').value;
  const box = q('#jdj-preview');
  const btn = q('#jdj-save');
  if (!t.trim()) { box.innerHTML = ''; btn.disabled = true; return; }
  const r = parse(t);
  if (!r) {
    box.innerHTML = `<p class="jdj-ko"><strong>Format non reconnu.</strong> Jeux pris en charge : ${esc(LISTE_JEUX)}.
      Un format a changé ? <a href="assistance.html">Signale-le</a>.</p>`;
    btn.disabled = true;
    return;
  }
  const b = J.board || {};
  const nom = JEUX[r.game]?.nom || r.game;
  const actif = !Array.isArray(b.actifs) || b.actifs.includes(r.game);
  const deja = (b.mine || []).some((m) => m.game === r.game);
  const grille = r.grid != null ? ` n°${r.grid}` : ''; // numéro de grille : sans séparateur de milliers
  let note;
  if (!actif) note = 'Ce jeu n’est pas ouvert sur le site pour le moment.';
  else if (deja) note = 'Tu as déjà déclaré ce jeu aujourd’hui.';
  else if (b.paillettes === false) note = 'Classement seulement, sans Paillettes pour l’instant.';
  else if ((b.payes ?? 0) < (b.plafond ?? 3)) note = `+${nf(b.gain ?? 5)} Paillettes (${nf((b.payes ?? 0) + 1)} sur ${nf(b.plafond ?? 3)} aujourd’hui)`;
  else note = `Plafond du jour atteint (${nf(b.plafond ?? 3)} jeux payés) : il compte quand même pour le classement.`;
  box.innerHTML = `<div class="jg-row"><span class="pill pill-ok">${COCHE}Reconnu : ${esc(nom)}${esc(grille)} · ${esc(scoreTexte(r))}</span>
    <span class="small muted">${esc(note)}</span></div>`;
  btn.disabled = !actif || deja || J.busy;
}

/* ---------- Envoi ---------- */
/** Enregistre le résultat collé (le serveur relit le texte). */
async function envoyer() {
  const btn = q('#jdj-save');
  if (btn.disabled || J.busy) return;
  const { sb, toast } = J.ctx;
  J.busy = true; btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  const { data, error } = await sb.rpc('hg_daily_submit', { p_raw: q('#jdj-raw').value });
  if (!J) return;
  J.busy = false; btn.removeAttribute('aria-busy');
  if (error) { toast(errMsg(error), 'error'); apercu(); return; }
  const nom = JEUX[data.game]?.nom || data.game;
  toast(data.reward > 0 ? `${nom} enregistré : +${nf(data.reward)} Paillettes` : `${nom} enregistré`, data.reward > 0 ? 'success' : 'ok');
  q('#jdj-raw').value = '';
  J.jeu = data.game;
  await charger();
  q('#jdj-raw').focus();
}

/* ---------- Classement du jour ---------- */
/**
 * Rangée de cases neutres qui reproduit la forme de la grille (essais ratés, réussite, cases restantes),
 * sans jamais montrer la solution. Rien pour les jeux à nombre de coups.
 * @param {{score: number, max: number|null}} r Résultat.
 * @returns {string} HTML (décoratif : le score est écrit à côté).
 */
function casesHtml(r) {
  if (!r.max) return '';
  const s = Number(r.score) || 0;
  let h = '';
  for (let i = 1; i <= r.max; i++) {
    const k = s === 0 ? 'rate' : i < s ? 'essai' : i === s ? 'ok' : 'vide';
    h += `<span class="jdj-cell is-${k}"></span>`;
  }
  return `<span class="jdj-cells" aria-hidden="true">${h}</span>`;
}

/** Affiche les boutons de jeux et le classement du jeu choisi. */
function rendreJour() {
  if (!J?.board) return;
  const { esc, me } = J.ctx;
  const b = J.board;
  q('#jdj-day-date').textContent = jourLong(b.day);
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const jeux = [...new Set(rows.map((r) => r.game))];
  // Jeu affiché par défaut : mon dernier jeu déclaré, sinon le plus joué du jour
  if (!J.jeu || !jeux.includes(J.jeu)) {
    const mien = (b.mine || []).map((m) => m.game).filter((g) => jeux.includes(g)).pop();
    J.jeu = mien || jeux.slice().sort((x, y) => rows.filter((r) => r.game === y).length - rows.filter((r) => r.game === x).length)[0] || null;
  }
  q('#jdj-chips').innerHTML = jeux.map((g) => `<button type="button" data-jeu="${esc(g)}" aria-pressed="${g === J.jeu}">${esc(JEUX[g]?.nom || g)}</button>`).join('');
  q('#jdj-chips').hidden = jeux.length < 2;
  const list = rows.filter((r) => r.game === J.jeu);
  let rang = 0;
  const avecRang = list.map((r, i) => {
    if (r.points > 0) rang = i === 0 || list[i - 1].points !== r.points || list[i - 1].score !== r.score ? i + 1 : rang;
    return { ...r, rank: r.points > 0 ? rang : '–' };
  });
  q('#jdj-day-list').innerHTML = classementHtml(avecRang, {
    me: me?.id, label: `Classement du jour : ${JEUX[J.jeu]?.nom || ''}`,
    vide: 'Personne n’a encore déclaré de jeu aujourd’hui. Colle le tien !',
    droite: (r) => `${casesHtml(r)}<span class="jg-score jdj-score">${esc(scoreTexte(r))}</span>`,
  });
}

/* ---------- Semaine et série ---------- */
/** Classement de la semaine (points). */
function rendreSemaine() {
  const { me } = J.ctx;
  q('#jdj-week').innerHTML = classementHtml(J.week, {
    me: me?.id, label: 'Classement de la semaine', vide: 'Personne n’a encore joué cette semaine.',
    droite: (r) => `<span class="small muted">${nf(r.jeux)} jeu${r.jeux > 1 ? 'x' : ''}</span><span class="jg-score">${nf(r.points)} pt${r.points > 1 ? 's' : ''}</span>`,
  });
}

/** Ma série de jours et mon rang de la semaine. */
function rendreSerie() {
  const { me } = J.ctx;
  const n = Number(J.board?.streak) || 0;
  q('#jdj-streak').textContent = `${nf(n)} jour${n > 1 ? 's' : ''}`;
  const mine = J.week.find((r) => r.user_id === me?.id);
  q('#jdj-rank').textContent = mine ? `${mine.rank}${mine.rank === 1 ? 'er' : 'e'}` : '—';
}

/* ---------- Résumé pour l'onglet « Aujourd'hui » ---------- */
/**
 * Jeux du matin déclarés aujourd'hui, gains et série, pour le tableau de bord.
 * @param {{sb: object}} ctx Contexte de la page.
 * @returns {Promise<{etat: string, texte: string, badge: string, gain: number, serie: number}>}
 */
export async function resume({ sb }) {
  const { data, error } = await sb.rpc('hg_daily_board');
  if (error) throw error;
  const mine = Array.isArray(data?.mine) ? data.mine : [];
  const gain = mine.reduce((t, m) => t + (Number(m.reward) || 0), 0);
  const serie = Number(data?.streak) || 0;
  if (!mine.length) return { etat: 'a_jouer', texte: 'Colle ton Worldle, ton Sutom…', badge: 'À coller', gain, serie };
  const txt = mine.map((m) => `${JEUX[m.game]?.nom || m.game} ${scoreTexte(m)}`).join(' · ');
  return { etat: 'fait', texte: txt, badge: mine.length > 1 ? `${mine.length} jeux` : 'Fait', gain, serie };
}
