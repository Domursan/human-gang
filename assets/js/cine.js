// ===== Humane Gang — page « Ciné-club » (cine.html, idée V9) =====
/*
 * Rôle : le ciné du dimanche du gang.
 *   - Prochaine séance : vote entre 2 et 4 films (barres et totaux), « Je serai là », lien du salon vocal Discord.
 *     Sous le seuil de votants à la clôture, la séance est reportée d'une semaine (automatique, côté base).
 *   - Films vus : note moyenne, avis courts (spoilers floutés), bouton « Le livre est mieux » et son compteur.
 *     Secret F5 (migration 101) : trois clics rapides (moins de 1,5 s) sur l'affiche d'un film vu font sortir une bulle
 *     « Le livre est mieux. » (3 s) et signalent le secret « livre » (eggFound, qui affiche le gain).
 *   - Liste d'attente : propositions des membres, « + » pour aider le projectionniste à choisir.
 *   - Les mieux notés du gang.
 *   Projectionniste (réglage cine.host_ids) ou Staff « evenements » : programmer une séance, choisir le film, annuler,
 *   changer le lien vocal, retirer une proposition. Staff « souvenirs » : masquer un avis.
 * Affiches : celles que les membres ajoutent (lien https ou fichier image, migration 098), sinon une vignette dessinée
 * en CSS (titre et couleur tirée du titre). Ajout et retrait : la personne qui a proposé le film, le projectionniste
 * et le Staff « evenements ».
 * Données : RPC hg_cine_state (lecture complète, passe aussi les états échus), hg_cine_propose, hg_cine_plus,
 * hg_cine_withdraw, hg_cine_vote, hg_cine_presence_set, hg_cine_review, hg_cine_book_better, hg_cine_review_hide,
 * hg_cine_session_open, hg_cine_session_admin (migration 087), hg_cine_poster_set (migration 098) ; lecture de
 * hg_cine_films (id, poster_url) ; hg_members (pseudos) ; stockage hg-assets (dossier cine/<membre>/) ;
 * hg_egg_found via eggs/api.js (code « livre », F5).
 * Dépendances : core.js, icons.js, ui-confirm.js, image-compress.js, eggs/api.js. Page réservée aux membres (auth: 'member').
 * N'exporte rien.
 */
import { sb, initPage, esc, $, errMsg, toast, avatarHtml, hasPerm, motionAllowed } from './core.js';
import { svg } from './icons.js';
import { confirmBox } from './ui-confirm.js';
import { prepareImage } from './image-compress.js';
import { eggFound } from './eggs/api.js';

/* ---------- Initialisation ---------- */
const me = await initPage({ auth: 'member' });
const app = $('#app');
const root = $('#cine-root');

/* ---------- Constantes et formats ---------- */
const TZ = 'Europe/Zurich';
const VOICE_RE = /^https:\/\/discord\.com\/channels\/\d{17,20}\/\d{17,20}$/;
const I = {
  star: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  starO: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  book: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5"/></svg>',
  plus: svg('plus', { size: 16 }), check: svg('check', { size: 16 }), close: svg('close', { size: 20 }), link: svg('link', { size: 16 }),
  people: svg('people', { size: 16 }), trash: svg('trash', { size: 16 }), eye: svg('eye', { size: 16 }),
};
const fmt = (iso, o) => new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, ...o }).format(new Date(iso));
/** « dimanche 1er nov. · 20 h 30 » */
function when(iso) {
  const day = fmt(iso, { weekday: 'long', day: 'numeric', month: 'short' }).replace(/^(\S+) 1 /, '$1 1er ');
  const [h, m] = fmt(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':');
  return `${day} · ${Number(h)} h${m === '00' ? '' : ` ${m}`}`;
}
/** « sam. 22 h 30 » */
function short(iso) {
  const [h, m] = fmt(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':');
  return `${fmt(iso, { weekday: 'short' })} ${Number(h)} h${m === '00' ? '' : ` ${m}`}`;
}
const dayLong = (d) => new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)).replace(/^1 /, '1er ');
const nf1 = (n) => Number(n).toLocaleString('fr-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Teinte stable tirée du titre (vignette dessinée, pas d'affiche officielle). */
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360; return h; };

/* ---------- État ---------- */
const S = { data: null, members: new Map(), posters: new Map(), broken: new Set(), busy: false, open: new Set() };
const pseudo = (id) => S.members.get(id)?.pseudo || 'Ancien membre';

async function load() {
  app.setAttribute('aria-busy', 'true');
  try {
    // Les affiches ne sont pas dans hg_cine_state : lecture directe (autorisée aux membres).
    const [st, mem, posters] = await Promise.all([sb.rpc('hg_cine_state'), S.members.size ? null : sb.rpc('hg_members'),
      sb.from('hg_cine_films').select('id, poster_url').not('poster_url', 'is', null)]);
    if (st.error) throw st.error;
    if (mem && !mem.error) S.members = new Map((mem.data || []).map((m) => [m.id, m]));
    if (!posters.error) S.posters = new Map((posters.data || []).map((r) => [r.id, r.poster_url]));
    S.data = st.data;
    render();
  } catch (e) {
    root.innerHTML = `<p class="cine-error" role="alert">Impossible de charger le ciné-club : ${esc(errMsg(e))}</p>`;
  }
  app.setAttribute('aria-busy', 'false');
}

/** Appelle une RPC, affiche l'erreur éventuelle, recharge la page en cas de succès. */
async function act(fn, args, okMsg) {
  if (S.busy) return null;
  S.busy = true;
  const { data, error } = await sb.rpc(fn, args);
  S.busy = false;
  if (error) { toast(errMsg(error), 'error'); return null; }
  if (okMsg) { toast(okMsg); $('#cine-status').textContent = okMsg; }
  await load();
  return data ?? true;
}

/* ---------- Rendu ---------- */
/** Vignette dessinée en CSS (repli : pas d'affiche, ou affiche qui ne charge pas). */
const cssPoster = (title, big = false) => `<div class="cine-poster${big ? ' is-big' : ''}" style="--h:${hue(title)}" aria-hidden="true"><span>${esc(title)}</span></div>`;
/** Affiche du film si un membre en a ajouté une, sinon vignette CSS. */
const poster = (f, big = false) => {
  const url = S.posters.get(f.id);
  if (!url || S.broken.has(url)) return cssPoster(f.title, big);
  return `<img class="cine-poster cine-poster-img${big ? ' is-big' : ''}" src="${esc(url)}" alt="${esc(f.title)}" loading="lazy" decoding="async" data-big="${big ? 1 : 0}">`;
};
/** Peut changer l'affiche : la personne qui a proposé le film, le projectionniste, le Staff « evenements ». */
const canPoster = (f) => !!f && (f.proposed_by === me.id || !!S.data?.is_host || hasPerm('evenements'));
/** Bouton « Ajouter / Changer l'affiche » (vide si la personne n'a pas le droit). */
const posterBtn = (f) => (canPoster(f)
  ? `<button type="button" class="btn btn-ghost btn-sm" data-act="poster" data-film="${esc(f.id)}" aria-label="${S.posters.has(f.id) ? 'Changer l’affiche' : 'Ajouter une affiche'} de ${esc(f.title)}">${S.posters.has(f.id) ? 'Changer l’affiche' : 'Ajouter une affiche'}</button>`
  : '');
/** Retrouve un film dans la séance en cours, la liste d'attente ou les films vus. */
const findFilm = (id) => S.data?.current?.films?.find((x) => x.id === id) || S.data?.waiting?.find((x) => x.id === id)
  || S.data?.seen?.find((x) => x.id === id) || null;

function starsHtml(avg, label = true) {
  const n = Math.round(Number(avg) || 0);
  return `<span class="cine-stars" ${label ? `role="img" aria-label="${avg ? `${nf1(avg)} sur 5` : 'pas encore noté'}"` : 'aria-hidden="true"'}>${[1, 2, 3, 4, 5].map((i) => (i <= n ? I.star : I.starO)).join('')}</span>`;
}

function currentHtml(d) {
  const c = d.current, cfg = d.cfg;
  if (!c) {
    const cancelled = d.cancelled ? `<p class="cine-forfait">${'Match nul par forfait : trop peu de votants, la séance est annulée. On remet ça bientôt !'}</p>` : '';
    return `<section class="card cine-cur" aria-labelledby="cine-cur-t">
      <h2 class="cine-k" id="cine-cur-t">Prochaine séance</h2>
      ${cancelled}<p class="muted">Pas de séance programmée pour l’instant.${d.is_host ? '' : ' Le projectionniste lance le vote en début de semaine : en attendant, propose des films ou donne des « + » à la liste d’attente.'}</p>
      ${d.is_host ? `<div class="btn-row"><button type="button" class="btn btn-sand" data-act="open-session"${d.waiting.length < 2 ? ' disabled aria-describedby="cine-need2"' : ''}>Programmer une séance</button></div>
        ${d.waiting.length < 2 ? '<p class="small muted" id="cine-need2">Il faut au moins deux films dans la liste d’attente.</p>' : ''}` : ''}
    </section>`;
  }
  const voting = c.status === 'vote';
  const total = c.films.reduce((s, f) => s + Number(f.votes || 0), 0);
  const chosen = c.films.find((f) => f.id === c.film_id);
  const present = (c.presence || []).includes(me.id);
  const films = voting ? `<div class="cine-films" role="group" aria-label="Films en lice">${c.films.map((f) => {
    const pct = total ? Math.round((Number(f.votes) / total) * 100) : 0, mine = c.my_vote === f.id;
    return `<article class="cine-film${mine ? ' is-mine' : ''}">
      ${poster(f)}
      <h3 class="cine-film-t">${esc(f.title)}</h3>
      <p class="small muted">${[f.year, f.pitch ? `« ${f.pitch} »` : f.proposed_by ? `proposé par ${pseudo(f.proposed_by)}` : null].filter(Boolean).map(esc).join(' · ')}</p>
      <div class="cine-bar" role="img" aria-label="${pct} % des votes"><span style="width:${pct}%"></span></div>
      <div class="cine-film-foot"><span class="small"><strong>${f.votes} vote${f.votes > 1 ? 's' : ''}</strong></span>
        ${mine ? `<span class="pill cine-mine">${I.check}Ton choix</span>` : `<button type="button" class="btn btn-ghost btn-sm" data-act="vote" data-film="${esc(f.id)}" aria-label="Voter pour ${esc(f.title)}">Voter</button>`}
      </div>
      ${posterBtn(f)}
      ${d.is_host ? `<button type="button" class="btn btn-ghost btn-sm cine-host-btn" data-act="fix" data-film="${esc(f.id)}">Choisir ce film</button>` : ''}
    </article>`;
  }).join('')}</div>
    <p class="small muted">${c.voters} votant${c.voters > 1 ? 's' : ''}. En dessous de ${cfg.seuil}, la séance est reportée d’une semaine.${c.postponed ? ` Déjà reportée ${c.postponed} fois.` : ''}</p>`
    : chosen ? `<div class="cine-chosen">${poster(chosen, true)}<div><h3 class="cine-chosen-t">${esc(chosen.title)}</h3>
        <p class="small muted">${[chosen.year, chosen.pitch ? `« ${chosen.pitch} »` : null].filter(Boolean).map(esc).join(' · ')}</p>${posterBtn(chosen)}</div></div>` : '';
  return `<section class="card cine-cur" aria-labelledby="cine-cur-t">
    <div class="cine-cur-head"><h2 class="cine-k" id="cine-cur-t">${voting ? 'Vote de la semaine' : 'Film choisi'}</h2>
      ${voting ? `<span class="pill pill-todo">Clôture ${esc(short(c.closes_at))}</span>` : '<span class="pill pill-ok">C’est décidé</span>'}</div>
    <p class="small muted">${esc(when(c.starts_at))}${c.host_id ? ` · projectionniste : ${esc(pseudo(c.host_id))}` : ''}</p>
    ${c.postponed && c.postponed_at ? `<p class="cine-forfait small">Reportée d’une semaine : pas assez de votants. Match nul par forfait !</p>` : ''}
    ${films}
    <div class="cine-presence">
      <button type="button" class="btn ${present ? 'btn-sand' : 'btn-ghost'}" data-act="presence" aria-pressed="${present}">${present ? I.check : I.people}<span>Je serai là</span></button>
      <span class="small muted">${(c.presence || []).length ? `${(c.presence || []).map((id) => esc(pseudo(id))).join(', ')}` : 'Personne n’a encore confirmé.'}</span>
      ${c.voice_link && VOICE_RE.test(c.voice_link) ? `<a class="btn btn-ghost" href="${esc(c.voice_link)}" target="_blank" rel="noopener noreferrer">${I.link}<span>Salon vocal</span></a>` : ''}
    </div>
    ${d.is_host ? `<details class="cine-host"><summary>Outils du projectionniste</summary>
      <div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" data-act="link">Lien du salon vocal</button>
      <button type="button" class="btn btn-danger btn-sm" data-act="cancel">Annuler la séance</button></div></details>` : ''}
  </section>`;
}

function reviewHtml(f, r, d) {
  const spoilerOpen = S.open.has(`${f.id}:${r.user_id}`);
  const author = S.members.get(r.user_id) || { pseudo: 'Ancien membre' };
  return `<li class="cine-review">${avatarHtml(author, 28)}<div class="cine-review-b">
      <span class="small"><strong>${esc(author.pseudo)}</strong>${r.stars ? ` · ${r.stars}/5` : ''}${r.book_better ? ' · le livre est mieux' : ''}</span>
      ${r.spoiler && !spoilerOpen
        ? `<p class="cine-spoiler" aria-hidden="true">${esc(r.body)}</p><button type="button" class="btn btn-ghost btn-sm" data-act="spoiler" data-key="${esc(`${f.id}:${r.user_id}`)}">${I.eye}<span>Contient un spoiler : afficher</span></button>`
        : `<p class="cine-review-t">${esc(r.body)}</p>`}
      ${d.can_moderate && r.user_id !== me.id ? `<button type="button" class="btn btn-ghost btn-sm" data-act="hide" data-film="${esc(f.id)}" data-user="${esc(r.user_id)}">Masquer</button>` : ''}
    </div></li>`;
}

function seenHtml(d) {
  if (!d.seen.length) return '<p class="empty">Aucun film vu pour l’instant. Le premier arrive dimanche ?</p>';
  return d.seen.slice(0, 20).map((f) => {
    const mine = f.mine || {}, bb = !!mine.book_better;
    return `<article class="card cine-seen" aria-labelledby="seen-${esc(f.id)}">
      <div class="cine-seen-head"><span class="cine-k cine-k-sand">${f.seen_on ? `Vu le ${esc(dayLong(f.seen_on))}` : 'Vu'}</span>
        <span class="small muted">${f.viewers} spectateur${f.viewers > 1 ? 's' : ''}</span></div>
      <div class="cine-seen-poster" data-film="${esc(f.id)}">${poster(f)}</div>
      <h3 class="cine-seen-t" id="seen-${esc(f.id)}">${esc(f.title)}${f.year ? ` <span class="muted cine-year">(${f.year})</span>` : ''}</h3>
      <div class="cine-rating">${starsHtml(f.avg)}<span class="small"><strong>${f.avg ? `${nf1(f.avg)} / 5` : 'Pas encore noté'}</strong>${f.notes ? ` · ${f.notes} note${f.notes > 1 ? 's' : ''}` : ''}</span></div>
      ${f.reviews.length ? `<ul class="cine-reviews">${f.reviews.slice(0, 6).map((r) => reviewHtml(f, r, d)).join('')}</ul>` : ''}
      <div class="cine-seen-foot">
        <button type="button" class="btn ${bb ? 'btn-sand' : 'btn-ghost'} btn-sm" data-act="book" data-film="${esc(f.id)}" aria-pressed="${bb}">${I.book}<span>Le livre est mieux · ${f.book_better}</span></button>
        ${posterBtn(f)}
        <button type="button" class="btn btn-sand btn-sm" data-act="review" data-film="${esc(f.id)}">${mine.stars || mine.body ? 'Modifier mon avis' : 'Noter'}</button>
      </div>
    </article>`;
  }).join('');
}

function waitingHtml(d) {
  return `<div class="cine-wait-head"><p class="small muted">Liste d’attente : ${d.waiting.length} film${d.waiting.length > 1 ? 's' : ''} proposé${d.waiting.length > 1 ? 's' : ''}</p>
      <button type="button" class="btn btn-ghost btn-sm" data-act="propose">${I.plus}<span>Proposer un film</span></button></div>
    ${d.waiting.length ? `<ul class="cine-wait">${d.waiting.map((f) => `<li class="cine-wait-i">
      <div class="cine-wait-txt"><strong>${esc(f.title)}</strong>${f.year ? ` <span class="muted">(${f.year})</span>` : ''}
        <span class="small muted">${f.pitch ? `« ${esc(f.pitch)} » · ` : ''}proposé par ${esc(pseudo(f.proposed_by))}</span>${posterBtn(f)}</div>
      <div class="cine-wait-act">
        <button type="button" class="btn ${f.my_plus ? 'btn-sand' : 'btn-ghost'} btn-sm" data-act="plus" data-film="${esc(f.id)}" aria-pressed="${!!f.my_plus}" aria-label="+ pour ${esc(f.title)} (${f.plus})">+ ${f.plus}</button>
        ${f.proposed_by === me.id || d.is_host ? `<button type="button" class="btn btn-ghost btn-sm cine-icon" data-act="withdraw" data-film="${esc(f.id)}" aria-label="Retirer ${esc(f.title)}">${I.trash}</button>` : ''}
      </div></li>`).join('')}</ul>` : ''}`;
}

function topHtml(d) {
  const top = d.seen.filter((f) => Number(f.notes) >= 2 && f.avg).sort((a, b) => b.avg - a.avg || b.notes - a.notes).slice(0, 5);
  if (!top.length) return '';
  return `<section class="cine-sec" aria-labelledby="cine-top-t"><h2 class="cine-sec-t" id="cine-top-t">Les mieux notés du gang</h2>
    <ol class="cine-top">${top.map((f) => `<li><strong>${esc(f.title)}</strong><span class="small muted">${nf1(f.avg)} / 5 · ${f.notes} notes</span></li>`).join('')}</ol></section>`;
}

function render() {
  const d = S.data;
  root.innerHTML = `${currentHtml(d)}
    <section class="cine-sec" aria-labelledby="cine-wait-t"><h2 class="cine-sec-t" id="cine-wait-t">Propositions</h2>${waitingHtml(d)}</section>
    <section class="cine-sec" aria-labelledby="cine-seen-t"><h2 class="cine-sec-t" id="cine-seen-t">Films vus</h2>${seenHtml(d)}</section>
    ${topHtml(d)}`;
}

/* ---------- Boîtes de dialogue ---------- */
/** Ouvre une boîte de dialogue à formulaire ; onSubmit(FormData, afficherErreur) renvoie true pour fermer. */
function dialog(title, inner, submitLabel, onSubmit) {
  const back = document.activeElement; // le bouton qui a ouvert la boîte reprend le focus à la fermeture
  const dlg = document.createElement('dialog');
  dlg.className = 'hg-dialog cine-dlg';
  dlg.setAttribute('aria-labelledby', 'cine-dlg-t');
  dlg.innerHTML = `<form class="stack" novalidate>
    <div class="cine-dlg-head"><h2 class="cine-dlg-title" id="cine-dlg-t">${esc(title)}</h2>
      <button type="button" class="btn btn-ghost cine-icon" data-close aria-label="Fermer">${I.close}</button></div>
    ${inner}
    <p class="cine-form-err" role="alert" hidden></p>
    <div class="btn-row cine-form-actions"><button type="button" class="btn btn-ghost" data-close>Annuler</button><button type="submit" class="btn btn-sand">${esc(submitLabel)}</button></div>
  </form>`;
  const form = dlg.querySelector('form'), err = dlg.querySelector('.cine-form-err');
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) dlg.close(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true;
    const btn = form.querySelector('[type="submit"]'); btn.disabled = true;
    try { if (await onSubmit(new FormData(form), fail, form)) dlg.close(); } finally { btn.disabled = false; }
  });
  dlg.addEventListener('close', () => { dlg.remove(); back?.focus?.(); });
  document.body.append(dlg);
  dlg.showModal();
  form.querySelector('input, textarea, select')?.focus();
  return dlg;
}

function openPropose() {
  dialog('Proposer un film', `
    <div class="field"><label for="cp-title">Titre</label><input id="cp-title" name="title" maxlength="120" required autocomplete="off" placeholder="Spotlight"></div>
    <div class="field"><label for="cp-year">Année (facultatif)</label><input id="cp-year" name="year" type="number" inputmode="numeric" min="1888" max="2100" placeholder="2015"></div>
    <div class="field"><label for="cp-pitch">Pourquoi ce film ? (facultatif)</label><input id="cp-pitch" name="pitch" maxlength="200" placeholder="Une phrase pour donner envie"></div>`,
  'Proposer', async (fd, fail) => {
    const title = String(fd.get('title') || '').trim();
    if (!title) { fail('Donne le titre du film.'); return false; }
    const year = fd.get('year') ? Number(fd.get('year')) : null;
    const { error } = await sb.rpc('hg_cine_propose', { p_title: title, p_year: year, p_pitch: String(fd.get('pitch') || '').trim() || null });
    if (error) { fail(errMsg(error)); return false; }
    toast('Film ajouté à la liste d’attente'); load(); return true;
  });
}

function openReview(film) {
  const mine = film.mine || {};
  const dlg = dialog(`Ton avis sur ${film.title}`, `
    <fieldset class="cine-starpick"><legend>Ta note</legend>
      ${[1, 2, 3, 4, 5].map((n) => `<label class="cine-starlab"><input type="radio" name="stars" value="${n}"${Number(mine.stars) === n ? ' checked' : ''}><span>${n} étoile${n > 1 ? 's' : ''}</span></label>`).join('')}
      <label class="cine-starlab"><input type="radio" name="stars" value=""${mine.stars ? '' : ' checked'}><span>Sans note</span></label>
    </fieldset>
    <div class="field"><label for="cr-body">Ton avis en quelques mots (facultatif)</label>
      <textarea id="cr-body" name="body" maxlength="280" rows="3" aria-describedby="cr-count">${esc(mine.body || '')}</textarea>
      <p class="small muted" id="cr-count" aria-live="polite"></p></div>
    <label class="check"><input type="checkbox" name="spoiler"${mine.spoiler ? ' checked' : ''}><span>Contient un spoiler (le texte sera flouté)</span></label>
    ${mine.stars || mine.body ? '<div><button type="button" class="btn btn-ghost btn-sm" data-act-dlg="clear">Retirer ma note et mon avis</button></div>' : ''}`,
  'Enregistrer', async (fd, fail) => {
    const stars = fd.get('stars') ? Number(fd.get('stars')) : null;
    const body = String(fd.get('body') || '').trim();
    const { error } = await sb.rpc('hg_cine_review', { p_film: film.id, p_stars: stars, p_body: body || null, p_spoiler: fd.get('spoiler') === 'on' });
    if (error) { fail(errMsg(error)); return false; }
    toast('Merci pour ton avis !'); load(); return true;
  });
  const ta = dlg.querySelector('#cr-body'), count = dlg.querySelector('#cr-count');
  const upd = () => { count.textContent = `${ta.value.length} / 280`; };
  ta.addEventListener('input', upd); upd();
  dlg.querySelector('[data-act-dlg="clear"]')?.addEventListener('click', async () => {
    const { error } = await sb.rpc('hg_cine_review_hide', { p_film: film.id, p_user: me.id });
    if (error) { toast(errMsg(error), 'error'); return; }
    dlg.close(); toast('Avis retiré'); load();
  });
}

/** Affiche d'un film : une adresse https, ou un fichier image (compressé, envoyé dans cine/<membre>/). */
function openPoster(film) {
  const has = S.posters.has(film.id);
  const dlg = dialog(`Affiche de ${film.title}`, `
    <div class="field"><label for="cp-url">Adresse de l’image (https)</label><input id="cp-url" name="url" type="url" inputmode="url" maxlength="600" placeholder="https://…" autocomplete="off"></div>
    <p class="small muted">ou</p>
    <div class="field"><label for="cp-file">Choisir un fichier image (10 Mo au plus)</label><input id="cp-file" name="file" type="file" accept="image/*"></div>
    ${has ? '<div><button type="button" class="btn btn-ghost btn-sm" data-act-dlg="remove">Retirer l’affiche</button></div>' : ''}`,
  'Enregistrer', async (fd, fail) => {
    const file = fd.get('file'), url = String(fd.get('url') || '').trim();
    let target = url;
    if (file && file.size) {
      if (!file.type.startsWith('image/')) { fail('Choisis un fichier image (PNG, JPG, WebP ou GIF).'); return false; }
      if (file.size > 10 * 1024 * 1024) { fail('Image trop lourde (10 Mo maximum).'); return false; }
      try {
        const img = await prepareImage(file);
        const path = `cine/${me.id}/${film.id}-${Date.now()}.${img.ext}`;
        const up = await sb.storage.from('hg-assets').upload(path, img.blob, { contentType: img.contentType, upsert: false });
        if (up.error) throw up.error;
        target = sb.storage.from('hg-assets').getPublicUrl(path).data.publicUrl;
      } catch (e) { fail(errMsg(e)); return false; }
    } else if (!url) { fail('Colle une adresse https ou choisis un fichier image.'); return false; }
    if (!/^https:\/\//.test(target)) { fail('L’adresse doit commencer par https://'); return false; }
    const { error } = await sb.rpc('hg_cine_poster_set', { p_film: film.id, p_url: target });
    if (error) { fail(errMsg(error)); return false; }
    toast('Affiche enregistrée'); load(); return true;
  });
  dlg.querySelector('[data-act-dlg="remove"]')?.addEventListener('click', async () => {
    const { error } = await sb.rpc('hg_cine_poster_set', { p_film: film.id, p_url: '' });
    if (error) { toast(errMsg(error), 'error'); return; }
    dlg.close(); toast('Affiche retirée'); load();
  });
}

/** Prochaine date par défaut :jour et heure du réglage (dimanche 20 h 30), au moins demain. */
function defaultStart(cfg) {
  const [h, m] = String(cfg.heure || '20:30').split(':').map(Number);
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() !== Number(cfg.jour ?? 0)) d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(h)}:${p2(m)}`;
}

function openSession() {
  const d = S.data;
  dialog('Programmer une séance', `
    <div class="field"><label for="cs-when">Date et heure</label><input id="cs-when" name="when" type="datetime-local" required value="${defaultStart(d.cfg)}"></div>
    <fieldset class="cine-pick"><legend>Films en lice (2 à 4)</legend>
      ${d.waiting.map((f, i) => `<label class="check"><input type="checkbox" name="films" value="${esc(f.id)}"${i < 2 ? ' checked' : ''}><span>${esc(f.title)}${f.year ? ` (${f.year})` : ''} · + ${f.plus}</span></label>`).join('')}
    </fieldset>
    <div class="field"><label for="cs-voice">Salon vocal Discord (facultatif)</label><input id="cs-voice" name="voice" type="url" inputmode="url" placeholder="https://discord.com/channels/…" aria-describedby="cs-voice-h">
      <p class="small muted" id="cs-voice-h">Seulement un lien de salon Discord : jamais de lien de visionnage.</p></div>`,
  'Lancer le vote', async (fd, fail) => {
    const films = fd.getAll('films');
    if (films.length < 2 || films.length > 4) { fail('Choisis de 2 à 4 films.'); return false; }
    const w = String(fd.get('when') || '');
    if (!w) { fail('Indique la date de la séance.'); return false; }
    const voice = String(fd.get('voice') || '').trim();
    if (voice && !VOICE_RE.test(voice)) { fail('Le lien doit être un salon Discord (https://discord.com/channels/…).'); return false; }
    const { error } = await sb.rpc('hg_cine_session_open', { p_starts_at: new Date(w).toISOString(), p_films: films, p_voice_link: voice || null });
    if (error) { fail(errMsg(error)); return false; }
    toast('Le vote est lancé !'); load(); return true;
  });
}

/* ---------- Événements ---------- */
root.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const d = S.data, c = d?.current, a = b.dataset.act, film = b.dataset.film;
  if (a === 'vote') act('hg_cine_vote', { p_session: c.id, p_film: film }, 'Vote enregistré');
  else if (a === 'presence') act('hg_cine_presence_set', { p_session: c.id, p_on: !(c.presence || []).includes(me.id) }, (c.presence || []).includes(me.id) ? 'Tu n’es plus inscrit·e' : 'À dimanche !');
  else if (a === 'plus') act('hg_cine_plus', { p_film: film });
  else if (a === 'book') act('hg_cine_book_better', { p_film: film });
  else if (a === 'propose') openPropose();
  else if (a === 'review') { const f = d.seen.find((x) => x.id === film); if (f) openReview(f); }
  else if (a === 'spoiler') { S.open.add(b.dataset.key); render(); }
  else if (a === 'poster') { const f = findFilm(film); if (f && canPoster(f)) openPoster(f); }
  else if (a === 'open-session') openSession();
  else if (a === 'withdraw') {
    const f = d.waiting.find((x) => x.id === film);
    if (await confirmBox(`Retirer « ${f?.title || 'ce film'} » ?`, 'Il quitte la liste d’attente.', { ok: 'Retirer', danger: true })) act('hg_cine_withdraw', { p_film: film }, 'Film retiré');
  } else if (a === 'hide') {
    if (await confirmBox('Masquer cet avis ?', 'Il ne sera plus visible du gang (action notée dans le journal admin).', { ok: 'Masquer', danger: true })) act('hg_cine_review_hide', { p_film: film, p_user: b.dataset.user }, 'Avis masqué');
  } else if (a === 'fix') {
    const f = c.films.find((x) => x.id === film);
    if (await confirmBox(`Choisir « ${f?.title} » ?`, 'Le vote se ferme et ce film est programmé.', { ok: 'Choisir' })) act('hg_cine_session_admin', { p_session: c.id, p_action: 'fix', p_film: film }, 'Film choisi');
  } else if (a === 'cancel') {
    if (await confirmBox('Annuler la séance ?', 'Les films en lice retournent dans la liste d’attente.', { ok: 'Annuler la séance', cancel: 'Garder', danger: true })) act('hg_cine_session_admin', { p_session: c.id, p_action: 'cancel' }, 'Séance annulée');
  } else if (a === 'link') {
    const v = await confirmBox('Lien du salon vocal', 'Un lien de salon Discord (vide pour retirer).', { ok: 'Enregistrer', input: { label: 'Lien', value: c.voice_link || '', placeholder: 'https://discord.com/channels/…' } });
    if (v === false) return;
    if (v && !VOICE_RE.test(v)) { toast('Le lien doit être un salon Discord.', 'error'); return; }
    act('hg_cine_session_admin', { p_session: c.id, p_action: 'link', p_voice_link: v || null }, 'Lien enregistré');
  }
});

/* ---------- Secret F5 « Le livre est mieux » : trois clics rapides sur l'affiche d'un film vu ---------- */
/** Les trois derniers clics sur une affiche de film vu : { el, t } (el : l'affiche, t : heure du clic en ms). */
const livreClics = [];
/** Petit livre ouvert (SVG), dessiné dans la bulle. */
const LIVRE_SVG = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.6C9 5 6 4.8 3 5.5V19c3-.7 6-.5 9 1 3-1.5 6-1.7 9-1V5.5c-3-.7-6-.5-9 1.1z"/><path d="M12 6.6V20"/></svg>';

/**
 * Fait sortir du coin de l'affiche la bulle « Le livre est mieux. » (3 s, sans animation si le mouvement est réduit),
 * puis signale le secret « livre » au serveur (eggFound affiche le gain).
 * @param {HTMLElement} box zone de l'affiche cliquée (.cine-seen-poster)
 */
function livreSecret(box) {
  if (box.querySelector('.cine-bulle')) return; // déjà affichée
  const bulle = document.createElement('div');
  bulle.className = `cine-bulle${motionAllowed() ? ' is-anim' : ''}`;
  bulle.setAttribute('role', 'status');
  bulle.innerHTML = `${LIVRE_SVG}<span>Le livre est mieux.</span>`;
  box.append(bulle);
  setTimeout(() => bulle.remove(), 3000);
  eggFound('livre'); // best effort : ne lève jamais d'exception
}

// Trois clics sur la même affiche en moins de 1,5 s (du premier au troisième).
root.addEventListener('click', (e) => {
  const box = e.target.closest('.cine-seen-poster');
  if (!box) return;
  const now = Date.now();
  livreClics.push({ el: box, t: now });
  if (livreClics.length > 3) livreClics.shift();
  if (livreClics.length === 3 && livreClics.every((c) => c.el === box) && now - livreClics[0].t < 1500) {
    livreClics.length = 0;
    livreSecret(box);
  }
});

// Affiche qui ne charge pas : on garde la vignette CSS (écoute en phase de capture, l'événement « error » ne remonte pas).
root.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('cine-poster-img')) return;
  S.broken.add(img.getAttribute('src'));
  const t = document.createElement('template');
  t.innerHTML = cssPoster(img.alt, img.dataset.big === '1');
  img.replaceWith(t.content);
}, true);

load();
