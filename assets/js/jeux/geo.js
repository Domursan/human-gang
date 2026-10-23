// ===== Humane Gang — Jeux › GeoGuessr du gang (idée J1) =====
/*
 * Rôle : la manche du jour (une photo d'une sortie passée), une épingle à poser sur la carte, une seule tentative ;
 * puis le résultat : vraie position, ligne entre les deux points, distance, score sur 5 000, Paillettes, sortie
 * d'origine. Classements du jour et de la semaine ; archive des manches passées jouable « pour l'honneur ».
 * La réponse ne quitte le serveur qu'après le vote (RPC hg_geo_guess).
 * Onglet : jeux.html#geo. Contrat : mount(panel, ctx), unmount().
 * Dépendances : photos.js (adresses signées, visionneuse), leaflet-load.js (carte), jeux/commun.js, core.js (errMsg).
 * Données : RPC hg_geo_today, hg_geo_guess, hg_geo_board, hg_geo_archive (migration 083).
 */
import { errMsg } from '../core.js';
import { signedUrl, signedUrls, openLightbox } from '../photos.js';
import { loadLeaflet, addOsmTiles } from '../leaflet-load.js';
import { chargerCss, nf, km, gainHtml, classementHtml, jourLong } from './commun.js';

/* ---------- Constantes ---------- */
/** Vue de départ de la carte : Suisse et pays voisins. */
const VUE = { centre: [46.6, 7.2], zoom: 6 };

/* ---------- État ---------- */
// panel, ctx : panneau et contexte ; today : réponse de hg_geo_today ; round : manche affichée
// ({ id, day, number, image_path, honor, mine }) ; pin : épingle posée [lat, lon] ; map, L, layer : carte Leaflet ;
// scope : classement affiché (jour | semaine) ; archive : manches passées (null = pas encore chargées) ; busy : envoi en cours.
let G = null;

/* ---------- Outils ---------- */
/** Élément du panneau. */
const q = (sel) => G.panel.querySelector(sel);

/** Icône d'épingle de la carte (pastille ronde, couleur selon le rôle). */
function pinIcon(kind) {
  return G.L.divIcon({ className: `geo-pin geo-pin-${kind}`, html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
}

/* ---------- Montage ---------- */
/**
 * Monte l'onglet GeoGuessr.
 * @param {HTMLElement} panel Panneau vide de l'onglet.
 * @param {{sb: object, me: object, toast: Function, esc: Function}} ctx Contexte de la page.
 */
export async function mount(panel, ctx) {
  chargerCss('geo');
  G = { panel, ctx, today: null, round: null, pin: null, map: null, L: null, layer: null, pinMarker: null, scope: 'jour', archive: null, busy: false };
  panel.innerHTML = `<div class="jg geo">
    <header>
      <h2 class="jg-title">GeoGuessr du gang</h2>
      <p class="small muted jg-sub" id="geo-sub">Chargement de la manche…</p>
    </header>
    <div class="jg-grid2">
      <div class="jg-col">
        <figure class="geo-photo" id="geo-photo" hidden>
          <button class="geo-photo-btn" type="button" data-geo="zoom" aria-label="Agrandir la photo"><img id="geo-img" alt="Photo de la manche : où a-t-elle été prise ?"></button>
          <figcaption class="geo-photo-tag">Photo d’une sortie passée</figcaption>
        </figure>
        <section class="jg-card geo-play" id="geo-play" aria-labelledby="geo-play-h">
          <div class="jg-between geo-play-head">
            <h3 class="jg-h3" id="geo-play-h">Où a-t-elle été prise ?</h3>
            <button class="btn btn-ghost geo-back" type="button" data-geo="today" hidden>Manche du jour</button>
          </div>
          <p class="small muted geo-hint" id="geo-hint">Touche la carte pour poser ton épingle, puis valide. Une seule tentative.</p>
          <div class="geo-map" id="geo-map" role="application" aria-label="Carte : touche l’endroit où la photo a été prise" aria-describedby="geo-hint"></div>
          <p class="small muted geo-map-status" id="geo-status" role="status" aria-live="polite"></p>
          <div class="btn-row geo-actions" id="geo-actions">
            <button class="btn btn-ghost" type="button" data-geo="centre">Épingle au centre</button>
            <button class="btn btn-primary geo-valider" type="button" data-geo="valider" disabled>Valider mon épingle</button>
          </div>
          <div class="geo-result" id="geo-result" hidden tabindex="-1"></div>
        </section>
      </div>
      <div class="jg-col">
        <section class="jg-card geo-board" aria-labelledby="geo-board-h">
          <div class="jg-between">
            <h3 class="jg-h3" id="geo-board-h">Classement du jour</h3>
            <div class="jg-seg" role="group" aria-label="Période du classement">
              <button type="button" data-geo="scope" data-scope="jour" aria-pressed="true">Jour</button>
              <button type="button" data-geo="scope" data-scope="semaine" aria-pressed="false">Semaine</button>
            </div>
          </div>
          <div id="geo-board" aria-live="polite"><p class="jg-empty-row">Chargement…</p></div>
        </section>
        <details class="jg-card geo-archive" id="geo-archive">
          <summary><span class="jg-h3">Manches passées</span> <span class="small muted">pour l’honneur, sans Paillettes</span></summary>
          <div class="geo-archive-grid" id="geo-archive-grid"><p class="jg-empty-row">Chargement…</p></div>
        </details>
        <p class="small muted geo-rules" id="geo-rules"></p>
      </div>
    </div>
  </div>`;
  panel.addEventListener('click', onClick);
  q('#geo-archive').addEventListener('toggle', () => { if (q('#geo-archive').open && !G.archive) chargerArchive(); });
  panel.addEventListener('jeux:show', () => G?.map?.invalidateSize());
  await charger();
}

/** Libère la carte (appelé en quittant la page). */
export function unmount() {
  try { G?.map?.remove(); } catch { /* carte déjà retirée */ }
  G = null;
}

/* ---------- Chargement ---------- */
/** Lit la manche du jour, puis affiche la manche, les règles et le classement. */
async function charger() {
  const { sb, toast } = G.ctx;
  const { data, error } = await sb.rpc('hg_geo_today');
  if (error) {
    q('#geo-sub').textContent = 'La manche n’a pas pu être chargée.';
    toast(`GeoGuessr : ${errMsg(error)}`, 'error');
    return;
  }
  G.today = data || {};
  regles(G.today.reglages || {});
  if (G.today.round) await afficher({ ...G.today.round, honor: false, mine: G.today.mine || null });
  else aucuneManche();
  await chargerClassement();
}

/** Règles du jeu, avec les réglages du serveur. */
function regles(r) {
  const b = Array.isArray(r.bonus) ? r.bonus : [100, 60, 30];
  q('#geo-rules').textContent = `Une nouvelle manche chaque jour à 6 h. Score sur 5 000 selon la distance ; 1 Paillette pour ${nf(r.points_par_paillette || 100)} points, ${nf(r.plafond ?? 50)} au plus par jour. Le lundi, le podium de la semaine reçoit ${b.map(nf).join(', ')} Paillettes.`;
}

/** Pas de manche aujourd'hui : message, pas de carte. */
function aucuneManche() {
  q('#geo-sub').textContent = `${jourLong(G.today.day)} · pas de manche aujourd’hui`;
  q('#geo-photo').hidden = true;
  q('#geo-play').innerHTML = '<h3 class="jg-h3">Pas de manche aujourd’hui</h3><p class="small muted">Le Staff n’a pas encore préparé de photo. Reviens demain à 6 h, ou rejoue une manche passée pour l’honneur.</p>';
}

/* ---------- Affichage d'une manche ---------- */
/**
 * Affiche une manche (du jour ou de l'archive) : photo, carte, et le résultat si elle a déjà été jouée.
 * @param {{id: string, day: string, number: number, image_path: string, honor: boolean, mine: object|null}} r
 */
async function afficher(r) {
  G.round = r;
  G.pin = null;
  const sub = `Manche n°${nf(r.number)} · ${jourLong(r.day)} · ${r.honor ? 'pour l’honneur, sans Paillettes' : 'une tentative par jour'}`;
  q('#geo-sub').textContent = sub;
  q('.geo-back').hidden = !r.honor || !G.today?.round;
  const img = q('#geo-img');
  q('#geo-photo').hidden = false;
  img.removeAttribute('src');
  signedUrl(r.image_path).then((u) => { if (G?.round === r && u) img.src = u; });
  q('#geo-result').hidden = true;
  q('#geo-actions').hidden = !!r.mine;
  q('#geo-hint').hidden = !!r.mine;
  q('.geo-valider').disabled = true;
  await carte();
  if (!G.map) return;
  G.layer.clearLayers();
  G.pinMarker = null;
  if (r.mine) resultat(r.mine, false);
  else {
    G.map.setView(VUE.centre, VUE.zoom);
    q('#geo-status').textContent = '';
  }
}

/** Prépare la carte Leaflet (une fois). En cas d'échec : message et bouton « Réessayer ». */
async function carte() {
  if (G.map) { G.map.invalidateSize(); return; }
  const status = q('#geo-status');
  status.textContent = 'Chargement de la carte…';
  try {
    G.L = await loadLeaflet();
  } catch (e) {
    if (!G) return;
    status.innerHTML = '';
    status.append(`Carte indisponible pour le moment (${e.message}). `);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-ghost'; b.textContent = 'Réessayer'; b.dataset.geo = 'retry-map';
    status.append(b);
    q('#geo-map').classList.add('is-off');
    return;
  }
  if (!G) return;
  q('#geo-map').classList.remove('is-off');
  status.textContent = '';
  const L = G.L;
  G.map = L.map(q('#geo-map'), { scrollWheelZoom: false, worldCopyJump: true }).setView(VUE.centre, VUE.zoom);
  addOsmTiles(L, G.map);
  G.layer = L.layerGroup().addTo(G.map);
  G.map.on('click', (e) => poser(e.latlng.lat, e.latlng.lng));
}

/**
 * Pose (ou déplace) l'épingle du membre, tant qu'il n'a pas validé.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 */
function poser(lat, lon) {
  if (!G?.round || G.round.mine || G.busy) return;
  const lng = ((((lon + 180) % 360) + 360) % 360) - 180; // carte répétée : longitude ramenée dans [-180, 180]
  G.pin = [lat, lng];
  if (G.pinMarker) G.pinMarker.setLatLng(G.pin);
  else G.pinMarker = G.L.marker(G.pin, { icon: pinIcon('moi'), title: 'Ton épingle', alt: 'Ton épingle', keyboard: false }).addTo(G.layer);
  q('.geo-valider').disabled = false;
  q('#geo-status').textContent = 'Épingle posée. Touche ailleurs pour la déplacer, puis valide.';
}

/* ---------- Vote et résultat ---------- */
/** Envoie l'épingle (une seule tentative) et affiche le résultat. */
async function valider() {
  if (!G.pin || G.busy || !G.round || G.round.mine) return;
  const { sb, toast } = G.ctx;
  const btn = q('.geo-valider');
  G.busy = true; btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  const { data, error } = await sb.rpc('hg_geo_guess', { p_round: G.round.id, p_lat: G.pin[0], p_lon: G.pin[1] });
  if (!G) return;
  G.busy = false; btn.removeAttribute('aria-busy');
  if (error) { btn.disabled = false; toast(errMsg(error), 'error'); return; }
  G.round.mine = data;
  if (!G.round.honor && G.today) G.today.mine = data;
  q('#geo-actions').hidden = true;
  q('#geo-hint').hidden = true;
  resultat(data, true);
  if (data.reward > 0) toast(`+${nf(data.reward)} Paillettes`, 'success');
  G.archive = null;
  if (q('#geo-archive').open) chargerArchive();
  chargerClassement();
}

/**
 * Résultat d'une manche jouée : deux épingles et la ligne qui les relie, score, distance, gain et sortie d'origine.
 * @param {object} m Tentative { lat, lon, distance_m, score, reward, honor, solution }.
 * @param {boolean} focus Donne le focus au résultat (juste après le vote).
 */
function resultat(m, focus) {
  const { esc } = G.ctx;
  const sol = m.solution || {};
  if (G.map && Number.isFinite(sol.lat) && Number.isFinite(sol.lon)) {
    const L = G.L;
    G.layer.clearLayers();
    G.pinMarker = null;
    const moi = [m.lat, m.lon], vrai = [sol.lat, sol.lon];
    L.polyline([moi, vrai], { color: '#F2EFEA', weight: 2, dashArray: '6 5', interactive: false }).addTo(G.layer);
    L.marker(vrai, { icon: pinIcon('vrai'), title: 'Vrai lieu', alt: 'Vrai lieu', keyboard: false }).addTo(G.layer)
      .bindTooltip('Vrai lieu', { permanent: true, direction: 'top', className: 'geo-tip geo-tip-vrai', offset: [0, -10] });
    L.marker(moi, { icon: pinIcon('moi'), title: 'Ton épingle', alt: 'Ton épingle', keyboard: false }).addTo(G.layer)
      .bindTooltip('Ton épingle', { permanent: true, direction: 'bottom', className: 'geo-tip geo-tip-moi', offset: [0, 10] });
    G.map.fitBounds([moi, vrai], { padding: [48, 48], maxZoom: 15 });
  }
  const gain = m.honor ? '<span class="pill">Pour l’honneur</span>' : m.reward > 0 ? gainHtml(m.reward) : '<span class="pill">0 Paillette</span>';
  const date = sol.event_date ? ` (${new Intl.DateTimeFormat('fr-CH', { month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' }).format(new Date(sol.event_date))})` : '';
  const origine = sol.label ? `<div class="geo-origin">
      <span class="small">C’était : <b>${esc(sol.label)}</b>${sol.event_title ? `, ${esc(sol.event_title)}${esc(date)}` : ''}</span>
      ${sol.event_id ? `<a class="small geo-album" href="irl.html#event-${encodeURIComponent(sol.event_id)}">Voir l’album</a>` : ''}
    </div>` : '';
  const box = q('#geo-result');
  box.innerHTML = `<div class="jg-between">
      <div><div class="jg-display geo-score">${nf(m.score)} <span class="small muted">/ 5 000</span></div>
      <div class="small muted">Ton épingle est à ${esc(km(m.distance_m))}</div></div>
      ${gain}
    </div>${origine}`;
  box.hidden = false;
  q('#geo-status').textContent = `Résultat : ${nf(m.score)} points sur 5 000, à ${km(m.distance_m)} du vrai lieu${sol.label ? ` (${sol.label})` : ''}.`;
  if (focus) box.focus({ preventScroll: false });
}

/* ---------- Classement ---------- */
/** Charge et affiche le classement (jour, semaine, ou la manche de l'archive affichée). */
async function chargerClassement() {
  if (!G) return;
  const { sb, me, esc } = G.ctx;
  const archive = G.round?.honor ? G.round : null;
  const scope = archive ? 'jour' : G.scope;
  q('#geo-board-h').textContent = archive ? `Classement de la manche n°${nf(archive.number)}` : scope === 'semaine' ? 'Classement de la semaine' : 'Classement du jour';
  q('.geo-board .jg-seg').hidden = !!archive;
  const box = q('#geo-board');
  const { data, error } = await sb.rpc('hg_geo_board', { p_scope: scope, p_round: archive ? archive.id : null });
  if (!G) return;
  if (error) { box.innerHTML = `<p class="jg-empty-row">Classement indisponible : ${esc(errMsg(error))}</p>`; return; }
  const rows = Array.isArray(data) ? data : [];
  const vide = archive && !archive.mine ? 'Joue cette manche pour voir son classement.' : scope === 'semaine' ? 'Personne n’a encore joué cette semaine.' : 'Personne n’a encore joué aujourd’hui. À toi !';
  box.innerHTML = classementHtml(rows, {
    me: me?.id, vide, label: q('#geo-board-h').textContent,
    droite: (r) => scope === 'semaine'
      ? `<span class="small muted">${nf(r.manches)} manche${r.manches > 1 ? 's' : ''}</span><span class="jg-score">${nf(r.score)}</span>`
      : `<span class="small muted">${esc(km(r.distance_m))}</span><span class="jg-score">${nf(r.score)}</span>`,
  });
}

/* ---------- Archive ---------- */
/** Charge les manches passées (vignettes, mon score). */
async function chargerArchive() {
  const { sb, esc } = G.ctx;
  const grid = q('#geo-archive-grid');
  const { data, error } = await sb.rpc('hg_geo_archive');
  if (!G) return;
  if (error) { grid.innerHTML = `<p class="jg-empty-row">Archive indisponible : ${esc(errMsg(error))}</p>`; return; }
  G.archive = Array.isArray(data) ? data : [];
  if (!G.archive.length) { grid.innerHTML = '<p class="jg-empty-row">Pas encore de manche passée.</p>'; return; }
  grid.innerHTML = G.archive.map((r, i) => `<button class="geo-arch" type="button" data-geo="arch" data-i="${i}"${G.round?.id === r.id ? ' aria-current="true"' : ''}>
      <span class="geo-arch-img"><img alt="" data-path="${esc(r.image_path)}" loading="lazy"></span>
      <span class="geo-arch-txt"><b>N°${nf(r.number)}</b> · ${esc(jourLong(r.day))}</span>
      <span class="small ${r.score == null ? 'jg-sand' : 'muted'}">${r.score == null ? 'À jouer' : `${nf(r.score)} pts${r.label ? ` · ${esc(r.label)}` : ''}`}</span>
    </button>`).join('');
  const urls = await signedUrls(G.archive.map((r) => r.image_path));
  if (!G) return;
  for (const img of grid.querySelectorAll('img[data-path]')) { const u = urls.get(img.dataset.path); if (u) img.src = u; }
}

/* ---------- Clics ---------- */
/** Délégation des clics du panneau. */
function onClick(e) {
  const b = e.target.closest('[data-geo]');
  if (!b || !G) return;
  const act = b.dataset.geo;
  if (act === 'valider') valider();
  else if (act === 'centre' && G.map) { const c = G.map.getCenter(); poser(c.lat, c.lng); }
  else if (act === 'zoom') { const src = q('#geo-img').src; if (src) openLightbox([{ url: src, alt: 'Photo de la manche' }]); }
  else if (act === 'retry-map') { carte().then(() => { if (G?.round) afficher(G.round); }); }
  else if (act === 'scope') {
    G.scope = b.dataset.scope;
    for (const x of G.panel.querySelectorAll('[data-geo="scope"]')) x.setAttribute('aria-pressed', String(x === b));
    chargerClassement();
  } else if (act === 'arch') {
    const r = G.archive?.[Number(b.dataset.i)];
    if (!r) return;
    for (const x of G.panel.querySelectorAll('.geo-arch')) x.toggleAttribute('aria-current', x === b);
    afficher({ id: r.id, day: r.day, number: r.number, image_path: r.image_path, honor: true, mine: r.mine || null })
      .then(() => { chargerClassement(); q('#geo-play').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  } else if (act === 'today' && G.today?.round) {
    for (const x of G.panel.querySelectorAll('.geo-arch')) x.removeAttribute('aria-current');
    afficher({ ...G.today.round, honor: false, mine: G.today.mine || null }).then(chargerClassement);
  }
}

/* ---------- Résumé pour l'onglet « Aujourd'hui » ---------- */
/**
 * État de la manche du jour pour le tableau de bord.
 * @param {{sb: object}} ctx Contexte de la page.
 * @returns {Promise<{etat: string, texte: string, badge: string, gain?: number}>}
 */
export async function resume({ sb }) {
  const { data, error } = await sb.rpc('hg_geo_today');
  if (error) throw error;
  const r = data?.round;
  if (!r) return { etat: 'info', texte: 'Pas de manche aujourd’hui', badge: 'Demain 6 h' };
  if (data.mine) return { etat: 'fait', texte: `Manche n°${nf(r.number)} · ${km(data.mine.distance_m)} · ${nf(data.mine.score)} pts`, badge: 'Fait', gain: Number(data.mine.reward) || 0 };
  return { etat: 'a_jouer', texte: `Manche n°${nf(r.number)} · une photo à situer`, badge: 'À jouer' };
}
