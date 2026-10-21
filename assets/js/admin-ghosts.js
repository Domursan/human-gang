// ===== Humane Gang — administration : comptes fantômes =====
// Un fantôme = ligne de hg_profiles avec is_ghost = true, préparée par l'admin avant l'inscription de la personne.
// Invisible pour les membres. Les fantômes sont gérés dans « Comptes » (admin-accounts/) :
//   - données et actions : chargement, création, code d'invitation, suppression, liaison (hg_ghost_merge) ;
//   - fiche d'un fantôme dans la zone principale (renderGhostView), avec le bloc « Lier à un compte inscrit » ;
//   - bannière « Ce compte correspond peut-être au fantôme X » (ghostBannerHtml) et actions de zone (ghostZoneActions) ;
//   - tiroirs : création (openNewGhostDrawer) et liaison depuis une fiche de compte (openMergeDrawer).
// Les écouteurs de la zone sont posés une fois (bindGhostPanel). Les effets de bord vers Comptes passent par setGhostHooks.
// Importé par admin-accounts/ (liste, fiche, événements), irl.js et historique.js (annuaire vu par l'admin).
import { sb, toast, errMsg, esc, fmtDate } from './core.js';
import { confirmBox } from './ui-confirm.js';
import { svg } from './icons.js';
import { fmtDay } from './utils.js';
import { openDrawer } from './admin/ui/drawer.js';
import { renderDetailHeader } from './admin/ui/detail-header.js';

const IC = {
  copy: svg('copy', { stroke: 2 }),
  link: svg('link', { stroke: 2 }),
};

const G = {
  list: [], error: null, loaded: false, // fantômes (hg_admin_ghosts)
  sugg: [], suggError: null,            // correspondances fantôme ↔ compte inscrit (hg_ghost_suggestions)
  root: null,                           // zone principale de Comptes, quand elle affiche un fantôme
  shown: null,                          // id du fantôme affiché dans la zone
  merge: null,                          // liaison en cours dans la zone : { ghostId, memberId, memberPseudo, q, busy, error }
  // Liens vers Comptes, fournis par setGhostHooks (évite un import circulaire)
  hooks: {
    members: () => [],                  // comptes actifs : [{ id, pseudo }]
    refreshed: async () => {},          // après un changement de données (liste des comptes à resynchroniser)
    merged: async () => {},             // après une liaison (ghostId, memberId)
    removed: async () => {},            // après une suppression (ghostId)
    openFiche: () => {},                // « Compléter la fiche » (ghostId)
  },
};

export function setGhostHooks(hooks) { Object.assign(G.hooks, hooks); }

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

/**
 * Recharge fantômes et correspondances, puis réaffiche la fiche du fantôme si elle est à l'écran.
 * notify : prévient Comptes (liste, bannière) après une modification.
 */
export async function refreshGhosts({ notify = false } = {}) {
  const [list, sugg] = await Promise.allSettled([fetchAdminGhosts(), fetchSuggestions()]);
  if (list.status === 'fulfilled') { G.list = list.value; G.error = null; }
  else { G.error = list.reason; console.warn('[fantômes]', list.reason); }
  if (sugg.status === 'fulfilled') { G.sugg = sugg.value; G.suggError = null; }
  else { G.sugg = []; G.suggError = sugg.reason; console.warn('[fantômes] correspondances', sugg.reason); }
  G.loaded = true;
  repaintShown();
  if (notify) await G.hooks.refreshed();
}
/** Premier chargement (à l'ouverture de Comptes) : sans effet si déjà fait. */
export function ensureGhosts() {
  return G.loaded ? Promise.resolve() : refreshGhosts();
}

/* ---------- Rendu : fiche d'un fantôme ---------- */
/** Texte d'une correspondance, déjà échappé. */
function reasonHtml(reason) {
  const s = norm(reason);
  const parts = [];
  if (/discord/.test(s)) parts.push('même ID Discord');
  if (/pseudo/.test(s)) parts.push('même pseudo');
  return parts.length ? parts.join(' et ') : esc(reason || 'correspondance');
}
const suggFor = (ghostId) => G.sugg.filter((s) => s.ghost_id === ghostId);

/** Formulaire de création (contenu du tiroir ; les champs sont lus par createGhost). */
function formHtml() {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <p class="agh-lead">Invisible pour les membres. La personne le récupère en s'inscrivant avec son code nominatif, ou avec n'importe quel lien si elle choisit exactement le même pseudo. Tu peux aussi le lier plus tard à un compte déjà inscrit.</p>
    <div class="agh-form-grid">
      <div class="field"><label for="agh-pseudo">Pseudo</label>
        <input id="agh-pseudo" name="pseudo" required minlength="2" maxlength="32" autocomplete="off" placeholder="Pseudo prévu"></div>
      <div class="field"><label for="agh-joined">Date d'arrivée dans le gang</label>
        <input id="agh-joined" name="joined_on" type="date" max="${today}">
        <span class="small muted">Vide = pas encore renseignée.</span></div>
      <div class="field agh-span"><label for="agh-note">Note privée</label>
        <textarea id="agh-note" name="note" rows="2" maxlength="500" placeholder="Visible seulement par toi"></textarea></div>
    </div>`;
}

/** Corps de la fiche d'un fantôme : note privée, code d'invitation. */
function ghostBodyHtml(g) {
  const active = ghostCodeActive(g);
  const link = active ? ghostInviteLink(g.invite_code) : '';
  return `
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
      <div class="agh-actions">
        <button class="btn btn-primary btn-sm" type="button" data-agh="invite">${active ? 'Régénérer le code d\'invitation' : 'Générer le code d\'invitation'}</button>
      </div>
    </div>`;
}

/** Bloc « Lier à un compte inscrit » : correspondances en tête, puis recherche, sélection, récapitulatif et confirmation. */
function linkBlockHtml(g) {
  const sugg = suggFor(g.id);
  const suggHtml = G.suggError
    ? `<p class="agh-sugg-err">Impossible de vérifier les correspondances : ${esc(errMsg(G.suggError))}</p>`
    : sugg.length ? `<div class="agh-lier-sugg"><p class="agh-k">Correspondances</p>
        <ul class="agh-sugg-list">${sugg.map((s) => `
          <li class="agh-sugg-item">
            <p class="agh-sugg-text"><strong>${esc(s.user_pseudo || 'Sans pseudo')}</strong> : ${reasonHtml(s.reason)}.</p>
            <div class="agh-sugg-row"><button class="btn btn-ghost btn-sm" type="button" data-agh="pick" data-user="${esc(s.user_id)}" data-pseudo="${esc(s.user_pseudo || '')}"
              aria-label="Choisir le compte ${esc(s.user_pseudo || '')}">Choisir ce compte</button></div>
          </li>`).join('')}</ul></div>` : '';
  return `
    <section class="card agh-card agh-lier" id="agh-lier" aria-labelledby="agh-lier-t">
      <h3 class="card-title" id="agh-lier-t">Lier à un compte inscrit</h3>
      <p class="small muted">Si la personne a déjà un compte, transfère ici l'historique de ${esc(g.pseudo)} (badges, présences, cartes, infos) : le fantôme est supprimé ensuite.</p>
      ${suggHtml}
      <div class="agh-lier-pick">
        <div class="field"><label for="agh-merge-q">Chercher un compte</label>
          <input id="agh-merge-q" type="search" autocomplete="off" placeholder="Pseudo du membre" value="${esc(G.merge?.q ?? '')}"></div>
        <div class="field"><label for="agh-merge-sel">Compte inscrit</label><select id="agh-merge-sel"></select></div>
      </div>
      <div class="agh-merge-recap" id="agh-merge-recap" aria-live="polite"></div>
      <p class="agh-merge-err" id="agh-merge-err" role="alert" hidden></p>
      <div class="agh-merge-btns"><button class="btn btn-danger" type="button" data-agh="merge-confirm" disabled>Lier et supprimer le fantôme</button></div>
    </section>`;
}

/** Liste des comptes actifs : correspondances du fantôme en tête (groupe à part), filtrée par la recherche. */
function fillSelect() {
  const m = G.merge; const sel = G.root?.querySelector('#agh-merge-sel');
  if (!m || !sel) return;
  const q = norm(m.q);
  const all = G.hooks.members();
  const suggIds = new Set(suggFor(m.ghostId).map((s) => s.user_id));
  const hits = all.filter((x) => !q || norm(x.pseudo).includes(q));
  const top = hits.filter((x) => suggIds.has(x.id));
  const rest = hits.filter((x) => !suggIds.has(x.id));
  const cur = m.memberId && !hits.some((x) => x.id === m.memberId) ? all.find((x) => x.id === m.memberId) : null;
  const opt = (x) => `<option value="${esc(x.id)}">${esc(x.pseudo)}</option>`;
  sel.innerHTML = `<option value="">${esc(all.length ? '— Choisir un compte —' : 'Aucun compte inscrit')}</option>`
    + (top.length ? `<optgroup label="Correspondances">${top.map(opt).join('')}</optgroup>` : '')
    + (rest.length ? `<optgroup label="Autres comptes">${rest.map(opt).join('')}</optgroup>` : '')
    + (cur ? `<optgroup label="Sélection">${opt(cur)}</optgroup>` : '')
    + (q && all.length && !hits.length ? '<option value="" disabled>Aucun compte ne correspond</option>' : '');
  sel.value = m.memberId ?? '';
}

/** Récapitulatif, état du bouton et erreur de la liaison, sans reconstruire le bloc. */
function syncMerge() {
  const m = G.merge; const wrap = G.root?.querySelector('#agh-lier'); if (!m || !wrap) return;
  const ghost = G.list.find((g) => g.id === m.ghostId);
  const member = m.memberId ? (G.hooks.members().find((x) => x.id === m.memberId) ?? (m.memberPseudo ? { id: m.memberId, pseudo: m.memberPseudo } : null)) : null;
  const recap = wrap.querySelector('#agh-merge-recap');
  const ok = wrap.querySelector('[data-agh="merge-confirm"]');
  const err = wrap.querySelector('#agh-merge-err');
  recap.innerHTML = !member ? '<p class="small muted">Choisis le compte inscrit qui reprendra ce fantôme.</p>'
    : `<p>Les badges, présences, cartes et infos de <strong>${esc(ghost?.pseudo ?? '')}</strong> passeront sur le compte de <strong>${esc(member.pseudo)}</strong>. Le fantôme sera supprimé. <strong>Action irréversible.</strong></p>
      <p class="small muted">Les champs vides du compte (date d'arrivée, anniversaire, ID Discord, avatar) seront complétés avec ceux du fantôme.</p>`;
  ok.disabled = m.busy || !member;
  ok.textContent = m.busy ? 'Liaison en cours…' : 'Lier et supprimer le fantôme';
  err.hidden = !m.error;
  err.textContent = m.error || '';
  wrap.querySelector('#agh-merge-sel').disabled = m.busy;
  wrap.querySelector('#agh-merge-q').disabled = m.busy;
}

function ensureMerge(ghostId) {
  if (!G.merge || G.merge.ghostId !== ghostId) G.merge = { ghostId, memberId: null, memberPseudo: null, q: '', busy: false, error: null };
  return G.merge;
}

/**
 * Affiche la fiche d'un fantôme dans la zone (root = #acc-root) : en-tête, code d'invitation, bloc de liaison.
 * Remplace le contenu de la zone : la fiche d'un compte, s'il y en avait une, n'est plus à l'écran.
 */
export function renderGhostView(root, id) {
  G.root = root; G.shown = id;
  ensureMerge(id);
  const g = G.list.find((x) => x.id === id);
  if (!g) {
    root.innerHTML = G.error ? `<div class="empty">Impossible de charger les fantômes : ${esc(errMsg(G.error))}</div>`
      : G.loaded ? '<div class="empty">Ce fantôme n’existe plus.</div>' : '<div class="empty">Chargement…</div>';
    return;
  }
  root.innerHTML = `<div id="agh-dh"></div>
    <div class="card agh-card agh-detail">${ghostBodyHtml(g)}</div>
    ${linkBlockHtml(g)}`;
  renderDetailHeader(root.querySelector('#agh-dh'), {
    member: { pseudo: g.pseudo, avatar_url: g.avatar_url },
    title: `${g.pseudo} (fantôme)`,
    subtitle: `Pas encore inscrit · ${g.joined_on ? `arrivée ${fmtDay(g.joined_on)}` : 'arrivée non renseignée'} · préparé le ${fmtDate(g.created_at)}`,
    actions: [
      { label: 'Compléter la fiche', onClick: () => G.hooks.openFiche(g.id) },
      { label: 'Supprimer', onClick: () => removeGhost(g) },
    ],
  });
  fillSelect();
  syncMerge();
}

/** Réaffiche la fiche du fantôme si elle est à l'écran (après un rechargement). */
function repaintShown() {
  if (!G.root || !G.shown || !G.root.querySelector('#agh-dh')) return;
  renderGhostView(G.root, G.shown);
}

/** Bannière d'un compte actif : fantômes qui lui ressemblent (vide s'il n'y en a pas). */
export function ghostBannerHtml(uid) {
  const rows = G.sugg.filter((s) => s.user_id === uid && G.list.some((g) => g.id === s.ghost_id));
  return rows.map((s) => `
    <section class="card agh-card agh-banner" aria-label="Fantôme correspondant">
      <div class="agh-banner-row">
        <p>Ce compte correspond peut-être au fantôme <strong>${esc(s.ghost_pseudo)}</strong> : ${reasonHtml(s.reason)}.</p>
        <button class="btn btn-primary btn-sm" type="button" data-agh="sugg-link" data-ghost="${esc(s.ghost_id)}" data-user="${esc(uid)}"
          aria-label="Lier le compte au fantôme ${esc(s.ghost_pseudo)}">Lier</button>
      </div>
    </section>`).join('');
}

/** Actions de la zone principale de Comptes : « Lier un fantôme… » pour un compte actif, « + Nouveau fantôme ». */
export function ghostZoneActions(uid = null) {
  const make = (label, cls, onClick) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `btn ${cls} btn-sm`; b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };
  const out = [];
  if (uid) out.push(make('Lier un fantôme…', 'btn-ghost', () => openMergeDrawer({ userId: uid })));
  out.push(make('+ Nouveau fantôme', 'btn-primary', () => openNewGhostDrawer()));
  return out;
}

/* ---------- Tiroirs ---------- */
/** Tiroir de création d'un fantôme. */
export function openNewGhostDrawer() {
  openDrawer({
    title: 'Nouveau fantôme', subtitle: 'Prépare un profil avant l’inscription',
    body: formHtml(), submitLabel: 'Créer le fantôme',
    onSubmit: (form) => createGhost(form),
  });
}

/**
 * Tiroir de liaison. ghostId et/ou userId fixent le fantôme et/ou le compte ; le reste se choisit dans le tiroir.
 * Le récapitulatif s'affiche dès que les deux sont connus ; la confirmation lance hg_ghost_merge.
 */
export function openMergeDrawer({ ghostId = null, userId = null } = {}) {
  const members = G.hooks.members();
  const fixedGhost = ghostId ? G.list.find((g) => g.id === ghostId) : null;
  const fixedMember = userId ? members.find((m) => m.id === userId) : null;
  if (ghostId && !fixedGhost) { toast('Ce fantôme n’existe plus.', 'error'); return; }
  if (userId && !fixedMember) { toast('Compte introuvable.', 'error'); return; }
  if (!fixedGhost && !G.list.length) { toast('Aucun fantôme à lier.', 'error'); return; }
  const body = document.createElement('div');
  body.className = 'agh-drawer';
  body.innerHTML = `
    ${fixedGhost ? '' : `<div class="field"><label for="agh-d-ghost">Fantôme</label>
      <select id="agh-d-ghost" name="ghost"><option value="">— Choisir un fantôme —</option>${G.list.map((g) => `<option value="${esc(g.id)}">${esc(g.pseudo)}</option>`).join('')}</select></div>`}
    ${fixedMember ? '' : `<div class="field"><label for="agh-d-member">Compte inscrit</label>
      <select id="agh-d-member" name="member"><option value="">— Choisir un compte —</option>${members.map((m) => `<option value="${esc(m.id)}">${esc(m.pseudo)}</option>`).join('')}</select></div>`}
    <div class="agh-merge-recap" aria-live="polite"></div>`;
  const d = openDrawer({
    title: 'Lier à un compte inscrit',
    subtitle: fixedGhost ? `Fantôme : ${fixedGhost.pseudo}` : fixedMember ? `Compte : ${fixedMember.pseudo}` : 'Transfère l’historique d’un fantôme',
    body, submitLabel: 'Lier et supprimer le fantôme',
    onSubmit: async (form) => {
      const gid = fixedGhost?.id ?? form.querySelector('[name="ghost"]')?.value;
      const mid = fixedMember?.id ?? form.querySelector('[name="member"]')?.value;
      if (!gid || !mid) throw new Error('Choisis le fantôme et le compte inscrit.');
      await doMerge(gid, mid);
      return true;
    },
  });
  const sync = () => {
    const gid = fixedGhost?.id ?? d.form.querySelector('[name="ghost"]')?.value;
    const mid = fixedMember?.id ?? d.form.querySelector('[name="member"]')?.value;
    const g = G.list.find((x) => x.id === gid);
    const m = members.find((x) => x.id === mid);
    d.body.querySelector('.agh-merge-recap').innerHTML = g && m
      ? `<p>Les badges, présences, cartes et infos de <strong>${esc(g.pseudo)}</strong> passeront sur le compte de <strong>${esc(m.pseudo)}</strong>. Le fantôme sera supprimé. <strong>Action irréversible.</strong></p>`
      : '<p class="small muted">Choisis le fantôme et le compte à relier.</p>';
    d.form.querySelector('[data-drawer-submit]').disabled = !(g && m);
  };
  d.form.addEventListener('change', sync);
  sync();
}

/* ---------- Actions ---------- */
async function createGhost(form) {
  const field = (n) => form.querySelector(`[name="${n}"]`);
  const pseudo = field('pseudo').value.trim();
  if (pseudo.length < 2 || pseudo.length > 32) throw new Error('Le pseudo doit faire entre 2 et 32 caractères.');
  const joined = field('joined_on').value || null;
  if (joined && joined > new Date().toISOString().slice(0, 10)) throw new Error('La date d\'arrivée ne peut pas être dans le futur.');
  const note = field('note').value.trim() || null;
  check(await sb.rpc('hg_ghost_create', { p_pseudo: pseudo, p_joined_on: joined, p_note: note }));
  toast(`Fantôme « ${pseudo} » créé`, 'ok');
  await refreshGhosts({ notify: true });
  return true;
}

async function invite(g, btn) {
  if (ghostCodeActive(g) && !(await confirmBox('Régénérer le code ?',
    `L'ancien code (${g.invite_code}) ne fonctionnera plus. Un seul code est valable par fantôme.`, { ok: 'Régénérer' }))) return;
  await busy(btn, async () => {
    const res = check(await sb.rpc('hg_ghost_invite', { p_ghost: g.id }));
    const code = typeof res === 'string' ? res : res?.code;
    toast(code ? `Code ${code} généré (valable 60 jours)` : 'Code généré', 'ok');
    await refreshGhosts();
  });
}

async function removeGhost(g) {
  if (!(await confirmBox('Supprimer ce fantôme ?',
    `La fiche de « ${g.pseudo} » sera supprimée définitivement. Son code d'invitation ne fonctionnera plus.`, { ok: 'Supprimer', danger: true }))) return;
  try {
    const rows = check(await sb.from('hg_profiles').delete().eq('id', g.id).eq('is_ghost', true).select('id'));
    // Sans policy DELETE sur hg_profiles, Supabase n'échoue pas : il supprime 0 ligne. On le signale.
    if (!rows?.length) throw new Error('Suppression refusée par la base : aucune règle DELETE sur hg_profiles pour l\'admin.');
  } catch (e) { toast(errMsg(e), 'error'); return; }
  toast('Fantôme supprimé', 'ok');
  await refreshGhosts({ notify: true });
  await G.hooks.removed(g.id);
}

/** Transfère le fantôme sur le compte inscrit (hg_ghost_merge), puis resynchronise Comptes. Lève une erreur en cas d'échec. */
async function doMerge(ghostId, memberId) {
  const ghost = G.list.find((g) => g.id === ghostId);
  const member = G.hooks.members().find((m) => m.id === memberId) ?? { pseudo: 'ce compte' };
  const res = check(await sb.rpc('hg_ghost_merge', { p_ghost: ghostId, p_user: memberId }));
  const row = Array.isArray(res) ? res[0] : res;
  const moved = Number(typeof row === 'object' && row !== null ? row.moved : row) || 0;
  if (G.merge?.ghostId === ghostId) G.merge = null;
  toast(`« ${ghost?.pseudo ?? 'Fantôme'} » lié à « ${member.pseudo} » : ${moved} élément${moved > 1 ? 's' : ''} transféré${moved > 1 ? 's' : ''}`, 'ok');
  await refreshGhosts({ notify: true });
  await G.hooks.merged(ghostId, memberId);
}

/** Confirmation du bloc de liaison (zone principale). */
async function confirmInline() {
  const m = G.merge;
  if (!m || !m.memberId || m.busy) return;
  m.busy = true; m.error = null; syncMerge();
  try { await doMerge(m.ghostId, m.memberId); }
  catch (e) { if (G.merge === m) { m.busy = false; m.error = errMsg(e); syncMerge(); } else toast(errMsg(e), 'error'); }
}

/** Choix d'un compte dans les correspondances du bloc. */
function pickMember(userId, pseudo) {
  const m = G.merge; if (!m) return;
  m.memberId = userId; m.memberPseudo = pseudo || null; m.error = null;
  fillSelect(); syncMerge();
}

/* ---------- Écouteurs de la zone (posés une fois sur #acc-root) ---------- */
const bound = new WeakSet();
export function bindGhostPanel(root) {
  if (!root || bound.has(root)) return;
  bound.add(root);
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-agh]');
    if (!b) return;
    const act = b.dataset.agh;
    if (act === 'copy-code') return copyText(b.dataset.code, 'Code copié');
    if (act === 'copy-link') return copyText(b.dataset.link, 'Lien copié');
    if (act === 'invite') { const g = G.list.find((x) => x.id === G.shown); if (g) invite(g, b); return; }
    if (act === 'merge-confirm') return confirmInline();
    if (act === 'pick') return pickMember(b.dataset.user, b.dataset.pseudo);
    if (act === 'sugg-link') return openMergeDrawer({ ghostId: b.dataset.ghost, userId: b.dataset.user });
  });
  root.addEventListener('input', (ev) => {
    if (ev.target.id !== 'agh-merge-q' || !G.merge) return;
    G.merge.q = ev.target.value;
    fillSelect();
  });
  root.addEventListener('change', (ev) => {
    if (ev.target.id !== 'agh-merge-sel' || !G.merge) return;
    G.merge.memberId = ev.target.value || null;
    G.merge.memberPseudo = null;
    G.merge.error = null;
    syncMerge();
  });
}
