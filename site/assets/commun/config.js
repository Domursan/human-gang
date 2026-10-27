// Configuration publique Supabase (clé "publishable" : faite pour être dans le navigateur, la sécurité est assurée par les règles RLS)
/*
 * Rôle : adresse du projet Supabase, clé publique, et adresse du logo par défaut.
 * Page : toutes les pages (importé par supabase.js, photos.js et site-defaults.js).
 * Dépendances : aucune. Aucun secret ici : seule la clé publique est utilisée côté navigateur.
 * Exporte : SUPABASE_URL, SUPABASE_KEY, LOGO_SRC.
 */
export const SUPABASE_URL = 'https://zqbdzokyhgavgmqgiwuw.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Pnq8U6lmFw5qavh98y1HKQ_9mHs-YTm';
export const LOGO_SRC = new URL('../images/marque/logo-1600.webp', import.meta.url).href;
