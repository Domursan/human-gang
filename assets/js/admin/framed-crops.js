// ===== Humane Gang — administration : images Framed découpées dans une affiche =====
/*
 * Rôle : fabriquer les 6 images d'un Framed (« devine l'image ») à partir d'une seule image : une affiche, un tuto du site
 * (liste assets/data/framed-affiches.json, images assets/img/framed/) ou une image importée. Les découpes vont du détail
 * serré (1re image) à l'image entière (6e). Toutes contiennent un même point de mise au point, choisi au hasard mais de
 * façon déterministe (graine = slug ou nom du fichier). Les 4 premières n'empiètent pas sur le haut de l'image (20 %),
 * où se trouvent souvent les titres, qui donneraient la réponse.
 * Exporte : cropsFromImage, loadImage, loadManifest, norm.
 */

/* ---------- Constantes ---------- */

/** Largeur et hauteur de chaque découpe, en fraction de l'image (même proportion) : du plus serré au tout. */
const FRACTIONS = [0.16, 0.25, 0.36, 0.5, 0.7, 1.0];
/** Part haute de l'image, où se trouvent souvent les titres. */
const TOP = 0.2;
/** Nombre de découpes (en partant de la 1re) qui restent sous la bande haute. */
const HIDE_TOP_UNTIL = 4;
/** Côté le plus long des images produites : 1280 px au plus, 512 px au moins (les détails serrés sont agrandis). */
const OUT_MAX = 1280;
const OUT_MIN = 512;
/** Qualité de l'encodage WebP des découpes. */
const WEBP_QUALITY = 0.86;
/** Liste des affiches et tutos du site, relative à la racine du site. */
const MANIFEST = 'assets/data/framed-affiches.json';

/* ---------- Outils ---------- */

/**
 * Normalise un titre pour comparer : minuscules, sans accents, sans espaces superflus.
 * @param {string} s Titre.
 * @returns {string}
 */
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Empreinte 32 bits (FNV-1a) d'une chaîne : graine stable pour un même slug. */
function hashSeed(str) {
  let h = 0x811c9dc5;
  for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Générateur pseudo-aléatoire (mulberry32) : renvoie une fonction qui donne des nombres entre 0 et 1, toujours la même
 * suite pour une même graine.
 * @param {number} seed Graine 32 bits.
 * @returns {() => number}
 */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Découpes ---------- */

/**
 * Rectangle de la découpe, en pixels de l'image W × H, qui contient le point de mise au point (fx, fy).
 * Si hideTop, le haut du rectangle reste sous la bande haute de l'image.
 * @returns {{x: number, y: number, w: number, h: number}}
 */
function cropRect(W, H, frac, fx, fy, hideTop, rnd) {
  const w = Math.round(frac * W), h = Math.round(frac * H);
  const x0 = Math.max(0, fx - w), x1 = Math.min(W - w, fx);
  let y0 = Math.max(0, fy - h);
  const y1 = Math.min(H - h, fy);
  if (hideTop) y0 = Math.max(y0, Math.ceil(TOP * H));
  const x = Math.floor(x0 + rnd() * (x1 - x0));
  const y = Math.floor(y0 + rnd() * (y1 - y0));
  return { x, y, w, h };
}

/**
 * Dessine une découpe dans un canvas et l'encode en WebP.
 * @returns {Promise<Blob>}
 */
async function drawCrop(img, r) {
  const long = Math.max(r.w, r.h);
  const k = Math.min(OUT_MAX, Math.max(OUT_MIN, long)) / long;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(r.w * k);
  canvas.height = Math.round(r.h * k);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', WEBP_QUALITY));
  if (!blob || blob.type !== 'image/webp') throw new Error('Encodage WebP indisponible sur ce navigateur');
  return blob;
}

/**
 * Six découpes de l'image, de la plus serrée (1re) à l'image entière (6e), toutes au même point de mise au point.
 * Déterministe : une même image et une même graine donnent toujours les mêmes découpes.
 * @param {HTMLImageElement|ImageBitmap} img Image décodée.
 * @param {string} seed Graine (slug de l'affiche ou nom du fichier).
 * @returns {Promise<Blob[]>} Six images WebP.
 */
export async function cropsFromImage(img, seed = 'framed') {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  if (!W || !H) throw new Error('Image illisible');
  const rnd = prng(hashSeed(String(seed)));
  const fx = Math.round(W * (0.3 + 0.4 * rnd())), fy = Math.round(H * (0.35 + 0.4 * rnd()));
  const out = [];
  for (let i = 0; i < FRACTIONS.length; i++) {
    const r = cropRect(W, H, FRACTIONS[i], fx, fy, i < HIDE_TOP_UNTIL, rnd);
    out.push(await drawCrop(img, r));
  }
  return out;
}

/* ---------- Chargement ---------- */

/**
 * Charge une image décodée. src : adresse, ou fichier (Blob) importé par l'administrateur.
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImage(src) {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  return img.decode()
    .then(() => img, () => { throw new Error('Image illisible'); })
    .finally(() => { if (typeof src !== 'string') URL.revokeObjectURL(url); });
}

/** Liste des affiches et tutos du site (mise en cache ; un échec n'est pas gardé). */
let manifest = null;
export function loadManifest() {
  if (!manifest) {
    manifest = fetch(MANIFEST, { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error('Liste des affiches indisponible'); return r.json(); })
      .catch((e) => { manifest = null; throw e; });
  }
  return manifest;
}
