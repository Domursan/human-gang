// ===== Humane Gang — administration : jeux de la page « Jeux » (idées J1, J3) =====
/*
 * Rôle : deux sous-sections de Jeux et cartes › Jeux.
 *   GeoGuessr (#fete/geoguessr, Staff « souvenirs ») : manches programmées et réserve « jouable ». Pour créer une
 *     manche : choisir une sortie, une de ses photos, placer le vrai lieu sur la carte, nommer le lieu, choisir le jour
 *     (vide = réserve). La photo est recopiée dans un dossier neutre (<mon id>/geo/…) après recompression : ni EXIF,
 *     ni identifiant de sortie dans son chemin (sinon la réponse fuiterait avant le vote).
 *   Citations (#fete/citations, Staff « quiz ») : file des citations proposées (publier en reformulant, refuser),
 *     saisie directe d'une citation par le Staff (l'accord de l'auteur reste demandé).
 * Toutes les écritures passent par des RPC qui vérifient les droits et journalisent (migration 083).
 * Dépendances : core.js (sb, toast, errMsg, esc, getUser), photos.js (signatures, envoi), image-compress.js
 *   (recompression), leaflet-load.js (carte), ui-confirm.js (confirmation), admin/ui/drawer.js (tiroir).
 * Exporte : mountGeoSection, mountCitationsSection.
 */
import { sb, toast, errMsg, esc, getUser } from '../../commun/core.js';
import { signedUrls, signedUrl, uploadImage, uuid } from '../irl/photos.js';
import { prepareImage } from '../../commun/image-compress.js';
import { loadLeaflet, addOsmTiles } from '../../commun/leaflet-load.js';
import { confirmBox } from '../../commun/ui-confirm.js';
import { openDrawer } from './ui/drawer.js';

/* ---------- Outils communs ---------- */
const jourFmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** Jour AAAA-MM-JJ lisible. */
const jour = (d) => (d ? jourFmt.format(new Date(`${d}T00:00:00Z`)) : '');
/** Jour courant à Zurich (AAAA-MM-JJ). */
const aujourdHui = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
/** Bouton occupé (pas de double envoi). */
function occupe(btn, on) { if (!btn) return; btn.disabled = on; if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy'); }

/* =====================================================================
   GeoGuessr
   ===================================================================== */
const GEO = { root: null, rows: [] };

/**
 * Monte la sous-section GeoGuessr.
 * @param {HTMLElement} root Conteneur (#geo-admin-root).
 */
export async function mountGeoSection(root) {
  if (!root) return;
  GEO.root = root;
  root.innerHTML = `<div class="ajx">
    <div class="ajx-head">
      <p class="small muted ajx-intro">Une photo par jour (6 h), choisie dans les albums : paysage, façade, gare… jamais un logement ni un visage sans accord.
        Les jours sans manche programmée, une photo de la réserve est tirée au sort.</p>
      <button class="btn btn-primary" type="button" data-ajx="geo-new">+ Nouvelle manche</button>
    </div>
    <p class="small ajx-stats" id="ajx-geo-stats" aria-live="polite"></p>
    <div id="ajx-geo-list" class="ajx-list" aria-live="polite"><div class="empty">Chargement des manches…</div></div>
  </div>`;
  root.addEventListener('click', geoClick);
  await geoCharger();
}

/** Lit toutes les manches (avec la réponse : panel seulement). */
async function geoCharger() {
  const { data, error } = await sb.rpc('hg_geo_admin_list');
  const list = GEO.root.querySelector('#ajx-geo-list');
  if (error) { list.innerHTML = `<div class="empty">Manches indisponibles : ${esc(errMsg(error))}</div>`; return; }
  GEO.rows = Array.isArray(data) ? data : [];
  const today = aujourdHui();
  const reserve = GEO.rows.filter((r) => !r.day && r.active).length;
  const avenir = GEO.rows.filter((r) => r.day && r.day >= today && r.active).length;
  GEO.root.querySelector('#ajx-geo-stats').textContent = `${avenir} manche${avenir > 1 ? 's' : ''} programmée${avenir > 1 ? 's' : ''} · ${reserve} photo${reserve > 1 ? 's' : ''} en réserve${reserve < 14 ? ' (prévois-en une trentaine)' : ''}`;
  if (!GEO.rows.length) { list.innerHTML = '<div class="empty">Aucune manche pour l’instant. Crée la première !</div>'; return; }
  list.innerHTML = `<ul class="ajx-rows">${GEO.rows.map((r) => `<li class="ajx-row${r.active ? '' : ' is-off'}">
      <div class="ajx-row-main"><strong>${esc(r.label)}</strong>
        <span class="small muted">${r.day ? esc(jour(r.day)) : 'Réserve'}${r.event_title ? ` · ${esc(r.event_title)}` : ''} · ${r.guesses} tentative${r.guesses > 1 ? 's' : ''}</span></div>
      <span class="pill ${r.active ? (r.day ? 'pill-ok' : '') : 'pill-todo'}">${r.active ? (r.day ? (r.day < today ? 'Jouée' : 'Programmée') : 'Réserve') : 'Désactivée'}</span>
      <div class="btn-row"><button class="btn btn-ghost" type="button" data-ajx="geo-edit" data-id="${esc(r.id)}">Modifier</button>
        <button class="btn btn-ghost" type="button" data-ajx="geo-toggle" data-id="${esc(r.id)}">${r.active ? 'Désactiver' : 'Activer'}</button></div>
    </li>`).join('')}</ul>`;
}

/** Données envoyées à hg_geo_round_save à partir d'une ligne existante. */
const geoPayload = (r) => ({ day: r.day, lat: r.lat, lon: r.lon, label: r.label, image_path: r.image_path, photo_id: r.photo_id, event_id: r.event_id, active: r.active });

/** Clics de la sous-section GeoGuessr. */
async function geoClick(e) {
  const b = e.target.closest('[data-ajx]');
  if (!b) return;
  const act = b.dataset.ajx;
  if (act === 'geo-new') geoForm(null);
  else if (act === 'geo-edit') geoForm(GEO.rows.find((r) => r.id === b.dataset.id) || null);
  else if (act === 'geo-toggle') {
    const r = GEO.rows.find((x) => x.id === b.dataset.id);
    if (!r) return;
    occupe(b, true);
    const { error } = await sb.rpc('hg_geo_round_save', { p_id: r.id, p: { ...geoPayload(r), active: !r.active } });
    occupe(b, false);
    if (error) { toast(errMsg(error), 'error'); return; }
    toast(r.active ? 'Manche désactivée' : 'Manche activée', 'ok');
    geoCharger();
  }
}

/**
 * Tiroir de création ou de modification d'une manche.
 * @param {object|null} r Manche existante, ou null pour en créer une.
 */
async function geoForm(r) {
  const played = !!r && r.guesses > 0;
  const body = document.createElement('div');
  body.className = 'ajx-geo-form';
  body.innerHTML = `
    ${played ? '<p class="small ajx-warn">Cette manche a déjà été jouée : seuls le nom du lieu et l’activation peuvent changer.</p>' : ''}
    <div class="field"><label for="ajx-geo-event">Sortie</label>
      <select id="ajx-geo-event" ${played ? 'disabled' : ''}><option value="">Choisis une sortie…</option></select></div>
    <fieldset class="ajx-photos-fs"><legend>Photo</legend>
      <div class="ajx-photos" id="ajx-geo-photos">${r ? '<p class="small muted">Photo actuelle ci-dessous ; choisis une sortie pour la remplacer.</p>' : '<p class="small muted">Choisis d’abord une sortie.</p>'}</div>
      ${r ? '<img class="ajx-geo-cur" id="ajx-geo-cur" alt="Photo actuelle de la manche">' : ''}
    </fieldset>
    <div class="field"><span class="ajx-lbl" id="ajx-geo-map-l">Vrai lieu : touche la carte</span>
      <div class="ajx-geo-map" id="ajx-geo-map" role="application" aria-labelledby="ajx-geo-map-l"></div>
      <p class="small muted" id="ajx-geo-map-st" role="status"></p></div>
    <div class="ajx-grid2">
      <div class="field"><label for="ajx-geo-lat">Latitude</label><input id="ajx-geo-lat" type="number" step="any" min="-90" max="90" required ${played ? 'disabled' : ''} value="${r ? esc(r.lat) : ''}"></div>
      <div class="field"><label for="ajx-geo-lon">Longitude</label><input id="ajx-geo-lon" type="number" step="any" min="-180" max="180" required ${played ? 'disabled' : ''} value="${r ? esc(r.lon) : ''}"></div>
    </div>
    <div class="field"><label for="ajx-geo-label">Nom du lieu (montré après le vote)</label>
      <input id="ajx-geo-label" type="text" maxlength="120" required placeholder="Gare de la Part-Dieu" value="${r ? esc(r.label) : ''}"></div>
    <div class="field"><label for="ajx-geo-day">Jour (vide : réserve, tirée au sort un jour sans manche)</label>
      <input id="ajx-geo-day" type="date" min="${aujourdHui()}" ${played ? 'disabled' : ''} value="${r?.day ? esc(r.day) : ''}"></div>
    <label class="ajx-check"><input id="ajx-geo-active" type="checkbox" ${!r || r.active ? 'checked' : ''}> Manche active</label>`;
  const st = { photo: null, events: [] };
  openDrawer({
    title: r ? 'Modifier la manche' : 'Nouvelle manche GeoGuessr', wide: true, body, submitLabel: r ? 'Enregistrer' : 'Créer la manche',
    onSubmit: async (form) => {
      const v = (id) => form.querySelector(id).value.trim();
      const lat = Number(v('#ajx-geo-lat')), lon = Number(v('#ajx-geo-lon'));
      if (!v('#ajx-geo-lat') || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Place le vrai lieu sur la carte');
      let path = r?.image_path || null;
      let photoId = r?.photo_id || null;
      let eventId = v('#ajx-geo-event') || r?.event_id || null;
      if (st.photo) {
        path = await geoCopiePhoto(st.photo.path);
        photoId = st.photo.id;
        eventId = v('#ajx-geo-event') || eventId;
      }
      if (!path) throw new Error('Choisis une photo');
      const p = { day: v('#ajx-geo-day') || null, lat, lon, label: v('#ajx-geo-label'), image_path: path, photo_id: photoId, event_id: eventId,
        active: form.querySelector('#ajx-geo-active').checked };
      const { error } = await sb.rpc('hg_geo_round_save', { p_id: r?.id || null, p });
      if (error) throw error;
      toast(r ? 'Manche enregistrée' : 'Manche créée', 'success');
      geoCharger();
    },
  });
  if (r) signedUrl(r.image_path).then((u) => { const img = body.querySelector('#ajx-geo-cur'); if (u && img) img.src = u; });
  // Sorties (les plus récentes d'abord), puis leurs photos à la demande
  const { data: evs } = await sb.from('hg_events').select('id, title, starts_at').order('starts_at', { ascending: false }).limit(300);
  st.events = Array.isArray(evs) ? evs : [];
  const sel = body.querySelector('#ajx-geo-event');
  sel.insertAdjacentHTML('beforeend', st.events.map((ev) => `<option value="${esc(ev.id)}"${r?.event_id === ev.id ? ' selected' : ''}>${esc(ev.title)}${ev.starts_at ? ` · ${esc(new Date(ev.starts_at).toLocaleDateString('fr-CH'))}` : ''}</option>`).join(''));
  sel.addEventListener('change', () => geoPhotos(body, sel.value, st));
  // Carte : clic = vrai lieu ; les champs latitude / longitude restent modifiables à la main
  const mapSt = body.querySelector('#ajx-geo-map-st');
  try {
    const L = await loadLeaflet();
    const el = body.querySelector('#ajx-geo-map');
    if (!el.isConnected) return;
    const has = r && Number.isFinite(r.lat);
    const map = L.map(el, { scrollWheelZoom: false }).setView(has ? [r.lat, r.lon] : [46.6, 7.2], has ? 13 : 6);
    addOsmTiles(L, map);
    const icon = L.divIcon({ className: 'ajx-pin', html: '<span></span>', iconSize: [20, 20], iconAnchor: [10, 10] });
    let m = has ? L.marker([r.lat, r.lon], { icon, keyboard: false }).addTo(map) : null;
    const latI = body.querySelector('#ajx-geo-lat'), lonI = body.querySelector('#ajx-geo-lon');
    if (!played) {
      map.on('click', (ev) => {
        const p = [Number(ev.latlng.lat.toFixed(6)), Number((((ev.latlng.lng + 180) % 360 + 360) % 360 - 180).toFixed(6))];
        latI.value = p[0]; lonI.value = p[1];
        if (m) m.setLatLng(p); else m = L.marker(p, { icon, keyboard: false }).addTo(map);
        mapSt.textContent = `Vrai lieu : ${p[0]}, ${p[1]}`;
      });
      const sync = () => { const a = Number(latI.value), o = Number(lonI.value); if (latI.value && lonI.value && Number.isFinite(a) && Number.isFinite(o)) { if (m) m.setLatLng([a, o]); else m = L.marker([a, o], { icon, keyboard: false }).addTo(map); } };
      latI.addEventListener('change', sync); lonI.addEventListener('change', sync);
    }
    setTimeout(() => map.invalidateSize(), 200);
  } catch (err) {
    mapSt.textContent = `Carte indisponible (${err.message}) : saisis la latitude et la longitude.`;
    body.querySelector('#ajx-geo-map').hidden = true;
  }
}

/**
 * Photos d'une sortie, à choisir (boutons radio avec vignette).
 * @param {HTMLElement} body Formulaire.
 * @param {string} eventId Sortie.
 * @param {{photo: object|null}} st État du formulaire.
 */
async function geoPhotos(body, eventId, st) {
  const box = body.querySelector('#ajx-geo-photos');
  st.photo = null;
  if (!eventId) { box.innerHTML = '<p class="small muted">Choisis d’abord une sortie.</p>'; return; }
  box.innerHTML = '<p class="small muted">Chargement des photos…</p>';
  const { data, error } = await sb.from('hg_photos').select('id, path, caption').eq('event_id', eventId).order('created_at', { ascending: true }).limit(200);
  if (error) { box.innerHTML = `<p class="small">Photos indisponibles : ${esc(errMsg(error))}</p>`; return; }
  const photos = Array.isArray(data) ? data : [];
  if (!photos.length) { box.innerHTML = '<p class="small muted">Pas de photo dans cet album.</p>'; return; }
  const urls = await signedUrls(photos.map((p) => p.path));
  box.innerHTML = photos.map((p, i) => `<label class="ajx-photo"><input type="radio" name="ajx-geo-photo" value="${i}">
      <img src="${esc(urls.get(p.path) || '')}" alt="${esc(p.caption || `Photo ${i + 1}`)}" loading="lazy"></label>`).join('');
  box.addEventListener('change', (e) => { const i = Number(e.target.value); if (Number.isInteger(i)) st.photo = photos[i]; });
}

/**
 * Copie neutre d'une photo pour une manche : téléchargée, recompressée (sans métadonnées), envoyée dans <mon id>/geo/.
 * @param {string} srcPath Chemin de la photo d'origine.
 * @returns {Promise<string>} Chemin de la copie.
 */
async function geoCopiePhoto(srcPath) {
  const url = await signedUrl(srcPath);
  if (!url) throw new Error('Photo introuvable');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement de la photo impossible (${res.status})`);
  const blob = await res.blob();
  const file = new File([blob], 'manche', { type: blob.type || 'image/jpeg' });
  const img = await prepareImage(file);
  const me = await getUser();
  if (!me?.id) throw new Error('Session expirée');
  const path = `${me.id}/geo/${uuid()}.${img.ext}`;
  await uploadImage(path, img.blob);
  return path;
}

/* =====================================================================
   Citations « Qui a dit ça ? »
   ===================================================================== */
const CIT = { root: null, rows: [], membres: null };
const CIT_STATUT = { nouvelle: ['En attente de l’auteur', 'pill-current'], accord_auteur: ['Accord de l’auteur', 'pill-ok'], refusee: ['Refusée', 'pill-todo'], publiee: ['Publiée', 'pill'] };

/**
 * Monte la sous-section Citations.
 * @param {HTMLElement} root Conteneur (#citations-admin-root).
 */
export async function mountCitationsSection(root) {
  if (!root) return;
  CIT.root = root;
  root.innerHTML = `<div class="ajx">
    <div class="ajx-head">
      <p class="small muted ajx-intro">Rien qui gêne, vise ou expose quelqu’un ; rien du salon politique ; seulement des salons publics.
        Publication après l’accord de l’auteur (ou 3 jours sans réponse de sa part). La citation est masquée à son auteur.</p>
      <button class="btn btn-primary" type="button" data-ajx="cit-new">+ Saisir une citation</button>
    </div>
    <div id="ajx-cit-list" class="ajx-list" aria-live="polite"><div class="empty">Chargement des citations…</div></div>
  </div>`;
  root.addEventListener('click', citClick);
  await citCharger();
}

/** Lit la file des propositions. */
async function citCharger() {
  const { data, error } = await sb.rpc('hg_quote_queue');
  const list = CIT.root.querySelector('#ajx-cit-list');
  if (error) { list.innerHTML = `<div class="empty">Citations indisponibles : ${esc(errMsg(error))}</div>`; return; }
  CIT.rows = Array.isArray(data) ? data : [];
  if (!CIT.rows.length) { list.innerHTML = '<div class="empty">Aucune citation proposée pour l’instant.</div>'; return; }
  list.innerHTML = `<ul class="ajx-rows">${CIT.rows.map((x) => {
    const [lab, cls] = CIT_STATUT[x.status] || [x.status, 'pill'];
    const ouverte = x.status === 'nouvelle' || x.status === 'accord_auteur';
    return `<li class="ajx-row ajx-cit">
      <div class="ajx-row-main"><blockquote class="ajx-quote">« ${esc(x.quote)} »</blockquote>
        <span class="small muted">Auteur : <b>${esc(x.author)}</b> · proposée par ${esc(x.proposed_by)}${x.context ? ` · ${esc(x.context)}` : ''}${x.refused_by === 'auteur' ? ' · refusée par l’auteur' : ''}</span></div>
      <span class="pill ${cls}">${esc(lab)}</span>
      ${ouverte ? `<div class="btn-row"><button class="btn btn-primary" type="button" data-ajx="cit-pub" data-id="${esc(x.id)}"${x.publiable ? '' : ' disabled title="En attente de l’accord de l’auteur (3 jours au plus)"'}>Publier…</button>
        <button class="btn btn-danger" type="button" data-ajx="cit-ref" data-id="${esc(x.id)}">Refuser</button></div>` : ''}
    </li>`;
  }).join('')}</ul>`;
}

/** Membres (pour la saisie directe), chargés une fois. */
async function citMembres() {
  if (CIT.membres) return CIT.membres;
  const { data } = await sb.rpc('hg_members');
  CIT.membres = (Array.isArray(data) ? data : []).slice().sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo), 'fr'));
  return CIT.membres;
}

/** Clics : saisie, publication (reformulation possible), refus. */
async function citClick(e) {
  const b = e.target.closest('[data-ajx]');
  if (!b) return;
  const act = b.dataset.ajx;
  if (act === 'cit-new') {
    const membres = await citMembres();
    openDrawer({
      title: 'Saisir une citation', submitLabel: 'Envoyer à l’auteur',
      body: `<div class="field"><label for="ajx-cit-q">Citation (280 caractères au plus)</label><textarea id="ajx-cit-q" rows="3" maxlength="280" required></textarea></div>
        <div class="field"><label for="ajx-cit-a">Auteur</label><select id="ajx-cit-a" required><option value="">Choisis un membre…</option>${membres.map((m) => `<option value="${esc(m.id)}">${esc(m.pseudo)}</option>`).join('')}</select></div>
        <div class="field"><label for="ajx-cit-c">Contexte (montré après la réponse)</label><input id="ajx-cit-c" type="text" maxlength="200"></div>
        <p class="small muted">L’auteur la verra dans l’onglet « Qui a dit ça ? » et pourra la refuser.</p>`,
      onSubmit: async (f) => {
        const { error } = await sb.rpc('hg_quote_propose', { p_quote: f.querySelector('#ajx-cit-q').value, p_author: f.querySelector('#ajx-cit-a').value || null, p_context: f.querySelector('#ajx-cit-c').value || null });
        if (error) throw error;
        toast('Citation enregistrée', 'success');
        citCharger();
      },
    });
  } else if (act === 'cit-pub') {
    const x = CIT.rows.find((y) => y.id === b.dataset.id);
    if (!x) return;
    openDrawer({
      title: 'Publier la citation', subtitle: `Auteur : ${x.author}`, submitLabel: 'Publier',
      body: `<div class="field"><label for="ajx-pub-q">Citation (reformulable)</label><textarea id="ajx-pub-q" rows="3" maxlength="280" required>${esc(x.quote)}</textarea></div>
        <div class="field"><label for="ajx-pub-c">Contexte et date (montrés après la réponse)</label><input id="ajx-pub-c" type="text" maxlength="200" value="${esc(x.context || '')}"></div>
        <div class="ajx-grid2"><div class="field"><label for="ajx-pub-r">Paillettes (bonne réponse)</label><input id="ajx-pub-r" type="number" min="0" max="100" value="10"></div>
        <div class="field"><label for="ajx-pub-d">Difficulté</label><select id="ajx-pub-d"><option value="facile">Facile</option><option value="moyen">Moyen</option><option value="difficile">Difficile</option><option value="expert">Expert</option></select></div></div>
        <p class="small muted">Trois autres membres actifs sont tirés au sort comme mauvais choix.</p>`,
      onSubmit: async (f) => {
        const { error } = await sb.rpc('hg_quote_publish', { p_id: x.id, p_quote: f.querySelector('#ajx-pub-q').value, p_context: f.querySelector('#ajx-pub-c').value,
          p_reward: Number(f.querySelector('#ajx-pub-r').value) || 0, p_difficulty: f.querySelector('#ajx-pub-d').value });
        if (error) throw error;
        toast('Citation publiée dans « Qui a dit ça ? »', 'success');
        citCharger();
      },
    });
  } else if (act === 'cit-ref') {
    const x = CIT.rows.find((y) => y.id === b.dataset.id);
    if (!x || !(await confirmBox('Refuser cette citation ?', `« ${x.quote} »`, { ok: 'Refuser', danger: true }))) return;
    occupe(b, true);
    const { error } = await sb.rpc('hg_quote_refuse', { p_id: x.id });
    occupe(b, false);
    if (error) { toast(errMsg(error), 'error'); return; }
    toast('Citation refusée', 'ok');
    citCharger();
  }
}
