// ===== Humane Gang — Capsule temporelle (capsule.html), idée S7 =====
/*
 * Rôle : liste des capsules (capsule.html) et page d'une capsule (capsule.html?id=<uuid>).
 *   Avant l'ouverture : cadenas, compte à rebours, compteur (« 9 membres ont glissé 14 objets »), mes dépôts
 *   (3 au plus : mot, photo ou prédiction), retrait possible jusqu'à la fermeture des dépôts. Personne ne lit les
 *   dépôts des autres : la base ne les livre qu'après l'heure d'ouverture (heure du serveur).
 *   Après l'ouverture : tous les objets, le mode « Ouverture ensemble » (plein écran, objets un par un dans un ordre
 *   mélangé, auteur révélé après chaque objet), vote « Réalisée / Ratée » sur les prédictions, masquage de son objet.
 *   Staff « souvenirs » et organisateur de la sortie liée : créer et modifier une capsule (jamais avancer l'ouverture).
 * Dépendances : core.js, image-compress.js, photos.js (uuid, visionneuse), contenus-ui.js.
 * Données : RPC hg_capsules_list, hg_capsule_get, hg_capsule_save, hg_capsule_deposit, hg_capsule_withdraw,
 *   hg_capsule_vote, hg_capsule_hide, hg_members ; stockage privé hg-capsules (<capsule>/<membre>/<fichier>).
 * Tout texte venant de la base passe par esc(). Le fichier n'exporte rien.
 */
import { sb, initPage, esc, $, toast, errMsg, motionAllowed } from './core.js';
import { prepareImage } from './image-compress.js';
import { uuid, openLightbox } from './photos.js';
import { loadPeople, pseudoOf, formDialog, fmtJour, fmtJourHeure } from './contenus-ui.js';
import { pluralWord } from './utils.js';

const me = await initPage();

const BUCKET = 'hg-capsules';
const ID = /^[0-9a-f-]{36}$/i.test(new URLSearchParams(location.search).get('id') || '') ? new URLSearchParams(location.search).get('id') : null;
const S = { list: null, data: null, people: new Map(), urls: new Map(), kind: 'mot', timer: 0, skew: 0, busy: false, show: null };
const ICON = {
  lock: '<svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  open: '<svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
  mot: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  photo: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 7l2-3h4l2 3"/></svg>',
  prediction: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6"/></svg>',
};
const KINDS = [['mot', 'Mot'], ['photo', 'Photo'], ['prediction', 'Prédiction']];
const KIND_LABEL = { mot: 'Mot', photo: 'Photo', prediction: 'Prédiction' };

/** Heure du serveur estimée (décalage mesuré au chargement) : le compte à rebours ne dépend pas de l'horloge de l'appareil. */
const nowMs = () => Date.now() + S.skew;

/** URL signées des photos d'une capsule (bucket privé). */
async function sign(paths) {
  const todo = [...new Set(paths.filter(Boolean))].filter((p) => !S.urls.has(p));
  if (!todo.length) return;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(todo, 3600);
  if (error) { console.warn('[capsule] url', error); return; }
  for (const r of data || []) if (r.signedUrl) S.urls.set(r.path, r.signedUrl);
}

/* =========================================================
   Liste des capsules
   ========================================================= */
function drawList() {
  const d = S.list;
  const caps = d.capsules || [];
  const card = (c) => {
    const open = c.is_open;
    return `<li class="card cp-li ${open ? 'is-open' : 'card-irl'}">
      <span class="cp-li-ico" aria-hidden="true">${open ? ICON.open : ICON.lock}</span>
      <div class="cp-li-body"><h2><a href="capsule.html?id=${esc(c.id)}">${esc(c.title)}</a></h2>
        <p class="small muted">${open ? `Ouverte le ${esc(fmtJour(c.opens_at))}` : `Ouverture le ${esc(fmtJourHeure(c.opens_at))}`}${c.event_title ? ` · ${esc(c.event_title)}` : ''}</p>
        <p class="small">${c.members} ${pluralWord(c.members, 'membre a', 'membres ont')} glissé ${c.items} ${pluralWord(c.items, 'objet', 'objets')}${c.mine ? ` · dont ${c.mine} de toi` : ''}</p></div>
    </li>`;
  };
  $('#cp-root').innerHTML = `<div class="page-head ct-head">
      <div><div class="eyebrow">Souvenirs</div><h1 class="page-title">Capsules temporelles</h1>
        <p class="ct-intro muted">Des mots, des photos et des prédictions scellés jusqu’à une date, puis ouverts tous ensemble. Personne ne lit les dépôts avant l’ouverture.</p></div>
      ${d.can_create ? '<button type="button" class="btn btn-sand" id="cp-new">+ Nouvelle capsule</button>' : ''}
    </div>
    <ul class="cp-list">${caps.length ? caps.map(card).join('') : '<li class="ct-empty">Aucune capsule pour le moment.</li>'}</ul>`;
}

/* =========================================================
   Page d'une capsule
   ========================================================= */

/** Compte à rebours (jours, heures, minutes, secondes) jusqu'à t. */
function countdownHtml(t) {
  const left = Math.max(0, new Date(t).getTime() - nowMs());
  const j = Math.floor(left / 864e5), h = Math.floor(left / 36e5) % 24, m = Math.floor(left / 6e4) % 60, s = Math.floor(left / 1e3) % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `<div class="cp-cd" role="timer" aria-label="Ouverture dans ${j} ${pluralWord(j, 'jour', 'jours')} ${h} ${pluralWord(h, 'heure', 'heures')} ${m} min">
    <div><b>${j}</b><span>${pluralWord(j, 'jour', 'jours')}</span></div><div><b>${p(h)}</b><span>heures</span></div>
    <div><b>${p(m)}</b><span>min</span></div><div><b aria-hidden="true">${p(s)}</b><span aria-hidden="true">s</span></div></div>`;
}

/** Libellé court d'un objet déposé. */
function itemText(i) {
  if (i.kind === 'photo') return `Photo${i.body ? ` · ${esc(i.body)}` : ''}`;
  return `${i.kind === 'prediction' ? 'Prédiction : ' : ''}${esc(i.body)}`;
}

/** Page d'une capsule scellée (avant l'ouverture). */
function sealedHtml(d) {
  const c = d.capsule;
  const depositOpen = new Date(c.deposit_until).getTime() > nowMs();
  const mine = d.mine || [];
  const full = mine.length >= 3;
  return `<div class="cp-hero">
      <div class="cp-lock" aria-hidden="true">${ICON.lock}</div>
      <p class="eyebrow">Capsule temporelle · scellée</p>
      <h1 class="cp-title">${esc(c.title)}</h1>
      <p class="small muted">${c.event_title ? `Liée à la sortie « ${esc(c.event_title)} ». ` : ''}Ouverture pour tout le monde le ${esc(fmtJourHeure(c.opens_at))}.</p>
      ${c.description ? `<p class="cp-desc">${esc(c.description)}</p>` : ''}
    </div>
    <div id="cp-cd">${countdownHtml(c.opens_at)}</div>
    <div class="card card-irl cp-count"><p class="small"><strong>${d.members} ${pluralWord(d.members, 'membre', 'membres')}</strong> ${pluralWord(d.members, 'a', 'ont')} glissé <strong>${d.items_count} ${pluralWord(d.items_count, 'objet', 'objets')}</strong></p>
      <p class="small muted">${depositOpen ? `dépôts jusqu’au ${esc(fmtJour(c.deposit_until))}` : 'dépôts fermés'}</p></div>
    <section class="card cp-mine" aria-labelledby="cp-mine-h">
      <div class="cp-mine-head"><h2 id="cp-mine-h">Mes dépôts</h2><p class="small muted">${mine.length} sur 3</p></div>
      <ul class="cp-items">${mine.map((i) => `<li class="cp-item"><span class="cp-k cp-k-${esc(i.kind)}" title="${KIND_LABEL[i.kind]}">${ICON[i.kind] || ''}<span class="visually-hidden">${KIND_LABEL[i.kind]}</span></span>
        <p class="small">${itemText(i)}</p>
        ${depositOpen ? `<button type="button" class="btn btn-ghost cp-small" data-withdraw="${esc(i.id)}">Retirer</button>` : ''}</li>`).join('') || '<li class="small muted">Tu n’as encore rien glissé.</li>'}</ul>
      ${depositOpen && !full ? `<form class="cp-form" id="cp-form" novalidate>
          <div class="cp-kinds" role="group" aria-label="Type d’objet">${KINDS.map(([k, l]) => `<button type="button" class="cp-kind" data-kind="${k}" aria-pressed="${S.kind === k}">${ICON[k]}${l}</button>`).join('')}</div>
          ${S.kind === 'photo'
            ? `<div class="field"><label for="cp-file">Photo</label><input id="cp-file" type="file" accept="image/jpeg,image/png,image/webp"></div>
               <div class="field"><label for="cp-body">Légende (facultatif)</label><input id="cp-body" maxlength="200"></div>`
            : `<div class="field"><label for="cp-body">${S.kind === 'prediction' ? 'Ta prédiction' : 'Ton mot'}</label>
               <textarea id="cp-body" maxlength="1000" rows="3" placeholder="${S.kind === 'prediction' ? 'En 2027, Carzy aura enfin vu KC gagner les Worlds…' : 'Un mot pour le gang du futur…'}"></textarea></div>`}
          <button type="submit" class="btn btn-sand cp-submit">${ICON.lock} Glisser dans la capsule</button>
          <p class="cp-err small" role="alert" hidden></p>
        </form>` : `<p class="small muted">${depositOpen ? 'Tu as glissé tes 3 objets.' : 'Les dépôts sont fermés : rendez-vous à l’ouverture.'}</p>`}
      <p class="small muted cp-promise">Personne ne lit les dépôts avant l’ouverture, ni sur le site ni dans l’administration. (L’administrateur technique de la base pourrait techniquement les lire en SQL ; il ne le fait pas.)</p>
    </section>`;
}

/** Page d'une capsule ouverte : tous les objets, votes, masquage, mode « Ouverture ensemble ». */
function openedHtml(d) {
  const c = d.capsule;
  const items = d.items || [];
  const card = (i) => `<li class="card cp-open-item${i.hidden ? ' is-hidden' : ''}">
      <p class="cp-ok-kind"><span class="cp-k cp-k-${esc(i.kind)}" aria-hidden="true">${ICON[i.kind] || ''}</span> ${KIND_LABEL[i.kind] || ''} · <strong>${esc(pseudoOf(S.people, i.user_id))}</strong></p>
      ${i.kind === 'photo' ? `<button type="button" class="cp-photo" data-zoom="${esc(i.id)}" aria-label="Voir la photo en grand">${S.urls.get(i.path) ? `<img src="${esc(S.urls.get(i.path))}" alt="" loading="lazy">` : ''}</button>${i.body ? `<p>${esc(i.body)}</p>` : ''}`
        : `<p class="cp-ok-text">${esc(i.body)}</p>`}
      ${i.kind === 'prediction' && !i.hidden ? `<div class="btn-row cp-verdict" role="group" aria-label="La prédiction s’est-elle réalisée ?">
          <button type="button" class="btn ${i.my_vote === 'realisee' ? 'btn-sand' : 'btn-ghost'}" data-verdict="realisee" data-id="${esc(i.id)}" aria-pressed="${i.my_vote === 'realisee'}">Réalisée · ${i.realisee}</button>
          <button type="button" class="btn ${i.my_vote === 'ratee' ? 'btn-sand' : 'btn-ghost'}" data-verdict="ratee" data-id="${esc(i.id)}" aria-pressed="${i.my_vote === 'ratee'}">Ratée · ${i.ratee}</button></div>` : ''}
      ${i.user_id === me.id || c.can_manage ? `<button type="button" class="btn btn-ghost cp-small" data-hide="${esc(i.id)}" data-hidden="${i.hidden}">${i.hidden ? 'Réafficher' : 'Masquer'}</button>` : ''}
      ${i.hidden ? '<p class="small muted">Masqué : visible seulement par son auteur et le Staff.</p>' : ''}
    </li>`;
  return `<div class="cp-hero">
      <div class="cp-lock is-open" aria-hidden="true">${ICON.open}</div>
      <p class="eyebrow">Capsule temporelle · ouverte</p>
      <h1 class="cp-title">${esc(c.title)}</h1>
      <p class="small muted">Ouverte le ${esc(fmtJourHeure(c.opens_at))} · ${items.length} ${pluralWord(items.length, 'objet', 'objets')}</p>
      ${items.length ? '<button type="button" class="btn btn-sand" id="cp-show">Ouverture ensemble</button>' : ''}
    </div>
    <ul class="cp-open-list">${items.map(card).join('') || '<li class="ct-empty">La capsule était vide.</li>'}</ul>`;
}

function drawCapsule() {
  const d = S.data;
  if (!d) { $('#cp-root').innerHTML = '<p class="ct-empty">Capsule introuvable. <a href="capsule.html">Toutes les capsules</a></p>'; return; }
  const c = d.capsule;
  $('#cp-root').innerHTML = `<p class="cp-back"><a href="capsule.html">← Toutes les capsules</a>${c.can_manage && !c.is_open ? ' · <button type="button" class="cp-link" id="cp-edit">Modifier la capsule</button>' : ''}</p>
    ${c.is_open ? openedHtml(d) : sealedHtml(d)}`;
  document.title = `${c.title} · Humane Gang`;
  clearInterval(S.timer);
  if (!c.is_open) {
    S.timer = setInterval(() => {
      if (new Date(c.opens_at).getTime() <= nowMs()) { clearInterval(S.timer); load(); return; }
      const box = $('#cp-cd');
      if (box) box.innerHTML = countdownHtml(c.opens_at);
    }, 1000);
  }
}

/* =========================================================
   Mode « Ouverture ensemble »
   ========================================================= */
function openShow() {
  const items = (S.data.items || []).filter((i) => !i.hidden);
  const order = items.map((i) => [Math.random(), i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const back = document.activeElement;
  const dlg = document.createElement('dialog');
  dlg.className = 'cp-show';
  dlg.setAttribute('aria-label', `Ouverture ensemble : ${S.data.capsule.title}`);
  document.body.append(dlg);
  const st = { i: 0, revealed: false };
  const paint = () => {
    const it = order[st.i];
    const last = st.i >= order.length - 1;
    dlg.innerHTML = `<div class="cp-show-in${motionAllowed() ? ' is-anim' : ''}">
      <p class="cp-show-n">${st.i + 1} / ${order.length}</p>
      <p class="eyebrow">${KIND_LABEL[it.kind]}</p>
      ${it.kind === 'photo' ? `<div class="cp-show-photo">${S.urls.get(it.path) ? `<img src="${esc(S.urls.get(it.path))}" alt="Photo glissée dans la capsule">` : ''}</div>${it.body ? `<p class="cp-show-text cp-show-cap">${esc(it.body)}</p>` : ''}`
        : `<p class="cp-show-text">${esc(it.body)}</p>`}
      <p class="cp-show-who" aria-live="polite">${st.revealed ? `— ${esc(pseudoOf(S.people, it.user_id))}` : ''}</p>
      <div class="btn-row cp-show-actions">
        <button type="button" class="btn btn-ghost" data-show="close">Fermer</button>
        ${st.revealed ? (last ? '<button type="button" class="btn btn-sand" data-show="close">Fin de la capsule</button>' : '<button type="button" class="btn btn-sand" data-show="next">Objet suivant</button>')
          : '<button type="button" class="btn btn-sand" data-show="reveal">Qui l’a écrit ?</button>'}
      </div></div>`;
    dlg.querySelector('.btn-sand')?.focus();
  };
  const close = () => { dlg.close(); dlg.remove(); back?.focus?.(); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => {
    const a = e.target.closest('[data-show]')?.dataset.show;
    if (a === 'close') close();
    if (a === 'reveal') { st.revealed = true; paint(); }
    if (a === 'next') { st.i += 1; st.revealed = false; paint(); }
  });
  paint();
  dlg.showModal();
}

/* =========================================================
   Données et actions
   ========================================================= */
async function load() {
  try {
    if (!S.people.size) S.people = await loadPeople();
    if (!ID) {
      const { data, error } = await sb.rpc('hg_capsules_list');
      if (error) throw error;
      S.list = data || { capsules: [] };
      if (S.list.now) S.skew = new Date(S.list.now).getTime() - Date.now();
      drawList();
    } else {
      const { data, error } = await sb.rpc('hg_capsule_get', { p_capsule: ID });
      if (error) throw error;
      S.data = data;
      if (data?.now) S.skew = new Date(data.now).getTime() - Date.now();
      if (data) await sign([...(data.mine || []), ...(data.items || [])].map((i) => i.path));
      drawCapsule();
    }
  } catch (e) {
    console.warn('[capsule]', e);
    $('#cp-root').innerHTML = '<p class="ct-empty">Capsules indisponibles pour le moment. Recharge la page dans un instant.</p>';
  }
  $('#app').setAttribute('aria-busy', 'false');
}

/** Valeur d'un champ datetime-local à partir d'une date ISO (heure locale de l'appareil). */
const localInput = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/** Créer ou modifier une capsule. */
async function editCapsule(c = null) {
  let events = S.list?.events;
  if (!events) {
    const { data } = await sb.rpc('hg_capsules_list');
    events = data?.events || [];
  }
  if (c?.event_id && !events.some((e) => e.id === c.event_id)) events = [{ id: c.event_id, title: c.event_title || 'Sortie liée' }, ...events];
  formDialog({
    title: c ? 'Modifier la capsule' : 'Nouvelle capsule',
    submit: c ? 'Enregistrer' : 'Créer la capsule',
    body: `<div class="field"><label for="ce-title">Titre</label><input id="ce-title" name="title" maxlength="80" required value="${esc(c?.title || '')}" placeholder="Nouvel an 2027"></div>
      <div class="field"><label for="ce-desc">Description (facultatif)</label><textarea id="ce-desc" name="desc" maxlength="300" rows="2">${esc(c?.description || '')}</textarea></div>
      <div class="field"><label for="ce-event">Sortie liée</label><select id="ce-event" name="event"><option value="">Aucune</option>
        ${events.map((e) => `<option value="${esc(e.id)}"${e.id === c?.event_id ? ' selected' : ''}>${esc(e.title)}${e.starts_at ? ` (${esc(fmtJour(e.starts_at))})` : ''}</option>`).join('')}</select></div>
      <div class="field"><label for="ce-dep">Fin des dépôts</label><input id="ce-dep" name="dep" type="datetime-local" required value="${esc(localInput(c?.deposit_until))}"></div>
      <div class="field"><label for="ce-open">Ouverture</label><input id="ce-open" name="open" type="datetime-local" required value="${esc(localInput(c?.opens_at))}"></div>
      ${c ? '<p class="small muted">Une fois des objets déposés, l’ouverture peut être repoussée mais jamais avancée.</p>' : ''}`,
    onSubmit: async (f) => {
      if (!f.dep.value || !f.open.value) throw new Error('Indique la fin des dépôts et l’ouverture.');
      const { data, error } = await sb.rpc('hg_capsule_save', {
        p_id: c?.id || null, p_title: f.title.value.trim(), p_description: f.desc.value.trim() || null, p_event: f.event.value || null,
        p_deposit_until: new Date(f.dep.value).toISOString(), p_opens_at: new Date(f.open.value).toISOString(),
      });
      if (error) throw error;
      toast(c ? 'Capsule modifiée.' : 'Capsule créée !', 'success');
      if (!c && data) { location.href = `capsule.html?id=${encodeURIComponent(data)}`; return; }
      await load();
    },
  });
}

/** Dépôt d'un objet (photo : envoi au stockage d'abord). */
async function deposit(form) {
  if (S.busy) return;
  const err = form.querySelector('.cp-err');
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  err.hidden = true;
  const body = form.querySelector('#cp-body')?.value.trim() || '';
  let path = null;
  S.busy = true;
  form.querySelector('.cp-submit').disabled = true;
  try {
    if (S.kind === 'photo') {
      const file = form.querySelector('#cp-file')?.files?.[0];
      if (!file) throw new Error('Choisis une photo.');
      const img = await prepareImage(file, { strip: true });
      path = `${ID}/${me.id}/${uuid()}.${img.ext === 'jpg' ? 'jpg' : 'webp'}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, img.blob, { contentType: img.contentType, upsert: false });
      if (error) throw error;
    } else if (!body) {
      throw new Error(S.kind === 'prediction' ? 'Écris ta prédiction.' : 'Écris ton mot.');
    }
    const { error } = await sb.rpc('hg_capsule_deposit', { p_capsule: ID, p_kind: S.kind, p_body: body || null, p_path: path });
    if (error) {
      if (path) sb.storage.from(BUCKET).remove([path]).catch(() => {});
      throw error;
    }
    toast('Glissé dans la capsule ! Rendez-vous à l’ouverture.', 'success');
    await load();
    $('#cp-mine-h')?.focus?.();
  } catch (e) {
    fail(errMsg(e));
    form.querySelector('.cp-submit').disabled = false;
  } finally {
    S.busy = false;
  }
}

/** Appelle une RPC d'action puis recharge ; une erreur s'affiche en message. */
async function act(fn, args, okMsg) {
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw error;
    if (okMsg) toast(okMsg, 'success');
    await load();
    return data;
  } catch (e) {
    toast(errMsg(e), 'error');
    return null;
  }
}

/* ---------- Écouteurs ---------- */
$('#app').addEventListener('click', async (e) => {
  if (e.target.closest('#cp-new')) { editCapsule(null); return; }
  if (e.target.closest('#cp-edit')) { editCapsule(S.data.capsule); return; }
  if (e.target.closest('#cp-show')) { openShow(); return; }
  const k = e.target.closest('[data-kind]');
  if (k) {
    const typed = S.kind !== 'photo' ? $('#cp-body')?.value : '';
    S.kind = k.dataset.kind;
    drawCapsule();
    if (typed && S.kind !== 'photo') $('#cp-body').value = typed; // le texte commencé n'est pas perdu
    $(`[data-kind="${S.kind}"]`)?.focus();
    return;
  }
  const w = e.target.closest('[data-withdraw]');
  if (w) {
    const path = await act('hg_capsule_withdraw', { p_item: w.dataset.withdraw }, 'Objet retiré de la capsule.');
    if (path) sb.storage.from(BUCKET).remove([path]).catch(() => {});
    return;
  }
  const v = e.target.closest('[data-verdict]');
  if (v) {
    const again = v.getAttribute('aria-pressed') === 'true';
    act('hg_capsule_vote', { p_item: v.dataset.id, p_verdict: again ? null : v.dataset.verdict });
    return;
  }
  const h = e.target.closest('[data-hide]');
  if (h) { act('hg_capsule_hide', { p_item: h.dataset.hide, p_hidden: h.dataset.hidden !== 'true' }, h.dataset.hidden === 'true' ? 'Objet réaffiché.' : 'Objet masqué.'); return; }
  const z = e.target.closest('[data-zoom]');
  if (z) {
    const it = (S.data.items || []).find((i) => i.id === z.dataset.zoom);
    if (it && S.urls.get(it.path)) openLightbox([{ url: S.urls.get(it.path), alt: 'Photo de la capsule', caption: pseudoOf(S.people, it.user_id) }], 0);
  }
});
$('#app').addEventListener('submit', (e) => {
  if (e.target.id !== 'cp-form') return;
  e.preventDefault();
  deposit(e.target);
});

load();
