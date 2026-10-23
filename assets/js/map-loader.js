// ===== Humane Gang — carte du monde à la demande (Leaflet) et recherche de lieux (Nominatim) =====
/*
 * Rôle : charge Leaflet (feuille de style et script) une seule fois, et cherche des lieux par leur nom avec Nominatim
 * (une requête par seconde au plus, comme le demande le service). Repris de irl-history.js pour être partagé ;
 * irl-history.js garde pour l'instant sa propre copie (il pourra importer ce module plus tard).
 * Page : carnet.html (carnet.js). Services externes : cdn.jsdelivr.net (Leaflet), tuiles OpenStreetMap, Nominatim.
 * Exporte : loadLeaflet, searchPlaces, TILE_URL, TILE_ATTRIBUTION.
 */

/** Adresse des fichiers Leaflet. */
const LEAFLET = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist';
/** Tuiles OpenStreetMap et mention obligatoire. */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
/** Nominatim : une requête par seconde au plus. */
const GAP_MS = 1100;

let loading = null;
let lastCall = 0;

/**
 * Charge Leaflet une seule fois. En cas d'échec, les balises ajoutées sont retirées pour permettre un nouvel essai.
 * @returns {Promise<object>} L'objet L de Leaflet.
 */
export function loadLeaflet() {
  if (window.L?.map) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((res, rej) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = `${LEAFLET}/leaflet.css`; css.dataset.leaflet = '';
      document.head.append(css);
    }
    const s = document.createElement('script');
    s.src = `${LEAFLET}/leaflet.js`; s.async = true;
    s.onload = () => (window.L?.map ? res(window.L) : rej(new Error('bibliothèque de carte indisponible')));
    s.onerror = () => rej(new Error('bibliothèque de carte injoignable'));
    document.head.append(s);
  }).catch((e) => {
    loading = null;
    document.querySelectorAll('script[src^="https://cdn.jsdelivr.net/npm/leaflet"]').forEach((x) => x.remove());
    throw e;
  });
  return loading;
}

/**
 * Cherche des lieux (villes, sites) par leur nom. Renvoie au plus 5 résultats : libellé court (ville, pays),
 * position et code pays (deux lettres). Jette une erreur lisible si le service ne répond pas.
 * @param {string} q Texte cherché.
 * @returns {Promise<Array<{label: string, lat: number, lon: number, country_code: string|null}>>}
 */
export async function searchPlaces(q) {
  const text = String(q || '').trim();
  if (text.length < 2) return [];
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&accept-language=fr&q=${encodeURIComponent(text)}`,
    { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Recherche de lieu indisponible (HTTP ${r.status})`);
  const j = await r.json();
  return (Array.isArray(j) ? j : []).map((h) => {
    const a = h.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.county || h.name || String(h.display_name || '').split(',')[0];
    const label = [city, a.country].filter(Boolean).join(', ').slice(0, 80);
    const cc = typeof a.country_code === 'string' && /^[a-z]{2}$/i.test(a.country_code) ? a.country_code.toLowerCase() : null;
    return { label, lat: Number(h.lat), lon: Number(h.lon), country_code: cc };
  }).filter((p) => p.label && Number.isFinite(p.lat) && Number.isFinite(p.lon));
}
