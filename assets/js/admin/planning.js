// ===== Humane Gang — administration : Pilotage › Planning (idée A2) =====
// Rôle : calendrier (mois ou semaine) de tout ce qui est daté sur le site : questions du gang, drops, défis, événements,
// sorties IRL, Secret Santa (tirage, envoi, échange) et annonces du bot programmées. Chaque type a sa couleur ; un filtre
// garde certains types. Un clic sur un élément ouvre son résumé, avec « Ouvrir » vers l'écran d'édition habituel.
// « + Programmer » propose les types permis : une annonce du bot s'écrit ici (elle part toute seule, envoyée par hg-cron) ;
// les autres types ouvrent leur écran habituel. Le panneau « À surveiller » signale les semaines sans contenu et les
// chevauchements (deux drops dans la même heure, deux annonces du bot à moins de 10 min).
// Données : RPC hg_planning_items(p_from, p_to) (migration 092, chaque bloc filtré par permission, 92 jours au plus) ;
// annonces : hg_bot_schedule_save, hg_bot_schedule_cancel ; salons du bot : hg_settings.bot (lecture, permission bot).
// Toujours à l'heure suisse (admin-events.js). Sur mobile (≤ 760 px), la grille devient une liste des jours remplis.
// Dépendances : core.js, admin-events.js, admin/ui/drawer.js, ui-confirm.js, admin/shell.js (setActions, navigate).
// Exporte : planningSub ({ main, open }), branché par admin.js sur « pilotage/planning ».
import { sb, esc, toast, errMsg, hasPerm } from '../core.js';
import { toZurichInput, fromZurichInput } from '../admin-events.js';
import { openDrawer } from './ui/drawer.js';
import { confirmBox } from '../ui-confirm.js';
import { setActions, navigate } from './shell.js';

/* ---------- Types d'éléments ---------- */
// kind → libellé du filtre, préfixe court, couleur (jeton CSS), permission (pour « + Programmer »), route d'édition.
const KINDS = {
  quiz: { label: 'Questions', short: 'Q', perm: 'quiz', route: 'cartes/questions' },
  carte_drop: { label: 'Drops', short: 'Drop', perm: 'cartes', route: 'cartes/drops' },
  evenement: { label: 'Événements', short: 'Évén.', perm: 'themes', route: 'vie/evenements' },
  defi: { label: 'Défis', short: 'Défi', perm: 'cartes', route: 'cartes/defis' },
  sortie: { label: 'Sorties IRL', short: 'IRL', perm: 'evenements', route: 'vie/sorties' },
  ss: { label: 'Secret Santa', short: 'SS', perm: 'secret_santa', route: 'vie/secret-santa' },
  bot: { label: 'Annonces du bot', short: 'Bot', perm: 'bot', route: 'communication/bot' },
};
const STATUS = { programmee: 'Programmée', envoyee: 'Envoyée', annulee: 'Annulée', echec: 'Échec', active: 'Active', inactive: 'Inactive',
  secrete: 'Bonus secrète', brillante: 'Brillante', normale: 'Normale', prevue: 'Prévue', retro: 'Rétro', inscriptions: 'Inscriptions',
  tirage: 'Tirage', envoi: 'Envoi', revelation: 'Révélation', termine: 'Terminée' };
const TZ = 'Europe/Zurich';
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MAX_PER_CELL = 3;   // éléments visibles par case du mois (au-delà : « +N »)
const SPAN_MAX = 31;      // un élément sur plusieurs jours est répété au plus sur 31 jours

/* ---------- Dates (jours civils à l'heure suisse) ---------- */
const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
/** « AAAA-MM-JJ » (heure suisse) d'un instant. */
const dayKey = (d) => keyFmt.format(new Date(d));
/** Jour civil « AAAA-MM-JJ » → Date UTC à midi (arithmétique des jours sans fuseau). */
const keyToUtc = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const utcToKey = (u) => u.toISOString().slice(0, 10);
const addDays = (k, n) => { const u = keyToUtc(k); u.setUTCDate(u.getUTCDate() + n); return utcToKey(u); };
/** Lundi de la semaine du jour k. */
const mondayOf = (k) => addDays(k, -((keyToUtc(k).getUTCDay() + 6) % 7));
const monthTitle = new Intl.DateTimeFormat('fr-CH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLong = new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayShort = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const when = new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const hm = new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
/** Majuscule initiale. */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** « Part dans 12 min », « Part dans 3 h », « Part le … » pour une annonce à venir. */
function countdown(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Part au prochain passage du bot (5 min au plus)';
  const min = Math.round(ms / 60000);
  if (min < 60) return `Part dans ${min} min`;
  if (min < 48 * 60) return `Part dans ${Math.round(min / 60)} h`;
  return `Part dans ${Math.round(min / 1440)} jours`;
}

/* ---------- État ---------- */
// view : mois | semaine ; anchor : premier jour du mois, ou lundi de la semaine ; items : éléments chargés ;
// off : types masqués par le filtre ; sel : identifiant de l'élément ouvert ; salons : salons connus du bot.
const P = { root: null, view: 'mois', anchor: '', items: [], off: new Set(), sel: null, seq: 0, salons: null };

/** Première et dernière case affichées (clés de jour), selon la vue. */
function range() {
  if (P.view === 'semaine') return { first: P.anchor, last: addDays(P.anchor, 6) };
  const first = mondayOf(P.anchor);
  const [y, m] = P.anchor.split('-').map(Number);
  const lastOfMonth = utcToKey(new Date(Date.UTC(y, m, 0, 12)));
  return { first, last: addDays(mondayOf(lastOfMonth), 6) };
}

/* ---------- Montage ---------- */
/** Monte la section (une fois) : barre d'outils, légende-filtre, grille et panneau latéral. */
async function main() {
  P.root = document.getElementById('planning-root');
  if (!P.root) return;
  const today = dayKey(Date.now());
  P.anchor = today.slice(0, 8) + '01';
  const kinds = Object.entries(KINDS).filter(([, k]) => hasPerm(k.perm));
  P.root.innerHTML = `<div class="pl">
    <div class="pl-bar">
      <div class="pl-seg" role="group" aria-label="Vue">
        <button type="button" class="pl-segb" data-pl="view" data-view="mois" aria-pressed="true">Mois</button>
        <button type="button" class="pl-segb" data-pl="view" data-view="semaine" aria-pressed="false">Semaine</button>
      </div>
      <div class="pl-nav">
        <button type="button" class="pl-navb" data-pl="prev" aria-label="Période précédente"><span aria-hidden="true">‹</span></button>
        <h3 class="pl-title" id="pl-title" aria-live="polite"></h3>
        <button type="button" class="pl-navb" data-pl="next" aria-label="Période suivante"><span aria-hidden="true">›</span></button>
        <button type="button" class="btn btn-ghost btn-sm" data-pl="today">Aujourd’hui</button>
      </div>
    </div>
    <div class="pl-legend" role="group" aria-label="Types affichés">
      ${kinds.map(([id, k]) => `<button type="button" class="pl-chip" data-pl="kind" data-kind="${id}" aria-pressed="true"><i class="pl-dot pl-k-${id}" aria-hidden="true"></i>${esc(k.label)}</button>`).join('')}
    </div>
    <div class="pl-body">
      <div class="pl-cal" id="pl-cal" aria-live="polite"><div class="empty">Chargement du planning…</div></div>
      <aside class="pl-side">
        <section class="pl-card" id="pl-detail" aria-labelledby="pl-detail-h" hidden></section>
        <section class="pl-card" id="pl-watch" aria-labelledby="pl-watch-h"></section>
      </aside>
    </div>
  </div>`;
  P.root.addEventListener('click', onClick);
  await load();
}

/** À chaque visite : bouton « + Programmer » dans l'en-tête de zone. */
function open() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-primary';
  b.textContent = '+ Programmer';
  b.addEventListener('click', () => openProgram());
  setActions([b]);
}

/** Charge les éléments de la période affichée (la réponse d'une période abandonnée est ignorée). */
async function load() {
  const seq = ++P.seq;
  const { first, last } = range();
  paintTitle();
  try {
    const { data, error } = await sb.rpc('hg_planning_items', {
      p_from: fromZurichInput(`${first}T00:00`), p_to: fromZurichInput(`${addDays(last, 1)}T00:00`),
    });
    if (error) throw error;
    if (seq !== P.seq) return;
    P.items = Array.isArray(data) ? data.filter((x) => x && KINDS[x.kind] && x.start) : [];
    render();
  } catch (e) {
    if (seq !== P.seq) return;
    P.root.querySelector('#pl-cal').innerHTML = `<div class="empty">Impossible de charger le planning : ${esc(errMsg(e))}</div>`;
  }
}

/** Titre de la période (« Novembre 2026 », « Semaine du 2 au 8 nov. »). */
function paintTitle() {
  const t = P.root.querySelector('#pl-title');
  if (P.view === 'mois') t.textContent = cap(monthTitle.format(keyToUtc(P.anchor)));
  else t.textContent = `Semaine du ${dayShort.format(keyToUtc(P.anchor))} au ${dayShort.format(keyToUtc(addDays(P.anchor, 6)))}`;
}

/* ---------- Rendu ---------- */
/** Éléments visibles (filtre), répartis par jour ; un élément sur plusieurs jours apparaît sur chacun. */
function byDay() {
  const { first, last } = range();
  const map = new Map();
  for (const it of P.items) {
    if (P.off.has(it.kind)) continue;
    const s = dayKey(it.start);
    const multi = (it.kind === 'defi' || it.kind === 'evenement') && it.end;
    const e = multi ? dayKey(new Date(new Date(it.end).getTime() - 1)) : s;
    let k = s < first ? first : s, n = 0;
    while (k <= e && k <= last && n++ < SPAN_MAX) {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push({ it, cont: k !== s });
      k = addDays(k, 1);
    }
  }
  for (const list of map.values()) list.sort((a, b) => String(a.it.start).localeCompare(String(b.it.start)));
  return map;
}

/** Bouton d'un élément dans une case (préfixe du type + titre ; heure en vue semaine). */
function chip(it, cont, full) {
  const k = KINDS[it.kind];
  const time = full && !cont ? `<span class="pl-time">${esc(hm.format(new Date(it.start)))}</span> ` : '';
  const muted = it.status === 'annulee' || it.status === 'inactive' ? ' is-off' : '';
  return `<button type="button" class="pl-item pl-k-${it.kind}${muted}${P.sel === it.id ? ' is-sel' : ''}" data-pl="item" data-id="${esc(it.id)}"
    aria-pressed="${P.sel === it.id}">${time}<b>${esc(k.short)}</b> · ${esc(it.title || '')}${cont ? ' <span class="pl-cont">(suite)</span>' : ''}</button>`;
}

/** Grille (mois ou semaine), panneau « À surveiller » et détail. */
function render() {
  const { first, last } = range();
  const today = dayKey(Date.now());
  const month = P.anchor.slice(0, 7);
  const map = byDay();
  const cells = [];
  for (let k = first; k <= last; k = addDays(k, 1)) {
    const list = map.get(k) || [];
    const out = P.view === 'mois' && k.slice(0, 7) !== month;
    const shown = P.view === 'mois' ? list.slice(0, MAX_PER_CELL) : list;
    const more = list.length - shown.length;
    const u = keyToUtc(k);
    const num = u.getUTCDate() === 1 || k === first ? dayShort.format(u) : String(u.getUTCDate());
    cells.push(`<div class="pl-cell${out ? ' is-out' : ''}${k === today ? ' is-today' : ''}${list.length ? ' has-items' : ''}" role="listitem" aria-label="${esc(cap(dayLong.format(u)))}">
      <p class="pl-day"><span class="pl-num">${esc(num)}</span><span class="pl-long">${esc(cap(dayLong.format(u)))}</span></p>
      ${shown.map(({ it, cont }) => chip(it, cont, P.view === 'semaine')).join('')}
      ${more > 0 ? `<button type="button" class="pl-more" data-pl="more" data-day="${k}">+${more} autre${more > 1 ? 's' : ''}</button>` : ''}
    </div>`);
  }
  const total = [...map.values()].reduce((n, l) => n + l.filter((x) => !x.cont).length, 0);
  P.root.querySelector('#pl-cal').innerHTML = `
    <div class="pl-grid pl-${P.view}">
      <div class="pl-dow" aria-hidden="true">${DAYS.map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="pl-cells" role="list" aria-label="Jours">${cells.join('')}</div>
    </div>
    ${total ? '' : '<p class="pl-none small muted">Rien de programmé sur cette période pour les types affichés.</p>'}`;
  renderWatch(map);
  renderDetail();
}

/** Panneau « À surveiller » : semaines sans contenu (à venir) et chevauchements. */
function renderWatch(map) {
  const box = P.root.querySelector('#pl-watch');
  const { first, last } = range();
  const today = dayKey(Date.now());
  const notes = [];
  for (let w = first; w <= last; w = addDays(w, 7)) {
    const end = addDays(w, 6);
    if (end < today) continue;
    let n = 0;
    for (let k = w; k <= end; k = addDays(k, 1)) n += (map.get(k) || []).length;
    if (!n) notes.push(`Aucun contenu du ${dayShort.format(keyToUtc(w))} au ${dayShort.format(keyToUtc(end))}.`);
  }
  const vis = P.items.filter((x) => !P.off.has(x.kind) && x.status !== 'annulee');
  /** Paires d'un même type plus proches que ms. */
  const close = (kind, ms, label) => {
    const l = vis.filter((x) => x.kind === kind).sort((a, b) => String(a.start).localeCompare(String(b.start)));
    for (let i = 1; i < l.length; i++) {
      if (new Date(l[i].start) - new Date(l[i - 1].start) < ms) notes.push(`${label} le ${when.format(new Date(l[i].start))} : « ${l[i - 1].title} » et « ${l[i].title} ».`);
    }
  };
  close('carte_drop', 3600e3, 'Deux drops dans la même heure');
  close('bot', 600e3, 'Deux annonces du bot à moins de 10 min');
  box.innerHTML = `<h3 class="pl-card-h" id="pl-watch-h">À surveiller</h3>
    ${notes.length ? `<ul class="pl-watch">${notes.slice(0, 8).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="small muted">Rien à signaler sur cette période.</p>'}`;
}

/** Libellés des salons (noms connus du bot), chargés une fois si la permission le permet. */
async function salons() {
  if (P.salons) return P.salons;
  P.salons = [];
  if (!hasPerm('bot')) return P.salons;
  try {
    const { data } = await sb.from('hg_settings').select('value').eq('key', 'bot').maybeSingle();
    const v = data?.value || {};
    const list = Array.isArray(v.salons) ? v.salons.filter((s) => /^\d{17,20}$/.test(String(s?.id))).map((s) => ({ id: String(s.id), nom: String(s.nom || s.id) })) : [];
    if (/^\d{17,20}$/.test(String(v.announce_channel_id || '')) && !list.some((s) => s.id === v.announce_channel_id)) list.unshift({ id: v.announce_channel_id, nom: 'annonces' });
    P.salons = list;
  } catch { /* sans lecture : identifiants bruts */ }
  return P.salons;
}
const salonName = (id) => (P.salons || []).find((s) => s.id === id)?.nom || id;

/** Résumé de l'élément choisi (dates, statut, auteur) avec ses actions. */
function renderDetail() {
  const box = P.root.querySelector('#pl-detail');
  const it = P.items.find((x) => x.id === P.sel);
  if (!it) { box.hidden = true; box.innerHTML = ''; return; }
  const k = KINDS[it.kind];
  const rows = [
    [it.kind === 'bot' ? 'Envoi' : 'Début', when.format(new Date(it.start))],
    it.end ? ['Fin', when.format(new Date(it.end))] : null,
    it.channels ? ['Salons', it.channels.map((c) => `#${salonName(c)}`).join(', ')] : null,
    it.game ? ['Jeu', it.game] : null,
    it.by ? ['Créé par', it.by] : null,
    ['Statut', STATUS[it.status] || it.status || '—'],
  ].filter(Boolean);
  const pending = it.kind === 'bot' && it.status === 'programmee';
  box.hidden = false;
  box.innerHTML = `<p class="pl-kicker"><i class="pl-dot pl-k-${it.kind}" aria-hidden="true"></i>${esc(k.label)}</p>
    <h3 class="pl-card-h" id="pl-detail-h">${esc(it.title || '')}</h3>
    <dl class="pl-dl">${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>
    ${it.kind === 'bot' && it.detail ? `<p class="pl-body-text">${esc(it.detail)}</p>` : it.detail ? `<p class="small muted">${esc(it.detail)}</p>` : ''}
    ${pending ? `<p class="pl-count small">${esc(countdown(it.start))}</p>` : ''}
    <div class="btn-row">
      ${pending ? '<button type="button" class="btn btn-ghost btn-sm" data-pl="cancel">Annuler l’envoi</button>' : ''}
      ${pending && !it.game ? '<button type="button" class="btn btn-ghost btn-sm" data-pl="edit">Modifier</button>' : ''}
      ${it.kind !== 'bot' ? `<button type="button" class="btn btn-primary btn-sm" data-pl="open" data-route="${esc(k.route)}">Ouvrir</button>` : ''}
    </div>`;
  if (it.channels && !P.salons) salons().then(() => { if (P.sel === it.id) renderDetail(); });
}

/* ---------- Actions ---------- */
/** Clics de la section : vue, navigation, filtre, éléments et actions du résumé. */
async function onClick(e) {
  const b = e.target.closest('[data-pl]');
  if (!b) return;
  const act = b.dataset.pl;
  if (act === 'view' && b.dataset.view !== P.view) {
    P.view = b.dataset.view;
    P.root.querySelectorAll('[data-pl="view"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.view === P.view)));
    const ref = P.view === 'semaine' ? (dayKey(Date.now()).slice(0, 7) === P.anchor.slice(0, 7) ? dayKey(Date.now()) : P.anchor) : P.anchor;
    P.anchor = P.view === 'semaine' ? mondayOf(ref) : ref.slice(0, 8) + '01';
    return load();
  }
  if (act === 'prev' || act === 'next') {
    const dir = act === 'next' ? 1 : -1;
    if (P.view === 'semaine') P.anchor = addDays(P.anchor, 7 * dir);
    else { const u = keyToUtc(P.anchor); u.setUTCMonth(u.getUTCMonth() + dir); P.anchor = utcToKey(u).slice(0, 8) + '01'; }
    return load();
  }
  if (act === 'today') {
    const t = dayKey(Date.now());
    P.anchor = P.view === 'semaine' ? mondayOf(t) : t.slice(0, 8) + '01';
    return load();
  }
  if (act === 'kind') {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    if (on) P.off.delete(b.dataset.kind); else P.off.add(b.dataset.kind);
    return render();
  }
  if (act === 'item') { P.sel = P.sel === b.dataset.id ? null : b.dataset.id; render(); if (P.sel) P.root.querySelector('#pl-detail')?.scrollIntoView?.({ block: 'nearest' }); return; }
  if (act === 'more') { P.view = 'semaine'; P.anchor = mondayOf(b.dataset.day); P.root.querySelectorAll('[data-pl="view"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.view === 'semaine'))); return load(); }
  if (act === 'open') { navigate(b.dataset.route); return; }
  const it = P.items.find((x) => x.id === P.sel);
  if (act === 'edit' && it) return openBotForm(it);
  if (act === 'cancel' && it) {
    const ok = await confirmBox('Annuler cette annonce ?', 'Elle ne partira pas. Tu pourras en programmer une autre.', { ok: 'Annuler l’envoi', cancel: 'Garder', danger: true });
    if (!ok) return;
    b.disabled = true;
    try {
      const { error } = await sb.rpc('hg_bot_schedule_cancel', { p_id: it.id });
      if (error) throw error;
      toast('Annonce annulée.', 'ok');
      await load();
    } catch (ex) { toast(errMsg(ex), 'error'); b.disabled = false; }
  }
}

/** « + Programmer » : types permis ; l'annonce du bot s'écrit ici, les autres ouvrent leur écran. */
function openProgram(day = null) {
  const kinds = Object.entries(KINDS).filter(([, k]) => hasPerm(k.perm));
  const label = { quiz: 'Une question du gang', carte_drop: 'Un drop de carte', evenement: 'Un événement (images à attraper)', defi: 'Un défi du gang',
    sortie: 'Une sortie IRL', ss: 'Une étape du Secret Santa', bot: 'Une annonce du bot' };
  const d = openDrawer({
    title: 'Programmer',
    subtitle: 'Choisis ce que tu veux programmer. L’annonce du bot s’écrit ici ; le reste s’ouvre dans son écran habituel.',
    body: `<div class="pl-prog">${kinds.map(([id]) => `<button type="button" class="pl-prog-b" data-kind="${id}">
      <i class="pl-dot pl-k-${id}" aria-hidden="true"></i><span>${esc(label[id])}</span></button>`).join('')}</div>`,
  });
  d.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    d.close();
    if (b.dataset.kind === 'bot') openBotForm(null, day);
    else navigate(KINDS[b.dataset.kind].route);
  });
}

/**
 * Formulaire d'une annonce programmée (création ou modification).
 * @param {object|null} it Élément à modifier (kind bot), ou null.
 * @param {string|null} day Jour proposé (création depuis le calendrier).
 */
async function openBotForm(it = null, day = null) {
  const list = await salons();
  const chosen = new Set(it?.channels || (list[0] ? [list[0].id] : []));
  const at = it ? toZurichInput(it.start) : `${day || dayKey(Date.now() + 864e5)}T18:00`;
  const d = openDrawer({
    title: it ? 'Modifier l’annonce' : 'Programmer une annonce',
    subtitle: 'Le bot la publie tout seul à l’heure choisie (heure suisse, à 5 min près). Annulable jusqu’au départ.',
    submitLabel: it ? 'Enregistrer' : 'Programmer',
    body: `<div class="pl-form">
      <div class="field"><label for="pl-f-title">Titre (facultatif, pour le planning)</label><input id="pl-f-title" type="text" maxlength="120" value="${esc(it?.title && it.title !== it.detail?.slice(0, 80) ? it.title : '')}"></div>
      <div class="field"><label for="pl-f-body">Message</label><textarea id="pl-f-body" rows="5" maxlength="2000" required>${esc(it?.detail || '')}</textarea></div>
      <fieldset class="pl-salons"><legend>Salons (5 au plus)</legend>
        ${list.length ? list.map((s) => `<label class="pl-salon"><input type="checkbox" value="${esc(s.id)}"${chosen.has(s.id) ? ' checked' : ''}> #${esc(s.nom)}</label>`).join('')
          : '<p class="small muted">Aucun salon connu : ajoute-les dans Communication › Bot Discord › Salons.</p>'}
      </fieldset>
      <div class="field"><label for="pl-f-at">Envoi (heure suisse)</label><input id="pl-f-at" type="datetime-local" required value="${esc(at)}"></div>
      <p class="form-error" id="pl-f-err" role="alert" hidden></p>
    </div>`,
    onSubmit: async (f) => {
      const err = f.querySelector('#pl-f-err');
      const body = f.querySelector('#pl-f-body').value.trim();
      const ch = [...f.querySelectorAll('.pl-salon input:checked')].map((x) => x.value);
      const iso = fromZurichInput(f.querySelector('#pl-f-at').value);
      const fail = (m) => { err.textContent = m; err.hidden = false; return false; };
      if (!body) return fail('Écris le message.');
      if (!ch.length || ch.length > 5) return fail('Coche entre 1 et 5 salons.');
      if (!iso || new Date(iso) < Date.now() - 60e3) return fail('Choisis une heure à venir.');
      try {
        const { error } = await sb.rpc('hg_bot_schedule_save', { p_id: it?.id ?? null, p_title: f.querySelector('#pl-f-title').value.trim() || null,
          p_body: body, p_channels: ch, p_send_at: iso });
        if (error) throw error;
      } catch (ex) { return fail(errMsg(ex)); }
      toast(it ? 'Annonce modifiée.' : `Annonce programmée : ${countdown(iso).toLowerCase()}.`, 'ok');
      await load();
    },
  });
  return d;
}

/** Fournisseur de la sous-section Pilotage › Planning (admin/shell.js). */
export const planningSub = { main, open };
