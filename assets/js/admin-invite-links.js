// ===== Humane Gang — administration : liens d'invitation (hg_invite_links) =====
// Un lien public (rejoindre.html?l=<token>) donne à chaque visiteur un code unique HG-XXXXXX valable 48 h.
// Importé par admin.js (section « Invitations »). Ne dépend que de core.js.
import { sb, toast, errMsg, esc, $, fmtDate, fmtDateTime } from './core.js';

const IC = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h3M21 18v3M17.5 17.5h.01"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
};
const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm';

const L = { root: null, me: null, pseudoOf: (id) => id, onChange: async () => {}, links: [], codes: [], open: new Set(), error: null };

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
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
  }
  toast('Copié dans le presse-papiers', 'ok');
}

/** URL publique du lien, calculée depuis l'adresse de la page (fonctionne aussi sous /human-gang/ sur GitHub Pages). */
export function inviteLinkUrl(token) {
  const u = new URL('rejoindre.html', `${location.origin}${location.pathname}`);
  u.searchParams.set('l', token);
  return u.href;
}

/* ---------- Données ---------- */
async function load() {
  const [l, c] = await Promise.all([
    sb.from('hg_invite_links').select('*').order('created_at', { ascending: false }),
    sb.from('hg_invites').select('code, used_by, used_at, created_at, expires_at, link_id').not('link_id', 'is', null).order('created_at', { ascending: false }),
  ]);
  L.links = check(l) ?? [];
  L.codes = check(c) ?? [];
}

function linkState(l) {
  if (!l.active) return ['Désactivé', 'pill-todo'];
  if (l.expires_at && new Date(l.expires_at) < new Date()) return ['Expiré', 'pill-warn'];
  if (l.max_codes != null && l.codes_generated >= l.max_codes) return ['Limite atteinte', 'pill-warn'];
  return ['Actif', 'pill-ok'];
}
function codeState(c) {
  if (c.used_by) return `Utilisé par <strong class="text">${esc(L.pseudoOf(c.used_by))}</strong> le ${esc(fmtDateTime(c.used_at))}`;
  if (c.expires_at && new Date(c.expires_at) < new Date()) return `<span class="muted">Expiré le ${esc(fmtDateTime(c.expires_at))}</span>`;
  return c.expires_at ? `Valable jusqu'au ${esc(fmtDateTime(c.expires_at))}` : 'Disponible';
}

/* ---------- Rendu ---------- */
function formHtml() {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <form class="il-form" id="il-form">
      <div class="field il-label"><label for="il-label">Libellé</label>
        <input id="il-label" name="label" maxlength="80" autocomplete="off" placeholder="ex. Soirée du 12 décembre"></div>
      <div class="field"><label for="il-max">Limite de codes</label>
        <input id="il-max" name="max_codes" type="number" min="1" max="500" step="1" inputmode="numeric" placeholder="Illimité"></div>
      <div class="field"><label for="il-exp">Expire le <span class="muted small">(option)</span></label>
        <input id="il-exp" name="expires_at" type="date" min="${today}"></div>
      <button class="btn btn-primary" type="submit">${IC.link} Créer le lien</button>
    </form>`;
}

function linkHtml(l) {
  const url = inviteLinkUrl(l.token);
  const [stateLabel, statePill] = linkState(l);
  const codes = L.codes.filter((c) => c.link_id === l.id);
  const used = codes.filter((c) => c.used_by).length;
  const open = L.open.has(l.id);
  const limit = l.max_codes != null ? ` · limite ${esc(l.max_codes)}` : '';
  return `
    <li class="il-item${l.active ? '' : ' is-off'}" data-link="${esc(l.id)}">
      <div class="il-top">
        <div class="il-title">
          <strong>${esc(l.label || 'Lien sans libellé')}</strong>
          <span class="pill ${statePill}">${stateLabel}</span>
        </div>
        <label class="switch il-switch"><input type="checkbox" role="switch" data-il-toggle${l.active ? ' checked' : ''} aria-label="Lien « ${esc(l.label || 'sans libellé')} » actif"><span class="switch-ui" aria-hidden="true"></span><span class="small">${l.active ? 'Actif' : 'Inactif'}</span></label>
      </div>
      <div class="il-url">
        <label class="visually-hidden" for="il-url-${esc(l.id)}">Adresse du lien</label>
        <input id="il-url-${esc(l.id)}" class="input il-url-input" readonly value="${esc(url)}">
        <button class="btn btn-ghost btn-sm" type="button" data-il-copy>${IC.copy} Copier</button>
        <button class="btn btn-ghost btn-sm" type="button" data-il-qr>${IC.qr} QR code</button>
        <button class="btn btn-danger btn-sm btn-icon" type="button" data-il-del aria-label="Supprimer le lien « ${esc(l.label || 'sans libellé')} »" title="Supprimer">${IC.trash}</button>
      </div>
      <p class="small muted il-meta">
        <span><strong class="text">${esc(l.codes_generated ?? codes.length)}</strong> code${(l.codes_generated ?? 0) > 1 ? 's' : ''} généré${(l.codes_generated ?? 0) > 1 ? 's' : ''}${limit}</span>
        <span><strong class="text">${used}</strong> utilisé${used > 1 ? 's' : ''}</span>
        <span>${l.expires_at ? `${new Date(l.expires_at) < new Date() ? 'Expiré le' : 'Expire le'} ${esc(fmtDate(l.expires_at))}` : 'Sans date d\'expiration'}</span>
        <span>Créé le ${esc(fmtDate(l.created_at))}</span>
      </p>
      <details class="il-codes"${open ? ' open' : ''} data-il-details>
        <summary>Codes générés par ce lien (${codes.length})</summary>
        ${codes.length ? `<ul class="il-code-list">${codes.map((c) => `
          <li><span class="code${c.used_by ? ' muted' : ''}">${esc(c.code)}</span>
            <span class="small">${codeState(c)}</span>
            <span class="small muted">demandé le ${esc(fmtDateTime(c.created_at))}</span></li>`).join('')}</ul>`
          : '<p class="small muted">Personne n\'a encore ouvert ce lien.</p>'}
      </details>
    </li>`;
}

function render() {
  const r = L.root; if (!r) return;
  r.innerHTML = `
    <h3 class="card-title">Liens d'invitation</h3>
    <p class="muted small">Un lien à partager (Discord, QR code…). Chaque personne qui l'ouvre reçoit son propre code d'invitation, valable 48 h et utilisable une seule fois. Désactive ou supprime le lien quand tu n'en as plus besoin.</p>
    ${formHtml()}
    ${L.error ? `<div class="empty">Impossible de charger les liens : ${esc(errMsg(L.error))}</div>`
      : L.links.length ? `<ul class="il-list">${L.links.map(linkHtml).join('')}</ul>`
      : '<div class="empty">Aucun lien pour l\'instant.</div>'}`;
}

async function refresh() {
  try { await load(); L.error = null; } catch (e) { L.error = e; }
  render();
}

/* ---------- QR code (bibliothèque légère chargée à la demande) ---------- */
let qrLib = null;
async function showQr(l) {
  const url = inviteLinkUrl(l.token);
  if (!qrLib) qrLib = (await import(QR_LIB)).default;
  const qr = qrLib(0, 'M');
  qr.addData(url);
  qr.make();
  const src = qr.createDataURL(8, 16);
  let dlg = $('#il-qr-dlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'il-qr-dlg'; dlg.className = 'hg-dialog il-qr-dlg';
    dlg.setAttribute('aria-labelledby', 'il-qr-title');
    document.body.append(dlg);
  }
  const name = (l.label || 'lien').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'lien';
  dlg.innerHTML = `
    <form method="dialog" class="stack">
      <h2 id="il-qr-title" class="dialog-title">QR code · ${esc(l.label || 'Lien sans libellé')}</h2>
      <img class="il-qr-img" src="${esc(src)}" alt="QR code menant à ${esc(url)}" width="${qr.getModuleCount() * 8 + 32}" height="${qr.getModuleCount() * 8 + 32}">
      <p class="small muted il-qr-url">${esc(url)}</p>
      <div class="btn-row dialog-actions">
        <a class="btn btn-ghost" href="${esc(src)}" download="invitation-${esc(name)}.gif">Télécharger l'image</a>
        <button class="btn btn-primary" value="close" type="submit">Fermer</button>
      </div>
    </form>`;
  dlg.showModal();
}

/* ---------- Événements ---------- */
function bind() {
  const r = L.root;
  r.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'il-form') return;
    ev.preventDefault();
    const f = ev.target;
    busy(ev.submitter, async () => {
      const label = f.label.value.trim() || `Lien du ${fmtDate(new Date())}`;
      const maxRaw = f.max_codes.value.trim();
      const max = maxRaw ? Number(maxRaw) : null;
      if (max !== null && (!Number.isInteger(max) || max < 1)) throw new Error('La limite doit être un nombre entier supérieur ou égal à 1.');
      // Date d'expiration : fin de journée locale
      const exp = f.expires_at.value ? new Date(`${f.expires_at.value}T23:59:59`) : null;
      if (exp && exp < new Date()) throw new Error('La date d\'expiration est déjà passée.');
      const row = check(await sb.from('hg_invite_links').insert({
        label, max_codes: max, expires_at: exp ? exp.toISOString() : null, created_by: L.me.id,
      }).select().single());
      await refresh();
      toast('Lien d\'invitation créé : copie-le ci-dessous', 'ok');
      if (row?.id) $(`[data-link="${CSS.escape(row.id)}"] .il-url-input`, L.root)?.select();
    });
  });
  r.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    const li = t.closest('[data-link]');
    const l = li && L.links.find((x) => x.id === li.dataset.link);
    if (!l) return;
    if (t.hasAttribute('data-il-copy')) return copyText(inviteLinkUrl(l.token));
    if (t.hasAttribute('data-il-qr')) return busy(t, () => showQr(l).catch((e) => { throw new Error(`QR code indisponible (${errMsg(e)}). Copie le lien à la place.`); }));
    if (t.hasAttribute('data-il-del')) {
      const pending = L.codes.filter((c) => c.link_id === l.id && !c.used_by).length;
      const ok = await confirmBox(`Supprimer le lien « ${l.label || 'sans libellé'} » ?`,
        `Le lien ne fonctionnera plus.${pending ? ` ${pending} code${pending > 1 ? 's' : ''} non utilisé${pending > 1 ? 's' : ''} généré${pending > 1 ? 's' : ''} par ce lien ${pending > 1 ? 'seront aussi supprimés' : 'sera aussi supprimé'}.` : ''} Les comptes déjà créés ne sont pas touchés.`,
        { ok: 'Supprimer', danger: true });
      if (!ok) return;
      await busy(t, async () => {
        check(await sb.from('hg_invites').delete().eq('link_id', l.id).is('used_by', null));
        check(await sb.from('hg_invite_links').delete().eq('id', l.id));
        L.open.delete(l.id);
        await refresh(); await L.onChange();
        toast('Lien supprimé', 'ok');
      });
    }
  });
  r.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (!el.matches('[data-il-toggle]')) return;
    const li = el.closest('[data-link]');
    const l = L.links.find((x) => x.id === li?.dataset.link);
    if (!l) return;
    el.disabled = true;
    try {
      check(await sb.from('hg_invite_links').update({ active: el.checked }).eq('id', l.id));
      toast(el.checked ? 'Lien activé' : 'Lien désactivé : il ne donne plus de code', 'ok');
      await refresh();
      $(`[data-link="${CSS.escape(l.id)}"] [data-il-toggle]`, r)?.focus();
    } catch (e) { el.checked = !el.checked; el.disabled = false; toast(errMsg(e), 'error'); }
  });
  r.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (!d.matches?.('[data-il-details]')) return;
    const id = d.closest('[data-link]')?.dataset.link;
    if (id) { if (d.open) L.open.add(id); else L.open.delete(id); }
  }, true);
}

/** Point d'entrée (admin.js). pseudoOf(uid) -> pseudo ; onChange() après une suppression de codes. */
export async function mountInviteLinks(root, { me, pseudoOf, onChange } = {}) {
  if (!root) return;
  Object.assign(L, { root, me, pseudoOf: pseudoOf || L.pseudoOf, onChange: onChange || L.onChange });
  bind();
  root.innerHTML = '<div class="empty">Chargement des liens…</div>';
  await refresh();
}
/** Re-rendu (ex. après rechargement des membres, pour les pseudos). */
export function refreshInviteLinks() { return refresh(); }
