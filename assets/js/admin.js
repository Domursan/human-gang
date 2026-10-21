// ===== Humane Gang — administration =====
import {
  sb, initPage, toast, errMsg, esc, $, $$, fmtDate, fmtDateTime, avatarHtml, notify, callFn, isGodMode, godTag,
} from './core.js';
import { confirmBox } from './ui-confirm.js';
import { mountGodCard, confirmRedo } from './admin-godmode.js';
import { mountThemesSection } from './admin-themes.js';
import { mountMessagesSection } from './admin-messages.js';
import { mountLogSection } from './admin-log.js';
import { mountBotSection } from './admin-bot.js';
import { initAccounts, refreshAccounts, sharedFieldsHtml, readSharedFields, pairsBlockHtml, openAccountFiche } from './admin-accounts.js';
import { mountGhostsSection, refreshGhostsSection, fetchAdminGhosts } from './admin-ghosts.js';
import { mountAccessSection, refreshAccessSection } from './admin-access.js';
import { mountInviteLinks, refreshInviteLinks } from './admin-invite-links.js';
import { openManualDraw } from './admin-ss-manual.js';
import { openBadgeEditor, deleteBadge, isAutoBadge } from './admin-badges-edit.js';
import { mountEventsSection, refreshEventsSection } from './admin-events.js';
import { mountCardsSection } from './admin-cards.js';
import { mountChallengesSection } from './admin-challenges.js';
import { hasLevels, sortedLevels, roman, METRIC_LABEL } from './badge-levels.js';
import { prepareImage, otherVariants } from './image-compress.js';

const me = await initPage({ auth: 'admin' });
mountGodCard($('#god-root'));

/* ---------- Icônes (SVG à trait) ---------- */
const ICON = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 12h10M13 8l4 4-4 4"/></svg>',
  badge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
};

/* ---------- État ---------- */
const S = {
  members: [], byId: new Map(), invites: [], editions: [], editionId: null, participants: [], exclusions: [],
  badges: [], userBadges: [], ideas: [], support: [], bot: null, theme: null, ghosts: [],
  ideaFilter: 'nouvelle', supportFilter: 'ouverte', badgeMember: '', lastDraw: null,
};
const pseudoOf = (id) => (id ? S.byId.get(id)?.pseudo ?? 'Ancien membre' : '—');
const STATUS = [
  ['inscriptions', 'Inscriptions ouvertes'], ['tirage', 'Tirage'], ['envoi', 'Envoi des cadeaux'],
  ['revelation', 'Révélation'], ['termine', 'Terminé'],
];
const STATUS_LABEL = Object.fromEntries(STATUS);
const SUBJECT_BUG = 'Bug sur le site';

/* ---------- Petits outils ---------- */
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return undefined; } finally { if (btn) btn.disabled = false; }
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
  }
  toast('Copié dans le presse-papiers', 'ok');
}
function check(res) { if (res.error) throw res.error; return res.data; }
/** Téléverse une image sous `base` (sans extension) ; compressée en WebP, l'extension suit le format envoyé. */
async function uploadAsset(base, file) {
  if (!file.type.startsWith('image/')) throw new Error('Choisis une image (PNG, JPG ou WebP).');
  if (file.size > 10 * 1024 * 1024) throw new Error('Image trop lourde (10 Mo maximum).');
  const img = await prepareImage(file);
  const path = `${base}.${img.ext}`;
  check(await sb.storage.from('hg-assets').upload(path, img.blob, { upsert: true, contentType: img.contentType, cacheControl: '300' }));
  sb.storage.from('hg-assets').remove(otherVariants(base, img.ext)).catch(() => {}); // ancienne version dans un autre format
  const { data } = sb.storage.from('hg-assets').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`; // évite l'ancienne version en cache
}
function pickFile(input) {
  return new Promise((resolve) => {
    input.value = '';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
const sectionError = (e) => `<div class="empty">Impossible de charger : ${esc(errMsg(e))}</div>`;

/* ---------- Chargement ---------- */
async function loadMembers() {
  S.members = check(await sb.rpc('hg_members')) ?? [];
  // Fantômes : visibles seulement par l'admin (pour leur attribuer badges, présences, cartes…)
  S.ghosts = await fetchAdminGhosts().catch((e) => { console.warn('[fantômes]', e); return []; });
  S.byId = new Map([...S.members, ...S.ghosts].map((m) => [m.id, m]));
}
async function loadInvites() { S.invites = check(await sb.from('hg_invites').select('*').order('created_at', { ascending: false })) ?? []; }
async function loadEditions() {
  S.editions = check(await sb.from('hg_ss_editions').select('*').order('year', { ascending: false })) ?? [];
  if (!S.editions.some((e) => e.id === S.editionId)) S.editionId = S.editions[0]?.id ?? null;
}
async function loadEditionDetails() {
  if (!S.editionId) { S.participants = []; S.exclusions = []; return; }
  const [p, x] = await Promise.all([
    sb.from('hg_ss_participants').select('user_id, sent_at, received_at, joined_at').eq('edition_id', S.editionId),
    sb.from('hg_ss_exclusions').select('*').eq('edition_id', S.editionId),
  ]);
  S.participants = check(p) ?? [];
  S.exclusions = check(x) ?? [];
}
async function loadBadges() {
  const [b, u] = await Promise.all([
    sb.from('hg_badges').select('*').order('sort'),
    sb.from('hg_user_badges').select('user_id, badge_code, awarded_at, level'),
  ]);
  S.badges = check(b) ?? []; S.userBadges = check(u) ?? [];
}
async function loadIdeas() { S.ideas = check(await sb.from('hg_ideas').select('*').order('created_at', { ascending: false })) ?? []; }
async function loadSupport() { S.support = check(await sb.from('hg_support').select('*').order('created_at', { ascending: false })) ?? []; }
async function loadSettings() {
  const rows = check(await sb.from('hg_settings').select('key, value').in('key', ['bot', 'theme'])) ?? [];
  const get = (k) => rows.find((r) => r.key === k)?.value;
  S.bot = get('bot') ?? { announce_channel_id: null, admin_discord_id: null, notify: {} };
  S.bot.notify = { draw: true, gift: true, irl: true, birthday: true, support: true, messages: true, ...(S.bot.notify || {}) };
  S.theme = get('theme') ?? { mode: 'auto', forced: null };
}

/* =========================================================
   Vue d'ensemble
   ========================================================= */
function renderStats() {
  const ed = S.editions[0];
  const free = S.invites.filter((i) => !i.used_by && !i.link_id && !(i.expires_at && new Date(i.expires_at) < new Date())).length;
  const newIdeas = S.ideas.filter((i) => i.status === 'nouvelle').length;
  const open = S.support.filter((s) => s.status === 'ouverte').length;
  const partCount = ed && ed.id === S.editionId ? S.participants.length : null;
  const tiles = [
    ['#comptes', S.members.length, 'membres'],
    ['#membres', free, free > 1 ? 'codes disponibles' : 'code disponible'],
    ['#secret-santa', ed ? (partCount ?? '–') : '–', ed ? `inscrits · Secret Santa ${ed.year}` : 'aucune édition'],
    ['#idees', newIdeas, newIdeas > 1 ? 'nouvelles idées' : 'nouvelle idée', newIdeas > 0],
    ['#assistance', open, open > 1 ? 'demandes ouvertes' : 'demande ouverte', open > 0],
  ];
  $('#stats').innerHTML = tiles.map(([href, v, l, warn]) =>
    `<a class="stat${warn ? ' attention' : ''}" href="${href}"><span class="stat-value">${esc(v)}</span><span class="stat-label">${esc(l)}</span></a>`).join('');
  setNavCount('idees', newIdeas); setNavCount('assistance', open);
}
function setNavCount(key, n) {
  const el = $(`.nav-count[data-count="${key}"]`);
  el.hidden = !n; el.textContent = n || '';
}

/* =========================================================
   Membres & invitations
   ========================================================= */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans I, L, O, 0, 1
function newCode() {
  const r = crypto.getRandomValues(new Uint32Array(4));
  return 'HG-' + [...r].map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}
let lastCodes = [];

// La liste des membres est dans la section « Comptes » (admin-accounts.js).
function renderMembers() { /* rien à rafraîchir ici : la liste des comptes ne dépend pas des badges */ }

function renderInvites() {
  $('#invite-new').innerHTML = lastCodes.length ? `
    <div class="new-codes" role="status">
      <strong>${lastCodes.length > 1 ? 'Nouveaux codes' : 'Nouveau code'}</strong>
      <div class="codes">${lastCodes.map((c) => `<span class="code">${esc(c)}</span>`).join('')}</div>
      <button class="btn btn-ghost btn-sm" type="button" data-copy-all>${ICON.copy} Copier ${lastCodes.length > 1 ? 'tous les codes' : 'le code'}</button>
    </div>` : '';

  // Les codes issus d'un lien d'invitation sont listés sous leur lien (admin-invite-links.js)
  const manual = S.invites.filter((i) => !i.link_id);
  const unused = manual.filter((i) => !i.used_by);
  const used = manual.filter((i) => i.used_by);
  const unusedHtml = unused.length ? unused.map((i) => `
      <div class="list-row">
        <div class="grow"><span class="code">${esc(i.code)}</span><div class="small muted">Créé le ${esc(fmtDate(i.created_at))}</div></div>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" type="button" data-copy="${esc(i.code)}">${ICON.copy} Copier</button>
          <button class="btn btn-danger btn-sm btn-icon" type="button" data-del-code="${esc(i.code)}" aria-label="Supprimer le code ${esc(i.code)}" title="Supprimer">${ICON.trash}</button>
        </div>
      </div>`).join('') : '<div class="empty">Aucun code disponible. Génère-en un pour inviter quelqu\'un.</div>';
  const usedHtml = used.length ? used.map((i) => `
      <div class="list-row">
        <div class="grow"><span class="code muted">${esc(i.code)}</span>
          <div class="small muted">Utilisé par <strong class="text">${esc(pseudoOf(i.used_by))}</strong> le ${esc(fmtDate(i.used_at))}</div></div>
      </div>`).join('') : '<p class="small muted">Aucun code utilisé pour l\'instant.</p>';

  $('#invite-list').innerHTML = `
    <div class="subhead"><h4 class="sub-title">Disponibles (${unused.length})</h4>
      ${unused.length > 1 ? '<button class="btn btn-danger btn-sm" type="button" data-del-all>Supprimer tous les disponibles</button>' : ''}</div>
    <div class="scroll-list">${unusedHtml}</div>
    <div class="subhead"><h4 class="sub-title">Utilisés (${used.length})</h4></div>
    <div class="scroll-list">${usedHtml}</div>`;
}

$('#invite-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const btn = ev.submitter;
  busy(btn, async () => {
    const n = Number($('#invite-count').value) || 1;
    let codes = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const set = new Set(); while (set.size < n) set.add(newCode());
      codes = [...set];
      const res = await sb.from('hg_invites').insert(codes.map((code) => ({ code, created_by: me.id })));
      if (!res.error) break;
      if (res.error.code !== '23505' || attempt === 2) throw res.error; // doublon improbable : on retente
    }
    lastCodes = codes;
    await loadInvites();
    renderInvites(); renderStats();
    toast(n > 1 ? `${n} codes générés` : 'Code généré', 'ok');
  });
});

$('#membres').addEventListener('click', async (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.copy) return copyText(t.dataset.copy);
  if (t.hasAttribute('data-copy-all')) return copyText(lastCodes.join('\n'));
  if (t.dataset.delCode) {
    const code = t.dataset.delCode;
    if (!(await confirmBox('Supprimer ce code ?', `Le code ${code} ne pourra plus être utilisé.`, { ok: 'Supprimer', danger: true }))) return;
    await busy(t, async () => {
      check(await sb.from('hg_invites').delete().eq('code', code).is('used_by', null));
      lastCodes = lastCodes.filter((c) => c !== code);
      await loadInvites(); renderInvites(); renderStats();
      toast('Code supprimé', 'ok');
    });
  }
  if (t.hasAttribute('data-del-all')) {
    const n = S.invites.filter((i) => !i.used_by && !i.link_id).length;
    if (!(await confirmBox('Supprimer tous les codes disponibles ?', `${n} codes non utilisés seront supprimés. Les codes déjà utilisés sont conservés.`, { ok: 'Tout supprimer', danger: true }))) return;
    await busy(t, async () => {
      check(await sb.from('hg_invites').delete().is('used_by', null).is('link_id', null));
      lastCodes = [];
      await loadInvites(); renderInvites(); renderStats();
      toast('Codes disponibles supprimés', 'ok');
    });
  }
});

/* =========================================================
   Secret Santa
   ========================================================= */
function renderSS() {
  const root = $('#ss-root');
  const ed = S.editions.find((e) => e.id === S.editionId);
  const nextYear = Math.max(new Date().getFullYear(), ...(S.editions.map((e) => e.year + 1)));
  const yearExists = (y) => S.editions.some((e) => e.year === y);
  const defaultYear = yearExists(new Date().getFullYear()) ? nextYear : new Date().getFullYear();

  const god = isGodMode();
  const openEd = S.editions.find((e) => e.status !== 'termine'); // une seule édition en cours à la fois (trigger en base, levé en mode sans limite)
  const locked = openEd && !god;
  const createForm = `
    <form class="card stack" id="ss-create"${openEd ? ' aria-describedby="ssc-locked"' : ''}>
      <h3 class="card-title">Nouvelle édition</h3>
      ${locked ? `<p class="ss-locked small" id="ssc-locked" role="note">Termine l'édition ${esc(openEd.year)} avant d'en créer une nouvelle (statut actuel : ${esc(STATUS_LABEL[openEd.status] ?? openEd.status)}).</p>` : ''}
      ${openEd && god ? `<p class="god-note" id="ssc-locked" role="note"><strong>Mode sans limite :</strong> l'édition ${esc(openEd.year)} n'est pas terminée (${esc(STATUS_LABEL[openEd.status] ?? openEd.status)}), tu peux quand même en créer une nouvelle. La page Secret Santa des membres affichera la plus récente.</p>` : ''}
      <fieldset class="ss-create-fields"${locked ? ' disabled' : ''}>
      <div class="grid-2">
        <div class="field"><label for="ssc-year">Année</label><input id="ssc-year" name="year" type="number" min="2020" max="2100" required value="${defaultYear}"></div>
        <div class="field"><label for="ssc-budget">Budget</label><input id="ssc-budget" name="budget" maxlength="60" placeholder="ex. 20 à 30 CHF"></div>
        <div class="field"><label for="ssc-send">Date limite d'envoi</label><input id="ssc-send" name="send_deadline" type="date"></div>
        <div class="field"><label for="ssc-exch">Date d'échange</label><input id="ssc-exch" name="exchange_date" type="date"></div>
      </div>
      ${sharedFieldsHtml('ssc', [])}
      <div class="btn-row"><button class="btn btn-primary" type="submit">Créer l'édition${openEd ? godTag() : ''}</button></div>
      </fieldset>
    </form>`;

  if (!ed) {
    root.innerHTML = `<div class="empty" style="margin-bottom:20px">Aucune édition pour l'instant. Crée la première ci-dessous.</div>${createForm}`;
    return;
  }

  const parts = [...S.participants].sort((a, b) => pseudoOf(a.user_id).localeCompare(pseudoOf(b.user_id), 'fr'));
  const sent = parts.filter((p) => p.sent_at).length;
  const received = parts.filter((p) => p.received_at).length;
  const partOpts = parts.map((p) => `<option value="${esc(p.user_id)}">${esc(pseudoOf(p.user_id))}</option>`).join('');
  const minDraw = god ? 1 : 3; // mode sans limite : dès 1 participant (il s'offre alors à lui-même)
  const canDraw = parts.length >= minDraw && !ed.drawn_at; // un seul tirage par édition (sauf « Refaire » en mode sans limite)
  const editionSelect = S.editions.length > 1 ? `
      <div class="field"><label for="ss-edition">Édition affichée</label>
        <select id="ss-edition">${S.editions.map((e) => `<option value="${esc(e.id)}"${e.id === ed.id ? ' selected' : ''}>${esc(e.year)} · ${esc(STATUS_LABEL[e.status] ?? e.status)}</option>`).join('')}</select></div>` : '';

  root.innerHTML = `
    <div class="ss-head" style="margin-bottom:20px">
      <div class="steps-mini" aria-label="Étapes">${STATUS.map(([k, l]) => {
        const idx = STATUS.findIndex(([s]) => s === ed.status), i = STATUS.findIndex(([s]) => s === k);
        return `<span class="pill ${i < idx ? 'pill-ok' : i === idx ? 'pill-current' : 'pill-todo'}">${esc(l)}</span>`;
      }).join('')}</div>
      ${editionSelect}
    </div>
    <div class="ss-layout">
      <form class="card card-ss stack" id="ss-edit">
        <h3 class="card-title">Édition ${esc(ed.year)}</h3>
        <div class="grid-2">
          <div class="field"><label for="sse-status">Statut${godTag()}</label>
            <select id="sse-status" name="status">${STATUS.map(([k, l]) => `<option value="${k}"${k === ed.status ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
          <div class="field"><label for="sse-budget">Budget</label><input id="sse-budget" name="budget" maxlength="60" value="${esc(ed.budget ?? '')}"></div>
          <div class="field"><label for="sse-send">Date limite d'envoi</label><input id="sse-send" name="send_deadline" type="date" value="${esc(ed.send_deadline ?? '')}"></div>
          <div class="field"><label for="sse-exch">Date d'échange</label><input id="sse-exch" name="exchange_date" type="date" value="${esc(ed.exchange_date ?? '')}"></div>
        </div>
        ${sharedFieldsHtml('sse', ed.shared_fields ?? [])}
        <p class="small muted">${ed.drawn_at ? `Tirage effectué le ${esc(fmtDateTime(ed.drawn_at))}.` : 'Tirage pas encore effectué.'} Le tirage passe automatiquement l'édition en « Envoi des cadeaux ».</p>
        <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer</button></div>

        <div class="draw-box stack">
          <h4 class="sub-title">Tirage au sort</h4>
          <p class="small muted">${god
            ? 'Mode sans limite : le tirage au hasard ignore les exclusions et la cible de l\'an dernier, et peut être refait. Les paires restent secrètes : tu peux les afficher plus bas si besoin.'
            : 'Respecte les exclusions et évite de retomber sur la même personne que l\'an dernier. Les paires restent secrètes : tu peux les afficher plus bas si besoin. Le tirage ne peut être lancé qu\'une seule fois par édition.'}</p>
          <div class="btn-row"><button class="btn btn-sand" type="button" id="ss-draw"${canDraw ? '' : ' disabled'}>${ed.drawn_at ? 'Tirage effectué' : `Lancer le tirage${god ? godTag() : ''}`}</button>
            ${ed.drawn_at ? '' : `<button class="btn btn-ghost" type="button" id="ss-draw-manual"${parts.length >= (god ? 1 : 2) ? '' : ' disabled'} aria-haspopup="dialog">Tirage manuel</button>`}</div>
          ${ed.drawn_at ? '' : '<p class="small muted">« Lancer le tirage » choisit au hasard. « Tirage manuel » te laisse fixer chaque paire toi-même (et compléter le reste au hasard).</p>'}
          ${ed.drawn_at ? `<p class="small muted">Tirage fait le ${esc(fmtDateTime(ed.drawn_at))} pour ${parts.length} participants.</p>` : parts.length < minDraw ? `<p class="small muted">Il faut au moins ${minDraw} inscrits${god ? godTag() : ''}.</p>` : ''}
          ${god && ed.drawn_at ? `<div class="draw-redo stack">
            <div class="btn-row">
              <button class="btn btn-sand" type="button" id="ss-redraw"${parts.length >= (god ? 1 : 2) ? '' : ' disabled'} aria-haspopup="dialog">Refaire le tirage (auto)${godTag()}</button>
              <button class="btn btn-ghost" type="button" id="ss-redraw-manual"${parts.length >= (god ? 1 : 2) ? '' : ' disabled'} aria-haspopup="dialog">Refaire le tirage (manuel)${godTag()}</button>
            </div>
            <p class="small muted">Supprime les attributions actuelles puis relance un tirage. Les cartes déjà vues par les participants changeront.</p>
          </div>` : ''}
          ${S.lastDraw && S.lastDraw.edition === ed.id ? `<p class="draw-result" role="status">Tirage OK pour ${esc(S.lastDraw.n)} participants</p>` : ''}
        </div>
      </form>

      <div class="stack" style="gap:20px">
        <div class="card stack">
          <h3 class="card-title">Carte de base</h3>
          <p class="small muted">Image de fond de la carte que chaque Santa découvre (le pseudo de sa cible est ajouté dessus). Format paysage conseillé, 1500 × 1000 px.</p>
          <div class="card-preview">${ed.card_base_url ? `<img src="${esc(ed.card_base_url)}" alt="Carte de base ${esc(ed.year)}">` : 'Carte par défaut'}</div>
          <div class="btn-row">
            <button class="btn btn-ghost" type="button" id="ss-card-upload">${ICON.upload} ${ed.card_base_url ? 'Remplacer' : 'Téléverser'}</button>
            ${ed.card_base_url ? '<button class="btn btn-danger" type="button" id="ss-card-reset">Revenir à la carte par défaut</button>' : ''}
          </div>
          <input type="file" id="ss-card-file" accept="image/png,image/jpeg,image/webp" hidden>
        </div>

        <div class="card stack">
          <h3 class="card-title">Inscrits <span class="muted">(${parts.length})</span></h3>
          ${parts.length ? `<div class="participants">${parts.map((p) => `<span class="pill">${esc(pseudoOf(p.user_id))}</span>`).join('')}</div>
            ${ed.drawn_at ? `<p class="small muted">Cadeaux envoyés : ${sent} / ${parts.length} · reçus : ${received} / ${parts.length}</p>` : ''}`
            : '<div class="empty">Personne n\'est encore inscrit.</div>'}
        </div>
      </div>

      <div class="card stack">
        <h3 class="card-title">Exclusions</h3>
        <p class="small muted">Deux personnes d'une même paire ne pourront pas se tirer l'une l'autre (couples, colocs…).</p>
        ${parts.length >= 2 ? `
        <form class="inline-form" id="ss-excl-form">
          <div class="field"><label for="ex-a">Personne A</label><select id="ex-a" required>${partOpts}</select></div>
          <div class="field"><label for="ex-b">Personne B</label><select id="ex-b" required>${partOpts}</select></div>
          <button class="btn btn-primary" type="submit">Ajouter</button>
        </form>` : '<p class="small muted">Il faut au moins deux inscrits pour définir une exclusion.</p>'}
        <div>${S.exclusions.length ? S.exclusions.map((x) => `
          <div class="list-row">
            <div class="pair grow"><strong>${esc(pseudoOf(x.user_a))}</strong>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>
              <strong>${esc(pseudoOf(x.user_b))}</strong></div>
            <button class="btn btn-danger btn-sm btn-icon" type="button" data-del-excl="${esc(x.user_a)}|${esc(x.user_b)}" aria-label="Retirer l'exclusion ${esc(pseudoOf(x.user_a))} et ${esc(pseudoOf(x.user_b))}">${ICON.x}</button>
          </div>`).join('') : '<p class="small muted">Aucune exclusion.</p>'}</div>
      </div>

      ${pairsBlockHtml(ed)}
      ${createForm}
    </div>`;
  const b = $('#ex-b'); if (b && b.options.length > 1) b.selectedIndex = 1;
}

const nullIfEmpty = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());

$('#secret-santa').addEventListener('change', async (ev) => {
  if (ev.target.id !== 'ss-edition') return;
  S.editionId = ev.target.value;
  try { await loadEditionDetails(); } catch (e) { toast(errMsg(e), 'error'); }
  renderSS();
});

$('#secret-santa').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = ev.target, btn = ev.submitter;
  if (form.id === 'ss-create') {
    busy(btn, async () => {
      const fd = new FormData(form);
      const year = Number(fd.get('year'));
      if (S.editions.some((e) => e.year === year)) throw new Error(`L'édition ${year} existe déjà.`);
      const openEd = S.editions.find((e) => e.status !== 'termine');
      if (openEd && !isGodMode()) throw new Error(`Termine l'édition ${openEd.year} avant d'en créer une nouvelle.`);
      const res = await sb.from('hg_ss_editions').insert({
        year, budget: nullIfEmpty(fd.get('budget')), send_deadline: nullIfEmpty(fd.get('send_deadline')),
        exchange_date: nullIfEmpty(fd.get('exchange_date')), shared_fields: readSharedFields(form),
      }).select().single();
      if (res.error && /termine/i.test(errMsg(res.error))) { // trigger hg_ss_editions_guard (levé côté serveur en mode sans limite)
        await loadEditions(); renderSS();
        throw new Error(isGodMode()
          ? 'Le serveur refuse encore : le mode sans limite a peut-être expiré. Réactive-le puis réessaie.'
          : 'Une édition est encore en cours : passe-la en « Terminé » avant d\'en créer une nouvelle.');
      }
      const row = check(res);
      S.editionId = row.id;
      await loadEditions(); await loadEditionDetails();
      renderSS(); renderStats();
      toast(`Édition ${year} créée, inscriptions ouvertes`, 'ok');
    });
  }
  if (form.id === 'ss-edit') {
    busy(btn, async () => {
      const fd = new FormData(form);
      const ed = S.editions.find((e) => e.id === S.editionId);
      const status = fd.get('status');
      if (status !== ed.status && ['envoi', 'revelation', 'termine'].includes(status) && !ed.drawn_at && !isGodMode()) {
        if (!(await confirmBox('Aucun tirage effectué', `Passer en « ${STATUS_LABEL[status]} » sans tirage ? Les participants n'auront pas de cible.`, { ok: 'Changer quand même' }))) return;
      }
      if (status === 'revelation' && ed.status !== 'revelation') {
        if (!(await confirmBox('Passer à la révélation ?', 'Tous les membres pourront voir qui offrait à qui.', { ok: 'Révéler' }))) return;
      }
      check(await sb.from('hg_ss_editions').update({
        status, budget: nullIfEmpty(fd.get('budget')),
        send_deadline: nullIfEmpty(fd.get('send_deadline')), exchange_date: nullIfEmpty(fd.get('exchange_date')),
        shared_fields: readSharedFields(form),
      }).eq('id', ed.id));
      await loadEditions(); renderSS(); renderStats();
      toast('Édition enregistrée', 'ok');
    });
  }
  if (form.id === 'ss-excl-form') {
    busy(btn, async () => {
      let a = $('#ex-a').value, b = $('#ex-b').value;
      if (!a || !b || a === b) throw new Error('Choisis deux personnes différentes.');
      if (a > b) [a, b] = [b, a];
      if (S.exclusions.some((x) => (x.user_a === a && x.user_b === b) || (x.user_a === b && x.user_b === a))) throw new Error('Cette exclusion existe déjà.');
      check(await sb.from('hg_ss_exclusions').insert({ edition_id: S.editionId, user_a: a, user_b: b }));
      await loadEditionDetails(); renderSS();
      toast('Exclusion ajoutée', 'ok');
    });
  }
});

$('#secret-santa').addEventListener('click', async (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  const ed = S.editions.find((e) => e.id === S.editionId);
  if (t.dataset.delExcl) {
    const [a, b] = t.dataset.delExcl.split('|');
    await busy(t, async () => {
      check(await sb.from('hg_ss_exclusions').delete().eq('edition_id', S.editionId).eq('user_a', a).eq('user_b', b));
      await loadEditionDetails(); renderSS();
      toast('Exclusion retirée', 'ok');
    });
  }
  if (t.id === 'ss-card-upload') {
    const file = await pickFile($('#ss-card-file'));
    if (!file) return;
    await busy(t, async () => {
      const url = await uploadAsset(`cartes/base-${ed.year}`, file);
      check(await sb.from('hg_ss_editions').update({ card_base_url: url }).eq('id', ed.id));
      await loadEditions(); renderSS();
      toast('Carte de base mise à jour', 'ok');
    });
  }
  if (t.id === 'ss-card-reset') {
    if (!(await confirmBox('Revenir à la carte par défaut ?', 'La carte dessinée automatiquement sera utilisée. Le fichier téléversé reste stocké.', { ok: 'Revenir au défaut' }))) return;
    await busy(t, async () => {
      check(await sb.from('hg_ss_editions').update({ card_base_url: null }).eq('id', ed.id));
      await loadEditions(); renderSS();
      toast('Carte par défaut rétablie', 'ok');
    });
  }
  if (t.id === 'ss-redraw' || t.id === 'ss-redraw-manual') {
    if (!isGodMode() || !ed.drawn_at) return;
    await redraw(t, ed, t.id === 'ss-redraw-manual');
    return;
  }
  if (t.id === 'ss-draw-manual') {
    if (ed.drawn_at) return;
    await busy(t, () => openManualDraw({
      edition: ed, participants: S.participants.map((p) => p.user_id), exclusions: S.exclusions, editions: S.editions, pseudoOf,
      onDone: async (count) => {
        S.lastDraw = { edition: ed.id, n: count };
        await loadEditions(); renderSS(); renderStats();
        toast(`Tirage manuel enregistré pour ${count} participants`, 'ok');
      },
    }));
    return;
  }
  if (t.id === 'ss-draw') {
    if (ed.drawn_at) return; // un seul tirage par édition
    const n = S.participants.length;
    const msg = isGodMode()
      ? `${n} participants. Mode sans limite : les ${S.exclusions.length} exclusion${S.exclusions.length > 1 ? 's' : ''} et la cible de l'an dernier sont ignorées.\nTu pourras refaire le tirage tant que le mode est actif.\nL'édition passera en « Envoi des cadeaux » et les participants seront prévenus par le bot.`
      : `${n} participants, ${S.exclusions.length} exclusion${S.exclusions.length > 1 ? 's' : ''}.\nLe tirage est définitif : il ne pourra pas être relancé. Vérifie les inscrits et les exclusions avant.\nL'édition passera en « Envoi des cadeaux » et les participants seront prévenus par le bot.`;
    if (!(await confirmBox('Lancer le tirage ?', msg, { ok: 'Lancer le tirage' }))) return;
    await busy(t, async () => {
      const count = check(await sb.rpc('hg_ss_draw', { p_edition: ed.id }));
      S.lastDraw = { edition: ed.id, n: count };
      notify('ss_draw', { edition_id: ed.id }); // le bot prévient (sans jamais révéler les paires)
      await loadEditions(); renderSS(); renderStats();
      toast(`Tirage OK pour ${count} participants`, 'ok');
    });
  }
});

/* Mode sans limite : refaire le tirage (suppression des attributions puis nouveau tirage auto ou manuel) */
async function deleteAssignments(ed) {
  check(await sb.from('hg_ss_assignments').delete().eq('edition_id', ed.id));
}
async function afterFailedRedraw(ed) {
  // Attributions supprimées mais nouveau tirage refusé : l'édition redevient « sans tirage » pour pouvoir relancer.
  try { check(await sb.from('hg_ss_editions').update({ drawn_at: null }).eq('id', ed.id)); } catch (e) { console.warn('[tirage] remise à zéro', e); }
  await loadEditions(); renderSS(); renderStats();
}
async function redraw(btn, ed, manual) {
  const n = S.participants.length;
  if (manual) {
    await busy(btn, () => openManualDraw({
      edition: ed, participants: S.participants.map((p) => p.user_id), exclusions: S.exclusions, editions: S.editions, pseudoOf,
      redo: {
        confirm: () => confirmRedo({ year: ed.year, participants: n, manual: true }),
        before: () => deleteAssignments(ed),
        onFail: () => afterFailedRedraw(ed),
      },
      onDone: async (count) => {
        S.lastDraw = { edition: ed.id, n: count };
        await loadEditions(); renderSS(); renderStats();
        toast(`Nouveau tirage manuel enregistré pour ${count} participants`, 'ok');
      },
    }));
    return;
  }
  const { ok, notify: tell } = await confirmRedo({ year: ed.year, participants: n });
  if (!ok) return;
  await busy(btn, async () => {
    if (!isGodMode()) throw new Error('Le mode sans limite a expiré : réactive-le pour refaire le tirage.');
    await deleteAssignments(ed);
    const res = await sb.rpc('hg_ss_draw', { p_edition: ed.id });
    if (res.error) { await afterFailedRedraw(ed); throw res.error; }
    const count = res.data;
    S.lastDraw = { edition: ed.id, n: count };
    if (tell) notify('ss_draw', { edition_id: ed.id });
    await loadEditions(); renderSS(); renderStats();
    toast(`Nouveau tirage OK pour ${count} participants`, 'ok');
  });
}
window.addEventListener('hg:godmode', () => { if (ssLoaded) renderSS(); });

/* =========================================================
   Badges
   ========================================================= */
const badgeImg = (b) => (b.image_url ? `<img src="${esc(b.image_url)}" alt="">` : ICON.badge);

function renderBadges() {
  const holders = new Map();
  for (const ub of S.userBadges) {
    if (!holders.has(ub.badge_code)) holders.set(ub.badge_code, []);
    const b = S.badges.find((x) => x.code === ub.badge_code);
    holders.get(ub.badge_code).push(pseudoOf(ub.user_id) + (hasLevels(b) ? ` (${roman(ub.level || 1)})` : ''));
  }
  $('#badge-grid').innerHTML = S.badges.map((b) => {
    const h = holders.get(b.code) || [];
    const auto = isAutoBadge(b.code);
    return `<div class="badge-card">
      <div class="badge-top"><div class="badge-img">${badgeImg(b)}</div>
        <div><div class="badge-name">${esc(b.name)}</div><div class="small muted">${esc(b.description)}</div></div></div>
      <div class="badge-tags"><span class="pill ${auto || hasLevels(b) ? 'pill-muted' : 'pill-current'}">${auto || hasLevels(b) ? 'automatique' : 'manuel'}</span>${hasLevels(b) ? `<span class="pill pill-warn" title="${esc(METRIC_LABEL[b.metric] || b.metric || '')}">${sortedLevels(b).length} niveaux · ${esc(METRIC_LABEL[b.metric] || b.metric || '')}</span>` : ''}<span class="small muted code-sm">${esc(b.code)}</span></div>
      <div class="badge-holders">${h.length ? `${h.length} membre${h.length > 1 ? 's' : ''} : ${esc(h.sort((x, y) => x.localeCompare(y, 'fr')).join(', '))}` : 'Personne pour l\'instant'}</div>
      <div class="badge-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-badge-edit="${esc(b.code)}">Modifier</button>
        <button class="btn btn-ghost btn-sm" type="button" data-badge-img="${esc(b.code)}" aria-label="${b.image_url ? 'Changer l\'image' : 'Ajouter une image'} du badge ${esc(b.name)}">${ICON.upload} Image</button>
        <button class="btn btn-danger btn-sm btn-icon" type="button" data-badge-del="${esc(b.code)}" aria-label="Supprimer le badge ${esc(b.name)}" title="Supprimer">${ICON.trash}</button>
      </div>
    </div>`;
  }).join('') || '<div class="empty">Aucun badge.</div>';

  const sel = $('#badge-member');
  const pickable = [...S.members.map((m) => ({ id: m.id, label: m.pseudo })), ...S.ghosts.map((g) => ({ id: g.id, label: `${g.pseudo} (fantôme)` }))]
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  sel.innerHTML = '<option value="">Choisir un membre…</option>' +
    pickable.map((m) => `<option value="${esc(m.id)}"${m.id === S.badgeMember ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
  renderBadgeToggles();
}
function renderBadgeToggles() {
  const uid = S.badgeMember;
  const box = $('#badge-toggles');
  if (!uid) { box.innerHTML = '<p class="small muted">Choisis un membre pour voir et modifier ses badges.</p>'; return; }
  const owned = new Set(S.userBadges.filter((u) => u.user_id === uid).map((u) => u.badge_code));
  box.innerHTML = S.badges.map((b) => `<button class="chip" type="button" data-toggle-badge="${esc(b.code)}" aria-pressed="${owned.has(b.code)}">${owned.has(b.code) ? ICON.check : ''}${esc(b.name)}</button>`).join('');
}
async function awardBadge(userId, code) {
  const res = await sb.from('hg_user_badges').insert({ user_id: userId, badge_code: code });
  if (res.error && res.error.code !== '23505') throw res.error;
  await loadBadges(); renderBadges(); renderMembers();
}
const hasBadge = (uid, code) => S.userBadges.some((u) => u.user_id === uid && u.badge_code === code);
const badgeName = (code) => S.badges.find((b) => b.code === code)?.name ?? code;

$('#badge-member').addEventListener('change', (ev) => { S.badgeMember = ev.target.value; renderBadgeToggles(); });
$('#badges').addEventListener('click', async (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.toggleBadge) {
    const code = t.dataset.toggleBadge, uid = S.badgeMember, on = t.getAttribute('aria-pressed') === 'true';
    if (on && !(await confirmBox('Retirer ce badge ?', `${pseudoOf(uid)} perdra le badge « ${badgeName(code)} ».`, { ok: 'Retirer', danger: true }))) return;
    await busy(t, async () => {
      if (on) {
        check(await sb.from('hg_user_badges').delete().eq('user_id', uid).eq('badge_code', code));
        await loadBadges(); renderBadges(); renderMembers();
      } else await awardBadge(uid, code);
      toast(on ? 'Badge retiré' : `Badge « ${badgeName(code)} » attribué à ${pseudoOf(uid)}`, 'ok');
    });
  }
  if (t.id === 'badge-new' || t.dataset.badgeEdit) {
    const badge = t.dataset.badgeEdit ? S.badges.find((b) => b.code === t.dataset.badgeEdit) : null;
    openBadgeEditor({ badge, badges: S.badges, onSaved: async () => { await loadBadges(); renderBadges(); refreshEventsSection(); } });
    return;
  }
  if (t.dataset.badgeDel) {
    const badge = S.badges.find((b) => b.code === t.dataset.badgeDel);
    if (!badge) return;
    const holders = S.userBadges.filter((u) => u.badge_code === badge.code).length;
    await busy(t, async () => {
      if (await deleteBadge(badge, holders)) {
        if (t.isConnected) t.disabled = false;
        await loadBadges(); renderBadges();
        toast(`Badge « ${badge.name} » supprimé`, 'ok');
      }
    });
    return;
  }
  if (t.dataset.badgeImg) {
    const code = t.dataset.badgeImg;
    const file = await pickFile($('#badge-file'));
    if (!file) return;
    await busy(t, async () => {
      const url = await uploadAsset(`badges/${code}`, file);
      check(await sb.from('hg_badges').update({ image_url: url }).eq('code', code));
      await loadBadges(); renderBadges();
      toast('Image du badge mise à jour', 'ok');
    });
  }
});

/* =========================================================
   Boîte à idées
   ========================================================= */
const IDEA_LABEL = { nouvelle: 'Nouvelle', retenue: 'Retenue', ecartee: 'Écartée' };
const IDEA_PILL = { nouvelle: 'pill-current', retenue: 'pill-ok', ecartee: 'pill-todo' };
function renderIdeas() {
  const list = S.ideaFilter === 'all' ? S.ideas : S.ideas.filter((i) => i.status === S.ideaFilter);
  $$('#idea-filters .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.filter === S.ideaFilter)));
  $('#idea-list').innerHTML = list.length ? list.map((i) => `
    <article class="item">
      <div class="item-meta"><strong>${esc(i.user_id ? pseudoOf(i.user_id) : 'Membre parti')}</strong>
        <span>${esc(fmtDateTime(i.created_at))}</span><span class="pill ${IDEA_PILL[i.status]}">${esc(IDEA_LABEL[i.status])}</span>
        ${i.status === 'retenue' && i.user_id && hasBadge(i.user_id, 'boite_a_idees') ? '<span class="pill pill-muted">badge attribué</span>' : ''}</div>
      <p class="item-body">${esc(i.body)}</p>
      <div class="btn-row">
        ${i.status !== 'retenue' ? `<button class="btn btn-ghost btn-sm" type="button" data-idea="${esc(i.id)}" data-status="retenue">${ICON.check} Retenir</button>` : ''}
        ${i.status !== 'ecartee' ? `<button class="btn btn-ghost btn-sm" type="button" data-idea="${esc(i.id)}" data-status="ecartee">Écarter</button>` : ''}
        ${i.status !== 'nouvelle' ? `<button class="btn btn-ghost btn-sm" type="button" data-idea="${esc(i.id)}" data-status="nouvelle">Remettre en nouvelle</button>` : ''}
        ${i.status === 'retenue' && i.user_id && S.byId.has(i.user_id) && !hasBadge(i.user_id, 'boite_a_idees') ? `<button class="btn btn-sand btn-sm" type="button" data-idea-badge="${esc(i.user_id)}">${ICON.badge} Attribuer le badge</button>` : ''}
      </div>
    </article>`).join('') : `<div class="empty">${S.ideaFilter === 'nouvelle' ? 'Aucune nouvelle idée.' : 'Rien dans cette catégorie.'}</div>`;
}
async function offerIdeaBadge(uid) {
  if (!uid || !S.byId.has(uid) || hasBadge(uid, 'boite_a_idees')) return;
  if (await confirmBox('Attribuer le badge ?', `Attribuer le badge « ${badgeName('boite_a_idees')} » à ${pseudoOf(uid)} ?`, { ok: 'Attribuer' })) {
    await awardBadge(uid, 'boite_a_idees');
    toast(`Badge attribué à ${pseudoOf(uid)}`, 'ok');
  }
}
$('#idees').addEventListener('click', async (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.filter) { S.ideaFilter = t.dataset.filter; renderIdeas(); return; }
  if (t.dataset.ideaBadge) { await busy(t, () => offerIdeaBadge(t.dataset.ideaBadge)); renderIdeas(); return; }
  if (t.dataset.idea) {
    const idea = S.ideas.find((i) => i.id === t.dataset.idea);
    await busy(t, async () => {
      check(await sb.from('hg_ideas').update({ status: t.dataset.status }).eq('id', idea.id));
      await loadIdeas(); renderIdeas(); renderStats();
      toast(`Idée ${IDEA_LABEL[t.dataset.status].toLowerCase()}`, 'ok');
      if (t.dataset.status === 'retenue') await offerIdeaBadge(idea.user_id);
      renderIdeas();
    });
  }
});

/* =========================================================
   Assistance
   ========================================================= */
function renderSupport() {
  const list = S.support.filter((s) => s.status === S.supportFilter);
  $$('#support-filters .chip').forEach((c) => {
    c.setAttribute('aria-pressed', String(c.dataset.filter === S.supportFilter));
    const n = S.support.filter((s) => s.status === c.dataset.filter).length;
    c.textContent = `${c.dataset.filter === 'ouverte' ? 'Ouvertes' : 'Traitées'} (${n})`;
  });
  $('#support-list').innerHTML = list.length ? list.map((s) => `
    <article class="item">
      <div class="item-meta"><strong>${esc(s.pseudo)}</strong>
        <span class="pill ${s.user_id ? 'pill-ok' : 'pill-warn'}"${s.user_id ? '' : ' title="Demande envoyée sans compte : le pseudo n\'est pas vérifié"'}>${s.user_id ? 'Membre connecté' : 'Non connecté · pseudo non vérifié'}</span>
        <span>${esc(fmtDateTime(s.created_at))}</span>
        <span class="pill ${s.discord_sent ? 'pill-ok' : 'pill-warn'}" title="${s.discord_sent ? 'Le bot t\'a envoyé cette demande en MP' : 'Le MP Discord n\'a pas été envoyé (bot non configuré ou erreur)'}">${s.discord_sent ? 'MP Discord envoyé' : 'MP Discord non envoyé'}</span></div>
      <div class="item-subject">${esc(s.subject)}</div>
      <p class="item-body">${esc(s.message)}</p>
      <div class="small muted">Contact pour la réponse : ${s.contact ? `<strong class="text">${esc(s.contact)}</strong>` : 'non précisé'}</div>
      <div class="btn-row">
        ${s.status === 'ouverte'
          ? `<button class="btn btn-primary btn-sm" type="button" data-support="${esc(s.id)}" data-status="traitee">${ICON.check} Marquer traitée</button>`
          : `<button class="btn btn-ghost btn-sm" type="button" data-support="${esc(s.id)}" data-status="ouverte">Rouvrir</button>`}
        ${s.contact ? `<button class="btn btn-ghost btn-sm" type="button" data-copy="${esc(s.contact)}">${ICON.copy} Copier le contact</button>` : ''}
        ${s.subject === SUBJECT_BUG && s.user_id && S.byId.has(s.user_id) && !hasBadge(s.user_id, 'chasseur_bugs')
          ? `<button class="btn btn-sand btn-sm" type="button" data-bug-badge="${esc(s.user_id)}">${ICON.badge} Badge ${esc(badgeName('chasseur_bugs'))}</button>` : ''}
      </div>
    </article>`).join('') : `<div class="empty">${S.supportFilter === 'ouverte' ? 'Aucune demande en attente.' : 'Aucune demande traitée.'}</div>`;
}
$('#assistance').addEventListener('click', async (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.filter) { S.supportFilter = t.dataset.filter; renderSupport(); return; }
  if (t.dataset.copy) return copyText(t.dataset.copy);
  if (t.dataset.bugBadge) {
    const uid = t.dataset.bugBadge;
    if (!(await confirmBox('Attribuer le badge ?', `Attribuer « ${badgeName('chasseur_bugs')} » à ${pseudoOf(uid)} ?`, { ok: 'Attribuer' }))) return;
    await busy(t, async () => { await awardBadge(uid, 'chasseur_bugs'); renderSupport(); toast('Badge attribué', 'ok'); });
  }
  if (t.dataset.support) {
    await busy(t, async () => {
      check(await sb.from('hg_support').update({ status: t.dataset.status }).eq('id', t.dataset.support));
      await loadSupport(); renderSupport(); renderStats();
      toast(t.dataset.status === 'traitee' ? 'Demande marquée comme traitée' : 'Demande rouverte', 'ok');
    });
  }
});

/* =========================================================
   Bot
   ========================================================= */
// Réglages, messages types et message manuel : voir admin-bot.js

/* =========================================================
   Thème
   ========================================================= */
// Éditeur complet des thèmes (hg_themes + hg_settings.theme) : voir admin-themes.js

/* =========================================================
   Navigation latérale (section active)
   ========================================================= */
function setupNav() {
  const links = $$('.admin-nav a');
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const setActive = (id) => links.forEach((a) => {
    const on = a === byId.get(id);
    if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    if (on && matchMedia('(max-width: 860px)').matches) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  const visible = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.boundingClientRect.top : null);
    const first = [...visible.entries()].filter(([, v]) => v !== null).sort((a, b) => a[1] - b[1])[0];
    if (first) setActive(first[0]);
  }, { rootMargin: '-15% 0px -60% 0px' });
  $$('.admin-section').forEach((s) => io.observe(s));
  setActive(location.hash.slice(1) || 'apercu');
}

/* =========================================================
   Démarrage
   ========================================================= */
async function safe(fn, onError) { try { await fn(); return true; } catch (e) { console.error(e); onError?.(e); return false; } }

let ssLoaded = false;
await Promise.all([
  safe(loadMembers, (e) => toast(`Membres : ${errMsg(e)}`, 'error')),
  safe(loadInvites, (e) => { $('#invite-list').innerHTML = sectionError(e); }),
  safe(async () => { await loadEditions(); await loadEditionDetails(); ssLoaded = true; }, (e) => { $('#ss-root').innerHTML = sectionError(e); }),
  safe(loadBadges, (e) => { $('#badge-grid').innerHTML = sectionError(e); }),
  safe(loadIdeas, (e) => { $('#idea-list').innerHTML = sectionError(e); }),
  safe(loadSupport, (e) => { $('#support-list').innerHTML = sectionError(e); }),
  safe(loadSettings, (e) => toast(`Réglages : ${errMsg(e)}`, 'error')),
]);

renderStats();
renderMembers();
renderInvites();
if (ssLoaded) renderSS();
renderBadges();
renderIdeas();
renderSupport();
mountBotSection($('#bot-root'));
mountThemesSection($('#theme-root'));
mountInviteLinks($('#links-root'), { me, pseudoOf, onChange: async () => { await loadInvites(); renderInvites(); renderStats(); } });
mountMessagesSection($('#messages-root'));
mountLogSection($('#log-root'));
mountEventsSection($('#events-root'), { onBadgesChange: async () => { await loadBadges(); renderBadges(); } });
mountCardsSection($('#cards-root'));
mountChallengesSection($('#challenges-root'));
mountAccessSection($('#access-root'), { openMember: (uid) => openAccountFiche(uid, 'acces') });
// Comptes fantômes : préparés avant l'inscription. Leur création/suppression resynchronise la liste des comptes et les sélecteurs.
mountGhostsSection($('#ghosts-root'), {
  openFiche: (uid) => openAccountFiche(uid),
  onChange: async () => { await loadMembers(); await refreshAccounts(); renderBadges(); renderStats(); },
});
refreshGhostsSection();
// Comptes : fiche complète de chaque membre. Après une modification, on resynchronise les autres sections.
initAccounts({
  me,
  onChange: async (kind) => {
    if (kind === 'members') { refreshAccessSection(); await loadMembers(); renderInvites(); refreshInviteLinks(); renderBadges(); if (ssLoaded) renderSS(); renderIdeas(); renderSupport(); renderStats(); }
    if (kind === 'badges') { await loadBadges(); renderBadges(); }
    if (kind === 'ss') { await loadEditionDetails(); if (ssLoaded) renderSS(); renderStats(); }
    if (kind === 'ideas') { await loadIdeas(); renderIdeas(); renderStats(); }
    if (kind === 'support') { await loadSupport(); renderSupport(); renderStats(); }
  },
});
setupNav();
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
