// ===== Humane Gang — administration (point d'entrée) =====
// Les sections sont montées à la demande (admin/mounts.js) : au premier affichage, à l'ouverture d'un lien direct
// (#comptes/<membre>[/<onglet>], #cartes/<onglet>, #<section>) ou depuis la palette « Aller à… » (admin/palette.js).
// Accès : admin, ou Staff avec des permissions. Une section sans droit est masquée et n'est jamais montée (admin/perms.js).
import { initPage, $ } from './core.js';
import { mountGodCard } from './admin-godmode.js';
import { setupNav } from './admin/overview.js';
import { applyPanelAccess, isAdminView } from './admin/perms.js';
import { initMounts, mountSection, prepareLazy, watchSections } from './admin/mounts.js';
import { startRouter } from './admin/router.js';
import { setupPalette } from './admin/palette.js';

const me = await initPage({ auth: 'admin' });
// Accès par section : seules les sections permises sont affichées (la navigation suit).
applyPanelAccess();
if (isAdminView()) mountGodCard($('#god-root')); // mode sans limite : administrateur seulement
else $('#god-root').hidden = true;

initMounts({ me });
setupPalette();
prepareLazy();                 // squelettes « Chargement… » des sections non montées
mountSection('apercu');        // la vue d'ensemble se charge tout de suite (ses tuiles, seulement pour les droits accordés)
watchSections();               // les autres sections se montent à leur approche de l'écran
setupNav();
startRouter();                 // adresse de départ (lien direct) et Précédent
