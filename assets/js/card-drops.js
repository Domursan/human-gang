// ===== Humane Gang — drops de cartes : une carte sauvage apparaît, les X premiers qui cliquent la gagnent =====
// Appelé par initPage (core/init.js) pour les membres connectés, sur toutes les pages. Lecture : rpc hg_drops_active
// (drops en cours, non encore gagnés par moi, pas épuisés ; jamais pour un fantôme). Rafraîchissement : temps réel
// (table hg_card_drops) + interrogation toutes les 60 s quand l'onglet est visible (les gagnants ne sont pas diffusés).
// Affichage : la vraie carte (cardHtml) flotte dans un coin, sans bloquer la page ; seul le bouton de la carte et le
// bouton « × » captent les clics. Clic → rpc hg_drop_claim → révélation + confettis + toast, ou « trop tard ».
// Sans mouvement (prefers-reduced-motion ou effets coupés) : la carte reste immobile dans le coin.
import { sb, toast, esc, playSound, motionAllowed, hasSession, isNavCancel } from './core.js';
import { cardHtml } from './cartes-ui.js';
import { rnd } from './utils.js';

const MAX_VISIBLE = 3;
const POLL_MS = 60000;
const GONE_RE = /trop tard|déjà attrapé|terminé|n'existe plus|plus disponible|épuisé|plus aucun/i;

// S.shown : id du drop -> { el, remaining } ; S.gone : drops à ne plus proposer sur cette page (gagnés, finis, masqués).
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
function say(msg) {
  if (!S.live) return;
  S.live.textContent = '';
  setTimeout(() => { if (S.live) S.live.textContent = msg; }, 50);
}
const stack = () => ensureLayer().querySelector('.cd-stack');
const countText = (n) => (n <= 1 ? 'Dernier exemplaire !' : `${n} exemplaires restants`);

/* ---------- Affichage ---------- */
function cardOf(d) {
  return { name: d.name, rarity: d.rarity, family: d.family, image_url: d.image_url, flavor: d.flavor,
    number: d.number, max_copies: d.max_copies, set_name: d.set_name };
}

function show(d) {
  const motion = motionAllowed();
  const item = document.createElement('div');
  item.className = `cd-item${motion ? ' is-float' : ' is-still'}`;
  item.dataset.drop = d.drop_id;
  const n = Number(d.remaining) || 0;
  item.innerHTML = `
    <button type="button" class="cd-x" data-cd-hide aria-label="Masquer cette carte sur cette page">×</button>
    ${cardHtml(cardOf(d), { size: 'sm', shiny: !!d.shiny, button: true,
      attrs: `data-cd-claim="${esc(d.drop_id)}" aria-describedby="cd-hint-${esc(d.drop_id)}"` })}
    <p class="cd-hint" id="cd-hint-${esc(d.drop_id)}">${esc(countText(n))}</p>`;
  stack().append(item);
  // Le nombre de sièges restants est aussi annoncé (sans voler le focus).
  say(`Une carte sauvage est apparue : « ${d.name} ». ${countText(n)}. Clique dessus pour l'attraper.`);
  S.shown.set(d.drop_id, { el: item, remaining: n });
}

/** Retire un drop de l'écran (et ne le reproposera pas sur cette page). */
function forget(id) {
  S.gone.add(id);
  const s = S.shown.get(id);
  S.shown.delete(id);
  s?.el.remove();
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
    if (!ids.has(id)) { const s = S.shown.get(id); S.shown.delete(id); s.el.remove(); }
  }
}

async function refresh() {
  const list = await fetchActive();
  if (list) sync(list);
}

/* ---------- Clic : attraper ---------- */
function onClick(e) {
  const hide = e.target.closest('[data-cd-hide]');
  if (hide) { forget(hide.closest('.cd-item')?.dataset.drop); return; }
  const btn = e.target.closest('[data-cd-claim]');
  if (btn) claim(btn.dataset.cdClaim, btn.closest('.cd-item'));
}

async function claim(id, item) {
  if (!item || S.busy.has(id)) return;
  S.busy.add(id);
  item.classList.add('is-busy');
  const btn = item.querySelector('[data-cd-claim]');
  if (btn) btn.disabled = true;
  try {
    const { data, error } = await sb.rpc('hg_drop_claim', { p_drop: id });
    if (error) throw error;
    S.gone.add(id);
    S.shown.delete(id);
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
function reveal(item, c) {
  const name = String(c.name || 'la carte');
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
/** Feuille de style de la carte (cartes-card.css) : chargée ici, les autres pages ne la lisent pas. Attend son chargement. */
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
