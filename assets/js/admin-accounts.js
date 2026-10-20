// ===== Humane Gang — administration : comptes des membres (fiche complète) + extras Secret Santa =====
// Importé par admin.js. Ne dépend que de core.js et profile-fields.js (pas d'import circulaire).
import { sb, toast, errMsg, esc, $, $$, fmtDate, fmtDateTime, avatarHtml, isGodMode, godLimitAttr, godTag } from './core.js';
import { INFO_GROUPS, INFO_FIELDS } from './profile-fields.js';
import { ensureAccessData, memberAccessHtml, setAccess, accessPages } from './admin-access.js';

/* ---------- Icônes ---------- */
const IC = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 3.9M6.6 6.6C3.8 8.3 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
};

/* ---------- Petits outils (copie locale : admin.js n'exporte rien) ---------- */
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
function check(res) { if (res.error) throw res.error; return res.data; }
const nullIfEmpty = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());
function safeUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const tryParse = (v) => { try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && u.hostname.includes('.') ? u.href : null; } catch { return null; } };
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? tryParse(s) : tryParse(`https://${s}`);
}
/** ISO -> valeur pour <input type="datetime-local"> (heure locale). */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ---------- État ---------- */
const A = {
  me: null, onChange: async () => {},
  accounts: [], avatars: new Map(), q: '', listError: null,
  uid: null, tab: 'profil', d: null, loading: false,
  ssEdition: null, showPair: false,
};
const pseudoOf = (id) => (id ? A.accounts.find((a) => a.id === id)?.pseudo || A.avatars.get(id)?.pseudo || 'Ancien membre' : '—');
const TABS = [
  ['profil', 'Profil'], ['infos', 'Informations'], ['ss', 'Secret Santa'], ['irl', 'Sorties IRL'],
  ['photos', 'Photos'], ['contrib', 'Idées & assistance'], ['badges', 'Badges'], ['acces', 'Accès'],
];
const SS_STATUS = { inscriptions: 'Inscriptions', tirage: 'Tirage', envoi: 'Envoi', revelation: 'Révélation', termine: 'Terminé' };
const RSVP = [['', 'Pas de réponse'], ['oui', 'Oui'], ['peut-etre', 'Peut-être'], ['non', 'Non']];
const IDEA = { nouvelle: 'Nouvelle', retenue: 'Retenue', ecartee: 'Écartée' };

const root = () => $('#acc-root');

/* =========================================================
   Liste des comptes
   ========================================================= */
async function loadAccounts() {
  const [acc, mem] = await Promise.all([sb.rpc('hg_admin_accounts'), sb.rpc('hg_members')]);
  A.accounts = (check(acc) ?? []).slice().sort((a, b) => (!a.pseudo - !b.pseudo) || String(a.pseudo ?? a.email ?? '').localeCompare(String(b.pseudo ?? b.email ?? ''), 'fr'));
  A.avatars = new Map((mem.data ?? []).map((m) => [m.id, m]));
  // Date d'arrivée réelle dans le gang (saisie par l'admin) : absente de hg_admin_accounts
  const jo = await sb.from('hg_profiles').select('id, joined_on');
  if (!jo.error) { const m = new Map((jo.data ?? []).map((r) => [r.id, r.joined_on])); for (const a of A.accounts) a.joined_on = m.get(a.id) ?? null; }
}
/** 'AAAA-MM-JJ' -> date lisible, sans décalage de fuseau. */
const fmtDay = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? fmtDate(new Date(+m[1], m[2] - 1, +m[3])) : ''; };

function renderList() {
  root().innerHTML = `
    <div class="card stack">
      <div class="acc-toolbar">
        <div class="field acc-search">
          <label for="acc-q">Rechercher un compte</label>
          <div class="acc-search-box">${IC.search}<input id="acc-q" type="search" autocomplete="off" placeholder="Pseudo ou e-mail" value="${esc(A.q)}"></div>
        </div>
        <p class="small muted acc-count" id="acc-count" aria-live="polite"></p>
      </div>
      <div class="acc-head" aria-hidden="true"><span>Membre</span><span>E-mail</span><span>Inscrit le</span><span>Arrivée</span><span>Dernière connexion</span><span></span></div>
      <ul class="acc-list" id="acc-list"></ul>
    </div>`;
  renderRows();
}
function renderRows() {
  const list = $('#acc-list'); if (!list) return;
  if (A.listError) { list.innerHTML = `<li class="empty">Impossible de charger les comptes : ${esc(errMsg(A.listError))}</li>`; return; }
  const q = norm(A.q.trim());
  const rows = A.accounts.filter((a) => !q || norm(a.pseudo).includes(q) || norm(a.email).includes(q));
  $('#acc-count').textContent = q ? `${rows.length} / ${A.accounts.length} comptes` : `${A.accounts.length} compte${A.accounts.length > 1 ? 's' : ''}`;
  list.innerHTML = rows.length ? rows.map((a) => {
    const m = { ...(A.avatars.get(a.id) || {}), pseudo: a.pseudo || '?' };
    const inner = `
      <span class="acc-who">${avatarHtml(m, 36)}<span class="acc-name"><strong>${esc(a.pseudo || 'Sans profil')}</strong>
        ${a.is_admin ? '<span class="pill pill-ok acc-pill">admin</span>' : ''}${a.id === A.me.id ? '<span class="pill pill-muted acc-pill">toi</span>' : ''}</span></span>
      <span class="acc-email">${esc(a.email || '—')}</span>
      <span class="acc-date"><span class="acc-k">Inscrit le </span>${esc(fmtDate(a.created_at))}</span>
      <span class="acc-date"><span class="acc-k">Arrivée dans le gang : </span>${a.joined_on ? esc(fmtDay(a.joined_on)) : '<span class="acc-none">non renseignée</span>'}</span>
      <span class="acc-date"><span class="acc-k">Dernière connexion : </span>${a.last_sign_in_at ? esc(fmtDateTime(a.last_sign_in_at)) : 'jamais'}</span>
      <span class="acc-go">${a.pseudo ? IC.chev : ''}</span>`;
    return a.pseudo
      ? `<li><button class="acc-row" type="button" data-open="${esc(a.id)}" aria-label="Ouvrir la fiche de ${esc(a.pseudo)}">${inner}</button></li>`
      : `<li><div class="acc-row is-disabled" title="Compte créé sans code d'invitation : aucun profil Humane Gang">${inner}</div></li>`;
  }).join('') : '<li class="empty">Aucun compte ne correspond à la recherche.</li>';
}

/* =========================================================
   Fiche d'un membre
   ========================================================= */
async function q(p) { const r = await p; return { data: r.data, error: r.error }; }
async function loadDetail(uid) {
  const [profile, info, editions, parts, wishes, assigns, events, rsvps, photos, ideas, support, badges, ubadges] = await Promise.all([
    q(sb.from('hg_profiles').select('*').eq('id', uid).maybeSingle()),
    q(sb.from('hg_profile_info').select('data, updated_at').eq('user_id', uid).maybeSingle()),
    q(sb.from('hg_ss_editions').select('id, year, status, drawn_at').order('year', { ascending: false })),
    q(sb.from('hg_ss_participants').select('edition_id, user_id, sent_at, received_at, joined_at')),
    q(sb.from('hg_ss_wishes').select('id, edition_id, label, url, created_at').eq('user_id', uid).order('created_at')),
    q(sb.from('hg_ss_assignments').select('edition_id, giver_id, receiver_id')),
    q(sb.from('hg_events').select('id, title, starts_at, location').order('starts_at', { ascending: false, nullsFirst: false })),
    q(sb.from('hg_event_rsvps').select('event_id, status, updated_at').eq('user_id', uid)),
    q(sb.from('hg_photos').select('id, event_id, path, caption, created_at').eq('user_id', uid).order('created_at', { ascending: false })),
    q(sb.from('hg_ideas').select('*').eq('user_id', uid).order('created_at', { ascending: false })),
    q(sb.from('hg_support').select('*').eq('user_id', uid).order('created_at', { ascending: false })),
    q(sb.from('hg_badges').select('code, name, description, image_url, sort').order('sort')),
    q(sb.from('hg_user_badges').select('badge_code, awarded_at').eq('user_id', uid)),
    ensureAccessData().catch(() => null), // accès aux pages (onglet « Accès ») ; l'erreur s'affiche dans l'onglet
  ]);
  if (profile.error) throw profile.error;
  if (!profile.data) throw new Error('Profil introuvable.');
  const d = {
    profile: profile.data, info, editions, parts, wishes, assigns, events, rsvps, photos, ideas, support, badges, ubadges,
    signed: new Map(),
  };
  // Miniatures signées (bucket privé)
  const paths = (photos.data ?? []).map((p) => p.path);
  if (paths.length) {
    const { data: urls, error } = await sb.storage.from('hg-photos').createSignedUrls(paths, 3600);
    if (error) console.warn('[photos]', error);
    for (const u of urls ?? []) if (u.signedUrl) d.signed.set(u.path, u.signedUrl);
  }
  return d;
}

async function openAccount(uid, { tab } = {}) {
  A.uid = uid; A.tab = tab || 'profil'; A.showPair = false; A.d = null;
  root().innerHTML = `${detailHead()}<div class="empty">Chargement de la fiche…</div>`;
  enterInspect();
  $('#comptes').scrollIntoView({ block: 'start' });
  try {
    A.d = await loadDetail(uid);
    if (A.uid !== uid) return;
    if (!A.d.editions.data?.some((e) => e.id === A.ssEdition)) A.ssEdition = A.d.editions.data?.[0]?.id ?? null;
    renderDetail();
    updateInspect();
  } catch (e) {
    root().innerHTML = `${detailHead()}<div class="empty">Impossible de charger la fiche : ${esc(errMsg(e))}</div>`;
  }
}
async function reloadDetail() {
  try { A.d = await loadDetail(A.uid); renderDetail(); updateInspect(); } catch (e) { toast(errMsg(e), 'error'); }
}

function detailHead() {
  const acc = A.accounts.find((a) => a.id === A.uid) || {};
  const p = A.d?.profile || { pseudo: acc.pseudo };
  return `
    <div class="acc-detail-top">
      <button class="btn btn-ghost btn-sm" type="button" data-act="back">${IC.back} Tous les comptes</button>
    </div>
    <div class="acc-ident">
      ${avatarHtml(p, 56)}
      <div class="acc-ident-txt">
        <h3 class="acc-ident-name">${esc(p.pseudo || acc.pseudo || 'Membre')}</h3>
        <div class="small muted">${esc(acc.email || '')}${acc.created_at ? ` · inscrit le ${esc(fmtDate(acc.created_at))}` : ''}${acc.last_sign_in_at ? ` · vu le ${esc(fmtDateTime(acc.last_sign_in_at))}` : ''}</div>
      </div>
      ${p.is_admin ? '<span class="pill pill-ok">admin</span>' : ''}
    </div>`;
}

function renderDetail() {
  root().innerHTML = `
    ${detailHead()}
    <div class="acc-tabs" role="tablist" aria-label="Données du membre">
      ${TABS.map(([k, l]) => `<button class="acc-tab" type="button" role="tab" id="acc-tab-${k}" data-tab="${k}" aria-controls="acc-panel" aria-selected="${k === A.tab}" tabindex="${k === A.tab ? 0 : -1}">${esc(l)}${tabCount(k)}</button>`).join('')}
    </div>
    <div class="card acc-panel" id="acc-panel" role="tabpanel" aria-labelledby="acc-tab-${A.tab}" tabindex="0">${panelHtml()}</div>`;
}
function tabCount(k) {
  const d = A.d; let n = 0;
  if (k === 'photos') n = d.photos.data?.length ?? 0;
  if (k === 'contrib') n = (d.ideas.data?.length ?? 0) + (d.support.data?.length ?? 0);
  if (k === 'badges') n = d.ubadges.data?.length ?? 0;
  return n ? ` <span class="acc-tab-n">${n}</span>` : '';
}
function renderPanel() {
  const panel = $('#acc-panel'); if (!panel) return renderDetail();
  panel.innerHTML = panelHtml();
}
const tabError = (r) => (r?.error ? `<div class="empty">Impossible de charger : ${esc(errMsg(r.error))}</div>` : '');

function panelHtml() {
  switch (A.tab) {
    case 'profil': return profileHtml();
    case 'infos': return infosHtml();
    case 'ss': return ssHtml();
    case 'irl': return irlHtml();
    case 'photos': return photosHtml();
    case 'contrib': return contribHtml();
    case 'badges': return badgesHtml();
    case 'acces': return memberAccessHtml({ id: A.d.profile.id, pseudo: A.d.profile.pseudo, is_admin: !!A.d.profile.is_admin });
    default: return '';
  }
}

/* ---------- Profil ---------- */
function profileHtml() {
  const p = A.d.profile, self = p.id === A.me.id;
  const color = /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#9E3543';
  return `
    <form class="stack" data-form="profile" novalidate>
      <div class="grid-2">
        <div class="field"><label for="ap-pseudo">Pseudo</label><input id="ap-pseudo" name="pseudo" required minlength="2" maxlength="32" value="${esc(p.pseudo)}"></div>
        <div class="field"><label for="ap-color">Couleur</label>
          <div class="acc-color"><input id="ap-color" name="color" type="color" value="${esc(color)}"><span class="small muted">${esc(p.color || 'par défaut')}</span></div></div>
        <div class="field acc-span"><label for="ap-avatar">Adresse de l'avatar (URL)</label>
          <div class="acc-avatar-edit">${avatarHtml(p, 44)}<input id="ap-avatar" name="avatar_url" type="url" inputmode="url" value="${esc(p.avatar_url ?? '')}" placeholder="Vide = initiales"></div></div>
        <div class="field"><label for="ap-bday">Anniversaire</label><input id="ap-bday" name="birthday" type="date" value="${esc(p.birthday ?? '')}"></div>
        <div class="field"><label for="ap-joined">Date d'arrivée dans le gang${godTag()}</label>
          <div class="acc-joined"><input id="ap-joined" name="joined_on" type="date" ${godLimitAttr('max', new Date().toISOString().slice(0, 10))} value="${esc(p.joined_on ?? '')}" aria-describedby="ap-joined-help">
            <button class="btn btn-ghost btn-sm" type="button" data-act="clear-joined"${p.joined_on ? '' : ' disabled'}>Effacer</button></div>
          <span class="small muted" id="ap-joined-help">Utilisée sur la carte d'identité (membre depuis). Vide = date d'inscription sur le site.</span></div>
        <div class="field"><label for="ap-discord">ID Discord</label><input id="ap-discord" name="discord_id" inputmode="numeric" autocomplete="off" value="${esc(p.discord_id ?? '')}" placeholder="17 à 20 chiffres"></div>
      </div>
      <fieldset class="toggles">
        <legend class="label">Options</legend>
        <label class="check"><input type="checkbox" name="share_birthday"${p.share_birthday ? ' checked' : ''}> <span>Partage son anniversaire avec le gang (jour et mois)</span></label>
        <label class="check"><input type="checkbox" name="bot_optin"${p.bot_optin ? ' checked' : ''}> <span>Accepte les messages privés du bot</span></label>
        <label class="check"><input type="checkbox" name="intro_seen"${p.intro_seen ? ' checked' : ''}> <span>Intro déjà vue</span></label>
        <label class="check"><input type="checkbox" name="is_admin"${p.is_admin ? ' checked' : ''}${self ? ' disabled' : ''}> <span>Administrateur${self ? ' <span class="muted small">(tu ne peux pas te retirer ce statut toi-même)</span>' : ''}</span></label>
      </fieldset>
      <p class="small muted">Identifiant : <span class="code acc-uid">${esc(p.id)}</span> · profil créé le ${esc(fmtDateTime(p.created_at))}${p.updated_at ? ` · modifié le ${esc(fmtDateTime(p.updated_at))}` : ''}</p>
      <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer le profil</button></div>
    </form>`;
}
async function saveProfile(form, btn) {
  const p = A.d.profile, self = p.id === A.me.id;
  const pseudo = form.pseudo.value.trim();
  if (pseudo.length < 2 || pseudo.length > 32) throw new Error('Le pseudo doit faire entre 2 et 32 caractères.');
  const discord = form.discord_id.value.trim();
  if (discord && !/^\d{17,20}$/.test(discord)) throw new Error('L\'ID Discord doit être un nombre de 17 à 20 chiffres.');
  const avatarRaw = form.avatar_url.value.trim();
  const avatar = avatarRaw ? safeUrl(avatarRaw) : null;
  if (avatarRaw && !avatar) throw new Error('Adresse d\'avatar invalide (http ou https uniquement).');
  const patch = {
    pseudo, color: form.color.value, avatar_url: avatar, birthday: nullIfEmpty(form.birthday.value),
    discord_id: discord || null, share_birthday: form.share_birthday.checked, bot_optin: form.bot_optin.checked,
    intro_seen: form.intro_seen.checked, joined_on: nullIfEmpty(form.joined_on.value),
  };
  if (patch.joined_on && !/^\d{4}-\d{2}-\d{2}$/.test(patch.joined_on)) throw new Error('Date d\'arrivée invalide.');
  if (patch.joined_on && patch.joined_on > new Date().toISOString().slice(0, 10) && !isGodMode()) throw new Error('La date d\'arrivée ne peut pas être dans le futur.');
  if (!self) patch.is_admin = form.is_admin.checked;
  if (self && p.is_admin && patch.is_admin === false) throw new Error('Tu ne peux pas te retirer le statut admin.');
  if (!self && patch.is_admin !== p.is_admin) {
    const ok = await confirmBox(
      patch.is_admin ? `Nommer ${pseudo} admin ?` : `Retirer le statut admin à ${pseudo} ?`,
      patch.is_admin ? 'Cette personne aura accès à toute l\'administration, y compris aux données privées de tous les membres et aux attributions du Secret Santa.' : 'Cette personne n\'aura plus accès à l\'administration.',
      { ok: patch.is_admin ? 'Nommer admin' : 'Retirer le statut', danger: !patch.is_admin },
    );
    if (!ok) return;
  }
  const row = check(await sb.from('hg_profiles').update(patch).eq('id', p.id).select().single());
  A.d.profile = row;
  const acc = A.accounts.find((a) => a.id === p.id);
  if (acc) { acc.pseudo = row.pseudo; acc.is_admin = row.is_admin; acc.joined_on = row.joined_on ?? null; }
  A.avatars.set(row.id, { ...(A.avatars.get(row.id) || {}), id: row.id, pseudo: row.pseudo, avatar_url: row.avatar_url, color: row.color });
  renderDetail();
  toast('Profil enregistré', 'ok');
  await A.onChange('members');
}

/* ---------- Informations diverses ---------- */
function infosHtml() {
  if (A.d.info.error) return tabError(A.d.info);
  const data = A.d.info.data?.data || {};
  const known = new Set(INFO_FIELDS.map((f) => f.id));
  const extra = Object.keys(data).filter((k) => !known.has(k));
  return `
    <form class="stack" data-form="infos">
      <p class="small muted">Visibles par le membre et par toi. Pour chaque édition, tu choisis lesquelles sont transmises au Santa.${A.d.info.data?.updated_at ? ` Dernière mise à jour : ${esc(fmtDateTime(A.d.info.data.updated_at))}.` : ' Rien de rempli pour l\'instant.'}</p>
      ${INFO_GROUPS.map((g) => `
        <fieldset class="acc-group">
          <legend>${esc(g.label)}</legend>
          <div class="grid-2">${g.fields.map((f) => {
            const id = `ai-${f.id}`, v = data[f.id] ?? '';
            const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
            return `<div class="field${f.type === 'textarea' ? ' acc-span' : ''}"><label for="${id}">${esc(f.label)}</label>${f.type === 'textarea'
              ? `<textarea id="${id}" name="${esc(f.id)}" rows="3" maxlength="2000"${ph}>${esc(v)}</textarea>`
              : `<input id="${id}" name="${esc(f.id)}" maxlength="300" autocomplete="off" value="${esc(v)}"${ph}>`}</div>`;
          }).join('')}</div>
        </fieldset>`).join('')}
      ${extra.length ? `<p class="small muted">Autres clés conservées telles quelles : ${esc(extra.join(', '))}.</p>` : ''}
      <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer les informations</button></div>
    </form>`;
}
async function saveInfos(form) {
  const old = A.d.info.data?.data || {};
  const known = new Set(INFO_FIELDS.map((f) => f.id));
  const data = Object.fromEntries(Object.entries(old).filter(([k]) => !known.has(k)));
  for (const f of INFO_FIELDS) {
    const v = String(form.elements[f.id]?.value ?? '').trim();
    if (v) data[f.id] = v;
  }
  const row = check(await sb.from('hg_profile_info')
    .upsert({ user_id: A.uid, data, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('data, updated_at').single());
  A.d.info = { data: row, error: null };
  renderPanel();
  toast('Informations enregistrées', 'ok');
}

/* ---------- Secret Santa ---------- */
function ssHtml() {
  const d = A.d;
  if (d.editions.error) return tabError(d.editions);
  const eds = d.editions.data ?? [];
  if (!eds.length) return '<div class="empty">Aucune édition de Secret Santa pour l\'instant.</div>';
  const ed = eds.find((e) => e.id === A.ssEdition) || eds[0];
  const parts = (d.parts.data ?? []).filter((p) => p.edition_id === ed.id);
  const mine = parts.find((p) => p.user_id === A.uid);
  const wishes = (d.wishes.data ?? []).filter((w) => w.edition_id === ed.id);
  const assigns = (d.assigns.data ?? []).filter((a) => a.edition_id === ed.id);
  const target = assigns.find((a) => a.giver_id === A.uid)?.receiver_id ?? '';
  const santa = assigns.find((a) => a.receiver_id === A.uid)?.giver_id ?? '';
  const others = parts.filter((p) => p.user_id !== A.uid).map((p) => ({ id: p.user_id, pseudo: pseudoOf(p.user_id) }))
    .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
  const opts = (sel) => `<option value="">Aucun·e</option>${others.map((o) => `<option value="${esc(o.id)}"${o.id === sel ? ' selected' : ''}>${esc(o.pseudo)}</option>`).join('')}`;
  const drawn = !!ed.drawn_at || assigns.length > 0;
  const pseudo = d.profile.pseudo;

  return `
    <div class="acc-ss-head">
      ${eds.length > 1 ? `<div class="field"><label for="acc-ss-ed">Édition</label>
        <select id="acc-ss-ed" data-ss-edition>${eds.map((e) => `<option value="${esc(e.id)}"${e.id === ed.id ? ' selected' : ''}>${esc(e.year)} · ${esc(SS_STATUS[e.status] ?? e.status)}</option>`).join('')}</select></div>`
        : `<p class="small muted">Édition ${esc(ed.year)} · ${esc(SS_STATUS[ed.status] ?? ed.status)}</p>`}
    </div>

    <div class="acc-ss-grid">
      <div class="acc-box stack">
        <h4 class="sub-title">Participation</h4>
        <p class="small muted">${mine ? `Inscrit·e le ${esc(fmtDateTime(mine.joined_at))}.` : `${esc(pseudo)} ne participe pas à cette édition.`}</p>
        <div class="btn-row">${mine
          ? `<button class="btn btn-danger btn-sm" type="button" data-act="ss-leave">Désinscrire</button>`
          : `<button class="btn btn-primary btn-sm" type="button" data-act="ss-join">Inscrire à l'édition ${esc(ed.year)}</button>`}</div>
        ${mine ? `
        <form class="stack" data-form="ss-dates">
          <div class="grid-2">
            <div class="field"><label for="as-sent">Cadeau envoyé le</label><input id="as-sent" name="sent_at" type="datetime-local" value="${esc(toLocalInput(mine.sent_at))}"></div>
            <div class="field"><label for="as-rec">Cadeau reçu le</label><input id="as-rec" name="received_at" type="datetime-local" value="${esc(toLocalInput(mine.received_at))}"></div>
          </div>
          <p class="small muted">Laisse un champ vide pour remettre « pas encore ». Aucune notification n'est envoyée.</p>
          <div class="btn-row"><button class="btn btn-primary btn-sm" type="submit">Enregistrer les dates</button></div>
        </form>` : ''}
      </div>

      <div class="acc-box stack">
        <h4 class="sub-title">Attribution</h4>
        ${!drawn ? '<p class="small muted">Le tirage n\'a pas encore été fait pour cette édition.</p>' : !A.showPair ? `
          <p class="small muted">Masqué pour éviter de te gâcher la surprise si tu participes.</p>
          <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-act="show-pair">${IC.eye} Afficher sa cible et son Santa</button></div>` : `
          <form class="acc-pair-form" data-form="pair-target">
            <div class="field"><label for="as-target">${esc(pseudo)} offre à</label><select id="as-target" name="who"${mine ? '' : ' disabled'}>${opts(target)}</select></div>
            <button class="btn btn-primary btn-sm" type="submit"${mine ? '' : ' disabled'}>Enregistrer</button>
          </form>
          <form class="acc-pair-form" data-form="pair-santa">
            <div class="field"><label for="as-santa">${esc(pseudo)} reçoit de (son Santa)</label><select id="as-santa" name="who"${mine ? '' : ' disabled'}>${opts(santa)}</select></div>
            <button class="btn btn-primary btn-sm" type="submit"${mine ? '' : ' disabled'}>Enregistrer</button>
          </form>
          <p class="small muted">Si la personne choisie est déjà prise, tu pourras échanger les deux attributions : une personne n'a jamais deux Santas.</p>
          <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-act="hide-pair">${IC.eyeOff} Masquer</button></div>`}
      </div>
    </div>

    <div class="acc-box stack">
      <h4 class="sub-title">Liste de souhaits (${wishes.length})</h4>
      ${d.wishes.error ? tabError(d.wishes) : wishes.length ? `<ul class="acc-wishes">${wishes.map((w) => `
        <li><form class="acc-wish" data-form="wish-edit" data-id="${esc(w.id)}">
          <div class="field"><label for="aw-l-${esc(w.id)}" class="visually-hidden">Souhait</label><input id="aw-l-${esc(w.id)}" name="label" maxlength="200" required value="${esc(w.label)}"></div>
          <div class="field"><label for="aw-u-${esc(w.id)}" class="visually-hidden">Lien</label><input id="aw-u-${esc(w.id)}" name="url" type="url" inputmode="url" maxlength="2000" placeholder="Lien (facultatif)" value="${esc(w.url ?? '')}"></div>
          <div class="acc-wish-actions">
            <button class="btn btn-ghost btn-sm" type="submit">Enregistrer</button>
            <button class="btn btn-danger btn-sm btn-icon" type="button" data-del-wish="${esc(w.id)}" aria-label="Supprimer « ${esc(w.label)} »">${IC.trash}</button>
          </div>
        </form></li>`).join('')}</ul>` : '<p class="small muted">Liste vide.</p>'}
      <form class="acc-wish acc-wish-new" data-form="wish-add">
        <div class="field"><label for="aw-new-l">Nouveau souhait</label><input id="aw-new-l" name="label" maxlength="200" required autocomplete="off"></div>
        <div class="field"><label for="aw-new-u">Lien (facultatif)</label><input id="aw-new-u" name="url" type="url" inputmode="url" maxlength="2000" autocomplete="off" placeholder="https://…"></div>
        <div class="acc-wish-actions"><button class="btn btn-primary btn-sm" type="submit">Ajouter</button></div>
      </form>
    </div>`;
}
const curEdition = () => (A.d.editions.data ?? []).find((e) => e.id === A.ssEdition) || A.d.editions.data?.[0];

async function ssJoin() {
  const ed = curEdition();
  check(await sb.from('hg_ss_participants').insert({ edition_id: ed.id, user_id: A.uid }));
  toast(`${A.d.profile.pseudo} est inscrit·e à l'édition ${ed.year}`, 'ok');
  if (ed.drawn_at) toast('Le tirage est déjà fait : pense à lui attribuer une cible et un Santa.', 'error');
}
async function ssLeave() {
  const ed = curEdition();
  const assigns = (A.d.assigns.data ?? []).filter((a) => a.edition_id === ed.id && (a.giver_id === A.uid || a.receiver_id === A.uid));
  const ok = await confirmBox(`Désinscrire ${A.d.profile.pseudo} ?`,
    assigns.length ? 'Le tirage est fait : ses attributions (sa cible et son Santa) seront aussi supprimées. Pense à réattribuer les personnes concernées.' : 'Sa liste de souhaits est conservée.',
    { ok: 'Désinscrire', danger: true });
  if (!ok) return false;
  if (assigns.length) check(await sb.from('hg_ss_assignments').delete().eq('edition_id', ed.id).or(`giver_id.eq.${A.uid},receiver_id.eq.${A.uid}`));
  check(await sb.from('hg_ss_participants').delete().eq('edition_id', ed.id).eq('user_id', A.uid));
  toast('Désinscription enregistrée', 'ok');
  return true;
}

/**
 * Fixe « giver offre à receiver » pour une édition, sans jamais créer de doublon de receveur
 * (contrainte unique edition_id + receiver_id). Si receiver a déjà un Santa et giver une cible, propose d'échanger.
 * Renvoie false si annulé.
 */
async function setPair(editionId, giver, receiver) {
  if (giver === receiver && !isGodMode()) throw new Error('Une personne ne peut pas s\'offrir un cadeau à elle-même.');
  const rows = (A.d.assigns.data ?? []).filter((a) => a.edition_id === editionId);
  const mineRow = rows.find((a) => a.giver_id === giver);
  const taken = rows.find((a) => a.receiver_id === receiver);
  if (mineRow && mineRow.receiver_id === receiver) { toast('Rien à changer', 'ok'); return false; }
  const inserts = [{ edition_id: editionId, giver_id: giver, receiver_id: receiver }];
  const deletes = new Set([giver]);
  if (taken) {
    const g0 = taken.giver_id;
    deletes.add(g0);
    if (mineRow) {
      if (g0 === mineRow.receiver_id) throw new Error(`Échange impossible : ${pseudoOf(g0)} se retrouverait à s'offrir son propre cadeau.`);
      const ok = await confirmBox('Échanger les attributions ?',
        `${pseudoOf(receiver)} est déjà la cible de ${pseudoOf(g0)}.\nAprès l'échange :\n· ${pseudoOf(giver)} offre à ${pseudoOf(receiver)}\n· ${pseudoOf(g0)} offre à ${pseudoOf(mineRow.receiver_id)}`,
        { ok: 'Échanger' });
      if (!ok) return false;
      inserts.push({ edition_id: editionId, giver_id: g0, receiver_id: mineRow.receiver_id });
    } else {
      const ok = await confirmBox('Réattribuer ?',
        `${pseudoOf(receiver)} est déjà la cible de ${pseudoOf(g0)}. ${pseudoOf(g0)} n'aura plus de cible et il faudra lui en attribuer une.`,
        { ok: 'Réattribuer', danger: true });
      if (!ok) return false;
    }
  }
  const before = rows.filter((a) => deletes.has(a.giver_id));
  check(await sb.from('hg_ss_assignments').delete().eq('edition_id', editionId).in('giver_id', [...deletes]));
  const res = await sb.from('hg_ss_assignments').insert(inserts);
  if (res.error) {
    if (before.length) await sb.from('hg_ss_assignments').insert(before); // remise en l'état
    throw res.error;
  }
  return true;
}
async function clearPair(editionId, col) {
  const row = (A.d.assigns.data ?? []).find((a) => a.edition_id === editionId && a[col] === A.uid);
  if (!row) { toast('Rien à changer', 'ok'); return false; }
  const other = col === 'giver_id' ? row.receiver_id : row.giver_id;
  const ok = await confirmBox('Supprimer cette attribution ?',
    col === 'giver_id' ? `${A.d.profile.pseudo} n'offrira plus à ${pseudoOf(other)}.` : `${pseudoOf(other)} ne sera plus le Santa de ${A.d.profile.pseudo}.`,
    { ok: 'Supprimer', danger: true });
  if (!ok) return false;
  check(await sb.from('hg_ss_assignments').delete().eq('edition_id', editionId).eq('giver_id', row.giver_id));
  return true;
}

/* ---------- Sorties IRL ---------- */
function irlHtml() {
  const d = A.d;
  if (d.events.error) return tabError(d.events);
  const evs = d.events.data ?? [];
  const by = new Map((d.rsvps.data ?? []).map((r) => [r.event_id, r]));
  if (!evs.length) return '<div class="empty">Aucune sortie pour l\'instant.</div>';
  const now = Date.now();
  return `
    <p class="small muted">Change la réponse de ${esc(d.profile.pseudo)} : elle est enregistrée tout de suite.</p>
    <ul class="acc-events">${evs.map((e) => {
      const r = by.get(e.id);
      return `<li class="acc-event">
        <div class="acc-event-main"><strong>${esc(e.title)}</strong>
          <div class="small muted">${e.starts_at ? esc(fmtDateTime(e.starts_at)) : 'Date à définir'}${e.location ? ` · ${esc(e.location)}` : ''}${e.starts_at && new Date(e.starts_at) < now ? ' · passée' : ''}${r ? ` · répondu le ${esc(fmtDate(r.updated_at))}` : ''}</div></div>
        <div class="field acc-rsvp"><label for="ar-${esc(e.id)}" class="visually-hidden">Réponse à ${esc(e.title)}</label>
          <select id="ar-${esc(e.id)}" data-rsvp="${esc(e.id)}">${RSVP.map(([v, l]) => `<option value="${v}"${(r?.status ?? '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      </li>`;
    }).join('')}</ul>`;
}
async function setRsvp(eventId, status) {
  if (!status) check(await sb.from('hg_event_rsvps').delete().eq('event_id', eventId).eq('user_id', A.uid));
  else check(await sb.from('hg_event_rsvps').upsert({ event_id: eventId, user_id: A.uid, status, updated_at: new Date().toISOString() }, { onConflict: 'event_id,user_id' }));
  const res = await sb.from('hg_event_rsvps').select('event_id, status, updated_at').eq('user_id', A.uid);
  A.d.rsvps = { data: res.data ?? [], error: res.error };
  toast(status ? `Réponse enregistrée : ${RSVP.find(([v]) => v === status)[1]}` : 'Réponse retirée', 'ok');
}

/* ---------- Photos ---------- */
function photosHtml() {
  const d = A.d;
  if (d.photos.error) return tabError(d.photos);
  const list = d.photos.data ?? [];
  if (!list.length) return `<div class="empty">${esc(d.profile.pseudo)} n'a ajouté aucune photo.</div>`;
  const evTitle = new Map((d.events.data ?? []).map((e) => [e.id, e.title]));
  return `
    <p class="small muted">${list.length} photo${list.length > 1 ? 's' : ''} ajoutée${list.length > 1 ? 's' : ''} aux albums.</p>
    <ul class="acc-photos">${list.map((p) => {
      const url = d.signed.get(p.path);
      return `<li class="acc-photo">
        <a class="acc-photo-img" ${url ? `href="${esc(url)}" target="_blank" rel="noopener"` : ''} aria-label="Ouvrir la photo en grand">${url ? `<img src="${esc(url)}" alt="${esc(p.caption || '')}" loading="lazy">` : '<span class="small muted">Aperçu indisponible</span>'}</a>
        <div class="acc-photo-meta small"><strong>${esc(evTitle.get(p.event_id) || 'Sans sortie')}</strong>
          <span class="muted">${esc(fmtDate(p.created_at))}${p.caption ? ` · ${esc(p.caption)}` : ''}</span></div>
        <button class="btn btn-danger btn-sm" type="button" data-del-photo="${esc(p.id)}">${IC.trash} Supprimer</button>
      </li>`;
    }).join('')}</ul>`;
}
async function deletePhoto(id) {
  const p = (A.d.photos.data ?? []).find((x) => x.id === id);
  if (!p) return false;
  if (!(await confirmBox('Supprimer cette photo ?', 'Le fichier et sa fiche seront supprimés définitivement de l\'album.', { ok: 'Supprimer', danger: true }))) return false;
  const st = await sb.storage.from('hg-photos').remove([p.path]);
  check(await sb.from('hg_photos').delete().eq('id', id));
  if (st.error) toast(`Fiche supprimée, mais le fichier n'a pas pu l'être : ${errMsg(st.error)}`, 'error');
  else toast('Photo supprimée', 'ok');
  return true;
}

/* ---------- Idées & assistance ---------- */
function contribHtml() {
  const d = A.d;
  const ideas = d.ideas.data ?? [], sup = d.support.data ?? [];
  return `
    <h4 class="sub-title">Boîte à idées (${ideas.length})</h4>
    ${d.ideas.error ? tabError(d.ideas) : ideas.length ? ideas.map((i) => `
      <article class="item">
        <div class="item-meta"><span>${esc(fmtDateTime(i.created_at))}</span></div>
        <p class="item-body">${esc(i.body)}</p>
        <div class="acc-inline">
          <div class="field"><label for="aid-${esc(i.id)}" class="visually-hidden">Statut de l'idée</label>
            <select id="aid-${esc(i.id)}" data-idea-status="${esc(i.id)}">${Object.entries(IDEA).map(([k, l]) => `<option value="${k}"${k === i.status ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
          <button class="btn btn-danger btn-sm btn-icon" type="button" data-del-idea="${esc(i.id)}" aria-label="Supprimer cette idée">${IC.trash}</button>
        </div>
      </article>`).join('') : '<p class="small muted">Aucune idée envoyée.</p>'}
    <h4 class="sub-title acc-sub2">Demandes d'assistance (${sup.length})</h4>
    ${d.support.error ? tabError(d.support) : sup.length ? sup.map((s) => `
      <article class="item">
        <div class="item-meta"><strong>${esc(s.subject)}</strong><span>${esc(fmtDateTime(s.created_at))}</span>
          <span class="pill ${s.status === 'ouverte' ? 'pill-current' : 'pill-ok'}">${s.status === 'ouverte' ? 'Ouverte' : 'Traitée'}</span></div>
        <p class="item-body">${esc(s.message)}</p>
        ${s.contact ? `<div class="small muted">Contact : <strong class="text">${esc(s.contact)}</strong></div>` : ''}
        <div class="btn-row">
          <button class="btn btn-ghost btn-sm" type="button" data-support="${esc(s.id)}" data-status="${s.status === 'ouverte' ? 'traitee' : 'ouverte'}">${s.status === 'ouverte' ? `${IC.check} Marquer traitée` : 'Rouvrir'}</button>
          <button class="btn btn-danger btn-sm btn-icon" type="button" data-del-support="${esc(s.id)}" aria-label="Supprimer cette demande">${IC.trash}</button>
        </div>
      </article>`).join('') : '<p class="small muted">Aucune demande d\'assistance.</p>'}`;
}

/* ---------- Badges ---------- */
function badgesHtml() {
  const d = A.d;
  if (d.badges.error) return tabError(d.badges);
  const owned = new Map((d.ubadges.data ?? []).map((u) => [u.badge_code, u]));
  return `
    <p class="small muted">${owned.size} badge${owned.size > 1 ? 's' : ''} sur ${(d.badges.data ?? []).length}. Touche un badge pour l'attribuer ou le retirer.</p>
    <div class="badge-toggles">${(d.badges.data ?? []).map((b) => {
      const u = owned.get(b.code);
      return `<button class="chip" type="button" data-toggle-badge="${esc(b.code)}" aria-pressed="${!!u}" title="${esc(b.description)}${u ? ` (depuis le ${esc(fmtDate(u.awarded_at))})` : ''}">${u ? IC.check : ''}${esc(b.name)}</button>`;
    }).join('')}</div>`;
}
async function toggleBadge(code, on) {
  const name = (A.d.badges.data ?? []).find((b) => b.code === code)?.name ?? code;
  if (on) {
    if (!(await confirmBox('Retirer ce badge ?', `${A.d.profile.pseudo} perdra le badge « ${name} ».`, { ok: 'Retirer', danger: true }))) return false;
    check(await sb.from('hg_user_badges').delete().eq('user_id', A.uid).eq('badge_code', code));
  } else {
    const res = await sb.from('hg_user_badges').insert({ user_id: A.uid, badge_code: code });
    if (res.error && res.error.code !== '23505') throw res.error;
  }
  const r = await sb.from('hg_user_badges').select('badge_code, awarded_at').eq('user_id', A.uid);
  A.d.ubadges = { data: r.data ?? [], error: r.error };
  toast(on ? 'Badge retiré' : `Badge « ${name} » attribué`, 'ok');
  return true;
}

/* =========================================================
   Événements de la section Comptes
   ========================================================= */
function bindAccounts() {
  const sec = $('#comptes');
  sec.addEventListener('input', (ev) => {
    if (ev.target.id === 'acc-q') { A.q = ev.target.value; renderRows(); }
    if (ev.target.id === 'ap-joined') { const b = $('[data-act="clear-joined"]', sec); if (b) b.disabled = !ev.target.value; }
  });
  sec.addEventListener('keydown', (ev) => {
    const tab = ev.target.closest('[role="tab"]');
    if (!tab || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(ev.key)) return;
    ev.preventDefault();
    const tabs = $$('[role="tab"]', sec);
    const i = tabs.indexOf(tab);
    const n = ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[n].dataset.tab, true);
  });
  sec.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.open) return openAccount(t.dataset.open);
    if (t.dataset.tab) return selectTab(t.dataset.tab);
    const act = t.dataset.act;
    if (act === 'back') { closeDetail(); return; }
    if (act === 'clear-joined') { const i = $('#ap-joined'); i.value = ''; t.disabled = true; i.focus(); return; }
    if (act === 'show-pair' || act === 'hide-pair') { A.showPair = act === 'show-pair'; renderPanel(); return; }
    if (act === 'ss-join') return busy(t, async () => { await ssJoin(); await afterSS(); });
    if (act === 'ss-leave') return busy(t, async () => { if (await ssLeave()) await afterSS(); });
    if (t.dataset.delWish) {
      const w = (A.d.wishes.data ?? []).find((x) => x.id === t.dataset.delWish);
      if (!(await confirmBox('Supprimer ce souhait ?', `« ${w?.label ?? ''} » sera retiré de la liste de ${A.d.profile.pseudo}.`, { ok: 'Supprimer', danger: true }))) return;
      return busy(t, async () => { check(await sb.from('hg_ss_wishes').delete().eq('id', t.dataset.delWish)); await reloadDetail(); toast('Souhait supprimé', 'ok'); });
    }
    if (t.dataset.delPhoto) return busy(t, async () => { if (await deletePhoto(t.dataset.delPhoto)) await reloadDetail(); });
    if (t.dataset.toggleBadge) {
      return busy(t, async () => {
        if (await toggleBadge(t.dataset.toggleBadge, t.getAttribute('aria-pressed') === 'true')) { renderDetail(); await A.onChange('badges'); }
      });
    }
    if (t.dataset.delIdea) {
      if (!(await confirmBox('Supprimer cette idée ?', 'Elle disparaîtra de la boîte à idées.', { ok: 'Supprimer', danger: true }))) return;
      return busy(t, async () => { check(await sb.from('hg_ideas').delete().eq('id', t.dataset.delIdea)); await reloadDetail(); toast('Idée supprimée', 'ok'); await A.onChange('ideas'); });
    }
    if (t.dataset.support) {
      return busy(t, async () => {
        check(await sb.from('hg_support').update({ status: t.dataset.status }).eq('id', t.dataset.support));
        await reloadDetail(); toast(t.dataset.status === 'traitee' ? 'Demande marquée comme traitée' : 'Demande rouverte', 'ok'); await A.onChange('support');
      });
    }
    if (t.dataset.delSupport) {
      if (!(await confirmBox('Supprimer cette demande ?', 'Elle sera effacée définitivement.', { ok: 'Supprimer', danger: true }))) return;
      return busy(t, async () => { check(await sb.from('hg_support').delete().eq('id', t.dataset.delSupport)); await reloadDetail(); toast('Demande supprimée', 'ok'); await A.onChange('support'); });
    }
  });
  sec.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (el.matches('[data-ss-edition]')) { A.ssEdition = el.value; A.showPair = false; renderPanel(); return; }
    if (el.dataset.pageAccess) {
      const slug = el.dataset.pageAccess, on = el.checked;
      el.disabled = true;
      try {
        await setAccess(slug, [A.uid], on); // déclenche 'hg:access' -> nouveau rendu de l'onglet
        const label = accessPages().find((x) => x.slug === slug)?.label || slug;
        toast(on ? `Accès à « ${label} » donné` : `Accès à « ${label} » retiré`, 'ok');
      } catch (e) { toast(errMsg(e), 'error'); el.checked = !on; el.disabled = false; }
      $(`[data-page-access="${CSS.escape(slug)}"]`)?.focus();
      return;
    }
    if (el.dataset.rsvp) {
      el.disabled = true;
      try { await setRsvp(el.dataset.rsvp, el.value); } catch (e) { toast(errMsg(e), 'error'); }
      renderPanel(); $(`[data-rsvp="${CSS.escape(el.dataset.rsvp)}"]`)?.focus();
      return;
    }
    if (el.dataset.ideaStatus) {
      el.disabled = true;
      try {
        check(await sb.from('hg_ideas').update({ status: el.value }).eq('id', el.dataset.ideaStatus));
        toast(`Idée : ${IDEA[el.value].toLowerCase()}`, 'ok'); await A.onChange('ideas');
      } catch (e) { toast(errMsg(e), 'error'); }
      await reloadDetail();
    }
  });
  sec.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.target, btn = ev.submitter, kind = form.dataset.form;
    if (kind === 'profile') return busy(btn, () => saveProfile(form, btn));
    if (kind === 'infos') return busy(btn, () => saveInfos(form));
    if (kind === 'ss-dates') {
      return busy(btn, async () => {
        const ed = curEdition();
        check(await sb.from('hg_ss_participants').update({ sent_at: fromLocalInput(form.sent_at.value), received_at: fromLocalInput(form.received_at.value) })
          .eq('edition_id', ed.id).eq('user_id', A.uid));
        toast('Dates enregistrées', 'ok'); await afterSS();
      });
    }
    if (kind === 'pair-target' || kind === 'pair-santa') {
      return busy(btn, async () => {
        const ed = curEdition(), who = form.who.value;
        let done;
        if (!who) done = await clearPair(ed.id, kind === 'pair-target' ? 'giver_id' : 'receiver_id');
        else done = kind === 'pair-target' ? await setPair(ed.id, A.uid, who) : await setPair(ed.id, who, A.uid);
        if (done) { toast('Attribution enregistrée', 'ok'); await afterSS(); }
      });
    }
    if (kind === 'wish-add' || kind === 'wish-edit') {
      return busy(btn, async () => {
        const label = form.label.value.trim(), rawUrl = form.url.value.trim();
        if (!label) throw new Error('Écris le souhait.');
        const url = rawUrl ? safeUrl(rawUrl) : null;
        if (rawUrl && !url) throw new Error('Lien invalide : http ou https uniquement.');
        if (kind === 'wish-add') check(await sb.from('hg_ss_wishes').insert({ edition_id: curEdition().id, user_id: A.uid, label, url }));
        else check(await sb.from('hg_ss_wishes').update({ label, url }).eq('id', form.dataset.id));
        await reloadDetail();
        toast(kind === 'wish-add' ? 'Souhait ajouté' : 'Souhait modifié', 'ok');
        if (kind === 'wish-add') $('#aw-new-l')?.focus();
      });
    }
  });
}
async function afterSS() { await reloadDetail(); await A.onChange('ss'); }

/* =========================================================
   Mode inspection : effet visuel quand une fiche de membre est ouverte
   (purement visuel, aucune donnée modifiée)
   ========================================================= */
const INSP = { bar: null, layer: null, fx: null, leaveT: 0 };
const inspReduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

function closeDetail() {
  A.uid = null; A.d = null;
  renderList();
  exitInspect();
  $('#acc-q')?.focus();
}
function inspIdentity() {
  const acc = A.accounts.find((a) => a.id === A.uid) || {};
  const p = A.d?.profile || { ...(A.avatars.get(A.uid) || {}), pseudo: acc.pseudo };
  return { ...(A.avatars.get(A.uid) || {}), ...p, pseudo: p.pseudo || acc.pseudo || 'Membre' };
}
function enterInspect() {
  clearTimeout(INSP.leaveT);
  const body = document.body;
  const fresh = !INSP.bar;
  if (fresh) {
    INSP.layer = document.createElement('div');
    INSP.layer.className = 'insp-layer';
    INSP.layer.setAttribute('aria-hidden', 'true');
    INSP.fx = document.createElement('div');
    INSP.fx.className = 'insp-fx';
    INSP.fx.setAttribute('aria-hidden', 'true');
    INSP.fx.innerHTML = '<div class="insp-frame"><i></i><i></i><i></i><i></i></div><div class="insp-scan"></div>';
    INSP.bar = document.createElement('div');
    INSP.bar.className = 'insp-bar';
    INSP.bar.setAttribute('role', 'region');
    INSP.bar.setAttribute('aria-label', 'Vue admin d\'un compte');
    INSP.bar.innerHTML = `<div class="insp-bar-in">
        <span class="insp-tag">${IC.eye}<span>Vue admin</span></span>
        <span class="insp-who" aria-live="polite"></span>
        <button class="btn btn-ghost btn-sm insp-quit" type="button">Quitter la vue</button>
      </div>`;
    INSP.bar.querySelector('.insp-quit').addEventListener('click', closeDetail);
    body.append(INSP.layer, INSP.fx, INSP.bar);
  }
  body.classList.remove('is-inspect-leaving');
  body.classList.add('is-inspecting');
  updateInspect();
  // rejoue le balayage d'entrée (y compris quand on passe d'une fiche à l'autre)
  if (!inspReduced()) {
    body.classList.remove('is-inspect-enter');
    void INSP.fx.offsetWidth;
    body.classList.add('is-inspect-enter');
  }
}
function updateInspect() {
  if (!INSP.bar || !A.uid) return;
  const p = inspIdentity();
  INSP.bar.querySelector('.insp-who').innerHTML = `${avatarHtml(p, 30)}<strong>${esc(p.pseudo)}</strong>`;
}
function exitInspect() {
  if (!INSP.bar) return;
  const body = document.body;
  const done = () => {
    body.classList.remove('is-inspecting', 'is-inspect-leaving', 'is-inspect-enter');
    INSP.layer?.remove(); INSP.fx?.remove(); INSP.bar?.remove();
    INSP.layer = INSP.fx = INSP.bar = null;
  };
  if (inspReduced()) return done();
  body.classList.add('is-inspect-leaving');
  INSP.leaveT = setTimeout(done, 320);
}
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || !A.uid || ev.defaultPrevented) return;
  if (document.querySelector('dialog[open]')) return;
  ev.preventDefault();
  closeDetail();
});
function selectTab(k, focus = false) {
  A.tab = k;
  $$('#comptes [role="tab"]').forEach((b) => { const on = b.dataset.tab === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  const panel = $('#acc-panel');
  panel.setAttribute('aria-labelledby', `acc-tab-${k}`);
  renderPanel();
  if (focus) $(`#acc-tab-${k}`)?.focus();
}

// Accès aux pages modifiés (ici ou dans la section « Accès aux pages ») : l'onglet « Accès » se met à jour
window.addEventListener('hg:access', () => {
  if (!A.uid || !A.d || A.tab !== 'acces') return;
  const f = document.activeElement?.dataset?.pageAccess;
  renderPanel();
  if (f) $(`[data-page-access="${CSS.escape(f)}"]`)?.focus();
});

/** Point d'entrée appelé par admin.js. onChange(kind) : 'members' | 'badges' | 'ss' | 'ideas' | 'support'. */
export async function initAccounts({ me, onChange }) {
  A.me = me; if (onChange) A.onChange = async (k) => { try { await onChange(k); } catch (e) { console.error(e); } };
  bindAccounts();
  bindSharedFields();
  try { await loadAccounts(); } catch (e) { A.listError = e; }
  renderList();
}
/** Recharge la liste (ex. après un changement fait ailleurs dans l'admin). */
export async function refreshAccounts() {
  try { await loadAccounts(); A.listError = null; } catch (e) { A.listError = e; }
  if (!A.uid) renderRows();
}
/** Ouvre la fiche d'un membre (utilisable depuis les autres sections). */
export function openAccountFiche(uid, tab) { return openAccount(uid, { tab }); }

/* =========================================================
   Secret Santa (section de l'admin) : champs transmis + attributions
   ========================================================= */
/** Bloc de cases « Informations transmises aux Santas » pour un formulaire d'édition. */
export function sharedFieldsHtml(prefix, selected = []) {
  const sel = new Set(selected || []);
  const total = INFO_FIELDS.length;
  return `
    <details class="sf-box"${sel.size ? '' : ' open'}>
      <summary><span class="sf-sum-title">Informations transmises aux Santas</span> <span class="pill pill-muted sf-count" data-sf-count>${sel.size} / ${total}</span></summary>
      <p class="small muted">Chaque Santa verra ces informations (si sa cible les a remplies) sous la liste de souhaits. Rien d'autre n'est partagé.</p>
      ${INFO_GROUPS.map((g) => `
        <fieldset class="sf-group" data-sf-group="${esc(g.id)}">
          <legend>${esc(g.label)}</legend>
          <div class="sf-group-actions">
            <button class="btn btn-ghost btn-sm" type="button" data-sf-all="1">Tout cocher</button>
            <button class="btn btn-ghost btn-sm" type="button" data-sf-all="0">Tout décocher</button>
          </div>
          <div class="sf-checks">${g.fields.map((f) => `
            <label class="check"><input type="checkbox" name="shared_fields" value="${esc(f.id)}" id="${esc(prefix)}-sf-${esc(f.id)}"${sel.has(f.id) ? ' checked' : ''}> <span>${esc(f.label)}</span></label>`).join('')}
          </div>
        </fieldset>`).join('')}
    </details>`;
}
/** Clés cochées, dans l'ordre de INFO_FIELDS. */
export function readSharedFields(form) {
  const on = new Set($$('input[name="shared_fields"]:checked', form).map((i) => i.value));
  return INFO_FIELDS.map((f) => f.id).filter((k) => on.has(k));
}
function updateSfCount(box) {
  const c = box?.querySelector('[data-sf-count]');
  if (c) c.textContent = `${$$('input[name="shared_fields"]:checked', box).length} / ${INFO_FIELDS.length}`;
}
let sfBound = false;
function bindSharedFields() {
  const sec = $('#secret-santa'); if (!sec || sfBound) return;
  sfBound = true;
  sec.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-sf-all]');
    if (b) {
      const on = b.dataset.sfAll === '1';
      $$('input[name="shared_fields"]', b.closest('fieldset')).forEach((i) => { i.checked = on; });
      updateSfCount(b.closest('.sf-box'));
      return;
    }
    const p = ev.target.closest('[data-pairs]');
    if (p) togglePairs(p);
  });
  sec.addEventListener('change', (ev) => { if (ev.target.name === 'shared_fields') updateSfCount(ev.target.closest('.sf-box')); });
}

/** Bloc « Attributions » (masqué par défaut). À insérer dans la section Secret Santa une fois le tirage fait. */
export function pairsBlockHtml(edition) {
  if (!edition?.drawn_at) return '';
  return `
    <div class="card stack ss-pairs" id="ss-pairs" data-edition="${esc(edition.id)}">
      <h3 class="card-title">Attributions ${esc(edition.year)}</h3>
      <p class="small muted">Qui offre à qui. Masqué par défaut pour éviter de te gâcher la surprise. Pour modifier une attribution, ouvre la fiche du membre dans « Comptes ».</p>
      <div class="btn-row"><button class="btn btn-ghost" type="button" data-pairs="show" aria-expanded="false" aria-controls="ss-pairs-body">${IC.eye} Afficher les attributions</button></div>
      <div id="ss-pairs-body" hidden></div>
    </div>`;
}
async function togglePairs(btn) {
  const box = btn.closest('#ss-pairs'), body = $('#ss-pairs-body', box);
  if (btn.dataset.pairs === 'hide') {
    body.hidden = true; body.innerHTML = '';
    btn.dataset.pairs = 'show'; btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `${IC.eye} Afficher les attributions`;
    return;
  }
  await busy(btn, async () => {
    const ed = box.dataset.edition;
    const [a, p] = await Promise.all([
      sb.from('hg_ss_assignments').select('giver_id, receiver_id').eq('edition_id', ed),
      sb.from('hg_ss_participants').select('user_id, sent_at, received_at').eq('edition_id', ed),
    ]);
    const rows = check(a) ?? [], parts = check(p) ?? [];
    if (!A.accounts.length) await loadAccounts().catch(() => {});
    const st = new Map(parts.map((x) => [x.user_id, x]));
    const givers = new Set(rows.map((r) => r.giver_id)), receivers = new Set(rows.map((r) => r.receiver_id));
    const noTarget = parts.filter((x) => !givers.has(x.user_id)).map((x) => pseudoOf(x.user_id));
    const noSanta = parts.filter((x) => !receivers.has(x.user_id)).map((x) => pseudoOf(x.user_id));
    const sorted = rows.slice().sort((x, y) => pseudoOf(x.giver_id).localeCompare(pseudoOf(y.giver_id), 'fr'));
    body.innerHTML = `
      ${sorted.length ? `<div class="pairs-table" role="table" aria-label="Attributions">
        <div class="pairs-tr pairs-th" role="row"><span role="columnheader">Santa</span><span role="columnheader"><span class="visually-hidden">offre à</span></span><span role="columnheader">Cible</span><span role="columnheader">Envoyé</span><span role="columnheader">Reçu</span></div>
        ${sorted.map((r) => `<div class="pairs-tr" role="row">
          <span role="cell"><button class="linkish" type="button" data-open-fiche="${esc(r.giver_id)}">${esc(pseudoOf(r.giver_id))}</button></span>
          <span role="cell" class="pairs-arrow" aria-hidden="true">${IC.arrow}</span>
          <span role="cell"><button class="linkish" type="button" data-open-fiche="${esc(r.receiver_id)}">${esc(pseudoOf(r.receiver_id))}</button></span>
          <span role="cell" class="small">${st.get(r.giver_id)?.sent_at ? `<span class="pill pill-ok">${esc(fmtDate(st.get(r.giver_id).sent_at))}</span>` : '<span class="muted">—</span>'}</span>
          <span role="cell" class="small">${st.get(r.receiver_id)?.received_at ? `<span class="pill pill-ok">${esc(fmtDate(st.get(r.receiver_id).received_at))}</span>` : '<span class="muted">—</span>'}</span>
        </div>`).join('')}
      </div>` : '<div class="empty">Aucune attribution enregistrée.</div>'}
      ${noTarget.length ? `<p class="small pairs-warn">Sans cible : ${esc(noTarget.join(', '))}</p>` : ''}
      ${noSanta.length ? `<p class="small pairs-warn">Sans Santa : ${esc(noSanta.join(', '))}</p>` : ''}`;
    body.hidden = false;
    btn.dataset.pairs = 'hide'; btn.setAttribute('aria-expanded', 'true');
    btn.innerHTML = `${IC.eyeOff} Masquer les attributions`;
  });
}
// Clic sur un pseudo du tableau des attributions -> fiche du membre, onglet Secret Santa
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-open-fiche]');
  if (!b) return;
  A.ssEdition = b.closest('#ss-pairs')?.dataset.edition || A.ssEdition;
  openAccount(b.dataset.openFiche, { tab: 'ss' }).then(() => { A.showPair = true; if (A.d) renderPanel(); });
});

