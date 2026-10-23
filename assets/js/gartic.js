// ===== Humane Gang — Galerie Gartic Phone (gartic.html, gartic.html?album=<id>) =====
/*
 * Rôle : chaque soirée Gartic Phone devient un album (10 chaînes au plus, les meilleures). Une chaîne = l'animation
 *   exportée par Gartic (GIF) ou une image, la phrase de départ et la phrase d'arrivée. Pas de nom d'auteur sur les dessins.
 *   La grille montre une vignette fixe (première image, fabriquée à l'envoi) ; « Voir l'animation » ouvre la visionneuse.
 *   En décembre, vote « Dessin de l'année » : une voix par membre, pas pour une chaîne qu'il a déposée.
 * Page : gartic.html (session membre requise).
 * Dépendances : core.js, photos.js (envoi, URL signées, visionneuse), reactions.js, ui-confirm.js.
 * Données : hg_gartic_parties, hg_gartic_chains (RLS) ; RPC hg_gartic_party_create, hg_gartic_add_chain, hg_gartic_hide,
 *   hg_gartic_vote, hg_gartic_state, hg_members (migration 088). Fichiers : bucket hg-photos, dossier <moi>/gartic/.
 * Exporte : GARTIC_MAX_MO, daysToDecember.
 */
import { sb, initPage, esc, $, errMsg, toast, hasPerm, loadMyPerms } from './core.js';
import { uploadImage, signedUrls, openLightbox, uuid } from './photos.js';
import { loadReactions, reactionBarHtml } from './reactions.js';
import { confirmBox } from './ui-confirm.js';

/** Poids maximal d'une chaîne (Mo). */
export const GARTIC_MAX_MO = 8;
/** Jours restants avant le 1er décembre (heure locale) ; 0 en décembre. */
export function daysToDecember(now = new Date()) {
  if (now.getMonth() === 11) return 0;
  const d = new Date(now.getFullYear(), 11, 1);
  return Math.ceil((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
}

const me = await initPage();
await loadMyPerms().catch(() => null);
const staff = hasPerm('souvenirs');
const albumId = new URLSearchParams(location.search).get('album');
const root = $('#gartic-root');
const dayFmt = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtDay = (d) => dayFmt.format(new Date(`${String(d).slice(0, 10)}T12:00:00Z`));
const S = { parties: [], chains: [], urls: new Map(), state: null, people: new Map(), cur: 0 };

/* ---------- Données ---------- */
async function load() {
  const [p, c, st, m] = await Promise.all([
    sb.from('hg_gartic_parties').select('id,played_on,title,created_by,hidden').order('played_on', { ascending: false }),
    sb.from('hg_gartic_chains').select('id,party_id,path,thumb_path,prompt_start,prompt_end,created_by,hidden,created_at').order('created_at'),
    sb.rpc('hg_gartic_state'),
    sb.rpc('hg_members'),
  ]);
  if (p.error) throw p.error;
  if (c.error) throw c.error;
  S.parties = p.data || [];
  S.chains = c.data || [];
  S.state = st.data || null;
  S.people = new Map((m.data || []).map((x) => [x.id, x]));
  const shown = albumId ? S.chains.filter((x) => x.party_id === albumId) : S.chains;
  S.urls = await signedUrls(shown.flatMap((x) => [x.thumb_path || x.path, albumId ? x.path : null]));
  if (albumId) await loadReactions('gartic', shown.map((x) => x.id), me.id);
}
const chainsOf = (pid) => S.chains.filter((x) => x.party_id === pid && !x.hidden);
const thumbOf = (x) => S.urls.get(x.thumb_path || x.path) || '';

/* ---------- Vote ---------- */
function paintVote() {
  const box = $('#gartic-vote');
  const st = S.state;
  if (!st) { box.hidden = true; return; }
  const year = st.year;
  const nYear = S.chains.filter((x) => !x.hidden && String(S.parties.find((p) => p.id === x.party_id)?.played_on || '').startsWith(String(year))).length;
  let body;
  if (st.vote_open) {
    const mine = S.chains.find((x) => x.id === st.my_vote);
    body = `<p class="small muted">Le vote est ouvert : une voix parmi les ${nYear} chaîne${nYear > 1 ? 's' : ''} de l’année, pas pour une chaîne que tu as déposée. Tu peux changer d’avis jusqu’à la fin du vote.</p>
      <p class="small">${mine ? `Ton vote : <strong>« ${esc(mine.prompt_start)} »</strong>` : 'Tu n’as pas encore voté : ouvre un album et choisis.'}</p>`;
  } else if (Array.isArray(st.results) && st.results.length) {
    const win = S.chains.find((x) => x.id === st.results[0].chain_id);
    body = win ? `<p class="small muted">Le gagnant, avec ${st.results[0].votes} voix :</p>
      <a class="gartic-win" href="gartic.html?album=${encodeURIComponent(win.party_id)}">${thumbOf(win) ? `<img src="${esc(thumbOf(win))}" alt="">` : ''}<span>« ${esc(win.prompt_start)} » → « ${esc(win.prompt_end)} »</span></a>` : '<p class="small muted">Vote terminé.</p>';
  } else {
    const n = daysToDecember();
    body = `<p class="small muted">${n ? `Le vote ouvre le 1er décembre : une voix parmi les ${nYear} chaîne${nYear > 1 ? 's' : ''} de l’année, pas pour une chaîne que tu as déposée.` : 'Le vote est fermé.'}</p>
      ${n ? `<button type="button" class="btn btn-ghost" disabled>Ouvre dans ${n} jour${n > 1 ? 's' : ''}</button>` : ''}`;
  }
  box.innerHTML = `<h2 class="gartic-vote-h">🏆 Dessin de l’année ${esc(year)}</h2>${body}`;
  box.hidden = false;
}

/* ---------- Liste des albums ---------- */
function paintAlbums() {
  const list = S.parties.filter((p) => !p.hidden || staff);
  if (!list.length) { root.innerHTML = '<p class="card ludo-empty">Pas encore d’album. Après la prochaine soirée, crée le sien et dépose les meilleures chaînes !</p>'; return; }
  root.innerHTML = `<ul class="gartic-albums">${list.map((p) => {
    const ch = chainsOf(p.id);
    const t = ch[0] ? thumbOf(ch[0]) : '';
    return `<li><a class="gartic-album" href="gartic.html?album=${encodeURIComponent(p.id)}">
      <span class="gartic-album-img">${t ? `<img src="${esc(t)}" alt="" loading="lazy">` : '<span class="thumb-missing" aria-hidden="true"></span>'}</span>
      <span class="gartic-album-body"><span class="gartic-album-t">${esc(p.title)}</span>
        <span class="small muted">${esc(fmtDay(p.played_on))} · ${ch.length} chaîne${ch.length > 1 ? 's' : ''}${p.hidden ? ' · masqué' : ''}</span></span>
    </a></li>`;
  }).join('')}</ul>
  <p class="small muted gartic-note">Pas de nom d’auteur sur les dessins : Gartic les mélange, et c’est mieux comme ça.</p>`;
}

/* ---------- Un album ---------- */
function paintAlbum() {
  const p = S.parties.find((x) => x.id === albumId);
  if (!p) { root.innerHTML = '<p class="card ludo-empty">Album introuvable. <a href="gartic.html">Toute la galerie</a></p>'; return; }
  $('.gartic-head').hidden = true;
  $('.jeu-back a').href = 'gartic.html';
  $('.jeu-back a').textContent = '← Galerie Gartic Phone';
  const ch = staff ? S.chains.filter((x) => x.party_id === p.id) : chainsOf(p.id);
  const visibleCount = chainsOf(p.id).length;
  S.cur = Math.min(S.cur, Math.max(0, ch.length - 1));
  const c = ch[S.cur];
  const author = S.people.get(p.created_by)?.pseudo;
  const st = S.state || {};
  const canVote = c && st.vote_open && c.created_by !== me.id && String(p.played_on).startsWith(String(st.year)) && !c.hidden;
  root.innerHTML = `<div class="gartic-album-head">
      <p class="eyebrow">Album · ${visibleCount} chaîne${visibleCount > 1 ? 's' : ''}</p>
      <h1 class="page-title gartic-title">${esc(p.title)}</h1>
      <p class="small muted">${esc(fmtDay(p.played_on))}${author ? ` · créé par ${esc(author)}` : ''}</p>
    </div>
    ${c ? `<section class="card gartic-chain${c.hidden ? ' is-hidden' : ''}" aria-labelledby="gartic-chain-h" aria-live="polite">
      <div class="jeu-between"><h2 class="pill gartic-pill" id="gartic-chain-h">Chaîne ${S.cur + 1} sur ${ch.length}</h2>${c.hidden ? '<span class="pill pill-todo">Masquée</span>' : ''}</div>
      <div class="gartic-phr"><span class="gartic-lbl">Phrase de départ</span><p>« ${esc(c.prompt_start)} »</p></div>
      <button type="button" class="gartic-frame" data-anim aria-label="Voir l’animation en grand">${thumbOf(c) ? `<img src="${esc(thumbOf(c))}" alt="Dessins de la chaîne « ${esc(c.prompt_start)} »">` : '<span class="thumb-missing" aria-hidden="true"></span>'}</button>
      <div class="gartic-phr gartic-phr-end"><span class="gartic-lbl">Phrase d’arrivée</span><p>« ${esc(c.prompt_end)} »</p></div>
      ${reactionBarHtml('gartic', c.id)}
      <div class="gartic-actions">
        <button type="button" class="btn btn-ghost" data-anim>Voir l’animation</button>
        ${canVote ? `<button type="button" class="btn ${st.my_vote === c.id ? 'btn-sand' : 'btn-ghost'}" data-vote aria-pressed="${st.my_vote === c.id}">${st.my_vote === c.id ? 'Ton vote de l’année' : 'Voter pour cette chaîne'}</button>` : ''}
        ${c.created_by === me.id && !c.hidden ? '<button type="button" class="btn btn-ghost" data-remove>Retirer ma chaîne</button>' : ''}
        ${staff ? `<button type="button" class="btn btn-ghost" data-hide="${c.hidden ? '0' : '1'}">${c.hidden ? 'Remettre' : 'Masquer'}</button>` : ''}
      </div>
    </section>` : '<p class="card ludo-empty">Pas encore de chaîne dans cet album.</p>'}
    ${ch.length > 1 ? `<div class="gartic-strip" role="group" aria-label="Chaînes de l’album">${ch.map((x, i) => `<button type="button" class="gartic-mini" data-pick="${i}" aria-pressed="${i === S.cur}" aria-label="Chaîne ${i + 1}">
      ${thumbOf(x) ? `<img src="${esc(thumbOf(x))}" alt="" loading="lazy">` : ''}<span>Chaîne ${i + 1}</span></button>`).join('')}</div>` : ''}
    ${visibleCount < 10 ? '<p><button type="button" class="btn btn-sand" data-add>Déposer une chaîne</button></p>' : '<p class="small muted">Album complet : 10 chaînes, les meilleures.</p>'}
    <p class="small muted gartic-note">Pas de nom d’auteur sur les dessins : Gartic les mélange, et c’est mieux comme ça.</p>`;
}

function paint() { paintVote(); if (albumId) paintAlbum(); else paintAlbums(); }
async function refresh() { await load(); paint(); }

/* ---------- Formulaires ---------- */
function dialog(title, bodyHtml, submitLabel, onSubmit) {
  const d = document.createElement('dialog');
  d.className = 'hg-dialog';
  d.setAttribute('aria-labelledby', 'ga-dlg-t');
  d.innerHTML = `<form class="stack" novalidate>
    <div class="dlg-head"><h2 class="dlg-title" id="ga-dlg-t">${esc(title)}</h2><button class="btn btn-ghost dlg-x" type="button" data-close aria-label="Fermer">✕</button></div>
    ${bodyHtml}<p class="form-error" role="alert" hidden></p>
    <div class="btn-row dlg-foot"><button type="button" class="btn btn-ghost" data-close>Annuler</button><button type="submit" class="btn btn-sand">${esc(submitLabel)}</button></div></form>`;
  document.body.append(d);
  const opener = document.activeElement;
  const f = d.querySelector('form'), err = d.querySelector('.form-error');
  d.addEventListener('close', () => { d.remove(); opener?.focus?.(); }, { once: true });
  for (const b of d.querySelectorAll('[data-close]')) b.addEventListener('click', () => d.close());
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]'); btn.disabled = true; err.hidden = true;
    const m = await onSubmit(f);
    btn.disabled = false;
    if (m) { err.textContent = m; err.hidden = false; return; }
    d.close();
  });
  d.showModal();
  f.querySelector('input,textarea')?.focus();
}

function openNewAlbum() {
  const today = new Date(); const pad = (n) => String(n).padStart(2, '0');
  const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  dialog('Nouvel album', `<div class="field"><label for="ga-d">Date de la soirée</label><input id="ga-d" name="d" type="date" required max="${iso}" value="${iso}"></div>
    <div class="field"><label for="ga-t">Titre</label><input id="ga-t" name="t" maxlength="80" required value="Soirée du ${esc(fmtDay(iso))}"></div>`, 'Créer l’album', async (f) => {
    const { data, error } = await sb.rpc('hg_gartic_party_create', { p_played_on: f.d.value, p_title: f.t.value.trim() });
    if (error) return errMsg(error);
    location.href = `gartic.html?album=${encodeURIComponent(data)}`;
    return null;
  });
}

/**
 * Vignette fixe d'une image animée : la première image, réduite à 480 px de côté, en WebP (JPEG en repli).
 * @param {File} file GIF ou image
 * @returns {Promise<Blob|null>}
 */
async function stillOf(file) {
  try {
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url; await img.decode();
    const k = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    return await new Promise((r) => cv.toBlob(r, 'image/webp', 0.8)) || await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
  } catch { return null; }
}

const EXT = { 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
function openAddChain() {
  dialog('Déposer une chaîne', `<p class="small muted">L’animation exportée par Gartic (GIF) ou une image, ${GARTIC_MAX_MO} Mo au plus. Seulement les meilleures : 10 par album.</p>
    <div class="field"><label for="ga-f">Fichier</label><input id="ga-f" name="f" type="file" accept="image/gif,image/png,image/jpeg,image/webp" required></div>
    <div class="field"><label for="ga-s">Phrase de départ</label><input id="ga-s" name="s" maxlength="140" required placeholder="Un canard qui fait ses impôts"></div>
    <div class="field"><label for="ga-e">Phrase d’arrivée</label><input id="ga-e" name="e" maxlength="140" required placeholder="Le Tzatzikistan déclare la guerre"></div>`, 'Déposer', async (f) => {
    const file = f.f.files[0];
    if (!file) return 'Choisis un fichier.';
    if (!EXT[file.type]) return 'Format accepté : GIF, PNG, JPEG ou WebP.';
    if (file.size > GARTIC_MAX_MO * 1024 * 1024) return `Fichier trop lourd : ${GARTIC_MAX_MO} Mo au plus.`;
    if (!f.s.value.trim() || !f.e.value.trim()) return 'Écris la phrase de départ et la phrase d’arrivée.';
    try {
      const id = uuid(), base = `${me.id}/gartic/${id}`;
      const path = await uploadImage(`${base}.${EXT[file.type]}`, file);
      const still = await stillOf(file);
      const thumb = still ? await uploadImage(`${base}-v.${still.type === 'image/webp' ? 'webp' : 'jpg'}`, still) : null;
      const { error } = await sb.rpc('hg_gartic_add_chain', { p_party: albumId, p_path: path, p_thumb: thumb, p_start: f.s.value.trim(), p_end: f.e.value.trim() });
      if (error) throw error;
    } catch (e) { return `Envoi impossible : ${errMsg(e)}`; }
    toast('Chaîne ajoutée à l’album.', 'ok');
    await refresh();
    S.cur = chainsOf(albumId).length - 1; paint();
    return null;
  });
}

/* ---------- Événements ---------- */
$('#gartic-new').addEventListener('click', openNewAlbum);
root.addEventListener('click', async (e) => {
  const ch = (staff ? S.chains.filter((x) => x.party_id === albumId) : chainsOf(albumId));
  const c = ch[S.cur];
  const pick = e.target.closest('[data-pick]');
  if (pick) { S.cur = Number(pick.dataset.pick); paintAlbum(); root.querySelector(`[data-pick="${S.cur}"]`)?.focus(); return; }
  if (e.target.closest('[data-add]')) return openAddChain();
  if (!c) return;
  if (e.target.closest('[data-anim]')) {
    const url = S.urls.get(c.path) || thumbOf(c);
    openLightbox([{ url, alt: `Chaîne « ${c.prompt_start} »`, caption: `« ${c.prompt_start} » → « ${c.prompt_end} »` }], 0);
    return;
  }
  if (e.target.closest('[data-vote]')) {
    const { error } = await sb.rpc('hg_gartic_vote', { p_chain: c.id });
    if (error) { toast(errMsg(error), 'error'); return; }
    toast('Vote enregistré.', 'ok'); await refresh(); root.querySelector('[data-vote]')?.focus(); return;
  }
  const hide = e.target.closest('[data-remove], [data-hide]');
  if (hide) {
    const on = hide.dataset.hide !== '0';
    if (on && !(await confirmBox(hide.dataset.remove != null ? 'Retirer ta chaîne de l’album ?' : 'Masquer cette chaîne ?', '', { ok: 'Confirmer', danger: true }))) return;
    const { error } = await sb.rpc('hg_gartic_hide', { p_kind: 'chain', p_id: c.id, p_hidden: on });
    if (error) { toast(errMsg(error), 'error'); return; }
    toast(on ? 'Chaîne retirée.' : 'Chaîne remise.', 'ok'); S.cur = 0; await refresh();
  }
});

/* ---------- Lancement ---------- */
try { await load(); paint(); } catch (e) { root.innerHTML = `<p class="card ludo-empty">Impossible de charger la galerie (${esc(errMsg(e))}).</p>`; }
$('#app').removeAttribute('aria-busy');
