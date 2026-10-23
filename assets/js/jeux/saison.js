// ===== Humane Gang — page Jeux, onglet « Saison » (idée J16 : saisons de classement) =====
/*
 * Rôle : classement trimestriel en points de saison (distincts des Paillettes) : compte à rebours, mon rang, mes points
 * de la semaine par catégorie (avec leurs plafonds hebdomadaires), palier atteignable par tous, top 10 général et
 * ligue des nouveaux (membres arrivés depuis moins d'un an).
 * Données : RPC hg_season_board (calcul côté serveur à partir des journaux déjà plafonnés ; migration 086).
 * Dépendances : ctx = { sb, me, toast, esc } fourni par jeux.js ; core/util.js (avatarHtml).
 * Exporte : mount(panel, ctx).
 */
import { avatarHtml } from '../core/util.js';

const nf = new Intl.NumberFormat('fr-CH');
/** Rang en toutes lettres courtes : 1er, 2e, 3e… */
const rangTxt = (n) => (Number(n) === 1 ? '1er' : `${n}e`);
/** Jours restants (arrondi supérieur) avant une date. */
const joursAvant = (d) => Math.max(0, Math.ceil((new Date(d) - Date.now()) / 864e5));

/** Charge la feuille de style de l'onglet une seule fois. */
function css() {
  if (document.querySelector('link[data-jeux-css="saison"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/jeux-saison.css', import.meta.url).href;
  l.dataset.jeuxCss = 'saison';
  document.head.append(l);
}

/**
 * Ligne de classement : rang, avatar, pseudo, pastille « 2e gen » pour un nouveau, points. La ligne du membre est marquée.
 * @param {object} r ligne { rank, user_id, pseudo, avatar_url, color, points, nouveau }
 * @param {string} meId identifiant du membre connecté
 * @param {Function} esc échappement HTML
 */
function ligne(r, meId, esc) {
  const moi = r.user_id === meId;
  return `<li class="ssn-row${moi ? ' is-me' : ''}"${moi ? ' aria-current="true"' : ''}>
    <span class="ssn-rank">${esc(String(r.rank))}</span>
    ${avatarHtml({ pseudo: r.pseudo, avatar_url: r.avatar_url, color: r.color }, 28)}
    <span class="ssn-name">${esc(r.pseudo)}${moi ? ' <span class="visually-hidden">(toi)</span>' : ''}</span>
    ${r.nouveau ? '<span class="pill ssn-gen">2e gen</span>' : ''}
    <span class="ssn-pts">${esc(nf.format(r.points))}</span>
  </li>`;
}

/**
 * Monte l'onglet dans son panneau.
 * @param {HTMLElement} panel section role="tabpanel" vide
 * @param {{sb: object, me: object, esc: Function}} ctx contexte de la page Jeux
 */
export async function mount(panel, ctx) {
  const { sb, me, esc } = ctx;
  css();
  panel.innerHTML = '<p class="card ssn-wait">Chargement de la saison…</p>';
  let B;
  try {
    const { data, error } = await sb.rpc('hg_season_board');
    if (error) throw error;
    B = data;
  } catch (e) {
    panel.innerHTML = `<p class="card">Impossible de charger la saison (${esc(e?.message || String(e))}).</p>`;
    return;
  }
  if (!B?.season) { panel.innerHTML = '<p class="card">Aucune saison en cours.</p>'; return; }

  const S = B.season, moi = B.me || null, cats = Array.isArray(B.cats) ? B.cats : [];
  const finie = new Date(S.ends_at) <= new Date();
  const jours = joursAvant(S.ends_at);
  const palier = Number(B.rewards?.palier_points) || 100;
  const sem = (moi && moi.week) || {};
  const semTotal = Object.values(sem).reduce((a, b) => a + (Number(b) || 0), 0);

  const rangHtml = moi
    ? `<section class="card ssn-me" aria-label="Mon rang">
        <div class="ssn-me-rank"><span class="ssn-big">${esc(rangTxt(moi.rank))}</span><span class="small muted">général</span></div>
        <div class="ssn-me-pts">
          <span class="ssn-mid">${esc(nf.format(moi.points))} pts</span>
          ${moi.nouveau && moi.rank_nouveaux ? `<span class="small ssn-nouveau">${esc(rangTxt(moi.rank_nouveaux))} de la ligue des nouveaux</span>` : ''}
          <span class="small muted">+${esc(nf.format(semTotal))} cette semaine</span>
        </div>
      </section>`
    : `<section class="card ssn-me" aria-label="Mon rang"><p class="muted">Pas encore de point cette saison : une bonne réponse au quiz, un jeu du jour ou une quête, et tu entres au classement.</p></section>`;

  const palierPct = moi ? Math.min(100, Math.round((moi.points / palier) * 100)) : 0;
  const palierHtml = `<div class="ssn-palier">
      <div class="ssn-cat-top small"><span>Palier de la saison</span><span><b>${esc(nf.format(Math.min(moi?.points || 0, palier)))}</b> <span class="muted">/ ${esc(nf.format(palier))} pts</span></span></div>
      <div class="progress ssn-bar${palierPct >= 100 ? ' is-full' : ''}" role="progressbar" aria-label="Palier de la saison" aria-valuemin="0" aria-valuemax="${palier}" aria-valuenow="${Math.min(moi?.points || 0, palier)}"><span style="width:${palierPct}%"></span></div>
      <p class="small muted">${palierPct >= 100 ? 'Palier atteint : ton bonus de fin de saison est assuré.' : `Atteins ${esc(nf.format(palier))} points pour recevoir le bonus de fin de saison (${esc(nf.format(B.rewards?.palier_gain ?? 0))} Paillettes).`}</p>
    </div>`;

  const catsHtml = cats.map((c) => {
    const v = Math.min(Number(sem[c.cat]) || 0, c.cap);
    const pct = c.cap > 0 ? Math.round((v / c.cap) * 100) : 0;
    return `<li class="ssn-cat">
      <div class="ssn-cat-top small"><span>${esc(c.label)}</span><span><b>${esc(String(v))}</b> <span class="muted">/ ${esc(String(c.cap))} cette semaine</span></span></div>
      <div class="progress ssn-bar${pct >= 100 ? ' is-full' : ''}" role="progressbar" aria-label="${esc(c.label)}" aria-valuemin="0" aria-valuemax="${c.cap}" aria-valuenow="${v}" aria-valuetext="${v} sur ${c.cap} points cette semaine"><span style="width:${pct}%"></span></div>
    </li>`;
  }).join('');

  const listes = { general: B.top || [], nouveaux: B.top_nouveaux || [] };
  panel.innerHTML = `
    <div class="ssn">
      <div class="ssn-head">
        <div><p class="small muted ssn-label">${esc(S.label)}</p><h2 class="ssn-title">Saison</h2></div>
        <span class="pill ${finie ? 'pill-todo' : 'pill-current'}">${finie ? 'Saison terminée' : jours <= 1 ? 'dernier jour' : `encore ${esc(String(jours))} jours`}</span>
      </div>
      ${rangHtml}
      <section class="card ssn-week" aria-labelledby="ssn-week-h">
        <h3 class="ssn-h" id="ssn-week-h">Mes points de la semaine</h3>
        <ul class="ssn-cats">${catsHtml}</ul>
        <p class="small muted">Chaque catégorie est plafonnée par semaine : la régularité paie plus que l’acharnement. Les points de saison ne s’achètent pas et ne se dépensent pas.</p>
        ${palierHtml}
      </section>
      <section class="card ssn-board" aria-labelledby="ssn-board-h">
        <h3 class="ssn-h" id="ssn-board-h">Classement</h3>
        <div class="ssn-chips" role="tablist" aria-label="Classement">
          <button type="button" class="ssn-chip" role="tab" id="ssn-t-general" aria-controls="ssn-l" aria-selected="true" data-l="general">Général</button>
          <button type="button" class="ssn-chip" role="tab" id="ssn-t-nouveaux" aria-controls="ssn-l" aria-selected="false" tabindex="-1" data-l="nouveaux">Ligue des nouveaux</button>
        </div>
        <ol class="ssn-list" id="ssn-l" role="tabpanel" aria-labelledby="ssn-t-general"></ol>
        <p class="small muted ssn-foot">${esc(nf.format(B.participants || 0))} membres classés. Fin de saison : podium, badge daté, Paillettes pour le top 3 et pour chaque podium de la ligue des nouveaux.</p>
      </section>
    </div>`;

  const ol = panel.querySelector('#ssn-l');
  /** Affiche la liste demandée (général ou nouveaux). */
  const montre = (k) => {
    const rows = listes[k];
    ol.innerHTML = rows.length ? rows.map((r) => ligne(r, me?.id, esc)).join('')
      : `<li class="ssn-empty muted">${k === 'nouveaux' ? 'Aucun nouveau classé pour l’instant.' : 'Personne n’a encore de point cette saison.'}</li>`;
    ol.setAttribute('aria-labelledby', `ssn-t-${k}`);
    for (const b of panel.querySelectorAll('.ssn-chip')) {
      const on = b.dataset.l === k;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  const chips = panel.querySelector('.ssn-chips');
  chips.addEventListener('click', (e) => { const b = e.target.closest('.ssn-chip'); if (b) montre(b.dataset.l); });
  chips.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const k = panel.querySelector('.ssn-chip[aria-selected="true"]').dataset.l === 'general' ? 'nouveaux' : 'general';
    montre(k);
    panel.querySelector(`.ssn-chip[data-l="${k}"]`).focus();
  });
  montre('general');
}
