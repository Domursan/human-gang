// ===== Humane Gang — administration : comptes des membres (fiche complète) + extras Secret Santa =====
// Point d'entrée (importé par admin.js) : le code est réparti dans assets/js/admin-accounts/.
export { initAccounts } from './admin-accounts/events.js';
export { refreshAccounts, mountAccountsList } from './admin-accounts/list.js';
export { openAccountFiche, showAccount, emptyDetail, mountAccountsInfo } from './admin-accounts/fiche.js';
export { sharedFieldsHtml, readSharedFields } from './admin-accounts/ss-shared.js';
export { pairsBlockHtml } from './admin-accounts/ss-pairs.js';
