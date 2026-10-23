// ===== Humane Gang — chargement de Leaflet (bibliothèque de cartes), partagé =====
/*
 * Rôle : charge une seule fois la feuille de style et le script de Leaflet depuis le CDN autorisé par la CSP,
 * et fournit le fond de carte OpenStreetMap commun. En cas d'échec, les balises ajoutées sont retirées pour
 * qu'une nouvelle tentative reste possible.
 * Pages : jeux.html (onglet GeoGuessr), admin.html (manches GeoGuessr). La carte des lieux d'irl-history.js
 *   garde pour l'instant son propre chargeur (même adresse, même balise data-leaflet : les deux cohabitent).
 * Dépendances : aucune.
 * Exporte : LEAFLET, loadLeaflet, addOsmTiles.
 */

/** Dossier de Leaflet sur le CDN (version figée, autorisée par la CSP des pages). */
export const LEAFLET = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist';

/** Chargement en cours ou terminé (une seule promesse par page). */
let loading = null;

/**
 * Charge Leaflet (feuille de style et script) une seule fois.
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
 * Ajoute le fond de carte OpenStreetMap (avec son attribution) à une carte.
 * @param {object} L Objet Leaflet.
 * @param {object} map Carte Leaflet.
 * @returns {object} La couche ajoutée.
 */
export function addOsmTiles(L, map) {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
}
