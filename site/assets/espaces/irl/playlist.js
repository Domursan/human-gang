// ===== Humane Gang — Playlist du gang (playlist.html), idée S8 =====
/*
 * Rôle : partager un morceau (lien YouTube, Spotify, Deezer ou SoundCloud ; titre et artiste remplis par l'oEmbed
 * public de YouTube ou Spotify quand c'est possible), voter pour le morceau de la semaine, réagir, écouter.
 * Le lecteur intégré (iframe) ne se charge qu'au clic sur « Écouter ici » : aucun service tiers avant ce clic.
 * Page : playlist.html (membres).
 * Dépendances : core.js, reactions.js (cible « track »), contenus-ui.js.
 * Données : RPC hg_playlist (morceaux, votes, palmarès), hg_track_add, hg_track_vote, hg_members.
 * Tout texte venant de la base passe par esc(). Le fichier n'exporte rien.
 */
import { sb, initPage, esc, $, toast, errMsg } from './core.js';
import { loadReactions, reactionBarHtml } from './reactions.js';
import { loadPeople, pseudoOf, formDialog, fmtJour, chipsHtml, setPressed } from './contenus-ui.js';
import { pluralWord } from './utils.js';

const me = await initPage();

/* ---------- Liens acceptés et lecteurs intégrés ---------- */
const SAFE = '[A-Za-z0-9_?=&%./-]+';
/** Plateforme d'un lien (même liste blanche que la base, hg_track_platform), ou null. */
function platformOf(url) {
  const u = String(url || '').trim();
  if (new RegExp(`^https://(www\\.|m\\.|music\\.)?youtube\\.com/${SAFE}$`).test(u) || new RegExp(`^https://youtu\\.be/${SAFE}$`).test(u)) return 'youtube';
  if (new RegExp(`^https://open\\.spotify\\.com/${SAFE}$`).test(u)) return 'spotify';
  if (new RegExp(`^https://(www\\.|link\\.)?deezer\\.com/${SAFE}$`).test(u) || new RegExp(`^https://deezer\\.page\\.link/${SAFE}$`).test(u)) return 'deezer';
  if (new RegExp(`^https://(www\\.|on\\.|m\\.)?soundcloud\\.com/${SAFE}$`).test(u)) return 'soundcloud';
  return null;
}
const NAMES = { youtube: 'YouTube', spotify: 'Spotify', deezer: 'Deezer', soundcloud: 'SoundCloud' };

/**
 * Adresse du lecteur intégré d'un morceau, ou null si le lien ne le permet pas (lien court Deezer, chaîne YouTube…).
 * @param {{url: string, platform: string}} t
 * @returns {string|null}
 */
function embedUrl(t) {
  let u;
  try { u = new URL(t.url); } catch { return null; }
  if (t.platform === 'youtube') {
    const id = u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/) || [])[1];
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (t.platform === 'spotify') {
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode)\/([A-Za-z0-9]+)/);
    return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
  }
  if (t.platform === 'deezer') {
    const m = u.pathname.match(/^\/(?:[a-z]{2}\/)?(track|album|playlist)\/(\d+)/);
    return m ? `https://widget.deezer.com/widget/auto/${m[1]}/${m[2]}` : null;
  }
  if (t.platform === 'soundcloud' && u.hostname !== 'on.soundcloud.com') return `https://w.soundcloud.com/player/?url=${encodeURIComponent(t.url)}`;
  return null;
}

/**
 * Titre et artiste via l'oEmbed public (YouTube, Spotify), sans clé. Renvoie {} si impossible (le membre remplit à la main).
 * @param {string} url
 * @returns {Promise<{title?: string, artist?: string}>}
 */
async function oembed(url) {
  const p = platformOf(url);
  const api = p === 'youtube' ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
    : p === 'spotify' ? `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}` : null;
  if (!api) return {};
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(api, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!r.ok) return {};
    const j = await r.json();
    return { title: String(j.title || '').slice(0, 120), artist: p === 'youtube' ? String(j.author_name || '').slice(0, 120) : '' };
  } catch { return {}; } finally { clearTimeout(timer); }
}

/* ---------- État ---------- */
const S = { data: null, people: new Map(), playing: new Set(), busy: false, tag: '' };

/* ---------- Dessin ---------- */

/** Ligne d'un morceau (cette semaine : avec bouton de vote ; semaines passées : sans). */
function trackRow(t, { vote = false } = {}) {
  const mine = t.added_by === me.id;
  const voted = S.data?.my_vote === t.id;
  const n = Number(t.votes) || 0;
  const emb = embedUrl(t);
  const playing = S.playing.has(t.id);
  const meta = [t.artist, `partagé par ${pseudoOf(S.people, t.added_by) || 'un ancien membre'}`, fmtJour(t.created_at)].filter(Boolean).map(esc).join(' · ');
  return `<li class="pl-row${t.hidden ? ' is-hidden' : ''}" data-track="${esc(t.id)}">
    <span class="pl-cov pl-cov-${esc(t.platform)}" aria-hidden="true">♪</span>
    <div class="pl-main">
      <p class="pl-title">${esc(t.title)} <span class="pl-plat pl-plat-${esc(t.platform)}">${esc(NAMES[t.platform] || t.platform)}</span></p>
      <p class="small muted">${meta}</p>
      ${t.note ? `<p class="pl-note">${esc(t.note)}</p>` : ''}
      <p class="pl-tags">${t.tag ? `<span class="pill">${esc(t.tag)}</span>` : ''}${t.heardle_ok ? '<span class="pill">Heardle</span>' : ''}${t.hidden ? '<span class="pill">Masqué par le Staff</span>' : ''}</p>
    </div>
    <div class="pl-actions">
      ${vote ? (mine ? `<span class="small muted pl-own">${n} ${pluralWord(n, 'voix', 'voix')} · ton morceau</span>`
        : `<button type="button" class="btn ${voted ? 'btn-sand' : 'btn-ghost'} pl-vote" data-vote="${esc(t.id)}" aria-pressed="${voted}">${voted ? 'Ton vote' : 'Voter'} · ${n} ${pluralWord(n, 'voix', 'voix')}</button>`) : ''}
      ${emb ? `<button type="button" class="btn btn-ghost" data-play="${esc(t.id)}" aria-expanded="${playing}">${playing ? 'Fermer le lecteur' : 'Écouter ici'}</button>` : ''}
      <a class="btn btn-ghost" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Ouvrir sur ${esc(NAMES[t.platform] || 'le site')}</a>
    </div>
    ${playing && emb ? `<div class="pl-player"><iframe src="${esc(emb)}" title="Lecteur : ${esc(t.title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"
        allow="autoplay; encrypted-media; clipboard-write; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"></iframe></div>` : ''}
    ${t.hidden ? '' : reactionBarHtml('track', t.id)}
  </li>`;
}

/** Toute la page à partir de S.data. */
function draw() {
  const d = S.data;
  const week = (d.tracks || []).filter((t) => t.week_start === d.week_start);
  const older = (d.tracks || []).filter((t) => t.week_start !== d.week_start);
  const winners = d.winners || [];
  const last = winners[0];
  const box = $('#pl-winner');
  box.hidden = !last;
  if (last) {
    box.innerHTML = `<p class="eyebrow" id="pl-winner-h">Morceau de la semaine du ${esc(fmtJour(last.week_start))}</p>
      <div class="pl-winner-row"><span class="pl-cov pl-cov-big" aria-hidden="true">♪</span><p class="pl-winner-title">${esc(last.title)}</p></div>
      <p class="muted">${esc([last.artist, `partagé par ${pseudoOf(S.people, last.added_by) || 'un ancien membre'}`, `${last.votes} ${pluralWord(last.votes, 'voix', 'voix')}`].filter(Boolean).join(' · '))}</p>
      <a class="btn btn-ghost" href="${esc(last.url)}" target="_blank" rel="noopener noreferrer">Écouter sur ${esc(NAMES[last.platform] || 'le site')}</a>`;
  }
  const left = Math.max(0, (Number(d.cap) || 3) - (Number(d.today) || 0));
  $('#pl-week-info').textContent = `${week.length} ${pluralWord(week.length, 'morceau partagé', 'morceaux partagés')} depuis lundi. Il te reste ${left} ${pluralWord(left, 'partage', 'partages')} aujourd’hui.`;
  $('#pl-add').disabled = left === 0;
  const tags = [...new Set(week.map((t) => t.tag).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  if (S.tag && !tags.includes(S.tag)) S.tag = '';
  $('#pl-tags-f').innerHTML = tags.length ? chipsHtml([['', 'Cette semaine'], ...tags.map((g) => [g, g[0].toUpperCase() + g.slice(1)])], S.tag, 'tag') : '';
  const shown = week.filter((t) => !S.tag || t.tag === S.tag);
  $('#pl-week').innerHTML = shown.length ? shown.map((t) => trackRow(t, { vote: true })).join('') : '<li class="ct-empty">Aucun morceau cette semaine : lance la playlist !</li>';
  $('#pl-hof').innerHTML = winners.length ? winners.map((w) => `<li><strong>${esc(w.title)}</strong>${w.artist ? ` · ${esc(w.artist)}` : ''}
      <span class="small muted">semaine du ${esc(fmtJour(w.week_start))} · ${w.votes} ${pluralWord(w.votes, 'voix', 'voix')}</span></li>`).join('')
    : '<li class="muted small">Le premier morceau de la semaine sera désigné lundi.</li>';
  $('#pl-older-count').textContent = `(${older.length})`;
  $('#pl-older').innerHTML = older.length ? older.map((t) => trackRow(t)).join('') : '<li class="muted small">Rien pour le moment.</li>';
}

/* ---------- Données et actions ---------- */

/** Recharge la playlist (hg_playlist), l'annuaire et les réactions. */
async function load() {
  try {
    const [people, res] = await Promise.all([S.people.size ? S.people : loadPeople(), sb.rpc('hg_playlist', { p_limit: 120 })]);
    if (res.error) throw res.error;
    S.people = people;
    S.data = res.data || { tracks: [], winners: [] };
    await loadReactions('track', (S.data.tracks || []).map((t) => t.id), me.id);
    draw();
  } catch (e) {
    console.warn('[playlist]', e);
    $('#pl-week').innerHTML = '<li class="ct-empty">Playlist indisponible pour le moment. Recharge la page dans un instant.</li>';
  }
  $('#app').setAttribute('aria-busy', 'false');
}

/** Boîte « Partager un morceau » : le lien d'abord, puis titre et artiste (remplis automatiquement si possible). */
function openAdd() {
  formDialog({
    title: 'Partager un morceau',
    submit: 'Partager',
    body: `<div class="field"><label for="pa-url">Lien (YouTube, Spotify, Deezer ou SoundCloud)</label>
        <input id="pa-url" name="url" type="url" inputmode="url" maxlength="300" required placeholder="https://www.youtube.com/watch?v=…" autocomplete="off">
        <span class="small muted" id="pa-url-info" aria-live="polite"></span></div>
      <div class="field"><label for="pa-title">Titre</label><input id="pa-title" name="title" maxlength="120" required></div>
      <div class="field"><label for="pa-artist">Artiste (facultatif)</label><input id="pa-artist" name="artist" maxlength="120"></div>
      <div class="field"><label for="pa-note">Un petit mot (facultatif)</label><input id="pa-note" name="note" maxlength="200" placeholder="la musique de Satisfactory qui tourne en boucle"></div>
      <div class="field"><label for="pa-tag">Étiquette (facultatif)</label><input id="pa-tag" name="tag" maxlength="30" list="pa-tags" placeholder="jeux, Eurovision, sport, découverte…">
        <datalist id="pa-tags"><option value="jeux"><option value="eurovision"><option value="sport"><option value="découverte"><option value="ciné"></datalist></div>`,
    onSubmit: async (f) => {
      const url = f.url.value.trim();
      if (!platformOf(url)) throw new Error('Lien non accepté : YouTube, Spotify, Deezer ou SoundCloud, en https.');
      if (!f.title.value.trim()) throw new Error('Indique le titre du morceau.');
      const { error } = await sb.rpc('hg_track_add', { p_url: url, p_title: f.title.value.trim(), p_artist: f.artist.value.trim() || null,
        p_note: f.note.value.trim() || null, p_tag: f.tag.value.trim() || null });
      if (error) throw error;
      toast('Morceau partagé !', 'success');
      await load();
    },
  });
  const url = $('#pa-url'), info = $('#pa-url-info');
  url.addEventListener('change', async () => {
    const v = url.value.trim();
    const p = platformOf(v);
    if (!v) { info.textContent = ''; return; }
    if (!p) { info.textContent = 'Lien non reconnu : YouTube, Spotify, Deezer ou SoundCloud, en https.'; return; }
    info.textContent = `${NAMES[p]} reconnu.`;
    const f = url.form;
    if (f.title.value.trim()) return;
    const o = await oembed(v);
    if (o.title && !f.title.value.trim()) f.title.value = o.title;
    if (o.artist && !f.artist.value.trim()) f.artist.value = o.artist;
    info.textContent = o.title ? `${NAMES[p]} reconnu : titre rempli automatiquement, tu peux le corriger.` : `${NAMES[p]} reconnu : remplis le titre à la main.`;
  });
}

/** Vote (ou retire son vote en recliquant). */
async function vote(id) {
  if (S.busy) return;
  S.busy = true;
  try {
    const again = S.data?.my_vote === id;
    const { error } = await sb.rpc('hg_track_vote', { p_track: again ? null : id });
    if (error) throw error;
    toast(again ? 'Vote retiré.' : 'Vote enregistré !', 'success');
    await load();
    document.querySelector(`[data-vote="${CSS.escape(id)}"]`)?.focus();
  } catch (e) {
    toast(errMsg(e), 'error');
  } finally {
    S.busy = false;
  }
}

/* ---------- Écouteurs ---------- */
$('#pl-add').addEventListener('click', openAdd);
$('#app').addEventListener('click', (e) => {
  const g = e.target.closest('[data-tag]');
  if (g) { S.tag = g.dataset.tag; draw(); setPressed($('#pl-tags-f'), 'tag', S.tag); return; }
  const v = e.target.closest('[data-vote]');
  if (v) { vote(v.dataset.vote); return; }
  const p = e.target.closest('[data-play]');
  if (p) {
    const id = p.dataset.play;
    if (S.playing.has(id)) S.playing.delete(id); else S.playing.add(id);
    draw();
    document.querySelector(`[data-play="${CSS.escape(id)}"]`)?.focus();
  }
});

load();
