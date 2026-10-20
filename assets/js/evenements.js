// ===== Humane Gang — page « Événements » : événements dynamiques en cours et passés =====
// Lecture membres : hg_dyn_events, hg_dyn_captures, hg_badges, hg_user_badges ; classement rpc hg_dyn_leaderboard.
// Les événements à venir ne sont pas montrés (surprise).
import { sb, initPage, esc, $, errMsg, avatarHtml } from './core.js';
import { hasLevels, sortedLevels, levelImage, levelLabel, levelPipsHtml, metricCount, roman, METRIC_LABEL } from './badge-levels.js';

const app = $('#app');
const me = await initPage({ auth: 'member' });

const svg = (d, s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 21h8M9 17h6"/>'),
  badge: svg('<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
};
const TZ = 'Europe/Zurich';
const fmt = (iso, o = {}) => new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', ...o }).format(new Date(iso));
const fmtDay = (iso) => new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
const oneIn = (p) => Math.max(1, Math.round(1 / (Number(p) || 1)));
const check = (r) => { if (r.error) throw r.error; return r.data; };

function remaining(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'terminé';
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return d ? `encore ${d} j ${h} h` : h ? `encore ${h} h ${m} min` : `encore ${m} min`;
}
function visual(ev, size) {
  return `<span class="evp-visual" style="--s:${size}px">${ev.image_url
    ? `<img src="${esc(ev.image_url)}" alt="" loading="lazy">`
    : `<span class="evp-emoji">${esc(ev.emoji || '✨')}</span>`}</span>`;
}
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
function boardHtml(rows) {
  if (!rows) return '<p class="small muted">Classement indisponible.</p>';
  if (!rows.length) return '<p class="small muted">Personne n\'a encore attrapé d\'image. À toi de jouer !</p>';
  return `<ol class="evp-lb">${rows.slice(0, 10).map((r, i) => `
    <li class="${r.user_id === me.id ? 'is-me' : ''}"><span class="evp-rank${i < 3 ? ' top' : ''}">${i + 1}</span>${avatarHtml(r, 32)}
      <a class="evp-lb-name" href="membre.html?id=${encodeURIComponent(r.user_id)}">${esc(r.pseudo)}${r.user_id === me.id ? ' <span class="evp-me">toi</span>' : ''}</a>
      <strong>${esc(r.captures)}</strong></li>`).join('')}</ol>
    ${(() => { const i = rows.findIndex((r) => r.user_id === me.id); return i >= 10 ? `<p class="small muted">Ta place : ${i + 1}<sup>e</sup> avec ${rows[i].captures} capture${rows[i].captures > 1 ? 's' : ''}.</p>` : ''; })()}`;
}
function eventCard(ev, ctx, live) {
  const mine = ctx.mine.get(ev.id) || 0;
  const total = ctx.total.get(ev.id) || 0;
  const b = ev.badge_code ? ctx.badges.get(ev.badge_code) : null;
  return `<article class="card evp-card${live ? ' is-live' : ''}" aria-labelledby="evp-${esc(ev.id)}">
    <div class="evp-head">
      ${visual(ev, live ? 112 : 72)}
      <div class="evp-title">
        <p class="eyebrow">${live ? `${ICON.clock} En cours · ${esc(remaining(ev.ends_at))}` : `Du ${esc(fmtDay(ev.starts_at))} au ${esc(fmtDay(ev.ends_at))}`}</p>
        <h2 class="display" id="evp-${esc(ev.id)}">${esc(ev.name)}</h2>
        ${ev.description ? `<p class="evp-desc">${esc(ev.description)}</p>` : ''}
        ${live ? `<p class="small muted">Jusqu'au ${esc(fmt(ev.ends_at, { weekday: 'long' }))}. ${ICON.eye} L'image passe au hasard sur les pages du site (${oneIn(ev.probability) === 1 ? 'à chaque page' : `environ 1 page sur ${oneIn(ev.probability)}`}) : clique dessus pour l'attraper.</p>` : ''}
      </div>
    </div>
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

async function load() {
  const nowIso = new Date().toISOString();
  const [evs, caps, myB] = await Promise.all([
    sb.from('hg_dyn_events').select('*').eq('active', true).lte('starts_at', nowIso).order('ends_at', { ascending: false }),
    sb.from('hg_dyn_captures').select('event_id, user_id'),
    sb.from('hg_user_badges').select('badge_code, level, awarded_at').eq('user_id', me.id),
  ]);
  const events = (check(evs) ?? []).filter((e) => new Date(e.starts_at) <= new Date());
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

function render(ctx) {
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

try {
  render(await load());
} catch (e) {
  app.innerHTML = `<section class="page-head"><h1 class="page-title">Événements</h1></section><p class="empty">Impossible de charger les événements (${esc(errMsg(e))}).</p>`;
}
app.removeAttribute('aria-busy');
