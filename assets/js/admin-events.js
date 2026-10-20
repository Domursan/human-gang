// ===== Humane Gang — administration : événements dynamiques (image qui traverse le site) =====
// Table hg_dyn_events (écriture admin), captures hg_dyn_captures, classement rpc hg_dyn_leaderboard(p_event).
// Les dates sont saisies en heure suisse (Europe/Zurich), quel que soit le fuseau de l'appareil.
// Annonces Discord : hg-notify { event: 'dyn_announce', event_id, phase: 'start' | 'end' } ; automatiques via hg-cron.
import { sb, toast, errMsg, esc, $, callFn, avatarHtml, getProfile } from './core.js';
import { openBadgeEditor } from './admin-badges-edit.js';
import { flyDynImage } from './dyn-events.js';
import { hasLevels, sortedLevels, roman, METRIC_LABEL } from './badge-levels.js';

const TZ = 'Europe/Zurich';
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  play: svg('<path d="M7 5l12 7-12 7z"/>'),
  megaphone: svg('<path d="M3 11v3l12 5V6L3 11z"/><path d="M15 9a3 3 0 0 1 0 6M6 15l1 5h3l-1-4"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 21h8M9 17h6"/>'),
  badge: svg('<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>'),
};
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };
const LIMITS = { durMin: 1.5, durMax: 30, sizeMin: 24, sizeMax: 240, perPageMax: 10, nMax: 1000 };

/* ---------- Fuseau Europe/Zurich ---------- */
function zParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return p;
}
/** ISO (UTC) → valeur d'un <input type="datetime-local"> en heure suisse. */
export function toZurichInput(iso) {
  if (!iso) return '';
  const p = zParts(new Date(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** « 2026-10-31T18:00 » (heure suisse) → ISO UTC. Gère le passage heure d'été / d'hiver. */
export function fromZurichInput(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(v || ''));
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offsetAt = (t) => { const p = zParts(new Date(t)); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t; };
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t); // second passage : corrige autour des changements d'heure
  return new Date(t).toISOString();
}
const fmtZ = (iso, opts = {}) => (iso ? new Intl.DateTimeFormat('fr-CH', {
  timeZone: TZ, weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  ...(new Date(iso).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}), ...opts,
}).format(new Date(iso)) : '');

/* ---------- État ---------- */
const E = { root: null, opts: {}, events: [], counts: new Map(), badges: [], me: null };
const check = (res) => { if (res.error) throw res.error; return res.data; };
const phaseOf = (ev, now = Date.now()) => {
  const s = new Date(ev.starts_at).getTime(), e = new Date(ev.ends_at).getTime();
  return now < s ? 'future' : now >= e ? 'past' : 'live';
};
const oneIn = (p) => Math.max(1, Math.round(1 / (Number(p) || 1)));
const pct = (p) => { const v = (Number(p) || 0) * 100; return v >= 10 ? `${Math.round(v)} %` : `${v.toLocaleString('fr-CH', { maximumFractionDigits: 1 })} %`; };
/** uuid v4 (crypto.randomUUID n'existe qu'en contexte sécurisé). */
function uuid() {
  if (crypto.randomUUID) try { return crypto.randomUUID(); } catch {}
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const badgeOf = (code) => E.badges.find((b) => b.code === code) || null;

function confirmBox(title, body, { ok = 'Confirmer', danger = false } = {}) {
  const dlg = $('#confirm-dlg');
  $('#confirm-title').textContent = title;
  $('#confirm-body').textContent = body;
  const okBtn = $('#confirm-ok');
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return undefined; } finally { if (btn?.isConnected) btn.disabled = false; }
}

async function load() {
  const [ev, cap, bdg] = await Promise.all([
    sb.from('hg_dyn_events').select('*').order('starts_at', { ascending: false }),
    sb.from('hg_dyn_captures').select('event_id'),
    sb.from('hg_badges').select('code, name, description, image_url, sort, levels_enabled, levels, metric, event_id').order('sort'),
  ]);
  E.events = check(ev) ?? [];
  E.counts = new Map();
  for (const c of check(cap) ?? []) E.counts.set(c.event_id, (E.counts.get(c.event_id) || 0) + 1);
  E.badges = check(bdg) ?? [];
}

/* ---------- Liste ---------- */
function thumb(ev, size = 56) {
  return `<span class="ev-thumb" style="width:${size}px;height:${size}px">${ev.image_url
    ? `<img src="${esc(ev.image_url)}" alt="" loading="lazy">`
    : `<span class="ev-emoji" style="font-size:${Math.round(size * 0.62)}px">${esc(ev.emoji || '✨')}</span>`}</span>`;
}
function cardHtml(ev) {
  const ph = phaseOf(ev);
  const n = E.counts.get(ev.id) || 0;
  const b = badgeOf(ev.badge_code);
  const pills = [
    !ev.active ? '<span class="pill pill-todo">désactivé</span>'
      : ph === 'live' ? '<span class="pill pill-ok">en cours</span>' : ph === 'future' ? '<span class="pill pill-current">à venir</span>' : '<span class="pill pill-todo">terminé</span>',
    `<span class="pill">1 page sur ${oneIn(ev.probability)} · ${esc(pct(ev.probability))}</span>`,
    `<span class="pill">${ev.max_per_page} max / page</span>`,
    ev.max_per_user != null ? `<span class="pill">${ev.max_per_user} max / personne</span>` : '',
    ev.max_total != null ? `<span class="pill">${n} / ${ev.max_total} au total</span>` : '',
    b ? `<span class="pill pill-warn">${ICON.badge} ${esc(b.name)}${hasLevels(b) ? ` · ${sortedLevels(b).length} niveaux` : ''}</span>` : '',
  ].join('');
  const ann = ev.announce
    ? [`Lancement : ${ev.announced_start_at ? `annoncé ${esc(fmtZ(ev.announced_start_at))}` : 'annonce automatique au début'}`,
      `Fin : ${ev.announced_end_at ? `annoncée ${esc(fmtZ(ev.announced_end_at))}` : 'annonce automatique à la fin (top 3)'}`].join(' · ')
    : 'Annonces Discord automatiques désactivées';
  return `<article class="ev-card${ev.active ? '' : ' is-off'}" data-ev="${esc(ev.id)}">
    <div class="ev-top">
      ${thumb(ev)}
      <div class="ev-main">
        <h4 class="ev-name">${esc(ev.name)}</h4>
        <p class="small muted ev-dates">Du ${esc(fmtZ(ev.starts_at))} au ${esc(fmtZ(ev.ends_at))} <span class="ev-tz">(heure suisse)</span></p>
        ${ev.description ? `<p class="ev-desc">${esc(ev.description)}</p>` : ''}
      </div>
      <div class="ev-count"><strong>${n}</strong><span>capture${n > 1 ? 's' : ''}</span></div>
    </div>
    <div class="ev-pills">${pills}</div>
    <p class="small muted ev-ann">${ann}</p>
    <div class="btn-row ev-actions">
      <button class="btn btn-ghost btn-sm" type="button" data-ev-edit>${ICON.edit} Modifier</button>
      <button class="btn btn-ghost btn-sm" type="button" data-ev-test>${ICON.play} Tester l'apparition</button>
      <button class="btn btn-ghost btn-sm" type="button" data-ev-announce="start">${ICON.megaphone} Annoncer le lancement</button>
      ${ph === 'past' ? `<button class="btn btn-ghost btn-sm" type="button" data-ev-announce="end">${ICON.megaphone} Annoncer la fin</button>` : ''}
      <button class="btn btn-danger btn-sm btn-icon" type="button" data-ev-del aria-label="Supprimer l'événement ${esc(ev.name)}" title="Supprimer">${ICON.trash}</button>
    </div>
    <details class="ev-board">
      <summary>${ICON.trophy} Classement <span class="muted">(${n} capture${n > 1 ? 's' : ''})</span></summary>
      <div class="ev-board-body"><p class="small muted">Chargement…</p></div>
    </details>
  </article>`;
}
function render() {
  const now = Date.now();
  const groups = [
    ['live', 'En cours', E.events.filter((e) => phaseOf(e, now) === 'live').sort((a, b) => new Date(a.ends_at) - new Date(b.ends_at))],
    ['future', 'À venir', E.events.filter((e) => phaseOf(e, now) === 'future').sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))],
    ['past', 'Terminés', E.events.filter((e) => phaseOf(e, now) === 'past')],
  ];
  E.root.innerHTML = `
    <div class="badge-head ev-head">
      <p class="small muted">Pendant un événement, une image spéciale traverse parfois l'écran des membres. Ceux qui cliquent dessus l'attrapent et peuvent gagner un badge (simple ou à niveaux).</p>
      <button class="btn btn-primary" type="button" data-ev-new>${ICON.plus} Nouvel événement</button>
    </div>
    ${E.events.length ? groups.map(([k, label, list]) => `
      <section class="ev-group" aria-label="${label}">
        <h3 class="sub-title">${label} <span class="muted">(${list.length})</span></h3>
        ${list.length ? `<div class="ev-list">${list.map(cardHtml).join('')}</div>` : `<p class="small muted">${k === 'live' ? 'Aucun événement en cours.' : k === 'future' ? 'Rien de prévu.' : 'Aucun événement terminé.'}</p>`}
      </section>`).join('') : '<div class="empty">Aucun événement pour l\'instant. Crée le premier (Halloween, Noël, anniversaire du gang…).</div>'}`;
}
async function reload() {
  try { await load(); render(); } catch (e) { E.root.innerHTML = `<div class="empty">Impossible de charger les événements : ${esc(errMsg(e))}</div>`; }
}

async function loadBoard(details, ev) {
  const box = $('.ev-board-body', details);
  try {
    const rows = check(await sb.rpc('hg_dyn_leaderboard', { p_event: ev.id })) ?? [];
    box.innerHTML = rows.length ? `<ol class="ev-lb">${rows.map((r, i) => `
      <li><span class="ev-rank">${i + 1}</span>${avatarHtml(r, 28)}<span class="ev-lb-name">${esc(r.pseudo)}</span><strong>${esc(r.captures)}</strong></li>`).join('')}</ol>`
      : '<p class="small muted">Personne n\'a encore attrapé d\'image.</p>';
  } catch (e) { box.innerHTML = `<p class="small muted">Classement indisponible : ${esc(errMsg(e))}</p>`; }
}

/* ---------- Éditeur ---------- */
function badgeOptions(sel) {
  return '<option value="">Aucun badge</option>' + E.badges.map((b) =>
    `<option value="${esc(b.code)}"${b.code === sel ? ' selected' : ''}>${esc(b.name)}${hasLevels(b) ? ` (${sortedLevels(b).length} niveaux · ${esc(METRIC_LABEL[b.metric] || '')})` : ''}</option>`).join('');
}
function openEditor(ev = null) {
  const isNew = !ev;
  const id = ev?.id ?? uuid();
  let dlg = $('#ev-dlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'ev-dlg'; dlg.className = 'hg-dialog ev-dlg';
    dlg.setAttribute('aria-labelledby', 'ev-title');
    document.body.append(dlg);
  }
  const start = ev?.starts_at ?? new Date(Math.ceil(Date.now() / 3600000) * 3600000).toISOString();
  const end = ev?.ends_at ?? new Date(new Date(start).getTime() + 7 * 864e5).toISOString();
  const n = ev ? oneIn(ev.probability) : 5;
  dlg.innerHTML = `
    <form class="stack" id="ev-form" novalidate>
      <div class="ev-dlg-head">
        <h2 id="ev-title" class="dialog-title">${isNew ? 'Nouvel événement' : `Modifier « ${esc(ev.name)} »`}</h2>
        <button class="btn btn-ghost btn-sm" type="button" data-ev-cancel aria-label="Fermer">Fermer</button>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <div class="ev-form-grid">
        <div class="stack">
          <div class="field"><label for="evf-name">Nom</label><input id="evf-name" name="name" required maxlength="60" autocomplete="off" placeholder="ex. La citrouille d'Halloween" value="${esc(ev?.name ?? '')}"></div>
          <div class="field"><label for="evf-desc">Description <span class="muted small">(affichée aux membres et dans l'annonce)</span></label>
            <textarea id="evf-desc" name="description" rows="2" maxlength="300">${esc(ev?.description ?? '')}</textarea></div>
          <fieldset class="ev-fs">
            <legend>Image qui traverse l'écran</legend>
            <div class="ev-visual">
              <span class="ev-preview" id="evf-preview" aria-hidden="true"></span>
              <div class="stack ev-visual-fields">
                <div class="field"><label for="evf-file">Image <span class="muted small">(PNG transparent conseillé, carré)</span></label>
                  <input id="evf-file" name="file" type="file" accept="image/png,image/webp,image/gif,image/jpeg,image/svg+xml"></div>
                <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-evf-noimg${ev?.image_url ? '' : ' hidden'}>Retirer l'image</button></div>
                <div class="field ev-emoji-field"><label for="evf-emoji">Ou un emoji <span class="muted small">(utilisé si pas d'image)</span></label>
                  <input id="evf-emoji" name="emoji" maxlength="8" autocomplete="off" placeholder="🎃" value="${esc(ev?.emoji ?? '')}"></div>
              </div>
            </div>
          </fieldset>
          <fieldset class="ev-fs">
            <legend>Dates <span class="muted small">(heure suisse)</span></legend>
            <div class="grid-2">
              <div class="field"><label for="evf-start">Début</label><input id="evf-start" name="starts_at" type="datetime-local" required value="${esc(toZurichInput(start))}"></div>
              <div class="field"><label for="evf-end">Fin</label><input id="evf-end" name="ends_at" type="datetime-local" required value="${esc(toZurichInput(end))}"></div>
            </div>
          </fieldset>
        </div>
        <div class="stack">
          <fieldset class="ev-fs">
            <legend>Apparitions</legend>
            <div class="field">
              <label for="evf-n">Fréquence : 1 chance sur <output class="ev-n-out" for="evf-n evf-range">${n}</output> pages vues</label>
              <div class="ev-range-row">
                <input id="evf-range" type="range" min="1" max="100" step="1" value="${Math.min(100, n)}" aria-label="1 chance sur N pages (curseur)">
                <input id="evf-n" name="n" type="number" min="1" max="${LIMITS.nMax}" step="1" inputmode="numeric" value="${n}" aria-describedby="evf-pct">
              </div>
              <span class="small muted" id="evf-pct"></span>
            </div>
            <div class="grid-3">
              <div class="field"><label for="evf-ppage">Max par page</label><input id="evf-ppage" name="max_per_page" type="number" min="1" max="${LIMITS.perPageMax}" step="1" value="${esc(ev?.max_per_page ?? 1)}"></div>
              <div class="field"><label for="evf-puser">Max par personne</label><input id="evf-puser" name="max_per_user" type="number" min="1" step="1" placeholder="illimité" value="${esc(ev?.max_per_user ?? '')}"></div>
              <div class="field"><label for="evf-total">Max au total</label><input id="evf-total" name="max_total" type="number" min="1" step="1" placeholder="illimité" value="${esc(ev?.max_total ?? '')}"></div>
            </div>
            <div class="grid-2">
              <div class="field"><label for="evf-dur">Durée à l'écran (s)</label><input id="evf-dur" name="duration" type="number" min="${LIMITS.durMin}" max="${LIMITS.durMax}" step="0.5" value="${esc((ev?.duration_ms ?? 6000) / 1000)}"></div>
              <div class="field"><label for="evf-size">Taille : <output id="evf-size-out">${esc(ev?.size_px ?? 72)}</output> px</label>
                <input id="evf-size" name="size_px" type="range" min="${LIMITS.sizeMin}" max="${LIMITS.sizeMax}" step="4" value="${esc(ev?.size_px ?? 72)}"></div>
            </div>
            <p class="small muted">Chaque page vue fait un tirage. En cas de succès, 1 à « max par page » images passent entre 5 et 40 s après le chargement.</p>
          </fieldset>
          <fieldset class="ev-fs">
            <legend>Badge</legend>
            <div class="field"><label for="evf-badge">Badge associé</label><select id="evf-badge" name="badge_code">${badgeOptions(ev?.badge_code ?? '')}</select></div>
            <div class="btn-row"><button class="btn btn-sand btn-sm" type="button" data-evf-newbadge${isNew ? ' disabled aria-describedby="evf-nb-help"' : ''}>${ICON.badge} Créer un badge pour cet événement</button></div>
            <p class="small muted" id="evf-nb-help">${isNew ? 'Enregistre d\'abord l\'événement pour lui créer un badge.' : 'Badge simple (gagné à la première capture) ou à niveaux (compteur « Images attrapées » de cet événement).'}</p>
          </fieldset>
          <div class="ev-switches">
            <label class="switch"><input type="checkbox" name="announce"${ev?.announce ?? true ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Annoncer sur Discord (début et fin)</span></label>
            <label class="switch"><input type="checkbox" name="active"${ev?.active ?? true ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Actif</span></label>
          </div>
        </div>
      </div>
      <div class="btn-row dialog-actions ev-dlg-actions">
        <button class="btn btn-ghost" type="button" data-evf-test>${ICON.play} Tester l'apparition</button>
        <span class="ev-spacer"></span>
        <button class="btn btn-ghost" type="button" data-ev-cancel>Annuler</button>
        <button class="btn btn-primary" type="submit">${isNew ? 'Créer l\'événement' : 'Enregistrer'}</button>
      </div>
    </form>`;

  const form = $('#ev-form', dlg);
  const f = form.elements;
  const err = $('.form-error', form);
  const showErr = (m) => { err.textContent = m; err.hidden = !m; if (m) err.scrollIntoView({ block: 'nearest' }); };
  let imageUrl = ev?.image_url ?? null;
  let previewUrl = null;
  const paintPreview = () => {
    const src = previewUrl || imageUrl;
    $('#evf-preview', dlg).innerHTML = src ? `<img src="${esc(src)}" alt="">` : `<span class="ev-emoji">${esc(f.emoji.value.trim() || '✨')}</span>`;
    $('[data-evf-noimg]', dlg).hidden = !src;
  };
  const syncN = (from) => {
    let v = Math.round(Number(from.value) || 1);
    v = Math.max(1, Math.min(LIMITS.nMax, v));
    if (from !== f.n) f.n.value = v;
    if (from !== $('#evf-range', dlg)) $('#evf-range', dlg).value = Math.min(100, v);
    $('.ev-n-out', dlg).textContent = v;
    $('#evf-pct', dlg).textContent = `soit ${pct(1 / v)} des pages vues${v === 1 ? ' (à chaque page)' : ''}`;
  };
  $('#evf-range', dlg).addEventListener('input', (e) => syncN(e.target));
  f.n.addEventListener('input', () => syncN(f.n));
  f.size_px.addEventListener('input', () => { $('#evf-size-out', dlg).textContent = f.size_px.value; });
  f.emoji.addEventListener('input', paintPreview);
  f.file.addEventListener('change', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const file = f.file.files?.[0];
    previewUrl = file ? URL.createObjectURL(file) : null;
    paintPreview();
  });
  $('[data-evf-noimg]', dlg).addEventListener('click', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; imageUrl = null; f.file.value = '';
    paintPreview(); f.emoji.focus();
  });
  dlg.querySelectorAll('[data-ev-cancel]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('close', () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, { once: true });
  syncN(f.n); paintPreview();

  /** Valeurs du formulaire (sans l'image téléversée). */
  const read = () => {
    const nv = Math.max(1, Math.min(LIMITS.nMax, Math.round(Number(f.n.value) || 1)));
    const intOrNull = (v) => (String(v).trim() === '' ? null : Math.round(Number(v)));
    return {
      name: f.name.value.trim(),
      description: f.description.value.trim() || null,
      emoji: f.emoji.value.trim() || null,
      starts_at: fromZurichInput(f.starts_at.value),
      ends_at: fromZurichInput(f.ends_at.value),
      probability: Number((1 / nv).toFixed(6)),
      max_per_page: Math.round(Number(f.max_per_page.value) || 1),
      max_per_user: intOrNull(f.max_per_user.value),
      max_total: intOrNull(f.max_total.value),
      duration_ms: Math.round((Number(f.duration.value) || 6) * 1000),
      size_px: Math.round(Number(f.size_px.value) || 72),
      badge_code: f.badge_code.value || null,
      announce: f.announce.checked,
      active: f.active.checked,
    };
  };
  const validate = (v) => {
    if (v.name.length < 2) return 'Donne un nom à l\'événement (2 caractères minimum).';
    if (!v.starts_at || !v.ends_at) return 'Indique la date et l\'heure de début et de fin.';
    if (new Date(v.ends_at) <= new Date(v.starts_at)) return 'La fin doit être après le début.';
    if (!previewUrl && !imageUrl && !v.emoji) return 'Choisis une image ou un emoji.';
    if (!(v.max_per_page >= 1 && v.max_per_page <= LIMITS.perPageMax)) return `Max par page : entre 1 et ${LIMITS.perPageMax}.`;
    if (v.max_per_user != null && !(v.max_per_user >= 1)) return 'Max par personne : au moins 1 (ou vide pour illimité).';
    if (v.max_total != null && !(v.max_total >= 1)) return 'Max au total : au moins 1 (ou vide pour illimité).';
    if (!(v.duration_ms >= LIMITS.durMin * 1000 && v.duration_ms <= LIMITS.durMax * 1000)) return `Durée à l'écran : entre ${LIMITS.durMin} et ${LIMITS.durMax} secondes.`;
    if (!(v.size_px >= LIMITS.sizeMin && v.size_px <= LIMITS.sizeMax)) return `Taille : entre ${LIMITS.sizeMin} et ${LIMITS.sizeMax} px.`;
    return '';
  };

  $('[data-evf-test]', dlg).addEventListener('click', () => {
    const v = read();
    flyDynImage({ ...v, name: v.name || 'l\'image', image_url: previewUrl || imageUrl }, { preview: true, host: dlg });
  });
  $('[data-evf-newbadge]', dlg).addEventListener('click', () => {
    if (isNew) return;
    const v = read();
    openBadgeEditor({
      badges: E.badges,
      preset: {
        title: 'Badge pour cet événement',
        name: v.name || ev.name,
        description: `A attrapé ${v.name || ev.name} pendant l'événement.`,
        levels_enabled: false, metric: 'event_captures', event_id: ev.id, levels: [],
      },
      onSaved: async (row) => {
        if (!row?.code) return;
        try {
          check(await sb.from('hg_dyn_events').update({ badge_code: row.code }).eq('id', ev.id));
          ev.badge_code = row.code;
          await load();
          f.badge_code.innerHTML = badgeOptions(row.code);
          toast(`Badge « ${row.name} » lié à l'événement`, 'ok');
          await E.opts.onBadgesChange?.();
          render();
        } catch (e) { toast(errMsg(e), 'error'); }
      },
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr('');
    const v = read();
    const msg = validate(v);
    if (msg) return showErr(msg);
    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      const file = f.file.files?.[0] ?? null;
      let url = imageUrl;
      if (file) {
        if (!file.type.startsWith('image/')) throw new Error('Choisis une image (PNG, GIF, WebP, JPG ou SVG).');
        if (file.size > 5 * 1024 * 1024) throw new Error('Image trop lourde (5 Mo maximum).');
        const path = `events/${id}-${Date.now()}.${EXT[file.type] || 'png'}`;
        check(await sb.storage.from('hg-assets').upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' }));
        url = sb.storage.from('hg-assets').getPublicUrl(path).data.publicUrl;
      }
      const row = { ...v, image_url: url };
      if (isNew) {
        E.me ||= await getProfile();
        check(await sb.from('hg_dyn_events').insert({ id, ...row, created_by: E.me?.id ?? null }));
      } else {
        // Dates déplacées dans le futur : les annonces correspondantes repartent (hg-cron les refera)
        const now = Date.now();
        if (row.starts_at !== ev.starts_at && new Date(row.starts_at).getTime() > now) row.announced_start_at = null;
        if (row.ends_at !== ev.ends_at && new Date(row.ends_at).getTime() > now) row.announced_end_at = null;
        check(await sb.from('hg_dyn_events').update(row).eq('id', ev.id));
      }
      dlg.close();
      toast(isNew ? `Événement « ${v.name} » créé` : 'Événement enregistré', 'ok');
      await reload();
    } catch (err2) {
      showErr(errMsg(err2));
    } finally { if (btn?.isConnected) btn.disabled = false; }
  });

  dlg.showModal();
  f.name.focus();
}

/* ---------- Actions de la liste ---------- */
async function onClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.hasAttribute('data-ev-new')) return openEditor(null);
  const card = t.closest('[data-ev]');
  const ev = card && E.events.find((x) => x.id === card.dataset.ev);
  if (!ev) return;
  if (t.hasAttribute('data-ev-edit')) return openEditor(ev);
  if (t.hasAttribute('data-ev-test')) return flyDynImage(ev, { preview: true });
  if (t.dataset.evAnnounce) {
    const phase = t.dataset.evAnnounce;
    const ok = await confirmBox(phase === 'start' ? 'Annoncer le lancement ?' : 'Annoncer la fin ?',
      phase === 'start'
        ? `Le bot publie « ${ev.name} » dans le salon d'annonces Discord, avec son image.`
        : `Le bot publie la fin de « ${ev.name} » avec le top 3 dans le salon d'annonces Discord.`,
      { ok: 'Publier' });
    if (!ok) return;
    await busy(t, async () => {
      const res = await callFn('hg-notify', { event: 'dyn_announce', event_id: ev.id, phase });
      if (res?.sent) toast('Annonce publiée sur Discord', 'ok');
      else toast(res?.skipped ? `Pas d'annonce : ${res.skipped}` : (res?.error || 'Annonce non envoyée'), res?.skipped ? '' : 'error');
      await reload();
    });
    return;
  }
  if (t.hasAttribute('data-ev-del')) {
    const n = E.counts.get(ev.id) || 0;
    const ok = await confirmBox(`Supprimer « ${ev.name} » ?`,
      `${n ? `Ses ${n} capture${n > 1 ? 's seront supprimées' : ' sera supprimée'}. ` : ''}Les badges déjà gagnés sont conservés. Cette action est définitive.`,
      { ok: 'Supprimer', danger: true });
    if (!ok) return;
    await busy(t, async () => {
      check(await sb.from('hg_dyn_events').delete().eq('id', ev.id));
      const m = /\/hg-assets\/(events\/[^?]+)/.exec(ev.image_url || '');
      if (m) await sb.storage.from('hg-assets').remove([decodeURIComponent(m[1])]).catch(() => {});
      toast('Événement supprimé', 'ok');
      await reload();
    });
  }
}

/**
 * Monte la section « Événements » de l'admin dans container.
 * opts.onBadgesChange() : appelé après la création d'un badge depuis un événement (pour rafraîchir la section Badges).
 */
export async function mountEventsSection(container, opts = {}) {
  if (!container) return;
  E.root = container; E.opts = opts;
  container.addEventListener('click', onClick);
  container.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.open || !d.classList.contains('ev-board')) return;
    const ev = E.events.find((x) => x.id === d.closest('[data-ev]')?.dataset.ev);
    if (ev) loadBoard(d, ev);
  }, true);
  await reload();
}
/** Recharge la section (ex. après une modification des badges ailleurs). */
export const refreshEventsSection = () => (E.root ? reload() : Promise.resolve());
