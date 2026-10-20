// ===== Human Gang — page Secret Santa =====
import { sb, initPage, toast, errMsg, esc, $, fmtDate, fmtDateTime, daysUntil, avatarHtml, notify, LOGO_SRC } from './core.js';
import { renderCardFront, renderCardBack, downloadCanvas } from './ss-card.js';
import { INFO_GROUPS, INFO_LABEL } from './profile-fields.js';

const me = await initPage({ auth: 'member' });
const app = $('#app');

const STEPS = [['inscriptions', 'Inscriptions'], ['tirage', 'Tirage'], ['envoi', 'Envoi'], ['revelation', 'Révélation']];
const ORDER = ['inscriptions', 'tirage', 'envoi', 'revelation', 'termine'];
const DRAWN = ['envoi', 'revelation', 'termine'];

/* ---------- Icônes (SVG à trait) ---------- */
const I = {
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  flip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/></svg>',
  download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  arrow: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15"/><path d="M13 6l6 6-6 6"/></svg>',
  gift: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8"/><path d="M12 8v12"/><path d="M12 8c-2-4-6-4-6-1.5S9 8 12 8zM12 8c2-4 6-4 6-1.5S15 8 12 8z"/></svg>',
  box: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>',
};

/* ---------- État ---------- */
const S = {
  ed: null,
  mine: null,           // ma ligne hg_ss_participants
  participants: [],     // lignes hg_ss_participants
  members: new Map(),   // id -> {pseudo, avatar_url, color}
  myWishes: [],
  target: null,         // {receiver_id, pseudo, avatar_url}
  targetWishes: [],
  targetInfo: {},       // infos diverses de la cible (filtrées par shared_fields côté base)
  progress: null,       // {participants, sent, received}
  reveal: [],
  revealed: false,      // carte déjà retournée une fois (mémorisé localement)
};

/* ---------- Utilitaires ---------- */
/** Ne garde que les URL http(s) ; ajoute https:// si l'utilisateur a oublié le protocole. */
function safeUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const tryParse = (v) => { try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && u.hostname.includes('.') ? u.href : null; } catch { return null; } };
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return tryParse(s);
  return tryParse(`https://${s}`);
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
const seenKey = () => `hg_ss_seen_${S.ed?.id}`;
function readSeen() { try { return localStorage.getItem(seenKey()) === '1'; } catch { return false; } }
function writeSeen() { try { localStorage.setItem(seenKey(), '1'); } catch {} }
const memberOf = (id) => S.members.get(id) || { pseudo: 'Membre', avatar_url: null, color: null };
const stepIndex = () => ORDER.indexOf(S.ed.status);
const isDrawn = () => DRAWN.includes(S.ed.status);
const isReveal = () => ['revelation', 'termine'].includes(S.ed.status);

/* ---------- Chargement ---------- */
async function loadParticipants() {
  const { data, error } = await sb.from('hg_ss_participants')
    .select('user_id, sent_at, received_at, joined_at').eq('edition_id', S.ed.id).order('joined_at');
  if (error) throw error;
  S.participants = data || [];
  S.mine = S.participants.find((p) => p.user_id === me.id) || null;
}
async function loadMyWishes() {
  const { data, error } = await sb.from('hg_ss_wishes')
    .select('id, label, url, created_at').eq('edition_id', S.ed.id).eq('user_id', me.id).order('created_at');
  if (error) throw error;
  S.myWishes = data || [];
}
async function loadProgress() {
  const { data, error } = await sb.rpc('hg_ss_progress', { p_edition: S.ed.id });
  if (error) throw error;
  S.progress = (Array.isArray(data) ? data[0] : data) || { participants: 0, sent: 0, received: 0 };
}

async function load() {
  const { data: ed, error } = await sb.from('hg_ss_editions').select('*')
    .order('year', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  S.ed = ed;
  if (!ed) return;
  S.revealed = readSeen();

  const [, membersRes] = await Promise.all([
    loadParticipants(),
    sb.rpc('hg_members'),
    loadMyWishes(),
  ]);
  if (membersRes.error) throw membersRes.error;
  S.members = new Map((membersRes.data || []).map((m) => [m.id, m]));

  const jobs = [];
  if (isDrawn()) {
    jobs.push(loadProgress().catch((e) => toast(`Avancement indisponible : ${errMsg(e)}`, 'error')));
    if (S.mine) {
      jobs.push((async () => {
        const { data, error: e } = await sb.rpc('hg_ss_my_target', { p_edition: ed.id });
        if (e) throw e;
        S.target = (Array.isArray(data) ? data[0] : data) || null;
        if (S.target) {
          const { data: w, error: we } = await sb.from('hg_ss_wishes')
            .select('id, label, url, created_at').eq('edition_id', ed.id).eq('user_id', S.target.receiver_id).order('created_at');
          if (we) throw we;
          S.targetWishes = w || [];
          const { data: info, error: ie } = await sb.rpc('hg_ss_target_info', { p_edition: ed.id });
          if (ie) console.warn('[hg_ss_target_info]', ie); // non bloquant : la liste de souhaits reste affichée
          S.targetInfo = info && typeof info === 'object' && !Array.isArray(info) ? info : {};
        }
      })().catch((e) => toast(`Impossible de charger ta cible : ${errMsg(e)}`, 'error')));
    }
  }
  if (isReveal()) {
    jobs.push((async () => {
      const { data, error: e } = await sb.rpc('hg_ss_reveal', { p_edition: ed.id });
      if (e) throw e;
      S.reveal = data || [];
    })().catch((e) => toast(`Révélation indisponible : ${errMsg(e)}`, 'error')));
  }
  await Promise.all(jobs);
}

/* ---------- Rendu : squelette ---------- */
function renderEmpty() {
  app.innerHTML = `
    <div class="page-head"><div>
      <div class="eyebrow">Secret Santa</div>
      <h1 class="page-title">Secret Santa</h1>
    </div></div>
    <div class="card card-ss ss-empty">
      <div class="ss-empty-icon" aria-hidden="true">${I.gift}</div>
      <h2>Pas encore d’édition</h2>
      <p class="muted">L’admin la lancera bientôt. Tu seras prévenu·e sur Discord dès l’ouverture des inscriptions.</p>
    </div>`;
}

function headHtml() {
  const idx = stepIndex();
  const pills = STEPS.map(([key, label], i) => {
    const cls = i < idx ? 'pill-ok' : i === idx ? 'pill-current' : 'pill-todo';
    const state = i < idx ? 'terminée' : i === idx ? 'en cours' : 'à venir';
    return `<li class="pill ${cls}">${i < idx ? I.check : `<span class="ss-step-n" aria-hidden="true">${i + 1}</span>`}${label}<span class="visually-hidden"> (${state})</span></li>`;
  }).join('');
  const dl = daysUntil(S.ed.send_deadline);
  const dlHint = S.ed.send_deadline && S.ed.status === 'envoi' && dl !== null
    ? (dl > 1 ? `dans ${dl} jours` : dl === 1 ? 'demain' : dl === 0 ? 'aujourd’hui' : 'dépassée') : '';
  const facts = [
    ['Budget', S.ed.budget ? esc(S.ed.budget) : '<span class="muted">à définir</span>'],
    ['Envoi avant le', S.ed.send_deadline ? `${esc(fmtDate(S.ed.send_deadline))}${dlHint ? ` <span class="ss-fact-hint">${esc(dlHint)}</span>` : ''}` : '<span class="muted">à définir</span>'],
    ['Échange le', S.ed.exchange_date ? esc(fmtDate(S.ed.exchange_date)) : '<span class="muted">à définir</span>'],
  ].map(([k, v]) => `<div class="ss-fact"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  return `
    <header class="page-head ss-head">
      <div>
        <div class="eyebrow">Édition ${esc(S.ed.year)}</div>
        <h1 class="page-title">Secret Santa</h1>
      </div>
      <ol class="ss-steps" aria-label="Étapes de l’édition">${pills}${S.ed.status === 'termine' ? `<li class="pill pill-ok">${I.check}Terminée</li>` : ''}</ol>
    </header>
    <dl class="ss-facts">${facts}</dl>`;
}

function renderAll() {
  if (!S.ed) return renderEmpty();
  const st = S.ed.status;
  let body = '';
  if (!isDrawn()) {
    body = `
      <div class="row ss-section">
        <section class="card card-ss" id="ss-signup" aria-labelledby="ss-signup-t"></section>
        <section class="card" id="ss-people" aria-labelledby="ss-people-t"></section>
      </div>
      <section class="card ss-section" id="ss-mywishes" aria-labelledby="ss-mywishes-t"></section>`;
  } else {
    body = `
      ${S.mine && S.target ? `
      <section class="ss-target ss-section" aria-labelledby="ss-card-t">
        <div class="ss-card-col" id="ss-card"></div>
        <div class="stack ss-side">
          <section class="card card-ss" id="ss-twishes" aria-labelledby="ss-twishes-t"></section>
          <section class="card" id="ss-send" aria-labelledby="ss-send-t"></section>
        </div>
      </section>` : `<section class="card card-ss ss-section" id="ss-notarget"></section>`}
      <div class="row ss-section">
        <section class="card" id="ss-progress" aria-labelledby="ss-progress-t"></section>
        ${S.mine ? '<section class="card" id="ss-mywishes" aria-labelledby="ss-mywishes-t"></section>' : ''}
      </div>
      ${isReveal() ? '<section class="card card-ss ss-section" id="ss-reveal" aria-labelledby="ss-reveal-t"></section>' : ''}`;
  }
  app.innerHTML = headHtml() + body;
  app.dataset.status = st;

  if (!isDrawn()) { renderSignup(); renderPeople(); renderMyWishes(); return; }
  if (S.mine && S.target) { renderCard(); renderTargetWishes(); renderSend(); } else renderNoTarget();
  renderProgress();
  if (S.mine) renderMyWishes();
  if (isReveal()) renderReveal();
}

/* ---------- Inscriptions ---------- */
function renderSignup() {
  const el = $('#ss-signup'); if (!el) return;
  const open = S.ed.status === 'inscriptions';
  const n = S.participants.length;
  let txt, btn = '';
  if (open) {
    txt = S.mine
      ? `Tu es inscrit·e depuis le ${esc(fmtDate(S.mine.joined_at))}. Pense à remplir ta liste de souhaits : elle aide ton Santa.`
      : 'Les inscriptions sont ouvertes. Inscris-toi pour participer au tirage.';
    btn = S.mine
      ? '<button class="btn btn-ghost" type="button" id="ss-leave">Se désinscrire</button>'
      : '<button class="btn btn-primary" type="button" id="ss-join">S’inscrire</button>';
  } else {
    txt = S.mine
      ? 'Les inscriptions sont closes et tu fais partie du tirage. Ta cible apparaîtra ici dès qu’il sera fait.'
      : 'Les inscriptions sont closes : le tirage arrive. Tu ne participes pas à cette édition.';
  }
  el.innerHTML = `
    <h2 id="ss-signup-t">${open ? 'Inscription' : 'Tirage en préparation'}</h2>
    <p class="ss-big"><span class="display">${n}</span> ${n > 1 ? 'inscrits' : 'inscrit'}</p>
    <p class="muted">${txt}</p>
    ${btn ? `<div class="btn-row">${btn}</div>` : ''}`;
  $('#ss-join', el)?.addEventListener('click', (e) => join(e.currentTarget));
  $('#ss-leave', el)?.addEventListener('click', (e) => leave(e.currentTarget));
}

async function join(btn) {
  btn.disabled = true;
  try {
    const { error } = await sb.from('hg_ss_participants').insert({ edition_id: S.ed.id, user_id: me.id });
    if (error) throw error;
    await loadParticipants();
    toast('Inscription enregistrée. Bienvenue dans le tirage !', 'ok');
    renderSignup(); renderPeople(); renderMyWishes();
  } catch (e) { toast(`Inscription impossible : ${errMsg(e)}`, 'error'); btn.disabled = false; }
}
async function leave(btn) {
  if (!confirm('Te désinscrire de cette édition ? Ta liste de souhaits est conservée.')) return;
  btn.disabled = true;
  try {
    const { error } = await sb.from('hg_ss_participants').delete().eq('edition_id', S.ed.id).eq('user_id', me.id);
    if (error) throw error;
    await loadParticipants();
    if (S.mine) throw new Error('la désinscription a été refusée');
    toast('Tu es désinscrit·e.', 'ok');
    renderSignup(); renderPeople(); renderMyWishes();
  } catch (e) { toast(`Désinscription impossible : ${errMsg(e)}`, 'error'); btn.disabled = false; }
}

function renderPeople() {
  const el = $('#ss-people'); if (!el) return;
  const rows = S.participants.map((p) => {
    const m = memberOf(p.user_id);
    return `<li class="ss-person${p.user_id === me.id ? ' is-me' : ''}">${avatarHtml(m, 36)}<span>${esc(m.pseudo)}</span>${p.user_id === me.id ? '<span class="ss-tag">toi</span>' : ''}</li>`;
  }).join('');
  el.innerHTML = `
    <h2 id="ss-people-t">Les inscrits</h2>
    ${rows ? `<ul class="ss-people">${rows}</ul>` : '<div class="empty">Personne pour l’instant. Lance le mouvement !</div>'}`;
}

/* ---------- Ma liste de souhaits ---------- */
function wishItem(w, { removable }) {
  const url = safeUrl(w.url);
  const link = url ? `<a class="ss-wish-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${I.link}<span>${esc(hostOf(url))}</span><span class="visually-hidden"> (nouvel onglet)</span></a>` : '';
  const del = removable ? `<button class="btn btn-ghost ss-icon-btn" type="button" data-del="${esc(w.id)}" aria-label="Supprimer « ${esc(w.label)} »">${I.trash}</button>` : '';
  return `<li class="ss-wish"><div class="ss-wish-main"><span class="ss-wish-label">${esc(w.label)}</span>${link}</div>${del}</li>`;
}

function renderMyWishes() {
  const el = $('#ss-mywishes'); if (!el) return;
  if (!S.mine) {
    el.innerHTML = `<h2 id="ss-mywishes-t">Ma liste de souhaits</h2>
      <div class="empty">Inscris-toi pour préparer ta liste de souhaits.</div>`;
    return;
  }
  const items = S.myWishes.map((w) => wishItem(w, { removable: true })).join('');
  el.innerHTML = `
    <h2 id="ss-mywishes-t">Ma liste de souhaits</h2>
    <p class="muted small ss-privacy">Visible uniquement par ton Santa. Rien d’autre de ton profil n’est partagé.</p>
    ${items ? `<ul class="ss-wishes">${items}</ul>` : '<div class="empty">Ta liste est vide. Une idée, un lien, une couleur préférée : tout aide.</div>'}
    <form class="ss-wish-form" id="ss-wish-form" novalidate>
      <div class="field">
        <label for="ss-w-label">Souhait</label>
        <input id="ss-w-label" name="label" required maxlength="200" autocomplete="off" placeholder="Ex. un livre de cuisine coréenne">
      </div>
      <div class="field">
        <label for="ss-w-url">Lien (facultatif)</label>
        <input id="ss-w-url" name="url" type="url" inputmode="url" maxlength="2000" autocomplete="off" placeholder="https://…">
      </div>
      <button class="btn btn-primary" type="submit">Ajouter</button>
    </form>`;
  $('#ss-wish-form', el).addEventListener('submit', addWish);
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => delWish(b)));
}

async function addWish(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const label = f.label.value.trim();
  const rawUrl = f.url.value.trim();
  if (!label) { toast('Écris ton souhait avant de l’ajouter.', 'error'); f.label.focus(); return; }
  if (label.length > 200) { toast('200 caractères maximum.', 'error'); return; }
  const url = rawUrl ? safeUrl(rawUrl) : null;
  if (rawUrl && !url) { toast('Lien invalide : seules les adresses http ou https sont acceptées.', 'error'); f.url.focus(); return; }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { data, error } = await sb.from('hg_ss_wishes')
      .insert({ edition_id: S.ed.id, user_id: me.id, label, url }).select('id, label, url, created_at').single();
    if (error) throw error;
    S.myWishes.push(data);
    renderMyWishes();
    $('#ss-w-label')?.focus();
    toast('Souhait ajouté.', 'ok');
  } catch (err) { toast(`Ajout impossible : ${errMsg(err)}`, 'error'); btn.disabled = false; }
}

async function delWish(btn) {
  const id = btn.dataset.del;
  btn.disabled = true;
  try {
    const { error } = await sb.from('hg_ss_wishes').delete().eq('id', id).eq('user_id', me.id);
    if (error) throw error;
    S.myWishes = S.myWishes.filter((w) => w.id !== id);
    renderMyWishes();
    toast('Souhait supprimé.', 'ok');
  } catch (err) { toast(`Suppression impossible : ${errMsg(err)}`, 'error'); btn.disabled = false; }
}

/* ---------- La carte ---------- */
function renderCard() {
  const el = $('#ss-card'); if (!el) return;
  el.innerHTML = `
    <div class="ss-card-head">
      <div class="eyebrow">Ta cible</div>
      <h2 id="ss-card-t" class="ss-card-title">${S.revealed ? 'Ta carte' : 'Retourne la carte'}</h2>
    </div>
    <button class="ss-flip" type="button" id="ss-flip" aria-pressed="false" aria-label="Retourner la carte">
      <span class="ss-flip-inner">
        <span class="ss-face ss-face-back"><canvas id="ss-cv-back" width="1000" height="1400" aria-hidden="true"></canvas></span>
        <span class="ss-face ss-face-front"><canvas id="ss-cv-front" width="1000" height="1400" role="img" aria-label="Carte Secret Santa"></canvas></span>
        <span class="ss-card-loading" aria-hidden="true"><span class="ss-spinner"></span></span>
      </span>
    </button>
    <p class="visually-hidden" id="ss-flip-live" aria-live="polite"></p>
    <div class="btn-row ss-card-actions">
      <button class="btn btn-sand" type="button" id="ss-flip-btn">${I.flip}<span>Retourner la carte</span></button>
      <button class="btn btn-ghost" type="button" id="ss-dl" disabled>${I.download}<span>Télécharger la carte</span></button>
    </div>`;

  const flip = $('#ss-flip', el);
  const front = $('#ss-cv-front', el);
  const back = $('#ss-cv-back', el);
  const dl = $('#ss-dl', el);
  const toggle = () => {
    const on = !flip.classList.contains('is-flipped');
    flip.classList.toggle('is-flipped', on);
    flip.setAttribute('aria-pressed', String(on));
    $('#ss-flip-live').textContent = on ? `Tu offres à ${S.target.pseudo}.` : 'Carte face cachée.';
    if (on && !S.revealed) {
      S.revealed = true; writeSeen();
      $('#ss-card-t').textContent = 'Ta carte';
      renderTargetWishes();
    }
  };
  flip.addEventListener('click', toggle);
  $('#ss-flip-btn', el).addEventListener('click', toggle);
  dl.addEventListener('click', async () => {
    try { await downloadCanvas(front, `carte-secret-santa-${S.ed.year}.png`); }
    catch (e) { toast(`Téléchargement impossible : ${errMsg(e)}`, 'error'); }
  });

  const exchangeLabel = S.ed.exchange_date ? fmtDate(S.ed.exchange_date) : '';
  Promise.all([
    renderCardBack(back, { logoSrc: LOGO_SRC, year: S.ed.year }),
    renderCardFront(front, { pseudo: S.target.pseudo, year: S.ed.year, baseUrl: S.ed.card_base_url, logoSrc: LOGO_SRC, budget: S.ed.budget, exchangeLabel }),
  ]).then(([, res]) => {
    flip.classList.add('is-ready');
    dl.disabled = false;
    if (S.ed.card_base_url && !res.usedBase) toast('Image de la carte indisponible : carte par défaut utilisée.', 'error');
  }).catch((e) => toast(`Génération de la carte impossible : ${errMsg(e)}`, 'error'));
}

function renderTargetWishes() {
  const el = $('#ss-twishes'); if (!el) return;
  if (!S.revealed) {
    el.innerHTML = `<h2 id="ss-twishes-t">La liste de ta cible</h2>
      <div class="empty">Retourne la carte pour découvrir ta cible et sa liste de souhaits.</div>`;
    return;
  }
  const items = S.targetWishes.map((w) => wishItem(w, { removable: false })).join('');
  el.innerHTML = `
    <div class="ss-target-who">${avatarHtml({ ...memberOf(S.target.receiver_id), pseudo: S.target.pseudo, avatar_url: S.target.avatar_url || memberOf(S.target.receiver_id).avatar_url }, 44)}
      <div><div class="eyebrow">Tu offres à</div><h2 id="ss-twishes-t" class="ss-target-name">${esc(S.target.pseudo)}</h2></div>
    </div>
    ${items ? `<ul class="ss-wishes">${items}</ul>` : `<div class="empty">${esc(S.target.pseudo)} n’a pas encore rempli sa liste. Repasse plus tard, elle peut encore la compléter.</div>`}
    ${targetInfoHtml()}`;
}

/** Bloc « Ce qu'il faut savoir sur <pseudo> » : seulement les champs transmis par l'admin et remplis. */
function targetInfoHtml() {
  const info = S.targetInfo || {};
  const filled = (k) => typeof info[k] === 'string' ? info[k].trim() !== '' : info[k] != null && info[k] !== '';
  const known = new Set(INFO_GROUPS.flatMap((g) => g.fields.map((f) => f.id)));
  const groups = INFO_GROUPS.map((g) => ({ label: g.label, fields: g.fields.filter((f) => filled(f.id)) })).filter((g) => g.fields.length);
  const extra = Object.keys(info).filter((k) => !known.has(k) && filled(k));
  if (extra.length) groups.push({ label: 'Autres', fields: extra.map((k) => ({ id: k, label: INFO_LABEL[k] || k })) });
  if (!groups.length) return '';
  return `
    <section class="ss-info" aria-labelledby="ss-info-t">
      <h3 id="ss-info-t" class="ss-info-title">Ce qu’il faut savoir sur ${esc(S.target.pseudo)}</h3>
      ${groups.map((g) => `
        <div class="ss-info-group">
          <h4 class="ss-info-glabel">${esc(g.label)}</h4>
          <dl class="ss-info-list">${g.fields.map((f) => `
            <div class="ss-info-item"><dt>${esc(INFO_LABEL[f.id] || f.label)}</dt><dd>${esc(String(info[f.id]).trim())}</dd></div>`).join('')}
          </dl>
        </div>`).join('')}
    </section>`;
}

/* ---------- Mon envoi ---------- */
function renderSend() {
  const el = $('#ss-send'); if (!el) return;
  const sent = S.mine?.sent_at, rec = S.mine?.received_at;
  const closed = S.ed.status === 'termine';
  el.innerHTML = `
    <h2 id="ss-send-t">Mon envoi</h2>
    <ul class="ss-checks">
      <li class="ss-check${sent ? ' is-done' : ''}">
        <span class="ss-check-icon" aria-hidden="true">${sent ? I.check : I.gift}</span>
        <div class="ss-check-body">
          <strong>Cadeau envoyé</strong>
          <span class="muted small">${sent ? `Le ${esc(fmtDateTime(sent))}` : 'Pas encore'}</span>
        </div>
        <button class="btn ${sent ? 'btn-ghost' : 'btn-primary'}" type="button" id="ss-sent"${sent || closed ? ' disabled' : ''}>${sent ? 'Envoyé' : 'J’ai envoyé le cadeau'}</button>
      </li>
      <li class="ss-check${rec ? ' is-done' : ''}">
        <span class="ss-check-icon" aria-hidden="true">${rec ? I.check : I.box}</span>
        <div class="ss-check-body">
          <strong>Mon cadeau reçu</strong>
          <span class="muted small">${rec ? `Le ${esc(fmtDateTime(rec))}` : 'Pas encore'}</span>
        </div>
        <button class="btn ${rec ? 'btn-ghost' : 'btn-sand'}" type="button" id="ss-received"${rec || closed ? ' disabled' : ''}>${rec ? 'Reçu' : 'J’ai reçu le mien'}</button>
      </li>
    </ul>
    <p class="muted small">Le bot prévient le destinataire sur Discord, sans révéler qui tu es.</p>`;
  $('#ss-sent', el).addEventListener('click', (e) => mark(e.currentTarget, 'sent_at', 'ss_gift_sent', 'Envoi noté. Ton destinataire va être prévenu.'));
  $('#ss-received', el).addEventListener('click', (e) => mark(e.currentTarget, 'received_at', 'ss_gift_received', 'Réception notée. Ton Santa va être prévenu.'));
}

async function mark(btn, field, event, okMsg) {
  if (S.mine?.[field]) return;
  btn.disabled = true;
  try {
    const { data, error } = await sb.from('hg_ss_participants')
      .update({ [field]: new Date().toISOString() })
      .eq('edition_id', S.ed.id).eq('user_id', me.id)
      .select('user_id, sent_at, received_at, joined_at').single();
    if (error) throw error;
    S.mine = data;
    const i = S.participants.findIndex((p) => p.user_id === me.id);
    if (i >= 0) S.participants[i] = data;
    renderSend();
    toast(okMsg, 'ok');
    notify(event, { edition_id: S.ed.id });
    try { await loadProgress(); renderProgress(); } catch {}
  } catch (e) { toast(`Enregistrement impossible : ${errMsg(e)}`, 'error'); btn.disabled = false; }
}

/* ---------- Pas de cible / non participant ---------- */
function renderNoTarget() {
  const el = $('#ss-notarget'); if (!el) return;
  el.innerHTML = S.mine
    ? `<h2>Ta cible n’est pas encore disponible</h2>
       <p class="muted">Tu es inscrit·e mais aucune cible ne t’a été attribuée (inscription après le tirage ?). Contacte l’admin via l’<a href="assistance.html">assistance</a>.</p>`
    : `<h2>Tu ne participes pas à cette édition</h2>
       <p class="muted">Les inscriptions sont closes. Tu peux suivre l’avancement ci-dessous${isReveal() ? ' et découvrir la révélation' : ''}. Rendez-vous l’an prochain !</p>`;
}

/* ---------- Avancement ---------- */
function renderProgress() {
  const el = $('#ss-progress'); if (!el) return;
  const p = S.progress || { participants: 0, sent: 0, received: 0 };
  const pct = p.participants ? Math.round((p.sent / p.participants) * 100) : 0;
  const pctR = p.participants ? Math.round((p.received / p.participants) * 100) : 0;
  el.innerHTML = `
    <h2 id="ss-progress-t">Avancement</h2>
    <p class="ss-big"><span class="display">${pct}</span><span class="ss-pct">%</span></p>
    <div class="progress ss-progress" role="progressbar" aria-label="Cadeaux envoyés" aria-valuemin="0" aria-valuemax="${p.participants}" aria-valuenow="${p.sent}">
      <span style="width:${pct}%"></span>
    </div>
    <div class="progress ss-progress ss-progress-rec" role="progressbar" aria-label="Cadeaux reçus" aria-valuemin="0" aria-valuemax="${p.participants}" aria-valuenow="${p.received}">
      <span style="width:${pctR}%"></span>
    </div>
    <p class="muted">${p.sent} / ${p.participants} ${p.sent > 1 ? 'cadeaux envoyés' : 'cadeau envoyé'} · ${p.received} ${p.received > 1 ? 'reçus' : 'reçu'}</p>`;
}

/* ---------- Révélation ---------- */
function renderReveal() {
  const el = $('#ss-reveal'); if (!el) return;
  const byPseudo = new Map([...S.members.values()].map((m) => [m.pseudo, m]));
  const rows = S.reveal.map((r) => {
    const g = byPseudo.get(r.giver) || { pseudo: r.giver }, rc = byPseudo.get(r.receiver) || { pseudo: r.receiver };
    const mine = r.giver === me.pseudo || r.receiver === me.pseudo;
    return `<li class="ss-reveal-row${mine ? ' is-me' : ''}">
      <span class="ss-reveal-who">${avatarHtml(g, 36)}<span>${esc(r.giver)}</span></span>
      <span class="ss-reveal-arrow" aria-hidden="true">${I.arrow}</span><span class="visually-hidden"> offre à </span>
      <span class="ss-reveal-who">${avatarHtml(rc, 36)}<span>${esc(r.receiver)}</span></span>
    </li>`;
  }).join('');
  el.innerHTML = `
    <div class="eyebrow">Les masques tombent</div>
    <h2 id="ss-reveal-t" class="ss-reveal-title">Qui offrait à qui</h2>
    ${rows ? `<ul class="ss-reveal">${rows}</ul>` : '<div class="empty">Aucune attribution à afficher.</div>'}`;
}

/* ---------- Démarrage ---------- */
try {
  await load();
  renderAll();
} catch (e) {
  app.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Secret Santa</div><h1 class="page-title">Secret Santa</h1></div></div>
    <div class="card"><h2>Chargement impossible</h2><p class="muted">${esc(errMsg(e))}</p>
    <div class="btn-row"><button class="btn btn-primary" type="button" onclick="location.reload()">Réessayer</button></div></div>`;
  toast(`Secret Santa : ${errMsg(e)}`, 'error');
}
