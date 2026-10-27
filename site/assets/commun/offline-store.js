// ===== Humane Gang — collection hors ligne (Q4) =====
/*
 * Rôle : garde sur l'appareil une copie de la collection de cartes du membre connecté et de sa propre carte de membre,
 * pour les montrer sans réseau, en lecture seule. Aucune donnée privée de plus : seulement ce que le membre lit déjà
 * (séries et cartes des séries ouvertes, ses exemplaires, son solde affiché, sa carte de membre).
 * - Stockage : IndexedDB « hg-offline », magasin « copies », une entrée par identifiant de compte :
 *   { user_id, at, profil: { id, pseudo, avatar_url, color }, cartes?: { at, sets, otherSets, cards, copies, paillettes }, membre?: { at, card } }.
 *   Jamais la copie d'un autre compte : la clé est l'identifiant du membre connecté (session locale).
 * - Images des cartes possédées : cache « hg-cartes-img » (adresses publiques du bucket hg-assets/cards/, sans jeton),
 *   rempli par la page et servi par sw.js hors ligne, plafonné à 400 images (les plus anciennes partent).
 * - Effacement : à la déconnexion (core/header.js), ou quand l'admin coupe la fonction (site_identite.cartes_hors_ligne).
 * - Sans réseau, cartes.js et membre.js démarrent avec startOfflinePage() au lieu d'initPage().
 * Page : cartes.js, membre.js (lecture et écriture), core/header.js (effacement), /offline.html (lien « Voir ma collection »).
 * Dépendances : core/supabase.js (session locale), core/site-defaults.js, core/theme-load.js, core/header.js, core/util.js.
 * Exporte : IMG_CACHE, IMG_MAX, isOffline, offlineAllowed, localUserId, readOffline, saveOffline, clearOffline,
 *   cacheCardImages, startOfflinePage, offlineBannerHtml, fmtOfflineDate.
 */
import { sb } from './core/supabase.js';
import { siteIdentite, applySiteDom } from './core/site-defaults.js';
import { applyTheme } from './core/theme-load.js';
import { renderHeader } from './core/header.js';
import { esc } from './core/util.js';

/* ---------- Constantes ---------- */
const DB_NAME = 'hg-offline';
const STORE = 'copies';
/** Cache des images de cartes (même nom dans sw.js). */
export const IMG_CACHE = 'hg-cartes-img';
/** Nombre maximal d'images de cartes gardées (même valeur dans sw.js). */
export const IMG_MAX = 400;
/** Seules les images publiques des cartes sont gardées (pas de jeton, pas de donnée privée). */
const CARD_IMG_RE = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/hg-assets\/cards\/[^\s?#]+$/;

/** Vrai si le navigateur se dit hors ligne. */
export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
/** Vrai si l'admin n'a pas coupé la copie hors ligne (Admin › Site › Textes et intro › Collection hors ligne). */
export const offlineAllowed = () => siteIdentite().cartes_hors_ligne !== false;

/* ---------- IndexedDB ---------- */
/** Ouvre la base (créée au premier usage). Rejette si IndexedDB est indisponible (navigation privée…). */
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB indisponible')); return; }
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE, { keyPath: 'user_id' }); };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
/** Lance une opération sur le magasin et attend la fin de la transaction. */
async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

/**
 * Identifiant du membre connecté sur cet appareil, sans réseau : session locale de supabase-js, sinon le jeton
 * enregistré dans localStorage. null si personne n'est connecté.
 * @returns {Promise<string|null>}
 */
export async function localUserId() {
  try {
    const r = await Promise.race([sb.auth.getSession(), new Promise((res) => setTimeout(() => res(null), 1500))]);
    const id = r?.data?.session?.user?.id;
    if (id) return id;
  } catch { /* repli sur le stockage local */ }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!/^sb-.*-auth-token$/.test(k || '')) continue;
      const v = JSON.parse(localStorage.getItem(k) || 'null');
      const id = v?.user?.id || v?.currentSession?.user?.id;
      if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) return id;
    }
  } catch { /* stockage bloqué */ }
  return null;
}

/**
 * Copie hors ligne d'un compte, ou null (absente, effacée par le navigateur, ou IndexedDB indisponible).
 * @param {string} uid Identifiant du membre connecté.
 * @returns {Promise<object|null>}
 */
export async function readOffline(uid) {
  if (!uid) return null;
  try { return (await tx('readonly', (s) => s.get(uid))) || null; } catch { return null; }
}

/**
 * Enregistre une partie de la copie (« cartes » ou « membre ») pour le membre connecté, en gardant l'autre partie.
 * Sans effet si l'admin a coupé la fonction (la copie existante est alors effacée).
 * @param {object} me Profil du membre connecté ({ id, pseudo, avatar_url, color }).
 * @param {'cartes'|'membre'} part Partie à remplacer.
 * @param {object} data Contenu de la partie.
 */
export async function saveOffline(me, part, data) {
  if (!me?.id) return;
  if (!offlineAllowed()) { await clearOffline(); return; }
  try {
    const old = (await readOffline(me.id)) || {};
    const at = new Date().toISOString();
    const row = { ...old, user_id: me.id, at, profil: { id: me.id, pseudo: me.pseudo, avatar_url: me.avatar_url ?? null, color: me.color ?? null }, [part]: { ...data, at } };
    await tx('readwrite', (s) => s.put(row));
  } catch (e) { console.warn('[hors ligne] copie non enregistrée :', e?.message || e); }
}

/** Efface toutes les copies de l'appareil et le cache des images de cartes (déconnexion, fonction coupée). */
export async function clearOffline() {
  try { await tx('readwrite', (s) => s.clear()); } catch { /* rien à effacer */ }
  try { if (typeof caches !== 'undefined') await caches.delete(IMG_CACHE); } catch { /* pas de cache */ }
}

/**
 * Garde les images des cartes possédées dans le cache hg-cartes-img (au plus IMG_MAX), sans bloquer la page.
 * Seules les adresses publiques hg-assets/cards/ sont prises.
 * @param {string[]} urls Adresses des images.
 */
export async function cacheCardImages(urls) {
  if (typeof caches === 'undefined' || !offlineAllowed()) return;
  try {
    const list = [...new Set(urls.filter((u) => CARD_IMG_RE.test(String(u || ''))))].slice(0, IMG_MAX);
    if (!list.length) return;
    const cache = await caches.open(IMG_CACHE);
    for (const u of list) {
      if (await cache.match(u)) continue;
      try {
        const res = await fetch(u, { mode: 'cors', credentials: 'omit' });
        if (res.ok) await cache.put(u, res);
      } catch { /* image ignorée : elle reviendra à la prochaine visite */ }
    }
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - IMG_MAX))) await cache.delete(k);
  } catch (e) { console.warn('[hors ligne] images non gardées :', e?.message || e); }
}

/* ---------- Démarrage d'une page sans réseau ---------- */

/**
 * Démarre une page hors ligne : thème, en-tête (compte de la copie), sans aucune requête.
 * Renvoie { me, copie } si une copie existe pour le membre connecté, sinon { me: null, copie: null }.
 * Au retour du réseau, la page se recharge pour repasser en ligne.
 * @returns {Promise<{me: object|null, copie: object|null}>}
 */
export async function startOfflinePage() {
  try { applyTheme(); } catch { /* thème par défaut */ }
  try { applySiteDom(); } catch { /* textes d'origine */ }
  const uid = await localUserId();
  const copie = offlineAllowed() ? await readOffline(uid) : null;
  const me = copie?.profil?.id === uid ? copie.profil : null;
  try { renderHeader(me, { nav: false }); } catch (e) { console.warn('[hors ligne] en-tête', e); }
  window.addEventListener('online', () => location.reload(), { once: true });
  return { me, copie: me ? copie : null };
}

/** Date lisible de la copie : « mer. 22 oct. à 23 h 14 ». */
export function fmtOfflineDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const jour = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  return `${jour} à ${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Bandeau « Hors ligne · lecture seule » (maquette Q4).
 * @param {string|null} at Date de la copie (ISO), ou null s'il n'y a pas de copie.
 * @param {string} quoi Ce que montre la page (« ta collection », « ta carte de membre »).
 * @returns {string} HTML
 */
export function offlineBannerHtml(at, quoi = 'ta collection') {
  const icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0"/><path d="M5.5 12a10 10 0 0 1 13 0"/><path d="M9 15.5a5 5 0 0 1 6 0"/><circle cx="12" cy="19" r="1"/><path d="M3 3l18 18"/></svg>';
  const texte = at
    ? `${esc(quoi.charAt(0).toUpperCase() + quoi.slice(1))} telle qu’au ${esc(fmtOfflineDate(at))}. Ouvertures et échanges reviennent avec le réseau.`
    : `Aucune copie de ${esc(quoi)} sur cet appareil : ouvre la page une fois avec du réseau pour la garder. (Sur iPhone, Safari efface les données d’un site non ouvert depuis 7 jours.)`;
  return `<div class="offline-banner" role="status">${icon}<div><p class="offline-banner-title">Hors ligne · lecture seule</p><p class="small muted">${texte}</p></div></div>`;
}
