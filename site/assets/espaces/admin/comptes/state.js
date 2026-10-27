// =====================================================================
// Comptes admin : état partagé (comptes, fiche ouverte, onglet, constantes).
// Les autres fichiers de admin-accounts/ importent cet état pour le lire ou le modifier.
// Dépendances : core.js ($, pour trouver la zone d'affichage).
// Exporte : A (état), pseudoOf, TABS, SS_STATUS, RSVP, IDEA, root, CACHE, dropFicheCache, H.
// =====================================================================
import { $ } from '../../../commun/core.js';

/* ---------- État ---------- */
// État global de la page Comptes. Les champs sont expliqués en ligne.
export const A = {
  me: null, onChange: async () => {},
  accounts: [], avatars: new Map(), q: '', listError: null, shown: 50, // comptes affichés (par lots de 50)
  uid: null, tab: 'profil', d: null, loading: false, ghostView: false, // ghostView : la zone affiche la fiche d'un fantôme
  ssEdition: null, showPair: false,
};
/** Pseudo d'un compte à partir de son identifiant. Cherche d'abord dans la liste, puis dans les avatars connus. */
export const pseudoOf = (id) => (id ? A.accounts.find((a) => a.id === id)?.pseudo || A.avatars.get(id)?.pseudo || 'Ancien membre' : '—');
// Onglets de la fiche : [identifiant, libellé affiché].
export const TABS = [
  ['profil', 'Profil'], ['infos', 'Informations'], ['ss', 'Secret Santa'], ['irl', 'Sorties IRL'],
  ['photos', 'Photos'], ['contrib', 'Idées & assistance'], ['badges', 'Badges'], ['acces', 'Accès'],
];
// Libellés des étapes d'une édition de Secret Santa.
export const SS_STATUS = { inscriptions: 'Inscriptions', tirage: 'Tirage', envoi: 'Envoi', revelation: 'Révélation', termine: 'Terminé' };
// Réponses possibles à une sortie IRL : [valeur enregistrée, libellé].
export const RSVP = [['', 'Pas de réponse'], ['oui', 'Oui'], ['peut-etre', 'Peut-être'], ['non', 'Non']];
// Statuts d'une idée proposée par un membre.
export const IDEA = { nouvelle: 'Nouvelle', retenue: 'Retenue', ecartee: 'Écartée' };

/** Zone d'affichage de la page Comptes (élément #acc-root). */
export const root = () => $('#acc-root');

/* Lectures de la fiche déjà faites pendant cette visite de la page : « uid|source » -> { data, error }.
   Vidé après toute modification (dropFicheCache) ; une lecture en erreur n'est jamais gardée. */
export const CACHE = new Map();
/** Vide le cache de la fiche : à appeler après toute modification, pour relire les vraies données. */
export const dropFicheCache = () => CACHE.clear();

/* Hooks de rendu de la fiche, renseignés par fiche.js (évite un import circulaire). */
export const H = { renderPanel: () => {}, renderDetail: () => {} };
