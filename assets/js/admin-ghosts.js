// ===== Humane Gang — administration : comptes fantômes =====
// Un fantôme = ligne de hg_profiles avec is_ghost = true, préparée par l'admin avant l'inscription de la personne.
// Invisible pour les membres. Importé par admin.js (section « Comptes fantômes »), admin-accounts.js (liste des comptes),
// irl.js et historique.js (annuaire vu par l'admin). Ne dépend que de core.js (pas d'import circulaire).
import { sb, toast, errMsg, esc, $, fmtDate, avatarHtml } from './core.js';
import { confirmBox } from './ui-confirm.js';
import { svg } from './icons.js';

const IC = {
  copy: svg('copy', { stroke: 2 }),
  link: svg('link', { stroke: 2 }),
  trash: svg('trash', { stroke: 2 }),
  merge: svg('merge', { stroke: 2 }),
};

const G = {
  root: null, openFiche: null, onChange: async () => {},
  list: [], error: null,            // fantômes
  sugg: [], suggError: null,        // correspondances possibles (hg_ghost_suggestions)
  merge: null,                      // liaison en cours : { ghostId, slot, memberId, memberPseudo, members, loading, error, busy }
};

function check(res) { if (res.error) throw res.error; return res.data; }
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return undefined; } finally { if (btn?.isConnected) btn.disabled = false; }
}
async function copyText(text, done = 'Copié dans le presse-papiers') {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
  }
  toast(done, 'ok');
}
/** 'AAAA-MM-JJ' -> date lisible, sans décalage de fuseau. */
const fmtDay = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? fmtDate(new Date(+m[1], m[2] - 1, +m[3])) : ''; };
/** Comparaison sans accents ni casse. */
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Code actif = non expiré. Un seul code par fantôme : en générer un nouveau invalide l'ancien. */
export const ghostCodeActive = (g) => !!g.invite_code && !!g.invite_expires_at && new Date(g.invite_expires_at) > new Date();
/** Lien d'inscription complet : compte.html lit ?code=… (pré-remplit le champ) et ouvre le formulaire d'inscription. */
export function ghostInviteLink(code) {
  const u = new URL('compte.html', location.href);
  u.searchParams.set('code', code);
  u.hash = 'inscription';
  return u.href;
}

/* ---------- Données ---------- */
/** Liste des fantômes (admin uniquement : hg_admin_ghosts). Chaque ligne porte is_ghost = true. */
export async function fetchAdminGhosts() {
  const data = check(await sb.rpc('hg_admin_ghosts'));
  return (data ?? []).map((g) => ({ ...g, is_ghost: true }));
}
/**
 * Annuaire { id → entrée } des fantômes, pour les pages membres vues par l'admin uniquement.
 * Le pseudo porte la mention « (fantôme) ». Vide si la requête échoue (ex. pas admin).
 */
export async function ghostDirectory() {
  try {
    return new Map((await fetchAdminGhosts()).map((g) => [g.id, { id: g.id, pseudo: `${g.pseudo} (fantôme)`, avatar_url: g.avatar_url, is_ghost: true }]));
  } catch (e) { console.warn('[fantômes]', e); return new Map(); }
}
/** Correspondances fantôme ↔ compte inscrit (même ID Discord ou même pseudo). */
async function fetchSuggestions() {
  const rows = check(await sb.rpc('hg_ghost_suggestions'));
  return (rows ?? []).filter((r) => r && r.ghost_id && r.user_id);
}
/** Comptes inscrits (non fantômes), triés par pseudo. */
async function loadMembers() {
  const data = check(await sb.rpc('hg_members'));
  return (data ?? [])
    .filter((m) => m && m.id)
    .map((m) => ({ id: m.id, pseudo: m.pseudo || 'Sans pseudo' }))
    .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
}

/* ---------- Rendu ---------- */
function formHtml() {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <form class="agh-form" id="agh-form" novalidate>
      <h3 class="card-title">Nouveau fantôme</h3>
      <div class="agh-form-grid">
        <div class="field"><label for="agh-pseudo">Pseudo</label>
          <input id="agh-pseudo" name="pseudo" required minlength="2" maxlength="32" autocomplete="off" placeholder="Pseudo prévu"></div>
        <div class="field"><label for="agh-joined">Date d'arrivée dans le gang</label>
          <input id="agh-joined" name="joined_on" type="date" max="${today}">
          <span class="small muted">Vide = pas encore renseignée.</span></div>
        <div class="field agh-span"><label for="agh-note">Note privée</label>
          <textarea id="agh-note" name="note" rows="2" maxlength="500" placeholder="Visible seulement par toi"></textarea></div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" type="submit">Créer le fantôme</button></div>
    </form>`;
}

/** Texte d'une correspondance, déjà échappé. */
function reasonHtml(reason) {
  const s = norm(reason);
  const parts = [];
  if (/discord/.test(s)) parts.push('même ID Discord');
  if (/pseudo/.test(s)) parts.push('même pseudo');
  return parts.length ? parts.join(' et ') : esc(reason || 'correspondance');
}

function itemHtml(g) {
  const active = ghostCodeActive(g);
  const link = active ? ghostInviteLink(g.invite_code) : '';
  return `
    <li class="agh-item" data-id="${esc(g.id)}">
      <div class="agh-head">
        ${avatarHtml({ pseudo: g.pseudo, avatar_url: g.avatar_url }, 44)}
        <div class="agh-who">
          <strong class="agh-name">${esc(g.pseudo)} <span class="pill pill-muted">(fantôme)</span></strong>
          <span class="small muted">Arrivée : ${g.joined_on ? esc(fmtDay(g.joined_on)) : 'non renseignée'} · préparé le ${esc(fmtDate(g.created_at))}</span>
        </div>
      </div>
      ${g.ghost_note ? `<p class="agh-note"><span class="agh-k">Note privée</span> ${esc(g.ghost_note)}</p>` : ''}
      <div class="agh-code">
        ${active ? `
          <div class="agh-code-line"><span class="agh-k">Code</span><span class="code agh-code-val">${esc(g.invite_code)}</span>
            <span class="small muted">valable jusqu'au ${esc(fmtDate(g.invite_expires_at))}</span></div>
          <label class="visually-hidden" for="agh-link-${esc(g.id)}">Lien d'inscription de ${esc(g.pseudo)}</label>
          <input id="agh-link-${esc(g.id)}" class="agh-link" readonly value="${esc(link)}">
          <div class="agh-btns">
            <button class="btn btn-ghost btn-sm" type="button" data-agh="copy-code" data-code="${esc(g.invite_code)}">${IC.copy} Copier le code</button>
            <button class="btn btn-ghost btn-sm" type="button" data-agh="copy-link" data-link="${esc(link)}">${IC.link} Copier le lien</button>
          </div>`
          : `<p class="small muted">${g.invite_code ? 'Code expiré.' : 'Aucun code actif.'} Génère-en un pour que la personne puisse s'inscrire.</p>`}
      </div>
      <div class="agh-actions">
        <button class="btn btn-primary btn-sm" type="button" data-agh="invite">${active ? 'Régénérer le code d\'invitation' : 'Générer le code d\'invitation'}</button>
        <button class="btn btn-ghost btn-sm" type="button" data-agh="fiche">Compléter la fiche</button>
        <button class="btn btn-ghost btn-sm" type="button" data-agh="link">${IC.merge} Lier à un compte inscrit</button>
        <button class="btn btn-danger btn-sm" type="button" data-agh="delete">${IC.trash} Supprimer le fantôme</button>
      </div>
      <div class="agh-merge-slot" data-slot="${esc(`item-${g.id}`)}"></div>
    </li>`;
}

function renderSugg() {
  const box = G.root?.querySelector('#agh-sugg');
  if (!box) return;
  const list = box.querySelector('#agh-sugg-list');
  if (G.suggError) {
    box.hidden = false;
    list.innerHTML = `<li class="agh-sugg-err">Impossible de vérifier les correspondances : ${esc(errMsg(G.suggError))}</li>`;
    return;
  }
  box.hidden = !G.sugg.length;
  list.innerHTML = G.sugg.map((s) => `
    <li class="agh-sugg-item">
      <p class="agh-sugg-text">Le compte inscrit <strong>${esc(s.user_pseudo || 'Sans pseudo')}</strong> ressemble au fantôme <strong>${esc(s.ghost_pseudo)}</strong> — ${reasonHtml(s.reason)}.</p>
      <div class="agh-sugg-row">
        <button class="btn btn-primary btn-sm" type="button" data-agh="sugg-link"
          data-ghost="${esc(s.ghost_id)}" data-user="${esc(s.user_id)}" data-pseudo="${esc(s.user_pseudo || '')}"
          aria-label="Lier le compte ${esc(s.user_pseudo || '')} au fantôme ${esc(s.ghost_pseudo)}">Lier</button>
      </div>
      <div class="agh-merge-slot" data-slot="${esc(`sugg-${s.ghost_id}-${s.user_id}`)}"></div>
    </li>`).join('');
}

function renderList() {
  const box = G.root?.querySelector('#agh-list');
  if (!box) return;
  const count = G.root.querySelector('#agh-count');
  if (G.error) { box.innerHTML = `<div class="empty">Impossible de charger les fantômes : ${esc(errMsg(G.error))}</div>`; if (count) count.textContent = ''; return; }
  if (count) count.textContent = `${G.list.length} fantôme${G.list.length > 1 ? 's' : ''}`;
  box.innerHTML = G.list.length
    ? G.list.map(itemHtml).join('')
    : '<div class="empty">Aucun fantôme pour l\'instant.</div>';
}

function renderLists() {
  if (!G.root) return;
  // Une liaison dont le fantôme a disparu n'a plus de sens.
  if (G.merge && !G.error && !G.list.some((g) => g.id === G.merge.ghostId)) G.merge = null;
  renderSugg();
  renderList();
  paintMerge();
}

/* ---------- Panneau de liaison (dans la fiche du fantôme ou sous la correspondance) ---------- */
function mergeHtml(ghostPseudo) {
  return `
    <div class="agh-merge" data-merge>
      <p class="agh-merge-title">Lier « ${esc(ghostPseudo)} » à un compte inscrit</p>
      <div class="field"><label for="agh-merge-q">Chercher un membre</label>
        <input id="agh-merge-q" type="search" autocomplete="off" placeholder="Pseudo du membre"></div>
      <div class="field"><label for="agh-merge-sel">Compte inscrit</label>
        <select id="agh-merge-sel"></select></div>
      <div class="agh-merge-recap" id="agh-merge-recap" aria-live="polite"></div>
      <p class="agh-merge-err" id="agh-merge-err" role="alert" hidden></p>
      <div class="agh-merge-btns">
        <button class="btn btn-ghost" type="button" data-agh="merge-cancel">Annuler</button>
        <button class="btn btn-danger" type="button" data-agh="merge-confirm" disabled>Lier et supprimer le fantôme</button>
      </div>
    </div>`;
}

/** Remplit la liste des comptes inscrits selon la recherche et la sélection courantes. */
function fillSelect() {
  const m = G.merge; const sel = G.root?.querySelector('#agh-merge-sel');
  if (!m || !sel) return;
  const q = norm(G.root.querySelector('#agh-merge-q')?.value);
  const all = m.members ?? [];
  const hits = all.filter((x) => !q || norm(x.pseudo).includes(q));
  // Le membre déjà choisi reste dans la liste, même si la recherche ne le retient pas.
  const shown = m.memberId && !hits.some((x) => x.id === m.memberId) ? [...hits, ...all.filter((x) => x.id === m.memberId)] : hits;
  const placeholder = m.loading ? 'Chargement…' : all.length ? '— Choisir un membre —' : 'Aucun compte inscrit';
  sel.innerHTML = `<option value="">${esc(placeholder)}</option>`
    + (q && all.length && !hits.length ? '<option value="" disabled>Aucun membre ne correspond</option>' : '')
    + shown.map((x) => `<option value="${esc(x.id)}">${esc(x.pseudo)}</option>`).join('');
  sel.value = m.memberId ?? '';
}

/** Met à jour le récapitulatif, l'état des boutons et l'erreur, sans reconstruire la liste. */
function syncMerge() {
  const m = G.merge; if (!m || !G.root) return;
  const wrap = G.root.querySelector('[data-merge]'); if (!wrap) return;
  const ghost = G.list.find((g) => g.id === m.ghostId);
  const member = (m.members ?? []).find((x) => x.id === m.memberId)
    ?? (m.memberId && m.memberPseudo ? { id: m.memberId, pseudo: m.memberPseudo } : null);
  const recap = wrap.querySelector('#agh-merge-recap');
  const ok = wrap.querySelector('[data-agh="merge-confirm"]');
  const err = wrap.querySelector('#agh-merge-err');
  if (m.loading) recap.innerHTML = '<p class="small muted">Chargement des comptes inscrits…</p>';
  else if (!member) recap.innerHTML = '<p class="small muted">Choisis le compte inscrit qui reprendra ce fantôme.</p>';
  else recap.innerHTML = `
    <p>Les badges, présences, cartes et infos de <strong>${esc(ghost?.pseudo ?? '')}</strong> passeront sur le compte de <strong>${esc(member.pseudo)}</strong>. Le fantôme sera supprimé. <strong>Action irréversible.</strong></p>
    <p class="small muted">Les champs vides du compte (date d'arrivée, anniversaire, ID Discord, avatar) seront complétés avec ceux du fantôme.</p>`;
  ok.disabled = m.busy || !member;
  ok.textContent = m.busy ? 'Liaison en cours…' : 'Lier et supprimer le fantôme';
  err.hidden = !m.error;
  err.textContent = m.error ? m.error : '';
  wrap.querySelector('#agh-merge-sel').disabled = m.busy || m.loading || !(m.members ?? []).length;
  wrap.querySelector('#agh-merge-q').disabled = m.busy;
  wrap.querySelector('[data-agh="merge-cancel"]').disabled = m.busy;
}

/** Place le panneau dans l'emplacement de la liaison en cours (et nulle part ailleurs). */
function paintMerge() {
  if (!G.root) return;
  G.root.querySelectorAll('[data-merge]').forEach((n) => n.remove());
  const m = G.merge; if (!m) return;
  const ghost = G.list.find((g) => g.id === m.ghostId);
  const slot = G.root.querySelector(`[data-slot="${CSS.escape(m.slot)}"]`);
  if (!ghost || !slot) { G.merge = null; return; }
  slot.innerHTML = mergeHtml(ghost.pseudo);
  fillSelect();
  syncMerge();
}

/** Ouvre le panneau de liaison, puis charge la liste des comptes inscrits. */
async function openMerge(ghostId, slot, pre = {}) {
  G.merge = { ghostId, slot, memberId: pre.id ?? null, memberPseudo: pre.pseudo ?? null, members: null, loading: true, error: null, busy: false };
  paintMerge();
  const panel = G.root?.querySelector('[data-merge]');
  panel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  let members = null; let error = null;
  try { members = await loadMembers(); } catch (e) { error = errMsg(e); console.warn('[fantômes]', e); }
  const m = G.merge;
  if (!m || m.ghostId !== ghostId || m.slot !== slot) return; // fermé ou remplacé entre-temps
  m.members = members; m.loading = false; m.error = error;
  fillSelect(); syncMerge();
  G.root.querySelector('#agh-merge-q')?.focus({ preventScroll: true });
}

/** Lance hg_ghost_merge après le récapitulatif affiché. */
async function confirmMerge() {
  const m = G.merge;
  if (!m || !m.memberId || m.busy) return;
  const ghost = G.list.find((g) => g.id === m.ghostId);
  const member = (m.members ?? []).find((x) => x.id === m.memberId) ?? { pseudo: m.memberPseudo || 'ce compte' };
  m.busy = true; m.error = null; syncMerge();
  try {
    const res = check(await sb.rpc('hg_ghost_merge', { p_ghost: m.ghostId, p_user: m.memberId }));
    const row = Array.isArray(res) ? res[0] : res;
    const moved = Number(typeof row === 'object' && row !== null ? row.moved : row) || 0;
    G.merge = null;
    toast(`« ${ghost?.pseudo ?? 'Fantôme'} » lié à « ${member.pseudo} » : ${moved} élément${moved > 1 ? 's' : ''} transféré${moved > 1 ? 's' : ''}`, 'ok');
    await refreshGhostsSection();
    try { await G.onChange(); } catch (e) { console.warn('[fantômes] resynchronisation', e); }
  } catch (e) {
    if (G.merge === m) { m.busy = false; m.error = errMsg(e); syncMerge(); }
  }
}

function renderInitialShell(root) {
  root.innerHTML = `
    <section class="card agh-card agh-sugg" id="agh-sugg" aria-labelledby="agh-sugg-t" hidden>
      <div class="agh-list-head"><h3 class="card-title" id="agh-sugg-t">Correspondances possibles</h3></div>
      <p class="small muted">Ces comptes inscrits ressemblent à un fantôme (même ID Discord ou même pseudo). Lie-les pour tout transférer.</p>
      <ul class="agh-sugg-list" id="agh-sugg-list"></ul>
    </section>
    <div class="card agh-card">
      <p class="agh-lead">Prépare un profil avant l'inscription. Invisible pour les membres. La personne le récupère en s'inscrivant avec son code nominatif, ou avec n'importe quel lien si elle choisit exactement le même pseudo. Tu peux aussi le lier plus tard à un compte déjà inscrit.</p>
      ${formHtml()}
    </div>
    <div class="card agh-card">
      <div class="agh-list-head">
        <h3 class="card-title">Fantômes en attente</h3>
        <p class="small muted" id="agh-count" aria-live="polite"></p>
      </div>
      <ul class="agh-list" id="agh-list"><li class="empty">Chargement…</li></ul>
    </div>`;
}

/* ---------- Actions ---------- */
async function createGhost(form, btn) {
  const pseudo = form.pseudo.value.trim();
  if (pseudo.length < 2 || pseudo.length > 32) throw new Error('Le pseudo doit faire entre 2 et 32 caractères.');
  const joined = form.joined_on.value || null;
  if (joined && joined > new Date().toISOString().slice(0, 10)) throw new Error('La date d\'arrivée ne peut pas être dans le futur.');
  const note = form.note.value.trim() || null;
  check(await sb.rpc('hg_ghost_create', { p_pseudo: pseudo, p_joined_on: joined, p_note: note }));
  form.reset();
  toast(`Fantôme « ${pseudo} » créé`, 'ok');
  await refreshGhostsSection();
  await G.onChange();
  $('#agh-pseudo', G.root)?.focus();
}

async function invite(g, btn) {
  if (ghostCodeActive(g) && !(await confirmBox('Régénérer le code ?',
    `L'ancien code (${g.invite_code}) ne fonctionnera plus. Un seul code est valable par fantôme.`, { ok: 'Régénérer' }))) return;
  await busy(btn, async () => {
    const res = check(await sb.rpc('hg_ghost_invite', { p_ghost: g.id }));
    const code = typeof res === 'string' ? res : res?.code;
    toast(code ? `Code ${code} généré (valable 60 jours)` : 'Code généré', 'ok');
    await refreshGhostsSection();
  });
}

async function removeGhost(g, btn) {
  if (!(await confirmBox('Supprimer ce fantôme ?',
    `La fiche de « ${g.pseudo} » sera supprimée définitivement. Son code d'invitation ne fonctionnera plus.`, { ok: 'Supprimer', danger: true }))) return;
  await busy(btn, async () => {
    const rows = check(await sb.from('hg_profiles').delete().eq('id', g.id).eq('is_ghost', true).select('id'));
    // Sans policy DELETE sur hg_profiles, Supabase n'échoue pas : il supprime 0 ligne. On le signale.
    if (!rows?.length) throw new Error('Suppression refusée par la base : aucune règle DELETE sur hg_profiles pour l\'admin.');
    toast('Fantôme supprimé', 'ok');
    await refreshGhostsSection();
    await G.onChange();
  });
}

/* ---------- Montage ---------- */
/**
 * Monte la section « Comptes fantômes ». openFiche(id) ouvre la fiche (admin-accounts.js) ;
 * onChange() resynchronise les autres sections (liste des comptes, sélecteurs de membres).
 */
export function mountGhostsSection(root, { openFiche, onChange } = {}) {
  G.root = root; G.openFiche = openFiche || null; G.onChange = onChange || (async () => {});
  renderInitialShell(root);

  root.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'agh-form') return;
    ev.preventDefault();
    const btn = ev.submitter;
    busy(btn, () => createGhost(ev.target, btn));
  });
  root.addEventListener('input', (ev) => {
    if (ev.target.id === 'agh-merge-q') { fillSelect(); syncMerge(); }
  });
  root.addEventListener('change', (ev) => {
    if (ev.target.id !== 'agh-merge-sel' || !G.merge) return;
    G.merge.memberId = ev.target.value || null;
    G.merge.memberPseudo = null;
    G.merge.error = null;
    syncMerge();
  });
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-agh]');
    if (!b) return;
    const act = b.dataset.agh;
    if (act === 'copy-code') return copyText(b.dataset.code, 'Code copié');
    if (act === 'copy-link') return copyText(b.dataset.link, 'Lien copié');
    if (act === 'merge-cancel') { G.merge = null; return paintMerge(); }
    if (act === 'merge-confirm') return confirmMerge();
    if (act === 'sugg-link') {
      return openMerge(b.dataset.ghost, `sugg-${b.dataset.ghost}-${b.dataset.user}`, { id: b.dataset.user, pseudo: b.dataset.pseudo });
    }
    const item = b.closest('[data-id]');
    const g = G.list.find((x) => x.id === item?.dataset.id);
    if (!g) return;
    if (act === 'link') return openMerge(g.id, `item-${g.id}`);
    if (act === 'fiche') return G.openFiche?.(g.id);
    if (act === 'invite') return invite(g, b);
    if (act === 'delete') return removeGhost(g, b);
  });
}

/** Recharge les fantômes et les correspondances, puis réaffiche la section. */
export async function refreshGhostsSection() {
  const [list, sugg] = await Promise.allSettled([fetchAdminGhosts(), fetchSuggestions()]);
  if (list.status === 'fulfilled') { G.list = list.value; G.error = null; }
  else { G.error = list.reason; }
  if (sugg.status === 'fulfilled') { G.sugg = sugg.value; G.suggError = null; }
  else { G.sugg = []; G.suggError = sugg.reason; console.warn('[fantômes] correspondances', sugg.reason); }
  renderLists();
}
