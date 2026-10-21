// ===== Humane Gang — administration (point d'entrée) =====
// Coquille (rail, colonnes, routage) : admin/shell.js. Chaque sous-section est montée à sa première visite (registerSub) ;
// les données partagées sont chargées ici, pour les seules sections permises. Les sections « Comptes », « Cartes » et les
// modules autonomes restent à leur place ; le reste est dans assets/js/admin/.
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
import { mountEventsSection } from './admin-events.js';
import { mountCardsSection, openCardsTab } from './admin-cards.js';
import { mountChallengesSection } from './admin-challenges.js';
import { mountStaffSection, listStaff, openStaff, infoStaff } from './admin-staff.js';
import { mountSortiesSection } from './admin-sorties/index.js';
import { mountSouvenirsSection } from './admin-souvenirs/index.js';
import { mountReglagesSection } from './admin-reglages/view.js';
import { S, pseudoOf } from './admin/state.js';
import { sectionError } from './admin/common.js';
import { loadMembers, loadInvites, loadEditions, loadEditionDetails, loadBadges, loadIdeas, loadSupport, loadSettings, safe } from './admin/loaders.js';
import { renderStats, loadOverview, overviewTables } from './admin/overview.js';
import { bindInvites, renderInvites, renderMembers } from './admin/invites.js';
import { renderSS } from './admin/ss-render.js';
import { bindSecretSanta } from './admin/ss-events.js';
import { bindBadges, renderBadges } from './admin/badges.js';
import { bindIdeas, renderIdeas } from './admin/ideas.js';
import { bindSupport, renderSupport } from './admin/support.js';
import { canSection, anySection, applyPanelAccess } from './admin/perms.js';
import { initLive, onTableChange } from './admin/live.js';
import { initShell, registerSub, startShell } from './admin/shell.js';

const me = await initPage({ auth: 'admin' });
applyPanelAccess();
const has = canSection;
initShell({ me }); // rail et colonnes tout de suite ; le routage démarre quand les données sont chargées

/* ---------- Comptes : fiche complète de chaque membre (initialisée à la première visite d'une sous-section qui en a besoin) ---------- */
let accountsReady = false;
function ensureAccounts() {
  if (accountsReady || !has('comptes')) return;
  accountsReady = true;
  // Après une modification, on resynchronise les autres sections.
  initAccounts({
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

/* ---------- Écouteurs des sections permises (liés au DOM, sans montage) ---------- */
if (has('membres')) bindInvites(me);
if (has('secret-santa')) bindSecretSanta();
if (has('badges')) bindBadges();
if (has('idees')) bindIdeas();
if (has('assistance')) bindSupport();

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
registerSub('membres/comptes', { main: () => ensureAccounts() });
registerSub('membres/fantomes', {
  // Comptes fantômes : préparés avant l'inscription. Leur création/suppression resynchronise la liste des comptes et les sélecteurs.
  main: () => {
    ensureAccounts();
    mountGhostsSection($('#ghosts-root'), {
      openFiche: (uid) => openAccountFiche(uid),
      onChange: async () => { await loadMembers(); await refreshAccounts(); renderBadges(); renderStats(); },
    });
    refreshGhostsSection();
  },
});
registerSub('membres/invitations', {
  main: () => mountInviteLinks($('#links-root'), { me, pseudoOf, onChange: async () => { await loadInvites(); renderInvites(); renderStats(); } }),
});
registerSub('membres/acces', {
  main: () => { ensureAccounts(); mountAccessSection($('#access-root'), { openMember: (uid) => openAccountFiche(uid, 'acces') }); },
});
registerSub('vie/sorties', { main: () => mountSortiesSection($('#sorties-root'), { me }) });
registerSub('vie/souvenirs', { main: () => mountSouvenirsSection($('#souvenirs-root'), { me }) });
registerSub('vie/evenements', { main: () => mountEventsSection($('#events-root'), { onBadgesChange: async () => { await loadBadges(); renderBadges(); } }) });
// Jeu de cartes : une seule section (#cartes) montée une fois ; chaque partie est une sous-section qui ouvre son onglet.
const cardsGroup = { group: 'cartes', main: () => mountCardsSection($('#cards-root'), { tabs: false }) };
for (const tab of ['series', 'cartes', 'quetes', 'economie', 'joueurs', 'stats', 'echanges']) {
  registerSub(`cartes/${tab}`, { ...cardsGroup, open: () => openCardsTab(tab) });
}
registerSub('cartes/defis', { main: () => mountChallengesSection($('#challenges-root')) });
registerSub('communication/messagerie', { main: () => mountMessagesSection($('#messages-root')) });
registerSub('communication/bot', { main: () => mountBotSection($('#bot-root')) });
registerSub('site/reglages', { main: () => mountReglagesSection($('#reglages-root')) });
registerSub('site/theme', { main: () => mountThemesSection($('#theme-root')) });

/* ---------- Démarrage : seulement les données des sections permises ---------- */
const needMembers = anySection('comptes', 'fantomes', 'membres', 'secret-santa', 'badges', 'idees', 'assistance', 'messagerie');
const needSS = has('secret-santa');
const needBadges = anySection('badges', 'evenements', 'comptes', 'fantomes', 'membres');
const needSupport = anySection('idees', 'assistance');
await Promise.all([
  needMembers ? safe(loadMembers, (e) => toast(`Membres : ${errMsg(e)}`, 'error')) : null,
  has('membres') ? safe(loadInvites, (e) => { $('#invite-list').innerHTML = sectionError(e); }) : null,
  needSS ? safe(async () => { await loadEditions(); await loadEditionDetails(); S.ssLoaded = true; }, (e) => { $('#ss-root').innerHTML = sectionError(e); }) : null,
  needBadges ? safe(loadBadges, (e) => { $('#badge-grid').innerHTML = sectionError(e); }) : null,
  has('idees') ? safe(loadIdeas, (e) => { $('#idea-list').innerHTML = sectionError(e); }) : null,
  has('assistance') ? safe(loadSupport, (e) => { $('#support-list').innerHTML = sectionError(e); }) : null,
  anySection('bot', 'theme') ? safe(loadSettings, (e) => toast(`Réglages : ${errMsg(e)}`, 'error')) : null,
]);

renderStats(); // compteurs « à traiter » compris
if (has('membres') || has('comptes')) renderMembers();
if (has('membres')) renderInvites();
if (S.ssLoaded) renderSS();
if (has('badges')) renderBadges();
if (has('idees')) renderIdeas();
if (has('assistance')) renderSupport();
startShell();
initLive(); // temps réel du panel (voyant du rail, compteurs, sections) ; sans effet si indisponible
