// Utilitaires purs du socle (aucune dépendance) : échappement, dates, avatar, mouvement réduit.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

const dateFmt = new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (d) => (d ? dateFmt.format(new Date(d)) : '');
export const fmtDateTime = (d) => (d ? dateTimeFmt.format(new Date(d)) : '');
export function daysUntil(d) {
  if (!d) return null;
  const ms = new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}
export function initials(name) { return String(name || '?').trim().slice(0, 2).toUpperCase(); }
export function avatarHtml(p, size = 40) {
  // Vérification à l'affichage (la base impose déjà ces formats, migration 021) :
  // seule une couleur hexadécimale et une image du bucket hg-avatars sont acceptées.
  const color = /^#[0-9a-f]{6}$/i.test(p?.color || '') ? p.color : 'var(--surface-2)';
  const avatarOk = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/hg-avatars\/[^\s"'<>]+$/i.test(p?.avatar_url || '');
  const style = `width:${size}px;height:${size}px;background:${esc(color)}`;
  return avatarOk
    ? `<img class="avatar" src="${esc(p.avatar_url)}" alt="" style="${style}">`
    : `<span class="avatar" aria-hidden="true" style="${style}">${esc(initials(p?.pseudo))}</span>`;
}

export function errMsg(e) { return e?.message || String(e); }

/** L'appareil demande-t-il de réduire les animations ? (false si la information n'est pas disponible) */
export function reducedMotion() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }
