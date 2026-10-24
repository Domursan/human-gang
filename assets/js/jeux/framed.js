// ===== Humane Gang — page « Jeux », onglet Framed du ciné-club (idée J9) =====
/*
 * Rôle : deviner l'élément du jour (un film du ciné-club, une affiche ou un tuto du site) à partir d'images qui se dévoilent : chaque erreur
 * ou « Passer » dévoile l'image suivante, 6 essais au plus. Trouver à la 1re image rapporte 6 points, à la 6e 1 point.
 * Les images sont privées (bucket hg-jeux) : le stockage ne laisse lire que les images déjà dévoilées (politique
 * hg_jeux_obj_read), lues ici par URL signée courte.
 * RPC : hg_framed_state, hg_framed_guess. Gains versés par le serveur (10 ✦ trouvé, 3 ✦ sinon, réglables).
 * Exporte : mount(panel, ctx).
 */
import { loadCss, guessFormHtml, bindGuess, boardHtml, shareText, copyText } from './devine.js';

const BUCKET = 'hg-jeux';
const dateFmt = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Zurich' });
const dateLong = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
/** Date « 9 mars 2025 » d'une date AAAA-MM-JJ (sans décalage de fuseau). */
const day = (d, f = dateFmt) => (d ? f.format(new Date(d + 'T12:00:00Z')) : '');

let P = null, C = null;
const S = { st: null, busy: false, urls: {}, view: 0, err: null };

/** Monte l'onglet. */
export async function mount(panel, ctx) {
  P = panel; C = ctx;
  loadCss('jeux-devine');
  panel.innerHTML = '<p class="muted">Chargement du Framed…</p>';
  panel.addEventListener('click', onClick);
  await load();
}

/** Charge l'état du jour, puis les URL signées des images dévoilées. */
async function load() {
  try {
    const { data, error } = await C.sb.rpc('hg_framed_state');
    if (error) throw error;
    S.st = data; S.err = null;
    await signFrames();
    S.view = Math.max(0, (S.st.frames?.length || 1) - 1);
  } catch (e) { S.err = e?.message || String(e); }
  render();
}

/** URL signées (10 min) des images dévoilées qui n'en ont pas encore. */
async function signFrames() {
  const todo = (S.st?.frames || []).filter((p) => !S.urls[p]);
  if (!todo.length) return;
  const { data } = await C.sb.storage.from(BUCKET).createSignedUrls(todo, 600);
  for (const r of data || []) if (r.signedUrl) S.urls[r.path] = r.signedUrl;
}

/** Titre d'un film dans les suggestions. */
const label = (f) => `${f.title}${f.year ? ` (${f.year})` : ''}`;

/** Boutons des images : dévoilées (ratée, en cours), verrouillées. */
function framesNav(st) {
  const n = st.total_frames || 6, k = st.frames.length, g = st.guesses || [];
  return `<div class="jf-nav" role="group" aria-label="Images">${Array.from({ length: n }, (_, i) => {
    const open = i < k;
    const miss = i < g.length && !(st.solved && i === g.length - 1);
    const cur = i === S.view;
    const state = !open ? 'verrouillée' : miss ? (g[i]?.id ? 'essai raté' : 'passée') : cur ? 'affichée' : 'dévoilée';
    return `<button type="button" class="jf-num${miss ? ' is-miss' : ''}${cur ? ' is-cur' : ''}" data-frame="${i}" ${open ? '' : 'disabled'} aria-label="Image ${i + 1}, ${state}"${cur ? ' aria-current="true"' : ''}>${i + 1}</button>`;
  }).join('')}</div>`;
}

/** Liste des essais déjà faits. */
function triesHtml(st) {
  const g = st.guesses || [];
  if (!g.length) return '';
  return `<ul class="jd-tries">${g.map((x, i) => {
    const win = st.solved && i === g.length - 1;
    return `<li class="jd-try${win ? ' is-win' : x.id ? ' is-miss' : ''}"><span class="jd-dot" aria-hidden="true"></span>
      <span class="jd-try-t">${i + 1} · ${x.id ? C.esc(label(x)) : 'Passé'}</span>
      <span class="jd-try-s">${win ? 'Trouvé' : x.id ? 'Raté' : (i < 5 ? '+1 image' : '')}</span></li>`;
  }).join('')}</ul>`;
}

/** Dessine l'onglet. */
function render() {
  const esc = C.esc, st = S.st;
  if (S.err) { P.innerHTML = `<p class="card">Framed indisponible : ${esc(S.err)}</p>`; return; }
  const hier = st.hier ? `<div class="card jd-hier"><p class="jd-hier-t">Hier · #${esc(st.hier.round)} ${esc(st.hier.title)}</p>
      <p class="muted small">trouvé par ${esc(st.hier.solvers)} membre${st.hier.solvers > 1 ? 's' : ''}${st.hier.avg ? ` · moyenne ${esc(String(st.hier.avg).replace('.', ','))} / 6` : ''}</p></div>` : '';
  const board = `<section class="card jd-board-box" aria-labelledby="jf-board-h"><h2 id="jf-board-h" class="jd-h2">Classement de la semaine</h2>${boardHtml(st.board, C.me?.id, esc)}</section>`;
  if (!st.round) {
    P.innerHTML = `<div class="jd"><h2 class="jd-title">Framed du gang</h2>
      <p class="card muted">Pas d’image aujourd’hui.${st.next_day ? ` Prochain Framed le ${esc(day(st.next_day, dateLong))}.` : ' Le projectionniste prépare les prochains.'}</p>${hier}${board}</div>`;
    return;
  }
  const k = st.frames.length, path = st.frames[S.view], url = S.urls[path];
  const pts = st.finished ? st.score : Math.max(1, 7 - k);
  const head = `<div class="jd-head"><h2 class="jd-title">Framed du gang #${esc(st.round)}</h2>
    <div class="jd-sub"><span class="muted small">Devine l’image du jour · image ${esc(S.view + 1)} sur ${esc(st.total_frames)}</span>
    <span class="pill jd-pts-pill">${st.finished ? `${esc(st.score)} pt${st.score > 1 ? 's' : ''}` : `${esc(pts)} pt${pts > 1 ? 's' : ''} possible${pts > 1 ? 's' : ''}`}</span></div></div>`;
  const img = `<div class="jf-img">${url ? `<img src="${esc(url)}" alt="Image ${S.view + 1} du jour à deviner" decoding="async">` : '<span class="muted small">Image en chargement…</span>'}</div>`;
  let bottom;
  if (st.finished) {
    const f = st.film || {};
    bottom = `<div class="card jd-end${st.solved ? ' is-win' : ''}" role="status">
      <p class="jd-end-t">${st.solved ? `Trouvé en ${esc(st.guesses.length)} essai${st.guesses.length > 1 ? 's' : ''} !` : 'Pas trouvé cette fois.'}</p>
      <p class="jd-end-ans">${esc(f.title || '')}${f.year ? ` <span class="muted">(${esc(f.year)})</span>` : ''}</p>
      ${f.seen_on ? `<p class="muted small">vu le ${esc(day(f.seen_on, dateLong))}${f.viewers ? `, ${esc(f.viewers)} spectateurs` : ''}</p>` : ''}
      <p class="small">${st.reward ? `+${esc(st.reward)} ✦ crédités` : ''}</p>
      <div class="jd-actions"><button type="button" class="btn btn-sand" data-act="share">Partager le résultat</button>
      <button type="button" class="btn btn-ghost" data-act="livre">Le livre est mieux</button></div></div>`;
  } else {
    bottom = guessFormHtml('jf', 'Ton titre', S.busy)
      + `<p class="muted small jd-note">Seules les ${esc(st.films.length)} réponses de la liste sont proposées. Trouvé : ${esc(st.gain)} ✦ · pas trouvé : ${esc(st.consolation)} ✦.</p>`;
  }
  P.innerHTML = `<div class="jd">${head}${img}${framesNav(st)}${triesHtml(st)}${bottom}${hier}${board}</div>`;
  if (!st.finished) {
    const passBtn = P.querySelector('[data-act="passer"]');
    if (passBtn && k < (st.total_frames || 6)) passBtn.textContent = `Passer · image ${k + 1}`;
    bindGuess(P, 'jf', {
      items: st.films, esc, label, sub: (f) => (f.seen_on ? `vu le ${day(f.seen_on)}` : ''),
      exclude: new Set((st.guesses || []).map((x) => String(x.id)).filter(Boolean)),
      onPick: (id) => guess(id), onSkip: () => guess(null),
    });
  }
}

/** Envoie un essai (null = passer). */
async function guess(id) {
  if (S.busy) return;
  S.busy = true; render();
  try {
    const { data, error } = await C.sb.rpc('hg_framed_guess', { p_film: id });
    if (error) throw error;
    S.st = data;
    await signFrames();
    S.view = data.frames.length - 1;
    if (data.finished) C.toast(data.solved ? `Bravo ! +${data.reward} ✦` : `C’était « ${data.film?.title} ». +${data.reward} ✦`, 'ok');
  } catch (e) { C.toast(e?.message || String(e), 'error'); }
  S.busy = false; render();
  P.querySelector('#jf-input')?.focus();
}

/** Clics : images, partage, clin d'œil. */
async function onClick(e) {
  const b = e.target.closest('button');
  if (!b || !P.contains(b)) return;
  if (b.dataset.frame) { S.view = Number(b.dataset.frame); render(); P.querySelector(`[data-frame="${S.view}"]`)?.focus(); return; }
  if (b.dataset.act === 'share') {
    C.toast(await copyText(shareText('Framed du gang', S.st)) ? 'Résultat copié, colle-le sur Discord.' : 'Copie impossible sur cet appareil.', 'ok');
  }
  if (b.dataset.act === 'livre') C.toast('Noté. Le livre est toujours mieux.', 'ok');
}
