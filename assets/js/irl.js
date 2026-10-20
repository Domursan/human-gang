// ===== Humane Gang — Sorties IRL =====
import { sb, initPage, toast, errMsg, esc, $, $$, fmtDateTime, daysUntil, avatarHtml, notify } from './core.js';
import { compressImage, uploadImage, removeObjects, signedUrls, openLightbox, uuid, thumbHtml } from './photos.js';
import { mountHistory } from './irl-history.js';

const me = await initPage({ auth: 'member' });
const isAdmin = !!me?.is_admin;

const GRACE_MS = 6 * 3600 * 1000;   // une sortie reste « prochaine » 6 h après son début
const ALBUM_PREVIEW = 12;           // miniatures affichées avant « +n »
const RSVP = [
  ['oui', 'Je viens'],
  ['peut-etre', 'Peut-être'],
  ['non', 'Pas dispo'],
];
const TINTS = ['var(--sand)', 'var(--rust)', 'var(--sage)', 'var(--slate)', 'var(--plum)', 'var(--rose)'];

const I = {
  cal: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  people: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.6 3.6-5.5 6.5-5.5s5.5 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  upload: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

/* ---------- État ---------- */
const S = { members: new Map(), events: [], rsvps: [], dates: [], votes: [], photos: [], urls: new Map(), expanded: new Set() };
let hx;   // historique des rencontres (monté plus bas, une fois les helpers définis)

async function load() {
  const [m, ev, rs, dt, vt, ph] = await Promise.all([
    sb.rpc('hg_members'),
    sb.from('hg_events').select('*').order('starts_at', { ascending: true }),
    sb.from('hg_event_rsvps').select('*'),
    sb.from('hg_event_dates').select('*').order('proposed_at', { ascending: true }),
    sb.from('hg_event_date_votes').select('*'),
    sb.from('hg_photos').select('*').order('created_at', { ascending: true }),
  ]);
  const err = [m, ev, rs, dt, vt, ph].find((r) => r.error)?.error;
  if (err) throw err;
  S.members = new Map((m.data || []).map((x) => [x.id, x]));
  S.events = ev.data || [];
  S.rsvps = rs.data || [];
  S.dates = dt.data || [];
  S.votes = vt.data || [];
  S.photos = ph.data || [];
}

/* ---------- Helpers ---------- */
const member = (id) => S.members.get(id) || { pseudo: 'Ancien membre' };
const pseudo = (id) => member(id).pseudo;
const canEdit = (ev) => ev.created_by === me.id || isAdmin;
const tint = (id) => TINTS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];
const photosOf = (id) => S.photos.filter((p) => p.event_id === id);
const datesOf = (id) => S.dates.filter((d) => d.event_id === id);
const votesOf = (dateId) => S.votes.filter((v) => v.date_id === dateId);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function rsvpOf(eventId) {
  const r = { oui: [], 'peut-etre': [], non: [], mine: null };
  for (const x of S.rsvps) {
    if (x.event_id !== eventId) continue;
    r[x.status]?.push(x.user_id);
    if (x.user_id === me.id) r.mine = x.status;
  }
  return r;
}
function classify() {
  const now = Date.now();
  const dated = S.events.filter((e) => e.starts_at);
  // Une rencontre ajoutée après coup (retro) est toujours « passée », même si elle date d'il y a moins de 6 h.
  const isPast = (e) => e.retro || new Date(e.starts_at).getTime() < now - GRACE_MS;
  const future = dated.filter((e) => !isPast(e))
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const past = dated.filter(isPast)
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
  const polls = S.events.filter((e) => !e.starts_at).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { next: future[0] || null, upcoming: future.slice(1), polls, past };
}
function whenLabel(iso) {
  const t = new Date(iso).getTime();
  if (t <= Date.now()) return 'En cours';
  const d = daysUntil(iso);
  if (d === 0) return "Aujourd'hui";
  if (d === 1) return 'Demain';
  return `Dans ${d} jours`;
}
function dateTile(iso) {
  const d = new Date(iso);
  const wd = new Intl.DateTimeFormat('fr-CH', { weekday: 'short' }).format(d).replace('.', '');
  const mo = new Intl.DateTimeFormat('fr-CH', { month: 'short' }).format(d);
  const yr = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `<div class="date-tile" aria-hidden="true"><span>${esc(wd)}</span><strong>${d.getDate()}</strong><span>${esc(mo)}${yr}</span></div>`;
}
function meta(ev, { creator = true } = {}) {
  const li = [];
  if (ev.starts_at) {
    const y = new Date(ev.starts_at).getFullYear();
    li.push(`<li>${I.cal}<span>${esc(fmtDateTime(ev.starts_at))}${y !== new Date().getFullYear() ? ` ${y}` : ''}</span></li>`);
  }
  if (ev.location) li.push(`<li>${I.pin}<span>${esc(ev.location)}</span></li>`);
  if (creator && ev.created_by) li.push(`<li>${I.user}<span>Proposée par ${esc(pseudo(ev.created_by))}</span></li>`);
  return li.length ? `<ul class="meta">${li.join('')}</ul>` : '';
}
function ownerActions(ev, { who = false } = {}) {
  if (!canEdit(ev)) return '';
  return `<div class="owner-actions">
    ${who ? `<button type="button" class="btn btn-ghost btn-sm" data-act="who" data-id="${esc(ev.id)}" data-key="who:${esc(ev.id)}">${I.people}<span>Qui était là ?</span></button>` : ''}
    <button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${esc(ev.id)}" data-key="edit:${esc(ev.id)}">${I.edit}<span>Modifier</span></button>
    <button type="button" class="btn btn-danger btn-sm" data-act="delete" data-id="${esc(ev.id)}">${I.trash}<span>Supprimer</span></button>
  </div>`;
}
function rsvpBlock(ev, { compact = false } = {}) {
  const r = rsvpOf(ev.id);
  const btns = RSVP.map(([v, label]) => {
    const on = r.mine === v;
    return `<button type="button" class="rsvp-btn rsvp-${v}" data-act="rsvp" data-id="${esc(ev.id)}" data-status="${v}"
      data-key="rsvp:${esc(ev.id)}:${v}" aria-pressed="${on}">${on ? I.check : ''}<span>${label}</span></button>`;
  }).join('');
  const counts = `<p class="rsvp-counts small"><strong>${plural(r.oui.length, 'vient', 'viennent')}</strong> · ${r['peut-etre'].length} peut-être · ${r.non.length} pas dispo</p>`;
  let people = '';
  if (!compact) {
    const yes = r.oui.map((id) => `<li class="person">${avatarHtml(member(id), 28)}<span>${esc(pseudo(id))}</span></li>`).join('');
    const maybe = r['peut-etre'].map((id) => esc(pseudo(id))).join(', ');
    people = `${yes ? `<ul class="people" aria-label="Présents">${yes}</ul>` : '<p class="small muted">Personne n\'a encore confirmé. Lance-toi.</p>'}
      ${maybe ? `<p class="small muted">Peut-être : ${maybe}</p>` : ''}`;
  }
  return `<div class="rsvp-wrap">
    <div class="rsvp" role="group" aria-label="Ta réponse pour ${esc(ev.title)}">${btns}</div>
    ${counts}${people}
  </div>`;
}
function descHtml(ev) {
  return ev.description ? `<p class="desc">${esc(ev.description)}</p>` : '';
}

/* ---------- Albums ---------- */
function albumHtml(ev) {
  const list = photosOf(ev.id);
  const expanded = S.expanded.has(ev.id);
  const shown = expanded ? list : list.slice(0, ALBUM_PREVIEW);
  const rest = list.length - shown.length;
  const tiles = shown.map((p, i) => `<li><button type="button" class="thumb" data-act="photo" data-id="${esc(ev.id)}" data-idx="${i}"
      aria-label="Photo ${i + 1} sur ${list.length}${p.user_id ? `, ajoutée par ${esc(pseudo(p.user_id))}` : ''}">${thumbHtml(S.urls.get(p.path))}</button></li>`).join('');
  const more = rest > 0 ? `<li><button type="button" class="thumb thumb-more" data-act="expand" data-id="${esc(ev.id)}" aria-label="Afficher les ${rest} autres photos">+${rest}</button></li>` : '';
  const grid = list.length
    ? `<ul class="album" aria-label="Album photo">${tiles}${more}</ul>`
    : '<p class="empty album-empty">Pas encore de photos. Sois le ou la première à en ajouter.</p>';
  return `<div class="album-wrap">
    <div class="album-head">
      <h4 class="album-title">Album <span class="muted">· ${plural(list.length, 'photo', 'photos')}</span></h4>
      <label class="btn btn-ghost btn-sm upload-btn">${I.upload}<span>Ajouter des photos</span>
        <input class="visually-hidden" type="file" accept="image/*" multiple data-upload="${esc(ev.id)}">
      </label>
    </div>
    ${grid}
    <p class="upload-status small muted" aria-live="polite" data-status-for="${esc(ev.id)}"></p>
  </div>`;
}

/* ---------- Rendu ---------- */
function coverHtml(ev) {
  const url = ev.cover_path ? S.urls.get(ev.cover_path) : null;
  if (url) return `<div class="feat-cover"><img src="${esc(url)}" alt=""></div>`;
  const d = new Date(ev.starts_at);
  return `<div class="feat-cover feat-cover-block" style="--tint:${tint(ev.id)}" aria-hidden="true">
    <span class="fc-day">${d.getDate()}</span>
    <span class="fc-month">${esc(new Intl.DateTimeFormat('fr-CH', { month: 'long' }).format(d))}</span>
  </div>`;
}
function renderNext(ev) {
  if (!ev) {
    return `<div class="card card-irl feat-empty">
      <p class="display feat-empty-title">Rien de calé pour l'instant.</p>
      <p class="muted">Un resto, une rando, un karaoké raté : propose quelque chose et le gang suivra.</p>
      <div><button type="button" class="btn btn-sand" data-act="new">+ Proposer une sortie</button></div>
    </div>`;
  }
  const started = new Date(ev.starts_at).getTime() <= Date.now();
  return `<article class="card card-irl featured" id="event-${esc(ev.id)}">
    ${coverHtml(ev)}
    <div class="feat-body stack">
      <div class="feat-tags"><span class="pill pill-current">Prochaine sortie</span><span class="pill">${esc(whenLabel(ev.starts_at))}</span></div>
      <h3 class="display feat-title">${esc(ev.title)}</h3>
      ${meta(ev)}
      ${descHtml(ev)}
      ${rsvpBlock(ev)}
      ${ownerActions(ev)}
    </div>
    ${started ? `<div class="feat-album">${albumHtml(ev)}</div>` : ''}
  </article>`;
}
function renderPoll(ev) {
  const ds = datesOf(ev.id);
  const counts = ds.map((d) => votesOf(d.id).length);
  const max = Math.max(1, ...counts);
  const top = Math.max(0, ...counts);
  const rows = ds.map((d, i) => {
    const vs = votesOf(d.id);
    const mine = vs.some((v) => v.user_id === me.id);
    const lead = top > 0 && vs.length === top;
    const who = vs.map((v) => esc(pseudo(v.user_id))).join(', ');
    return `<li class="pd${lead ? ' pd-lead' : ''}">
      <div class="pd-main">
        <div class="pd-label"><strong>${esc(fmtDateTime(d.proposed_at))}</strong>${lead ? '<span class="pill pill-ok">En tête</span>' : ''}</div>
        <div class="pd-bar" aria-hidden="true"><span style="width:${Math.round((counts[i] / max) * 100)}%"></span></div>
        <div class="small muted">${plural(vs.length, 'vote', 'votes')}${who ? ` · ${who}` : ''}</div>
      </div>
      <div class="pd-actions">
        <button type="button" class="btn btn-sm vote-btn" data-act="vote" data-date="${esc(d.id)}" data-key="vote:${esc(d.id)}"
          aria-pressed="${mine}" aria-label="${mine ? 'Retirer mon vote' : 'Je suis dispo'} pour le ${esc(fmtDateTime(d.proposed_at))}">${mine ? I.check : ''}<span>${mine ? 'Dispo' : 'Je suis dispo'}</span></button>
        ${canEdit(ev) ? `<button type="button" class="btn btn-ghost btn-sm" data-act="fix" data-id="${esc(ev.id)}" data-date="${esc(d.id)}">Fixer cette date</button>` : ''}
      </div>
    </li>`;
  }).join('');
  return `<article class="card poll" id="event-${esc(ev.id)}">
    <div class="poll-head">
      <div class="stack-sm">
        <span class="pill pill-todo">Sondage de dates</span>
        <h3 class="ev-title">${esc(ev.title)}</h3>
        ${meta(ev)}
      </div>
      ${ownerActions(ev)}
    </div>
    ${descHtml(ev)}
    ${ds.length ? `<ol class="poll-dates">${rows}</ol>` : '<p class="empty">Aucune date proposée pour l\'instant.</p>'}
  </article>`;
}
function renderUpcoming(ev) {
  return `<article class="card ev-row" id="event-${esc(ev.id)}">
    ${dateTile(ev.starts_at)}
    <div class="ev-main stack-sm">
      <div class="ev-row-head">
        <div class="stack-sm"><h3 class="ev-title">${esc(ev.title)}</h3>${meta(ev)}</div>
        ${ownerActions(ev)}
      </div>
      ${descHtml(ev)}
      ${rsvpBlock(ev, { compact: true })}
    </div>
  </article>`;
}
function renderPast(ev) {
  const r = rsvpOf(ev.id);
  return `<article class="card past" id="event-${esc(ev.id)}">
    <div class="past-head">
      ${dateTile(ev.starts_at)}
      <div class="stack-sm past-info">
        ${ev.retro ? '<span class="pill retro-pill">Ajoutée après coup</span>' : ''}
        <h3 class="ev-title">${esc(ev.title)}</h3>
        ${meta(ev, { creator: false })}
        <p class="small muted past-people">${I.people}<span>${r.oui.length ? `${plural(r.oui.length, 'présent', 'présents')} : ${r.oui.map((id) => esc(pseudo(id))).join(', ')}` : 'Présents non renseignés'}</span></p>
      </div>
      ${ownerActions(ev, { who: true })}
    </div>
    ${albumHtml(ev)}
  </article>`;
}

async function render() {
  const { next, upcoming, polls, past } = classify();
  // URLs signées en un seul lot : couvertures + photos des albums affichés
  const albumEvents = [...past, ...(next && new Date(next.starts_at) <= Date.now() ? [next] : [])];
  const paths = [
    ...(next?.cover_path ? [next.cover_path] : []),
    ...past.map((e) => e.cover_path).filter(Boolean),   // miniatures de l'historique
    ...albumEvents.flatMap((e) => photosOf(e.id).map((p) => p.path)),
  ];
  S.urls = await signedUrls(paths);

  const focusKey = S.focusKey || document.activeElement?.dataset?.key;
  S.focusKey = null;
  $('#next').innerHTML = renderNext(next);
  $('#polls-section').hidden = !polls.length;
  $('#polls').innerHTML = polls.map(renderPoll).join('');
  $('#upcoming-section').hidden = !upcoming.length;
  $('#upcoming').innerHTML = upcoming.map(renderUpcoming).join('');
  $('#past').innerHTML = past.length
    ? past.map(renderPast).join('')
    : '<p class="empty">Aucune sortie passée pour l\'instant. Les souvenirs arrivent bientôt.</p>';
  hx.render();
  if (focusKey) $(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
}

async function refresh() {
  try { await load(); await render(); } catch (e) { toast(`Chargement impossible : ${errMsg(e)}`, 'error'); }
}

function goToHash() {
  if (location.hash === '#historique') { if (!hx.isOpen()) hx.setTab('historique'); return; }
  const m = location.hash.match(/^#event-([0-9a-f-]{36})$/i);
  if (!m) return;
  if (hx.isOpen()) hx.setTab('sorties');
  const el = document.getElementById(`event-${m[1]}`);
  if (!el) return;
  el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

/* ---------- Actions ---------- */
async function setRsvp(eventId, status, btn) {
  const mine = rsvpOf(eventId).mine;
  btn.disabled = true;
  try {
    if (mine === status) {
      const { error } = await sb.from('hg_event_rsvps').delete().eq('event_id', eventId).eq('user_id', me.id);
      if (error) throw error;
    } else {
      const { error } = await sb.from('hg_event_rsvps').upsert(
        { event_id: eventId, user_id: me.id, status, updated_at: new Date().toISOString() },
        { onConflict: 'event_id,user_id' });
      if (error) throw error;
    }
    await refresh();
  } catch (e) { toast(`Réponse non enregistrée : ${errMsg(e)}`, 'error'); btn.disabled = false; }
}
async function toggleVote(dateId, btn) {
  const mine = votesOf(dateId).some((v) => v.user_id === me.id);
  btn.disabled = true;
  try {
    const q = mine
      ? sb.from('hg_event_date_votes').delete().eq('date_id', dateId).eq('user_id', me.id)
      : sb.from('hg_event_date_votes').insert({ date_id: dateId, user_id: me.id });
    const { error } = await q;
    if (error) throw error;
    await refresh();
  } catch (e) { toast(`Vote non enregistré : ${errMsg(e)}`, 'error'); btn.disabled = false; }
}
async function fixDate(eventId, dateId) {
  const d = S.dates.find((x) => x.id === dateId);
  if (!d || !confirm(`Fixer la sortie au ${fmtDateTime(d.proposed_at)} ?`)) return;
  const { error } = await sb.from('hg_events').update({ starts_at: d.proposed_at }).eq('id', eventId);
  if (error) return toast(`Impossible de fixer la date : ${errMsg(error)}`, 'error');
  toast('Date fixée. Le gang peut maintenant répondre.', 'ok');
  await refresh();
}
async function deleteEvent(eventId) {
  const ev = S.events.find((e) => e.id === eventId);
  if (!ev || !confirm(`Supprimer « ${ev.title} » ? Les réponses, votes et photos de l'album seront supprimés.`)) return;
  const mineOnly = (p) => isAdmin || p.startsWith(`${me.id}/`);
  const files = [ev.cover_path, ...photosOf(eventId).map((p) => p.path)].filter((p) => p && mineOnly(p));
  const { error } = await sb.from('hg_events').delete().eq('id', eventId);
  if (error) return toast(`Suppression impossible : ${errMsg(error)}`, 'error');
  try { await removeObjects(files); } catch (e) { console.warn('[irl] fichiers non supprimés', e); }
  toast('Sortie supprimée.', 'ok');
  await refresh();
}
async function uploadPhotos(eventId, input) {
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  const status = $(`[data-status-for="${CSS.escape(eventId)}"]`);
  const label = input.closest('label');
  input.disabled = true; label?.classList.add('is-busy');
  let ok = 0;
  for (const [i, f] of files.entries()) {
    if (status) status.textContent = `Compression et envoi ${i + 1} / ${files.length}…`;
    let path = null;
    try {
      const blob = await compressImage(f);
      path = `${me.id}/${eventId}/${uuid()}.jpg`;
      await uploadImage(path, blob);
      const { error } = await sb.from('hg_photos').insert({ event_id: eventId, user_id: me.id, path });
      if (error) throw error;
      ok++;
    } catch (e) {
      if (path) removeObjects([path]).catch(() => {});
      toast(`${f.name} : ${errMsg(e)}`, 'error');
    }
  }
  input.disabled = false; label?.classList.remove('is-busy');
  if (status) status.textContent = '';
  if (ok) { toast(`${plural(ok, 'photo ajoutée', 'photos ajoutées')} à l'album.`, 'ok'); S.expanded.add(eventId); await refresh(); }
}
function openPhoto(eventId, idx) {
  const list = photosOf(eventId);
  const items = list.map((p) => ({
    url: S.urls.get(p.path),
    alt: `Photo ajoutée par ${pseudo(p.user_id)}`,
    caption: [p.caption, `Ajoutée par ${pseudo(p.user_id)}`].filter(Boolean).join(' · '),
    onDelete: (p.user_id === me.id || isAdmin) ? () => deletePhoto(p) : null,
  })).filter((x) => x.url);
  openLightbox(items, idx);
}
async function deletePhoto(p) {
  const { error } = await sb.from('hg_photos').delete().eq('id', p.id);
  if (error) { toast(`Suppression impossible : ${errMsg(error)}`, 'error'); return false; }
  try { await removeObjects([p.path]); } catch (e) { console.warn('[irl] fichier non supprimé', e); }
  toast('Photo supprimée.', 'ok');
  refresh();
  return true;
}

$('#app').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  S.focusKey = b.dataset.key || null;
  if (act === 'rsvp') setRsvp(id, b.dataset.status, b);
  else if (act === 'vote') toggleVote(b.dataset.date, b);
  else if (act === 'fix') fixDate(id, b.dataset.date);
  else if (act === 'edit') { const ev = S.events.find((x) => x.id === id); if (ev?.retro) hx.openRetro(ev); else openEventDialog(ev); }
  else if (act === 'who') hx.openWho(S.events.find((x) => x.id === id));
  else if (act === 'delete') deleteEvent(id);
  else if (act === 'new') openEventDialog();
  else if (act === 'photo') openPhoto(id, Number(b.dataset.idx));
  else if (act === 'expand') { S.expanded.add(id); render().then(() => $(`#event-${CSS.escape(id)} .thumb[data-idx="${ALBUM_PREVIEW}"]`)?.focus()); }
});
$('#app').addEventListener('change', (e) => {
  const inp = e.target.closest('input[data-upload]');
  if (inp) uploadPhotos(inp.dataset.upload, inp);
});
$('#btn-new').addEventListener('click', () => openEventDialog());
$('#btn-retro').addEventListener('click', () => hx.openRetro());
window.addEventListener('hashchange', goToHash);

/* ---------- Formulaire de sortie ---------- */
const dlg = $('#event-dialog');
const form = $('#event-form');
let editing = null;

const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function updateDateRows() {
  const rows = $$('.date-row', $('#ev-dates'));
  rows.forEach((r, i) => {
    r.querySelector('input').setAttribute('aria-label', `Date proposée ${i + 1}`);
    r.querySelector('button').disabled = rows.length <= 2;
  });
  $('#ev-add-date').disabled = rows.length >= 6;
}
function addDateRow(value = '', id = '') {
  const row = document.createElement('div');
  row.className = 'date-row';
  row.innerHTML = `<input class="input" type="datetime-local" value="${esc(value)}" data-orig="${esc(value)}" data-id="${esc(id)}">
    <button type="button" class="btn btn-ghost" aria-label="Retirer cette date">${I.trash}</button>`;
  row.querySelector('button').addEventListener('click', () => { row.remove(); updateDateRows(); });
  $('#ev-dates').append(row);
  updateDateRows();
}
function setMode(mode) {
  form.elements.when.value = mode;
  $('#ev-fixed').hidden = mode !== 'fixed';
  $('#ev-poll').hidden = mode !== 'poll';
  if (mode === 'poll') { while ($$('.date-row', $('#ev-dates')).length < 2) addDateRow(); }
}
form.addEventListener('change', (e) => { if (e.target.name === 'when') setMode(e.target.value); });
$('#ev-add-date').addEventListener('click', () => { addDateRow(); $('#ev-dates .date-row:last-child input').focus(); });
$$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));

function openEventDialog(ev = null) {
  editing = ev;
  form.reset();
  $('#ev-dates').innerHTML = '';
  $('#ev-dlg-title').textContent = ev ? 'Modifier la sortie' : 'Proposer une sortie';
  $('#ev-submit').textContent = ev ? 'Enregistrer' : 'Créer la sortie';
  const cur = $('#ev-cover-current');
  cur.hidden = !ev?.cover_path;
  cur.innerHTML = ev?.cover_path ? `<label class="check"><input type="checkbox" name="remove_cover"><span>Retirer l'image de couverture actuelle</span></label>` : '';
  if (ev) {
    form.elements.title.value = ev.title || '';
    form.elements.location.value = ev.location || '';
    form.elements.description.value = ev.description || '';
    form.elements.starts_at.value = toLocalInput(ev.starts_at);
    if (!ev.starts_at) datesOf(ev.id).forEach((d) => addDateRow(toLocalInput(d.proposed_at), d.id));
  }
  setMode(ev && !ev.starts_at ? 'poll' : 'fixed');
  dlg.showModal();
  form.elements.title.focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = form.elements;
  const title = f.title.value.trim();
  const mode = f.when.value;
  if (!title) { toast('Donne un titre à la sortie.', 'error'); f.title.focus(); return; }
  let starts_at = null, pollRows = [];
  if (mode === 'fixed') {
    if (!f.starts_at.value) { toast('Indique une date, ou choisis « Date à caler ».', 'error'); f.starts_at.focus(); return; }
    starts_at = new Date(f.starts_at.value).toISOString();
  } else {
    pollRows = $$('.date-row input', $('#ev-dates')).filter((i) => i.value);
    const uniq = new Set(pollRows.map((i) => i.value));
    if (uniq.size !== pollRows.length) { toast('Deux dates proposées sont identiques.', 'error'); return; }
    if (pollRows.length < 2 || pollRows.length > 6) { toast('Propose entre 2 et 6 dates.', 'error'); return; }
  }
  const payload = { title, location: f.location.value.trim() || null, description: f.description.value.trim() || null, starts_at };
  const coverFile = f.cover.files[0];
  const removeCover = !!f.remove_cover?.checked;
  const btn = $('#ev-submit');
  btn.disabled = true;
  try {
    let id = editing?.id;
    if (editing) {
      const { error } = await sb.from('hg_events').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from('hg_events').insert({ ...payload, created_by: me.id }).select().single();
      if (error) throw error;
      id = data.id;
    }

    // Dates du sondage
    const existing = editing ? datesOf(id) : [];
    if (mode === 'poll') {
      const keep = new Set(pollRows.filter((i) => i.dataset.id && i.value === i.dataset.orig).map((i) => i.dataset.id));
      const drop = existing.filter((d) => !keep.has(d.id)).map((d) => d.id);
      const add = pollRows.filter((i) => !(i.dataset.id && keep.has(i.dataset.id))).map((i) => ({ event_id: id, proposed_at: new Date(i.value).toISOString() }));
      if (drop.length) { const { error } = await sb.from('hg_event_dates').delete().in('id', drop); if (error) throw error; }
      if (add.length) { const { error } = await sb.from('hg_event_dates').insert(add); if (error) throw error; }
    } else if (existing.length) {
      const { error } = await sb.from('hg_event_dates').delete().eq('event_id', id);
      if (error) throw error;
    }

    // Couverture
    const old = editing?.cover_path || null;
    try {
      if (coverFile) {
        const blob = await compressImage(coverFile);
        const path = `${me.id}/${id}/cover.jpg`;
        if (old) await removeObjects([old]).catch(() => {});
        await uploadImage(path, blob);
        const { error } = await sb.from('hg_events').update({ cover_path: path }).eq('id', id);
        if (error) throw error;
      } else if (removeCover && old) {
        const { error } = await sb.from('hg_events').update({ cover_path: null }).eq('id', id);
        if (error) throw error;
        await removeObjects([old]).catch(() => {});
      }
    } catch (err) { toast(`Sortie enregistrée, mais image non envoyée : ${errMsg(err)}`, 'error'); }

    if (!editing) notify('irl_new', { event_id: id });
    toast(editing ? 'Sortie mise à jour.' : 'Sortie proposée. Le gang est prévenu.', 'ok');
    dlg.close();
    await refresh();
    if (!editing) { location.hash = `event-${id}`; goToHash(); }
  } catch (err) {
    toast(`Enregistrement impossible : ${errMsg(err)}`, 'error');
  } finally { btn.disabled = false; }
});

/* ---------- Démarrage ---------- */
hx = mountHistory({ me, isAdmin, S, classify, member, pseudo, canEdit, plural, tint, I, refresh });
await refresh();
goToHash();
