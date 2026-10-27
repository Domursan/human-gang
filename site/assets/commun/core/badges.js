// Badges : vérification (une fois par session) et célébration plein écran des nouveaux badges et niveaux.
/*
 * Rôle : après l'initialisation d'une page, dit au membre qu'il vient de débloquer un badge ou un niveau.
 * Page : toutes les pages membre (appelé par init.js, via initPage).
 * Dépendances :
 *   - supabase.js (client Supabase, session) ; profile.js (profil en cache) ;
 *     theme-load.js / theme.js (thème du site à marquer comme vu) ; effects.js (mouvement autorisé) ;
 *     util.js (esc) ; sound.js (son) ; badge-levels.js (niveaux des badges).
 *   - RPC : hg_mark_theme_seen, hg_refresh_my_badges.
 *   - Tables : hg_user_badges, hg_badges.
 *   - Stockage local : localStorage « hg_badges_seen » (badges déjà vus, par membre) ;
 *     sessionStorage « hg_badges_checked » (vérification faite pour cette session).
 * Exporte : checkNewBadges, celebrateBadges.
 */
import { sb, hasSession, isNavCancel } from './supabase.js';
import { getCachedProfile } from './profile.js';
import { applyTheme } from './theme-load.js';
import { getSiteTheme } from './theme.js';
import { motionAllowed } from './effects.js';
import { esc } from './util.js';
import { playSound } from '../sound.js';
import { hasLevels, levelDef, levelImage, roman } from '../badge-levels.js';

/* ---------- Constantes ---------- */

/** Clé localStorage : pour chaque membre, la liste des badges déjà vus sur cet appareil. */
const BADGES_SEEN_KEY = 'hg_badges_seen';
/** Clé sessionStorage : posée une fois la vérification de la session réussie (sinon la page suivante réessaie). */
const BADGES_SESSION_KEY = 'hg_badges_checked';

/* ---------- Utilitaires ---------- */

/** Lit une valeur JSON dans un Storage ; renvoie fallback si la clé est absente ou illisible. */
function readJson(store, key, fallback) { try { return JSON.parse(store.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
/** Initiales d'un nom (2 lettres) pour le cercle affiché quand un badge n'a pas d'image. */
function badgeInitials(name) {
  const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
}

/* ---------- Vérification ---------- */

/**
 * Vérifie mes badges et célèbre les nouveaux. Appelée par initPage au plus une fois par session ;
 * { force: true } la relance (ex. après une action qui peut débloquer un badge).
 * @param {{force?: boolean}} [options] force : ignore le marqueur de session.
 * @returns {Promise<Array<object>>} Les badges (ou niveaux) nouvellement débloqués ; [] si rien.
 */
export async function checkNewBadges({ force = false } = {}) {
  const p = getCachedProfile();
  if (!p?.id || !(await hasSession())) return []; // déconnecté entre-temps : aucune RPC membre
  try {
    if (!force && sessionStorage.getItem(BADGES_SESSION_KEY)) return [];
  } catch { if (!force) return []; }
  try {
    await applyTheme();
    const site = getSiteTheme();
    // Le thème saisonnier du site est marqué comme vu (sauf le thème par défaut, qui n'a rien à annoncer)
    if (site && !site.is_default && site.slug) {
      const r = await sb.rpc('hg_mark_theme_seen', { p_slug: site.slug });
      if (r.error) console.warn('[badges] thème vu', r.error);
    }
    // Recalcule côté base les badges mérités, puis lit l'état actuel
    const ref = await sb.rpc('hg_refresh_my_badges');
    if (ref.error) console.warn('[badges] rafraîchissement', ref.error);
    const [mine, all] = await Promise.all([
      sb.from('hg_user_badges').select('badge_code, awarded_at, level').eq('user_id', p.id),
      sb.from('hg_badges').select('code, name, description, image_url, sort, levels_enabled, levels'),
    ]);
    if (mine.error) throw mine.error;
    // Traitement réussi (badges recalculés et lus) : on pose le marqueur de session
    if (!ref.error) { try { sessionStorage.setItem(BADGES_SESSION_KEY, '1'); } catch {} }
    const codes = (mine.data || []).map((b) => b.badge_code);
    const levels = Object.fromEntries((mine.data || []).map((b) => [b.badge_code, Number(b.level) || 1]));
    // Mémoire locale des badges vus : un objet { <uid>: [codes], <uid>:lv: {code: niveau} }
    const seenAll = readJson(localStorage, BADGES_SEEN_KEY, null);
    const map = seenAll && typeof seenAll === 'object' && !Array.isArray(seenAll) ? seenAll : {};
    const known = Array.isArray(map[p.id]) ? map[p.id] : null;
    // Niveaux déjà vus (badges à niveaux) : clé séparée « <uid>:lv » → { code: niveau }
    const lvKey = `${p.id}:lv`;
    const knownLv = map[lvKey] && typeof map[lvKey] === 'object' && !Array.isArray(map[lvKey]) ? map[lvKey] : null;
    // On mémorise tout de suite ce qui est acquis, même si rien n'est célébré
    map[p.id] = [...new Set([...(known || []), ...codes])];
    map[lvKey] = { ...(knownLv || {}), ...levels };
    try { localStorage.setItem(BADGES_SEEN_KEY, JSON.stringify(map)); } catch {}
    // Premier passage sur cet appareil : on enregistre sans célébrer, sinon le membre recevrait tous ses anciens badges d'un coup
    if (!known) return [];
    const info = new Map((all.data || []).map((b) => [b.code, b]));
    // Nouveaux badges (code absent de la mémoire) et montées de niveau (niveau supérieur à celui vu)
    const fresh = codes.filter((c) => !known.includes(c));
    const ups = knownLv ? codes.filter((c) => known.includes(c) && levels[c] > (Number(knownLv[c]) || 1) && hasLevels(info.get(c))) : [];
    if (!fresh.length && !ups.length) return [];
    /** Ajoute au badge son niveau, son nom de niveau et son image de niveau (si le badge a des niveaux). */
    const withLevel = (c, levelUp) => {
      const b = info.get(c) || { code: c, name: c, description: '' };
      if (!hasLevels(b)) return b;
      const lv = levels[c] || 1;
      return { ...b, level: lv, level_name: levelDef(b, lv)?.name || '', image_url: levelImage(b, lv), levelUp };
    };
    const list = [...fresh.map((c) => withLevel(c, false)), ...ups.map((c) => withLevel(c, true))];
    celebrateBadges(list);
    return list;
  } catch (e) {
    if (!isNavCancel(e)) console.warn('[badges]', e);
    return [];
  }
}

/* ---------- Célébration (dialogue plein écran) ---------- */

/**
 * Affiche la célébration (plein écran) pour une liste de badges { code, name, description, image_url }.
 * Un clic (ou « Suivant ») passe au badge suivant ; le dernier clic ferme le dialogue.
 * @param {Array<object>} list Badges à présenter, dans l'ordre.
 */
export function celebrateBadges(list) {
  const queue = [...(list || [])];
  if (!queue.length) return;
  const total = queue.length;
  const d = document.createElement('dialog');
  d.className = 'badge-celebrate';
  d.setAttribute('aria-labelledby', 'bc-title');
  d.setAttribute('aria-describedby', 'bc-desc');
  d.innerHTML = `<canvas class="bc-confetti" aria-hidden="true"></canvas>
    <div class="bc-card">
      <p class="eyebrow bc-eyebrow">Nouveau badge débloqué</p>
      <div class="bc-badge"></div>
      <h2 id="bc-title" class="display"></h2>
      <p id="bc-desc" class="bc-desc"></p>
      <p class="bc-count small muted" hidden></p>
      <div class="btn-row bc-actions">
        <button class="btn btn-primary bc-ok" type="button">Super !</button>
        <a class="btn btn-ghost bc-link" href="compte.html">Voir mes badges</a>
      </div>
    </div>`;
  document.body.append(d);
  const canvas = d.querySelector('canvas');
  let stop = () => {}; // arrête les confettis en cours (remplacée à chaque badge)
  let idx = 0;
  /** Affiche le badge à la position idx : image ou initiales, titre, niveau, compteur, puis confettis. */
  const show = () => {
    const b = queue[idx];
    const box = d.querySelector('.bc-badge');
    box.innerHTML = b.image_url
      ? `<img src="${esc(b.image_url)}" alt="">`
      : `<span class="bc-initials" aria-hidden="true">${esc(badgeInitials(b.name))}</span>`;
    d.querySelector('#bc-title').textContent = b.name || b.code;
    d.querySelector('.bc-eyebrow').textContent = b.levelUp ? 'Nouveau niveau atteint' : 'Nouveau badge débloqué';
    const lvTxt = b.level ? `Niveau ${roman(b.level)}${b.level_name ? ` · ${b.level_name}` : ''}` : '';
    d.querySelector('#bc-desc').textContent = [lvTxt, b.description || ''].filter(Boolean).join(' — ');
    const cnt = d.querySelector('.bc-count');
    cnt.hidden = total < 2;
    cnt.textContent = `${idx + 1} / ${total}`;
    d.querySelector('.bc-ok').textContent = idx < total - 1 ? 'Suivant' : 'Super !';
    // Relance l'animation d'entrée : retirer la classe, forcer un recalcul du style (offsetWidth), puis la remettre
    d.classList.remove('bc-pop'); void d.offsetWidth; d.classList.add('bc-pop');
    stop(); stop = motionAllowed() ? confetti(canvas) : () => {}; // pas de confettis si le mouvement est réduit
    playSound('badge');
  };
  /** Passe au badge suivant, ou ferme le dialogue après le dernier. */
  const next = () => {
    if (++idx < total) show();
    else d.close();
  };
  // Clic n'importe où (sauf le lien « Voir mes badges ») : badge suivant
  d.addEventListener('click', (e) => { if (!e.target.closest('.bc-link')) { e.preventDefault(); next(); } });
  d.addEventListener('cancel', (e) => { e.preventDefault(); d.close(); }); // Échap : tout fermer
  d.addEventListener('close', () => { stop(); d.remove(); }); // nettoyage : arrêt des confettis, retrait du DOM
  d.showModal();
  d.querySelector('.bc-ok').focus();
  show();
}

/* ---------- Effet confettis ---------- */

/**
 * Confettis « pixel » arc-en-ciel sur un canvas plein écran. Renvoie une fonction d'arrêt.
 * Les morceaux tombent depuis les deux bords, puis s'effacent sur le dernier quart de la durée.
 * @param {HTMLCanvasElement} canvas Canvas à dessiner (il est redimensionné ici).
 * @returns {() => void} Fonction qui arrête l'animation et efface le canvas.
 */
function confetti(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1); // densité d'écran, plafonnée à 2 pour rester léger
  const W = innerWidth, H = innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false; // bords nets : l'effet reste en « pixels »
  const css = getComputedStyle(document.documentElement);
  // Couleurs lues dans le thème (--rb-1 à --rb-6), blanc si une variable manque
  const colors = [1, 2, 3, 4, 5, 6].map((i) => css.getPropertyValue(`--rb-${i}`).trim() || '#ffffff');
  // Nombre de morceaux proportionnel à la surface de l'écran, borné entre 70 et 160
  const n = Math.round(Math.min(160, Math.max(70, (W * H) / 9000)));
  /** Nombre aléatoire entre a et b. */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const parts = Array.from({ length: n }, (_, i) => {
    const fromLeft = i % 2 === 0; // moitié des morceaux depuis la gauche, moitié depuis la droite
    return {
      x: fromLeft ? rnd(-10, W * 0.15) : rnd(W * 0.85, W + 10), y: rnd(H * 0.55, H * 0.9),
      vx: (fromLeft ? 1 : -1) * rnd(120, 420), vy: -rnd(520, 980),
      s: Math.round(rnd(2, 4)) * 3, c: colors[i % colors.length], ph: rnd(0, 6.28), sp: rnd(6, 14),
    };
  });
  let raf = 0, t0 = performance.now(), last = t0;
  const LIFE = 3200; // durée totale de l'animation, en ms
  /** Une image d'animation : fait avancer chaque morceau (gravité, frottement) et le dessine. */
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; // pas de temps borné pour éviter les sauts
    const k = (now - t0) / LIFE; // avancement de 0 à 1
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = k > 0.75 ? Math.max(0, 1 - (k - 0.75) / 0.25) : 1; // fondu sur le dernier quart
    for (const p of parts) {
      p.vy += 900 * dt; p.vx *= 1 - 0.9 * dt; p.vy *= 1 - 0.35 * dt; // gravité et frottement de l'air
      p.x += p.vx * dt; p.y += p.vy * dt;
      const flip = Math.abs(Math.cos(p.ph + now / 1000 * p.sp)); // « retournement » sans rotation : reste pixel
      const h = Math.max(3, Math.round((p.s * flip) / 3) * 3);
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x / 3) * 3, Math.round(p.y / 3) * 3, p.s, h); // positions arrondies à la grille de 3 px
    }
    if (k < 1) raf = requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H); };
}
