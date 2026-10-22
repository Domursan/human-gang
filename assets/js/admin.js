// ===== Humane Gang — administration (point d'entrée) =====
// Coquille (rail, colonnes, routage) : admin/shell.js. Chaque sous-section est montée à sa première visite (registerSub) ;
// les données partagées sont chargées ici, pour les seules sections permises. Les sections « Comptes », « Cartes » et les
// modules autonomes restent à leur place ; le reste est dans assets/js/admin/. Palette « Aller à… » : admin/palette.js.
// Accès : admin, ou Staff avec des permissions. Droits : admin/perms.js (source unique).
// Ce fichier ne fait que brancher : il relie chaque sous-section à son fournisseur (registerSub), charge les données
// nécessaires, puis démarre le routage. Le code des sections est dans leurs propres modules.
import { initPage, $, toast, errMsg } from './core.js';
import { mountThemesSection, themeActions } from './admin-themes.js';
import { mountMessagesSection, listMessages, openMessages } from './admin-messages.js';
import { mountLogSection, listLog, openLog } from './admin-log.js';
import { mountBotSection } from './admin-bot.js';
import { initAccounts, refreshAccounts, showAccount, showGhostFiche, emptyDetail, mountAccountsList, mountAccountsInfo } from './admin-accounts.js';
import { ensureGhosts, ghostZoneActions, openNewGhostDrawer } from './admin-ghosts.js';
import { mountAccessSection, refreshAccessSection, accessActions } from './admin-access.js';
import { mountInviteLinks, refreshInviteLinks } from './admin-invite-links.js';
import { eventsSub } from './admin-events.js';
import { mountCardsSection, openCardsTab, mountPlayersList, mountDropsSection } from './admin-cards.js';
import { mountChallengesSection } from './admin-challenges.js';
import { mountQuizSection } from './admin-quiz.js';
import { mountStaffSection, listStaff, openStaff, infoStaff } from './admin-staff.js';
import { mountSortiesSection, openSortie, listSorties, infoSorties } from './admin-sorties/index.js';
import { mountSouvenirsSection, openSouvenirs, listSouvenirs } from './admin-souvenirs/index.js';
import { mountReglagesSection, reglagesActions } from './admin-reglages/view.js';
import { A } from './admin-accounts/state.js';
import { S, pseudoOf } from './admin/state.js';
import { sectionError } from './admin/common.js';
import { loadMembers, loadInvites, loadEditionDetails, loadBadges, loadIdeas, loadSupport, ensureMembers, ensureInvites, ensureSS, ensureBadges, ensureIdeas, ensureSupport, safe } from './admin/loaders.js';
import { renderStats, loadOverview, overviewTables } from './admin/overview.js';
import { bindInvites, renderInvites, renderMembers, inviteActions } from './admin/invites.js';
import { renderSS, ssSub } from './admin/ss-render.js';
import { bindSecretSanta } from './admin/ss-events.js';
import { bindBadges, renderBadges, badgesSub } from './admin/badges.js';
import { ideasSub, renderIdeas } from './admin/ideas.js';
import { supportSub, renderSupport } from './admin/support.js';
import { canSection, anySection, applyPanelAccess } from './admin/perms.js';
import { initLive, onTableChange } from './admin/live.js';
import { initShell, registerSub, startShell, navigate, setActions } from './admin/shell.js';
import { setupPalette } from './admin/palette.js';

// Démarrage : l'identité (et les droits) sont lus d'abord ; le reste suit.
const me = await initPage({ auth: 'admin' });
applyPanelAccess();
const has = canSection;
initShell({ me }); // rail et colonnes tout de suite ; le routage démarre quand les données sont chargées
setupPalette();    // « Aller à… » (Ctrl/Cmd+K, bouton du rail)

/* ---------- Comptes : fiche complète de chaque membre (initialisée à la première visite d'une sous-section qui en a besoin) ---------- */
// Promesse de l'initialisation des comptes : créée une seule fois.
let accountsP = null;
/** Initialise la section Comptes si la personne y a droit, une seule fois. Renvoie la promesse, ou undefined. */
function ensureAccounts() {
  if (!accountsP && has('comptes')) accountsP = loadAccountsPanel();
  return accountsP ?? undefined;
}
/**
 * Lance le module Comptes. Après une modification, resynchronise les autres sections concernées
 * (membres, badges, Secret Santa, idées, assistance, statistiques).
 */
function loadAccountsPanel() {
  // Après une modification, on resynchronise les autres sections.
  return initAccounts({
    me,
    onChange: async (kind) => {
      if (kind === 'members') { await refreshAccounts(); if (has('membres')) refreshAccessSection(); await loadMembers(); renderInvites(); refreshInviteLinks(); renderBadges(); if (S.ssLoaded) renderSS(); renderIdeas(); renderSupport(); renderStats(); }
      if (kind === 'badges') { await loadBadges(); renderBadges(); }
      if (kind === 'ss') { await loadEditionDetails(); if (S.ssLoaded) renderSS(); renderStats(); }
      if (kind === 'ideas') { await loadIdeas(); renderIdeas(); renderStats(); }
      if (kind === 'support') { await loadSupport(); renderSupport(); renderStats(); }
    },
  });
}
// Fournisseur `open` de Comptes : adresse #membres/comptes/<id>[/<onglet>] ; sans identifiant, la zone principale est vide.
// Comptes inscrits et fantômes sont dans la même liste : un fantôme s'ouvre sur sa fiche (code, liaison), sauf avec un onglet.
// #membres/comptes/nouveau ouvre le tiroir de création d'un fantôme (adresse transitoire).
/**
 * Affiche une fiche membre (ou la zone vide, ou le tiroir de création d'un fantôme) selon l'adresse.
 * @param {HTMLElement} _el Conteneur du groupe (non utilisé : la fiche va dans sa propre zone).
 * @param {{id?: string, tab?: string}} route Segments de l'adresse.
 */
async function openFicheRoute(_el, { id, tab }) {
  if (id === 'nouveau') { location.hash = '#membres/comptes'; openNewGhostDrawer(); return; }
  if (!id) { setActions(ghostZoneActions(null)); emptyDetail(); return; } // #membres/comptes : la zone principale invite à choisir dans la liste
  await ensureAccounts();
  await ensureGhosts();
  const acc = A.accounts.find((a) => a.id === id);
  if (!acc) { toast('Compte introuvable.', 'error'); navigate('membres/comptes'); return; }
  setActions(ghostZoneActions(acc.is_ghost ? null : id));
  if (acc.is_ghost && !tab) { showGhostFiche(id); return; }
  showAccount(id, tab);
}

/* ---------- Écouteurs des sections permises (liés au DOM, sans montage) ---------- */
// Branchés tout de suite, sans attendre la première visite (les boutons sont dans la page).
if (has('membres')) bindInvites(me);
if (has('secret-santa')) bindSecretSanta();
if (has('badges')) bindBadges();

/* ---------- Sous-sections : montage à la première visite ---------- */
// Chaque registerSub relie une adresse (domaine/sous-section) à ses fonctions : main (montage unique),
// open (à chaque visite), list (colonne 2), info (panneau de droite). Voir l'API en tête de admin/shell.js.
// Pilotage
registerSub('pilotage/apercu', {
  main: () => {
    loadOverview();
    const tables = overviewTables();
    if (tables.length) onTableChange('apercu', tables, loadOverview); // temps réel : journal et échanges
  },
});
registerSub('pilotage/journal', { main: () => mountLogSection($('#log-root')), open: openLog, list: listLog });
registerSub('pilotage/staff', { main: () => mountStaffSection($('#staff-root')), open: openStaff, list: listStaff, info: infoStaff }); // administrateur seulement
// Membres
registerSub('membres/comptes', {
  main: () => ensureAccounts(),
  list: (el) => mountAccountsList(el),
  open: openFicheRoute,
  info: (el) => mountAccountsInfo(el),
});
registerSub('membres/invitations', {
  main: () => mountInviteLinks($('#links-root'), { me, pseudoOf, onChange: async () => { await loadInvites(); renderInvites(); renderStats(); } }),
  open: () => setActions(inviteActions()), // « + Nouveau code » et « + Nouveau lien » (tiroirs)
});
registerSub('membres/acces', {
  main: () => { ensureAccounts(); mountAccessSection($('#access-root'), { openMember: (uid) => navigate(`membres/comptes/${uid}/acces`) }); },
  open: () => setActions(accessActions()),
});
// Vie du gang
registerSub('vie/sorties', {
  main: () => mountSortiesSection($('#sorties-root'), { me }),
  open: (el, r) => openSortie(r),
  list: listSorties,
  info: infoSorties,
});
registerSub('vie/souvenirs', {
  main: () => mountSouvenirsSection($('#souvenirs-root'), { me }),
  open: (el, r) => openSouvenirs(r),
  list: listSouvenirs,
});
registerSub('vie/secret-santa', ssSub);
registerSub('vie/evenements', eventsSub({ onBadgesChange: async () => { await loadBadges(); renderBadges(); } }));
registerSub('vie/badges', badgesSub);
// Jeu de cartes : une seule section (#cartes) montée une fois ; chaque partie est une sous-section qui ouvre son onglet.
const cardsGroup = { group: 'cartes', main: () => mountCardsSection($('#cards-root'), { tabs: false }) };
for (const tab of ['series', 'cartes', 'quetes', 'economie', 'boosters', 'stats', 'echanges']) {
  registerSub(`cartes/${tab}`, { ...cardsGroup, open: () => openCardsTab(tab) });
}
// Joueurs : liste en colonne 2 ; le membre choisi est dans l'adresse (#cartes/joueurs/<id>).
registerSub('cartes/joueurs', { ...cardsGroup, list: mountPlayersList, open: (_el, { id }) => openCardsTab('joueurs', id) });
registerSub('cartes/drops', { main: () => mountDropsSection($('#drops-root')) }); // drops : un tirage manuel, les premiers qui cliquent
registerSub('cartes/defis', { main: () => mountChallengesSection($('#challenges-root')) });
registerSub('cartes/questions', { main: () => mountQuizSection($('#quiz-root')) }); // questions du gang : un onglet réponses et statistiques
// Communication
registerSub('communication/assistance', supportSub); // liste en colonne 2, détail et fiche rapide
registerSub('communication/idees', ideasSub);
registerSub('communication/messagerie', {
  main: (el) => { el.dataset.fill = ''; mountMessagesSection($('#messages-root')); },
  open: openMessages, list: listMessages, // liste en colonne 2, lecture dans la zone (createThread en lecture seule)
});
registerSub('communication/bot', { main: () => mountBotSection($('#bot-root')) });
// Site
registerSub('site/reglages', { main: () => mountReglagesSection($('#reglages-root')), open: () => setActions(reglagesActions()) });
registerSub('site/theme', { main: () => mountThemesSection($('#theme-root')), open: () => setActions(themeActions()) });

/* ---------- Démarrage : seulement les données partagées des sections permises (chaque donnée se charge une fois) ---------- */
// Les réglages du bot et du thème se chargent avec leur section (admin-bot.js, admin-themes.js).
const needMembers = anySection('comptes', 'membres', 'secret-santa', 'badges', 'idees', 'assistance', 'messagerie');
const needSS = has('secret-santa');
const needBadges = anySection('badges', 'evenements', 'comptes', 'membres');
// Chargement en parallèle. Une erreur n'arrête pas le démarrage : elle s'affiche dans la section concernée.
await Promise.all([
  needMembers ? safe(ensureMembers, (e) => toast(`Membres : ${errMsg(e)}`, 'error')) : null,
  has('membres') ? safe(ensureInvites, (e) => { $('#invite-list').innerHTML = sectionError(e); }) : null,
  needSS ? safe(ensureSS, (e) => { $('#ss-root').innerHTML = sectionError(e); }) : null,
  needBadges ? safe(ensureBadges, (e) => { $('#badge-grid').innerHTML = sectionError(e); }) : null,
  has('idees') ? safe(ensureIdeas, (e) => { $('#ideas-root').innerHTML = sectionError(e); }) : null,
  has('assistance') ? safe(ensureSupport, (e) => { $('#support-root').innerHTML = sectionError(e); }) : null,
]);

// Compteurs, puis listes déjà prêtes ; le routage démarre ensuite.
renderStats(); // compteurs « à traiter » compris
if (has('membres') || has('comptes')) renderMembers();
if (has('membres')) renderInvites();
if (S.ssLoaded) renderSS();
if (has('badges')) renderBadges();
if (has('idees')) renderIdeas();
if (has('assistance')) renderSupport();
startShell();
initLive(); // temps réel du panel (voyant du rail, compteurs, sections) ; sans effet si indisponible
