// ===== Humane Gang — administration : événements dynamiques (image qui traverse le site) =====
// Colonne 2 : liste des événements (createList). Zone principale : l'événement choisi (#event/evenements/<id>) avec ses
// paramètres, son badge, ses annonces Discord et son classement. Création et modification dans le tiroir.
// Table hg_dyn_events (écriture admin), captures hg_dyn_captures, classement rpc hg_dyn_leaderboard(p_event).
// Les dates sont saisies en heure suisse (Europe/Zurich), quel que soit le fuseau de l'appareil.
// Annonces Discord : hg-notify { event: 'dyn_announce', event_id, phase: 'start' | 'end' } ; automatiques via hg-cron.
// Dépendances : core.js (Supabase, toast, profil), admin-badges-edit.js (éditeur de badge), dyn-events.js (aperçu de l'image),
// badge-levels.js, image-compress.js, ui-confirm.js, icons.js, admin/ui/* (liste, détail, drawer, pastille), admin/shell.js (navigation).
// Exporte : toZurichInput et fromZurichInput (conversion heure suisse, réutilisées ailleurs), eventsSub (section Événements),
// refreshEventsSection (rechargement après une modification des badges).
import { sb, toast, errMsg, esc, $, callFn, avatarHtml, getProfile } from './core.js';
import { openBadgeEditor } from './admin-badges-edit.js';
import { flyDynImage } from './dyn-events.js';
import { hasLevels, sortedLevels, METRIC_LABEL } from './badge-levels.js';
import { prepareImage } from './image-compress.js';
import { confirmBox } from './ui-confirm.js';
import { svg } from './icons.js';
import { openDrawer } from './admin/ui/drawer.js';
import { createList } from './admin/ui/list.js';
import { renderDetailHeader } from './admin/ui/detail-header.js';
import { pill } from './admin/ui/common.js';
import { navigate } from './admin/shell.js';

// Fuseau de toutes les dates affichées et saisies dans cette section.
const TZ = 'Europe/Zurich';
// Icônes SVG des boutons (ajouter, modifier, tester, annoncer, supprimer, badge).
const ICON = {
  plus: svg('plus', { stroke: 2 }),
  edit: svg('edit', { stroke: 2 }),
  play: svg('play', { stroke: 2 }),
  megaphone: svg('megaphone', { stroke: 2 }),
  trash: svg('trash', { stroke: 2 }),
  badge: svg('badge', { stroke: 2 }),
};
// Bornes des champs : durée à l'écran (secondes), taille (px), max par page, et « 1 chance sur N » (nMax).
const LIMITS = { durMin: 1.5, durMax: 30, sizeMin: 24, sizeMax: 240, perPageMax: 10, nMax: 1000 };
// Route de la section ; sert à revenir à la liste ou à ouvrir un événement.
const EV_ROUTE = 'event/evenements';

/* ---------- Fuseau Europe/Zurich ---------- */
/**
 * Découpe une date en ses parties (année, mois, jour, heure, minute, seconde) lues à l'heure suisse.
 * @param {Date} date Date à découper.
 * @returns {Object<string, string>} Parties sous forme de texte.
 */
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
  /** Décalage en millisecondes entre l'heure suisse et UTC à l'instant t (change avec l'heure d'été). */
  const offsetAt = (t) => { const p = zParts(new Date(t)); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t; };
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t); // second passage : corrige autour des changements d'heure
  return new Date(t).toISOString();
}
// Date lisible en heure suisse ; l'année n'apparaît que si elle n'est pas l'année en cours.
const fmtZ = (iso, opts = {}) => (iso ? new Intl.DateTimeFormat('fr-CH', {
  timeZone: TZ, weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  ...(new Date(iso).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}), ...opts,
}).format(new Date(iso)) : '');

/* ---------- État ---------- */
// État de la section : racine, colonne 2, en-tête du détail, événements, captures par événement, badges, profil,
// callback après changement de badge, numéro de requête (ignore les réponses périmées) et écouteur global posé une fois.
const E = { root: null, list: null, head: null, sel: null, events: [], counts: new Map(), badges: [], me: null, onBadgesChange: null, tok: 0, bound: false };
/** Renvoie les données d'une réponse Supabase, ou lève l'erreur si la requête a échoué. */
const check = (res) => { if (res.error) throw res.error; return res.data; };
/**
 * Phase d'un événement à l'instant donné : future (pas commencé), live (en cours) ou past (terminé).
 * @param {object} ev Ligne hg_dyn_events (starts_at, ends_at).
 * @param {number} [now] Instant de référence en millisecondes.
 * @returns {'future'|'live'|'past'}
 */
const phaseOf = (ev, now = Date.now()) => {
  const s = new Date(ev.starts_at).getTime(), e = new Date(ev.ends_at).getTime();
  return now < s ? 'future' : now >= e ? 'past' : 'live';
};
/** Nombre de pages vues pour une chance : « 1 chance sur N ». Toujours au moins 1. */
const oneIn = (p) => Math.max(1, Math.round(1 / (Number(p) || 1)));
/** Probabilité en pourcentage lisible : entier à partir de 10 %, une décimale en dessous. */
const pct = (p) => { const v = (Number(p) || 0) * 100; return v >= 10 ? `${Math.round(v)} %` : `${v.toLocaleString('fr-CH', { maximumFractionDigits: 1 })} %`; };
/** uuid v4 (crypto.randomUUID n'existe qu'en contexte sécurisé). */
function uuid() {
  if (crypto.randomUUID) try { return crypto.randomUUID(); } catch {}
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** Badge correspondant à un code, ou null s'il n'existe pas. */
const badgeOf = (code) => E.badges.find((b) => b.code === code) || null;
/** Événement actuellement sélectionné, ou null. */
const current = () => E.events.find((x) => x.id === E.sel) ?? null;

/**
 * Désactive le bouton pendant l'exécution de fn, puis le réactive. Une erreur est affichée en toast.
 * @param {HTMLButtonElement|null} btn Bouton à désactiver.
 * @param {Function} fn Action asynchrone.
 * @returns {Promise<*>} Résultat de fn, ou undefined en cas d'erreur.
 */
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return undefined; } finally { if (btn?.isConnected) btn.disabled = false; }
}

/**
 * Charge les événements, le nombre de captures par événement et les badges, en une seule fois.
 * Une erreur remonte à l'appelant, qui affiche le message.
 */
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

/* ---------- Présentation ---------- */
/**
 * Vignette d'un événement : son image, ou son emoji (✨ par défaut) si l'image manque.
 * @param {object} ev Ligne hg_dyn_events.
 * @param {number} [size=56] Taille en pixels.
 * @returns {string} HTML.
 */
function thumb(ev, size = 56) {
  return `<span class="ev-thumb" style="width:${size}px;height:${size}px">${ev.image_url
    ? `<img src="${esc(ev.image_url)}" alt="" loading="lazy">`
    : `<span class="ev-emoji" style="font-size:${Math.round(size * 0.62)}px">${esc(ev.emoji || '✨')}</span>`}</span>`;
}
/** Pastille d'état : désactivé, en cours, à venir ou terminé. */
function statePill(ev, now = Date.now()) {
  if (!ev.active) return pill({ id: 'off', label: 'Désactivé', tone: 'muted' });
  const ph = phaseOf(ev, now);
  return ph === 'live' ? pill({ id: 'live', label: 'En cours', tone: 'open' })
    : ph === 'future' ? pill({ id: 'future', label: 'À venir', tone: 'prog' })
      : pill({ id: 'past', label: 'Terminé', tone: 'done' });
}
/**
 * Lignes de la liste : en cours d'abord, puis à venir (le plus proche en premier), terminés, désactivés.
 * @param {number} [now] Instant de référence en millisecondes.
 * @returns {object[]}
 */
function listItems(now = Date.now()) {
  const rank = { live: 0, future: 1, past: 2, off: 3 };
  return E.events.map((ev) => {
    const phase = ev.active ? phaseOf(ev, now) : 'off';
    return { id: ev.id, name: ev.name, phase, ev, rank: rank[phase] };
  }).sort((a, b) => a.rank - b.rank || (a.phase === 'past' ? 0 : new Date(a.ev.starts_at) - new Date(b.ev.starts_at)));
}
/**
 * HTML d'une ligne de la liste : nom, dates et pastille d'état.
 * @param {object} it Élément de listItems().
 * @returns {string}
 */
function rowHtml(it) {
  return `<div class="ui-row-body">
    <div class="ui-row-top"><span class="ui-row-name">${esc(it.ev.name)}</span></div>
    <div class="ui-row-title">${esc(fmtZ(it.ev.starts_at))} → ${esc(fmtZ(it.ev.ends_at))}</div>
    <div class="ui-row-foot">${statePill(it.ev)}</div>
  </div>`;
}
/** Affiche le bouton « Nouvel événement » dans la barre d'actions de la zone. */
function paintActions() {
  const z = document.getElementById('zone-actions');
  if (!z) return;
  z.innerHTML = `<button class="btn btn-primary" type="button" data-ev-act="new">${ICON.plus} Nouvel événement</button>`;
}

/* ---------- Zone principale ---------- */
/**
 * HTML de la zone principale d'un événement : apparition, badge, annonces, classement (rempli plus tard) et suppression.
 * @param {object} ev Ligne hg_dyn_events.
 * @returns {string}
 */
function detailHtml(ev) {
  const n = E.counts.get(ev.id) || 0;
  const b = badgeOf(ev.badge_code);
  const ann = ev.announce
    ? [`Lancement : ${ev.announced_start_at ? `annoncé ${esc(fmtZ(ev.announced_start_at))}` : 'annonce automatique au début'}`,
      `Fin : ${ev.announced_end_at ? `annoncée ${esc(fmtZ(ev.announced_end_at))}` : 'annonce automatique à la fin (top 3)'}`].join(' · ')
    : 'Annonces Discord automatiques désactivées';
  const ph = ev.active ? phaseOf(ev) : 'off';
  const facts = [
    [`1 / ${oneIn(ev.probability)}`, `chance par page vue (${pct(ev.probability)})`],
    [String(ev.max_per_page), 'max par page'],
    [ev.max_per_user != null ? String(ev.max_per_user) : '∞', 'max par personne'],
    [ev.max_total != null ? `${n} / ${ev.max_total}` : String(n), ev.max_total != null ? 'captures au total' : 'captures à ce jour'],
    [`${(ev.duration_ms ?? 6000) / 1000} s`, 'durée à l\'écran'],
    [`${ev.size_px ?? 72} px`, 'taille'],
  ];
  return `
    <div class="vie-grid">
      <section class="card stack" aria-labelledby="ev-h-state">
        <div class="ev-state-row">${thumb(ev, 72)}
          <div class="stack" style="gap:6px;min-width:0">
            <h3 class="card-title" id="ev-h-state">Apparition</h3>
            <div>${statePill(ev)}</div>
            <p class="small muted" style="margin:0">${ph === 'off' ? 'Événement désactivé : il n\'apparaît plus.' : ph === 'live' ? 'Les images peuvent apparaître maintenant.' : ph === 'future' ? 'Pas encore lancé.' : 'Terminé.'}</p>
          </div>
        </div>
        <div class="ui-facts">${facts.map(([v, l]) => `<div class="ui-fact"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>
      </section>

      <section class="card stack" aria-labelledby="ev-h-badge">
        <h3 class="card-title" id="ev-h-badge">Badge</h3>
        ${b ? `<div class="ev-badge-line">${ICON.badge} <strong>${esc(b.name)}</strong></div>
          <p class="small muted" style="margin:0">${hasLevels(b) ? `Badge à niveaux : ${sortedLevels(b).length} niveaux (${esc(METRIC_LABEL[b.metric] || b.metric || '')}).` : 'Badge simple : gagné à la première image attrapée.'}</p>`
          : '<p class="small muted" style="margin:0">Aucun badge lié à cet événement. Modifie l\'événement pour en créer un.</p>'}
      </section>

      <section class="card stack" aria-labelledby="ev-h-ann">
        <h3 class="card-title" id="ev-h-ann">Annonces Discord</h3>
        <p class="small muted" style="margin:0">${ann}</p>
        <div class="btn-row">
          <button class="btn btn-ghost btn-sm" type="button" data-ev-announce="start">${ICON.megaphone} Annoncer le lancement</button>
          ${ph === 'past' ? `<button class="btn btn-ghost btn-sm" type="button" data-ev-announce="end">${ICON.megaphone} Annoncer la fin</button>` : ''}
        </div>
      </section>

      <section class="card stack" aria-labelledby="ev-h-board">
        <h3 class="card-title" id="ev-h-board">Classement <span class="muted">(${n} capture${n > 1 ? 's' : ''})</span></h3>
        <div id="ev-board"><p class="small muted">Chargement…</p></div>
      </section>

      <section class="card stack ss-danger vie-wide" aria-labelledby="ev-h-del">
        <h3 class="card-title" id="ev-h-del">Supprimer l'événement</h3>
        <p class="small muted">${n ? `Ses ${n} capture${n > 1 ? 's seront supprimées' : ' sera supprimée'}. ` : ''}Les badges déjà gagnés sont conservés. Cette action est définitive.</p>
        <div class="btn-row"><button class="btn btn-danger btn-sm" type="button" data-ev-act="delete" aria-label="Supprimer l'événement ${esc(ev.name)}">${ICON.trash} Supprimer</button></div>
      </section>
    </div>`;
}

/**
 * Affiche le détail de l'événement sélectionné, ou un message s'il n'y en a pas ou s'il n'existe plus.
 * Recharge le classement une fois le détail posé.
 */
function paintDetail() {
  const root = E.root;
  if (!root) return;
  E.head?.destroy();
  E.head = null;
  const ev = current();
  if (!E.sel) {
    root.innerHTML = '<div class="detail-empty">Choisis un événement dans la liste, ou crées-en un avec « Nouvel événement ».</div>';
    return;
  }
  if (!ev) {
    root.innerHTML = '<div class="detail-empty">Cet événement n\'existe plus. Choisis-en un autre dans la liste.</div>';
    return;
  }
  root.innerHTML = `<div class="vie-detail"><div id="ev-dhead"></div>${detailHtml(ev)}</div>`;
  E.head = renderDetailHeader(root.querySelector('#ev-dhead'), {
    title: ev.name,
    subtitle: `Du ${fmtZ(ev.starts_at)} au ${fmtZ(ev.ends_at)} (heure suisse)`,
    actions: [
      { label: 'Modifier', onClick: () => openEditor(current()) },
      { label: 'Tester l\'apparition', onClick: () => { const c = current(); if (c) flyDynImage(c, { preview: true }); } },
    ],
  });
  loadBoard(ev);
}

/**
 * Charge le classement (top des captures) de l'événement et l'affiche dans la section prévue.
 * Ignore la réponse si l'admin a changé d'événement entre-temps.
 * @param {object} ev Événement concerné.
 */
async function loadBoard(ev) {
  const box = document.getElementById('ev-board');
  if (!box) return;
  try {
    const rows = check(await sb.rpc('hg_dyn_leaderboard', { p_event: ev.id })) ?? [];
    if (E.sel !== ev.id || !box.isConnected) return;
    box.innerHTML = rows.length ? `<ol class="ev-lb">${rows.map((r, i) => `
      <li><span class="ev-rank">${i + 1}</span>${avatarHtml(r, 28)}<span class="ev-lb-name">${esc(r.pseudo)}</span><strong>${esc(r.captures)}</strong></li>`).join('')}</ol>`
      : '<p class="small muted">Personne n\'a encore attrapé d\'image.</p>';
  } catch (e) { if (E.sel === ev.id && box.isConnected) box.innerHTML = `<p class="small muted">Classement indisponible : ${esc(errMsg(e))}</p>`; }
}

/* ---------- Éditeur (tiroir) ---------- */
/**
 * Options du menu « Badge associé » : « Aucun badge » puis tous les badges (avec le nombre de niveaux).
 * @param {string} sel Code du badge à présélectionner.
 * @returns {string} HTML des options.
 */
function badgeOptions(sel) {
  return '<option value="">Aucun badge</option>' + E.badges.map((b) =>
    `<option value="${esc(b.code)}"${b.code === sel ? ' selected' : ''}>${esc(b.name)}${hasLevels(b) ? ` (${sortedLevels(b).length} niveaux · ${esc(METRIC_LABEL[b.metric] || '')})` : ''}</option>`).join('');
}

/**
 * HTML du formulaire de l'événement (tiroir). Les valeurs viennent de l'événement, ou des valeurs par défaut pour une création.
 * @param {object|null} ev Événement modifié, ou null pour une création.
 * @param {{isNew: boolean, start: string, end: string, n: number}} opts Dates de départ (ISO) et fréquence « 1 sur n ».
 * @returns {string}
 */
function editorBody(ev, { isNew, start, end, n }) {
  return `
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
          <label class="switch"><input type="checkbox" name="announce"${(ev?.announce ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Annoncer sur Discord (début et fin)</span></label>
          <label class="switch"><input type="checkbox" name="active"${(ev?.active ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Actif</span></label>
        </div>
      </div>
    </div>
    <div class="btn-row ev-dlg-actions">
      <button class="btn btn-ghost" type="button" data-evf-test>${ICON.play} Tester l'apparition</button>
    </div>`;
}

/**
 * Ouvre le tiroir de création (ev = null) ou de modification d'un événement, et branche ses contrôles.
 * Pour une création, l'id est généré côté navigateur pour pouvoir nommer l'image avant l'envoi.
 * @param {object|null} [ev=null] Événement à modifier.
 */
function openEditor(ev = null) {
  const isNew = !ev;
  const id = ev?.id ?? uuid();
  // Par défaut : début à la prochaine heure pleine, fin 7 jours plus tard.
  const start = ev?.starts_at ?? new Date(Math.ceil(Date.now() / 3600000) * 3600000).toISOString();
  const end = ev?.ends_at ?? new Date(new Date(start).getTime() + 7 * 864e5).toISOString();
  // Fréquence par défaut d'une création : 1 chance sur 5 pages vues.
  const n = ev ? oneIn(ev.probability) : 5;
  // Image actuelle de l'événement. Remise à null si l'admin retire l'image.
  let imageUrl = ev?.image_url ?? null;
  // Aperçu local de l'image choisie (URL blob) ; libéré à la fermeture du tiroir.
  let previewUrl = null;
  const d = openDrawer({
    title: isNew ? 'Nouvel événement' : `Modifier « ${ev.name} »`,
    subtitle: 'Dates en heure suisse. Une image ou un emoji est nécessaire.',
    body: editorBody(ev, { isNew, start, end, n }),
    submitLabel: isNew ? 'Créer l\'événement' : 'Enregistrer',
    onSubmit: (form) => submitEditor(form),
    onClose: () => { if (previewUrl) URL.revokeObjectURL(previewUrl); },
    wide: true,
  });
  const { form, body } = d;
  const f = form.elements;
  const err = body.querySelector('.form-error');
  /** Affiche ou efface le message d'erreur du formulaire, et le fait voir. */
  const showErr = (m) => { err.textContent = m; err.hidden = !m; if (m) err.scrollIntoView({ block: 'nearest' }); };
  /** Affiche l'aperçu : image choisie, image actuelle, ou emoji. Le bouton « Retirer l'image » suit l'état. */
  const paintPreview = () => {
    const src = previewUrl || imageUrl;
    $('#evf-preview', body).innerHTML = src ? `<img src="${esc(src)}" alt="">` : `<span class="ev-emoji">${esc(f.emoji.value.trim() || '✨')}</span>`;
    $('[data-evf-noimg]', body).hidden = !src;
  };
  /**
   * Garde synchronisés le champ « 1 chance sur N », le curseur et le texte en pourcentage.
   * @param {HTMLInputElement} from Champ qui vient d'être modifié (il n'est pas réécrit).
   */
  const syncN = (from) => {
    let v = Math.round(Number(from.value) || 1);
    v = Math.max(1, Math.min(LIMITS.nMax, v));
    if (from !== f.n) f.n.value = v;
    if (from !== $('#evf-range', body)) $('#evf-range', body).value = Math.min(100, v);
    $('.ev-n-out', body).textContent = v;
    $('#evf-pct', body).textContent = `soit ${pct(1 / v)} des pages vues${v === 1 ? ' (à chaque page)' : ''}`;
  };
  $('#evf-range', body).addEventListener('input', (e) => syncN(e.target));
  f.n.addEventListener('input', () => syncN(f.n));
  f.size_px.addEventListener('input', () => { $('#evf-size-out', body).textContent = f.size_px.value; });
  f.emoji.addEventListener('input', paintPreview);
  f.file.addEventListener('change', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const file = f.file.files?.[0];
    previewUrl = file ? URL.createObjectURL(file) : null;
    paintPreview();
  });
  $('[data-evf-noimg]', body).addEventListener('click', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; imageUrl = null; f.file.value = '';
    paintPreview(); f.emoji.focus();
  });
  syncN(f.n); paintPreview();

  /** Valeurs du formulaire (sans l'image téléversée). */
  const read = () => {
    const nv = Math.max(1, Math.min(LIMITS.nMax, Math.round(Number(f.n.value) || 1)));
    /** Entier d'un champ, ou null si le champ est vide. */
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
  /**
   * Contrôle les valeurs saisies avant enregistrement.
   * @param {object} v Valeurs lues par read().
   * @returns {string} Message d'erreur à afficher, ou '' si tout est correct.
   */
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

  $('[data-evf-test]', body).addEventListener('click', () => {
    const v = read();
    flyDynImage({ ...v, name: v.name || 'l\'image', image_url: previewUrl || imageUrl }, { preview: true, host: d.el });
  });
  $('[data-evf-newbadge]', body)?.addEventListener('click', () => {
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
          await E.onBadgesChange?.();
          await reload();
        } catch (e) { toast(errMsg(e), 'error'); }
      },
    });
  });

  /** Enregistrement : renvoie true (le tiroir se ferme) ou false (erreur affichée, le tiroir reste ouvert). */
  async function submitEditor(formEl) {
    showErr('');
    const v = read();
    const msg = validate(v);
    if (msg) { showErr(msg); return false; }
    try {
      const file = formEl.elements.file.files?.[0] ?? null;
      let url = imageUrl;
      if (file) {
        if (!file.type.startsWith('image/')) throw new Error('Choisis une image (PNG, GIF, WebP, JPG ou SVG).');
        if (file.size > 5 * 1024 * 1024) throw new Error('Image trop lourde (5 Mo maximum).');
        const img = await prepareImage(file);
        const path = `events/${id}-${Date.now()}.${img.ext}`;
        check(await sb.storage.from('hg-assets').upload(path, img.blob, { upsert: true, contentType: img.contentType, cacheControl: '3600' }));
        url = sb.storage.from('hg-assets').getPublicUrl(path).data.publicUrl;
      }
      const row = { ...v, image_url: url };
      if (isNew) {
        E.me ||= await getProfile();
        check(await sb.from('hg_dyn_events').insert({ id, ...row, created_by: E.me?.id ?? null }));
      } else {
        // Dates déplacées dans le futur : les annonces correspondantes repartent (hg-cron les refera)
        const now = Date.now();
        // Si une date a changé et tombe dans le futur, l'annonce correspondante est remise à zéro pour être refaite.
        // Comparaison en instants (timestamps) : deux écritures ISO différentes d'une même date ne comptent pas comme un changement.
        const moved = (a, b) => new Date(a).getTime() !== new Date(b).getTime();
        if (moved(row.starts_at, ev.starts_at) && new Date(row.starts_at).getTime() > now) row.announced_start_at = null;
        if (moved(row.ends_at, ev.ends_at) && new Date(row.ends_at).getTime() > now) row.announced_end_at = null;
        check(await sb.from('hg_dyn_events').update(row).eq('id', ev.id));
      }
      toast(isNew ? `Événement « ${v.name} » créé` : 'Événement enregistré', 'ok');
      await load();
      if (isNew) navigate(`${EV_ROUTE}/${id}`); else { E.list?.update(listItems()); paintDetail(); }
      return true;
    } catch (err) {
      showErr(errMsg(err));
      return false;
    }
  }
  f.name.focus();
}

/* ---------- Actions ---------- */
/**
 * Demande confirmation puis demande au bot de publier l'annonce (début ou fin) sur Discord.
 * @param {HTMLButtonElement} btn Bouton d'annonce.
 * @param {object} ev Événement.
 * @param {'start'|'end'} phase Lancement ou fin.
 */
async function announce(btn, ev, phase) {
  const ok = await confirmBox(phase === 'start' ? 'Annoncer le lancement ?' : 'Annoncer la fin ?',
    phase === 'start'
      ? `Le bot publie « ${ev.name} » dans le salon d'annonces Discord, avec son image.`
      : `Le bot publie la fin de « ${ev.name} » avec le top 3 dans le salon d'annonces Discord.`,
    { ok: 'Publier' });
  if (!ok) return;
  await busy(btn, async () => {
    const res = await callFn('hg-notify', { event: 'dyn_announce', event_id: ev.id, phase });
    if (res?.sent) toast('Annonce publiée sur Discord', 'ok');
    else toast(res?.skipped ? `Pas d'annonce : ${res.skipped}` : (res?.error || 'Annonce non envoyée'), res?.skipped ? '' : 'error');
    await reload();
  });
}

/**
 * Supprime l'événement après confirmation, puis son image du stockage. Les badges déjà gagnés restent.
 * @param {HTMLButtonElement} btn Bouton « Supprimer ».
 * @param {object} ev Événement à supprimer.
 */
async function remove(btn, ev) {
  const n = E.counts.get(ev.id) || 0;
  const ok = await confirmBox(`Supprimer « ${ev.name} » ?`,
    `${n ? `Ses ${n} capture${n > 1 ? 's seront supprimées' : ' sera supprimée'}. ` : ''}Les badges déjà gagnés sont conservés. Cette action est définitive.`,
    { ok: 'Supprimer', danger: true });
  if (!ok) return;
  await busy(btn, async () => {
    check(await sb.from('hg_dyn_events').delete().eq('id', ev.id));
    const m = /\/hg-assets\/(events\/[^?]+)/.exec(ev.image_url || '');
    if (m) await sb.storage.from('hg-assets').remove([decodeURIComponent(m[1])]).catch(() => {});
    toast('Événement supprimé', 'ok');
    navigate(EV_ROUTE);
    await reload();
  });
}

/**
 * Gestionnaire global des clics de la section : boutons « Nouvel événement », « Supprimer » et annonces.
 * @param {Event} e Événement de clic.
 */
async function onClick(e) {
  const t = e.target.closest('button[data-ev-act], button[data-ev-announce]');
  if (!t) return;
  if (t.dataset.evAct === 'new') return openEditor(null);
  const ev = current();
  if (!ev) return;
  if (t.dataset.evAct === 'delete') return remove(t, ev);
  if (t.dataset.evAnnounce) return announce(t, ev, t.dataset.evAnnounce);
}

/** Recharge les données, la liste et le détail (sans changer la sélection). */
async function reload() {
  try {
    await load();
    E.list?.update(listItems());
    E.list?.select(E.sel);
    paintDetail();
  } catch (e) {
    if (E.root) E.root.innerHTML = `<div class="empty">Impossible de charger les événements : ${esc(errMsg(e))}</div>`;
  }
}

/**
 * Section « Événements » (registerSub) : liste en colonne 2, détail dans la zone.
 * opts.onBadgesChange() : appelé après la création d'un badge depuis un événement (pour rafraîchir la section Badges).
 */
export function eventsSub(opts = {}) {
  E.onBadgesChange = opts.onBadgesChange || null;
  return {
    /** Repère le conteneur de la zone principale et branche le clic global, une seule fois. */
    main() {
      E.root = document.getElementById('events-root');
      if (!E.bound) { E.bound = true; document.addEventListener('click', onClick); }
    },
    /** Crée la liste (colonne 2) : filtres, recherche, sélection et navigation vers l'événement choisi. */
    list(el) {
      E.list = createList(el, {
        items: listItems(),
        key: 'id',
        label: 'Événements',
        filters: [
          { id: 'live', label: 'En cours', test: (it) => it.phase === 'live' },
          { id: 'future', label: 'À venir', test: (it) => it.phase === 'future' },
          { id: 'past', label: 'Terminés', test: (it) => it.phase === 'past' },
        ],
        search: { placeholder: 'Rechercher un événement', label: 'Rechercher un événement', fields: (it) => `${it.ev.name} ${it.ev.description || ''}` },
        selectedId: E.sel,
        render: rowHtml,
        empty: 'Aucun événement pour l\'instant.',
        onSelect: (it) => navigate(`${EV_ROUTE}/${it.id}`),
      });
    },
    /** Ouvre la section : recharge les événements, vérifie l'identifiant demandé, puis affiche la liste et le détail. */
    async open(_el, { id } = {}) {
      const tok = ++E.tok;
      E.sel = id || null;
      try { await load(); } catch (e) { if (E.root) E.root.innerHTML = `<div class="empty">Impossible de charger les événements : ${esc(errMsg(e))}</div>`; return; }
      if (tok !== E.tok) return;
      if (id && !E.events.some((x) => x.id === id)) { navigate(EV_ROUTE); return; }
      E.list?.update(listItems());
      E.list?.select(E.sel);
      paintActions();
      paintDetail();
    },
  };
}

/** Recharge la section (ex. après une modification des badges ailleurs). */
export const refreshEventsSection = () => (E.root ? reload() : Promise.resolve());
