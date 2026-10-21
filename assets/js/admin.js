// ===== Humane Gang — administration (point d'entrée) =====
// Coquille (rail, colonnes, routage) : admin/shell.js. Chaque sous-section est montée à sa première visite (registerSub) ;
// les données partagées sont chargées ici, pour les seules sections permises. Les sections « Comptes », « Cartes » et les
// modules autonomes restent à leur place ; le reste est dans assets/js/admin/. Palette « Aller à… » : admin/palette.js.
// Accès : admin, ou Staff avec des permissions. Droits : admin/perms.js (source unique).
import { initPage, $, toast, errMsg } from './core.js';
import { mountThemesSection } from './admin-themes.js';
import { mountMessagesSection } from './admin-messages.js';
import { mountLogSection, listLog, openLog } from './admin-log.js';
import { mountBotSection } from './admin-bot.js';
import { initAccounts, refreshAccounts, openAccountFiche } from './admin-accounts.js';
import { mountGhostsSection, refreshGhostsSection } from './admin-ghosts.js';
import { mountAccessSection, refreshAccessSection } from './admin-access.js';
import { mountInviteLinks, refreshInviteLinks } from './admin-invite-links.js';
import { eventsSub } from './admin-events.js';
import { mountCardsSection, openCardsTab } from './admin-cards.js';
import { mountChallengesSection } from './admin-challenges.js';
import { mountStaffSection, listStaff, openStaff, infoStaff } from './admin-staff.js';
import { mountSortiesSection } from './admin-sorties/index.js';
import { mountSouvenirsSection } from './admin-souvenirs/index.js';
import { mountReglagesSection } from './admin-reglages/view.js';
import { A, TABS } from './admin-accounts/state.js';
import { closeDetail } from './admin-accounts/inspect.js';
import { S, pseudoOf } from './admin/state.js';
import { sectionError } from './admin/common.js';
import { loadMembers, loadInvites, loadEditionDetails, loadBadges, loadIdeas, loadSupport, ensureMembers, ensureInvites, ensureSS, ensureBadges, ensureIdeas, ensureSupport, safe } from './admin/loaders.js';
import { renderStats, loadOverview, overviewTables } from './admin/overview.js';
import { bindInvites, renderInvites, renderMembers } from './admin/invites.js';
import { renderSS, ssSub } from './admin/ss-render.js';
import { bindSecretSanta } from './admin/ss-events.js';
import { bindBadges, renderBadges, badgesSub } from './admin/badges.js';
import { ideasSub, renderIdeas } from './admin/ideas.js';
import { supportSub, renderSupport } from './admin/support.js';
import { canSection, anySection, applyPanelAccess } from './admin/perms.js';
import { initLive, onTableChange } from './admin/live.js';
import { initShell, registerSub, startShell, navigate } from './admin/shell.js';
import { setupPalette } from './admin/palette.js';
import { bindFicheHash } from './admin/router.js';

const me = await initPage({ auth: 'admin' });
applyPanelAccess();
const has = canSection;
initShell({ me }); // rail et colonnes tout de suite ; le routage démarre quand les données sont chargées
setupPalette();    // « Aller à… » (Ctrl/Cmd+K, bouton du rail)

/* ---------- Comptes : fiche complète de chaque membre (initialisée à la première visite d'une sous-section qui en a besoin) ---------- */
let accountsP = null;
function ensureAccounts() {
  if (!accountsP && has('comptes')) accountsP = loadAccountsPanel();
  return accountsP ?? undefined;
}
function loadAccountsPanel() {
  // Après une modification, on resynchronise les autres sections.
  return initAccounts({
    me,
    onChange: async (kind) => {
      if (kind === 'members') { if (has('membres')) refreshAccessSection(); await loadMembers(); renderInvites(); refreshInviteLinks(); renderBadges(); if (S.ssLoaded) renderSS(); renderIdeas(); renderSupport(); renderStats(); }
      if (kind === 'badges') { await loadBadges(); renderBadges(); }
      if (kind === 'ss') { await loadEditionDetails(); if (S.ssLoaded) renderSS(); renderStats(); }
      if (kind === 'ideas') { await loadIdeas(); renderIdeas(); renderStats(); }
      if (kind === 'support') { await loadSupport(); renderSupport(); renderStats(); }
    },
  });
}
// Ouvre la fiche d'un membre (adresse #membres/comptes/<id>[/<onglet>]) ; sans identifiant, la fiche se ferme.
async function openFicheRoute(_el, { id, tab }) {
  if (!id) { if (A.uid) closeDetail(); return; }
  await ensureAccounts();
  if (!A.accounts.some((a) => a.id === id)) { toast('Compte introuvable.', 'error'); navigate('membres/comptes'); return; }
  await openAccountFiche(id, TABS.some(([k]) => k === tab) ? tab : 'profil');
}

/* ---------- Écouteurs des sections permises (liés au DOM, sans montage) ---------- */
if (has('membres')) bindInvites(me);
if (has('secret-santa')) bindSecretSanta();
if (has('badges')) bindBadges();

/* ---------- Sous-sections : montage à la première visite ---------- */
registerSub('pilotage/apercu', {
  main: () => {
    loadOverview();
    const tables = overviewTables();
    if (tables.length) onTableChange('apercu', tables, loadOverview); // temps réel : journal et échanges
  },
});
registerSub('pilotage/journal', { main: () => mountLogSection($('#log-root')), open: openLog, list: listLog });
registerSub('pilotage/staff', { main: () => mountStaffSection($('#staff-root')), open: openStaff, list: listStaff, info: infoStaff }); // administrateur seulement
registerSub('membres/comptes', { main: () => ensureAccounts(), open: openFicheRoute });
registerSub('membres/fantomes', {
  // Comptes fantômes : préparés avant l'inscription. Leur création/suppression resynchronise la liste des comptes et les sélecteurs.
  main: () => {
    ensureAccounts();
    mountGhostsSection($('#ghosts-root'), {
      openFiche: (uid) => navigate(`membres/comptes/${uid}`),
      onChange: async () => { await loadMembers(); await refreshAccounts(); renderBadges(); renderStats(); },
    });
    refreshGhostsSection();
  },
});
registerSub('membres/invitations', {
  main: () => mountInviteLinks($('#links-root'), { me, pseudoOf, onChange: async () => { await loadInvites(); renderInvites(); renderStats(); } }),
});
registerSub('membres/acces', {
  main: () => { ensureAccounts(); mountAccessSection($('#access-root'), { openMember: (uid) => navigate(`membres/comptes/${uid}/acces`) }); },
});
registerSub('vie/sorties', { main: () => mountSortiesSection($('#sorties-root'), { me }) });
registerSub('vie/souvenirs', { main: () => mountSouvenirsSection($('#souvenirs-root'), { me }) });
registerSub('vie/secret-santa', ssSub);
registerSub('vie/evenements', eventsSub({ onBadgesChange: async () => { await loadBadges(); renderBadges(); } }));
registerSub('vie/badges', badgesSub);
// Jeu de cartes : une seule section (#cartes) montée une fois ; chaque partie est une sous-section qui ouvre son onglet.
const cardsGroup = { group: 'cartes', main: () => mountCardsSection($('#cards-root'), { tabs: false }) };
for (const tab of ['series', 'cartes', 'quetes', 'economie', 'joueurs', 'stats', 'echanges']) {
  registerSub(`cartes/${tab}`, { ...cardsGroup, open: () => openCardsTab(tab) });
}
registerSub('cartes/defis', { main: () => mountChallengesSection($('#challenges-root')) });
registerSub('communication/assistance', supportSub); // liste en colonne 2, détail et fiche rapide
registerSub('communication/idees', ideasSub);
registerSub('communication/messagerie', { main: () => mountMessagesSection($('#messages-root')) });
registerSub('communication/bot', { main: () => mountBotSection($('#bot-root')) });
registerSub('site/reglages', { main: () => mountReglagesSection($('#reglages-root')) });
registerSub('site/theme', { main: () => mountThemesSection($('#theme-root')) });

/* ---------- Démarrage : seulement les données partagées des sections permises (chaque donnée se charge une fois) ---------- */
// Les réglages du bot et du thème se chargent avec leur section (admin-bot.js, admin-themes.js).
const needMembers = anySection('comptes', 'fantomes', 'membres', 'secret-santa', 'badges', 'idees', 'assistance', 'messagerie');
const needSS = has('secret-santa');
const needBadges = anySection('badges', 'evenements', 'comptes', 'fantomes', 'membres');
await Promise.all([
  needMembers ? safe(ensureMembers, (e) => toast(`Membres : ${errMsg(e)}`, 'error')) : null,
  has('membres') ? safe(ensureInvites, (e) => { $('#invite-list').innerHTML = sectionError(e); }) : null,
  needSS ? safe(ensureSS, (e) => { $('#ss-root').innerHTML = sectionError(e); }) : null,
  needBadges ? safe(ensureBadges, (e) => { $('#badge-grid').innerHTML = sectionError(e); }) : null,
  has('idees') ? safe(ensureIdeas, (e) => { $('#ideas-root').innerHTML = sectionError(e); }) : null,
  has('assistance') ? safe(ensureSupport, (e) => { $('#support-root').innerHTML = sectionError(e); }) : null,
]);

renderStats(); // compteurs « à traiter » compris
if (has('membres') || has('comptes')) renderMembers();
if (has('membres')) renderInvites();
if (S.ssLoaded) renderSS();
if (has('badges')) renderBadges();
if (has('idees')) renderIdeas();
if (has('assistance')) renderSupport();
bindFicheHash();   // l'adresse suit la fiche ouverte et son onglet (clics et saisies dans la section Comptes)
startShell();
initLive(); // temps réel du panel (voyant du rail, compteurs, sections) ; sans effet si indisponible
