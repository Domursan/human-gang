// ===== Humane Gang — Carnet de voyage (carnet.html), idée S12 =====
/*
 * Rôle : fil des cartes postales du gang (photo, lieu, petit mot, date) avec rendu « carte postale » (timbre, tampon),
 * carte du monde des épingles (Leaflet, chargé à l'ouverture de la page), réactions, envoi d'une carte, onglet
 * « Mon carnet » (mes cartes, y compris celles en attente de publication, et mes pays : compteur, sans classement).
 * Vie privée : la photo est toujours réencodée (les métadonnées EXIF, dont la position GPS, disparaissent), la position
 * est arrondie par le serveur à une décimale (environ 10 km), et l'option « Publier à mon retour » diffère l'affichage.
 * Adresse : carnet.html (fil) ; carnet.html?membre=<id> (carnet d'un membre).
 * Dépendances : core.js, photos.js (URL signées, visionneuse, envoi), image-compress.js, map-loader.js, reactions.js,
 *   contenus-ui.js.
 * Données : table hg_postcards (lecture, filtrée par la base), RPC hg_postcard_add, hg_postcard_hide, hg_members.
 * Tout texte venant de la base passe par esc(). Le fichier n'exporte rien.
 */
import { sb, initPage, esc, $, toast, errMsg } from './core.js';
import { signedUrls, uploadImage, removeObjects, openLightbox, uuid } from './photos.js';
import { prepareImage } from './image-compress.js';
import { loadLeaflet, searchPlaces, TILE_URL, TILE_ATTRIBUTION } from './map-loader.js';
import { loadReactions, reactionBarHtml } from './reactions.js';
import { loadPeople, pseudoOf, formDialog, fmtJour, FUSEAU } from './contenus-ui.js';
import { pluralWord } from './utils.js';

const me = await initPage();

/* ---------- État ---------- */
const params = new URLSearchParams(location.search);
const MEMBRE = /^[0-9a-f-]{36}$/i.test(params.get('membre') || '') ? params.get('membre') : null;
const S = { rows: [], people: new Map(), urls: new Map(), tab: MEMBRE ? 'moi' : 'fil', map: null, layer: null, markers: new Map() };
const fTampon = new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: FUSEAU });
/** Noms de pays en français à partir du code (Intl.DisplayNames ; le code seul si indisponible). */
const pays = (() => {
  let dn = null;
  try { dn = new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { /* navigateur ancien */ }
  return (cc) => (cc ? (dn?.of(cc.toUpperCase()) || cc.toUpperCase()) : '');
})();

/** Cartes visibles dans le fil : publiées et non masquées (la base cache déjà les autres, sauf pour leur auteur et le Staff). */
const published = (p) => !p.hidden && new Date(p.publish_at) <= new Date();
/** Ville seule (avant la virgule), pour le tampon. */
const ville = (p) => String(p.place_label || '').split(',')[0];

/* ---------- Dessin ---------- */

/** Grande carte postale : photo avec timbre et tampon, auteur, lieu, petit mot. */
function postcard(p) {
  const url = S.urls.get(p.path);
  const who = pseudoOf(S.people, p.user_id);
  const date = p.taken_on || p.publish_at;
  return `<article class="cv-pc" aria-labelledby="pc-${esc(p.id)}">
    <button type="button" class="cv-photo" data-zoom="${esc(p.id)}" aria-label="Voir la photo de ${esc(p.place_label)} en grand">
      ${url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async">` : '<span class="cv-photo-missing" aria-hidden="true"></span>'}
      <span class="cv-stamp" aria-hidden="true"><span>HG</span></span>
      <span class="cv-tampon" aria-hidden="true">${esc(ville(p).toUpperCase().slice(0, 14))}<br>${esc(fTampon.format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00` : date)).replace(/\./g, '·'))}</span>
    </button>
    <div class="cv-pc-body">
      <p id="pc-${esc(p.id)}"><strong>${esc(who)}</strong> <span class="cv-place">· ${esc(p.place_label)}</span></p>
      ${p.message ? `<p class="cv-msg">${esc(p.message)}</p>` : ''}
      <p class="cv-date">${esc(fmtJour(date))}</p>
    </div>
  </article>
  <div class="cv-pc-foot">
    ${reactionBarHtml('postcard', p.id)}
    ${p.lat != null ? `<button type="button" class="btn btn-ghost cv-locate" data-locate="${esc(p.id)}">Voir sur la carte</button>` : ''}
  </div>`;
}

/** Ligne compacte d'une carte plus ancienne. */
function compact(p) {
  const url = S.urls.get(p.path);
  return `<li class="cv-li">
    <button type="button" class="cv-thumb" data-zoom="${esc(p.id)}" aria-label="Voir la photo de ${esc(p.place_label)} en grand">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : ''}</button>
    <div class="cv-li-body">
      <p><strong>${esc(pseudoOf(S.people, p.user_id))}</strong> <span class="muted">· ${esc(p.place_label)}</span></p>
      ${p.message ? `<p class="small muted">« ${esc(p.message)} »</p>` : ''}
      <p class="small muted">${esc(fmtJour(p.taken_on || p.publish_at))}</p>
      ${reactionBarHtml('postcard', p.id)}
    </div>
    ${p.lat != null ? `<button type="button" class="btn btn-ghost cv-locate" data-locate="${esc(p.id)}" aria-label="Voir ${esc(p.place_label)} sur la carte">Carte</button>` : ''}
  </li>`;
}

/** Onglet « Le fil » : la plus récente en grand, les autres en liste. */
function drawFeed() {
  const list = S.rows.filter(published).filter((p) => !MEMBRE || p.user_id === MEMBRE);
  const [first, ...rest] = list;
  $('#cv-feed').innerHTML = first
    ? `${postcard(first)}${rest.length ? `<ul class="cv-list">${rest.map(compact).join('')}</ul>` : ''}`
    : '<p class="ct-empty">Pas encore de carte postale. Tu pars bientôt ? Envoie la première !</p>';
}

/** Onglet « Mon carnet » (ou carnet d'un membre) : compteurs personnels et liste. */
function drawMine() {
  const who = MEMBRE || me.id;
  const own = who === me.id;
  const list = S.rows.filter((p) => p.user_id === who && (own || published(p)));
  const countries = new Set(list.filter((p) => p.country_code).map((p) => p.country_code));
  $('#cv-stats').innerHTML = `<div class="cv-stat"><b>${list.length}</b><span>${pluralWord(list.length, 'carte postale', 'cartes postales')}</span></div>
    <div class="cv-stat"><b>${countries.size}</b><span>${pluralWord(countries.size, 'pays', 'pays')}</span></div>
    ${countries.size ? `<p class="cv-flags small">${[...countries].map((c) => esc(pays(c))).sort((a, b) => a.localeCompare(b, 'fr')).join(' · ')}</p>` : ''}`;
  $('#cv-mine').innerHTML = list.length ? list.map((p) => {
    const later = new Date(p.publish_at) > new Date();
    return `<li class="cv-li">
      <button type="button" class="cv-thumb" data-zoom="${esc(p.id)}" aria-label="Voir la photo de ${esc(p.place_label)} en grand">${S.urls.get(p.path) ? `<img src="${esc(S.urls.get(p.path))}" alt="" loading="lazy">` : ''}</button>
      <div class="cv-li-body"><p><strong>${esc(p.place_label)}</strong></p>
        ${p.message ? `<p class="small muted">« ${esc(p.message)} »</p>` : ''}
        <p class="cv-pills">${later ? `<span class="ct-status ct-status-wait">Publiée le ${esc(fmtJour(p.publish_at))}</span>` : ''}${p.hidden ? '<span class="ct-status ct-status-ko">Masquée</span>' : ''}${p.geoguessr_ok ? '<span class="ct-status">GeoGuessr</span>' : ''}</p></div>
      ${own ? `<button type="button" class="btn btn-ghost" data-hide="${esc(p.id)}" data-hidden="${p.hidden}">${p.hidden ? 'Réafficher' : 'Masquer'}</button>` : ''}
    </li>`;
  }).join('') : `<li class="ct-empty">${own ? 'Ton carnet est vide pour le moment.' : 'Aucune carte postale pour ce membre.'}</li>`;
}

/** Onglets (ARIA) et panneaux. */
function drawTabs() {
  for (const k of ['fil', 'moi']) {
    const t = $(`#cv-tab-${k}`);
    t.setAttribute('aria-selected', String(S.tab === k));
    t.tabIndex = S.tab === k ? 0 : -1;
    $(`#cv-panel-${k}`).hidden = S.tab !== k;
  }
}

function draw() { drawTabs(); drawFeed(); drawMine(); updateMap(); }

/* ---------- Carte du monde ---------- */

/** Épingles des cartes visibles (une par carte, position déjà arrondie par le serveur). */
async function updateMap() {
  const visible = S.rows.filter((p) => p.lat != null && (published(p) || p.user_id === me.id)).filter((p) => !MEMBRE || p.user_id === MEMBRE);
  const countries = new Set(visible.filter((p) => p.country_code).map((p) => p.country_code));
  const status = $('#cv-map-status');
  status.textContent = `${visible.length} ${pluralWord(visible.length, 'carte', 'cartes')} · ${countries.size} pays`;
  let L;
  try { L = await loadLeaflet(); } catch (e) {
    $('#cv-map').classList.add('cv-map-off');
    status.textContent += ` — carte indisponible pour le moment (${e.message}).`;
    return;
  }
  if (!S.map) {
    S.map = L.map('cv-map', { scrollWheelZoom: false, worldCopyJump: true }).setView([30, 10], 1);
    L.tileLayer(TILE_URL, { maxZoom: 12, attribution: TILE_ATTRIBUTION }).addTo(S.map);
    S.layer = L.layerGroup().addTo(S.map);
  }
  S.layer.clearLayers();
  S.markers.clear();
  for (const p of visible) {
    const icon = L.divIcon({ className: 'cv-pin', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] });
    const m = L.marker([Number(p.lat), Number(p.lng)], { icon, title: `${pseudoOf(S.people, p.user_id)} · ${p.place_label}`, alt: p.place_label })
      .bindPopup(`<strong>${esc(pseudoOf(S.people, p.user_id))}</strong><br>${esc(p.place_label)}`).addTo(S.layer);
    S.markers.set(p.id, m);
  }
}

/* ---------- Données ---------- */

async function load() {
  try {
    const [people, res] = await Promise.all([S.people.size ? S.people : loadPeople(),
      sb.from('hg_postcards').select('*').order('publish_at', { ascending: false }).limit(300)]);
    if (res.error) throw res.error;
    S.people = people;
    S.rows = (res.data || []).slice().sort((a, b) => String(b.publish_at).localeCompare(String(a.publish_at)));
    S.urls = await signedUrls(S.rows.map((p) => p.path));
    await loadReactions('postcard', S.rows.filter(published).map((p) => p.id), me.id);
    if (MEMBRE) $('#cv-title').textContent = `Carnet de ${pseudoOf(S.people, MEMBRE) || 'voyage'}`;
    draw();
  } catch (e) {
    console.warn('[carnet]', e);
    $('#cv-feed').innerHTML = '<p class="ct-empty">Cartes postales indisponibles pour le moment. Recharge la page dans un instant.</p>';
  }
  $('#app').setAttribute('aria-busy', 'false');
}

/* ---------- Envoi d'une carte ---------- */

/** Boîte « Envoyer une carte postale ». */
function openSend() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU }).format(new Date());
  const st = { place: null };
  formDialog({
    title: 'Envoyer une carte postale',
    submit: 'Envoyer la carte',
    body: `<div class="field"><label for="cs-photo">Photo</label><input id="cs-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required>
        <span class="small muted">Les informations cachées de la photo (position GPS, appareil) sont retirées avant l’envoi.</span></div>
      <div class="field"><label for="cs-q">Lieu (ville ou site)</label>
        <div class="cv-search"><input id="cs-q" name="q" maxlength="80" placeholder="Kyoto, Chamonix…" autocomplete="off">
          <button type="button" class="btn btn-ghost" id="cs-find">Chercher</button></div>
        <div id="cs-results" class="cv-results" role="radiogroup" aria-label="Lieux trouvés"></div>
        <span class="small muted" id="cs-place-info" aria-live="polite">Seule la ville est enregistrée, arrondie à environ 10 km.</span></div>
      <div class="field"><label for="cs-msg">Petit mot</label><textarea id="cs-msg" name="message" maxlength="280" rows="3"></textarea></div>
      <div class="field"><label for="cs-date">Date de la photo</label><input id="cs-date" name="taken_on" type="date" max="${today}" value="${today}"></div>
      <label class="check"><input type="checkbox" name="later" id="cs-later"> <span>Publier à mon retour (pour ne pas annoncer que je suis absent de chez moi)</span></label>
      <div class="field" id="cs-pub-f" hidden><label for="cs-pub">Date de publication</label><input id="cs-pub" name="publish_on" type="date" min="${today}"></div>
      <label class="check"><input type="checkbox" name="geo"> <span>Utilisable pour le GeoGuessr du gang (au moins 30 jours après)</span></label>`,
    onSubmit: async (f) => {
      const file = f.photo.files?.[0];
      if (!file) throw new Error('Choisis une photo.');
      const place = st.place || (f.q.value.trim().length >= 2 ? { label: f.q.value.trim(), lat: null, lon: null, country_code: null } : null);
      if (!place) throw new Error('Indique le lieu (cherche-le pour l’épingler sur la carte).');
      let publishAt = null;
      if (f.later.checked) {
        if (!f.publish_on.value) throw new Error('Choisis la date de publication.');
        publishAt = new Date(`${f.publish_on.value}T08:00:00`).toISOString();
      }
      const img = await prepareImage(file, { strip: true });
      const ext = img.ext === 'jpg' ? 'jpg' : 'webp';
      const path = `${me.id}/postcards/${uuid()}.${ext}`;
      await uploadImage(path, img.blob);
      const { data, error } = await sb.rpc('hg_postcard_add', {
        p_path: path, p_place: place.label.slice(0, 80), p_country: place.country_code, p_lat: place.lat, p_lng: place.lon,
        p_message: f.message.value.trim() || null, p_taken_on: f.taken_on.value || null, p_publish_at: publishAt, p_geoguessr: f.geo.checked,
      });
      if (error) { removeObjects([path]).catch(() => {}); throw error; }
      const gain = Number(data?.reward) || 0;
      toast(`${publishAt ? `Carte enregistrée : elle sera publiée le ${fmtJour(publishAt)}.` : 'Carte postale envoyée !'}${gain ? ` Nouveau pays : +${gain} ✦` : ''}`, 'success');
      await load();
    },
  });
  $('#cs-later').addEventListener('change', (e) => { $('#cs-pub-f').hidden = !e.target.checked; });
  const find = async () => {
    const box = $('#cs-results'), info = $('#cs-place-info');
    box.innerHTML = '';
    st.place = null;
    info.textContent = 'Recherche…';
    try {
      const hits = await searchPlaces($('#cs-q').value);
      if (!hits.length) { info.textContent = 'Aucun lieu trouvé : le nom sera gardé tel quel, sans épingle.'; return; }
      box.innerHTML = hits.map((h, i) => `<label class="check"><input type="radio" name="place" value="${i}"> <span>${esc(h.label)}</span></label>`).join('');
      box.querySelectorAll('input').forEach((r) => r.addEventListener('change', () => {
        st.place = hits[Number(r.value)];
        info.textContent = `Lieu choisi : ${st.place.label}.`;
      }));
      info.textContent = 'Choisis le bon lieu.';
    } catch (e) {
      info.textContent = `${errMsg(e)}. Le nom sera gardé tel quel, sans épingle.`;
    }
  };
  $('#cs-find').addEventListener('click', find);
  $('#cs-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
}

/* ---------- Écouteurs ---------- */
$('#cv-send').addEventListener('click', openSend);
$('#app').addEventListener('click', async (e) => {
  const tab = e.target.closest('[role="tab"]');
  if (tab) { S.tab = tab.id === 'cv-tab-moi' ? 'moi' : 'fil'; drawTabs(); return; }
  const z = e.target.closest('[data-zoom]');
  if (z) {
    const p = S.rows.find((x) => x.id === z.dataset.zoom);
    const url = p && S.urls.get(p.path);
    if (url) openLightbox([{ url, alt: p.place_label, caption: `${pseudoOf(S.people, p.user_id)} · ${p.place_label}` }], 0);
    return;
  }
  const l = e.target.closest('[data-locate]');
  if (l) {
    const p = S.rows.find((x) => x.id === l.dataset.locate);
    if (S.map && p) { S.map.setView([Number(p.lat), Number(p.lng)], 6); S.markers.get(p.id)?.openPopup(); $('#cv-map').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else toast('La carte n’est pas disponible pour le moment.', 'error');
    return;
  }
  const h = e.target.closest('[data-hide]');
  if (h) {
    try {
      const { error } = await sb.rpc('hg_postcard_hide', { p_id: h.dataset.hide, p_hidden: h.dataset.hidden !== 'true' });
      if (error) throw error;
      toast(h.dataset.hidden === 'true' ? 'Carte réaffichée.' : 'Carte masquée.', 'success');
      await load();
    } catch (x) { toast(errMsg(x), 'error'); }
  }
});
// Flèches gauche / droite entre les deux onglets.
$('.cv-tabs').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  S.tab = S.tab === 'fil' ? 'moi' : 'fil';
  drawTabs();
  $(`#cv-tab-${S.tab}`).focus();
});

load();
