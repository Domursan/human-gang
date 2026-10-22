// =====================================================================
// Réglages : libellés, aides et règles des clés de hg_settings.
// Le registre KEYS regroupe les descriptions de toutes les clés connues. Il est construit à partir de KEYS_BASE
// puis complété par les fichiers keys-lot1 à keys-lot5 (chacun pour un lot de réglages).
// - managed : la clé a son propre éditeur dans une autre section (ancre) ; ici elle est en lecture seule.
// - sensitive : clé technique ; seul l'administrateur peut la modifier (le reste du panel ne suffit pas).
// Une clé inconnue du registre est affichée sans aide, et modifiable par le Staff (non sensible).
// Dépendances : keys-lot1.js à keys-lot5.js (descriptions par lot).
// Exporte : KEYS, KIND_LABEL, KEY_RE, isSensitive, managedOf, kindOf, parseValue, displayValue.
// =====================================================================
import { KEYS_LOT1 } from './keys-lot1.js';
import { KEYS_LOT2 } from './keys-lot2.js'; // lot 2 : comptes et invitations
import { KEYS_LOT3 } from './keys-lot3.js'; // lot 3 : descripteurs Secret Santa, IRL, souvenirs
import { KEYS_LOT4 } from './keys-lot4.js'; // lot 4 : ajout isolé
import { KEYS_LOT5 } from './keys-lot5.js'; // lot 5 : bot, planning, assistance

const KEYS_BASE = {
  theme: { label: 'Thème du site', help: 'Mode du site (clair, sombre, automatique) et thème forcé.', managed: '#theme', managedLabel: 'Thème' },
  bot: { label: 'Bot Discord', help: 'Salon d\'annonce, administrateur Discord et types de notifications.', managed: '#bot', managedLabel: 'Bot Discord' },
  bot_templates: { label: 'Modèles de messages du bot', help: 'Titres et textes des messages envoyés par le bot.', managed: '#bot', managedLabel: 'Bot Discord' },
  cards: { label: 'Économie du jeu de cartes', help: 'Taux de tirage, prix des boosters, récompenses en Paillettes.', managed: '#cartes', managedLabel: 'Cartes, onglet Économie' },
  push_vapid_public: { label: 'Clé publique des notifications (VAPID)', help: 'Clé publique Web Push. Elle doit correspondre à la clé privée de la fonction edge : la modifier casse les notifications des membres.', sensitive: true },
  domursan_owner: { label: 'Propriétaire Domursan', help: 'Identifiant technique du propriétaire de l\'app Domursan.', sensitive: true },
  quiz: { label: 'Questions du gang', help: 'Récompenses par défaut selon la difficulté des questions. Modifiable dans la section Questions du gang.', managed: '#cartes/questions', managedLabel: 'Questions du gang' },
  admin_initial: { label: 'Administrateur initial', help: 'Trace de l\'administrateur d\'origine du site.', sensitive: true },
};

/** Toutes les clés décrites : base + lot 1 (identité et textes, formulaire dédié). */
export const KEYS = { ...KEYS_BASE, ...KEYS_LOT1 };
Object.assign(KEYS, KEYS_LOT2);

/* Libellés des types d'éditeur, affichés dans les listes et le formulaire d'ajout. */
export const KIND_LABEL = { text: 'Texte', number: 'Nombre', bool: 'Oui / non', json: 'JSON (objet ou liste)' };
/* Forme d'un nom de clé : minuscules, chiffres et tiret bas, à partir d'une lettre, 2 à 41 caractères. */
export const KEY_RE = /^[a-z][a-z0-9_]{1,40}$/;
/* Longueur maximale d'une valeur texte (même limite que le champ du formulaire). */
const TEXT_MAX = 2000;

/** Vrai si la clé est sensible (seul l'administrateur peut la modifier). */
export const isSensitive = (key) => !!KEYS[key]?.sensitive;
/** Descripteur de la section qui gère la clé, ou null si la clé n'est gérée nulle part ailleurs. */
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

Object.assign(KEYS, KEYS_LOT3); // lot 3 : descripteurs Secret Santa, IRL, souvenirs
Object.assign(KEYS, KEYS_LOT4); // lot 4 : ajout isolé
Object.assign(KEYS, KEYS_LOT5); // lot 5 : bot, planning, assistance
