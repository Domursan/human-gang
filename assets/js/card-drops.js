// ===== Humane Gang — drops de cartes : une carte sauvage apparaît, les X premiers qui cliquent la gagnent =====
// Appelé par initPage (core/init.js) pour les membres connectés, sur toutes les pages. Lecture : rpc hg_drops_active
// (drops en cours, non encore gagnés par moi, pas épuisés ; jamais pour un fantôme). Rafraîchissement : temps réel
// (table hg_card_drops) + interrogation toutes les 60 s quand l'onglet est visible (les gagnants ne sont pas diffusés).
// Affichage : la vraie carte (cardHtml) traverse la page comme les images d'événements (dyn-events.js : mêmes
// trajectoires, même vitesse linéaire). Elle revient régulièrement tant que le drop est actif et non gagné.
// Elle est cliquable pendant son trajet ; seul le bouton de la carte et le « × » captent les clics.
// Clic → rpc hg_drop_claim → révélation + confettis + toast (dans le coin), ou « trop tard ».
// Sans mouvement (prefers-reduced-motion ou effets coupés) : la carte reste immobile dans le coin, sans vol.
// Une seule carte vole à la fois, et jamais en même temps qu'une image d'événement (dyn-events.js attend).
import { sb, toast, esc, playSound, motionAllowed, hasSession, isNavCancel } from './core.js';
import { cardHtml } from './cartes-ui.js';
import { rnd } from './utils.js';
import { trajectory, KINDS } from './dyn-events.js';

/* ---------- Constantes et état ---------- */
const MAX_VISIBLE = 3; // nombre maximum de cartes affichées en même temps
const POLL_MS = 60000; // interrogation de secours toutes les 60 s (les gagnants ne sont pas diffusés en temps réel)
// Messages d'erreur du serveur qui veulent dire « c'est fini pour ce drop » (et non une panne réseau).
const GONE_RE = /trop tard|déjà attrapé|terminé|n'existe plus|plus disponible|épuisé|plus aucun/i;
// Rythme des vols (ms) : premier passage rapide, puis un passage toutes les 8 à 16 s, chacun de 7 à 9,5 s.
const FIRST_FLY = [1500, 4000];
const GAP_FLY = [8000, 16000];
const FLY_MS = [7000, 9500];
const RETRY_FLY = [2000, 3500]; // délai avant de réessayer si un autre objet vole déjà
/** Tire au hasard un élément d'une liste. */
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// S.shown : id du drop -> { el, remaining, timer, anim } ; S.gone : drops à ne plus proposer sur cette page (gagnés, finis, masqués).
// S.busy : drops dont une capture est en cours ; S.layer / S.live : calque et zone d'annonce pour lecteurs d'écran.
const S = { shown: new Map(), gone: new Set(), busy: new Set(), started: false, layer: null, live: null };

/* ---------- Données ---------- */
/** Drops visibles pour moi. null si la lecture échoue (on garde ce qui est affiché). Jamais d'erreur. */
async function fetchActive() {
  try {
    if (!(await hasSession())) return null;
    const { data, error } = await sb.rpc('hg_drops_active');
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (!isNavCancel(e)) console.warn('[drops]', e?.message || e);
    return null;
  }
}

/* ---------- Calque (injecté une fois) ---------- */
/** Crée le calque fixe au-dessus de la page (une seule fois) et renvoie-le. Les clics y sont reliés à onClick. */
function ensureLayer() {
  if (S.layer?.isConnected) return S.layer;
  const layer = document.createElement('div');
  layer.className = 'cd-layer';
  layer.innerHTML = '<div class="cd-stack"></div><p class="visually-hidden cd-live" aria-live="polite"></p>';
  layer.addEventListener('click', onClick);
  document.body.append(layer);
  S.layer = layer;
  S.live = layer.querySelector('.cd-live');
  return layer;
}
/**
 * Annonce un message aux lecteurs d'écran. On vide la zone puis on écrit après 50 ms,
 * pour que la même annonce soit lue à nouveau si elle se répète.
 * @param {string} msg
 */
function say(msg) {
  if (!S.live) return;
  S.live.textContent = '';
  setTimeout(() => { if (S.live) S.live.textContent = msg; }, 50);
}
/** Zone du coin où se posent les cartes (révélations et cartes à l'arrêt). */
const stack = () => ensureLayer().querySelector('.cd-stack');
/** Texte sous la carte : « Dernier exemplaire ! » ou le nombre restant. */
const countText = (n) => (n <= 1 ? 'Dernier exemplaire !' : `${n} exemplaires restants`);

/* ---------- Affichage ---------- */
/**
 * Convertit une ligne de drop (hg_drops_active) en objet attendu par cardHtml.
 * @param {object} d ligne reçue du serveur
 * @returns {object} carte prête pour cardHtml
 */
function cardOf(d) {
  return { name: d.name, rarity: d.rarity, family: d.family, image_url: d.image_url, flavor: d.flavor,
    number: d.number, max_copies: d.max_copies, set_name: d.set_name };
}

/**
 * Ajoute une carte sauvage à l'écran. Avec mouvement, elle part dans le calque et volera ;
 * sans mouvement, elle se pose dans le coin.
 * @param {object} d ligne du drop (drop_id, remaining, shiny, name...)
 */
function show(d) {
  const motion = motionAllowed();
  const item = document.createElement('div');
  item.className = motion ? 'cd-item is-fly' : 'cd-item is-still';
  item.dataset.drop = d.drop_id;
  const n = Number(d.remaining) || 0;
  item.innerHTML = `
    <button type="button" class="cd-x" data-cd-hide aria-label="Masquer cette carte sur cette page">×</button>
    ${cardHtml(cardOf(d), { size: 'sm', shiny: !!d.shiny, button: true,
      attrs: `data-cd-claim="${esc(d.drop_id)}" aria-describedby="cd-hint-${esc(d.drop_id)}"` })}
    <p class="cd-hint" id="cd-hint-${esc(d.drop_id)}">${esc(countText(n))}</p>`;
  const entry = { el: item, remaining: n, timer: null, anim: null };
  S.shown.set(d.drop_id, entry);
  if (motion) {
    // Dans le calque, hors du coin : la carte vole, puis se pose (masquée) jusqu'au prochain passage.
    ensureLayer().append(item);
    entry.timer = setTimeout(() => fly(d.drop_id), rnd(FIRST_FLY[0], FIRST_FLY[1]));
  } else {
    stack().append(item);
  }
  // Le nombre de sièges restants est aussi annoncé (sans voler le focus).
  say(`Une carte sauvage est apparue : « ${d.name} ». ${countText(n)}. Clique dessus pour l'attraper.`);
}

/* ---------- Vol ---------- */
/** Fait traverser l'écran à la carte (mêmes trajectoires que les images d'événements). Reporte si une autre carte
 *  ou une image vole, si l'onglet est caché, ou si une capture est en cours. */
function fly(id) {
  const s = S.shown.get(id);
  if (!s) return;
  /** Programme le prochain passage de cette carte dans ms millisecondes. */
  const later = (ms) => { s.timer = setTimeout(() => fly(id), ms); };
  if (document.hidden || S.busy.has(id) || s.el.classList.contains('is-busy')
    || document.querySelector('.cd-item.is-flying, .dyn-fly')) return later(rnd(RETRY_FLY[0], RETRY_FLY[1]));
  const { el } = s;
  el.classList.add('is-flying');
  const size = Math.max(el.offsetWidth, el.offsetHeight) || 120;
  s.anim = el.animate(trajectory(pick(KINDS), innerWidth, innerHeight, size),
    { duration: rnd(FLY_MS[0], FLY_MS[1]), easing: 'linear', fill: 'forwards' });
  // Posée : elle se remet en attente. Annulée (gain, masquage, retrait) : rien à faire, le nettoyage est fait ailleurs.
  s.anim.finished.then(() => {
    const cur = S.shown.get(id);
    if (!cur || cur !== s) return;
    cur.anim = null;
    el.classList.remove('is-flying');
    later(rnd(GAP_FLY[0], GAP_FLY[1]));
  }, () => {});
}

/** Retire un drop de l'écran : arrête son vol et ses passages à venir (il ne reviendra plus sur cette page). */
function release(id) {
  const s = S.shown.get(id);
  if (!s) return null;
  clearTimeout(s.timer);
  s.anim?.cancel();
  S.shown.delete(id);
  return s;
}

/** Retire un drop de l'écran (et ne le reproposera pas sur cette page). */
function forget(id) {
  S.gone.add(id);
  release(id)?.el.remove();
}

/** Met l'écran d'accord avec la liste reçue : nouveaux drops, quantités restantes, drops terminés. */
function sync(list) {
  const ids = new Set();
  for (const d of list) {
    if (S.gone.has(d.drop_id)) continue;
    ids.add(d.drop_id);
    const cur = S.shown.get(d.drop_id);
    if (cur) {
      const n = Number(d.remaining) || 0;
      if (n !== cur.remaining) {
        cur.remaining = n;
        const hint = cur.el.querySelector('.cd-hint');
        if (hint) hint.textContent = countText(n);
      }
    } else if (S.shown.size < MAX_VISIBLE) {
      show(d);
    }
  }
  for (const id of [...S.shown.keys()]) {
    if (!ids.has(id)) release(id)?.el.remove();
  }
}

/** Relit les drops actifs et met l'écran d'accord avec eux (ne fait rien si la lecture échoue). */
async function refresh() {
  const list = await fetchActive();
  if (list) sync(list);
}

/* ---------- Clic : attraper ---------- */
/** Clic sur le calque : « × » masque la carte sur cette page, le bouton de la carte tente de la capturer. */
function onClick(e) {
  const hide = e.target.closest('[data-cd-hide]');
  if (hide) { forget(hide.closest('.cd-item')?.dataset.drop); return; }
  const btn = e.target.closest('[data-cd-claim]');
  if (btn) claim(btn.dataset.cdClaim, btn.closest('.cd-item'));
}

/**
 * Tente d'attraper un drop (rpc hg_drop_claim). Succès : révélation. Drop fini : la carte disparaît.
 * Autre erreur (réseau, serveur) : la carte reste et le bouton redevient actif.
 * @param {string} id identifiant du drop
 * @param {HTMLElement} item élément affiché de la carte
 */
async function claim(id, item) {
  // Garde S.busy : un double clic rapide ne doit envoyer qu'une seule capture.
  if (!item || S.busy.has(id)) return;
  S.busy.add(id);
  item.classList.add('is-busy');
  const btn = item.querySelector('[data-cd-claim]');
  if (btn) btn.disabled = true;
  try {
    const { data, error } = await sb.rpc('hg_drop_claim', { p_drop: id });
    if (error) throw error;
    S.gone.add(id);
    release(id);
    reveal(item, data || {});
  } catch (e) {
    if (isNavCancel(e)) return;
    const msg = e?.message || String(e);
    if (GONE_RE.test(msg)) {
      forget(id);
      toast(msg, 'error');
      say(msg);
      refresh();
    } else {
      // Erreur réseau ou serveur : la carte reste, on peut réessayer.
      item.classList.remove('is-busy');
      if (btn) btn.disabled = false;
      toast(`Capture impossible : ${msg}`, 'error');
    }
  } finally {
    S.busy.delete(id);
  }
}

/* ---------- Révélation ---------- */
/**
 * Montre la carte gagnée dans le coin, avec un message, un son, un toast et des confettis.
 * La révélation disparaît seule au bout de 6 s.
 * @param {HTMLElement} item élément de la carte (sorti du calque)
 * @param {object} c carte renvoyée par hg_drop_claim (name, rarity, serial...)
 */
function reveal(item, c) {
  const name = String(c.name || 'la carte');
  // La révélation se pose dans le coin (comme avant) : la carte qui volait n'y est plus, elle est sortie du calque.
  stack().append(item);
  item.className = `cd-item cd-won${motionAllowed() ? '' : ' is-still'}`;
  item.innerHTML = `<div class="cd-reveal" role="status">
      <p class="cd-reveal-t">Tu as attrapé « ${esc(name)} » !</p>
      ${cardHtml(cardOf(c), { size: 'md', shiny: !!c.shiny, serial: c.serial || null })}
      <p class="small">Ajoutée à ta collection.</p>
    </div>`;
  playSound('success');
  toast(`Tu as attrapé « ${name} » !`);
  say(`Tu as attrapé « ${name} » ! Elle est dans ta collection.`);
  if (motionAllowed()) confetti(item);
  setTimeout(() => item.remove(), 6000);
}

/** Quelques pastilles colorées autour de la carte (même principe que la capture des événements). */
function confetti(item) {
  const layer = ensureLayer();
  const r = item.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const css = getComputedStyle(document.documentElement);
  const colors = [1, 2, 3, 4, 5, 6].map((i) => css.getPropertyValue(`--rb-${i}`).trim() || '#E2C77E');
  const n = 18;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'cd-px';
    const px = Math.round(rnd(2, 4)) * 3;
    p.style.cssText = `left:${cx}px;top:${cy}px;width:${px}px;height:${px}px;background:${colors[i % colors.length]}`;
    layer.append(p);
    const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2), d = rnd(60, 130);
    const dx = Math.round((Math.cos(a) * d) / 3) * 3, dy = Math.round((Math.sin(a) * d) / 3) * 3;
    p.animate([
      { transform: 'translate(-50%, -50%)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`, opacity: 1, offset: 0.7 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 18}px))`, opacity: 0 },
    ], { duration: rnd(550, 850), easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).finished.finally(() => p.remove());
  }
}

/* ---------- Démarrage ---------- */
/**
 * Charge la feuille de style des cartes si la page ne l'a pas déjà incluse, et attend qu'elle soit prête
 * (pour éviter de dessiner une carte sans style).
 * @returns {Promise<void>}
 */
function ensureCardCss() {
  const found = document.querySelector('link[href$="cartes-card.css"]');
  if (found) return found.sheet ? Promise.resolve() : new Promise((res) => found.addEventListener('load', res, { once: true }));
  return new Promise((res) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = new URL('../css/cartes-card.css', import.meta.url).href;
    l.onload = l.onerror = () => res();
    document.head.append(l);
  });
}

/** Lance la surveillance des drops pour un membre connecté. Ne jette jamais. */
export async function startCardDrops(profile) {
  if (S.started || !profile?.id || !(await hasSession())) return;
  S.started = true;
  try {
    await ensureCardCss();
    await refresh();
    sb.channel('hg-card-drops')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hg_card_drops' }, () => refresh())
      .subscribe();
  } catch (e) {
    console.warn('[drops]', e?.message || e);
  }
  setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}
