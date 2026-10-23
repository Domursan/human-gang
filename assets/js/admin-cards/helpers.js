// =====================================================================
// Cartes admin : outils communs (formatage, index, dialogues, envoi d'images, lecture paginée).
// Fonctions pures pour la plupart ; les autres parlent à Supabase (images, lecture complète) ou affichent un message.
// Dépendances : core.js (sb, toast, errMsg, esc), image-compress.js (prepareImage), state.js (C), constants.js (TZ).
// Exporte : check, nf, fmtWhen, pseudo, activeProfiles, friendly, group, maxSerialOf, liveCount, nextFreeNumber,
// nextSetSort, identSetId, thumb, tile, selField, setState, period, act, removeImages, uploadCardImage, fetchAll.
// =====================================================================
import { sb, toast, errMsg, esc } from '../core.js';
import { prepareImage } from '../image-compress.js';
import { C } from './state.js';
import { TZ } from './constants.js';

/* ---------- Petits outils ---------- */
/* Données d'une réponse Supabase, ou lève l'erreur reçue. Même rôle que check() dans admin-accounts/common.js. */
export const check = (res) => { if (res.error) throw res.error; return res.data; };
/* Nombre formaté à la mode suisse, avec 2 décimales au plus. */
export const nf = (n) => new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 2 }).format(n || 0);
/* Date et heure lisibles, en fuseau de Zurich ; chaîne vide si la date est absente. */
export const fmtWhen = (iso) => (iso ? new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');
/* Pseudo d'un membre à partir de son identifiant ; « Ancien membre » si le profil n'est plus connu. */
export const pseudo = (id) => (id ? C.byId.get(id)?.pseudo ?? 'Ancien membre' : '—');
/** Comptes inscrits seulement (hors fantômes) : pour les listes et les choix. L'historique garde C.byId. */
export const activeProfiles = () => C.profiles.filter((p) => !p.is_ghost);
/* Message d'erreur lisible : le texte de map pour ce code d'erreur s'il existe, sinon le message d'origine. */
export const friendly = (e, map = {}) => (e?.code && map[e.code]) || errMsg(e);
/* Regroupe des lignes par clé : renvoie une Map clé -> tableau des lignes de cette clé. */
export const group = (rows, key) => {
  const m = new Map();
  for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
};
/* Plus grand numéro de série des exemplaires d'une carte (0 s'il n'y en a pas). */
export const maxSerialOf = (cardId) => (C.copiesByCard.get(cardId) || []).reduce((m, x) => Math.max(m, x.serial || 0), 0);
/* Nombre d'exemplaires d'une carte encore en circulation (non recyclés). */
export const liveCount = (cardId) => (C.copiesByCard.get(cardId) || []).filter((x) => !x.recycled_at).length;
/* Premier numéro libre dans une série : on comble les trous avant d'ajouter à la fin. */
export const nextFreeNumber = (setId) => {
  const used = new Set(C.cards.filter((k) => k.set_id === setId).map((k) => k.number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
};
/* Rang d'affichage à donner à une nouvelle série : après la dernière. */
export const nextSetSort = () => C.sets.reduce((m, s) => Math.max(m, s.sort), -1) + 1;
/* Série utilisée pour les cartes d'identité : celle choisie, sinon la première série. */
export const identSetId = () => (C.sets.some((s) => s.id === C.identSet) ? C.identSet : C.sets[0]?.id || '');
/* Vignette d'une carte : son image, ou une case vide si elle n'en a pas. */
export const thumb = (k) => (k.image_url ? `<img class="acd-thumb" src="${esc(k.image_url)}" alt="" loading="lazy">` : '<span class="acd-thumb acd-thumb-ph" aria-hidden="true"></span>');
/* Petite tuile « valeur + libellé » pour les chiffres clés. */
export const tile = (v, l) => `<div class="acd-tile"><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`;
/* Champ de formulaire « liste déroulante », avec l'option val pré-sélectionnée. */
export const selField = (id, label, f, options, val) => `<div class="field"><label for="${id}">${esc(label)}</label>
  <select id="${id}" data-f="${f}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
/* Statut d'une série selon ses dates : désactivée, à venir, terminée ou active. Renvoie [classe de pastille, libellé]. */
export const setState = (s, now = Date.now()) => {
  if (!s.active) return ['pill-todo', 'Désactivée'];
  if (s.starts_at && new Date(s.starts_at).getTime() > now) return ['pill-current', 'À venir'];
  if (s.ends_at && new Date(s.ends_at).getTime() <= now) return ['pill-todo', 'Terminée'];
  return ['pill-ok', 'Active'];
};
/* Phrase décrivant la période de disponibilité d'une série. */
export const period = (s) => (s.starts_at || s.ends_at
  ? `${s.starts_at ? 'du ' + fmtWhen(s.starts_at) : 'dès le début'}${s.ends_at ? ' au ' + fmtWhen(s.ends_at) : ', sans fin'}`
  : 'toujours disponible');
/** Action en cours : bouton désactivé avec indicateur, pas de second envoi. */
export async function act(btn, fn) {
  if (btn?.dataset.busy) return;
  if (btn) { btn.disabled = true; btn.dataset.busy = '1'; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true'); }
  try { await fn(); } catch (e) { toast(errMsg(e), 'error'); } finally {
    if (btn) { delete btn.dataset.busy; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); if (btn.isConnected) btn.disabled = false; }
  }
}
/**
 * Supprime du stockage les images d'une liste d'URL. Seules les images du dossier cards/ sont concernées.
 * Ne bloque jamais : une image orpheline n'empêche pas la suite.
 * @param {string[]} urls adresses publiques des images.
 */
export async function removeImages(urls) {
  const paths = urls.map((u) => /\/hg-assets\/(cards\/[^?#]+)/.exec(u || '')?.[1]).filter(Boolean).map((p) => decodeURIComponent(p));
  if (!paths.length) return;
  try { await sb.storage.from('hg-assets').remove(paths); } catch { /* image orpheline : non bloquant */ }
}
/**
 * Vérifie, réduit puis envoie l'image d'une carte dans le dossier cards/ du bucket public hg-assets.
 * @param {File} file fichier choisi par l'admin (image de 5 Mo maximum).
 * @returns {Promise<string>} adresse publique de l'image.
 * @throws {Error} si le fichier n'est pas une image ou s'il est trop lourd.
 */
export async function uploadCardImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choisis une image (PNG, JPG, WebP, GIF ou SVG).');
  if (file.size > 5 * 1024 * 1024) throw new Error('Image trop lourde (5 Mo maximum).');
  const img = await prepareImage(file);
  const path = `cards/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${img.ext}`;
  // Nom unique à chaque envoi (jamais réécrit) : l'image peut être gardée un an par les navigateurs (Q3).
  check(await sb.storage.from('hg-assets').upload(path, img.blob, { upsert: true, contentType: img.contentType, cacheControl: '31536000' }));
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
