// ===== Humane Gang — rendez-vous saisonniers de l'accueil (migration 096) =====
/*
 * Rôle : monte sur l'accueil ce que la saison apporte, dans le bloc #saison-home : la saison des Worlds (dates choisies
 * par le Staff) : bandeau de saison, booster de la saison (C1, par son identifiant) et quêtes saisonnières.
 * Le calendrier de l'Avent n'est plus sur l'accueil : en décembre, il s'ouvre depuis le paquet cadeau de la barre du haut
 * (avent-gift.js, avent-popup.js).
 * L'anniversaire du gang (T4) est monté par eggs/core.js (anniv.js), sur l'accueil et la page Cartes.
 * RPC : hg_saison_state. Rien n'est affiché hors saison.
 * Dépendances : core.js (sb, esc), icons.js, cartes-ui.js (fmtP), saisons-css.js.
 * Exporte : mountSeasonal(box).
 */
import { sb, esc } from '../../commun/core.js';
import { svg } from '../../commun/icons.js';
import { loadSeasonCss } from './saisons-css.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const nf = new Intl.NumberFormat('fr-CH');

/** « 2 novembre » (heure de Zurich). */
function dayMonth(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'numeric' }).formatToParts(d);
  return `${p.find((x) => x.type === 'day').value} ${MOIS[Number(p.find((x) => x.type === 'month').value) - 1]}`;
}
/** Tuile « En boutique » : le booster de la saison (C1). */
function boosterHtml(w) {
  const b = w.booster;
  if (!b || !b.active) return '';
  const fin = w.fin ? ` · jusqu’au ${esc(dayMonth(w.fin))}` : '';
  return `<section class="sz-card wd-card" aria-labelledby="wd-b-t"><div class="wd-shop">
    <div class="wd-pack" aria-hidden="true">🏆</div>
    <div class="sz-stack" style="gap:6px;margin:0"><p class="sz-eyebrow">En boutique</p>
      <h3 class="sz-h3" id="wd-b-t">${esc(b.name)}</h3>
      <p class="sz-small sz-muted">${Number(b.size) || 5} cartes · ${nf.format(Number(b.price) || 0)} Paillettes${fin}</p>
      <p style="margin:0"><a class="btn wd-btn" href="/pages/cartes/cartes.html#boutique">Voir la boutique</a></p></div></div></section>`;
}

/** Tuile « Quêtes de la saison ». */
function questsHtml(w) {
  const qs = Array.isArray(w.quests) ? w.quests : [];
  if (!qs.length) return '';
  const li = qs.map((q) => {
    const p = Math.min(Number(q.progress) || 0, Number(q.target) || 1);
    const done = p >= (Number(q.target) || 1);
    const val = q.claimed ? 'Réclamée' : done ? `+${Number(q.reward) || 0}` : `${p} / ${Number(q.target) || 1}`;
    return `<li class="${done ? 'is-done' : ''}"><span class="wd-box" aria-hidden="true">${done ? svg('check', { size: 12, stroke: 3 }) : ''}</span>
      <span class="wd-q-label">${esc(q.label)}</span><span class="wd-q-val">${esc(val)}</span>
      <span class="visually-hidden">${done ? (q.claimed ? 'récompense réclamée' : 'terminée, à réclamer dans les quêtes') : 'en cours'}</span></li>`;
  }).join('');
  const claim = qs.some((q) => !q.claimed && (Number(q.progress) || 0) >= (Number(q.target) || 1));
  return `<section class="sz-card wd-card" aria-labelledby="wd-q-t"><h3 class="sz-eyebrow" id="wd-q-t">Quêtes de la saison</h3>
    <ul class="wd-quests">${li}</ul>
    ${claim ? '<p style="margin:12px 0 0"><a class="btn wd-btn" href="/pages/cartes/cartes.html#ouverture">Réclamer dans les quêtes</a></p>' : ''}</section>`;
}

/** Bloc complet de la saison des Worlds. */
function worldsHtml(w) {
  return `<section class="sz-stack" aria-labelledby="wd-title">
    <div class="wd-band"><h2 class="sz-eyebrow" id="wd-title">${svg('trophy', { size: 14 })} Saison des Worlds</h2>
      ${w.fin ? `<span class="sz-small">jusqu’au ${esc(dayMonth(w.fin))}</span>` : ''}</div>
    ${boosterHtml(w)}${questsHtml(w)}
    <p class="wd-foot">À la finale, un drop « La soirée finale » tombe pendant le match.</p>
  </section>`;
}

/**
 * Monte les rendez-vous de la saison (Worlds) dans box. Le bloc reste caché s'il n'y a rien à montrer.
 * @param {HTMLElement} box Conteneur #saison-home.
 */
export async function mountSeasonal(box) {
  if (!box) return;
  const wdBox = document.createElement('div');
  box.append(wdBox);
  try {
    const { data, error } = await sb.rpc('hg_saison_state');
    if (error || !data?.worlds) return;
    loadSeasonCss();
    wdBox.innerHTML = worldsHtml(data.worlds);
    box.hidden = false;
  } catch (e) { console.warn('[saison]', e); }
}
