// Comptes admin : fiche d'un membre (chargement, en-tête, onglets, résumé du panneau d'infos).
// L'onglet suit l'URL : #membres/comptes/<id>/<onglet>.
import { sb, toast, errMsg, esc, $, $$, fmtDate, fmtDateTime } from '../core.js';
import { ensureAccessData, memberAccessHtml } from '../admin-access.js';
import { renderDetailHeader } from '../admin/ui/detail-header.js';
import { renderInfoPanel } from '../admin/ui/info-panel.js';
import { A, H, TABS, root } from './state.js';
import { isAdminView } from '../admin/perms.js';
import { permLabel } from '../admin-staff.js';
import { closeDetail } from './inspect.js';
import { profileHtml, infosHtml } from './profile.js';
import { ssHtml } from './ss.js';
import { irlHtml, photosHtml, contribHtml, badgesHtml } from './activity.js';
import { roleOf, selectInList } from './list.js';

/* =========================================================
   Fiche d'un membre
   ========================================================= */
async function q(p) { const r = await p; return { data: r.data, error: r.error }; }
async function loadDetail(uid) {
  const [profile, info, editions, parts, wishes, assigns, events, rsvps, photos, ideas, support, badges, ubadges, wallet, cards] = await Promise.all([
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
    q(sb.from('hg_wallets').select('paillettes').eq('user_id', uid).maybeSingle()), // résumé : Paillettes
    q(sb.from('hg_card_copies').select('id').eq('owner_id', uid)),                  // résumé : Cartes
    ensureAccessData().catch(() => null), // accès aux pages (onglet « Accès ») ; l'erreur s'affiche dans l'onglet
  ]);
  if (profile.error) throw profile.error;
  if (!profile.data) throw new Error('Profil introuvable.');
  // Statut Staff du membre : visible de l'administrateur seulement (liste réservée à l'admin)
  const staffRes = isAdminView() ? await q(sb.rpc('hg_staff_list')) : { data: null, error: null };
  const d = {
    profile: profile.data, info, staff: (staffRes.data ?? []).find((s) => s.user_id === uid) ?? null, editions, parts, wishes, assigns, events, rsvps, photos, ideas, support, badges, ubadges,
    wallet, cards, signed: new Map(),
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

const tabOf = (t) => (TABS.some(([k]) => k === t) ? t : 'profil');

/** Ouvre la fiche d'un membre dans la zone principale (URL déjà à jour). */
export async function openAccount(uid, { tab } = {}) {
  A.uid = uid; A.tab = tabOf(tab); A.showPair = false; A.d = null;
  root().innerHTML = '<div class="empty">Chargement de la fiche…</div>';
  selectInList(uid);
  paintInfo();
  try {
    const d = await loadDetail(uid);
    if (A.uid !== uid) return;
    A.d = d;
    if (!A.d.editions.data?.some((e) => e.id === A.ssEdition)) A.ssEdition = A.d.editions.data?.[0]?.id ?? null;
    if (isGhostFiche() && A.tab === 'acces') A.tab = 'profil';
    renderDetail();
  } catch (e) {
    if (A.uid !== uid) return;
    root().innerHTML = `<div class="empty">Impossible de charger la fiche : ${esc(errMsg(e))}</div>`;
    paintInfo();
  }
}
export async function reloadDetail() {
  try { A.d = await loadDetail(A.uid); renderDetail(); } catch (e) { toast(errMsg(e), 'error'); }
}

/** Écran sans élément choisi : la zone principale invite à choisir dans la liste. */
export function emptyDetail() {
  A.uid = null; A.d = null; A.showPair = false;
  selectInList(null);
  root().innerHTML = `<div class="acc-empty">
      <p class="acc-empty-t">Choisis un membre dans la liste</p>
      <p class="small muted">Sa fiche s'ouvre ici : profil, Secret Santa, sorties, photos, badges et accès aux pages.</p>
    </div>`;
  paintInfo();
}

/** Fournisseur `open` de la sous-section : affiche la fiche de l'URL (#membres/comptes/<id>/<onglet>). */
export function showAccount(uid, tab) {
  if (!uid) { emptyDetail(); return; }
  const t = tabOf(tab);
  if (A.uid === uid && A.d) {
    selectInList(uid);
    if (t !== A.tab) selectTab(t);
    return;
  }
  return openAccount(uid, { tab: t });
}

/** Vrai si la fiche ouverte est celle d'un fantôme (pas encore inscrit). */
const isGhostFiche = () => !!(A.d?.profile?.is_ghost ?? A.accounts.find((a) => a.id === A.uid)?.is_ghost);

/** Pastille « Staff » et permissions accordées (administrateur seulement). */
function staffLineHtml(st) {
  if (!st || !isAdminView()) return '';
  const perms = st.perms?.length ? st.perms.map((k) => `<span class="pill pill-muted">${esc(permLabel(k))}</span>`).join('') : '<span class="small muted">aucune permission</span>';
  return `<div class="acc-staff"><span class="pill pill-ok">Staff</span>${st.active ? '' : ' <span class="pill pill-muted">inactif</span>'} ${perms}</div>`;
}

/** En-tête de la fiche : composant commun (admin/ui/detail-header.js) + ligne Staff / admin. */
function paintHead() {
  const host = $('#acc-dh'); if (!host) return;
  const acc = A.accounts.find((a) => a.id === A.uid) || {};
  const p = A.d?.profile || { pseudo: acc.pseudo };
  const ghost = isGhostFiche();
  const subtitle = ghost
    ? 'Fantôme : pas encore inscrit. Tout ce que tu ajoutes ici suivra la personne à son inscription.'
    : [acc.email, acc.created_at ? `inscrit le ${fmtDate(acc.created_at)}` : '', acc.last_sign_in_at ? `vu le ${fmtDateTime(acc.last_sign_in_at)}` : '']
      .filter(Boolean).join(' · ');
  renderDetailHeader(host, {
    member: { pseudo: p.pseudo || acc.pseudo || '?', avatar_url: p.avatar_url, color: p.color },
    title: `${p.pseudo || acc.pseudo || 'Membre'}${ghost ? ' (fantôme)' : ''}`,
    subtitle,
    actions: [{ label: 'Fermer la fiche', onClick: closeDetail }],
  });
  const meta = $('#acc-meta');
  if (meta) meta.innerHTML = `${p.is_admin ? '<span class="pill pill-ok">admin</span> ' : ''}${staffLineHtml(A.d?.staff)}`;
}

function tabCount(k) {
  const d = A.d; let n = 0;
  if (k === 'photos') n = d.photos.data?.length ?? 0;
  if (k === 'contrib') n = (d.ideas.data?.length ?? 0) + (d.support.data?.length ?? 0);
  if (k === 'badges') n = d.ubadges.data?.length ?? 0;
  return n ? ` <span class="acc-tab-n">${n}</span>` : '';
}

export function renderDetail() {
  root().innerHTML = `
    <div id="acc-dh"></div>
    <div class="acc-meta" id="acc-meta"></div>
    <div class="acc-tabs" role="tablist" aria-label="Données du membre">
      ${TABS.filter(([k]) => !(isGhostFiche() && k === 'acces')).map(([k, l]) => `<button class="acc-tab" type="button" role="tab" id="acc-tab-${k}" data-tab="${k}" aria-controls="acc-panel" aria-selected="${k === A.tab}" tabindex="${k === A.tab ? 0 : -1}">${esc(l)}${tabCount(k)}</button>`).join('')}
    </div>
    <div class="card acc-panel" id="acc-panel" role="tabpanel" aria-labelledby="acc-tab-${A.tab}" tabindex="0">${panelHtml()}</div>`;
  paintHead();
  paintInfo();
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

export function selectTab(k, focus = false) {
  A.tab = k;
  $$('#comptes [role="tab"]').forEach((b) => { const on = b.dataset.tab === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  const panel = $('#acc-panel');
  panel.setAttribute('aria-labelledby', `acc-tab-${k}`);
  renderPanel();
  // L'onglet suit l'URL sans nouvelle entrée d'historique (le routeur ne réagit pas à replaceState)
  if (A.uid) history.replaceState(null, '', `#membres/comptes/${A.uid}/${k}`);
  if (focus) $(`#acc-tab-${k}`)?.focus();
}

/* =========================================================
   Panneau d'infos (colonne 4 : résumé du membre)
   ========================================================= */
let infoH = null;
/** Fournisseur `info` de la sous-section : le contenu est repeint à chaque changement de fiche. */
export function mountAccountsInfo(el) {
  el.innerHTML = '<div id="acc-info"></div>';
  paintInfo();
}

export function paintInfo() {
  const host = $('#acc-info'); if (!host) return;
  infoH?.destroy(); infoH = null;
  if (!A.uid || !A.d) { host.innerHTML = '<p class="ui-info-empty">Sélectionne un membre pour voir son résumé.</p>'; return; }
  const d = A.d; const p = d.profile;
  const acc = A.accounts.find((a) => a.id === A.uid) || {};
  const ghost = isGhostFiche();
  const role = roleOf({ ...acc, is_ghost: ghost, is_admin: !!p.is_admin });
  const nf = (n) => Number(n || 0).toLocaleString('fr-CH');
  const sorties = (d.rsvps.data ?? []).filter((r) => r.status === 'oui').length;
  const ss = (d.parts.data ?? []).filter((x) => x.user_id === A.uid).length;
  const history = (d.support.data ?? []).slice(0, 5).map((s) => ({
    id: s.id, title: s.subject || 'Demande',
    status: s.status === 'ouverte' ? { label: 'Ouverte', tone: 'open' } : { label: 'Traitée', tone: 'done' },
    at: s.created_at,
  }));
  const actions = [
    { label: 'Modifier le profil', onClick: () => selectTab('profil') },
    { label: 'Secret Santa', onClick: () => selectTab('ss') },
    { label: 'Badges', onClick: () => selectTab('badges') },
    ...(ghost ? [] : [{ label: 'Accès aux pages', onClick: () => selectTab('acces') }]),
  ];
  infoH = renderInfoPanel(host, {
    member: { pseudo: p.pseudo || acc.pseudo || '?', avatar_url: p.avatar_url, color: p.color, since: acc.created_at || null, lastSeen: acc.last_sign_in_at || null },
    statsTitle: 'Résumé',
    stats: [
      { value: nf(d.wallet.data?.paillettes), label: 'Paillettes' },
      { value: nf(d.cards.data?.length), label: 'Cartes' },
      { value: nf(sorties), label: 'Sorties IRL' },
      { value: nf(ss), label: 'Secret Santa' },
      { value: nf(d.ubadges.data?.length), label: 'Badges' },
      { value: role.label, label: 'Rôle' },
    ],
    historyTitle: "Demandes d'assistance",
    history,
    actions,
  });
}

/** Ouvre la fiche d'un membre depuis une autre section : change l'URL, la sous-section affiche la fiche. */
export function openAccountFiche(uid, tab) {
  const h = `#membres/comptes/${uid}${tab ? `/${tab}` : ''}`;
  if (location.hash === h) return openAccount(uid, { tab: tabOf(tab) });
  location.hash = h;
}

// Accès aux pages modifiés (ici ou dans la section « Accès aux pages ») : l'onglet « Accès » se met à jour
window.addEventListener('hg:access', () => {
  if (!A.uid || !A.d || A.tab !== 'acces') return;
  const f = document.activeElement?.dataset?.pageAccess;
  renderPanel();
  if (f) $(`[data-page-access="${CSS.escape(f)}"]`)?.focus();
});

H.renderPanel = renderPanel;
H.renderDetail = renderDetail;
