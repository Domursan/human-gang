// Comptes admin : outils communs (icônes, busy, validations, message d'erreur d'onglet).
import { toast, errMsg, esc } from '../core.js';
import { svg } from '../icons.js';

/* ---------- Icônes ---------- */
export const IC = {
  back: svg('back2', { stroke: 2 }),
  chev: svg('chev', { stroke: 2 }),
  trash: svg('trash', { stroke: 2 }),
  eye: svg('eye', { stroke: 2 }),
  eyeOff: svg('eyeOff', { stroke: 2 }),
  check: svg('check2', { stroke: 2.2 }),
  arrow: svg('arrow2', { stroke: 2 }),
  search: svg('search', { stroke: 2 }),
};

/* ---------- Petits outils (copie locale : admin.js n'exporte rien) ---------- */
/** Action en cours : bouton désactivé, indicateur, pas de second envoi (même logique que admin/common.js). */
export async function busy(btn, fn) {
  if (btn?.dataset.busy) return undefined;
  if (btn) { btn.disabled = true; btn.dataset.busy = '1'; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return undefined; } finally {
    if (btn) { delete btn.dataset.busy; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); if (btn.isConnected) btn.disabled = false; }
  }
}
export function check(res) { if (res.error) throw res.error; return res.data; }
export const nullIfEmpty = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());
/** ISO -> valeur pour <input type="datetime-local"> (heure locale). */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const tabError = (r) => (r?.error ? `<div class="empty">Impossible de charger : ${esc(errMsg(r.error))}</div>` : '');
