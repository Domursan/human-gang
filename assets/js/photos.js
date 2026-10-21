// ===== Humane Gang — photos : compression, envoi, URLs signées, lightbox (partagé IRL / Historique) =====
import { sb, esc } from './core.js';

export const PHOTO_BUCKET = 'hg-photos';
const SIGN_TTL = 3600; // secondes

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------- Stockage ---------- */
/** Envoie un blob préparé par prepareImage ; le type MIME vient du blob. */
export async function uploadImage(path, blob) {
  const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false, cacheControl: '3600' });
  if (error) throw error;
  forgetUrl(path);
  return path;
}
export async function removeObjects(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const { error } = await sb.storage.from(PHOTO_BUCKET).remove(list);
  if (error) throw error;
  list.forEach(forgetUrl);
}

/* ---------- URLs signées (avec cache mémoire) ---------- */
const urlCache = new Map(); // path -> { url, until }
function forgetUrl(path) { urlCache.delete(path); }

/** Renvoie une Map path -> url signée, en lots. Les chemins introuvables sont absents de la Map. */
export async function signedUrls(paths) {
  const out = new Map();
  const now = Date.now();
  const todo = [];
  for (const p of new Set(paths.filter(Boolean))) {
    const c = urlCache.get(p);
    if (c && c.until > now) out.set(p, c.url); else todo.push(p);
  }
  for (let i = 0; i < todo.length; i += 100) {
    const chunk = todo.slice(i, i + 100);
    const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(chunk, SIGN_TTL);
    if (error) { console.warn('[photos] signedUrls', error); continue; }
    for (const row of data || []) {
      if (row?.signedUrl && !row.error) {
        out.set(row.path, row.signedUrl);
        urlCache.set(row.path, { url: row.signedUrl, until: now + (SIGN_TTL - 120) * 1000 });
      }
    }
  }
  return out;
}
export async function signedUrl(path) {
  if (!path) return null;
  const c = urlCache.get(path);
  if (c && c.until > Date.now()) return c.url;
  const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, SIGN_TTL);
  if (error) { console.warn('[photos] signedUrl', error); return null; }
  urlCache.set(path, { url: data.signedUrl, until: Date.now() + (SIGN_TTL - 120) * 1000 });
  return data.signedUrl;
}

/* ---------- Lightbox ---------- */
const ICON = {
  prev: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};
let lb;
function ensureLightbox() {
  if (lb) return lb;
  const d = document.createElement('dialog');
  d.className = 'lightbox';
  d.setAttribute('aria-label', 'Visionneuse de photos');
  d.innerHTML = `
    <div class="lb-bar">
      <span class="lb-count small" aria-live="polite"></span>
      <div class="lb-actions">
        <button type="button" class="btn btn-danger lb-del" hidden>${ICON.trash}<span>Supprimer</span></button>
        <button type="button" class="btn btn-ghost lb-close" aria-label="Fermer">${ICON.close}</button>
      </div>
    </div>
    <div class="lb-stage">
      <button type="button" class="lb-nav lb-prev" aria-label="Photo précédente">${ICON.prev}</button>
      <figure class="lb-fig"><img alt=""><figcaption class="small muted"></figcaption></figure>
      <button type="button" class="lb-nav lb-next" aria-label="Photo suivante">${ICON.next}</button>
    </div>`;
  document.body.append(d);
  lb = { d, items: [], i: 0, opener: null };
  const show = () => {
    const it = lb.items[lb.i];
    const img = d.querySelector('img');
    img.src = it.url; img.alt = it.alt || '';
    d.querySelector('figcaption').textContent = it.caption || '';
    d.querySelector('.lb-count').textContent = `${lb.i + 1} / ${lb.items.length}`;
    const many = lb.items.length > 1;
    d.querySelector('.lb-prev').hidden = !many;
    d.querySelector('.lb-next').hidden = !many;
    d.querySelector('.lb-del').hidden = !it.onDelete;
  };
  lb.show = show;
  const step = (n) => { lb.i = (lb.i + n + lb.items.length) % lb.items.length; show(); };
  d.querySelector('.lb-prev').addEventListener('click', () => step(-1));
  d.querySelector('.lb-next').addEventListener('click', () => step(1));
  d.querySelector('.lb-close').addEventListener('click', () => d.close());
  d.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  d.addEventListener('click', (e) => { if (e.target === d || e.target.classList.contains('lb-stage')) d.close(); });
  d.addEventListener('close', () => { d.querySelector('img').removeAttribute('src'); lb.opener?.focus?.(); });
  d.querySelector('.lb-del').addEventListener('click', async () => {
    const it = lb.items[lb.i];
    if (!it?.onDelete || !confirm('Supprimer cette photo ?')) return;
    const ok = await it.onDelete(it);
    if (ok === false) return;
    lb.items.splice(lb.i, 1);
    if (!lb.items.length) { d.close(); return; }
    lb.i = Math.min(lb.i, lb.items.length - 1);
    show();
  });
  return lb;
}

/**
 * Ouvre la visionneuse.
 * items : [{ url, alt?, caption?, onDelete?: async (item) => boolean }]
 */
export function openLightbox(items, index = 0) {
  if (!items?.length) return;
  const l = ensureLightbox();
  l.items = [...items]; l.i = Math.max(0, Math.min(index, items.length - 1));
  l.opener = document.activeElement;
  l.show();
  l.d.showModal();
  l.d.querySelector('.lb-close').focus();
}

/** Petit utilitaire : <img> avec fallback (si URL manquante → bloc vide). */
export function thumbHtml(url, alt = '') {
  return url ? `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async">` : '<span class="thumb-missing" aria-hidden="true"></span>';
}
