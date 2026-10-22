// Chargement des réglages du site (hg_settings : site_identite, site_textes). Ne lève jamais d'erreur :
// en cas d'échec, la page garde le dernier état connu (cache) ou les valeurs par défaut.
/*
 * Rôle : lit dans la table hg_settings l'identité du site (nom, copyright, options) et ses textes,
 * puis les transmet à site-defaults.js qui s'en sert pour remplir la page.
 * Page : toutes les pages (init.js lance le chargement en parallèle du profil).
 * Dépendances : supabase.js (requête), site-defaults.js (setSiteRaw).
 * Exporte : loadSiteSettings.
 */
import { sb } from './supabase.js';
import { setSiteRaw } from './site-defaults.js';

/**
 * Charge les réglages « site_identite » et « site_textes » depuis hg_settings et les enregistre.
 * Ne jette jamais : une erreur est seulement signalée dans la console, et les valeurs précédentes restent.
 * @returns {Promise<void>}
 */
export async function loadSiteSettings() {
  try {
    const { data, error } = await sb.from('hg_settings').select('key, value').in('key', ['site_identite', 'site_textes']);
    if (error) throw error;
    const raw = { identite: {}, textes: {} }; // ligne absente (ou lecture refusée) : valeurs par défaut
    for (const r of data ?? []) {
      if (r.key === 'site_identite') raw.identite = r.value ?? {};
      if (r.key === 'site_textes') raw.textes = r.value ?? {};
    }
    setSiteRaw(raw);
  } catch (e) {
    console.warn('[réglages du site]', e);
  }
}
