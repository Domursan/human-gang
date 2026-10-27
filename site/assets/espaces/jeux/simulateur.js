/* Simulateur de téléphone (/pages/jeux/simulateur.html) : outil de test pour l'admin, hors navigation du site.
   Sorti de la page (ancien script inline) pour que la Content-Security-Policy de /pages/jeux/simulateur.html n'ait pas besoin
   de 'unsafe-inline' dans script-src. Contenu inchangé. */
/* ---------- Données ---------- */

/** Téléphones proposés : largeur et hauteur de la zone d'affichage du navigateur (en pixels CSS), barre d'état, style. */
const DEVICES = [
  { id: 'iphone-se', name: 'iPhone SE', w: 375, h: 667, status: 20, kind: 'iphone', notch: false, home: false },
  { id: 'iphone-13-mini', name: 'iPhone 13 mini', w: 375, h: 812, status: 44, kind: 'iphone', notch: true, home: true },
  { id: 'iphone-15', name: 'iPhone 15', w: 393, h: 852, status: 54, kind: 'iphone', notch: true, home: true },
  { id: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', w: 430, h: 932, status: 54, kind: 'iphone', notch: true, home: true },
  { id: 'galaxy-s23', name: 'Samsung Galaxy S23', w: 360, h: 780, status: 28, kind: 'android', notch: true, home: false },
  { id: 'pixel-8', name: 'Google Pixel 8', w: 412, h: 915, status: 28, kind: 'android', notch: true, home: false },
  { id: 'ipad-mini', name: 'iPad mini', w: 744, h: 1133, status: 24, kind: 'iphone', notch: false, home: true },
];
/** Appareils montrés en mode « Comparer ». */
const COMPARE = ['iphone-se', 'iphone-15', 'galaxy-s23'];
/** Pages du site, pour la liste de raccourcis. */
const PAGES = [
  ['/pages/compte/accueil.html', 'Accueil'], ['/index.html', 'Intro'], ['/pages/irl/secret-santa.html', 'Secret Santa'], ['/pages/irl/irl.html', 'Sorties IRL'],
  ['/pages/irl/historique.html', 'Historique'], ['/pages/compte/messages.html', 'Messages'], ['/pages/cartes/cartes.html', 'Cartes'], ['/pages/irl/evenements.html', 'Événements'],
  ['/pages/compte/compte.html', 'Mon compte'], ['/pages/compte/membre.html', 'Carte de membre'], ['/pages/irl/recap.html', "Récap de l'année"], ['/pages/infos/aide.html', 'Aide et tutos'],
  ['/pages/infos/assistance.html', 'Assistance'], ['/pages/admin/admin.html', 'Administration'], ['/pages/infos/legal.html', 'Mentions légales'], ['/pages/infos/rejoindre.html', 'Rejoindre'],
  ['/affiches/index.html', 'Affiches'],
];

/* ---------- État ---------- */

const $ = (s) => document.querySelector(s);
const base = new URL('/', location.href); // racine du site : les chemins de la liste sont absolus
/** Préférences mémorisées dans ce navigateur (appareil, zoom, page). */
const saved = (() => { try { return JSON.parse(localStorage.getItem('hg_simulateur') || '{}'); } catch { return {}; } })();
const state = {
  device: DEVICES.some((d) => d.id === saved.device) ? saved.device : 'iphone-15',
  landscape: false,
  compare: false,
  zoom: saved.zoom || 'fit',
  path: saved.path || '/pages/compte/accueil.html',
};

/** Enregistre les préférences (silencieux si le stockage est indisponible). */
function persist() {
  try { localStorage.setItem('hg_simulateur', JSON.stringify({ device: state.device, zoom: state.zoom, path: state.path })); } catch { /* sans effet */ }
}

/* ---------- Rendu ---------- */

/** Construit le cadre d'un téléphone avec son iframe. */
function phoneEl(d) {
  const w = state.landscape ? d.h : d.w;
  const h = state.landscape ? d.w : d.h;
  const status = state.landscape ? 0 : d.status;
  const home = state.landscape || !d.home ? 0 : 22;
  const slot = document.createElement('div');
  slot.className = 'slot';
  slot.innerHTML = `
    <div class="box"><div class="scaler">
      <div class="phone ${d.kind}${d.notch ? '' : ' no-notch'}${d.home ? '' : ' no-home'}${state.landscape ? ' landscape' : ''}">
        <div class="screen" style="width:${w}px;height:${h + status + home}px">
          <div class="status" style="height:${status}px"><span>12:56</span><span>5G ▮▮▮</span></div>
          <span class="island" aria-hidden="true"></span>
          <iframe title="${d.name}" style="height:${h}px" src="${new URL(state.path, base).href}"></iframe>
          <div class="home" aria-hidden="true"></div>
        </div>
      </div>
    </div></div>
    <span class="slot-label">${d.name} · ${w} × ${h}</span>`;
  const frame = slot.querySelector('iframe');
  frame.addEventListener('load', () => onFrameLoad(frame));
  return slot;
}

/** Affiche le ou les téléphones selon le mode. */
function render() {
  const stage = $('#stage');
  stage.replaceChildren();
  const list = state.compare ? DEVICES.filter((d) => COMPARE.includes(d.id)) : DEVICES.filter((d) => d.id === state.device);
  for (const d of list) stage.append(phoneEl(d));
  $('#compare').setAttribute('aria-pressed', String(state.compare));
  $('#device').disabled = state.compare;
  applyZoom();
}

/** Applique le zoom : « Ajusté » réduit pour que le téléphone tienne en hauteur dans la fenêtre. */
function applyZoom() {
  for (const s of document.querySelectorAll('.scaler')) {
    s.style.transform = '';
    const naturalW = s.offsetWidth;
    const naturalH = s.offsetHeight;
    let z = Number(state.zoom);
    if (state.zoom === 'fit') {
      const availH = window.innerHeight - $('.bar').offsetHeight - 90;
      const availW = state.compare ? (window.innerWidth - 96) / 3 : window.innerWidth - 32;
      z = Math.min(1, availH / naturalH, availW / naturalW);
    }
    s.style.transform = `scale(${z})`;
    const box = s.parentElement;
    box.style.width = `${naturalW * z}px`;
    box.style.height = `${naturalH * z}px`;
  }
}

/** Après chaque navigation dans le téléphone : met à jour la barre d'adresse (même domaine, donc lisible). */
function onFrameLoad(frame) {
  try {
    const loc = frame.contentWindow.location;
    const rel = loc.href.startsWith(base.href) ? '/' + loc.href.slice(base.href.length) : loc.href;
    if (rel && rel !== state.path) { state.path = rel; persist(); }
    $('#url').value = state.path;
    syncPageSelect();
  } catch { /* page d'un autre domaine : on ne peut pas la lire */ }
}

/** Positionne la liste des pages sur la page en cours (ou « Autre page »). */
function syncPageSelect() {
  const file = state.path.split(/[?#]/)[0];
  $('#page').value = PAGES.some(([p]) => p === file) ? file : '';
}

/** Charge une page dans tous les téléphones affichés. */
function go(path) {
  state.path = '/' + (path.replace(/^\.?\/+/, '') || 'pages/compte/accueil.html');
  persist();
  $('#url').value = state.path;
  syncPageSelect();
  for (const f of document.querySelectorAll('iframe')) f.src = new URL(state.path, base).href;
}

/* ---------- Événements ---------- */

$('#device').innerHTML = DEVICES.map((d) => `<option value="${d.id}">${d.name} (${d.w} × ${d.h})</option>`).join('');
$('#device').value = state.device;
$('#page').innerHTML = `<option value="">Autre page…</option>` + PAGES.map(([p, l]) => `<option value="${p}">${l}</option>`).join('');
$('#zoom').value = state.zoom;
$('#url').value = state.path;
syncPageSelect();

$('#device').addEventListener('change', (e) => { state.device = e.target.value; persist(); render(); });
$('#zoom').addEventListener('change', (e) => { state.zoom = e.target.value; persist(); applyZoom(); });
$('#rotate').addEventListener('click', () => { state.landscape = !state.landscape; render(); });
$('#compare').addEventListener('click', () => { state.compare = !state.compare; render(); });
$('#page').addEventListener('change', (e) => { if (e.target.value) go(e.target.value); });
$('#url-form').addEventListener('submit', (e) => { e.preventDefault(); go($('#url').value.trim()); });
$('#reload').addEventListener('click', () => { for (const f of document.querySelectorAll('iframe')) f.contentWindow.location.reload(); });
$('#back').addEventListener('click', () => { for (const f of document.querySelectorAll('iframe')) { try { f.contentWindow.history.back(); } catch { /* sans effet */ } } });
window.addEventListener('resize', applyZoom);
// Au premier rendu, la barre d'outils et les polices ne sont pas encore mises en page : on recalcule à la fin du chargement
window.addEventListener('load', applyZoom);
document.fonts?.ready.then(applyZoom);

render();
