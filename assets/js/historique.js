// ===== Humane Gang — Historique (frise) =====
import { sb, initPage, toast, errMsg, esc, $, $$, fmtDate, avatarHtml, godLimit, godTag } from './core.js';
import { uploadImage, removeObjects, signedUrls, openLightbox, uuid, thumbHtml } from './photos.js';
import { prepareImage } from './image-compress.js';
import { loadReactions, reactionBarHtml } from './reactions.js';
import { ghostDirectory } from './admin-ghosts.js';
import { confirmBox } from './ui-confirm.js';
import { svg } from './icons.js';
import { pluralCount } from './utils.js';

const me = await initPage({ auth: 'member' });
const isAdmin = !!me?.is_admin;

const GRACE_MS = 6 * 3600 * 1000; // même règle que la page IRL : une sortie est « passée » 6 h après son début
const THUMBS = 4;
const STATUS_LABEL = { revelation: 'Révélation', termine: 'Terminé' };
const KIND_LABEL = { ss: 'Secret Santa', irl: 'Sortie IRL', moment: 'Moment culte' };
const FILTER_LABEL = { all: 'tout', ss: 'Secret Santa', irl: 'IRL et albums', moment: 'moments cultes' };

const I = {
  gift: svg('gift', { size: 18, stroke: 1.8 }),
  pin: svg('pin', { size: 18, stroke: 1.8 }),
  star: svg('star', { size: 18, stroke: 1.8 }),
  people: svg('people', { size: 16, stroke: 1.8 }),
  arrow: svg('arrow', { size: 16, stroke: 2 }),
  edit: svg('edit2', { size: 16, stroke: 1.8 }),
  trash: svg('trash2', { size: 16, stroke: 1.8 }),
};

const S = { members: new Map(), editions: [], progress: new Map(), events: [], present: new Map(), photos: new Map(), moments: [], urls: new Map(), reveals: new Map(), filter: 'all' };
const member = (id) => S.members.get(id) || { pseudo: 'Ancien membre' };
const dayDate = (d) => new Date(`${d}T12:00:00`); // date SQL → midi local (évite les décalages de fuseau)

/* ---------- Données ---------- */
async function load() {
  const pastLimit = new Date(Date.now() - GRACE_MS).toISOString();
  const [m, ed, ev, mo] = await Promise.all([
    sb.rpc('hg_members'),
    sb.from('hg_ss_editions').select('*').in('status', ['revelation', 'termine']).order('year', { ascending: false }),
    sb.from('hg_events').select('id,title,location,starts_at').not('starts_at', 'is', null).lt('starts_at', pastLimit).order('starts_at', { ascending: false }),
    sb.from('hg_moments').select('*').order('happened_on', { ascending: false }),
  ]);
  const err = [m, ed, ev, mo].find((r) => r.error)?.error;
  if (err) throw err;
  S.members = new Map((m.data || []).map((x) => [x.id, x]));
  if (me?.is_admin) for (const [id, g] of await ghostDirectory()) S.members.set(id, g); // l'admin voit les fantômes, pas les membres
  S.editions = ed.data || [];
  S.events = ev.data || [];
  S.moments = mo.data || [];
  await loadReactions('moment', S.moments.map((x) => x.id), me.id); // une requête pour toutes les réactions de la page

  const ids = S.events.map((e) => e.id);
  const [prog, rs, ph] = await Promise.all([
    Promise.all(S.editions.map((e) => sb.rpc('hg_ss_progress', { p_edition: e.id }))),
    ids.length ? sb.from('hg_event_rsvps').select('event_id,user_id').eq('status', 'oui').in('event_id', ids) : { data: [] },
    ids.length ? sb.from('hg_photos').select('id,event_id,path,user_id').in('event_id', ids).order('created_at', { ascending: true }) : { data: [] },
  ]);
  const err2 = [...prog, rs, ph].find((r) => r.error)?.error;
  if (err2) throw err2;
  S.progress = new Map(S.editions.map((e, i) => {
    const d = prog[i].data;
    return [e.id, Array.isArray(d) ? d[0] : d];
  }));
  S.present = new Map();
  for (const r of rs.data || []) S.present.set(r.event_id, [...(S.present.get(r.event_id) || []), r.user_id]);
  S.photos = new Map();
  for (const p of ph.data || []) S.photos.set(p.event_id, [...(S.photos.get(p.event_id) || []), p]);

  const paths = [
    ...[...S.photos.values()].flatMap((l) => l.slice(0, THUMBS).map((p) => p.path)),
    ...S.moments.map((x) => x.image_path),
  ];
  S.urls = await signedUrls(paths);
}

/* ---------- Construction de la frise ---------- */
function items() {
  const out = [];
  for (const e of S.editions) {
    const date = e.exchange_date ? dayDate(e.exchange_date) : new Date(e.year, 11, 24, 12);
    out.push({ kind: 'ss', date, year: e.year, html: ssCard(e) });
  }
  for (const e of S.events) {
    const date = new Date(e.starts_at);
    out.push({ kind: 'irl', date, year: date.getFullYear(), html: irlCard(e) });
  }
  for (const m of S.moments) {
    const date = dayDate(m.happened_on);
    out.push({ kind: 'moment', date, year: date.getFullYear(), html: momentCard(m) });
  }
  return out.sort((a, b) => b.date - a.date);
}

function ssCard(e) {
  const p = S.progress.get(e.id);
  const n = p?.participants ?? 0;
  const date = e.exchange_date ? fmtDate(dayDate(e.exchange_date)) : `Décembre ${e.year}`;
  return `<article class="tl-card tl-card-ss">
    <div class="tl-kind">${I.gift}<span>Secret Santa · ${esc(date)}</span></div>
    <h3 class="tl-title">Secret Santa ${esc(e.year)}</h3>
    <div class="tl-tags">
      <span class="pill">${I.people}${pluralCount(n, 'participant', 'participants')}</span>
      ${e.budget ? `<span class="pill">Budget ${esc(e.budget)}</span>` : ''}
      <span class="pill ${e.status === 'termine' ? 'pill-ok' : 'pill-current'}">${esc(STATUS_LABEL[e.status] || e.status)}</span>
    </div>
    <details class="reveal" data-edition="${esc(e.id)}">
      <summary>Qui offrait à qui ?</summary>
      <div class="reveal-body"><p class="small muted">Chargement…</p></div>
    </details>
  </article>`;
}

function irlCard(e) {
  const present = (S.present.get(e.id) || []).filter((id) => S.members.has(id)); // compte inconnu (fantôme) : ignoré
  const photos = S.photos.get(e.id) || [];
  const shown = photos.slice(0, THUMBS);
  const more = photos.length - shown.length;
  const href = `irl.html#event-${encodeURIComponent(e.id)}`;
  const thumbs = shown.length ? `<ul class="tl-thumbs">
      ${shown.map((p, i) => `<li><a class="tl-thumb" href="${href}" aria-label="Photo ${i + 1} de l'album ${esc(e.title)}">${thumbHtml(S.urls.get(p.path))}</a></li>`).join('')}
      ${more > 0 ? `<li><a class="tl-thumb tl-thumb-more" href="${href}" aria-label="${more} autres photos dans l'album">+${more}</a></li>` : ''}
    </ul>` : '';
  return `<article class="tl-card tl-card-irl">
    <div class="tl-kind">${I.pin}<span>Sortie IRL · ${esc(fmtDate(e.starts_at))}</span></div>
    <h3 class="tl-title">${esc(e.title)}</h3>
    <p class="tl-meta small">${e.location ? `${esc(e.location)} · ` : ''}${present.length ? `${pluralCount(present.length, 'présent', 'présents')} : ${present.map((id) => esc(member(id).pseudo)).join(', ')}` : 'Présents non renseignés'}</p>
    ${thumbs}
    <a class="tl-link" href="${href}">${photos.length ? `Voir l'album (${pluralCount(photos.length, 'photo', 'photos')})` : 'Ajouter des photos à l\'album'} ${I.arrow}</a>
  </article>`;
}

function momentCard(m) {
  const url = m.image_path ? S.urls.get(m.image_path) : null;
  const author = m.created_by ? member(m.created_by) : null;
  const mine = m.created_by === me.id || isAdmin;
  return `<article class="tl-card tl-card-moment">
    <div class="tl-kind">${I.star}<span>Moment culte · ${esc(fmtDate(dayDate(m.happened_on)))}</span></div>
    <h3 class="tl-title">${esc(m.title)}</h3>
    ${url ? `<button type="button" class="tl-moment-img" data-act="zoom" data-id="${esc(m.id)}" aria-label="Agrandir l'image de « ${esc(m.title)} »"><img src="${esc(url)}" alt="" loading="lazy"></button>` : ''}
    ${m.body ? `<p class="tl-body">${esc(m.body)}</p>` : ''}
    ${reactionBarHtml('moment', m.id)}
    <div class="tl-foot">
      ${author ? `<span class="tl-author">${avatarHtml(author, 26)}<span class="small muted">Raconté par ${esc(author.pseudo)}</span></span>` : '<span></span>'}
      ${mine ? `<span class="btn-row">
        <button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${esc(m.id)}">${I.edit}<span>Modifier</span></button>
        <button type="button" class="btn btn-danger btn-sm" data-act="delete" data-id="${esc(m.id)}">${I.trash}<span>Supprimer</span></button>
      </span>` : ''}
    </div>
  </article>`;
}

function render() {
  const all = items();
  const list = S.filter === 'all' ? all : all.filter((x) => x.kind === S.filter);
  const tl = $('#timeline');
  if (!all.length) {
    tl.innerHTML = `<div class="hist-empty">
      <p class="display hist-empty-title">La frise est encore vierge.</p>
      <p class="muted">Les éditions du Secret Santa, les sorties passées et vos moments cultes s'afficheront ici, année après année. Commence par immortaliser un souvenir.</p>
      <div class="btn-row"><button type="button" class="btn btn-light" data-act="new">+ Ajouter un moment culte</button><a class="btn btn-ghost" href="irl.html">Voir les sorties IRL</a></div>
    </div>`;
    return;
  }
  if (!list.length) {
    tl.innerHTML = `<p class="empty">Rien dans la catégorie « ${esc(FILTER_LABEL[S.filter])} » pour l'instant.</p>`;
    return;
  }
  const years = new Map();
  for (const it of list) years.set(it.year, [...(years.get(it.year) || []), it]);
  tl.innerHTML = [...years.entries()].sort((a, b) => b[0] - a[0]).map(([y, its]) => `
    <section class="tl-year" aria-labelledby="y-${y}">
      <h2 class="tl-year-title" id="y-${y}"><span>${y}</span><span class="tl-year-count small muted">${pluralCount(its.length, 'souvenir', 'souvenirs')}</span></h2>
      <ol class="tl-items">
        ${its.map((it) => `<li class="tl-item tl-${it.kind}"><span class="tl-dot" aria-hidden="true"></span><span class="visually-hidden">${KIND_LABEL[it.kind]}</span>${it.html}</li>`).join('')}
      </ol>
    </section>`).join('');
}

async function refresh() {
  try { await load(); render(); } catch (e) {
    $('#timeline').innerHTML = '<p class="empty">Impossible de charger l\'historique pour le moment.</p>';
    toast(`Chargement impossible : ${errMsg(e)}`, 'error');
  }
}

/* ---------- Interactions ---------- */
$$('.hf').forEach((b) => b.addEventListener('click', () => {
  S.filter = b.dataset.filter;
  $$('.hf').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  render();
  $('#hist-live').textContent = `Filtre : ${FILTER_LABEL[S.filter]}`;
}));

// Révélation chargée à la première ouverture
$('#timeline').addEventListener('toggle', async (e) => {
  const d = e.target;
  if (!d.matches?.('details.reveal') || !d.open) return;
  const id = d.dataset.edition;
  const body = $('.reveal-body', d);
  if (!S.reveals.has(id)) {
    const { data, error } = await sb.rpc('hg_ss_reveal', { p_edition: id });
    if (error) { body.innerHTML = '<p class="small muted">Révélation indisponible.</p>'; toast(errMsg(error), 'error'); return; }
    S.reveals.set(id, data || []);
  }
  const rows = S.reveals.get(id);
  body.innerHTML = rows.length
    ? `<ul class="reveal-list">${rows.map((r) => `<li><span>${esc(r.giver)}</span><span class="reveal-arrow" aria-label="offrait à">${I.arrow}</span><span>${esc(r.receiver)}</span></li>`).join('')}</ul>`
    : '<p class="small muted">Aucune attribution enregistrée pour cette édition.</p>';
}, true);

$('#timeline').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const m = S.moments.find((x) => x.id === b.dataset.id);
  if (b.dataset.act === 'new') openMomentDialog();
  else if (b.dataset.act === 'edit' && m) openMomentDialog(m);
  else if (b.dataset.act === 'delete' && m) deleteMoment(m);
  else if (b.dataset.act === 'zoom' && m) openLightbox([{ url: S.urls.get(m.image_path), alt: m.title, caption: m.title }]);
});
$('#btn-moment').addEventListener('click', () => openMomentDialog());

async function deleteMoment(m) {
  if (!(await confirmBox(`Supprimer le moment « ${m.title} » ?`, '', { ok: 'Supprimer', danger: true }))) return;
  const { error } = await sb.from('hg_moments').delete().eq('id', m.id);
  if (error) return toast(`Suppression impossible : ${errMsg(error)}`, 'error');
  if (m.image_path && (isAdmin || m.image_path.startsWith(`${me.id}/`))) removeObjects([m.image_path]).catch(() => {});
  toast('Moment supprimé.', 'ok');
  await refresh();
}

/* ---------- Formulaire moment ---------- */
const dlg = $('#moment-dialog');
const form = $('#moment-form');
let editing = null;
$$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function openMomentDialog(m = null) {
  editing = m;
  form.reset();
  $('#mo-dlg-title').textContent = m ? 'Modifier le moment' : 'Ajouter un moment culte';
  $('#mo-submit').textContent = m ? 'Enregistrer' : 'Ajouter';
  form.elements.title.value = m?.title || '';
  form.elements.body.value = m?.body || '';
  form.elements.happened_on.value = m?.happened_on || todayIso();
  godLimit(form.elements.happened_on, 'max', todayIso()); // date future autorisée en mode sans limite (admin)
  $('label[for="mo-date"]').innerHTML = `Date${godTag()}`;
  const cur = $('#mo-image-current');
  cur.hidden = !m?.image_path;
  cur.innerHTML = m?.image_path ? `<label class="check"><input type="checkbox" name="remove_image"><span>Retirer l'image actuelle</span></label>` : '';
  dlg.showModal();
  form.elements.title.focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = form.elements;
  const title = f.title.value.trim();
  if (!title) { toast('Donne un titre à ce moment.', 'error'); f.title.focus(); return; }
  if (!f.happened_on.value) { toast('Indique la date du moment.', 'error'); f.happened_on.focus(); return; }
  const payload = { title, body: f.body.value.trim() || null, happened_on: f.happened_on.value };
  const file = f.image.files[0];
  const removeImg = !!f.remove_image?.checked;
  const old = editing?.image_path || null;
  const btn = $('#mo-submit');
  btn.disabled = true;
  let newPath = null;
  try {
    if (file) {
      const img = await prepareImage(file);
      newPath = `${me.id}/moments/${uuid()}.${img.ext}`;
      await uploadImage(newPath, img.blob);
      payload.image_path = newPath;
    } else if (removeImg) payload.image_path = null;

    const { error } = editing
      ? await sb.from('hg_moments').update(payload).eq('id', editing.id)
      : await sb.from('hg_moments').insert({ ...payload, created_by: me.id });
    if (error) throw error;
    if (old && (file || removeImg) && (isAdmin || old.startsWith(`${me.id}/`))) removeObjects([old]).catch(() => {});
    toast(editing ? 'Moment mis à jour.' : 'Moment ajouté à la frise.', 'ok');
    dlg.close();
    await refresh();
  } catch (err) {
    if (newPath) removeObjects([newPath]).catch(() => {});
    toast(`Enregistrement impossible : ${errMsg(err)}`, 'error');
  } finally { btn.disabled = false; }
});

await refresh();
