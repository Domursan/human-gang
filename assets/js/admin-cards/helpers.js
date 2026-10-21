// Cartes admin : outils communs (formatage, index, dialogues, envoi d'images, lecture paginée).
import { sb, toast, errMsg, esc } from '../core.js';
import { prepareImage } from '../image-compress.js';
import { C } from './state.js';
import { TZ } from './constants.js';

/* ---------- Petits outils ---------- */
export const check = (res) => { if (res.error) throw res.error; return res.data; };
export const nf = (n) => new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 2 }).format(n || 0);
export const fmtWhen = (iso) => (iso ? new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');
export const pseudo = (id) => (id ? C.byId.get(id)?.pseudo ?? 'Ancien membre' : '—');
export const friendly = (e, map = {}) => (e?.code && map[e.code]) || errMsg(e);
export const group = (rows, key) => {
  const m = new Map();
  for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
};
export const maxSerialOf = (cardId) => (C.copiesByCard.get(cardId) || []).reduce((m, x) => Math.max(m, x.serial || 0), 0);
export const liveCount = (cardId) => (C.copiesByCard.get(cardId) || []).filter((x) => !x.recycled_at).length;
export const nextFreeNumber = (setId) => {
  const used = new Set(C.cards.filter((k) => k.set_id === setId).map((k) => k.number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
};
export const nextSetSort = () => C.sets.reduce((m, s) => Math.max(m, s.sort), -1) + 1;
export const identSetId = () => (C.sets.some((s) => s.id === C.identSet) ? C.identSet : C.sets[0]?.id || '');
export const thumb = (k) => (k.image_url ? `<img class="acd-thumb" src="${esc(k.image_url)}" alt="" loading="lazy">` : '<span class="acd-thumb acd-thumb-ph" aria-hidden="true"></span>');
export const tile = (v, l) => `<div class="acd-tile"><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`;
export const selField = (id, label, f, options, val) => `<div class="field"><label for="${id}">${esc(label)}</label>
  <select id="${id}" data-f="${f}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
export const setState = (s, now = Date.now()) => {
  if (!s.active) return ['pill-todo', 'Désactivée'];
  if (s.starts_at && new Date(s.starts_at).getTime() > now) return ['pill-current', 'À venir'];
  if (s.ends_at && new Date(s.ends_at).getTime() <= now) return ['pill-todo', 'Terminée'];
  return ['pill-ok', 'Active'];
};
export const period = (s) => (s.starts_at || s.ends_at
  ? `${s.starts_at ? 'du ' + fmtWhen(s.starts_at) : 'dès le début'}${s.ends_at ? ' au ' + fmtWhen(s.ends_at) : ', sans fin'}`
  : 'toujours disponible');
export const dlgHead = (title) => `<div class="acd-dlg-head"><h2 id="acd-dlg-title" class="dialog-title">${esc(title)}</h2>
  <button class="btn btn-ghost btn-sm" type="button" data-acd-close>Fermer</button></div>`;

export function dialog() {
  let d = document.getElementById('acd-dlg');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'acd-dlg'; d.className = 'hg-dialog acd-dlg';
    d.setAttribute('aria-labelledby', 'acd-dlg-title');
    d.addEventListener('click', (e) => { if (e.target.closest('[data-acd-close]')) d.close(); });
    document.body.append(d);
  }
  return d;
}
export async function act(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { toast(errMsg(e), 'error'); } finally { if (btn?.isConnected) btn.disabled = false; }
}
export async function removeImages(urls) {
  const paths = urls.map((u) => /\/hg-assets\/(cards\/[^?#]+)/.exec(u || '')?.[1]).filter(Boolean).map((p) => decodeURIComponent(p));
  if (!paths.length) return;
  try { await sb.storage.from('hg-assets').remove(paths); } catch { /* image orpheline : non bloquant */ }
}
export async function uploadCardImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choisis une image (PNG, JPG, WebP, GIF ou SVG).');
  if (file.size > 5 * 1024 * 1024) throw new Error('Image trop lourde (5 Mo maximum).');
  const img = await prepareImage(file);
  const path = `cards/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${img.ext}`;
  check(await sb.storage.from('hg-assets').upload(path, img.blob, { upsert: true, contentType: img.contentType, cacheControl: '3600' }));
  return sb.storage.from('hg-assets').getPublicUrl(path).data.publicUrl;
}

/** Lecture complète d'une table (PostgREST renvoie au plus 1000 lignes par requête). */
export async function fetchAll(make) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if ((data || []).length < PAGE) break;
  }
  return out;
}
