// Faux Leaflet (tests hors ligne) : juste ce qu'utilisent jeux/geo.js et admin-jeux.js.
// Servi à la place de cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js par les tests qui le demandent.
// window.__fakeMapClick(lat, lon) simule un clic sur la dernière carte créée ; window.__fakeMap garde son état
// (marqueurs, lignes, dernier cadrage) pour les vérifications.
(function () {
  /** Couche générique : addTo, setLatLng, bindTooltip. */
  function layer(kind, data) {
    const o = { kind, data, addTo(t) { (t.items || t.layers).push(o); return o; }, setLatLng(p) { o.data = p; return o; }, bindTooltip(t) { o.tip = t; return o; }, bindPopup() { return o; } };
    return o;
  }
  window.L = {
    map(el) {
      const m = { el, items: [], handlers: {}, center: [46.6, 7.2], zoom: 6, bounds: null,
        setView(c, z) { m.center = c; m.zoom = z; return m; }, on(ev, fn) { m.handlers[ev] = fn; return m; },
        invalidateSize() { return m; }, fitBounds(b) { m.bounds = b; return m; }, getCenter() { return { lat: m.center[0], lng: m.center[1] }; }, remove() {} };
      el.classList.add('leaflet-container');
      el.innerHTML = '<div class="fake-map">carte</div>';
      window.__fakeMap = m;
      window.__fakeMapClick = (lat, lng) => m.handlers.click?.({ latlng: { lat, lng } });
      return m;
    },
    tileLayer() { return layer('tiles'); },
    layerGroup() { const g = { layers: [], addTo(t) { t.items.push(g); return g; }, clearLayers() { g.layers.length = 0; } }; return g; },
    marker(p, o) { return layer('marker', p, o); },
    polyline(p) { return layer('line', p); },
    divIcon(o) { return o; },
  };
})();
