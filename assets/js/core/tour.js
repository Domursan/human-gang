// ===== Visite guidée du site (Q1) =====
/*
 * Rôle : au tout premier passage d'un membre sur l'accueil, une bulle de bienvenue puis 4 étapes qui éclairent
 * un élément réel de la page (menu, Cartes, loupe, Aide et tutos) sur un fond assombri.
 * - « Suivant », « Passer la visite » et un compteur « 2 / 4 » ; Échap passe la visite ; le focus reste dans la bulle.
 * - Une étape dont la cible manque (page masquée par l'admin, loupe absente…) est sautée.
 * - Sur téléphone, le menu replié est ouvert pour les étapes qui en ont besoin, puis refermé.
 * - Jamais par-dessus une autre fenêtre (célébration de badge, intro, dialogue) : on attend que l'écran soit libre.
 * - Pas d'animation si motionAllowed() est faux.
 * Fin ou « Passer » : hg_profiles.tour_done_at = maintenant (migration 094 ; la garde des profils laisse le membre
 * écrire ce champ). 1970-01-01 = membre inscrit avant la visite : un bandeau la lui propose une seule fois.
 * Textes : réglables dans Admin › Site › Textes (site_textes.visite_*, défauts dans core/site-defaults.js) ;
 * site_identite.visite_active coupe la visite automatique (« Revoir la visite » reste sur la page Aide).
 * Page : accueil.js (lancement automatique, bandeau), aide.js (« Revoir la visite » → accueil.html#visite).
 * Dépendances : supabase.js, profile.js (profil en cache), pages-access.js (canAccess), effects.js, site-defaults.js, util.js.
 * Exporte : TOUR_ANCIEN, tourState, startTour, maybeStartTour, markTourDone.
 */
import { sb } from './supabase.js';
import { getCachedProfile } from './profile.js';
import { canAccess } from './pages-access.js';
import { motionAllowed } from './effects.js';
import { siteIdentite, siteTexte } from './site-defaults.js';
import { esc } from './util.js';

/** Date posée par la migration 094 pour les membres inscrits avant la visite (bandeau au lieu de la visite). */
export const TOUR_ANCIEN = '1970-01-01';

/**
 * État de la visite pour un profil.
 * - 'jamais' : jamais vue (tour_done_at null) → visite automatique ;
 * - 'ancien' : membre inscrit avant la visite → bandeau proposé une fois ;
 * - 'vue' : déjà vue ou passée ;
 * - 'inconnu' : colonne absente (migration pas encore appliquée) → rien d'automatique.
 * @param {object|null} p Profil (ligne hg_profiles).
 * @returns {'jamais'|'ancien'|'vue'|'inconnu'}
 */
export function tourState(p) {
  if (!p || !('tour_done_at' in p)) return 'inconnu';
  if (p.tour_done_at === null) return 'jamais';
  return String(p.tour_done_at).startsWith(TOUR_ANCIEN) ? 'ancien' : 'vue';
}

/**
 * Enregistre la visite comme vue (ou le bandeau comme refusé). Une erreur d'écriture est ignorée (rien de bloquant).
 * @param {object} me Profil du membre connecté.
 */
export async function markTourDone(me) {
  if (!me?.id) return;
  const at = new Date().toISOString();
  me.tour_done_at = at;
  const cached = getCachedProfile();
  if (cached && cached.id === me.id) cached.tour_done_at = at;
  try { await sb.from('hg_profiles').update({ tour_done_at: at }).eq('id', me.id); } catch { /* sans effet : la visite reviendra au prochain passage */ }
}

/* ---------- Étapes ---------- */

/** Texte réglé (site_textes.visite_*) ou valeur par défaut. */
const tx = (k, def) => { const v = siteTexte(k); return typeof v === 'string' && v.trim() ? v.trim() : def; };

/** Vrai si l'en-tête est en mode téléphone (bouton « Menu » visible). */
const isCompact = () => { const t = document.querySelector('.site-header .nav-toggle'); return !!t && !t.hidden && t.offsetParent !== null; };
/** Élément visible (présent et avec une taille). */
const visible = (el) => !!el && el.getClientRects().length > 0;

/**
 * Étapes de la visite. cible() renvoie l'élément à éclairer (null : étape sautée) ; menu : ouvre le menu replié sur téléphone ;
 * page : page du site que l'étape présente (sautée si le membre n'y a pas accès).
 */
/** L'élément s'il est affiché (pas dans le menu en arc fermé), sinon null. */
const vis = (sel) => { const el = document.querySelector(sel); return el && el.offsetParent !== null ? el : null; };
function steps() {
  return [
    { id: 'menu', menu: true, titre: 'Tout le site part d’ici', texte: tx('visite_menu', 'Le jeu de cartes, IRL, Jeux, Calendrier : chaque menu s’ouvre sur ses rubriques.'),
      cible: () => { const n = document.querySelector('.site-header .nav'); return n?.querySelector('.nav-top') ? n : null; } },
    { id: 'cartes', menu: true, page: 'cartes', titre: 'Tes cartes t’attendent', texte: tx('visite_cartes', 'Un booster gratuit t’attend chaque jour, et les quêtes de la semaine rapportent des Paillettes.'),
      cible: () => document.querySelector('#tile-cartes') || document.querySelector('.site-header .nav a[data-page="cartes"]') },
    { id: 'recherche', titre: 'Cherche n’importe quoi', texte: tx('visite_recherche', 'Une sortie, un souvenir ou un membre : la loupe est derrière ta photo (Ctrl+K sur ordinateur).'),
      cible: () => vis('.site-header .nav-search-open') || document.querySelector('.site-header .nav-me') },
    { id: 'aide', titre: 'Besoin d’un coup de main ?', texte: tx('visite_aide', 'Clique sur ta photo : l’aide, tes messages et tes réglages sont là, avec plus de 60 tutos pas à pas.'),
      cible: () => vis('.site-header .nav-help') || document.querySelector('.site-header .nav-me') },
  ];
}

/* ---------- Écran libre ---------- */

/** Vrai si une autre fenêtre occupe l'écran (dialogue ouvert, célébration de badge, intro, visionneuse). */
function screenBusy() {
  if (document.querySelector('dialog[open], .badge-celebrate, .intro-overlay, [aria-modal="true"]:not(.tour-bubble)')) return true;
  return document.visibilityState === 'hidden';
}
/**
 * Attend que l'écran soit libre (au plus `max` ms). Renvoie false si l'écran est resté occupé.
 * @param {number} [max=20000]
 * @returns {Promise<boolean>}
 */
async function waitFree(max = 20000) {
  const t0 = Date.now();
  // Deux contrôles d'affilée sans fenêtre : laisse le temps à une célébration qui s'ouvre juste après le chargement.
  let calm = 0;
  while (Date.now() - t0 < max) {
    calm = screenBusy() ? 0 : calm + 1;
    if (calm >= 2) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/* ---------- Affichage ---------- */

let running = false;

/**
 * Lance la visite (bienvenue puis étapes disponibles). Sans effet si une visite est déjà en cours.
 * @param {object} me Profil du membre connecté.
 * @param {{ welcome?: boolean, onEnd?: (finished: boolean) => void }} [opts] welcome : bulle de bienvenue d'abord (true par défaut).
 */
export async function startTour(me, { welcome = true, onEnd } = {}) {
  if (running) return;
  running = true; // réservé tout de suite : deux appels rapprochés ne lancent qu'une visite
  if (!(await waitFree())) { running = false; return; }
  const header = document.querySelector('.site-header');
  const toggle = header?.querySelector('.nav-toggle');
  // Étapes disponibles : page accessible et cible présente dans la page (sur téléphone, le menu replié est caché mais présent).
  const list = steps().filter((s) => (!s.page || canAccess(s.page)) && !!s.cible());
  if (!list.length) { running = false; return; }
  const motion = motionAllowed();
  const opener = document.activeElement;

  const root = document.createElement('div');
  root.className = `tour${motion ? '' : ' tour-still'}`;
  root.innerHTML = `
    <div class="tour-veil" aria-hidden="true"></div>
    <div class="tour-spot" aria-hidden="true" hidden></div>
    <div class="tour-bubble" role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-d" tabindex="-1">
      <span class="tour-arrow" aria-hidden="true" hidden></span>
      <div class="tour-top"><span class="tour-count small" id="tour-c"></span><span class="tour-dots" aria-hidden="true"></span></div>
      <p class="tour-title" id="tour-t"></p>
      <p class="tour-text muted" id="tour-d"></p>
      <div class="tour-actions">
        <button type="button" class="btn btn-ghost tour-skip">Passer la visite</button>
        <button type="button" class="btn btn-primary tour-next">Suivant</button>
      </div>
    </div>`;
  document.body.append(root);
  document.documentElement.classList.add('tour-on');
  const bubble = root.querySelector('.tour-bubble');
  const spot = root.querySelector('.tour-spot');
  const arrow = root.querySelector('.tour-arrow');
  const next = root.querySelector('.tour-next');
  const skip = root.querySelector('.tour-skip');

  let i = welcome ? -1 : 0; // -1 : bulle de bienvenue
  let target = null;

  /** Ouvre ou ferme le menu replié (téléphone) comme un clic sur « Menu ». */
  const setMenu = (open) => {
    if (!toggle || !isCompact()) return;
    if ((toggle.getAttribute('aria-expanded') === 'true') !== open) toggle.click();
  };

  /** Place l'éclairage sur la cible et la bulle au-dessous (ou au-dessus s'il manque de place). */
  const place = () => {
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    if (!target || !visible(target)) {
      spot.hidden = true; arrow.hidden = true; root.classList.remove('has-spot');
      bubble.style.left = ''; bubble.style.top = '';
      bubble.classList.add('tour-center');
      return;
    }
    bubble.classList.remove('tour-center');
    const r = target.getBoundingClientRect();
    const pad = 6;
    spot.hidden = false; root.classList.add('has-spot');
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const bw = Math.min(360, vw - 32);
    bubble.style.width = `${bw}px`;
    const bh = bubble.offsetHeight;
    const below = r.bottom + pad + 14 + bh <= vh - 8 || r.top < bh + 30;
    const top = below ? r.bottom + pad + 14 : r.top - pad - 14 - bh;
    const left = Math.max(16, Math.min(vw - bw - 16, r.left + r.width / 2 - bw / 2));
    bubble.style.left = `${left}px`;
    bubble.style.top = `${Math.max(8, top)}px`;
    arrow.hidden = false;
    arrow.classList.toggle('tour-arrow-up', below);
    arrow.style.left = `${Math.max(18, Math.min(bw - 34, r.left + r.width / 2 - left - 8))}px`;
  };

  /** Affiche l'étape i (ou la bienvenue si i = -1). Saute les étapes sans cible. */
  const show = () => {
    if (i === -1) {
      target = null;
      root.querySelector('#tour-c').textContent = 'Bienvenue';
      root.querySelector('.tour-dots').innerHTML = '';
      root.querySelector('#tour-t').textContent = 'Bienvenue dans le gang !';
      root.querySelector('#tour-d').textContent = tx('visite_bienvenue', 'On te montre l’essentiel en {n} étapes.').replace(/\{n\}/g, String(list.length));
      next.textContent = 'C’est parti';
      place();
      return;
    }
    while (i < list.length) {
      const s = list[i];
      setMenu(!!s.menu);
      const el = s.cible();
      if (visible(el)) { target = el; break; }
      i++; // cible absente : étape sautée
    }
    if (i >= list.length) { end(true); return; }
    const s = list[i];
    const total = list.length, n = i + 1;
    root.querySelector('#tour-c').textContent = `Étape ${n} / ${total}`;
    root.querySelector('.tour-dots').innerHTML = Array.from({ length: total }, (_, k) => `<i${k < n ? ' class="on"' : ''}></i>`).join('');
    root.querySelector('#tour-t').textContent = s.titre;
    root.querySelector('#tour-d').textContent = s.texte;
    next.textContent = n >= total ? 'Terminer' : 'Suivant';
    target.scrollIntoView?.({ block: 'nearest', behavior: motion ? 'smooth' : 'auto' });
    place();
    if (motion) setTimeout(place, 350); // après le défilement doux
  };

  /** Termine la visite : nettoie l'écran, referme le menu, enregistre la date, rend le focus. */
  const end = (finished) => {
    if (!running) return;
    running = false;
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', onKey, true);
    setMenu(false);
    root.remove();
    document.documentElement.classList.remove('tour-on');
    markTourDone(me);
    try { (opener && opener !== document.body ? opener : document.querySelector('#app'))?.focus?.({ preventScroll: true }); } catch { /* rien à faire */ }
    onEnd?.(finished);
  };

  /** Clavier : Échap passe la visite ; Tab reste dans la bulle. */
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); return; }
    if (e.key === 'Tab') {
      const f = [skip, next];
      const at = f.indexOf(document.activeElement);
      if (e.shiftKey && at <= 0) { e.preventDefault(); next.focus(); } else if (!e.shiftKey && at === f.length - 1) { e.preventDefault(); skip.focus(); } else if (at === -1) { e.preventDefault(); next.focus(); }
    }
  };

  next.addEventListener('click', () => { i++; show(); if (running) next.focus(); });
  skip.addEventListener('click', () => end(false));
  root.querySelector('.tour-veil').addEventListener('click', (e) => e.preventDefault());
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  document.addEventListener('keydown', onKey, true);
  show();
  next.focus();
}

/**
 * Accueil : lance la visite au premier passage, ou propose le bandeau aux membres déjà inscrits.
 * Sans effet si la colonne n'existe pas encore, si la visite est coupée par l'admin, ou si elle a déjà été vue.
 * accueil.html#visite (bouton « Revoir la visite » de la page Aide) la relance à la demande.
 * @param {object} me Profil du membre connecté.
 * @param {HTMLElement} [bannerHost] Où insérer le bandeau « Nouveau : la visite du site » (début de #app par défaut).
 */
export function maybeStartTour(me, bannerHost) {
  if (!me) return;
  if (location.hash === '#visite') {
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* adresse inchangée */ }
    startTour(me);
    return;
  }
  if (siteIdentite().visite_active === false) return;
  const st = tourState(me);
  if (st === 'jamais') { startTour(me); return; }
  if (st !== 'ancien') return;
  const host = bannerHost || document.querySelector('#app');
  if (!host || document.querySelector('.tour-banner')) return;
  const b = document.createElement('div');
  b.className = 'tour-banner';
  b.setAttribute('role', 'region');
  b.setAttribute('aria-label', 'Visite guidée');
  b.innerHTML = `<p><strong>Nouveau :</strong> ${esc(tx('visite_bandeau', 'la visite du site en 30 secondes.'))}</p>
    <div class="tour-banner-actions">
      <button type="button" class="btn btn-primary tour-banner-go">Faire la visite</button>
      <button type="button" class="btn btn-ghost tour-banner-no">Plus tard, non merci</button>
    </div>`;
  host.prepend(b);
  // Une seule fois : dès qu'il est proposé, on enregistre la date (il ne reviendra pas ; la visite reste sur la page Aide).
  markTourDone(me);
  b.querySelector('.tour-banner-go').addEventListener('click', () => { b.remove(); startTour(me, { welcome: false }); });
  b.querySelector('.tour-banner-no').addEventListener('click', () => b.remove());
}
