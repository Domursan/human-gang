// Chargement des réglages du site (hg_settings : site_identite, site_textes). Ne lève jamais d'erreur :
// en cas d'échec, la page garde le dernier état connu (cache) ou les valeurs par défaut.
import { sb } from './supabase.js';
import { setSiteRaw } from './site-defaults.js';

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
