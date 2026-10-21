// Comptes admin : fiche d'un membre (chargement, en-tête, onglets, sélection d'onglet).
import { sb, toast, errMsg, esc, $, $$, fmtDate, fmtDateTime, avatarHtml } from '../core.js';
import { ensureAccessData, memberAccessHtml } from '../admin-access.js';
import { IC } from './common.js';
import { A, H, TABS, root, CACHE, dropFicheCache } from './state.js';
import { isAdminView } from '../admin/perms.js';
import { permLabel } from '../admin-staff.js';
import { enterInspect, updateInspect } from './inspect.js';
import { profileHtml, infosHtml } from './profile.js';
import { ssHtml } from './ss.js';
import { irlHtml, photosHtml, contribHtml, badgesHtml } from './activity.js';

/* =========================================================
   Fiche d'un membre
   Chargement par onglet : seul l'onglet ouvert lit ses données (profil + Staff à l'ouverture).
   Les lectures sont gardées pendant la visite de la page (CACHE) ; toute modification les vide.
   ========================================================= */
async function q(p) { const r = await p; return { data: r.data, error: r.error }; }
const DATA_FIELDS = ['info', 'editions', 'parts', 'assigns', 'wishes', 'events', 'rsvps', 'photos', 'ideas', 'support', 'badges', 'ubadges'];

/** Renseigne A.d[name] une seule fois (depuis le cache si la lecture existe déjà). */
async function fill(name, key, read) {
  const d = A.d;
  if (!d || d[name] !== undefined) return;
  if (!CACHE.has(key)) CACHE.set(key, Promise.resolve(read()).then((r) => { if (r.error) CACHE.delete(key); return r; }));
  const r = await CACHE.get(key);
  if (A.d === d && d[name] === undefined) d[name] = r;
}

const SOURCE = {
  info: (uid) => () => q(sb.from('hg_profile_info').select('data, updated_at').eq('user_id', uid).maybeSingle()),
  editions: () => q(sb.from('hg_ss_editions').select('id, year, status, drawn_at').order('year', { ascending: false })),
  parts: (ed) => () => q(sb.from('hg_ss_participants').select('edition_id, user_id, sent_at, received_at, joined_at').eq('edition_id', ed)),
  assigns: (ed) => () => q(sb.from('hg_ss_assignments').select('edition_id, giver_id, receiver_id').eq('edition_id', ed)),
  wishes: (uid) => () => q(sb.from('hg_ss_wishes').select('id, edition_id, label, url, created_at').eq('user_id', uid).order('created_at')),
  events: () => q(sb.from('hg_events').select('id, title, starts_at, location').order('starts_at', { ascending: false, nullsFirst: false })),
  rsvps: (uid) => () => q(sb.from('hg_event_rsvps').select('event_id, status, updated_at').eq('user_id', uid)),
  photos: (uid) => async () => {
    const r = await q(sb.from('hg_photos').select('id, event_id, path, caption, created_at').eq('user_id', uid).order('created_at', { ascending: false }));
    const signed = new Map(); // miniatures signées (bucket privé)
    const paths = (r.data ?? []).map((p) => p.path);
    if (paths.length) {
      const { data: urls, error } = await sb.storage.from('hg-photos').createSignedUrls(paths, 3600);
      if (error) console.warn('[photos]', error);
      for (const u of urls ?? []) if (u.signedUrl) signed.set(u.path, u.signedUrl);
    }
    return { ...r, signed };
  },
  ideas: (uid) => () => q(sb.from('hg_ideas').select('*').eq('user_id', uid).order('created_at', { ascending: false })),
  support: (uid) => () => q(sb.from('hg_support').select('*').eq('user_id', uid).order('created_at', { ascending: false })),
  badges: () => q(sb.from('hg_badges').select('code, name, description, image_url, sort').order('sort')),
  ubadges: (uid) => () => q(sb.from('hg_user_badges').select('badge_code, awarded_at').eq('user_id', uid)),
};

/** Lectures nécessaires à un onglet (le profil et le Staff sont toujours chargés). */
async function loadTab(k, uid) {
  const d = A.d;
  if (k === 'infos') return fill('info', `${uid}|info`, SOURCE.info(uid));
  if (k === 'ss') {
    await fill('editions', 'editions', SOURCE.editions);
    const eds = d.editions?.data ?? [];
    if (!eds.some((e) => e.id === A.ssEdition)) A.ssEdition = eds[0]?.id ?? null;
    const ed = A.ssEdition;
    if (!ed) return;
    if (d.edition !== ed) { d.edition = ed; d.parts = undefined; d.assigns = undefined; } // participants et tirage : de l'édition affichée
    await Promise.all([
      fill('parts', `ss|${ed}|parts`, SOURCE.parts(ed)),
      fill('assigns', `ss|${ed}|assigns`, SOURCE.assigns(ed)),
      fill('wishes', `${uid}|wishes`, SOURCE.wishes(uid)),
    ]);
    return;
  }
  if (k === 'irl') return Promise.all([fill('events', 'events', SOURCE.events), fill('rsvps', `${uid}|rsvps`, SOURCE.rsvps(uid))]);
  if (k === 'photos') return Promise.all([fill('events', 'events', SOURCE.events), fill('photos', `${uid}|photos`, SOURCE.photos(uid))]).then(() => {
    if (A.d === d && d.signed === undefined) d.signed = d.photos?.signed ?? new Map();
  });
  if (k === 'contrib') return Promise.all([fill('ideas', `${uid}|ideas`, SOURCE.ideas(uid)), fill('support', `${uid}|support`, SOURCE.support(uid))]);
  if (k === 'badges') return Promise.all([fill('badges', 'badges', SOURCE.badges), fill('ubadges', `${uid}|ubadges`, SOURCE.ubadges(uid))]);
  if (k === 'acces') { await ensureAccessData().catch(() => null); return; } // l'erreur s'affiche dans l'onglet
}

/** Charge l'onglet demandé (sans toucher aux autres) ; A.d peut avoir changé entre-temps : on ne renseigne que la fiche courante. */
async function ensureTab(k) {
  const uid = A.uid;
  await loadTab(k, uid);
}

/** Lectures de base : profil (erreur bloquante) et Staff (administrateur). */
async function loadBase(uid) {
  const [profile, staffRes] = await Promise.all([
    q(sb.from('hg_profiles').select('*').eq('id', uid).maybeSingle()),
    isAdminView() ? q(sb.rpc('hg_staff_list')) : Promise.resolve({ data: null, error: null }),
  ]);
  if (profile.error) throw profile.error;
  if (!profile.data) throw new Error('Profil introuvable.');
  return {
    profile: profile.data,
    // Statut Staff du membre : visible de l'administrateur seulement (liste réservée à l'admin)
    staff: (staffRes.data ?? []).find((s) => s.user_id === uid) ?? null,
  };
}

export async function openAccount(uid, { tab } = {}) {
  A.uid = uid; A.tab = tab || 'profil'; A.showPair = false; A.d = { signed: new Map() };
  root().innerHTML = `${detailHead()}<div class="empty">Chargement de la fiche…</div>`;
  enterInspect();
  $('#comptes').scrollIntoView({ block: 'start' });
  try {
    const base = await loadBase(uid);
    if (A.uid !== uid) return;
    Object.assign(A.d, base);
    await ensureTab(A.tab);
    if (A.uid !== uid) return;
    renderDetail();
    updateInspect();
  } catch (e) {
    root().innerHTML = `${detailHead()}<div class="empty">Impossible de charger la fiche : ${esc(errMsg(e))}</div>`;
  }
}
/** Relit la fiche après une modification : cache vidé, profil et onglet ouvert relus. */
export async function reloadDetail() {
  const uid = A.uid; if (!uid || !A.d) return;
  dropFicheCache();
  try {
    const base = await loadBase(uid);
    if (A.uid !== uid) return;
    const d = A.d;
    for (const f of DATA_FIELDS) delete d[f];
    d.signed = new Map(); d.edition = undefined;
    Object.assign(d, base);
    await ensureTab(A.tab);
    if (A.uid !== uid) return;
    renderDetail(); updateInspect();
  } catch (e) { toast(errMsg(e), 'error'); }
}

/** Vrai si la fiche ouverte est celle d'un fantôme (pas encore inscrit). */
const isGhostFiche = () => !!(A.d?.profile?.is_ghost ?? A.accounts.find((a) => a.id === A.uid)?.is_ghost);

/** Pastille « Staff » et permissions accordées (administrateur seulement). */
function staffLineHtml(st) {
  if (!st || !isAdminView()) return '';
  const perms = st.perms?.length ? st.perms.map((k) => `<span class="pill pill-muted">${esc(permLabel(k))}</span>`).join('') : '<span class="small muted">aucune permission</span>';
  return `<div class="acc-staff"><span class="pill pill-ok">Staff</span>${st.active ? '' : ' <span class="pill pill-muted">inactif</span>'} ${perms}</div>`;
}

function detailHead() {
  const acc = A.accounts.find((a) => a.id === A.uid) || {};
  const p = A.d?.profile || { pseudo: acc.pseudo };
  const ghost = isGhostFiche();
  return `
    <div class="acc-detail-top">
      <button class="btn btn-ghost btn-sm" type="button" data-act="back">${IC.back} Tous les comptes</button>
    </div>
    <div class="acc-ident">
      ${avatarHtml(p, 56)}
      <div class="acc-ident-txt">
        <h3 class="acc-ident-name">${esc(p.pseudo || acc.pseudo || 'Membre')}${ghost ? ' <span class="pill pill-muted">(fantôme)</span>' : ''}</h3>
        ${ghost
          ? '<div class="small muted">Fantôme : pas encore inscrit. Tout ce que tu ajoutes ici suivra la personne à son inscription.</div>'
          : `<div class="small muted">${esc(acc.email || '')}${acc.created_at ? ` · inscrit le ${esc(fmtDate(acc.created_at))}` : ''}${acc.last_sign_in_at ? ` · vu le ${esc(fmtDateTime(acc.last_sign_in_at))}` : ''}</div>`}
${staffLineHtml(A.d?.staff)}
      </div>
      ${p.is_admin ? '<span class="pill pill-ok">admin</span>' : ''}
    </div>`;
}

export function renderDetail() {
  root().innerHTML = `
    ${detailHead()}
    <div class="acc-tabs" role="tablist" aria-label="Données du membre">
      ${TABS.filter(([k]) => !(isGhostFiche() && k === 'acces')).map(([k, l]) => `<button class="acc-tab" type="button" role="tab" id="acc-tab-${k}" data-tab="${k}" aria-controls="acc-panel" aria-selected="${k === A.tab}" tabindex="${k === A.tab ? 0 : -1}">${esc(l)}${tabCount(k)}</button>`).join('')}
    </div>
    <div class="card acc-panel" id="acc-panel" role="tabpanel" aria-labelledby="acc-tab-${A.tab}" tabindex="0">${panelHtml()}</div>`;
}
/** Compteur de l'onglet : seulement si ses données sont déjà lues (pas de requête pour le seul affichage). */
function tabCount(k) {
  const d = A.d; let n = 0;
  if (k === 'photos') n = d.photos?.data?.length ?? 0;
  if (k === 'contrib') n = (d.ideas?.data?.length ?? 0) + (d.support?.data?.length ?? 0);
  if (k === 'badges') n = d.ubadges?.data?.length ?? 0;
  return n ? ` <span class="acc-tab-n">${n}</span>` : '';
}
/** Vrai si les lectures de l'onglet sont déjà là. */
function tabReady(k) {
  const d = A.d;
  switch (k) {
    case 'profil': return true;
    case 'infos': return d.info !== undefined;
    case 'ss': return d.editions !== undefined && d.edition === A.ssEdition && d.parts !== undefined && d.assigns !== undefined && d.wishes !== undefined;
    case 'irl': return d.events !== undefined && d.rsvps !== undefined;
    case 'photos': return d.photos !== undefined && d.events !== undefined;
    case 'contrib': return d.ideas !== undefined && d.support !== undefined;
    case 'badges': return d.badges !== undefined && d.ubadges !== undefined;
    default: return false;
  }
}
export function renderPanel() {
  const panel = $('#acc-panel'); if (!panel) return renderDetail();
  panel.innerHTML = panelHtml();
}

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

export async function selectTab(k, focus = false) {
  A.tab = k;
  $$('#comptes [role="tab"]').forEach((b) => { const on = b.dataset.tab === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  const panel = $('#acc-panel');
  panel.setAttribute('aria-labelledby', `acc-tab-${k}`);
  if (!A.d || tabReady(k)) renderPanel();
  else {
    // Première ouverture de l'onglet : seules ses données sont lues
    const uid = A.uid;
    panel.innerHTML = '<div class="empty">Chargement…</div>';
    try { await ensureTab(k); } catch (e) { if (A.uid === uid) panel.innerHTML = `<div class="empty">Impossible de charger : ${esc(errMsg(e))}</div>`; return; }
    if (A.uid !== uid || A.tab !== k) return;
    renderPanel();
    renderDetailCounts();
  }
  if (focus) $(`#acc-tab-${k}`)?.focus();
}
/** Met à jour les compteurs des onglets sans reconstruire la fiche (le focus reste sur l'onglet). */
function renderDetailCounts() {
  $$('#comptes .acc-tab').forEach((b) => {
    const k = b.dataset.tab;
    const label = TABS.find(([x]) => x === k)?.[1] ?? '';
    const n = tabCount(k);
    b.innerHTML = `${esc(label)}${n}`;
  });
}

// Accès aux pages modifiés (ici ou dans la section « Accès aux pages ») : l'onglet « Accès » se met à jour
window.addEventListener('hg:access', () => {
  if (!A.uid || !A.d || A.tab !== 'acces') return;
  const f = document.activeElement?.dataset?.pageAccess;
  renderPanel();
  if (f) $(`[data-page-access="${CSS.escape(f)}"]`)?.focus();
});

/** Ouvre la fiche d'un membre (utilisable depuis les autres sections). */
export function openAccountFiche(uid, tab) { return openAccount(uid, { tab }); }

H.renderPanel = renderPanel;
H.renderDetail = renderDetail;
