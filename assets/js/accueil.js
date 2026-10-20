// ===== Accueil : le QG du Humane Gang =====
import { sb, initPage, esc, $, fmtDate, fmtDateTime, avatarHtml, errMsg, toast, currentLogo } from './core.js';

const app = $('#app');
const me = await initPage({ auth: 'optional' });

/* ---------- Icônes (SVG à trait) ---------- */
const svg = (d, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
/* Emojis des rubriques (demandés par Ethan) */
const EMOJI = { ss: '🎁', irl: '📍', hist: '📜' };
const tileIcon = (k) => `<span class="tile-icon tile-icon-${k}" aria-hidden="true">${EMOJI[k]}</span>`;
const ICON = {
  bulb: svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>', 20),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 20),
  cake: svg('<path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7"/><path d="M5 16c2 1.5 3.5 1.5 5 0s3.5-1.5 5 0 3 1.5 4 0"/><path d="M12 12V8M12 5.5v.01"/>', 20),
  pulse: svg('<path d="M3 12h4l3-7 4 14 3-7h4"/>', 20),
};

const STATUS = {
  inscriptions: ['Inscriptions ouvertes', 'pill-current'],
  tirage: ['Tirage en préparation', 'pill-current'],
  envoi: ['Envoi des cadeaux', 'pill-current'],
  revelation: ['Révélation', 'pill-ok'],
  termine: ['Terminée', 'pill-todo'],
};
const RSVP = { oui: 'Tu viens', 'peut-etre': 'Peut-être', non: 'Tu ne viens pas' };

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
function ago(d) {
  const s = (new Date(d) - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return 'à l\'instant';
}
const parseDay = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/* ---------- Synchronisation « intro vue » entre l'appareil et le profil ---------- */
function syncIntro() {
  if (!me) return;
  let local = false;
  try { local = !!localStorage.getItem('hg_intro_seen'); } catch {}
  if (me.intro_seen && !local) { try { localStorage.setItem('hg_intro_seen', '1'); } catch {} }
  else if (!me.intro_seen && local) sb.from('hg_profiles').update({ intro_seen: true }).eq('id', me.id).then(() => {}, () => {});
}

/* ======================================================================
   Visiteur non connecté
   ====================================================================== */
function renderGuest() {
  app.innerHTML = `
    <section class="home-hero home-hero-guest">
      <img class="home-hero-logo" src="${esc(currentLogo())}" alt="" onerror="this.remove()">
      <p class="eyebrow">Humane Gang</p>
      <h1 class="page-title">Le QG du Humane Gang</h1>
      <p class="home-lead">Secret Santa, sorties IRL et souvenirs : tout ce qui fait le gang, au même endroit. L'espace est réservé aux membres.</p>
      <div class="btn-row home-hero-actions">
        <a class="btn btn-primary" href="compte.html?next=accueil.html">Se connecter / Rejoindre</a>
        <button class="btn btn-ghost" type="button" id="replay">Revoir l'intro</button>
      </div>
      <p class="small muted">Pour rejoindre le gang, il te faut un code d'invitation donné par un membre.</p>
    </section>
    <section class="grid home-tiles" aria-label="Ce qui t'attend">
      <div class="card card-ss tile">
        ${tileIcon('ss')}
        <h2 class="tile-label">Secret Santa</h2>
        <p class="tile-sub">Inscriptions, tirage au sort, liste de souhaits et révélation finale.</p>
      </div>
      <div class="card card-irl tile">
        ${tileIcon('irl')}
        <h2 class="tile-label">IRL</h2>
        <p class="tile-sub">Les prochaines sorties, qui vient, et l'album photo de chaque rencontre.</p>
      </div>
      <div class="card card-hist tile">
        ${tileIcon('hist')}
        <h2 class="tile-label">Historique</h2>
        <p class="tile-sub">La frise du gang : éditions passées, sorties et moments cultes.</p>
      </div>
    </section>`;
  $('#replay').addEventListener('click', () => {
    try { localStorage.removeItem('hg_intro_seen'); } catch {}
    location.href = 'index.html';
  });
}

/* ======================================================================
   Membre connecté
   ====================================================================== */
function renderMemberShell() {
  app.innerHTML = `
    <section class="page-head home-head">
      <div>
        <p class="eyebrow">Salut ${esc(me.pseudo)}</p>
        <h1 class="page-title">Le QG du Humane Gang</h1>
      </div>
      <div id="countdown" class="countdown" hidden></div>
    </section>
    ${recapBanner()}

    <section class="grid home-tiles" aria-label="Rubriques">
      <a class="card card-ss tile tile-link" href="secret-santa.html" id="tile-ss">
        ${tileIcon('ss')}
        <span class="tile-arrow">${ICON.arrow}</span>
        <h2 class="tile-label">Secret Santa</h2>
        <div class="tile-body"><span class="skeleton"></span><span class="skeleton short"></span></div>
      </a>
      <a class="card card-irl tile tile-link" href="irl.html" id="tile-irl">
        ${tileIcon('irl')}
        <span class="tile-arrow">${ICON.arrow}</span>
        <h2 class="tile-label">IRL</h2>
        <div class="tile-body"><span class="skeleton"></span><span class="skeleton short"></span></div>
      </a>
      <a class="card card-hist tile tile-link" href="historique.html" id="tile-hist">
        ${tileIcon('hist')}
        <span class="tile-arrow">${ICON.arrow}</span>
        <h2 class="tile-label">Historique</h2>
        <div class="tile-body"><span class="skeleton"></span><span class="skeleton short"></span></div>
      </a>
    </section>

    <section class="row home-row">
      <div class="card home-feed">
        <h2 class="card-title">${ICON.pulse} Fil d'activité</h2>
        <ul class="feed" id="feed" aria-live="polite"><li class="skeleton-row"></li><li class="skeleton-row"></li><li class="skeleton-row"></li></ul>
      </div>
      <div class="card home-bdays">
        <h2 class="card-title">${ICON.cake} Anniversaires de ${MONTHS[new Date().getMonth()]}</h2>
        <ul class="bdays" id="bdays"><li class="skeleton-row"></li></ul>
      </div>
    </section>

    <section class="card home-ideas" id="idees" aria-labelledby="ideas-title">
      <form class="stack" id="idea-form" novalidate>
        <div class="ideas-head">
          <h2 class="card-title" id="ideas-title">${ICON.bulb} Une idée pour le gang ?</h2>
          <p class="small muted">Une sortie, une fonctionnalité pour le site, un thème… Ton message est <strong>lu uniquement par l'admin</strong>.</p>
        </div>
        <div class="field">
          <label for="idea-body">Ton idée</label>
          <textarea id="idea-body" maxlength="2000" rows="3" required placeholder="Et si on organisait…"></textarea>
          <span class="small muted ideas-count" id="idea-count" aria-live="polite">0 / 2000</span>
        </div>
        <p class="form-error" id="idea-error" role="alert" hidden></p>
        <div class="btn-row"><button class="btn btn-sand" type="submit">Envoyer l'idée</button></div>
      </form>
    </section>`;
}

/* ---------- Boîte à idées ---------- */
function bindIdeas() {
  const form = $('#idea-form'), ta = $('#idea-body'), count = $('#idea-count'), err = $('#idea-error');
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  ta.addEventListener('input', () => { count.textContent = `${ta.value.length} / 2000`; if (ta.value.trim()) showErr(''); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = ta.value.trim();
    if (!body) { showErr('Écris ton idée avant de l\'envoyer.'); ta.focus(); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Envoi…'; showErr('');
    const { error } = await sb.from('hg_ideas').insert({ user_id: me.id, body });
    btn.disabled = false; btn.textContent = label;
    if (error) { showErr(`Envoi impossible : ${errMsg(error)}`); return; }
    ta.value = ''; count.textContent = '0 / 2000';
    toast('Merci, ton idée a été transmise à l\'admin.', 'ok');
  });
}

const failBox = (e) => `<p class="small muted">Impossible de charger ces infos (${esc(errMsg(e))}).</p>`;

/* ---------- Tuile Secret Santa + compte à rebours ---------- */
async function loadSecretSanta() {
  const body = $('#tile-ss .tile-body');
  try {
    const { data: ed, error } = await sb.from('hg_ss_editions').select('*').order('year', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!ed) { body.innerHTML = `<p class="tile-main">Pas encore d'édition</p><p class="tile-sub">L'admin lancera la prochaine bientôt.</p>`; return; }
    const [st, cls] = STATUS[ed.status] || [ed.status, 'pill-todo'];
    const [{ data: mine }, { data: prog }] = await Promise.all([
      sb.from('hg_ss_participants').select('user_id').eq('edition_id', ed.id).eq('user_id', me.id).maybeSingle(),
      sb.rpc('hg_ss_progress', { p_edition: ed.id }),
    ]);
    const p = Array.isArray(prog) ? prog[0] : prog;
    const when = ed.exchange_date ? `Échange le ${fmtDate(parseDay(ed.exchange_date))}`
      : ed.send_deadline ? `Envoi avant le ${fmtDate(parseDay(ed.send_deadline))}` : 'Dates à venir';
    const part = mine ? 'Tu participes' : (ed.status === 'inscriptions' ? 'Tu n\'es pas encore inscrit·e' : 'Tu ne participes pas');
    body.innerHTML = `
      <p class="tile-main">Édition ${esc(ed.year)}</p>
      <p><span class="pill ${cls}">${esc(st)}</span></p>
      <p class="tile-sub">${esc(when)}</p>
      <p class="tile-sub">${esc(part)}${p?.participants ? ` · ${esc(p.participants)} participant${p.participants > 1 ? 's' : ''}` : ''}</p>`;
    if (ed.exchange_date && !['revelation', 'termine'].includes(ed.status)) startCountdown(parseDay(ed.exchange_date), ed.year);
  } catch (e) { body.innerHTML = failBox(e); }
}

let cdTimer;
function startCountdown(target, year) {
  const box = $('#countdown');
  const unit = (n, l) => `<div class="cd-unit"><span class="cd-num display">${String(n).padStart(2, '0')}</span><span class="cd-lbl">${l}</span></div>`;
  const tick = () => {
    const ms = target - Date.now();
    if (ms <= -86400000) { box.hidden = true; clearInterval(cdTimer); return; }
    box.hidden = false;
    if (ms <= 0) { box.innerHTML = `<p class="cd-title">Secret Santa ${esc(year)}</p><p class="cd-today display">C'est le jour de l'échange</p>`; clearInterval(cdTimer); return; }
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    box.innerHTML = `<p class="cd-title">Échange des cadeaux ${esc(year)} dans</p>
      <div class="cd-units" role="timer" aria-label="${d} jours, ${h} heures et ${m} minutes">${unit(d, d > 1 ? 'jours' : 'jour')}${unit(h, 'h')}${unit(m, 'min')}${unit(sec, 's')}</div>`;
  };
  tick();
  cdTimer = setInterval(tick, 1000);
}

/* ---------- Tuile IRL ---------- */
async function loadIrl() {
  const body = $('#tile-irl .tile-body');
  try {
    const nowIso = new Date().toISOString();
    const [{ data: next, error }, { count: polls }] = await Promise.all([
      sb.from('hg_events').select('id,title,location,starts_at').gte('starts_at', nowIso).order('starts_at').limit(1).maybeSingle(),
      sb.from('hg_events').select('id', { count: 'exact', head: true }).is('starts_at', null),
    ]);
    if (error) throw error;
    const pollTxt = polls ? `<p class="tile-sub">${polls} sondage${polls > 1 ? 's' : ''} de dates en cours</p>` : '';
    if (!next) {
      body.innerHTML = `<p class="tile-main">Aucune sortie prévue</p><p class="tile-sub">Propose la prochaine !</p>${pollTxt}`;
      return;
    }
    const { data: rsvps } = await sb.from('hg_event_rsvps').select('user_id,status').eq('event_id', next.id);
    const yes = (rsvps || []).filter((r) => r.status === 'oui').length;
    const mine = (rsvps || []).find((r) => r.user_id === me.id);
    body.innerHTML = `
      <p class="tile-kicker">Prochaine sortie</p>
      <p class="tile-main">${esc(next.title)}</p>
      <p class="tile-sub">${esc(fmtDateTime(next.starts_at))}${next.location ? ` · ${esc(next.location)}` : ''}</p>
      <p class="tile-sub">${yes} présent${yes > 1 ? 's' : ''} · ${mine ? esc(RSVP[mine.status] || mine.status) : 'Tu n\'as pas encore répondu'}</p>
      ${pollTxt}`;
  } catch (e) { body.innerHTML = failBox(e); }
}

/* ---------- Tuile Historique ---------- */
async function loadHistory() {
  const body = $('#tile-hist .tile-body');
  try {
    const nowIso = new Date().toISOString();
    const [mom, eds, evs, last] = await Promise.all([
      sb.from('hg_moments').select('id', { count: 'exact', head: true }),
      sb.from('hg_ss_editions').select('id', { count: 'exact', head: true }).in('status', ['revelation', 'termine']),
      sb.from('hg_events').select('id', { count: 'exact', head: true }).lt('starts_at', nowIso),
      sb.from('hg_moments').select('title,happened_on').order('happened_on', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (mom.error) throw mom.error;
    const n = (c, s, p) => `${c || 0} ${(c || 0) > 1 ? p : s}`;
    body.innerHTML = `
      <p class="tile-main">${n(mom.count, 'moment culte', 'moments cultes')}</p>
      <p class="tile-sub">${n(evs.count, 'sortie passée', 'sorties passées')} · ${n(eds.count, 'édition Secret Santa', 'éditions Secret Santa')}</p>
      ${last.data ? `<p class="tile-sub">Dernier souvenir : ${esc(last.data.title)}</p>` : ''}`;
  } catch (e) { body.innerHTML = failBox(e); }
}

/* ---------- Annuaire (partagé par le fil et les anniversaires) ---------- */
const membersP = sb.rpc('hg_members').then(({ data, error }) => { if (error) throw error; return data || []; });

/* ---------- Liens vers la carte d'identité d'un membre ---------- */
const memberLink = (m, label = m.pseudo) => `<a class="member-link" href="membre.html?id=${encodeURIComponent(m.id)}">${esc(label)}</a>`;
function feedText(a, m) {
  const text = String(a.text ?? '');
  if (!m) return esc(text);
  if (text.startsWith(m.pseudo)) return `${memberLink(m)}${esc(text.slice(m.pseudo.length))}`;
  return `${memberLink(m)} · ${esc(text)}`;
}

/* ---------- Bandeau « Le récap est disponible » (1er décembre → 31 janvier) ---------- */
function recapBanner() {
  const d = new Date(), mo = d.getMonth();
  if (mo !== 11 && mo !== 0) return '';
  const y = mo === 11 ? d.getFullYear() : d.getFullYear() - 1;
  return `<a class="recap-banner" href="recap.html?year=${y}">
      <span class="recap-banner-emoji" aria-hidden="true">✨</span>
      <span class="recap-banner-txt"><strong>Le récap ${y} est disponible</strong><span>Ton année avec le gang en quelques chiffres</span></span>
      <span class="recap-banner-go" aria-hidden="true">${ICON.arrow}</span>
    </a>`;
}

/* ---------- Fil d'activité ---------- */
async function loadFeed() {
  const ul = $('#feed');
  try {
    const [{ data, error }, members] = await Promise.all([
      sb.from('hg_activity').select('id,user_id,kind,text,created_at').order('created_at', { ascending: false }).limit(10),
      membersP.catch(() => []),
    ]);
    if (error) throw error;
    if (!data?.length) { ul.innerHTML = `<li class="empty">Rien pour l'instant. Le fil se remplira au fil des inscriptions, sorties et souvenirs.</li>`; return; }
    const byId = new Map(members.map((m) => [m.id, m]));
    ul.innerHTML = data.map((a) => {
      const m = a.user_id ? byId.get(a.user_id) : null;
      const av = m ? avatarHtml(m, 36) : `<span class="avatar feed-sys" aria-hidden="true" style="width:36px;height:36px"><img src="${esc(currentLogo())}" alt="" onerror="this.remove()"></span>`;
      return `<li class="feed-item">
        ${av}
        <div class="feed-text">
          <p>${feedText(a, m)}</p>
          <time class="small muted" datetime="${esc(a.created_at)}" title="${esc(fmtDateTime(a.created_at))}">${esc(ago(a.created_at))}</time>
        </div>
      </li>`;
    }).join('');
  } catch (e) { ul.innerHTML = `<li>${failBox(e)}</li>`; }
}

/* ---------- Anniversaires du mois ---------- */
async function loadBirthdays() {
  const ul = $('#bdays');
  try {
    const members = await membersP;
    const now = new Date(), month = now.getMonth() + 1, today = now.getDate();
    const list = members
      .filter((m) => m.birthday_dm && Number(m.birthday_dm.split('.')[1]) === month)
      .map((m) => ({ ...m, day: Number(m.birthday_dm.split('.')[0]) }))
      .sort((a, b) => a.day - b.day || a.pseudo.localeCompare(b.pseudo, 'fr'));
    if (!list.length) {
      ul.innerHTML = `<li class="empty">Pas d'anniversaire partagé ce mois-ci.<br><a href="compte.html">Partager le tien</a> (jour et mois seulement)</li>`;
      return;
    }
    ul.innerHTML = list.map((m) => `
      <li class="bday${m.day === today ? ' is-today' : ''}${m.day < today ? ' is-past' : ''}">
        ${avatarHtml(m, 36)}
        <span class="bday-name">${memberLink(m)}</span>
        ${m.day === today ? '<span class="pill pill-current">Aujourd\'hui</span>' : `<span class="bday-date">${m.day} ${MONTHS[month - 1]}</span>`}
      </li>`).join('');
  } catch (e) { ul.innerHTML = `<li>${failBox(e)}</li>`; }
}

/* ---------- Lancement ---------- */
if (!me) {
  renderGuest();
} else {
  syncIntro();
  renderMemberShell();
  bindIdeas();
  if (location.hash === '#idees') requestAnimationFrame(() => $('#idees')?.scrollIntoView({ block: 'start' }));
  await Promise.allSettled([loadSecretSanta(), loadIrl(), loadHistory(), loadFeed(), loadBirthdays()]);
}
app.removeAttribute('aria-busy');
