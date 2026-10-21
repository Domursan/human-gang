// Admin : outils communs aux sections (icônes, busy, copie, envoi d'images, message d'erreur de section).
import { sb, toast, errMsg, esc } from '../core.js';
import { svg } from '../icons.js';
import { prepareImage, otherVariants } from '../image-compress.js';

/* ---------- Icônes (SVG à trait) ---------- */
export const ICON = {
  copy: svg('copy', { stroke: 2 }),
  trash: svg('trash', { stroke: 2 }),
  x: svg('close', { stroke: 2 }),
  link: svg('link2', { stroke: 2 }),
  badge: svg('badge', { stroke: 1.8 }),
  upload: svg('upload', { stroke: 2 }),
  check: svg('check2', { stroke: 2.2 }),
};

/* ---------- Petits outils ---------- */
export async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return undefined; } finally { if (btn) btn.disabled = false; }
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
  }
  toast('Copié dans le presse-papiers', 'ok');
}
export function check(res) { if (res.error) throw res.error; return res.data; }
/** Téléverse une image sous `base` (sans extension) ; compressée en WebP, l'extension suit le format envoyé. */
export async function uploadAsset(base, file) {
  if (!file.type.startsWith('image/')) throw new Error('Choisis une image (PNG, JPG ou WebP).');
  if (file.size > 10 * 1024 * 1024) throw new Error('Image trop lourde (10 Mo maximum).');
  const img = await prepareImage(file);
  const path = `${base}.${img.ext}`;
  check(await sb.storage.from('hg-assets').upload(path, img.blob, { upsert: true, contentType: img.contentType, cacheControl: '300' }));
  sb.storage.from('hg-assets').remove(otherVariants(base, img.ext)).catch(() => {}); // ancienne version dans un autre format
  const { data } = sb.storage.from('hg-assets').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`; // évite l'ancienne version en cache
}
export function pickFile(input) {
  return new Promise((resolve) => {
    input.value = '';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
export const sectionError = (e) => `<div class="empty">Impossible de charger : ${esc(errMsg(e))}</div>`;

export const nullIfEmpty = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());
