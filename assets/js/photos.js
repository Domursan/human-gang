// ===== Humane Gang — photos : compression, envoi, URLs signées, lightbox (partagé IRL / Historique) =====
/*
 * Rôle : tout ce qui touche aux photos : envoi et suppression dans le stockage, adresses temporaires (signées)
 * pour les afficher, visionneuse plein écran, et téléchargement de l'album d'une sortie en ZIP.
 * Pages : irl.js et irl-history.js (sorties), historique.js (souvenirs), et l'administration (admin-sorties/, admin-souvenirs/).
 * Dépendances : core.js (client Supabase, esc), config.js (adresse du projet pour l'album), reactions.js (barre de
 *   réactions dans la visionneuse), ui-confirm.js (confirmation de suppression), icons.js (icônes).
 * Stockage : bucket « hg-photos ». Fonction edge : hg-album (album ZIP).
 * Exporte : PHOTO_BUCKET, uuid, uploadImage, removeObjects, signedUrls, signedUrl, openLightbox, thumbHtml, downloadAlbum.
 */
import { sb, esc } from './core.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { reactionBarHtml } from './reactions.js';
import { confirmBox } from './ui-confirm.js';
import { svg } from './icons.js';

/* ---------- Constantes ---------- */

/** Nom du bucket de stockage des photos. */
export const PHOTO_BUCKET = 'hg-photos';
/** Durée de validité d'une adresse signée, en secondes (1 heure). */
const SIGN_TTL = 3600; // secondes

/**
 * Identifiant unique au format UUID v4. Utilise crypto.randomUUID si le navigateur le fournit,
 * sinon génère les octets à la main (les bits de version et de variante sont posés).
 * @returns {string}
 */
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------- Stockage ---------- */
/**
 * Envoie un blob préparé par prepareImage ; le type MIME vient du blob. Une adresse en cache pour ce chemin est oubliée.
 * upsert est désactivé : on n'écrase jamais une photo existante.
 * @param {string} path Chemin dans le bucket.
 * @param {Blob} blob Image à envoyer.
 * @returns {Promise<string>} Le chemin (inchangé).
 */
export async function uploadImage(path, blob) {
  const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false, cacheControl: '3600' });
  if (error) throw error;
  forgetUrl(path);
  return path;
}
/**
 * Supprime des fichiers du bucket (les chemins vides sont ignorés) et oublie leurs adresses en cache.
 * @param {Array<string|null|undefined>} paths Chemins à supprimer.
 * @returns {Promise<void>}
 */
export async function removeObjects(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const { error } = await sb.storage.from(PHOTO_BUCKET).remove(list);
  if (error) throw error;
  list.forEach(forgetUrl);
}

/* ---------- URLs signées (avec cache mémoire) ---------- */
/** Adresses signées déjà obtenues : chemin -> { url, until }. until = instant (ms) à partir duquel l'adresse n'est plus sûre. */
const urlCache = new Map(); // path -> { url, until }
/**
 * Oublie l'adresse signée d'un chemin (après un envoi ou une suppression).
 * @param {string} path Chemin dans le bucket.
 */
function forgetUrl(path) { urlCache.delete(path); }

/**
 * Renvoie une Map path -> url signée, en lots de 100. Les adresses encore valables viennent du cache.
 * Les chemins introuvables ou en erreur sont absents de la Map ; un lot en erreur ne bloque pas les autres.
 * Une adresse est gardée 2 minutes de moins que sa durée réelle, pour ne jamais être servie expirée.
 * @param {string[]} paths Chemins à signer.
 * @returns {Promise<Map<string, string>>}
 */
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
/**
 * Adresse signée d'une seule photo (prise dans le cache si elle est encore valable).
 * @param {string|null|undefined} path Chemin dans le bucket.
 * @returns {Promise<string|null>} Adresse, ou null si absente ou en erreur.
 */
export async function signedUrl(path) {
  if (!path) return null;
  const c = urlCache.get(path);
  if (c && c.until > Date.now()) return c.url;
  const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, SIGN_TTL);
  if (error) { console.warn('[photos] signedUrl', error); return null; }
  urlCache.set(path, { url: data.signedUrl, until: Date.now() + (SIGN_TTL - 120) * 1000 });
  return data.signedUrl;
}

/* ---------- Visionneuse (lightbox) ---------- */

/** Icônes de la visionneuse (précédent, suivant, fermer, supprimer). */
const ICON = {
  prev: svg('prev', { size: 22, stroke: 2 }),
  next: svg('chev', { size: 22, stroke: 2 }),
  close: svg('close', { size: 22, stroke: 2 }),
  trash: svg('trash2', { size: 18, stroke: 2 }),
};
/** État de la visionneuse, créée une seule fois : { d (dialogue), items, i (index affiché), opener, show }. */
let lb;
/**
 * Construit la visionneuse (dialogue) la première fois, puis la renvoie.
 * Elle affiche une photo, ses légendes, la barre de réactions et un bouton « Supprimer » si l'élément le permet.
 * Flèches gauche / droite et clic sur le fond la pilotent. À la fermeture, l'image est retirée (libère la mémoire).
 * @returns {{d: HTMLDialogElement, items: Array<object>, i: number, opener: Element|null, show: Function}}
 */
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
    </div>
    <div class="lb-react" hidden></div>`;
  document.body.append(d);
  lb = { d, items: [], i: 0, opener: null };
  /** Affiche la photo à l'index courant : image, légende, compteur, flèches, bouton supprimer, réactions. */
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
    const rb = d.querySelector('.lb-react');
    rb.hidden = !it.react;
    rb.innerHTML = it.react ? reactionBarHtml('photo', it.react) : '';
  };
  lb.show = show;
  /**
   * Passe à la photo suivante (n = 1) ou précédente (n = -1), en boucle.
   * @param {number} n Décalage.
   */
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
    if (!it?.onDelete || !(await confirmBox('Supprimer cette photo ?', '', { ok: 'Supprimer', danger: true }))) return;
    const ok = await it.onDelete(it);
    if (ok === false) return;
    const idx = lb.items.indexOf(it); // l'index a pu changer pendant la confirmation
    if (idx < 0) return;
    lb.items.splice(idx, 1);
    if (!lb.items.length) { d.close(); return; }
    lb.i = Math.min(lb.i, lb.items.length - 1);
    show();
  });
  return lb;
}

/**
 * Ouvre la visionneuse.
 * items : [{ url, alt?, caption?, react?: id de la photo (barre de réactions), onDelete?: async (item) => boolean }]
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

/* ---------- Album : téléchargement en un ZIP (fonction edge hg-album) ---------- */
/** Télécharge toutes les photos d'une sortie. Lève une erreur lisible en cas d'échec. */
export async function downloadAlbum(eventId, title = '') {
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('session expirée, reconnecte-toi');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/hg-album`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId }),
  });
  if (!res.ok) {
    let msg = `erreur ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* réponse non JSON */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const slug = String(title).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'sortie';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `album-${slug}.zip`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
