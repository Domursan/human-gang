// ===== Humane Gang — compression d'image côté client (photos et administration) =====
// Redimensionne le côté le plus long à MAX_SIDE px et réencode en WebP (qualité 0.85).
// Repli JPEG si le navigateur ne sait pas écrire de WebP. Les GIF (animés) passent tels quels ; les SVG sont convertis
// en image (le stockage hg-assets refuse les SVG depuis la migration 073 : un SVG peut contenir du script).
// Une image déjà petite et plus légère en JPEG/WebP d'origine est envoyée telle quelle.
/*
 * Rôle : réduit le poids des photos avant de les envoyer au stockage (photos des membres, images de l'administration).
 * Page : les pages qui envoient une image (irl.js, historique.js, et les pages d'administration : événements, thèmes, souvenirs, badges).
 * Dépendances : aucune (API navigateur : createImageBitmap ou Image, canvas).
 * Exporte : prepareImage, otherVariants, MAX_SIDE, WEBP_QUALITY (ces deux constantes ne sont utilisées que dans ce fichier).
 */

/* ---------- Constantes ---------- */

/** Taille maximale du côté le plus long, en pixels. */
export const MAX_SIDE = 1600;
/** Qualité de l'encodage WebP (0 à 1). */
export const WEBP_QUALITY = 0.85;
/** Qualité de l'encodage JPEG de repli (0 à 1). */
const JPEG_QUALITY = 0.85;
/** Types non réencodés : un GIF pourrait perdre son animation. Un SVG, lui, est toujours converti en WebP (ou JPEG). */
const KEEP_AS_IS = new Set(['image/gif']);
/** Extension de fichier pour chaque type MIME accepté. */
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
/** Toutes les extensions possibles pour une image envoyée (utilisé pour nettoyer les anciennes versions). */
const ALL_EXTS = ['png', 'jpg', 'webp', 'gif', 'svg'];

/* ---------- Décodage et encodage ---------- */

/**
 * Décode un fichier image en bitmap ou en élément <img>, selon ce que le navigateur sait faire.
 * @param {File} file Fichier image.
 * @returns {Promise<ImageBitmap|HTMLImageElement>} Image décodée, prête à être dessinée.
 */
async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* repli <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Encode le contenu d'un canvas en Blob (version Promise de canvas.toBlob).
 * @param {HTMLCanvasElement} canvas Canvas à encoder.
 * @param {string} type Type MIME visé ('image/webp' ou 'image/jpeg').
 * @param {number} quality Qualité (0 à 1).
 * @returns {Promise<Blob|null>} Null si l'encodage est impossible.
 */
const toBlob = (canvas, type, quality) => new Promise((res) => canvas.toBlob(res, type, quality));

/**
 * Prépare un fichier image pour l'envoi.
 * Renvoie { blob, ext, contentType } : à utiliser tel quel pour le chemin de stockage et le type MIME.
 * strip : true pour toujours réencoder (l'image redessinée perd ses métadonnées EXIF, dont la position GPS).
 */
export async function prepareImage(file, { max = MAX_SIDE, quality = WEBP_QUALITY, strip = false } = {}) {
  if (!file?.type?.startsWith('image/')) throw new Error(`« ${file?.name || 'fichier'} » n'est pas une image`);
  if (KEEP_AS_IS.has(file.type) && !strip) return { blob: file, ext: EXT[file.type], contentType: file.type };

  const src = await decode(file);
  const w0 = src.width, h0 = src.height;
  if (!w0 || !h0) throw new Error(`Image illisible : ${file.name}`);
  // Un SVG est vectoriel : on le dessine à la taille maximale (jamais à sa petite taille nominale, ex. 24 px).
  const k = file.type === 'image/svg+xml' ? max / Math.max(w0, h0) : Math.min(1, max / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(src, 0, 0, w, h);
  src.close?.();

  let blob = await toBlob(canvas, 'image/webp', quality);
  if (blob?.type !== 'image/webp') {
    // WebP non pris en charge : le navigateur renvoie un PNG. Repli JPEG sur fond blanc (pas de transparence).
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    blob = await toBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    if (!blob) throw new Error(`Impossible de compresser ${file.name}`);
    return { blob, ext: 'jpg', contentType: 'image/jpeg' };
  }
  // Déjà léger et sans redimensionnement : on garde l'original plutôt que de le réencoder plus lourd
  if (!strip && k === 1 && blob.size >= file.size && (file.type === 'image/webp' || file.type === 'image/jpeg')) {
    return { blob: file, ext: EXT[file.type], contentType: file.type };
  }
  return { blob, ext: 'webp', contentType: 'image/webp' };
}

/** Chemins possibles d'une image déjà envoyée sous `base` avec une autre extension (pour nettoyer après un remplacement). */
export function otherVariants(base, keepExt) {
  return ALL_EXTS.filter((e) => e !== keepExt).map((e) => `${base}.${e}`);
}
