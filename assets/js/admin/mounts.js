// Admin : montage paresseux des sections. Chaque section est montée une seule fois, quand elle approche de l'écran
// (ou quand un lien direct, la palette ou une autre section l'ouvre). Les données partagées passent par admin/loaders.js.
// Ce module ne fait aucune requête lui-même : il appelle l'initialisation de chaque section dans l'ordre d'origine.
import { $, toast, errMsg } from '../core.js';
import { mountGhostsSection, refreshGhostsSection } from '../admin-ghosts.js';
import { mountAccessSection, refreshAccessSection } from '../admin-access.js';
import { mountInviteLinks, refreshInviteLinks } from '../admin-invite-links.js';
import { mountEventsSection } from '../admin-events.js';
import { mountCardsSection } from '../admin-cards.js';
import { mountChallengesSection } from '../admin-challenges.js';
import { mountStaffSection } from '../admin-staff.js';
import { mountSortiesSection } from '../admin-sorties/index.js';
import { mountSouvenirsSection } from '../admin-souvenirs/index.js';
import { mountReglagesSection } from '../admin-reglages/view.js';
import { mountMessagesSection } from '../admin-messages.js';
import { mountLogSection } from '../admin-log.js';
import { mountBotSection } from '../admin-bot.js';
import { mountThemesSection } from '../admin-themes.js';
import { initAccounts, refreshAccounts, openAccountFiche } from '../admin-accounts.js';
import { A, TABS } from '../admin-accounts/state.js';
import { pseudoOf } from './state.js';
import { sectionError } from './common.js';
import { ensureMembers, ensureInvites, ensureBadges, ensureIdeas, ensureSupport, ensureSS, forget } from './loaders.js';
import { renderStats } from './overview.js';
import { bindInvites, renderInvites } from './invites.js';
import { renderSS } from './ss-render.js';
import { bindSecretSanta } from './ss-events.js';
import { bindBadges, renderBadges } from './badges.js';
import { bindIdeas, renderIdeas } from './ideas.js';
import { bindSupport, renderSupport } from './support.js';
import { canSection, isAdminView } from './perms.js';

export const CTX = { me: null };
const RUN = new Map();   // id -> promesse du montage (un seul montage par section)
const READY = new Set(); // sections montées avec succès
export const isReady = (id) => READY.has(id);

/** Adresse d'une fiche membre : comptes/<id>[/<onglet>] (le profil est l'onglet par défaut, sans suffixe). */
export const fichePath = (uid, tab = 'profil') => (tab && tab !== 'profil' ? `comptes/${uid}/${tab}` : `comptes/${uid}`);
/** Remplace l'adresse sans créer d'entrée d'historique ni déclencher hashchange. */
export function setHash(path) {
  const h = '#' + path;
  if (location.hash !== h) history.replaceState(null, '', h);
}

/* ---------- Dépendances de chaque section (données partagées) ---------- */
const reloadMembers = () => { forget('members'); return ensureMembers(); };

/** Après une modification d'un membre : seules les parties qui affichent un pseudo sont rafraîchies. */
async function onAccountsChange(kind) {
  if (kind === 'members') {
    await reloadMembers();
    if (isReady('acces')) refreshAccessSection();
    if (isReady('membres')) { renderInvites(); refreshInviteLinks(); }
    if (isReady('badges')) renderBadges();
    if (isReady('secret-santa')) renderSS();
    if (isReady('idees')) renderIdeas();
    if (isReady('assistance')) renderSupport();
  }
  if (kind === 'badges') { forget('badges'); await ensureBadges(); if (isReady('badges')) renderBadges(); }
  if (kind === 'ss') { forget('ss'); await ensureSS(); if (isReady('secret-santa')) renderSS(); }
  if (kind === 'ideas') { forget('ideas'); await ensureIdeas(); if (isReady('idees')) renderIdeas(); }
  if (kind === 'support') { forget('support'); await ensureSupport(); if (isReady('assistance')) renderSupport(); }
  renderStats();
}
async function onGhostsChange() {
  await reloadMembers();
  if (isReady('comptes')) await refreshAccounts();
  if (isReady('badges')) renderBadges();
  renderStats();
}
async function onInvitesChange() { forget('invites'); await ensureInvites(); renderInvites(); renderStats(); }
async function onBadgesChange() { forget('badges'); await ensureBadges(); if (isReady('badges')) renderBadges(); }

/* ---------- Initialisation de chaque section (une fois) ---------- */
const MOUNTS = {
  apercu: async () => {
    // Tuiles : seulement les données des sections accessibles
    const need = [];
    if (canSection('comptes')) need.push(ensureMembers());
    if (canSection('membres')) need.push(ensureInvites());
    if (canSection('secret-santa')) need.push(ensureSS());
    if (canSection('idees')) need.push(ensureIdeas());
    if (canSection('assistance')) need.push(ensureSupport());
    const failed = (await Promise.allSettled(need)).find((r) => r.status === 'rejected');
    if (failed) { console.error(failed.reason); toast(`Vue d'ensemble : ${errMsg(failed.reason)}`, 'error'); }
    renderStats();
  },
  comptes: () => initAccounts({ me: CTX.me, onChange: onAccountsChange }),
  fantomes: async () => {
    mountGhostsSection($('#ghosts-root'), { openFiche: (uid) => openFiche(uid), onChange: onGhostsChange });
    await refreshGhostsSection();
  },
  acces: () => mountAccessSection($('#access-root'), { openMember: (uid) => openFiche(uid, 'acces') }),
  membres: async () => {
    bindInvites(CTX.me);
    await Promise.all([ensureMembers(), ensureInvites()]);
    renderInvites();
    await mountInviteLinks($('#links-root'), { me: CTX.me, pseudoOf, onChange: onInvitesChange });
  },
  'secret-santa': async () => {
    bindSecretSanta();
    await Promise.all([ensureMembers(), ensureSS()]);
    renderSS();
  },
  sorties: () => mountSortiesSection($('#sorties-root'), { me: CTX.me }),
  badges: async () => {
    bindBadges();
    await Promise.all([ensureMembers(), ensureBadges()]);
    renderBadges();
  },
  evenements: () => mountEventsSection($('#events-root'), { onBadgesChange }),
  souvenirs: () => mountSouvenirsSection($('#souvenirs-root'), { me: CTX.me }),
  cartes: () => mountCardsSection($('#cards-root')),
  defis: () => mountChallengesSection($('#challenges-root')),
  idees: async () => {
    bindIdeas();
    await Promise.all([ensureMembers(), ensureIdeas()]);
    renderIdeas();
  },
  assistance: async () => {
    bindSupport();
    await Promise.all([ensureMembers(), ensureSupport()]);
    renderSupport();
  },
  messagerie: async () => { await ensureMembers(); await mountMessagesSection($('#messages-root')); },
  journal: () => mountLogSection($('#log-root')),
  staff: () => (isAdminView() ? mountStaffSection($('#staff-root'), { me: CTX.me }) : undefined),
  bot: () => mountBotSection($('#bot-root')),
  reglages: () => mountReglagesSection($('#reglages-root')),
  theme: () => mountThemesSection($('#theme-root')),
};
export const SECTION_IDS = Object.keys(MOUNTS);

/** Monte une section (idempotent). Résout quand elle est prête (ou en erreur). */
export function mountSection(id) {
  if (!RUN.has(id)) RUN.set(id, run(id));
  return RUN.get(id);
}
async function run(id) {
  const sec = document.getElementById(id);
  if (!sec || sec.hidden || !MOUNTS[id]) return false;
  try {
    await MOUNTS[id]();
    READY.add(id);
  } catch (e) {
    console.error(e);
    sec.insertAdjacentHTML('beforeend', sectionError(e));
  }
  sec.querySelector(':scope > .admin-skel')?.remove();
  sec.classList.remove('is-lazy');
  return READY.has(id);
}

/** Ouvre la fiche d'un membre (monte la section Comptes d'abord). Retourne false si le compte est introuvable. */
export async function openFiche(uid, tab = 'profil') {
  await mountSection('comptes');
  if (!isReady('comptes')) return false;
  if (!A.accounts.some((a) => a.id === uid)) {
    toast('Compte introuvable.', 'error');
    setHash('comptes');
    return false;
  }
  const t = TABS.some(([k]) => k === tab) ? tab : 'profil';
  setHash(fichePath(uid, t));
  await openAccountFiche(uid, t);
  return true;
}

/* ---------- Chargement à la demande ---------- */
/** Ajoute le squelette « Chargement… » aux sections qui ne sont pas encore montées (la vue d'ensemble se charge tout de suite). */
export function prepareLazy() {
  for (const sec of document.querySelectorAll('.admin-section')) {
    if (sec.id === 'apercu' || sec.hidden) continue;
    sec.classList.add('is-lazy');
    sec.insertAdjacentHTML('beforeend', '<div class="admin-skel" role="status"><span class="admin-skel-label">Chargement…</span><span class="admin-skel-bar"></span><span class="admin-skel-bar short"></span></div>');
  }
}
/** Monte chaque section visible dès qu'elle approche de l'écran (marge de 240 px). */
export function watchSections() {
  const secs = [...document.querySelectorAll('.admin-section')].filter((s) => !s.hidden && s.id !== 'apercu');
  if (!('IntersectionObserver' in window)) { secs.forEach((s) => mountSection(s.id)); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); mountSection(e.target.id); }
  }, { rootMargin: '240px 0px' });
  secs.forEach((s) => io.observe(s));
}

export function initMounts({ me }) { CTX.me = me; }
