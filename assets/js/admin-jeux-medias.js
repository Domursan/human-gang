// ===== Humane Gang — administration : Framed du ciné-club (J9) et Heardle du gang (J10) =====
/*
 * Rôle : Jeux et cartes › Framed et Heardle. Deux parties :
 *  - Framed : films vus au ciné-club (titre, année, date de séance, spectateurs) avec jusqu'à 6 images envoyées dans le
 *    bucket privé hg-jeux (framed/<film>/<n>.webp, compressées par image-compress.js), et calendrier des manches.
 *  - Heardle : propositions des membres à valider ou écarter, morceaux (lien YouTube, instant de départ), calendrier,
 *    annulation d'une manche (vidéo supprimée ou bloquée).
 * Droits : Staff « souvenirs » et administrateur (contrôlés aussi par les RPC, journalisées).
 * Route : #fete/framed-heardle (branchée par admin.js). Section : <section id="jeux-medias">, conteneur #jeux-medias-root.
 * RPC : hg_framed_admin, hg_framed_film_save, hg_framed_round_save, hg_heardle_admin, hg_heardle_track_save, hg_heardle_round_save.
 * Exporte : mountJeuxMediasSection.
 */
import { sb, toast, errMsg, esc } from './core.js';
import { prepareImage } from './image-compress.js';

const BUCKET = 'hg-jeux';
const dfmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Zurich' });
const day = (d) => (d ? dfmt.format(new Date(d + 'T12:00:00Z')) : '');
let root = null;
const S = { part: 'framed', F: null, H: null, edit: null, editT: null, urls: {}, files: {}, busy: false };

/**
 * Monte la section.
 * @param {HTMLElement} el Conteneur #jeux-medias-root.
 */
export async function mountJeuxMediasSection(el) {
  root = el;
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('change', onChange);
  await load();
}

/** Charge les deux parties. */
async function load() {
  const [f, h] = await Promise.all([sb.rpc('hg_framed_admin'), sb.rpc('hg_heardle_admin')]);
  S.F = f.error || !f.data ? { error: f.error ? errMsg(f.error) : 'Données indisponibles' } : f.data;
  S.H = h.error || !h.data ? { error: h.error ? errMsg(h.error) : 'Données indisponibles' } : h.data;
  const paths = (S.F.films || []).flatMap((x) => x.frames || []).filter((p) => !S.urls[p]);
  if (paths.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(paths, 600);
    for (const r of data || []) if (r.signedUrl) S.urls[r.path] = r.signedUrl;
  }
  render();
}

/** Dessine la section. */
function render() {
  root.innerHTML = `<div class="jm">
    <div class="jm-tabs" role="group" aria-label="Jeu">
      <button type="button" class="jm-chip" data-part="framed" aria-pressed="${S.part === 'framed'}">Framed du ciné-club</button>
      <button type="button" class="jm-chip" data-part="heardle" aria-pressed="${S.part === 'heardle'}">Heardle du gang</button>
    </div>
    ${S.part === 'framed' ? framedHtml() : heardleHtml()}</div>`;
}

/* ---------- Framed ---------- */
function framedHtml() {
  const F = S.F;
  if (F.error) return `<div class="empty">${esc(F.error)}</div>`;
  const usable = F.films.filter((f) => f.active && f.frames.length >= 3 && !f.day);
  const rounds = F.rounds.map((r) => `<li class="jm-row"><span class="jm-day">${esc(day(r.day))}</span><span class="jm-t">${esc(r.title)}</span>
      <span class="small muted">${esc(r.players)} joueur${r.players > 1 ? 's' : ''}</span>
      ${r.day >= F.today && !r.players ? `<button type="button" class="btn btn-ghost" data-act="f-unround" data-day="${esc(r.day)}">Retirer</button>` : ''}</li>`).join('');
  const films = F.films.map((f) => `<li class="jm-row"><span class="jm-t"><strong>${esc(f.title)}</strong>${f.year ? ` (${esc(f.year)})` : ''}${f.active ? '' : ' <span class="pill">masqué</span>'}</span>
      <span class="small muted">${f.seen_on ? `vu le ${esc(day(f.seen_on))} · ` : ''}${esc(f.frames.length)}/6 images${f.day ? ` · manche du ${esc(day(f.day))}` : ''}</span>
      <button type="button" class="btn btn-ghost" data-act="f-edit" data-id="${esc(f.id)}">Modifier</button></li>`).join('');
  return `<section class="jm-sec" aria-labelledby="jm-f-cal"><h3 id="jm-f-cal">Calendrier des manches</h3>
      <p class="small muted">Rythme conseillé : 3 films par semaine. Un film ne revient jamais ; la manche du jour ne change plus dès qu’un membre a joué.</p>
      <form class="jm-inline" id="jm-f-round"><label for="jm-f-day">Jour</label><input type="date" id="jm-f-day" class="input" min="${esc(F.today)}" value="${esc(F.today)}" required>
        <label for="jm-f-film">Film</label><select id="jm-f-film" class="input" required>${usable.map((f) => `<option value="${esc(f.id)}">${esc(f.title)}</option>`).join('') || '<option value="">Aucun film prêt (3 images au moins)</option>'}</select>
        <button type="submit" class="btn btn-primary" ${usable.length ? '' : 'disabled'}>Programmer</button></form>
      <ul class="jm-list">${rounds || '<li class="empty">Aucune manche programmée.</li>'}</ul></section>
    <section class="jm-sec" aria-labelledby="jm-f-films"><div class="jm-sec-h"><h3 id="jm-f-films">Films du ciné-club (${esc(F.films.length)})</h3>
      <button type="button" class="btn btn-primary" data-act="f-new">+ Nouveau film</button></div>
      ${S.edit ? filmFormHtml() : ''}
      <ul class="jm-list">${films || '<li class="empty">Aucun film.</li>'}</ul></section>`;
}

/** Formulaire d'un film (6 emplacements d'image). */
function filmFormHtml() {
  const f = S.edit;
  const slots = Array.from({ length: 6 }, (_, i) => {
    const p = f.frames[i], url = S.files[i] ? URL.createObjectURL(S.files[i]) : p && S.urls[p];
    return `<div class="jm-slot"><span class="small">Image ${i + 1}${i === 0 ? ' (la plus difficile)' : i === 5 ? ' (la plus facile)' : ''}</span>
      ${url ? `<img src="${esc(url)}" alt="Image ${i + 1}">` : '<span class="jm-empty muted small">vide</span>'}
      <input type="file" accept="image/png,image/jpeg,image/webp" data-slot="${i}" aria-label="Image ${i + 1}"></div>`;
  }).join('');
  return `<form class="card jm-form" id="jm-film-form"><h4>${f.id ? 'Modifier le film' : 'Nouveau film'}</h4>
    <div class="jm-grid">
      <div class="field"><label for="jm-title">Titre</label><input id="jm-title" class="input" maxlength="120" required value="${esc(f.title || '')}"></div>
      <div class="field"><label for="jm-year">Année</label><input id="jm-year" class="input" type="number" min="1890" max="2100" value="${esc(f.year || '')}"></div>
      <div class="field"><label for="jm-seen">Vu en séance le</label><input id="jm-seen" class="input" type="date" value="${esc(f.seen_on || '')}"></div>
      <div class="field"><label for="jm-viewers">Spectateurs</label><input id="jm-viewers" class="input" type="number" min="0" max="500" value="${esc(f.viewers ?? '')}"></div>
    </div>
    <label class="check"><input type="checkbox" id="jm-active" ${f.active !== false ? 'checked' : ''}> Proposé dans les suggestions</label>
    <p class="small muted">Quelques images fixes, jamais publiques : des plans sans titre ni générique, de la plus énigmatique à la plus parlante.</p>
    <div class="jm-slots">${slots}</div>
    <div class="jm-actions"><button type="button" class="btn btn-ghost" data-act="f-cancel">Annuler</button><button type="submit" class="btn btn-primary" ${S.busy ? 'disabled' : ''}>Enregistrer</button></div></form>`;
}

/** Enregistre le film : envoie les nouvelles images puis la fiche. */
async function saveFilm() {
  const f = S.edit, id = f.id || crypto.randomUUID();
  S.busy = true;
  try {
    const frames = [...f.frames];
    for (const [i, file] of Object.entries(S.files)) {
      const img = await prepareImage(file, { max: 1280 });
      if (!['webp', 'jpg', 'png'].includes(img.ext)) throw new Error('Format d’image non accepté (WebP, JPEG ou PNG)');
      const path = `framed/${id}/${Number(i) + 1}.${img.ext}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, img.blob, { contentType: img.contentType, upsert: true });
      if (error) throw error;
      frames[i] = path;
      S.urls[path] = null;
    }
    const v = (s) => root.querySelector(s).value.trim();
    const { error } = await sb.rpc('hg_framed_film_save', { p: { id, title: v('#jm-title'), year: v('#jm-year'), seen_on: v('#jm-seen'), viewers: v('#jm-viewers'),
      active: root.querySelector('#jm-active').checked, frames: frames.filter(Boolean) } });
    if (error) throw error;
    toast('Film enregistré.', 'ok');
    S.edit = null; S.files = {};
  } catch (e) { toast(errMsg(e), 'error'); }
  S.busy = false;
  await load();
}

/* ---------- Heardle ---------- */
function heardleHtml() {
  const H = S.H;
  if (H.error) return `<div class="empty">${esc(H.error)}</div>`;
  const props = H.tracks.filter((t) => t.status === 'propose');
  const ok = H.tracks.filter((t) => t.status === 'valide');
  const free = ok.filter((t) => !t.day);
  const yt = (t) => `https://www.youtube.com/watch?v=${encodeURIComponent(t.youtube_id)}&t=${t.start_s}s`;
  const row = (t, acts) => `<li class="jm-row"><span class="jm-t"><strong>${esc(t.artist)} — ${esc(t.title)}</strong></span>
      <span class="small muted">départ ${esc(t.start_s)} s${t.proposed_pseudo ? ` · proposé par ${esc(t.proposed_pseudo)}` : ''}${t.shared_on ? ` · ${esc(t.shared_on)}` : ''}${t.day ? ` · manche du ${esc(day(t.day))}` : ''}</span>
      <a class="btn btn-ghost" href="${esc(yt(t))}" target="_blank" rel="noopener">Écouter</a>${acts}</li>`;
  const rounds = H.rounds.map((r) => `<li class="jm-row"><span class="jm-day">${esc(day(r.day))}</span><span class="jm-t">${esc(r.artist)} — ${esc(r.title)}${r.cancelled ? ' <span class="pill">annulée</span>' : ''}</span>
      <span class="small muted">${esc(r.players)} joueur${r.players > 1 ? 's' : ''}</span>
      ${r.day >= H.today && !r.cancelled ? `<button type="button" class="btn btn-ghost" data-act="h-cancel" data-day="${esc(r.day)}">Annuler la manche</button>` : ''}</li>`).join('');
  return `<section class="jm-sec" aria-labelledby="jm-h-cal"><h3 id="jm-h-cal">Calendrier des manches</h3>
      <p class="small muted">Vérifie que la vidéo se lit en Suisse avant de la programmer. Une vidéo supprimée : « Annuler la manche ».</p>
      <form class="jm-inline" id="jm-h-round"><label for="jm-h-day">Jour</label><input type="date" id="jm-h-day" class="input" min="${esc(H.today)}" value="${esc(H.today)}" required>
        <label for="jm-h-track">Morceau</label><select id="jm-h-track" class="input" required>${free.map((t) => `<option value="${esc(t.id)}">${esc(t.artist)} — ${esc(t.title)}</option>`).join('') || '<option value="">Aucun morceau libre</option>'}</select>
        <button type="submit" class="btn btn-primary" ${free.length ? '' : 'disabled'}>Programmer</button></form>
      <ul class="jm-list">${rounds || '<li class="empty">Aucune manche programmée.</li>'}</ul></section>
    <section class="jm-sec" aria-labelledby="jm-h-props"><h3 id="jm-h-props">Propositions des membres (${esc(props.length)})</h3>
      <ul class="jm-list">${props.map((t) => row(t, `<button type="button" class="btn btn-primary" data-act="h-edit" data-id="${esc(t.id)}">Valider…</button><button type="button" class="btn btn-ghost" data-act="h-reject" data-id="${esc(t.id)}">Écarter</button>`)).join('') || '<li class="empty">Aucune proposition en attente.</li>'}</ul></section>
    <section class="jm-sec" aria-labelledby="jm-h-tracks"><div class="jm-sec-h"><h3 id="jm-h-tracks">Morceaux du gang (${esc(ok.length)})</h3>
      <button type="button" class="btn btn-primary" data-act="h-new">+ Nouveau morceau</button></div>
      ${S.editT ? trackFormHtml() : ''}
      <ul class="jm-list">${ok.map((t) => row(t, `<button type="button" class="btn btn-ghost" data-act="h-edit" data-id="${esc(t.id)}">Modifier</button>`)).join('') || '<li class="empty">Aucun morceau.</li>'}</ul></section>`;
}

/** Formulaire d'un morceau. */
function trackFormHtml() {
  const t = S.editT;
  return `<form class="card jm-form" id="jm-track-form"><h4>${t.id ? (t.status === 'propose' ? 'Valider la proposition' : 'Modifier le morceau') : 'Nouveau morceau'}</h4>
    <div class="jm-grid">
      <div class="field"><label for="jm-t-title">Titre</label><input id="jm-t-title" class="input" maxlength="120" required value="${esc(t.title || '')}"></div>
      <div class="field"><label for="jm-t-artist">Artiste</label><input id="jm-t-artist" class="input" maxlength="120" required value="${esc(t.artist || '')}"></div>
      <div class="field"><label for="jm-t-yt">Lien ou identifiant YouTube</label><input id="jm-t-yt" class="input" maxlength="200" required value="${esc(t.youtube_id || '')}"></div>
      <div class="field"><label for="jm-t-start">Départ (secondes)</label><input id="jm-t-start" class="input" type="number" min="0" max="36000" value="${esc(t.start_s ?? 0)}"></div>
      <div class="field"><label for="jm-t-where">Où et quand</label><input id="jm-t-where" class="input" maxlength="60" value="${esc(t.shared_on || '')}" placeholder="#musique, mars 2023"></div>
    </div>
    <div class="jm-actions"><button type="button" class="btn btn-ghost" data-act="h-cancel-edit">Annuler</button><button type="submit" class="btn btn-primary">${t.status === 'propose' ? 'Valider' : 'Enregistrer'}</button></div></form>`;
}

/* ---------- Événements ---------- */
async function rpc(name, args, ok) {
  const { error } = await sb.rpc(name, args);
  if (error) { toast(errMsg(error), 'error'); return; }
  if (ok) toast(ok, 'ok');
  await load();
}

function onClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.part) { S.part = b.dataset.part; render(); return; }
  const a = b.dataset.act;
  if (a === 'f-new') { S.edit = { frames: [], active: true }; S.files = {}; render(); root.querySelector('#jm-title')?.focus(); }
  if (a === 'f-edit') { S.edit = structuredClone(S.F.films.find((f) => f.id === b.dataset.id)); S.files = {}; render(); root.querySelector('#jm-title')?.focus(); }
  if (a === 'f-cancel') { S.edit = null; S.files = {}; render(); }
  if (a === 'f-unround') rpc('hg_framed_round_save', { p_day: b.dataset.day, p_film: null }, 'Manche retirée.');
  if (a === 'h-new') { S.editT = { status: 'valide' }; render(); root.querySelector('#jm-t-title')?.focus(); }
  if (a === 'h-edit') { S.editT = { ...S.H.tracks.find((t) => t.id === b.dataset.id) }; render(); root.querySelector('#jm-t-title')?.focus(); }
  if (a === 'h-cancel-edit') { S.editT = null; render(); }
  if (a === 'h-reject') { const t = S.H.tracks.find((x) => x.id === b.dataset.id); rpc('hg_heardle_track_save', { p: { ...t, status: 'retire' } }, 'Proposition écartée.'); }
  if (a === 'h-cancel') rpc('hg_heardle_round_save', { p_day: b.dataset.day, p_track: null, p_cancel: true }, 'Manche annulée.');
}

function onChange(e) {
  const i = e.target.dataset?.slot;
  if (i === undefined || !e.target.files?.[0]) return;
  // Mémorise les valeurs saisies avant de redessiner l'aperçu.
  const v = (s) => root.querySelector(s)?.value;
  Object.assign(S.edit, { title: v('#jm-title'), year: v('#jm-year'), seen_on: v('#jm-seen'), viewers: v('#jm-viewers'), active: root.querySelector('#jm-active')?.checked });
  S.files[i] = e.target.files[0];
  render();
}

async function onSubmit(e) {
  e.preventDefault();
  const id = e.target.id;
  if (id === 'jm-film-form') return saveFilm();
  if (id === 'jm-f-round') return rpc('hg_framed_round_save', { p_day: root.querySelector('#jm-f-day').value, p_film: root.querySelector('#jm-f-film').value }, 'Manche programmée.');
  if (id === 'jm-h-round') return rpc('hg_heardle_round_save', { p_day: root.querySelector('#jm-h-day').value, p_track: root.querySelector('#jm-h-track').value, p_cancel: false }, 'Manche programmée.');
  if (id === 'jm-track-form') {
    const v = (s) => root.querySelector(s).value.trim();
    const t = S.editT;
    const p = { title: v('#jm-t-title'), artist: v('#jm-t-artist'), youtube_id: v('#jm-t-yt'), start_s: Number(v('#jm-t-start')) || 0, shared_on: v('#jm-t-where'), status: 'valide' };
    if (t.id) Object.assign(p, { id: t.id, proposed_by: t.proposed_by || '' });
    S.editT = null;
    return rpc('hg_heardle_track_save', { p }, 'Morceau enregistré.');
  }
}
