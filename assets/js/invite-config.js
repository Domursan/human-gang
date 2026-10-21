// ===== Réglages des invitations (hg_settings.invites) : lecture avec repli =====
// Valeurs actuelles par défaut ; une clé absente ou invalide donne exactement le comportement d'origine.
// Lisible par les visiteurs (politique hg_settings_read_invites_textes, migration 051).
import { sb } from './core.js';

export const INVITE_DEFAULTS = Object.freeze({
  validite_heures: 48,
  max_codes_heure_lien: 30,
  fantome_jours: 60,
  prefixe: 'HG-',
});

export const INVITE_LIMITS = Object.freeze({
  validite_heures: [1, 8760],
  max_codes_heure_lien: [1, 500],
  fantome_jours: [1, 365],
});
export const PREFIX_RE = /^[A-Z0-9]{1,8}-$/;

/** Fusionne une valeur brute (jsonb) avec les défauts ; renvoie { value } ou { error }. */
export function normalizeInviteConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { ...INVITE_DEFAULTS };
  for (const [k, [min, max]] of Object.entries(INVITE_LIMITS)) {
    if (src[k] === undefined || src[k] === null || src[k] === '') continue;
    const n = Number(src[k]);
    if (!Number.isInteger(n) || n < min || n > max) return { error: `« ${k} » doit être un nombre entier entre ${min} et ${max}.` };
    out[k] = n;
  }
  if (src.prefixe !== undefined && src.prefixe !== null && src.prefixe !== '') {
    const p = String(src.prefixe).toUpperCase();
    if (!PREFIX_RE.test(p)) return { error: 'Le préfixe doit être en lettres ou chiffres et finir par un tiret (ex. HG-).' };
    out.prefixe = p;
  }
  return { value: out };
}

let cache = null;
let pending = null;

/** Réglages courants (synchrone) : défauts tant que loadInviteConfig n'a pas réussi. */
export function inviteConfig() { return cache || INVITE_DEFAULTS; }

/** Charge hg_settings.invites une fois ; ne lève jamais (repli sur les défauts). */
export function loadInviteConfig() {
  if (!pending) {
    pending = (async () => {
      try {
        const { data, error } = await sb.from('hg_settings').select('value').eq('key', 'invites').maybeSingle();
        if (error) throw error;
        const r = normalizeInviteConfig(data?.value);
        cache = r.value || INVITE_DEFAULTS;
      } catch (e) {
        console.warn('[invites] réglages non lus, valeurs par défaut :', e?.message || e);
        cache = INVITE_DEFAULTS;
      }
      return cache;
    })();
  }
  return pending;
}

/** Oublie le cache (après une modification dans l'admin). */
export function resetInviteConfig() { cache = null; pending = null; }

/** Expression régulière d'un code d'invitation (préfixe réglé, 4 à 8 caractères ensuite). */
export function inviteCodeRe(prefix = inviteConfig().prefixe) {
  return new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[A-Z0-9]{4,8}$`);
}
