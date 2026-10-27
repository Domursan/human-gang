// ===== Humane Gang — administration : comptes des membres (fiche complète) + extras Secret Santa =====
// Point d'entrée (importé par admin.js) : le code est réparti dans assets/js/admin-accounts/.
export { initAccounts } from './comptes/events.js';
export { refreshAccounts, mountAccountsList } from './comptes/list.js';
export { openAccountFiche, showAccount, showGhostFiche, emptyDetail, mountAccountsInfo, paintSugg, reloadDetail } from './comptes/fiche.js';
export { sharedFieldsHtml, readSharedFields } from './comptes/ss-shared.js';
export { pairsBlockHtml } from './comptes/ss-pairs.js';
