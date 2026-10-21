// Comptes admin : fiche d'un membre (chargement, en-tête, onglets, sélection d'onglet).
import { sb, toast, errMsg, esc, $, $$, fmtDate, fmtDateTime, avatarHtml } from '../core.js';
import { ensureAccessData, memberAccessHtml } from '../admin-access.js';
import { IC } from './common.js';
import { A, H, TABS, root } from './state.js';
import { enterInspect, updateInspect } from './inspect.js';
import { profileHtml, infosHtml } from './profile.js';
import { ssHtml } from './ss.js';
import { irlHtml, photosHtml, contribHtml, badgesHtml } from './activity.js';

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

export async function openAccount(uid, { tab } = {}) {
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
export async function reloadDetail() {
  try { A.d = await loadDetail(A.uid); renderDetail(); updateInspect(); } catch (e) { toast(errMsg(e), 'error'); }
}

/** Vrai si la fiche ouverte est celle d'un fantôme (pas encore inscrit). */
const isGhostFiche = () => !!(A.d?.profile?.is_ghost ?? A.accounts.find((a) => a.id === A.uid)?.is_ghost);

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
function tabCount(k) {
  const d = A.d; let n = 0;
  if (k === 'photos') n = d.photos.data?.length ?? 0;
  if (k === 'contrib') n = (d.ideas.data?.length ?? 0) + (d.support.data?.length ?? 0);
  if (k === 'badges') n = d.ubadges.data?.length ?? 0;
  return n ? ` <span class="acc-tab-n">${n}</span>` : '';
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
  if (focus) $(`#acc-tab-${k}`)?.focus();
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
