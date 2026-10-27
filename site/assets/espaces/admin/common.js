// Admin : outils communs aux sections (icônes, busy, copie, envoi d'images, message d'erreur de section).
// Utilisé par presque toutes les sections admin/. Dépend de core.js (Supabase, toast, erreurs), icons.js (SVG)
// et image-compress.js (compression des images avant envoi).
import { sb, toast, errMsg, esc } from '../core.js';
import { svg } from '../icons.js';
import { prepareImage, otherVariants } from '../image-compress.js';

/* ---------- Icônes (SVG à trait) ---------- */
/** Icônes des boutons d'action des sections (copier, supprimer, téléverser…). */
export const ICON = {
  copy: svg('copy', { stroke: 2 }),
  trash: svg('trash', { stroke: 2 }),
  badge: svg('badge', { stroke: 1.8 }),
  upload: svg('upload', { stroke: 2 }),
  check: svg('check2', { stroke: 2.2 }),
};

/* ---------- Petits outils ---------- */
/**
 * Action en cours : le bouton est désactivé, montre un indicateur, et ne peut pas être envoyé deux fois.
 * Une erreur est affichée en toast (la fonction ne lève pas).
 * @param {HTMLElement|null} btn Bouton déclencheur (peut être null).
 * @param {() => Promise<any>} fn Action asynchrone à exécuter.
 * @returns {Promise<any>} Ce que renvoie `fn`, ou undefined en cas d'erreur ou si une action est déjà en cours.
 */
export async function busy(btn, fn) {
  if (btn?.dataset.busy) return undefined;
  if (btn) { btn.disabled = true; btn.dataset.busy = '1'; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return undefined; } finally {
    if (btn) { delete btn.dataset.busy; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); if (btn.isConnected) btn.disabled = false; }
  }
}
/** Copie un texte dans le presse-papiers, puis confirme par un message. Repli sur une zone de texte cachée si l'API est bloquée. */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
  }
  toast('Copié dans le presse-papiers', 'ok');
}
/** Renvoie les données d'une réponse Supabase, ou lève son erreur (pour que busy/toast l'affichent). */
export function check(res) { if (res.error) throw res.error; return res.data; }
/**
 * Téléverse une image sous `base` (sans extension). Compressée en WebP, l'extension suit le format envoyé.
 * Lève une erreur si le fichier n'est pas une image ou dépasse 10 Mo.
 * @returns {Promise<string>} URL publique, avec un paramètre `v` pour ne pas garder l'ancienne version en cache.
 */
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
/**
 * Ouvre le sélecteur de fichiers d'un <input type="file"> et renvoie le fichier choisi, ou null.
 * L'input est vidé avant, pour que le même fichier puisse être choisi deux fois de suite.
 */
export function pickFile(input) {
  return new Promise((resolve) => {
    input.value = '';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
/** Message affiché à la place d'une section dont le chargement a échoué. */
export const sectionError = (e) => `<div class="empty">Impossible de charger : ${esc(errMsg(e))}</div>`;

/** Texte nettoyé (espaces retirés), ou null s'il est vide. Pour les champs optionnels, enregistrés en base comme null. */
export const nullIfEmpty = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());
