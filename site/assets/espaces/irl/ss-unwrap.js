// ===== Humane Gang — soirée déballage du Secret Santa (T2, migration 096) =====
/*
 * Rôle : bloc « Soirée déballage » de la page Secret Santa, aux étapes « envoi » et « révélation ».
 *   Avant : qui a déjà reçu son cadeau (sans jamais dire qui l'a envoyé) et le sondage de dates de la soirée.
 *   Le soir même : la personne qui déballe en grand, un minuteur indicatif (il ne coupe rien), « Ensuite : … »,
 *   l'ordre de passage tiré au sort (en direct chez tout le monde, temps réel sur hg_ss_unwrap) et l'album de la soirée
 *   (photo en un geste, rappel « cache l'étiquette »).
 *   Staff « secret_santa » : préparer la soirée (titre, 2 à 4 dates, minuteur), fixer la date, tirer l'ordre, « Suivant »,
 *   « Passer (absent) », « Cadeau en route », révéler les paires.
 * RPC : hg_ss_unwrap_state (membre inscrit ou Staff), hg_ss_unwrap_setup, hg_ss_unwrap_fix_date, hg_ss_unwrap_draw,
 *   hg_ss_unwrap_next, hg_ss_unwrap_reveal (Staff). Tables : hg_event_date_votes (vote : sa propre ligne, RLS), hg_photos.
 * Aucune récompense ici (la photo suit les règles habituelles des photos d'une sortie).
 * Dépendances : core.js, photos.js, image-compress.js, ui-confirm.js, saisons-css.js.
 * Exporte : mountUnwrap(el, { ed, me, members, onReveal }).
 */
import { sb, esc, toast, errMsg, avatarHtml } from '../../commun/core.js';
import { uploadImage, removeObjects, signedUrls, uuid, openLightbox } from './photos.js';
import { prepareImage } from '../../commun/image-compress.js';
import { confirmBox } from '../../commun/ui-confirm.js';
import { svg } from '../../commun/icons.js';
import { loadSeasonCss } from '../accueil/saisons-css.js';

const ST_LABEL = { attente: 'À venir', en_cours: 'En cours', fait: 'Déballé', passe: 'Absent', en_route: 'Cadeau en route' };
const fmtWhen = (iso) => new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** État du bloc (un seul bloc par page). */
const U = { el: null, ed: null, me: null, members: new Map(), st: null, photos: [], urls: new Map(), tick: 0, channel: null, onReveal: null };

const who = (id) => U.members.get(id) || { pseudo: 'Membre', avatar_url: null, color: null };

/** Secondes restantes du tour en cours (minuteur indicatif, calculé localement depuis started_at). */
function remaining() {
  const cur = (U.st?.order || []).find((o) => o.status === 'en_cours');
  if (!cur?.started_at) return null;
  const total = Number(U.st.turn_seconds) || 300;
  const left = total - Math.floor((Date.now() - new Date(cur.started_at).getTime()) / 1000);
  return { left, total };
}
const mmss = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/** Bloc « personne en cours » avec le minuteur. */
function nowHtml() {
  const order = U.st.order || [];
  const cur = order.find((o) => o.status === 'en_cours');
  if (!cur) {
    const done = order.length && order.every((o) => ['fait', 'en_route'].includes(o.status));
    return done ? '<p class="sz-small sz-muted">Tout le monde a déballé. Merci pour cette soirée !</p>' : '';
  }
  const next = order.find((o) => o.position > cur.position && ['attente', 'passe'].includes(o.status))
    || order.find((o) => o.user_id !== cur.user_id && ['attente', 'passe'].includes(o.status));
  const r = remaining();
  const pct = r ? Math.max(0, Math.round((r.left / r.total) * 100)) : 100;
  const p = who(cur.user_id);
  return `<div class="uw-now">
    <div class="uw-timer" style="--p:${pct}" role="timer" aria-label="Minuteur indicatif"><span><b id="uw-clock">${r ? mmss(r.left) : '—'}</b><span>indicatif</span></span></div>
    <div><p class="sz-eyebrow" style="color:var(--rose)">Au tour de</p>
      <p class="uw-who">${avatarHtml(p, 34)}<span>${esc(p.pseudo)}</span></p>
      ${next ? `<p class="sz-small sz-muted">Ensuite : ${esc(who(next.user_id).pseudo)}</p>` : '<p class="sz-small sz-muted">Dernier déballage</p>'}</div></div>`;
}

/** Ordre de passage. */
function orderHtml() {
  const order = U.st.order || [];
  if (!order.length) return '';
  const cur = order.find((o) => o.status === 'en_cours');
  const nextId = cur ? (order.find((o) => o.position > cur.position && ['attente', 'passe'].includes(o.status))?.user_id) : null;
  return `<section class="sz-card" aria-labelledby="uw-o-t"><h3 class="sz-h3" id="uw-o-t">Ordre de passage (tiré au sort)</h3>
    <ol class="uw-order">${order.map((o, i) => {
      const p = who(o.user_id);
      const isNext = o.user_id === nextId;
      const lab = isNext ? 'Ensuite' : ST_LABEL[o.status] || o.status;
      return `<li class="${o.status === 'en_cours' ? 'is-cur' : ''}"><span class="uw-pos">${i + 1}</span>${avatarHtml(p, 28)}<span>${esc(p.pseudo)}</span>
        <span class="uw-st is-${isNext ? 'next' : esc(o.status)}">${o.status === 'fait' ? svg('check', { size: 12 }) + ' ' : ''}${esc(lab)}</span></li>`;
    }).join('')}</ol></section>`;
}

/** Avant la soirée : qui a reçu, sondage de dates. */
function beforeHtml() {
  const rec = U.st.received || [];
  const ev = U.st.event;
  const recTxt = U.st.all_received ? 'Tout le monde a reçu son cadeau !' : `${rec.filter((r) => r.received).length} sur ${rec.length} ont reçu leur cadeau`;
  const dates = ev?.dates || [];
  const fixed = ev?.starts_at;
  return `<section class="sz-card" aria-labelledby="uw-b-t"><h3 class="sz-h3" id="uw-b-t">Avant la soirée</h3>
    <p class="sz-small sz-muted" style="margin-top:6px">${esc(recTxt)}</p>
    <div class="uw-recv">${rec.map((r) => `<span class="pill ${r.received ? 'pill-ok' : 'pill-todo'}">${r.received ? svg('check', { size: 12 }) : ''} ${esc(who(r.user_id).pseudo)}<span class="visually-hidden">${r.received ? ' : reçu' : ' : pas encore reçu'}</span></span>`).join('')}</div>
    ${fixed ? `<p style="margin-top:12px"><strong>Rendez-vous ${esc(fmtWhen(fixed))}</strong>, en vocal.</p>` : ''}
    ${!fixed && dates.length ? `<p class="sz-small" style="margin-top:12px">Quelle date te va ? (plusieurs choix possibles)</p>
      <div class="uw-dates">${dates.map((d) => `<button type="button" class="btn btn-ghost" data-vote="${esc(d.id)}" aria-pressed="${!!d.mine}">${esc(fmtWhen(d.at))} · ${Number(d.votes) || 0}</button>`).join('')}</div>` : ''}
  </section>`;
}

/** Album de la soirée. */
function albumHtml() {
  const ev = U.st.event;
  if (!ev) return '';
  const imgs = U.photos.map((p, i) => U.urls.get(p.path) ? `<button type="button" class="uw-add" data-zoom="${i}" aria-label="Agrandir la photo ${i + 1}"><img src="${esc(U.urls.get(p.path))}" alt="" loading="lazy" decoding="async"></button>` : '').join('');
  return `<section class="sz-card" aria-labelledby="uw-a-t"><div class="sz-between"><h3 class="sz-h3" id="uw-a-t">Album de la soirée</h3>
    <span class="sz-small sz-muted">${U.photos.length} ${U.photos.length > 1 ? 'photos' : 'photo'}</span></div>
    <div class="uw-album">${imgs}<label class="uw-add" title="Ajouter une photo de ton cadeau">${svg('upload', { size: 18 })}<span class="visually-hidden">Ajouter une photo de ton cadeau</span>
      <input type="file" accept="image/*" data-photo></label></div>
    <p class="sz-small sz-muted" style="margin-top:8px">Pense à cacher l’étiquette du colis avant la photo.</p></section>`;
}

/** Panneau de l'organisateur (Staff « secret_santa »). */
function pilotHtml() {
  if (!U.st.can_pilot) return '';
  const ev = U.st.event, order = U.st.order || [];
  if (!ev) {
    return `<section class="sz-card uw-pilot" aria-labelledby="uw-p-t"><div class="sz-between"><h3 class="sz-h3" id="uw-p-t">Organisateur</h3><span class="pill">Staff Secret Santa</span></div>
      <form class="stack" data-setup style="margin-top:10px">
        <div class="field"><label for="uw-title">Titre</label><input id="uw-title" maxlength="120" value="Soirée déballage ${esc(U.ed.year)}"></div>
        ${[1, 2, 3, 4].map((i) => `<div class="field"><label for="uw-d${i}">Date proposée ${i}${i > 2 ? ' (facultatif)' : ''}</label><input id="uw-d${i}" type="datetime-local"></div>`).join('')}
        <div class="field"><label for="uw-turn">Minuteur indicatif (minutes)</label><input id="uw-turn" type="number" min="1" max="30" value="5"></div>
        <div class="btn-row"><button class="btn btn-sand" type="submit">Créer la soirée</button></div></form></section>`;
  }
  const running = order.some((o) => o.status === 'en_cours');
  const fixBtns = !ev.starts_at && (ev.dates || []).length
    ? `<p class="sz-small" style="margin-top:10px">Fixer la date gagnante :</p><div class="uw-dates">${ev.dates.map((d) => `<button type="button" class="btn btn-ghost" data-fix="${esc(d.id)}">${esc(fmtWhen(d.at))} (${Number(d.votes) || 0})</button>`).join('')}</div>` : '';
  return `<section class="sz-card uw-pilot" aria-labelledby="uw-p-t"><div class="sz-between"><h3 class="sz-h3" id="uw-p-t">Organisateur</h3><span class="pill">Staff Secret Santa</span></div>
    ${fixBtns}
    <div class="btn-row" style="margin-top:12px">
      ${running ? `<button class="btn btn-sand" type="button" data-next="suivant">Suivant</button>
        <button class="btn btn-ghost" type="button" data-next="passer">Passer (absent)</button>
        <button class="btn btn-ghost" type="button" data-next="en_route">Cadeau en route</button>` : ''}
      <button class="btn btn-ghost" type="button" data-draw>${order.length ? 'Tirer un nouvel ordre' : 'Tirer l’ordre'}</button>
      ${order.filter((o) => o.status === 'en_route' || o.status === 'passe').map((o) => `<button class="btn btn-ghost" type="button" data-pick="${esc(o.user_id)}">Faire passer ${esc(who(o.user_id).pseudo)}</button>`).join('')}
      ${U.st.status === 'envoi' ? '<button class="btn btn-ghost" type="button" data-reveal>Révéler les paires</button>' : ''}
    </div></section>`;
}

/** Dessine le bloc. */
function render() {
  if (!U.el || !U.st) return;
  const ev = U.st.event;
  const when = ev?.starts_at ? `${fmtWhen(ev.starts_at)} · en vocal · ` : '';
  U.el.innerHTML = `
    <div class="eyebrow">Secret Santa ${esc(U.ed.year)}</div>
    <h2 id="ss-unwrap-t" class="ss-reveal-title">${esc(ev?.title || 'Soirée déballage')}</h2>
    <p class="sz-small sz-muted">${esc(when)}${(U.st.received || []).length} participants</p>
    <div class="sz-stack" style="margin-top:14px">
      ${(U.st.order || []).length ? nowHtml() : beforeHtml()}
      ${pilotHtml()}
      ${orderHtml()}
      ${albumHtml()}
    </div>`;
}

/** Recharge l'état, puis l'album. */
async function load() {
  const { data, error } = await sb.rpc('hg_ss_unwrap_state', { p_edition: U.ed.id });
  if (error) throw error;
  U.st = data;
  if (data?.event?.id) {
    const { data: ph } = await sb.from('hg_photos').select('id,path,user_id').eq('event_id', data.event.id).order('created_at', { ascending: true });
    U.photos = ph || [];
    const todo = U.photos.map((p) => p.path).filter((p) => !U.urls.has(p));
    if (todo.length) { try { for (const [k, v] of await signedUrls(todo)) U.urls.set(k, v); } catch { /* miniatures absentes */ } }
  }
}
const refresh = async () => { try { await load(); render(); } catch (e) { console.warn('[déballage]', e); } };

/** Appel Staff avec message d'erreur lisible. */
async function staffCall(btn, fn, args, okMsg) {
  if (btn) btn.disabled = true;
  try {
    const { error } = await sb.rpc(fn, args);
    if (error) throw error;
    if (okMsg) toast(okMsg, 'success');
    await refresh();
    return true;
  } catch (e) {
    toast(errMsg(e), 'error');
    if (btn) btn.disabled = false;
    return false;
  }
}

/** Envoie une photo dans l'album de la soirée. */
async function addPhoto(input) {
  const f = input.files?.[0];
  if (!f || !U.st?.event?.id) return;
  input.disabled = true;
  let path = null;
  try {
    const img = await prepareImage(f);
    path = `${U.me.id}/${U.st.event.id}/${uuid()}.${img.ext}`;
    await uploadImage(path, img.blob);
    const { error } = await sb.from('hg_photos').insert({ event_id: U.st.event.id, user_id: U.me.id, path });
    if (error) throw error;
    toast('Photo ajoutée à l’album de la soirée', 'success');
    await refresh();
  } catch (e) {
    if (path) removeObjects([path]).catch(() => {});
    toast(errMsg(e), 'error');
  } finally { input.disabled = false; input.value = ''; }
}

/** Branche les événements (une fois). */
function bind() {
  U.el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.vote) {
      const on = t.getAttribute('aria-pressed') === 'true';
      t.disabled = true;
      const q = on ? sb.from('hg_event_date_votes').delete().eq('date_id', t.dataset.vote).eq('user_id', U.me.id)
        : sb.from('hg_event_date_votes').insert({ date_id: t.dataset.vote, user_id: U.me.id });
      const { error } = await q;
      if (error) { toast(errMsg(error), 'error'); t.disabled = false; return; }
      await refresh();
    } else if (t.dataset.fix) {
      await staffCall(t, 'hg_ss_unwrap_fix_date', { p_edition: U.ed.id, p_date: t.dataset.fix }, 'Date de la soirée fixée');
    } else if (t.dataset.next) {
      await staffCall(t, 'hg_ss_unwrap_next', { p_edition: U.ed.id, p_action: t.dataset.next, p_user: null });
    } else if (t.dataset.pick) {
      await staffCall(t, 'hg_ss_unwrap_next', { p_edition: U.ed.id, p_action: 'choisir', p_user: t.dataset.pick });
    } else if (t.hasAttribute('data-draw')) {
      const again = (U.st.order || []).length > 0;
      if (again && !(await confirmBox('Tirer un nouvel ordre ?', 'L’ordre actuel et les déballages déjà notés seront remplacés.', { ok: 'Tirer à nouveau', danger: true }))) return;
      await staffCall(t, 'hg_ss_unwrap_draw', { p_edition: U.ed.id, p_force: again }, 'Ordre de passage tiré');
    } else if (t.hasAttribute('data-reveal')) {
      if (!(await confirmBox('Révéler les paires ?', 'Tout le monde verra qui offrait à qui.', { ok: 'Révéler' }))) return;
      if (await staffCall(t, 'hg_ss_unwrap_reveal', { p_edition: U.ed.id }, 'Paires révélées')) U.onReveal?.();
    } else if (t.dataset.zoom) {
      const items = U.photos.filter((p) => U.urls.get(p.path)).map((p) => ({ url: U.urls.get(p.path), alt: 'Photo de la soirée déballage' }));
      openLightbox(items, Number(t.dataset.zoom));
    }
  });
  U.el.addEventListener('change', (e) => { if (e.target.matches('input[data-photo]')) addPhoto(e.target); });
  U.el.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-setup]');
    if (!f) return;
    e.preventDefault();
    const dates = [1, 2, 3, 4].map((i) => f.querySelector(`#uw-d${i}`).value).filter(Boolean).map((v) => new Date(v).toISOString());
    const minutes = Number(f.querySelector('#uw-turn').value) || 5;
    await staffCall(f.querySelector('button[type="submit"]'), 'hg_ss_unwrap_setup',
      { p_edition: U.ed.id, p_title: f.querySelector('#uw-title').value, p_dates: dates, p_turn_seconds: Math.round(minutes * 60) }, 'Soirée créée');
  });
}

/** Met à jour le minuteur chaque seconde (sans redessiner le reste). */
function startTick() {
  clearInterval(U.tick);
  U.tick = setInterval(() => {
    const el = U.el?.querySelector('#uw-clock');
    const r = remaining();
    if (!el || !r) return;
    el.textContent = mmss(r.left);
    el.closest('.uw-timer')?.style.setProperty('--p', String(Math.max(0, Math.round((r.left / r.total) * 100))));
  }, 1000);
}

/** Temps réel : l'ordre de passage change chez tout le monde en direct. */
function subscribe() {
  try {
    if (U.channel) sb.removeChannel(U.channel);
    U.channel = sb.channel(`hg-unwrap-${U.ed.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hg_ss_unwrap', filter: `edition_id=eq.${U.ed.id}` }, () => refresh())
      .subscribe();
  } catch (e) { console.warn('[déballage] temps réel indisponible', e); }
}

/**
 * Monte le bloc « Soirée déballage » dans el. Le bloc se retire si la personne n'a pas accès (non inscrite, hors Staff).
 * @param {HTMLElement} el Section vide de la page Secret Santa.
 * @param {{ed: object, me: object, members: Map, onReveal?: Function}} ctx
 */
export async function mountUnwrap(el, ctx) {
  if (!el || !ctx?.ed) return;
  loadSeasonCss();
  Object.assign(U, { el, ed: ctx.ed, me: ctx.me, members: ctx.members || new Map(), onReveal: ctx.onReveal || null });
  try {
    await load();
  } catch {
    el.remove();
    return;
  }
  if (!U.st?.event && !U.st?.can_pilot && !(U.st?.order || []).length) {
    // Rien de prévu encore : un petit mot seulement.
    el.innerHTML = `<div class="eyebrow">Secret Santa ${esc(U.ed.year)}</div><h2 id="ss-unwrap-t" class="ss-reveal-title">Soirée déballage</h2>
      <p class="sz-small sz-muted">L’organisateur proposera bientôt des dates pour ouvrir les cadeaux ensemble, en vocal.</p>`;
    return;
  }
  render();
  bind();
  startTick();
  subscribe();
  if (location.hash === '#deballage') requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
}
