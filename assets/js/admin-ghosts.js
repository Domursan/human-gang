// ===== Humane Gang — administration : comptes fantômes =====
// Un fantôme = ligne de hg_profiles avec is_ghost = true, préparée par l'admin avant l'inscription de la personne.
// Invisible pour les membres. Importé par admin.js (section « Comptes fantômes »), admin-accounts.js (liste des comptes),
// irl.js et historique.js (annuaire vu par l'admin). Ne dépend que de core.js (pas d'import circulaire).
import { sb, toast, errMsg, esc, $, fmtDate, avatarHtml } from './core.js';

const IC = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
};

const G = { root: null, openFiche: null, onChange: async () => {}, list: [], error: null };

function check(res) { if (res.error) throw res.error; return res.data; }
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return undefined; } finally { if (btn?.isConnected) btn.disabled = false; }
}
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
        <button class="btn btn-danger btn-sm" type="button" data-agh="delete">${IC.trash} Supprimer le fantôme</button>
      </div>
    </li>`;
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
  root.innerHTML = `
    <div class="card agh-card">
      <p class="agh-lead">Prépare un profil avant l'inscription. Invisible pour les membres. À l'inscription avec son code, la personne récupère tout.</p>
      ${formHtml()}
    </div>
    <div class="card agh-card">
      <div class="agh-list-head">
        <h3 class="card-title">Fantômes en attente</h3>
        <p class="small muted" id="agh-count" aria-live="polite"></p>
      </div>
      <ul class="agh-list" id="agh-list"><li class="empty">Chargement…</li></ul>
    </div>`;

  root.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'agh-form') return;
    ev.preventDefault();
    const btn = ev.submitter;
    busy(btn, () => createGhost(ev.target, btn));
  });
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-agh]');
    if (!b) return;
    const act = b.dataset.agh;
    if (act === 'copy-code') return copyText(b.dataset.code, 'Code copié');
    if (act === 'copy-link') return copyText(b.dataset.link, 'Lien copié');
    const g = G.list.find((x) => x.id === b.closest('[data-id]')?.dataset.id);
    if (!g) return;
    if (act === 'fiche') return G.openFiche?.(g.id);
    if (act === 'invite') return invite(g, b);
    if (act === 'delete') return removeGhost(g, b);
  });
}

/** Recharge la liste des fantômes et la réaffiche. */
export async function refreshGhostsSection() {
  try { G.list = await fetchAdminGhosts(); G.error = null; } catch (e) { G.error = e; }
  renderList();
}
