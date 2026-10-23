// ===== Humane Gang — pièces jointes de l'assistance (images et PDF) =====
// Côté membre (assistance.html) : choix, compression, envoi dans le bucket privé « hg-support-files », retrait avant envoi.
// Côté membre et admin (fil) : affichage des pièces jointes avec des liens signés courts (5 min), vignette pour une image,
// icône pour un PDF. Le bucket n'accepte que jpeg, png, webp, gif et PDF, 5 Mo au plus ; aucun SVG ni HTML.
// Dépendances : core.js (sb, esc), image-compress.js (prepareImage). Exporte : constantes, prepareSupportFile,
// uploadSupportFile, removeSupportFiles, attachmentsHtml, hydrateAttachments, fileSize.
import { sb, esc } from './core.js';
import { prepareImage } from './image-compress.js';

/** Bucket privé des pièces jointes (migration 078). */
export const SUPPORT_BUCKET = 'hg-support-files';
/** Taille maximale d'un fichier, en octets (5 Mo). */
export const SUPPORT_MAX_BYTES = 5 * 1024 * 1024;
/** Nombre maximal de pièces jointes par demande. */
export const SUPPORT_MAX_FILES = 3;
/** Types acceptés (même liste que le bucket). */
export const SUPPORT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
/** Durée de validité d'un lien signé, en secondes. */
const SIGNED_TTL = 300;

/** Taille lisible, en français (« 310 Ko », « 1,4 Mo »). */
export function fileSize(n) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/**
 * Prépare un fichier choisi par le membre : contrôle du type, compression des images (WebP), contrôle de la taille.
 * @param {File} file fichier choisi
 * @returns {Promise<{blob: Blob, ext: string, contentType: string, name: string, size: number, original: number, isImage: boolean}>}
 * @throws {Error} message en français si le fichier est refusé
 */
export async function prepareSupportFile(file) {
  if (!SUPPORT_MIMES.includes(file?.type)) throw new Error(`« ${file?.name || 'fichier'} » refusé : seulement des images ou des PDF`);
  if (file.size > SUPPORT_MAX_BYTES) throw new Error(`« ${file.name} » est trop lourd (${fileSize(file.size)}) : 5 Mo maximum`);
  const isImage = file.type.startsWith('image/');
  const prepared = isImage ? await prepareImage(file, { max: 1600 }) : { blob: file, ext: 'pdf', contentType: 'application/pdf' };
  if (prepared.blob.size > SUPPORT_MAX_BYTES) throw new Error(`« ${file.name} » reste trop lourd après compression : 5 Mo maximum`);
  return {
    blob: prepared.blob, ext: prepared.ext, contentType: prepared.contentType,
    name: String(file.name || 'piece-jointe').slice(0, 120), size: prepared.blob.size, original: file.size, isImage,
  };
}

/**
 * Identifiant aléatoire au format UUID v4, à partir de crypto.getRandomValues (disponible même hors contexte sécurisé,
 * contrairement à crypto.randomUUID).
 * @returns {string}
 */
function randomId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Envoie un fichier préparé dans le dossier du membre, sous un nom aléatoire.
 * @param {string} uid identifiant du membre (premier niveau du chemin, exigé par la politique du bucket)
 * @param {object} prepared résultat de prepareSupportFile
 * @returns {Promise<string>} chemin du fichier dans le bucket
 */
export async function uploadSupportFile(uid, prepared) {
  const path = `${uid}/${randomId()}.${prepared.ext}`;
  const { error } = await sb.storage.from(SUPPORT_BUCKET).upload(path, prepared.blob, {
    contentType: prepared.contentType, upsert: false, cacheControl: '3600',
  });
  if (error) throw error;
  return path;
}

/**
 * Retire des fichiers du bucket (fichiers non envoyés : retrait avant envoi, ou envoi échoué). Sans erreur levée.
 * @param {string[]} paths chemins à retirer
 */
export async function removeSupportFiles(paths) {
  if (!paths?.length) return;
  try { await sb.storage.from(SUPPORT_BUCKET).remove(paths); } catch { /* best effort */ }
}

/* ---------- Affichage dans le fil ---------- */
// Liens signés mis en cache le temps de leur validité (évite une requête par rendu).
const signed = new Map();

/** Lien signé d'un fichier (mis en cache), ou '' si la lecture est refusée. */
async function urlOf(path) {
  const hit = signed.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await sb.storage.from(SUPPORT_BUCKET).createSignedUrl(path, SIGNED_TTL);
  if (error || !data?.signedUrl) return '';
  signed.set(path, { url: data.signedUrl, until: Date.now() + (SIGNED_TTL - 30) * 1000 });
  return data.signedUrl;
}

/**
 * HTML des pièces jointes d'un message : vignette pour une image, icône et nom pour un PDF. Les liens sont remplis
 * ensuite par hydrateAttachments (liens signés). Tout texte passe par esc().
 * @param {Array<{path: string, name: string, mime: string, size: number}>} files pièces jointes
 * @returns {string} HTML (vide si aucune)
 */
export function attachmentsHtml(files) {
  if (!files?.length) return '';
  return `<ul class="sf-list" aria-label="Pièces jointes">${files.map((f) => {
    const img = String(f.mime || '').startsWith('image/');
    const label = `${f.name}, ${fileSize(f.size)}`;
    return `<li><a class="sf-item${img ? ' is-img' : ' is-pdf'}" href="#" data-sf-path="${esc(f.path)}" data-sf-img="${img ? '1' : '0'}" aria-label="Ouvrir ${esc(label)}" target="_blank" rel="noopener">`
      + (img
        ? `<span class="sf-thumb" aria-hidden="true"><img alt="" loading="lazy" decoding="async"></span>`
        : `<span class="sf-thumb sf-pdf" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg><span>PDF</span></span>`)
      + `<span class="sf-name">${esc(f.name)}</span><span class="sf-size">${esc(fileSize(f.size))}</span></a></li>`;
  }).join('')}</ul>`;
}

/**
 * Remplit les liens d'une zone rendue par attachmentsHtml : vignette (image) et adresse signée (ouverture).
 * Une erreur de lecture laisse le lien sans adresse (il est alors désactivé).
 * @param {ParentNode} root zone contenant les liens
 */
export async function hydrateAttachments(root) {
  const links = [...(root?.querySelectorAll('a[data-sf-path]') || [])];
  await Promise.all(links.map(async (a) => {
    const url = await urlOf(a.dataset.sfPath);
    if (!url) { a.removeAttribute('href'); a.classList.add('is-off'); a.setAttribute('aria-disabled', 'true'); return; }
    a.href = url;
    const img = a.querySelector('img');
    if (img && a.dataset.sfImg === '1') img.src = url;
  }));
}
