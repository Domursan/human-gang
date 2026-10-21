// Pastille « messages non lus » de l'en-tête (rafraîchie à l'ouverture, toutes les minutes et au retour sur l'onglet).
import { sb } from './supabase.js';

let _unreadTimer = 0;
let _unreadBound = false;

/** Rafraîchit la pastille « messages non lus » de l'en-tête. Renvoie le nombre (ou null en cas d'échec). */
export async function refreshUnread() {
  const link = document.querySelector('.site-header .nav-msg');
  if (!link) return null;
  try {
    const { data, error } = await sb.rpc('hg_unread_count');
    if (error) throw error;
    const raw = Array.isArray(data) ? data[0] : data;
    const n = Math.max(0, Number(typeof raw === 'object' && raw ? Object.values(raw)[0] : raw) || 0);
    const badge = link.querySelector('.nav-badge');
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    link.setAttribute('aria-label', n ? `Messages, ${n} non lu${n > 1 ? 's' : ''}` : 'Messages');
    return n;
  } catch (e) {
    console.warn('[non lus]', e);
    return null;
  }
}
export function startUnread() {
  refreshUnread();
  clearInterval(_unreadTimer);
  _unreadTimer = setInterval(() => { if (!document.hidden) refreshUnread(); }, 60000);
  if (_unreadBound) return;
  _unreadBound = true;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshUnread(); });
}
