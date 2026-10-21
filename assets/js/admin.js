// ===== Humane Gang — administration (point d'entrée) =====
// Les sections « Comptes », « Cartes » et les modules autonomes restent à leur place ; le reste est dans assets/js/admin/.
// Accès : admin, ou Staff avec des permissions. Chaque section n'est initialisée que si son droit est accordé
// (correspondance dans admin/perms.js) : ses données ne sont chargées ni affichées sinon.
import { initPage, $, toast, errMsg } from './core.js';
import { mountGodCard } from './admin-godmode.js';
import { mountThemesSection } from './admin-themes.js';
import { mountMessagesSection } from './admin-messages.js';
import { mountLogSection } from './admin-log.js';
import { mountBotSection } from './admin-bot.js';
import { initAccounts, refreshAccounts, openAccountFiche } from './admin-accounts.js';
import { mountGhostsSection, refreshGhostsSection } from './admin-ghosts.js';
import { mountAccessSection, refreshAccessSection } from './admin-access.js';
import { mountInviteLinks, refreshInviteLinks } from './admin-invite-links.js';
import { mountEventsSection } from './admin-events.js';
import { mountCardsSection } from './admin-cards.js';
import { mountChallengesSection } from './admin-challenges.js';
import { mountStaffSection } from './admin-staff.js';
import { mountSortiesSection } from './admin-sorties/index.js';
import { mountSouvenirsSection } from './admin-souvenirs/index.js';
import { mountReglagesSection } from './admin-reglages/view.js';
import { S, pseudoOf } from './admin/state.js';
import { sectionError } from './admin/common.js';
import { loadMembers, loadInvites, loadEditions, loadEditionDetails, loadBadges, loadIdeas, loadSupport, loadSettings, safe } from './admin/loaders.js';
import { renderStats, setupNav } from './admin/overview.js';
import { bindInvites, renderInvites, renderMembers } from './admin/invites.js';
import { renderSS } from './admin/ss-render.js';
import { bindSecretSanta } from './admin/ss-events.js';
import { bindBadges, renderBadges } from './admin/badges.js';
import { bindIdeas, renderIdeas } from './admin/ideas.js';
import { bindSupport, renderSupport } from './admin/support.js';
import { canSection, anySection, isAdminView, applyPanelAccess } from './admin/perms.js';

const me = await initPage({ auth: 'admin' });
// Accès par section : seules les sections permises sont affichées et initialisées.
applyPanelAccess();
const has = canSection;

if (isAdminView()) mountGodCard($('#god-root')); // mode sans limite : administrateur seulement
else $('#god-root').hidden = true;

// Écouteurs des sections (dans l'ordre d'origine)
if (has('membres')) bindInvites(me);
if (has('secret-santa')) bindSecretSanta();
if (has('badges')) bindBadges();
if (has('idees')) bindIdeas();
if (has('assistance')) bindSupport();

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

renderStats();
if (has('membres') || has('comptes')) renderMembers();
if (has('membres')) renderInvites();
if (S.ssLoaded) renderSS();
if (has('badges')) renderBadges();
if (has('idees')) renderIdeas();
if (has('assistance')) renderSupport();
if (has('bot')) mountBotSection($('#bot-root'));
if (has('themes') || has('theme')) mountThemesSection($('#theme-root'));
if (has('membres')) mountInviteLinks($('#links-root'), { me, pseudoOf, onChange: async () => { await loadInvites(); renderInvites(); renderStats(); } });
if (has('messagerie')) mountMessagesSection($('#messages-root'));
if (has('journal')) mountLogSection($('#log-root'));
if (has('evenements')) mountEventsSection($('#events-root'), { onBadgesChange: async () => { await loadBadges(); renderBadges(); } });
if (has('cartes')) mountCardsSection($('#cards-root'));
if (has('defis')) mountChallengesSection($('#challenges-root'));
if (has('acces')) mountAccessSection($('#access-root'), { openMember: (uid) => openAccountFiche(uid, 'acces') });
if (has('sorties')) mountSortiesSection($('#sorties-root'), { me });
if (has('souvenirs')) mountSouvenirsSection($('#souvenirs-root'), { me });
if (has('reglages')) mountReglagesSection($('#reglages-root'));
// Comptes fantômes : préparés avant l'inscription. Leur création/suppression resynchronise la liste des comptes et les sélecteurs.
if (has('fantomes')) {
  mountGhostsSection($('#ghosts-root'), {
    openFiche: (uid) => openAccountFiche(uid),
    onChange: async () => { await loadMembers(); await refreshAccounts(); renderBadges(); renderStats(); },
  });
  refreshGhostsSection();
}
// Gestion du Staff : administrateur seulement
if (isAdminView()) mountStaffSection($('#staff-root'), { me });
// Comptes : fiche complète de chaque membre. Après une modification, on resynchronise les autres sections.
if (has('comptes')) {
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
setupNav();
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
