// ===== Humane Gang — administration (point d'entrée) =====
// Les sections « Comptes », « Cartes » et les modules autonomes restent à leur place ; le reste est dans assets/js/admin/.
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
import { mountSortiesSection } from './admin-sorties/index.js';
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

const me = await initPage({ auth: 'admin' });
mountGodCard($('#god-root'));

// Écouteurs des sections (dans l'ordre d'origine)
bindInvites(me);
bindSecretSanta();
bindBadges();
bindIdeas();
bindSupport();

/* ---------- Démarrage ---------- */
await Promise.all([
  safe(loadMembers, (e) => toast(`Membres : ${errMsg(e)}`, 'error')),
  safe(loadInvites, (e) => { $('#invite-list').innerHTML = sectionError(e); }),
  safe(async () => { await loadEditions(); await loadEditionDetails(); S.ssLoaded = true; }, (e) => { $('#ss-root').innerHTML = sectionError(e); }),
  safe(loadBadges, (e) => { $('#badge-grid').innerHTML = sectionError(e); }),
  safe(loadIdeas, (e) => { $('#idea-list').innerHTML = sectionError(e); }),
  safe(loadSupport, (e) => { $('#support-list').innerHTML = sectionError(e); }),
  safe(loadSettings, (e) => toast(`Réglages : ${errMsg(e)}`, 'error')),
]);

renderStats();
renderMembers();
renderInvites();
if (S.ssLoaded) renderSS();
renderBadges();
renderIdeas();
renderSupport();
mountBotSection($('#bot-root'));
mountThemesSection($('#theme-root'));
mountInviteLinks($('#links-root'), { me, pseudoOf, onChange: async () => { await loadInvites(); renderInvites(); renderStats(); } });
mountMessagesSection($('#messages-root'));
mountLogSection($('#log-root'));
mountEventsSection($('#events-root'), { onBadgesChange: async () => { await loadBadges(); renderBadges(); } });
mountCardsSection($('#cards-root'));
mountChallengesSection($('#challenges-root'));
mountSortiesSection($('#sorties-root'), { me });
mountAccessSection($('#access-root'), { openMember: (uid) => openAccountFiche(uid, 'acces') });
// Comptes fantômes : préparés avant l'inscription. Leur création/suppression resynchronise la liste des comptes et les sélecteurs.
mountGhostsSection($('#ghosts-root'), {
  openFiche: (uid) => openAccountFiche(uid),
  onChange: async () => { await loadMembers(); await refreshAccounts(); renderBadges(); renderStats(); },
});
refreshGhostsSection();
// Comptes : fiche complète de chaque membre. Après une modification, on resynchronise les autres sections.
initAccounts({
  me,
  onChange: async (kind) => {
    if (kind === 'members') { refreshAccessSection(); await loadMembers(); renderInvites(); refreshInviteLinks(); renderBadges(); if (S.ssLoaded) renderSS(); renderIdeas(); renderSupport(); renderStats(); }
    if (kind === 'badges') { await loadBadges(); renderBadges(); }
    if (kind === 'ss') { await loadEditionDetails(); if (S.ssLoaded) renderSS(); renderStats(); }
    if (kind === 'ideas') { await loadIdeas(); renderIdeas(); renderStats(); }
    if (kind === 'support') { await loadSupport(); renderSupport(); renderStats(); }
  },
});
setupNav();
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
