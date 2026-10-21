import { KEYS_LOT2 } from './keys-lot2.js'; // lot 2 : comptes et invitations
// Réglages : libellés, aides et règles des clés de hg_settings.
// - managed : la clé a son propre éditeur dans une autre section (ancre) ; ici elle est en lecture seule.
// - sensitive : clé technique ; seul l'administrateur peut la modifier (le reste du panel ne suffit pas).
// Une clé inconnue du registre est affichée sans aide, et modifiable par le Staff (non sensible).

import { KEYS_LOT1 } from './keys-lot1.js';

const KEYS_BASE = {
  theme: { label: 'Thème du site', help: 'Mode du site (clair, sombre, automatique) et thème forcé.', managed: '#theme', managedLabel: 'Thème' },
  bot: { label: 'Bot Discord', help: 'Salon d\'annonce, administrateur Discord et types de notifications.', managed: '#bot', managedLabel: 'Bot Discord' },
  bot_templates: { label: 'Modèles de messages du bot', help: 'Titres et textes des messages envoyés par le bot.', managed: '#bot', managedLabel: 'Bot Discord' },
  cards: { label: 'Économie du jeu de cartes', help: 'Taux de tirage, prix des boosters, récompenses en Paillettes.', managed: '#cartes', managedLabel: 'Cartes, onglet Économie' },
  push_vapid_public: { label: 'Clé publique des notifications (VAPID)', help: 'Clé publique Web Push. Elle doit correspondre à la clé privée de la fonction edge : la modifier casse les notifications des membres.', sensitive: true },
  domursan_owner: { label: 'Propriétaire Domursan', help: 'Identifiant technique du propriétaire de l\'app Domursan.', sensitive: true },
  admin_initial: { label: 'Administrateur initial', help: 'Trace de l\'administrateur d\'origine du site.', sensitive: true },
};

/** Toutes les clés décrites : base + lot 1 (identité et textes, formulaire dédié). */
export const KEYS = { ...KEYS_BASE, ...KEYS_LOT1 };
Object.assign(KEYS, KEYS_LOT2); // lot 2 : comptes et invitations

export const KIND_LABEL = { text: 'Texte', number: 'Nombre', bool: 'Oui / non', json: 'JSON (objet ou liste)' };
export const KEY_RE = /^[a-z][a-z0-9_]{1,40}$/;
const TEXT_MAX = 2000;

export const isSensitive = (key) => !!KEYS[key]?.sensitive;
export const managedOf = (key) => (KEYS[key]?.managed ? KEYS[key] : null);

/** Type d'éditeur d'après la valeur stockée (jsonb). */
export function kindOf(value) {
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'bool';
  return 'json';
}

/** Valeur à écrire pour un type donné. Renvoie { value } ou { error } (message en français). */
export function parseValue(kind, raw) {
  if (kind === 'bool') return { value: !!raw };
  if (kind === 'text') {
    const v = String(raw ?? '');
    if (v.length > TEXT_MAX) return { error: `Le texte dépasse ${TEXT_MAX} caractères.` };
    return { value: v };
  }
  if (kind === 'number') {
    const s = String(raw ?? '').trim();
    const n = Number(s);
    if (s === '' || !Number.isFinite(n)) return { error: 'Saisis un nombre.' };
    return { value: n };
  }
  // json : objet ou liste uniquement (les réglages du site sont toujours structurés)
  let parsed;
  try { parsed = JSON.parse(String(raw ?? '')); } catch (e) { return { error: `JSON invalide : ${e.message}` }; }
  if (parsed === null || typeof parsed !== 'object') return { error: 'Le JSON doit être un objet { … } ou une liste [ … ].' };
  return { value: parsed };
}

/** Texte affiché pour la valeur d'un réglage (JSON indenté pour les structures). */
export function displayValue(value) {
  if (kindOf(value) === 'json') return JSON.stringify(value, null, 2);
  return String(value);
}

import { KEYS_LOT3 } from './keys-lot3.js'; Object.assign(KEYS, KEYS_LOT3); // lot 3 : descripteurs Secret Santa, IRL, souvenirs
import { KEYS_LOT4 } from './keys-lot4.js'; Object.assign(KEYS, KEYS_LOT4); // lot 4 : ajout isolé
import { KEYS_LOT5 } from './keys-lot5.js'; Object.assign(KEYS, KEYS_LOT5); // lot 5 : bot, planning, assistance
