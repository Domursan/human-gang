// Comptes admin : état partagé (comptes, fiche ouverte, onglet, constantes).
import { $ } from '../core.js';

/* ---------- État ---------- */
export const A = {
  me: null, onChange: async () => {},
  accounts: [], avatars: new Map(), listError: null,
  uid: null, tab: 'profil', d: null, loading: false,
  ssEdition: null, showPair: false,
};
export const pseudoOf = (id) => (id ? A.accounts.find((a) => a.id === id)?.pseudo || A.avatars.get(id)?.pseudo || 'Ancien membre' : '—');
export const TABS = [
  ['profil', 'Profil'], ['infos', 'Informations'], ['ss', 'Secret Santa'], ['irl', 'Sorties IRL'],
  ['photos', 'Photos'], ['contrib', 'Idées & assistance'], ['badges', 'Badges'], ['acces', 'Accès'],
];
export const SS_STATUS = { inscriptions: 'Inscriptions', tirage: 'Tirage', envoi: 'Envoi', revelation: 'Révélation', termine: 'Terminé' };
export const RSVP = [['', 'Pas de réponse'], ['oui', 'Oui'], ['peut-etre', 'Peut-être'], ['non', 'Non']];
export const IDEA = { nouvelle: 'Nouvelle', retenue: 'Retenue', ecartee: 'Écartée' };

export const root = () => $('#acc-root');

/** Hooks de rendu de la fiche, renseignés par fiche.js (évite un import circulaire). */
export const H = { renderPanel: () => {}, renderDetail: () => {} };
