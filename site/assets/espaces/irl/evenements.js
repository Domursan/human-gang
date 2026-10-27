// ===== Humane Gang — page « Événements » (/pages/irl/evenements.html) : événements dynamiques en cours et passés =====
// Lecture membres : hg_dyn_events, hg_dyn_captures, hg_badges, hg_user_badges ; classement rpc hg_dyn_leaderboard.
// Les événements à venir ne sont pas montrés (surprise).
// Dépendances : core.js (accès Supabase, page), badge-levels.js (niveaux de badge), ics.js (agenda), icons.js, utils.js.
// Page réservée aux membres (auth: 'member'). N'exporte rien.
import { sb, initPage, esc, $, errMsg, avatarHtml } from '../../commun/core.js';
import { hasLevels, sortedLevels, levelImage, levelLabel, levelPipsHtml, metricCount, roman, METRIC_LABEL } from '../compte/badge-levels.js';
import { addToCalendar } from './ics.js';
import { svg } from '../../commun/icons.js';
import { fmtDayInZone } from '../../commun/utils.js';

/* ---------- Initialisation : conteneur et session membre ---------- */
const app = $('#app');
// me = personne connectée (la page exige un membre).
const me = await initPage({ auth: 'member' });

/* ---------- Constantes et icônes ---------- */
const ICON = {
  trophy: svg('trophy', { size: 20, stroke: 1.8 }),
  badge: svg('badge', { size: 20, stroke: 1.8 }),
  eye: svg('eye', { size: 20, stroke: 1.8 }),
  clock: svg('clock', { size: 20, stroke: 1.8 }),
  cal: svg('cal', { size: 20, stroke: 1.8 }),
};
// Fuseau horaire du gang : toutes les dates affichées sont en heure de Zurich.
const TZ = 'Europe/Zurich';
/** Formate une date ISO en français, en heure de Zurich (options Intl en surcharge). */
const fmt = (iso, o = {}) => new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', ...o }).format(new Date(iso));
/** Transforme une probabilité (ex. 0.25) en « 1 page sur N » (ex. 4). Au moins 1. */
const oneIn = (p) => Math.max(1, Math.round(1 / (Number(p) || 1)));
/** Réponse Supabase → données, ou lève l'erreur pour que le bloc try/catch l'affiche. */
const check = (r) => { if (r.error) throw r.error; return r.data; };

/* ---------- Rendu : fonctions d'affichage (renvoient du HTML) ---------- */
/**
 * Temps restant avant la fin d'un événement, en texte (« encore 2 h 10 min »), ou « terminé ».
 * @param {string} iso date de fin ISO
 * @returns {string}
 */
function remaining(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'terminé';
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return d ? `encore ${d} j ${h} h` : h ? `encore ${h} h ${m} min` : `encore ${m} min`;
}
/**
 * Visuel d'un événement : son image si elle existe, sinon son emoji (ou une étoile).
 * @param {object} ev l'événement
 * @param {number} size taille en pixels (variable CSS --s)
 * @returns {string} HTML
 */
function visual(ev, size) {
  return `<span class="evp-visual" style="--s:${size}px">${ev.image_url
    ? `<img src="${esc(ev.image_url)}" alt="" loading="lazy">`
    : `<span class="evp-emoji">${esc(ev.emoji || '✨')}</span>`}</span>`;
}
/**
 * Bloc « badge de l'événement » : image, niveaux (si le badge en a) et état obtenu ou non.
 * @param {object} b le badge (hg_badges)
 * @param {object|undefined} mine la ligne hg_user_badges de la personne, si elle l'a obtenu
 * @param {boolean} live true si l'événement est en cours
 * @returns {string} HTML, vide si pas de badge
 */
function badgeBlock(b, mine, live) {
  if (!b) return '';
  const lv = hasLevels(b);
  const has = !!mine;
  const level = Number(mine?.level) || 0;
  const img = lv ? levelImage(b, has ? level : 1) : b.image_url;
  const scope = b.metric === 'event_captures' && !b.event_id ? ' (tous événements confondus)' : '';
  return `<div class="evp-badge${has ? ' is-got' : ''}">
    <span class="evp-badge-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ICON.badge}${has && lv ? `<span class="evp-badge-lvl" aria-hidden="true">${roman(level)}</span>` : ''}</span>
    <div class="evp-badge-txt">
      <p class="evp-k">${ICON.badge} ${live && !has ? 'Badge à gagner' : 'Badge de l\'événement'}</p>
      <strong>${esc(b.name)}</strong>
      <span class="small muted">${esc(b.description)}</span>
      ${lv ? `<div class="evp-levels">${levelPipsHtml(b, has ? level : 0, { max: 8 })}
          <ul class="evp-lv-list">${sortedLevels(b).map((l) => `<li class="${has && l.level <= level ? 'is-on' : ''}"><span class="lvl-pip${has && l.level <= level ? ' is-on' : ''}">${roman(l.level)}</span>${l.name ? `<strong>${esc(l.name)}</strong>` : ''}<span class="muted">${esc(metricCount(b.metric, l.threshold))}${esc(scope)}</span></li>`).join('')}</ul>
          ${has ? `<span class="lvl-name">Tu es ${esc(levelLabel(b, level).replace(/^Niveau/, 'niveau'))}</span>` : `<span class="small muted">${esc(METRIC_LABEL[b.metric] || '')}</span>`}</div>`
        : `<span class="pill ${has ? 'pill-ok' : 'pill-todo'}">${has ? 'Obtenu' : 'À la première capture'}</span>`}
    </div>
  </div>`;
}
/**
 * Classement d'un événement : top 10, avec la place de la personne si elle est plus loin.
 * @param {Array<object>|null} rows lignes de hg_dyn_leaderboard, null si la RPC a échoué
 * @returns {string} HTML
 */
function boardHtml(rows) {
  if (!rows) return '<p class="small muted">Classement indisponible.</p>';
  if (!rows.length) return '<p class="small muted">Personne n\'a encore attrapé d\'image. À toi de jouer !</p>';
  return `<ol class="evp-lb">${rows.slice(0, 10).map((r, i) => `
    <li class="${r.user_id === me.id ? 'is-me' : ''}"><span class="evp-rank${i < 3 ? ' top' : ''}">${i + 1}</span>${avatarHtml(r, 32)}
      <a class="evp-lb-name" href="/pages/compte/membre.html?id=${encodeURIComponent(r.user_id)}">${esc(r.pseudo)}${r.user_id === me.id ? ' <span class="evp-me">toi</span>' : ''}</a>
      <strong>${esc(r.captures)}</strong></li>`).join('')}</ol>
    ${(() => { const i = rows.findIndex((r) => r.user_id === me.id); return i >= 10 ? `<p class="small muted">Ta place : ${i + 1}<sup>e</sup> avec ${rows[i].captures} capture${rows[i].captures > 1 ? 's' : ''}.</p>` : ''; })()}`;
}
/**
 * Carte complète d'un événement (en cours ou passé) : titre, stats, classement et badge.
 * @param {object} ev l'événement
 * @param {object} ctx données chargées par load()
 * @param {boolean} live true pour un événement en cours
 * @returns {string} HTML
 */
function eventCard(ev, ctx, live) {
  const mine = ctx.mine.get(ev.id) || 0;
  const total = ctx.total.get(ev.id) || 0;
  const b = ev.badge_code ? ctx.badges.get(ev.badge_code) : null;
  return `<article class="card evp-card${live ? ' is-live' : ''}" aria-labelledby="evp-${esc(ev.id)}">
    <div class="evp-head">
      ${visual(ev, live ? 112 : 72)}
      <div class="evp-title">
        <p class="eyebrow">${live ? `${ICON.clock} En cours · ${esc(remaining(ev.ends_at))}` : `Du ${esc(fmtDayInZone(ev.starts_at, TZ))} au ${esc(fmtDayInZone(ev.ends_at, TZ))}`}</p>
        <h2 class="display" id="evp-${esc(ev.id)}">${esc(ev.name)}</h2>
        ${ev.description ? `<p class="evp-desc">${esc(ev.description)}</p>` : ''}
        ${live ? `<p class="small muted">Jusqu'au ${esc(fmt(ev.ends_at, { weekday: 'long' }))}. ${ICON.eye} L'image passe au hasard sur les pages du site (${oneIn(ev.probability) === 1 ? 'à chaque page' : `environ 1 page sur ${oneIn(ev.probability)}`}) : clique dessus pour l'attraper.</p>` : ''}
      </div>
    </div>
    ${live ? `<div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" data-act="ics" data-id="${esc(ev.id)}" aria-label="Ajouter « ${esc(ev.name)} » à mon agenda">${ICON.cal}<span>Ajouter à mon agenda</span></button></div>` : ''}
    <dl class="evp-stats">
      <div><dt>Tes captures</dt><dd>${mine}${ev.max_per_user != null ? `<small> / ${esc(ev.max_per_user)}</small>` : ''}</dd></div>
      <div><dt>Captures du gang</dt><dd>${total}${ev.max_total != null ? `<small> / ${esc(ev.max_total)}</small>` : ''}</dd></div>
      <div><dt>Chasseurs</dt><dd>${ctx.boards.get(ev.id)?.length ?? '–'}</dd></div>
    </dl>
    <div class="evp-cols">
      <section class="evp-board" aria-label="Classement de ${esc(ev.name)}">
        <h3 class="evp-k">${ICON.trophy} Classement</h3>
        ${boardHtml(ctx.boards.get(ev.id))}
      </section>
      ${b ? badgeBlock(b, ctx.myBadges.get(b.code), live) : ''}
    </div>
  </article>`;
}

/* ---------- Chargement des données ---------- */
/**
 * Charge tout ce qu'il faut pour la page, en parallèle quand c'est possible.
 * Ne garde que les événements déjà commencés (un événement à venir reste caché).
 * @returns {Promise<{events: object[], mine: Map, total: Map, badges: Map, boards: Map, myBadges: Map}>}
 *   mine/total : nombre de captures par événement (à moi / de tout le gang) ; boards : classement par événement (null si erreur).
 */
async function load() {
  const nowIso = new Date().toISOString();
  const [evs, myB] = await Promise.all([
    sb.from('hg_dyn_events').select('*').eq('active', true).lte('starts_at', nowIso).order('ends_at', { ascending: false }),
    sb.from('hg_user_badges').select('badge_code, level, awarded_at').eq('user_id', me.id),
  ]);
  const events = (check(evs) ?? []).filter((e) => new Date(e.starts_at) <= new Date());
  // Captures : seulement celles des événements affichés (pas toute la table).
  const ids = events.map((e) => e.id);
  const caps = ids.length
    ? await sb.from('hg_dyn_captures').select('event_id, user_id').in('event_id', ids)
    : { data: [], error: null };
  const mine = new Map(), total = new Map();
  for (const c of check(caps) ?? []) {
    total.set(c.event_id, (total.get(c.event_id) || 0) + 1);
    if (c.user_id === me.id) mine.set(c.event_id, (mine.get(c.event_id) || 0) + 1);
  }
  const codes = [...new Set(events.map((e) => e.badge_code).filter(Boolean))];
  const badges = new Map();
  if (codes.length) for (const b of check(await sb.from('hg_badges').select('*').in('code', codes)) ?? []) badges.set(b.code, b);
  const boards = new Map();
  await Promise.all(events.slice(0, 24).map(async (e) => {
    try { boards.set(e.id, check(await sb.rpc('hg_dyn_leaderboard', { p_event: e.id })) ?? []); } catch { boards.set(e.id, null); }
  }));
  const myBadges = new Map((check(myB) ?? []).map((r) => [r.badge_code, r]));
  return { events, mine, total, badges, boards, myBadges };
}

/* ---------- Événements : bouton « Ajouter à mon agenda » ---------- */
let shown = null; // contexte du dernier rendu (pour le bouton « Ajouter à mon agenda »)
// Délégation : un seul écouteur sur #app, qui marche pour les cartes rendues plus tard.
app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act="ics"]');
  if (!b) return;
  const ev = shown?.events.find((x) => x.id === b.dataset.id);
  if (ev) addToCalendar({ id: ev.id, title: ev.name, start: ev.starts_at, end: ev.ends_at, description: ev.description }, new URL('/pages/irl/evenements.html', location.href).href);
});

/* ---------- Page : rendu complet, puis chargement initial ---------- */
/**
 * Dessine la page : en-tête, événements en cours, événements passés.
 * @param {object} ctx données chargées par load() ; gardées dans shown pour le bouton agenda
 */
function render(ctx) {
  shown = ctx;
  const now = new Date();
  const live = ctx.events.filter((e) => new Date(e.ends_at) > now).sort((a, b) => new Date(a.ends_at) - new Date(b.ends_at));
  const past = ctx.events.filter((e) => new Date(e.ends_at) <= now);
  app.innerHTML = `
    <section class="page-head">
      <div>
        <p class="eyebrow">Chasse aux images</p>
        <h1 class="page-title">Événements</h1>
      </div>
      <p class="muted evp-intro">Pendant un événement (Halloween, Noël…), une image spéciale traverse parfois le site. Attrape-la pour grimper au classement et gagner un badge.</p>
    </section>
    <section class="evp-section" aria-labelledby="evp-live-title">
      <h2 class="evp-section-title" id="evp-live-title">En cours</h2>
      ${live.length ? live.map((e) => eventCard(e, ctx, true)).join('') : '<p class="empty">Aucun événement en cours. Le prochain sera annoncé sur Discord… ou pas : ouvre l\'œil !</p>'}
    </section>
    <section class="evp-section" aria-labelledby="evp-past-title">
      <h2 class="evp-section-title" id="evp-past-title">Événements passés</h2>
      ${past.length ? `<div class="evp-past">${past.map((e) => eventCard(e, ctx, false)).join('')}</div>` : '<p class="empty">Pas encore d\'événement terminé.</p>'}
    </section>`;
}

// Premier affichage. En cas d'erreur de chargement, un message lisible remplace la page.
try {
  render(await load());
} catch (e) {
  app.innerHTML = `<section class="page-head"><h1 class="page-title">Événements</h1></section><p class="empty">Impossible de charger les événements (${esc(errMsg(e))}).</p>`;
}
app.removeAttribute('aria-busy');
