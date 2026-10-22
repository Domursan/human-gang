// Pastille « messages non lus » de l'en-tête (rafraîchie à l'ouverture, toutes les minutes et au retour sur l'onglet).
/*
 * Rôle : affiche dans le lien « Messages » de l'en-tête le nombre de messages non lus du membre.
 * Page : toutes les pages du membre (init.js lance startUnread ; messages.js appelle aussi refreshUnread).
 * Dépendances : supabase.js (RPC hg_unread_count, session).
 * Exporte : refreshUnread, startUnread.
 */
import { sb, hasSession, isNavCancel } from './supabase.js';

/** Minuteur de rafraîchissement automatique (une minute). */
let _unreadTimer = 0;
/** true une fois l'écouteur « retour sur l'onglet » posé : on ne l'ajoute qu'une fois. */
let _unreadBound = false;

/**
 * Rafraîchit la pastille « messages non lus » de l'en-tête. Renvoie le nombre (ou null en cas d'échec).
 * Sans lien « Messages » dans l'en-tête, ou sans session, ne fait rien et renvoie null.
 * Au-delà de 99, la pastille affiche « 99+ ».
 * @returns {Promise<number|null>} Nombre de messages non lus.
 */
export async function refreshUnread() {
  const link = document.querySelector('.site-header .nav-msg');
  if (!link || !(await hasSession())) return null;
  try {
    const { data, error } = await sb.rpc('hg_unread_count');
    if (error) throw error;
    // La fonction peut renvoyer un nombre nu ou un objet { nom: nombre } : on accepte les deux formes
    const raw = Array.isArray(data) ? data[0] : data;
    const n = Math.max(0, Number(typeof raw === 'object' && raw ? Object.values(raw)[0] : raw) || 0);
    const badge = link.querySelector('.nav-badge');
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    link.setAttribute('aria-label', n ? `Messages, ${n} non lu${n > 1 ? 's' : ''}` : 'Messages');
    return n;
  } catch (e) {
    if (!isNavCancel(e)) console.warn('[non lus]', e);
    return null;
  }
}

/**
 * Démarre le suivi des non-lus : un rafraîchissement tout de suite, puis chaque minute (si l'onglet est visible),
 * et un rafraîchissement au retour sur l'onglet. Relancer la fonction remet seulement le minuteur à zéro.
 */
export function startUnread() {
  refreshUnread();
  clearInterval(_unreadTimer);
  _unreadTimer = setInterval(() => { if (!document.hidden) refreshUnread(); }, 60000);
  if (_unreadBound) return;
  _unreadBound = true;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshUnread(); });
}
